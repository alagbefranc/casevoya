import {
  INVITE_EXPIRY,
  PATHS,
  clientInviteLines,
  renderTemplate,
  type TemplateId,
} from "@/modules/email/designs/catalog";
import { DEFAULT_EMAIL_ORIGIN, appLink, cleanText, emailOrigin, renderCopy, safeUrl } from "@/modules/email/designs/layout";

export { INVITE_WITHOUT_LINK } from "@/modules/email/designs/catalog";

export type EmailContent = { subject: string; preheader: string; html: string; text: string; design: string };

type Context = Record<string, unknown>;

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
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

/** Which approved design a queued delivery uses, from its database template and context. */
export function designFor(context: Context): TemplateId | "generic" {
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
    default:
      return "generic";
  }
}

/**
 * HTML, text, subject and preheader for one queued delivery. Copy stays generic: no file body, no
 * case narrative, no document name, no amount. Links are built from the app origin and fixed
 * paths; the only link taken from the context is an invitation's private link that the mail
 * worker opened from its sealed form (context.link). Without it the invitation says the link is
 * not in the email.
 */
export function renderEmail(context: Context, options: { origin?: string } = {}): EmailContent {
  const origin = emailOrigin(options.origin ?? DEFAULT_EMAIL_ORIGIN);
  const firm = firmName(context);
  const design = designFor(context);
  const link = inviteHref(context.link);
  const due = textOf(context.due_on) || null;
  let copy;
  switch (design) {
    case "EM01":
      copy = renderTemplate("EM01", { firmName: firm, inviterName: textOf(context.inviter), role: textOf(context.role), acceptUrl: link }, origin);
      break;
    case "EM02":
      copy = renderTemplate("EM02", { firmName: firm, inviterName: textOf(context.inviter), acceptUrl: link }, origin);
      break;
    case "EX04":
      copy = renderTemplate("EX04", { firmName: firm, acceptUrl: link }, origin);
      break;
    case "EM07":
      copy = renderTemplate("EM07", { firmName: firm, dueOn: due }, origin);
      break;
    case "EM08":
      copy = renderTemplate("EM08", { firmName: firm, agreementKind: textOf(context.agreement_kind) }, origin);
      break;
    case "EM06":
      copy = renderTemplate("EM06", { firmName: firm, dueOn: due }, origin);
      break;
    case "EM10":
      copy = renderTemplate(
        "EM10",
        { firmName: firm, invoiceId: textOf(context.invoice_id), invoiceNumber: textOf(context.invoice_number), dueOn: due },
        origin,
      );
      break;
    case "EX08":
      copy = renderTemplate("EX08", { firmName: firm, invoiceId: textOf(context.invoice_id), invoiceNumber: textOf(context.invoice_number) }, origin);
      break;
    case "EM11":
      copy = renderTemplate("EM11", { firmName: firm, receiptNumber: textOf(context.receipt_number), advance: context.advance === true }, origin);
      break;
    case "EM16a":
      copy = renderTemplate(
        "EM16a",
        { firmName: firm, startsAt: textOf(context.starts_at) || null, timeZone: textOf(context.time_zone) || null, consultantName: textOf(context.consultant_name) || null },
        origin,
      );
      break;
    case "EM16b":
    case "EM16c":
      copy = renderTemplate(design, { firmName: firm, startsAt: textOf(context.starts_at) || null, timeZone: textOf(context.time_zone) || null }, origin);
      break;
    case "EM08-staff":
    case "EM09":
    case "EM09-staff":
    case "EX06":
    case "EX06-received":
    case "EX09":
    case "EX10":
      copy = renderTemplate(design, { firmName: firm }, origin);
      break;
    default:
      copy = renderTemplate("EX07", { firmName: firm }, origin);
      copy = {
        ...copy,
        subject: `An update from ${firm}`,
        preheader: "The details are in your portal.",
        heading: "There’s an update on your file",
        body: `${firm} has an update for you. For your privacy, the details are in your portal.`,
        cta: { label: "Open your portal", href: appLink(origin, PATHS.portal) ?? "" },
      };
  }
  const rendered = renderCopy(copy, origin);
  return { ...rendered, design };
}
