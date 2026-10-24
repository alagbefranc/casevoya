"use client";

import { toast2 } from "@/components/port/kit";
import { shareWithClient } from "@/modules/government/actions";
import { readAttestationFrom } from "@/modules/government/page-attestation";
import { enterEstimate, markChecked, reviewEstimate } from "@/modules/government/status-actions";
import { needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";

/**
 * GOV-05 controls on the Government status page (`data-govs`): Mark checked, Share with client
 * (from its preview dialog), Add IRCC estimate and Review estimate. The database decides every
 * change; a step-up refusal sends the person to /mfa?step=6 and back to this page.
 */
type Router = { refresh: () => void };
type Result = { error?: string } | Record<string, unknown> | null | undefined;

function value(root: ParentNode, selector: string): string {
  return (root.querySelector<HTMLInputElement>(selector)?.value ?? "").trim();
}

const DONE: Record<string, [string, string]> = {
  check: ["Marked checked", "Last checked now shows this check. Nothing about the status changed."],
  share: ["Shared with the client", "It’s on their portal Home, recorded by the firm."],
  estimate: ["Sent for review", "A licensed member reviews IRCC’s estimate before it shows."],
  approved: ["Estimate approved", "It shows next to the status as IRCC’s estimate."],
  rejected: ["Estimate rejected", "It won’t show. The note is kept with it."],
};

export function bindGovStatusControls(root: HTMLElement, router: Router, listen: { signal: AbortSignal }) {
  root.addEventListener(
    "click",
    (event) => {
      const control = (event.target as HTMLElement).closest<HTMLElement>("[data-govs]");
      if (!control || !root.contains(control)) return;
      event.preventDefault();
      event.stopPropagation();
      if (control.getAttribute("aria-busy") === "true") return;
      control.setAttribute("aria-busy", "true");
      void runGovStatusAct(control, router).finally(() => control.removeAttribute("aria-busy"));
    },
    { capture: true, signal: listen.signal },
  );
}

export async function runGovStatusAct(button: HTMLElement, router: Router) {
  const act = button.dataset.govs ?? "";
  const data = button.dataset;
  const organizationId = data.org ?? "";
  const matterId = data.matter ?? "";
  const dialog = button.closest("dialog");
  const scope: ParentNode = dialog ?? document;
  let result: Result;
  let done = act;

  if (act === "check") {
    result = await markChecked({ organizationId, matterId, correspondenceId: data.id ?? null });
  } else if (act === "share") {
    result = await shareWithClient({ organizationId, kind: "correspondence", id: data.id ?? "" });
  } else if (act === "estimate") {
    result = await enterEstimate({
      organizationId,
      matterId,
      sourceUrl: value(scope, "#geU"),
      applicationType: value(scope, "#geT"),
      estimate: value(scope, "#geV"),
      checkedOn: value(scope, "#geD"),
    });
  } else if (act === "estimate-review") {
    done = data.decision ?? "";
    // No page capture: approving reads the reviewer's attestation from the dialog.
    const attested = done === "approved" ? readAttestationFrom(scope) : null;
    if (attested && "error" in attested) return void toast2(attested.error, { kind: "warn", sub: "Nothing was saved." });
    result = await reviewEstimate({
      organizationId,
      estimateId: data.id ?? "",
      version: Number(data.version),
      decision: done,
      note: value(scope, "#gerN") || null,
      pageOpenedOn: attested?.openedOn ?? null,
    });
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
  const [title, sub] = DONE[done] ?? ["Saved", "Recorded in the matter’s history."];
  const captured = act === "estimate" && result && "captured" in result ? result.captured : null;
  toast2(title, { kind: "ok", sub: captured === false ? `${sub} IRCC’s page couldn’t be reached from Casevoya, so no page fingerprint was kept.` : sub });
  router.refresh();
}
