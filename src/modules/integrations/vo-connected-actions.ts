"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import type { Json } from "@/types/database.types";
import { composioConfigured, executeAs } from "./composio";
import { isVoConnectedToolkit, voConnectedAction, voConnectedArguments, voProposalSummary, type VoConnectedToolkit } from "./vo-connected-tools";

/**
 * Vo's actions in a staff member's connected apps (Composio), run as that member with their own
 * connected account. Reads run at once; writes are only proposed here and run when the member
 * confirms (connected_action_proposals). Every call checks the explicit list
 * (vo-connected-tools.ts) and composio_connection_ready (the firm's switch, the member's active
 * connection) before Composio is called.
 */
type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

const NOT_CONFIGURED = "Not connected — Composio not configured on this server.";
const SWITCHED_OFF = "The firm owner hasn’t turned on connected accounts.";
const NAME: Record<VoConnectedToolkit, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  googlecalendar: "Google Calendar",
  outlook_calendar: "Microsoft 365 calendar",
  zoom: "Zoom",
  googlemeet: "Google Meet",
  microsoft_teams: "Microsoft Teams",
  calendly: "Calendly",
  dropbox: "Dropbox",
  quickbooks: "QuickBooks",
};
const MAX_RESULT = 12000;

function notReady(message: string | undefined, toolkit: VoConnectedToolkit): string {
  return message && /turned on/.test(message) ? SWITCHED_OFF : `Connect your ${NAME[toolkit]} first.`;
}

async function me(organizationId: string) {
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  const userId = String(claims?.claims?.sub ?? "");
  const { data } = userId
    ? await supabase.from("memberships").select("id").eq("organization_id", organizationId).eq("user_id", userId).eq("status", "active").order("created_at").limit(1).maybeSingle()
    : { data: null };
  return { supabase, membershipId: data?.id ?? null };
}

function shorten(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}…` : text;
}

/** A read in one of the member's connected apps (e.g. list Zoom meetings). Returns Composio's data, trimmed. */
export async function runConnectedRead(input: { organizationId: string; toolkit: string; action: string; arguments?: unknown }): Promise<Result<{ data: string }>> {
  if (!isUuid(input.organizationId) || !isVoConnectedToolkit(input.toolkit)) return { error: "Choose a connected app." };
  const action = voConnectedAction(input.toolkit, input.action);
  if (!action || action.kind !== "read") return { error: "Vo can’t do that in a connected app." };
  if (!composioConfigured()) return { error: NOT_CONFIGURED };
  const { supabase, membershipId } = await me(input.organizationId);
  if (!membershipId) return { error: "Sign in first." };
  const ready = await supabase.rpc("composio_connection_ready", { p_organization_id: input.organizationId, p_toolkit: input.toolkit });
  if (ready.error) return { error: notReady(ready.error.message, input.toolkit) };
  const label = ready.data && typeof ready.data === "object" ? ((ready.data as Record<string, unknown>).mail_label as string | undefined) : undefined;
  const args = voConnectedArguments(action, input.arguments, { mailLabel: label ?? null });
  if ("error" in args) return { error: String(args.error) };
  try {
    const out = await executeAs(membershipId, action.slug, args);
    if (!out.successful) return { error: `${NAME[input.toolkit]} didn’t answer that. Try again.` };
    return { ok: true, data: shorten(out.data) };
  } catch {
    return { error: `${NAME[input.toolkit]} didn’t answer that. Try again.` };
  }
}

/** Vo proposes a write (a meeting link, an event, a folder, a draft, a booking link); nothing runs yet. */
export async function proposeConnectedAction(input: { organizationId: string; toolkit: string; action: string; arguments?: unknown }): Promise<Result<{ proposalId: string; summary: string }>> {
  if (!isUuid(input.organizationId) || !isVoConnectedToolkit(input.toolkit)) return { error: "Choose a connected app." };
  const action = voConnectedAction(input.toolkit, input.action);
  if (!action || action.kind !== "write") return { error: "Vo can’t do that in a connected app." };
  const args = voConnectedArguments(action, input.arguments);
  if ("error" in args) return { error: String(args.error) };
  const summary = voProposalSummary(input.toolkit, action, args);
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("propose_connected_action", {
    p_organization_id: input.organizationId,
    p_toolkit: input.toolkit,
    p_action: action.slug,
    p_arguments: args as Json,
    p_summary: summary,
  });
  if (error || typeof data !== "string") return { error: error ? notReady(error.message, input.toolkit) : "That wasn’t saved." };
  return { ok: true, proposalId: data, summary };
}

/** The member's confirm: runs the proposed write once, in their own connected account. */
export async function confirmConnectedAction(input: { organizationId: string; proposalId: string }): Promise<Result<{ result: string }>> {
  if (!isUuid(input.organizationId) || !isUuid(input.proposalId)) return { error: "Choose an action." };
  if (!composioConfigured()) return { error: NOT_CONFIGURED };
  const supabase = await createClient({ organizationId: input.organizationId });
  const claimed = await supabase.rpc("claim_connected_action", { p_proposal_id: input.proposalId });
  if (claimed.error || !claimed.data || typeof claimed.data !== "object") {
    return { error: claimed.error && /expired|handled/.test(claimed.error.message) ? "That action was already handled or has expired." : "That action can’t run now. Check the app is still connected." };
  }
  const row = claimed.data as { membership_id: string; toolkit: string; action: string; arguments: unknown };
  // Checked again: a row can't name an action that isn't on the list.
  const action = isVoConnectedToolkit(row.toolkit) ? voConnectedAction(row.toolkit, row.action) : null;
  const args = action?.kind === "write" ? voConnectedArguments(action, row.arguments) : { error: "not allowed" };
  if (!action || "error" in args) {
    await supabase.rpc("settle_connected_action", { p_proposal_id: input.proposalId, p_status: "failed", p_result: "Not an allowed action." });
    return { error: "Vo can’t do that in a connected app." };
  }
  let ok = false;
  let result = "";
  try {
    const out = await executeAs(row.membership_id, action.slug, args);
    ok = out.successful;
    result = ok ? shorten(out.data).slice(0, 2000) : "The app didn’t accept it.";
  } catch {
    result = "The app didn’t answer.";
  }
  await supabase.rpc("settle_connected_action", { p_proposal_id: input.proposalId, p_status: ok ? "done" : "failed", p_result: result });
  return ok ? { ok: true, result } : { error: result };
}

export async function dismissConnectedAction(input: { organizationId: string; proposalId: string }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.proposalId)) return { error: "Choose an action." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("settle_connected_action", { p_proposal_id: input.proposalId, p_status: "dismissed" });
  if (error) return { error: "That action was already handled." };
  return { ok: true };
}
