"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { complianceError, readDate, readDays } from "./format";

/**
 * Privacy requests (SEC-05, SEC-06), the complaints register (ADM-05) and their firm settings.
 * Each call goes to a database function that checks the caller (role, assignment, designated
 * handlers, step-up); these only shape the input and word the refusals plainly.
 */

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

const uuidOrNull = (value: string | null | undefined) => (value && isUuid(value) ? value : null);
const KINDS = new Set(["access", "correction", "consent_withdrawal", "deletion"]);
const CHANNELS = new Set(["email", "phone", "letter", "in_person", "portal", "other"]);
const CATEGORIES = new Set(["fees_billing", "communication", "service_quality", "conduct", "privacy", "other"]);

export async function recordPrivacyRequest(input: {
  organizationId: string;
  kind: string;
  requesterName: string;
  personId: string | null;
  matterId: string | null;
  details: string;
  channel: string;
  received: string;
  assigneeMembershipId: string;
  idempotencyKey: string;
}): Promise<Result<{ id: string }>> {
  if (!KINDS.has(input.kind)) return { error: "Choose the type of request." };
  if (!CHANNELS.has(input.channel)) return { error: "Choose how the request arrived." };
  if (!input.requesterName.trim()) return { error: "Enter the person’s name." };
  if (input.details.trim().length < 3) return { error: "Describe what they asked for." };
  const received = readDate(input.received);
  if (!received) return { error: "Enter the received date as DD/MM/YYYY." };
  if (!isUuid(input.assigneeMembershipId)) return { error: "Choose who handles the request." };
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  const result = await auth.supabase.rpc("record_privacy_request", {
    p_org: input.organizationId,
    p_kind: input.kind,
    p_requester_name: input.requesterName.trim(),
    p_person_id: uuidOrNull(input.personId),
    p_matter_id: uuidOrNull(input.matterId),
    p_details: input.details.trim(),
    p_channel: input.channel,
    p_received_on: received,
    p_assignee_membership_id: input.assigneeMembershipId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (result.error) return { error: complianceError(result.error.message) };
  return { ok: true, id: String(result.data) };
}

export async function recordPrivacyStep(input: { organizationId: string; requestId: string; step: string; note: string }): Promise<Result> {
  if (!isUuid(input.requestId) || !["identity", "scope", "redaction", "review"].includes(input.step)) return { error: "Refresh the page and try again." };
  if (input.note.trim().length < 3) return { error: "Add a note of 3 to 2,000 characters." };
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  const result = await auth.supabase.rpc("record_privacy_step", { p_request_id: input.requestId, p_step: input.step, p_note: input.note.trim() });
  if (result.error) return { error: complianceError(result.error.message) };
  return { ok: true };
}

export async function savePrivacyRedaction(input: {
  organizationId: string;
  requestId: string;
  redactionId: string | null;
  record: string;
  thirdParty: string;
  removed: string;
  state: string;
}): Promise<Result> {
  if (!isUuid(input.requestId)) return { error: "Refresh the page and try again." };
  if (!["to_do", "redacted", "excluded", "kept"].includes(input.state)) return { error: "Choose a state." };
  const editing = uuidOrNull(input.redactionId);
  if (!editing && (!input.record.trim() || !input.thirdParty.trim() || !input.removed.trim())) return { error: "Name the record, the third party and what is removed." };
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  const result = await auth.supabase.rpc("save_privacy_redaction", {
    p_request_id: input.requestId,
    p_redaction_id: editing,
    p_record_label: editing ? null : input.record.trim(),
    p_third_party: editing ? null : input.thirdParty.trim(),
    p_removed: editing ? null : input.removed.trim(),
    p_state: input.state,
  });
  if (result.error) return { error: complianceError(result.error.message) };
  return { ok: true };
}

export async function closePrivacyRequest(input: {
  organizationId: string;
  requestId: string;
  outcome: string;
  note: string;
  refusalReason: string;
  deliveredBy: string;
  evidence: string;
  consentRecordId: string | null;
}): Promise<Result> {
  if (!isUuid(input.requestId)) return { error: "Refresh the page and try again." };
  if (!["fulfilled", "partly_fulfilled", "refused", "withdrawn"].includes(input.outcome)) return { error: "Choose an outcome." };
  if (input.outcome === "refused" && input.refusalReason.trim().length < 3) return { error: "Give the reason for refusing." };
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  const blank = (value: string) => (value.trim() ? value.trim() : null);
  const result = await auth.supabase.rpc("close_privacy_request", {
    p_request_id: input.requestId,
    p_outcome: input.outcome,
    p_outcome_note: blank(input.note),
    p_refusal_reason: input.outcome === "refused" ? blank(input.refusalReason) : null,
    p_delivery_method: blank(input.deliveredBy),
    p_evidence_note: blank(input.evidence),
    p_consent_record_id: uuidOrNull(input.consentRecordId),
  });
  if (result.error) return { error: complianceError(result.error.message) };
  return { ok: true };
}

export async function recordComplaint(input: {
  organizationId: string;
  complainantName: string;
  personId: string | null;
  matterId: string | null;
  category: string;
  channel: string;
  issue: string;
  received: string;
  assigneeMembershipId: string;
  idempotencyKey: string;
}): Promise<Result<{ id: string }>> {
  if (!input.complainantName.trim()) return { error: "Enter the complainant’s name." };
  if (input.issue.trim().length < 3) return { error: "Describe the issue." };
  if (!CATEGORIES.has(input.category)) return { error: "Choose a category." };
  if (!CHANNELS.has(input.channel)) return { error: "Choose how the complaint arrived." };
  const received = readDate(input.received);
  if (!received) return { error: "Enter the received date as DD/MM/YYYY." };
  if (!isUuid(input.assigneeMembershipId)) return { error: "Choose who handles the complaint." };
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  const result = await auth.supabase.rpc("record_complaint", {
    p_org: input.organizationId,
    p_complainant_name: input.complainantName.trim(),
    p_person_id: uuidOrNull(input.personId),
    p_matter_id: uuidOrNull(input.matterId),
    p_category: input.category,
    p_channel: input.channel,
    p_issue: input.issue.trim(),
    p_received_on: received,
    p_assignee_membership_id: input.assigneeMembershipId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (result.error) return { error: complianceError(result.error.message) };
  return { ok: true, id: String(result.data) };
}

export async function recordComplaintStep(input: { organizationId: string; complaintId: string; step: string; on: string; note: string }): Promise<Result> {
  if (!isUuid(input.complaintId) || !["acknowledge", "review", "respond", "resolve"].includes(input.step)) return { error: "Refresh the page and try again." };
  const dated = input.step !== "review";
  const on = dated ? readDate(input.on) : null;
  if (dated && !on) return { error: "Enter the date as DD/MM/YYYY." };
  if (input.step !== "acknowledge" && input.note.trim().length < 3) return { error: "Add a note of 3 to 2,000 characters." };
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  const result = await auth.supabase.rpc("record_complaint_step", { p_complaint_id: input.complaintId, p_step: input.step, p_on: on, p_note: input.note.trim() || null });
  if (result.error) return { error: complianceError(result.error.message) };
  return { ok: true };
}

/**
 * The firm owner's settings. Only the given parts change: the others keep their saved values.
 * `handlers` replaces the designated complaint handlers when given.
 */
export async function saveComplianceSettings(input: {
  organizationId: string;
  privacyDays?: string;
  ackDays?: string;
  responseDays?: string;
  escalation?: string;
  handlers?: string[];
}): Promise<Result> {
  const read = (value: string | undefined, max: number) => (value === undefined ? undefined : readDays(value, 1, max));
  const privacy = read(input.privacyDays, 365);
  const ack = read(input.ackDays, 60);
  const response = read(input.responseDays, 365);
  for (const value of [privacy, ack, response]) if (value && "error" in value) return { error: value.error };
  const escalation = input.escalation === undefined ? undefined : input.escalation.trim();
  if (escalation !== undefined && escalation.length > 0 && (escalation.length < 3 || escalation.length > 2000)) return { error: "Write the escalation path in 3 to 2,000 characters." };
  const auth = await session(input.organizationId);
  if (!auth.supabase) return { error: auth.error ?? "Sign in first." };
  const current = await auth.supabase
    .from("compliance_settings")
    .select("privacy_response_days, complaint_ack_days, complaint_response_days, complaint_escalation_text")
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  const pick = (value: { days: number | null } | { error: string } | undefined, saved: number | null | undefined) =>
    value === undefined ? (saved ?? null) : "days" in value ? value.days : null;
  const result = await auth.supabase.rpc("set_compliance_settings", {
    p_org: input.organizationId,
    p_privacy_response_days: pick(privacy, current.data?.privacy_response_days),
    p_complaint_ack_days: pick(ack, current.data?.complaint_ack_days),
    p_complaint_response_days: pick(response, current.data?.complaint_response_days),
    p_complaint_escalation_text: escalation === undefined ? (current.data?.complaint_escalation_text ?? null) : escalation || null,
  });
  if (result.error) return { error: complianceError(result.error.message) };
  if (input.handlers) {
    const handlers = await auth.supabase.rpc("set_complaint_handlers", { p_org: input.organizationId, p_membership_ids: input.handlers.filter((id) => isUuid(id)) });
    if (handlers.error) return { error: complianceError(handlers.error.message) };
  }
  return { ok: true };
}
