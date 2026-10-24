/**
 * FIN-06 page data, pure: rows read under row-level security in, the live-only billing panels'
 * data out (billing-live.tsx). Nothing is invented: no rates, no fees, no sample rows.
 */
import type { BillingButton, FinanceBillingData, MatterWorkData, QuoteRow, TaxChoice, TimeRow } from "@/components/sheet/designer/billing-live";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { AGEING_BUCKETS, durationLabel, invoiceAgeing, percentLabel, rateLabel, timeAmountCents, type AgeingInvoice } from "@/modules/billing/present";
import { formatAmount, formatMoney } from "@/modules/finance/money";
import { dayMonthYear } from "@/modules/sheet/matter-present";

export type TimeEntryRow = {
  id: string;
  membership_id: string;
  worked_on: string;
  minutes: number | null;
  started_at: string | null;
  rate_cents: number;
  description: string;
  billable: boolean;
  discarded_at: string | null;
  created_at: string;
};

/** The invoice a time entry is on (not voided, not a discarded draft). */
export type BilledOn = { number: string; status: string };

export function timeState(entry: Pick<TimeEntryRow, "minutes" | "billable">, billed: BilledOn | undefined): MatterBadge {
  if (entry.minutes === null) return { tone: "rev", label: "Running" };
  if (billed) return billed.status === "draft" ? { tone: "gr", label: `On draft ${billed.number}` } : { tone: "ok", label: `Billed on ${billed.number}` };
  if (!entry.billable) return { tone: "gr", label: "Not billable" };
  return { tone: "chg", label: "Unbilled" };
}

/** Unbilled billable time: total minutes and amount (each line rounded, as the invoice will be). */
export function unbilledTotals(entries: readonly TimeEntryRow[], billed: ReadonlyMap<string, BilledOn>): { minutes: number; cents: number; count: number } {
  let minutes = 0;
  let cents = 0;
  let count = 0;
  for (const entry of entries) {
    if (entry.discarded_at || entry.minutes === null || !entry.billable || billed.has(entry.id)) continue;
    minutes += entry.minutes;
    cents += timeAmountCents(entry.minutes, entry.rate_cents);
    count++;
  }
  return { minutes, cents, count };
}

export type AcceptedQuote = {
  id: string;
  title: string;
  totalCents: number;
  instalments: { label: string; amount_cents: number; paid_as: string }[];
  /** A draft or issued invoice made from the quote's lines. */
  invoiced: { number: string; status: string } | null;
  plan: null | {
    id: string;
    status: string;
    items: { id: string; position: number; label: string; amount_cents: number; paid_as: string; due_on: string; invoiced: { number: string; status: string } | null }[];
  };
};

const PAID_AS: Record<string, string> = { advance: "Advance (client account)", invoice_after_delivery: "Invoice after delivery" };

/** "14:05" in the firm's timezone. */
export function clockTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  }
}

function open(dialog: string, data: Record<string, string>): Record<string, string> {
  const attrs: Record<string, string> = { "data-billing-open": dialog };
  for (const [key, value] of Object.entries(data)) attrs[`data-b-${key}`] = value;
  return attrs;
}

export function matterWork(input: {
  organizationId: string;
  matterId: string;
  today: string;
  timeZone: string;
  defaultDue: string;
  viewerMembershipId: string;
  canLog: boolean;
  canBill: boolean;
  closed: boolean;
  entries: readonly TimeEntryRow[];
  billed: ReadonlyMap<string, BilledOn>;
  names: ReadonlyMap<string, string>;
  quotes: readonly AcceptedQuote[] | null;
  taxes: TaxChoice[];
}): MatterWorkData {
  const live = input.entries.filter((entry) => !entry.discarded_at);
  const running = live.find((entry) => entry.minutes === null && entry.membership_id === input.viewerMembershipId) ?? null;
  const rows: TimeRow[] = [...live]
    .sort((a, b) => b.worked_on.localeCompare(a.worked_on) || b.created_at.localeCompare(a.created_at))
    .map((entry) => {
      const billed = input.billed.get(entry.id);
      const own = entry.membership_id === input.viewerMembershipId;
      const actions: BillingButton[] = [];
      if (entry.minutes === null && own) actions.push({ label: "Stop", attrs: { "data-billing-act": "timer-stop", "data-org": input.organizationId, "data-entry": entry.id } });
      if (!billed && (own || input.canBill)) actions.push({ label: "Discard", attrs: { "data-billing-act": "time-discard", "data-org": input.organizationId, "data-entry": entry.id } });
      return {
        key: entry.id,
        date: dayMonthYear(entry.worked_on, input.today),
        who: own ? "You" : (input.names.get(entry.membership_id) ?? "Staff member"),
        description: entry.description,
        duration: entry.minutes === null ? "Running" : durationLabel(entry.minutes),
        rate: rateLabel(entry.rate_cents),
        amount: entry.minutes === null ? "—" : formatAmount(timeAmountCents(entry.minutes, entry.rate_cents), "CAD"),
        state: timeState(entry, billed),
        actions,
      };
    });
  const totals = unbilledTotals(live, input.billed);
  const actions: BillingButton[] = [];
  if (input.canLog && !input.closed) actions.push({ label: "Log time", attrs: { "data-dlg": "dlgTime" }, primary: true });
  if (input.canBill && totals.count > 0) actions.push({ label: "Draft invoice from unbilled time", attrs: open("dlgTimeInv", { matter: input.matterId }) });

  let quotes: MatterWorkData["quotes"] = null;
  const planDialogs: MatterWorkData["planDialogs"] = [];
  if (input.canBill && input.quotes) {
    const quoteRows: QuoteRow[] = input.quotes.map((quote, index) => {
      const plan = quote.plan && quote.plan.status === "active" ? quote.plan : null;
      const quoteActions: BillingButton[] = [];
      if (!quote.invoiced && !plan) {
        quoteActions.push({ label: "Draft invoice from quote", attrs: open("dlgQuoteInv", { agreement: quote.id, title: quote.title }) });
        if (quote.instalments.length) {
          const id = `dlgPlan${index}`;
          planDialogs.push({
            id,
            agreementId: quote.id,
            title: quote.title,
            instalments: quote.instalments.map((row) => ({ label: row.label, amount: formatMoney(row.amount_cents, "CAD"), paidAs: PAID_AS[row.paid_as] ?? row.paid_as })),
          });
          quoteActions.push({ label: "Set up instalments", attrs: { "data-dlg": id } });
        }
      }
      const state: MatterBadge = quote.invoiced
        ? { tone: quote.invoiced.status === "draft" ? "gr" : "ok", label: quote.invoiced.status === "draft" ? `On draft ${quote.invoiced.number}` : `Invoiced ${quote.invoiced.number}` }
        : plan
          ? { tone: "blue", label: "Instalment plan" }
          : { tone: "chg", label: "Not invoiced" };
      return {
        key: quote.id,
        title: quote.title,
        total: formatMoney(quote.totalCents, "CAD"),
        state,
        actions: quoteActions,
        plan: plan
          ? {
              state: { tone: "blue", label: "Active" },
              rows: plan.items.map((item) => {
                const itemActions: BillingButton[] = [];
                if (item.paid_as === "invoice_after_delivery" && !item.invoiced && item.amount_cents > 0) {
                  itemActions.push({ label: "Draft invoice", attrs: open("dlgInstInv", { item: item.id }) });
                }
                const due = item.due_on < input.today;
                const itemState: MatterBadge = item.invoiced
                  ? { tone: item.invoiced.status === "draft" ? "gr" : "ok", label: item.invoiced.status === "draft" ? `On draft ${item.invoiced.number}` : `Invoiced ${item.invoiced.number}` }
                  : item.paid_as === "advance"
                    ? { tone: due ? "bad" : "blue", label: due ? "Advance due" : "Advance" }
                    : { tone: due ? "bad" : "chg", label: due ? "Due, not invoiced" : "Not invoiced" };
                return {
                  key: item.id,
                  label: item.label,
                  due: dayMonthYear(item.due_on, input.today),
                  amount: formatAmount(item.amount_cents, "CAD"),
                  paidAs: PAID_AS[item.paid_as] ?? item.paid_as,
                  state: itemState,
                  actions: itemActions,
                };
              }),
              actions: [{ label: "Cancel plan", attrs: open("dlgPlanX", { plan: plan.id }) }],
            }
          : null,
      };
    });
    quotes = { rows: quoteRows, empty: "No accepted quote on this matter. Quotes are built and sent from Agreements > Quote; the client accepts them in the portal." };
  }

  return {
    organizationId: input.organizationId,
    matterId: input.matterId,
    today: input.today,
    time: {
      rows,
      summary: totals.count ? [`${durationLabel(totals.minutes)} unbilled`, formatMoney(totals.cents, "CAD")] : ["Nothing unbilled"],
      empty: input.canLog ? "No time logged on this matter yet." : "No time logged on this matter.",
      actions,
      running: running ? { id: running.id, text: `${running.description}. Started at ${running.started_at ? clockTime(running.started_at, input.timeZone) : "—"}; stop it from its row.` } : null,
    },
    quotes,
    taxes: input.taxes,
    defaultDue: input.defaultDue,
    planDialogs,
  };
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export type TaxRateRow = { id: string; name: string; rate_percent: number | string; effective_from: string; effective_to: string | null; approved_by: string; source_note: string | null };

export function taxState(rate: Pick<TaxRateRow, "effective_from" | "effective_to">, today: string): MatterBadge {
  if (rate.effective_from > today) return { tone: "blue", label: "Upcoming" };
  if (rate.effective_to && rate.effective_to < today) return { tone: "gr", label: "Ended" };
  return { tone: "ok", label: "In effect" };
}

/** The tax names a draft can use: every name the firm has a rate for (in effect or upcoming). */
export function taxChoices(rates: readonly TaxRateRow[], today: string): TaxChoice[] {
  const names = new Map<string, string>();
  for (const rate of rates) {
    if (rate.effective_to && rate.effective_to < today) continue;
    const key = rate.name.toLowerCase();
    if (!names.has(key)) names.set(key, rate.name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b)).map((name) => {
    const now = rates.find((rate) => rate.name.toLowerCase() === name.toLowerCase() && taxState(rate, today).label === "In effect");
    return { value: name, label: now ? `${name} (${percentLabel(now.rate_percent)} today)` : `${name} (not in effect today)` };
  });
}

export type FeeReferenceRow = { id: string; section: string | null; fee_group: string | null; name: string; amount_cents: number; source_url: string; retrieved_at: string; snapshot_sha256: string; status: string };

export function feeState(status: string): MatterBadge {
  if (status === "approved") return { tone: "ok", label: "Approved" };
  if (status === "pending_review") return { tone: "chg", label: "Waiting for review" };
  if (status === "rejected") return { tone: "gr", label: "Rejected" };
  return { tone: "gr", label: "Superseded" };
}

const FEES_SHOWN = 40;

export function financeBilling(input: {
  organizationId: string;
  today: string;
  defaultDue: string;
  timeZone: string;
  canBill: boolean;
  canManageRates: boolean;
  canFetchFees: boolean;
  canReviewFees: boolean;
  invoices: readonly AgeingInvoice[];
  sampleMode: boolean;
  unbilled: readonly { matterId: string; matter: string; minutes: number; cents: number }[];
  rates: readonly TaxRateRow[];
  fees: readonly FeeReferenceRow[];
}): FinanceBillingData {
  const counted = input.invoices.filter((row) => input.sampleMode || !row.is_sample);
  const buckets = invoiceAgeing(counted, input.today);
  const org = input.organizationId;
  const rateRows = [...input.rates]
    .sort((a, b) => a.name.localeCompare(b.name) || b.effective_from.localeCompare(a.effective_from))
    .map((rate) => {
      const state = taxState(rate, input.today);
      const actions: BillingButton[] =
        input.canManageRates && state.label !== "Ended" ? [{ label: "End", attrs: open("dlgTaxEnd", { rate: rate.id }) }] : [];
      return {
        key: rate.id,
        name: rate.name,
        rate: percentLabel(rate.rate_percent),
        from: dayMonthYear(rate.effective_from, input.today),
        to: rate.effective_to ? dayMonthYear(rate.effective_to, input.today) : "—",
        approvedBy: rate.approved_by,
        source: rate.source_note ?? "",
        state,
        actions,
      };
    });

  // The fee references: the approved snapshot, or the one waiting for review.
  const pending = input.fees.filter((row) => row.status === "pending_review");
  const approved = input.fees.filter((row) => row.status === "approved");
  const shown = approved.length ? approved : pending;
  const first = shown[0];
  const feeActions: BillingButton[] = [];
  if (input.canFetchFees) feeActions.push({ label: "Read IRCC’s fee list now", attrs: { "data-billing-act": "fees-fetch", "data-org": org } });
  if (input.canReviewFees && pending.length) feeActions.push({ label: "Review", attrs: { "data-dlg": "dlgFeeReview" }, primary: true });
  const retrieved = first ? new Date(first.retrieved_at) : null;
  const retrievedLabel = retrieved ? `${new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(retrieved)}` : "";

  return {
    organizationId: org,
    today: input.today,
    ageing: {
      rows: buckets.map((row, index) => ({ label: AGEING_BUCKETS[index], invoices: row.invoices, amount: formatAmount(row.cents, "CAD") })),
      total: { invoices: buckets.reduce((sum, row) => sum + row.invoices, 0), amount: formatAmount(buckets.reduce((sum, row) => sum + row.cents, 0), "CAD") },
      note: "Open CAD invoices by what’s still owed and how many days past their due date, counted on the firm’s today. Current means not yet due. Drafts, paid, voided and credited invoices aren’t counted.",
    },
    unbilled: input.canBill
      ? {
          rows: input.unbilled.map((row) => ({
            key: row.matterId,
            matter: row.matter,
            time: durationLabel(row.minutes),
            amount: formatAmount(row.cents, "CAD"),
            actions: [{ label: "Draft invoice", attrs: open("dlgTimeInv", { matter: row.matterId }) }],
          })),
          empty: "No unbilled billable time. Staff log time on a matter’s Billing tab.",
        }
      : null,
    taxes: {
      rows: rateRows,
      empty: "No tax rates. The firm (or its accountant) adds the rates it charges, with the dates they apply; Casevoya never picks one. Until then, invoices carry no tax line.",
      actions: input.canManageRates ? [{ label: "Add a tax rate", attrs: { "data-dlg": "dlgTax" } }] : [],
    },
    fees: {
      intro:
        "Government fees go on an invoice as a disbursement with their official source. These references are read by the server from IRCC’s fee list, with the page’s retrieval time and fingerprint, and can be picked only after a licensed member approves them. Staff may also type a fee with its source URL and the date they checked it.",
      rows: shown.slice(0, FEES_SHOWN).map((row) => ({
        key: row.id,
        section: [row.section, row.fee_group].filter(Boolean).join(" · ") || "—",
        name: row.name,
        amount: formatAmount(row.amount_cents, "CAD"),
        state: feeState(row.status),
      })),
      more: shown.length > FEES_SHOWN ? `${shown.length - FEES_SHOWN} more are offered when adding a government fee to a draft.` : null,
      source: first ? [`Source ${first.source_url.split("#")[0]}`, `retrieved ${retrievedLabel}`, `SHA-256 ${first.snapshot_sha256.slice(0, 12)}…`] : [],
      empty: "No fee references yet. Read IRCC’s fee list, or type a government fee with its source on a draft invoice.",
      actions: feeActions,
    },
    taxChoices: taxChoices(input.rates, input.today),
    defaultDue: input.defaultDue,
    pending: pending.length ? { sha256: pending[0].snapshot_sha256, rows: pending.length } : null,
  };
}
