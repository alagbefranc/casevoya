/**
 * Pure: Settings > Subscription (ADM-02) and Settings > Retention (SEC-07) from the firm's records.
 *
 * Subscription shows the stored state (organization_subscriptions) and real usage counts
 * (public.firm_subscription_usage). No plan, price, seat limit, storage allowance or AI quota is
 * stored, so none is shown: plans and prices are Casevoya's to set (docs/DECISIONS.md).
 *
 * Retention shows the firm's own period (organizations.retention_policy) with its version
 * (retention_policy_versions). Casevoya supplies no statutory period, so none is stated.
 */
import type { RetentionData, RetentionRow, SettingsBillingAlert, SubscriptionData } from "@/components/sheet/designer/settings-billing";
import { dayMonth } from "@/modules/sheet/home-present";
import { publishedOn } from "@/modules/portal-policies/present";

export type SubscriptionStatus = "trial" | "trial_ended" | "active" | "cancelled";

export type SubscriptionRow = {
  status: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
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

const STATE: Record<SubscriptionStatus, string> = {
  trial: "Trial",
  trial_ended: "Trial ended",
  active: "Active",
  cancelled: "Cancelled",
};

/** The state the firm is in now: a trial whose end has passed has ended, even before the clock syncs. */
export function subscriptionState(row: SubscriptionRow | null, now: Date): SubscriptionStatus | null {
  if (!row || !(row.status in STATE)) return null;
  const status = row.status as SubscriptionStatus;
  if (status === "trial" && row.trial_ends_at && new Date(row.trial_ends_at).getTime() <= now.getTime()) return "trial_ended";
  return status;
}

/** The second pill in the Settings top bar. */
export function subscriptionPill(row: SubscriptionRow | null, now: Date): string {
  const state = subscriptionState(row, now);
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

function stateText(row: SubscriptionRow | null, state: SubscriptionStatus | null, timeZone: string): string {
  if (!row || !state) return "Not available";
  if (state === "trial") {
    const since = row.trial_started_at ? `Trial since ${publishedOn(row.trial_started_at, timeZone)}` : "Trial";
    return row.trial_ends_at ? `${since}, ends ${publishedOn(row.trial_ends_at, timeZone)}` : `${since}, no end date set`;
  }
  if (state === "trial_ended") return row.trial_ends_at ? `Trial ended ${publishedOn(row.trial_ends_at, timeZone)}` : "Trial ended";
  return STATE[state];
}

export function subscriptionPage(input: {
  firmName: string;
  subscription: SubscriptionRow | null;
  /** Null for roles public.firm_subscription_usage refuses (not owner or finance). */
  usage: SubscriptionUsage | null;
  timeZone: string;
  now: Date;
}): SubscriptionData {
  const state = subscriptionState(input.subscription, input.now);
  const rows: [string, string][] = [
    ["Plan", "None chosen yet. Plans and prices are set by Casevoya."],
    ["State", stateText(input.subscription, state, input.timeZone)],
  ];
  const usage = input.usage;
  if (usage) {
    const since = `since ${dayMonth(usage.month_start)}`;
    rows.push(
      ["Seats", `${usage.seats_active} in use${usage.seats_invited ? `, ${usage.seats_invited} invited` : ""}. No seat limit is set.`],
      ["Active matters", `${usage.active_matters}${usage.sample_matters ? ` (${usage.sample_matters} sample)` : ""}. No limit is set.`],
      ["Storage", usage.storage_bytes ? `${storageSize(usage.storage_bytes)} of documents. No allowance is set.` : "No documents stored yet. No allowance is set."],
      ["Vo runs this month", `${usage.vo_runs_month} ${since}`],
      ["Emails sent this month", `${usage.emails_month} ${since}`],
    );
  }
  rows.push(
    ["Invoices from Casevoya", "None. Casevoya doesn’t bill through the app yet."],
    ["If you cancel", "New work stops after the paid period. Cancelling never deletes your records, and client-file exports stay open for the period your contract sets."],
  );
  const alert: SettingsBillingAlert | null =
    state === "trial_ended"
      ? { tone: "warn", icon: "alert", title: "Your trial has ended", body: "Your records are kept and you can still export them. New client portal invitations are paused." }
      : state === "cancelled"
        ? { tone: "warn", icon: "alert", title: "Your subscription is cancelled", body: "Your records are kept and you can still export them." }
        : null;
  const note = [
    "Casevoya sets plans and prices and hasn’t published them yet. Nothing is charged here and no card is taken.",
    usage ? "Usage counts are live." : "Usage counts are shown to the firm owner and finance.",
  ].join(" ");
  return { payer: input.firmName, rows, alert, note };
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
