"use client";

import { toast2 } from "@/components/port/kit";
import { readAttestationFrom } from "@/modules/government/page-attestation";
import { needsStepUp, stepUpLocation, withoutDialog } from "@/modules/sheet/matter-wire";
import {
  confirmSubmissionFees,
  overrideSubmissionGate,
  proposeSubmissionRequirement,
  retireSubmissionRequirement,
  reviewSubmissionRequirement,
  tickSubmissionStep,
} from "@/modules/submissions/actions";

/**
 * The Submissions tab's checklist acts (GOV-01, GOV-03): `data-sub` controls on the Submission
 * checklist card and its dialogs. The database decides every change; a step-up refusal sends the
 * person to /mfa?step=6 and back. Clicks are taken in the capture phase so a step's `.ck` box
 * changes only when the database has stored it (the page refreshes with the stored state).
 */
type Router = { replace: (href: string) => void; refresh: () => void };
type Result = { error?: string } | Record<string, unknown> | null | undefined;

function value(root: ParentNode, selector: string): string {
  return (root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)?.value ?? "").trim();
}

const DONE: Record<string, [string, string]> = {
  tick: ["Saved", "The step’s state is kept with this handoff."],
  fees: ["Fee handling confirmed", "Kept with this handoff, with your name and the time."],
  override: ["Gate overridden", "Your reason is in the audit trail."],
  propose: ["Sent for review", "A licensed consultant approves it before it reaches a checklist."],
  review: ["Approved", "It now shows on checklists for its program and channel."],
  attest: ["Approved", "It shows on checklists with “page not captured by Casevoya, checked by you” and the date."],
  reject: ["Rejected", "It won’t reach any checklist."],
  retire: ["Retired", "It no longer shows on checklists."],
};

export function bindSubmissionControls(root: HTMLElement, router: Router, listen: { signal: AbortSignal }) {
  root.addEventListener(
    "click",
    (event) => {
      const control = (event.target as HTMLElement).closest<HTMLElement>("[data-sub]");
      if (!control || !root.contains(control)) return;
      event.preventDefault();
      event.stopPropagation();
      if (control.getAttribute("aria-busy") === "true") return;
      if (control.dataset.sub === "reject-open" || control.dataset.sub === "retire-open" || control.dataset.sub === "attest-open") {
        // One Reject (Retire, Approve without a snapshot) dialog serves every entry: it takes this entry's id and version.
        const which =
          control.dataset.sub === "reject-open" ? ["#dSubRej", "reject"] : control.dataset.sub === "retire-open" ? ["#dSubRet", "retire"] : ["#dSubAtt", "attest"];
        const confirm = root.querySelector<HTMLElement>(`${which[0]} [data-sub="${which[1]}"]`);
        const dialog = root.querySelector<HTMLDialogElement>(which[0]);
        if (!confirm || !dialog) return;
        confirm.dataset.id = control.dataset.id ?? "";
        confirm.dataset.version = control.dataset.version ?? "";
        const tick = dialog.querySelector<HTMLInputElement>("input[data-attest]");
        if (tick) tick.checked = false;
        dialog.showModal();
        return;
      }
      control.setAttribute("aria-busy", "true");
      void runSubmissionAct(control, root, router).finally(() => control.removeAttribute("aria-busy"));
    },
    { capture: true, signal: listen.signal },
  );
}

export async function runSubmissionAct(control: HTMLElement, root: HTMLElement, router: Router) {
  const act = control.dataset.sub ?? "";
  const data = control.dataset;
  const organizationId = data.org ?? "";
  const dialog = control.closest("dialog");
  const scope: ParentNode = dialog ?? root;
  let result: Result;
  let note: string | null = null;

  if (act === "tick") {
    result = await tickSubmissionStep({ organizationId, handoffId: data.handoff ?? "", requirementId: data.requirement ?? "", ticked: data.ticked === "true" });
  } else if (act === "fees") {
    const text = value(scope, "#sfN");
    if (text.length < 3) return void toast2("Say how the fee was handled", { kind: "warn", sub: "For example: client paid in the portal; receipt saved." });
    result = await confirmSubmissionFees({ organizationId, handoffId: data.handoff ?? "", confirmed: true, note: text });
  } else if (act === "override") {
    const reason = value(scope, "#soR");
    if (reason.length < 10) return void toast2("Give the reason", { kind: "warn", sub: "At least 10 characters. It is kept in the audit trail." });
    result = await overrideSubmissionGate({ organizationId, handoffId: data.handoff ?? "", gate: value(scope, "#soG"), reason });
  } else if (act === "propose") {
    const label = value(scope, "#sqL");
    const sourceUrl = value(scope, "#sqU");
    if (label.length < 3) return void toast2("Write the step or name", { kind: "warn", sub: "Word for word, as the official page gives it." });
    if (!sourceUrl) return void toast2("Add the official page link", { kind: "warn", sub: "canada.ca or a gc.ca site, with the section anchor if it has one." });
    const proposed = await proposeSubmissionRequirement({
      organizationId,
      programKey: value(scope, "#sqP") || null,
      channel: value(scope, "#sqC"),
      kind: value(scope, "#sqK"),
      label,
      sourceUrl,
      sourceSection: value(scope, "#sqS") || null,
      formNumber: value(scope, "#sqF") || null,
      formModifiedOn: value(scope, "#sqM") || null,
      checkedOn: value(scope, "#sqD"),
      currentTo: value(scope, "#sqT") || null,
    });
    result = proposed;
    if (proposed && "snapshot" in proposed && !proposed.snapshot) {
      note = `${proposed.reason ?? "The page couldn’t be fetched."} It is kept for review. A licensed consultant approves it only after opening the official page themselves.`;
    }
  } else if (act === "review") {
    result = await reviewSubmissionRequirement({ organizationId, requirementId: data.id ?? "", version: Number(data.version), decision: "approved", note: null });
  } else if (act === "attest") {
    const attested = readAttestationFrom(scope);
    if (!attested || "error" in attested) return void toast2(attested?.error ?? "Tick that you opened the official page yourself", { kind: "warn", sub: "Nothing was saved." });
    result = await reviewSubmissionRequirement({ organizationId, requirementId: data.id ?? "", version: Number(data.version), decision: "approved", note: null, pageOpenedOn: attested.openedOn });
  } else if (act === "reject") {
    const why = value(scope, "#sjN");
    if (why.length < 3) return void toast2("Say why", { kind: "warn", sub: "Kept with the entry." });
    result = await reviewSubmissionRequirement({ organizationId, requirementId: data.id ?? "", version: Number(data.version), decision: "rejected", note: why });
  } else if (act === "retire") {
    const why = value(scope, "#srtN");
    if (why.length < 3) return void toast2("Say why", { kind: "warn", sub: "Kept with the entry." });
    result = await retireSubmissionRequirement({ organizationId, requirementId: data.id ?? "", version: Number(data.version), reason: why });
  } else {
    return;
  }

  const error = result && "error" in result && typeof result.error === "string" ? result.error : null;
  if (error) {
    if (needsStepUp(error)) {
      window.location.assign(stepUpLocation(window.location.pathname, window.location.search, null));
      return;
    }
    toast2(error, { kind: "bad", sub: "Nothing was saved." });
    return;
  }
  dialog?.close();
  const [title, sub] = DONE[act] ?? ["Saved", "Recorded in the matter’s history."];
  toast2(title, { kind: note ? "warn" : "ok", sub: note ?? sub });
  const here = `${window.location.pathname}${window.location.search}`;
  const clean = withoutDialog(window.location.pathname, window.location.search);
  if (clean !== here) router.replace(clean);
  router.refresh();
}
