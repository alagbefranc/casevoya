/**
 * The optional Composio mail provider (Gmail / Outlook), for one staff member. Server-side only
 * (it needs COMPOSIO_API_KEY); the session is injected so tests use a fake.
 *
 * - Tools are discovered from a toolkit-scoped session and filtered by composio-policy.ts; there
 *   is no code path that can execute a send, reply or forward tool.
 * - Reading is narrowed to the label/folder the staff member chose ("Casevoya" by default): Gmail
 *   messages are fetched with that label's id only; if the label doesn't exist, nothing is read.
 * - Gmail argument names come from https://docs.composio.dev/toolkits/gmail.md (2026-10-18):
 *   GMAIL_FETCH_EMAILS(label_ids, max_results), GMAIL_LIST_LABELS(), GMAIL_CREATE_EMAIL_DRAFT
 *   (recipient_email, subject, body, is_html, thread_id). Outlook: OUTLOOK_CREATE_DRAFT
 *   (to_recipients, subject, body, is_html) from /toolkits/outlook.md. Outlook listing by folder is
 *   not documented on the page we could read, so Outlook reading reports "not available" rather
 *   than guess an argument name.
 */
import { allowedFor, classifyComposioTool, toolSlugs, type ComposioPurpose } from "../composio-policy";
import type { MailDraftInput, MailDraftResult, MailMessage, MailProvider } from "./provider";

export type ComposioSessionLike = {
  tools(): Promise<unknown>;
  execute(slug: string, args?: Record<string, unknown>): Promise<{ data?: unknown; error?: string | null; logId?: string | null }>;
};

export class ComposioBlockedTool extends Error {}

/** The only way this module runs a Composio tool: discovered, classified, purpose-checked. */
export async function runAllowed(session: ComposioSessionLike, slug: string, purpose: ComposioPurpose, args: Record<string, unknown>) {
  if (!allowedFor(slug, purpose)) throw new ComposioBlockedTool(`${slug} is ${classifyComposioTool(slug)}, not ${purpose}`);
  const available = toolSlugs(await session.tools());
  if (!available.includes(slug)) throw new ComposioBlockedTool(`${slug} is not in this session`);
  return session.execute(slug, args);
}

function pick(slugs: string[], test: (slug: string) => boolean): string | null {
  return slugs.find(test) ?? null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list(value: unknown, ...keys: string[]): unknown[] {
  const record = asRecord(value);
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as unknown[];
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function composioMailProvider(input: { toolkit: "gmail" | "outlook"; label: string; session: () => Promise<ComposioSessionLike> }): MailProvider {
  return {
    id: "composio",
    async listMessages({ limit }): Promise<MailMessage[]> {
      if (input.toolkit !== "gmail") return [];
      const session = await input.session();
      const slugs = toolSlugs(await session.tools());
      const labels = pick(slugs, (s) => s === "GMAIL_LIST_LABELS");
      const fetch = pick(slugs, (s) => s === "GMAIL_FETCH_EMAILS");
      if (!labels || !fetch) return [];
      const labelResult = await runAllowed(session, labels, "read", {});
      const wanted = input.label.trim().toLowerCase();
      const label = list(labelResult.data, "labels")
        .map(asRecord)
        .find((row) => str(row.name).trim().toLowerCase() === wanted);
      // No Casevoya label: nothing is read (never the whole mailbox).
      const labelId = label ? str(label.id) : "";
      if (!labelId) return [];
      const fetched = await runAllowed(session, fetch, "read", { label_ids: [labelId], max_results: Math.min(Math.max(limit, 1), 20) });
      return list(fetched.data, "messages", "emails")
        .map(asRecord)
        .map((row) => ({
          id: str(row.messageId ?? row.id),
          threadId: str(row.threadId ?? row.thread_id) || null,
          from: str(row.sender ?? row.from),
          subject: str(row.subject),
          receivedAt: str(row.messageTimestamp ?? row.date) || null,
          text: str(row.messageText ?? row.preview ?? row.snippet).slice(0, 4000),
        }))
        .filter((row) => row.id);
    },
    async createDraft(draft: MailDraftInput): Promise<MailDraftResult> {
      const session = await input.session();
      const slugs = toolSlugs(await session.tools());
      const slug = pick(slugs, (s) => (input.toolkit === "gmail" ? s === "GMAIL_CREATE_EMAIL_DRAFT" : s === "OUTLOOK_CREATE_DRAFT"));
      if (!slug) return { error: "Saving a draft isn’t available for this mailbox." };
      const args =
        input.toolkit === "gmail"
          ? { recipient_email: draft.to, subject: draft.subject, body: draft.body, is_html: false, ...(draft.threadId ? { thread_id: draft.threadId } : {}) }
          : { to_recipients: [draft.to], subject: draft.subject, body: draft.body, is_html: false };
      const result = await runAllowed(session, slug, "draft", args);
      if (result.error) return { error: "The mailbox didn’t accept the draft. Nothing was sent." };
      const data = asRecord(result.data);
      return { ok: true, draftId: str(data.id ?? data.draftId) || null, logId: result.logId ?? null };
    },
  };
}
