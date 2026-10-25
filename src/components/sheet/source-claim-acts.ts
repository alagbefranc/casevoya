"use client";

import { toast2 } from "@/components/port/kit";
import { addRuleClaim, resolveRuleApplicability, reviewRuleVersion, suspendRuleVersion } from "@/modules/content-governance/claim-actions";
import { readAttestationFrom } from "@/modules/government/page-attestation";
import { needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";

/**
 * SRC-01/02/03 act handlers for Templates > Source review and Rule detail: Add claim, Resolve
 * applicability, Approve and publish, Reject, Suspend. Each calls a server action; the database
 * decides who may do what. A step-up refusal on Approve sends the reviewer to the step-up page and
 * back to the same claim.
 */

type Router = { refresh: () => void; replace: (href: string) => void };

function value(scope: ParentNode, selector: string): string {
  return scope.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)?.value.trim() ?? "";
}

function set(scope: ParentNode, selector: string, next: string) {
  const field = scope.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (field) field.value = next;
}

/** Add claim: choosing captured content fills the dialog from it (staff can still edit it). */
export function mountClaimInputs(root: HTMLElement, signal: AbortSignal) {
  root.addEventListener(
    "change",
    (event) => {
      const target = event.target as HTMLElement;
      if (target.id !== "clK") return;
      const dialog = target.closest("dialog") ?? root;
      const option = (target as HTMLSelectElement).selectedOptions[0];
      const note = dialog.querySelector<HTMLElement>("#clNote");
      if (!option?.value) {
        if (note) note.hidden = true;
        return;
      }
      set(dialog, "#clC", option.dataset.claim ?? "");
      set(dialog, "#clV", option.dataset.value ?? "");
      set(dialog, "#clP", option.dataset.program ?? "");
      set(dialog, "#clU", option.dataset.url ?? "");
      set(dialog, "#clS", option.dataset.section ?? "");
      set(dialog, "#clX", option.dataset.excerpt ?? "");
      if (note) {
        note.textContent = option.dataset.note ?? "";
        note.hidden = false;
      }
    },
    { signal },
  );
}

const DONE: Record<string, [string, string]> = {
  resolve: ["Applicability resolved", "A licensed reviewer can approve it now."],
  approve: ["Approved and published", "This version is locked and live for its program."],
  reject: ["Version rejected", "The reason is kept with it."],
  suspend: ["Version suspended", "It is no longer live."],
};

export async function runClaimAct(button: HTMLElement, root: HTMLElement, router: Router) {
  const act = button.dataset.claimAct ?? "";
  const dialog = button.closest("dialog");
  const scope: ParentNode = dialog ?? root;
  const organizationId = button.dataset.org ?? "";
  const versionId = button.dataset.id ?? "";
  const version = Number(button.dataset.v ?? "0");
  let result: { error?: string } | Record<string, unknown> | undefined;
  let note: string | null = null;

  if (act === "add") {
    const claim = value(scope, "#clC");
    const sourceUrl = value(scope, "#clU");
    if (claim.length < 3) return void toast2("Write the claim", { kind: "warn", sub: "In the official page’s words." });
    if (!sourceUrl) return void toast2("Add the official page link", { kind: "warn", sub: "The exact page with its section anchor, never a homepage." });
    const added = await addRuleClaim({
      organizationId,
      capturedKey: value(scope, "#clK") || null,
      program: value(scope, "#clP") || null,
      claim,
      value: value(scope, "#clV") || null,
      sourceUrl,
      section: value(scope, "#clS") || null,
      excerpt: value(scope, "#clX") || null,
      applicabilityNote: value(scope, "#clA") || null,
      formNumber: value(scope, "#clF") || null,
      formModifiedOn: value(scope, "#clFm") || null,
      publishedOn: value(scope, "#clDp") || null,
      modifiedOn: value(scope, "#clDm") || null,
      lastAmendedOn: value(scope, "#clDa") || null,
      currentTo: value(scope, "#clDc") || null,
      effectiveFrom: value(scope, "#clDe") || null,
      effectiveTo: value(scope, "#clDt") || null,
      checkedOn: value(scope, "#clD"),
    });
    result = added;
    if ("id" in added) {
      note =
        added.captured === "live"
          ? "Casevoya captured the page now: its SHA-256, the time and the dates it prints are stored."
          : added.captured === "captured"
            ? `${added.reason ?? "The page couldn’t be fetched now."} Casevoya’s earlier capture of this page is stored with its SHA-256 and time.`
            : `${added.reason ?? "The page couldn’t be fetched."} It is kept for review; the approving reviewer must open the page and attest it matches.`;
      dialog?.close();
      toast2("Claim saved as a draft", { kind: added.captured ? "ok" : "warn", sub: note });
      router.replace(`/sheet/templates?tab=rule&view=${added.id}`);
      router.refresh();
      return;
    }
  } else if (act === "resolve") {
    result = await resolveRuleApplicability({ organizationId, versionId, version, resolution: value(scope, "#crR"), note: value(scope, "#crN") });
  } else if (act === "approve") {
    const attested = readAttestationFrom(scope);
    if (attested && "error" in attested) return void toast2(attested.error, { kind: "warn", sub: "Nothing was approved." });
    result = await reviewRuleVersion({
      organizationId,
      versionId,
      version,
      decision: "approved",
      note: value(scope, "#caN") || null,
      nextReviewOn: value(scope, "#caD") || null,
      pageOpenedOn: attested ? attested.openedOn : null,
    });
  } else if (act === "reject") {
    const why = value(scope, "#cjN");
    if (why.length < 3) return void toast2("Say why", { kind: "warn", sub: "Kept with the version." });
    result = await reviewRuleVersion({ organizationId, versionId, version, decision: "rejected", note: why, nextReviewOn: null });
  } else if (act === "suspend") {
    const why = value(scope, "#csN");
    if (why.length < 3) return void toast2("Say why", { kind: "warn", sub: "Kept with the version." });
    result = await suspendRuleVersion({ organizationId, versionId, version, reason: why });
  } else {
    return;
  }

  const error = result && "error" in result && typeof result.error === "string" ? result.error : null;
  if (error) {
    if (needsStepUp(error)) {
      window.location.assign(stepUpLocation(window.location.pathname, window.location.search, null, "rule_approve"));
      return;
    }
    toast2(error, { kind: "bad", sub: act === "add" ? "Nothing was saved. What you typed is still in the dialog." : "Nothing changed." });
    return;
  }
  dialog?.close();
  const [title, sub] = DONE[act] ?? ["Saved", ""];
  toast2(title, { kind: "ok", sub });
  router.refresh();
}
