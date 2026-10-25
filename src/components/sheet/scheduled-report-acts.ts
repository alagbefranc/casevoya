"use client";

import { toast2 } from "@/components/port/kit";
import {
  deleteScheduledReport,
  pauseScheduledReport,
  runScheduledReportNow,
  saveScheduledReport,
} from "@/modules/sheet/scheduled-reports-actions";
import type { ScheduleFormValue } from "@/modules/sheet/scheduled-reports-present";

/**
 * Reports > Scheduled (REP-03): New schedule and Edit fill the schedule dialog; Save, Pause or
 * Resume, Run now (test) and Delete call the server actions. The database decides and audits.
 */
type Router = { refresh: () => void };
type Open = (id: string) => void;

const DIALOG = "dlgSched";

function field<T extends HTMLInputElement | HTMLSelectElement>(dialog: HTMLElement, id: string): T | null {
  return dialog.querySelector<T>(`#${id}`);
}

/** Shows the weekday or the day-of-month field, and only the staff who see the chosen report. */
export function syncScheduleDialog(dialog: HTMLElement): void {
  const frequency = field<HTMLSelectElement>(dialog, "srF")?.value ?? "weekly";
  for (const block of dialog.querySelectorAll<HTMLElement>("[data-sched-when]")) block.hidden = block.dataset.schedWhen !== frequency;
  const tab = field<HTMLSelectElement>(dialog, "srT")?.value ?? "";
  for (const label of dialog.querySelectorAll<HTMLElement>("[data-sched-person]")) {
    const sees = (label.dataset.schedPerson ?? "").split(" ").includes(tab);
    label.hidden = !sees;
    const box = label.querySelector<HTMLInputElement>("input[type=checkbox]");
    if (box && !sees) box.checked = false;
  }
}

function fill(dialog: HTMLElement, value: Partial<ScheduleFormValue>) {
  dialog.dataset.schedId = value.id ?? "";
  dialog.dataset.schedVersion = value.version ? String(value.version) : "";
  const set = (id: string, v: string | undefined) => {
    const el = field(dialog, id);
    if (el && v !== undefined) el.value = v;
  };
  set("srN", value.title ?? "");
  const tab = field<HTMLSelectElement>(dialog, "srT");
  if (tab) tab.value = value.tab ?? tab.options[0]?.value ?? "";
  set("srR", value.range ?? "90d");
  set("srF", value.frequency ?? "weekly");
  set("srW", String(value.weekday ?? 1));
  set("srD", String(value.monthDay ?? 1));
  set("srH", value.sendTime ?? "08:00");
  const chosen = new Set(value.recipients ?? []);
  for (const box of dialog.querySelectorAll<HTMLInputElement>("[data-sched-recipient]")) box.checked = chosen.has(box.value);
  const heading = dialog.querySelector("#dlgSchedH");
  if (heading) heading.textContent = value.id ? "Edit scheduled report" : "Schedule a report";
  syncScheduleDialog(dialog);
}

function readForm(text: string | undefined): Partial<ScheduleFormValue> | null {
  try {
    const value = JSON.parse(text ?? "") as Partial<ScheduleFormValue>;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export async function runScheduledReportAct(button: HTMLElement, root: ParentNode, router: Router, open: Open): Promise<void> {
  const act = button.dataset.schedAct;
  const organizationId = button.dataset.org ?? "";
  const id = button.dataset.schedId ?? "";

  if (act === "new" || act === "edit") {
    const dialog = root.querySelector<HTMLDialogElement>(`dialog#${DIALOG}`);
    if (!dialog) return;
    const value = act === "edit" ? readForm(button.dataset.sched) : { recipients: button.dataset.self ? [button.dataset.self] : [] };
    if (!value) return;
    fill(dialog, value);
    open(DIALOG);
    field<HTMLInputElement>(dialog, "srN")?.focus();
    return;
  }

  if (act === "save") {
    const dialog = button.closest<HTMLDialogElement>("dialog");
    if (!dialog) return;
    const read = (fieldId: string) => field(dialog, fieldId)?.value ?? "";
    const frequency = read("srF");
    const scheduleId = dialog.dataset.schedId || null;
    const result = await saveScheduledReport({
      organizationId,
      id: scheduleId,
      version: dialog.dataset.schedVersion ? Number(dialog.dataset.schedVersion) : null,
      title: read("srN"),
      tab: read("srT"),
      range: read("srR"),
      frequency,
      weekday: frequency === "weekly" ? Number(read("srW")) : null,
      monthDay: frequency === "monthly" ? Number(read("srD")) : null,
      sendTime: read("srH"),
      recipients: [...dialog.querySelectorAll<HTMLInputElement>("[data-sched-recipient]")]
        .filter((box) => box.checked && !box.closest<HTMLElement>("[data-sched-person]")?.hidden)
        .map((box) => box.value),
    });
    if ("error" in result) {
      toast2(result.error, { kind: "bad", sub: "Nothing was saved." });
      return;
    }
    dialog.close();
    toast2(scheduleId ? "Schedule saved" : "Report scheduled", { kind: "ok", sub: "Recipients get a link in Casevoya at each send. They’re checked again first." });
    router.refresh();
    return;
  }

  if (act === "pause" || act === "resume") {
    const result = await pauseScheduledReport({ organizationId, id, paused: act === "pause" });
    if ("error" in result) {
      toast2(result.error, { kind: "bad" });
      return;
    }
    toast2(act === "pause" ? "Schedule paused" : "Schedule resumed", { kind: "ok", sub: act === "pause" ? "Nothing is sent until you resume it." : "The next send is shown in the table." });
    router.refresh();
    return;
  }

  if (act === "test") {
    const result = await runScheduledReportNow({ organizationId, id });
    if ("error" in result) {
      toast2(result.error, { kind: "bad", sub: "Nothing was sent." });
      return;
    }
    const { delivered, skipped } = result.ok;
    toast2("Test sent", {
      kind: "ok",
      sub: `A link went to ${delivered} ${delivered === 1 ? "person’s" : "people’s"} notifications${skipped ? `; ${skipped} skipped because they can no longer see this report` : ""}. No report was attached.`,
    });
    router.refresh();
    return;
  }

  if (act === "delete") {
    if (!window.confirm("Delete this scheduled report? Nothing more is sent. Links already sent still need sign-in and show what each person can see.")) return;
    const result = await deleteScheduledReport({ organizationId, id });
    if ("error" in result) {
      toast2(result.error, { kind: "bad", sub: "Nothing was deleted." });
      return;
    }
    toast2("Schedule deleted", { kind: "ok", sub: "It’s kept in the audit trail." });
    router.refresh();
  }
}
