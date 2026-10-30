import { isAcceptableEmail } from "@/lib/auth/invitations";
import { isIsoCountry } from "@/lib/iso-country";

/**
 * What the Settings dialogs may send, checked before the database checks it again. Pure.
 * Keys match public.update_firm_profile's; nothing else is passed through.
 */
export const FIRM_DETAIL_KEYS = [
  "legal_name",
  "display_name",
  "billing_contact_name",
  "billing_contact_email",
  "privacy_contact_name",
  "privacy_contact_email",
  "continuity_contact_name",
  "continuity_contact_email",
] as const;

const MAX: Record<(typeof FIRM_DETAIL_KEYS)[number], number> = {
  legal_name: 300,
  display_name: 200,
  billing_contact_name: 200,
  billing_contact_email: 320,
  privacy_contact_name: 200,
  privacy_contact_email: 320,
  continuity_contact_name: 200,
  continuity_contact_email: 320,
};

const REQUIRED = new Set(["legal_name", "display_name", "billing_contact_name", "billing_contact_email", "privacy_contact_name", "privacy_contact_email"]);
/** Same rule as app.normalize_email: one address, no markup or quoting characters. */
const EMAIL = { test: (value: string) => isAcceptableEmail(value.toLowerCase()) };

export function firmDetailChanges(fields: Record<string, unknown>): { changes: Record<string, string> } | { error: string } {
  const changes: Record<string, string> = {};
  for (const key of FIRM_DETAIL_KEYS) {
    const raw = fields?.[key];
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (REQUIRED.has(key) && !value) return { error: "Names and the billing and privacy contacts can’t be empty." };
    if (value.length > MAX[key]) return { error: "One of the details is too long." };
    if (key.endsWith("_email") && value && !EMAIL.test(value)) return { error: "Enter a full email address." };
    changes[key] = key.endsWith("_email") ? value.toLowerCase() : value;
  }
  if (Object.keys(changes).length === 0) return { error: "Nothing to save." };
  // The continuity contact is both a name and an email, or neither.
  const continuity = continuityProblem(changes.continuity_contact_name, changes.continuity_contact_email);
  if (continuity) return { error: continuity };
  return { changes };
}

/**
 * The continuity contact is a name and an email together, or neither. Undefined means the form
 * didn't send that field (left as saved); an empty string clears it.
 */
export function continuityProblem(name: string | undefined, email: string | undefined): string | null {
  if (name === undefined && email === undefined) return null;
  const hasName = Boolean(name?.trim());
  const hasEmail = Boolean(email?.trim());
  if (hasEmail && !hasName) return "Add the continuity contact’s name, or clear both.";
  if (hasName && !hasEmail && email !== undefined) return "Add the continuity contact’s email, or clear both.";
  if (hasEmail && !EMAIL.test(email!.trim())) return "Enter a full email address.";
  return null;
}

/** An IANA-looking zone name, or null. The database checks it is a real one. */
export function timezoneName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const zone = value.trim();
  return /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(zone) && zone.length <= 64 ? zone : null;
}

export type OfficeInput = {
  label: string;
  addressLine: string;
  locality: string;
  region: string;
  postalCode: string;
  countryCode: string;
  timezone: string | null;
  primary: boolean;
};

const squash = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Same name, street and city (ignoring case and spacing): the same office saved twice. */
export function sameOffice(
  saved: { label: string; address_line: string; locality: string },
  office: Pick<OfficeInput, "label" | "addressLine" | "locality">,
): boolean {
  return squash(saved.label) === squash(office.label) && squash(saved.address_line) === squash(office.addressLine) && squash(saved.locality) === squash(office.locality);
}

export function officeInput(fields: Record<string, unknown>): OfficeInput | { error: string } {
  const text = (key: string) => (typeof fields?.[key] === "string" ? (fields[key] as string).trim() : "");
  const office: OfficeInput = {
    label: text("label"),
    addressLine: text("addressLine"),
    locality: text("locality"),
    region: text("region"),
    postalCode: text("postalCode"),
    countryCode: (text("countryCode") || "CA").toUpperCase(),
    timezone: null,
    primary: fields?.primary === true,
  };
  if (!office.label || !office.addressLine || !office.locality) return { error: "Add the office name, street address and city." };
  if (office.label.length > 120 || office.addressLine.length > 300 || office.locality.length > 120 || office.region.length > 80 || office.postalCode.length > 20) {
    return { error: "One of the address lines is too long." };
  }
  if (!/^[A-Z]{2}$/.test(office.countryCode) || !isIsoCountry(office.countryCode)) {
    return { error: "Enter the country as its two-letter ISO code, like CA, US or GB." };
  }
  const zone = text("timezone");
  if (zone) {
    office.timezone = timezoneName(zone);
    if (!office.timezone) return { error: "Choose a timezone from the list, like America/Toronto." };
  }
  return office;
}
