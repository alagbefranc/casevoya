const PROBE_ORIGIN = "https://next.invalid";

/**
 * Same-site relative path only. The value is parsed the way a browser would,
 * so `/\evil.com`, `/\t/evil.com` and `javascript:` all fall back.
 */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = "/app"): string {
  const next = typeof value === "string" ? value : fallback;
  if (!next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(next, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== PROBE_ORIGIN) return fallback;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
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
