"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { createClient } from "@/lib/supabase/server";
import { loadSheetAccess } from "@/modules/sheet/load";
import { switchToLiveRefusal } from "@/modules/sheet/setup-present";
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

/**
 * Takes the firm out of sample mode (public.set_sample_mode(false)). The database decides: it
 * needs the firm owner with a recent step-up and refuses while app.real_client_invite_blockers
 * lists anything. The change is audited there (firm.sample_mode_changed).
 */
export async function switchToLive(): Promise<{ ok: true } | { error: string; stepUp: boolean }> {
  const access = await loadSheetAccess();
  if (access.kind === "live") return { ok: true };
  if (access.kind !== "sample") return { error: "Sign in to your firm first.", stepUp: false };
  if (access.staff.role !== "firm_owner") return { error: "Only the firm owner can switch the firm to live.", stepUp: false };
  const supabase = await createClient({ organizationId: access.staff.organizationId });
  const { error } = await supabase.rpc("set_sample_mode", { p_enabled: false });
  if (error) return switchToLiveRefusal(error.message);
  return { ok: true };
}
