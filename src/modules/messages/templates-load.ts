import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { memberNames } from "@/modules/sheet/chrome-load";
import type { MessageTemplateOption } from "./templates";

type Client = Awaited<ReturnType<typeof createClient>>;

/** The firm's approved templates for one use, by name (RLS: firm staff). */
export async function approvedTemplates(supabase: Client, org: string, useFor: "message" | "announcement") {
  const { data } = await supabase
    .from("message_templates")
    .select("id, name, title, body, version")
    .eq("organization_id", org)
    .eq("use_for", useFor)
    .eq("status", "approved")
    .order("name")
    .limit(100);
  return data ?? [];
}

/** Approved message templates as the composer offers them. */
export async function messageTemplateOptions(supabase: Client, org: string): Promise<MessageTemplateOption[]> {
  return (await approvedTemplates(supabase, org, "message")).map((row) => ({ id: row.id, name: row.name, body: row.body }));
}

/**
 * Each matter's responsible consultant's name, or null when none is set or their name isn't on
 * their profile (the merge field then stays a gap to fill).
 */
export async function consultantNames(supabase: Client, org: string, matters: { id: string; responsible_consultant_membership_id: string | null }[]) {
  const wanted = matters.filter((row) => row.responsible_consultant_membership_id);
  const names = wanted.length ? await memberNames(supabase, org) : new Map<string, string>();
  const out = new Map<string, string | null>();
  for (const row of matters) {
    const name = row.responsible_consultant_membership_id ? names.get(row.responsible_consultant_membership_id) : undefined;
    out.set(row.id, name && name !== "Unassigned" ? name : null);
  }
  return out;
}
