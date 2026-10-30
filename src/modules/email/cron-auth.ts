/**
 * Bearer check for the scheduler routes (mail and WhatsApp dispatch, retention, scheduled
 * reports, document scans, source re-checks). Purposes are kept apart:
 *   - CRON_SECRET (optional, at least 16 characters): when set it is the only accepted bearer.
 *   - Otherwise the cron key derived from EMAIL_DISPATCH_SECRET by HKDF-SHA-256
 *     (info "casevoya/cron-auth/v1"), or, for the existing callers (pg_cron kicks through the
 *     Vault secret `email_dispatch_secret`, scripts/rescan-legacy-documents.mjs), the raw
 *     EMAIL_DISPATCH_SECRET.
 * Sealing keys (invite-link-seal.ts) use their own HKDF salt and info, so no accepted bearer is
 * ever a sealing key. Comparisons are over SHA-256 digests, constant time, length independent.
 * Web Crypto only (runs in the Cloudflare Worker).
 */

export const CRON_KEY_SALT = "casevoya.cron-auth";
export const CRON_KEY_INFO = "casevoya/cron-auth/v1";
const MIN_SECRET_LENGTH = 16;

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The cron bearer derived from the dispatch secret (base64url, 43 chars), or null for a short secret. */
export async function deriveCronKey(secret: string): Promise<string | null> {
  if (secret.length < MIN_SECRET_LENGTH) return null;
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(CRON_KEY_SALT), info: encoder.encode(CRON_KEY_INFO) },
    base,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

/** The bearer token of an Authorization header, or "" when there is none. */
export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

export type CronSecrets = { cronSecret?: string; dispatchSecret: string };

/** The bearers a scheduler route accepts, most specific first. */
export async function acceptedCronBearers(secrets: CronSecrets): Promise<string[]> {
  const cronSecret = secrets.cronSecret ?? "";
  if (cronSecret.trim().length >= MIN_SECRET_LENGTH) return [cronSecret];
  if (!secrets.dispatchSecret) return [];
  const derived = await deriveCronKey(secrets.dispatchSecret);
  return derived ? [derived, secrets.dispatchSecret] : [secrets.dispatchSecret];
}

/** True when the token is an accepted scheduler bearer. Never throws. */
export async function cronBearerAuthorized(token: string, secrets: CronSecrets): Promise<boolean> {
  try {
    if (!token) return false;
    const accepted = await acceptedCronBearers(secrets);
    const given = await digest(token);
    let ok = false;
    for (const value of accepted) {
      const match = equalBytes(given, await digest(value));
      ok = ok || match;
    }
    return ok;
  } catch {
    return false;
  }
}
