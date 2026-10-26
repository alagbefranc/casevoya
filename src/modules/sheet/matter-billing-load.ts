import "server-only";
import type { MatterBillingData } from "@/components/sheet/designer/matter";
import { createClient } from "@/lib/supabase/server";
import { LISTED_PAYMENT_STATUSES } from "@/modules/sheet/finance-present";
import { matterBilling } from "@/modules/sheet/matter-billing";
import { isoDateInTimeZone } from "@/modules/sheet/present";
import { latestPayments } from "@/modules/sheet/states-present";

type Client = Awaited<ReturnType<typeof createClient>>;

export const BILLING_INVOICE_COLUMNS = "number, amount_cents, paid_cents, credited_cents, refunded_cents, status, issued_on, due_on, fee_category, currency, is_sample";

/**
 * The matter's Billing tab: its invoices and client-fund entries, read as the signed-in staff
 * member. Row-level security decides (app.can_read_invoice, app.can_read_matter_billing: the firm
 * owner and the matter's finance user), so someone else reads nothing and is told who can.
 */
export async function loadMatterBilling(
  supabase: Client,
  input: { organizationId: string; matterId: string; today: string; role: string; timeZone: string },
): Promise<MatterBillingData> {
  const [invoices, entries, manual] = await Promise.all([
    // A discarded draft (FIN-06) was never sent; it stays on Finance, not on the matter.
    supabase.from("invoices").select(`id, ${BILLING_INVOICE_COLUMNS}`).eq("organization_id", input.organizationId).eq("matter_id", input.matterId).is("discarded_at", null).order("issued_on", { ascending: false }).limit(200),
    supabase.from("client_fund_entries").select("kind, status, direction, amount_cents").eq("organization_id", input.organizationId).eq("matter_id", input.matterId).limit(1000),
    // FIN-09: manual payments waiting for verification (billing staff, RLS).
    supabase.from("invoice_manual_payments").select("invoice_id, amount_cents").eq("organization_id", input.organizationId).eq("matter_id", input.matterId).eq("status", "pending_verification").limit(200),
  ]);
  // DES-04: card payment attempts on the matter's invoices (billing staff, RLS), in the statuses
  // Finance › Payments lists, so a failed one shows as failed, not as an open payment.
  const ids = (invoices.data ?? []).map((row) => row.id);
  const card = ids.length
    ? await supabase
        .from("invoice_payments")
        .select("invoice_id, status, updated_at")
        .eq("organization_id", input.organizationId)
        .in("invoice_id", ids)
        .in("status", [...LISTED_PAYMENT_STATUSES])
        .order("updated_at", { ascending: false })
        .limit(500)
    : null;
  const pending = new Map<string, number>();
  for (const row of manual.data ?? []) pending.set(row.invoice_id, (pending.get(row.invoice_id) ?? 0) + row.amount_cents);
  const attempts = latestPayments((card?.data ?? []).map((row) => ({ invoiceId: row.invoice_id, status: row.status, updatedAt: row.updated_at })));
  return matterBilling({
    invoices: (invoices.data ?? []).map((row) => {
      const attempt = attempts.get(row.id);
      return {
        ...row,
        pending_cents: pending.get(row.id) ?? 0,
        card: attempt ? { status: attempt.status, on: isoDateInTimeZone(new Date(attempt.updatedAt), input.timeZone) } : null,
      };
    }),
    entries: entries.data ?? [],
    today: input.today,
    hidden: input.role !== "firm_owner" && input.role !== "finance_user",
  });
}
