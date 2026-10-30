type HeaderSource = Pick<Headers, "get">;

/**
 * The visitor's address as Cloudflare reports it. cf-connecting-ip is set by Cloudflare's edge
 * and replaces any value the client sent; x-real-ip and x-forwarded-for (which the client can
 * write) are used only when it is absent, as on a local proxy.
 */
export function clientAddress(headers: HeaderSource): string | null {
  return headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? headers.get("x-forwarded-for");
}

/** A single valid IP address from clientAddress (first entry of a list), or the fallback. */
export function clientIp(headers: HeaderSource, fallback = "127.0.0.1"): string {
  const first = clientAddress(headers)?.split(",")[0]?.trim() ?? "";
  return isIpAddress(first) ? first : fallback;
}

export function isIpAddress(value: string): boolean {
  if (/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(value)) return true;
  if (value.length > 45 || !value.includes(":") || !/^[0-9A-Fa-f:.]+$/.test(value)) return false;
  try {
    return new URL(`http://[${value}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}
