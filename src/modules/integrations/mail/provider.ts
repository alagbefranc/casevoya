/**
 * Mail providers for Vo and staff (pure types and selection).
 *
 *  casevoya  DEFAULT, always available. Inbound mail is Cloudflare Email Routing ->
 *            workers/inbound-email -> `inbound_emails`; staff read only mail filed to a matter they
 *            can open (RLS) and triage items, whose matter matches are suggestions. Outbound staff
 *            replies through Casevoya's own sender are NOT built yet (docs/integrations/composio.md).
 *  composio  OPTIONAL, per staff member: their own Gmail or Outlook through a Composio Connect Link,
 *            after the owner turns it on and accepts the disclosure. Reads only the label/folder
 *            the staff member marks for Casevoya; can create a DRAFT in their mailbox; never sends.
 */

import { dataBlock, oneLine } from "@/modules/vo/prompt";

export type MailProviderId = "casevoya" | "composio";

/**
 * Mail as Vo may see it: sender and subject flattened to one line, the body inside a nonce data
 * block, so instructions inside an email can't pose as Vo's rules (AI-05).
 */
export function mailForVo(messages: MailMessage[], nonce: string): string {
  return messages
    .map((message) => `Email from ${oneLine(message.from, 120)}, subject ${oneLine(message.subject, 160)}:\n${dataBlock(nonce, message.text, 2000)}`)
    .join("\n");
}

export type MailMessage = {
  id: string;
  threadId: string | null;
  from: string;
  subject: string;
  receivedAt: string | null;
  /** Plain text. Untrusted: shown to Vo only inside a data block. */
  text: string;
};

export type MailDraftInput = { to: string; subject: string; body: string; threadId?: string | null };

export type MailDraftResult = { ok: true; draftId: string | null; logId: string | null } | { error: string };

export interface MailProvider {
  id: MailProviderId;
  /** Messages Vo may read: filed to the matter (casevoya) or in the Casevoya label (composio). */
  listMessages(input: { limit: number }): Promise<MailMessage[]>;
  /** Saves a draft for the staff member to send themselves. Casevoya mail has no drafts. */
  createDraft(input: MailDraftInput): Promise<MailDraftResult>;
}

export type StaffMailChoice = {
  /** The staff member's active Composio mail connection, if any. */
  connected: "gmail" | "outlook" | null;
  /** The owner has turned connected accounts on for the firm. */
  firmAllowsComposio: boolean;
  /** COMPOSIO_API_KEY is set where the adapter runs. */
  composioConfigured: boolean;
};

/**
 * Which provider serves a thread: a conversation that arrived through Casevoya (portal message or
 * Casevoya email) stays on Casevoya; Composio only when the staff member chose it, connected it,
 * the firm allows it and the key is configured. Otherwise Casevoya.
 */
export function selectMailProvider(choice: StaffMailChoice, origin: "casevoya" | "external"): MailProviderId {
  if (origin === "casevoya") return "casevoya";
  return choice.connected && choice.firmAllowsComposio && choice.composioConfigured ? "composio" : "casevoya";
}
