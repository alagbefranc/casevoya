/** Public hostname for the consultant introduction page. DNS is not set in this repo. */
export const FIND_HOST = "find.casevoya.ca";

/** True when `host` (a Host or X-Forwarded-Host value, with or without a port) is the find site. */
export function isFindHost(host: string | null | undefined): boolean {
  const first = (host ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first) return false;
  const name = first.startsWith("[") ? first.slice(0, first.indexOf("]") + 1) : first.replace(/:\d+$/, "");
  return name === FIND_HOST;
}

/**
 * Public file for a find-host path that is not already under /find.
 * `/` is the introduction page. Other paths keep the page's /find prefix.
 * Null when this request should stay on the app router.
 */
export function findAssetPath(pathname: string): string | null {
  if (pathname.startsWith("/api") || pathname.startsWith("/_next") || pathname.startsWith("/find")) return null;
  return pathname === "/" ? "/find/index.html" : `/find${pathname}`;
}

export type AssetFetcher = { fetch: (input: Request) => Promise<Response> };

/**
 * Read the find page from the asset bucket. A Next rewrite to `/find/index.html` never reaches
 * that bucket in the OpenNext worker (assets run before the worker, and an internal rewrite is
 * then rendered by the app router, which 404s). Returns null when there is no bucket, so
 * `next dev` can keep its public-file rewrite.
 */
export async function fetchFindAsset(requestUrl: string, pathname: string, assets: AssetFetcher | null): Promise<Response | null> {
  const assetPath = findAssetPath(pathname);
  if (!assetPath || !assets) return null;
  const url = new URL(requestUrl);
  url.pathname = assetPath;
  url.search = "";
  try {
    const response = await assets.fetch(new Request(url.toString(), { method: "GET" }));
    if (response.ok && response.body) return response;
    // Some asset configs redirect /find/index.html to /find/. Follow one hop inside the bucket.
    const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!location) return null;
    const next = await assets.fetch(new Request(new URL(location, url).toString(), { method: "GET" }));
    if (!next.ok || !next.body) return null;
    return next;
  } catch {
    return null;
  }
}
