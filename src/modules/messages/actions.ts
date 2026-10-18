"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { MAX_BODY, messageError } from "./present";

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

const KEY = /^[A-Za-z0-9_-]{8,80}$/;

function uuids(values: unknown): string[] | null {
  if (!Array.isArray(values)) return null;
  const list = values.filter((value): value is string => typeof value === "string" && isUuid(value));
  return list.length === values.length ? list : null;
}

/**
 * Sends a matter message as the signed-in person. The database decides everything: who may write,
 * the audience (a new thread's people, fixed once), the attachment rule, the rate limit and the
 * generic EX07 email. `clientKey` makes a retried send return the message it already made.
 */
export async function sendMessage(input: {
  organizationId: string;
  matterId: string;
  threadId?: string | null;
  personIds?: string[] | null;
  body: string;
  requiresAck?: boolean;
  documentIds?: string[] | null;
  clientKey?: string | null;
}): Promise<Result<{ messageId: string; threadId: string }>> {
  if (!isUuid(input.organizationId) || !isUuid(input.matterId)) return { error: "Choose a conversation." };
  if (input.threadId && !isUuid(input.threadId)) return { error: "Choose a conversation." };
  const body = (input.body ?? "").trim();
  if (!body || body.length > MAX_BODY) return { error: messageError("1 to 4000") };
  const people = input.personIds == null ? null : uuids(input.personIds);
  const documents = input.documentIds == null ? null : uuids(input.documentIds);
  if ((input.personIds != null && !people) || (input.documentIds != null && !documents)) return { error: "Choose a conversation." };
  const clientKey = input.clientKey && KEY.test(input.clientKey) ? input.clientKey : null;

  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("send_matter_message", {
    p_organization_id: input.organizationId,
    p_matter_id: input.matterId,
    p_thread_id: input.threadId ?? null,
    p_person_ids: input.threadId ? null : people,
    p_body: body,
    p_requires_ack: input.requiresAck === true,
    p_document_ids: documents && documents.length ? documents : null,
    p_client_key: clientKey,
  });
  if (error) return { error: messageError(error.message) };
  const row = (data ?? {}) as { message_id?: string; thread_id?: string };
  if (!row.message_id || !row.thread_id) return { error: messageError("") };
  return { ok: true, messageId: row.message_id, threadId: row.thread_id };
}

/** Marks the thread's messages read for the signed-in person (unread status). */
export async function markThreadRead(input: { organizationId: string; threadId: string }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.threadId)) return { error: "Choose a conversation." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("mark_message_thread_read", { p_organization_id: input.organizationId, p_thread_id: input.threadId });
  if (error) return { error: messageError(error.message) };
  return { ok: true };
}

/** Acknowledges a critical instruction addressed to the signed-in client. */
export async function acknowledgeMessage(input: { organizationId: string; messageId: string }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.messageId)) return { error: "Choose a message." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("acknowledge_matter_message", { p_organization_id: input.organizationId, p_message_id: input.messageId });
  if (error) return { error: messageError(error.message) };
  return { ok: true };
}

/** Sheet > Notifications: marks the given items read, or every item the person can see (null). */
export async function markNotificationsRead(input: { organizationId: string; ids: string[] | null }): Promise<Result> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  const ids = input.ids == null ? null : uuids(input.ids);
  if (input.ids != null && (!ids || ids.length > 200)) return { error: "Choose a notification." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("mark_staff_notifications_read", { p_organization_id: input.organizationId, p_ids: ids });
  if (error) return { error: "That wasn’t saved." };
  return { ok: true };
}

/** Adds a staff-only note on a matter. Notes are never shown in the portal or mailed. */
export async function addStaffNote(input: { organizationId: string; matterId: string; body: string }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.matterId)) return { error: "Choose a matter." };
  const body = (input.body ?? "").trim();
  if (!body || body.length > MAX_BODY) return { error: "Write a note of up to 4,000 characters." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("add_matter_staff_note", { p_organization_id: input.organizationId, p_matter_id: input.matterId, p_body: body });
  if (error) return { error: "That note wasn’t saved." };
  return { ok: true };
}
