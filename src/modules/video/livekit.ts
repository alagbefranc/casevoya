/**
 * LiveKit, without the Node server SDK: tokens are HS256 JWTs signed with Web Crypto and the room
 * API is Twirp (JSON over POST), so this runs on Cloudflare Workers. Shapes follow the official
 * `livekit-server-sdk` 2.19 (AccessToken, TokenVerifier, WebhookReceiver, RoomServiceClient;
 * Apache-2.0), read 2026-10-22: claims `iss` = API key, `sub` = identity, `nbf`, `exp`, `name`,
 * `metadata`, `attributes`, `video` (the grant); Twirp path `/twirp/livekit.RoomService/<Method>`
 * with `Authorization: Bearer <server token>`; webhooks carry the JWT in `Authorization` with a
 * `sha256` claim (base64 SHA-256 of the raw body).
 *
 * The API secret never leaves the server; tokens are returned to the browser once and never
 * stored or logged.
 */

export type VideoGrant = {
  room?: string;
  roomJoin?: boolean;
  roomCreate?: boolean;
  roomAdmin?: boolean;
  roomList?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  canPublishSources?: ("camera" | "microphone" | "screen_share" | "screen_share_audio")[];
  canUpdateOwnMetadata?: boolean;
  hidden?: boolean;
};

export type LiveKitConfig = { url: string; apiKey: string; apiSecret: string };

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(value: unknown): string {
  return base64url(encoder.encode(JSON.stringify(value)));
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** A signed HS256 JWT. `ttlSeconds` from now; `nbf` is now. */
export async function signLiveKitJwt(
  config: Pick<LiveKitConfig, "apiKey" | "apiSecret">,
  claims: { sub?: string; name?: string; metadata?: string; attributes?: Record<string, string>; video?: VideoGrant; sha256?: string },
  ttlSeconds: number,
  now: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(now / 1000);
  const payload = { ...claims, iss: config.apiKey, nbf: iat, exp: iat + Math.max(1, Math.floor(ttlSeconds)) };
  const head = `${base64urlJson({ alg: "HS256", typ: "JWT" })}.${base64urlJson(payload)}`;
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(config.apiSecret, "sign"), encoder.encode(head));
  return `${head}.${base64url(new Uint8Array(mac))}`;
}

/**
 * The claims of a JWT signed by this API key and secret, or null: wrong signature, another
 * issuer, no `exp`, expired or not yet valid (10 seconds of clock tolerance, as the SDK).
 */
export async function verifyLiveKitJwt(
  config: Pick<LiveKitConfig, "apiKey" | "apiSecret">,
  token: string,
  now: number = Date.now(),
): Promise<Record<string, unknown> | null> {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || !config.apiSecret) return null;
  let header: { alg?: unknown };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== "HS256" || !payload || typeof payload !== "object") return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(config.apiSecret, "verify"), fromBase64url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return null;
  }
  if (!ok) return null;
  const seconds = now / 1000;
  if (payload.iss !== config.apiKey) return null;
  if (typeof payload.exp !== "number" || payload.exp + 10 < seconds) return null;
  if (typeof payload.nbf === "number" && payload.nbf - 10 > seconds) return null;
  return payload;
}

async function sha256Base64(body: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
  let binary = "";
  for (const byte of hash) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** True only when the webhook's Authorization JWT is ours and its sha256 claim matches the raw body. */
export async function verifyLiveKitWebhook(
  config: Pick<LiveKitConfig, "apiKey" | "apiSecret">,
  rawBody: string,
  authorization: string | null | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  const token = String(authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const claims = await verifyLiveKitJwt(config, token, now);
  if (!claims || typeof claims.sha256 !== "string") return false;
  return claims.sha256 === (await sha256Base64(rawBody));
}

/** wss://… → https://… for the Twirp API (as the SDK does). */
export function liveKitHttpUrl(url: string): string {
  return url.replace(/^ws(s?):\/\//i, "http$1://").replace(/\/+$/, "");
}

export class LiveKitApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

/** The few RoomService calls Casevoya makes. Each call signs its own 10-minute server token. */
export function roomService(config: LiveKitConfig, fetcher: Fetch = fetch) {
  async function call(method: string, body: Record<string, unknown>, grant: VideoGrant): Promise<Record<string, unknown>> {
    const token = await signLiveKitJwt(config, { video: grant }, 600);
    const response = await fetcher(`${liveKitHttpUrl(config.url)}/twirp/livekit.RoomService/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    if (!response.ok) {
      const code = typeof data.code === "string" ? data.code : null;
      throw new LiveKitApiError(typeof data.msg === "string" ? data.msg : `LiveKit ${method} failed`, response.status, code);
    }
    return data;
  }
  return {
    /** Idempotent: an existing room is returned as it is. */
    createRoom(name: string, options: { emptyTimeout: number; departureTimeout: number; maxParticipants: number; metadata?: string }) {
      return call("CreateRoom", { name, ...options }, { roomCreate: true });
    },
    /** Disconnects everyone. A room that no longer exists is not an error. */
    async deleteRoom(room: string) {
      try {
        await call("DeleteRoom", { room }, { roomCreate: true });
      } catch (error) {
        if (error instanceof LiveKitApiError && (error.status === 404 || error.code === "not_found")) return;
        throw error;
      }
    },
    updateParticipant(room: string, identity: string, change: { permission?: Record<string, unknown>; attributes?: Record<string, string> }) {
      return call("UpdateParticipant", { room, identity, ...change }, { roomAdmin: true, room });
    },
    async removeParticipant(room: string, identity: string) {
      try {
        await call("RemoveParticipant", { room, identity }, { roomAdmin: true, room });
      } catch (error) {
        if (error instanceof LiveKitApiError && (error.status === 404 || error.code === "not_found")) return;
        throw error;
      }
    },
  };
}

/** Room limits (BUILD-SPEC §7.1): closes 10 minutes after the last person leaves; 8 people at most. */
export const ROOM_OPTIONS = { emptyTimeout: 600, departureTimeout: 60, maxParticipants: 8 } as const;

/** What a host may publish, and what an admitted client gets (BUILD-SPEC §7.3, §7.4). */
export const FULL_SOURCES: NonNullable<VideoGrant["canPublishSources"]> = ["camera", "microphone", "screen_share", "screen_share_audio"];

/**
 * The join grant. A host is a room admin; an admitted client publishes and subscribes; a client in
 * the lobby can neither publish nor subscribe (sees and sends nothing) until a host admits them.
 */
export function joinGrant(room: string, role: "host" | "client", admitted: boolean): VideoGrant {
  if (role === "host") {
    return { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: FULL_SOURCES, roomAdmin: true, canUpdateOwnMetadata: false };
  }
  if (admitted) {
    return { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: FULL_SOURCES, canUpdateOwnMetadata: false };
  }
  return { room, roomJoin: true, canPublish: false, canSubscribe: false, canPublishData: false, canUpdateOwnMetadata: false, hidden: false };
}

/** The permission a host's Admit gives a waiting client (UpdateParticipant; TrackSource enum names). */
export const ADMITTED_PERMISSION = {
  canSubscribe: true,
  canPublish: true,
  canPublishData: true,
  canPublishSources: ["CAMERA", "MICROPHONE", "SCREEN_SHARE", "SCREEN_SHARE_AUDIO"],
  canUpdateMetadata: false,
} as const;

/** A participant's join token, valid `ttlSeconds`. */
export function participantToken(
  config: LiveKitConfig,
  input: { identity: string; name: string; role: "host" | "client"; admitted: boolean; room: string; ttlSeconds: number },
  now?: number,
): Promise<string> {
  return signLiveKitJwt(
    config,
    {
      sub: input.identity,
      name: input.name,
      metadata: JSON.stringify({ role: input.role }),
      attributes: { role: input.role, admitted: input.role === "host" || input.admitted ? "1" : "0" },
      video: joinGrant(input.room, input.role, input.admitted),
    },
    input.ttlSeconds,
    now,
  );
}
