"use client";

import { goStepUp } from "@/lib/auth/step-up-resume";
import { toast2 } from "@/components/port/kit";
import { stepUpHref, type StepUpActionKey } from "@/lib/auth/mfa-step";
import {
  addRuleClaim,
  editRuleClaim,
  resolveRuleApplicability,
  reviewRuleVersion,
  suspendRuleVersion,
  unsuspendRuleVersion,
} from "@/modules/content-governance/claim-actions";
import { readAttestationFrom } from "@/modules/government/page-attestation";
import { needsStepUp, stepUpLocation } from "@/modules/sheet/matter-wire";

/**
 * Act handlers for Templates > Source review and Rule detail. Firm claims (SRC-01/02/03): Add
 * claim, Resolve applicability, Approve and publish, Reject, Suspend, Unsuspend. Live official
 * claims (#188, decisions 2026-10-25): Edit, Keep my edit, Revert to official. Each calls a server
 * action; the database decides who may do what. A step-up refusal sends the member to the step-up
 * page and back to the same claim with the dialog open again and what they typed (edits and
 * unsuspend need a fresh step-up every time).
 */

type Router = { refresh: () => void; replace: (href: string) => void };

const DRAFT = "cv-claim-change";

function value(scope: ParentNode, selector: string): string {
  return scope.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)?.value.trim() ?? "";
}

/** Every named field of a dialog. */
function fieldsOf(dialog: ParentNode): Record<string, string> {
  const fields: Record<string, string> = {};
  dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[name], textarea[name]").forEach((input) => {
    fields[input.name] = input.value;
  });
  return fields;
}

/** To the step-up page, coming back to this claim with the dialog open and what was typed. */
function stepUp(dialog: HTMLDialogElement | null, action: StepUpActionKey) {
  if (!dialog) {
    goStepUp(stepUpLocation(window.location.pathname, window.location.search, null, action));
    return;
  }
  try {
    sessionStorage.setItem(DRAFT, JSON.stringify({ dialog: dialog.id, fields: fieldsOf(dialog) }));
  } catch {
    // Storage can be unavailable; the member types it again.
  }
  const params = new URLSearchParams(window.location.search);
  params.set("dlg", dialog.id);
  toast2("Confirm it’s you", { kind: "warn", sub: "Each change to a claim needs a fresh step-up. The dialog opens again with what you typed." });
  window.setTimeout(() => goStepUp(stepUpHref(`${window.location.pathname}?${params.toString()}`, action)), 900);
}

/** Back from step-up, or a link with `?dlg=`: reopen that claim dialog with what was typed. */
export function reopenClaimDialog(root: ParentNode, open: (id: string) => void) {
  const id = new URLSearchParams(window.location.search).get("dlg");
  if (!id || !/^dlgClaim[A-Za-z]+$/.test(id)) return;
  const dialog = root.querySelector<HTMLDialogElement>(`dialog#${CSS.escape(id)}`);
  if (!dialog?.querySelector("[data-claim-act]")) return;
  let fields: Record<string, unknown> = {};
  try {
    const raw = sessionStorage.getItem(DRAFT);
    sessionStorage.removeItem(DRAFT);
    const parsed = raw ? (JSON.parse(raw) as { dialog?: unknown; fields?: Record<string, unknown> }) : null;
    if (parsed?.dialog === id && parsed.fields && typeof parsed.fields === "object") fields = parsed.fields;
  } catch {
    fields = {};
  }
  dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[name], textarea[name]").forEach((input) => {
    const saved = fields[input.name];
    if (typeof saved === "string") input.value = saved;
  });
  open(id);
}

const DONE: Record<string, [string, string]> = {
  resolve: ["Applicability resolved", "A licensed reviewer can approve it now."],
  approve: ["Approved and published", "This version is locked and live for its program."],
  reject: ["Version rejected", "The reason is kept with it."],
  suspend: ["Version suspended", "It is no longer live."],
  unsuspend: ["Version unsuspended", "It is live again. Who did it and why are kept with it."],
  edit: ["Your firm’s wording is saved", "Only your firm sees it, stamped with your name, licence and today’s date."],
  keep: ["Your edit is kept", "Stamped again against the new official version."],
  revert: ["Reverted to the official text", "Your edit stays in History."],
};

const STEP_UP: Record<string, StepUpActionKey> = {
  approve: "rule_approve",
  unsuspend: "rule_unsuspend",
  edit: "claim_edit",
  keep: "claim_edit",
  revert: "claim_edit",
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
          : `${added.reason ?? "The page couldn’t be fetched."} It is kept for review; the approving reviewer must open the page and attest it matches.`;
      dialog?.close();
      toast2("Claim saved for licensed review", { kind: added.captured ? "ok" : "warn", sub: note });
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
  } else if (act === "unsuspend") {
    const why = value(scope, "#cuN");
    if (why.length < 3) return void toast2("Say why", { kind: "warn", sub: "Kept with the version." });
    result = await unsuspendRuleVersion({ organizationId, versionId, version, reason: why });
  } else if (act === "edit" || act === "keep" || act === "revert") {
    const definitionId = button.dataset.def ?? "";
    const baseVersionId = button.dataset.base ?? "";
    const why = value(scope, act === "edit" ? "#ceR" : act === "keep" ? "#ckR" : "#crvR");
    if (why.length < 3) return void toast2("Say why", { kind: "warn", sub: "Kept with the edit in History." });
    const wording = act === "edit" ? value(scope, "#ceT") : act === "keep" ? (button.dataset.text ?? "") : null;
    if (act !== "revert" && (wording ?? "").length < 3) return void toast2("Write your firm’s wording", { kind: "warn", sub: "3 to 2,000 characters." });
    result = await editRuleClaim({
      organizationId,
      definitionId,
      baseVersionId,
      action: act === "revert" ? "revert" : "edit",
      text: wording,
      value: act === "edit" ? value(scope, "#ceV") || null : act === "keep" ? button.dataset.value || null : null,
      reason: why,
    });
  } else {
    return;
  }

  const error = result && "error" in result && typeof result.error === "string" ? result.error : null;
  if (error) {
    if (needsStepUp(error) && STEP_UP[act]) {
      stepUp(act === "approve" ? null : dialog, STEP_UP[act]);
      return;
    }
    toast2(error, { kind: "bad", sub: act === "add" || act === "edit" ? "Nothing was saved. What you typed is still in the dialog." : "Nothing changed." });
    return;
  }
  dialog?.close();
  const [title, sub] = DONE[act] ?? ["Saved", ""];
  toast2(title, { kind: "ok", sub });
  const params = new URLSearchParams(window.location.search);
  if (params.has("dlg")) {
    params.delete("dlg");
    router.replace(`${window.location.pathname}?${params.toString()}`);
  }
  router.refresh();
}
