"use client";

import { toast2 } from "@/components/port/kit";
import { freezeIntakeSnapshot, reuseApprovedFacts, reviewIntakeAnswer, sendIntakeRequest } from "@/modules/intake/delivery-actions";
import { needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";

type Router = { replace: (href: string) => void; refresh: () => void };

function value(root: ParentNode, id: string): string {
  return root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#${id}`)?.value ?? "";
}

/** Send a form (`#dIntakeSend`): public.send_intake_request checks the role, the matter, the person and sample mode. */
export async function runIntakeSend(button: HTMLElement, router: Router) {
  const dialog = button.closest("dialog");
  if (!dialog) return;
  const result = await sendIntakeRequest({
    organizationId: button.dataset.org ?? "",
    matterId: button.dataset.matter ?? "",
    templateId: value(dialog, "isF"),
    personId: value(dialog, "isP"),
    dueOn: value(dialog, "isD") || null,
    message: value(dialog, "isM") || null,
  });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was sent." });
    return;
  }
  dialog.close();
  dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("#isD, #isM").forEach((node) => {
    node.value = "";
  });
  toast2(result.created ? "Form sent" : "Already sent", {
    kind: "ok",
    sub: result.created ? "It’s a task in their portal. Answers appear here as they save. No email is sent." : "This person already has this form open. Nothing new was sent.",
  });
  router.refresh();
}

/**
 * Mark reviewed: the Designer's fuse button arms for its 4 seconds (Undo cancels it). Only once it
 * settles is public.review_intake_answer called; a refusal puts the button back.
 */
export function armIntakeReview(button: HTMLElement, router: Router) {
  const wrap = button.closest<HTMLElement>("[data-intake-review]");
  if (!wrap || wrap.dataset.phase !== "idle") return;
  const ms = Number(wrap.dataset.ms || 4000);
  window.setTimeout(() => {
    if (wrap.dataset.phase !== "settled") return;
    void reviewIntakeAnswer({ organizationId: wrap.dataset.org ?? "", answerId: wrap.dataset.intakeReview ?? "" }).then((result) => {
      if ("error" in result) {
        wrap.dataset.phase = "idle";
        wrap.querySelector(".k2-fb-idle")?.removeAttribute("hidden");
        wrap.querySelector(".k2-fb-undo")?.removeAttribute("hidden");
        wrap.querySelector(".k2-fb-done")?.setAttribute("aria-hidden", "true");
        toast2(result.error, { kind: "bad", sub: "The answer is still waiting for review." });
        return;
      }
      const status = wrap.querySelector(".k2-sr");
      if (status) status.textContent = "Reviewed";
      router.refresh();
    });
  }, ms + 120);
}

/** Freeze snapshot: public.freeze_intake_response needs a recent step-up; without one the person goes to it first. */
export async function runIntakeFreeze(button: HTMLElement, router: Router) {
  const result = await freezeIntakeSnapshot({ organizationId: button.dataset.org ?? "", responseId: button.dataset.intakeFreeze ?? "" });
  if ("error" in result) {
    if (needsStepUp(result.error)) {
      window.location.assign(stepUpLocation(window.location.pathname, window.location.search, null, "intake_send"));
      return;
    }
    toast2(result.error, { kind: "bad", sub: "Nothing was frozen." });
    return;
  }
  toast2("Snapshot frozen", { kind: "ok", sub: "The answers as submitted are fixed. A client correction still makes a new version beside it." });
  router.refresh();
}

/**
 * Reuse approved facts (INT-04): public.reuse_approved_facts copies the person's reviewed answers
 * from their earlier forms into the empty questions of this draft, each waiting for the client.
 */
export async function runIntakeReuse(button: HTMLElement, router: Router) {
  const result = await reuseApprovedFacts({ organizationId: button.dataset.org ?? "", responseId: button.dataset.intakeReuse ?? "" });
  if ("error" in result) {
    toast2(result.error, { kind: "bad", sub: "Nothing was copied." });
    return;
  }
  if (result.count === 0) {
    toast2("Nothing to reuse", { kind: "warn", sub: "No reviewed answer from this person’s earlier forms fits an empty question here." });
    return;
  }
  toast2(`${result.count} answer${result.count === 1 ? "" : "s"} reused`, { kind: "ok", sub: "Each one waits for the client to confirm it in their portal before they can send the form." });
  router.refresh();
}
