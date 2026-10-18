import "server-only";
import { sendCloudflareEmail } from "@/modules/email/cloudflare";
import { dispatchOutbound, type MailDelivery, type PreparedMail } from "@/modules/email/dispatch";
import { openInviteLink } from "@/modules/email/invite-link-seal";
import { emailRuntimeConfig } from "@/lib/email/env";
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
      openLink(sealed, invitationId) {
        return openInviteLink(config.dispatchSecret, sealed, invitationId);
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
    },
  );
}
