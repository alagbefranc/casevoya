export const PORTAL_INVITE_ROLES = [
  "client",
  "adult_dependant",
  "sponsor",
  "employer_contact",
  "guardian",
] as const;

export type PortalInviteRole = (typeof PORTAL_INVITE_ROLES)[number];

export const PORTAL_SECTION_KEYS = [
  "passport_bio",
  "school_transcript",
  "police_certificate",
  "private_record",
] as const;

export type PortalShareSection = (typeof PORTAL_SECTION_KEYS)[number];

export type PortalAcceptPayload = {
  portal_terms_id: string;
  privacy_notice_id: string;
  locale: "en-CA" | "fr-CA";
  email_notices: boolean;
  sms_notices: boolean;
  deadline_reminders: boolean;
  processing_consent: boolean;
  ai_drafting?: boolean;
  shares?: PortalShareSection[];
};

export function isPortalInviteRole(value: string): value is PortalInviteRole {
  return (PORTAL_INVITE_ROLES as readonly string[]).includes(value);
}
