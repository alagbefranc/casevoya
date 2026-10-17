"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import type { Database, Json } from "@/types/database.types";

type Workflow = Database["public"]["Enums"]["intake_workflow_category"];
type Presence = Database["public"]["Enums"]["answer_presence"];

const WORKFLOWS: readonly Workflow[] = [
  "temporary_residence",
  "study",
  "work",
  "permanent_residence",
  "sponsorship",
  "citizenship",
  "provincial",
  "unspecified",
];

const PRESENCE: readonly Presence[] = ["provided", "unknown", "not_applicable", "approximate"];

async function clientFor(organizationId: string, code: string | null) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." as const };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." as const };
  if (code != null) {
    const verified = await verifyTotpCode(supabase, code);
    if (!verified.ok) return { error: verified.error };
  }
  return { supabase };
}

export async function saveIntakeTemplate(input: {
  organizationId: string;
  stableKey: string;
  title: string;
  locale: "en-CA" | "fr-CA";
  workflowCategory: string;
  schema: Json;
  publish: boolean;
  effectiveOn?: string | null;
  rulePackVersionId?: string | null;
  code?: string | null;
}) {
  if (!WORKFLOWS.includes(input.workflowCategory as Workflow)) return { error: "Choose a workflow bucket." };
  if (input.rulePackVersionId && !isUuid(input.rulePackVersionId)) return { error: "Choose a published program pack." };
  const session = await clientFor(input.organizationId, input.publish ? (input.code ?? "") : null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("save_intake_template", {
    p_stable_key: input.stableKey,
    p_title: input.title,
    p_locale: input.locale,
    p_workflow_category: input.workflowCategory as Workflow,
    p_schema: input.schema,
    p_publish: input.publish,
    p_effective_on: input.effectiveOn ?? null,
    p_rule_pack_version_id: input.rulePackVersionId ?? null,
  });
  if (error) return { error: safeAccessError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "The intake template was not saved." };
  return { id: data };
}

export async function openIntakeResponse(input: {
  organizationId: string;
  templateId: string;
  matterId: string;
  personId: string;
}) {
  if (!isUuid(input.templateId) || !isUuid(input.matterId) || !isUuid(input.personId)) {
    return { error: "Choose a template, a matter, and a person." };
  }
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("open_intake_response", {
    p_template_id: input.templateId,
    p_matter_id: input.matterId,
    p_person_id: input.personId,
  });
  if (error) return { error: safeAccessError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "The intake was not opened." };
  return { id: data };
}

/** Portal clients and staff both save here. A portal answer does not ask for a staff code. */
export async function saveIntakeAnswer(input: {
  organizationId: string;
  responseId: string;
  expectedVersion: number;
  fieldKey: string;
  presence: string;
  value: Json;
}) {
  if (!isUuid(input.responseId) || !PRESENCE.includes(input.presence as Presence)) {
    return { error: "Choose an intake answer." };
  }
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("save_intake_answer", {
    p_response_id: input.responseId,
    p_expected_version: input.expectedVersion,
    p_field_key: input.fieldKey,
    p_presence: input.presence as Presence,
    p_value: input.value,
  });
  if (error) return { error: safeAccessError(error.message) };
  if (typeof data !== "string" || !isUuid(data)) return { error: "The answer was not saved." };
  return { id: data };
}

export async function submitIntakeResponse(input: {
  organizationId: string;
  responseId: string;
  expectedVersion: number;
}) {
  if (!isUuid(input.responseId)) return { error: "Choose an intake." };
  const session = await clientFor(input.organizationId, null);
  if ("error" in session) return { error: session.error };
  const { data, error } = await session.supabase.rpc("submit_intake_response", {
    p_response_id: input.responseId,
    p_expected_version: input.expectedVersion,
  });
  if (error) return { error: safeAccessError(error.message) };
  return { version: data };
}

export async function freezeIntakeResponse(input: { organizationId: string; responseId: string; code: string }) {
  if (!isUuid(input.responseId)) return { error: "Choose an intake." };
  const session = await clientFor(input.organizationId, input.code);
  if ("error" in session) return { error: session.error };
  const { error } = await session.supabase.rpc("freeze_intake_response", { p_response_id: input.responseId });
  if (error) return { error: safeAccessError(error.message) };
  return { ok: true as const };
}
