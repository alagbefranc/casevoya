"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { announcementError } from "@/modules/sheet/announcements-present";
import { templateError } from "./templates";

type Result<T extends object = object> = ({ ok: true } & T) | { error: string };

/**
 * Templates > Message templates: save a firm template (a new one, or an edit, which makes it a
 * draft again). The database checks the role, the lengths and the merge fields.
 */
export async function saveMessageTemplate(input: {
  organizationId: string;
  templateId: string | null;
  useFor: "message" | "announcement";
  name: string;
  title: string | null;
  body: string;
  expectedVersion: number | null;
}): Promise<Result<{ id: string; version: number }>> {
  if (!isUuid(input.organizationId) || (input.templateId && !isUuid(input.templateId))) return { error: "Choose a template." };
  if (input.useFor !== "message" && input.useFor !== "announcement") return { error: "Choose what the template is for." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("save_message_template", {
    p_organization_id: input.organizationId,
    p_template_id: input.templateId,
    p_use_for: input.useFor,
    p_name: input.name ?? "",
    p_title: input.useFor === "announcement" ? (input.title ?? "") : null,
    p_body: input.body ?? "",
    p_expected_version: input.expectedVersion,
  });
  if (error) return { error: templateError(error.message) };
  const row = (data ?? {}) as { id?: string; version?: number };
  if (!row.id) return { error: templateError("") };
  return { ok: true, id: row.id, version: Number(row.version ?? 1) };
}

/** A firm owner or licensed consultant approves the draft they read (its version). */
export async function approveMessageTemplate(input: { organizationId: string; templateId: string; version: number }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.templateId)) return { error: "Choose a template." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("approve_message_template", {
    p_organization_id: input.organizationId,
    p_template_id: input.templateId,
    p_expected_version: input.version,
  });
  if (error) return { error: templateError(error.message) };
  return { ok: true };
}

export async function archiveMessageTemplate(input: { organizationId: string; templateId: string }): Promise<Result> {
  if (!isUuid(input.organizationId) || !isUuid(input.templateId)) return { error: "Choose a template." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("archive_message_template", { p_organization_id: input.organizationId, p_template_id: input.templateId });
  if (error) return { error: templateError(error.message) };
  return { ok: true };
}

/**
 * Inbox > Announcements: send an approved announcement template to all active clients or one
 * program's. The database checks the sender's role, the template, the audience, the rate limit
 * and sample mode, and audits it.
 */
export async function sendAnnouncement(input: {
  organizationId: string;
  templateId: string;
  version: number;
  programKey: string | null;
}): Promise<Result<{ recipients: number; emailed: number }> | { rateLimited: true; retryAt: string | null }> {
  if (!isUuid(input.organizationId) || !isUuid(input.templateId) || !Number.isInteger(input.version)) return { error: "Choose an approved announcement template." };
  const programKey = input.programKey && /^[A-Za-z0-9_.:-]{1,200}$/.test(input.programKey) ? input.programKey : null;
  if (input.programKey && !programKey) return { error: "Choose an audience." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { data, error } = await supabase.rpc("send_announcement", {
    p_organization_id: input.organizationId,
    p_template_id: input.templateId,
    p_template_version: input.version,
    p_program_key: programKey,
  });
  if (error) return { error: announcementError(error.message) };
  const row = (data ?? {}) as { rate_limited?: boolean; retry_at?: string; recipients?: number; emailed?: number };
  if (row.rate_limited) return { rateLimited: true, retryAt: typeof row.retry_at === "string" ? row.retry_at : null };
  return { ok: true, recipients: Number(row.recipients ?? 0), emailed: Number(row.emailed ?? 0) };
}
