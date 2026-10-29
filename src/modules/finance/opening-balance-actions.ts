"use server";

import { safeAccessError } from "@/lib/auth/step-up";
import { verifyTotpCode } from "@/lib/auth/verify-totp";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/tenant/context";
import { openingBalanceError } from "@/modules/sheet/opening-balance-present";

/**
 * MIG-03: finance review of an imported opening balance. The database checks the role,
 * the step-up and the lock. Approval records the decision only: nothing is posted.
 */

async function session(organizationId: string, code: string) {
  if (!isUuid(organizationId)) return { error: "Choose a firm." };
  const supabase = await createClient({ organizationId });
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { error: "Sign in first." };
  const verified = await verifyTotpCode(supabase, code);
  if (!verified.ok) return { error: verified.error };
  return { supabase };
}

function failed(message: string): { error: string } {
  return { error: /step-up/i.test(message) ? safeAccessError(message) : openingBalanceError(message) };
}

export async function reviewOpeningBalance(input: {
  organizationId: string;
  id: string;
  approve: boolean;
  note: string;
  code: string;
}): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.id)) return { error: "Choose a balance." };
  const open = await session(input.organizationId, input.code);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { error } = await open.supabase.rpc("review_opening_balance", {
    p_org: input.organizationId,
    p_id: input.id,
    p_approve: input.approve,
    p_note: input.note,
  });
  if (error) return failed(error.message);
  return { ok: true };
}

export async function correctOpeningBalance(input: {
  organizationId: string;
  id: string;
  expectedVersion: number;
  kind: "receivable" | "advance";
  amountCents: number;
  currency: string;
  asOf: string;
  description: string;
  reason: string;
  code: string;
}): Promise<{ ok: true } | { error: string }> {
  if (!isUuid(input.id)) return { error: "Choose a balance." };
  const open = await session(input.organizationId, input.code);
  if ("error" in open) return { error: open.error ?? "Sign in first." };
  const { error } = await open.supabase.rpc("correct_opening_balance", {
    p_org: input.organizationId,
    p_id: input.id,
    p_expected_version: input.expectedVersion,
    p_kind: input.kind,
    p_amount_cents: input.amountCents,
    p_currency: input.currency,
    p_as_of: input.asOf,
    p_description: input.description,
    p_reason: input.reason,
  });
  if (error) return failed(error.message);
  return { ok: true };
}
