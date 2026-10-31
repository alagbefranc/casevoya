const PROBE_ORIGIN = "https://redirect.invalid";
const MAX_REDIRECT_LENGTH = 2048;
// Backslash, any whitespace, C0 controls, DEL and C1 controls.
const UNSAFE_CHARS = /[\\\s\u0000-\u001f\u007f-\u009f]/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * A same-site path (with its query and hash) that is safe to redirect or navigate to, else
 * `fallback`. The input must be a single-slash path with no backslash, whitespace or control
 * characters; it is parsed the way a browser would, and the parsed output is checked again, so dot
 * segments or encoded slashes can't turn it into `//host` or `/\host`.
 */
export function safeRedirect(value: unknown, fallback = "/app"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_REDIRECT_LENGTH) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || UNSAFE_CHARS.test(value)) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== PROBE_ORIGIN || parsed.username || parsed.password) return fallback;
  const out = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  if (!out.startsWith("/") || out.startsWith("//") || out.includes("\\")) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(parsed.pathname);
  } catch {
    return fallback;
  }
  if (decoded.startsWith("//") || decoded.startsWith("/\\") || decoded.includes("\\") || CONTROL_CHARS.test(decoded)) return fallback;
  // The decoded path, if something downstream decodes it, must still be a same-site path.
  try {
    const again = new URL(decoded, PROBE_ORIGIN);
    if (again.origin !== PROBE_ORIGIN || again.pathname.startsWith("//")) return fallback;
  } catch {
    return fallback;
  }
  return out;
}

/** Same as safeRedirect; kept for existing callers. */
export const safeNext: (value: unknown, fallback?: string) => string = safeRedirect;

/**
 * An absolute URL for a server redirect: `path` (checked with safeRedirect) resolved against `base`,
 * and only ever on `base`'s origin. Anything else becomes `fallback` on that origin.
 */
export function redirectUrl(path: unknown, base: string | URL, fallback = "/app"): URL {
  const origin = new URL(base).origin;
  const target = new URL(safeRedirect(path, fallback), origin);
  if (target.origin === origin) return target;
  const backup = new URL(safeRedirect(fallback, "/"), origin);
  return backup.origin === origin ? backup : new URL("/", origin);
}

const GATED_PREFIXES = ["/app", "/portal", "/sheet", "/call"];

/** Firm workspace, client portal, sheet and video call routes. Signed-out visitors go to sign-in. */
export function isGatedPath(pathname: string): boolean {
  return GATED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Sign-in URL that keeps the path, including its query string, in `next`. */
export function signInLocation(pathname: string, search = ""): string {
  const query = search && !search.startsWith("?") ? `?${search}` : search;
  return `/sign-in?next=${encodeURIComponent(`${pathname}${query}`)}`;
}
