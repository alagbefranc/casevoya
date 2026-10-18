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
  /** Opens a sealed invitation link (context.sealed_link) for that invitation. Null when it cannot. */
  openLink?: (sealed: string, invitationId: string) => Promise<string | null>;
  /**
   * Each delivery's recipient locale ('en-CA' | 'fr-CA'), from public.email_delivery_locales.
   * Optional; a failure or a missing entry means English. Even 'fr-CA' sends French only for a
   * template whose French is approved (designs/french.ts).
   */
  locales?: (deliveryIds: string[]) => Promise<Record<string, string>>;
};

async function recipientLocales(deps: DispatchDeps, messages: MailDelivery[]): Promise<Record<string, string>> {
  if (!deps.locales || messages.length === 0) return {};
  try {
    return await deps.locales(messages.map((message) => message.delivery_id));
  } catch {
    return {};
  }
}

/**
 * The invitation link, opened from its sealed form, or null. Any failure (no key, tampered or
 * foreign ciphertext, a throw) means the linkless invitation is sent instead.
 */
async function openSealedLink(deps: DispatchDeps, sealed: unknown, invitationId: unknown): Promise<string | null> {
  if (!deps.openLink || typeof sealed !== "string" || typeof invitationId !== "string" || !sealed || !invitationId) {
    return null;
  }
  try {
    return await deps.openLink(sealed, invitationId);
  } catch {
    return null;
  }
}

function includesAddress(list: string[], email: string): boolean {
  const target = email.toLowerCase();
  return list.some((item) => item.toLowerCase() === target);
}

export async function dispatchOutbound(
  deps: DispatchDeps,
  options: { worker: string; limit: number; inboundDomain: string; fromAddress: string; appOrigin?: string },
): Promise<{ processed: number; sent: number }> {
  const events = await deps.claim(options.worker, options.limit);
  let sent = 0;
  for (const event of events) {
    const prepared = await deps.prepare(event.id, options.worker, options.inboundDomain, options.fromAddress);
    if (prepared.action !== "send" || !prepared.messages) continue;
    const locales = await recipientLocales(deps, prepared.messages);
    for (const message of prepared.messages) {
      // Only a link this worker opened reaches the template; never the sealed form. Every other
      // button (portal, Sheet) is a fixed path the renderer joins to the app origin; nothing from
      // the database is a link.
      const context: Record<string, unknown> = { ...message.context };
      const sealed = context.sealed_link;
      delete context.sealed_link;
      delete context.link;
      delete context.locale;
      const locale = locales[message.delivery_id];
      if (locale === "fr-CA") context.locale = locale;
      const link = await openSealedLink(deps, sealed, context.invitation_id);
      const rendered = renderEmail(
        { ...context, template: message.template, ...(link ? { link } : {}) },
        { origin: options.appOrigin },
      );
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
