"use client";

import { toast2 } from "@/components/port/kit";
import { readIdleMinutes } from "@/modules/security/idle";
import { setStaffIdleTimeout } from "@/modules/settings/security-actions";
import { IDLE_TIMEOUT_DIALOG } from "@/modules/sheet/settings-present";

type Router = { refresh: () => void };

/** Settings > Security, Change (SEC-01): public.set_staff_idle_timeout checks the owner, the step-up and the bounds. */
export async function runIdleTimeout(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const read = readIdleMinutes(dialog.querySelector<HTMLInputElement>("#idMin")?.value ?? "");
  if ("error" in read) {
    toast2(read.error, { kind: "bad", sub: "The idle sign-out time didn’t change." });
    return;
  }
  const code = dialog.querySelector<HTMLInputElement>("#idC")?.value.trim() ?? "";
  if (!/^\d{6}$/.test(code)) {
    toast2("Enter the six-digit code from your authenticator app.", { kind: "bad", sub: "The idle sign-out time didn’t change." });
    return;
  }
  const result = await setStaffIdleTimeout({ organizationId: button.dataset.org ?? "", minutes: read.minutes, code });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "The idle sign-out time didn’t change." });
    return;
  }
  (document.getElementById(IDLE_TIMEOUT_DIALOG) as HTMLDialogElement | null)?.close();
  toast2(`Idle sign-out set to ${result.minutes} minutes`, { kind: "ok", sub: "It applies to every staff member from their next activity. It’s in the audit trail." });
  router.refresh();
}
