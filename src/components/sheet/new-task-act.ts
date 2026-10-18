"use client";

import { toast2 } from "@/components/port/kit";
import { createSheetTask } from "@/modules/tasks/actions";
import { optionFits, readNewTask, taskAudience } from "@/modules/sheet/new-task";

type Router = { refresh: () => void };

function field(root: ParentNode, id: string) {
  return root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
}

function value(root: ParentNode, id: string): string {
  return field(root, id)?.value ?? "";
}

/** Shows only the owners and dependencies that fit the chosen matter and kind, as create_task requires. */
export function syncNewTask(dialog: ParentNode) {
  const matter = value(dialog, "tkM");
  const kind = taskAudience(value(dialog, "tkK"));
  for (const id of ["tkO", "tkP"]) {
    const select = field(dialog, id);
    if (!(select instanceof HTMLSelectElement)) continue;
    for (const option of select.options) {
      const fits = optionFits({ kind: option.dataset.k, matter: option.dataset.m }, matter, kind);
      option.hidden = !fits;
      option.disabled = !fits;
    }
    if (select.selectedOptions[0]?.disabled) {
      const first = [...select.options].find((option) => !option.disabled);
      select.value = first?.value ?? "";
    }
  }
}

/**
 * Saves the New task dialog through the server action. The database decides; a refusal
 * (sample mode, a matter the person isn't assigned to, an owner who can't own it) is shown as is.
 */
export async function runNewTask(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const read = readNewTask({
    matter: value(dialog, "tkM"),
    title: value(dialog, "tkT"),
    kind: value(dialog, "tkK"),
    owner: value(dialog, "tkO"),
    due: value(dialog, "tkD"),
    dependsOn: value(dialog, "tkP"),
  });
  if ("error" in read) {
    toast2(read.error, { kind: "warn", sub: "Nothing was saved." });
    return;
  }
  const result = await createSheetTask({ organizationId: button.dataset.org ?? "", timezone: button.dataset.tz ?? "", ...read.input });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  dialog.close();
  for (const id of ["tkT", "tkD"]) {
    const input = field(dialog, id);
    if (input) input.value = "";
  }
  if (result.dependency) toast2("Task created without its dependency", { kind: "warn", sub: result.dependency });
  else toast2("Task created", { kind: "ok", sub: read.input.audience === "client" ? "It shows in the client’s portal." : "Staff only." });
  router.refresh();
}
