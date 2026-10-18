/**
 * The public enquiry (CRM-01; PRD API "POST /leads: create minimal enquiry with abuse controls and
 * consent version"). Pure: what a visitor sends, checked, and the exact consent wording that is
 * stored with a hash next to their answer. The reply consent is required and is not marketing;
 * marketing is a separate, optional box (CASL; PRD OPS-05, SEC-05).
 */

/** Bump the version whenever either statement changes; stored with every answer. */
export const ENQUIRY_CONSENT = {
  version: "enquiry-v1",
  reply: "The firm may use these details to reply to my enquiry.",
  marketing: "Send me the firm’s news. Separate from replies about my enquiry; I can stop any time.",
} as const;

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
};

export type EnquiryRefusal = "name_required" | "contact_required" | "email_invalid" | "phone_invalid" | "consent_required" | "invalid";

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
    },
  };
}

export const ENQUIRY_MESSAGES: Record<EnquiryRefusal | "form_unavailable" | "enquiry_rate_limited" | "unavailable", string> = {
  name_required: "Enter your name.",
  contact_required: "Enter an email or phone number.",
  email_invalid: "Enter a valid email address.",
  phone_invalid: "Enter a valid phone number.",
  consent_required: "Tick the box so the firm can reply to you.",
  invalid: "Check the form and try again.",
  form_unavailable: "This form isn’t available.",
  enquiry_rate_limited: "Too many enquiries from here. Try again in a few minutes.",
  unavailable: "Your enquiry couldn’t be sent. Try again.",
};
