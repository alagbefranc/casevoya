"use client";

import { toast2 } from "@/components/port/kit";
import { readQuietHours, readReminderDays } from "@/modules/sheet/automations-present";
import { needsStepUp } from "@/modules/sheet/staff-present";
import { setFirmReminderOffsets, setQuietHours } from "@/modules/tasks/actions";

type Router = { refresh: () => void };

/**
 * Automations › Reminder settings (#dlgAuto): checks the days and quiet hours first, then saves
 * through the database (firm owner, recent step-up). A step-up refusal goes to /mfa and back.
 */
export async function runAutomationSave(button: HTMLElement, router: Router) {
  const dialog = button.closest<HTMLDialogElement>("dialog");
  if (!dialog) return;
  const value = (id: string) => dialog.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "";
  const days = readReminderDays(value("auD"));
  if ("error" in days) {
    toast2(days.error, { kind: "warn", sub: "Nothing was changed." });
    return;
  }
  const quiet = readQuietHours(value("auQS"), value("auQE"));
  if ("error" in quiet) {
    toast2(quiet.error, { kind: "warn", sub: "Nothing was changed." });
    return;
  }
  const organizationId = button.dataset.org ?? "";
  const refused = (error: string | undefined) => {
    if (needsStepUp(error)) {
      toast2("Confirm it’s you first", { kind: "warn", sub: "Then save the reminder settings again." });
      window.setTimeout(() => window.location.assign(`/mfa?step=6&next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`), 900);
      return;
    }
    toast2(error ?? "That didn’t save.", { kind: "bad", sub: "Nothing more was changed." });
  };
  const saved = await setFirmReminderOffsets({ organizationId, days: days.days, code: null });
  if ("error" in saved) return refused(saved.error);
  const hours = await setQuietHours({ organizationId, start: quiet.start, end: quiet.end, code: null });
  if ("error" in hours) return refused(hours.error);
  dialog.close();
  toast2("Reminder settings saved", { kind: "ok", sub: "Deadlines saved from now on use them." });
  router.refresh();
}
