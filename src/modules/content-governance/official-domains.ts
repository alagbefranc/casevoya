/**
 * Official-host allowlist. Must stay in lockstep with the
 * official_source_domains seed in supabase/migrations/20261017110000_source_governance.sql.
 *
 * A match is an entry gate. It does not approve a page, program, fee, form, or deadline.
 * IRCC on canada.ca includes www.canada.ca and ircc.canada.ca. cic.gc.ca includes
 * subdomains such as www.cic.gc.ca. A lookalike such as cic.gc.ca.evil.com does not match.
 */
export const OFFICIAL_SOURCE_HOSTS = [
  "canada.ca",
  "cic.gc.ca",
  "justice.gc.ca",
  "college-ic.ca",
  "priv.gc.ca",
  "irb-cisr.gc.ca",
  "cai.gouv.qc.ca",
  "gouv.qc.ca",
  "quebec.ca",
  "ontario.ca",
  "gov.bc.ca",
  "alberta.ca",
  "gov.mb.ca",
  "saskatchewan.ca",
  "gov.sk.ca",
  "gnb.ca",
  "novascotia.ca",
  "gov.pe.ca",
  "gov.nl.ca",
  "gov.nt.ca",
  "gov.nu.ca",
  "yukon.ca",
] as const;

export type OfficialSourceHost = (typeof OFFICIAL_SOURCE_HOSTS)[number];

const HOST_PATTERN =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function hostMatchesAllowlist(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  return OFFICIAL_SOURCE_HOSTS.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

/** Returns the lowercase host, or null when the URL cannot be an official source. */
export function officialUrlHost(raw: string): string | null {
  if (raw !== raw.trim() || /[\s@\\]/.test(raw) || !raw.startsWith("https://")) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  let host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    host === "metadata.google.internal" ||
    host.includes(":") ||
    /^[0-9.]+$/.test(host) ||
    !HOST_PATTERN.test(host)
  ) {
    return null;
  }
  return host;
}

export function officialUrlIsAllowlisted(raw: string): boolean {
  const host = officialUrlHost(raw);
  return host !== null && hostMatchesAllowlist(host);
}
