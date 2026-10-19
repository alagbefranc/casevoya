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
import { isInterval, isPlan, money, PLAN_NAMES, planLabel, readCatalog, totalCents, type Catalog, type Interval, type Plan } from "@/modules/subscription/catalog";

export type SubscriptionStatus = "trial" | "trial_ended" | "active" | "past_due" | "restricted" | "cancelled" | "archived";

export type SubscriptionRow = {
  status: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  plan?: string | null;
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
  if (status === "trial" && row.trial_ends_at && new Date(row.trial_ends_at).getTime() <= now.getTime()) return "trial_ended";
  return status;
}

/** The second pill in the Settings top bar: the plan once one is chosen, else the state. */
export function subscriptionPill(row: SubscriptionRow | null, now: Date): string {
  const state = subscriptionState(row, now);
  if (state && isPlan(row?.plan) && (state === "active" || state === "past_due" || state === "restricted")) return `Plan: ${PLAN_NAMES[row!.plan as Plan]}`;
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
  };
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function stateText(row: SubscriptionRow | null, state: SubscriptionStatus | null, detail: SubscriptionDetail | null, grace: FirmSubscription["grace"], timeZone: string): string {
  if (!row || !state) return "Not available";
  const on = (iso: string) => publishedOn(iso, timeZone);
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
    const window = detail.cancelled_at ? ` Exports stay open at least until ${on(addDays(detail.cancelled_at, grace.export_window_days))}.` : "";
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
export function subscriptionButtons(detail: SubscriptionDetail | null, state: SubscriptionStatus | null, organizationId: string): SubscriptionButton[] {
  if (!state || !detail) return [];
  if (detail.has_stripe_subscription && (state === "active" || state === "past_due" || state === "restricted")) {
    const portal = (label: string): SubscriptionButton => ({ label, act: "portal", primary: false, organizationId });
    return [{ label: "Change plan", act: "portal", primary: true, organizationId }, portal("Manage billing"), portal(detail.cancel_at ? "Keep subscription" : "Cancel at period end")];
  }
  const choose: SubscriptionButton = { label: state === "trial" || state === "trial_ended" ? "Choose a plan" : "Choose a plan again", act: "plan", primary: true, organizationId };
  return detail.has_billing_account ? [choose, { label: "Manage billing", act: "portal", primary: false, organizationId }] : [choose];
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
  else if (ent?.basis === "trial" && state === "trial") planText = "None chosen yet. Your trial has Solo allowances.";
  else if (ent?.basis === "trial") planText = "None chosen yet. Solo allowances apply until you choose one.";
  else planText = "None chosen yet.";

  const rows: [string, string][] = [
    ["Plan", planText],
    ["State", stateText(input.subscription, state, sub, grace, input.timeZone)],
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
      ["Seats", ofLimit(usage.seats_active, seatsLimit, `${extra}${invited}`, "No seat limit is set.")],
      ["Active matters", ofLimit(realMatters, ent ? ent.matters : null, sample, "No limit is set.")],
      [
        "Storage",
        storage !== null
          ? `${usage.storage_bytes ? (usage.storage_bytes / 1024 ** 3).toFixed(1) : "0"} of ${storage} GB`
          : usage.storage_bytes
            ? `${storageSize(usage.storage_bytes)} of documents. No allowance is set.`
            : "No documents stored yet. No allowance is set.",
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
  if (state === "trial_ended") alert = { tone: "warn", icon: "alert", title: "Your trial has ended", body: "Your records are kept and you can still export them. New client portal invitations are paused until you choose a plan." };
  else if (state === "past_due") alert = { tone: "warn", icon: "alert", title: "The last payment failed", body: `Update your card in Manage billing. New work pauses after ${grace.past_due_days} days past due; nothing is deleted.` };
  else if (state === "restricted") alert = { tone: "warn", icon: "alert", title: "Payment is overdue, so new work is paused", body: "New client invitations, staff invitations and real matters wait for the payment. Your records and exports stay open." };
  else if (state === "cancelled") alert = { tone: "warn", icon: "alert", title: "Your subscription is cancelled", body: `Your records are kept and you can still export them${sub?.cancelled_at ? ` until at least ${on(addDays(sub.cancelled_at, grace.export_window_days))}` : ""}.` };
  else if (state === "archived") alert = { tone: "info", icon: "archive", title: "Your subscription is archived", body: "Nothing was deleted. Choose a plan to carry on where you left off." };

  const canManage = Boolean(input.canManage && input.organizationId && detail);
  const buttons = canManage ? subscriptionButtons(sub, state, input.organizationId!) : [];
  const dialog = canManage && buttons.some((button) => button.act === "plan") ? planDialog(catalog, input.organizationId!, { plan: sub?.plan ?? null, interval: sub?.billing_interval ?? null, extraSeats: sub?.extra_seats ?? 0 }) : null;

  const note = [
    detail
      ? catalog
        ? "Prices are in CAD and set by Casevoya; payment goes through Stripe (test mode while Casevoya is in pilot) and no card is stored by Casevoya."
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
