/**
 * The consultation agreement a booker signs through their booking's private link
 * (public.booking_agreement_for_signing). Only a well-formed answer is used; anything else reads
 * as "not available" rather than a guess.
 */
export type SigningView =
  | { state: "unavailable" }
  | {
      state: "open" | "signed" | "closed";
      firm: string;
      attendee: string | null;
      meeting: string;
      startsAt: string;
      timeZone: string;
      title: string;
      version: number;
      body: string;
      sha256: string;
      consentText: string;
      signedName: string | null;
      signedAt: string | null;
      sample: boolean;
    };

const REF = /^[a-z2-7]{26}$/;

export function isBookingRef(value: string): boolean {
  return REF.test(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function readSigningView(raw: unknown): SigningView {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const state = row?.state;
  if (!row || (state !== "open" && state !== "signed" && state !== "closed")) return { state: "unavailable" };
  const firm = text(row.firm);
  const body = text(row.body);
  const sha256 = text(row.sha256);
  const consentText = text(row.consent_text);
  if (!firm || !body || !sha256 || !/^[0-9a-f]{64}$/.test(sha256) || !consentText) return { state: "unavailable" };
  return {
    state,
    firm,
    attendee: text(row.attendee),
    meeting: text(row.meeting) ?? "Consultation",
    startsAt: text(row.starts_at) ?? "",
    timeZone: text(row.time_zone) ?? "America/Toronto",
    title: text(row.title) ?? "Consultation agreement",
    version: typeof row.version === "number" ? row.version : 1,
    body,
    sha256,
    consentText,
    signedName: text(row.signed_name),
    signedAt: text(row.signed_at),
    sample: row.sample === true,
  };
}

/** A database refusal as words the signer can act on. */
export function signError(message: string): string {
  if (/consent is required/.test(message)) return "Tick the box to agree to sign electronically.";
  if (/full name/.test(message)) return "Type your full name to sign.";
  if (/changed/.test(message)) return "This agreement changed. Reload the page and read it again before signing.";
  if (/cancelled/.test(message)) return "This consultation was cancelled, so there is nothing to sign.";
  if (/not available/.test(message)) return "This agreement isn’t available any more. Ask the firm for a new link.";
  return "That didn’t work. Try again in a moment.";
}
