import "server-only";
import type { EnquiryLiveProps } from "@/components/sheet/enquiry-live";
import { appOrigin } from "@/lib/email/env";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { FIRM_LOGO_BUCKET, FIRM_LOGO_PREVIEW_SECONDS, brandingLogoLocator, ownFirmLogoKey } from "@/modules/firm-onboarding/firm-logo";
import { PRACTICE_NOTICE } from "@/modules/scheduling/format";
import { ENQUIRY_PRACTICE_NOTE, enquiryPageBase } from "./enquiry-present";
import { isFirmSlug, parsePublicFirm } from "./enquiry";
import { enquiryLinks } from "./share";

/** The firm's stored logo as a short-lived link, or null (no logo, or no service key here). */
async function firmLogo(slug: string): Promise<string | null> {
  if (!process.env.SUPABASE_SECRET_KEY) return null;
  try {
    const service = createServiceClient();
    const { data: org } = await service.from("organizations").select("id, branding").eq("slug", slug).maybeSingle();
    const locator = org ? brandingLogoLocator(org.branding) : null;
    const key = org && locator ? ownFirmLogoKey(locator, org.id) : null;
    if (!key) return null;
    const { data } = await service.storage.from(FIRM_LOGO_BUCKET).createSignedUrl(key, FIRM_LOGO_PREVIEW_SECONDS);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * The firm's public enquiry page (or its embedded form), or null when the firm takes no
 * enquiries from this viewer (unknown, no privacy notice, sample mode for anyone but its staff).
 */
export async function loadEnquiryPage(slug: string, embedded: boolean): Promise<EnquiryLiveProps | null> {
  const firmSlug = slug.toLowerCase();
  if (!isFirmSlug(firmSlug) || !hasPublicSupabaseEnv()) return null;
  let firm = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("enquiry_public_firm", { p_firm_slug: firmSlug });
    firm = error ? null : parsePublicFirm(data);
  } catch {
    firm = null;
  }
  if (!firm) return null;
  const logo = embedded ? null : await firmLogo(firm.firmSlug);
  const snippet = firm.staff ? enquiryLinks(appOrigin(), firm.firmSlug, firm.firmName).scriptSnippet : null;
  return {
    firmSlug: firm.firmSlug,
    firmName: firm.firmName,
    base: enquiryPageBase({
      firmName: firm.firmName,
      logo,
      embedded,
      snippet,
      practice: firm.practice ? { ...PRACTICE_NOTICE, note: ENQUIRY_PRACTICE_NOTE } : null,
    }),
  };
}
