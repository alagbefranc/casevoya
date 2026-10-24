"use client";

import { toast2 } from "@/components/port/kit";
import { confirmMatterDeadline } from "@/modules/sheet/actions";
import { needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";
import {
  addSheetTaskDependency,
  addSheetTaskWatcher,
  completeSheetTask,
  escalateOverdueWork,
  loadTaskDetail,
  removeSheetTaskDependency,
  removeSheetTaskWatcher,
  saveSheetTask,
  setSheetTaskBlocker,
  setSheetTaskChecklist,
} from "@/modules/tasks/actions";
import { checklistProgress, type TaskDetail } from "@/modules/sheet/task-detail";

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
  if ("error" in result) {
    // In the dialog the refusal (an open dependency, say) also stays written above the detail.
    if (fromDialog && dialog) note(dialog, result.error);
    return void toast2(result.error, { kind: "bad", sub: "The task is still open." });
  }
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
  if (dialog.querySelector("#teX")) void fillDetail(dialog);
}

/** The detail last read for the open Task dialog (OPS-01). */
const details = new WeakMap<HTMLDialogElement, TaskDetail>();

/** A line above the detail: loading, a refusal, or nothing. */
function note(dialog: HTMLDialogElement, text: string | null) {
  const line = dialog.querySelector<HTMLElement>("#teXL");
  if (!line) return;
  line.textContent = text ?? "";
  line.hidden = !text;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; data?: Record<string, string>; attrs?: Record<string, string> } = {},
) {
  const element = document.createElement(tag);
  if (props.className) element.className = props.className;
  if (props.text != null) element.textContent = props.text;
  for (const [key, val] of Object.entries(props.data ?? {})) element.dataset[key] = val;
  for (const [key, val] of Object.entries(props.attrs ?? {})) element.setAttribute(key, val);
  return element;
}

/** One `.li` row: an optional tick, the words, and an optional Remove. */
function detailRow(input: {
  title: string;
  small?: string;
  tick?: { on: boolean; data?: Record<string, string>; label?: string };
  remove?: Record<string, string>;
  editable: boolean;
}) {
  const row = make("div", { className: "li" });
  if (input.tick) {
    const tick = make("span", { className: input.tick.on ? "ck on" : "ck" });
    if (input.tick.data && input.editable) {
      for (const [key, val] of Object.entries(input.tick.data)) tick.dataset[key] = val;
      tick.setAttribute("role", "checkbox");
      tick.setAttribute("aria-checked", String(input.tick.on));
      tick.setAttribute("tabindex", "0");
      tick.setAttribute("aria-label", input.tick.label ?? input.title);
    } else {
      tick.setAttribute("aria-hidden", "true");
    }
    row.append(tick);
  }
  const words = make("div");
  words.append(make("b", { text: input.title }));
  if (input.small) words.append(make("small", { text: input.small }));
  row.append(words);
  if (input.remove && input.editable) {
    const right = make("span", { className: "r" });
    right.append(make("button", { className: "btn s sm", text: "Remove", data: input.remove, attrs: { type: "button", "aria-label": `Remove ${input.title}` } }));
    row.append(right);
  }
  return row;
}

function fillSelect(select: HTMLSelectElement | null, options: { value: string; label: string }[], empty: string) {
  if (!select) return;
  const list = options.length ? options : [{ value: "", label: empty }];
  select.replaceChildren(...list.map((option) => make("option", { text: option.label, attrs: { value: option.value } })));
  select.disabled = options.length === 0;
}

/** Draws the detail into the Task dialog. */
function drawDetail(dialog: HTMLDialogElement, detail: TaskDetail) {
  details.set(dialog, detail);
  dialog.dataset.version = String(detail.version);
  dialog.dataset.detail = "1";
  const editable = detail.open;
  const set = (selector: string, val: string) => {
    const field = dialog.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
    if (!field) return;
    if (field instanceof HTMLSelectElement && val && ![...field.options].some((option) => option.value === val)) {
      field.append(make("option", { text: val.replace(/_/g, " "), attrs: { value: val } }));
    }
    field.value = val;
    field.disabled = !editable;
  };
  set("#teTm", detail.dueTime);
  set("#teZ", detail.dueTimezone);
  set("#teE", detail.estimate == null ? "" : String(detail.estimate));
  set("#teR", detail.recurrence);
  set("#teB", detail.blocker?.note ?? "");
  set("#teKI", "");

  dialog.querySelector("#teW")?.replaceChildren(
    ...(detail.watchers.length
      ? detail.watchers.map((watcher) => detailRow({ title: watcher.name, remove: { taskUnwatch: watcher.id }, editable: true }))
      : [make("small", { className: "hint", text: "No watchers yet." })]),
  );
  fillSelect(dialog.querySelector("#teWS"), detail.watcherOptions, "Everyone is watching");

  dialog.querySelector("#teP")?.replaceChildren(
    ...(detail.dependsOn.length
      ? detail.dependsOn.map((dep) =>
          detailRow({ title: dep.title, small: dep.done ? "Done" : "Still open: this task waits on it", tick: { on: dep.done }, remove: { taskUndep: dep.id }, editable }),
        )
      : [make("small", { className: "hint", text: "Nothing. It can be marked done any time." })]),
  );
  fillSelect(dialog.querySelector("#tePS"), detail.dependsOnOptions, "No other open task on this matter");

  dialog.querySelector("#teK")?.replaceChildren(
    ...detail.checklist.map((item, index) =>
      detailRow({
        title: item.text,
        tick: { on: item.done, data: { taskTick: String(index) }, label: `${item.done ? "Untick" : "Tick"} “${item.text}”` },
        remove: { taskUncheck: String(index) },
        editable,
      }),
    ),
  );
  const progress = dialog.querySelector<HTMLElement>("#teKP");
  if (progress) progress.textContent = checklistProgress(detail.checklist);

  const recorded = dialog.querySelector<HTMLElement>("#teBR");
  if (recorded) recorded.textContent = detail.blocker ? detail.blocker.recorded : "Not blocked. Say what is blocking it to mark it blocked.";
  const block = dialog.querySelector<HTMLElement>('[data-task-block="set"]');
  if (block) block.textContent = detail.blocker ? "Update blocker" : "Mark blocked";
  dialog.querySelector<HTMLElement>('[data-task-block="clear"]')?.toggleAttribute("hidden", !detail.blocker);

  dialog.querySelector("#teH")?.replaceChildren(...detail.history.map((line) => make("small", { className: "hint", text: line, attrs: { style: "display:block" } })));
  dialog.querySelectorAll<HTMLButtonElement>("[data-task-watch], [data-task-dep], [data-task-check], [data-task-block]").forEach((button) => {
    if (button.hasAttribute("data-task-watch")) button.disabled = detail.watcherOptions.length === 0;
    else if (button.hasAttribute("data-task-dep")) button.disabled = !editable || detail.dependsOnOptions.length === 0;
    else button.disabled = !editable;
  });
  note(dialog, editable ? null : "This task is finished, so its detail is shown, not edited.");
}

async function fillDetail(dialog: HTMLDialogElement) {
  const taskId = dialog.dataset.task ?? "";
  dialog.dataset.detail = "";
  details.delete(dialog);
  note(dialog, "Loading the task’s detail…");
  const result = await loadTaskDetail({ organizationId: dialog.dataset.org ?? "", taskId, timezone: dialog.dataset.tz ?? "" });
  // The dialog may have moved on to another task meanwhile.
  if (dialog.dataset.task !== taskId) return;
  if ("error" in result) return note(dialog, `${result.error} The detail couldn’t load; the title, due date and owner still save.`);
  drawDetail(dialog, result.detail);
}

/** A detail change saved straight away (watchers, depends on, checklist, blocker), then the detail is read again. */
async function runDetail(control: HTMLElement, root: HTMLElement) {
  const dialog = control.closest("dialog");
  const detail = dialog ? details.get(dialog) : undefined;
  if (!dialog || !detail) return;
  const organizationId = dialog.dataset.org ?? "";
  const taskId = detail.id;
  const version = Number(dialog.dataset.version);
  const data = control.dataset;
  let result: { error: string } | object;
  if ("taskWatch" in data) {
    result = await addSheetTaskWatcher({ organizationId, taskId, membershipId: value(dialog, "#teWS") });
  } else if ("taskUnwatch" in data) {
    result = await removeSheetTaskWatcher({ organizationId, taskId, membershipId: data.taskUnwatch ?? "" });
  } else if ("taskDep" in data) {
    result = await addSheetTaskDependency({ organizationId, taskId, dependsOnTaskId: value(dialog, "#tePS") });
  } else if ("taskUndep" in data) {
    result = await removeSheetTaskDependency({ organizationId, taskId, dependsOnTaskId: data.taskUndep ?? "" });
  } else if ("taskBlock" in data) {
    result = await setSheetTaskBlocker({ organizationId, taskId, version, note: data.taskBlock === "clear" ? null : value(dialog, "#teB") });
  } else {
    const items = detail.checklist.map((item) => ({ ...item }));
    if ("taskCheck" in data) {
      const text = value(dialog, "#teKI");
      if (!text) return void toast2("Type the checklist item first.", { kind: "warn" });
      items.push({ text, done: false });
    } else if ("taskTick" in data) {
      const item = items[Number(data.taskTick)];
      if (item) item.done = !item.done;
    } else if ("taskUncheck" in data) {
      items.splice(Number(data.taskUncheck), 1);
    }
    result = await setSheetTaskChecklist({ organizationId, taskId, version, items });
  }
  if ("error" in result) return void toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
  root.dataset.taskChanged = "1";
  await fillDetail(dialog);
}

/** "Escalate overdue" on the Tasks page: public.escalate_overdue_work as of now. */
async function runEscalate(button: HTMLElement, router: Router) {
  const result = await escalateOverdueWork({ organizationId: button.dataset.taskEscalate ?? "", asOf: new Date().toISOString() });
  if ("error" in result && result.error) return void toast2(result.error, { kind: "bad", sub: "Nothing was escalated." });
  const count = "count" in result && typeof result.count === "number" ? result.count : 0;
  toast2(count ? `${count} overdue ${count === 1 ? "item" : "items"} escalated` : "Nothing overdue to escalate", {
    kind: count ? "ok" : "info",
    sub: count ? "Each task’s owner, its watchers and the matter’s responsible consultant are told in Notifications." : "",
  });
  router.refresh();
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
    // OPS-01: only once the detail has loaded, so an unread form never clears what is saved.
    details:
      dialog.dataset.detail === "1"
        ? { estimate: value(dialog, "#teE"), dueTime: value(dialog, "#teTm"), dueTimezone: value(dialog, "#teZ"), recurrence: value(dialog, "#teR") }
        : null,
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
      const detail = target.closest<HTMLElement>(
        "[data-task-watch], [data-task-unwatch], [data-task-dep], [data-task-undep], [data-task-check], [data-task-tick], [data-task-uncheck], [data-task-block]",
      );
      if (detail && root.contains(detail)) {
        event.preventDefault();
        event.stopPropagation();
        busy(detail, () => runDetail(detail, root));
        return;
      }
      const escalate = target.closest<HTMLElement>("[data-task-escalate]");
      if (escalate && root.contains(escalate)) {
        event.preventDefault();
        event.stopPropagation();
        busy(escalate, () => runEscalate(escalate, router));
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
      } else if (target.matches(".ck[data-task-done], .ck[data-task-tick]")) {
        event.preventDefault();
        target.click();
      }
    },
    listen,
  );
  // A detail change saved from the Task dialog shows on the page once the dialog closes.
  root.querySelector<HTMLDialogElement>("dialog#dTask")?.addEventListener(
    "close",
    () => {
      if (root.dataset.taskChanged !== "1") return;
      delete root.dataset.taskChanged;
      router.refresh();
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
