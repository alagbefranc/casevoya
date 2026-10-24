import "server-only";
import { createClient } from "@/lib/supabase/server";
import { stripeServer } from "@/lib/stripe/server";
import { publishableKey } from "@/modules/finance/keys";
import { ledgerTotals } from "@/modules/finance/client-funds-present";
import { formatMoney } from "@/modules/finance/money";
import type { PortalViewer } from "@/modules/portal/load";
import { invoiceState } from "@/modules/sheet/finance-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";
import { paymentReceiptFromRpc } from "@/modules/finance/payment-receipt";
import { receiptView, type ReceiptView } from "@/modules/finance/portal-receipt";
import { isCardPayableCategory } from "@/modules/finance/connect-present";

export type PortalInvoice = {
  id: string;
  number: string;
  description: string;
  matterTitle: string;
  amountCents: number;
  paidCents: number;
  /** Succeeded card refunds on this invoice (FIN-13). */
  refundedCents: number;
  /** Issued credit notes on this invoice: they reduce what is due (FIN-06). */
  creditedCents: number;
  currency: string;
  status: string;
  issuedOn: string | null;
  dueOn: string;
  open: boolean;
  processing: boolean;
  /** An earned fee or incurred cost the client may pay by card; an advance never is (FIN-02). Absent means payable. */
  cardPayable?: boolean;
  state: { tone: string; label: string; detail?: string };
  /** Receipts for the client's own payments of this invoice ("PR-0001", CICC Code s. 33(3)), oldest first. */
  receipts: { id: string; number: string }[];
  /** Issued credit notes on this invoice ("CN-0001"), oldest first; each has a PDF. */
  creditNotes: { id: string; number: string; amountCents: number }[];
  /** FIN-09: payments the firm recorded by hand that wait for verification. Not paid yet. */
  pendingCents?: number;
};

/** One entry of the client's own client-account ledger that counts (verified, approved or recorded). */
export type PortalFundsEntry = {
  id: string;
  kind: "deposit" | "transfer" | "refund" | "correction";
  direction: "in" | "out";
  amountCents: number;
  occurredOn: string;
  method: string | null;
  reference: string | null;
  invoiceNumber: string | null;
  matterTitle: string;
  /** "RC-0001" for a verified deposit: the receipt for the advance (CICC Code s. 32(b)). */
  receiptNumber: string | null;
};

export type PortalClientFunds = {
  /** Held for the client now: verified deposits less transfers, refunds and corrections. */
  heldCents: number;
  entries: PortalFundsEntry[];
};

export type PortalInvoices = {
  invoices: PortalInvoice[];
  /** The client's own client-account ledger (FIN-03), or null when there is none. Read-only. */
  clientFunds: PortalClientFunds | null;
  today: string;
  /** Test keys on both sides: the Payment Element can load. */
  payable: boolean;
  publishableKey: string | null;
};

/** The client's invoices (RLS: invoices on matters where they are a party). */
export async function loadPortalInvoices(viewer: PortalViewer): Promise<PortalInvoices> {
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const today = isoDateInTimeZone(new Date(), viewer.timezone);
  const { data } = await supabase
    .from("invoices")
    .select("id, matter_id, number, description, fee_category, amount_cents, paid_cents, refunded_cents, credited_cents, currency, status, issued_on, due_on")
    .eq("organization_id", viewer.organizationId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = data ?? [];
  const ids = rows.map((row) => row.id);
  const processing = ids.length
    ? await supabase.from("invoice_payments").select("invoice_id").eq("organization_id", viewer.organizationId).eq("status", "processing").in("invoice_id", ids)
    : null;
  const busy = new Set((processing?.data ?? []).map((row) => row.invoice_id));
  // FIN-09: manual payments the firm recorded (e-transfer, cheque, wire, cash) still waiting for
  // verification: the invoice reads "Pending verification", never "Paid".
  const manual = ids.length ? await supabase.rpc("invoice_manual_payment_summary", { p_invoice_ids: ids }) : null;
  const pendingOf = new Map<string, number>();
  for (const row of manual?.data ?? []) {
    if (row.status === "pending_verification") pendingOf.set(row.invoice_id, (pendingOf.get(row.invoice_id) ?? 0) + Number(row.amount_cents));
  }
  // RLS: only receipts for payments this client made (card) or that came from their client-account money.
  const paymentReceipts = ids.length
    ? await supabase
        .from("invoice_payment_receipts")
        .select("id, invoice_id, number")
        .eq("organization_id", viewer.organizationId)
        .in("invoice_id", ids)
        .order("number", { ascending: true })
    : null;
  const receiptsOf = new Map<string, { id: string; number: string }[]>();
  for (const row of paymentReceipts?.data ?? []) {
    receiptsOf.set(row.invoice_id, [...(receiptsOf.get(row.invoice_id) ?? []), { id: row.id, number: row.number }]);
  }
  // RLS: issued credit notes on invoices the client can read (a party on the matter).
  const credits = ids.length
    ? await supabase
        .from("invoice_credit_notes")
        .select("id, invoice_id, number, amount_cents")
        .eq("organization_id", viewer.organizationId)
        .eq("status", "issued")
        .in("invoice_id", ids)
        .order("number", { ascending: true })
    : null;
  const creditsOf = new Map<string, { id: string; number: string; amountCents: number }[]>();
  for (const row of credits?.data ?? []) {
    creditsOf.set(row.invoice_id, [...(creditsOf.get(row.invoice_id) ?? []), { id: row.id, number: row.number, amountCents: row.amount_cents }]);
  }
  const titles = new Map(viewer.matters.map((matter) => [matter.id, matter.title]));
  const pk = publishableKey();
  // RLS: only the client's own sub-ledgers, and only entries that count.
  const funds = await supabase
    .from("client_fund_entries")
    .select("id, matter_id, kind, status, direction, amount_cents, occurred_on, method, external_reference, invoice_id, created_at")
    .eq("organization_id", viewer.organizationId)
    .in("status", ["verified", "approved", "recorded"])
    .order("created_at", { ascending: true })
    .limit(500);
  const fundRows = funds.data ?? [];
  // RLS: receipts for the client's own deposits.
  const depositIds = fundRows.filter((row) => row.kind === "deposit").map((row) => row.id);
  const receipts = depositIds.length
    ? await supabase.from("client_fund_receipts").select("entry_id, number").eq("organization_id", viewer.organizationId).in("entry_id", depositIds)
    : null;
  const receiptOf = new Map((receipts?.data ?? []).map((row) => [row.entry_id, row.number]));
  const numbers = new Map(rows.map((row) => [row.id, row.number]));
  const clientFunds: PortalClientFunds | null = fundRows.length
    ? {
        heldCents: ledgerTotals(
          fundRows.map((row) => ({ kind: row.kind, status: row.status, direction: row.direction === "in" ? "in" : "out", amountCents: row.amount_cents })),
        ).balanceCents,
        entries: fundRows.map((row) => ({
          id: row.id,
          kind: row.kind,
          direction: row.direction === "in" ? "in" : "out",
          amountCents: row.amount_cents,
          occurredOn: row.occurred_on,
          method: row.method,
          reference: row.external_reference,
          invoiceNumber: row.invoice_id ? (numbers.get(row.invoice_id) ?? null) : null,
          matterTitle: titles.get(row.matter_id) ?? "Your matter",
          receiptNumber: row.kind === "deposit" ? (receiptOf.get(row.id) ?? null) : null,
        })),
      }
    : null;
  return {
    clientFunds,
    today,
    payable: Boolean(pk && stripeServer()),
    publishableKey: pk,
    invoices: rows.map((row) => {
      const state = invoiceState(
        row.status,
        row.due_on,
        today,
        busy.has(row.id),
        row.refunded_cents > 0 ? formatMoney(row.refunded_cents, row.currency) : null,
        row.credited_cents > 0 && row.status !== "credited" ? formatMoney(row.credited_cents, row.currency) : null,
        pendingOf.get(row.id) ? formatMoney(pendingOf.get(row.id) ?? 0, row.currency) : null,
      );
      return {
        id: row.id,
        number: row.number,
        description: row.description,
        matterTitle: titles.get(row.matter_id) ?? "Your matter",
        amountCents: row.amount_cents,
        paidCents: row.paid_cents,
        refundedCents: row.refunded_cents,
        creditedCents: row.credited_cents,
        currency: row.currency,
        status: row.status,
        issuedOn: row.issued_on,
        dueOn: row.due_on,
        open: row.status === "issued" || row.status === "partially_paid",
        processing: busy.has(row.id),
        cardPayable: isCardPayableCategory(row.fee_category),
        state: { tone: state.tone, label: state.label, ...(state.detail ? { detail: state.detail } : {}) },
        receipts: receiptsOf.get(row.id) ?? [],
        creditNotes: creditsOf.get(row.id) ?? [],
        pendingCents: pendingOf.get(row.id) ?? 0,
      };
    }),
  };
}

/**
 * One of the client's payment receipts on screen (/portal/receipt?id=): the same audited read as the
 * PDF (`invoice_payment_receipt`), plus their invoices for "Still to pay". Null when it can't be read.
 */
export async function loadPortalReceipt(viewer: PortalViewer, receiptId: string): Promise<ReceiptView | null> {
  const supabase = await createClient({ organizationId: viewer.organizationId });
  const { data, error } = await supabase.rpc("invoice_payment_receipt", { p_receipt_id: receiptId });
  if (error) return null;
  const receipt = paymentReceiptFromRpc(data);
  if (!receipt) return null;
  const invoices = await loadPortalInvoices(viewer).catch(() => null);
  return receiptView({ receipt, receiptId, organizationId: viewer.organizationId, invoices: invoices?.invoices ?? [] });
}
