/**
 * Dates and labels for Compliance (privacy requests and complaints). Pure; used by the loaders,
 * the client acts and the tests. Calendar dates are `YYYY-MM-DD`; timestamps are shown as the
 * firm's local date.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(date: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** "12 Oct" */
export function dayMonth(date: string): string {
  const p = parts(date);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]}` : date;
}

/** "11 Nov 2026" */
export function dayMonthYear(date: string): string {
  const p = parts(date);
  return p ? `${p[2]} ${MONTHS[p[1] - 1]} ${p[0]}` : date;
}

/** "17/10/2026", as the Designer's Received field shows it. */
export function dmy(date: string): string {
  const p = parts(date);
  return p ? `${String(p[2]).padStart(2, "0")}/${String(p[1]).padStart(2, "0")}/${p[0]}` : "";
}

/** The firm's calendar date of an instant. */
export function localDate(at: string | Date, timeZone: string): string {
  const date = typeof at === "string" ? new Date(at) : at;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Reads "17/10/2026" (or "2026-10-17") into a real calendar date, or null. */
export function readDate(value: string): string | null {
  const text = value.trim();
  let year: number;
  let month: number;
  let day: number;
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dm) [day, month, year] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  else if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Days from `from` to `to` (calendar dates). */
export function daysBetween(from: string, to: string): number {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000);
}

/** A whole number of days in [min, max], blank for none, or an error. */
export function readDays(value: string, min: number, max: number): { days: number | null } | { error: string } {
  const text = value.trim();
  if (!text) return { days: null };
  if (!/^\d+$/.test(text)) return { error: "Enter a whole number of days, or leave it blank." };
  const days = Number(text);
  if (days < min || days > max) return { error: `Enter between ${min} and ${max} days, or leave it blank.` };
  return { days };
}

export const KIND_LABEL: Record<string, string> = {
  access: "Access to their records",
  correction: "Correction",
  consent_withdrawal: "Withdraw a consent",
  deletion: "Deletion request",
};

export const CHANNEL_LABEL: Record<string, string> = {
  email: "email",
  phone: "phone",
  letter: "letter",
  in_person: "in person",
  portal: "portal message",
  other: "another channel",
};

export const OUTCOME_LABEL: Record<string, string> = {
  fulfilled: "Done",
  partly_fulfilled: "Partly done",
  refused: "Refused",
  withdrawn: "Withdrawn",
};

export const CATEGORY_LABEL: Record<string, string> = {
  fees_billing: "Fees or billing",
  communication: "Communication",
  service_quality: "Quality of service",
  conduct: "Professional conduct",
  privacy: "Privacy",
  other: "Other",
};

export const CONSENT_LABEL: Record<string, string> = {
  portal_terms: "Portal terms of use",
  privacy_notice: "Privacy notice",
  processing: "Processing their information",
  contact_email: "Email contact",
  contact_sms: "Text messages",
  deadline_reminder: "Deadline reminders",
  share_section: "Sharing a section",
  ai_drafting: "AI drafting",
  participation_declined: "Declined to take part",
  electronic_signature: "Electronic signature",
};

export const REDACTION_LABEL: Record<string, { tone: string; label: string }> = {
  to_do: { tone: "chg", label: "To do" },
  redacted: { tone: "ok", label: "Redacted" },
  excluded: { tone: "ok", label: "Excluded" },
  kept: { tone: "blue", label: "Kept, reviewed" },
};

/** Database refusals in plain words. Anything unknown stays generic. */
export function complianceError(message: string): string {
  const known: [RegExp, string][] = [
    [/firm owner step-up/i, "Confirm with your authenticator, passkey, or a recovery code, then try again."],
    [/step-up is required/i, "Confirm with your authenticator, passkey, or a recovery code, then try again."],
    [/never deleted here/i, "Casevoya never deletes records here. Refuse the deletion with a reason, or record it withdrawn."],
    [/needs a reason/i, "Give the reason for refusing."],
    [/verify identity and record the review first/i, "Check who they are and record the review before closing it as done."],
    [/record the evidence/i, "Record the evidence of what was done."],
    [/verify identity first/i, "Check who they are first."],
    [/record the scope search first/i, "Record the scope search first."],
    [/finish the redaction step first/i, "Finish the redaction step first."],
    [/finish every line/i, "Finish every line of the redaction worklist first."],
    [/worklist is closed/i, "The redaction worklist is closed."],
    [/already recorded/i, "That step is already recorded. Refresh the page."],
    [/this request is closed/i, "This request is already closed. Refresh the page."],
    [/this complaint is resolved/i, "This complaint is already resolved. Refresh the page."],
    [/isn't this person's/i, "That consent belongs to someone else."],
    [/isn't active/i, "That consent is already withdrawn."],
    [/only by a fulfilled withdrawal/i, "A consent is withdrawn only when a withdrawal request is closed as done."],
    [/received date can't be in the future/i, "The received date can’t be in the future."],
    [/too far in the past/i, "The received date is too far in the past."],
    [/between the received date and today/i, "Use a date between the received date and today."],
    [/acknowledgement first/i, "Record the acknowledgement first."],
    [/record the review first/i, "Record the review first."],
    [/record the response first/i, "Record the response first."],
    [/choose a complaint handler/i, "Choose the firm owner or a designated complaint handler."],
    [/choose who handles the request/i, "Choose who handles the request."],
    [/handlers must be active staff/i, "Choose active staff members of your firm."],
    [/requester's name|complainant's name/i, "Enter the person’s name."],
    [/describe the (request|issue)/i, "Describe it in 3 to 2,000 characters."],
    [/add a note|list the evidence|summarize the response|record the resolution/i, "Add a note of 3 to 2,000 characters."],
    [/between 1 and/i, "Enter a number of days in the allowed range."],
    [/escalation path/i, "Write the escalation path in 3 to 2,000 characters."],
    [/access denied/i, "You don’t have access to that."],
    [/aal2/i, "Confirm your authenticator app before continuing."],
  ];
  for (const [pattern, text] of known) if (pattern.test(message)) return text;
  return "That action could not be completed.";
}

export const STEP_UP_MESSAGE = "Confirm with your authenticator, passkey, or a recovery code, then try again.";
