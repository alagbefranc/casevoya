/**
 * Pure helpers for the matter's Billing tab and the Matters list's Money column: what a matter's
 * invoices and client-fund entries add up to. Money is integer cents; nothing is invented, and a
 * matter with neither shows "—".
 */
import type { MatterBillingData } from "@/components/sheet/designer/matter";
import { formatAmount, formatMoney } from "@/modules/finance/money";
import { invoiceState } from "@/modules/sheet/finance-present";
import { dayMonthYear } from "@/modules/sheet/matter-present";

export type BillingInvoice = {
  number: string;
  amount_cents: number;
  paid_cents: number;
  credited_cents: number;
  refunded_cents?: number | null;
  status: string;
  issued_on: string | null;
  due_on: string;
  fee_category: string;
  currency: string;
  is_sample: boolean;
};

export type BillingEntry = { kind: string; status: string; direction: string; amount_cents: number };

const CATEGORY: Record<string, string> = {
  professional_fee: "Professional fee",
  disbursement: "Disbursement",
  consultation_fee: "Consultation fee",
};

/** What an issued or partly paid invoice still has owing (never below zero). */
export function owedCents(invoice: Pick<BillingInvoice, "amount_cents" | "paid_cents" | "credited_cents" | "status">): number {
  if (invoice.status !== "issued" && invoice.status !== "partially_paid") return 0;
  return Math.max(0, invoice.amount_cents - invoice.paid_cents - invoice.credited_cents);
}

/** Client funds held for a matter, as app.matter_closure_blockers counts them. */
export function heldCents(entries: readonly BillingEntry[]): { held: number; pending: number } {
  let held = 0;
  let pending = 0;
  for (const entry of entries) {
    if (entry.kind === "deposit" && entry.status === "verified") held += entry.amount_cents;
    else if (entry.kind === "deposit" && entry.status === "pending_verification") pending += entry.amount_cents;
    else if (entry.kind === "transfer" && entry.status === "approved") held -= entry.amount_cents;
    else if (entry.kind === "refund" || entry.kind === "correction") held += entry.direction === "in" ? entry.amount_cents : -entry.amount_cents;
  }
  return { held, pending };
}

/** The Matters list's Money column: "CAD 1,130.00 owed", "CAD 1,500.00 held", both, or "—". */
export function moneyCell(
  invoices: readonly (Pick<BillingInvoice, "amount_cents" | "paid_cents" | "credited_cents" | "status"> & { currency?: string })[],
  entries: readonly BillingEntry[],
): string {
  const currency = invoices[0]?.currency ?? "CAD";
  const owed = invoices.reduce((sum, row) => sum + owedCents(row), 0);
  const { held } = heldCents(entries);
  const parts = [...(owed > 0 ? [`${formatMoney(owed, currency)} owed`] : []), ...(held > 0 ? [`${formatMoney(held, currency)} held`] : [])];
  return parts.length ? parts.join(", ") : "—";
}

/** The Billing tab, in the Designer's words. */
export function matterBilling(input: {
  invoices: readonly BillingInvoice[];
  entries: readonly BillingEntry[];
  today: string;
  /** The viewer's role can't read this matter's invoices or client funds (they read nothing). */
  hidden: boolean;
}): MatterBillingData {
  const currency = input.invoices[0]?.currency ?? "CAD";
  const { held, pending } = heldCents(input.entries);
  const live = input.invoices.filter((row) => row.status !== "draft" && row.status !== "voided");
  const invoiced = live.reduce((sum, row) => sum + row.amount_cents - row.credited_cents, 0);
  const paid = live.reduce((sum, row) => sum + row.paid_cents, 0);
  const owed = live.reduce((sum, row) => sum + owedCents(row), 0);
  const nextDue = live.filter((row) => owedCents(row) > 0).map((row) => row.due_on).sort()[0];
  return {
    hidden: input.hidden && input.invoices.length === 0 && input.entries.length === 0,
    held: {
      amount: formatMoney(held, currency),
      count: input.entries.length,
      note: input.entries.length === 0 ? "No client funds recorded." : pending > 0 ? `Held, not earned. ${formatMoney(pending, currency)} waiting for verification.` : "Held, not earned.",
    },
    invoiced: {
      amount: formatMoney(invoiced, currency),
      count: live.length,
      note: live.length === 0 ? ["No invoices issued yet"] : [`${formatMoney(paid, currency)} paid`, owed > 0 ? `${formatMoney(owed, currency)} due${nextDue ? ` ${dayMonthYear(nextDue, input.today)}` : ""}` : "nothing owed"],
    },
    invoices: [...input.invoices]
      .sort((a, b) => (b.issued_on ?? "").localeCompare(a.issued_on ?? "") || b.number.localeCompare(a.number))
      .map((row) => {
        const state = invoiceState(row.status, row.due_on, input.today);
        return {
          number: `${row.number}${row.is_sample ? " (sample)" : ""}`,
          categories: [CATEGORY[row.fee_category] ?? row.fee_category],
          issued: row.issued_on ? dayMonthYear(row.issued_on, input.today) : "Not issued",
          state: { tone: state.tone, label: state.label },
          total: formatAmount(row.amount_cents, row.currency),
          payment:
            row.paid_cents > 0
              ? [`${formatMoney(row.paid_cents, row.currency)} paid`, ...(owedCents(row) > 0 ? [`${formatMoney(owedCents(row), row.currency)} owed`] : [])]
              : owedCents(row) > 0
                ? [`${formatMoney(owedCents(row), row.currency)} owed`]
                : ["—"],
        };
      }),
  };
}
