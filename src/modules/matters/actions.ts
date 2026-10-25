"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { newMatterError, readNewMatter } from "@/modules/sheet/new-matter";
import type { Database } from "@/types/database.types";

type MatterStage = Database["public"]["Enums"]["matter_stage"];
type GovernmentStatus = Database["public"]["Enums"]["government_status"];
type MatterOutcome = Database["public"]["Enums"]["matter_outcome"];

const STAGES: readonly MatterStage[] = [
  "engagement_pending",
  "intake",
  "evidence_collection",
  "preparation",
  "consultant_review",
  "client_confirmation",
  "ready_to_submit",
  "submitted",
  "government_processing",
  "decision_review",
  "post_decision",
  "closed",
];

const GOVERNMENT: readonly GovernmentStatus[] = [
  "not_recorded",
  "receipt_on_file",
  "processing_reported",
  "additional_request_open",
  "decision_evidence_on_file",
];

const OUTCOMES: readonly MatterOutcome[] = [
  "approved",
  "refused",
  "withdrawn",
  "returned_or_incomplete",
  "abandoned",
  "other_verified",
];

function asRecord(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  return {};
}

async function staffClient(organizationId: string, code: string | null) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  if (code != null) {
    const verified = await verifyTotpCode(supabase, code);
    if (!verified.ok) return { error: verified.error };
  }
  return { supabase };
}

export async function createEngagedMatter(input: {
  organizationId: string;
  title: string;
  isSample: boolean;
  consultantMembershipId: string;
  rulePackVersionId?: string | null;
  scope?: string | null;
}) {
  if (!isUuid(input.consultantMembershipId)) return { error: "Choose a responsible consultant." };
  if (input.rulePackVersionId && !isUuid(input.rulePackVersionId)) return { error: "Choose a published program pack." };
  const session = await staffClient(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("create_engaged_matter", {
    p_title: input.title,
    p_is_sample: input.isSample,
    p_consultant_membership_id: input.consultantMembershipId,
    p_rule_pack_version_id: input.rulePackVersionId ?? null,
    p_scope: input.scope ?? null,
  });
  if (error) return { error: safeAccessError(error.message) };
  const result = asRecord(data);
  if (result.ok !== true || typeof result.id !== "string") {
    return { error: result.blocked === "licence" ? "That consultant's licence blocks a new matter." : "The matter was not created." };
  }
  return { id: result.id, reference: typeof result.reference === "string" ? result.reference : null };
}

/**
 * The Sheet's "New matter": a real client matter with its applicant and optional sponsor,
 * created as the signed-in staff member (create_client_matter is security invoker, so RLS,
 * sample mode and the licence lock decide). No authenticator code is sent; an aal2 refusal
 * comes back as the step-up message so the page can send the person to /mfa?step=6.
 */
export async function createClientMatter(input: {
  organizationId: string;
  applicantName: string;
  applicantEmail: string | null;
  sponsorName: string | null;
  sponsorEmail: string | null;
  applicantDateOfBirth?: string | null;
  sponsorDateOfBirth?: string | null;
  consultantMembershipId: string;
  rulePackVersionId: string | null;
  /** SRC-12: a program from the support catalogue instead of a pack id. */
  programKey?: string | null;
}): Promise<{ id: string; reference: string | null; isSample: boolean; supported?: boolean } | { error: string }> {
  const read = readNewMatter({
    applicantName: input.applicantName,
    applicantEmail: input.applicantEmail,
    sponsorName: input.sponsorName,
    sponsorEmail: input.sponsorEmail,
    applicantDateOfBirth: input.applicantDateOfBirth,
    sponsorDateOfBirth: input.sponsorDateOfBirth,
    consultant: input.consultantMembershipId,
    program: input.programKey ?? input.rulePackVersionId,
  });
  if ("error" in read) return { error: read.error };
  if (!isUuid(read.input.consultantMembershipId)) return { error: "Choose a responsible consultant." };
  if (read.input.rulePackVersionId && !isUuid(read.input.rulePackVersionId)) return { error: "Choose a published program template." };
  const session = await staffClient(input.organizationId, null);
  if ("error" in session) return { error: session.error ?? "Sign in first." };
  // SRC-12: a catalogued program. The database pins its current approved pack, or opens the matter
  // with no pack, checklist or rules when the program is not supported.
  if (read.input.programKey) {
    const { data, error } = await session.supabase.rpc("create_client_matter_for_program", {
      p_applicant_name: read.input.applicantName,
      p_applicant_email: read.input.applicantEmail,
      p_sponsor_name: read.input.sponsorName,
      p_sponsor_email: read.input.sponsorEmail,
      p_consultant_membership_id: read.input.consultantMembershipId,
      p_program_key: read.input.programKey,
      p_applicant_date_of_birth: read.input.applicantDateOfBirth,
      p_sponsor_date_of_birth: read.input.sponsorDateOfBirth,
    });
    if (error) return { error: newMatterError(error.message) };
    const result = asRecord(data);
    if (result.ok !== true || typeof result.id !== "string" || !isUuid(result.id)) {
      return { error: result.blocked === "licence" ? newMatterError("licence blocks") : "The matter was not created." };
    }
    return {
      id: result.id,
      reference: typeof result.reference === "string" ? result.reference : null,
      isSample: result.is_sample === true,
      supported: result.supported === true,
    };
  }
  const { data, error } = await session.supabase.rpc("create_client_matter", {
    p_applicant_name: read.input.applicantName,
    p_applicant_email: read.input.applicantEmail,
    p_sponsor_name: read.input.sponsorName,
    p_sponsor_email: read.input.sponsorEmail,
    p_consultant_membership_id: read.input.consultantMembershipId,
    p_rule_pack_version_id: read.input.rulePackVersionId,
    p_applicant_date_of_birth: read.input.applicantDateOfBirth,
    p_sponsor_date_of_birth: read.input.sponsorDateOfBirth,
  });
  if (error) return { error: newMatterError(error.message) };
  const result = asRecord(data);
  if (result.ok !== true || typeof result.id !== "string" || !isUuid(result.id)) {
    return { error: result.blocked === "licence" ? newMatterError("licence blocks") : "The matter was not created." };
  }
  // A sample-mode firm's new matter is a sample record (decision 2026-10-19).
  return { id: result.id, reference: typeof result.reference === "string" ? result.reference : null, isSample: result.is_sample === true };
}

export async function overrideMatterStage(input: {
  organizationId: string;
  matterId: string;
  toStage: string;
  expectedVersion: number;
  reason: string;
  /** Null relies on the session's recent step-up; the database checks app.mfa_step_up_satisfied() either way. */
  code: string | null;
}) {
  if (!isUuid(input.matterId) || !STAGES.includes(input.toStage as MatterStage)) {
    return { error: "Choose a matter and a stage." };
  }
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("override_matter_stage", {
    p_matter_id: input.matterId,
    p_to_stage: input.toStage as MatterStage,
    p_expected_version: input.expectedVersion,
    p_reason: input.reason,
  });
  if (error) return { error: safeAccessError(error.message) };
  const result = asRecord(data);
  if (result.ok !== true) {
    return { error: result.blocked === "licence" ? "That licence blocks this stage change." : "The stage was not changed." };
  }
  return {
    version: typeof result.version === "number" ? result.version : null,
    permittedRole: typeof result.permitted_role === "string" ? result.permitted_role : null,
  };
}

export async function assignResponsibleConsultant(input: {
  organizationId: string;
  matterId: string;
  membershipId: string;
  expectedVersion: number;
  code: string;
}) {
  if (!isUuid(input.matterId) || !isUuid(input.membershipId)) return { error: "Choose a matter and a consultant." };
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("assign_responsible_consultant", {
    p_matter_id: input.matterId,
    p_membership_id: input.membershipId,
    p_expected_version: input.expectedVersion,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { version: data };
}

/**
 * ORG-06: changes the responsible consultant and tells the people on the matter with a portal
 * account (portal notice and EX17), in one database call. The database checks the role, the
 * licence, the version and the step-up.
 */
export async function changeResponsibleConsultant(input: { organizationId: string; matterId: string; membershipId: string; expectedVersion: number; code: string | null }) {
  if (!isUuid(input.matterId) || !isUuid(input.membershipId)) return { error: "Choose a consultant." };
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("change_responsible_consultant", {
    p_matter_id: input.matterId,
    p_membership_id: input.membershipId,
    p_expected_version: input.expectedVersion,
  });
  if (error) return { error: safeAccessError(error.message) };
  const result = asRecord(data);
  const count = (value: unknown) => (typeof value === "number" && value > 0 ? Math.floor(value) : 0);
  return { version: typeof result.version === "number" ? result.version : null, told: count(result.told), emailed: count(result.emailed) };
}

export async function selectMatterProgram(input: {
  organizationId: string;
  matterId: string;
  rulePackVersionId: string;
  expectedVersion: number;
  reason: string;
  code: string;
}) {
  if (!isUuid(input.matterId) || !isUuid(input.rulePackVersionId)) return { error: "Choose a matter and a published pack." };
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("select_matter_program", {
    p_matter_id: input.matterId,
    p_rule_pack_version_id: input.rulePackVersionId,
    p_expected_version: input.expectedVersion,
    p_reason: input.reason,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { version: data };
}

export async function recordMatterEngagement(input: {
  organizationId: string;
  matterId: string;
  scope: string;
  useException: boolean;
  exceptionReason?: string | null;
  agreementLocator?: string | null;
  code: string;
}) {
  if (!isUuid(input.matterId)) return { error: "Choose a matter." };
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("record_matter_engagement", {
    p_matter_id: input.matterId,
    p_scope: input.scope,
    p_use_exception: input.useException,
    p_exception_reason: input.exceptionReason ?? null,
    p_agreement_locator: input.agreementLocator ?? null,
  });
  if (error) return { error: safeAccessError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "The engagement was not recorded." };
  return { id: data };
}

export async function setMatterOnHold(input: {
  organizationId: string;
  matterId: string;
  expectedVersion: number;
  reason: string;
  ownerMembershipId: string;
  reviewOn: string;
  /** Null relies on the session's recent step-up; the database checks app.mfa_step_up_satisfied() either way. */
  code: string | null;
}) {
  if (!isUuid(input.matterId) || !isUuid(input.ownerMembershipId)) return { error: "Choose a matter and a hold owner." };
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("set_matter_on_hold", {
    p_matter_id: input.matterId,
    p_expected_version: input.expectedVersion,
    p_reason: input.reason,
    p_owner_membership_id: input.ownerMembershipId,
    p_review_on: input.reviewOn,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { version: data };
}

export async function clearMatterOnHold(input: {
  organizationId: string;
  matterId: string;
  expectedVersion: number;
  reason: string;
  /** Null relies on the session's recent step-up; the database checks app.mfa_step_up_satisfied() either way. */
  code: string | null;
}) {
  if (!isUuid(input.matterId)) return { error: "Choose a matter." };
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("clear_matter_on_hold", {
    p_matter_id: input.matterId,
    p_expected_version: input.expectedVersion,
    p_reason: input.reason,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { version: data };
}

export async function recordGovernmentStatus(input: {
  organizationId: string;
  matterId: string;
  status: string;
  expectedVersion: number;
  note: string;
  /** Null relies on the session's recent step-up; the database checks app.mfa_step_up_satisfied() either way. */
  code: string | null;
}) {
  if (!isUuid(input.matterId) || !GOVERNMENT.includes(input.status as GovernmentStatus)) {
    return { error: "Choose a matter and a recorded status." };
  }
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("record_government_status", {
    p_matter_id: input.matterId,
    p_status: input.status as GovernmentStatus,
    p_expected_version: input.expectedVersion,
    p_note: input.note,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { version: data };
}

export async function recordMatterOutcome(input: {
  organizationId: string;
  matterId: string;
  outcome: string;
  expectedVersion: number;
  note: string;
  /** Null relies on the session's recent step-up; the database checks app.mfa_step_up_satisfied() either way. */
  code: string | null;
}) {
  if (!isUuid(input.matterId) || !OUTCOMES.includes(input.outcome as MatterOutcome)) {
    return { error: "Choose a matter and an outcome." };
  }
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("record_matter_outcome", {
    p_matter_id: input.matterId,
    p_outcome: input.outcome as MatterOutcome,
    p_expected_version: input.expectedVersion,
    p_note: input.note,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { version: data };
}

export async function recordMatterRetention(input: {
  organizationId: string;
  matterId: string;
  expectedVersion: number;
  retentionOn: string;
  reason: string;
  code: string;
}) {
  if (!isUuid(input.matterId)) return { error: "Choose a matter." };
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("record_matter_retention", {
    p_matter_id: input.matterId,
    p_expected_version: input.expectedVersion,
    p_retention_on: input.retentionOn,
    p_reason: input.reason,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { version: data };
}

export async function linkSuccessorMatter(input: {
  organizationId: string;
  predecessorId: string;
  successorId: string;
  reason: string;
  code: string;
}) {
  if (!isUuid(input.predecessorId) || !isUuid(input.successorId)) return { error: "Choose both matters." };
  const session = await staffClient(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("link_successor_matter", {
    p_predecessor_id: input.predecessorId,
    p_successor_id: input.successorId,
    p_reason: input.reason,
  });
  if (error) return { error: safeAccessError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "The matters were not linked." };
  return { id: data };
}
