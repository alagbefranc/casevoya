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
import { createClient } from "@/lib/supabase/server";
import { stripeServer } from "@/lib/stripe/server";
import { publishableKey } from "@/modules/finance/keys";
import { formatAmount, formatMoney, INVOICE_CURRENCIES } from "@/modules/finance/money";
import { retrieveAccountStatus } from "@/modules/finance/stripe-account";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import {
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
import { dayMonth } from "@/modules/sheet/home-present";
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
  const matters = matterIds.length
    ? await supabase.from("matters").select("id, title, matter_participants(role, persons(display_name))").eq("organization_id", org).in("id", matterIds)
    : null;
  const clientByMatter = new Map(
    (matters?.data ?? []).map((row) => [
      row.id,
      (row.matter_participants ?? [])
        .filter((party) => party.role === "applicant")
        .map((party) => party.persons?.display_name)
        .filter((name): name is string => Boolean(name))
        .join(", ") ||
        row.title ||
        "Client",
    ]),
  );
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
  const [labels, held] = await Promise.all([
    invoiceLabels(supabase, org, [...new Set(rows.map((row) => row.invoice_id))]),
    canBill && received.length
      ? supabase.from("invoice_refunds").select("payment_id, amount_cents").eq("organization_id", org).in("status", [...HELD_REFUND_STATUSES]).in("payment_id", received)
      : null,
  ]);
  const heldByPayment = new Map<string, number>();
  for (const refund of held?.data ?? []) heldByPayment.set(refund.payment_id, (heldByPayment.get(refund.payment_id) ?? 0) + refund.amount_cents);
  return rows.map((row) => {
    const invoice = labels.get(row.invoice_id);
    const settled = row.status === "succeeded" && row.amount_received_cents > 0;
    const refundable = settled ? Math.max(0, row.amount_received_cents - (heldByPayment.get(row.id) ?? 0)) : 0;
    const client = invoice?.client ?? "Client";
    const goesTo = invoice?.number ?? "Invoice";
    return {
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
  const [refunds, disputes] = await Promise.all([
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
    intro: `Card refunds and the disputes Stripe reported for ${staff.organizationName}. Refunding a payment isn’t the same as crediting an invoice; each keeps its own state and links (FIN-13). A refund counts only when Stripe’s signed event confirms it. Disputes never hold back or delete a client’s records, and neither changes a matter’s stage or government status.`,
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
export async function loadSheetFinance(staff: SheetStaff, tab: FinanceHeaderData["tab"]) {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const today = isoDateInTimeZone(new Date(), staff.timezone);
  const canBill = BILLING_ROLES.has(staff.role);

  const [chrome, invoices, billable, samples, accountRow] = await Promise.all([
    loadSheetChrome(staff, "/sheet/finance"),
    supabase
      .from("invoices")
      .select("id, matter_id, number, description, fee_category, amount_cents, currency, paid_cents, refunded_cents, status, issued_on, due_on, is_sample, created_at")
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
  const [matters, processing] = await Promise.all([
    matterIds.length ? supabase.from("matters").select("id, reference, title, is_sample").eq("organization_id", org).in("id", matterIds) : null,
    invoiceIds.length
      ? supabase.from("invoice_payments").select("invoice_id").eq("organization_id", org).eq("status", "processing").in("invoice_id", invoiceIds)
      : null,
  ]);
  const matterById = new Map((matters?.data ?? []).map((row) => [row.id, row]));
  const clientByMatter = new Map(billing.map((row) => [row.matter_id, row.client_display_name || row.title]));
  const processingIds = new Set((processing?.data ?? []).map((row) => row.invoice_id));
  const clientOf = (matterId: string) => clientByMatter.get(matterId) || matterById.get(matterId)?.title || "Matter";
  const referenceOf = (matterId: string) => {
    const matter = matterById.get(matterId);
    const label = matter?.reference || matter?.title || "—";
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
    const state = invoiceState(row.status, row.due_on, today, processingIds.has(row.id), row.refunded_cents > 0 ? formatMoney(row.refunded_cents, row.currency) : null);
    return {
      key: row.id,
      flags: [state.flag].filter(Boolean),
      number: { href: `/sheet/matters/${row.matter_id}`, label: row.number },
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

  const open = rows.filter((row) => row.status === "issued" || row.status === "partially_paid");
  const overdue = open.filter((row) => row.due_on < today);
  const owed = open.reduce((sum, row) => sum + (row.amount_cents - row.paid_cents), 0);
  const overdueSum = overdue.reduce((sum, row) => sum + (row.amount_cents - row.paid_cents), 0);
  const refunded = rows.reduce((sum, row) => sum + row.refunded_cents, 0);
  const received = rows.reduce((sum, row) => sum + row.paid_cents, 0) - refunded;
  const paidCount = rows.filter((row) => row.paid_cents > 0).length;
  const paidNote = paidCount ? `${paidCount} ${paidCount === 1 ? "invoice" : "invoices"} paid` : "No payments yet";
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
    {
      href: "?tab=payments",
      label: "Card payments",
      value: { money: cardReady ? "On" : account ? "Setting up" : "Off" },
      note: cardReady ? { left: "Stripe", right: "test mode" } : account ? "Finish the Stripe account" : "Set up a Stripe account",
      tone: cardReady ? undefined : "warn",
    },
  ];

  const page: FinanceData = {
    intro: `Invoices for ${staff.organizationName}’s earned fees, paid by card into the firm’s own Stripe account (test mode). Advances held in the client account and government fees paid to IRCC stay separate. A payment never changes a government status.`,
    kpis,
    rows: tableRows,
    empty: tableRows.length
      ? null
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

  return { chrome, header, page, dialog, account: accountData, payments, refunds, refundDialog };
}
