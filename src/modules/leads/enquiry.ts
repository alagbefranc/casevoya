/**
 * The public enquiry (CRM-01; PRD API "POST /leads: create minimal enquiry with abuse controls and
 * consent version"). Pure: what a visitor sends, checked, and the exact consent wording that is
 * stored with a hash next to their answer. The reply consent is required and is not marketing;
 * marketing is a separate, optional box (CASL; PRD OPS-05, SEC-05).
 */

/**
 * Bump the version whenever either statement changes; stored with every answer. enquiry-v2: the
 * hosted page and the embed name the firm, and the stored text is exactly what the visitor saw
 * (enquiryStatements). The generic wording here is the version-1 text, kept for reference.
 */
export const ENQUIRY_CONSENT = {
  version: "enquiry-v2",
  reply: "The firm may use these details to reply to my enquiry.",
  marketing: "Send me the firm’s news. Separate from replies about my enquiry; I can stop any time.",
} as const;

/** The two boxes as the visitor sees them on the firm's page, and the exact text stored with a tick. */
export function enquiryStatements(firmName: string) {
  const firm = firmName.replace(/\s+/g, " ").trim().slice(0, 200) || "The firm";
  const marketingNote = "Separate from replies about your enquiry. You can stop any time.";
  return {
    reply: `${firm} may use these details to reply to my enquiry`,
    replyNote: "Required. We record when you agreed.",
    marketingLabel: `Send me ${firm} news `,
    marketingNote,
    /** Stored when the marketing box is ticked: its label and the line under it. */
    marketing: `Send me ${firm} news. ${marketingNote}`,
  };
}

/** Under this many milliseconds between the form opening and sending, it is treated as a script. */
export const ENQUIRY_MIN_FORM_MS = 2500;

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isFirmSlug(value: string): boolean {
  return SLUG.test(value);
}

/** The firm's hosted enquiry page (/enquiry/<firm>) or its embedded form (/embed/enquiry/<firm>). */
export function enquiryPagePath(pathname: string): { firm: string; embed: boolean } | null {
  const match = /^\/(embed\/)?enquiry\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  const firm = match[2].toLowerCase();
  return { firm: SLUG.test(firm) ? firm : "", embed: Boolean(match[1]) };
}

/** `open`: the firm's enquiry page is switched on in Settings (CRM-01). */
export type PublicEnquiryFirm = { firmName: string; firmSlug: string; practice: boolean; staff: boolean; open: boolean };

/** What enquiry_public_firm returned, or null (unknown firm, no privacy notice, not open to this viewer). */
export function parsePublicFirm(raw: unknown): PublicEnquiryFirm | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.firm_name !== "string" || typeof row.firm_slug !== "string" || !SLUG.test(row.firm_slug)) return null;
  return { firmName: row.firm_name, firmSlug: row.firm_slug, practice: row.practice === true, staff: row.staff === true, open: row.open !== false };
}

export const ENQUIRY_SERVICES = ["Visit", "Study", "Work", "Permanent residence", "Sponsor a family member", "Citizenship", "Not sure"] as const;

export type EnquiryInput = {
  name: string;
  contact: string;
  preferred: "email" | "phone" | null;
  service: string | null;
  country: string | null;
  language: string | null;
  reply: boolean;
  marketing: boolean;
  source: "hosted_page" | "web_form";
  key: string;
  /** CRM-01: utm_*, the referrer's host and the embedding site's host. The database cleans them again. */
  attribution: Record<string, string>;
};

export const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "referrer_host", "embed_host"] as const;

/** Only the known keys, each a short single-line string. */
export function readAttribution(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) out[key] = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200);
  }
  return out;
}

export type EnquiryRefusal = "name_required" | "contact_required" | "email_invalid" | "phone_invalid" | "consent_required" | "too_fast" | "invalid";

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/** The visitor's form, or the first thing to fix. The database checks it all again. */
export function readEnquiry(body: unknown): { input: EnquiryInput } | { error: EnquiryRefusal } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "invalid" };
  const raw = body as Record<string, unknown>;
  // Honeypot: a field people never see. Filled in means a script.
  if (typeof raw.website === "string" && raw.website.trim()) return { error: "invalid" };
  // Form timer: how long the form was open before it was sent. People take longer than this.
  if (typeof raw.elapsedMs !== "number" || !Number.isFinite(raw.elapsedMs) || raw.elapsedMs < 0) return { error: "invalid" };
  if (raw.elapsedMs < ENQUIRY_MIN_FORM_MS) return { error: "too_fast" };
  const name = str(raw.name, 200);
  if (!name) return { error: "name_required" };
  const contact = str(raw.contact, 320);
  if (!contact) return { error: "contact_required" };
  if (contact.includes("@")) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) return { error: "email_invalid" };
  } else if (!/^[0-9+() .-]{3,40}$/.test(contact)) {
    return { error: "phone_invalid" };
  }
  if (raw.reply !== true) return { error: "consent_required" };
  const key = typeof raw.key === "string" && /^[A-Za-z0-9-]{8,180}$/.test(raw.key) ? raw.key : null;
  if (!key) return { error: "invalid" };
  const service = str(raw.service, 120);
  return {
    input: {
      name,
      contact,
      preferred: raw.preferred === "phone" ? "phone" : raw.preferred === "email" ? "email" : null,
      service: service && (ENQUIRY_SERVICES as readonly string[]).includes(service) ? service : null,
      country: str(raw.country, 100),
      language: str(raw.language, 100),
      reply: true,
      marketing: raw.marketing === true,
      source: raw.source === "web_form" ? "web_form" : "hosted_page",
      key,
      attribution: readAttribution(raw.attribution),
    },
  };
}

export const ENQUIRY_MESSAGES: Record<EnquiryRefusal | "form_unavailable" | "form_closed" | "enquiry_rate_limited" | "unavailable", string> = {
  name_required: "Enter your name.",
  contact_required: "Enter an email or phone number.",
  email_invalid: "Enter a valid email address.",
  phone_invalid: "Enter a valid phone number.",
  consent_required: "Tick the box so the firm can reply to you.",
  too_fast: "Please take a moment to check your details, then send again.",
  invalid: "Check the form and try again.",
  form_unavailable: "This form isn’t available.",
  form_closed: "This firm isn’t taking enquiries online right now.",
  enquiry_rate_limited: "Too many enquiries from here. Try again in a few minutes.",
  unavailable: "Your enquiry couldn’t be sent. Try again.",
};
