/**
 * Zernio webhook signatures (docs: "Webhooks > Signatures", llms-full read 2026-10-19):
 * `X-Zernio-Signature` is the lowercase hex HMAC-SHA256 of the raw request body, keyed by the
 * secret given when the endpoint was registered (`X-Late-Signature` is the legacy alias with the
 * same value). There is no timestamp in the signature; replays are absorbed by deduplicating on
 * the event id (`X-Zernio-Event-Id`, also `payload.id`).
 */
import { timingSafeEqual } from "@/modules/email/sign";

const encoder = new TextEncoder();

export async function zernioSignature(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** True only for a 64-hex signature that matches the raw body under this secret. */
export async function verifyZernioSignature(secret: string, rawBody: string, signature: string | null | undefined): Promise<boolean> {
  if (!secret) return false;
  const given = String(signature ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = await zernioSignature(secret, rawBody);
  return timingSafeEqual(expected, given);
}

/** The signature header, or its legacy alias. */
export function signatureHeader(headers: Headers): string | null {
  return headers.get("x-zernio-signature") ?? headers.get("x-late-signature");
}
