"use client";

import { toast2 } from "@/components/port/kit";
import { dismissServiceNotice } from "@/modules/settings/service-notice-actions";

type Router = { refresh: () => void };

/** ADM-04: Dismiss on the service notice banner hides it for the signed-in person only. */
export async function runServiceNoticeDismiss(button: HTMLElement, router: Router): Promise<void> {
  const result = await dismissServiceNotice({ organizationId: button.dataset.org ?? "", noticeId: button.dataset.noticeDismiss ?? "" });
  if ("error" in result) {
    toast2(result.error, { kind: "bad" });
    return;
  }
  button.closest("[data-service-notice]")?.remove();
  toast2("Notice dismissed", { kind: "ok", sub: "Only for you. It stays in Settings › Security › Service notices." });
  router.refresh();
}
