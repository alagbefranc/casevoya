import "server-only";
import type { FinanceData, FinanceHeaderData, FinanceKpi, InvoiceRow, NewInvoiceDialogData } from "@/components/sheet/designer/finance";
import { createClient } from "@/lib/supabase/server";
import { stripeServer } from "@/lib/stripe/server";
import { publishableKey } from "@/modules/finance/keys";
import { formatAmount, formatMoney, INVOICE_CURRENCIES } from "@/modules/finance/money";
import { retrieveAccountStatus } from "@/modules/finance/stripe-account";
import { loadSheetChrome } from "@/modules/sheet/chrome-load";
import { FEE_CATEGORY_LABEL, invoiceState } from "@/modules/sheet/finance-present";
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
};

function short(text: string, max = 48): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * The Designer's Finance page for a firm, read as the signed-in staff member. RLS decides what is
 * visible: the firm owner sees every invoice, a finance user those on assigned matters.
 */
export async function loadSheetFinance(staff: SheetStaff, tab: "invoices" | "payments") {
  const supabase = await createClient({ organizationId: staff.organizationId });
  const org = staff.organizationId;
  const today = isoDateInTimeZone(new Date(), staff.timezone);
  const canBill = BILLING_ROLES.has(staff.role);

  const [chrome, invoices, billable, accountRow] = await Promise.all([
    loadSheetChrome(staff, "/sheet/finance"),
    supabase
      .from("invoices")
      .select("id, matter_id, number, description, fee_category, amount_cents, currency, paid_cents, status, issued_on, due_on, is_sample, created_at")
      .eq("organization_id", org)
      .order("created_at", { ascending: false })
      .limit(INVOICES_READ),
    canBill ? supabase.rpc("list_matter_billing") : null,
    supabase.from("firm_payment_accounts").select("account_id, card_payments_status, payouts_status, requirements_due").eq("organization_id", org).maybeSingle(),
  ]);
  const rows = invoices.data ?? [];
  const billing = (billable?.data ?? []).filter((row) => row.organization_id === org && row.stage !== "closed");
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
    const state = invoiceState(row.status, row.due_on, today, processingIds.has(row.id));
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
      state: { tone: state.tone, label: state.label },
    };
  });

  const open = rows.filter((row) => row.status === "issued" || row.status === "partially_paid");
  const overdue = open.filter((row) => row.due_on < today);
  const owed = open.reduce((sum, row) => sum + (row.amount_cents - row.paid_cents), 0);
  const overdueSum = overdue.reduce((sum, row) => sum + (row.amount_cents - row.paid_cents), 0);
  const received = rows.reduce((sum, row) => sum + row.paid_cents, 0);
  const paidCount = rows.filter((row) => row.paid_cents > 0).length;
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
      note: paidCount ? `${paidCount} ${paidCount === 1 ? "invoice" : "invoices"} paid` : "No payments yet",
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
  };

  return { chrome, header, page, dialog, account: accountData };
}
