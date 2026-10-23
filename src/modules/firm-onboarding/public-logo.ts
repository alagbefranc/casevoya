import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { FIRM_LOGO_BUCKET, FIRM_LOGO_PREVIEW_SECONDS, brandingLogoLocator, ownFirmLogoKey } from "./firm-logo";

/**
 * The firm's stored logo as a short-lived link, or null (no logo, or no service key here). Used
 * on the firm's public pages: the enquiry form and the consultation agreement signing page.
 */
export async function firmLogo(slug: string): Promise<string | null> {
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
