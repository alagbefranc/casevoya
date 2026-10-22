"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { messageError } from "@/modules/messages/present";
import { callVoAgent, voAgentConfigured } from "./agent-client";
import { draftStale } from "@/modules/sheet/vo-present";
import { MAX_DRAFT_CHARS } from "./guard";
import { voError, voSettingChanges, type VoSwitchKey } from "./errors";
import type { VoSourceRef, VoTask, VoTaskRequest } from "./sign";

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const TOKEN_LIFETIME_MS = 2 * 60_000;

type Started = { runId: string; matterId: string; membershipId: string; userId: string; accessToken: string };

/**
 * Checks and counts a Vo request in the database (staff with MFA who can read the matter, Vo on,
 * capability, sample mode, rate limits), then hands the run to the Vo agent service with the
 * caller's own access token. Unavailable before anything is counted when the service isn't set up.
 */
async function start(
  organizationId: string,
  kind: VoTask,
  target: { threadId?: string; matterId?: string },
): Promise<{ supabase: Awaited<ReturnType<typeof createClient>>; started: Started } | { error: string }> {
  if (!voAgentConfigured()) return { error: voError("unavailable") };
  const supabase = await createClient({ organizationId });
  const [{ data: claims }, { data: session }] = await Promise.all([supabase.auth.getClaims(), supabase.auth.getSession()]);
  const userId = String(claims?.claims?.sub ?? "");
  const accessToken = session.session?.access_token ?? "";
  if (!userId || !accessToken) return { error: "Sign in first." };
  const { data: membership } = await supabase
    .from("memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) return { error: voError("denied") };
  const begun = await supabase.rpc("begin_vo_run", {
    p_organization_id: organizationId,
    p_kind: kind,
    p_thread_id: target.threadId ?? null,
    p_matter_id: target.matterId ?? null,
  });
  if (begun.error) return { error: voError("denied") };
  const run = (begun.data ?? {}) as { ok?: boolean; error?: string; run_id?: string; matter_id?: string };
  if (run.ok !== true || !run.run_id || !run.matter_id) return { error: voError(run.error ?? "failed") };
  return { supabase, started: { runId: run.run_id, matterId: run.matter_id, membershipId: membership.id, userId, accessToken } };
}

function request(organizationId: string, kind: VoTask, started: Started, threadId: string | null, question: string | null): VoTaskRequest {
  return {
    v: 1,
    runId: started.runId,
    organizationId,
    membershipId: started.membershipId,
    userId: started.userId,
    task: kind,
    matterId: started.matterId,
    threadId,
    question,
    accessToken: started.accessToken,
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
  };
}

/** If the service never answered, the run is closed here so it doesn't look in progress. */
async function closeIfOpen(supabase: Awaited<ReturnType<typeof createClient>>, runId: string, failure: string) {
  await supabase.rpc("finish_vo_run", { p_run_id: runId, p_result: "failed", p_failure: failure === "unavailable" ? "unavailable" : "failed" });
}

/**
 * "Draft with Vo" from a matter conversation: a reply to the client's latest message, or an
 * explanation of the open document requests. The result is a DRAFT the staff member reviews,
 * edits and sends themselves from the composer (send_vo_draft). Nothing is sent here.
 */
export async function draftWithVo(input: {
  organizationId: string;
  threadId: string;
  kind: "message_reply" | "document_request";
}): Promise<Result<{ draftId: string; text: string; needsRule: boolean; sources: VoSourceRef[] }> | { ok: true; abstained: true }> {
  if (!isUuid(input.organizationId) || !isUuid(input.threadId)) return { error: "Choose a conversation." };
  if (input.kind !== "message_reply" && input.kind !== "document_request") return { error: "Choose what Vo should draft." };
  const begun = await start(input.organizationId, input.kind, { threadId: input.threadId });
  if ("error" in begun) return begun;
  const out = await callVoAgent(request(input.organizationId, input.kind, begun.started, input.threadId, null));
  if (out.result === "drafted") return { ok: true, draftId: out.draftId, text: out.text, needsRule: out.needsRule, sources: out.sources };
  if (out.result === "abstained") return { ok: true, abstained: true };
  if (out.result === "answered") return { error: voError("failed") };
  if (out.failure === "unavailable") await closeIfOpen(begun.supabase, begun.started.runId, out.failure);
  return { error: voError(out.failure === "nothing_to_draft" ? (input.kind === "document_request" ? "no_requests" : "no_message") : out.failure) };
}

/**
 * Ask Vo about one matter: an answer for the staff member only, from the firm's own records, with
 * the records it used. Questions that need a rule, a fee, a deadline or a legal judgement are
 * declined and left for a consultant. The answer is shown, not stored.
 */
export async function askVo(input: {
  organizationId: string;
  matterId: string;
  question: string;
}): Promise<Result<{ text: string; needsRule: boolean; sources: VoSourceRef[] }> | { ok: true; abstained: true }> {
  if (!isUuid(input.organizationId) || !isUuid(input.matterId)) return { error: "Choose a matter." };
  const question = (input.question ?? "").trim();
  if (!question || question.length > 1000) return { error: "Ask a question of up to 1,000 characters." };
  const begun = await start(input.organizationId, "ask", { matterId: input.matterId });
  if ("error" in begun) return begun;
  const out = await callVoAgent(request(input.organizationId, "ask", begun.started, null, question));
  if (out.result === "answered") return { ok: true, text: out.text, needsRule: out.needsRule, sources: out.sources };
  if (out.result === "abstained") return { ok: true, abstained: true };
  if (out.result === "drafted") return { error: voError("failed") };
  if (out.failure === "unavailable") await closeIfOpen(begun.supabase, begun.started.runId, out.failure);
  return { error: voError(out.failure) };
}

/** Sends the reviewed text of a draft as a matter message (the person pressed Send). */
export async function sendVoDraft(input: {
  organizationId: string;
  draftId: string;
  body: string;
  clientKey?: string | null;
}): Promise<Result<{ messageId: string; threadId: string }>> {
  if (!isUuid(input.organizationId) || !isUuid(input.draftId)) return { error: "Choose a draft." };
  const body = (input.body ?? "").trim();
  if (!body || body.length > MAX_DRAFT_CHARS) return { error: messageError("1 to 4000") };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("send_vo_draft", {
    p_draft_id: input.draftId,
    p_body: body,
    p_client_key: input.clientKey && KEY.test(input.clientKey) ? input.clientKey : null,
  });
  if (error) {
    if (/placeholder/i.test(error.message)) return { error: voError("placeholder") };
    if (/already reviewed/i.test(error.message)) return { error: voError("reviewed") };
    if (/vo denied/i.test(error.message)) return { error: voError("denied") };
    return { error: messageError(error.message) };
  }
  const row = (data ?? {}) as { message_id?: string; thread_id?: string };
  if (!row.message_id || !row.thread_id) return { error: messageError("") };
  return { ok: true, messageId: row.message_id, threadId: row.thread_id };
}

/**
 * Vo drafts' Accept: the person sends the draft as Vo wrote it, as a matter message (the same
 * send_vo_draft the composer uses; a draft with a "[needs a sourced rule]" placeholder is refused).
 * The text is read through RLS here, never taken from the page.
 */
export async function acceptVoDraft(input: { organizationId: string; draftId: string }): Promise<Result<{ messageId: string; threadId: string }>> {
  if (!isUuid(input.organizationId) || !isUuid(input.draftId)) return { error: "Choose a draft." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data } = await supabase
    .from("vo_drafts")
    .select("body, status, created_at, thread_id, matter_id")
    .eq("organization_id", input.organizationId)
    .eq("id", input.draftId)
    .maybeSingle();
  if (!data) return { error: voError("denied") };
  if (data.status !== "draft") return { error: voError("reviewed") };
  // The page disables Accept on an out-of-date draft; the same check here, so a direct call can't skip it.
  const [thread, matter] = await Promise.all([
    supabase.from("message_threads").select("last_message_at").eq("organization_id", input.organizationId).eq("id", data.thread_id).maybeSingle(),
    supabase.from("matters").select("updated_at").eq("organization_id", input.organizationId).eq("id", data.matter_id).maybeSingle(),
  ]);
  if (draftStale(data.created_at, { threadLastMessageAt: thread.data?.last_message_at, matterUpdatedAt: matter.data?.updated_at })) {
    return { error: voError("stale") };
  }
  return sendVoDraft({ organizationId: input.organizationId, draftId: input.draftId, body: data.body, clientKey: `vo-accept-${input.draftId.replaceAll("-", "")}` });
}

/** Rejects a draft: it stays in the audit as rejected and is never sent. */
export async function discardVoDraft(input: { organizationId: string; draftId: string }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.draftId)) return { error: "Choose a draft." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("discard_vo_draft", { p_draft_id: input.draftId });
  if (error) return { error: /already reviewed/i.test(error.message) ? voError("reviewed") : voError("denied") };
  return { ok: true };
}

/** The reviewer's "useful?" vote on a run. */
export async function rateVoRun(input: { organizationId: string; runId: string; useful: boolean }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.runId) || typeof input.useful !== "boolean") return { error: "Choose a run." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("rate_vo_run", { p_run_id: input.runId, p_useful: input.useful });
  if (error) return { error: voError("denied") };
  return { ok: true };
}

/** One Vo switch, changed by the firm owner (the others keep their saved value). */
export async function saveVoSetting(input: { organizationId: string; setting: VoSwitchKey; on: boolean }): Promise<Result> {
  if (!isUuid(input.organizationId) || typeof input.on !== "boolean") return { error: "Choose a setting." };
  const changes = voSettingChanges(input.setting, input.on);
  if (!changes) return { error: "Choose a setting." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("set_vo_settings", { p_organization_id: input.organizationId, p_changes: changes });
  if (error) return { error: voError("owner_only") };
  return { ok: true };
}
