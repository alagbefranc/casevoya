"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import type { Json } from "@/types/database.types";

/**
 * INT-02 / SRC-11, SRC-08 and SRC-10. Each call acts as the signed-in member. The database
 * checks the licence, the fresh step-up and that every claim is already live. Nothing here
 * invents a rule, a fee or a date.
 */

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

function refusal(message: string): string {
  if (/step-up|aal2|recovery code/i.test(message)) return safeAccessError(message);
  if (/opened this review/i.test(message)) return "Only the firm that opened this review, or Casevoya, can close it.";
  if (/licence/i.test(message)) return "Your licence isn’t recorded, or the source owner’s isn’t. Add it in Settings.";
  if (/disagree/i.test(message)) return "A claim in this pack has two official sources that disagree. Resolve that review first.";
  if (/test case/i.test(message)) return "An executable rule in this pack has no test cases yet.";
  if (/live/i.test(message)) return "Every claim in the pack has to be live.";
  if (/program/i.test(message)) return "That claim is for a different program.";
  if (/jurisdiction/i.test(message)) return "That jurisdiction is not one this firm practises.";
  if (/change/i.test(message)) return "Write how the firm handles a change to these sources (at least a short note).";
  if (/effective|review date/i.test(message)) return "Give the effective date and a later review date. Don’t leave either blank.";
  return "That could not be saved.";
}

export async function publishReviewedProgramPack(input: {
  organizationId: string;
  programKey: string;
  jurisdiction: string;
  versionIds: string[];
  sourceOwnerId: string;
  effectiveFrom: string;
  nextReviewAt: string;
  changeResponse: string;
}): Promise<{ id: string } | { error: string }> {
  if (!input.versionIds.every(isUuid) || !isUuid(input.sourceOwnerId)) return { error: "Choose the live claims and a source owner." };
  const open = await session(input.organizationId);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { data, error } = await open.supabase.rpc("publish_reviewed_program_pack", {
    p_program_key: input.programKey.trim().toLowerCase(),
    p_jurisdiction: input.jurisdiction.trim().toUpperCase(),
    p_version_ids: input.versionIds,
    p_source_owner: input.sourceOwnerId,
    p_effective_from: input.effectiveFrom,
    p_next_review_at: input.nextReviewAt,
    p_change_response: input.changeResponse.trim(),
  });
  if (error) return { error: refusal(error.message) };
  return typeof data === "string" ? { id: data } : { error: "The pack was not published." };
}

export async function saveRuleTestCase(input: {
  organizationId: string;
  definitionId: string;
  kind: string;
  title: string;
  inputs: Record<string, string | boolean>;
  expected: string;
}): Promise<{ id: string } | { error: string }> {
  if (!isUuid(input.definitionId)) return { error: "Choose a rule." };
  const open = await session(input.organizationId);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { data, error } = await open.supabase.rpc("save_rule_test_case", {
    p_definition_id: input.definitionId,
    p_kind: input.kind,
    p_title: input.title.trim(),
    p_inputs: input.inputs as Json,
    p_expected: input.expected,
  });
  if (error) return { error: refusal(error.message) };
  return typeof data === "string" ? { id: data } : { error: "The test case was not saved." };
}

export async function recordSourceConflict(input: {
  organizationId: string;
  definitionId: string;
  leftEvidenceId: string;
  rightEvidenceId: string;
  reason: string;
}): Promise<{ id: string } | { error: string }> {
  if (![input.definitionId, input.leftEvidenceId, input.rightEvidenceId].every(isUuid)) return { error: "Choose two stored captures." };
  const open = await session(input.organizationId);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { data, error } = await open.supabase.rpc("record_source_conflict", {
    p_definition_id: input.definitionId,
    p_left_evidence: input.leftEvidenceId,
    p_right_evidence: input.rightEvidenceId,
    p_reason: input.reason.trim(),
  });
  if (error) return { error: refusal(error.message) };
  return typeof data === "string" ? { id: data } : { error: "The conflict was not recorded." };
}

export async function resolveSourceConflict(input: { organizationId: string; conflictId: string; note: string }): Promise<{ id: string } | { error: string }> {
  if (!isUuid(input.conflictId)) return { error: "That review is not open." };
  const open = await session(input.organizationId);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { data, error } = await open.supabase.rpc("resolve_source_conflict", { p_conflict_id: input.conflictId, p_note: input.note.trim() });
  if (error) return { error: refusal(error.message) };
  return typeof data === "string" ? { id: data } : { error: "The review was not closed." };
}
