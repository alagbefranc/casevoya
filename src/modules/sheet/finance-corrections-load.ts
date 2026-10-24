import "server-only";
import type Stripe from "stripe";
import type { CreditNoteDialogData, CreditNoteRow, FinanceKpi } from "@/components/sheet/designer/finance";
import type { AllocationRow, CreditReviewDialogData, InvoiceAction, InvoiceCreditRow, InvoiceViewData, LineRow, Step, VoidDialogData } from "@/components/sheet/designer/invoice";
import type { ManualPaymentDialogsData, ReconItemDialogData } from "@/components/sheet/designer/manual-pay";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import type { PayoutRow, ReconAction, ReconData, ReconDialogsData, ReconItem } from "@/components/sheet/designer/recon";
import type { createClient } from "@/lib/supabase/server";
import {
  amountDue,
  canCredit,
  canVoid,
  creditable,
  creditBalance,
  creditNoteState,
  monthLabel,
  reconHistoryTitle,
  signedAmount,
} from "@/modules/finance/corrections-present";
import { MANUAL_METHODS, manualMethodLabel, manualPaymentState, pendingManualCents, reviewersFor } from "@/modules/finance/manual-payments-present";
import { formatAmount, formatMoney } from "@/modules/finance/money";
import { cardBrandName } from "@/modules/finance/payment-receipt";
import { creditNoteHref, invoicePdfHref, reconciliationPdfHref } from "@/modules/finance/receipt-links";
import { longDate } from "@/modules/finance/receipt-pdf";
import { balanceLine, billedTo, FEE_CATEGORY_LABEL, invoiceState, paymentState, shortStripeId } from "@/modules/sheet/finance-present";
import { dayMonth } from "@/modules/sheet/home-present";
import type { SheetStaff } from "@/modules/sheet/load";
import { isoDateInTimeZone } from "@/modules/sheet/present";

/**
 * The Finance page's corrections and reconciliation, read as the signed-in staff member: the single
 * invoice tab (with its credit notes, void and credit note dialogs), the Refunds tab's Credit notes
 * panel, the Reconciliation tab and the Client funds tab's "Last reconciliation" tile. RLS decides
 * what is visible; nothing is invented, and a firm without records gets the empty states.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

const READ = 500;

function capitalize(text: string): string {
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function short(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Staff display names for "who did it" (owner and finance users read them). */
async function staffNames(supabase: Supabase, org: string, canBill: boolean): Promise<(id: string | null | undefined) => string> {
  const names = canBill ? await supabase.rpc("client_fund_staff_names", { p_org: org }) : null;
  const map = new Map((names?.data ?? []).map((row) => [row.user_id, row.display_name]));
  return (id) => (id ? (map.get(id) ?? "Staff member") : "Staff member");
}

async function viewerId(supabase: Supabase): Promise<string> {
  const claims = await supabase.auth.getClaims();
  return typeof claims.data?.claims?.sub === "string" ? claims.data.claims.sub : "";
}

/**
 * Each billable matter's title and applicants, from the billing projection. A finance user reads
 * this but not matter or person rows, so it is what names their matters and clients.
 */
export async function billingNames(supabase: Supabase, org: string): Promise<Map<string, { title: string; client: string | null }>> {
  const billing = await supabase.rpc("list_matter_billing");
  return new Map((billing.data ?? []).filter((row) => row.organization_id === org).map((row) => [row.matter_id, { title: row.title, client: row.client_display_name || null }]));
}

/** The matter's applicants as the billing projection names them (finance users don't read person rows). */
async function clientNames(supabase: Supabase, org: string, matterIds: string[]): Promise<Map<string, string>> {
  if (!matterIds.length) return new Map();
  const [billing, matters] = await Promise.all([
    billingNames(supabase, org),
    // The applicant is who an invoice is billed to; list_matter_billing leaves sample matters out.
    supabase.from("matters").select("id, matter_participants(role, persons(display_name))").eq("organization_id", org).in("id", matterIds),
  ]);
  const parties = new Map((matters.data ?? []).map((row) => [row.id, row.matter_participants ?? []]));
  return new Map(
    matterIds
      .map((id): [string, string | null] => [id, billing.get(id)?.client ?? (parties.has(id) ? billedTo(parties.get(id) ?? []) : (billing.get(id)?.title ?? null))])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

// ---------------------------------------------------------------------------
// Refunds tab: Credit notes panel
// ---------------------------------------------------------------------------

export async function loadCreditNoteRows(supabase: Supabase, staff: SheetStaff, canBill: boolean): Promise<CreditNoteRow[]> {
  const org = staff.organizationId;
  const notes = await supabase
    .from("invoice_credit_notes")
    .select("id, invoice_id, matter_id, number, amount_cents, currency, reason, status, requested_by, issued_by, issued_at, owner_self_approved, declined_by, declined_at, created_at")
    .eq("organization_id", org)
    .order("created_at", { ascending: false })
    .limit(READ);
  const rows = notes.data ?? [];
  if (!rows.length) return [];
  const [invoices, clients, name] = await Promise.all([
    supabase.from("invoices").select("id, number, is_sample").eq("organization_id", org).in("id", [...new Set(rows.map((row) => row.invoice_id))]),
    clientNames(supabase, org, [...new Set(rows.map((row) => row.matter_id))]),
    staffNames(supabase, org, canBill),
  ]);
  const invoiceById = new Map((invoices.data ?? []).map((row) => [row.id, row]));
  const day = (iso: string) => dayMonth(isoDateInTimeZone(new Date(iso), staff.timezone));
  return rows.map((row) => {
    const invoice = invoiceById.get(row.invoice_id);
    const issuedBy =
      row.status === "issued"
        ? `${name(row.issued_by)}${row.owner_self_approved ? " (owner, own draft)" : ""}, ${day(row.issued_at ?? row.created_at)}`
        : row.status === "draft"
          ? `Draft by ${name(row.requested_by)}, waiting for review`
          : `Declined by ${name(row.declined_by)}, ${day(row.declined_at ?? row.created_at)}`;
    return {
      key: row.id,
      number: row.number,
      href: `?tab=invoice&view=${row.invoice_id}`,
      invoice: [`${invoice?.number ?? "Invoice"}${invoice?.is_sample ? " (sample)" : ""}`, clients.get(row.matter_id) ?? "Client"],
      amount: formatAmount(row.amount_cents, row.currency),
      reason: short(row.reason),
      issuedBy,
    };
  });
}

// ---------------------------------------------------------------------------
// Single invoice tab
// ---------------------------------------------------------------------------

export type InvoiceViewPage = {
  number: string;
  view: InvoiceViewData;
  creditDialog: CreditNoteDialogData;
  reviewDialog: CreditReviewDialogData | null;
  voidDialog: VoidDialogData | null;
  /** FIN-09: record, verify and reverse manual payments (billing staff). */
  manualDialogs: ManualPaymentDialogsData | null;
};

export async function loadInvoiceView(supabase: Supabase, staff: SheetStaff, canBill: boolean, invoiceId: string, today: string): Promise<InvoiceViewPage | null> {
  const org = staff.organizationId;
  const isOwner = staff.role === "firm_owner";
  const found = await supabase
    .from("invoices")
    .select("id, matter_id, number, description, fee_category, amount_cents, currency, paid_cents, refunded_cents, credited_cents, client_funds_paid_cents, status, issued_on, due_on, is_sample, voided_at, voided_by, void_reason, created_at")
    .eq("organization_id", org)
    .eq("id", invoiceId)
    .maybeSingle();
  const invoice = found.data;
  if (!invoice) return null;
  const [viewer, matter, clients, payments, transfers, receipts, notes, name, refunds, billing, manual, operating, reviewerRows] = await Promise.all([
    viewerId(supabase),
    supabase.from("matters").select("id, reference, title, is_sample").eq("organization_id", org).eq("id", invoice.matter_id).maybeSingle(),
    clientNames(supabase, org, [invoice.matter_id]),
    supabase
      .from("invoice_payments")
      .select("id, payment_intent_id, last_event_id, amount_cents, amount_received_cents, refunded_cents, currency, status, succeeded_at, updated_at, card_brand, card_last4")
      .eq("organization_id", org)
      .eq("invoice_id", invoice.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("client_fund_entries")
      .select("id, number, amount_cents, status, approved_at, created_at, owner_self_approved")
      .eq("organization_id", org)
      .eq("invoice_id", invoice.id)
      .eq("kind", "transfer")
      .order("created_at", { ascending: true }),
    supabase.from("invoice_payment_receipts").select("id, number, payment_id, entry_id").eq("organization_id", org).eq("invoice_id", invoice.id),
    supabase
      .from("invoice_credit_notes")
      .select("id, number, amount_cents, currency, reason, status, requested_by, issued_by, issued_at, owner_self_approved, credit_balance_cents, created_at")
      .eq("organization_id", org)
      .eq("invoice_id", invoice.id)
      .order("number", { ascending: true }),
    staffNames(supabase, org, canBill),
    // Card refunds on this invoice's payments, for its history (RLS mirrors invoice_payments).
    supabase
      .from("invoice_refunds")
      .select("id, number, amount_cents, currency, status, requested_by, succeeded_at, created_at")
      .eq("organization_id", org)
      .eq("invoice_id", invoice.id)
      .order("created_at", { ascending: true }),
    billingNames(supabase, org),
    // FIN-09: manual payments (billing staff, RLS), the operating accounts and who may review.
    supabase
      .from("invoice_manual_payments")
      .select("id, number, method, external_reference, received_on, operating_account_id, evidence_version_id, evidence_note, amount_cents, currency, status, reviewer_user_id, recorded_by, verified_by, verified_at, self_verified, reversed_at, reversal_reason, created_at")
      .eq("organization_id", org)
      .eq("invoice_id", invoice.id)
      .order("number", { ascending: true }),
    canBill ? supabase.from("firm_operating_accounts").select("id, label, account_last4, is_active").eq("organization_id", org).order("created_at") : null,
    canBill ? supabase.rpc("list_payment_reviewers", { p_org: org }) : null,
  ]);
  const manualRows = manual.data ?? [];
  const pendingManual = pendingManualCents(manualRows);
  const operatingRows = (operating?.data ?? []).filter((row) => row.is_active);
  const operatingLabel = new Map((operating?.data ?? []).map((row) => [row.id, `${row.label} ••• ${row.account_last4}`]));
  const currency = invoice.currency;
  // A finance user can't read the matter row; the billing projection still names it.
  const matterTitle = matter.data?.title || billing.get(invoice.matter_id)?.title || "Matter";
  const money = (minor: number) => formatMoney(minor, currency);
  const amount = (minor: number) => formatAmount(minor, currency);
  const day = (iso: string) => dayMonth(isoDateInTimeZone(new Date(iso), staff.timezone));
  const client = clients.get(invoice.matter_id) ?? "Client";
  const reference = matter.data?.reference || matterTitle;
  const receiptOf = new Map((receipts.data ?? []).map((row) => [row.payment_id ?? row.entry_id ?? "", row]));
  const noteRows = notes.data ?? [];
  const drafts = noteRows.filter((row) => row.status === "draft").reduce((sum, row) => sum + row.amount_cents, 0);
  const listed = (payments.data ?? []).filter((row) => row.status !== "requires_payment");
  const received = listed.filter((row) => row.status === "succeeded" && row.amount_received_cents > 0);
  const transferRows = transfers.data ?? [];
  const moneyState = {
    status: invoice.status,
    amountCents: invoice.amount_cents,
    paidCents: invoice.paid_cents,
    creditedCents: invoice.credited_cents,
    refundedCents: invoice.refunded_cents,
  };
  const due = amountDue(moneyState);
  const balance = creditBalance(moneyState);
  const left = creditable(moneyState, drafts);
  const state = invoiceState(
    invoice.status,
    invoice.due_on,
    today,
    listed.some((row) => row.status === "processing"),
    invoice.refunded_cents > 0 ? money(invoice.refunded_cents) : null,
    invoice.credited_cents > 0 && invoice.status !== "credited" ? money(invoice.credited_cents) : null,
    pendingManual > 0 ? money(pendingManual) : null,
  );
  const label = `${invoice.number}${invoice.is_sample ? " (sample)" : ""}`;

  // Lines: the invoice line, the total, what was paid and credited, the balance due.
  const lines: LineRow[] = [
    {
      key: "line",
      category: { text: FEE_CATEGORY_LABEL[invoice.fee_category] ?? "Fee" },
      description: { parts: [invoice.description] },
      qty: "1",
      tax: "—",
      amount: { text: amount(invoice.amount_cents) },
    },
    { key: "total", category: null, description: { bold: true, parts: ["Total"] }, qty: null, tax: null, amount: { bold: true, text: amount(invoice.amount_cents) } },
  ];
  for (const payment of received) {
    const receipt = receiptOf.get(payment.id);
    const card = payment.card_last4 ? `${cardBrandName(payment.card_brand)} ••••${payment.card_last4}` : "card";
    lines.push({
      key: payment.id,
      category: null,
      description: { parts: [`Paid ${day(payment.succeeded_at ?? payment.updated_at)}`, card, ...(receipt ? [receipt.number] : [])] },
      qty: null,
      tax: null,
      amount: { text: signedAmount(-payment.amount_received_cents, amount) },
    });
  }
  for (const entry of transferRows.filter((row) => row.status === "approved")) {
    const receipt = receiptOf.get(entry.id);
    lines.push({
      key: entry.id,
      category: null,
      description: { parts: [`Paid ${day(entry.approved_at ?? entry.created_at)}`, "client account", entry.number, ...(receipt ? [receipt.number] : [])] },
      qty: null,
      tax: null,
      amount: { text: signedAmount(-entry.amount_cents, amount) },
    });
  }
  for (const payment of manualRows.filter((row) => row.status === "verified")) {
    lines.push({
      key: payment.id,
      category: null,
      description: { parts: [`Paid ${dayMonth(payment.received_on)}`, manualMethodLabel(payment.method), payment.number] },
      qty: null,
      tax: null,
      amount: { text: signedAmount(-payment.amount_cents, amount) },
    });
  }
  for (const note of noteRows.filter((row) => row.status === "issued")) {
    lines.push({
      key: note.id,
      category: null,
      description: { parts: [`Credit note ${note.number}`, short(note.reason, 48)] },
      qty: null,
      tax: null,
      amount: { text: signedAmount(-note.amount_cents, amount) },
    });
  }
  lines.push({
    key: "due",
    category: null,
    description: { bold: true, parts: [balanceLine(invoice.status, due, dayMonth(invoice.due_on))] },
    qty: null,
    tax: null,
    amount: { bold: true, text: amount(due) },
  });

  // Allocations: card payments Stripe acted on and transfers from the client account.
  const allocations: AllocationRow[] = [
    ...listed.map((payment) => {
      const receipt = receiptOf.get(payment.id);
      const settled = payment.status === "succeeded" && payment.amount_received_cents > 0;
      return {
        key: payment.id,
        date: settled ? day(payment.succeeded_at ?? payment.updated_at) : "—",
        source: `Card through ${staff.organizationName}’s Stripe account`,
        evidence: [`Signed event ${shortStripeId(payment.last_event_id ?? payment.payment_intent_id)}`, ...(receipt ? [`receipt ${receipt.number}`] : [])],
        amount: amount(settled ? payment.amount_received_cents : payment.amount_cents),
        state: paymentState(payment.status, { refundedCents: payment.refunded_cents, receivedCents: payment.amount_received_cents, refunded: money(payment.refunded_cents) }),
      };
    }),
    ...transferRows.map((entry) => {
      const receipt = receiptOf.get(entry.id);
      const state: MatterBadge =
        entry.status === "approved"
          ? { tone: "ok", label: entry.owner_self_approved ? "Approved by owner (own request)" : "Approved" }
          : entry.status === "pending_approval"
            ? { tone: "chg", label: "Pending approval" }
            : { tone: "gr", label: "Declined" };
      return {
        key: entry.id,
        date: entry.status === "approved" ? day(entry.approved_at ?? entry.created_at) : "—",
        source: `Transfer from ${client}’s client ledger`,
        evidence: [entry.number, ...(receipt ? [`receipt ${receipt.number}`] : entry.status === "pending_approval" ? ["needs a second approver"] : [])],
        amount: amount(entry.amount_cents),
        state,
      };
    }),
    // FIN-09: manual payments. Only a verified one counts as paid.
    ...manualRows.map((payment) => ({
      key: payment.id,
      date: dayMonth(payment.received_on),
      source: `${capitalize(manualMethodLabel(payment.method))} to ${operatingLabel.get(payment.operating_account_id) ?? "the firm’s operating account"}`,
      evidence: [payment.number, payment.external_reference, payment.evidence_version_id ? "file attached" : short(payment.evidence_note ?? "", 32)],
      amount: amount(payment.amount_cents),
      state: manualPaymentState(payment.status, payment.self_verified),
    })),
  ];

  const creditRows: InvoiceCreditRow[] = noteRows.map((note) => {
    const own = note.requested_by === viewer;
    return {
      key: note.id,
      number: note.number,
      amount: amount(note.amount_cents),
      reason: short(note.reason),
      state: creditNoteState(note.status, note.owner_self_approved),
      ...(note.status === "issued" ? { pdf: creditNoteHref(note.id, org) } : {}),
      ...(note.status === "draft" && canBill
        ? {
            review: {
              "data-cn-review": note.id,
              "data-number": note.number,
              "data-amount": money(note.amount_cents),
              "data-reason": note.reason,
              "data-by": `${name(note.requested_by)}${own ? " (you)" : ""}, ${day(note.created_at)}`,
              "data-can-issue": own && !isOwner ? "0" : "1",
              "data-own": own && isOwner ? "1" : "0",
            },
          }
        : {}),
    };
  });

  // History: issued, credits, then where it stands.
  const history: Step[] = [];
  const closed = invoice.status !== "issued" && invoice.status !== "partially_paid";
  const anyMoney = received.length > 0 || transferRows.some((row) => row.status === "approved");
  history.push({
    key: "issued",
    state: invoice.status === "issued" && !anyMoney && !noteRows.some((row) => row.status === "issued") ? "now" : "done",
    title: "Issued",
    note: [invoice.issued_on ? dayMonth(invoice.issued_on) : "—", "in the client’s portal"],
  });
  for (const note of noteRows.filter((row) => row.status === "issued")) {
    history.push({ key: note.id, state: "done", title: `Credit note ${note.number}`, note: [day(note.issued_at ?? note.created_at), `${money(note.amount_cents)} by ${name(note.issued_by)}`] });
  }
  // Card refunds: succeeded ones are history; pending ones say so.
  for (const refund of (refunds.data ?? []).filter((row) => row.status === "succeeded" || row.status === "pending" || row.status === "requires_action")) {
    const done = refund.status === "succeeded";
    history.push({
      key: refund.id,
      state: "done",
      title: `Refund ${refund.number}`,
      note: [day(refund.succeeded_at ?? refund.created_at), `${formatMoney(refund.amount_cents, refund.currency)} to the card${done ? "" : ", waiting for Stripe"}`],
    });
  }
  if (invoice.status === "voided") {
    history.push({ key: "voided", state: "now", title: "Voided", note: [day(invoice.voided_at ?? invoice.created_at), `by ${name(invoice.voided_by)}: ${short(invoice.void_reason ?? "", 80)}`] });
  } else if (invoice.status === "partially_paid") {
    history.push({ key: "partial", state: "now", title: "Partially paid", note: [`${money(invoice.paid_cents)} allocated`] });
  } else if (closed) {
    history.push({ key: "closed", state: "now", title: state.label, note: [invoice.status === "credited" ? `${money(invoice.credited_cents)} credited` : `${money(invoice.paid_cents)} allocated`] });
  } else if (history.length > 1) {
    history.push({ key: "open", state: "now", title: "Issued", note: [`${money(due)} due`] });
  }
  if (!closed) history.push({ key: "paid", state: "", title: "Paid", note: ["When the balance is allocated"] });

  const blockers = {
    payments: listed.filter((row) => row.status === "processing" || row.status === "succeeded").length,
    transfers: transferRows.filter((row) => row.status === "pending_approval" || row.status === "approved").length,
    receipts: (receipts.data ?? []).length,
    creditNotes: noteRows.filter((row) => row.status !== "declined").length,
  };
  const manualHeld = manualRows.filter((row) => row.status === "pending_verification" || row.status === "verified").length;
  const voidable = canBill && manualHeld === 0 && canVoid(moneyState, blockers);
  const creditOk = canBill && canCredit(invoice.status) && left > 0;
  const actions: InvoiceAction[] = [];
  if (creditOk) actions.push({ label: "Issue a credit note", attrs: { "data-dlg": "dlgCN" } });
  if (voidable) actions.push({ label: "Void invoice", attrs: { "data-dlg": "dlgVoid" } });
  // FIN-09: record an e-transfer, cheque, wire or cash payment; verify it; mark it reversed or failed.
  const open = invoice.status === "issued" || invoice.status === "partially_paid";
  const manualMax = Math.max(0, due - pendingManual);
  if (canBill && open && manualMax > 0) actions.push({ label: "Record a manual payment", attrs: { "data-dlg": "dlgMP" } });
  if (canBill) {
    for (const payment of manualRows) {
      const recordedByViewer = payment.recorded_by === viewer;
      if (payment.status === "pending_verification") {
        const named = payment.reviewer_user_id === viewer;
        actions.push({
          label: `Verify ${payment.number}`,
          primary: true,
          attrs: {
            "data-mp-open": "verify",
            "data-payment": payment.id,
            "data-number": payment.number,
            "data-amount": money(payment.amount_cents),
            "data-method": `${manualMethodLabel(payment.method)} · ${payment.external_reference}`,
            "data-received": longDate(payment.received_on),
            "data-dest": operatingLabel.get(payment.operating_account_id) ?? "Operating account",
            "data-evidence": payment.evidence_version_id ? `File attached${payment.evidence_note ? ` · ${short(payment.evidence_note, 80)}` : ""}` : (payment.evidence_note ?? "—"),
            ...(payment.evidence_version_id ? { "data-evidence-file": payment.evidence_version_id } : {}),
            "data-by": `${name(payment.recorded_by)}${recordedByViewer ? " (you)" : ""}, ${day(payment.created_at)}`,
            "data-reviewer": `${name(payment.reviewer_user_id)}${named ? " (you)" : ""}`,
            // The named reviewer or a firm owner; the database also checks the second person.
            "data-can-verify": named || isOwner ? "1" : "0",
          },
        });
      }
      if (payment.status === "pending_verification" || payment.status === "verified") {
        actions.push({
          label: `Mark ${payment.number} reversed or failed`,
          attrs: {
            "data-mp-open": "reverse",
            "data-payment": payment.id,
            "data-verified": payment.status === "verified" ? "1" : "0",
            "data-summary": `${payment.number} · ${money(payment.amount_cents)} · ${manualMethodLabel(payment.method)} ${payment.external_reference} · ${payment.status === "verified" ? "verified, counted as paid" : "pending verification"}`,
          },
        });
      }
    }
  }
  // The invoice as a PDF, drawn from the invoice as it stands (the receipts' layout).
  if (invoice.status !== "draft") actions.push({ label: "Download PDF", attrs: {}, href: invoicePdfHref(invoice.id, org) });

  const fromFunds = invoice.client_funds_paid_cents > 0;
  const view: InvoiceViewData = {
    number: label,
    client,
    intro: [`Matter ${reference}${matter.data?.is_sample ? " (sample)" : ""}`, `${matterTitle}. Billed to ${client}. Payee: ${staff.organizationName}.`],
    badge: { tone: state.tone, label: state.label, ...(state.detail ? { detail: state.detail } : {}) },
    tags: [
      { label: "Issued", value: invoice.issued_on ? longDate(invoice.issued_on) : "—" },
      { label: due > 0 || invoice.status === "issued" || invoice.status === "partially_paid" ? "Balance due" : "Was due", value: longDate(invoice.due_on) },
    ],
    lock: invoice.status === "voided" ? ["Voided", "can’t be paid or edited"] : ["Issued", "can’t be edited"],
    lines,
    allocations,
    allocationsEmpty: "Nothing is allocated to this invoice yet.",
    allocationsNote:
      "A successful checkout page isn’t proof of payment. Only Stripe’s signed event, an approved transfer from the client account or a manual payment its reviewer verified counts. A credit note reduces what’s owed; it isn’t a payment.",
    creditNotes: { rows: creditRows, empty: canBill ? "No credit notes. Correct an issued invoice with a credit note; it can’t be edited." : "No credit notes." },
    creditBalance:
      balance > 0
        ? {
            title: `${money(balance)} to refund to the client`,
            copy: `${invoice.status === "voided" ? "A payment arrived after this invoice was voided." : "Credits on this invoice are more than what was still owed."} A credit note doesn’t move money: refund it separately. ${received.length ? "Refund a card payment from the Payments tab." : ""}${fromFunds ? " Money paid from the client account went to the firm’s operating account; return it to the client from there and keep the evidence." : ""}`.replace(/\s+/g, " ").trim(),
          }
        : null,
    preview: null,
    history,
    actions,
  };

  const creditDialog: CreditNoteDialogData = {
    live: {
      organizationId: org,
      invoiceId: invoice.id,
      invoice: label,
      maxCents: left,
      hint: left > 0 ? `Up to ${money(left)}, the amount not already credited or refunded${due > 0 && due < left ? ` (${money(due)} is unpaid)` : ""}` : "Nothing left to credit",
      blocked: !canBill
        ? { title: "Billing staff only", copy: "The firm owner or the matter’s finance user drafts credit notes." }
        : !creditOk
          ? { title: "Nothing to credit", copy: "This invoice is voided, fully credited, or has drafts waiting for review that cover the rest." }
          : null,
    },
  };
  return {
    number: label,
    view,
    creditDialog,
    reviewDialog: canBill && noteRows.some((row) => row.status === "draft") ? { organizationId: org } : null,
    voidDialog: voidable ? { organizationId: org, invoiceId: invoice.id, invoice: label, blocked: null } : null,
    manualDialogs: canBill
      ? {
          organizationId: org,
          today,
          invoiceId: invoice.id,
          invoice: label,
          matterId: invoice.matter_id,
          maxCents: manualMax,
          hint: manualMax > 0 ? `${currency}. Up to ${money(manualMax)}${pendingManual > 0 ? `, counting ${money(pendingManual)} waiting for verification` : ""}` : "Nothing left to pay",
          methods: MANUAL_METHODS,
          accounts: operatingRows.length
            ? operatingRows.map((row) => ({ value: row.id, label: `${row.label} ••• ${row.account_last4} (operating)` }))
            : [{ value: "", label: "No operating account yet" }],
          reviewers: reviewersFor(reviewerRows?.data ?? [], invoice.matter_id, viewer),
          blocked: !operatingRows.length
            ? { title: "Add the operating account first", copy: "The firm owner records the firm’s operating account (bank and last four digits) in Settings > Subscription > Bank accounts." }
            : !open || manualMax <= 0
              ? { title: "Nothing to record", copy: "This invoice has nothing left to pay, counting payments waiting for verification." }
              : null,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation tab
// ---------------------------------------------------------------------------

type ItemJson = { kind?: unknown; entry_id?: unknown; number?: unknown; ledger_id?: unknown; amount_cents?: unknown; date?: unknown };

/** Stripe payouts on the firm's connected account (test mode), with what each contains, matched to Casevoya's card payments. */
async function loadPayouts(stripe: Stripe, accountId: string, supabase: Supabase, staff: SheetStaff): Promise<NonNullable<ReconData["payouts"]>> {
  const note =
    "Read from Stripe for the firm’s account (test mode): each payout to the firm’s operating account, with the card payments, refunds and Stripe fees in it. Card money never goes to the client account. Matched by PaymentIntent to the card payments Casevoya recorded.";
  try {
    const payouts = await stripe.payouts.list({ limit: 5 }, { stripeAccount: accountId });
    const rows: PayoutRow[] = [];
    for (const payout of payouts.data) {
      if (payout.livemode) continue;
      const transactions = await stripe.balanceTransactions.list({ payout: payout.id, limit: 100, expand: ["data.source"] }, { stripeAccount: accountId });
      let paymentCount = 0;
      let gross = 0;
      let refunds = 0;
      let fees = 0;
      const intents: string[] = [];
      for (const txn of transactions.data) {
        fees += txn.fee;
        if (txn.type === "charge" || txn.type === "payment") {
          paymentCount += 1;
          gross += txn.amount;
          const source = txn.source;
          if (source && typeof source === "object" && "payment_intent" in source) {
            const intent = (source as Stripe.Charge).payment_intent;
            const id = typeof intent === "string" ? intent : intent?.id;
            if (id) intents.push(id);
          }
        } else if (txn.type === "refund" || txn.type === "payment_refund") {
          refunds += txn.amount;
        }
      }
      const known = intents.length
        ? await supabase.from("invoice_payments").select("payment_intent_id").eq("organization_id", staff.organizationId).in("payment_intent_id", intents)
        : null;
      const matched = (known?.data ?? []).length;
      const currency = payout.currency.toUpperCase();
      const state: MatterBadge =
        payout.status === "paid"
          ? { tone: "ok", label: "Paid out" }
          : payout.status === "failed"
            ? { tone: "bad", label: "Failed" }
            : payout.status === "canceled"
              ? { tone: "gr", label: "Canceled" }
              : { tone: "rev", label: "On the way" };
      rows.push({
        key: payout.id,
        // Stripe gives the arrival day as midnight UTC: read the day itself, not the firm's clock then.
        date: dayMonth(new Date(payout.arrival_date * 1000).toISOString().slice(0, 10)),
        amount: `${formatAmount(payout.amount, currency)}${currency === "CAD" ? "" : ` ${currency}`}`,
        payments: paymentCount ? `${paymentCount} · ${formatAmount(gross, currency)}` : "—",
        refunds: refunds ? signedAmount(refunds, (minor) => formatAmount(minor, currency)) : "—",
        fees: fees ? formatAmount(fees, currency) : "—",
        matched: paymentCount ? `${matched} of ${paymentCount}` : "—",
        state,
      });
    }
    return { rows, empty: "No payouts from Stripe yet.", note };
  } catch {
    return { rows: [], empty: "Stripe payouts couldn’t be read right now.", note };
  }
}

export type ReconPage = { data: ReconData; dialogs: ReconDialogsData; /** FIN-12: Add an outstanding deposit or cheque. */ itemDialog: ReconItemDialogData | null };

/** FIN-12: the accountant and practice reviewer validate before the figures are relied on. */
export const RECON_VALIDATION_BANNER = {
  title: "Not yet validated for production financial use",
  copy: "Your accountant and the practice reviewer must validate the chart of accounts, these figures and this report before the firm relies on them for its client account. Casevoya records what the firm enters; it is not an accounting system and reads no bank feed.",
};

export async function loadReconciliation(
  supabase: Supabase,
  staff: SheetStaff,
  canBill: boolean,
  today: string,
  stripe: Stripe | null,
  stripeAccountId: string | null,
): Promise<ReconPage> {
  const org = staff.organizationId;
  const isOwner = staff.role === "firm_owner";
  const [viewer, accounts, recs, name, parties] = await Promise.all([
    viewerId(supabase),
    supabase.from("client_accounts").select("id, label, institution, account_last4, is_active").eq("organization_id", org).order("created_at"),
    supabase
      .from("client_account_reconciliations")
      .select("*")
      .eq("organization_id", org)
      .order("statement_date", { ascending: false })
      .order("prepared_at", { ascending: false })
      .limit(200),
    staffNames(supabase, org, canBill),
    canBill ? supabase.rpc("list_client_fund_parties") : null,
  ]);
  const accountRows = (accounts.data ?? []).filter((row) => row.is_active);
  const accountById = new Map((accounts.data ?? []).map((row) => [row.id, row]));
  const recRows = recs.data ?? [];
  const pendingRow = recRows.find((row) => row.status === "pending_review") ?? null;
  const signed = recRows.filter((row) => row.status === "reconciled" || row.status === "exceptions");
  const lastSigned = new Map<string, string>();
  for (const row of signed) if (!lastSigned.has(row.client_account_id)) lastSigned.set(row.client_account_id, row.statement_date);
  const day = (iso: string) => dayMonth(isoDateInTimeZone(new Date(iso), staff.timezone));
  const multiple = accountRows.length > 1;

  let pending: ReconData["pending"] = null;
  let summary: string[] = [];
  let adjustedDifference = 0;
  if (pendingRow) {
    const account = accountById.get(pendingRow.client_account_id);
    const items = (Array.isArray(pendingRow.items) ? pendingRow.items : []) as ItemJson[];
    // Client names for the items: the entries this person may read (RLS), then the billing projection.
    const entryIds = items.map((item) => (typeof item.entry_id === "string" ? item.entry_id : "")).filter(Boolean);
    const entries = entryIds.length ? await supabase.from("client_fund_entries").select("id, person_id").eq("organization_id", org).in("id", entryIds) : null;
    const personOf = new Map((entries?.data ?? []).map((row) => [row.id, row.person_id]));
    const personName = new Map((parties?.data ?? []).filter((row) => row.organization_id === org).map((row) => [row.person_id, row.display_name]));
    const clientOf = (entryId: string) => {
      const person = personOf.get(entryId);
      return (person && personName.get(person)) || "a client on a matter you don’t bill";
    };
    // FIN-12: the bank side's outstanding items (deposits in transit, outstanding cheques).
    const adjustments = await supabase
      .from("client_reconciliation_adjustments")
      .select("id, kind, description, reference, item_date, amount_cents")
      .eq("organization_id", org)
      .eq("reconciliation_id", pendingRow.id)
      .is("removed_at", null)
      .order("item_date", { ascending: true })
      .order("created_at", { ascending: true });
    const adjustmentRows = adjustments.data ?? [];
    const inTransit = adjustmentRows.filter((row) => row.kind === "deposit_in_transit").reduce((sum, row) => sum + Number(row.amount_cents), 0);
    const cheques = adjustmentRows.filter((row) => row.kind === "outstanding_cheque").reduce((sum, row) => sum + Number(row.amount_cents), 0);
    const statement = Number(pendingRow.statement_balance_cents);
    const ledgerBalance = Number(pendingRow.ledger_balance_cents);
    const adjusted = statement + inTransit - cheques;
    const difference = adjusted - ledgerBalance;
    adjustedDifference = difference;
    const deposits = items.filter((item) => item.kind === "deposit_pending_verification");
    const notSent = items.filter((item) => item.kind === "transfer_not_sent");
    const sumOf = (list: ItemJson[]) => list.reduce((sum, item) => sum + Number(item.amount_cents ?? 0), 0);
    const toFunds: ReconAction = { label: "Verify", href: "?tab=funds" };
    const itemRows: ReconItem[] = items.map((item, index) => {
      const entryId = typeof item.entry_id === "string" ? item.entry_id : "";
      const number = typeof item.number === "string" ? item.number : "";
      const date = typeof item.date === "string" ? dayMonth(item.date) : "—";
      const cents = Number(item.amount_cents ?? 0);
      return item.kind === "deposit_pending_verification"
        ? { key: entryId || String(index), item: [`Deposit not verified (${number})`, clientOf(entryId)], bank: date, ledger: "—", amount: formatAmount(cents, "CAD"), action: canBill ? toFunds : null }
        : {
            key: entryId || String(index),
            item: [`Approved transfer not sent (${number})`, clientOf(entryId)],
            bank: "—",
            ledger: date,
            amount: formatAmount(cents, "CAD"),
            action: canBill ? { label: "Record bank transfer", href: "?tab=funds" } : null,
          };
    });
    for (const row of adjustmentRows) {
      const transit = row.kind === "deposit_in_transit";
      itemRows.push({
        key: row.id,
        item: [transit ? "Deposit in transit" : "Outstanding cheque", short(row.description, 60), ...(row.reference ? [row.reference] : [])],
        bank: transit ? "—" : dayMonth(row.item_date),
        ledger: transit ? dayMonth(row.item_date) : "—",
        amount: transit ? formatAmount(Number(row.amount_cents), "CAD") : signedAmount(-Number(row.amount_cents), (minor) => formatAmount(minor, "CAD")),
        action: canBill ? { label: "Remove", attrs: { "data-rec-item-remove": row.id, "data-org": org } } : null,
      });
    }
    const count = itemRows.length;
    const countLabel = `${count} outstanding ${count === 1 ? "item" : "items"}`;
    const own = pendingRow.prepared_by === viewer;
    const canSign = canBill && (!own || isOwner);
    const preparer = name(pendingRow.prepared_by);
    const explain = [
      deposits.length ? `${formatMoney(sumOf(deposits), "CAD")} in ${deposits.length === 1 ? "a deposit" : `${deposits.length} deposits`} the bank may show but the ledger doesn’t count until verified.` : "",
      notSent.length
        ? `${formatMoney(sumOf(notSent), "CAD")} in approved transfers still in the account (the control ledger counts it, the client ledgers don’t).`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    const adjustmentNote = inTransit || cheques
      ? `, ${[inTransit ? `+ ${formatMoney(inTransit, "CAD")} in transit` : "", cheques ? `− ${formatMoney(cheques, "CAD")} in outstanding cheques` : ""].filter(Boolean).join(" ")}`
      : "";
    pending = {
      cards: [
        {
          title: "Adjusted bank balance",
          value: signedAmount(adjusted, (minor) => formatMoney(minor, "CAD")),
          note: `Statement ${signedAmount(statement, (minor) => formatMoney(minor, "CAD"))} to ${dayMonth(pendingRow.statement_date)}, bank ••• ${account?.account_last4 ?? "—"}${adjustmentNote}`,
          ...(difference !== 0 ? { tone: "bad" as const } : {}),
        },
        {
          title: "Control ledger",
          value: signedAmount(Number(pendingRow.ledger_balance_cents), (minor) => formatMoney(minor, "CAD")),
          note: "In the client account per Casevoya’s records",
        },
        {
          title: "Client ledgers, total",
          value: signedAmount(Number(pendingRow.client_ledgers_total_cents), (minor) => formatMoney(minor, "CAD")),
          note: `${pendingRow.client_count} ${pendingRow.client_count === 1 ? "client" : "clients"}`,
        },
      ],
      alert:
        difference === 0
          ? {
              tone: "info",
              title: ["The adjusted bank balance matches the control ledger", countLabel],
              copy: count ? explain : "Nothing is outstanding. It can be signed as reconciled.",
              action: null,
            }
          : {
              tone: "warn",
              title: [`${signedAmount(difference, (minor) => formatMoney(minor, "CAD"))} difference`, countLabel],
              copy: `The adjusted bank balance and the control ledger don’t agree as of ${dayMonth(pendingRow.statement_date)}. ${explain} Add the deposits in transit and outstanding cheques the statement doesn’t show yet, verify what’s outstanding and prepare it again, or sign it with exceptions that explain the difference.`.replace(/\s+/g, " "),
              action: deposits.length && canBill ? { label: deposits.length === 1 ? "Verify the payment" : "Verify the payments", primary: true, href: "?tab=funds" } : null,
            },
      items: itemRows,
      itemsEmpty: "Nothing outstanding as of the statement date.",
      addItem: canBill ? { label: "Add an outstanding deposit or cheque", attrs: { "data-dlg": "dlgRecItem" } } : null,
      draftPdf: canBill ? reconciliationPdfHref(pendingRow.id, org) : undefined,
      steps: [
        { key: "prepared", state: "done", title: `Prepared by ${preparer}`, note: [day(pendingRow.prepared_at), ...(pendingRow.preparer_note ? [short(pendingRow.preparer_note, 80)] : [])] },
        {
          key: "review",
          state: "now",
          title: "Review and sign-off",
          note: [own && !isOwner ? `Someone other than ${preparer}` : own ? "You, as the firm owner (own preparation)" : "Waiting for a second person"],
        },
      ],
      sign: {
        label: "Sign reconciliation",
        disabled: !canSign,
        why: !canBill
          ? "The firm owner or a finance user signs it"
          : !canSign
            ? "You prepared it; the firm owner or another finance user signs it"
            : difference !== 0
              ? "The difference isn’t zero: sign it with exceptions, or prepare it again"
              : null,
        attrs: { "data-dlg": "dlgRecSign" },
        // The preparer can't sign but may discard it and prepare it again (the dialog holds Discard).
        ...(canBill && !canSign ? { discard: { "data-dlg": "dlgRecSign" } } : {}),
      },
    };
    summary = [
      `As of ${longDate(pendingRow.statement_date)}${multiple && account ? ` (${account.label} ••• ${account.account_last4})` : ""}`,
      `statement ${formatMoney(Number(pendingRow.statement_balance_cents), "CAD")}`,
      ...(adjusted !== statement ? [`adjusted ${signedAmount(adjusted, (minor) => formatMoney(minor, "CAD"))}`] : []),
      `control ledger ${formatMoney(Number(pendingRow.ledger_balance_cents), "CAD")}`,
      `difference ${signedAmount(difference, (minor) => formatMoney(minor, "CAD"))}`,
    ];
  }

  const history = signed.map((row) => {
    const account = accountById.get(row.client_account_id);
    const who = row.owner_self_signed ? `${name(row.signed_by)} (owner, own preparation)` : `${name(row.prepared_by)} and ${name(row.signed_by)}`;
    return {
      key: row.id,
      month: `${monthLabel(row.statement_date)}${multiple && account ? ` · ••• ${account.account_last4}` : ""}`,
      // The adjusted bank balance it was signed with (rows signed before FIN-12's workspace: the statement).
      bank: signedAmount(Number(row.adjusted_balance_cents ?? row.statement_balance_cents), (minor) => formatAmount(minor, "CAD")),
      control: signedAmount(Number(row.ledger_balance_cents), (minor) => formatAmount(minor, "CAD")),
      clients: signedAmount(Number(row.client_ledgers_total_cents), (minor) => formatAmount(minor, "CAD")),
      signed: `${who}, ${row.signed_at ? day(row.signed_at) : "—"}${row.status === "exceptions" ? ", with exceptions" : ""}`,
      pdf: reconciliationPdfHref(row.id, org),
    };
  });

  const blocked = !canBill
    ? { title: "Billing staff only", copy: "The firm owner or a finance user reconciles the client account." }
    : !accountRows.length
      ? { title: "Add the client account first", copy: "The firm owner records the client account on the Client funds tab." }
      : pendingRow
        ? { title: "One is waiting for review", copy: "Sign or discard the reconciliation waiting for review before preparing another." }
        : null;
  const start: ReconData["start"] = pendingRow
    ? null
    : accounts.error || recs.error
      ? { title: "Reconciliations couldn’t load", copy: "Reload the page. Nothing was changed; if it keeps happening, sign in again.", action: null }
      : !accountRows.length
      ? { title: "No client account yet", copy: "Reconciliation compares the client account’s bank statement with the ledger. The firm owner adds the account on the Client funds tab first.", action: canBill ? { label: "Go to Client funds", href: "?tab=funds" } : null }
      : canBill
        ? {
            title: "No reconciliation waiting for review",
            copy: "Take the client account’s bank statement, enter its closing balance and date, and Casevoya works out the control ledger, the client ledgers and what’s outstanding as of that date. A second person signs it.",
            action: { label: "Prepare a reconciliation", primary: true, attrs: { "data-dlg": "dlgRec" } },
          }
        : { title: "No reconciliation to show", copy: "Reconciliations are shown to the firm owner and finance users.", action: null };

  const payouts = canBill && stripe && stripeAccountId ? await loadPayouts(stripe, stripeAccountId, supabase, staff) : null;

  const data: ReconData = {
    period: pendingRow ? monthLabel(pendingRow.statement_date) : null,
    intro: `Three-way check of ${staff.organizationName}’s client account: the bank statement’s closing balance, the control ledger and the total of all client ledgers, as of the statement date. Casevoya computes the ledger side from verified deposits, bank transfers recorded as sent, refunds and corrections; it reads no bank feed. Your accountant validates the chart of accounts before live use.`,
    pending,
    start,
    history,
    // "Earlier months" is wrong while this month's own reconciliation is in the list.
    historyTitle: reconHistoryTitle(signed.map((row) => row.statement_date), today),
    historyEmpty: { title: "No signed reconciliations yet", copy: "Signed reconciliations are listed here, month by month. They can’t be changed once signed." },
    payouts,
    banner: RECON_VALIDATION_BANNER,
  };
  const dialogs: ReconDialogsData = {
    organizationId: org,
    today,
    accounts: accountRows.length
      ? accountRows.map((row) => ({ value: row.id, label: `${row.label} ••• ${row.account_last4}`, data: lastSigned.has(row.id) ? { "data-after": lastSigned.get(row.id) as string } : undefined }))
      : [{ value: "", label: "No client account yet" }],
    blocked,
    pending: pendingRow
      ? {
          id: pendingRow.id,
          difference: adjustedDifference,
          summary,
          canSign: canBill && (pendingRow.prepared_by !== viewer || isOwner),
          ownPreparation: pendingRow.prepared_by === viewer && isOwner,
        }
      : null,
  };
  return {
    data,
    dialogs,
    itemDialog: pendingRow && canBill ? { organizationId: org, reconciliationId: pendingRow.id, statementDate: pendingRow.statement_date } : null,
  };
}

/** The Client funds tab's "Last reconciliation" tile (the Designer's fourth tile). */
export async function loadLastReconciliationKpi(supabase: Supabase, staff: SheetStaff, canBill: boolean): Promise<FinanceKpi> {
  const org = staff.organizationId;
  const [recs, name] = await Promise.all([
    supabase
      .from("client_account_reconciliations")
      .select("statement_date, status, prepared_by, signed_by, owner_self_signed")
      .eq("organization_id", org)
      .in("status", ["reconciled", "exceptions", "pending_review"])
      .order("statement_date", { ascending: false })
      .limit(20),
    staffNames(supabase, org, canBill),
  ]);
  const rows = recs.data ?? [];
  const last = rows.find((row) => row.status === "reconciled" || row.status === "exceptions");
  const waiting = rows.some((row) => row.status === "pending_review");
  if (!last) {
    return { href: "?tab=recon", label: "Last reconciliation", value: { money: "—" }, note: waiting ? "First one waiting for review" : "Not reconciled yet", tone: waiting ? undefined : "warn" };
  }
  const who = last.owner_self_signed ? `Signed by ${name(last.signed_by)} (owner)` : `Signed by ${name(last.prepared_by)} and ${name(last.signed_by)}`;
  return {
    href: "?tab=recon",
    label: "Last reconciliation",
    value: { money: dayMonth(last.statement_date) },
    note: last.status === "exceptions" ? { left: who, right: "with exceptions" } : waiting ? { left: who, right: "next one waiting" } : who,
    tone: last.status === "exceptions" ? "warn" : undefined,
  };
}
