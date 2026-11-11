/** Same words as the other cookie-authenticated writes. */
export const SAME_ORIGIN_ERROR = "This request must come from Casevoya.";

/**
 * A browser mutation from this site. The Origin header must be this response's origin.
 * A missing Origin is refused: these routes are called by our own pages, which send it.
 */
export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
