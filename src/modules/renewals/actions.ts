"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { renewalError } from "@/modules/renewals/present";
import { federalOfficialUrl, snapshotOfficialPage } from "@/modules/submissions/official-page";

/**
 * Server actions for DEC-02 renewal follow-up. Each calls a public.* wrapper as the signed-in
 * member; the database checks role, matter scope, step-up, licence, the client's contact choices
 * and version. A step-up refusal comes back as the shared step-up message so the Sheet can send
 * the person to /mfa?step=6. Nothing here sends an email or creates a bill.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
type Ref = { organizationId: string };

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  return { supabase };
}

function refusal(message: string): string {
  if (/step-up|aal2|recovery code/i.test(message)) return safeAccessError(message);
  return renewalError(message);
}

const text = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
};
const date = (value: string | null | undefined) => (value && DATE.test(value) ? value : null);
const uuid = (value: string | null | undefined) => (value && isUuid(value) ? value : null);

/** Staff record the expiry shown on the client's issued document and its internal reminder. */
export async function recordIssuedExpiry(
  input: Ref & { decisionId: string; label: string; expiresOn: string; versionId?: string | null; remindOn?: string | null; timingId?: string | null },
) {
  if (!isUuid(input.decisionId)) return { error: "Choose the decision." };
  if ((text(input.label)?.length ?? 0) < 2) return { error: renewalError("name the issued document") };
  if (!date(input.expiresOn)) return { error: renewalError("expiry date shown") };
  const timingId = uuid(input.timingId);
  if (!timingId && !date(input.remindOn)) return { error: renewalError("choose the reminder date") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("record_issued_expiry", {
    p_decision_id: input.decisionId,
    p_document_label: (text(input.label) as string),
    p_expires_on: input.expiresOn,
    p_document_version_id: uuid(input.versionId),
    p_remind_on: timingId ? null : date(input.remindOn),
    p_timing_id: timingId,
    p_owner_membership_id: null,
  });
  if (error) return { error: refusal(error.message) };
  return { id: data };
}

/** Staff set the client's renewal reminder: only if the client's contact choices allow it. */
export async function setRenewalReminder(input: Ref & { renewalId: string; version: number; scope: string; feeId?: string | null }) {
  if (!isUuid(input.renewalId)) return { error: "Choose the expiry." };
  if ((text(input.scope)?.length ?? 0) < 10) return { error: renewalError("scope of the new service") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("set_renewal_reminder", {
    p_renewal_id: input.renewalId,
    p_expected_version: input.version,
    p_service_scope: (text(input.scope) as string),
    p_fee_reference_id: uuid(input.feeId),
  });
  if (error) return { error: refusal(error.message) };
  return { version: data };
}

export async function cancelRenewal(input: Ref & { renewalId: string; version: number; reason: string }) {
  if (!isUuid(input.renewalId)) return { error: "Choose the expiry." };
  if ((text(input.reason)?.length ?? 0) < 3) return { error: renewalError("say why it's cancelled") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { data, error } = await s.supabase.rpc("cancel_decision_renewal", {
    p_renewal_id: input.renewalId,
    p_expected_version: input.version,
    p_reason: (text(input.reason) as string),
  });
  if (error) return { error: refusal(error.message) };
  return { version: data };
}

/**
 * Enters a renewal timing from an official page. The server fetches the page and hashes it; when
 * it can't, the entry is still kept for review and says so (it can't go live without a snapshot).
 * Nothing is read from the page: the words and the days are what staff typed from it.
 */
export async function proposeRenewalTiming(
  input: Ref & {
    programKey: string | null;
    appliesTo: string;
    timingText: string;
    leadDays: string | null;
    sourceUrl: string;
    sourceSection: string | null;
    formNumber: string | null;
    formModifiedOn: string | null;
    checkedOn: string;
    currentTo: string | null;
  },
) {
  const url = (input.sourceUrl ?? "").trim();
  if (!federalOfficialUrl(url)) return { error: renewalError("official Government of Canada page") };
  if (!date(input.checkedOn)) return { error: renewalError("date checked") };
  const programKey = text(input.programKey);
  if (programKey && !/^[a-z0-9_]{1,80}$/.test(programKey)) return { error: "Choose the program." };
  const days = text(input.leadDays);
  if (days && !/^\d{1,4}$/.test(days)) return { error: renewalError("days before expiry must be") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const fetched = await snapshotOfficialPage(url, fetch);
  const { data, error } = await s.supabase.rpc("propose_renewal_timing", {
    p_org: input.organizationId,
    p_program_key: programKey,
    p_applies_to: (input.appliesTo ?? "").trim(),
    p_timing_text: (input.timingText ?? "").trim(),
    p_lead_days: days ? Number(days) : null,
    p_source_url: url,
    p_source_section: text(input.sourceSection),
    p_form_number: text(input.formNumber),
    p_form_modified_on: date(input.formModifiedOn),
    p_checked_on: input.checkedOn,
    p_current_to: date(input.currentTo),
    p_snapshot: fetched.snapshot as unknown as never,
  });
  if (error) return { error: refusal(error.message) };
  return { id: data as string, snapshot: Boolean(fetched.snapshot), reason: fetched.snapshot ? null : fetched.reason };
}

/** pageOpenedOn: the reviewer's attestation for a timing without a page snapshot (2026-10-24). */
export async function reviewRenewalTiming(input: Ref & { timingId: string; version: number; decision: string; note: string | null; pageOpenedOn?: string | null }) {
  if (!isUuid(input.timingId)) return { error: "Choose the entry." };
  if (input.decision !== "approved" && input.decision !== "rejected") return { error: "Choose approve or reject." };
  if (input.decision === "rejected" && (text(input.note)?.length ?? 0) < 3) return { error: renewalError("say why it's rejected") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("review_renewal_timing", {
    p_timing_id: input.timingId,
    p_expected_version: input.version,
    p_decision: input.decision,
    p_note: text(input.note),
    p_page_opened_on: input.decision === "approved" && /^\d{4}-\d{2}-\d{2}$/.test(input.pageOpenedOn ?? "") ? (input.pageOpenedOn as string) : null,
  });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}

export async function retireRenewalTiming(input: Ref & { timingId: string; version: number; reason: string }) {
  if (!isUuid(input.timingId)) return { error: "Choose the entry." };
  if ((text(input.reason)?.length ?? 0) < 3) return { error: renewalError("say why it's retired") };
  const s = await session(input.organizationId);
  if ("error" in s) return { error: s.error };
  const { error } = await s.supabase.rpc("retire_renewal_timing", {
    p_timing_id: input.timingId,
    p_expected_version: input.version,
    p_reason: (text(input.reason) as string),
  });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}
