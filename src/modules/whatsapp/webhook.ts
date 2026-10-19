/**
 * Zernio webhook payloads (pure). Shapes from "Inbox webhooks" and "Webhooks" in the Zernio docs
 * (read 2026-10-19): every event carries `id` (the dedupe key) and `event`; message events carry
 * `account.accountId` (`account.id` is the same value), and `message` with `platform`,
 * `direction`, `platformMessageId` (Meta's wamid), `conversationId`, `text`, `attachments`,
 * `sender.phoneNumber` (E.164, may be absent for a WhatsApp username user), `sender.id` (the
 * phone digits when available), `sender.businessScopedUserId` and `sentAt`. Delivery status
 * events add `statusAt` and, on message.failed, `error`.
 */
import { normalizePhoneE164 } from "./phone";

export type ZernioEvent =
  | { kind: "test" }
  | { kind: "ignore"; event: string }
  | {
      kind: "received";
      eventId: string;
      accountId: string;
      platformMessageId: string;
      conversationId: string | null;
      phone: string | null;
      bsuid: string | null;
      senderName: string | null;
      text: string | null;
      hasAttachments: boolean;
      sentAt: string | null;
    }
  | { kind: "status"; eventId: string; accountId: string; providerMessageId: string; status: "delivered" | "read" | "failed"; at: string | null; error: string | null };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, max = 200): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function isoOrNull(value: unknown): string | null {
  const raw = str(value, 64);
  return raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
}

export function parseZernioEvent(payload: unknown): ZernioEvent {
  const body = record(payload);
  const event = str(body.event, 100) ?? "";
  if (body.test === true || event === "webhook.test") return { kind: "test" };
  const eventId = str(body.id);
  const account = record(body.account);
  const accountId = str(account.accountId) ?? str(account.id);
  const message = record(body.message);
  if (!eventId || !accountId || message.platform !== "whatsapp") return { kind: "ignore", event };

  if (event === "message.received") {
    if (message.direction !== "incoming") return { kind: "ignore", event };
    const platformMessageId = str(message.platformMessageId);
    if (!platformMessageId) return { kind: "ignore", event };
    const sender = record(message.sender);
    const senderId = str(sender.id, 40);
    const phone = normalizePhoneE164(str(sender.phoneNumber, 40) ?? (senderId && /^\d{8,15}$/.test(senderId) ? `+${senderId}` : null));
    return {
      kind: "received",
      eventId,
      accountId,
      platformMessageId,
      conversationId: str(message.conversationId) ?? str(record(body.conversation).id),
      phone,
      bsuid: str(sender.businessScopedUserId),
      senderName: str(sender.name),
      text: typeof message.text === "string" ? message.text.slice(0, 4000) : null,
      hasAttachments: Array.isArray(message.attachments) && message.attachments.length > 0,
      sentAt: isoOrNull(message.sentAt),
    };
  }

  if (event === "message.delivered" || event === "message.read" || event === "message.failed") {
    const providerMessageId = str(message.platformMessageId);
    if (!providerMessageId) return { kind: "ignore", event };
    const error = record(body.error);
    const code = typeof error.code === "number" ? String(error.code) : str(error.code, 20);
    const reason = [code, str(error.title, 100) ?? str(error.message, 200)].filter(Boolean).join(" ");
    return {
      kind: "status",
      eventId,
      accountId,
      providerMessageId,
      status: event === "message.delivered" ? "delivered" : event === "message.read" ? "read" : "failed",
      at: isoOrNull(body.statusAt),
      error: reason || null,
    };
  }
  return { kind: "ignore", event };
}
