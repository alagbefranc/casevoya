"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { loadSheetAccess } from "@/modules/sheet/load";
import type { Database } from "@/types/database.types";

type SampleProofStep = Database["public"]["Enums"]["sample_proof_step"];
const STEPS: readonly SampleProofStep[] = ["intake", "agreement", "upload", "reminder", "invoice", "export"];

/** Records one of the six sample proofs on the firm's sample case. */
export async function recordSampleStep(step: string): Promise<{ ok: true } | { error: string }> {
  if (!(STEPS as readonly string[]).includes(step)) return { error: "That isn’t a sample step." };
  const access = await loadSheetAccess();
  if (access.kind !== "sample" && access.kind !== "live") return { error: "Sign in to your firm first." };
  const supabase = await createClient({ organizationId: access.staff.organizationId });
  const { data: matterId, error: caseError } = await supabase.rpc("ensure_sample_case");
  if (caseError || typeof matterId !== "string") return { error: safeAccessError(caseError?.message ?? "") };
  const { error } = await supabase.rpc("complete_sample_proof", { p_step: step as SampleProofStep, p_matter_id: matterId });
  if (error) return { error: safeAccessError(error.message) };
  return { ok: true };
}
