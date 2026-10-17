/** Same-site relative path only. Rejects protocol-relative URLs. */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = "/app"): string {
  const next = typeof value === "string" ? value : fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}

const GATED_PREFIXES = ["/app", "/portal", "/sheet"];

/** Firm workspace, client portal, and sheet routes. Signed-out visitors go to sign-in. */
export function isGatedPath(pathname: string): boolean {
  return GATED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Sign-in URL that keeps the path, including its query string, in `next`. */
export function signInLocation(pathname: string, search = ""): string {
  const query = search && !search.startsWith("?") ? `?${search}` : search;
  return `/sign-in?next=${encodeURIComponent(`${pathname}${query}`)}`;
}
