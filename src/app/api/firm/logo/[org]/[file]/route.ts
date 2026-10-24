import { createServiceClient } from "@/lib/supabase/service";
import { FIRM_LOGO_BUCKET, brandingLogoLocator, firmLogoType, ownFirmLogoKey } from "@/modules/firm-onboarding/firm-logo";

function missing() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}

/**
 * A firm's current logo as a public image (ORG-01), for the firm header on its emails: an email
 * is opened long after it is sent, so a short-lived signed link won't do. The file name is the
 * random id the upload gave it, and the logo is served only while it is still the firm's saved
 * logo; a replaced or removed logo is gone. The bytes are checked again before they are served.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ org: string; file: string }> }) {
  const { org, file } = await params;
  const key = ownFirmLogoKey(`${FIRM_LOGO_BUCKET}/${org}/${file}`, org);
  if (!key) return missing();
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return missing();
  }
  const { data: firm } = await service.from("organizations").select("id, branding").eq("id", org).maybeSingle();
  const current = firm ? brandingLogoLocator(firm.branding) : null;
  if (!current || ownFirmLogoKey(current, org)?.toLowerCase() !== key.toLowerCase()) return missing();
  const { data: blob } = await service.storage.from(FIRM_LOGO_BUCKET).download(ownFirmLogoKey(current, org) ?? key);
  if (!blob) return missing();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = firmLogoType(bytes);
  if (!type) return missing();
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
