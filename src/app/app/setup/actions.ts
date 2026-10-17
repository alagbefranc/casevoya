"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import {
  declareCredentialInputSchema,
  firmSetupDbPayload,
  normalizeCollegeId,
  officeInputSchema,
  reassignInputSchema,
  sampleProofInputSchema,
  setupStepInputSchema,
} from "@/modules/firm-onboarding";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";

export type SetupActionState = { error?: string; id?: string } | null;

async function signedInClient(organizationId: string, code: string) {
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { supabase, error: "Sign in first." as const };
  const verified = await verifyTotpCode(supabase, code);
  if (!verified.ok) return { supabase, error: verified.error };
  return { supabase, error: null };
}

export async function completeFirmSetupStep(input: unknown): Promise<SetupActionState> {
  const parsed = setupStepInputSchema.safeParse(input);
  if (!parsed.success) return { error: "That setup step is incomplete." };
  const { supabase, error: authError } = await signedInClient(parsed.data.organizationId, parsed.data.code);
  if (authError) return { error: authError };
  const { error } = await supabase.rpc("save_firm_setup", {
    p_step: parsed.data.payload.step,
    p_payload: firmSetupDbPayload(parsed.data.payload) as Json,
  });
  if (error) return { error: safeAccessError(error.message) };
  return {};
}

export async function saveFirmOffice(input: unknown): Promise<SetupActionState> {
  const parsed = officeInputSchema.safeParse(input);
  if (!parsed.success) return { error: "That office address is incomplete." };
  const { supabase, error: authError } = await signedInClient(parsed.data.organizationId, parsed.data.code);
  if (authError) return { error: authError };
  const { data, error } = await supabase.rpc("save_organization_office", {
    p_label: parsed.data.label,
    p_address_line: parsed.data.addressLine,
    p_locality: parsed.data.locality,
    p_region: parsed.data.region ?? "",
    p_postal_code: parsed.data.postalCode ?? "",
    p_country_code: parsed.data.countryCode,
    p_is_primary: parsed.data.isPrimary,
  });
  if (error || typeof data !== "string") return { error: safeAccessError(error?.message ?? "") };
  return { id: data };
}

export async function declareConsultantLicence(input: unknown): Promise<SetupActionState> {
  const parsed = declareCredentialInputSchema.safeParse(input);
  if (!parsed.success) return { error: "That licence declaration is incomplete." };
  const collegeId = normalizeCollegeId(parsed.data.collegeId);
  if (!collegeId) return { error: "Enter the College ID using letters, digits, or hyphens." };
  const { supabase, error: authError } = await signedInClient(parsed.data.organizationId, parsed.data.code);
  if (authError) return { error: authError };
  const { data, error } = await supabase.rpc("declare_consultant_credential", {
    p_membership_id: parsed.data.membershipId,
    p_licence_type: parsed.data.licenceType,
    p_college_id: collegeId,
    p_scope_note: parsed.data.scopeNote ?? "",
    p_proof_locator: parsed.data.proofLocator,
  });
  if (error || typeof data !== "string") return { error: safeAccessError(error?.message ?? "") };
  return { id: data };
}

export async function completeSampleProof(input: unknown): Promise<SetupActionState> {
  const parsed = sampleProofInputSchema.safeParse(input);
  if (!parsed.success) return { error: "That sample proof is incomplete." };
  const { supabase, error: authError } = await signedInClient(parsed.data.organizationId, parsed.data.code);
  if (authError) return { error: authError };
  const { error } = await supabase.rpc("complete_sample_proof", {
    p_step: parsed.data.step,
    p_matter_id: parsed.data.matterId,
  });
  if (error) return { error: safeAccessError(error.message) };
  return {};
}

export async function reassignConsultantMatters(input: unknown): Promise<SetupActionState> {
  const parsed = reassignInputSchema.safeParse(input);
  if (!parsed.success) return { error: "That reassignment is incomplete." };
  const { supabase, error: authError } = await signedInClient(parsed.data.organizationId, parsed.data.code);
  if (authError) return { error: authError };
  const { error } = await supabase.rpc("reassign_consultant_matters", {
    p_from_membership: parsed.data.fromMembershipId,
    p_to_membership: parsed.data.toMembershipId,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: safeAccessError(error.message) };
  return {};
}
