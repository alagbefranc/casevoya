"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { DELIVERY_METHODS, followUpError } from "@/modules/decisions/present";
import { federalOfficialUrl, snapshotOfficialPage } from "@/modules/submissions/official-page";

/**
 * DEC-02 approval follow-up actions (20261025200000_dec_approval_follow_up.sql). Each one calls a
 * public.* wrapper as the signed-in member; the database checks role, matter scope, step-up and
 * licence. A step-up refusal comes back as the shared step-up message so the Sheet can send the
 * person to /mfa?step=6 and back.
 */

type Ref = { organizationId: string };
type Outcome = { ok: true } | { error: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Session = { error: string } | { supabase: Awaited<ReturnType<typeof createClient>> };

async function session(organizationId: string): Promise<Session> {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  return { supabase };
}

function refusal(message: string): string {
  if (/step-up|aal2|recovery code/i.test(message)) return safeAccessError(message);
  return followUpError(message);
}

const text = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
};
const date = (value: string | null | undefined) => (value && DATE.test(value) ? value : null);

/**
 * Enters a follow-up step from an official page. The server fetches the page and hashes it; when it
 * can't, the entry is still kept for review and says so (it can't be approved without a snapshot).
 * Nothing is read from the page: the words are what staff typed from it.
 */
export async function proposeFollowUpStep(
  input: Ref & {
    programKey: string;
    label: string;
    timing: string | null;
    sourceUrl: string;
    sourceSection: string | null;
    formNumber: string | null;
    formModifiedOn: string | null;
    checkedOn: string;
    currentTo: string | null;
  },
) {
  const url = (input.sourceUrl ?? "").trim();
  if (!federalOfficialUrl(url)) return { error: followUpError("official Government of Canada page") };
  if (!date(input.checkedOn)) return { error: followUpError("date checked") };
  if (!/^[a-z0-9_]{1,80}$/.test(input.programKey ?? "")) return { error: followUpError("choose the program") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const fetched = await snapshotOfficialPage(url, fetch);
  const { data, error } = await s.supabase.rpc("propose_approval_follow_up_step", {
    p_org: input.organizationId,
    p_program_key: input.programKey,
    p_label: (input.label ?? "").trim(),
    p_timing_text: text(input.timing) as string,
    p_source_url: url,
    p_source_section: text(input.sourceSection) as string,
    p_form_number: text(input.formNumber) as string,
    p_form_modified_on: date(input.formModifiedOn) as string,
    p_checked_on: input.checkedOn,
    p_current_to: date(input.currentTo) as string,
    p_snapshot: fetched.snapshot as unknown as never,
  });
  if (error) return { error: refusal(error.message) };
  return { id: data as string, snapshot: Boolean(fetched.snapshot), reason: fetched.snapshot ? null : fetched.reason };
}

export async function reviewFollowUpStep(input: Ref & { stepId: string; version: number; decision: "approved" | "rejected"; note: string | null }): Promise<Outcome> {
  if (!isUuid(input.stepId)) return { error: "Choose the step." };
  if (input.decision !== "approved" && input.decision !== "rejected") return { error: "Choose approve or reject." };
  if (input.decision === "rejected" && (text(input.note)?.length ?? 0) < 3) return { error: followUpError("why it's rejected") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("review_approval_follow_up_step", {
    p_step_id: input.stepId,
    p_expected_version: input.version,
    p_decision: input.decision,
    p_note: text(input.note) as string,
  });
  return error ? { error: refusal(error.message) } : { ok: true };
}

export async function retireFollowUpStep(input: Ref & { stepId: string; version: number; reason: string }): Promise<Outcome> {
  if (!isUuid(input.stepId)) return { error: "Choose the step." };
  if ((text(input.reason)?.length ?? 0) < 3) return { error: followUpError("why it's retired") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("retire_approval_follow_up_step", {
    p_step_id: input.stepId,
    p_expected_version: input.version,
    p_reason: text(input.reason) as string,
  });
  return error ? { error: refusal(error.message) } : { ok: true };
}

export async function tickFollowUpStep(input: Ref & { matterId: string; stepId: string; ticked: boolean }): Promise<Outcome> {
  if (!isUuid(input.matterId) || !isUuid(input.stepId)) return { error: "Choose the step." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("tick_approval_follow_up_step", { p_matter_id: input.matterId, p_step_id: input.stepId, p_ticked: input.ticked });
  return error ? { error: refusal(error.message) } : { ok: true };
}

export async function saveConditionsSummary(input: Ref & { matterId: string; summaryId: string | null; version: number | null; body: string }): Promise<Outcome> {
  if (!isUuid(input.matterId)) return { error: "Choose the matter." };
  const body = (input.body ?? "").trim();
  if (body.length < 20) return { error: followUpError("at least 20") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } =
    input.summaryId && isUuid(input.summaryId)
      ? await s.supabase.rpc("revise_conditions_summary", { p_summary_id: input.summaryId, p_expected_version: input.version ?? 0, p_body: body })
      : await s.supabase.rpc("draft_conditions_summary", { p_matter_id: input.matterId, p_body: body });
  return error ? { error: refusal(error.message) } : { ok: true };
}

export async function approveConditionsSummary(input: Ref & { summaryId: string; version: number }): Promise<Outcome> {
  if (!isUuid(input.summaryId)) return { error: "Choose the summary." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("approve_conditions_summary", { p_summary_id: input.summaryId, p_expected_version: input.version });
  return error ? { error: refusal(error.message) } : { ok: true };
}

export async function recordDecisionDelivery(
  input: Ref & { matterId: string; documentVersionId: string; method: string; deliveredAt: string; note: string | null },
): Promise<Outcome> {
  if (!isUuid(input.matterId) || !isUuid(input.documentVersionId)) return { error: followUpError("stored file on this matter") };
  if (!DELIVERY_METHODS.some((option) => option.value === input.method)) return { error: followUpError("how it was delivered") };
  const at = new Date(input.deliveredAt);
  if (!input.deliveredAt || Number.isNaN(at.getTime())) return { error: followUpError("delivery time") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("record_decision_delivery", {
    p_matter_id: input.matterId,
    p_document_version_id: input.documentVersionId,
    p_method: input.method,
    p_delivered_at: at.toISOString(),
    p_note: text(input.note) as string,
  });
  return error ? { error: refusal(error.message) } : { ok: true };
}

export async function recordDeliveryAcknowledgement(
  input: Ref & { deliveryId: string; version: number; acknowledgedOn: string; evidenceVersionId: string | null; evidenceNote: string | null },
): Promise<Outcome> {
  if (!isUuid(input.deliveryId)) return { error: "Choose the delivery." };
  if (!date(input.acknowledgedOn)) return { error: followUpError("acknowledgement date") };
  const evidence = input.evidenceVersionId && isUuid(input.evidenceVersionId) ? input.evidenceVersionId : null;
  if (!evidence && !text(input.evidenceNote)) return { error: followUpError("add the evidence") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("record_delivery_acknowledgement", {
    p_delivery_id: input.deliveryId,
    p_expected_version: input.version,
    p_acknowledged_on: input.acknowledgedOn,
    p_evidence_version_id: evidence as string,
    p_evidence_note: text(input.evidenceNote) as string,
  });
  return error ? { error: refusal(error.message) } : { ok: true };
}

/** The client confirms, in the portal, that they received a decision document. */
export async function acknowledgeDecisionDelivery(input: Ref & { deliveryId: string }): Promise<Outcome> {
  if (!isUuid(input.deliveryId)) return { error: "Choose the document." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("acknowledge_decision_delivery", { p_delivery_id: input.deliveryId });
  if (error) return { error: /already acknowledged/.test(error.message) ? "You already confirmed this one." : "That couldn’t be saved. Try again." };
  return { ok: true };
}
