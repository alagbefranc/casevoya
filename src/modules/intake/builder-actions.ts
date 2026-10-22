"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { readSchema } from "@/modules/sheet/intake-builder-present";
import type { Json } from "@/types/database.types";

/**
 * The Intake form builder. Each call acts as the signed-in user: public.save_intake_draft (firm
 * owner, licensed consultant or case manager at aal2) and public.publish_intake_draft (licensed,
 * recent step-up) and public.withdraw_intake_form (the same as publishing) decide. A published
 * version is never changed.
 */
export type BuilderResult = { ok: true; id?: string; version?: number } | { error: string; stepUp?: boolean; conflict?: boolean };

function refused(message: string): { error: string; stepUp?: boolean; conflict?: boolean } {
  if (/step-up/i.test(message)) return { error: "Confirm it’s you with your authenticator, then publish again.", stepUp: true };
  if (/conflict/i.test(message)) return { error: "This form changed somewhere else. The latest version is shown now.", conflict: true };
  if (/never changed/i.test(message)) return { error: "A published version can’t change. Your edit starts a new draft.", conflict: true };
  if (/schema is not usable/i.test(message)) return { error: "Each field needs a label, and the form needs at least one field." };
  if (/already deleted/i.test(message)) return { error: "This form was already deleted.", conflict: true };
  if (/licensed consultant|staff access denied/i.test(message)) return { error: "Only a licensed consultant can publish or delete a form." };
  if (/denied/i.test(message)) return { error: "You can’t change intake forms." };
  return { error: safeAccessError(message) };
}

async function signedIn(organizationId: string) {
  if (!isUuid(organizationId)) return null;
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  return claims?.claims?.sub ? supabase : null;
}

export async function saveIntakeDraft(input: {
  organizationId: string;
  stableKey: string;
  title: string;
  schema: unknown;
  templateId: string | null;
  version: number | null;
}): Promise<BuilderResult> {
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const schema = readSchema(input.schema);
  if (schema.fields.length === 0) return { error: "Add at least one field." };
  const { data, error } = await supabase.rpc("save_intake_draft", {
    p_stable_key: input.stableKey,
    p_title: input.title,
    p_schema: JSON.parse(JSON.stringify(schema)) as Json,
    p_template_id: input.templateId && isUuid(input.templateId) ? input.templateId : null,
    p_expected_version: input.templateId ? input.version : null,
  });
  if (error) return refused(error.message);
  const saved = data as { id?: unknown; version?: unknown } | null;
  return { ok: true, id: typeof saved?.id === "string" ? saved.id : undefined, version: typeof saved?.version === "number" ? saved.version : undefined };
}

export async function publishIntakeDraft(input: { organizationId: string; templateId: string; version: number }): Promise<BuilderResult> {
  if (!isUuid(input.templateId)) return { error: "Change a field first: your edit starts the next version as a draft." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("publish_intake_draft", { p_template_id: input.templateId, p_expected_version: input.version });
  return error ? refused(error.message) : { ok: true };
}

/**
 * Delete form: the form's published version can no longer be sent and its draft is removed.
 * Matters that already use a version keep it.
 */
export async function withdrawIntakeForm(input: { organizationId: string; stableKey: string }): Promise<BuilderResult> {
  if (!/^[a-z][a-z0-9_]{1,80}$/.test(input.stableKey)) return { error: "Choose a form." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("withdraw_intake_form", { p_stable_key: input.stableKey });
  return error ? refused(error.message) : { ok: true };
}
