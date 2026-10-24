import "server-only";
import type Stripe from "stripe";
import type { createClient } from "@/lib/supabase/server";
import { publishableKey } from "@/modules/finance/keys";
import { accountNeedsRefresh, connectAccountFromRow, type ConnectAccount, type FinanceAccountData } from "@/modules/finance/connect-present";
import { retrieveAccountStatus, syncStatusArgs } from "@/modules/finance/stripe-account";
import type { SheetStaff } from "@/modules/sheet/load";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const BILLING_ROLES = new Set(["firm_owner", "finance_user"]);

export type FirmAccountRow = { account_id: string; card_payments_status: string; payouts_status: string; requirements_due: number };

/**
 * The firm's Stripe connected account for the Finance page and Settings (FIN-02), read as the
 * signed-in staff member (RLS: the firm owner and finance users). For the owner, the cached status
 * is read again from Stripe (test-mode key) when it isn't finished, was never read, or is over an
 * hour old, and stored through public.sync_firm_payment_account_status. A Stripe failure keeps the
 * cached status. One read, one card: Settings and Finance both use this.
 */
export async function loadFirmAccount(
  supabase: Supabase,
  staff: SheetStaff,
  stripe: Stripe | null,
): Promise<{ row: FirmAccountRow | null; data: FinanceAccountData }> {
  const org = staff.organizationId;
  const canBill = BILLING_ROLES.has(staff.role);
  const read = await supabase
    .from("firm_payment_accounts")
    .select("account_id, card_payments_status, payouts_status, requirements_due, requirements, fees_collector, losses_collector, status_checked_at")
    .eq("organization_id", org)
    .maybeSingle();
  let row = read.data;
  let account: ConnectAccount | null = row ? connectAccountFromRow(row) : null;
  if (row && account && staff.role === "firm_owner" && stripe && accountNeedsRefresh(account, new Date())) {
    try {
      const status = await retrieveAccountStatus(stripe, row.account_id);
      if (!status.livemode) {
        const synced = await supabase.rpc("sync_firm_payment_account_status", syncStatusArgs(org, row.account_id, status));
        if (!synced.error) {
          row = {
            ...row,
            card_payments_status: status.cardPayments,
            payouts_status: status.payouts,
            requirements_due: status.requirements.length,
            requirements: status.requirements,
            fees_collector: status.feesCollector ?? row.fees_collector,
            losses_collector: status.lossesCollector ?? row.losses_collector,
            status_checked_at: new Date().toISOString(),
          };
          account = connectAccountFromRow(row);
        }
      }
    } catch {
      // Stripe unreachable: the cached status stays.
    }
  }
  const pk = publishableKey();
  return {
    row: row
      ? { account_id: row.account_id, card_payments_status: row.card_payments_status, payouts_status: row.payouts_status, requirements_due: row.requirements_due }
      : null,
    data: {
      organizationId: org,
      firmName: staff.organizationName,
      isOwner: staff.role === "firm_owner",
      configured: Boolean(stripe && pk),
      publishableKey: pk,
      account,
      canBill,
    },
  };
}
