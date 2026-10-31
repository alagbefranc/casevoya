"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { readGoogleBusy } from "./calendar";
import { composioCallbackUrl } from "./callback";
import { composioConfigured, connectLink, staffSession, toolkitSession } from "./composio";
import { composioMailProvider } from "./mail/composio-mail";

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

const NOT_CONFIGURED = "Not connected — Composio not configured on this server.";
const TOOLKITS = ["gmail", "outlook", "googlecalendar", "outlook_calendar"] as const;
type Toolkit = (typeof TOOLKITS)[number];

/** Composio's toolkit slug for each of our connection kinds (Outlook mail and calendar share one). */
const COMPOSIO_TOOLKIT: Record<Toolkit, string> = { gmail: "gmail", outlook: "outlook", googlecalendar: "googlecalendar", outlook_calendar: "outlook" };

async function me(organizationId: string) {
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  const userId = String(claims?.claims?.sub ?? "");
  const { data } = userId
    ? await supabase.from("memberships").select("id").eq("organization_id", organizationId).eq("user_id", userId).eq("status", "active").order("created_at").limit(1).maybeSingle()
    : { data: null };
  return { supabase, membershipId: data?.id ?? null };
}

/** The firm owner turns connected accounts on (after accepting the disclosure) or off. */
export async function setComposioEnabled(input: { organizationId: string; enabled: boolean; acceptDisclosure: boolean }): Promise<Result> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("set_composio_enabled", {
    p_organization_id: input.organizationId,
    p_enabled: input.enabled === true,
    p_accept_disclosure: input.acceptDisclosure === true,
  });
  if (error) return { error: /disclosure/.test(error.message) ? "Read and accept the disclosure first." : "Only the firm owner, signed in with two-step verification, can change this." };
  return { ok: true };
}

/**
 * A Connect Link for the signed-in staff member's own account (Composio-managed OAuth). It returns
 * to Settings > Integrations on the app origin; `callbackUrl` is accepted for compatibility and ignored.
 */
export async function connectAccount(input: { organizationId: string; toolkit: Toolkit; callbackUrl?: string }): Promise<Result<{ url: string }>> {
  if (!isUuid(input.organizationId) || !TOOLKITS.includes(input.toolkit)) return { error: "Choose an account to connect." };
  if (!composioConfigured()) return { error: NOT_CONFIGURED };
  const { supabase, membershipId } = await me(input.organizationId);
  if (!membershipId) return { error: "Sign in first." };
  const saved = await supabase.rpc("save_staff_connection", { p_organization_id: input.organizationId, p_toolkit: input.toolkit, p_status: "pending" });
  if (saved.error) return { error: /not turned on/.test(saved.error.message) ? "The firm owner hasn’t turned on connected accounts." : "Only firm staff can connect an account." };
  try {
    return { ok: true, url: await connectLink(membershipId, COMPOSIO_TOOLKIT[input.toolkit], composioCallbackUrl(input.toolkit)) };
  } catch {
    return { error: "Composio didn’t return a link. Try again." };
  }
}

/** After the Connect Link: records the connected account id (never a token) when it is active. */
export async function refreshConnection(input: { organizationId: string; toolkit: Toolkit }): Promise<Result<{ active: boolean }>> {
  if (!isUuid(input.organizationId) || !TOOLKITS.includes(input.toolkit)) return { error: "Choose an account." };
  if (!composioConfigured()) return { error: NOT_CONFIGURED };
  const { supabase, membershipId } = await me(input.organizationId);
  if (!membershipId) return { error: "Sign in first." };
  const session = await staffSession(membershipId);
  const { items } = await session.toolkits({ toolkits: [COMPOSIO_TOOLKIT[input.toolkit]] });
  const item = items.find((row) => row.slug === COMPOSIO_TOOLKIT[input.toolkit]);
  const accountId = item?.connection?.isActive ? item.connection.connectedAccount?.id : undefined;
  if (!accountId) return { ok: true, active: false };
  const { error } = await supabase.rpc("save_staff_connection", { p_organization_id: input.organizationId, p_toolkit: input.toolkit, p_status: "active", p_connected_account_id: accountId });
  if (error) return { error: "That connection wasn’t saved." };
  return { ok: true, active: true };
}

/** The member (or the owner) disconnects; the calendar's busy times are removed with it. */
export async function disconnectAccount(input: { organizationId: string; connectionId: string }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.connectionId)) return { error: "Choose a connection." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("disconnect_staff_connection", { p_connection_id: input.connectionId });
  if (error) return { error: "Only the person who connected it, or the firm owner, can disconnect it." };
  return { ok: true };
}

/** Reads busy times from the connected Google Calendar into Casevoya's slot engine. */
export async function syncCalendarBusy(input: { organizationId: string }): Promise<Result<{ blocks: number }>> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  if (!composioConfigured()) return { error: NOT_CONFIGURED };
  const { supabase, membershipId } = await me(input.organizationId);
  if (!membershipId) return { error: "Sign in first." };
  const from = new Date();
  const read = await readGoogleBusy(await toolkitSession(membershipId, "googlecalendar"), from, 28);
  if ("error" in read) return read;
  const { data, error } = await supabase.rpc("replace_external_busy_blocks", {
    p_organization_id: input.organizationId,
    p_source: "google",
    p_from: from.toISOString(),
    p_to: read.to.toISOString(),
    p_blocks: read.blocks,
  });
  if (error) return { error: /connect that calendar/.test(error.message) ? "Connect your Google Calendar first." : "Busy times weren’t saved." };
  return { ok: true, blocks: Number(data ?? 0) };
}

/**
 * Saves a Vo draft (or any reviewed text) as a DRAFT in the staff member's own connected mailbox.
 * A person clicked this; they open their mailbox and send it themselves. Nothing is sent here.
 */
export async function saveDraftToMailbox(input: {
  organizationId: string;
  draftId: string;
  toolkit: "gmail" | "outlook";
  to: string;
  subject: string;
}): Promise<Result<{ draftId: string | null }>> {
  if (!isUuid(input.organizationId) || !isUuid(input.draftId)) return { error: "Choose a draft." };
  if (input.toolkit !== "gmail" && input.toolkit !== "outlook") return { error: "Choose a mailbox." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.to) || input.to.length > 320) return { error: "Enter the recipient’s email address." };
  if (!composioConfigured()) return { error: NOT_CONFIGURED };
  const { supabase, membershipId } = await me(input.organizationId);
  if (!membershipId) return { error: "Sign in first." };
  const [{ data: draft }, { data: connection }] = await Promise.all([
    supabase.from("vo_drafts").select("body, status").eq("organization_id", input.organizationId).eq("id", input.draftId).maybeSingle(),
    supabase.from("staff_connections").select("status, mail_label").eq("organization_id", input.organizationId).eq("membership_id", membershipId).eq("toolkit", input.toolkit).maybeSingle(),
  ]);
  if (!draft) return { error: "That draft isn’t available." };
  if (/\[needs a sourced rule\]/i.test(draft.body)) return { error: "Replace “[needs a sourced rule]” before saving it to your mailbox." };
  if (connection?.status !== "active") return { error: "Connect your mailbox first." };
  const provider = composioMailProvider({ toolkit: input.toolkit, label: connection.mail_label, session: () => toolkitSession(membershipId, input.toolkit) });
  const result = await provider.createDraft({ to: input.to, subject: input.subject.slice(0, 200), body: draft.body });
  if ("error" in result) return result;
  return { ok: true, draftId: result.draftId };
}
