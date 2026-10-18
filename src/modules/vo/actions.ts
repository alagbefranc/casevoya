"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { messageError } from "@/modules/messages/present";
import { hasWork, loadVoContext } from "./context";
import { runVoModel, workersAi } from "./engine";
import { guardVoOutput, MAX_DRAFT_CHARS } from "./guard";
import { buildVoMessages, newNonce, VO_PROMPT_VERSION, type VoKind } from "./prompt";
import { nextSettings, voError, type VoSettingKey } from "./present";

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const KINDS: readonly VoKind[] = ["message_reply", "document_request"];

/**
 * "Draft with Vo" from a matter conversation. The database checks the caller (active staff with
 * staff MFA who can read the conversation), that Vo is on, sample mode and the rate limits, and
 * records the run; the context is read with the caller's own access (RLS); the Workers AI answer
 * is guarded and saved as a DRAFT with the records it cited. Nothing is sent: the staff member
 * reviews and edits it in the composer and sends it themselves (send_vo_draft).
 */
export async function draftWithVo(input: {
  organizationId: string;
  threadId: string;
  kind: VoKind;
}): Promise<Result<{ draftId: string; text: string; needsRule: boolean }> | { ok: true; abstained: true }> {
  if (!isUuid(input.organizationId) || !isUuid(input.threadId)) return { error: "Choose a conversation." };
  if (!KINDS.includes(input.kind)) return { error: "Choose what Vo should draft." };
  // Unavailable outside the Worker: say so before anything is counted.
  const ai = workersAi();
  if (!ai) return { error: voError("unavailable") };

  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  const userId = String(claims?.claims?.sub ?? "");
  if (!userId) return { error: "Sign in first." };

  const begun = await supabase.rpc("begin_vo_run", { p_organization_id: input.organizationId, p_kind: input.kind, p_thread_id: input.threadId });
  if (begun.error) return { error: voError("denied") };
  const run = (begun.data ?? {}) as { ok?: boolean; error?: string; run_id?: string };
  if (run.ok !== true || !run.run_id) return { error: voError(run.error ?? "failed") };
  const runId = run.run_id;
  const version = VO_PROMPT_VERSION[input.kind];

  const fail = async (failure: "failed" | "empty" | "nothing_to_draft", message: string) => {
    await supabase.rpc("finish_vo_run", { p_run_id: runId, p_result: "failed", p_failure: failure, p_prompt_version: version });
    return { error: message };
  };

  try {
    const [firm, profile] = await Promise.all([
      supabase.from("organizations").select("display_name").eq("id", input.organizationId).maybeSingle(),
      supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    ]);
    const loaded = await loadVoContext(supabase, {
      organizationId: input.organizationId,
      threadId: input.threadId,
      kind: input.kind,
      firmName: firm.data?.display_name ?? "the firm",
      staffName: profile.data?.display_name ?? "a staff member",
    });
    if (!loaded) return await fail("failed", voError("denied"));
    if (!hasWork(loaded.context)) return await fail("nothing_to_draft", voError(input.kind === "document_request" ? "no_requests" : "no_message"));

    const answer = await runVoModel(buildVoMessages(loaded.context, newNonce()), ai);
    if ("error" in answer) return await fail("failed", voError("failed"));
    const guarded = guardVoOutput(answer.text);
    if (guarded.kind === "empty") return await fail("empty", voError("failed"));
    if (guarded.kind === "abstain") {
      await supabase.rpc("finish_vo_run", {
        p_run_id: runId,
        p_result: "abstained",
        p_model: answer.model,
        p_prompt_version: version,
        p_latency_ms: answer.ms,
      });
      return { ok: true, abstained: true };
    }
    const saved = await supabase.rpc("finish_vo_run", {
      p_run_id: runId,
      p_result: "drafted",
      p_title: loaded.title,
      p_body: guarded.text,
      p_sources: loaded.sources,
      p_model: answer.model,
      p_prompt_version: version,
      p_needs_rule: guarded.needsRule,
      p_latency_ms: answer.ms,
    });
    if (saved.error || typeof saved.data !== "string") return { error: voError("failed") };
    return { ok: true, draftId: saved.data, text: guarded.text, needsRule: guarded.needsRule };
  } catch {
    return await fail("failed", voError("failed")).catch(() => ({ error: voError("failed") }));
  }
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

/** Rejects a draft: it stays in the audit as discarded and is never sent. */
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
export async function saveVoSetting(input: { organizationId: string; setting: VoSettingKey; on: boolean }): Promise<Result> {
  if (!isUuid(input.organizationId) || typeof input.on !== "boolean") return { error: "Choose a setting." };
  if (!["enabled", "reply_drafts", "read_client_messages"].includes(input.setting)) return { error: "Choose a setting." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const [row, org] = await Promise.all([
    supabase.from("vo_settings").select("enabled, reply_drafts, read_client_messages").eq("organization_id", input.organizationId).maybeSingle(),
    supabase.from("organizations").select("sample_mode").eq("id", input.organizationId).maybeSingle(),
  ]);
  const next = nextSettings(row.data ?? null, org.data?.sample_mode === true, input.setting, input.on);
  const { error } = await supabase.rpc("set_vo_settings", {
    p_organization_id: input.organizationId,
    p_enabled: next.enabled,
    p_reply_drafts: next.replyDrafts,
    p_read_client_messages: next.readClientMessages,
  });
  if (error) return { error: voError("owner_only") };
  return { ok: true };
}
