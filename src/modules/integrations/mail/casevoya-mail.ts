import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { MailProvider } from "./provider";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Casevoya's own mail (default): email that arrived through the firm's Casevoya address and was
 * filed to this matter, read with the staff member's own client (RLS, consultant scope). Triage
 * items not yet filed are not read here; their matter matches stay suggestions in the Inbox.
 * Drafts: Casevoya mail has no mailbox drafts; staff replies through Casevoya's sender aren't
 * built yet, so this says so instead of pretending.
 */
export function casevoyaMailProvider(input: { supabase: Client; organizationId: string; matterId: string }): MailProvider {
  return {
    id: "casevoya",
    async listMessages({ limit }) {
      const { data } = await input.supabase
        .from("inbound_emails")
        .select("id, from_email, subject, text_body, created_at")
        .eq("organization_id", input.organizationId)
        .eq("matter_id", input.matterId)
        .order("created_at", { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 20));
      return (data ?? []).map((row) => ({
        id: row.id,
        threadId: null,
        from: row.from_email,
        subject: row.subject ?? "",
        receivedAt: row.created_at,
        text: (row.text_body ?? "").slice(0, 4000),
      }));
    },
    async createDraft() {
      return { error: "Replies from your Casevoya address aren’t available yet. Use the matter’s Messages, or your connected mailbox." };
    },
  };
}
