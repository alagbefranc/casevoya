import { publishedOn } from "@/modules/portal-policies/present";

/**
 * Card trial (20261101100100): the banner every staff member sees on every Sheet page about the
 * firm's own Casevoya trial or a failed payment. Ending, export-window and archived states are the
 * continuity banner's (SEC-10); this one never repeats them. Pure.
 */
export type BillingBannerData = {
  tone: "info" | "warn";
  icon: "clock" | "alert";
  title: string;
  body: string;
  /** The firm owner and finance: where to act. Others see the words only. */
  link: { href: string; label: string } | null;
};

export type BillingBannerRow = {
  status: string;
  trial_ends_at: string | null;
  card_required: boolean;
  cancel_at_period_end: boolean;
  past_due_since: string | null;
  /** A Stripe subscription exists (the id itself never leaves the server). */
  stripe: boolean;
};

const DAY = 86_400_000;
export const BILLING_TAB = "/sheet/settings?tab=billing";
export const PLAN_DIALOG = "/sheet/settings?tab=billing&dlg=plan";

/** Whole days left, rounded up: 13.2 days is "14 days left"; never below 0. */
export function daysLeft(endIso: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(endIso).getTime() - now.getTime()) / DAY));
}

function days(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

export function billingBanner(
  row: BillingBannerRow | null,
  input: { now: Date; timeZone: string; canManage: boolean; isOwner: boolean; graceDays?: number; trialDays?: number },
): BillingBannerData | null {
  if (!row) return null;
  const on = (iso: string) => publishedOn(iso, input.timeZone);
  const grace = input.graceDays ?? 7;
  if (row.status === "trial" && row.card_required) {
    return {
      tone: "info",
      icon: "clock",
      title: `Add a card to start your ${input.trialDays ?? 14}-day free trial`,
      body: "$0 today. Real client invitations and real matters open once a card is on file; you are billed when the trial ends unless you cancel before then.",
      link: input.isOwner ? { href: PLAN_DIALOG, label: "Add a card" } : null,
    };
  }
  if (row.status === "trial" && row.trial_ends_at && !row.cancel_at_period_end) {
    const left = daysLeft(row.trial_ends_at, input.now);
    if (row.stripe) {
      return {
        tone: "info",
        icon: "clock",
        title: `${days(left)} left in your free trial`,
        body: `Your card is charged on ${on(row.trial_ends_at)}, plus applicable taxes, unless you cancel before then.`,
        link: input.canManage ? { href: BILLING_TAB, label: "Manage billing" } : null,
      };
    }
    // A trial from before cards were required: a reminder in its last week.
    if (left <= 7) {
      return {
        tone: left <= 2 ? "warn" : "info",
        icon: left <= 2 ? "alert" : "clock",
        title: `${days(left)} left in your trial`,
        body: `Your trial ends ${on(row.trial_ends_at)}. Choose a plan to keep inviting clients and opening matters; nothing is deleted.`,
        link: input.isOwner ? { href: PLAN_DIALOG, label: "Choose a plan" } : null,
      };
    }
    return null;
  }
  if (row.status === "past_due") {
    const pauses = row.past_due_since ? new Date(new Date(row.past_due_since).getTime() + grace * DAY).toISOString() : null;
    return {
      tone: "warn",
      icon: "alert",
      title: "The last Casevoya payment failed",
      body: pauses
        ? `Update your card by ${on(pauses)}, or new matters and invitations pause until the payment goes through. Nothing is deleted.`
        : `Update your card within ${grace} days, or new matters and invitations pause until the payment goes through. Nothing is deleted.`,
      link: input.canManage ? { href: BILLING_TAB, label: "Manage billing" } : null,
    };
  }
  return null;
}
