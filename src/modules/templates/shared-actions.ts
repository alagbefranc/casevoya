"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { sharedTemplateError } from "@/modules/sheet/shared-template-present";
import type { Json } from "@/types/database.types";

/**
 * ADM-03 firm actions. Drafting and publishing stay on the admin portal's calls.
 * The database checks the role and, for a firm override, the step-up.
 */

async function session(organizationId: string, code: string | null) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  if (code) {
    const verified = await verifyTotpCode(supabase, code);
    if (!verified.ok) return { error: verified.error };
  }
  return { supabase };
}

function failed(message: string): { error: string } {
  return { error: /step-up/i.test(message) ? safeAccessError(message) : sharedTemplateError(message) };
}

export async function adoptSharedTemplate(input: { organizationId: string; versionId: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.versionId)) return { error: "Choose a version." };
  const open = await session(input.organizationId, null);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { error } = await open.supabase.rpc("adopt_shared_template", { p_version_id: input.versionId });
  if (error) return failed(error.message);
  return { ok: true };
}

export async function saveFirmTemplateOverride(input: {
  organizationId: string;
  templateId: string;
  title: string;
  summary: string;
  items: string[];
  reason: string;
  code: string;
}): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.templateId)) return { error: "Choose a template." };
  const open = await session(input.organizationId, input.code);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { error } = await open.supabase.rpc("save_firm_template_override", {
    p_template_id: input.templateId,
    p_title: input.title,
    p_summary: input.summary,
    p_items: input.items as unknown as Json,
    p_reason: input.reason,
  });
  if (error) return failed(error.message);
  return { ok: true };
}

export async function clearFirmTemplateOverride(input: {
  organizationId: string;
  templateId: string;
  reason: string;
  code: string;
}): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.templateId)) return { error: "Choose a template." };
  const open = await session(input.organizationId, input.code);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { error } = await open.supabase.rpc("clear_firm_template_override", {
    p_template_id: input.templateId,
    p_reason: input.reason,
  });
  if (error) return failed(error.message);
  return { ok: true };
}

export async function pinMatterSharedTemplate(input: {
  organizationId: string;
  matterId: string;
  templateId: string;
}): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.matterId) || !isUuid(input.templateId)) return { error: "Choose a matter and a template." };
  const open = await session(input.organizationId, null);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { error } = await open.supabase.rpc("pin_matter_shared_template", {
    p_matter_id: input.matterId,
    p_template_id: input.templateId,
  });
  if (error) return failed(error.message);
  return { ok: true };
}

export async function dismissSharedTemplateNotice(input: { organizationId: string; noticeId: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.noticeId)) return { error: "Choose a notice." };
  const open = await session(input.organizationId, null);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { error } = await open.supabase.rpc("dismiss_shared_template_notice", { p_notice_id: input.noticeId });
  if (error) return failed(error.message);
  return { ok: true };
}
