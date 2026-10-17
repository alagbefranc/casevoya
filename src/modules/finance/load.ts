import "server-only";

import { createClient } from "@/lib/supabase/server";

export type FinanceInvoice = {
  id: string;
  number: string;
  kind: string;
  status: string;
  currency: string;
  totalCents: number;
  balanceCents: number;
  governmentFeeNote: string | null;
  matterId: string | null;
  matterTitle: string;
  billingName: string | null;
  dueOn: string | null;
  payable: boolean;
};

export type FinancePlan = {
  code: string;
  monthlyCents: number | null;
  seats: number | null;
  activeMatters: number | null;
  quoted: boolean;
};

export type FinanceSnapshot = {
  currency: string;
  extraSeatMonthlyCents: number | null;
  annualDiscountBps: number | null;
  plans: FinancePlan[];
  subscriptionStatus: string | null;
  subscriptionPlan: string | null;
  subscriptionInterval: string | null;
  subscriptionAmountCents: number | null;
  connectAccountId: string | null;
  connectStatus: string | null;
  invoices: FinanceInvoice[];
  clientFundsCents: number;
  exceptions: { id: string; detail: string }[];
};

export type PortalFinance = {
  invoices: FinanceInvoice[];
  receipts: { id: string; number: string; amountCents: number; currency: string; invoiceId: string | null }[];
  connectEnabled: boolean;
};

const EMPTY: FinanceSnapshot = {
  currency: "cad",
  extraSeatMonthlyCents: null,
  annualDiscountBps: null,
  plans: [],
  subscriptionStatus: null,
  subscriptionPlan: null,
  subscriptionInterval: null,
  subscriptionAmountCents: null,
  connectAccountId: null,
  connectStatus: null,
  invoices: [],
  clientFundsCents: 0,
  exceptions: [],
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function cents(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function invoice(row: unknown, withMatter: boolean): FinanceInvoice | null {
  const item = record(row);
  if (!item || typeof item.id !== "string") return null;
  return {
    id: item.id,
    number: text(item.number) ?? "Invoice",
    kind: text(item.kind) ?? "professional_services",
    status: text(item.status) ?? "issued",
    currency: text(item.currency) ?? "cad",
    totalCents: cents(item.total_cents),
    balanceCents: cents(item.balance_cents),
    governmentFeeNote: text(item.government_fee_note),
    matterId: text(item.matter_id),
    matterTitle: text(item.matter_title) ?? "Matter",
    billingName: withMatter ? text(item.billing_name) : null,
    dueOn: text(item.due_on),
    payable: item.payable === true,
  };
}

export function parseFinanceSnapshot(value: unknown): FinanceSnapshot {
  const body = record(value);
  if (!body) return EMPTY;
  const catalog = record(body.plans);
  const planRows = record(catalog?.plans);
  const plans: FinancePlan[] = planRows
    ? Object.entries(planRows).map(([code, raw]) => {
        const plan = record(raw);
        return {
          code,
          monthlyCents: plan && plan.monthly_cents != null ? cents(plan.monthly_cents) : null,
          seats: plan && plan.seats != null ? cents(plan.seats) : null,
          activeMatters: plan && plan.active_matters != null ? cents(plan.active_matters) : null,
          quoted: plan?.quoted === true,
        };
      })
    : [];
  const subscription = record(body.subscription);
  const connect = record(body.connect);
  const funds = list(body.client_funds).reduce<number>((sum, row) => sum + cents(record(row)?.cents), 0);
  return {
    currency: text(catalog?.currency) ?? "cad",
    extraSeatMonthlyCents: catalog && catalog.extra_seat_monthly_cents != null ? cents(catalog.extra_seat_monthly_cents) : null,
    annualDiscountBps: catalog && catalog.annual_discount_bps != null ? cents(catalog.annual_discount_bps) : null,
    plans,
    subscriptionStatus: text(subscription?.status),
    subscriptionPlan: text(subscription?.plan_code),
    subscriptionInterval: text(subscription?.billing_interval),
    subscriptionAmountCents: subscription && subscription.amount_cents != null ? cents(subscription.amount_cents) : null,
    connectAccountId: text(connect?.account_id),
    connectStatus: text(connect?.status),
    invoices: list(body.invoices).map((row) => invoice(row, true)).filter((row): row is FinanceInvoice => row != null),
    clientFundsCents: funds,
    exceptions: list(body.exceptions)
      .map((row) => {
        const item = record(row);
        if (!item || typeof item.id !== "string" || typeof item.detail !== "string") return null;
        return { id: item.id, detail: item.detail };
      })
      .filter((row): row is { id: string; detail: string } => row != null),
  };
}

export function parsePortalFinance(value: unknown): PortalFinance {
  const body = record(value);
  return {
    invoices: list(body?.invoices).map((row) => invoice(row, false)).filter((row): row is FinanceInvoice => row != null),
    receipts: list(body?.receipts)
      .map((row) => {
        const item = record(row);
        if (!item || typeof item.id !== "string") return null;
        return {
          id: item.id,
          number: text(item.number) ?? "Receipt",
          amountCents: cents(item.amount_cents),
          currency: text(item.currency) ?? "cad",
          invoiceId: text(item.invoice_id),
        };
      })
      .filter((row): row is PortalFinance["receipts"][number] => row != null),
    connectEnabled: body?.connect_enabled === true,
  };
}

export async function loadFinanceSnapshot(organizationId: string, matterId: string | null): Promise<FinanceSnapshot> {
  const supabase = await createClient({ organizationId });
  const { data, error } = await supabase.rpc("finance_snapshot", { p_matter_id: matterId });
  if (error || !data) return EMPTY;
  return parseFinanceSnapshot(data);
}

export async function loadPortalFinance(organizationId: string): Promise<PortalFinance> {
  const supabase = await createClient({ organizationId });
  const { data, error } = await supabase.rpc("portal_finance_snapshot");
  if (error || !data) return { invoices: [], receipts: [], connectEnabled: false };
  return parsePortalFinance(data);
}
