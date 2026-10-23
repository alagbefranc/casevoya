"use client";

import { toast2 } from "@/components/port/kit";
import { confirmMatterDeadline } from "@/modules/sheet/actions";
import { needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";
import { completeSheetTask, saveSheetTask } from "@/modules/tasks/actions";

/**
 * The Work area's live controls (audit fixes, 2026-10-20): a task's tick and Task dialog (Tasks
 * page and the matter's Tasks tab), Confirm on a tentative deadline, the Change stage button's
 * label, the matter Documents checklist's person chips, and the Matters list's search, Mine
 * switch, Select all and counts. Clicks are taken in the capture phase, before the Sheet's own
 * handler, so a wired tick never just toggles. The database decides every change.
 */
type Router = { refresh: () => void };

function value(root: ParentNode, selector: string): string {
  return (root.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value ?? "").trim();
}

function busy(element: HTMLElement, run: () => Promise<void>) {
  if (element.getAttribute("aria-busy") === "true") return;
  element.setAttribute("aria-busy", "true");
  void run().finally(() => element.removeAttribute("aria-busy"));
}

function stepUp() {
  window.location.assign(stepUpLocation(window.location.pathname, window.location.search, null));
}

/** Mark a task done: from a row's tick (`data-task-done="<id>"`) or the Task dialog (`data-task-done="dialog"`). */
async function runTaskDone(control: HTMLElement, root: HTMLElement, router: Router) {
  const dialog = control.closest("dialog");
  const fromDialog = control.dataset.taskDone === "dialog";
  const taskId = fromDialog ? (dialog?.dataset.task ?? "") : (control.dataset.taskDone ?? "");
  const version = Number(fromDialog ? dialog?.dataset.version : control.dataset.version);
  const organizationId = (fromDialog ? dialog?.dataset.org : control.dataset.org) ?? root.querySelector<HTMLElement>("#dTask")?.dataset.org ?? "";
  const result = await completeSheetTask({ organizationId, taskId, version });
  if ("error" in result) return void toast2(result.error, { kind: "bad", sub: "The task is still open." });
  if (!fromDialog) {
    control.classList.add("on");
    control.setAttribute("aria-checked", "true");
  }
  dialog?.close();
  toast2("Task done", { kind: "ok", sub: "Its pending reminders were cancelled. Kept in the task’s history." });
  router.refresh();
}

/** Opens the Task dialog for the row's task, filled from the row. */
function openTask(opener: HTMLElement, root: HTMLElement) {
  const dialog = root.querySelector<HTMLDialogElement>("dialog#dTask");
  if (!dialog) return;
  const data = opener.dataset;
  dialog.dataset.task = data.taskOpen ?? "";
  dialog.dataset.version = data.version ?? "";
  dialog.dataset.owner = data.owner ?? "";
  dialog.dataset.due = data.due ?? "";
  if (data.org) dialog.dataset.org = data.org;
  const title = dialog.querySelector<HTMLInputElement>("#teT");
  if (title) title.value = data.title ?? "";
  const due = dialog.querySelector<HTMLInputElement>("#teD");
  if (due) {
    due.value = data.due ?? "";
    // An existing due date in the past stays editable; a new one can't be before today.
    if (data.due && due.min && data.due < due.min) due.dataset.min = due.min;
  }
  const internal = data.audience !== "client";
  const ownerField = dialog.querySelector<HTMLElement>("#teOF");
  // The owner can only be changed by someone reassign_task allows (not an assistant).
  if (ownerField) ownerField.hidden = !internal || dialog.dataset.reassign === "0";
  const clientNote = dialog.querySelector<HTMLElement>("#teC");
  if (clientNote) clientNote.hidden = internal;
  const owner = dialog.querySelector<HTMLSelectElement>("#teO");
  if (owner && internal && data.owner) owner.value = data.owner;
  if (!dialog.open) dialog.showModal();
}

async function runTaskSave(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const internal = !dialog.querySelector<HTMLElement>("#teOF")?.hidden;
  const result = await saveSheetTask({
    organizationId: dialog.dataset.org ?? "",
    taskId: dialog.dataset.task ?? "",
    version: Number(dialog.dataset.version),
    timezone: dialog.dataset.tz ?? "",
    title: value(dialog, "#teT"),
    due: value(dialog, "#teD"),
    ownerMembershipId: internal ? value(dialog, "#teO") || null : null,
    currentOwnerMembershipId: dialog.dataset.owner || null,
    currentDueOn: dialog.dataset.due || null,
  });
  if ("error" in result) {
    if (needsStepUp(result.error)) return stepUp();
    return void toast2(result.error, { kind: "bad", sub: /saved/i.test(result.error) ? "" : "Nothing was saved." });
  }
  dialog.close();
  toast2("Task saved", { kind: "ok", sub: result.reassigned ? "The new owner is told. The task keeps its history." : "Kept in the task’s history." });
  router.refresh();
}

async function runDeadlineConfirm(button: HTMLElement, router: Router) {
  const result = await confirmMatterDeadline({
    organizationId: button.dataset.org ?? "",
    deadlineId: button.dataset.deadlineConfirm ?? "",
    version: Number(button.dataset.version),
  });
  if (result && "error" in result && typeof result.error === "string") {
    if (needsStepUp(result.error)) return stepUp();
    return void toast2(result.error, { kind: "bad", sub: "It is still tentative." });
  }
  toast2("Deadline confirmed", { kind: "ok", sub: "Recorded with your name in the matter’s history." });
  router.refresh();
}

/** The Documents checklist's person chips: Everyone, or one person's rows. */
function pickPerson(chip: HTMLElement) {
  const panel = chip.closest(".panel");
  if (!panel) return;
  const who = chip.dataset.whoChip ?? "";
  panel.querySelectorAll<HTMLElement>("[data-who-chip]").forEach((item) => {
    item.classList.toggle("on", item === chip);
    item.setAttribute("aria-pressed", String(item === chip));
    // The Designer marks the chosen chip by its filled background; the others are transparent.
    item.style.background = item === chip ? "" : "transparent";
  });
  panel.querySelectorAll<HTMLElement>("tbody tr").forEach((row) => {
    row.hidden = Boolean(who) && row.dataset.who !== who;
  });
}

/** The Change stage button says where the matter will move: it follows the chosen stage. */
export function syncStageButton(dialog: ParentNode) {
  const checked = dialog.querySelector<HTMLInputElement>('input[name="stg"]:checked');
  const go = dialog.querySelector<HTMLElement>("#stGo");
  const label = checked?.closest("label")?.querySelector("b")?.textContent?.trim();
  if (go && label) go.textContent = `Move to ${label}`;
}

export function bindWorkControls(root: HTMLElement, router: Router, listen: { signal: AbortSignal }) {
  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      const done = target.closest<HTMLElement>("[data-task-done]");
      if (done && root.contains(done)) {
        event.preventDefault();
        event.stopPropagation();
        busy(done, () => runTaskDone(done, root, router));
        return;
      }
      const open = target.closest<HTMLElement>("[data-task-open]");
      if (open && root.contains(open)) {
        event.preventDefault();
        event.stopPropagation();
        openTask(open, root);
        return;
      }
      const save = target.closest<HTMLElement>("[data-task-save]");
      if (save && root.contains(save)) {
        event.preventDefault();
        event.stopPropagation();
        busy(save, () => runTaskSave(save, router));
        return;
      }
      const confirm = target.closest<HTMLElement>("[data-deadline-confirm]");
      if (confirm && root.contains(confirm)) {
        event.preventDefault();
        event.stopPropagation();
        busy(confirm, () => runDeadlineConfirm(confirm, router));
        return;
      }
      const chip = target.closest<HTMLElement>("[data-who-chip]");
      if (chip && root.contains(chip)) {
        event.preventDefault();
        pickPerson(chip);
      }
    },
    { capture: true, signal: listen.signal },
  );
  root.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target as HTMLElement;
      if (target.matches("[data-who-chip]")) {
        event.preventDefault();
        pickPerson(target);
      } else if (target.matches(".ck[data-task-done]")) {
        event.preventDefault();
        target.click();
      }
    },
    listen,
  );
  const stage = root.querySelector<HTMLDialogElement>("dialog#dStage");
  if (stage?.querySelector("[data-act]")) {
    syncStageButton(stage);
    stage.addEventListener("change", () => syncStageButton(stage), listen);
  }
  // Cancel (or closing) New matter clears what was typed, so the next one starts empty.
  const newMatter = root.querySelector<HTMLDialogElement>("dialog#dlgNew");
  newMatter?.addEventListener(
    "close",
    () => {
      newMatter.querySelectorAll<HTMLInputElement>("input.inp").forEach((input) => {
        input.value = "";
      });
    },
    listen,
  );
}

/**
 * The Matters list: search and the Mine switch narrow the same rows together, "Showing N of M"
 * and the no-match panel follow, and Select all ticks every shown row.
 */
export function wireMattersList(root: HTMLElement, listen: { signal: AbortSignal }) {
  const bar = root.querySelector<HTMLElement>("#content > .bar");
  const input = bar?.querySelector<HTMLInputElement>("input");
  const rows = [...root.querySelectorAll<HTMLElement>("#content .t tbody tr")];
  const count = root.querySelector<HTMLElement>("[data-matters-showing]");
  const empty = root.querySelector<HTMLElement>("[data-matters-none]");
  const table = root.querySelector<HTMLElement>("#content > .tw");
  if (!bar || !input) return;
  const mine = () => /Mine/.test(bar.querySelector('.k2-rsw [aria-checked="true"]')?.textContent ?? "");
  // "Showing N of M" is the paragraph's first text run; "Load more" after it stays.
  const counter = count?.firstChild?.nodeType === Node.TEXT_NODE ? count.firstChild : null;
  const original = counter?.nodeValue ?? "";
  const apply = () => {
    const q = input.value.trim().toLowerCase();
    const onlyMine = mine();
    let shown = 0;
    for (const row of rows) {
      const hide = (onlyMine && !row.hasAttribute("data-mine")) || (Boolean(q) && !row.textContent.toLowerCase().includes(q));
      row.hidden = hide;
      if (!hide) shown++;
    }
    if (counter) counter.nodeValue = q || onlyMine ? `Showing ${shown} of ${rows.length} ` : original;
    if (empty && rows.length) {
      empty.hidden = shown > 0;
      table?.toggleAttribute("hidden", shown === 0);
    }
  };
  const preset = new URLSearchParams(window.location.search).get("q");
  if (preset && !input.value) input.value = preset;
  input.addEventListener("input", apply, listen);
  bar.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".k2-rsw button")) window.setTimeout(apply, 0);
  }, listen);
  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-matters-clear]")) {
        event.preventDefault();
        input.value = "";
        apply();
        return;
      }
      const all = target.closest<HTMLElement>('thead .ck[aria-label="Select all"]');
      if (!all) return;
      event.preventDefault();
      event.stopPropagation();
      const on = !all.classList.contains("on");
      all.classList.toggle("on", on);
      all.setAttribute("aria-checked", String(on));
      for (const row of rows) {
        if (row.hidden) continue;
        row.querySelector(".ck")?.classList.toggle("on", on);
        row.classList.toggle("sel", on);
      }
    },
    { capture: true, signal: listen.signal },
  );
  apply();
}
