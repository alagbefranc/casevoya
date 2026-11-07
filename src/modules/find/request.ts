import zonesFile from "../../../public/find/countries.json";
import { clientAddress, ipKey, isIpAddress } from "@/lib/security/client-address";
import { isTimeZone } from "@/modules/scheduling/slots/zone";

const zonesByCode = zonesFile as Record<string, readonly string[]>;

/** The six goals on the public page, in the order the page shows them. */
export const FIND_GOALS = [
  "Study in Canada",
  "Work in Canada",
  "Bring family together",
  "Visit Canada",
  "Permanent residence",
  "Not sure yet",
] as const;

/** Exact consent sentence on the review step. Stored with every accepted request. */
export const FIND_CONSENT_STATEMENT =
  "I agree that Casevoya may read my request and share it with one licensed consultant who can help. Nothing is sent until I press Send.";

export const FIND_CONSENT_VERSION = "find-consent-2026-11-07";

/** Shown by the page and returned by the API whenever the request is not stored. */
export const FIND_NOT_SENT = "This was not sent. Check your connection and press Send again.";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export type FindRequest = {
  goal: (typeof FIND_GOALS)[number];
  country: string;
  code: string;
  zone: string;
  language: string;
  name: string;
  email: string;
  consent: true;
};

export type FindReadError = "invalid" | "consent_required";

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

/**
 * The public POST body. `consent` must be boolean true. `code` is an ISO country in the page's
 * country list, `zone` is one of that country's IANA zones, and `country` is the English name
 * the page shows for that code.
 */
export function readFindRequest(body: unknown): { input: FindRequest } | { error: FindReadError } {
  if (!body || typeof body !== "object") return { error: "invalid" };
  const row = body as Record<string, unknown>;
  if (row.consent !== true) return { error: "consent_required" };
  const goal = text(row.goal, 40);
  if (!goal || !FIND_GOALS.includes(goal as (typeof FIND_GOALS)[number])) return { error: "invalid" };
  const code = text(row.code, 2)?.toUpperCase() ?? "";
  const zones = zonesByCode[code];
  const country = text(row.country, 80);
  if (!zones || !country || regionNames.of(code) !== country) return { error: "invalid" };
  const zone = text(row.zone, 64);
  if (!zone || !zones.includes(zone) || !isTimeZone(zone)) return { error: "invalid" };
  const language = text(row.language, 80);
  if (!language || language === "Another language") return { error: "invalid" };
  const name = text(row.name, 80);
  const email = text(row.email, 254);
  if (!name || !email || !EMAIL.test(email)) return { error: "invalid" };
  return {
    input: {
      goal: goal as (typeof FIND_GOALS)[number],
      country,
      code,
      zone,
      language,
      name,
      email,
      consent: true,
    },
  };
}

/** sha256 hex of the visitor address (IPv6 as its /64). Missing addresses share one bucket. */
export async function findAddressHash(headers: Pick<Headers, "get">, salt = ""): Promise<string> {
  const first = clientAddress(headers)?.split(",")[0]?.trim() ?? "";
  const key = first && isIpAddress(first) ? ipKey(first) : "unknown";
  const data = new TextEncoder().encode(`casevoya-find:${salt}:${key}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
