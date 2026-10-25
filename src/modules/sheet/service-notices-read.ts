import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SheetStaff } from "@/modules/sheet/load";
import { readServiceNotices, serviceNoticeBanner, type ServiceNotice, type ServiceNoticeBannerData } from "@/modules/sheet/service-notices-present";

type Client = Awaited<ReturnType<typeof createClient>>;

/** A firm sees a handful of notices a year; this is a ceiling, not a page. */
const READ = 200;
const COLUMNS = "id, kind, severity, title, body, starts_at, ends_at, status, resolved_at, resolution_note";

/**
 * ADM-04: the firm's service notices, read as the signed-in staff member. RLS returns only
 * published or resolved notices sent to all firms or to this firm, to its staff (never client
 * users). `currentOnly`: published and not past its end. Null on a read error.
 */
export async function readFirmNotices(supabase: Client, options: { currentOnly: boolean; now: Date }): Promise<ServiceNotice[] | null> {
  let query = supabase.from("service_notices").select(COLUMNS).neq("status", "draft");
  if (options.currentOnly) query = query.eq("status", "published").or(`ends_at.is.null,ends_at.gt.${options.now.toISOString()}`);
  const { data, error } = await query.order("starts_at", { ascending: false }).limit(READ);
  if (error) return null;
  return readServiceNotices(data as Record<string, unknown>[]);
}

/** The banner across every Sheet page (ADM-04); null when there is nothing to show or on a read error. */
export async function loadServiceNoticeBanner(staff: SheetStaff, now: Date = new Date()): Promise<ServiceNoticeBannerData | null> {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const notices = await readFirmNotices(supabase, { currentOnly: true, now });
  if (!notices?.length) return null;
  const dismissals = await supabase
    .from("service_notice_dismissals")
    .select("notice_id")
    .eq("organization_id", staff.organizationId)
    .in(
      "notice_id",
      notices.map((notice) => notice.id),
    );
  const dismissed = new Set((dismissals.data ?? []).map((row) => row.notice_id));
  return serviceNoticeBanner(notices, dismissed, { now, timeZone: staff.timezone, organizationId: staff.organizationId });
}
