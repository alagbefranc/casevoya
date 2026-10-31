"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { cleanStages, workflowError, workflowProblem, type WorkflowStageInput } from "@/modules/sheet/workflows-present";
import type { Json } from "@/types/database.types";

/**
 * Firm workflows (2026-10-30). Each call acts as the signed-in member; the database functions
 * check the role (firm owner or licensed consultant), the firm, the row version and every field,
 * and write the audit log.
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
  return row && typeof row.id === "string" && typeof row.version === "number" ? { id: row.id, version: row.version } : { error: "The workflow wasn’t saved. Try again." };
}

export async function saveFirmWorkflow(input: {
  organizationId: string;
  workflowId: string | null;
  expectedVersion: number | null;
  name: string;
  programKey: string;
  description: string;
  stages: WorkflowStageInput[];
}): Promise<Saved> {
  if (input.workflowId && !isUuid(input.workflowId)) return { error: "Choose a workflow." };
  if (input.programKey && !/^[a-z0-9_]{1,80}$/.test(input.programKey)) return { error: "Choose a program." };
  const stages = cleanStages(input.stages ?? []);
  const problem = workflowProblem(input.name ?? "", stages);
  if (problem) return { error: problem };
  const open = await session(input.organizationId);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { data, error } = await open.supabase.rpc("save_firm_workflow", {
    p_workflow_id: (input.workflowId ?? null) as unknown as string,
    p_expected_version: (input.workflowId ? input.expectedVersion : null) as unknown as number,
    p_name: input.name.trim(),
    p_program_key: (input.programKey || null) as unknown as string,
    p_description: (input.description.trim() || null) as unknown as string,
    p_stages: stages as unknown as Json,
  });
  if (error) return { error: workflowError(error.message) };
  return readSaved(data);
}

export async function copySharedTemplateToWorkflow(input: { organizationId: string; versionId: string }): Promise<Saved> {
  if (!isUuid(input.versionId)) return { error: "Choose a shared template." };
  const open = await session(input.organizationId);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { data, error } = await open.supabase.rpc("copy_shared_template_to_workflow", { p_version_id: input.versionId });
  if (error) return { error: workflowError(error.message) };
  return readSaved(data);
}

export async function setFirmWorkflowArchived(input: { organizationId: string; workflowId: string; expectedVersion: number; archived: boolean }): Promise<Saved> {
  if (!isUuid(input.workflowId)) return { error: "Choose a workflow." };
  const open = await session(input.organizationId);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { data, error } = await open.supabase.rpc("set_firm_workflow_archived", {
    p_workflow_id: input.workflowId,
    p_expected_version: input.expectedVersion,
    p_archived: Boolean(input.archived),
  });
  if (error) return { error: workflowError(error.message) };
  return readSaved(data);
}
