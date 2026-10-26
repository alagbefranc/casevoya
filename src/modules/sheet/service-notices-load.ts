import "server-only";
import type { SecurityRow, SettingsHeaderData } from "@/components/sheet/designer/settings";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { planPill } from "@/modules/sheet/settings-present";
import { SERVICE_NOTICES_HREF, serviceNoticeHistory, serviceNoticeSecurityBadge, type ServiceNoticeHistoryData } from "@/modules/sheet/service-notices-present";
import { readFirmNotices } from "@/modules/sheet/service-notices-read";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Settings > Security (ADM-04): the Service notices row, linking to the history. */
export async function loadServiceNoticeSecurityRow(supabase: Client, now: Date = new Date()): Promise<SecurityRow> {
  const notices = await readFirmNotices(supabase, { currentOnly: true, now });
  return {
    title: "Service notices",
    detail: "Maintenance and incident notices from Casevoya to your firm, current and past",
    badge: notices ? serviceNoticeSecurityBadge(notices, now) : { tone: "gr", label: "Not available" },
    action: { label: "Notice history", attrs: { "data-go": SERVICE_NOTICES_HREF } },
  };
}

/** Settings > Service notices (ADM-04): the firm's history, any staff member. */
export async function loadServiceNoticeHistory(
  staff: SheetStaff,
  now: Date = new Date(),
): Promise<{ chrome: Awaited<ReturnType<typeof loadSheetChrome>>; header: SettingsHeaderData; page: ServiceNoticeHistoryData }> {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const [chrome, notices, subscription] = await Promise.all([
    loadSheetChrome(staff, "/sheet/settings"),
    readFirmNotices(supabase, { currentOnly: false, now }),
    supabase.from("organization_subscriptions").select("status, plan").eq("organization_id", staff.organizationId).maybeSingle(),
  ]);
  const header: SettingsHeaderData = { firmName: staff.organizationName, plan: planPill(subscription.data?.status, subscription.data?.plan), tab: "security" };
  const page = serviceNoticeHistory(notices ?? [], { now, timeZone: staff.timezone });
  return { chrome, header, page: notices === null ? { ...page, unavailable: true } : page };
}
