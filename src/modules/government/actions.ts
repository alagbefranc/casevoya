"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { createUploadIntent } from "@/modules/documents/actions";
import { isUuid } from "@/lib/tenant/context";
import {
  CORRESPONDENCE_CHANNELS,
  CORRESPONDENCE_KINDS,
  DECISION_MILESTONES,
  governmentError,
  SUBMISSION_CHANNELS,
  WITHDRAWAL_STEPS,
  type CorrespondenceChannel,
  type CorrespondenceKind,
  type DecisionMilestone,
  type SubmissionChannel,
  type WithdrawalStep,
} from "@/modules/government/present";
import type { Database } from "@/types/database.types";

/**
 * Server actions for T036 to T039. Each one calls a public.* wrapper as the signed-in member;
 * the database checks role, consultant scope, step-up, licence, and version. A step-up refusal
 * comes back as the shared step-up message so the Sheet can send the person to /mfa?step=6.
 */
type Outcome = Database["public"]["Enums"]["matter_outcome"];
const OUTCOMES: readonly Outcome[] = ["approved", "refused", "withdrawn", "returned_or_incomplete", "abandoned", "other_verified"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

function refusal(message: string): string {
  if (/step-up|aal2|recovery code/i.test(message)) return safeAccessError(message);
  return governmentError(message);
}

const text = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
};
const date = (value: string | null | undefined) => (value && DATE.test(value) ? value : null);
const uuid = (value: string | null | undefined) => (value && isUuid(value) ? value : null);

type Ref = { organizationId: string };

export async function prepareHandoff(input: Ref & { matterId: string; packageLabel: string; packageSha256?: string | null; channel: string }) {
  if (!isUuid(input.matterId) || !SUBMISSION_CHANNELS.includes(input.channel as SubmissionChannel)) return { error: "Choose a matter and a channel." };
  if (!text(input.packageLabel)) return { error: "Name the package version." };
  const hash = text(input.packageSha256);
  if (hash && !/^[0-9a-f]{64}$/i.test(hash)) return { error: governmentError("package hash") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("prepare_submission_handoff", {
    p_matter_id: input.matterId,
    p_package_label: input.packageLabel.trim(),
    p_package_sha256: text(input.packageSha256)?.toLowerCase() ?? null,
    p_channel: input.channel as SubmissionChannel,
  });
  if (error) return { error: refusal(error.message) };
  return { id: data };
}

export async function signOffHandoff(input: Ref & { handoffId: string; version: number }) {
  if (!isUuid(input.handoffId)) return { error: "Choose the handoff." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("sign_off_submission_handoff", { p_handoff_id: input.handoffId, p_expected_version: input.version });
  if (error) return { error: refusal(error.message) };
  return { version: data };
}

export async function recordSubmission(
  input: Ref & {
    handoffId: string;
    version: number;
    reference: string;
    submittedAt: string;
    submittedBy: string;
    receiptVersionId?: string | null;
    receiptLocator?: string | null;
    acknowledgedOn?: string | null;
  },
) {
  if (!isUuid(input.handoffId) || !isUuid(input.submittedBy)) return { error: "Choose the handoff and who submitted it." };
  if (!text(input.reference)) return { error: "Add the submission reference." };
  const when = new Date(input.submittedAt);
  if (Number.isNaN(when.getTime())) return { error: "Add when it was submitted." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("record_submission", {
    p_handoff_id: input.handoffId,
    p_expected_version: input.version,
    p_external_reference: input.reference.trim(),
    p_submitted_at: when.toISOString(),
    p_submitted_by_membership_id: input.submittedBy,
    p_receipt_version_id: uuid(input.receiptVersionId),
    p_receipt_locator: text(input.receiptLocator),
    p_acknowledged_on: date(input.acknowledgedOn),
  });
  if (error) return { error: refusal(error.message) };
  return { version: data };
}

export async function verifySubmission(
  input: Ref & { handoffId: string; version: number; receiptVersionId?: string | null; receiptLocator?: string | null; acknowledgedOn?: string | null },
) {
  if (!isUuid(input.handoffId)) return { error: "Choose the submission." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("verify_submission_receipt", {
    p_handoff_id: input.handoffId,
    p_expected_version: input.version,
    p_receipt_version_id: uuid(input.receiptVersionId),
    p_receipt_locator: text(input.receiptLocator),
    p_acknowledged_on: date(input.acknowledgedOn),
  });
  if (error) return { error: refusal(error.message) };
  return { version: data };
}

export async function recordCorrespondence(
  input: Ref & {
    matterId: string;
    kind: string;
    channel: string;
    receivedOn: string;
    documentDate?: string | null;
    issuer?: string | null;
    actionRequested?: string | null;
    statedDeadline?: string | null;
    evidenceVersionId?: string | null;
    evidenceLocator?: string | null;
  },
) {
  if (!isUuid(input.matterId)) return { error: "Choose a matter." };
  if (!CORRESPONDENCE_KINDS.includes(input.kind as CorrespondenceKind)) return { error: "Choose the letter type." };
  if (!CORRESPONDENCE_CHANNELS.includes(input.channel as CorrespondenceChannel)) return { error: "Choose how it arrived." };
  if (!date(input.receivedOn)) return { error: "Add the date the firm received it." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("record_government_correspondence", {
    p_matter_id: input.matterId,
    p_kind: input.kind as CorrespondenceKind,
    p_issuer: text(input.issuer),
    p_channel: input.channel as CorrespondenceChannel,
    p_document_date: date(input.documentDate),
    p_received_on: input.receivedOn,
    p_action_requested: text(input.actionRequested),
    p_stated_deadline: text(input.statedDeadline),
    p_reference_text: null,
    p_evidence_version_id: uuid(input.evidenceVersionId),
    p_evidence_locator: text(input.evidenceLocator),
    p_corrects_id: null,
  });
  if (error) return { error: refusal(error.message) };
  return { id: data };
}

export async function verifyCorrespondence(input: Ref & { correspondenceId: string; version: number }) {
  if (!isUuid(input.correspondenceId)) return { error: "Choose the letter." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("verify_government_correspondence", {
    p_correspondence_id: input.correspondenceId,
    p_expected_version: input.version,
  });
  if (error) return { error: refusal(error.message) };
  return { version: data };
}

/** Attaches the evidence to a letter recorded without it (public.attach_correspondence_evidence), so it can be verified. */
export async function attachCorrespondenceEvidence(
  input: Ref & { correspondenceId: string; version: number; evidenceVersionId: string | null; evidenceLocator?: string | null },
) {
  if (!isUuid(input.correspondenceId)) return { error: "Choose the letter." };
  if (input.evidenceVersionId && !isUuid(input.evidenceVersionId)) return { error: "Use a file that is stored on this matter." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("attach_correspondence_evidence", {
    p_correspondence_id: input.correspondenceId,
    p_expected_version: input.version,
    p_evidence_version_id: input.evidenceVersionId,
    p_evidence_locator: input.evidenceLocator ?? null,
  });
  if (error) return { error: refusal(error.message) };
  return { version: data };
}

export async function linkLetterDeadline(input: Ref & { correspondenceId: string; deadlineId: string }) {
  if (!isUuid(input.correspondenceId) || !isUuid(input.deadlineId)) return { error: "Choose the letter and the deadline." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("link_correspondence_work", {
    p_correspondence_id: input.correspondenceId,
    p_deadline_id: input.deadlineId,
    p_task_id: null,
  });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}

export async function recordCheck(input: Ref & { matterId: string; note: string }) {
  if (!isUuid(input.matterId)) return { error: "Choose a matter." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("record_government_check", { p_matter_id: input.matterId, p_note: input.note });
  if (error) return { error: refusal(error.message) };
  return { id: data };
}

export async function recordDecision(
  input: Ref & { correspondenceId: string; outcome: string; milestone?: string | null; decidedOn?: string | null; reasons?: string | null },
) {
  if (!isUuid(input.correspondenceId) || !OUTCOMES.includes(input.outcome as Outcome)) return { error: "Choose the letter and the outcome." };
  const milestone = text(input.milestone);
  if (milestone && !DECISION_MILESTONES.includes(milestone as DecisionMilestone)) return { error: "Choose a milestone." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("record_decision", {
    p_correspondence_id: input.correspondenceId,
    p_outcome: input.outcome as Outcome,
    p_milestone: (milestone as DecisionMilestone | null) ?? null,
    p_decided_on: date(input.decidedOn),
    p_authority_reasons: text(input.reasons),
  });
  if (error) return { error: refusal(error.message) };
  return { id: data };
}

export async function confirmDecision(input: Ref & { decisionId: string; version: number; interpretation?: string | null; nextSteps: string }) {
  if (!isUuid(input.decisionId)) return { error: "Choose the decision." };
  if (!text(input.nextSteps) || (input.nextSteps.trim().length ?? 0) < 3) return { error: "Write the reviewed next steps before confirming." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("confirm_decision", {
    p_decision_id: input.decisionId,
    p_expected_version: input.version,
    p_consultant_interpretation: text(input.interpretation),
    p_next_steps: input.nextSteps.trim(),
  });
  if (error) return { error: refusal(error.message) };
  return { version: data };
}

export async function addExpiryReminder(input: Ref & { decisionId: string; documentVersionId: string; dueOn: string }) {
  if (!isUuid(input.decisionId) || !isUuid(input.documentVersionId)) return { error: "Choose the document." };
  if (!date(input.dueOn)) return { error: "Choose a reminder date on or before the expiry." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("add_expiry_reminder", {
    p_decision_id: input.decisionId,
    p_document_version_id: input.documentVersionId,
    p_due_on: input.dueOn,
    p_owner_membership_id: null,
  });
  if (error) return { error: refusal(error.message) };
  return { id: data };
}

export async function recordStep(input: Ref & { decisionId: string; step: string; note?: string | null }) {
  if (!isUuid(input.decisionId) || !WITHDRAWAL_STEPS.includes(input.step as WithdrawalStep)) return { error: "Choose the step." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("record_decision_step", {
    p_decision_id: input.decisionId,
    p_step: input.step as WithdrawalStep,
    p_note: text(input.note),
  });
  if (error) return { error: refusal(error.message) };
  return { id: data };
}

/**
 * Starts a staff-only upload of a government letter or receipt for this matter. The file is
 * filed under the matter's applicant (a document belongs to one person), kept to staff
 * (audience "staff"), and linked to the matter by public.create_upload_intent.
 */
export async function startEvidenceUpload(input: Ref & { matterId: string; filename: string; byteSize: number; purpose: string }) {
  if (!isUuid(input.matterId)) return { error: "Choose a matter." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const parties = await s.supabase
    .from("matter_participants")
    .select("person_id, role")
    .eq("organization_id", input.organizationId)
    .eq("matter_id", input.matterId)
    .not("person_id", "is", null)
    .limit(20);
  const applicant = (parties.data ?? []).find((row) => row.role === "applicant") ?? (parties.data ?? [])[0];
  if (!applicant?.person_id) return { error: "Add a client to this matter before filing a letter." };
  return createUploadIntent({
    organizationId: input.organizationId,
    matterId: input.matterId,
    personId: applicant.person_id,
    filename: input.filename,
    byteSize: input.byteSize,
    purpose: input.purpose.slice(0, 200),
    sensitivity: "ordinary",
    audience: "staff",
  });
}

export async function shareWithClient(input: Ref & { kind: "correspondence" | "decision"; id: string }) {
  if (!isUuid(input.id) || (input.kind !== "correspondence" && input.kind !== "decision")) return { error: "Choose what to share." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("share_government_record", { p_kind: input.kind, p_id: input.id });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}
