/**
 * Settings > Firm, Offices, Branding, Language and time: the firm's own rows shaped for the
 * Designer components in `components/sheet/designer/settings-firm.tsx`. Pure, so it is tested
 * without a database. Nothing here invents a value: a missing one reads "Not set" or an empty state.
 */
import type {
  BrandingData,
  FirmData,
  FirmField,
  FirmValue,
  LanguageData,
  OfficeDialogData,
  OfficesData,
  SettingsHeaderData,
  SettingsTab,
} from "@/components/sheet/designer/settings-firm";
import { BRAND_DIALOG, FIRM_DIALOG, OFFICE_NEW_DIALOG, TIMEZONE_DIALOG } from "@/components/sheet/designer/settings-firm";
import { firmHeaderPreviewHtml } from "@/modules/email/designs/layout";
import { brandingAccent } from "@/modules/firm-onboarding/firm-logo";

export const NOT_SET = "Not set";

/** The tabs this module renders; the others keep their own pages. */
export function settingsTab(tab: string | undefined): SettingsTab | null {
  if (tab === undefined || tab === "" || tab === "general") return "general";
  return tab === "offices" || tab === "branding" || tab === "language" ? tab : null;
}

export type FirmRow = {
  id: string;
  legal_name: string;
  display_name: string;
  timezone: string;
  jurisdiction_codes: string[] | null;
  billing_contact_name: string | null;
  billing_contact_email: string | null;
  privacy_contact_name: string | null;
  privacy_contact_email: string | null;
  continuity_contact_name: string | null;
  continuity_contact_email: string | null;
  succession_note: string | null;
  branding: unknown;
};

export type OfficeRecord = {
  id: string;
  label: string;
  address_line: string;
  locality: string;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  timezone: string | null;
  is_primary: boolean;
};

export type StaffLanguageRecord = { name: string | null; locale: string | null; timezone: string | null };

const PLAN: Record<string, string> = {
  trial: "Plan: Trial",
  trial_ended: "Plan: Trial ended",
  active: "Plan: Subscribed",
  cancelled: "Plan: Cancelled",
};

export function planLabel(status: string | null | undefined): string | null {
  return status ? (PLAN[status] ?? null) : null;
}

/** The names the firm-setup "Where you practise" step shows for each code it stores. */
const JURISDICTION: Record<string, string> = {
  CA: "Federal (IRCC)",
  ON: "Ontario",
  BC: "British Columbia",
  AB: "Alberta",
  MB: "Manitoba",
  SK: "Saskatchewan",
  NS: "Nova Scotia",
  QC: "Québec",
};

export function jurisdictionValue(codes: readonly string[] | null | undefined): FirmValue {
  const names = (codes ?? []).map((code) => JURISDICTION[code] ?? code);
  if (names.length === 0) return NOT_SET;
  return names.length === 1 ? names[0] : { parts: names };
}

function text(value: string | null | undefined): string {
  return value?.trim() ? value.trim() : NOT_SET;
}

export function settingsHeader(tab: SettingsTab, firmName: string, plan: string | null, owner: boolean): SettingsHeaderData {
  const act =
    tab === "general" && owner
      ? { label: "Edit details", icon: "edit", dialog: FIRM_DIALOG }
      : tab === "offices" && owner
        ? { label: "Add an office", icon: "plus", dialog: OFFICE_NEW_DIALOG }
        : tab === "language"
          ? { label: "Change my timezone", icon: "clock", dialog: TIMEZONE_DIALOG }
          : null;
  return { tab, firmName, plan, act };
}

export function firmPage(firm: FirmRow): FirmData {
  const continuity = firm.continuity_contact_name?.trim();
  const plan = firm.succession_note?.trim() ? "succession plan on file" : null;
  return {
    firmName: firm.display_name,
    rows: [
      { label: "Legal name", value: text(firm.legal_name) },
      { label: "Display name", value: text(firm.display_name) },
      { label: "Organisation ID", value: firm.id, num: true },
      { label: "Jurisdictions", value: jurisdictionValue(firm.jurisdiction_codes) },
      { label: "Billing contact", value: text(firm.billing_contact_name) },
      { label: "Privacy contact", value: text(firm.privacy_contact_name) },
      { label: "Continuity contact", value: continuity ? (plan ? { parts: [continuity, plan] } : continuity) : NOT_SET },
    ],
  };
}

export function firmFields(firm: FirmRow): FirmField[] {
  return [
    { id: "fmL", key: "legal_name", label: "Legal name", value: firm.legal_name, max: 300 },
    { id: "fmD", key: "display_name", label: "Display name", value: firm.display_name, max: 200, hint: "What clients see in the portal and emails." },
    { id: "fmBN", key: "billing_contact_name", label: "Billing contact", value: firm.billing_contact_name ?? "", max: 200 },
    { id: "fmBE", key: "billing_contact_email", label: "Billing contact email", value: firm.billing_contact_email ?? "", type: "email", max: 320 },
    { id: "fmPN", key: "privacy_contact_name", label: "Privacy contact", value: firm.privacy_contact_name ?? "", max: 200 },
    { id: "fmPE", key: "privacy_contact_email", label: "Privacy contact email", value: firm.privacy_contact_email ?? "", type: "email", max: 320 },
    { id: "fmCN", key: "continuity_contact_name", label: "Continuity contact", value: firm.continuity_contact_name ?? "", max: 200, hint: "Who looks after clients if you can’t. Leave empty for none." },
    { id: "fmCE", key: "continuity_contact_email", label: "Continuity contact email", value: firm.continuity_contact_email ?? "", type: "email", max: 320 },
  ];
}

export function officeAddress(office: Pick<OfficeRecord, "address_line" | "locality" | "region" | "postal_code" | "country_code">): string {
  const regional = [office.region, office.postal_code].filter((part) => part?.trim()).join(" ");
  const parts = [office.address_line, office.locality, regional].map((part) => part?.trim()).filter(Boolean);
  if (office.country_code && office.country_code !== "CA") parts.push(office.country_code);
  return parts.length ? parts.join(", ") : "—";
}

/** Main office first, then by name. */
function ordered(offices: readonly OfficeRecord[]): OfficeRecord[] {
  return [...offices].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.label.localeCompare(b.label, "en-CA"));
}

export function officesPage(offices: readonly OfficeRecord[], firmTimezone: string, owner: boolean): OfficesData {
  return {
    intro: "Where your firm works. Staff access is firm-wide today: an office doesn’t limit what staff see.",
    rows: ordered(offices).map((office) => ({
      id: office.id,
      // An office already named "Main office" doesn't need the "(main office)" marker twice.
      label: office.is_primary && !/\bmain office\b/i.test(office.label) ? `${office.label} (main office)` : office.label,
      address: officeAddress(office),
      timezone: office.timezone ?? firmTimezone,
      // Staff aren't assigned to offices in Casevoya, so there is no count to show.
      staff: "—",
    })),
    empty: owner ? "No offices saved yet. Add your main office." : "No offices saved yet.",
    canEdit: owner,
  };
}

export function officeDialogs(offices: readonly OfficeRecord[]): OfficeDialogData[] {
  return ordered(offices).map((office) => ({
    id: office.id,
    label: office.label,
    addressLine: office.address_line,
    locality: office.locality,
    region: office.region ?? "",
    postalCode: office.postal_code ?? "",
    countryCode: office.country_code,
    timezone: office.timezone ?? "",
    primary: office.is_primary,
  }));
}

export function brandingPage(input: { firmName: string; branding: unknown; logoUrl: string | null; owner: boolean }): BrandingData {
  const accent = brandingAccent(input.branding);
  return {
    firmName: input.firmName,
    figures: [
      {
        box: "brd-l",
        images: input.logoUrl ? [{ src: input.logoUrl, alt: `${input.firmName} logo`, height: 36 }] : [],
        empty: "No logo yet",
        caption: ["Logo", "PNG or JPG, light backgrounds"],
      },
    ],
    colourTag: accent ? `Firm colour ${accent.toUpperCase()}` : "No firm colour set",
    // One dialog holds both the logo and the firm colour, so the button names both.
    replace: input.owner ? { label: input.logoUrl ? "Change logo or colour" : "Add a logo or colour", dialog: BRAND_DIALOG } : null,
    note: "Portal buttons keep Casevoya’s accessible blue. Your logo and firm colour appear on sealed agreement PDFs. The portal and emails don’t show them yet: emails use the header on the right.",
    preview: { kind: "html", html: firmHeaderPreviewHtml(input.firmName), label: `${input.firmName} email header` },
  };
}

export function languageLabel(locale: string | null | undefined): string {
  return locale === "fr-CA" ? "French" : "English";
}

export function languagePage(staff: readonly StaffLanguageRecord[], firmTimezone: string): LanguageData {
  return {
    rows: [...staff]
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "en-CA"))
      .map((person) => ({
        name: person.name?.trim() || "Unnamed staff member",
        language: languageLabel(person.locale),
        timezone: person.timezone || firmTimezone,
      })),
    empty: "No active staff yet.",
    alert: {
      title: "French for clients goes through review",
      body: "Clients can choose Français in their portal. An email goes out in French only after a person approves that template’s translation; until then it’s sent in English. Staff screens are in English.",
    },
  };
}

/** IANA zone names for the timezone suggestions, the firm's and Canada's first. */
export function timezoneSuggestions(current: readonly string[]): string[] {
  const canada = ["America/St_Johns", "America/Halifax", "America/Moncton", "America/Toronto", "America/Winnipeg", "America/Regina", "America/Edmonton", "America/Vancouver", "America/Whitehorse"];
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    all = [];
  }
  return [...new Set([...current.filter(Boolean), ...canada, ...all])];
}
