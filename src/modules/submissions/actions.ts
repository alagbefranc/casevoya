"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { SUBMISSION_CHANNELS, type SubmissionChannel } from "@/modules/government/present";
import { federalOfficialUrl, snapshotOfficialPage } from "@/modules/submissions/official-page";
import { checklistError, OVERRIDABLE, type GateKey } from "@/modules/submissions/present";

/**
 * GOV-01 and GOV-03 checklist actions. Each one calls a public.* wrapper as the signed-in member
 * (20261025170000_gov_submission_checklist.sql); the database checks role, matter scope, step-up
 * and licence. A step-up refusal comes back as the shared step-up message so the Sheet can send
 * the person to /mfa?step=6 and back.
 */

type Ref = { organizationId: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

function refusal(message: string): string {
  if (/step-up|aal2|recovery code/i.test(message) && !/firm owner step-up/i.test(message)) return safeAccessError(message);
  if (/firm owner step-up/i.test(message)) return safeAccessError("step-up is required");
  return checklistError(message);
}

const text = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
};
const date = (value: string | null | undefined) => (value && DATE.test(value) ? value : null);

export async function tickSubmissionStep(input: Ref & { handoffId: string; requirementId: string; ticked: boolean }) {
  if (!isUuid(input.handoffId) || !isUuid(input.requirementId)) return { error: "Choose the step." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("tick_submission_step", { p_handoff_id: input.handoffId, p_requirement_id: input.requirementId, p_ticked: input.ticked });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}

export async function confirmSubmissionFees(input: Ref & { handoffId: string; confirmed: boolean; note: string | null }) {
  if (!isUuid(input.handoffId)) return { error: "Choose the handoff." };
  if (input.confirmed && (text(input.note)?.length ?? 0) < 3) return { error: checklistError("how the government fee was handled") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("confirm_submission_fees", { p_handoff_id: input.handoffId, p_confirmed: input.confirmed, p_note: text(input.note) as string });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}

export async function overrideSubmissionGate(input: Ref & { handoffId: string; gate: string; reason: string }) {
  if (!isUuid(input.handoffId)) return { error: "Choose the handoff." };
  if (!OVERRIDABLE.includes(input.gate as GateKey)) return { error: checklistError("cannot be overridden") };
  if ((text(input.reason)?.length ?? 0) < 10) return { error: checklistError("reason of at least 10") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("override_submission_gate", { p_handoff_id: input.handoffId, p_gate: input.gate, p_reason: (text(input.reason) as string) });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}

/**
 * Enters a step or channel name from an official page. The server fetches the page and hashes
 * it; when it can't, the entry is still kept for review and says so (it goes live only when a
 * licensed reviewer attests they opened the page themselves). Nothing is read from the page: the
 * words are what staff typed from it.
 */
export async function proposeSubmissionRequirement(
  input: Ref & {
    programKey: string | null;
    channel: string;
    kind: string;
    label: string;
    sourceUrl: string;
    sourceSection: string | null;
    formNumber: string | null;
    formModifiedOn: string | null;
    checkedOn: string;
    currentTo: string | null;
  },
) {
  if (!SUBMISSION_CHANNELS.includes(input.channel as SubmissionChannel)) return { error: "Choose the channel." };
  if (input.kind !== "outside_step" && input.kind !== "channel_name") return { error: "Choose a step or a channel name." };
  const url = (input.sourceUrl ?? "").trim();
  if (!federalOfficialUrl(url)) return { error: checklistError("official Government of Canada page") };
  if (!date(input.checkedOn)) return { error: checklistError("date checked") };
  const programKey = text(input.programKey);
  if (programKey && !/^[a-z0-9_]{1,80}$/.test(programKey)) return { error: "Choose the program." };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const fetched = await snapshotOfficialPage(url, fetch);
  const { data, error } = await s.supabase.rpc("propose_submission_requirement", {
    p_org: input.organizationId,
    p_program_key: programKey as string,
    p_channel: input.channel as SubmissionChannel,
    p_kind: input.kind,
    p_label: input.label.trim(),
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

/**
 * Approve or reject an entry. pageOpenedOn is the reviewer's attestation for an entry without a
 * snapshot (the date they opened the official page themselves); the database ignores it when the
 * entry has a snapshot and refuses a no-snapshot approval without it.
 */
export async function reviewSubmissionRequirement(
  input: Ref & { requirementId: string; version: number; decision: string; note: string | null; pageOpenedOn?: string | null },
) {
  if (!isUuid(input.requirementId)) return { error: "Choose the entry." };
  if (input.decision !== "approved" && input.decision !== "rejected") return { error: "Choose approve or reject." };
  if (input.decision === "rejected" && (text(input.note)?.length ?? 0) < 3) return { error: checklistError("why it's rejected") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("review_submission_requirement", {
    p_requirement_id: input.requirementId,
    p_expected_version: input.version,
    p_decision: input.decision,
    p_note: text(input.note) as string,
    p_page_opened_on: input.decision === "approved" ? date(input.pageOpenedOn) : null,
  });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}

export async function retireSubmissionRequirement(input: Ref & { requirementId: string; version: number; reason: string }) {
  if (!isUuid(input.requirementId)) return { error: "Choose the entry." };
  if ((text(input.reason)?.length ?? 0) < 3) return { error: checklistError("why it's retired") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("retire_submission_requirement", {
    p_requirement_id: input.requirementId,
    p_expected_version: input.version,
    p_reason: text(input.reason) as string,
  });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}
