/**
 * /portal/account (SEC-01, SEC-05): what the client's own two-step and consent rows say. Pure, so
 * the wording is tested. The database (public.my_consents, public.my_two_step_state) decides the
 * state; nothing here invents one.
 */

/** The consents a client changes on their own Account page. The notice channels have their own switches. */
export const PORTAL_CONSENT_PURPOSES = ["ai_drafting", "marketing", "processing"] as const;
export type PortalConsentPurpose = (typeof PORTAL_CONSENT_PURPOSES)[number];

export function isPortalConsentPurpose(value: unknown): value is PortalConsentPurpose {
  return typeof value === "string" && (PORTAL_CONSENT_PURPOSES as readonly string[]).includes(value);
}

/** true given, false refused or withdrawn, null never asked. */
export type ConsentState = boolean | null;

export type TwoStepState = "off" | "needs_check" | "ok";

export type PortalAccountExtras = {
  consents: Record<PortalConsentPurpose, ConsentState> | null;
  twoStep: TwoStepState | null;
};

export function readConsents(value: unknown): PortalAccountExtras["consents"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const one = (key: string): ConsentState => (row[key] === true ? true : row[key] === false ? false : null);
  return { ai_drafting: one("ai_drafting"), marketing: one("marketing"), processing: one("processing") };
}

export function readTwoStep(value: unknown): TwoStepState | null {
  return value === "off" || value === "needs_check" || value === "ok" ? value : null;
}

/** The plain words for each optional consent, as the client sees them. */
export function consentCopy(purpose: PortalConsentPurpose, firm: string): { label: string; detail: string } {
  if (purpose === "ai_drafting") {
    return {
      label: "AI drafting help",
      detail: `${firm} may use Vo, its AI assistant, to read your documents and draft from your file. A person at ${firm} checks everything before it’s used. If you turn this off, Vo skips your documents.`,
    };
  }
  if (purpose === "marketing") {
    return { label: `News and offers from ${firm}`, detail: "Separate consent, recorded with the date. Off unless you turn it on." };
  }
  return {
    label: "Using your information for your application",
    detail: `${firm} needs this to prepare and manage your application. You can withdraw it; ${firm} will review what that means for your file and contact you.`,
  };
}

/** What withdrawing core processing does and doesn't do (SEC-05): nothing is deleted. */
export const PROCESSING_WITHDRAWAL_NOTE =
  "Withdrawing doesn’t delete anything. Your firm must keep your records for its retention period, and longer if a legal hold applies. Your firm reviews what happens next with you.";

/** What the client is told after a withdrawal is saved. */
export function withdrawalToast(purpose: PortalConsentPurpose, firm: string): { title: string; sub: string } {
  if (purpose === "ai_drafting") return { title: "AI drafting help is off", sub: `Saved. Vo no longer reads your documents. ${firm} has been told.` };
  if (purpose === "marketing") return { title: "No news or offers", sub: `Saved. ${firm} has been told.` };
  return { title: "Consent withdrawn", sub: `Saved. Nothing is deleted. ${firm} will review it and contact you.` };
}

/** The two-step row's line, and how a lost phone is handled (never by email alone). */
export function twoStepCopy(state: TwoStepState | null, firm: string): { detail: string; badge: { tone: "ok" | "gr"; label: string } } {
  const recovery = `If you lose your phone, contact ${firm}. They confirm who you are (for example on a video call with your ID) before they reset it; an email alone can’t.`;
  if (state === "ok" || state === "needs_check") {
    return { detail: `A code from your authenticator app is asked for each time you sign in, and before high-risk changes. ${recovery}`, badge: { tone: "ok", label: "On" } };
  }
  return {
    detail: `Add a code from an authenticator app each time you sign in. It’s required before high-risk changes, like changing your email or downloading a full copy of your file. ${recovery}`,
    badge: { tone: "gr", label: "Off" },
  };
}
