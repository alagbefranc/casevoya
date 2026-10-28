"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { ruleUpgradeError } from "@/modules/sheet/rule-pin-present";

/**
 * SRC-05: accept or decline a newer approved rule pack for a matter. public.decide_matter_rule_upgrade
 * checks the role (licensed consultant or firm owner), the step-up for an accept, the matter
 * version and that the pack is the newer approved version, records the decision with its impact
 * preview, and audits it. Accept moves the pin; decline leaves the matter as it is.
 */
export async function decideRuleUpgrade(input: {
  organizationId: string;
  matterId: string;
  packId: string;
  version: number;
  decision: "accepted" | "declined";
  reason: string;
}): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.organizationId) || !isUuid(input.matterId) || !isUuid(input.packId) || !Number.isInteger(input.version)) {
    return { error: "Reload the page and try again." };
  }
  if (input.decision !== "accepted" && input.decision !== "declined") return { error: "Reload the page and try again." };
  const reason = input.reason.replace(/\s+/g, " ").trim();
  if (reason.length < 3 || reason.length > 500) return { error: "Say why, in 3 to 500 characters." };
  const supabase = await createClient({ organizationId: input.organizationId });
  const { error } = await supabase.rpc("decide_matter_rule_upgrade", {
    p_matter_id: input.matterId,
    p_to_pack_id: input.packId,
    p_expected_version: input.version,
    p_decision: input.decision,
    p_reason: reason,
  });
  if (error) return { error: ruleUpgradeError(error.message) };
  return { ok: true };
}
