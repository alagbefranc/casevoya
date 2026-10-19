/**
 * The WhatsApp worker (mirrors src/modules/email/dispatch.ts): claim due outbox events, let the
 * database prepare each (consent, the firm's number and the 24-hour window checked at send time),
 * send through Zernio with the delivery id as the idempotency key, and record the outcome. A
 * retryable failure goes back to the outbox's backoff and stops this run; anything that breaks
 * the no-sensitive-content rule is a terminal failure and is never sent.
 */
import { SensitiveContentError, buildTemplateSend, buildTextReply, type PreparedWhatsApp } from "./templates";
import type { ZernioClient } from "./zernio";

export type WhatsAppOutcome = "sent" | "retry" | "terminal_failure";

export type WhatsAppDispatchDeps = {
  claim: (worker: string, limit: number) => Promise<{ id: string }[]>;
  prepare: (eventId: string, worker: string) => Promise<Record<string, unknown>>;
  finish: (deliveryId: string, worker: string, outcome: WhatsAppOutcome, messageId: string | null, conversationId: string | null, error: string | null) => Promise<void>;
  zernio: Pick<ZernioClient, "sendTemplate" | "sendText">;
};

function asPrepared(value: Record<string, unknown>): PreparedWhatsApp | null {
  if (value.action !== "send") return null;
  const str = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
  const deliveryId = str("delivery_id");
  const accountId = str("account_id");
  const to = str("to");
  const kind = str("kind");
  if (!deliveryId || !accountId || !to || (kind !== "template" && kind !== "text")) return null;
  return {
    delivery_id: deliveryId,
    account_id: accountId,
    to,
    kind,
    template_name: str("template_name"),
    template_language: str("template_language"),
    firm_name: str("firm_name") ?? "",
    body: str("body"),
    conversation_id: str("conversation_id"),
    sandbox: value.sandbox === true,
  };
}

export async function dispatchWhatsApp(deps: WhatsAppDispatchDeps, options: { worker: string; limit: number }): Promise<{ processed: number; sent: number }> {
  const events = await deps.claim(options.worker, options.limit);
  let sent = 0;
  for (const event of events) {
    const prepared = asPrepared(await deps.prepare(event.id, options.worker));
    if (!prepared) continue;
    const key = `casevoya-wa-${prepared.delivery_id}`;
    let result;
    try {
      if (prepared.kind === "template") {
        result = await deps.zernio.sendTemplate(buildTemplateSend(prepared), key);
      } else {
        const reply = buildTextReply(prepared);
        result = await deps.zernio.sendText(reply.conversationId, reply.body, key);
      }
    } catch (error) {
      const reason = error instanceof SensitiveContentError ? `refused: ${error.message}` : error instanceof Error ? error.message : "not sent";
      await deps.finish(prepared.delivery_id, options.worker, "terminal_failure", null, null, reason.slice(0, 300));
      continue;
    }
    if (!result.ok) {
      const reason = `${result.status}${result.code ? ` ${result.code}` : ""}: ${result.error}`.slice(0, 300);
      await deps.finish(prepared.delivery_id, options.worker, result.retry ? "retry" : "terminal_failure", null, null, reason);
      if (result.retry) break;
      continue;
    }
    await deps.finish(prepared.delivery_id, options.worker, "sent", result.data.messageId, result.data.conversationId, null);
    sent += 1;
  }
  return { processed: events.length, sent };
}
