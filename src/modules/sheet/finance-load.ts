import "server-only";
import type Stripe from "stripe";
import type {
  FinanceData,
  FinanceHeaderData,
  FinanceKpi,
  InvoiceRow,
  NewInvoiceDialogData,
  PaymentRow,
  PaymentsData,
  RefundDialogData,
  RefundsData,
} from "@/components/sheet/designer/finance";
import { FINANCE_CHIPS } from "@/components/sheet/designer/finance";
import type {
  FundsAction,
  FundsData,
  FundsLiveDialogsData,
  FundsOption,
  FundsPanel,
  RecordPaymentDialogData,
  TransferDialogData,
  VerifyDialogData,
} from "@/components/sheet/designer/funds";
import {
  earliestWithdrawal,
  ledgerBadge,
  ledgerLines,
  ledgerTotals,
  methodShort,
  withdrawalState,
  withdrawalTiming,
  type FundEntry,
  type Withdrawal,
} from "@/modules/finance/client-funds-present";
import { createClient } from "@/lib/supabase/server";
import { stripeServer } from "@/lib/stripe/server";
import { publishableKey } from "@/modules/finance/keys";
import { formatAmount, formatMoney, INVOICE_CURRENCIES } from "@/modules/finance/money";
import { paymentReceiptHref } from "@/modules/finance/receipt-links";
import { retrieveAccountStatus } from "@/modules/finance/stripe-account";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import {
  cardReceived,
  disputeOpen,
  disputeReason,
  disputeState,
  FEE_CATEGORY_LABEL,
  invoiceState,
  LISTED_PAYMENT_STATUSES,
  paymentState,
  refundState,
  shortStripeId,
} from "@/modules/sheet/finance-present";
import {
  billingNames,
  loadCreditNoteRows,
  loadInvoiceView,
  loadLastReconciliationKpi,
  loadReconciliation,
  type InvoiceViewPage,
  type ReconPage,
} from "@/modules/sheet/finance-corrections-load";
import { dayMonth } from "@/modules/sheet/home-present";
import { loadFinanceBilling, loadInvoiceBillingDialogs } from "@/modules/billing/load";
import { billingInvoiceState } from "@/modules/billing/present";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone, plusDays } from "@/modules/sheet/present";

const INVOICES_READ = 500;
const BILLING_ROLES = new Set(["firm_owner", "finance_user"]);

export type FinanceAccountData = {
  organizationId: string;
  firmName: string;
  isOwner: boolean;
  /** Both the server's test secret key and the browser's test publishable key are set. */
  configured: boolean;
  publishableKey: string | null;
  account: null | { cardPayments: string; payouts: string; requirementsDue: number };
  /** Firm owner or finance user: the staff who see the firm's billing. */
  canBill: boolean;
};

const PAYMENTS_READ = 500;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Invoice number ("INV-0001", "(sample)" marked) and client name for each invoice id, read through RLS. */
async function invoiceLabels(supabase: Supabase, org: string, invoiceIds: string[]): Promise<Map<string, { number: string; client: string }>> {
  if (!invoiceIds.length) return new Map();
  const invoices = await supabase.from("invoices").select("id, number, matter_id, is_sample").eq("organization_id", org).in("id", invoiceIds);
  const matterIds = [...new Set((invoices.data ?? []).map((row) => row.matter_id))];
  const [matters, billing] = matterIds.length
    ? await Promise.all([
        supabase.from("matters").select("id, title, matter_participants(role, persons(display_name))").eq("organization_id", org).in("id", matterIds),
        billingNames(supabase, org),
      ])
    : [null, new Map<string, { title: string; client: string | null }>()];
  // A finance user reads no matter rows: the billing projection names their clients.
  const clientByMatter = new Map<string, string>([
    ...[...billing].map(([id, row]): [string, string] => [id, row.client || row.title]),
    ...(matters?.data ?? []).map((row): [string, string] => [
      row.id,
      (row.matter_participants ?? [])
        .filter((party) => party.role === "applicant")
        .map((party) => party.persons?.display_name)
        .filter((name): name is string => Boolean(name))
        .join(", ") ||
        row.title ||
        "Client",
    ]),
  ]);
  return new Map(
    (invoices.data ?? []).map((row) => [row.id, { number: `${row.number}${row.is_sample ? " (sample)" : ""}`, client: clientByMatter.get(row.matter_id) ?? "Client" }]),
  );
}

function money(minor: number, currency: string): string {
  return `${formatAmount(minor, currency)}${currency === "CAD" ? "" : ` ${currency}`}`;
}

/** Refunds that hold part of a payment: pending, needing action, or succeeded. */
const HELD_REFUND_STATUSES = ["pending", "requires_action", "succeeded"] as const;

/**
 * The Payments tab's rows: card payments Stripe has acted on, newest first, read as the signed-in
 * staff member (RLS: the invoices they may read). Nothing is invented: a sample firm sees its
 * sample invoices' payments, marked "(sample)". Billing staff get a Refund button on a received
 * payment with something left to refund.
 */
async function loadPaymentRows(supabase: Supabase, staff: SheetStaff, canBill: boolean): Promise<PaymentRow[]> {
  const org = staff.organizationId;
  const payments = await supabase
    .from("invoice_payments")
    .select("id, invoice_id, payment_intent_id, last_event_id, amount_cents, amount_received_cents, refunded_cents, currency, status, succeeded_at, updated_at")
    .eq("organization_id", org)
    .in("status", [...LISTED_PAYMENT_STATUSES])
    .order("updated_at", { ascending: false })
    .limit(PAYMENTS_READ);
  const rows = payments.data ?? [];
  if (!rows.length) return [];
  const received = rows.filter((row) => row.status === "succeeded" && row.amount_received_cents > 0).map((row) => row.id);
  const [labels, held, receipts] = await Promise.all([
    invoiceLabels(supabase, org, [...new Set(rows.map((row) => row.invoice_id))]),
    canBill && received.length
      ? supabase.from("invoice_refunds").select("payment_id, amount_cents").eq("organization_id", org).in("status", [...HELD_REFUND_STATUSES]).in("payment_id", received)
      : null,
    // RLS: the matter's billing staff (or the client who paid) read the receipt (CICC Code s. 33(3)).
    received.length ? supabase.from("invoice_payment_receipts").select("id, payment_id, number").eq("organization_id", org).in("payment_id", received) : null,
  ]);
  const receiptOf = new Map((receipts?.data ?? []).filter((row) => row.payment_id).map((row) => [row.payment_id as string, row]));
  const heldByPayment = new Map<string, number>();
  for (const refund of held?.data ?? []) heldByPayment.set(refund.payment_id, (heldByPayment.get(refund.payment_id) ?? 0) + refund.amount_cents);
  return rows.map((row) => {
    const invoice = labels.get(row.invoice_id);
    const settled = row.status === "succeeded" && row.amount_received_cents > 0;
    const refundable = settled ? Math.max(0, row.amount_received_cents - (heldByPayment.get(row.id) ?? 0)) : 0;
    const client = invoice?.client ?? "Client";
    const goesTo = invoice?.number ?? "Invoice";
    const receipt = receiptOf.get(row.id);
    return {
      ...(receipt ? { receipt: { label: `Receipt ${receipt.number}`, href: paymentReceiptHref(receipt.id, org) } } : {}),
      key: row.id,
      received: dayMonth(isoDateInTimeZone(new Date(row.succeeded_at ?? row.updated_at), staff.timezone)),
      from: client,
      method: "Card",
      reference: [shortStripeId(row.last_event_id ?? row.payment_intent_id)],
      goesTo,
      amount: money(settled ? row.amount_received_cents : row.amount_cents, row.currency),
      state: paymentState(row.status, { refundedCents: row.refunded_cents, receivedCents: row.amount_received_cents, refunded: formatMoney(row.refunded_cents, row.currency) }),
      ...(canBill && refundable > 0
        ? {
            refund: {
              paymentId: row.id,
              refundableCents: refundable,
              refundable: formatAmount(refundable, row.currency).replaceAll(",", ""),
              label: `${goesTo} · ${client} · ${formatMoney(refundable, row.currency)} refundable`,
            },
          }
        : {}),
    };
  });
}

const REFUNDS_READ = 500;

/** The Refunds and disputes tab, read as the signed-in staff member (RLS mirrors invoice_payments). */
async function loadRefunds(supabase: Supabase, staff: SheetStaff, canBill: boolean): Promise<RefundsData> {
  const org = staff.organizationId;
  const [refunds, disputes, creditNotes] = await Promise.all([
    supabase
      .from("invoice_refunds")
      .select("id, invoice_id, payment_id, number, amount_cents, currency, status, failure_reason, created_at")
      .eq("organization_id", org)
      .order("created_at", { ascending: false })
      .limit(REFUNDS_READ),
    supabase
      .from("invoice_disputes")
      .select("id, invoice_id, number, amount_cents, currency, status, reason, evidence_due_by, created_at")
      .eq("organization_id", org)
      .order("created_at", { ascending: false })
      .limit(REFUNDS_READ),
    loadCreditNoteRows(supabase, staff, canBill),
  ]);
  const refundRows = refunds.data ?? [];
  const disputeRows = disputes.data ?? [];
  const labels = await invoiceLabels(supabase, org, [...new Set([...refundRows.map((row) => row.invoice_id), ...disputeRows.map((row) => row.invoice_id)])]);
  const day = (iso: string) => dayMonth(isoDateInTimeZone(new Date(iso), staff.timezone));

  // The newest refund of a payment that failed, unless a later refund of that payment replaced it.
  const latestByPayment = new Map<string, (typeof refundRows)[number]>();
  for (const row of refundRows) if (!latestByPayment.has(row.payment_id)) latestByPayment.set(row.payment_id, row);
  const failed = refundRows.find((row) => (row.status === "failed" || row.status === "canceled") && latestByPayment.get(row.payment_id)?.id === row.id);
  const failedClient = failed ? (labels.get(failed.invoice_id)?.client ?? "the client") : "";
  const failedWhy = failed ? refundState(failed.status, failed.failure_reason).detail : undefined;

  return {
    intro: `Card refunds, credit notes and the disputes Stripe reported for ${staff.organizationName}. Refunding a payment isn’t the same as crediting an invoice; each keeps its own state and links. A refund counts only when Stripe’s signed event confirms it. Disputes never hold back or delete a client’s records, and none of these changes a matter’s stage or government status.`,
    refunds: refundRows.map((row) => ({
      key: row.id,
      number: row.number,
      client: labels.get(row.invoice_id)?.client ?? "Client",
      from: ["Card", labels.get(row.invoice_id)?.number ?? "Invoice"],
      amount: money(row.amount_cents, row.currency),
      requested: day(row.created_at),
      state: refundState(row.status, row.failure_reason),
    })),
    refundsEmpty: canBill
      ? { title: "No refunds yet", copy: "Refund a received card payment from the Payments tab. It shows here as processing until Stripe confirms it." }
      : { title: "No refunds to show", copy: "Refunds are shown to the firm owner and the matter’s finance user." },
    failed: failed
      ? {
          title: `Refund ${failed.number} ${failed.status === "canceled" ? "was canceled" : "failed"}`,
          copy: `Stripe couldn’t return ${formatMoney(failed.amount_cents, failed.currency)} to ${failedClient}’s card${failedWhy ? ` (${failedWhy})` : ""}. Nothing was refunded twice; the amount can be refunded again from the Payments tab.`,
        }
      : null,
    creditNotes,
    creditNotesEmpty: canBill
      ? { title: "No credit notes yet", copy: "Correct an issued invoice with a credit note from its own tab. Someone other than the person who drafts it issues it." }
      : { title: "No credit notes to show", copy: "Credit notes are shown to the firm owner and the matter’s finance user." },
    disputes: disputeRows.map((row) => ({
      key: row.id,
      number: row.number,
      client: labels.get(row.invoice_id)?.client ?? "Client",
      payment: ["Card", `${labels.get(row.invoice_id)?.number ?? "Invoice"}, ${disputeReason(row.reason).toLowerCase()}`],
      amount: money(row.amount_cents, row.currency),
      evidenceDue: disputeOpen(row.status) && row.evidence_due_by ? day(row.evidence_due_by) : "—",
      state: disputeState(row.status),
    })),
    disputesEmpty: canBill
      ? { title: "No disputes", copy: "If a client disputes a card payment with their bank, Stripe reports it and it shows here with its evidence deadline." }
      : { title: "No disputes to show", copy: "Disputes are shown to the firm owner and the matter’s finance user." },
    disputeFooter: disputeRows.length
      ? {
          note: "Evidence can’t be submitted from Casevoya yet, and the firm’s Stripe account has no Stripe Dashboard: to respond before the due date, contact Stripe support. The client keeps full access to their portal and records during a dispute.",
        }
      : null,
  };
}

const FUNDS_READ = 2000;

export type ClientFundsPage = {
  data: FundsData;
  pay: RecordPaymentDialogData;
  verify: VerifyDialogData;
  transfer: TransferDialogData;
  more: FundsLiveDialogsData;
};

/**
 * The Client funds tab, read as the signed-in staff member. RLS decides what is visible: the firm
 * owner sees every client sub-ledger, a finance user those on matters they're assigned to. Nothing
 * is invented: a firm without a client account or entries gets the empty state.
 */
async function loadClientFunds(supabase: Supabase, staff: SheetStaff, canBill: boolean, today: string): Promise<ClientFundsPage> {
  const org = staff.organizationId;
  const isOwner = staff.role === "firm_owner";
  const [claims, accounts, ledgers, entries, partyResult, names, receipts, banks, dues, paymentReceipts] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("client_accounts").select("id, label, institution, account_last4, is_active").eq("organization_id", org).order("created_at"),
    supabase.from("client_fund_ledgers").select("id, client_account_id, matter_id, person_id, is_sample, created_at").eq("organization_id", org).order("created_at"),
    supabase
      .from("client_fund_entries")
      .select(
        "id, ledger_id, number, kind, status, direction, amount_cents, occurred_on, method, external_reference, evidence_note, note, invoice_id, reverses_entry_id, requested_by, verified_by, verified_by_owner_self, approved_by, owner_self_approved, created_at",
      )
      .eq("organization_id", org)
      .order("created_at", { ascending: true })
      .limit(FUNDS_READ),
    canBill ? supabase.rpc("list_client_fund_parties") : null,
    canBill ? supabase.rpc("client_fund_staff_names", { p_org: org }) : null,
    supabase.from("client_fund_receipts").select("entry_id, number").eq("organization_id", org).limit(FUNDS_READ),
    supabase.from("client_fund_bank_transfers").select("entry_id, transferred_on, bank_reference").eq("organization_id", org).limit(FUNDS_READ),
    canBill ? supabase.rpc("list_client_fund_withdrawals") : null,
    supabase.from("invoice_payment_receipts").select("id, entry_id, number").eq("organization_id", org).eq("source", "client_funds").limit(FUNDS_READ),
  ]);
  const receiptOf = new Map((receipts.data ?? []).map((row) => [row.entry_id, row.number]));
  // An approved transfer pays an invoice: its receipt is the invoice payment receipt (CICC Code s. 33(3)).
  const paymentReceiptOf = new Map(
    (paymentReceipts.data ?? []).filter((row) => row.entry_id).map((row) => [row.entry_id as string, { id: row.id, number: row.number }]),
  );
  const bankOf = new Map((banks.data ?? []).map((row) => [row.entry_id, { on: row.transferred_on, reference: row.bank_reference }]));
  const withdrawals: Withdrawal[] = (dues?.data ?? [])
    .filter((row) => row.organization_id === org)
    .map((row) => ({
      state: row.state === "awaiting_approval" || row.state === "awaiting_bank_transfer" ? row.state : "not_requested",
      matterId: row.matter_id,
      ledgerId: row.ledger_id,
      entryId: row.entry_id,
      invoiceNumber: row.invoice_number,
      amountCents: Number(row.amount_cents),
      withdrawBy: row.withdraw_by,
      daysLeft: row.days_left,
      overdue: row.overdue,
    }));
  const viewer = typeof claims.data?.claims?.sub === "string" ? claims.data.claims.sub : "";
  const accountRows = (accounts.data ?? []).filter((row) => row.is_active);
  const ledgerRows = ledgers.data ?? [];
  const entryRows = entries.data ?? [];
  const partyRows = (partyResult?.data ?? []).filter((row) => row.organization_id === org);
  const nameOf = new Map((names?.data ?? []).map((row) => [row.user_id, row.display_name]));
  const staffName = (id: string | null) => (id ? (nameOf.get(id) ?? "Staff member") : null);

  const matterIds = [...new Set([...ledgerRows.map((row) => row.matter_id), ...partyRows.map((row) => row.matter_id)])];
  const [matters, invoices, billed] = await Promise.all([
    matterIds.length ? supabase.from("matters").select("id, reference, title, is_sample").eq("organization_id", org).in("id", matterIds) : null,
    matterIds.length
      ? supabase.from("invoices").select("id, number, matter_id, amount_cents, paid_cents, credited_cents, status, issued_on, is_sample").eq("organization_id", org).in("matter_id", matterIds).limit(FUNDS_READ)
      : null,
    matterIds.length && canBill ? billingNames(supabase, org) : null,
  ]);
  const matterById = new Map((matters?.data ?? []).map((row) => [row.id, row]));
  const sampleMatter = new Set([...ledgerRows.filter((row) => row.is_sample).map((row) => row.matter_id), ...partyRows.filter((row) => row.is_sample).map((row) => row.matter_id)]);
  // A finance user reads no matter rows: the billing projection's title names the matter.
  const referenceOf = (matterId: string) => {
    const matter = matterById.get(matterId);
    const label = matter?.reference || matter?.title || billed?.get(matterId)?.title || "Matter";
    return matter?.is_sample || sampleMatter.has(matterId) ? `${label} (sample)` : label;
  };
  const personName = new Map(partyRows.map((row) => [row.person_id, row.display_name]));
  const invoiceById = new Map((invoices?.data ?? []).map((row) => [row.id, row]));
  const entryNumber = new Map(entryRows.map((row) => [row.id, row.number]));
  const accountById = new Map(accountRows.map((row) => [row.id, row]));
  const accountLabel = (id: string) => {
    const account = accountById.get(id) ?? (accounts.data ?? []).find((row) => row.id === id);
    return account ? `${account.label} ••• ${account.account_last4}` : "Client account";
  };
  const day = (iso: string) => dayMonth(iso);

  type Row = (typeof entryRows)[number];
  const asEntry = (row: Row): FundEntry => ({
    id: row.id,
    number: row.number,
    kind: row.kind,
    status: row.status,
    direction: row.direction === "in" ? "in" : "out",
    amountCents: row.amount_cents,
    occurredOn: row.occurred_on,
    method: row.method,
    reference: row.external_reference,
    evidence: row.evidence_note,
    note: row.note,
    invoiceNumber: row.invoice_id ? (invoiceById.get(row.invoice_id)?.number ?? "an invoice") : null,
    reversesNumber: row.reverses_entry_id ? (entryNumber.get(row.reverses_entry_id) ?? null) : null,
    recordedBy: staffName(row.requested_by) ?? "Staff member",
    verifiedBy: staffName(row.verified_by),
    approvedBy: staffName(row.approved_by),
    ownerSelfApproved: row.owner_self_approved,
    verifiedByOwnerSelf: row.verified_by_owner_self,
    receiptNumber: row.kind === "transfer" ? (paymentReceiptOf.get(row.id)?.number ?? null) : (receiptOf.get(row.id) ?? null),
    paymentReceiptId: row.kind === "transfer" ? (paymentReceiptOf.get(row.id)?.id ?? null) : null,
    bank: row.kind === "transfer" && row.status === "approved" ? (bankOf.get(row.id) ?? null) : undefined,
  });
  const receiptHref = (entry: FundEntry) =>
    entry.kind === "transfer" && entry.paymentReceiptId
      ? paymentReceiptHref(entry.paymentReceiptId, org)
      : `/api/client-funds/receipts/${entry.id}?organizationId=${org}`;
  const byLedger = new Map<string, FundEntry[]>();
  for (const row of entryRows) {
    const list = byLedger.get(row.ledger_id) ?? [];
    list.push(asEntry(row));
    byLedger.set(row.ledger_id, list);
  }

  const panels: FundsPanel[] = [];
  const ledgerOptions: FundsOption[] = [];
  const corrections: FundsOption[] = [];
  const bankTransfers: FundsOption[] = [];
  let balance = 0;
  let pendingIn = 0;
  let pendingOut = 0;
  let pendingCount = 0;
  let firstPending: string | null = null;
  const clientsWithMoney = new Set<string>();
  for (const ledger of ledgerRows) {
    const list = byLedger.get(ledger.id) ?? [];
    if (!list.length) continue;
    const totals = ledgerTotals(list);
    const client = personName.get(ledger.person_id) ?? "Client";
    const matter = referenceOf(ledger.matter_id);
    // Sample ledgers stay listed (marked) after sample mode ends, but real totals leave them out.
    const counted = staff.sampleMode || !ledger.is_sample;
    if (counted) {
      balance += totals.balanceCents;
      pendingIn += totals.pendingInCents;
      pendingOut += totals.pendingOutCents;
      if (totals.balanceCents > 0) clientsWithMoney.add(ledger.person_id);
      if (totals.pendingInCents > 0 && !firstPending) firstPending = client;
    }

    const actions: FundsAction[] = [];
    if (canBill) {
      for (const entry of list) {
        if (entry.kind === "deposit" && entry.status === "pending_verification") {
          const recordedByViewer = entryRows.find((item) => item.id === entry.id)?.requested_by === viewer;
          actions.push({
            label: `Verify ${entry.number}`,
            primary: true,
            attrs: {
              "data-funds-verify-open": entry.id,
              "data-client": client,
              "data-amount": formatMoney(entry.amountCents, "CAD"),
              "data-reference": entry.reference ?? "No reference",
              "data-received": `${day(entry.occurredOn)} · ${methodShort(entry.method)}`,
              "data-evidence": entry.evidence ?? "No note",
              "data-by": recordedByViewer ? `${entry.recordedBy} (you)` : entry.recordedBy,
              "data-dest": accountLabel(ledger.client_account_id),
              // Second person: the recorder can't verify it, unless they are the firm owner.
              "data-can-verify": recordedByViewer && !isOwner ? "0" : "1",
              "data-own-entry": recordedByViewer && isOwner ? "1" : "0",
            },
          });
        }
        if (entry.kind === "transfer" && entry.status === "approved" && entry.bank === null) {
          const invoice = entryRows.find((item) => item.id === entry.id)?.invoice_id;
          const issuedOn = invoice ? invoiceById.get(invoice)?.issued_on : null;
          bankTransfers.push({
            value: entry.id,
            label: `${entry.number} · ${client} · ${entry.invoiceNumber ?? "Invoice"} · ${formatMoney(entry.amountCents, "CAD")}`,
            data: { "data-ledger": ledger.id, ...(issuedOn ? { "data-earliest": issuedOn } : {}) },
          });
          actions.push({ label: `Record bank transfer ${entry.number}`, primary: true, attrs: { "data-funds-open": "dlgBank", "data-ledger": ledger.id, "data-entry": entry.id } });
        }
        if (entry.kind === "transfer" && entry.status === "pending_approval") {
          pendingCount += 1;
          const row = entryRows.find((item) => item.id === entry.id);
          const own = row?.requested_by === viewer;
          const canApprove = !own || isOwner;
          actions.push({
            label: `Review transfer ${entry.number}`,
            primary: true,
            attrs: {
              "data-funds-review": entry.id,
              "data-from": `${client}’s client ledger · ${formatMoney(totals.balanceCents, "CAD")} balance`,
              "data-for": `${entry.invoiceNumber ?? "Invoice"}${entry.note ? ` · ${entry.note}` : ""}`,
              "data-amount": `${formatMoney(entry.amountCents, "CAD")} · checked again against the client’s balance and the invoice when approved`,
              "data-approvals": `Requested by ${entry.recordedBy}${own ? " (you)" : ""} · waiting for approval`,
              "data-can-approve": canApprove ? "1" : "0",
              "data-approve-label": own && isOwner ? "Approve as owner (own request)" : `Approve as ${staff.displayName}`,
            },
          });
        }
        if ((entry.kind === "deposit" && entry.status === "verified") || entry.kind === "refund") {
          const reversed = list.some((item) => item.kind === "correction" && item.reversesNumber === entry.number);
          if (!reversed) {
            corrections.push({
              value: entry.id,
              label: `${entry.number} · ${client} · ${entry.kind === "deposit" ? "deposit" : "refund"} ${formatMoney(entry.amountCents, "CAD")}`,
              data: { "data-ledger": ledger.id },
            });
          }
        }
      }
      if (totals.availableCents > 0) {
        ledgerOptions.push({
          value: ledger.id,
          label: `${client} · ${matter} · ${formatMoney(totals.availableCents, "CAD")} available`,
          data: { "data-matter": ledger.matter_id, "data-available": String(totals.availableCents) },
        });
        actions.push({ label: "Transfer earned fees", attrs: { "data-funds-open": "dlgTrNew", "data-ledger": ledger.id } });
        actions.push({ label: "Refund", attrs: { "data-funds-open": "dlgOut", "data-ledger": ledger.id } });
      }
      if (corrections.some((option) => option.data?.["data-ledger"] === ledger.id)) {
        actions.push({ label: "Correct an entry", attrs: { "data-funds-open": "dlgFix", "data-ledger": ledger.id } });
      }
    }
    const due = earliestWithdrawal(
      withdrawals.filter((row) => row.ledgerId === ledger.id || (row.ledgerId === null && row.matterId === ledger.matter_id)),
      day,
    );
    const dueNote = due ? `Withdraw by ${due.label}${due.overdue ? " (overdue)" : ""}: within 30 days of the invoice (CICC Code s. 32(g)). ` : "";
    panels.push({
      key: ledger.id,
      client,
      matter,
      badge: ledgerBadge(list, due),
      rows: ledgerLines(list, day, "CAD", receiptHref),
      footer: actions.length
        ? {
            actions,
            note:
              dueNote +
              (totals.pendingOutCents > 0
                ? `After approval: ${formatMoney(totals.balanceCents - totals.pendingOutCents, "CAD")} available. A ledger entry alone doesn’t move money; make the bank transfer from the client account.`
                : `${formatMoney(totals.availableCents, "CAD")} available. A ledger entry alone doesn’t move money; the bank does.`),
          }
        : null,
    });
  }

  const invoiceOptions: FundsOption[] = (invoices?.data ?? [])
    .filter((row) => (row.status === "issued" || row.status === "partially_paid") && row.amount_cents > row.paid_cents + row.credited_cents)
    .map((row) => ({
      value: row.id,
      label: `${row.number}${row.is_sample ? " (sample)" : ""} · ${formatMoney(row.amount_cents - row.paid_cents - row.credited_cents, "CAD")} due`,
      data: { "data-matter": row.matter_id, "data-due": String(row.amount_cents - row.paid_cents - row.credited_cents) },
    }));

  const firstAccount = accountRows[0];
  const bank = firstAccount ? (accountRows.length === 1 ? `Bank ••• ${firstAccount.account_last4}` : `${accountRows.length} accounts`) : "No client account yet";
  const clientCount = clientsWithMoney.size;
  const kpis: FinanceKpi[] = [
    {
      href: "?tab=funds",
      label: "Client account balance",
      value: { money: formatMoney(balance, "CAD") },
      note: firstAccount ? { left: bank, right: `${clientCount} ${clientCount === 1 ? "client" : "clients"}` } : bank,
    },
    {
      href: "?tab=funds",
      label: "Pending verification",
      value: { money: formatMoney(pendingIn, "CAD") },
      note: firstPending ? { left: firstPending, right: "not available yet" } : "Nothing to verify",
      tone: pendingIn > 0 ? "warn" : undefined,
    },
    {
      href: "?tab=funds",
      label: "Transfers waiting",
      value: { count: pendingCount },
      note: pendingCount ? { left: formatMoney(pendingOut, "CAD"), right: "needs approval" } : "None waiting",
      tone: pendingCount ? "warn" : undefined,
    },
    // The Designer's fourth tile (FIN-12). What's available after pending transfers is in each ledger's footer.
    await loadLastReconciliationKpi(supabase, staff, canBill),
  ];
  // CICC Code s. 32(g): what is still to leave the client account, and by when.
  const firstDue = [...withdrawals].sort((a, b) => a.withdrawBy.localeCompare(b.withdrawBy))[0];
  if (firstDue) {
    const overdue = withdrawals.filter((row) => row.overdue).length;
    const totalDue = withdrawals.reduce((sum, row) => sum + row.amountCents, 0);
    kpis.push({
      href: "?tab=funds",
      label: "Withdraw by",
      value: { money: day(firstDue.withdrawBy) },
      note: {
        left: formatMoney(totalDue, "CAD"),
        // The total covers every invoice still to withdraw for; name them all, not only the first.
        right: overdue
          ? `${overdue} overdue`
          : withdrawals.length > 1
            ? `${withdrawals.length} invoices, first ${firstDue.invoiceNumber} · ${withdrawalTiming(firstDue).toLowerCase()}`
            : `${firstDue.invoiceNumber}, ${withdrawalState(firstDue)} · ${withdrawalTiming(firstDue).toLowerCase()}`,
      },
      tone: overdue ? "bad" : firstDue.daysLeft <= 7 ? "warn" : undefined,
    });
  }

  const emptyActions: FundsAction[] = !canBill
    ? []
    : !firstAccount
      ? isOwner
        ? [{ label: "Add the client account", primary: true, attrs: { "data-funds-open": "dlgAcct" } }]
        : []
      : [{ label: "Record a payment", primary: true, attrs: { "data-dlg": "dlgPay" } }];
  const failed = Boolean(accounts.error || ledgers.error || entries.error);
  const empty = panels.length
    ? null
    : failed
      ? { title: "Client funds couldn’t load", copy: "Reload the page. Nothing was changed; if it keeps happening, sign in again.", actions: [] }
      : !canBill
      ? { title: "No client funds to show", copy: "Client funds are shown to the firm owner and the matter’s finance user.", actions: [] }
      : !firstAccount
        ? {
            title: "No client account yet",
            copy: isOwner
              ? "Add the firm’s client (trust) account at its bank: a name, the bank and the last four digits. Then record advances clients send to it."
              : "The firm owner adds the firm’s client account first. Then advances can be recorded here.",
            actions: emptyActions,
          }
        : { title: "No client funds yet", copy: "When a client sends an advance to the client account, record it here. It counts once it’s verified against the bank statement.", actions: emptyActions };

  const parties: FundsOption[] = partyRows
    .filter((row) => !staff.sampleMode || row.is_sample)
    .map((row) => ({ value: `${row.matter_id}:${row.person_id}`, label: `${row.display_name} · ${referenceOf(row.matter_id)}${row.role === "applicant" ? "" : ` (${row.role.replaceAll("_", " ")})`}` }));

  return {
    data: {
      intro: `Advances held in ${staff.organizationName}’s client account at its own bank, per client and per matter. They’re a liability, not revenue, until an approved earned-fee transfer. Casevoya records the account; it never holds the money.`,
      kpis,
      panels,
      empty,
      alert: {
        title: "One client’s money never pays another client’s bill",
        copy: "Entries can’t be edited once recorded; mistakes are fixed with a reversing entry. A transfer pays only an issued invoice on the same matter, and Casevoya’s subscription and processor fees never come out of a client’s balance. Nothing here changes a matter’s stage or government status.",
      },
    },
    pay: {
      live: {
        organizationId: org,
        today,
        sampleMode: staff.sampleMode,
        parties: parties.length ? parties : [{ value: "", label: "No open matter with a client" }],
        accounts: accountRows.length ? accountRows.map((row) => ({ value: row.id, label: `${row.label} ••• ${row.account_last4} (advances)` })) : [{ value: "", label: "No client account yet" }],
        blocked: !canBill
          ? { title: "Billing staff only", copy: "The firm owner or the matter’s finance user records client funds." }
          : !accountRows.length
            ? { title: "Add the client account first", copy: "The firm owner records the firm’s client account (bank and last four digits) before payments can be recorded." }
            : !parties.length
              ? { title: "No client to record for", copy: staff.sampleMode ? "In sample mode only sample matters take client funds." : "Open a matter with a client first." }
              : null,
      },
    },
    verify: { live: { organizationId: org } },
    transfer: { live: { organizationId: org } },
    more: { organizationId: org, today, ledgers: ledgerOptions, invoices: invoiceOptions, corrections, bankTransfers, isOwner },
  };
}

function sumCurrency(funds: { amount: number; currency: string }[] | undefined, currency: string): number {
  return (funds ?? []).filter((fund) => fund.currency.toUpperCase() === currency).reduce((sum, fund) => sum + fund.amount, 0);
}

const PAYOUTS: Record<string, { value: string; note: string; tone?: "warn" | "bad" }> = {
  active: { value: "On", note: "Stripe pays out to the firm’s bank" },
  pending: { value: "Not yet", note: "Stripe needs more information", tone: "warn" },
  restricted: { value: "Paused", note: "Stripe needs more information", tone: "bad" },
  unsupported: { value: "Off", note: "Not available for this account", tone: "warn" },
};

/**
 * The Stripe balance and payouts tiles, for staff who see the firm's account (RLS on
 * firm_payment_accounts: owner or finance user). Read from Stripe with the platform's test key;
 * when Stripe can't be read the tiles say so and show no number.
 */
async function loadBalance(stripe: Stripe | null, account: { account_id: string; payouts_status: string }): Promise<FinanceKpi[]> {
  const href = "?tab=payments";
  let balance: { available: number; pending: number } | null = null;
  if (stripe) {
    try {
      const read = await stripe.balance.retrieve({}, { stripeAccount: account.account_id });
      if (!read.livemode) balance = { available: sumCurrency(read.available, "CAD"), pending: sumCurrency(read.pending, "CAD") };
    } catch {
      balance = null;
    }
  }
  const payouts = PAYOUTS[account.payouts_status] ?? PAYOUTS.pending;
  return [
    {
      href,
      label: "Available in Stripe",
      value: { money: balance ? formatMoney(balance.available, "CAD") : "—" },
      note: balance ? { left: "Stripe", right: "test mode" } : "Balance unavailable",
    },
    {
      href,
      label: "On the way",
      value: { money: balance ? formatMoney(balance.pending, "CAD") : "—" },
      note: balance ? "Pending in Stripe" : "Balance unavailable",
    },
    { href, label: "Payouts", value: { money: payouts.value }, note: payouts.note, tone: payouts.tone },
  ];
}

function short(text: string, max = 48): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * The Designer's Finance page for a firm, read as the signed-in staff member. RLS decides what is
 * visible: the firm owner sees every invoice, a finance user those on assigned matters.
 */
export async function loadSheetFinance(staff: SheetStaff, tab: FinanceHeaderData["tab"], invoiceId: string | null = null) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const today = isoDateInTimeZone(new Date(), staff.timezone);
  const canBill = BILLING_ROLES.has(staff.role);

  const [chrome, invoices, billable, samples, accountRow] = await Promise.all([
    loadSheetChrome(staff, "/sheet/finance"),
    supabase
      .from("invoices")
      .select("id, matter_id, number, description, fee_category, amount_cents, currency, paid_cents, refunded_cents, credited_cents, written_off_cents, status, issued_on, due_on, is_sample, discarded_at, created_at")
      .eq("organization_id", org)
      .order("created_at", { ascending: false })
      .limit(INVOICES_READ),
    canBill ? supabase.rpc("list_matter_billing") : null,
    // list_matter_billing leaves sample matters out, and in sample mode only sample matters take
    // invoices (create_invoice), so the open sample matters this person can read are offered here.
    canBill && staff.sampleMode
      ? supabase
          .from("matters")
          .select("id, title, stage, matter_participants(role, persons(display_name))")
          .eq("organization_id", org)
          .eq("is_sample", true)
          .neq("stage", "closed")
          .limit(50)
      : null,
    supabase.from("firm_payment_accounts").select("account_id, card_payments_status, payouts_status, requirements_due").eq("organization_id", org).maybeSingle(),
  ]);
  const rows = invoices.data ?? [];
  const sampleBilling = (samples?.data ?? []).map((row) => ({
    matter_id: row.id,
    organization_id: org,
    title: row.title,
    stage: row.stage,
    client_display_name:
      (row.matter_participants ?? [])
        .filter((party) => party.role === "applicant")
        .map((party) => party.persons?.display_name)
        .filter((name): name is string => Boolean(name))
        .join(", ") || null,
  }));
  const billing = [...(billable?.data ?? []).filter((row) => row.organization_id === org && row.stage !== "closed"), ...sampleBilling];
  const matterIds = [...new Set([...rows.map((row) => row.matter_id), ...billing.map((row) => row.matter_id)])];
  const invoiceIds = rows.map((row) => row.id);
  const [matters, processing, cardPayments] = await Promise.all([
    matterIds.length ? supabase.from("matters").select("id, reference, title, is_sample").eq("organization_id", org).in("id", matterIds) : null,
    invoiceIds.length
      ? supabase.from("invoice_payments").select("invoice_id").eq("organization_id", org).eq("status", "processing").in("invoice_id", invoiceIds)
      : null,
    // "Received by card": only Stripe-confirmed card payments, net of their refunds.
    supabase
      .from("invoice_payments")
      .select("invoice_id, status, currency, amount_received_cents, refunded_cents")
      .eq("organization_id", org)
      .eq("status", "succeeded")
      .limit(PAYMENTS_READ),
  ]);
  const matterById = new Map((matters?.data ?? []).map((row) => [row.id, row]));
  // Closed matters too: their invoices still need a name. A finance user reads no matter rows, so
  // the billing projection's title stands in for the reference.
  const billedTitle = new Map((billable?.data ?? []).filter((row) => row.organization_id === org).map((row) => [row.matter_id, row.title]));
  const clientByMatter = new Map([
    ...(billable?.data ?? []).filter((row) => row.organization_id === org).map((row): [string, string] => [row.matter_id, row.client_display_name || row.title]),
    ...billing.map((row): [string, string] => [row.matter_id, row.client_display_name || row.title]),
  ]);
  const processingIds = new Set((processing?.data ?? []).map((row) => row.invoice_id));
  const clientOf = (matterId: string) => clientByMatter.get(matterId) || matterById.get(matterId)?.title || "Matter";
  const referenceOf = (matterId: string) => {
    const matter = matterById.get(matterId);
    const label = matter?.reference || matter?.title || billedTitle.get(matterId) || "—";
    return matter?.is_sample ? `${label} (sample)` : label;
  };

  // The cached account status is refreshed from Stripe for the owner while it is not active yet.
  let account = accountRow.data;
  const stripe = stripeServer();
  if (account && staff.role === "firm_owner" && stripe && (account.card_payments_status !== "active" || account.requirements_due > 0)) {
    try {
      const status = await retrieveAccountStatus(stripe, account.account_id);
      if (!status.livemode) {
        await supabase.rpc("sync_firm_payment_account", {
          p_org: org,
          p_account_id: account.account_id,
          p_card_payments_status: status.cardPayments,
          p_payouts_status: status.payouts,
          p_requirements_due: status.requirementsDue,
        });
        account = { ...account, card_payments_status: status.cardPayments, payouts_status: status.payouts, requirements_due: status.requirementsDue };
      }
    } catch {
      // Stripe unreachable: the cached status stays.
    }
  }
  const cardReady = account?.card_payments_status === "active";

  const tableRows: InvoiceRow[] = rows.map((row) => {
    const state = billingInvoiceState(
      row,
      invoiceState(
        row.status,
        row.due_on,
        today,
        processingIds.has(row.id),
        row.refunded_cents > 0 ? formatMoney(row.refunded_cents, row.currency) : null,
        row.credited_cents - row.written_off_cents > 0 && row.status !== "credited" ? formatMoney(row.credited_cents - row.written_off_cents, row.currency) : null,
      ),
    );
    return {
      key: row.id,
      flags: [state.flag].filter(Boolean),
      // The invoice's own tab: its lines, allocations, credit notes, void and credit note actions.
      number: { href: `?tab=invoice&view=${row.id}`, label: row.number },
      client: { name: clientOf(row.matter_id) },
      matter: referenceOf(row.matter_id),
      categories: [FEE_CATEGORY_LABEL[row.fee_category] ?? "Fee", short(row.description)],
      issued: row.issued_on ? dayMonth(row.issued_on) : "—",
      due: dayMonth(row.due_on),
      total: formatAmount(row.amount_cents, row.currency),
      paid: formatAmount(row.paid_cents, row.currency),
      state: { tone: state.tone, label: state.label, ...(state.detail ? { detail: state.detail } : {}) },
    };
  });

  // Sample invoices stay listed (marked) after sample mode ends, but real totals leave them out.
  const open = rows.filter((row) => (row.status === "issued" || row.status === "partially_paid") && (staff.sampleMode || !row.is_sample));
  const overdue = open.filter((row) => row.due_on < today);
  const owed = open.reduce((sum, row) => sum + Math.max(0, row.amount_cents - row.paid_cents - row.credited_cents), 0);
  const overdueSum = overdue.reduce((sum, row) => sum + Math.max(0, row.amount_cents - row.paid_cents - row.credited_cents), 0);
  const card = cardReceived(cardPayments?.data ?? [], "CAD");
  const received = card.netCents;
  const refunded = card.refundedCents;
  const paidNote = card.payments ? `${card.payments} card ${card.payments === 1 ? "payment" : "payments"}` : "No card payments yet";
  const oldest = [...overdue].sort((a, b) => a.due_on.localeCompare(b.due_on))[0];
  const daysLate = (due: string) => Math.max(1, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 86_400_000));

  const kpis: FinanceKpi[] = [
    {
      href: "?tab=invoices",
      label: `Owed to ${staff.organizationName}`,
      value: { money: formatMoney(owed, "CAD") },
      note: open.length ? `${open.length} open ${open.length === 1 ? "invoice" : "invoices"}` : "No open invoices",
    },
    {
      href: "?tab=invoices",
      label: "Overdue",
      value: { money: formatMoney(overdueSum, "CAD") },
      note: oldest ? { left: clientOf(oldest.matter_id), right: `${daysLate(oldest.due_on)} ${daysLate(oldest.due_on) === 1 ? "day" : "days"}` } : "Nothing overdue",
      tone: overdue.length ? "bad" : undefined,
    },
    {
      href: "?tab=payments",
      label: "Received by card",
      value: { money: formatMoney(received, "CAD") },
      note: refunded > 0 ? { left: paidNote, right: `${formatMoney(refunded, "CAD")} refunded` } : paidNote,
    },
    // Only billing staff read the firm's Stripe account: for anyone else "Off" would be a guess.
    canBill
      ? {
          href: "?tab=payments",
          label: "Card payments",
          value: { money: cardReady ? "On" : account ? "Setting up" : "Off" },
          note: cardReady ? { left: "Stripe", right: "test mode" } : account ? "Finish the Stripe account" : "Set up a Stripe account",
          tone: cardReady ? undefined : "warn",
        }
      : { href: "?tab=payments", label: "Card payments", value: { money: "—" }, note: "Shown to the firm owner and finance users" },
  ];

  const page: FinanceData = {
    intro: `Invoices for ${staff.organizationName}’s earned fees, paid by card into the firm’s own Stripe account (test mode). Advances held in the client account and government fees paid to IRCC stay separate. A payment never changes a government status.`,
    kpis,
    rows: tableRows,
    // The Draft chip only when this firm has a draft invoice: issued invoices are never drafts.
    chips: rows.some((row) => row.status === "draft") ? undefined : FINANCE_CHIPS.filter((chip) => chip !== "Draft"),
    filterEmpty: true,
    empty: tableRows.length
      ? null
      : invoices.error
        ? { title: "Invoices couldn’t load", copy: "Reload the page. Nothing was changed; if it keeps happening, sign in again." }
        : canBill
        ? { title: "No invoices yet", copy: "Issue an invoice for delivered work or an incurred cost on a matter. The client pays it in their portal.", action: { label: "New invoice", dialog: "dlgInv" } }
        : { title: "No invoices to show", copy: "Invoices are shown to the firm owner and the matter’s finance user." },
  };

  const header: FinanceHeaderData = {
    pills: ["CAD", staff.sampleMode ? { left: staff.organizationName, right: "sample mode" } : staff.organizationName],
    recordPayment: false,
    invoiceTab: null,
    tab,
  };

  const choices = billing.filter((row) => !staff.sampleMode || matterById.get(row.matter_id)?.is_sample);
  const dialog: NewInvoiceDialogData = {
    matters: choices.length
      ? choices.map((row) => ({ value: row.matter_id, left: `${row.client_display_name || row.title} · ${referenceOf(row.matter_id)}` }))
      : [{ value: "", left: "No open matter to invoice" }],
    work: [],
    live: {
      organizationId: org,
      sampleMode: staff.sampleMode,
      currencies: [...INVOICE_CURRENCIES],
      defaultDue: plusDays(today, 30),
      today,
      cardPaymentsReady: cardReady,
      blocked: !canBill
        ? { title: "Billing staff only", copy: "The firm owner or the matter’s finance user issues invoices." }
        : choices.length === 0
          ? { title: "No matter to invoice", copy: staff.sampleMode ? "In sample mode only sample matters take invoices." : "Open a matter first." }
          : null,
    },
  };

  const pk = publishableKey();
  const accountData: FinanceAccountData = {
    organizationId: org,
    firmName: staff.organizationName,
    isOwner: staff.role === "firm_owner",
    configured: Boolean(stripe && pk),
    publishableKey: pk,
    account: account ? { cardPayments: account.card_payments_status, payouts: account.payouts_status, requirementsDue: account.requirements_due } : null,
    canBill,
  };

  let payments: PaymentsData | null = null;
  let refundDialog: RefundDialogData | null = null;
  if (tab === "payments") {
    refundDialog = {
      organizationId: org,
      blocked: !canBill
        ? { title: "Billing staff only", copy: "The firm owner or the matter’s finance user refunds payments." }
        : !stripe
          ? { title: "Stripe isn’t configured", copy: "Refunds go through the firm’s Stripe account, which isn’t reachable in this environment. Nothing can be refunded here." }
          : null,
    };
    const [paymentRows, balance] = await Promise.all([
      loadPaymentRows(supabase, staff, canBill),
      // The account row is only visible to the owner and finance users (RLS).
      account && canBill ? loadBalance(stripe, account) : null,
    ]);
    payments = {
      intro: `Money ${staff.organizationName} received by card, into the firm’s own Stripe account. A payment counts only when Stripe’s signed event confirms it. Stripe runs in test mode: no real card is charged, and Casevoya never holds the money.`,
      currency: "CAD",
      balance,
      rows: paymentRows,
      empty: paymentRows.length
        ? null
        : canBill
          ? { title: "No card payments yet", copy: "Payments show here once a client pays an invoice in their portal and Stripe confirms it." }
          : { title: "No payments to show", copy: "Payments are shown to the firm owner and the matter’s finance user." },
      note: [
        "The same Stripe event arriving twice is counted once (provider",
        "connected account",
        "event ID). A payment in another currency can’t pay a CAD invoice. A failed payment leaves the invoice open, and a refund never takes back more than was received; neither changes the matter stage.",
      ],
    };
  }

  const refunds = tab === "refunds" ? await loadRefunds(supabase, staff, canBill) : null;
  const funds = tab === "funds" ? await loadClientFunds(supabase, staff, canBill, today) : null;
  if (funds && canBill) header.recordPayment = true;
  // Reconciliation: Stripe's payouts are read only for billing staff who see the firm's account.
  const recon: ReconPage | null =
    tab === "recon" ? await loadReconciliation(supabase, staff, canBill, today, account && canBill ? stripe : null, account && canBill ? account.account_id : null) : null;
  const invoiceView: InvoiceViewPage | null = tab === "invoice" && invoiceId ? await loadInvoiceView(supabase, staff, canBill, invoiceId, today) : null;
  // FIN-06: ageing, unbilled time, tax rates and fee references under the Invoices tab; a draft's
  // and an open invoice's own dialogs on its tab.
  const billingPanels =
    tab === "invoices"
      ? await loadFinanceBilling(supabase, {
          staff,
          today,
          invoices: rows,
          matterName: (matterId) => `${clientOf(matterId)} · ${referenceOf(matterId)}`,
        })
      : null;
  const invoiceBilling = invoiceView ? await loadInvoiceBillingDialogs(supabase, { staff, invoice: invoiceView.billing, today, canBill }) : null;
  if (invoiceView) header.invoiceTab = invoiceView.number;
  // An invoice that isn't there (or isn't this person's to see) falls back to the Invoices tab.
  else if (tab === "invoice") header.tab = "invoices";

  return { chrome, header, page, dialog, account: accountData, payments, refunds, refundDialog, funds, recon, invoiceView, billing: billingPanels, invoiceBilling };
}
