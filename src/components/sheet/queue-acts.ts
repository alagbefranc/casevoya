"use client";

import { goStepUp } from "@/lib/auth/step-up-resume";
import { toast2 } from "@/components/port/kit";
import { reassignQueueTasks } from "@/modules/sheet/queue-actions";
import { stepUpHref } from "@/lib/auth/mfa-step";

type Router = { refresh: () => void };

/** The ticked queue items: tasks (which can move) and the rest (which can't, here). */
export function pickedQueueItems(root: ParentNode) {
  const ticked = [...root.querySelectorAll<HTMLElement>("#ql .li")].filter((item) => item.querySelector(".ck.on"));
  const tasks = ticked
    .filter((item) => item.dataset.task && item.dataset.version)
    .map((item) => ({ id: item.dataset.task as string, version: Number(item.dataset.version) }));
  return { tasks, others: ticked.length - tasks.length };
}

/** "2 tasks chosen" under the Reassign control, kept true as boxes are ticked. */
export function syncQueuePicked(root: ParentNode) {
  const line = root.querySelector<HTMLElement>("[data-queue-picked]");
  if (!line) return;
  const { tasks, others } = pickedQueueItems(root);
  const chosen = tasks.length === 0 ? "Tick tasks to choose them." : tasks.length === 1 ? "1 task chosen." : `${tasks.length} tasks chosen.`;
  line.textContent = others ? `${chosen} ${others === 1 ? "1 ticked item isn’t a task" : `${others} ticked items aren’t tasks`} and stays with its matter.` : chosen;
}

function stepUp() {
  const next = `${window.location.pathname}${window.location.search}`;
  goStepUp(stepUpHref(next, "reassign_work"));
}

export async function runQueueReassign(root: HTMLElement, button: HTMLElement, router: Router) {
  const { tasks, others } = pickedQueueItems(root);
  const membershipId = root.querySelector<HTMLSelectElement>("#qR")?.value ?? "";
  if (!tasks.length) {
    toast2(others ? "Only tasks can be reassigned here" : "Tick the tasks to reassign first", {
      kind: "warn",
      sub: others ? "Reviews and deadlines follow the matter’s consultant; change it on the matter." : "Use the checkbox at the start of each task.",
    });
    return;
  }
  const result = await reassignQueueTasks({ organizationId: button.dataset.queueReassign ?? "", membershipId, tasks });
  if ("error" in result) {
    if (result.stepUp) {
      toast2("Confirm it’s you", { kind: "warn", sub: result.error });
      window.setTimeout(stepUp, 900);
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  const person = root.querySelector<HTMLSelectElement>("#qR")?.selectedOptions[0]?.textContent ?? "them";
  toast2(result.moved === 1 ? `1 task reassigned to ${person}` : `${result.moved} tasks reassigned to ${person}`, {
    kind: result.refused ? "warn" : "ok",
    sub: result.refused ? `${result.refused} couldn’t be: it changed since you opened the page, or your role can’t move it.` : "They see it in their own work.",
  });
  router.refresh();
}
