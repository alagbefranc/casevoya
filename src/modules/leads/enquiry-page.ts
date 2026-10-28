import "server-only";
import type { EnquiryLiveProps } from "@/components/sheet/enquiry-live";
import { appOrigin } from "@/lib/email/env";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { firmLogo } from "@/modules/firm-onboarding/public-logo";
import { PRACTICE_NOTICE } from "@/modules/scheduling/format";
import { ENQUIRY_PRACTICE_NOTE, enquiryPageBase } from "./enquiry-present";
import { isFirmSlug, parsePublicFirm } from "./enquiry";
import { enquiryLinks } from "./share";
import { privacyPath } from "./privacy";


/**
 * The firm's public enquiry page (or its embedded form), or null when the firm takes no
 * enquiries from this viewer (unknown, no privacy notice, sample mode for anyone but its staff).
 * "unavailable" when the firm's details couldn't be read (DES-04: the page says so and to try again).
 */
export const ENQUIRY_UNAVAILABLE = {
  title: "This form isn’t available right now",
  copy: "The firm’s enquiry form couldn’t be loaded. Nothing was sent. Try again in a moment.",
} as const;

export async function loadEnquiryPage(slug: string, embedded: boolean): Promise<(EnquiryLiveProps & { open: boolean }) | null | "unavailable"> {
  const firmSlug = slug.toLowerCase();
  if (!isFirmSlug(firmSlug) || !hasPublicSupabaseEnv()) return null;
  let firm = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("enquiry_public_firm", { p_firm_slug: firmSlug });
    // DES-04: an answer that couldn't be read is not "the firm takes no enquiries".
    if (error) return "unavailable";
    firm = parsePublicFirm(data);
  } catch {
    return "unavailable";
  }
  if (!firm) return null;
  const logo = embedded ? null : await firmLogo(firm.firmSlug);
  const snippet = firm.staff ? enquiryLinks(appOrigin(), firm.firmSlug, firm.firmName).scriptSnippet : null;
  return {
    firmSlug: firm.firmSlug,
    firmName: firm.firmName,
    open: firm.open,
    base: enquiryPageBase({
      firmName: firm.firmName,
      logo,
      embedded,
      snippet,
      practice: firm.practice ? { ...PRACTICE_NOTICE, note: ENQUIRY_PRACTICE_NOTE } : null,
      // In the embed, an absolute link: the form sits on the firm's own site.
      privacyHref: `${embedded ? appOrigin() : ""}${privacyPath(firm.firmSlug)}`,
    }),
  };
}
