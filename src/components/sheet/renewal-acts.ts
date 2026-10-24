"use client";

import { toast2 } from "@/components/port/kit";
import { readAttestationFrom } from "@/modules/government/page-attestation";
import { needsStepUp, stepUpLocation, withoutDialog } from "@/modules/sheet/matter-wire";
import {
  cancelRenewal,
  proposeRenewalTiming,
  recordIssuedExpiry,
  retireRenewalTiming,
  reviewRenewalTiming,
  setRenewalReminder,
} from "@/modules/renewals/actions";

/**
 * DEC-02: the Decisions tab's Expiry and renewal acts (`data-ren` controls on its card and
 * dialogs). The database decides every change, including whether the client's contact choices
 * allow a renewal reminder; its refusal is shown as it says it. A step-up refusal sends the
 * person to /mfa?step=6 and back.
 */
type Router = { replace: (href: string) => void; refresh: () => void };
type Result = { error?: string } | Record<string, unknown> | null | undefined;

function value(root: ParentNode, selector: string): string {
  return (root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)?.value ?? "").trim();
}

const DONE: Record<string, [string, string]> = {
  expiry: ["Expiry recorded", "The reminder task is on the matter’s tasks."],
  set: ["Renewal reminder set", "The client sees it in the portal. A lead is in the Pipeline; nothing was billed."],
  cancel: ["Expiry cancelled", "Its open reminder task was cancelled."],
  timing: ["Sent for review", "A licensed consultant approves it before it sets any reminder."],
  approve: ["Approved", "It can now set reminder dates."],
  attest: ["Approved", "It shows with “page not captured by Casevoya, checked by you” and the date."],
  reject: ["Rejected", "It won’t set any reminder."],
  retire: ["Retired", "It no longer sets new reminder dates."],
};

/** The row's button carries its id and version to the one dialog that serves every row. */
const OPENERS: Record<string, [string, string]> = {
  "set-open": ["#dRenSet", "set"],
  "cancel-open": ["#dRenCan", "cancel"],
  "reject-open": ["#dRenRej", "reject"],
  "retire-open": ["#dRenRet", "retire"],
  "attest-open": ["#dRenAtt", "attest"],
};

export function bindRenewalControls(root: HTMLElement, router: Router, listen: { signal: AbortSignal }) {
  root.addEventListener(
    "click",
    (event) => {
      const control = (event.target as HTMLElement).closest<HTMLElement>("[data-ren]");
      if (!control || !root.contains(control)) return;
      event.preventDefault();
      event.stopPropagation();
      if (control.getAttribute("aria-busy") === "true") return;
      const opener = OPENERS[control.dataset.ren ?? ""];
      if (opener) {
        const confirm = root.querySelector<HTMLElement>(`${opener[0]} [data-ren="${opener[1]}"]`);
        const dialog = root.querySelector<HTMLDialogElement>(opener[0]);
        if (!confirm || !dialog) return;
        confirm.dataset.id = control.dataset.id ?? "";
        confirm.dataset.version = control.dataset.version ?? "";
        const tick = dialog.querySelector<HTMLInputElement>("input[data-attest]");
        if (tick) tick.checked = false;
        dialog.showModal();
        return;
      }
      control.setAttribute("aria-busy", "true");
      void runRenewalAct(control, root, router).finally(() => control.removeAttribute("aria-busy"));
    },
    { capture: true, signal: listen.signal },
  );
}

export async function runRenewalAct(control: HTMLElement, root: HTMLElement, router: Router) {
  const act = control.dataset.ren ?? "";
  const data = control.dataset;
  const organizationId = data.org ?? "";
  const dialog = control.closest("dialog");
  const scope: ParentNode = dialog ?? root;
  let result: Result;
  let note: string | null = null;

  if (act === "expiry") {
    const label = value(scope, "#reL");
    const expiresOn = value(scope, "#reE");
    const timingId = value(scope, "#reT");
    const remindOn = value(scope, "#reD");
    if (label.length < 2) return void toast2("Name the issued document", { kind: "warn", sub: "As it reads, for example the permit or card." });
    if (!expiresOn) return void toast2("Enter the expiry date", { kind: "warn", sub: "Exactly as it is shown on the issued document." });
    if (!timingId && !remindOn) return void toast2("Choose the reminder date", { kind: "warn", sub: "Without an IRCC timing it’s the firm’s choice. No date is set for you." });
    result = await recordIssuedExpiry({ organizationId, decisionId: data.id ?? "", label, expiresOn, versionId: value(scope, "#reV") || null, remindOn: remindOn || null, timingId: timingId || null });
  } else if (act === "set") {
    const scopeText = value(scope, "#rsS");
    if (scopeText.length < 10) return void toast2("State the scope of the new service", { kind: "warn", sub: "At least 10 characters. The client sees it with the reminder." });
    result = await setRenewalReminder({ organizationId, renewalId: data.id ?? "", version: Number(data.version), scope: scopeText, feeId: value(scope, "#rsF") || null });
  } else if (act === "cancel") {
    const why = value(scope, "#rcN");
    if (why.length < 3) return void toast2("Say why", { kind: "warn", sub: "Kept with the expiry." });
    result = await cancelRenewal({ organizationId, renewalId: data.id ?? "", version: Number(data.version), reason: why });
  } else if (act === "timing") {
    const appliesTo = value(scope, "#rtA");
    const timingText = value(scope, "#rtW");
    const sourceUrl = value(scope, "#rtU");
    if (appliesTo.length < 2) return void toast2("Name the document or status", { kind: "warn", sub: "As the official page names it." });
    if (timingText.length < 3) return void toast2("Write the timing", { kind: "warn", sub: "Word for word, as the official page gives it." });
    if (!sourceUrl) return void toast2("Add the official page link", { kind: "warn", sub: "canada.ca or a gc.ca site, with the section anchor if it has one." });
    const proposed = await proposeRenewalTiming({
      organizationId,
      programKey: value(scope, "#rtP") || null,
      appliesTo,
      timingText,
      leadDays: value(scope, "#rtN") || null,
      sourceUrl,
      sourceSection: value(scope, "#rtS") || null,
      formNumber: value(scope, "#rtF") || null,
      formModifiedOn: value(scope, "#rtM") || null,
      checkedOn: value(scope, "#rtD"),
      currentTo: value(scope, "#rtC") || null,
    });
    result = proposed;
    if (proposed && "snapshot" in proposed && !proposed.snapshot) {
      note = `${proposed.reason ?? "The page couldn’t be fetched."} It is kept for review. A licensed consultant approves it only after opening the official page themselves.`;
    }
  } else if (act === "approve") {
    result = await reviewRenewalTiming({ organizationId, timingId: data.id ?? "", version: Number(data.version), decision: "approved", note: null });
  } else if (act === "attest") {
    const attested = readAttestationFrom(scope);
    if (!attested || "error" in attested) return void toast2(attested?.error ?? "Tick that you opened the official page yourself", { kind: "warn", sub: "Nothing was saved." });
    result = await reviewRenewalTiming({ organizationId, timingId: data.id ?? "", version: Number(data.version), decision: "approved", note: null, pageOpenedOn: attested.openedOn });
  } else if (act === "reject") {
    const why = value(scope, "#rjN");
    if (why.length < 3) return void toast2("Say why", { kind: "warn", sub: "Kept with the entry." });
    result = await reviewRenewalTiming({ organizationId, timingId: data.id ?? "", version: Number(data.version), decision: "rejected", note: why });
  } else if (act === "retire") {
    const why = value(scope, "#rrN");
    if (why.length < 3) return void toast2("Say why", { kind: "warn", sub: "Kept with the entry." });
    result = await retireRenewalTiming({ organizationId, timingId: data.id ?? "", version: Number(data.version), reason: why });
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
