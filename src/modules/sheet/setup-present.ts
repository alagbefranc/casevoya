/**
 * Pure helpers for a firm still in sample mode: what keeps real client invitations locked, and the
 * plain words for it on the Finish setup banner and the sample-mode page.
 *
 * Decision 2026-10-19 (Francis): only licensed consultants sign up and firms start live. The six
 * practice steps are an optional tour and block nothing. A declared licence on the firm owner that
 * is not blocked is enough; an ended trial still blocks.
 *
 * The database decides. `app.set_sample_mode(false)` refuses while
 * `app.real_client_invite_blockers(org)` is non-empty; `inviteBlockers` mirrors that function
 * exactly, from rows any staff member can read, only so the Sheet can say what is left.
 */

/** The six optional practice steps on the sample case, in the Designer's order. They block nothing. */
export const PRACTICE_STEPS = [
  { key: "intake", title: "Send an intake form" },
  { key: "agreement", title: "Send a service agreement" },
  { key: "upload", title: "Request and review an upload" },
  { key: "reminder", title: "Schedule a reminder" },
  { key: "invoice", title: "Issue an invoice" },
  { key: "export", title: "Export the file" },
] as const;

export type SetupCredential = {
  status: string;
  verificationMethod: string | null;
  registerStatus: string | null;
  entitlementToPractise: boolean | null;
  disciplineSuspended: boolean;
  disciplineRevoked: boolean;
  /** The licence holder's membership: role and status. */
  holderRole: string | null;
  holderStatus: string | null;
};

export type SetupRows = {
  verificationStatus: string | null;
  credentials: SetupCredential[];
  subscriptionStatus: string | null;
  /** Card trial: the firm has not put a card on file in Stripe Checkout yet. */
  cardRequired?: boolean;
};

const BLOCKING = new Set(["revoked", "suspended", "inactive", "not_entitled"]);
const CHECK_METHODS = new Set(["manual_public_register", "cicc_list"]);

/** The same test as app.firm_has_verified_licence: a manual register check or a CICC list match in good standing. */
export function hasVerifiedLicence(credentials: readonly SetupCredential[]): boolean {
  return credentials.some(
    (row) =>
      (row.holderRole === "licensed_consultant" || row.holderRole === "firm_owner") &&
      row.holderStatus === "active" &&
      row.status === "verified" &&
      row.verificationMethod !== null &&
      CHECK_METHODS.has(row.verificationMethod) &&
      row.registerStatus === "active" &&
      (row.entitlementToPractise === true || (row.verificationMethod === "cicc_list" && row.entitlementToPractise === null)) &&
      !row.disciplineSuspended &&
      !row.disciplineRevoked &&
      !BLOCKING.has(row.status),
  );
}

/** A licence that locks its holder: revoked, suspended, inactive or not entitled, on the credential or its flags. */
export function credentialBlocks(row: SetupCredential): boolean {
  return BLOCKING.has(row.status) || row.disciplineRevoked || row.disciplineSuspended || row.registerStatus === "inactive" || row.entitlementToPractise === false;
}

/** The same list, in the same order, as app.real_client_invite_blockers. */
export function inviteBlockers(rows: SetupRows): string[] {
  if (rows.verificationStatus == null) return ["firm_not_found"];
  const blockers: string[] = [];
  if (rows.verificationStatus === "restricted") blockers.push("firm_restricted");
  const owners = rows.credentials.filter((row) => row.holderRole === "firm_owner" && row.holderStatus === "active");
  if (!owners.length) blockers.push("owner_licence_missing");
  else if (owners.some(credentialBlocks)) blockers.push("owner_licence_blocked");
  if (rows.subscriptionStatus === "trial_ended") blockers.push("trial_ended");
  if (rows.subscriptionStatus === "trial" && rows.cardRequired === true) blockers.push("card_required");
  if (SUBSCRIPTION_RESTRICTED.has(rows.subscriptionStatus ?? "")) blockers.push("subscription_restricted");
  return blockers;
}

/** Subscription states that pause new work (app.subscription_entitlements new_work_blocked). */
export const SUBSCRIPTION_RESTRICTED = new Set(["restricted", "cancelled", "archived"]);

export const LICENCE_ADDED = "Add your CICC licence";
export const LICENCE_BLOCKED = "Your CICC licence needs attention";
export const TRIAL_ENDED = "Your trial has ended: choose a plan";
export const SUBSCRIPTION_PAUSED = "Your subscription is paused: choose a plan";
export const CARD_REQUIRED = "Add a card to start your 14-day free trial";

export type GoLiveStep = { key: string; label: string; href: string };

/**
 * Plain words for one blocker. firm_restricted and owner_licence_blocked are one step for the
 * person: a firm is restricted when its licence check came back adverse.
 */
export function blockerStep(blocker: string): GoLiveStep {
  if (blocker === "owner_licence_missing") return { key: "licence_added", label: LICENCE_ADDED, href: "/sheet/licence" };
  if (blocker === "owner_licence_blocked" || blocker === "firm_restricted") return { key: "licence_blocked", label: LICENCE_BLOCKED, href: "/sheet/licence" };
  if (blocker === "trial_ended") return { key: "trial", label: TRIAL_ENDED, href: "/sheet/settings?tab=billing" };
  if (blocker === "card_required") return { key: "card", label: CARD_REQUIRED, href: "/sheet/settings?tab=billing&dlg=plan" };
  if (blocker === "subscription_restricted") return { key: "subscription", label: SUBSCRIPTION_PAUSED, href: "/sheet/settings?tab=billing" };
  return { key: blocker, label: "Firm setup isn’t finished", href: "/sheet/sample-mode" };
}

/** What is left before the firm can go live, once each, in blocker order. */
export function goLiveRemaining(blockers: readonly string[]): GoLiveStep[] {
  const steps: GoLiveStep[] = [];
  for (const blocker of blockers) {
    const step = blockerStep(blocker);
    if (!steps.some((item) => item.key === step.key)) steps.push(step);
  }
  return steps;
}

export type SetupState = {
  /** Raw blockers, as the database names them. */
  blockers: string[];
  /** The firm owner has a licence on file. */
  hasCredential: boolean;
  /** The owner's licence is on file and locks nobody. */
  licenceOk: boolean;
  trialEnded: boolean;
  remaining: GoLiveStep[];
};

export function setupState(rows: SetupRows): SetupState {
  const blockers = inviteBlockers(rows);
  return {
    blockers,
    hasCredential: !blockers.includes("owner_licence_missing") && !blockers.includes("firm_not_found"),
    licenceOk: !blockers.some((blocker) => ["firm_not_found", "firm_restricted", "owner_licence_missing", "owner_licence_blocked"].includes(blocker)),
    trialEnded: blockers.includes("trial_ended"),
    remaining: goLiveRemaining(blockers),
  };
}

/** "add your CICC licence, choose a plan (your trial has ended)". */
export function remainingSummary(state: SetupState): string {
  const parts: string[] = [];
  if (state.remaining.some((step) => step.key === "licence_added")) parts.push("add your CICC licence");
  if (state.remaining.some((step) => step.key === "licence_blocked")) parts.push("sort out your CICC licence (its check paused it)");
  if (state.trialEnded) parts.push("choose a plan (your trial has ended)");
  if (state.remaining.some((step) => step.key === "card")) parts.push("add a card to start your 14-day free trial (nothing is charged today)");
  if (state.remaining.some((step) => step.key === "firm_not_found")) parts.push("finish firm setup");
  return parts.join(", ");
}

/** The banner's progress line: "Still to do: add your CICC licence." */
export function progressLine(state: SetupState): string {
  const summary = remainingSummary(state);
  return summary ? `Still to do: ${summary}.` : "Your CICC licence is on file: the firm owner can switch to live.";
}

/** Plain words for public.set_sample_mode(false)'s refusals. */
export function switchToLiveRefusal(message: string): { error: string; stepUp: boolean } {
  if (/step-up/i.test(message)) return { error: "Confirm it’s you with your authenticator, then try again.", stepUp: true };
  if (/stays on until/i.test(message)) return { error: "Finish the items still to do first.", stepUp: false };
  return { error: "The firm couldn’t be switched to live. Try again.", stepUp: false };
}

export type SetupBannerData = {
  firmName: string;
  progress: string;
  /** Collapsed for this browser session (cookie, never stored on the firm). */
  collapsed: boolean;
};

/** The session cookie that remembers a collapsed banner until the browser closes. */
export const SETUP_BANNER_COOKIE = "cv-setup-banner";
