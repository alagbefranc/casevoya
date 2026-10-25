"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { composioConfigured, toolkitSession } from "@/modules/integrations/composio";
import { composioMailProvider } from "@/modules/integrations/mail/composio-mail";
import { callVoAgent, voAgentConfigured } from "./agent-client";
import {
  blockedCategory,
  categoryBlockedMessage,
  MAX_CALL_NOTES,
  MIN_CALL_NOTES,
  voCrmError,
  type VoCrmRequest,
  type VoCrmResponse,
  type VoCrmSourceRef,
  type VoCrmTask,
} from "./crm";
import { voError } from "./errors";
import type { VoTaskRequest } from "./sign";

/**
 * Vo lead follow-up drafts and call-notes summaries (PRD AI-01, AI-06). The database checks and
 * counts the request (staff with MFA who can read the lead, the consultation and where its summary
 * is kept; Vo on; the capability switch; consent to contact; sample mode; the shared rate limits)
 * and starts a run; the Vo agent service then reads the records AS THIS PERSON and saves a DRAFT.
 * Nothing is sent or saved to a record here: a person reviews it and decides.
 */

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };
type Drafted = { draftId: string; text: string; needsRule: boolean; sources: VoCrmSourceRef[]; leftOut: number };

const TOKEN_LIFETIME_MS = 2 * 60_000;

async function session(organizationId: string) {
  const supabase = await createClient({ organizationId });
  const [{ data: claims }, { data: current }] = await Promise.all([supabase.auth.getClaims(), supabase.auth.getSession()]);
  const userId = String(claims?.claims?.sub ?? "");
  const accessToken = current.session?.access_token ?? "";
  if (!userId || !accessToken) return null;
  const { data: membership } = await supabase
    .from("memberships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return { supabase, userId, accessToken, membershipId: membership?.id ?? null };
}

function refusal(task: VoCrmTask, run: { error?: string; draft_id?: string }): { error: string; draftId?: string } {
  const code = run.error ?? "failed";
  return { error: voCrmError(code, task), ...(code === "already_drafted" && run.draft_id ? { draftId: run.draft_id } : {}) };
}

async function hand(
  task: VoCrmTask,
  organizationId: string,
  who: { supabase: Awaited<ReturnType<typeof createClient>>; userId: string; accessToken: string; membershipId: string },
  runId: string,
  target: { leadId: string | null; bookingId: string | null; matterId: string | null; notes: string | null },
): Promise<Result<Drafted> | { ok: true; abstained: true }> {
  const request: VoCrmRequest = {
    v: 1,
    runId,
    organizationId,
    membershipId: who.membershipId,
    userId: who.userId,
    task,
    ...target,
    accessToken: who.accessToken,
    expiresAt: Date.now() + TOKEN_LIFETIME_MS,
  };
  // The same signed transport as every Vo request; the service routes it by task.
  const out = (await callVoAgent(request as unknown as VoTaskRequest)) as unknown as VoCrmResponse;
  if (out.result === "drafted") return { ok: true, draftId: out.draftId, text: out.text, needsRule: out.needsRule, sources: out.sources, leftOut: out.leftOut ?? 0 };
  if (out.result === "abstained") return { ok: true, abstained: true };
  // If the service never answered, the run is closed here so it doesn't look in progress.
  if (out.failure === "unavailable") {
    await who.supabase.rpc("finish_vo_crm_run", { p_run_id: runId, p_result: "failed", p_failure: "unavailable" });
    return { error: voError("unavailable") };
  }
  if (out.failure === "refused") return { error: out.category ? categoryBlockedMessage(out.category) : voCrmError("refused") };
  return { error: voError(out.failure === "empty" ? "empty" : "failed") };
}

/** "Draft follow-up with Vo" on a Lead page. */
export async function draftLeadFollowUp(input: { organizationId: string; leadId: string }): Promise<Result<Drafted> | { ok: true; abstained: true } | { error: string; draftId?: string }> {
  if (!isUuid(input.organizationId) || !isUuid(input.leadId)) return { error: "Open a lead first." };
  if (!voAgentConfigured()) return { error: voError("unavailable") };
  const who = await session(input.organizationId);
  if (!who) return { error: "Sign in first." };
  if (!who.membershipId) return { error: voError("denied") };
  const begun = await who.supabase.rpc("begin_vo_lead_follow_up", { p_organization_id: input.organizationId, p_lead_id: input.leadId });
  if (begun.error) return { error: voError("denied") };
  const run = (begun.data ?? {}) as { ok?: boolean; error?: string; run_id?: string; draft_id?: string };
  if (run.ok !== true || !run.run_id) return refusal("lead_follow_up", run);
  return hand("lead_follow_up", input.organizationId, { ...who, membershipId: who.membershipId }, run.run_id, { leadId: input.leadId, bookingId: null, matterId: null, notes: null });
}

/** "Summarise with Vo" on a video consultation's record: the staff member's own pasted notes. */
export async function summariseCallNotes(input: { organizationId: string; bookingId: string; notes: string }): Promise<Result<Drafted> | { ok: true; abstained: true } | { error: string; draftId?: string }> {
  if (!isUuid(input.organizationId) || !isUuid(input.bookingId)) return { error: "Choose a consultation." };
  const notes = typeof input.notes === "string" ? input.notes.replace(/\r\n?/g, "\n").trim() : "";
  if (notes.length < MIN_CALL_NOTES || notes.length > MAX_CALL_NOTES) return { error: voCrmError("notes_length") };
  if (!voAgentConfigured()) return { error: voError("unavailable") };
  const who = await session(input.organizationId);
  if (!who) return { error: "Sign in first." };
  if (!who.membershipId) return { error: voError("denied") };
  // The sensitive-category switches, before anything is counted or sent (the service checks again).
  const { data: settings } = await who.supabase.from("vo_settings").select("read_medical, read_criminal").eq("organization_id", input.organizationId).maybeSingle();
  const blocked = blockedCategory(notes, settings ?? null);
  if (blocked) return { error: categoryBlockedMessage(blocked) };
  const begun = await who.supabase.rpc("begin_vo_call_summary", { p_organization_id: input.organizationId, p_booking_id: input.bookingId });
  if (begun.error) return { error: voError("denied") };
  const run = (begun.data ?? {}) as { ok?: boolean; error?: string; run_id?: string; draft_id?: string; lead_id?: string | null; matter_id?: string | null };
  if (run.ok !== true || !run.run_id) return refusal("call_summary", run);
  return hand("call_summary", input.organizationId, { ...who, membershipId: who.membershipId }, run.run_id, {
    leadId: run.lead_id ?? null,
    bookingId: input.bookingId,
    matterId: run.lead_id ? null : (run.matter_id ?? null),
    notes,
  });
}

function reviewError(message: string): string {
  if (/placeholder/i.test(message)) return voError("placeholder");
  if (/already reviewed/i.test(message)) return voError("reviewed");
  if (/no consent to be contacted/i.test(message)) return voCrmError("no_consent_send");
  if (/1 to 3900/i.test(message)) return "Write the text first (up to 3,900 characters).";
  return voError("denied");
}

/** The person sent the reviewed follow-up themselves: the text they sent becomes a lead note. */
export async function markLeadFollowUpSent(input: { organizationId: string; draftId: string; body: string }): Promise<Result<{ noteId: string }>> {
  if (!isUuid(input.organizationId) || !isUuid(input.draftId)) return { error: "Choose a draft." };
  const body = (input.body ?? "").trim();
  if (!body || body.length > 3900) return { error: "Write the text first (up to 3,900 characters)." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("mark_vo_lead_follow_up_sent", { p_draft_id: input.draftId, p_body: body });
  if (error) return { error: reviewError(error.message) };
  return { ok: true, noteId: String(data ?? "") };
}

/** The person keeps the reviewed call summary as a staff note on the lead or the matter. */
export async function saveCallSummary(input: { organizationId: string; draftId: string; body: string }): Promise<Result<{ noteId: string }>> {
  if (!isUuid(input.organizationId) || !isUuid(input.draftId)) return { error: "Choose a draft." };
  const body = (input.body ?? "").trim();
  if (!body || body.length > 3900) return { error: "Write the text first (up to 3,900 characters)." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("save_vo_call_summary", { p_draft_id: input.draftId, p_body: body });
  if (error) return { error: reviewError(error.message) };
  return { ok: true, noteId: String(data ?? "") };
}

/** Rejects a draft: it stays in the audit as rejected and is never used. */
export async function discardVoCrmDraft(input: { organizationId: string; draftId: string }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.draftId)) return { error: "Choose a draft." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("discard_vo_crm_draft", { p_draft_id: input.draftId });
  if (error) return { error: reviewError(error.message) };
  return { ok: true };
}

/**
 * The reviewed follow-up as a DRAFT in the staff member's own connected mailbox (Gmail or Outlook,
 * through Composio's draft tool only), addressed to the lead. They open their mailbox and send it
 * themselves; nothing is sent here. The Vo draft stays waiting until they mark it sent.
 */
export async function saveLeadFollowUpToMailbox(input: { organizationId: string; draftId: string; body: string; toolkit: "gmail" | "outlook" }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.draftId)) return { error: "Choose a draft." };
  if (input.toolkit !== "gmail" && input.toolkit !== "outlook") return { error: "Choose a mailbox." };
  const body = (input.body ?? "").trim();
  if (!body || body.length > 3900) return { error: "Write the text first (up to 3,900 characters)." };
  if (/\[needs a (sourced rule|consultant)\]/i.test(body)) return { error: voError("placeholder") };
  if (!composioConfigured()) return { error: "Mailbox drafts aren’t set up on this server. Copy the text instead." };
  const who = await session(input.organizationId);
  if (!who?.membershipId) return { error: "Sign in first." };
  const { data: draft } = await who.supabase.from("vo_crm_drafts").select("lead_id, kind, status").eq("organization_id", input.organizationId).eq("id", input.draftId).maybeSingle();
  if (!draft || draft.kind !== "lead_follow_up" || !draft.lead_id) return { error: voError("denied") };
  if (draft.status !== "draft") return { error: voError("reviewed") };
  const [{ data: lead }, { data: consent }, { data: connection }] = await Promise.all([
    who.supabase.from("leads").select("email, service_interest").eq("organization_id", input.organizationId).eq("id", draft.lead_id).maybeSingle(),
    who.supabase
      .from("lead_consents")
      .select("granted")
      .eq("organization_id", input.organizationId)
      .eq("lead_id", draft.lead_id)
      .eq("purpose", "enquiry_reply")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    who.supabase.from("staff_connections").select("status, mail_label").eq("organization_id", input.organizationId).eq("membership_id", who.membershipId).eq("toolkit", input.toolkit).maybeSingle(),
  ]);
  if (consent?.granted !== true) return { error: voCrmError("no_consent_send") };
  if (!lead?.email) return { error: "This lead has no email address. Copy the text and send it another way." };
  if (connection?.status !== "active") return { error: "Connect your mailbox first (Settings, Integrations)." };
  const membershipId = who.membershipId;
  const provider = composioMailProvider({ toolkit: input.toolkit, label: connection.mail_label, session: () => toolkitSession(membershipId, input.toolkit) });
  const subject = lead.service_interest ? `Your enquiry: ${lead.service_interest}` : "Your enquiry";
  const result = await provider.createDraft({ to: lead.email, subject: subject.slice(0, 200), body });
  if ("error" in result) return result;
  return { ok: true };
}
