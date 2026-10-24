"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { checklistError, readProposals, type ChecklistItemInput, type ChecklistProposals } from "@/modules/sheet/checklist-present";
import type { Json } from "@/types/database.types";

/**
 * DOC-01: firm checklist templates and Apply checklist. Each call acts as the signed-in member;
 * the database functions check the role, the matter and the step-up.
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

export async function saveChecklistTemplate(input: { organizationId: string; templateId: string | null; stableKey: string; title: string; items: ChecklistItemInput[] }): Promise<{ id: string } | { error: string }> {
  if (input.templateId && !isUuid(input.templateId)) return { error: "Choose a checklist." };
  const open = await session(input.organizationId, null);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { data, error } = await open.supabase.rpc("save_checklist_template", {
    p_template_id: input.templateId as string,
    p_stable_key: input.stableKey,
    p_title: input.title,
    p_items: input.items as unknown as Json,
  });
  if (error) return { error: checklistError(error.message) };
  return typeof data === "string" ? { id: data } : { error: "The checklist was not saved." };
}

export async function approveChecklistTemplate(input: { organizationId: string; templateId: string; expectedVersion: number; code: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.templateId)) return { error: "Choose a checklist." };
  const open = await session(input.organizationId, input.code || null);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { error } = await open.supabase.rpc("approve_checklist_template", { p_template_id: input.templateId, p_expected_version: input.expectedVersion });
  if (error) return { error: /step-up/i.test(error.message) ? safeAccessError(error.message) : checklistError(error.message) };
  return { ok: true };
}

export async function previewChecklist(input: { organizationId: string; matterId: string; templateId: string }): Promise<{ proposals: ChecklistProposals } | { error: string }> {
  if (!isUuid(input.matterId) || !isUuid(input.templateId)) return { error: "Choose a checklist." };
  const open = await session(input.organizationId, null);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { data, error } = await open.supabase.rpc("checklist_apply_preview", { p_matter_id: input.matterId, p_template_id: input.templateId });
  if (error) return { error: checklistError(error.message) };
  return { proposals: readProposals(data) };
}

export async function applyChecklist(input: {
  organizationId: string;
  matterId: string;
  templateId: string;
  add: { itemId: string; personId: string }[];
  remove: string[];
  code: string;
}): Promise<{ created: number; cancelled: number } | { error: string }> {
  if (!isUuid(input.matterId) || !isUuid(input.templateId) || input.remove.some((id) => !isUuid(id))) return { error: "Choose a checklist." };
  const open = await session(input.organizationId, input.code || null);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { data, error } = await open.supabase.rpc("apply_checklist", {
    p_matter_id: input.matterId,
    p_template_id: input.templateId,
    p_add: input.add.map((row) => ({ item_id: row.itemId, person_id: row.personId })) as unknown as Json,
    p_remove: input.remove,
  });
  if (error) return { error: /step-up/i.test(error.message) ? safeAccessError(error.message) : checklistError(error.message) };
  const result = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return { created: Number(result.created ?? 0), cancelled: Number(result.cancelled ?? 0) };
}
