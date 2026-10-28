import "server-only";
import { sendCloudflareEmail } from "@/modules/email/cloudflare";
import { dispatchOutbound, type MailDelivery, type PreparedMail } from "@/modules/email/dispatch";
import { openInviteLink, openSigningCode } from "@/modules/email/invite-link-seal";
import { appOrigin, emailRuntimeConfig } from "@/lib/email/env";
import { createServiceClient } from "@/lib/supabase/service";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asMessages(value: unknown): MailDelivery[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MailDelivery => {
    if (!item || typeof item !== "object") return false;
    const row = item as MailDelivery;
    return typeof row.delivery_id === "string" && typeof row.to === "string";
  });
}

export async function runEmailDispatch(limit = 20) {
  const config = emailRuntimeConfig();
  const supabase = createServiceClient();
  const worker = "casevoya-email-dispatch";
  // Deadline reminders that are due become 'reminder.due' mail events, sent below with the rest.
  // Reminders for a date already gone by are skipped by the database, never sent late. A failure
  // here doesn't hold up other mail: the next run claims them.
  try {
    await supabase.rpc("claim_due_reminders", { p_limit: 100, p_as_of: new Date().toISOString() });
  } catch {
    // Unreachable database: the mail claim below fails the same way and the run reports it.
  }
  return dispatchOutbound(
    {
      async claim(workerName, count) {
        const { data, error } = await supabase.rpc("claim_mail_events", { p_worker: workerName, p_limit: count });
        if (error) throw new Error(error.message);
        if (!Array.isArray(data)) return [];
        return data.flatMap((row) => {
          const record = asRecord(row);
          return typeof record.id === "string" ? [{ id: record.id }] : [];
        });
      },
      async prepare(eventId, workerName, domain, fromAddress) {
        const { data, error } = await supabase.rpc("prepare_email_delivery", {
          p_event_id: eventId,
          p_worker: workerName,
          p_inbound_domain: domain,
          p_from_address: fromAddress,
        });
        if (error) throw new Error(error.message);
        const record = asRecord(data);
        const prepared: PreparedMail = {
          action: typeof record.action === "string" ? record.action : "done",
          event_id: typeof record.event_id === "string" ? record.event_id : undefined,
          messages: asMessages(record.messages),
        };
        return prepared;
      },
      async locales(deliveryIds) {
        const { data, error } = await supabase.rpc("email_delivery_locales", { p_delivery_ids: deliveryIds });
        if (error) throw new Error(error.message);
        const record = asRecord(data);
        return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
      },
      async manageToken(deliveryId, sha256) {
        const { data, error } = await supabase.rpc("issue_booking_manage_token", { p_delivery_id: deliveryId, p_sha256: sha256 });
        if (error) throw new Error(error.message);
        return typeof data === "string" ? data : null;
      },
      async brands(deliveryIds) {
        const { data, error } = await supabase.rpc("email_delivery_brands", { p_delivery_ids: deliveryIds });
        if (error) throw new Error(error.message);
        const record = asRecord(data);
        return Object.fromEntries(Object.entries(record).map(([id, look]) => [id, asRecord(look)]));
      },
      openLink(sealed, invitationId) {
        return openInviteLink(config.dispatchSecret, sealed, invitationId);
      },
      openCode(sealed, codeId) {
        return openSigningCode(config.dispatchSecret, sealed, codeId);
      },
      send(email) {
        return sendCloudflareEmail(email, { accountId: config.accountId, token: config.token });
      },
      async finish(deliveryId, workerName, outcome, providerMessageId, errorText) {
        const { error } = await supabase.rpc("finish_email_delivery", {
          p_delivery_id: deliveryId,
          p_worker: workerName,
          p_outcome: outcome,
          p_provider_message_id: providerMessageId ?? "",
          p_error: errorText ?? "",
        });
        if (error) throw new Error(error.message);
      },
    },
    {
      worker,
      limit,
      inboundDomain: config.inboundDomain,
      fromAddress: config.fromAddress,
      appOrigin: appOrigin(),
    },
  );
}
