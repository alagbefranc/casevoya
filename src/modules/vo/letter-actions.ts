"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { callVoAgent, voAgentConfigured } from "./agent-client";
import { voError } from "./errors";
import { isLetterType, LETTER_MAX_CHARS, letterDbError, letterError } from "./letter";
import type { VoTaskRequest } from "./sign";

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

const TOKEN_LIFETIME_MS = 2 * 60_000;

/** A step-up refusal comes back as the shared message, so the Sheet sends the person to /mfa. */
function refusal(message: string, approving = false): string {
  if (/step-up|aal2|recovery code/i.test(message)) return safeAccessError(message);
  if (approving && /staff access denied/i.test(message)) return letterError("approve_role");
  return letterDbError(message);
}

/**
 * "Draft letter with Vo" on a matter (AI-01). The database checks and counts the request (staff
 * with MFA who can read the matter, Vo on, the letter switch on, sample mode, an approved fact Vo
 * may use, the shared rate limits); the Vo agent service then drafts as the staff member, from
 * approved facts and approved official content only, and saves a DRAFT letter. Nothing is sent or
 * released: a licensed member approves the letter first.
 */
export async function draftLetterWithVo(input: { organizationId: string; matterId: string; letterType: string }): Promise<Result<{ letterId: string }> | { ok: true; abstained: true }> {
  if (!isUuid(input.organizationId) || !isUuid(input.matterId)) return { error: "Choose a matter." };
  if (!isLetterType(input.letterType)) return { error: letterError("letter_type") };
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
  const begun = await supabase.rpc("begin_vo_letter_draft", { p_organization_id: input.organizationId, p_matter_id: input.matterId, p_letter_type: input.letterType });
  if (begun.error) return { error: voError("denied") };
  const run = (begun.data ?? {}) as { ok?: boolean; error?: string; run_id?: string; matter_id?: string };
  if (run.ok !== true || !run.run_id || !run.matter_id) {
    const code = run.error ?? "failed";
    return { error: code === "no_facts" || code === "capability_off" ? letterError(code) : voError(code) };
  }
  const request: VoTaskRequest = {
    v: 1,
    runId: run.run_id,
    organizationId: input.organizationId,
    membershipId: membership.id,
    userId,
    task: "letter_draft",
    matterId: run.matter_id,
    threadId: null,
    question: null,
    letterType: input.letterType,
    accessToken,
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
  };
  const out = await callVoAgent(request);
  if (out.result === "drafted") return { ok: true, letterId: out.draftId };
  if (out.result === "abstained") return { ok: true, abstained: true };
  // If the service never answered, the run is closed here so it doesn't look in progress.
  if (out.result === "failed" && out.failure === "unavailable") {
    await supabase.rpc("finish_vo_run", { p_run_id: run.run_id, p_result: "failed", p_failure: "unavailable" });
  }
  if (out.result === "failed" && out.failure === "nothing_to_draft") return { error: letterError("no_facts") };
  return { error: voError(out.result === "failed" ? out.failure : "failed") };
}

/** A letter written by hand: the non-AI path, whatever the Vo switches say. */
export async function createLetter(input: { organizationId: string; matterId: string; letterType: string; title: string; body: string }): Promise<Result<{ letterId: string }>> {
  if (!isUuid(input.organizationId) || !isUuid(input.matterId)) return { error: "Choose a matter." };
  if (!isLetterType(input.letterType)) return { error: letterError("letter_type") };
  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  if (!title || title.length > 200 || !body || body.length > LETTER_MAX_CHARS) return { error: letterError("size") };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("create_matter_letter", {
    p_organization_id: input.organizationId,
    p_matter_id: input.matterId,
    p_letter_type: input.letterType,
    p_title: title,
    p_body: body,
  });
  if (error || typeof data !== "string") return { error: refusal(error?.message ?? "") };
  return { ok: true, letterId: data };
}

/** A new version of a draft letter, written by a person. */
export async function reviseLetter(input: { organizationId: string; letterId: string; version: number; title: string; body: string }): Promise<Result<{ versionNumber: number }>> {
  if (!isUuid(input.organizationId) || !isUuid(input.letterId) || !Number.isInteger(input.version)) return { error: "Choose a letter." };
  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  if (!title || title.length > 200 || !body || body.length > LETTER_MAX_CHARS) return { error: letterError("size") };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("revise_matter_letter", { p_letter_id: input.letterId, p_expected_version: input.version, p_title: title, p_body: body });
  if (error || typeof data !== "number") return { error: refusal(error?.message ?? "") };
  return { ok: true, versionNumber: data };
}

/** A licensed member approves the current version (fresh step-up; audited). */
export async function approveLetter(input: { organizationId: string; letterId: string; version: number }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.letterId) || !Number.isInteger(input.version)) return { error: "Choose a letter." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("approve_matter_letter", { p_letter_id: input.letterId, p_expected_version: input.version });
  if (error) return { error: refusal(error.message, true) };
  return { ok: true };
}

/** Discards a draft letter: it stays on record as discarded and can't be released. */
export async function discardLetter(input: { organizationId: string; letterId: string; version: number }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.letterId) || !Number.isInteger(input.version)) return { error: "Choose a letter." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("discard_matter_letter", { p_letter_id: input.letterId, p_expected_version: input.version });
  if (error) return { error: refusal(error.message) };
  return { ok: true };
}
