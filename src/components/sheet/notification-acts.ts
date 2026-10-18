"use client";

import { toast2 } from "@/components/port/kit";
import { markNotificationsRead } from "@/modules/messages/actions";

type Router = { push: (href: string) => void; refresh: () => void };

/** A notification row: marked read, then the record it is about opens. */
export async function openNotification(row: HTMLElement, organizationId: string, router: Router) {
  const id = row.dataset.notif ?? "";
  const href = row.dataset.nav ?? "";
  if (id && organizationId) await markNotificationsRead({ organizationId, ids: [id] });
  if (href.startsWith("/sheet/")) router.push(href);
  else router.refresh();
}

/** Mark all read: every notification the person can see now. */
export async function markAllNotificationsRead(button: HTMLElement, router: Router) {
  const organizationId = button.dataset.org ?? "";
  if (!organizationId) return;
  const result = await markNotificationsRead({ organizationId, ids: null });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  toast2("All caught up", { kind: "ok", sub: "Every notification is marked read." });
  router.refresh();
}
