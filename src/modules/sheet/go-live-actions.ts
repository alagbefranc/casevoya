"use server";

import { createClient } from "@/lib/supabase/server";
import { loadSheetAccess } from "@/modules/sheet/load";
import { goLiveRefusal, TEST_CONFIRM } from "@/modules/sheet/go-live-present";

type Result = { ok: true } | { error: string; stepUp: boolean };

async function ownerClient(): Promise<{ client: Awaited<ReturnType<typeof createClient>> } | { error: string; stepUp: boolean }> {
  const access = await loadSheetAccess();
  if (access.kind !== "live" && access.kind !== "sample") return { error: "Sign in to your firm first.", stepUp: false };
  if (access.staff.role !== "firm_owner") return { error: "Only the firm owner can switch the firm.", stepUp: false };
  return { client: await createClient({ organizationId: access.staff.organizationId }) };
}

/**
 * Go live: public.switch_firm_to_live() checks every step again, needs the firm owner with a
 * recent step-up, turns sample mode off and records firm.went_live (also when it refuses).
 */
export async function switchFirmToLive(): Promise<Result> {
  const owner = await ownerClient();
  if ("error" in owner) return owner;
  const { data, error } = await owner.client.rpc("switch_firm_to_live");
  if (error) return goLiveRefusal({ message: error.message });
  const answer = (data ?? {}) as { live?: boolean; missing?: string[] };
  if (answer.live === true) return { ok: true };
  return goLiveRefusal({ missing: Array.isArray(answer.missing) ? answer.missing : [] });
}

/** Back to test mode: the firm owner, a recent step-up and the confirm. Records stay as they are. */
export async function switchFirmToTest(confirmed: boolean): Promise<Result> {
  if (!confirmed) return goLiveRefusal({ message: "confirm switching back to test mode" });
  const owner = await ownerClient();
  if ("error" in owner) return owner;
  const { error } = await owner.client.rpc("switch_firm_to_test", { p_confirm: TEST_CONFIRM });
  if (error) return goLiveRefusal({ message: error.message });
  return { ok: true };
}
