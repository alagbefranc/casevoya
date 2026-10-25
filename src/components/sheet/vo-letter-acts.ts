"use client";

import { toast2 } from "@/components/port/kit";
import { approveLetter, createLetter, discardLetter, draftLetterWithVo, reviseLetter } from "@/modules/vo/letter-actions";
import { needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";

/**
 * AI-01 letters on a matter (src/components/sheet/designer/matter-letters.tsx): Draft letter with
 * Vo, New letter, Save as new version, Approve and Discard. The database decides each change; a
 * step-up refusal on Approve sends the person to the step-up screen and back to the matter.
 */
type Router = { refresh: () => void };

function field(scope: ParentNode | null, selector: string): string {
  const element = scope?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector);
  return element?.value ?? "";
}

function done(button: HTMLElement, title: string, sub: string, router: Router) {
  button.closest("dialog")?.close();
  toast2(title, { kind: "ok", sub });
  router.refresh();
}

/** Draft letter with Vo: Vo drafts from approved facts and saves a DRAFT for licensed review. */
export async function runVoLetterDraft(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  toast2("Vo is drafting the letter", { sub: "Usually under a minute. Nothing is sent." });
  let result: Awaited<ReturnType<typeof draftLetterWithVo>>;
  try {
    result = await draftLetterWithVo({ organizationId: button.dataset.org ?? "", matterId: button.dataset.matter ?? "", letterType: field(dialog, "#vlType") });
  } catch {
    toast2("Vo didn’t finish", { kind: "bad", sub: "Nothing was saved. Write the letter yourself, or try again." });
    return;
  }
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  if ("abstained" in result) {
    dialog?.close();
    toast2("This letter needs a consultant", { kind: "warn", sub: "It would need advice or an eligibility view, so Vo didn’t draft it. Write it yourself." });
    return;
  }
  done(button, "Letter drafted by Vo", "It’s a DRAFT with its cited facts and sources. A licensed member approves it before it can be released.", router);
}

/** New letter, written by hand: saved as a draft for licensed review. */
export async function runLetterNew(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  const result = await createLetter({
    organizationId: button.dataset.org ?? "",
    matterId: button.dataset.matter ?? "",
    letterType: field(dialog, "#nlType"),
    title: field(dialog, "#nlTitle"),
    body: field(dialog, "#nlBody"),
  });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  done(button, "Letter saved as a draft", "A licensed member approves it before it can be released.", router);
}

/** Save as new version: the edited text becomes the next version; the old one is kept. */
export async function runLetterRevise(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  const result = await reviseLetter({
    organizationId: button.dataset.org ?? "",
    letterId: button.dataset.letterRevise ?? "",
    version: Number(button.dataset.version),
    title: field(dialog, "[data-letter-title]"),
    body: field(dialog, "[data-letter-body]"),
  });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  done(button, `Saved as version ${result.versionNumber}`, "The earlier version is kept. This one needs its own licensed approval.", router);
}

/** Approve (licensed members, fresh step-up): the current version becomes the letter that can be released. */
export async function runLetterApprove(button: HTMLElement, router: Router) {
  const result = await approveLetter({ organizationId: button.dataset.org ?? "", letterId: button.dataset.letterApprove ?? "", version: Number(button.dataset.version) });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      window.location.assign(stepUpLocation(window.location.pathname, window.location.search, null));
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was approved." });
    return;
  }
  done(button, "Letter approved", "You can download the final letter now. The approval is in the audit log.", router);
}

/** Discard: the draft stays on record as discarded and can't be released. */
export async function runLetterDiscard(button: HTMLElement, router: Router) {
  if (!window.confirm("Discard this draft letter? It stays on record but can’t be released or changed.")) return;
  const result = await discardLetter({ organizationId: button.dataset.org ?? "", letterId: button.dataset.letterDiscard ?? "", version: Number(button.dataset.version) });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was changed." });
    return;
  }
  done(button, "Letter discarded", "It stays on record and can’t be released.", router);
}
