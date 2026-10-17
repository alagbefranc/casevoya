import { RESERVED_FIRM_SLUGS } from "@/lib/auth/slug";

export const DEFAULT_INBOUND_EMAIL_DOMAIN = "docs.casevoya.ca";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const TOKEN = /^[a-f0-9]{32}$/;
const RESERVED = new Set<string>(RESERVED_FIRM_SLUGS);

export type ParsedInboundAddress =
  | { ok: true; slug: string; token: string | null; domain: string }
  | { ok: false; reason: "domain" | "syntax" | "reserved" };

export function inboundDomain(override?: string | null): string {
  const domain = (override ?? DEFAULT_INBOUND_EMAIL_DOMAIN).trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9.-]{0,188}[a-z0-9])?$/.test(domain)) return DEFAULT_INBOUND_EMAIL_DOMAIN;
  return domain;
}

/** Firm addresses are slug@domain. Matter replies are slug+token@ the same domain. */
export function parseInboundAddress(address: string, domain = DEFAULT_INBOUND_EMAIL_DOMAIN): ParsedInboundAddress {
  const expected = inboundDomain(domain);
  const raw = address.trim().toLowerCase();
  const bracket = raw.match(/<([^>]+)>/);
  const email = bracket?.[1] ?? raw;
  const at = email.lastIndexOf("@");
  if (at < 1) return { ok: false, reason: "syntax" };
  const host = email.slice(at + 1);
  const local = email.slice(0, at);
  if (host !== expected) return { ok: false, reason: "domain" };
  const plus = local.indexOf("+");
  const slug = plus === -1 ? local : local.slice(0, plus);
  const token = plus === -1 ? null : local.slice(plus + 1);
  if (!SLUG.test(slug) || (token !== null && !TOKEN.test(token))) return { ok: false, reason: "syntax" };
  if (RESERVED.has(slug)) return { ok: false, reason: "reserved" };
  return { ok: true, slug, token, domain: expected };
}

export function firmAddress(slug: string, domain = DEFAULT_INBOUND_EMAIL_DOMAIN, token?: string | null): string {
  const host = inboundDomain(domain);
  if (token) return `${slug}+${token}@${host}`;
  return `${slug}@${host}`;
}
