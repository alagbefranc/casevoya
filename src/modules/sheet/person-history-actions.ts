"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { historyError } from "@/modules/sheet/person-history-present";
import type { Json } from "@/types/database.types";

/**
 * INT-05: a person's other names, passports and addresses, and resolving a review flag. Each call
 * acts as the signed-in member; public.record_person_identity and public.resolve_person_flag check
 * the role, the person and the fields.
 */

async function signedIn(organizationId: string) {
  if (!isUuid(organizationId)) return null;
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  return claims?.claims?.sub ? supabase : null;
}

export async function recordPersonIdentity(input: {
  organizationId: string;
  personId: string;
  kind: string;
  data: Record<string, unknown>;
  replacesId?: string | null;
  retire?: boolean;
}): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.personId) || (input.replacesId && !isUuid(input.replacesId))) return { error: "Choose a person." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("record_person_identity", {
    p_person_id: input.personId,
    p_kind: input.kind,
    p_data: input.data as Json,
    ...(input.replacesId ? { p_replaces_id: input.replacesId } : {}),
    p_retire: input.retire === true,
  });
  return error ? { error: historyError(error.message) } : { ok: true };
}

export async function resolvePersonFlag(input: { organizationId: string; personId: string; flagKey: string; detail: string; note: string }): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.personId)) return { error: "Choose a person." };
  if (!input.note.trim()) return { error: "Say why this is fine." };
  const supabase = await signedIn(input.organizationId);
  if (!supabase) return { error: "Sign in first." };
  const { error } = await supabase.rpc("resolve_person_flag", { p_person_id: input.personId, p_flag_key: input.flagKey, p_detail: input.detail, p_note: input.note });
  return error ? { error: historyError(error.message) } : { ok: true };
}
