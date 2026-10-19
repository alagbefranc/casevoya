/**
 * Who may put a Casevoya page in a frame. Every page and route answers X-Frame-Options:
 * SAMEORIGIN (clickjacking protection: no other site can frame the Sheet, the portal or sign-in).
 * The one exception is a firm's embedded enquiry form, /embed/enquiry/<firm>, which exists to be
 * framed by the firm's own website: it answers `Content-Security-Policy: frame-ancestors *` and
 * no X-Frame-Options. Nothing else is framable, including /enquiry/<firm>, the embed script and
 * the enquiry API (docs/DECISIONS.md, 2026-10-19).
 */

const EMBEDDABLE = /^\/embed\/enquiry\/[^/]+\/?$/;

export function isEmbeddablePath(pathname: string): boolean {
  return EMBEDDABLE.test(pathname);
}

export function framingHeaders(pathname: string): Record<string, string> {
  return isEmbeddablePath(pathname) ? { "Content-Security-Policy": "frame-ancestors *" } : { "X-Frame-Options": "SAMEORIGIN" };
}

/** Sets the framing headers for `pathname` on a response (a route's own stricter CSP is kept). */
export function applyFraming(headers: Headers, pathname: string): void {
  if (isEmbeddablePath(pathname)) {
    headers.delete("X-Frame-Options");
    headers.set("Content-Security-Policy", "frame-ancestors *");
    return;
  }
  headers.set("X-Frame-Options", "SAMEORIGIN");
}
