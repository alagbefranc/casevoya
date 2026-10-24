/**
 * The firm's public enquiry page from what the database says about the firm (CRM-01). Pure, so
 * the presentation and fidelity tests use the same function as the page.
 */
import type { EnquiryPageData } from "@/components/sheet/designer/enquiry";
import { ENQUIRY_SERVICES, enquiryStatements } from "./enquiry";

export const ENQUIRY_TITLE = "Tell us what you need";
export const ENQUIRY_LEAD = "A licensed consultant reads every enquiry. We only ask for what we need to reply; don’t send passport details or documents yet.";
export const ENQUIRY_ART = "/assets/generated/b2/client-welcome-160@2x.webp";
export const ENQUIRY_EMBED_NOTE = "Same fields, same consent wording, source recorded as “Website form”.";
/** CRM-01: the page when the firm has switched its enquiry page off. */
export function enquiryClosedTitle(firmName: string): string {
  return `${firmName} isn’t taking enquiries online right now`;
}
export const ENQUIRY_CLOSED_COPY = "Please contact the firm directly. Nothing you type here is sent.";

export const ENQUIRY_PRACTICE_NOTE = "Practice page: only your team can open it until your firm is verified. Enquiries sent here are sample leads.";

export function enquiryPageBase(input: {
  firmName: string;
  /** The firm's logo link, or null for its name as text. */
  logo: string | null;
  embedded: boolean;
  /** The firm's own staff: the script snippet for the website card. */
  snippet: string | null;
  practice: { label: string; detail: string; note: string } | null;
  /** CRM-01: the firm's public privacy notice (/privacy/<firm>). */
  privacyHref?: string | null;
}): Omit<EnquiryPageData, "errors" | "submit" | "live"> {
  const statements = enquiryStatements(input.firmName);
  return {
    header: input.logo ? { logo: { src: input.logo, alt: input.firmName } } : { name: input.firmName },
    title: ENQUIRY_TITLE,
    lead: ENQUIRY_LEAD,
    art: ENQUIRY_ART,
    embed: input.snippet ? { code: input.snippet, note: ENQUIRY_EMBED_NOTE } : null,
    preferred: ["Email", "Phone"],
    services: [...ENQUIRY_SERVICES],
    consent: { reply: statements.reply, replyNote: statements.replyNote, marketing: statements.marketingLabel, marketingNote: statements.marketingNote },
    footer: { firm: input.firmName, privacyHref: input.privacyHref ?? null },
    practice: input.practice,
    embedded: input.embedded,
  };
}
