import "server-only";
import type { NotificationsData } from "@/components/sheet/designer/notifications";
import { createClient } from "@/lib/supabase/server";
import { loadSheetChrome, matterNames } from "@/modules/sheet/chrome-load";
import type { SheetStaff } from "@/modules/sheet/load";
import { notificationGroups, notificationsTab, readItems } from "@/modules/sheet/notifications-present";
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
    supabase.rpc("staff_notifications", { p_organization_id: staff.organizationId, p_limit: 100 }),
  ]);
  const items = readItems(read.error ? [] : read.data);
  const name = await matterNames(supabase, staff.organizationId, items.map((item) => item.matter_id).filter((id): id is string => Boolean(id)));
  const tab = notificationsTab(query.tab);
  const data: NotificationsData = {
    tab,
    unread: items.filter((item) => !item.read).length,
    groups: notificationGroups({ items, tab, now: now.toISOString(), timezone: staff.timezone, matterName: name }),
    organizationId: staff.organizationId,
  };
  chrome.sidebar.counts = { ...chrome.sidebar.counts, notifications: data.unread };
  return { chrome, data };
}
