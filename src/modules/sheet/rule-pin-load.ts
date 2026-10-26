import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { matterRulePin, type MatterRulePinData, type MatterRuleState } from "@/modules/sheet/rule-pin-present";

type Client = Awaited<ReturnType<typeof createClient>>;

const DECIDERS = new Set(["firm_owner", "licensed_consultant"]);

/** SRC-05: the matter overview's pinned rule pack and forms, read through public.matter_rule_state. */
export async function loadMatterRulePin(
  supabase: Client,
  input: { organizationId: string; matterId: string; timeZone: string; role: string; closed: boolean },
): Promise<MatterRulePinData | null> {
  const { data, error } = await supabase.rpc("matter_rule_state", { p_matter_id: input.matterId });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
  return matterRulePin(data as MatterRuleState, {
    organizationId: input.organizationId,
    matterId: input.matterId,
    timeZone: input.timeZone,
    canDecide: DECIDERS.has(input.role) && !input.closed,
  });
}
