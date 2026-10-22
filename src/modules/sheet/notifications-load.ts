import "server-only";
import type { NotificationsData } from "@/components/sheet/designer/notifications";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { NOTIFICATION_READ_LIMIT, matterLabel, notificationGroups, notificationsTab, readItems, unreadCount } from "@/modules/sheet/notifications-present";
import type { SheetQuery } from "@/modules/sheet/present";

/**
 * Sheet > Notifications for the signed-in staff member: what public.staff_notifications returns
 * (client messages, client uploads, card payments, public bookings and deadline reminders on what
 * they may already read, last 30 days), with their unread state.
 */
export async function loadSheetNotifications(staff: SheetStaff, query: SheetQuery, now: Date = new Date()) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const [chrome, read] = await Promise.all([
    loadSheetChrome(staff, "/sheet/notifications"),
    supabase.rpc("staff_notifications", { p_organization_id: staff.organizationId, p_limit: NOTIFICATION_READ_LIMIT }),
  ]);
  const items = readItems(read.error ? [] : read.data);
  const ids = [...new Set(items.map((item) => item.matter_id).filter((id): id is string => Boolean(id)))];
  const matters = ids.length ? await supabase.from("matters").select("id, reference, title").eq("organization_id", staff.organizationId).in("id", ids) : null;
  const byId = new Map((matters?.data ?? []).map((row) => [row.id, row]));
  const name = (id: string | null) => matterLabel(id ? byId.get(id) : undefined);
  const tab = notificationsTab(query.tab);
  const data: NotificationsData = {
    tab,
    unread: unreadCount(items),
    // Only the newest rows are read: past that, the count is "at least".
    more: items.length >= NOTIFICATION_READ_LIMIT,
    groups: notificationGroups({ items, tab, now: now.toISOString(), timezone: staff.timezone, matterName: name }),
    organizationId: staff.organizationId,
  };
  chrome.sidebar.counts = { ...chrome.sidebar.counts, notifications: data.unread };
  return { chrome, data };
}
