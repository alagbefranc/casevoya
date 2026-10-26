import { stepUpHref } from "@/lib/auth/mfa-step";

/** Pure: the subscription functions' own refusals, in plain words; null for access refusals. */
export function subscriptionActionError(message: string): string | null {
  if (/arranged with Casevoya/i.test(message)) return "Enterprise plans are arranged with Casevoya. There is no checkout for them.";
  if (/billing portal/i.test(message)) return "Your current subscription is changed in the billing portal: use Manage billing.";
  if (/no billing account yet/i.test(message)) return "There is no billing account yet. Choose a plan first.";
  if (/already has a billing account/i.test(message)) return "This firm already has a billing account. Reload the page and try again.";
  if (/no price yet/i.test(message)) return "That plan has no price yet.";
  if (/0 to 500/i.test(message)) return "Extra seats must be 0 to 500.";
  if (/choose a plan and a billing interval/i.test(message)) return "Choose a plan and monthly or annual billing.";
  return null;
}

/** Where the step-up screen sends the owner back: this tab, with the plan dialog open again. */
export function subscriptionStepUpLocation(reopenDialog: boolean): string {
  const next = `/sheet/settings?tab=billing${reopenDialog ? "&dlg=plan" : ""}`;
  return stepUpHref(next, "plan");
}

/** sessionStorage key for the plan chosen before a step-up. */
export const PLAN_DRAFT = "cv-subscription-plan";

/** The database's entitlement refusals, as the New matter and Invite staff dialogs show them. */
export function entitlementError(message: string): string | null {
  const seats = /seat allowance reached: (\d+) of (\d+) staff seats/i.exec(message);
  if (seats) return `Your plan's seat allowance is used: ${seats[1]} of ${seats[2]} staff seats are in use. Add a seat in Settings > Subscription.`;
  const matters = /active-matter allowance reached: (\d+) of (\d+) active matters/i.exec(message);
  if (matters) return `Your plan's active-matter allowance is used: ${matters[1]} of ${matters[2]} active matters are open. Close a matter or change plan in Settings > Subscription.`;
  if (/subscription paused/i.test(message)) return "Your subscription is paused. Choose a plan in Settings > Subscription first.";
  return null;
}
