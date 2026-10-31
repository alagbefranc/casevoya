"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { automationError, automationProblem, DEADLINE_KINDS } from "@/modules/sheet/automation-rules";

/**
 * Firm automations (2026-10-30). Each call acts as the signed-in member; the database functions
 * check the role (firm owner or licensed consultant), a recent step-up, the firm, the row version
 * and every field, and write the audit log.
 */

async function session(organizationId: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  return { supabase };
}

type Saved = { id: string; version: number } | { error: string };

function readSaved(data: unknown): Saved {
  const row = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  return row && typeof row.id === "string" && typeof row.version === "number" ? { id: row.id, version: row.version } : { error: "The automation wasn’t saved. Try again." };
}

const KINDS = new Set<string>(DEADLINE_KINDS.map((kind) => kind.key));

export async function saveFirmAutomation(input: {
  organizationId: string;
  automationId: string | null;
  expectedVersion: number | null;
  name: string;
  kinds: string[];
  days: string;
  copiedFromBuiltIn: boolean;
}): Promise<Saved> {
  if (input.automationId && !isUuid(input.automationId)) return { error: "Choose an automation." };
  const kinds = [...new Set((input.kinds ?? []).filter((kind) => KINDS.has(kind)))];
  const checked = automationProblem({ name: input.name ?? "", kinds, days: input.days ?? "" });
  if ("error" in checked) return { error: checked.error };
  const open = await session(input.organizationId);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { data, error } = await open.supabase.rpc("save_firm_automation", {
    p_automation_id: (input.automationId ?? null) as unknown as string,
    p_expected_version: (input.automationId ? input.expectedVersion : null) as unknown as number,
    p_name: input.name.trim(),
    p_deadline_kinds: kinds,
    p_offset_days: checked.days,
    p_copied_from: (!input.automationId && input.copiedFromBuiltIn ? "builtin_deadline_reminders" : null) as unknown as string,
  });
  if (error) return { error: automationError(error.message) };
  return readSaved(data);
}

export async function setFirmAutomationPaused(input: { organizationId: string; automationId: string; expectedVersion: number; paused: boolean }): Promise<Saved> {
  if (!isUuid(input.automationId)) return { error: "Choose an automation." };
  const open = await session(input.organizationId);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { data, error } = await open.supabase.rpc("set_firm_automation_paused", {
    p_automation_id: input.automationId,
    p_expected_version: input.expectedVersion,
    p_paused: Boolean(input.paused),
  });
  if (error) return { error: automationError(error.message) };
  return readSaved(data);
}
