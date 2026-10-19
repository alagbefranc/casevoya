import "server-only";
import type { MatterBillingData } from "@/components/sheet/designer/matter";
import { createClient } from "@/lib/supabase/server";
import { matterBilling } from "@/modules/sheet/matter-billing";

type Client = Awaited<ReturnType<typeof createClient>>;

export const BILLING_INVOICE_COLUMNS = "number, amount_cents, paid_cents, credited_cents, refunded_cents, status, issued_on, due_on, fee_category, currency, is_sample";

/**
 * The matter's Billing tab: its invoices and client-fund entries, read as the signed-in staff
 * member. Row-level security decides (app.can_read_invoice, app.can_read_matter_billing: the firm
 * owner and the matter's finance user), so someone else reads nothing and is told who can.
 */
export async function loadMatterBilling(
  supabase: Client,
  input: { organizationId: string; matterId: string; today: string; role: string },
): Promise<MatterBillingData> {
  const [invoices, entries] = await Promise.all([
    supabase.from("invoices").select(BILLING_INVOICE_COLUMNS).eq("organization_id", input.organizationId).eq("matter_id", input.matterId).order("issued_on", { ascending: false }).limit(200),
    supabase.from("client_fund_entries").select("kind, status, direction, amount_cents").eq("organization_id", input.organizationId).eq("matter_id", input.matterId).limit(1000),
  ]);
  return matterBilling({
    invoices: invoices.data ?? [],
    entries: entries.data ?? [],
    today: input.today,
    hidden: input.role !== "firm_owner" && input.role !== "finance_user",
  });
}
