/**
 * Pure: Settings > Subscription (ADM-02, T042) and Settings > Retention (SEC-07) from the firm's records.
 *
 * Subscription shows the stored state (organization_subscriptions), the plan and its price from
 * the catalog (product_settings subscription.plans, through public.firm_subscription), the
 * allowances the state gives, real usage counts and Casevoya's invoices. Every amount comes from
 * the catalog: when the catalog lacks one, none is shown.
 *
 * Retention shows the firm's own period (organizations.retention_policy) with its version
 * (retention_policy_versions). Casevoya supplies no statutory period, so none is stated.
 */
import type { PlanDialogData, RetentionData, RetentionRow, SettingsBillingAlert, SubscriptionButton, SubscriptionData, SubscriptionInvoiceRow } from "@/components/sheet/designer/settings-billing";
import { dayMonth } from "@/modules/sheet/home-present";
import { publishedOn } from "@/modules/portal-policies/present";
import { readContinuity, type Continuity } from "@/modules/sheet/sec-present";
import type { PublicPricing } from "@/modules/subscription/pricing";
import { isInterval, isPlan, money, PLAN_NAMES, planLabel, readCatalog, totalCents, type Catalog, type Interval, type Plan } from "@/modules/subscription/catalog";

export type SubscriptionStatus = "trial" | "trial_ended" | "active" | "past_due" | "restricted" | "cancelled" | "archived";

export type SubscriptionRow = {
  status: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  plan?: string | null;
  /** Card trial: no card on file yet, so the trial has not started (20261101100100). */
  card_required?: boolean;
  /** A Stripe subscription exists: a trial on it is Stripe's to end (it converts or cancels). */
  stripe_trial?: boolean;
  cancel_at_period_end?: boolean;
};

export type SubscriptionUsage = {
  seats_active: number;
  seats_invited: number;
  active_matters: number;
  sample_matters: number;
  storage_bytes: number;
  vo_runs_month: number;
  emails_month: number;
  month_start: string;
};

/** public.firm_subscription's `subscription`: the stored row without any Stripe id. */
export type SubscriptionDetail = {
  status: string;
  plan: Plan | null;
  billing_interval: Interval | null;
  extra_seats: number;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  cancelled_at: string | null;
  past_due_since: string | null;
  restricted_at: string | null;
  archived_at: string | null;
  latest_invoice_status: string | null;
  latest_invoice_url: string | null;
  has_billing_account: boolean;
  has_stripe_subscription: boolean;
};

export type Entitlements = {
  status: string | null;
  plan: Plan | null;
  basis: "plan" | "trial" | "enterprise" | "none";
  seats: number | null;
  matters: number | null;
  storage_gb: number | null;
  extra_seats: number;
  new_work_blocked: boolean;
};

export type SubscriptionInvoice = {
  id: string;
  number: string | null;
  status: string;
  amount_due_cents: number;
  amount_paid_cents: number;
  currency: string;
  period_start: string | null;
  period_end: string | null;
  hosted_invoice_url: string | null;
  pdf_url: string | null;
  created_at: string;
};

export type FirmSubscription = {
  subscription: SubscriptionDetail | null;
  entitlements: Entitlements;
  usage: SubscriptionUsage | null;
  catalog: Catalog | null;
  grace: { past_due_days: number; export_window_days: number };
  invoices: SubscriptionInvoice[];
  /** SEC-10: the cancellation continuity (phase, export window end, arrangement, coverage). */
  continuity?: Continuity | null;
};

const STATE: Record<SubscriptionStatus, string> = {
  trial: "Trial",
  trial_ended: "Trial ended",
  active: "Active",
  past_due: "Past due",
  restricted: "Restricted",
  cancelled: "Cancelled",
  archived: "Archived",
};

/** The state the firm is in now: a trial whose end has passed has ended, even before the clock syncs. */
export function subscriptionState(row: SubscriptionRow | null, now: Date): SubscriptionStatus | null {
  if (!row || !(row.status in STATE)) return null;
  const status = row.status as SubscriptionStatus;
  if (status === "trial" && !row.stripe_trial && row.trial_ends_at && new Date(row.trial_ends_at).getTime() <= now.getTime()) return "trial_ended";
  return status;
}

/** The second pill in the Settings top bar: the plan once one is chosen, else the state. */
export function subscriptionPill(row: SubscriptionRow | null, now: Date): string {
  const state = subscriptionState(row, now);
  if (state && isPlan(row?.plan) && (state === "active" || state === "past_due" || state === "restricted")) return `Plan: ${PLAN_NAMES[row!.plan as Plan]}`;
  if (state === "trial" && row?.card_required) return "Subscription: Card needed";
  return state ? `Subscription: ${STATE[state]}` : "Subscription: not available";
}

/** "6.2 GB", "340 MB", "12 KB". */
export function storageSize(bytes: number): string {
  const kb = 1024;
  if (bytes >= kb ** 3) return `${(bytes / kb ** 3).toFixed(1)} GB`;
  if (bytes >= kb ** 2) return `${(bytes / kb ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / kb))} KB`;
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function limit(value: unknown): number | null {
  const n = Number(value);
  return value != null && Number.isInteger(n) && n > 0 ? n : null;
}

function isoOrNull(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

/** Reads public.firm_subscription_usage's JSON; null when it isn't the expected shape. */
export function readUsage(value: unknown): SubscriptionUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const month = typeof row.month_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.month_start) ? row.month_start : null;
  if (!month) return null;
  return {
    seats_active: count(row.seats_active),
    seats_invited: count(row.seats_invited),
    active_matters: count(row.active_matters),
    sample_matters: count(row.sample_matters),
    storage_bytes: count(row.storage_bytes),
    vo_runs_month: count(row.vo_runs_month),
    emails_month: count(row.emails_month),
    month_start: month,
  };
}

/** Reads app.subscription_entitlements' JSON; null when it isn't the expected shape. */
export function readEntitlements(value: unknown): Entitlements | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const basis = row.basis;
  if (basis !== "plan" && basis !== "trial" && basis !== "enterprise" && basis !== "none") return null;
  return {
    status: typeof row.status === "string" ? row.status : null,
    plan: isPlan(row.plan) ? row.plan : null,
    basis,
    seats: limit(row.seats),
    matters: limit(row.matters),
    storage_gb: limit(row.storage_gb),
    extra_seats: count(row.extra_seats),
    new_work_blocked: row.new_work_blocked === true,
  };
}

function readInvoice(value: unknown): SubscriptionInvoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.status !== "string" || typeof row.created_at !== "string") return null;
  const https = (link: unknown) => (typeof link === "string" && link.startsWith("https://") ? link : null);
  return {
    id: row.id,
    number: typeof row.number === "string" ? row.number : null,
    status: row.status,
    amount_due_cents: count(row.amount_due_cents),
    amount_paid_cents: count(row.amount_paid_cents),
    currency: typeof row.currency === "string" ? row.currency.toUpperCase() : "CAD",
    period_start: isoOrNull(row.period_start),
    period_end: isoOrNull(row.period_end),
    hosted_invoice_url: https(row.hosted_invoice_url),
    pdf_url: https(row.pdf_url),
    created_at: row.created_at,
  };
}

/** Reads public.firm_subscription's JSON; null when it isn't the expected shape. */
export function readFirmSubscription(value: unknown): FirmSubscription | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const entitlements = readEntitlements(row.entitlements);
  if (!entitlements) return null;
  const sub = row.subscription && typeof row.subscription === "object" ? (row.subscription as Record<string, unknown>) : null;
  const grace = row.grace && typeof row.grace === "object" ? (row.grace as Record<string, unknown>) : {};
  return {
    subscription:
      sub && typeof sub.status === "string"
        ? {
            status: sub.status,
            plan: isPlan(sub.plan) ? sub.plan : null,
            billing_interval: isInterval(sub.billing_interval) ? sub.billing_interval : null,
            extra_seats: count(sub.extra_seats),
            trial_started_at: isoOrNull(sub.trial_started_at),
            trial_ends_at: isoOrNull(sub.trial_ends_at),
            current_period_end: isoOrNull(sub.current_period_end),
            cancel_at: isoOrNull(sub.cancel_at),
            cancelled_at: isoOrNull(sub.cancelled_at),
            past_due_since: isoOrNull(sub.past_due_since),
            restricted_at: isoOrNull(sub.restricted_at),
            archived_at: isoOrNull(sub.archived_at),
            latest_invoice_status: typeof sub.latest_invoice_status === "string" ? sub.latest_invoice_status : null,
            latest_invoice_url: typeof sub.latest_invoice_url === "string" && sub.latest_invoice_url.startsWith("https://") ? sub.latest_invoice_url : null,
            has_billing_account: sub.has_billing_account === true,
            has_stripe_subscription: sub.has_stripe_subscription === true,
          }
        : null,
    entitlements,
    usage: readUsage(row.usage),
    catalog: readCatalog(row.catalog),
    grace: { past_due_days: limit(grace.past_due_days) ?? 7, export_window_days: limit(grace.export_window_days) ?? 90 },
    invoices: Array.isArray(row.invoices) ? row.invoices.map(readInvoice).filter((inv): inv is SubscriptionInvoice => Boolean(inv)) : [],
    continuity: readContinuity(row.continuity),
  };
}

/** SEC-10: the export window's end as the database counts it (from the later of cancellation and period end). */
function windowEnd(detail: FirmSubscription | null, cancelledAt: string | null, days: number): string | null {
  return detail?.continuity?.windowEndsAt ?? (cancelledAt ? addDays(cancelledAt, days) : null);
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function stateText(row: SubscriptionRow | null, state: SubscriptionStatus | null, detail: SubscriptionDetail | null, grace: FirmSubscription["grace"], timeZone: string, exportsUntil: string | null = null): string {
  if (!row || !state) return "Not available";
  const on = (iso: string) => publishedOn(iso, timeZone);
  if (state === "trial" && row.card_required) return "Not started: add a card to start your 14-day free trial. Nothing is charged today.";
  if (state === "trial" && row.stripe_trial) {
    if (!row.trial_ends_at) return "Free trial";
    return row.cancel_at_period_end
      ? `Free trial, ends ${on(row.trial_ends_at)}. You cancelled, so nothing will be charged.`
      : `Free trial, ends ${on(row.trial_ends_at)}. Your card is charged on ${on(row.trial_ends_at)} unless you cancel before then.`;
  }
  if (state === "trial") {
    const since = row.trial_started_at ? `Trial since ${on(row.trial_started_at)}` : "Trial";
    return row.trial_ends_at ? `${since}, ends ${on(row.trial_ends_at)}` : `${since}, no end date set`;
  }
  if (state === "trial_ended") return row.trial_ends_at ? `Trial ended ${on(row.trial_ends_at)}. Choose a plan to carry on.` : "Trial ended. Choose a plan to carry on.";
  if (!detail) return STATE[state];
  if (state === "active") {
    if (detail.cancel_at) return `Active, cancels at the period end on ${on(detail.cancel_at)}`;
    return detail.current_period_end ? `Active, renews on ${on(detail.current_period_end)}` : "Active";
  }
  if (state === "past_due") {
    const since = detail.past_due_since ? ` since ${on(detail.past_due_since)}` : "";
    const until = detail.past_due_since ? ` New work pauses on ${on(addDays(detail.past_due_since, grace.past_due_days))} unless the payment goes through.` : "";
    return `Past due${since}: the last payment failed.${until}`;
  }
  if (state === "restricted") return `Restricted${detail.restricted_at ? ` since ${on(detail.restricted_at)}` : ""}: payment is overdue, so new work is paused. Your records and exports stay open.`;
  if (state === "cancelled") {
    const when = detail.cancelled_at ? ` on ${on(detail.cancelled_at)}` : "";
    const until = exportsUntil ?? (detail.cancelled_at ? addDays(detail.cancelled_at, grace.export_window_days) : null);
    const window = until ? ` Exports stay open at least until ${on(until)}.` : "";
    return `Cancelled${when}.${window}`;
  }
  return `Archived${detail.archived_at ? ` on ${on(detail.archived_at)}` : ""}. Nothing was deleted; choose a plan to carry on.`;
}

/** "4 of 6", or with no allowance "4 in use. No seat limit is set." (`detail` follows the count). */
function ofLimit(used: number, allowance: number | null, detail: string, noLimit: string): string {
  return allowance === null ? `${used} in use${detail}. ${noLimit}` : `${used} of ${allowance}${detail}`;
}

/** "Download" links for each Casevoya invoice, newest first. */
export function invoiceRows(invoices: readonly SubscriptionInvoice[], timeZone: string): SubscriptionInvoiceRow[] {
  const label: Record<string, string> = { paid: "Paid", open: "Awaiting payment", draft: "Draft", void: "Void", uncollectible: "Not collected" };
  return invoices.map((inv) => ({
    text: `${inv.number ?? "Invoice"} · ${publishedOn(inv.created_at, timeZone)} · ${money(inv.amount_due_cents, inv.currency)} · ${label[inv.status] ?? inv.status}`,
    href: inv.hosted_invoice_url ?? inv.pdf_url,
  }));
}

/** The owner's buttons under the Plan rows: Checkout for a new plan, the portal for a live one. */
export function subscriptionButtons(detail: SubscriptionDetail | null, state: SubscriptionStatus | null, organizationId: string, row: SubscriptionRow | null = null): SubscriptionButton[] {
  if (!state || !detail) return [];
  // Card trial: a trial Stripe runs is changed, or cancelled before it bills, in the portal.
  if (detail.has_stripe_subscription && state === "trial") {
    return [
      { label: "Manage billing", act: "portal", primary: true, organizationId },
      { label: row?.cancel_at_period_end ? "Keep subscription" : "Cancel trial", act: "portal", primary: false, organizationId },
    ];
  }
  if (state === "trial" && row?.card_required) {
    const start: SubscriptionButton = { label: "Add a card and start the trial", act: "plan", primary: true, organizationId };
    return detail.has_billing_account ? [start, { label: "Manage billing", act: "portal", primary: false, organizationId }] : [start];
  }
  if (detail.has_stripe_subscription && (state === "active" || state === "past_due" || state === "restricted")) {
    const portal = (label: string): SubscriptionButton => ({ label, act: "portal", primary: false, organizationId });
    // SEC-10: Cancel subscription opens Casevoya's own dialog (period end, export window, no deletion); keeping it is in the portal.
    const cancel: SubscriptionButton = detail.cancel_at ? portal("Keep subscription") : { label: "Cancel subscription", act: "cancel", primary: false, organizationId };
    return [{ label: "Change plan", act: "portal", primary: true, organizationId }, portal("Manage billing"), cancel];
  }
  const choose: SubscriptionButton = { label: state === "trial" || state === "trial_ended" ? "Choose a plan" : "Choose a plan again", act: "plan", primary: true, organizationId };
  return detail.has_billing_account ? [choose, { label: "Manage billing", act: "portal", primary: false, organizationId }] : [choose];
}

/**
 * Card trial: what the plan dialog says about today's charge. A firm with no card yet gets the
 * full trial; a trial already running (before cards were required) keeps its end date when more
 * than two days are left; anyone else is billed today. The server decides again at Checkout.
 */
export function dialogTrial(
  row: SubscriptionRow | null,
  state: SubscriptionStatus | null,
  offer: PublicPricing | null,
  now: Date,
  on: (iso: string) => string,
): Pick<PlanDialogData, "trialDays" | "trialNote" | "founding"> {
  const founding = offer?.founding ? { percent: offer.founding.percent, months: offer.founding.months } : null;
  if (state !== "trial" || !row) return { trialDays: null, trialNote: null, founding };
  if (row.card_required) return { trialDays: offer?.trialDays || 14, trialNote: null, founding };
  const left = row.trial_ends_at ? new Date(row.trial_ends_at).getTime() - now.getTime() : 0;
  if (!row.stripe_trial && row.trial_ends_at && left > 49 * 3_600_000) {
    return { trialDays: null, trialNote: `$0 today. Your trial carries on until ${on(row.trial_ends_at)}; you are billed then unless you cancel before. Cancel anytime.`, founding };
  }
  return { trialDays: null, trialNote: null, founding };
}

/** The Choose a plan dialog: every priced plan from the catalog, Enterprise as "Contact Casevoya". */
export function planDialog(catalog: Catalog | null, organizationId: string, current: { plan: Plan | null; interval: Interval | null; extraSeats: number }): PlanDialogData {
  const plans: PlanDialogData["plans"] = [];
  for (const plan of ["solo", "practice", "firm"] as const) {
    const tier = catalog?.plans[plan] ?? null;
    plans.push({
      value: plan,
      label: PLAN_NAMES[plan],
      monthlyCents: tier?.monthlyCents ?? null,
      yearlyCents: tier && catalog ? tier.monthlyCents * catalog.annualMonths : null,
      allowances: tier ? `${tier.seats ?? "—"} staff seats · ${tier.matters?.toLocaleString("en-CA") ?? "—"} active matters${tier.storageGb ? ` · ${tier.storageGb} GB` : ""}` : "No price set",
    });
  }
  plans.push({ value: "enterprise", label: `${PLAN_NAMES.enterprise} (contact Casevoya)`, monthlyCents: null, yearlyCents: null, allowances: "Arranged with Casevoya: no limits set here" });
  return {
    organizationId,
    currency: catalog?.currency ?? "CAD",
    annualMonths: catalog?.annualMonths ?? 12,
    extraSeatMonthlyCents: catalog?.extraSeatMonthlyCents ?? null,
    plans,
    selected: current.plan && current.plan !== "enterprise" ? current.plan : "practice",
    interval: current.interval ?? "month",
    extraSeats: current.extraSeats,
  };
}

/** The dialog's total line, as the browser recomputes it: "CAD 349/month" or "No price set". */
export function planTotalText(catalog: Catalog | null, plan: Plan, interval: Interval, extraSeats: number): string {
  if (plan === "enterprise") return "Arranged with Casevoya";
  const cents = totalCents(catalog, plan, interval, extraSeats);
  return cents === null ? "No price set" : `${money(cents, catalog?.currency ?? "CAD")}/${interval}`;
}

export function subscriptionPage(input: {
  firmName: string;
  subscription: SubscriptionRow | null;
  /** Null for roles public.firm_subscription_usage refuses (not owner or finance). */
  usage: SubscriptionUsage | null;
  timeZone: string;
  now: Date;
  /** public.firm_subscription for the owner and finance; null for other roles. */
  detail?: FirmSubscription | null;
  /** A firm owner: the buttons and the plan dialog. */
  canManage?: boolean;
  organizationId?: string;
  /** public.public_pricing: the trial and the founding offer, for the plan dialog. */
  offer?: PublicPricing | null;
}): SubscriptionData {
  const state = subscriptionState(input.subscription, input.now);
  const detail = input.detail ?? null;
  const catalog = detail?.catalog ?? null;
  const ent = detail?.entitlements ?? null;
  const sub = detail?.subscription ?? null;
  const grace = detail?.grace ?? { past_due_days: 7, export_window_days: 90 };
  const usage = input.usage ?? detail?.usage ?? null;
  const on = (iso: string) => publishedOn(iso, input.timeZone);

  let planText: string;
  if (ent?.basis === "plan" && ent.plan) planText = planLabel(catalog, ent.plan, sub?.billing_interval ?? null, sub?.extra_seats ?? 0);
  else if (ent?.basis === "enterprise") planText = planLabel(catalog, "enterprise", null);
  else if (ent?.basis === "trial" && state === "trial") planText = "None chosen yet. No seat or matter limits apply during the trial.";
  else if (ent?.basis === "trial") planText = "None chosen yet. Limits apply once you choose a plan.";
  else planText = "None chosen yet.";
  const trialLimit = ent?.basis === "trial" ? " until you choose a plan." : "";

  const rows: [string, string][] = [
    ["Plan", planText],
    ["State", stateText(input.subscription, state, sub, grace, input.timeZone, windowEnd(detail, sub?.cancelled_at ?? null, grace.export_window_days))],
  ];
  if (usage) {
    const since = `since ${dayMonth(usage.month_start)}`;
    const seatsLimit = ent ? ent.seats : null;
    const extra = ent && ent.extra_seats > 0 && seatsLimit !== null ? ` (${seatsLimit - ent.extra_seats} plan + ${ent.extra_seats} extra)` : "";
    const invited = usage.seats_invited ? `, ${usage.seats_invited} invited` : "";
    const realMatters = Math.max(0, usage.active_matters - usage.sample_matters);
    const sample = usage.sample_matters ? ` (${usage.sample_matters} sample, not counted)` : "";
    const storage = ent?.storage_gb ?? null;
    rows.push(
      ["Seats", ofLimit(usage.seats_active, seatsLimit, `${extra}${invited}`, trialLimit ? `No seat limit${trialLimit}` : "No seat limit is set.")],
      ["Active matters", ofLimit(realMatters, ent ? ent.matters : null, sample, trialLimit ? `No limit${trialLimit}` : "No limit is set.")],
      [
        "Storage",
        storage !== null
          ? `${usage.storage_bytes ? (usage.storage_bytes / 1024 ** 3).toFixed(1) : "0"} of ${storage} GB`
          : usage.storage_bytes
            ? `${storageSize(usage.storage_bytes)} of documents. No allowance${trialLimit || " is set."}`
            : `No documents stored yet. No allowance${trialLimit || " is set."}`,
      ],
      ["Vo runs this month", `${usage.vo_runs_month} ${since}`],
      ["Emails sent this month", `${usage.emails_month} ${since}`],
    );
  }
  const invoices = detail ? invoiceRows(detail.invoices, input.timeZone) : [];
  rows.push(
    ["Invoices from Casevoya", invoices.length ? `${invoices.length} ${invoices.length === 1 ? "invoice" : "invoices"}` : "None yet."],
    [
      "If you cancel",
      `New work stops after the paid period. Cancelling never deletes your records, and client-file exports stay open for at least ${grace.export_window_days} days.`,
    ],
  );

  let alert: SettingsBillingAlert | null = null;
  if (state === "trial" && input.subscription?.card_required) alert = { tone: "info", icon: "alert", title: "Add a card to start your 14-day free trial", body: "$0 today. Real client invitations and real matters open once a card is on file. You are billed when the trial ends unless you cancel before then; cancel anytime." };
  else if (state === "trial" && input.subscription?.stripe_trial && input.subscription.trial_ends_at && !input.subscription.cancel_at_period_end) alert = { tone: "info", icon: "alert", title: `Your free trial ends ${on(input.subscription.trial_ends_at)}`, body: "Your card is charged then, plus applicable taxes, unless you cancel before then in Manage billing." };
  else if (state === "trial_ended") alert = { tone: "warn", icon: "alert", title: "Your trial has ended", body: "Your records are kept and you can still export them. New client portal invitations are paused until you choose a plan." };
  else if (state === "past_due") alert = { tone: "warn", icon: "alert", title: "The last payment failed", body: `Update your card in Manage billing within ${grace.past_due_days} days. After that, new work pauses until the payment goes through; nothing is deleted.` };
  else if (state === "restricted") alert = { tone: "warn", icon: "alert", title: "Payment is overdue, so new work is paused", body: "New client invitations, staff invitations and real matters wait for the payment. Your records and exports stay open." };
  else if (state === "cancelled") alert = { tone: "warn", icon: "alert", title: "Your subscription is cancelled", body: `Your records are kept and you can still export them${sub?.cancelled_at ? ` until at least ${on(windowEnd(detail, sub.cancelled_at, grace.export_window_days)!)}` : ""}.` };
  else if (state === "archived") alert = { tone: "info", icon: "archive", title: "Your subscription is archived", body: "Nothing was deleted. Choose a plan to carry on where you left off." };

  const canManage = Boolean(input.canManage && input.organizationId && detail);
  const buttons = canManage ? subscriptionButtons(sub, state, input.organizationId!, input.subscription) : [];
  const dialog =
    canManage && buttons.some((button) => button.act === "plan")
      ? { ...planDialog(catalog, input.organizationId!, { plan: sub?.plan ?? null, interval: sub?.billing_interval ?? null, extraSeats: sub?.extra_seats ?? 0 }), ...dialogTrial(input.subscription, state, input.offer ?? null, input.now, on) }
      : null;

  const note = [
    detail
      ? catalog
        ? "Prices are in CAD and set by Casevoya; payment goes through Stripe and no card is stored by Casevoya."
        : "Casevoya hasn’t published prices yet. Nothing is charged here and no card is taken."
      : "Plans, prices and invoices are shown to the firm owner and finance.",
    usage ? "Usage counts are live." : "Usage counts are shown to the firm owner and finance.",
  ].join(" ");
  return { payer: input.firmName, rows, alert, note, invoices, buttons, dialog };
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** Where firm setup's slider starts (src/components/port/use-port.ts), and its range. */
export const RETENTION_SLIDER = { start: 12, min: 1, max: 15 } as const;

export type RetentionPolicy = { unit?: unknown; count?: unknown; version?: unknown } | null;

export type RetentionVersion = {
  version: number;
  periodCount: number;
  source: string;
  approvedAt: string;
  approvedBy: string | null;
};

function years(policy: RetentionPolicy): number | null {
  if (!policy || policy.unit !== "years") return null;
  const n = Number(policy.count);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null;
}

function policyVersion(policy: RetentionPolicy): number | null {
  const n = Number(policy?.version);
  return policy && policy.version != null && Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * The version the owner is looking at, as public.set_firm_retention_policy counts it: the last
 * row's, or one more when the period came from setup and has no row yet; 0 with no period.
 */
export function retentionVersion(policy: RetentionPolicy, latest: number | null): number {
  const last = latest ?? 0;
  if (years(policy) === null) return last;
  return policyVersion(policy) === null ? last + 1 : last;
}

export function retentionPage(input: {
  policy: RetentionPolicy;
  latest: RetentionVersion | null;
  /** Who saved firm setup's records step, and when. */
  setup: { at: string; by: string | null } | null;
  holds: { count: number; references: string[] };
  organizationId: string;
  canSave: boolean;
  timeZone: string;
}): RetentionData {
  const period = years(input.policy);
  const version = retentionVersion(input.policy, input.latest?.version ?? null);
  const on = (iso: string) => publishedOn(iso, input.timeZone);
  const by = (name: string | null) => (name ? ` by ${name}` : "");

  let versionRow: string[];
  let applies: string[];
  const latest = input.latest && policyVersion(input.policy) === input.latest.version ? input.latest : null;
  if (period === null) {
    versionRow = ["Not set"];
    applies = ["Matters closed after you save a period"];
  } else if (latest) {
    const how = latest.source === "firm_setup" ? "set in firm setup" : "approved";
    versionRow = [`R-${latest.version}`, `${how}${by(latest.approvedBy)}, ${on(latest.approvedAt)}`];
    applies = [`Matters closed after ${on(latest.approvedAt)}`];
  } else if (policyVersion(input.policy) === null) {
    versionRow = [`R-${version}`, input.setup ? `set in firm setup${by(input.setup.by)}, ${on(input.setup.at)}` : "set in firm setup"];
    applies = [input.setup ? `Matters closed after ${on(input.setup.at)}` : "Matters closed under this period"];
  } else {
    versionRow = [`R-${policyVersion(input.policy)}`];
    applies = ["Matters closed under this period"];
  }

  const refs = input.holds.references.slice(0, 3);
  const more = input.holds.count - refs.length;
  const holds =
    input.holds.count > 0
      ? [`${input.holds.count} active`, ...(refs.length ? [`${refs.join(", ")}${more > 0 ? ` and ${more} more` : ""}`] : [])]
      : ["None active"];
  const rows: RetentionRow[] = [
    ["Policy version", versionRow],
    ["Applies to", applies],
    ["Legal holds", holds],
  ];

  const value = period ?? RETENTION_SLIDER.start;
  const alert: SettingsBillingAlert | null =
    period === null
      ? {
          tone: "warn",
          icon: "alert",
          title: "No retention period is set",
          body: input.canSave ? "Choose how long to keep closed files and save it. Until then, matters can’t be closed." : "Matters can’t be closed until the firm owner sets one.",
        }
      : input.canSave
        ? null
        : { tone: "info", icon: "lock", title: "Only the firm owner can change this", body: "Ask them if the period needs to change." };

  return {
    intro: "How long closed files are kept. The period is your firm’s own choice; a legal hold keeps a matter’s records longer.",
    slider: { value, min: RETENTION_SLIDER.min, max: Math.max(RETENTION_SLIDER.max, value) },
    rows,
    note: "This period is your firm’s setting, not a legal minimum from Casevoya. Check it against your professional and contract obligations. Matters already closed keep the period they closed under.",
    alert,
    save: input.canSave ? { organizationId: input.organizationId, version } : null,
  };
}
