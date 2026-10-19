/**
 * Pure helpers for the Sheet's Inbox page (OPS-06): who an email to triage might belong to,
 * the buttons that file it, and the words for delivery problems. Matching on an email
 * address is only ever a suggestion: staff confirm it, and filing never gives the sender
 * portal access.
 */
import type { InboxChip, InboxTab, Text2, TriageAction, TriageAttachment } from "@/components/sheet/designer/inbox";
import { dayMonth } from "@/modules/sheet/home-present";
import { isoDateInTimeZone, plusDays } from "@/modules/sheet/present";

export function inboxTab(raw: string | undefined): InboxTab {
  return raw === "triage" || raw === "bounced" || raw === "notes" ? raw : "conv";
}

const TEMPLATE_LABEL: Record<string, string> = {
  invite: "Portal invitation",
  reminder: "Deadline reminder",
  agreement: "Agreement to sign",
  signature: "Signed agreement",
  document_request: "Document request",
  document_receipt: "Document received",
  invoice: "Invoice issued",
  payment_failed: "Payment failed",
  refund_started: "Refund started",
  refund_complete: "Refund complete",
  consultation_booked: "Consultation booked",
  consultation_rescheduled: "Consultation moved",
  consultation_cancelled: "Consultation cancelled",
  message: "New message notice",
  staff_message: "Email from staff",
  support_requested: "Support access requested",
  support_granted: "Support access granted",
};

export function templateLabel(template: string): string {
  return TEMPLATE_LABEL[template] ?? "Notice";
}

export function noticeLabel(template: string, critical: boolean): string {
  return `${templateLabel(template)}${critical ? " (critical)" : ""}`;
}

/** What counts as a delivery problem, everywhere it is counted: the Inbox pill and the Delivery problems tab. */
export const DELIVERY_PROBLEM_STATUSES = ["bounced", "suppressed", "failed"] as const;
export const DELIVERY_PROBLEM_DAYS = 60;

export function deliveryProblemsSince(now: Date): string {
  return new Date(now.getTime() - DELIVERY_PROBLEM_DAYS * 86_400_000).toISOString();
}

export function deliveryProblemsPill(count: number): string {
  return `${count} delivery ${count === 1 ? "problem" : "problems"}`;
}

export function deliveryProblem(status: string, attempts: number): Text2 {
  if (status === "bounced") return "Address bounced";
  if (status === "suppressed") return "On the do-not-send list";
  return ["Sending failed", `${attempts} attempt${attempts === 1 ? "" : "s"}`];
}

export function deliveryState(status: string): InboxChip {
  if (status === "bounced") return { tone: "bad", label: "Not delivered" };
  if (status === "suppressed") return { tone: "bad", label: "Not sent" };
  return { tone: "bad", label: "Failed" };
}

/** The Designer's state previews for a file that can't be shown, or none. */
export function attachmentImage(uploadState: string, mediaType: string | null): string | null {
  if (uploadState === "quarantined" || uploadState === "failed") return "preview-quarantined";
  if (uploadState === "uploading") return "preview-checking";
  if (mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "fallback-docx";
  if (mediaType === "image/heic") return "fallback-heic";
  return null;
}

export function attachment(filename: string, uploadState: string, mediaType: string | null): TriageAttachment {
  return { label: "Attachment", name: filename, image: attachmentImage(uploadState, mediaType) };
}

export type Candidate = { personId: string; name: string; matterId: string; matter: string; email: string | null };

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** At most this many people get a button on one email. */
export const MAX_CANDIDATES = 4;

export type Suggestion = { suggestion: Text2; why: Text2; actions: TriageAction[] };

/**
 * What the Suggested match, Why and Action cells show for one email to triage.
 * `addressMatter` is the matter its reply address named (if the caller can read it), with the
 * people on it; otherwise `byEmail` holds people elsewhere in the firm with the sender's address.
 */
export function suggest(input: {
  emailId: string;
  organizationId: string;
  from: string;
  ready: boolean;
  addressMatter: { id: string; label: string; people: Candidate[] } | null;
  byEmail: Candidate[];
}): Suggestion {
  const from = input.from.trim().toLowerCase();
  const dismiss: TriageAction = { label: "Not case mail", attrs: { "data-inbox-dismiss": input.emailId, "data-org": input.organizationId } };
  const file = (candidate: Candidate, label: string, primary: boolean): TriageAction => ({
    label,
    primary,
    attrs: {
      "data-inbox-file": input.emailId,
      "data-org": input.organizationId,
      "data-matter": candidate.matterId,
      "data-person": candidate.personId,
      "data-name": candidate.name,
    },
  });
  if (!input.ready) return { suggestion: "Still arriving", why: "Attachments are being checked", actions: [] };

  if (input.addressMatter) {
    const people = input.addressMatter.people;
    const match = people.filter((person) => person.email && person.email.toLowerCase() === from);
    if (match.length === 1) {
      const others = people.filter((person) => person.personId !== match[0].personId).slice(0, MAX_CANDIDATES - 1);
      return {
        suggestion: [input.addressMatter.label, match[0].name],
        why: ["Sent to this matter’s reply address", "email matches, sender not verified"],
        actions: [file(match[0], "Confirm match", true), ...others.map((person) => file(person, firstName(person.name), false)), dismiss],
      };
    }
    return {
      suggestion: input.addressMatter.label,
      why: people.length ? ["Sent to this matter’s reply address", "choose who sent it"] : "Sent to this matter’s reply address",
      actions: [...people.slice(0, MAX_CANDIDATES).map((person) => file(person, firstName(person.name), false)), dismiss],
    };
  }

  const candidates = input.byEmail.slice(0, MAX_CANDIDATES);
  if (candidates.length === 1) {
    return {
      suggestion: [candidates[0].matter, candidates[0].name],
      why: ["Email matches a client", "sender not verified"],
      actions: [file(candidates[0], "Confirm match", true), dismiss],
    };
  }
  if (candidates.length > 1) {
    const people = new Set(input.byEmail.map((candidate) => candidate.personId)).size;
    return {
      suggestion: people > 1 ? `${people} possible people` : `${input.byEmail.length} possible matters`,
      why: people > 1 ? ["Shared email", "can’t match on email alone"] : ["Email matches a client", "on more than one matter"],
      actions: [...candidates.map((candidate) => file(candidate, `${firstName(candidate.name)}, ${candidate.matter}`, false)), dismiss],
    };
  }
  return { suggestion: "No match", why: "—", actions: [dismiss] };
}

function time(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** The conversation list's time: "08:41" today, "Yesterday", otherwise "16 Oct". */
export function listWhen(iso: string, timeZone: string, today: string): string {
  const date = new Date(iso);
  const day = isoDateInTimeZone(date, timeZone);
  if (day === today) return time(date, timeZone);
  if (day === plusDays(today, -1)) return "Yesterday";
  return dayMonth(day);
}

/** A message's time: "today 08:41", otherwise "16 Oct 08:41". */
export function mailWhen(iso: string, timeZone: string, today: string): string {
  const date = new Date(iso);
  const day = isoDateInTimeZone(date, timeZone);
  return `${day === today ? "today" : dayMonth(day)} ${time(date, timeZone)}`;
}

/** "17 Oct 07:02". */
export function sentWhen(iso: string, timeZone: string): string {
  const date = new Date(iso);
  return `${dayMonth(isoDateInTimeZone(date, timeZone))} ${time(date, timeZone)}`;
}

/** The first line of an email, for the conversation list. */
export function snippet(subject: string | null, body: string | null): string {
  const text = (body ?? "").replace(/\s+/g, " ").trim() || (subject ?? "").trim();
  if (!text) return "(no text)";
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

const ROLE_LABEL: Record<string, string> = {
  applicant: "Applicant",
  sponsor: "Sponsor",
  dependant: "Dependant",
  guardian: "Guardian",
  employer: "Employer",
  representative: "Representative",
};

export function partyRoleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  return ROLE_LABEL[role] ?? role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, " ");
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
