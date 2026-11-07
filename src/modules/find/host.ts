/** Public hostname for the consultant introduction page. DNS is not set in this repo. */
export const FIND_HOST = "find.casevoya.ca";

/** True when `host` (a Host or X-Forwarded-Host value, with or without a port) is the find site. */
export function isFindHost(host: string | null | undefined): boolean {
  const first = (host ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  if (!first) return false;
  const name = first.startsWith("[") ? first.slice(0, first.indexOf("]") + 1) : first.replace(/:\d+$/, "");
  return name === FIND_HOST;
}
