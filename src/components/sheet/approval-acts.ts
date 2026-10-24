"use client";

import { toast2 } from "@/components/port/kit";
import {
  approveConditionsSummary,
  proposeFollowUpStep,
  recordDecisionDelivery,
  recordDeliveryAcknowledgement,
  retireFollowUpStep,
  reviewFollowUpStep,
  saveConditionsSummary,
  tickFollowUpStep,
} from "@/modules/decisions/actions";
import { submittedInstant } from "@/modules/government/present";
import { needsStepUp, stepUpLocation, withoutDialog } from "@/modules/sheet/matter-wire";

/**
 * The Decisions tab's approval follow-up acts (DEC-02): `data-dec` controls on the follow-up
 * checklist, conditions summary and delivery record, and their dialogs. The database decides every
 * change; a step-up refusal sends the person to /mfa?step=6 and back. Clicks are taken in the
 * capture phase so a step's `.ck` box changes only when the database has stored it (the page
 * refreshes with the stored state). Closure tasks keep the existing `data-gov="task-done"` act.
 */
type Router = { replace: (href: string) => void; refresh: () => void };
type Result = { error?: string } | Record<string, unknown> | null | undefined;

function value(root: ParentNode, selector: string): string {
  return (root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)?.value ?? "").trim();
}

const DONE: Record<string, [string, string]> = {
  tick: ["Saved", "Kept on the matter with your name and the time."],
  propose: ["Sent for review", "A licensed consultant approves it before it reaches a checklist."],
  review: ["Approved", "It now shows on follow-up checklists for its program."],
  reject: ["Rejected", "It won’t reach any checklist."],
  retire: ["Retired", "It no longer shows on new checklists."],
  "draft-summary": ["Draft saved", "A licensed consultant approves it before the client sees it."],
  "revise-summary": ["Draft saved", "A licensed consultant approves it before the client sees it."],
  "approve-summary": ["Summary approved", "The client now sees it in the portal, as the firm’s summary."],
  deliver: ["Delivery recorded", "The client sees it in the portal and can confirm they received it."],
  ack: ["Acknowledgement recorded", "Kept with the delivery, with your evidence."],
};

/** One dialog serves every row: it takes the clicked row's id and version. */
const SHARED: Record<string, [string, string]> = {
  "reject-open": ["#dDecRej", "reject"],
  "retire-open": ["#dDecRet", "retire"],
  "ack-open": ["#dDecAck", "ack"],
};

export function bindApprovalControls(root: HTMLElement, router: Router, listen: { signal: AbortSignal }) {
  root.addEventListener(
    "click",
    (event) => {
      const control = (event.target as HTMLElement).closest<HTMLElement>("[data-dec]");
      if (!control || !root.contains(control)) return;
      event.preventDefault();
      event.stopPropagation();
      if (control.getAttribute("aria-busy") === "true") return;
      const shared = SHARED[control.dataset.dec ?? ""];
      if (shared) {
        const confirm = root.querySelector<HTMLElement>(`${shared[0]} [data-dec="${shared[1]}"]`);
        const dialog = root.querySelector<HTMLDialogElement>(shared[0]);
        if (!confirm || !dialog) return;
        confirm.dataset.id = control.dataset.id ?? "";
        confirm.dataset.version = control.dataset.version ?? "";
        dialog.showModal();
        return;
      }
      control.setAttribute("aria-busy", "true");
      void runApprovalAct(control, root, router).finally(() => control.removeAttribute("aria-busy"));
    },
    { capture: true, signal: listen.signal },
  );
}

export async function runApprovalAct(control: HTMLElement, root: HTMLElement, router: Router) {
  const act = control.dataset.dec ?? "";
  const data = control.dataset;
  const organizationId = data.org ?? "";
  const matterId = data.matter ?? "";
  const dialog = control.closest("dialog");
  const scope: ParentNode = dialog ?? root;
  const version = Number(data.version);
  let result: Result;
  let note: string | null = null;

  if (act === "tick") {
    result = await tickFollowUpStep({ organizationId, matterId, stepId: data.step ?? "", ticked: data.ticked === "true" });
  } else if (act === "propose") {
    const label = value(scope, "#dsL");
    const sourceUrl = value(scope, "#dsU");
    if (label.length < 3) return void toast2("Write the step", { kind: "warn", sub: "Word for word, as the official page gives it." });
    if (!sourceUrl) return void toast2("Add the official page link", { kind: "warn", sub: "canada.ca or a gc.ca site, with the section anchor if it has one." });
    const proposed = await proposeFollowUpStep({
      organizationId,
      programKey: value(scope, "#dsP"),
      label,
      timing: value(scope, "#dsW") || null,
      sourceUrl,
      sourceSection: value(scope, "#dsS") || null,
      formNumber: value(scope, "#dsF") || null,
      formModifiedOn: value(scope, "#dsM") || null,
      checkedOn: value(scope, "#dsD"),
      currentTo: value(scope, "#dsT") || null,
    });
    result = proposed;
    if (proposed && "snapshot" in proposed && !proposed.snapshot) {
      note = `${proposed.reason ?? "The page couldn’t be fetched."} It is kept for review, but it can’t be approved without a snapshot of the page.`;
    }
  } else if (act === "review") {
    result = await reviewFollowUpStep({ organizationId, stepId: data.id ?? "", version, decision: "approved", note: null });
  } else if (act === "reject") {
    const why = value(scope, "#djN");
    if (why.length < 3) return void toast2("Say why", { kind: "warn", sub: "Kept with the step." });
    result = await reviewFollowUpStep({ organizationId, stepId: data.id ?? "", version, decision: "rejected", note: why });
  } else if (act === "retire") {
    const why = value(scope, "#dtN");
    if (why.length < 3) return void toast2("Say why", { kind: "warn", sub: "Kept with the step." });
    result = await retireFollowUpStep({ organizationId, stepId: data.id ?? "", version, reason: why });
  } else if (act === "draft-summary" || act === "revise-summary") {
    const body = value(scope, "#dmB");
    if (body.length < 20) return void toast2("Write the summary", { kind: "warn", sub: "At least 20 characters, in plain words." });
    result = await saveConditionsSummary({ organizationId, matterId, summaryId: act === "revise-summary" ? (data.id ?? null) : null, version: act === "revise-summary" ? version : null, body });
  } else if (act === "approve-summary") {
    result = await approveConditionsSummary({ organizationId, summaryId: data.id ?? "", version });
  } else if (act === "deliver") {
    const at = scope.querySelector<HTMLInputElement>("#ddT");
    const deliveredAt = submittedInstant(value(scope, "#ddT"), at?.dataset.tz);
    if (!deliveredAt) return void toast2("Add when it was delivered", { kind: "warn", sub: "It can’t be in the future." });
    result = await recordDecisionDelivery({
      organizationId,
      matterId,
      documentVersionId: value(scope, "#ddV"),
      method: value(scope, "#ddM"),
      deliveredAt,
      note: value(scope, "#ddN") || null,
    });
  } else if (act === "ack") {
    const evidenceVersionId = value(scope, "#daV") || null;
    const evidenceNote = value(scope, "#daN") || null;
    if (!evidenceVersionId && !evidenceNote) return void toast2("Add the evidence", { kind: "warn", sub: "A file on the matter, or a note of what shows it." });
    result = await recordDeliveryAcknowledgement({ organizationId, deliveryId: data.id ?? "", version, acknowledgedOn: value(scope, "#daD"), evidenceVersionId, evidenceNote });
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
