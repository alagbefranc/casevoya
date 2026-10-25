/**
 * Pure helpers for replying to and writing client email from the Sheet Inbox (PRD OPS-04,
 * OPS-06): the words for a sent email's delivery status, the thread line for it, the Send
 * buttons' live attributes, and plain errors. The database (public.send_matter_email) decides who
 * may write to whom; nothing here widens that.
 */
import type { ThreadMail } from "@/components/sheet/designer/inbox";

/** The most a staff email may say, as public.send_matter_email checks it. */
export const MAX_EMAIL_CHARS = 5000;

export type OutboundState = "queued" | "sent" | "failed" | "not_sent";

/**
 * What a sent email's delivery row says, in words. No row yet means the mail worker has not
 * picked it up: queued. A row marked "queued" was accepted by the mail provider, which delivers
 * it later and reports nothing back, so for the firm it is sent. A sample matter's email is never
 * sent (recorded as skipped).
 */
export function outboundStatus(deliveryStatus: string | null | undefined, sample: boolean): { state: OutboundState; label: string } {
  switch (deliveryStatus) {
    case "sent":
    case "queued":
      return { state: "sent", label: "Sent" };
    case "bounced":
      return { state: "failed", label: "Failed: address bounced" };
    case "failed":
      return { state: "failed", label: "Failed" };
    case "suppressed":
      return { state: "not_sent", label: "Not sent: on the do-not-send list" };
    case "skipped":
      return { state: "not_sent", label: sample ? "Not sent: sample client" : "Not sent" };
    default:
      return { state: "queued", label: "Queued" };
  }
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** One sent email in a conversation: "Sam · today 09:12 · by email · Sent", then the text. */
export function outboundMail(input: { author: string; when: string; body: string; status: string }): ThreadMail {
  return {
    meta: [firstName(input.author), input.when, "by email", input.status],
    body: input.body.trim().slice(0, 4000) || "(no text)",
    files: null,
  };
}

export type MessageChannel = "portal" | "whatsapp";

/** The conversation list's chip tokens for the channels a conversation has (Portal, Email, WhatsApp). */
export function conversationChannels(channels: readonly ("email" | MessageChannel)[]): string[] {
  return ["portal", "email", "whatsapp"].filter((channel) => channels.includes(channel as "email" | MessageChannel));
}

/**
 * One secure matter message in a conversation: "Priya · 18 Oct 09:12 · via portal", then the text.
 * A staff message (OPS-04) also says whether it was acknowledged, and "Delivered" or "Read by …".
 */
export function messageMail(input: { author: string; when: string; body: string; channel: MessageChannel; ack: boolean; acked?: string[]; state?: string | null }): ThreadMail {
  const ack = input.ack ? [input.acked?.length ? `acknowledged by ${input.acked.join(", ")}` : "acknowledgement asked"] : [];
  return {
    meta: [firstName(input.author), input.when, input.channel === "whatsapp" ? "via WhatsApp" : "via portal", ...ack, ...(input.state ? [input.state] : [])],
    body: input.body.trim().slice(0, 4000) || "(no text)",
    files: null,
  };
}

/** "Send to …" when the conversation's latest message is a portal or WhatsApp one: a reply in that matter thread. */
export function messageSendAttrs(input: { organizationId: string; matterId: string; threadId: string; name: string }): Attrs {
  return {
    "data-inbox-message": input.threadId,
    "data-org": input.organizationId,
    "data-matter": input.matterId,
    "data-name": firstName(input.name),
  };
}

/** "Staff-only note": the reply box's text, kept on the matter for staff only (public.add_matter_staff_note). */
export function noteAttrs(organizationId: string, matterId: string): Attrs {
  return { "data-inbox-note": matterId, "data-org": organizationId };
}

/**
 * Who the New message dialog can write to by email: a person with an address who hasn't turned
 * email off and whose address isn't on the do-not-send list (send_matter_email refuses both).
 */
export function canEmail(person: { email: string | null; emailOff: boolean }, suppressed: ReadonlySet<string>): boolean {
  const email = (person.email ?? "").trim().toLowerCase();
  return Boolean(email) && !person.emailOff && !suppressed.has(email);
}

/** The toast after a portal reply. It names no email: whether one goes out is the client's own setting. */
export function messageSentToast(name: string, ack: boolean): { title: string; kind: string; sub: string } {
  return { title: `Message to ${name} sent`, kind: "ok", sub: `${ack ? "They’re asked to acknowledge it. " : ""}They read it in their portal.` };
}

/** The Compose dialog's To option value: which matter and person. */
export function composeValue(matterId: string, personId: string): string {
  return `${matterId}:${personId}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseComposeValue(value: string | null | undefined): { matterId: string; personId: string } | null {
  const [matterId, personId, extra] = (value ?? "").split(":");
  if (extra !== undefined || !UUID.test(matterId ?? "") || !UUID.test(personId ?? "")) return null;
  return { matterId, personId };
}

type Attrs = Record<string, string>;

/**
 * The conversation's "Send to …" button. With an address it sends by email (a reply when the
 * thread has a filed email on that matter); without one it says so and sends nothing.
 */
export function replySendAttrs(input: {
  organizationId: string;
  matterId: string;
  personId: string;
  name: string;
  hasEmail: boolean;
  replyToEmailId: string | null;
}): Attrs {
  const first = firstName(input.name);
  if (!input.hasEmail) {
    return {
      "data-toast": `${first} has no email address on file`,
      "data-toast-kind": "warn",
      "data-toast-sub": "Nothing was sent. Add an address on their client record, or use the portal.",
    };
  }
  return {
    "data-inbox-reply": input.replyToEmailId ?? "new",
    "data-org": input.organizationId,
    "data-matter": input.matterId,
    "data-person": input.personId,
    "data-name": first,
  };
}

/** The New message dialog's Send button. */
export function composeSendAttrs(organizationId: string): Attrs {
  return { "data-inbox-compose": "1", "data-org": organizationId };
}

/** Plain words for a refused send. */
export function replyError(message: string): string {
  if (/must be 1 to 5000|1 to 5000 characters/i.test(message)) return `Write a message of up to ${MAX_EMAIL_CHARS} characters.`;
  if (/not on this matter/i.test(message)) return "That person isn’t on this matter.";
  if (/no email address/i.test(message)) return "That person has no email address on file.";
  if (/not on this person/i.test(message)) return "That email isn’t on this person’s file any more. Refresh the page.";
  if (/do-not-send/i.test(message)) return "This address is on the do-not-send list, so Casevoya won’t email it.";
  if (/turned off email/i.test(message)) return "This person turned off email from the firm. Use the portal instead.";
  if (/rate limit/i.test(message)) return "You’ve sent a lot of email in the last few minutes. Wait a little, then try again.";
  if (/denied|42501/i.test(message)) return "You can’t email people on this matter.";
  return "The email could not be sent.";
}

/** The toast after a send. A sample client's email is saved but never sent. */
export function sentToast(name: string, sample: boolean): { title: string; kind: string; sub: string } {
  if (sample) return { title: "Saved, not sent", kind: "warn", sub: `${name} is a sample client, so no email was sent.` };
  return { title: `Email to ${name} queued`, kind: "ok", sub: "Their answer comes back to this inbox." };
}
