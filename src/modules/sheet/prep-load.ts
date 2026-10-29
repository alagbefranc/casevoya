import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { presentBundle, presentFormReview, type MatterBundleData, type MatterFormsData } from "@/modules/sheet/prep-present";

type Client = Awaited<ReturnType<typeof createClient>>;

export async function loadMatterForms(
  supabase: Client,
  input: { organizationId: string; matterId: string; today: string; role: string; licensed: boolean },
): Promise<MatterFormsData | null> {
  const { data, error } = await supabase.rpc("form_mapping_review", { p_matter_id: input.matterId });
  if (error) return null;
  return presentFormReview(data, input);
}

export async function loadMatterBundle(
  supabase: Client,
  input: { organizationId: string; matterId: string; role: string },
): Promise<MatterBundleData | null> {
  const { data, error } = await supabase.rpc("bundle_index", { p_matter_id: input.matterId });
  if (error) return null;
  return presentBundle(data, input);
}
