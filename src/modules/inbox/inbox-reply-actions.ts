"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { MAX_EMAIL_CHARS, replyError } from "@/modules/sheet/inbox-reply-present";
import { safeAccessError } from "@/lib/auth/step-up";

/**
 * Reply to a client's email, or write a new one, from the Sheet Inbox (PRD OPS-04, OPS-06). The
 * database (public.send_matter_email) checks the caller's role and matter scope, that the person
 * is on the matter and has an email address, sample mode, the do-not-send list and the person's
 * email choice, records the email and queues it through the outbox. Casevoya's mail worker sends
 * it later; nothing is sent from here.
 */
export async function sendInboxEmail(input: {
  organizationId: string;
  matterId: string;
  personId: string;
  body: string;
  replyToEmailId?: string | null;
  clientKey?: string | null;
}): Promise<{ ok: true; sample: boolean } | { error: string }> {
  if (!isUuid(input.organizationId)) return { error: "Choose a firm." };
  if (!isUuid(input.matterId) || !isUuid(input.personId)) return { error: "Choose who to write to." };
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) return { error: "Write a message first." };
  if (body.length > MAX_EMAIL_CHARS) return { error: `Write a message of up to ${MAX_EMAIL_CHARS} characters.` };
  const replyTo = input.replyToEmailId && isUuid(input.replyToEmailId) ? input.replyToEmailId : null;
  const clientKey = input.clientKey && /^[A-Za-z0-9_-]{8,80}$/.test(input.clientKey) ? input.clientKey : null;

  const supabase = await createClient({ organizationId: input.organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const { data, error } = await supabase.rpc("send_matter_email", {
    p_organization_id: input.organizationId,
    p_matter_id: input.matterId,
    p_person_id: input.personId,
    p_body: body,
    p_reply_to_email_id: replyTo,
    p_client_key: clientKey,
  });
  if (error) {
    const plain = replyError(error.message);
    return { error: plain === "The email could not be sent." ? safeAccessError(error.message) : plain };
  }
  const sample = Boolean(data && typeof data === "object" && !Array.isArray(data) && (data as { sample?: unknown }).sample === true);
  return { ok: true, sample };
}
