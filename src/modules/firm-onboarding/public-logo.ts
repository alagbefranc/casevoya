import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { FIRM_LOGO_BUCKET, FIRM_LOGO_PREVIEW_SECONDS, brandingAccent, brandingLogoLocator, ownFirmLogoKey } from "./firm-logo";

/**
 * The firm's stored logo as a short-lived link, or null (no logo, or no service key here). Used
 * on the firm's public pages: the enquiry form and the consultation agreement signing page.
 */
export async function firmLogo(slug: string): Promise<string | null> {
  return (await firmLook(slug)).logo;
}

/** The firm's logo (a short-lived link) and colour, each null when not set (ORG-01: the portal tile). */
export async function firmLook(slug: string): Promise<{ logo: string | null; accent: string | null }> {
  if (!process.env.SUPABASE_SECRET_KEY) return { logo: null, accent: null };
  try {
    const service = createServiceClient();
    const { data: org } = await service.from("organizations").select("id, branding").eq("slug", slug).maybeSingle();
    const accent = org ? brandingAccent(org.branding) : null;
    const locator = org ? brandingLogoLocator(org.branding) : null;
    const key = org && locator ? ownFirmLogoKey(locator, org.id) : null;
    if (!key) return { logo: null, accent };
    const { data } = await service.storage.from(FIRM_LOGO_BUCKET).createSignedUrl(key, FIRM_LOGO_PREVIEW_SECONDS);
    return { logo: data?.signedUrl ?? null, accent };
  } catch {
    return { logo: null, accent: null };
  }
}
