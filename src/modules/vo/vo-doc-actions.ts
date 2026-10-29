"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { callVoAgent, voAgentConfigured } from "./agent-client";
import { clientAiOffMessage, voError } from "./errors";
import { VO_DOC_CATEGORY_LABEL, type VoDocCategory } from "./vo-doc";

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

const TOKEN_LIFETIME_MS = 2 * 60_000;
/** A document reading can take longer than a reply draft (one model call over the whole file). */
const READ_TIMEOUT_MS = 150_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Client = Awaited<ReturnType<typeof createClient>>;

/** Decision #263-3: name the client (read as this staff member; RLS decides) and say how they consent. */
async function clientAiOff(supabase: Client, organizationId: string, personId: string | undefined): Promise<{ error: string; code: "client_ai_off" }> {
  const { data: person } = personId && isUuid(personId)
    ? await supabase.from("persons").select("display_name, user_id").eq("organization_id", organizationId).eq("id", personId).maybeSingle()
    : { data: null };
  return { error: clientAiOffMessage(person?.display_name ?? null, Boolean(person?.user_id)), code: "client_ai_off" };
}

/**
 * #272: before "Read with Vo" says Vo is reading, whether the client hasn't agreed to AI help
 * (public.vo_document_client_ai_off, the same test the reading makes). The refusal, or null when
 * the reading may go ahead (it still checks everything itself).
 */
export async function voReadConsentRefusal(input: { organizationId: string; versionId: string }): Promise<{ error: string; code: "client_ai_off" } | null> {
  if (!isUuid(input.organizationId) || !isUuid(input.versionId)) return null;
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("vo_document_client_ai_off", { p_organization_id: input.organizationId, p_version_id: input.versionId });
  const row = (error ? null : data) as { client_ai_off?: boolean; person_id?: string } | null;
  return row?.client_ai_off === true ? clientAiOff(supabase, input.organizationId, row.person_id) : null;
}

/**
 * "Read with Vo" from a document's review dialog (PRD AI-01..AI-06). The database checks the
 * person (staff, MFA and a fresh second factor, like Open file), the version and its matter, Vo
 * and its document switches, the document's category, sample mode and rate limits, and starts a
 * run; the Vo agent service then downloads the file with this person's own token and saves
 * PROPOSALS ONLY. Nothing about the document or the matter changes here.
 */
export async function readDocumentWithVo(input: {
  organizationId: string;
  versionId: string;
}): Promise<
  Result<{ draftId: string; matterId: string; text: string; needsRule: boolean }> | { ok: true; abstained: true } | { error: string; draftId?: string; matterId?: string; code?: "client_ai_off" }
> {
  if (!isUuid(input.organizationId) || !isUuid(input.versionId)) return { error: "Open a document to review first." };
  if (!voAgentConfigured()) return { error: voError("unavailable") };
  const supabase = await createClient({ organizationId: input.organizationId });
  const [{ data: claims }, { data: session }] = await Promise.all([supabase.auth.getClaims(), supabase.auth.getSession()]);
  const userId = String(claims?.claims?.sub ?? "");
  const accessToken = session.session?.access_token ?? "";
  if (!userId || !accessToken) return { error: "Sign in first." };
  const { data: membership } = await supabase
    .from("memberships")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) return { error: voError("denied") };

  const begun = await supabase.rpc("begin_vo_document_review", { p_organization_id: input.organizationId, p_version_id: input.versionId });
  if (begun.error) return { error: /step-up|aal2/i.test(begun.error.message) ? safeAccessError(begun.error.message) : voError("denied") };
  const run = (begun.data ?? {}) as { ok?: boolean; error?: string; run_id?: string; matter_id?: string; draft_id?: string; category?: string; person_id?: string };
  if (run.ok !== true || !run.run_id || !run.matter_id) {
    if (run.error === "client_ai_off") return clientAiOff(supabase, input.organizationId, run.person_id);
    if (run.error === "already_read" && run.draft_id && run.matter_id) return { error: voError("already_read"), draftId: run.draft_id, matterId: run.matter_id };
    if (run.error === "category_off" && run.category && run.category in VO_DOC_CATEGORY_LABEL) {
      return { error: `${voError("category_off")} (${VO_DOC_CATEGORY_LABEL[run.category as VoDocCategory]})` };
    }
    return { error: voError(run.error ?? "failed") };
  }

  const out = await callVoAgent(
    {
      v: 1,
      runId: run.run_id,
      organizationId: input.organizationId,
      membershipId: membership.id,
      userId,
      task: "document_review",
      matterId: run.matter_id,
      threadId: null,
      question: null,
      versionId: input.versionId,
      accessToken,
      expiresAt: Date.now() + TOKEN_LIFETIME_MS,
    },
    { timeoutMs: READ_TIMEOUT_MS },
  );
  if (out.result === "drafted") return { ok: true, draftId: out.draftId, matterId: run.matter_id, text: out.text, needsRule: out.needsRule };
  if (out.result === "abstained") return { ok: true, abstained: true };
  if (out.result === "answered") return { error: voError("doc_failed") };
  // If the service never answered, the run is closed here so it doesn't look in progress.
  if (out.failure === "unavailable") {
    await supabase.rpc("finish_vo_run", { p_run_id: run.run_id, p_result: "failed", p_failure: "unavailable" });
    return { error: voError("unavailable") };
  }
  const code = out.failure === "refused" || out.failure === "unsupported_file" ? out.failure : out.failure === "empty" ? "doc_empty" : "doc_failed";
  return { error: voError(code) };
}

function proposalError(message: string): string {
  if (/already reviewed/i.test(message)) return voError("proposal_reviewed");
  if (/placeholder/i.test(message)) return voError("placeholder");
  if (/staff access denied/i.test(message)) return voError("proposal_role");
  if (/sample mode/i.test(message)) return voError("sample_only");
  if (/purpose|label and a date|300 characters/i.test(message)) return "Write a short value (up to 200 characters) before accepting.";
  return voError("denied");
}

/**
 * A person accepts one proposal, possibly edited. A classification updates the document; a
 * deadline is recorded through the existing deadline function (internal, tentative); a field or a
 * flag is recorded as checked. All audited.
 */
export async function acceptVoDocProposal(input: {
  organizationId: string;
  proposalId: string;
  value?: string | null;
  dueOn?: string | null;
}): Promise<Result<{ deadlineId: string | null; draftStatus: string }>> {
  if (!isUuid(input.organizationId) || !isUuid(input.proposalId)) return { error: "Choose a proposal." };
  const value = (input.value ?? "").trim();
  if (value.length > 300) return { error: "Keep the value under 300 characters." };
  if (input.dueOn && !DATE.test(input.dueOn)) return { error: "Enter the date as a date." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("accept_vo_doc_proposal", { p_proposal_id: input.proposalId, p_value: value || null, p_due_on: input.dueOn || null });
  if (error) return { error: proposalError(error.message) };
  const row = (data ?? {}) as { deadline_id?: string | null; draft_status?: string };
  return { ok: true, deadlineId: row.deadline_id ?? null, draftStatus: row.draft_status ?? "draft" };
}

export async function rejectVoDocProposal(input: { organizationId: string; proposalId: string }): Promise<Result<{ draftStatus: string }>> {
  if (!isUuid(input.organizationId) || !isUuid(input.proposalId)) return { error: "Choose a proposal." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("reject_vo_doc_proposal", { p_proposal_id: input.proposalId });
  if (error) return { error: proposalError(error.message) };
  return { ok: true, draftStatus: ((data ?? {}) as { draft_status?: string }).draft_status ?? "draft" };
}

/** Rejects a whole reading: nothing in it changes any record; the audit keeps it. */
export async function discardVoDocDraft(input: { organizationId: string; draftId: string }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.draftId)) return { error: "Choose a reading." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("discard_vo_doc_draft", { p_draft_id: input.draftId });
  if (error) return { error: /already reviewed/i.test(error.message) ? voError("reviewed") : voError("denied") };
  return { ok: true };
}
