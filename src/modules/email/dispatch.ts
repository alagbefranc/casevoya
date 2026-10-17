import { renderEmail } from "@/modules/email/templates";
import type { OutboundEmail, SendOutcome } from "@/modules/email/cloudflare";

export type MailDelivery = {
  delivery_id: string;
  to: string;
  from_address: string;
  from_name: string;
  reply_to_address: string;
  reply_to_name: string;
  template: string;
  context: Record<string, unknown>;
};

export type PreparedMail = {
  action: string;
  event_id?: string;
  messages?: MailDelivery[];
};

export type ClaimedMail = { id: string };

export type DispatchDeps = {
  claim: (worker: string, limit: number) => Promise<ClaimedMail[]>;
  prepare: (eventId: string, worker: string, domain: string, fromAddress: string) => Promise<PreparedMail>;
  send: (email: OutboundEmail) => Promise<SendOutcome>;
  finish: (
    deliveryId: string,
    worker: string,
    outcome: "sent" | "queued" | "bounced" | "suppressed" | "retry" | "terminal_failure",
    providerMessageId: string | null,
    error: string | null,
  ) => Promise<void>;
};

function includesAddress(list: string[], email: string): boolean {
  const target = email.toLowerCase();
  return list.some((item) => item.toLowerCase() === target);
}

export async function dispatchOutbound(
  deps: DispatchDeps,
  options: { worker: string; limit: number; inboundDomain: string; fromAddress: string },
): Promise<{ processed: number; sent: number }> {
  const events = await deps.claim(options.worker, options.limit);
  let sent = 0;
  for (const event of events) {
    const prepared = await deps.prepare(event.id, options.worker, options.inboundDomain, options.fromAddress);
    if (prepared.action !== "send" || !prepared.messages) continue;
    for (const message of prepared.messages) {
      const rendered = renderEmail({ ...message.context, template: message.template });
      const outcome = await deps.send({
        to: message.to,
        fromAddress: message.from_address,
        fromName: message.from_name,
        replyToAddress: message.reply_to_address,
        replyToName: message.reply_to_name,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      if (!outcome.ok) {
        await deps.finish(
          message.delivery_id,
          options.worker,
          outcome.retry ? "retry" : "terminal_failure",
          null,
          outcome.error,
        );
        if (outcome.retry) break;
        continue;
      }
      const kind = includesAddress(outcome.permanentBounces, message.to)
        ? "bounced"
        : includesAddress(outcome.suppressed, message.to)
          ? "suppressed"
          : includesAddress(outcome.queued, message.to)
            ? "queued"
            : "sent";
      await deps.finish(message.delivery_id, options.worker, kind, outcome.messageId, null);
      if (kind === "sent" || kind === "queued") sent += 1;
    }
  }
  return { processed: events.length, sent };
}
