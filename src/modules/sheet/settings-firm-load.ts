import "server-only";
import type { SettingsDialogs, SettingsTab } from "@/components/sheet/designer/settings-firm";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { FIRM_LOGO_BUCKET, FIRM_LOGO_PREVIEW_SECONDS, brandingAccent, brandingLogoLocator, ownFirmLogoKey } from "@/modules/firm-onboarding/firm-logo";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import { emailRuntimeConfig } from "@/lib/email/env";
import { firmAddress } from "@/modules/email/addresses";
import { firmInboundAddress } from "@/modules/sheet/inbound-present";
import type { SheetStaff } from "@/modules/sheet/load";
import {
  brandingPage,
  firmFields,
  firmPage,
  languagePage,
  officeDialogs,
  officesPage,
  planLabel,
  settingsHeader,
  timezoneSuggestions,
  type FirmRow,
  type OfficeRecord,
} from "@/modules/sheet/settings-firm-present";

const STAFF_ROLES = ["firm_owner", "licensed_consultant", "case_manager", "assistant", "finance_user"] as const;

const FIRM_COLUMNS =
  "id, legal_name, display_name, timezone, default_locale, jurisdiction_codes, billing_contact_name, billing_contact_email, privacy_contact_name, privacy_contact_email, continuity_contact_name, continuity_contact_email, succession_note, branding";

/** A short-lived link to the firm's own saved logo in the private bucket, or null. */
async function logoUrl(branding: unknown, organizationId: string): Promise<string | null> {
  const locator = brandingLogoLocator(branding);
  const key = locator ? ownFirmLogoKey(locator, organizationId) : null;
  if (!key) return null;
  try {
    const { data } = await createServiceClient().storage.from(FIRM_LOGO_BUCKET).createSignedUrl(key, FIRM_LOGO_PREVIEW_SECONDS);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Settings > Firm, Offices, Branding, Language and time for the signed-in staff member's firm,
 * live or in sample mode (the firm's own settings are never sample data). Read as that person,
 * so the database decides what is visible; only a firm owner gets the edit dialogs, and the
 * database still decides every save.
 */
export async function loadSheetSettingsFirm(staff: SheetStaff, tab: SettingsTab) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const owner = staff.role === "firm_owner";
  const [chrome, firmRead, subscription] = await Promise.all([
    loadSheetChrome(staff, "/sheet/settings"),
    supabase.from("organizations").select(FIRM_COLUMNS).eq("id", org).maybeSingle(),
    supabase.from("organization_subscriptions").select("status").eq("organization_id", org).maybeSingle(),
  ]);
  const firm: FirmRow = (firmRead.data as FirmRow | null) ?? {
    id: org,
    legal_name: staff.legalName,
    display_name: staff.organizationName,
    timezone: staff.timezone,
    jurisdiction_codes: [],
    billing_contact_name: null,
    billing_contact_email: null,
    privacy_contact_name: null,
    privacy_contact_email: null,
    continuity_contact_name: null,
    continuity_contact_email: null,
    succession_note: null,
    branding: {},
  };
  // Without the firm's own row, the values above are stand-ins: nothing is offered for editing
  // (saving the stand-ins would blank the real contacts and branding).
  const firmOk = Boolean(firmRead.data);
  const header = settingsHeader(tab, firm.display_name || staff.organizationName, planLabel(subscription.data?.status), owner && (firmOk || tab !== "general"));
  const dialogs: SettingsDialogs = { organizationId: org };

  if (tab === "general") {
    if (owner && firmOk) dialogs.firm = { fields: firmFields(firm) };
    const page = firmPage(firm);
    const data = firmOk
      ? page
      : { ...page, rows: page.rows.map((row) => (row.label === "Organisation ID" || row.label === "Display name" ? row : { ...row, value: "Couldn’t load. Reload the page." })) };
    // OPS-06: the firm's inbound address, slug@ the inbound domain (the inbound worker's own rule).
    const slug = await supabase.from("organizations").select("slug").eq("id", org).maybeSingle();
    const withInbound = slug.data?.slug ? { ...data, inbound: firmInboundAddress(firmAddress(slug.data.slug, emailRuntimeConfig().inboundDomain)) } : data;
    return { chrome, header, dialogs, page: { tab, data: withInbound } as const };
  }

  if (tab === "offices") {
    const read = await supabase
      .from("organization_offices")
      .select("id, label, address_line, locality, region, postal_code, country_code, timezone, is_primary")
      .eq("organization_id", org)
      .limit(100);
    const offices = (read.data ?? []) as OfficeRecord[];
    if (owner) {
      dialogs.offices = { offices: officeDialogs(offices), firmTimezone: firm.timezone };
      dialogs.zones = timezoneSuggestions([firm.timezone]);
    }
    return { chrome, header, dialogs, page: { tab, data: officesPage(offices, firm.timezone, owner) } as const };
  }

  if (tab === "branding") {
    const url = await logoUrl(firm.branding, org);
    if (owner && firmOk) dialogs.brand = { accent: brandingAccent(firm.branding) ?? "", logoLocator: brandingLogoLocator(firm.branding) ?? "" };
    return { chrome, header, dialogs, page: { tab, data: brandingPage({ firmName: firm.display_name, branding: firm.branding, logoUrl: url, owner: owner && firmOk }) } as const };
  }

  // Language and time: the firm's active staff, each with their own stored language and timezone.
  const members = await supabase
    .from("memberships")
    .select("user_id")
    .eq("organization_id", org)
    .eq("status", "active")
    .in("role", [...STAFF_ROLES])
    .limit(200);
  const userIds = [...new Set((members.data ?? []).map((row) => row.user_id))];
  const profiles = userIds.length ? await supabase.from("profiles").select("id, display_name, preferred_locale, timezone").in("id", userIds) : null;
  const byId = new Map((profiles?.data ?? []).map((row) => [row.id, row]));
  const people = userIds.map((id) => {
    const profile = byId.get(id);
    return { name: profile?.display_name ?? null, locale: profile?.preferred_locale ?? null, timezone: profile?.timezone ?? null };
  });
  const me = await supabase.auth.getClaims();
  const myId = me.data?.claims?.sub;
  const mine = (myId ? byId.get(myId)?.timezone : null) ?? firm.timezone;
  dialogs.timezone = { mine, firm: owner ? firm.timezone : null, locale: owner && firmOk ? (firm.default_locale === "fr-CA" ? "fr-CA" : "en-CA") : null };
  dialogs.zones = timezoneSuggestions([mine, firm.timezone]);
  return { chrome, header, dialogs, page: { tab: "language" as const, data: languagePage(people, firm.timezone, firm.default_locale) } };
}
