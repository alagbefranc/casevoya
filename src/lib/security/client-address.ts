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

/**
 * The address as a rate-limit or hash key: IPv4 unchanged, IPv6 cut to its /64 network (one
 * subscriber usually holds a whole /64), an IPv4-mapped IPv6 address as its IPv4 address. Anything
 * that is not an address is returned trimmed.
 */
export function ipKey(address: string): string {
  const value = address.trim();
  if (!value.includes(":")) return value;
  const groups = ipv6Groups(value);
  if (!groups) return value.toLowerCase();
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join(".");
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    text = `${text.slice(0, v4.index)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!all.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return all.map((group) => Number.parseInt(group, 16));
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
