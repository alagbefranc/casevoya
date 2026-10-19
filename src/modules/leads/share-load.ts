import "server-only";
import QRCode from "qrcode";
import { appOrigin } from "@/lib/email/env";
import { createClient } from "@/lib/supabase/server";
import type { SheetStaff } from "@/modules/sheet/load";
import { bookingLinks, enquiryLinks, type EnquiryShareData } from "./share";

/** The hosted page's QR code as an SVG data URI (drawn here, no outside service). */
export async function enquiryQr(link: string): Promise<string | null> {
  try {
    const svg = await QRCode.toString(link, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
    return `data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return null;
  }
}

/**
 * Every public link the firm has, for the Sheet's share dialog: the enquiry page and its two
 * website snippets, and each published booking page. Any staff member may see them (they are
 * public addresses); null when the firm's slug can't be read.
 */
export async function loadEnquiryShare(staff: SheetStaff): Promise<EnquiryShareData | null> {
  const org = staff.organizationId;
  const supabase = await createClient({ organizationId: org });
  const [orgRow, privacy, types] = await Promise.all([
    supabase.from("organizations").select("slug, display_name, sample_mode").eq("id", org).maybeSingle(),
    supabase.from("portal_policy_documents").select("id").eq("organization_id", org).eq("kind", "privacy_notice").limit(1),
    supabase
      .from("booking_event_types")
      .select("title, slug, is_sample")
      .eq("organization_id", org)
      .eq("is_published", true)
      .is("archived_at", null)
      .order("title"),
  ]);
  const slug = orgRow.data?.slug;
  if (!slug) return null;
  const origin = appOrigin();
  const firmName = orgRow.data?.display_name ?? staff.organizationName;
  const links = enquiryLinks(origin, slug, firmName);
  return {
    firmName,
    links,
    qr: await enquiryQr(links.page),
    practice: orgRow.data?.sample_mode === true,
    privacyMissing: !privacy.error && (privacy.data ?? []).length === 0,
    bookings: bookingLinks(origin, slug, types.data ?? []),
  };
}
