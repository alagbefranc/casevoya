/**
 * Redaction for anything written to logs (Workers observability keeps console output). Removes
 * credentials from headers, bearer tokens, JWT-shaped strings and secret query values, so a log
 * line never carries a session, signed link or webhook signature.
 */

export const REDACTED = "[redacted]";

/** Header names whose values are never logged. */
const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|cf-access-jwt-assertion|cf-access-client-secret|x-api-key|apikey|x-[a-z0-9-]*-(signature|token|secret)|x-[a-z0-9-]*signature)$/i;

/** Query (or form-style) parameters whose values are never logged. */
const SECRET_PARAMS = [
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "token_hash",
  "code",
  "key",
  "apikey",
  "api_key",
  "secret",
  "signature",
  "sig",
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-security-token",
];
const SECRET_QUERY = new RegExp(`([?&;](?:${SECRET_PARAMS.join("|")})=)[^&#\\s"'<>]*`, "gi");
const BEARER = /\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
// Three base64url segments, the first starting like a JSON object header ("eyJ").
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const SUPABASE_SECRET = /\bsb_secret_[A-Za-z0-9_-]+/g;
/** Object keys (besides credential headers) whose values are never logged. */
const SENSITIVE_KEY = /^(token|access_token|refresh_token|id_token|password|secret|api_key|apikey|signature|jwt)$/i;
const MAX_DEPTH = 4;

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADER.test(name.trim());
}

/** A string with bearer tokens, JWTs, Supabase secret keys and secret query values replaced. */
export function redactText(text: string): string {
  return text
    .replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(SUPABASE_SECRET, REDACTED)
    .replace(SECRET_QUERY, `$1${REDACTED}`);
}

/** Headers as a plain object, credential headers replaced and other values redacted as text. */
export function redactHeaders(headers: Headers | Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  const entries: [string, string][] = [];
  if (headers instanceof Headers) headers.forEach((value, name) => entries.push([name, value]));
  else {
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) entries.push([name, Array.isArray(value) ? value.join(", ") : value]);
    }
  }
  for (const [name, value] of entries) out[name] = isSensitiveHeader(name) ? REDACTED : redactText(value);
  return out;
}

/** An error's message, redacted; "unknown" for anything that isn't an Error. */
export function redactedMessage(error: unknown): string {
  return error instanceof Error ? redactText(error.message) : typeof error === "string" ? redactText(error) : "unknown";
}

/**
 * Any value made safe to log: strings are redacted, Errors become {name, message}, Headers and
 * Requests lose credentials (a Request is reduced to its method and redacted URL), and plain objects
 * have the values of credential-named keys replaced.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[…]";
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (typeof Headers !== "undefined" && value instanceof Headers) return redactHeaders(value);
  if (typeof Request !== "undefined" && value instanceof Request) return { method: value.method, url: redactText(value.url) };
  if (value instanceof URL) return redactText(value.toString());
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = isSensitiveHeader(key) || SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1);
  return out;
}
