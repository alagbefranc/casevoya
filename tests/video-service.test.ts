import { AccessToken, TokenVerifier } from "livekit-server-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callIsOpen, callNotice, parseJoinView } from "@/modules/video/present";

// The video service and routes with Supabase and LiveKit faked: what the database answers turns
// into a LiveKit token (or none), rooms are created once, admit changes permissions, the webhook
// route checks LiveKit's signature before anything is applied.

const rpc = vi.fn();
const getClaims = vi.fn(async () => ({ data: { claims: { sub: "00000000-0000-4000-8000-0000000000aa" } } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, auth: { getClaims } }) }));
const serviceRpc = vi.fn(async () => ({ data: { outcome: "applied" }, error: null }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc: serviceRpc }) }));

const ORG = "11111111-1111-4111-8111-111111111111";
const REF = "abcdefghijklmnopqrstuvwxyz";
const ROOM = `cv-${"2".repeat(32)}`;
const KEY = "APIsynthetic";
const SECRET = "synthetic-secret-that-is-long-enough-for-hs256";

function open(overrides: Record<string, unknown> = {}) {
  return {
    state: "open",
    role: "client",
    title: "Video consultation",
    starts_at: "2026-10-22T15:00:00Z",
    ends_at: "2026-10-22T15:30:00Z",
    opens_at: "2026-10-22T14:45:00Z",
    closes_at: "2026-10-22T16:00:00Z",
    host_name: "Synthetic Host",
    firm_name: "Synthetic Firm",
    is_sample: false,
    room_name: ROOM,
    room_created: false,
    identity: "client:00000000-0000-4000-8000-0000000000aa",
    name: "Synthetic Client",
    admitted: false,
    ttl_seconds: 900,
    ...overrides,
  };
}

let fetchCalls: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  rpc.mockReset();
  serviceRpc.mockClear();
  fetchCalls = [];
  vi.stubEnv("LIVEKIT_URL", "wss://synthetic.livekit.test");
  vi.stubEnv("LIVEKIT_API_KEY", KEY);
  vi.stubEnv("LIVEKIT_API_SECRET", SECRET);
  vi.stubEnv("SUPABASE_SECRET_KEY", "service-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response("{}", { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function postToken() {
  const { POST } = await import("@/app/api/video/[ref]/token/route");
  return POST(new Request("https://app.test/api/video/x/token", { method: "POST", body: JSON.stringify({ organizationId: ORG }) }), { params: Promise.resolve({ ref: REF }) });
}

describe("token route", () => {
  it("a waiting client gets a lobby token; the room is created once and recorded", async () => {
    rpc.mockImplementation(async (name: string) => (name === "video_join" ? { data: open(), error: null } : { data: null, error: null }));
    const response = await postToken();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as { token: string; serverUrl: string; role: string; admitted: boolean };
    expect(body).toMatchObject({ serverUrl: "wss://synthetic.livekit.test", role: "client", admitted: false });
    const claims = await new TokenVerifier(KEY, SECRET).verify(body.token);
    expect(claims).toMatchObject({ sub: "client:00000000-0000-4000-8000-0000000000aa", video: { room: ROOM, roomJoin: true, canPublish: false, canSubscribe: false } });
    expect(rpc).toHaveBeenCalledWith("video_join", { p_org: ORG, p_ref: REF, p_issue: true });
    expect(rpc).toHaveBeenCalledWith("video_room_created", { p_org: ORG, p_ref: REF });
    expect(fetchCalls.map((c) => c.url)).toEqual(["https://synthetic.livekit.test/twirp/livekit.RoomService/CreateRoom"]);
    expect(fetchCalls[0].body).toMatchObject({ name: ROOM, emptyTimeout: 600, maxParticipants: 8 });
  });

  it("a call whose room was created before still asks for the room (it may have closed on its own), without recording it again", async () => {
    rpc.mockResolvedValue({ data: open({ role: "host", identity: "staff:00000000-0000-4000-8000-0000000000aa", admitted: true, room_created: true }), error: null });
    const body = (await (await postToken()).json()) as { token: string };
    const claims = await new TokenVerifier(KEY, SECRET).verify(body.token);
    expect(claims.sub).toBe("staff:00000000-0000-4000-8000-0000000000aa");
    expect(claims.video).toMatchObject({ room: ROOM, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    expect(claims.video?.roomAdmin).toBeFalsy();
    expect(claims.video?.roomCreate).toBeFalsy();
    expect(claims.video?.roomList).toBeFalsy();
    expect(claims.video?.roomRecord).toBeFalsy();
    expect(fetchCalls.map((c) => c.url)).toEqual(["https://synthetic.livekit.test/twirp/livekit.RoomService/CreateRoom"]);
    expect(fetchCalls[0].body).toMatchObject({ name: ROOM, emptyTimeout: 600, departureTimeout: 60, maxParticipants: 8 });
    expect(rpc).not.toHaveBeenCalledWith("video_room_created", expect.anything());
  });

  it("the join token lives at most 10 minutes even when the window is longer", async () => {
    rpc.mockImplementation(async (name: string) => (name === "video_join" ? { data: open({ ttl_seconds: 7200 }), error: null } : { data: null, error: null }));
    const body = (await (await postToken()).json()) as { token: string };
    const claims = await new TokenVerifier(KEY, SECRET).verify(body.token);
    expect(Number(claims.exp) - Number(claims.nbf)).toBeLessThanOrEqual(600);
  });

  it("no token when the identity the database answers isn't the signed-in person's own", async () => {
    for (const data of [
      open({ identity: "client:00000000-0000-4000-8000-0000000000bb" }),
      open({ role: "host", identity: "client:00000000-0000-4000-8000-0000000000aa", admitted: true }),
      open({ role: "client", identity: "staff:00000000-0000-4000-8000-0000000000aa" }),
    ]) {
      rpc.mockReset();
      rpc.mockResolvedValue({ data, error: null });
      fetchCalls = [];
      const response = await postToken();
      expect(response.status).toBe(403);
      expect(((await response.json()) as { token?: string }).token).toBeUndefined();
      expect(fetchCalls).toHaveLength(0);
    }
  });

  it("no token when the room can't be created", async () => {
    rpc.mockImplementation(async (name: string) => (name === "video_join" ? { data: open(), error: null } : { data: null, error: null }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "unavailable", msg: "down" }), { status: 503 })));
    const response = await postToken();
    expect(response.status).toBe(502);
    expect(((await response.json()) as { token?: string }).token).toBeUndefined();
    expect(rpc).not.toHaveBeenCalledWith("video_room_created", expect.anything());
  });

  it("before the window there is no token, only what the call is", async () => {
    rpc.mockResolvedValue({ data: open({ state: "early", room_name: undefined, identity: undefined }), error: null });
    const body = (await (await postToken()).json()) as { view: { state: string; grant: unknown }; configured: boolean; token?: string };
    expect(body.token).toBeUndefined();
    expect(body).toMatchObject({ view: { state: "early", grant: null }, configured: true });
  });

  it("without LiveKit settings nothing is counted or sent: the page says video isn't set up", async () => {
    vi.stubEnv("LIVEKIT_API_SECRET", "");
    rpc.mockResolvedValue({ data: open({ room_name: undefined }), error: null });
    const body = (await (await postToken()).json()) as { configured: boolean; token?: string };
    expect(body).toMatchObject({ configured: false });
    expect(body.token).toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("video_join", { p_org: ORG, p_ref: REF, p_issue: false });
    expect(fetchCalls).toHaveLength(0);
  });

  it("a refused caller, a bad reference and a signed-out visitor get no token", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "call access denied" } });
    expect((await postToken()).status).toBe(403);
    const { POST } = await import("@/app/api/video/[ref]/token/route");
    const bad = await POST(new Request("https://app.test/x", { method: "POST", body: JSON.stringify({ organizationId: ORG }) }), { params: Promise.resolve({ ref: "NOT-A-REF" }) });
    expect(bad.status).toBe(400);
    getClaims.mockResolvedValueOnce({ data: { claims: null } } as never);
    expect((await postToken()).status).toBe(401);
  });
});

describe("guest token route", () => {
  const BOOKING = "22222222-2222-4222-8222-222222222222";
  const GUEST_ROOM = `cv-${BOOKING.replaceAll("-", "")}`;
  async function postGuest() {
    const { POST } = await import("@/app/api/video/[ref]/token/route");
    return POST(new Request("https://app.test/x", { method: "POST", body: JSON.stringify({ guestToken: "g".repeat(43), name: "Sam" }) }), { params: Promise.resolve({ ref: REF }) });
  }

  it("a guest gets a short lobby token bound to their booking's identity and room", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "video_join_guest" ? { data: open({ room_name: GUEST_ROOM, identity: `client:${BOOKING}`, ttl_seconds: 5400 }), error: null } : { data: null, error: null },
    );
    const response = await postGuest();
    expect(response.status).toBe(200);
    const claims = await new TokenVerifier(KEY, SECRET).verify(((await response.json()) as { token: string }).token);
    expect(claims.sub).toBe(`client:${BOOKING}`);
    expect(claims.video).toMatchObject({ room: GUEST_ROOM, roomJoin: true, canPublish: false, canSubscribe: false, canPublishData: false });
    expect(claims.video?.roomAdmin).toBeFalsy();
    expect(Number(claims.exp) - Number(claims.nbf)).toBeLessThanOrEqual(600);
  });

  it("no guest token for a host role, or an identity that doesn't name the room", async () => {
    for (const data of [
      open({ role: "host", room_name: GUEST_ROOM, identity: `client:${BOOKING}` }),
      open({ room_name: ROOM, identity: `client:${BOOKING}` }),
      open({ room_name: GUEST_ROOM, identity: `staff:${BOOKING}` }),
    ]) {
      rpc.mockReset();
      rpc.mockResolvedValue({ data, error: null });
      fetchCalls = [];
      const response = await postGuest();
      expect(response.status).toBe(403);
      expect(fetchCalls).toHaveLength(0);
    }
  });
});

describe("admit route", () => {
  async function postAdmit(admit: boolean, identity = "client:00000000-0000-4000-8000-0000000000bb") {
    const { POST } = await import("@/app/api/video/[ref]/admit/route");
    return POST(new Request("https://app.test/x", { method: "POST", body: JSON.stringify({ organizationId: ORG, identity, admit }) }), { params: Promise.resolve({ ref: REF }) });
  }

  it("admitting gives the client publish and subscribe rights in the room", async () => {
    rpc.mockResolvedValue({ data: { room_name: ROOM, identity: "client:00000000-0000-4000-8000-0000000000bb" }, error: null });
    expect((await postAdmit(true)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("video_admit", { p_org: ORG, p_ref: REF, p_identity: "client:00000000-0000-4000-8000-0000000000bb", p_admit: true });
    expect(fetchCalls[0].url).toMatch(/UpdateParticipant$/);
    expect(fetchCalls[0].body).toMatchObject({ room: ROOM, permission: { canPublish: true, canSubscribe: true }, attributes: { admitted: "1" } });
  });

  it("sending away removes them from the room; a host identity can't be targeted", async () => {
    rpc.mockResolvedValue({ data: { room_name: ROOM, identity: "client:00000000-0000-4000-8000-0000000000bb" }, error: null });
    expect((await postAdmit(false)).status).toBe(200);
    expect(fetchCalls[0].url).toMatch(/RemoveParticipant$/);
    expect((await postAdmit(true, "staff:00000000-0000-4000-8000-0000000000bb")).status).toBe(400);
  });

  it("a non-host is refused by the database and nothing reaches LiveKit", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "only the host can let people in" } });
    expect((await postAdmit(true)).status).toBe(403);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("LiveKit webhook route", () => {
  async function post(body: string, authorization: string | null) {
    const { POST } = await import("@/app/api/video/livekit/webhook/route");
    const headers: Record<string, string> = { "content-type": "application/webhook+json" };
    if (authorization) headers.authorization = authorization;
    return POST(new Request("https://app.test/api/video/livekit/webhook", { method: "POST", body, headers }));
  }
  async function sign(body: string, secret = SECRET) {
    const at = new AccessToken(KEY, secret, { ttl: 300 });
    at.sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))).toString("base64");
    return at.toJwt();
  }
  const body = JSON.stringify({ id: "EV_1", event: "room_started", room: { name: ROOM }, createdAt: "1792670000" });

  it("applies a signed event", async () => {
    const response = await post(body, await sign(body));
    expect(response.status).toBe(200);
    expect(serviceRpc).toHaveBeenCalledWith("apply_livekit_event", { p_event: JSON.parse(body) });
  });

  it("refuses an unsigned or wrongly signed event before reading it", async () => {
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, await sign(body, "other-secret"))).status).toBe(401);
    expect((await post(body.replace("EV_1", "EV_2"), await sign(body))).status).toBe(401);
    expect(serviceRpc).not.toHaveBeenCalled();
  });
});

describe("present", () => {
  it("parses the database's answer and refuses anything else", () => {
    const view = parseJoinView(open({ admitted: true }));
    expect(view?.grant).toEqual({ roomName: ROOM, roomCreated: false, identity: "client:00000000-0000-4000-8000-0000000000aa", name: "Synthetic Client", admitted: true, ttlSeconds: 900 });
    expect(parseJoinView({ ...open(), state: "maybe" })).toBeNull();
    expect(parseJoinView({ ...open(), role: "admin" })).toBeNull();
    expect(parseJoinView(open({ room_name: "../other" }))?.grant).toBeNull();
  });

  it("the window opens 15 minutes before and closes 30 minutes after", () => {
    const start = "2026-10-22T15:00:00Z";
    const end = "2026-10-22T15:30:00Z";
    expect(callIsOpen(start, end, Date.parse("2026-10-22T14:44:59Z"))).toBe(false);
    expect(callIsOpen(start, end, Date.parse("2026-10-22T14:45:00Z"))).toBe(true);
    expect(callIsOpen(start, end, Date.parse("2026-10-22T15:59:59Z"))).toBe(true);
    expect(callIsOpen(start, end, Date.parse("2026-10-22T16:00:00Z"))).toBe(false);
  });

  it("says why a call can't be joined", () => {
    expect(callNotice({ state: "open", reason: null, firmName: "F" })).toBeNull();
    expect(callNotice({ state: "unavailable", reason: "cancelled", firmName: "F" })?.title).toBe("This consultation was cancelled");
    expect(callNotice({ state: "early", reason: null, firmName: "F" })?.copy).toMatch(/15 minutes/);
  });
});
