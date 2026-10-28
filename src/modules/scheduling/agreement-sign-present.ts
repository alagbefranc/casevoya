/**
 * The consultation agreement a booker signs through their booking's private link
 * (public.booking_agreement_for_signing). Only a well-formed answer is used; anything else reads
 * as "not available" rather than a guess.
 */
export type SigningView =
  | { state: "unavailable" }
  /** The firm voided it and sent nothing new: the old link says so (the firm's name only). */
  | { state: "withdrawn"; firm: string; firmSlug: string | null }
  /** The booker declined: their own reason, never the text or its hash. */
  | {
      state: "declined";
      firm: string;
      firmSlug: string | null;
      attendee: string | null;
      reason: string;
      declinedAt: string | null;
      timeZone: string;
      sample: boolean;
    }
  | {
      state: "open" | "signed" | "closed";
      firm: string;
      firmSlug: string | null;
      attendee: string | null;
      /** The attendee's email, masked ("d.ok•••@example.com"). */
      emailMask: string | null;
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
      signatureKind: "typed" | "drawn" | "uploaded" | null;
      /** A drawn or uploaded signature, as a data: URL (signed agreements only). */
      signatureImage: string | null;
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
  if (row && state === "withdrawn") {
    const firm = text(row.firm);
    return firm ? { state: "withdrawn", firm, firmSlug: text(row.firm_slug) } : { state: "unavailable" };
  }
  if (row && state === "declined") {
    const firm = text(row.firm);
    const reason = text(row.decline_reason);
    if (!firm || !reason) return { state: "unavailable" };
    return {
      state: "declined",
      firm,
      firmSlug: text(row.firm_slug),
      attendee: text(row.attendee),
      reason,
      declinedAt: text(row.declined_at),
      timeZone: text(row.time_zone) ?? "America/Toronto",
      sample: row.sample === true,
    };
  }
  if (!row || (state !== "open" && state !== "signed" && state !== "closed")) return { state: "unavailable" };
  const firm = text(row.firm);
  const body = text(row.body);
  const sha256 = text(row.sha256);
  const consentText = text(row.consent_text);
  if (!firm || !body || !sha256 || !/^[0-9a-f]{64}$/.test(sha256) || !consentText) return { state: "unavailable" };
  const kind = row.signature_kind;
  const stored = text(row.signature_image);
  // Only a PNG or JPEG the database stored (base64) becomes an image; anything else is dropped.
  const image = stored && /^[A-Za-z0-9+/]+={0,2}$/.test(stored) ? (stored.startsWith("iVBOR") ? `data:image/png;base64,${stored}` : stored.startsWith("/9j/") ? `data:image/jpeg;base64,${stored}` : null) : null;
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
    signatureKind: kind === "typed" || kind === "drawn" || kind === "uploaded" ? kind : null,
    signatureImage: image,
    sample: row.sample === true,
    firmSlug: text(row.firm_slug),
    emailMask: text(row.email_mask),
  };
}

/** A database refusal as words the signer can act on. */
export function signError(message: string): string {
  if (/consent is required/.test(message)) return "Tick the box to agree to sign electronically.";
  if (/full name/.test(message)) return "Type your full name to sign.";
  if (/changed/.test(message)) return "This agreement changed. Reload the page and read it again before signing.";
  if (/cancelled/.test(message)) return "This consultation was cancelled, so there is nothing to sign.";
  if (/not available/.test(message)) return "This agreement isn’t available any more. Ask the firm for a new link.";
  if (/emailed code/.test(message)) return "Confirm it’s you with the emailed code first. Go back and ask for a new code.";
  if (/PNG or JPEG/.test(message)) return "Choose a PNG or JPEG of your signature, up to 1.5 MB.";
  if (/choose how to sign/.test(message)) return "Choose how to sign.";
  if (/say why/.test(message)) return "Say why you’re declining. The firm sees this.";
  return "That didn’t work. Try again in a moment.";
}

/** "SHA-256 9f3b…41aa": the short fingerprint for narrow screens. */
export function shortFingerprint(sha256: string): string {
  return `${sha256.slice(0, 4)}…${sha256.slice(-4)}`;
}

/** The first word of a display name, or the whole name when it is one word. */
export function firstName(name: string | null | undefined, fallback = "there"): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || fallback;
}
