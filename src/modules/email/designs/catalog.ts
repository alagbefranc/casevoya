/**
 * Every approved email design (Designer export, 18 Oct 2026) as a typed template: what it says,
 * which header it carries, where its button goes. Copy follows the approved designs with the
 * example data (firm, people, dates, numbers) replaced by merge fields. Nothing sensitive is put in
 * a subject or preheader: no immigration program, no document name, no amount, no message body.
 * docs/EMAIL-TEMPLATES.md lists the same rows for review.
 *
 * Links are built here from the app origin and fixed app paths. The one exception is an
 * invitation's private accept link, which the mail worker opens from its sealed form and passes in
 * (acceptUrl); it is used only when it is an absolute http(s) URL. EM16c may link to the firm's
 * public booking page, /book/<firm slug>, where the slug must match the firm slug pattern.
 */
import { appLink, cleanText, safeUrl, type Brand, type EmailCopy, type Spot } from "@/modules/email/designs/layout";
import {
  agreementNoun,
  countOrNull,
  dateTimeIn,
  dayDate,
  documentNumber,
  longDate,
  shortDate,
  staffRolePhrase,
  uuidOrNull,
} from "@/modules/email/designs/format";

export type TemplateStatus = "wired" | "ready-not-wired" | "deferred";
export type Audience = "staff" | "firm owner" | "client" | "adult dependant";

/** Sent with an invitation when the private link could not be attached or opened. */
export const INVITE_WITHOUT_LINK = "The private link is not in this email. Use the link the firm gives you.";
export const INVITE_EXPIRY = "Your private link works once and expires in 7 days.";

export const PATHS = {
  portal: "/portal",
  portalDocuments: "/portal/documents",
  portalAgreements: "/portal/agreements",
  portalPayments: "/portal/payments",
  portalMessages: "/portal/messages",
  portalAppointments: "/portal/appointments",
  /** The firm's public booking pages: /book/<firm slug>. */
  book: "/book",
  sheetAgreements: "/sheet/agreements",
  sheetTasks: "/sheet/tasks",
  sheetGrants: "/sheet/grants",
  sheetSettings: "/sheet/settings",
  sheetExports: "/sheet/exports",
  sheetLicence: "/sheet/licence",
} as const;

type FirmContext = { firmName: string };

/** The typed merge context of each template. */
export type EmailContexts = {
  EM01: FirmContext & { inviterName?: string | null; role?: string | null; acceptUrl?: string | null };
  EM02: FirmContext & { inviterName?: string | null; acceptUrl?: string | null };
  EM05: Record<string, never>;
  EM06: FirmContext & { dueOn?: string | null };
  EM07: FirmContext & { dueOn?: string | null };
  EM08: FirmContext & { agreementKind?: string | null };
  "EM08-staff": FirmContext;
  EM09: FirmContext;
  "EM09-staff": FirmContext;
  EM10: FirmContext & { invoiceId?: string | null; invoiceNumber?: string | null; dueOn?: string | null };
  EM11: FirmContext & { receiptNumber?: string | null; advance?: boolean };
  EM12: { matterReference?: string | null };
  EM14a: FirmContext & { acceptUrl?: string | null };
  EM14b: FirmContext;
  EM14c: FirmContext & { dueOn?: string | null };
  EM15: FirmContext & { consultantName?: string | null };
  /** portal: the attendee's person has a portal login (only then a portal button). */
  EM16a: FirmContext & {
    startsAt?: string | null;
    timeZone?: string | null;
    consultantName?: string | null;
    portal?: boolean;
    locationKind?: string | null;
    address?: string | null;
  };
  EM16b: FirmContext & { startsAt?: string | null; timeZone?: string | null; portal?: boolean };
  /** bookingPage: the firm's slug when it has a booking page this attendee can use (no portal). */
  EM16c: FirmContext & { startsAt?: string | null; timeZone?: string | null; portal?: boolean; bookingPage?: string | null };
  EM17: FirmContext & { approverName?: string | null; minutes?: number | null; endsAt?: string | null; timeZone?: string | null };
  EM18a: FirmContext;
  EM18b: FirmContext & { daysPastDue?: number | null };
  EM19a: { hours?: number | null };
  EM19b: { startedOn?: string | null; hoursLeft?: number | null };
  EX02: FirmContext & { device?: string | null };
  EX03: FirmContext & { inviterName?: string | null };
  EX04: FirmContext & { acceptUrl?: string | null };
  EX05: FirmContext;
  EX06: FirmContext;
  "EX06-received": FirmContext;
  EX07: FirmContext;
  EX08: FirmContext & { invoiceId?: string | null; invoiceNumber?: string | null };
  EX09: FirmContext;
  EX10: FirmContext;
  EX11: FirmContext & { minutes?: number | null };
  EX12: FirmContext & { consultantName?: string | null };
  EX13: FirmContext & { replyBy?: string | null };
  EX14: FirmContext & { respondBy?: string | null; handlerName?: string | null };
};

export type TemplateId = keyof EmailContexts;

export type TemplateDef<C> = {
  id: string;
  name: string;
  audience: Audience;
  brand: "platform" | "firm";
  /** What makes the app send it (or, when not wired, what would). */
  trigger: string;
  status: TemplateStatus;
  /** Where the button goes, as an app path; null when the design has no button. */
  ctaTarget: string | null;
  mergeFields: string[];
  /** Synthetic merge values for previews and tests. Never real client data. */
  sample: C;
  build: (context: C, origin: string) => EmailCopy;
};

function firm(context: FirmContext): string {
  return cleanText(context.firmName) || "Your firm";
}

/** "Toronto time" from "America/Toronto". */
function zoneLabel(zone: string | null | undefined): string {
  const city = cleanText(zone ?? "", 60).split("/").pop()?.replaceAll("_", " ");
  return `${city || "Toronto"} time`;
}

function name(value: string | null | undefined): string {
  return cleanText(value ?? "", 80);
}

function firmBrand(context: FirmContext): Brand {
  return { kind: "firm", firmName: firm(context) };
}

const PLATFORM: Brand = { kind: "platform" };

function cta(label: string, href: string | null): EmailCopy["cta"] {
  return href ? { label, href } : null;
}

function copy(
  parts: Omit<EmailCopy, "cta" | "spot" | "brand"> & { cta?: EmailCopy["cta"]; spot: Spot; brand: Brand; lang?: "en" | "fr" },
): EmailCopy {
  return { cta: null, ...parts };
}

function invoiceHref(origin: string, invoiceId: string | null | undefined): string | null {
  const id = uuidOrNull(invoiceId);
  return appLink(origin, id ? `${PATHS.portalPayments}?invoice=${id}` : PATHS.portalPayments);
}

/**
 * EM16a: how they meet, from the booking's location kind. A meeting link itself is never put in
 * the email (the firm sends it); an in-person address is plain text.
 */
function meetingLine(firmName: string, kind: string | null | undefined, address: string | null | undefined): string {
  switch (kind) {
    case "phone":
      return `${firmName} will call you at the number you gave.`;
    case "video":
    case "meeting_link":
      return `${firmName} will send you the meeting link.`;
    case "in_person": {
      const where = cleanText(address ?? "", 300).replace(/\.$/, "");
      return where ? `At ${where}.` : `${firmName} will confirm the address.`;
    }
    default:
      return "";
  }
}

/** The last line for an attendee with no portal. */
function contactToChange(firmName: string): string {
  return `To change or cancel, contact ${firmName}.`;
}

const FIRM_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** The firm's public booking page, built from the fixed app path /book/<firm slug>. */
function bookingPageHref(origin: string, firmSlug: string | null | undefined): string | null {
  const slug = typeof firmSlug === "string" ? firmSlug.trim() : "";
  return FIRM_SLUG.test(slug) ? appLink(origin, `${PATHS.book}/${slug}`) : null;
}

const SYNTHETIC_FIRM = "Maple Example Immigration";

export const EMAIL_TEMPLATES: { [K in TemplateId]: TemplateDef<EmailContexts[K]> } = {
  EM01: {
    id: "EM01",
    name: "Staff invite",
    audience: "staff",
    brand: "platform",
    trigger: "Firm owner invites a staff member (outbox staff_invitation.email_requested, template invite, kind staff)",
    status: "wired",
    ctaTarget: "Sealed accept link /invite/<token>",
    mergeFields: ["firm_name", "inviter_name", "role", "accept_url (sealed)"],
    sample: { firmName: SYNTHETIC_FIRM, inviterName: "Sam Example", role: "case_manager", acceptUrl: "https://app.casevoya.ca/invite/0000000000000000000000000000000000000000000000000000000000000000" },
    build(context) {
      const firmName = firm(context);
      const inviter = name(context.inviterName);
      const link = safeUrl(context.acceptUrl);
      const lead = `You’ve been invited as ${staffRolePhrase(context.role)}. Set a password and two-step sign-in to join.`;
      return copy({
        subject: inviter ? `${inviter} invited you to ${firmName}` : `You’re invited to join ${firmName}`,
        preheader: `Accept your invitation to join ${firmName} on Casevoya.`,
        heading: inviter ? `${inviter} invited you to ${firmName}` : `You’re invited to join ${firmName}`,
        body: link ? `${lead} ${INVITE_EXPIRY}` : `${lead} ${INVITE_WITHOUT_LINK}`,
        cta: cta("Accept invitation", link),
        spot: "staff-invite",
        brand: PLATFORM,
      });
    },
  },
  EM02: {
    id: "EM02",
    name: "Client invite",
    audience: "client",
    brand: "firm",
    trigger: "Staff invite a client, sponsor, employer contact or guardian to the portal (outbox portal_invitation.email_requested)",
    status: "wired",
    ctaTarget: "Sealed accept link /accept/<role>?token=…",
    mergeFields: ["firm_name", "inviter_name", "accept_url (sealed)"],
    sample: { firmName: SYNTHETIC_FIRM, inviterName: "Sam Example", acceptUrl: "https://app.casevoya.ca/accept/client?token=0000000000000000000000000000000000000000000000000000000000000000" },
    build(context) {
      const firmName = firm(context);
      const lines = clientInviteLines(firmName, context.inviterName);
      const link = safeUrl(context.acceptUrl);
      return copy({
        subject: `Your file with ${firmName} is ready`,
        preheader: "Open your private link to set up your portal login.",
        heading: lines.heading,
        body: link ? lines.body : `${lines.invited} ${INVITE_WITHOUT_LINK}`,
        cta: cta("Open your portal", link),
        spot: "client-invite",
        brand: firmBrand(context),
      });
    },
  },
  EM05: {
    id: "EM05",
    name: "Sessions signed out",
    audience: "staff",
    brand: "platform",
    trigger: "Password changed with “sign out everywhere” (revoke_other_sessions). No outbox event yet",
    status: "ready-not-wired",
    ctaTarget: null,
    mergeFields: [],
    sample: {},
    build() {
      return copy({
        subject: "Your other sessions were signed out",
        preheader: "This follows your password change.",
        heading: "Your other sessions were signed out",
        body: "After your password change, every other session was signed out. This is recorded in your firm’s audit trail.",
        spot: "sign-in-code",
        brand: PLATFORM,
      });
    },
  },
  EM06: {
    id: "EM06",
    name: "Document requested",
    audience: "client",
    brand: "firm",
    trigger: "Staff create a document request (outbox document.request_created, template document_request)",
    status: "wired",
    ctaTarget: PATHS.portalDocuments,
    mergeFields: ["firm_name", "due_on"],
    sample: { firmName: SYNTHETIC_FIRM, dueOn: "2026-11-06" },
    build(context, origin) {
      const firmName = firm(context);
      const due = longDate(context.dueOn);
      return copy({
        subject: `${firmName} asked for a document`,
        preheader: "Upload it securely in your portal.",
        heading: `${firmName} asked for a document`,
        body: due
          ? `Please upload a document to your file by ${due}. Details are in your portal.`
          : "Please upload a document to your file. Details are in your portal.",
        cta: cta("Open your portal", appLink(origin, PATHS.portalDocuments)),
        spot: "document-requested",
        brand: firmBrand(context),
      });
    },
  },
  EM07: {
    id: "EM07",
    name: "Deadline reminder",
    audience: "client",
    brand: "firm",
    trigger: "A reminder schedule comes due (outbox reminder.due, template reminder). Honours deadline_reminders and email_notices",
    status: "wired",
    ctaTarget: PATHS.portal,
    mergeFields: ["firm_name", "due_on"],
    sample: { firmName: SYNTHETIC_FIRM, dueOn: "2026-10-30" },
    build(context, origin) {
      const short = shortDate(context.dueOn);
      const day = dayDate(context.dueOn);
      return copy({
        subject: short ? `A step on your file is due ${short}` : `A reminder from ${firm(context)}`,
        preheader: "Your portal shows what to do next.",
        heading: short ? `A step is due on ${short}` : "A step on your file is coming up",
        body: day
          ? `A step on your file is due ${day}. Your portal shows what to do.`
          : "A step on your file is coming up. Your portal shows what to do.",
        cta: cta("Open your portal", appLink(origin, PATHS.portal)),
        spot: "reminder",
        brand: firmBrand(context),
      });
    },
  },
  EM08: {
    id: "EM08",
    name: "Agreement ready to sign",
    audience: "client",
    brand: "firm",
    trigger: "Staff send an agreement for signature (outbox agreement.sent, template agreement), to client signers",
    status: "wired",
    ctaTarget: PATHS.portalAgreements,
    mergeFields: ["firm_name", "agreement_kind"],
    sample: { firmName: SYNTHETIC_FIRM, agreementKind: "service" },
    build(context, origin) {
      const firmName = firm(context);
      return copy({
        subject: `An agreement from ${firmName} is ready to sign`,
        preheader: "Review it and sign in your portal.",
        heading: "An agreement is ready to sign",
        body: `Your ${agreementNoun(context.agreementKind)} from ${firmName} is ready. Review it and sign in your portal.`,
        cta: cta("Review and sign", appLink(origin, PATHS.portalAgreements)),
        spot: "agreement",
        brand: firmBrand(context),
      });
    },
  },
  "EM08-staff": {
    id: "EM08-staff",
    name: "Agreement: your turn to countersign (staff variant of EM08)",
    audience: "staff",
    brand: "platform",
    trigger: "A staff signer’s turn comes (outbox agreement.signer_turn, template agreement, audience staff)",
    status: "wired",
    ctaTarget: PATHS.sheetAgreements,
    mergeFields: ["firm_name"],
    sample: { firmName: SYNTHETIC_FIRM },
    build(context, origin) {
      const firmName = firm(context);
      return copy({
        subject: `Your countersignature is needed at ${firmName}`,
        preheader: "Open Agreements in Casevoya to sign.",
        heading: "It’s your turn to countersign",
        body: `Everyone before you has signed an agreement. It is your turn to countersign it for ${firmName}. Open Agreements in Casevoya to sign.`,
        cta: cta("Open agreements", appLink(origin, PATHS.sheetAgreements)),
        spot: "agreement",
        brand: PLATFORM,
      });
    },
  },
  EM09: {
    id: "EM09",
    name: "Agreement executed",
    audience: "client",
    brand: "firm",
    trigger: "The last signer signs (outbox agreement.executed, template signature), to client signers",
    status: "wired",
    ctaTarget: PATHS.portalAgreements,
    mergeFields: ["firm_name"],
    sample: { firmName: SYNTHETIC_FIRM },
    build(context, origin) {
      const firmName = firm(context);
      return copy({
        subject: `Your agreement with ${firmName} is signed`,
        preheader: "Your copy and the completion certificate are in your portal.",
        heading: "Everyone has signed",
        body: `Your agreement with ${firmName} is signed by everyone. Your copy and the completion certificate are in your portal.`,
        cta: cta("Download your copy", appLink(origin, PATHS.portalAgreements)),
        spot: "agreement",
        brand: firmBrand(context),
      });
    },
  },
  "EM09-staff": {
    id: "EM09-staff",
    name: "Agreement executed (staff variant of EM09)",
    audience: "staff",
    brand: "platform",
    trigger: "The last signer signs (outbox agreement.executed, template signature, audience staff), to staff signers",
    status: "wired",
    ctaTarget: PATHS.sheetAgreements,
    mergeFields: ["firm_name"],
    sample: { firmName: SYNTHETIC_FIRM },
    build(context, origin) {
      const firmName = firm(context);
      return copy({
        subject: `An agreement at ${firmName} is signed`,
        preheader: "The firm’s copy is on the matter in Casevoya.",
        heading: "Everyone has signed",
        body: "An agreement you signed is now signed by everyone. The firm’s copy and the completion certificate are on the matter in Casevoya.",
        cta: cta("Open agreements", appLink(origin, PATHS.sheetAgreements)),
        spot: "agreement",
        brand: PLATFORM,
      });
    },
  },
  EM10: {
    id: "EM10",
    name: "Invoice issued",
    audience: "client",
    brand: "firm",
    trigger: "Billing staff issue an invoice (outbox invoice.issued, template invoice), to the matter’s applicants. Honours email_notices",
    status: "wired",
    ctaTarget: `${PATHS.portalPayments}?invoice=<invoice id>`,
    mergeFields: ["firm_name", "invoice_id", "invoice_number", "due_on"],
    sample: { firmName: SYNTHETIC_FIRM, invoiceId: "00000000-0000-4000-8000-000000000010", invoiceNumber: "INV-0001", dueOn: "2026-11-06" },
    build(context, origin) {
      const firmName = firm(context);
      const number = documentNumber(context.invoiceNumber, "INV");
      const due = longDate(context.dueOn);
      const which = number ? `Invoice ${number}` : "Your invoice";
      return copy({
        subject: `New invoice from ${firmName}`,
        preheader: "The amount and payment options are in your portal.",
        heading: `New invoice from ${firmName}`,
        body: due
          ? `${which} has a balance due on ${due}. The amount and payment options are in your portal.`
          : `${which} is ready. The amount and payment options are in your portal.`,
        cta: cta("View invoice", invoiceHref(origin, context.invoiceId)),
        spot: "invoice",
        brand: firmBrand(context),
      });
    },
  },
  EM11: {
    id: "EM11",
    name: "Payment receipt",
    audience: "client",
    brand: "firm",
    trigger: "An invoice payment receipt (PR-) or client-funds advance receipt (RC-) is issued. Hook: template payment_receipt; needs its enum value and an outbox event from app.issue_invoice_payment_receipt",
    status: "ready-not-wired",
    ctaTarget: PATHS.portalPayments,
    mergeFields: ["firm_name", "receipt_number", "advance"],
    sample: { firmName: SYNTHETIC_FIRM, receiptNumber: "PR-0001", advance: false },
    build(context, origin) {
      const firmName = firm(context);
      // PR-0001: invoice payment receipt; RC-0001: client-funds advance receipt.
      const number = documentNumber(context.receiptNumber, "PR") ?? documentNumber(context.receiptNumber, "RC");
      const what = context.advance ? "your advance payment" : "your payment";
      return copy({
        subject: `${firmName} received your payment`,
        preheader: "Your receipt is in your portal.",
        heading: "Payment received",
        body: number
          ? `${firmName} received ${what}. Receipt ${number} is in your portal.`
          : `${firmName} received ${what}. Your receipt is in your portal.`,
        cta: cta("View receipt", appLink(origin, PATHS.portalPayments)),
        spot: "receipt",
        brand: firmBrand(context),
      });
    },
  },
  EM12: {
    id: "EM12",
    name: "Bounced notice staff follow up",
    audience: "staff",
    brand: "platform",
    trigger: "A critical client email bounces (finish_email_delivery opens the “Email was not delivered” task). No email yet",
    status: "ready-not-wired",
    ctaTarget: PATHS.sheetTasks,
    mergeFields: ["matter_reference"],
    sample: { matterReference: "CA-2026-0001" },
    build(context, origin) {
      const reference = cleanText(context.matterReference ?? "", 40);
      return copy({
        subject: "A client notice was not delivered",
        preheader: "A follow-up task is open in Casevoya.",
        heading: "Critical notice not delivered",
        body: reference
          ? `A notice on matter ${reference} bounced and was not delivered. A follow-up task was created.`
          : "A client notice bounced and was not delivered. A follow-up task was created.",
        cta: cta("Open task", appLink(origin, PATHS.sheetTasks)),
        spot: "reminder",
        brand: PLATFORM,
      });
    },
  },
  EM14a: {
    id: "EM14a",
    name: "French client invite (draft)",
    audience: "client",
    brand: "firm",
    trigger: "French client invitation (fr-CA). Draft translation: needs a certified translator. Never sent",
    status: "deferred",
    ctaTarget: "Sealed accept link",
    mergeFields: ["firm_name", "accept_url (sealed)"],
    sample: { firmName: SYNTHETIC_FIRM, acceptUrl: "https://app.casevoya.ca/accept/client?token=0000000000000000000000000000000000000000000000000000000000000000" },
    build(context) {
      const firmName = firm(context);
      return copy({
        subject: `Votre dossier avec ${firmName} est prêt`,
        preheader: "Ouvrez votre lien privé pour créer votre accès au portail.",
        heading: `Votre dossier avec ${firmName} est prêt`,
        body: `${firmName} vous invite à votre portail client. Ouvrez votre portail pour voir votre première étape.`,
        cta: cta("Ouvrir votre portail", safeUrl(context.acceptUrl)),
        spot: "client-invite",
        brand: firmBrand(context),
        lang: "fr",
      });
    },
  },
  EM14b: {
    id: "EM14b",
    name: "French document requested (draft)",
    audience: "client",
    brand: "firm",
    trigger: "French document request (fr-CA). Draft translation: needs a certified translator. Never sent",
    status: "deferred",
    ctaTarget: PATHS.portalDocuments,
    mergeFields: ["firm_name"],
    sample: { firmName: SYNTHETIC_FIRM },
    build(context, origin) {
      const firmName = firm(context);
      return copy({
        subject: `${firmName} vous demande un document`,
        preheader: "Téléversez-le en toute sécurité dans votre portail.",
        heading: `${firmName} vous demande un document`,
        body: "Veuillez téléverser un document à votre dossier. Les détails se trouvent dans votre portail.",
        cta: cta("Ouvrir votre portail", appLink(origin, PATHS.portalDocuments)),
        spot: "document-requested",
        brand: firmBrand(context),
        lang: "fr",
      });
    },
  },
  EM14c: {
    id: "EM14c",
    name: "French deadline reminder (draft)",
    audience: "client",
    brand: "firm",
    trigger: "French reminder (fr-CA). Draft translation: needs a certified translator. Never sent",
    status: "deferred",
    ctaTarget: PATHS.portal,
    mergeFields: ["firm_name", "due_on"],
    sample: { firmName: SYNTHETIC_FIRM, dueOn: "2026-10-30" },
    build(context, origin) {
      return copy({
        subject: "Une étape de votre dossier arrive à échéance",
        preheader: "Votre portail indique quoi faire.",
        heading: "Une étape arrive à échéance",
        body: "Une étape de votre dossier arrive à échéance. Votre portail indique quoi faire.",
        cta: cta("Ouvrir votre portail", appLink(origin, PATHS.portal)),
        spot: "reminder",
        brand: firmBrand(context),
        lang: "fr",
      });
    },
  },
  EM15: {
    id: "EM15",
    name: "Decision recorded",
    audience: "client",
    brand: "firm",
    trigger: "Staff record a government decision on the matter. No outbox mail event yet",
    status: "ready-not-wired",
    ctaTarget: PATHS.portal,
    mergeFields: ["firm_name", "consultant_name"],
    sample: { firmName: SYNTHETIC_FIRM, consultantName: "Sam Example" },
    build(context, origin) {
      const firmName = firm(context);
      const consultant = name(context.consultantName);
      const next = consultant ? `${consultant} will contact you about next steps.` : `${firmName} will contact you about next steps.`;
      return copy({
        subject: "There’s news on your file",
        preheader: "For your privacy, the details are in your portal.",
        heading: "There’s news on your file",
        body: `${firmName} recorded a decision on your file. For your privacy, the details are in your portal. ${next}`,
        cta: cta("Open your portal", appLink(origin, PATHS.portal)),
        spot: "receipt",
        brand: firmBrand(context),
      });
    },
  },
  EM16a: {
    id: "EM16a",
    name: "Consultation booked",
    audience: "client",
    brand: "firm",
    trigger:
      "A consultation is booked on the public booking page (or a practice page in sample mode) or by staff (outbox booking.confirmed, template consultation_booked), to the attendee. Honours email_notices when linked to a person. The portal button only for an attendee whose person has a portal login",
    status: "wired",
    ctaTarget: PATHS.portalAppointments,
    mergeFields: ["firm_name", "starts_at", "time_zone", "consultant_name", "portal", "location_kind", "address"],
    sample: {
      firmName: SYNTHETIC_FIRM,
      startsAt: "2026-10-22T14:30:00Z",
      timeZone: "America/Toronto",
      consultantName: "Sam Example",
      portal: true,
      locationKind: "phone",
    },
    build(context, origin) {
      const firmName = firm(context);
      const when = dateTimeIn(context.startsAt, context.timeZone);
      const consultant = name(context.consultantName);
      const lead = when ? `${when} (${zoneLabel(context.timeZone)})` : "Your consultation";
      const meet = meetingLine(firmName, context.locationKind, context.address);
      const end = context.portal ? "" : ` ${contactToChange(firmName)}`;
      return copy({
        subject: `Your consultation with ${firmName} is booked`,
        preheader: "Here’s when, and how you’ll meet.",
        heading: "Your consultation is booked",
        body: `${lead}${consultant ? ` with ${consultant}` : ""}.${meet ? ` ${meet}` : ""}${end}`,
        cta: context.portal ? cta("View booking", appLink(origin, PATHS.portalAppointments)) : null,
        spot: "reminder",
        brand: firmBrand(context),
      });
    },
  },
  EM16b: {
    id: "EM16b",
    name: "Consultation rescheduled",
    audience: "client",
    brand: "firm",
    trigger:
      "Staff move a confirmed consultation (outbox booking.rescheduled, template consultation_rescheduled), to the attendee. The portal button only for an attendee whose person has a portal login",
    status: "wired",
    ctaTarget: PATHS.portalAppointments,
    mergeFields: ["firm_name", "starts_at", "time_zone", "portal"],
    sample: { firmName: SYNTHETIC_FIRM, startsAt: "2026-10-27T14:30:00Z", timeZone: "America/Toronto", portal: true },
    build(context, origin) {
      const firmName = firm(context);
      const when = dateTimeIn(context.startsAt, context.timeZone);
      const moved = when ? `Your consultation is now ${when} (${zoneLabel(context.timeZone)}).` : "Your consultation has a new time.";
      return copy({
        subject: `Your appointment with ${firmName} moved`,
        preheader: context.portal ? "The new time is in your portal." : "Here’s the new time.",
        heading: "Your appointment moved",
        body: context.portal
          ? when
            ? `${moved} Your reminders moved too.`
            : "Your consultation has a new time. It’s in your portal, and your reminders moved too."
          : `${moved} ${contactToChange(firmName)}`,
        cta: context.portal ? cta("View booking", appLink(origin, PATHS.portalAppointments)) : null,
        spot: "reminder",
        brand: firmBrand(context),
      });
    },
  },
  EM16c: {
    id: "EM16c",
    name: "Consultation cancelled",
    audience: "client",
    brand: "firm",
    trigger:
      "Staff cancel an upcoming confirmed consultation (outbox booking.cancelled, template consultation_cancelled), to the attendee. Portal attendees get the portal button; others get the firm's booking page when it has a published one they can use, otherwise no button",
    status: "wired",
    ctaTarget: PATHS.portalAppointments,
    mergeFields: ["firm_name", "starts_at", "time_zone", "portal", "booking_page"],
    sample: { firmName: SYNTHETIC_FIRM, startsAt: "2026-10-27T14:30:00Z", timeZone: "America/Toronto", portal: true },
    build(context, origin) {
      const firmName = firm(context);
      const when = dateTimeIn(context.startsAt, context.timeZone);
      const which = when ? `Your consultation on ${when} (${zoneLabel(context.timeZone)})` : "Your consultation";
      const page = context.portal ? null : bookingPageHref(origin, context.bookingPage);
      const href = context.portal ? appLink(origin, PATHS.portalAppointments) : page;
      return copy({
        subject: `${firmName} cancelled your consultation`,
        preheader: context.portal
          ? "You can book another time in your portal."
          : page
            ? "You can book another time online."
            : "To book another time, contact the firm.",
        heading: "Your consultation was cancelled",
        body: `${which} was cancelled by ${firmName}.${href ? "" : ` To book another time, contact ${firmName}.`}`,
        cta: href ? cta("Book another time", href) : null,
        spot: "reminder",
        brand: firmBrand(context),
      });
    },
  },
  EM17: {
    id: "EM17",
    name: "Support access granted",
    audience: "firm owner",
    brand: "platform",
    trigger: "A firm owner approves a Casevoya support access request. Support access is not built yet",
    status: "ready-not-wired",
    ctaTarget: PATHS.sheetGrants,
    mergeFields: ["firm_name", "approver_name", "minutes", "ends_at", "time_zone"],
    sample: { firmName: SYNTHETIC_FIRM, approverName: "Sam Example", minutes: 60, endsAt: "2026-10-22T15:40:00Z", timeZone: "America/Toronto" },
    build(context, origin) {
      const approver = name(context.approverName) || "A firm owner";
      const minutes = countOrNull(context.minutes, 1440);
      const ends = dateTimeIn(context.endsAt, context.timeZone);
      return copy({
        subject: "You gave Casevoya support access",
        preheader: "Every action is in your audit trail. You can end it now.",
        heading: "You gave Casevoya support access",
        body: `${approver} approved ${minutes ? `${minutes} minutes of ` : ""}support access on one matter.${ends ? ` It ends ${ends}.` : ""} Every action is in your audit trail, and you can end it now.`,
        cta: cta("Review or end access", appLink(origin, PATHS.sheetGrants)),
        spot: "verify",
        brand: PLATFORM,
      });
    },
  },
  EM18a: {
    id: "EM18a",
    name: "Subscription past due",
    audience: "firm owner",
    brand: "platform",
    trigger: "The Casevoya subscription payment fails. Subscription billing is not built yet",
    status: "ready-not-wired",
    ctaTarget: PATHS.sheetSettings,
    mergeFields: ["firm_name"],
    sample: { firmName: SYNTHETIC_FIRM },
    build(context, origin) {
      return copy({
        subject: "Your Casevoya subscription is past due",
        preheader: "Nothing is deleted. Update billing to keep working.",
        heading: "Your Casevoya subscription is past due",
        body: `We couldn’t collect ${firm(context)}’s subscription payment. Nothing is deleted; new work pauses after notice if it stays unpaid.`,
        cta: cta("Update billing", appLink(origin, PATHS.sheetSettings)),
        spot: "invoice",
        brand: PLATFORM,
      });
    },
  },
  EM18b: {
    id: "EM18b",
    name: "Workspace restricted",
    audience: "firm owner",
    brand: "platform",
    trigger: "The subscription stays past due. Subscription billing is not built yet",
    status: "ready-not-wired",
    ctaTarget: PATHS.sheetSettings,
    mergeFields: ["firm_name", "days_past_due"],
    sample: { firmName: SYNTHETIC_FIRM, daysPastDue: 21 },
    build(context, origin) {
      const days = countOrNull(context.daysPastDue, 3650);
      return copy({
        subject: `${firm(context)}’s workspace is restricted`,
        preheader: "Clients can still sign in, upload and pay. Nothing is deleted.",
        heading: `${firm(context)}’s workspace is restricted`,
        body: `Your subscription has been past due${days ? ` for ${days} days` : ""}, so new matters, invitations and submission releases are paused. Clients can still sign in, upload and pay, and nothing is deleted.`,
        cta: cta("Update billing", appLink(origin, PATHS.sheetSettings)),
        spot: "invoice",
        brand: PLATFORM,
      });
    },
  },
  EM19a: {
    id: "EM19a",
    name: "Data export ready",
    audience: "staff",
    brand: "platform",
    trigger: "A client-file export finishes. Exports are not built yet",
    status: "ready-not-wired",
    ctaTarget: PATHS.sheetExports,
    mergeFields: ["hours"],
    sample: { hours: 24 },
    build(context, origin) {
      const hours = countOrNull(context.hours, 720);
      return copy({
        subject: "Your export is ready",
        preheader: "Sign in to download it.",
        heading: "Your export is ready",
        body: `The client-file export you started is ready. The link ${hours ? `works for ${hours} hours and ` : ""}needs you to sign in.`,
        cta: cta("Download export", appLink(origin, PATHS.sheetExports)),
        spot: "sign-in-code",
        brand: PLATFORM,
      });
    },
  },
  EM19b: {
    id: "EM19b",
    name: "Data export expiring",
    audience: "staff",
    brand: "platform",
    trigger: "An unopened export nears expiry. Exports are not built yet",
    status: "ready-not-wired",
    ctaTarget: PATHS.sheetExports,
    mergeFields: ["started_on", "hours_left"],
    sample: { startedOn: "2026-10-16", hoursLeft: 2 },
    build(context, origin) {
      const started = shortDate(context.startedOn);
      const hours = countOrNull(context.hoursLeft, 720);
      return copy({
        subject: "Your client-file export expires soon",
        preheader: "Download it before the link expires.",
        heading: "Your client-file export expires soon",
        body: `The export you started${started ? ` on ${started}` : ""} expires${hours ? ` in ${hours} ${hours === 1 ? "hour" : "hours"}` : " soon"}. After that you can start a new one; nothing in the file changes.`,
        cta: cta("Download export", appLink(origin, PATHS.sheetExports)),
        spot: "sign-in-code",
        brand: PLATFORM,
      });
    },
  },
  EX02: {
    id: "EX02",
    name: "New sign in alert",
    audience: "staff",
    brand: "platform",
    trigger: "A staff sign-in from a new device. No device tracking event yet",
    status: "ready-not-wired",
    ctaTarget: PATHS.sheetSettings,
    mergeFields: ["firm_name", "device"],
    sample: { firmName: SYNTHETIC_FIRM, device: "Chrome on Windows" },
    build(context, origin) {
      const device = cleanText(context.device ?? "", 80);
      return copy({
        subject: "New sign-in to your Casevoya account",
        preheader: "If it wasn’t you, sign out everywhere now.",
        heading: "New sign-in to your account",
        body: `Someone signed in to ${firm(context)} on a new device${device ? ` (${device})` : ""}. If it wasn’t you, sign out everywhere now.`,
        cta: cta("Review sign-ins", appLink(origin, PATHS.sheetSettings)),
        spot: "sign-in-code",
        brand: PLATFORM,
      });
    },
  },
  EX03: {
    id: "EX03",
    name: "Invitation expired",
    audience: "staff",
    brand: "platform",
    trigger: "A staff invitation passes its 7 days unused. No expiry event yet",
    status: "ready-not-wired",
    ctaTarget: null,
    mergeFields: ["firm_name", "inviter_name"],
    sample: { firmName: SYNTHETIC_FIRM, inviterName: "Sam Example" },
    build(context) {
      const inviter = name(context.inviterName);
      return copy({
        subject: `Your invitation to ${firm(context)} expired`,
        preheader: "Ask the firm to send a new one.",
        heading: "Your invitation expired",
        body: `Your invitation to ${firm(context)} expired after 7 days. Ask ${inviter || "the firm owner"} to send a new one.`,
        spot: "staff-invite",
        brand: PLATFORM,
      });
    },
  },
  EX04: {
    id: "EX04",
    name: "Dependant invite",
    audience: "adult dependant",
    brand: "firm",
    trigger: "Staff invite an adult dependant to their own login (portal_invitation.email_requested, role adult_dependant)",
    status: "wired",
    ctaTarget: "Sealed accept link /accept/family?token=…",
    mergeFields: ["firm_name", "accept_url (sealed)"],
    sample: { firmName: SYNTHETIC_FIRM, acceptUrl: "https://app.casevoya.ca/accept/family?token=0000000000000000000000000000000000000000000000000000000000000000" },
    build(context) {
      const firmName = firm(context);
      const link = safeUrl(context.acceptUrl);
      const lead = `${firmName} has opened your own login for the family file. You choose what you share.`;
      return copy({
        subject: `${firmName} opened your own login`,
        preheader: "Set up your login. You choose what you share.",
        heading: "You’re invited to share your file",
        body: link ? `${lead} ${INVITE_EXPIRY}` : `${lead} ${INVITE_WITHOUT_LINK}`,
        cta: cta("Set up your login", link),
        spot: "client-invite",
        brand: firmBrand(context),
      });
    },
  },
  EX05: {
    id: "EX05",
    name: "Document needs another look",
    audience: "client",
    brand: "firm",
    trigger: "Staff reject a document version (outbox document.reviewed, decision not accepted). Currently skipped by prepare_email_delivery",
    status: "ready-not-wired",
    ctaTarget: PATHS.portalDocuments,
    mergeFields: ["firm_name"],
    sample: { firmName: SYNTHETIC_FIRM },
    build(context, origin) {
      const firmName = firm(context);
      return copy({
        subject: "A document needs another look",
        preheader: "The reason is in your portal.",
        heading: "A document needs another look",
        body: `${firmName} asked for a clearer copy of one of your documents. The reason is in your portal.`,
        cta: cta("Open your portal", appLink(origin, PATHS.portalDocuments)),
        spot: "document-requested",
        brand: firmBrand(context),
      });
    },
  },
  EX06: {
    id: "EX06",
    name: "Document accepted",
    audience: "client",
    brand: "firm",
    trigger: "Staff accept a document version (outbox document.reviewed, decision accepted, template document_receipt)",
    status: "wired",
    ctaTarget: PATHS.portalDocuments,
    mergeFields: ["firm_name"],
    sample: { firmName: SYNTHETIC_FIRM },
    build(context, origin) {
      const firmName = firm(context);
      return copy({
        subject: "Your document was accepted",
        preheader: `Accepted by ${firmName}, not by the government.`,
        heading: "Your document was accepted",
        body: `${firmName} accepted one of your documents for your file. Accepted means accepted by ${firmName}, not by the government.`,
        cta: cta("Open your portal", appLink(origin, PATHS.portalDocuments)),
        spot: "receipt",
        brand: firmBrand(context),
      });
    },
  },
  "EX06-received": {
    id: "EX06-received",
    name: "Document received (variant of EX06)",
    audience: "client",
    brand: "firm",
    trigger: "A document upload passes the file check (outbox document.uploaded, template document_receipt)",
    status: "wired",
    ctaTarget: PATHS.portalDocuments,
    mergeFields: ["firm_name"],
    sample: { firmName: SYNTHETIC_FIRM },
    build(context, origin) {
      const firmName = firm(context);
      return copy({
        subject: `${firmName} received your document`,
        preheader: "It’s in your portal.",
        heading: "Your document was received",
        body: `${firmName} received a document on your file. It’s in your portal.`,
        cta: cta("Open your portal", appLink(origin, PATHS.portalDocuments)),
        spot: "receipt",
        brand: firmBrand(context),
      });
    },
  },
  EX07: {
    id: "EX07",
    name: "New message",
    audience: "client",
    brand: "firm",
    trigger: "Staff send a portal message. Matter messages are not built yet (T034)",
    status: "ready-not-wired",
    ctaTarget: PATHS.portalMessages,
    mergeFields: ["firm_name"],
    sample: { firmName: SYNTHETIC_FIRM },
    build(context, origin) {
      const firmName = firm(context);
      return copy({
        subject: `New message from ${firmName}`,
        preheader: "For your privacy, read it in your portal.",
        heading: "You have a new message",
        body: `${firmName} sent you a message. For your privacy, read it in your portal.`,
        cta: cta("Read message", appLink(origin, PATHS.portalMessages)),
        spot: "reminder",
        brand: firmBrand(context),
      });
    },
  },
  EX08: {
    id: "EX08",
    name: "Payment failed",
    audience: "client",
    brand: "firm",
    trigger: "A card payment fails (Stripe payment_intent.payment_failed moves invoice_payments to failed; outbox invoice.payment_failed, template payment_failed). Honours email_notices",
    status: "wired",
    ctaTarget: `${PATHS.portalPayments}?invoice=<invoice id>`,
    mergeFields: ["firm_name", "invoice_id", "invoice_number"],
    sample: { firmName: SYNTHETIC_FIRM, invoiceId: "00000000-0000-4000-8000-000000000010", invoiceNumber: "INV-0001" },
    build(context, origin) {
      const firmName = firm(context);
      const number = documentNumber(context.invoiceNumber, "INV");
      return copy({
        subject: `Your payment to ${firmName} didn’t go through`,
        preheader: "You haven’t been charged. You can try again in your portal.",
        heading: "We couldn’t take your payment",
        body: `Your card payment to ${firmName}${number ? ` for invoice ${number}` : ""} didn’t go through. You haven’t been charged. You can try again in your portal.`,
        cta: cta("Open payments", invoiceHref(origin, context.invoiceId)),
        spot: "invoice",
        brand: firmBrand(context),
      });
    },
  },
  EX09: {
    id: "EX09",
    name: "Refund started",
    audience: "client",
    brand: "firm",
    trigger: "Billing staff refund a card payment (invoice_refunds row recorded; outbox invoice.refund_started, template refund_started). Honours email_notices",
    status: "wired",
    ctaTarget: PATHS.portalPayments,
    mergeFields: ["firm_name"],
    sample: { firmName: SYNTHETIC_FIRM },
    build(context, origin) {
      const firmName = firm(context);
      return copy({
        subject: `${firmName} started a refund`,
        preheader: "Refunds usually take 5 to 10 business days to appear.",
        heading: "Your refund is on its way",
        body: `${firmName} started a refund to your card. Refunds usually take 5 to 10 business days to appear.`,
        cta: cta("View payments", appLink(origin, PATHS.portalPayments)),
        spot: "receipt",
        brand: firmBrand(context),
      });
    },
  },
  EX10: {
    id: "EX10",
    name: "Refund complete",
    audience: "client",
    brand: "firm",
    trigger: "Stripe confirms the refund (refund.updated succeeded; outbox invoice.refund_succeeded, template refund_complete). Honours email_notices",
    status: "wired",
    ctaTarget: PATHS.portalPayments,
    mergeFields: ["firm_name"],
    sample: { firmName: SYNTHETIC_FIRM },
    build(context, origin) {
      const firmName = firm(context);
      return copy({
        subject: `Your refund from ${firmName} is complete`,
        preheader: "The details are in your portal.",
        heading: "Your refund is complete",
        body: `${firmName}’s refund has been sent. The details are in your portal.`,
        cta: cta("View payments", appLink(origin, PATHS.portalPayments)),
        spot: "receipt",
        brand: firmBrand(context),
      });
    },
  },
  EX11: {
    id: "EX11",
    name: "Support access requested",
    audience: "firm owner",
    brand: "platform",
    trigger: "Casevoya support asks for access. Support access is not built yet",
    status: "ready-not-wired",
    ctaTarget: PATHS.sheetGrants,
    mergeFields: ["firm_name", "minutes"],
    sample: { firmName: SYNTHETIC_FIRM, minutes: 60 },
    build(context, origin) {
      const minutes = countOrNull(context.minutes, 1440);
      return copy({
        subject: "Casevoya support asked for access",
        preheader: "Nothing opens unless you approve.",
        heading: "Support access requested",
        body: `Casevoya support asked for ${minutes ? `${minutes} minutes of ` : ""}access to one matter at ${firm(context)}. Nothing opens unless you approve.`,
        cta: cta("Review request", appLink(origin, PATHS.sheetGrants)),
        spot: "verify",
        brand: PLATFORM,
      });
    },
  },
  EX12: {
    id: "EX12",
    name: "Licence check attention",
    audience: "firm owner",
    brand: "platform",
    trigger: "The register re-check cannot confirm a consultant’s licence. Re-check reminders are not wired to email yet",
    status: "ready-not-wired",
    ctaTarget: PATHS.sheetLicence,
    mergeFields: ["firm_name", "consultant_name"],
    sample: { firmName: SYNTHETIC_FIRM, consultantName: "Sam Example" },
    build(context, origin) {
      const consultant = name(context.consultantName);
      return copy({
        subject: "A licence check needs attention",
        preheader: "Open Licences in Casevoya to review it.",
        heading: "A licence check needs attention",
        body: `The register check couldn’t confirm ${consultant ? `${consultant}’s` : "a consultant’s"} licence. New engagements and submission releases are paused.`,
        cta: cta("Open licences", appLink(origin, PATHS.sheetLicence)),
        spot: "verify",
        brand: PLATFORM,
      });
    },
  },
  EX13: {
    id: "EX13",
    name: "Privacy request received",
    audience: "client",
    brand: "firm",
    trigger: "A client makes a privacy request. Privacy requests are not built yet",
    status: "ready-not-wired",
    ctaTarget: PATHS.portal,
    mergeFields: ["firm_name", "reply_by"],
    sample: { firmName: SYNTHETIC_FIRM, replyBy: "2026-11-11" },
    build(context, origin) {
      const firmName = firm(context);
      const by = longDate(context.replyBy);
      return copy({
        subject: `${firmName} received your privacy request`,
        preheader: "You can follow it in your portal.",
        heading: "We received your privacy request",
        body: `${firmName} received your request to see your records.${by ? ` They’ll reply by ${by}.` : ""}`,
        cta: cta("Open your portal", appLink(origin, PATHS.portal)),
        spot: "verify",
        brand: firmBrand(context),
      });
    },
  },
  EX14: {
    id: "EX14",
    name: "Complaint received",
    audience: "client",
    brand: "firm",
    trigger: "A client files a complaint. Complaints are not built yet",
    status: "ready-not-wired",
    ctaTarget: null,
    mergeFields: ["firm_name", "respond_by", "handler_name"],
    sample: { firmName: SYNTHETIC_FIRM, respondBy: "2026-10-23", handlerName: "Sam Example" },
    build(context) {
      const firmName = firm(context);
      const by = longDate(context.respondBy);
      const handler = name(context.handlerName);
      return copy({
        subject: `${firmName} received your complaint`,
        preheader: "We’ll respond in writing.",
        heading: "We received your complaint",
        body: `${firmName} received your complaint${by ? ` and will respond by ${by}` : " and will respond in writing"}.${handler ? ` It’s handled by ${handler}.` : ""}`,
        spot: "verify",
        brand: firmBrand(context),
      });
    },
  },
};

/** The client-invitation heading and paragraph, shared with the staff screen's preview. */
export function clientInviteLines(firmName: string, inviterName?: string | null): { heading: string; invited: string; body: string } {
  const firmText = cleanText(firmName) || "Your firm";
  const inviter = name(inviterName);
  const invited = inviter ? `${inviter} at ${firmText} invited you to your client portal.` : `${firmText} invited you to your client portal.`;
  return {
    heading: `Your file with ${firmText} is ready`,
    invited,
    body: `${invited} Open your portal to see your first step. ${INVITE_EXPIRY}`,
  };
}

export function renderTemplate<K extends TemplateId>(id: K, context: EmailContexts[K], origin: string): EmailCopy {
  return (EMAIL_TEMPLATES[id] as TemplateDef<EmailContexts[K]>).build(context, origin);
}
