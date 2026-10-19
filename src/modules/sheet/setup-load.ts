import "server-only";
import { cookies } from "next/headers";
import type { createClient } from "@/lib/supabase/server";
import type { SheetStaff } from "@/modules/sheet/load";
import { SETUP_BANNER_COOKIE, progressLine, setupState, type SetupBannerData, type SetupState } from "@/modules/sheet/setup-present";

type Client = Awaited<ReturnType<typeof createClient>>;

export type SheetSetup = { state: SetupState; banner: SetupBannerData };

/**
 * Where a sample-mode firm stands on going live, read as the signed-in staff member (every
 * staff role can read these rows). Null for a live firm.
 */
export async function loadSheetSetup(supabase: Client, staff: SheetStaff): Promise<SheetSetup | null> {
  if (!staff.sampleMode) return null;
  const org = staff.organizationId;
  const [firm, credentials, subscription, proofs, jar] = await Promise.all([
    supabase.from("organizations").select("verification_status").eq("id", org).maybeSingle(),
    supabase
      .from("consultant_credentials")
      .select("status, verification_method, register_status, entitlement_to_practise, discipline_suspended, discipline_revoked, membership_id")
      .eq("organization_id", org),
    supabase.from("organization_subscriptions").select("status").eq("organization_id", org).maybeSingle(),
    supabase.from("sample_proof_steps").select("step").eq("organization_id", org),
    cookies(),
  ]);
  const holderIds = [...new Set((credentials.data ?? []).map((row) => row.membership_id))];
  const holders = holderIds.length ? await supabase.from("memberships").select("id, role, status").eq("organization_id", org).in("id", holderIds) : null;
  const holder = new Map((holders?.data ?? []).map((row) => [row.id, row]));

  const state = setupState({
    verificationStatus: firm.data?.verification_status ?? null,
    credentials: (credentials.data ?? []).map((row) => ({
      status: row.status,
      verificationMethod: row.verification_method,
      registerStatus: row.register_status,
      entitlementToPractise: row.entitlement_to_practise,
      disciplineSuspended: row.discipline_suspended,
      disciplineRevoked: row.discipline_revoked,
      holderRole: holder.get(row.membership_id)?.role ?? null,
      holderStatus: holder.get(row.membership_id)?.status ?? null,
    })),
    subscriptionStatus: subscription.data?.status ?? null,
    proofs: (proofs.data ?? []).map((row) => row.step as string),
  });
  return {
    state,
    banner: { firmName: staff.organizationName, progress: progressLine(state), collapsed: jar.get(SETUP_BANNER_COOKIE)?.value === "collapsed" },
  };
}
