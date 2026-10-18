"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/tenant/context";
import { FIRM_LOGO_BUCKET, ownFirmLogoKey } from "@/modules/firm-onboarding/firm-logo";
import { firmDetailChanges, officeInput, timezoneName } from "@/modules/settings/firm-input";
import type { Json } from "@/types/database.types";

/**
 * Settings > Firm, Offices, Branding, Language and time. Each call acts as the signed-in person;
 * the database decides: firm details, offices and branding need the firm owner with a recent
 * step-up (public.update_firm_profile, save_firm_office, remove_firm_office, save_firm_setup);
 * a staff member's own timezone needs only their two-step sign-in (public.set_my_timezone).
 */
export type FirmSettingsResult = { ok: true } | { error: string; stepUp?: boolean };

function refused(message: string): { error: string; stepUp?: boolean } {
  if (/step-up/i.test(message)) return { error: "Confirm it’s you with your authenticator, then try again.", stepUp: true };
  if (/timezone is not usable/i.test(message)) return { error: "Choose a timezone from the list, like America/Toronto." };
  if (/email is not usable/i.test(message)) return { error: "Enter a full email address." };
  if (/is required/i.test(message)) return { error: "Names and the billing and privacy contacts can’t be empty." };
  if (/another main office/i.test(message)) return { error: "Make another office the main office first." };
  if (/main office cannot be removed/i.test(message)) return { error: "The main office can’t be removed." };
  if (/office address is incomplete/i.test(message)) return { error: "Add the office name, street address and city." };
  if (/office not found/i.test(message)) return { error: "That office isn’t on file." };
  if (/accent must be a hex colour/i.test(message)) return { error: "Enter the colour as # and six letters or digits, like #0A4B93." };
  if (/organizations_branding_logo_ck/i.test(message)) return { error: "Upload your logo again." };
  if (/staff access denied/i.test(message)) return { error: "You can’t make that change." };
  return { error: safeAccessError(message) };
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function signedIn(organizationId: string): Promise<{ supabase: Client } | { error: string }> {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  return { supabase };
}

export async function saveFirmDetails(input: { organizationId: string; fields: Record<string, string> }): Promise<FirmSettingsResult> {
  const changes = firmDetailChanges(input.fields);
  if ("error" in changes) return changes;
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { error } = await session.supabase.rpc("update_firm_profile", { p_organization_id: input.organizationId, p_changes: changes.changes as Json });
  return error ? refused(error.message) : { ok: true };
}

export async function saveFirmOffice(input: { organizationId: string; officeId: string | null; fields: Record<string, string | boolean> }): Promise<FirmSettingsResult> {
  if (input.officeId !== null && !isUuid(input.officeId)) return { error: "That office isn’t on file." };
  const office = officeInput(input.fields);
  if ("error" in office) return office;
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { error } = await session.supabase.rpc("save_firm_office", {
    p_organization_id: input.organizationId,
    p_office_id: input.officeId,
    p_label: office.label,
    p_address_line: office.addressLine,
    p_locality: office.locality,
    p_region: office.region,
    p_postal_code: office.postalCode,
    p_country_code: office.countryCode,
    p_timezone: office.timezone,
    p_is_primary: office.primary,
  });
  return error ? refused(error.message) : { ok: true };
}

export async function removeFirmOffice(input: { organizationId: string; officeId: string }): Promise<FirmSettingsResult> {
  if (!isUuid(input.officeId)) return { error: "That office isn’t on file." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { error } = await session.supabase.rpc("remove_firm_office", { p_organization_id: input.organizationId, p_office_id: input.officeId });
  return error ? refused(error.message) : { ok: true };
}

/** The file is in the private logo bucket (written only by /api/firm/logo). */
async function logoStored(key: string): Promise<boolean> {
  try {
    const folder = key.slice(0, key.lastIndexOf("/"));
    const name = key.slice(key.lastIndexOf("/") + 1);
    const { data } = await createServiceClient().storage.from(FIRM_LOGO_BUCKET).list(folder, { search: name, limit: 1 });
    return Boolean(data?.some((object) => object.name === name));
  } catch {
    return false;
  }
}

/**
 * Logo and colour, through the same database path as the firm-setup Branding step
 * (public.save_firm_setup('branding'), firm owner + step-up). A new logo is uploaded first by
 * /api/firm/logo, which returns its locator; an empty locator removes the logo.
 */
export async function saveFirmBranding(input: { organizationId: string; logoLocator: string; accent: string }): Promise<FirmSettingsResult> {
  const accent = (input.accent ?? "").trim();
  if (accent && !/^#[0-9A-Fa-f]{6}$/.test(accent)) return { error: "Enter the colour as # and six letters or digits, like #0A4B93." };
  const locator = (input.logoLocator ?? "").trim();
  if (locator) {
    const key = ownFirmLogoKey(locator, input.organizationId);
    if (!key) return { error: "Upload your logo again." };
    if (!(await logoStored(key))) return { error: "Your logo wasn’t found. Upload it again." };
  }
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { error } = await session.supabase.rpc("save_firm_setup", {
    p_step: "branding",
    p_payload: { acknowledged: "true", logo_locator: locator, accent } as Json,
  });
  return error ? refused(error.message) : { ok: true };
}

/** The signed-in staff member's own timezone, and (firm owner, step-up) the firm's when it changed. */
export async function saveTimezones(input: { organizationId: string; mine: string; firm: string | null; firmBefore: string | null }): Promise<FirmSettingsResult> {
  const mine = timezoneName(input.mine);
  if (!mine) return { error: "Choose a timezone from the list, like America/Toronto." };
  const firm = input.firm === null ? null : timezoneName(input.firm);
  if (input.firm !== null && !firm) return { error: "Choose a timezone from the list, like America/Toronto." };
  const session = await signedIn(input.organizationId);
  if ("error" in session) return session;
  const { error } = await session.supabase.rpc("set_my_timezone", { p_organization_id: input.organizationId, p_timezone: mine });
  if (error) return refused(error.message);
  if (firm && firm !== input.firmBefore) {
    const { error: firmError } = await session.supabase.rpc("update_firm_profile", { p_organization_id: input.organizationId, p_changes: { timezone: firm } as Json });
    if (firmError) return refused(firmError.message);
  }
  return { ok: true };
}
