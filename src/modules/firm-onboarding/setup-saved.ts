/**
 * Firm setup steps 1 and 2 as saved (issue #259): what /setup shows again after a reload, and the
 * signed-in owner's name and email as the first answer for the billing and privacy contacts.
 * Pure, so it is unit tested; setup/page.tsx reads the rows and port-actions saves them.
 */

/** One address line on the firm-details screen. The office function stores the pieces separately. */
export function officeParts(raw: string) {
  const postal = raw.match(/\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/i)?.[0]?.toUpperCase().replace("-", " ") ?? "";
  const region = raw.match(/\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\b/)?.[1] ?? "";
  let rest = raw;
  if (postal) rest = rest.replace(new RegExp(postal.replace(/\s+/g, "\\s*"), "i"), " ");
  if (region) rest = rest.replace(new RegExp(`\\b${region}\\b`), " ");
  const bits = rest.split(",").map((part) => part.trim()).filter(Boolean);
  const locality = (bits.at(-1) || raw).slice(0, 120);
  const addressLine = (bits.length > 1 ? bits.slice(0, -1).join(", ") : raw).slice(0, 300);
  return { addressLine, locality, region, postal };
}

export type SavedOffice = { address_line: string; locality: string; region: string | null; postal_code: string | null };

/**
 * The saved office as the one line the screen asks for, so saving it again stores the same pieces.
 * A line typed without commas was stored whole as the address line (officeParts), so it comes back
 * as it was.
 */
export function officeLine(office: SavedOffice | null | undefined): string {
  if (!office) return "";
  const line = office.address_line.trim();
  const locality = office.locality.trim();
  const tail = [office.region?.trim(), office.postal_code?.trim()].filter(Boolean).join(" ");
  if (!line.includes(",") && officeParts(line).locality === locality && officeParts(line).addressLine === line) return line;
  return [line, locality, tail].filter(Boolean).join(", ");
}

/** The time zones the firm-details screen offers, as its options read. */
export const SETUP_TIMEZONES = [
  "America/Toronto (Eastern)",
  "America/Vancouver (Pacific)",
  "America/Edmonton (Mountain)",
  "America/Halifax (Atlantic)",
] as const;

/** The option for a saved IANA zone; null when the screen doesn't offer it (its default stays). */
export function timezoneOption(zone: string | null | undefined): string | null {
  const clean = (zone ?? "").trim();
  return SETUP_TIMEZONES.find((option) => option.split(" ")[0] === clean) ?? null;
}

/** What steps 1 and 2 show: the saved answers, else the signed-in owner for the contacts. */
export type SetupSaved = {
  legalName: string;
  address: string;
  timezone: string | null;
  billingName: string;
  billingEmail: string;
  privacyName: string;
  privacyEmail: string;
  termsAccepted: boolean;
};

export type SavedOrganization = {
  legal_name?: string | null;
  display_name?: string | null;
  timezone?: string | null;
  billing_contact_name?: string | null;
  billing_contact_email?: string | null;
  privacy_contact_name?: string | null;
  privacy_contact_email?: string | null;
  subscription_terms_accepted_at?: string | null;
};

export function setupSaved(
  org: SavedOrganization | null | undefined,
  office: SavedOffice | null | undefined,
  owner: { name?: string | null; email?: string | null },
  savedSteps: readonly string[] = [],
): SetupSaved {
  const ownerName = (owner.name ?? "").trim();
  const ownerEmail = (owner.email ?? "").trim();
  return {
    // The firm name from sign-up is both names until the owner changes one.
    legalName: (org?.legal_name || org?.display_name || "").trim(),
    address: officeLine(office),
    // Shown only once firm details were saved: before that the screen's own default stays.
    timezone: savedSteps.includes("firm_details") ? timezoneOption(org?.timezone) : null,
    billingName: (org?.billing_contact_name || ownerName).trim(),
    billingEmail: (org?.billing_contact_email || ownerEmail).trim(),
    privacyName: (org?.privacy_contact_name || ownerName).trim(),
    privacyEmail: (org?.privacy_contact_email || ownerEmail).trim(),
    termsAccepted: Boolean(org?.subscription_terms_accepted_at) && savedSteps.includes("terms_and_privacy"),
  };
}
