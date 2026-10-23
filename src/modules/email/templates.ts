import {
  INVITE_EXPIRY,
  PATHS,
  clientInviteLines,
  renderTemplate,
  type EmailContexts,
} from "@/modules/email/designs/catalog";
import { chooseEmailLanguage } from "@/modules/email/designs/french";
import { DEFAULT_EMAIL_ORIGIN, appLink, cleanText, emailOrigin, renderCopy, safeUrl, type EmailCopy } from "@/modules/email/designs/layout";
import { buildLocalized } from "@/modules/email/designs/localized";

export { INVITE_WITHOUT_LINK } from "@/modules/email/designs/catalog";

export type EmailContent = { subject: string; preheader: string; html: string; text: string; design: string; lang: "en" | "fr" };

type Context = Record<string, unknown>;

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A whole number of minutes from the delivery context, or null (the design then says "support access"). */
function minutesOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function firmName(context: Context): string {
  return cleanText(context.firm) || "Your firm";
}

/**
 * The invitation email's copy in two parts, a bold lead and the rest. The staff screens preview
 * exactly this before an invitation is sent (the sent email adds the inviter's name when known).
 */
export function inviteEmailLines(firm: string, kind: "staff" | "portal"): { lead: string; rest: string } {
  const name = cleanText(firm) || "Your firm";
  if (kind === "staff") {
    return {
      lead: `You’re invited to join ${name}.`,
      rest: `Set a password and two-step sign-in to join. ${INVITE_EXPIRY}`,
    };
  }
  const lines = clientInviteLines(name);
  return { lead: `${lines.heading}.`, rest: lines.body };
}

/** The Sheet page a staff signer opens to countersign. The renderer joins it to the app origin. */
export const COUNTERSIGN_PATH = PATHS.sheetAgreements;

/** An absolute http(s) invitation link opened by the mail worker, or null. Nothing else is ever put in an email. */
function inviteHref(value: unknown): string | null {
  const text = textOf(value).trim();
  if (!text || text.length > 600) return null;
  return safeUrl(text);
}

/** The designs a database template can map to (the mail worker sends only these). */
type Wired =
  | "EM01"
  | "EM02"
  | "EX04"
  | "EM06"
  | "EM07"
  | "EM08"
  | "EM08-staff"
  | "EM09"
  | "EM09-staff"
  | "EX06"
  | "EX06-received"
  | "EM10"
  | "EX08"
  | "EX09"
  | "EX10"
  | "EM11"
  | "EM16a"
  | "EM16b"
  | "EM16c"
  | "EX07"
  | "EX15"
  | "EX16"
  | "EX11"
  | "EM17";

/** Which approved design a queued delivery uses, from its database template and context. */
export function designFor(context: Context): Wired | "generic" {
  const template = textOf(context.template);
  const staff = textOf(context.audience) === "staff";
  switch (template) {
    case "invite":
      if (textOf(context.kind) === "staff") return "EM01";
      return textOf(context.role) === "adult_dependant" ? "EX04" : "EM02";
    case "reminder":
      return "EM07";
    case "agreement":
      return staff ? "EM08-staff" : "EM08";
    case "signature":
      return staff ? "EM09-staff" : "EM09";
    case "document_request":
      return "EM06";
    case "document_receipt":
      return textOf(context.status) === "accepted" ? "EX06" : "EX06-received";
    case "invoice":
      return "EM10";
    case "payment_failed":
      return "EX08";
    case "refund_started":
      return "EX09";
    case "refund_complete":
      return "EX10";
    // Hook for the receipts work (EM11): needs the email_template value 'payment_receipt' and an
    // outbox event that queues it with receipt_number (and advance: true for client funds).
    case "payment_receipt":
      return "EM11";
    // Scheduling (20261019180200_scheduling_mail.sql): booked, moved, cancelled by the firm.
    case "consultation_booked":
      return "EM16a";
    case "consultation_rescheduled":
      return "EM16b";
    case "consultation_cancelled":
      return "EM16c";
    // Matter messaging (20261019203100_matter_messaging.sql): a staff message. Firm name only.
    case "message":
      return "EX07";
    // Inbox replies (20261019215100_inbox_reply_emails.sql): a staff member's own email.
    case "staff_message":
      return "EX15";
    // Support access (20261020170200_support_access_mail.sql): to the firm's owners.
    case "support_requested":
      return "EX11";
    case "support_granted":
      return "EM17";
    // Signing flow (20261023230100): the six-digit code the worker opened from its sealed form.
    case "signing_code":
      return "EX16";
    default:
      return "generic";
  }
}

/** The typed merge context of a wired design, from the delivery context. */
function contextFor(design: Wired, context: Context, firm: string): EmailContexts[Wired] {
  const link = inviteHref(context.link);
  const due = textOf(context.due_on) || null;
  switch (design) {
    case "EM01":
      return { firmName: firm, inviterName: textOf(context.inviter), role: textOf(context.role), acceptUrl: link };
    case "EM02":
      return { firmName: firm, inviterName: textOf(context.inviter), acceptUrl: link };
    case "EX04":
      return { firmName: firm, acceptUrl: link };
    case "EM06":
    case "EM07":
      return { firmName: firm, dueOn: due };
    case "EM08":
      return { firmName: firm, agreementKind: textOf(context.agreement_kind), signingRef: textOf(context.signing_ref) || null };
    case "EM10":
      return { firmName: firm, invoiceId: textOf(context.invoice_id), invoiceNumber: textOf(context.invoice_number), dueOn: due };
    case "EX08":
      return { firmName: firm, invoiceId: textOf(context.invoice_id), invoiceNumber: textOf(context.invoice_number) };
    case "EM11":
      return { firmName: firm, receiptNumber: textOf(context.receipt_number), advance: context.advance === true };
    case "EM16a":
      return {
        firmName: firm,
        startsAt: textOf(context.starts_at) || null,
        timeZone: textOf(context.time_zone) || null,
        consultantName: textOf(context.consultant_name) || null,
        portal: context.portal === true,
        locationKind: textOf(context.location_kind) || null,
        address: textOf(context.address) || null,
      };
    // The portal button only when the database says the attendee has a portal login.
    case "EM16b":
      return { firmName: firm, startsAt: textOf(context.starts_at) || null, timeZone: textOf(context.time_zone) || null, portal: context.portal === true };
    case "EM16c":
      return {
        firmName: firm,
        startsAt: textOf(context.starts_at) || null,
        timeZone: textOf(context.time_zone) || null,
        portal: context.portal === true,
        bookingPage: textOf(context.booking_page) || null,
        // Portal appointments: the attendee cancelled from their portal; anything else is the firm.
        cancelledBy: textOf(context.cancelled_by) === "client" ? "client" : "staff",
      };
    case "EM08-staff":
    case "EM09":
    case "EM09-staff":
    case "EX06":
    case "EX06-received":
    case "EX09":
    case "EX10":
    case "EX07":
      return { firmName: firm };
    case "EX16":
      return { firmName: firm, code: textOf(context.code) || null };
    // Support access: minutes asked for; on approval the approver, the minutes, the end and the firm's zone.
    case "EX11":
      return { firmName: firm, minutes: minutesOf(context.minutes) };
    case "EM17":
      return {
        firmName: firm,
        approverName: textOf(context.approver) || null,
        minutes: minutesOf(context.minutes),
        endsAt: textOf(context.ends_at) || null,
        timeZone: textOf(context.time_zone) || null,
      };
    // The text and subject come with the message (never the delivery context); see dispatch.ts.
    case "EX15":
      return {
        firmName: firm,
        senderName: textOf(context.sender) || null,
        body: textOf(context.body),
        subject: textOf(context.subject) || null,
        portal: context.portal === true,
      };
  }
}

/** The approved English generic notice, for a database template the renderer does not know. */
function genericEnglish(firm: string, origin: string): EmailCopy {
  const copy = renderTemplate("EX07", { firmName: firm }, origin);
  return {
    ...copy,
    subject: `An update from ${firm}`,
    preheader: "The details are in your portal.",
    heading: "There’s an update on your file",
    body: `${firm} has an update for you. For your privacy, the details are in your portal.`,
    cta: { label: "Open your portal", href: appLink(origin, PATHS.portal) ?? "" },
  };
}

/**
 * HTML, text, subject and preheader for one queued delivery. Copy stays generic: no file body, no
 * case narrative, no document name, no amount. The one exception is EX15, a staff member's own
 * email from the Sheet Inbox: its body is their text as written (context.body, put there by the
 * mail worker from the prepared message), escaped, with no links made from it. Links are built from the app origin and fixed
 * paths; the only link taken from the context is an invitation's private link that the mail
 * worker opened from its sealed form (context.link). Without it the invitation says the link is
 * not in the email. (A cancelled consultation may link to /book/<firm slug>: the path is fixed and
 * the slug, context.booking_page, must match the firm slug pattern.)
 *
 * Language: context.locale is the recipient's stored preference (prepare-time, see
 * email_delivery_locales). French is used only when the recipient prefers it AND the template's
 * French is approved in fr-drafts.json (designs/french.ts); otherwise the approved English.
 */
export function renderEmail(context: Context, options: { origin?: string } = {}): EmailContent {
  const origin = emailOrigin(options.origin ?? DEFAULT_EMAIL_ORIGIN);
  const firm = firmName(context);
  const design = designFor(context);
  // EX15 is the staff member's own words, sent as written (English shell; no French string table).
  const lang = design === "EX15" ? "en" : chooseEmailLanguage(design, context.locale);
  let copy: EmailCopy;
  if (design === "generic") {
    copy = lang === "fr" ? buildLocalized("generic", "fr", { firmName: firm }, origin) : genericEnglish(firm, origin);
  } else if (design === "EX15") {
    copy = renderTemplate("EX15", contextFor("EX15", context, firm) as EmailContexts["EX15"], origin);
  } else {
    const typed = contextFor(design, context, firm);
    copy = lang === "fr" ? buildLocalized(design, "fr", typed as never, origin) : renderTemplate(design, typed as never, origin);
  }
  const rendered = renderCopy(copy, origin);
  return { ...rendered, design, lang };
}
