"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { claimUrlProblem } from "@/modules/content-governance/claim-capture";
import { captureClaimPage } from "@/modules/content-governance/claim-page";
import { mayStoreServerCapture, NOT_FETCHED, storeServerCapture } from "@/modules/content-governance/server-capture";
import { officialClaimError } from "@/modules/sheet/official-claims-present";
import { claimError } from "@/modules/sheet/source-claims-present";

/**
 * SRC-01 / SRC-02 / SRC-03 actions for Templates > Source review, and the live official claims'
 * firm edits (#188, decisions 2026-10-25): Edit, Keep and Revert (public.edit_rule_claim) and
 * Unsuspend (public.unsuspend_rule_version), each needing a fresh step-up every time. Each calls a public.* wrapper as
 * the signed-in member (20261025400000_src_claims_review.sql); the database checks role, licence,
 * step-up and the review rules. A step-up refusal comes back as the shared step-up message so the
 * Sheet can send the person to /mfa?step=6 and back.
 */

type Ref = { organizationId: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase, userId: claims.claims.sub as string };
}

function refusal(message: string): string {
  if (/step-up|aal2|recovery code/i.test(message)) return safeAccessError(message);
  return claimError(message);
}

const text = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
};
const date = (value: string | null | undefined) => (value && DATE.test(value) ? value : null);

export type AddClaimInput = Ref & {
  program: string | null;
  claim: string;
  value: string | null;
  sourceUrl: string;
  section: string | null;
  excerpt: string | null;
  applicabilityNote: string | null;
  formNumber: string | null;
  formModifiedOn: string | null;
  publishedOn: string | null;
  modifiedOn: string | null;
  lastAmendedOn: string | null;
  currentTo: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  checkedOn: string;
};

/**
 * Adds a firm claim (Add claim, processing times included). Casevoya fetches the page on the server
 * and stores its SHA-256, retrieval time and the dates it prints (those replace any typed in). When
 * the fetch fails the claim is kept without a capture and its approval needs the reviewer's
 * attestation. A firm claim keeps licensed approval with a step-up (decision 2026-10-25 4:48 PM).
 * Captured official claims aren't offered here: the loader loads them as live official claims
 * (scripts/ops/load-official-claims.mjs).
 */
export async function addRuleClaim(input: AddClaimInput) {
  const url = (input.sourceUrl ?? "").trim();
  const problem = claimUrlProblem(url, text(input.section));
  if (problem) return { error: problem };
  if (!date(input.checkedOn)) return { error: claimError("date checked") };
  if ((text(input.claim)?.length ?? 0) < 3) return { error: claimError("write the claim") };
  const program = text(input.program)?.toLowerCase() ?? null;
  if (program && !/^[a-z0-9_]{1,80}$/.test(program)) return { error: "Choose the program." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };

  // The firm membership is checked before any outbound fetch.
  const fetched = (await mayStoreServerCapture(s.supabase, input.organizationId, s.userId)) ? await captureClaimPage(url, fetch) : NOT_FETCHED;
  // The fetched page is stored by the server (service role); the claim names that capture. The
  // database doesn't treat a hash sent with the claim as a capture.
  const stored = fetched.snapshot
    ? await storeServerCapture({
        organizationId: input.organizationId,
        actorUserId: s.userId,
        sourceUrl: url,
        title: text(input.section),
        page: fetched.snapshot,
        dates: { modifiedOn: fetched.dates.modifiedOn ?? fetched.dates.lastAmendedOn, currentTo: fetched.dates.currentTo },
      })
    : null;
  const snapshot = stored;
  const dates = fetched.snapshot ? fetched.dates : { modifiedOn: date(input.modifiedOn), lastAmendedOn: date(input.lastAmendedOn), currentTo: date(input.currentTo) };
  const via: "live" | null = stored ? "live" : null;
  const reason = fetched.snapshot ? (stored ? null : "The page capture couldn’t be stored.") : fetched.reason;

  const { data, error } = await s.supabase.rpc("add_rule_claim", {
    p_org: input.organizationId,
    p_stable_key: null as unknown as string,
    p_jurisdiction: "CA",
    p_program_key: program as string,
    p_claim: (text(input.claim) as string),
    p_value: text(input.value) as string,
    p_source_url: url,
    p_source_section: text(input.section) as string,
    p_excerpt: text(input.excerpt) as string,
    p_applicability_note: text(input.applicabilityNote) as string,
    p_form_number: text(input.formNumber) as string,
    p_form_modified_on: date(input.formModifiedOn) as string,
    p_published_on: date(input.publishedOn) as string,
    p_modified_on: dates.modifiedOn as string,
    p_last_amended_on: dates.lastAmendedOn as string,
    p_current_to: dates.currentTo as string,
    p_effective_from: date(input.effectiveFrom) as string,
    p_effective_to: date(input.effectiveTo) as string,
    p_checked_on: input.checkedOn,
    p_snapshot: snapshot as unknown as never,
  });
  if (error) return { error: refusal(error.message) };
  return { id: data as string, captured: via, reason };
}

export async function resolveRuleApplicability(input: Ref & { versionId: string; version: number; resolution: string; note: string }) {
  if (!isUuid(input.versionId)) return { error: "Choose the claim." };
  if (!["applies", "does_not_apply", "partly"].includes(input.resolution)) return { error: claimError("choose applies") };
  if ((text(input.note)?.length ?? 0) < 3) return { error: claimError("say who and what") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("resolve_rule_applicability", {
    p_version_id: input.versionId,
    p_expected_version: input.version,
    p_resolution: input.resolution,
    p_note: text(input.note) as string,
  });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}

export async function reviewRuleVersion(
  input: Ref & { versionId: string; version: number; decision: string; note: string | null; nextReviewOn: string | null; pageOpenedOn?: string | null },
) {
  if (!isUuid(input.versionId)) return { error: "Choose the claim." };
  if (input.decision !== "approved" && input.decision !== "rejected") return { error: "Choose approve or reject." };
  if (input.decision === "rejected" && (text(input.note)?.length ?? 0) < 3) return { error: claimError("say why") };
  if (input.decision === "approved" && !date(input.nextReviewOn)) return { error: claimError("next review date") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("review_rule_version", {
    p_version_id: input.versionId,
    p_expected_version: input.version,
    p_decision: input.decision,
    p_note: text(input.note) as string,
    p_next_review_on: (input.decision === "approved" ? date(input.nextReviewOn) : null) as string,
    p_page_opened_on: (input.decision === "approved" ? date(input.pageOpenedOn) : null) as string,
  });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}

export async function suspendRuleVersion(input: Ref & { versionId: string; version: number; reason: string }) {
  if (!isUuid(input.versionId)) return { error: "Choose the claim." };
  if ((text(input.reason)?.length ?? 0) < 3) return { error: claimError("say why") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("suspend_rule_version", {
    p_version_id: input.versionId,
    p_expected_version: input.version,
    p_reason: text(input.reason) as string,
  });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}

/** A refusal of an edit or unsuspend: a missing or used step-up as the shared step-up message, else the Sheet's words. */
function changeRefusal(message: string): string {
  if (/step-up|aal2|recovery code/i.test(message)) return safeAccessError("step-up is required");
  return officialClaimError(message);
}

/**
 * Edit (or Keep after a source change) or Revert a live official claim, for the signed-in member's
 * firm only. The database checks the licence, a fresh step-up (each used once) and that the
 * official version is still the one the member saw.
 */
export async function editRuleClaim(
  input: Ref & { definitionId: string; baseVersionId: string; action: "edit" | "revert"; text: string | null; value: string | null; reason: string },
) {
  if (!isUuid(input.definitionId) || !isUuid(input.baseVersionId)) return { error: "Choose the claim." };
  if (input.action !== "edit" && input.action !== "revert") return { error: "Choose edit or revert." };
  if ((text(input.reason)?.length ?? 0) < 3) return { error: officialClaimError("say why") };
  if (input.action === "edit" && (text(input.text)?.length ?? 0) < 3) return { error: officialClaimError("write the firm's wording") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("edit_rule_claim", {
    p_definition_id: input.definitionId,
    p_expected_base_version_id: input.baseVersionId,
    p_text: (input.action === "edit" ? text(input.text) : null) as string,
    p_value: (input.action === "edit" ? text(input.value) : null) as string,
    p_reason: text(input.reason) as string,
    p_action: input.action,
  });
  if (error) return { error: changeRefusal(error.message) };
  return { id: data as string };
}

/** Unsuspend a firm's suspended claim version: a licensed member, a fresh step-up and a reason; audited. */
export async function unsuspendRuleVersion(input: Ref & { versionId: string; version: number; reason: string }) {
  if (!isUuid(input.versionId)) return { error: "Choose the claim." };
  if ((text(input.reason)?.length ?? 0) < 3) return { error: claimError("say why") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("unsuspend_rule_version", {
    p_version_id: input.versionId,
    p_expected_version: input.version,
    p_reason: text(input.reason) as string,
  });
  if (error) return { error: changeRefusal(error.message) };
  return { ok: true };
}
