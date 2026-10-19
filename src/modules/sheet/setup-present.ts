/**
 * Pure helpers for finishing setup while a firm is in sample mode: the go-live blockers, the
 * eight setup steps the banner counts, and the plain words for each blocker.
 *
 * The database decides. `app.set_sample_mode(false)` refuses while
 * `app.real_client_invite_blockers(org)` is non-empty; `inviteBlockers` mirrors that function
 * from rows any staff member can read, only so the Sheet can say what is left.
 */

/** The six sample proofs, in the Designer's order. */
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
  proofs: string[];
};

const BLOCKING = new Set(["revoked", "suspended", "inactive", "not_entitled"]);

/** The same test as app.firm_has_verified_licence. */
export function hasVerifiedLicence(credentials: readonly SetupCredential[]): boolean {
  return credentials.some(
    (row) =>
      (row.holderRole === "licensed_consultant" || row.holderRole === "firm_owner") &&
      row.holderStatus === "active" &&
      row.status === "verified" &&
      row.verificationMethod === "manual_public_register" &&
      row.registerStatus === "active" &&
      row.entitlementToPractise === true &&
      !row.disciplineSuspended &&
      !row.disciplineRevoked &&
      !BLOCKING.has(row.status),
  );
}

/** The same list, in the same order, as app.real_client_invite_blockers. */
export function inviteBlockers(rows: SetupRows): string[] {
  if (rows.verificationStatus == null) return ["firm_not_found"];
  const blockers: string[] = [];
  if (rows.verificationStatus !== "verified") blockers.push("firm_unverified");
  if (!hasVerifiedLicence(rows.credentials)) blockers.push("licence_not_verified");
  if (rows.subscriptionStatus === "trial_ended") blockers.push("trial_ended");
  const done = new Set(rows.proofs);
  for (const step of PRACTICE_STEPS) if (!done.has(step.key)) blockers.push(`sample_step_missing:${step.key}`);
  return blockers;
}

export const LICENCE_ADDED = "Add your CICC licence";
export const LICENCE_VERIFIED = "Licence verified against the CICC register";
export const TRIAL_ENDED = "Your trial has ended: choose a plan";

export type GoLiveStep = { key: string; label: string; href: string };

/**
 * Plain words for one blocker. firm_unverified and licence_not_verified are one step for the
 * person: the firm is verified once its licence check passes.
 */
export function blockerStep(blocker: string): GoLiveStep {
  if (blocker === "firm_unverified" || blocker === "licence_not_verified") return { key: "licence_verified", label: LICENCE_VERIFIED, href: "/sheet/licence" };
  if (blocker === "trial_ended") return { key: "trial", label: TRIAL_ENDED, href: "/sheet/settings?tab=billing" };
  if (blocker.startsWith("sample_step_missing:")) {
    const key = blocker.slice("sample_step_missing:".length);
    const step = PRACTICE_STEPS.find((item) => item.key === key);
    return { key, label: `Practice step: ${step ? step.title.toLowerCase() : key}`, href: "/sheet/sample-mode" };
  }
  return { key: blocker, label: "Firm setup isn’t finished", href: "/sheet/sample-mode" };
}

/** What is left before the firm can go live, once each, in blocker order. "Add your licence" leads when none is on file. */
export function goLiveRemaining(blockers: readonly string[], hasCredential: boolean): GoLiveStep[] {
  const steps: GoLiveStep[] = [];
  if (!hasCredential) steps.push({ key: "licence_added", label: LICENCE_ADDED, href: "/sheet/licence" });
  for (const blocker of blockers) {
    const step = blockerStep(blocker);
    if (!steps.some((item) => item.key === step.key)) steps.push(step);
  }
  return steps;
}

export type SetupState = {
  /** Raw blockers, as the database names them. */
  blockers: string[];
  hasCredential: boolean;
  /** Steps done of the eight: licence added, licence verified and the six practice steps. */
  done: number;
  total: number;
  trialEnded: boolean;
  remaining: GoLiveStep[];
};

export function setupState(rows: SetupRows): SetupState {
  const blockers = inviteBlockers(rows);
  const hasCredential = rows.credentials.length > 0;
  const verified = !blockers.includes("firm_unverified") && !blockers.includes("licence_not_verified");
  const practice = PRACTICE_STEPS.filter((step) => !blockers.includes(`sample_step_missing:${step.key}`)).length;
  return {
    blockers,
    hasCredential,
    done: Number(hasCredential) + Number(verified) + practice,
    total: 2 + PRACTICE_STEPS.length,
    trialEnded: blockers.includes("trial_ended"),
    remaining: goLiveRemaining(blockers, hasCredential),
  };
}

/** "add your CICC licence, verify it against the CICC register, 6 practice steps". */
export function remainingSummary(state: SetupState): string {
  const parts: string[] = [];
  if (!state.hasCredential) parts.push("add your CICC licence");
  if (state.remaining.some((step) => step.key === "licence_verified")) parts.push(state.hasCredential ? "get it verified against the CICC register" : "verify it against the CICC register");
  const practice = state.remaining.filter((step) => PRACTICE_STEPS.some((item) => item.key === step.key)).length;
  if (practice) parts.push(`${practice} practice ${practice === 1 ? "step" : "steps"}`);
  if (state.trialEnded) parts.push("choose a plan (your trial has ended)");
  if (state.remaining.some((step) => step.key === "firm_not_found")) parts.push("finish firm setup");
  return parts.join(", ");
}

/** The banner's progress line: "3 of 8 done: still to do, add your CICC licence, …". */
export function progressLine(state: SetupState): string {
  const summary = remainingSummary(state);
  const head = `${state.done} of ${state.total} done`;
  return summary ? `${head}. Still to do: ${summary}.` : `${head}. Everything is ready: the firm owner can switch to live.`;
}

/** Plain words for public.set_sample_mode(false)'s refusals. */
export function switchToLiveRefusal(message: string): { error: string; stepUp: boolean } {
  if (/step-up/i.test(message)) return { error: "Confirm it’s you with your authenticator, then try again.", stepUp: true };
  if (/stays on until/i.test(message)) return { error: "Finish the remaining setup steps first.", stepUp: false };
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
