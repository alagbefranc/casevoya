/**
 * The signed request between the app Worker and the Vo agent service (services/vo-agent). Pure Web
 * Crypto, so the same code runs in the Worker, in the Node container and in tests.
 *
 * Signature: hex HMAC-SHA256 of `${timestamp}.${body}` with the shared secret VO_AGENT_SECRET.
 * A request is accepted for VO_REQUEST_MAX_AGE_MS after its timestamp, and the body itself carries
 * an expiry, so a captured request can't be replayed later. The body carries the signed-in staff
 * member's own short-lived Supabase access token: every tool runs as that person, under RLS. It
 * never carries a service-role key.
 */

export const VO_REQUEST_MAX_AGE_MS = 60_000;
export const VO_SIGNATURE_HEADER = "x-vo-signature";
export const VO_TIMESTAMP_HEADER = "x-vo-timestamp";

export type VoTask = "message_reply" | "document_request" | "ask";

export type VoTaskRequest = {
  v: 1;
  runId: string;
  organizationId: string;
  membershipId: string;
  userId: string;
  task: VoTask;
  matterId: string;
  threadId: string | null;
  /** Ask Vo: the staff member's question. Treated as data like everything else. */
  question: string | null;
  /** The staff member's own Supabase access token (RLS applies to every tool). */
  accessToken: string;
  /** Epoch ms after which the service refuses the request. */
  expiresAt: number;
};

export type VoSourceRef = { kind: "message" | "matter" | "document_request" | "task" | "deadline"; id: string; label: string };

export type VoTaskResponse =
  | { result: "drafted"; draftId: string; text: string; needsRule: boolean; sources: VoSourceRef[] }
  | { result: "answered"; text: string; needsRule: boolean; sources: VoSourceRef[] }
  | { result: "abstained" }
  | { result: "failed"; failure: "unavailable" | "failed" | "empty" | "nothing_to_draft" };

const encoder = new TextEncoder();

async function key(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signVoRequest(secret: string, timestamp: number, body: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(`${timestamp}.${body}`));
  return hex(signature);
}

/** Constant-time comparison of two hex strings. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyVoRequest(
  secret: string,
  headers: { signature: string | null; timestamp: string | null },
  body: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!secret || secret.length < 32 || !headers.signature || !headers.timestamp) return false;
  if (!/^\d{10,16}$/.test(headers.timestamp) || !/^[0-9a-f]{64}$/.test(headers.signature)) return false;
  const timestamp = Number(headers.timestamp);
  if (Math.abs(now - timestamp) > VO_REQUEST_MAX_AGE_MS) return false;
  return same(await signVoRequest(secret, timestamp, body), headers.signature);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request body, checked field by field; null when anything is off. */
export function parseVoTaskRequest(raw: unknown, now: number = Date.now()): VoTaskRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = (value: unknown) => typeof value === "string" && UUID.test(value);
  if (r.v !== 1 || !id(r.runId) || !id(r.organizationId) || !id(r.membershipId) || !id(r.userId) || !id(r.matterId)) return null;
  if (r.task !== "message_reply" && r.task !== "document_request" && r.task !== "ask") return null;
  if (r.task === "ask" ? r.threadId !== null : !id(r.threadId)) return null;
  if (r.task === "ask" ? typeof r.question !== "string" || !r.question.trim() || r.question.length > 1000 : r.question !== null) return null;
  if (typeof r.accessToken !== "string" || r.accessToken.length < 20 || r.accessToken.length > 8000) return null;
  if (typeof r.expiresAt !== "number" || r.expiresAt < now || r.expiresAt > now + 5 * 60_000) return null;
  return r as unknown as VoTaskRequest;
}
