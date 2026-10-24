"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { intakeError } from "@/modules/intake/present";
import type { Database, Json } from "@/types/database.types";

/**
 * Intake delivery (PRD INT-03 to INT-06). Each call acts as the signed-in person, so the database
 * functions decide: public.send_intake_request (staff on the matter, aal2), public.save_intake_answer
 * and public.submit_intake_response (the response's own person, or staff), public.request_intake_correction
 * (the person, after submitting), public.review_intake_answer (staff on the matter, aal2) and
 * public.freeze_intake_response (staff, step-up). INT-04: public.reuse_approved_facts (staff on the
 * matter, aal2) and public.confirm_reused_fact (the person the form is for).
 */

type Presence = Database["public"]["Enums"]["answer_presence"];
const PRESENCE: readonly Presence[] = ["provided", "unknown", "not_applicable", "approximate"];

async function signedIn(organizationId: string) {
  if (!isUuid(organizationId)) return null;
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  return claims?.claims?.sub ? supabase : null;
}

function staffError(message: string): string {
  if (/step-up/i.test(message)) return safeAccessError(message);
  if (/past/i.test(message)) return "Choose a due date from today on.";
  if (/published intake form/i.test(message)) return "Choose a published intake form.";
  if (/not in effect/i.test(message)) return "That form isn’t in effect yet.";
  if (/person on this matter/i.test(message)) return "Choose a person on this matter.";
  if (/sample and real/i.test(message)) return "A sample record and a real one can’t be linked.";
  if (/sample mode/i.test(message)) return "This firm is in sample mode: only sample matters accept new work.";
  if (/newer answer/i.test(message)) return "A newer answer replaced this one. Review the newer version.";
  if (/once the client sends/i.test(message)) return "Review answers once the client sends them.";
  if (/before the client sends/i.test(message)) return "Reuse earlier answers before the client sends this form.";
  if (/message under/i.test(message)) return "Keep the message under 2,000 characters.";
  if (/denied/i.test(message)) return "You can’t do that on this matter.";
  return safeAccessError(message);
}

export type SendResult = { ok: true; created: boolean; responseId: string } | { error: string };

export async function sendIntakeRequest(input: {
  organizationId: string;
  matterId: string;
  personId: string;
  templateId: string;
  dueOn?: string | null;
  message?: string | null;
}): Promise<SendResult> {
  if (!isUuid(input.matterId) || !isUuid(input.personId) || !isUuid(input.templateId)) return { error: "Choose a form and a person." };
  const dueOn = input.dueOn && /^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) ? input.dueOn : null;
  if (input.dueOn && !dueOn) return { error: "Choose a due date from the calendar." };
  const message = (input.message ?? "").trim();
  if (message.length > 2000) return { error: "Keep the message under 2,000 characters." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("send_intake_request", {
    p_matter_id: input.matterId,
    p_person_id: input.personId,
    p_template_id: input.templateId,
    p_due_on: dueOn,
    p_message: message || null,
  });
  if (error) return { error: staffError(error.message) };
  const sent = data as { response_id?: unknown; created?: unknown } | null;
  if (typeof sent?.response_id !== "string") return { error: "The form was not sent." };
  return { ok: true, created: sent.created === true, responseId: sent.response_id };
}

export type SaveResult =
  | { ok: true; version: number; savedAt: string; answerId: string; value: Json }
  | { conflict: true; version: number; latest: { presence: string; value: Json } | null }
  | { error: string };

/** Autosave of one answer. A stale version comes back as a conflict with what is saved now, so nothing typed is lost. */
export async function saveIntakeAnswerLive(input: {
  organizationId: string;
  responseId: string;
  expectedVersion: number;
  fieldKey: string;
  presence: string;
  value: Json;
}): Promise<SaveResult> {
  if (!isUuid(input.responseId) || !PRESENCE.includes(input.presence as Presence) || !/^[a-z][a-z0-9_]{0,63}$/.test(input.fieldKey)) {
    return { error: "Choose an answer." };
  }
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in again to keep saving." };
  const { data, error } = await supabase.rpc("save_intake_answer", {
    p_response_id: input.responseId,
    p_expected_version: input.expectedVersion,
    p_field_key: input.fieldKey,
    p_presence: input.presence as Presence,
    p_value: input.value,
  });
  const { data: response } = await supabase.from("intake_responses").select("version, updated_at").eq("id", input.responseId).maybeSingle();
  if (error) {
    if (/conflict/i.test(error.message) && response) {
      const { data: latest } = await supabase
        .from("intake_answer_versions")
        .select("presence, normalized_value")
        .eq("response_id", input.responseId)
        .eq("field_key", input.fieldKey)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return { conflict: true, version: response.version, latest: latest ? { presence: latest.presence, value: latest.normalized_value } : null };
    }
    return { error: intakeError(error.message) };
  }
  if (typeof data !== "string" || !response) return { error: "That didn’t save. Try again." };
  const { data: saved } = await supabase.from("intake_answer_versions").select("normalized_value").eq("id", data).maybeSingle();
  return { ok: true, version: response.version, savedAt: response.updated_at, answerId: data, value: saved?.normalized_value ?? (input.value as Json) };
}

export async function submitIntakeLive(input: { organizationId: string; responseId: string; expectedVersion: number }): Promise<{ ok: true } | { error: string; conflict?: boolean }> {
  if (!isUuid(input.responseId)) return { error: "Choose a form." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in again to send your answers." };
  const { error } = await supabase.rpc("submit_intake_response", { p_response_id: input.responseId, p_expected_version: input.expectedVersion });
  if (error) return { error: intakeError(error.message), conflict: /conflict/i.test(error.message) };
  return { ok: true };
}

export async function requestIntakeCorrection(input: {
  organizationId: string;
  responseId: string;
  fieldKey: string | null;
  presence: string | null;
  value: Json | null;
  reason: string;
  description: string;
  proofDocumentId: string | null;
}): Promise<{ ok: true; reference: string; answerId: string | null } | { error: string }> {
  if (!isUuid(input.responseId)) return { error: "Choose a form." };
  if (input.fieldKey && (!PRESENCE.includes(input.presence as Presence) || input.value == null)) return { error: "Give the right answer." };
  if (input.proofDocumentId && !isUuid(input.proofDocumentId)) return { error: "Choose the file again." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in again to send this." };
  const { data, error } = await supabase.rpc("request_intake_correction", {
    p_response_id: input.responseId,
    p_field_key: input.fieldKey,
    p_presence: input.fieldKey ? (input.presence as Presence) : null,
    p_value: input.fieldKey ? input.value : null,
    p_reason: input.reason.trim() || null,
    p_description: input.description.trim() || null,
    p_proof_document_id: input.proofDocumentId,
  });
  if (error) return { error: intakeError(error.message) };
  const made = data as { reference?: unknown; answer_id?: unknown } | null;
  if (typeof made?.reference !== "string") return { error: "The correction was not sent." };
  return { ok: true, reference: made.reference, answerId: typeof made.answer_id === "string" ? made.answer_id : null };
}

export async function reviewIntakeAnswer(input: { organizationId: string; answerId: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.answerId)) return { error: "Choose an answer." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("review_intake_answer", { p_answer_id: input.answerId });
  return error ? { error: staffError(error.message) } : { ok: true };
}

/** Freezes a submitted snapshot. The database asks for a recent step-up; the page sends the person to it. */
export async function freezeIntakeSnapshot(input: { organizationId: string; responseId: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.responseId)) return { error: "Choose a form." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("freeze_intake_response", { p_response_id: input.responseId });
  return error ? { error: staffError(error.message) } : { ok: true };
}

/** INT-04: copies the person's reviewed answers from their earlier forms into this draft form, each waiting for their reconfirmation. */
export async function reuseApprovedFacts(input: { organizationId: string; responseId: string }): Promise<{ ok: true; count: number } | { error: string }> {
  if (!isUuid(input.responseId)) return { error: "Choose a form." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("reuse_approved_facts", { p_response_id: input.responseId });
  if (error) return { error: staffError(error.message) };
  return { ok: true, count: typeof data === "number" ? data : 0 };
}

/** INT-04: the client confirms one answer copied from their earlier matter. */
export async function confirmReusedFact(input: { organizationId: string; reuseId: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.reuseId)) return { error: "Choose an answer." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in again to confirm your answer." };
  const { error } = await supabase.rpc("confirm_reused_fact", { p_reuse_id: input.reuseId });
  return error ? { error: intakeError(error.message) } : { ok: true };
}
