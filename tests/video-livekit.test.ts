import { AccessToken, TokenVerifier, WebhookReceiver } from "livekit-server-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  ADMITTED_PERMISSION,
  joinGrant,
  liveKitHttpUrl,
  participantToken,
  roomService,
  signLiveKitJwt,
  verifyLiveKitJwt,
  verifyLiveKitWebhook,
} from "@/modules/video/livekit";

// The Web Crypto LiveKit helpers, checked against the official server SDK (dev dependency only):
// our join tokens verify with its TokenVerifier, its webhook tokens verify with ours.

const config = { url: "wss://synthetic.livekit.test", apiKey: "APIsynthetic", apiSecret: "synthetic-secret-that-is-long-enough-for-hs256" };

describe("join tokens", () => {
  it("a host token verifies with the official SDK and carries the room-admin grant", async () => {
    const token = await participantToken(config, { identity: "staff:00000000-0000-4000-8000-000000000001", name: "Synthetic Host", role: "host", admitted: true, room: "cv-0123", ttlSeconds: 900 });
    const claims = await new TokenVerifier(config.apiKey, config.apiSecret).verify(token);
    expect(claims).toMatchObject({
      iss: config.apiKey,
      sub: "staff:00000000-0000-4000-8000-000000000001",
      name: "Synthetic Host",
      attributes: { role: "host", admitted: "1" },
      video: { room: "cv-0123", roomJoin: true, roomAdmin: true, canPublish: true, canSubscribe: true, canPublishSources: ["camera", "microphone", "screen_share", "screen_share_audio"] },
    });
    expect(JSON.parse(String(claims.metadata))).toEqual({ role: "host" });
    expect(Number(claims.exp) - Number(claims.nbf)).toBe(900);
  });

  it("a client in the lobby can neither publish nor subscribe; admitted, they can", () => {
    expect(joinGrant("cv-1", "client", false)).toMatchObject({ roomJoin: true, canPublish: false, canSubscribe: false, canPublishData: false });
    expect(joinGrant("cv-1", "client", false).roomAdmin).toBeUndefined();
    expect(joinGrant("cv-1", "client", true)).toMatchObject({ canPublish: true, canSubscribe: true, canPublishData: true });
    expect(joinGrant("cv-1", "client", true).roomAdmin).toBeUndefined();
  });

  it("our verifier refuses another secret, another issuer, expiry and tampering", async () => {
    const now = Date.UTC(2026, 9, 22, 12);
    const token = await signLiveKitJwt(config, { sub: "x" }, 60, now);
    expect(await verifyLiveKitJwt(config, token, now)).toMatchObject({ sub: "x" });
    expect(await verifyLiveKitJwt({ ...config, apiSecret: "other" }, token, now)).toBeNull();
    expect(await verifyLiveKitJwt({ ...config, apiKey: "APIother" }, token, now)).toBeNull();
    expect(await verifyLiveKitJwt(config, token, now + 71_000)).toBeNull();
    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "y", iss: config.apiKey, exp: 9999999999 })).toString("base64url");
    expect(await verifyLiveKitJwt(config, `${h}.${forged}.${s}`, now)).toBeNull();
    expect(await verifyLiveKitJwt(config, `${h}.${p}`, now)).toBeNull();
  });

  it("a token minted by the official SDK verifies with ours", async () => {
    const at = new AccessToken(config.apiKey, config.apiSecret, { identity: "client:1", ttl: 60 });
    at.addGrant({ roomJoin: true, room: "cv-1" });
    expect(await verifyLiveKitJwt(config, await at.toJwt())).toMatchObject({ sub: "client:1", video: { room: "cv-1", roomJoin: true } });
  });
});

describe("webhooks", () => {
  const body = JSON.stringify({ id: "EV_1", event: "room_started", room: { name: "cv-1" }, createdAt: "1792670000" });

  async function sdkAuthorization(raw: string) {
    // What LiveKit's server sends: a JWT whose sha256 claim is the base64 SHA-256 of the body.
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))).toString("base64");
    const at = new AccessToken(config.apiKey, config.apiSecret, { ttl: 300 });
    at.sha256 = digest;
    return at.toJwt();
  }

  it("accepts LiveKit's signature over the exact body, with or without Bearer", async () => {
    const auth = await sdkAuthorization(body);
    expect(await verifyLiveKitWebhook(config, body, auth)).toBe(true);
    expect(await verifyLiveKitWebhook(config, body, `Bearer ${auth}`)).toBe(true);
    // And the SDK agrees.
    await expect(new WebhookReceiver(config.apiKey, config.apiSecret).receive(body, auth)).resolves.toMatchObject({ event: "room_started" });
  });

  it("refuses a changed body, a missing header and another secret", async () => {
    const auth = await sdkAuthorization(body);
    expect(await verifyLiveKitWebhook(config, body.replace("room_started", "room_finished"), auth)).toBe(false);
    expect(await verifyLiveKitWebhook(config, body, null)).toBe(false);
    expect(await verifyLiveKitWebhook({ ...config, apiSecret: "other" }, body, auth)).toBe(false);
    // A token without a sha256 claim is not a webhook signature.
    expect(await verifyLiveKitWebhook(config, body, await signLiveKitJwt(config, {}, 60))).toBe(false);
  });
});

describe("room service", () => {
  it("posts Twirp JSON with a short server token scoped to the call", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("{}", { status: 200 });
    });
    const api = roomService(config, fetcher as unknown as typeof fetch);
    await api.createRoom("cv-1", { emptyTimeout: 600, departureTimeout: 60, maxParticipants: 8 });
    await api.updateParticipant("cv-1", "client:1", { permission: { ...ADMITTED_PERMISSION }, attributes: { admitted: "1" } });
    expect(calls[0].url).toBe("https://synthetic.livekit.test/twirp/livekit.RoomService/CreateRoom");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ name: "cv-1", emptyTimeout: 600, departureTimeout: 60, maxParticipants: 8 });
    const createAuth = String((calls[0].init.headers as Record<string, string>).Authorization).replace("Bearer ", "");
    expect((await new TokenVerifier(config.apiKey, config.apiSecret).verify(createAuth)).video).toEqual({ roomCreate: true });
    expect(calls[1].url).toMatch(/UpdateParticipant$/);
    const updateAuth = String((calls[1].init.headers as Record<string, string>).Authorization).replace("Bearer ", "");
    expect((await new TokenVerifier(config.apiKey, config.apiSecret).verify(updateAuth)).video).toEqual({ roomAdmin: true, room: "cv-1" });
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ room: "cv-1", identity: "client:1", permission: { canPublish: true, canPublishSources: ["CAMERA", "MICROPHONE", "SCREEN_SHARE", "SCREEN_SHARE_AUDIO"] }, attributes: { admitted: "1" } });
  });

  it("a room that is already gone is not an error when deleting; other failures are", async () => {
    const gone = roomService(config, (async () => new Response(JSON.stringify({ code: "not_found", msg: "room not found" }), { status: 404 })) as unknown as typeof fetch);
    await expect(gone.deleteRoom("cv-1")).resolves.toBeUndefined();
    const broken = roomService(config, (async () => new Response(JSON.stringify({ code: "internal", msg: "boom" }), { status: 500 })) as unknown as typeof fetch);
    await expect(broken.deleteRoom("cv-1")).rejects.toThrow("boom");
  });

  it("wss and ws URLs map to https and http", () => {
    expect(liveKitHttpUrl("wss://x.livekit.cloud/")).toBe("https://x.livekit.cloud");
    expect(liveKitHttpUrl("ws://localhost:7880")).toBe("http://localhost:7880");
  });
});
