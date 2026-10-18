"use client";

import { toast2 } from "@/components/port/kit";
import { changeMatterStage, confirmMatterOutcome, holdMatter, recordMatterDeadline, recordMatterLetter, resumeMatter } from "@/modules/sheet/actions";
import { letterNote, letterStatus, needsStepUp, stageAt, stepUpLocation, withoutDialog, type MatterDialog } from "@/modules/sheet/matter-wire";
import { readDeadline } from "@/modules/sheet/new-deadline";

type Router = { replace: (href: string) => void; refresh: () => void };
type Result = { error?: string } | Record<string, unknown> | null | undefined;

function text(root: ParentNode, selector: string): string {
  const el = root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  return (el?.value ?? "").trim();
}

const DIALOG: Record<string, MatterDialog | null> = { stage: "stage", hold: "hold", letter: "letter", deadline: "deadline", resume: null, outcome: null };
const DONE: Record<string, string> = {
  stage: "Stage changed",
  hold: "Matter put on hold",
  letter: "Letter recorded",
  resume: "Matter resumed",
  outcome: "Outcome recorded",
  deadline: "Deadline recorded",
};
const DONE_SUB: Record<string, string> = {
  deadline: "Tentative until a licensed consultant confirms it. Reminders are proposed.",
};

/**
 * Saves a matter dialog through the server actions. The database decides; a step-up
 * refusal sends the person to /mfa?step=6 and back here with the dialog open again.
 */
export async function runMatterAct(button: HTMLElement, root: HTMLElement, router: Router) {
  const act = button.dataset.act ?? "";
  const ref = {
    organizationId: button.dataset.org ?? "",
    matterId: button.dataset.matter ?? "",
    version: Number(button.dataset.version),
  };
  const dialog = button.closest("dialog");
  const scope: ParentNode = dialog ?? root;
  let result: Result;
  let sub = DONE_SUB[act] ?? "Recorded in the matter’s history.";

  if (act === "stage") {
    const toStage = stageAt(scope.querySelector<HTMLInputElement>('input[name="stg"]:checked')?.value);
    const reason = text(scope, "textarea");
    if (!toStage) return void toast2("Pick a stage", { kind: "warn", sub: "Choose where this matter moves next." });
    if (reason.length < 3) return void toast2("Add a reason", { kind: "warn", sub: "The reason is kept in the matter’s history." });
    result = await changeMatterStage({ ...ref, toStage, reason });
  } else if (act === "hold") {
    const selects = scope.querySelectorAll<HTMLSelectElement>("select");
    const reason = (selects[0]?.selectedOptions[0]?.textContent ?? "").trim();
    const ownerMembershipId = selects[1]?.value ?? "";
    const reviewOn = text(scope, 'input[type="date"]');
    if (!reviewOn) return void toast2("Pick a review date", { kind: "warn", sub: "On hold needs a date to look at it again." });
    result = await holdMatter({ ...ref, reason, ownerMembershipId, reviewOn });
  } else if (act === "letter") {
    const selects = scope.querySelectorAll<HTMLSelectElement>("select");
    const type = (selects[0]?.selectedOptions[0]?.textContent ?? "").trim();
    const via = (selects[1]?.selectedOptions[0]?.textContent ?? "").trim();
    const status = letterStatus(type);
    if (!status) return void toast2("Choose the letter type", { kind: "warn" });
    const note = letterNote({ type, receivedOn: text(scope, 'input[type="date"]'), via, deadline: text(scope, "input[placeholder]") });
    result = await recordMatterLetter({ ...ref, status, note });
  } else if (act === "resume") {
    result = await resumeMatter(ref);
  } else if (act === "outcome") {
    const outcome = text(scope, "#outSel");
    const note = text(scope, "#outNote");
    if (note.length < 3) return void toast2("Add a note", { kind: "warn", sub: "Say what the decision letter shows. It is kept in the history." });
    result = await confirmMatterOutcome({ ...ref, outcome, note });
  } else if (act === "deadline") {
    const fields = {
      label: text(scope, "#ddL"),
      kind: text(scope, "#ddK"),
      dueOn: text(scope, "#ddD"),
      dueTime: text(scope, "#ddT"),
      timezone: text(scope, "#ddZ"),
      evidence: text(scope, "#ddE"),
      sourceUrl: text(scope, "#ddU"),
      retrievedOn: text(scope, "#ddR"),
    };
    // Checked here for a quick answer, and again by the server action and the database.
    const read = readDeadline(fields);
    if ("error" in read) return void toast2(read.error, { kind: "warn", sub: "Nothing was saved." });
    result = await recordMatterDeadline({ ...ref, fields });
    if (result && "remindersScheduled" in result && result.remindersScheduled === false) {
      sub = "Tentative until a licensed consultant confirms it. Reminders weren’t scheduled yet.";
    }
  } else {
    return;
  }

  const error = result && "error" in result && typeof result.error === "string" ? result.error : null;
  if (error) {
    if (needsStepUp(error)) {
      window.location.assign(stepUpLocation(window.location.pathname, window.location.search, DIALOG[act] ?? null));
      return;
    }
    toast2(error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  dialog?.close();
  toast2(DONE[act] ?? "Saved", { kind: "ok", sub });
  router.replace(withoutDialog(window.location.pathname, window.location.search));
  router.refresh();
}
