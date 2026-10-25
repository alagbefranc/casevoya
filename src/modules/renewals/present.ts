/**
 * DEC-02 renewal follow-up: plain words for the database's refusals, and the pure pieces the
 * matter's Decisions tab and the client's portal show. Every value comes from the firm's records;
 * a renewal timing or fee is shown only with its official source next to it.
 */
import { formatMoney } from "@/modules/finance/money";
import { attestationError } from "@/modules/government/page-attestation";

const ERRORS: [RegExp, string][] = [
  [/step-up|aal2|recovery code/i, "Confirm it’s you with your authenticator, then try again."],
  [/version conflict/i, "Someone changed this a moment ago. Reload the page and try again."],
  [/approval the consultant confirmed/i, "Expiry reminders follow an approval a licensed consultant has confirmed."],
  [/choose the reminder date/i, "Choose the reminder date. Without an IRCC timing it’s the firm’s choice; no date is set for you."],
  [/on or before the expiry/i, "The reminder must be on or before the expiry date."],
  [/has passed/i, "That reminder date has passed. Choose a date from today."],
  [/official timing sets the reminder on (\d{4}-\d{2}-\d{2})/i, "The IRCC timing sets the reminder date. Leave the date empty, or choose the firm’s own date without the timing."],
  [/states no number of days/i, "That IRCC timing gives no number of days. Choose the date yourself; it’s shown as the firm’s choice."],
  [/only an approved official timing/i, "Only an IRCC timing a licensed consultant approved can set the date."],
  [/another program/i, "That IRCC timing is for another program."],
  [/name the issued document/i, "Name the issued document as it reads, for example the permit or card."],
  [/expiry date shown/i, "Enter the expiry date shown on the issued document."],
  [/stored file on this matter/i, "Choose a stored file on this matter."],
  [/scope of the new service/i, "State the scope of the new service, at least 10 characters."],
  [/approved IRCC fee list/i, "Only a fee from the approved IRCC fee list can be shown to the client."],
  [/already set/i, "A renewal reminder is already set for this expiry."],
  [/sample matter/i, "Renewal reminders are set on real matters, not sample ones."],
  [/is cancelled/i, "This expiry is cancelled."],
  [/why it'?’?s cancelled|say why it.s cancelled/i, "Say why it’s cancelled."],
  [/official Government of Canada page/i, "Use the official page on canada.ca or a gc.ca site."],
  [/section of the page|section anchor/i, "Name the section of the page, or give its link with the section anchor."],
  [/date checked/i, "Enter the date you checked the page: within the last year, not in the future."],
  [/date modified needs/i, "A form’s date modified needs its form number and can’t be in the future."],
  [/current-to date/i, "A “current to” date can’t be in the future."],
  [/word for word/i, "Write the timing word for word, as the official page gives it."],
  [/document or status as the official page/i, "Name the document or status as the official page does."],
  [/days before expiry must be/i, "Days before expiry: a number from 1 to 1095, only when the page states one."],
  [/nothing is waiting/i, "This entry was already reviewed."],
  [/why it'?’?s rejected|say why it.s rejected/i, "Say why it’s rejected."],
  [/why it'?’?s retired|say why it.s retired/i, "Say why it’s retired."],
  [/only an approved timing is retired/i, "Only an approved timing can be retired."],
  [/sample mode/i, "This firm is in sample mode; only sample matters accept new work."],
  [/denied|staff access|licen/i, "You don’t have access to do that on this matter."],
];

/** The database's refusal in plain words. A contact-choice refusal keeps its reason. */
export function renewalError(message: string): string {
  const refused = /renewal reminder refused: (.+)$/i.exec(message);
  if (refused) return `Renewal reminder refused. ${refused[1].trim()}`;
  if (!/step-up|aal2|recovery code/i.test(message)) {
    const attestation = attestationError(message);
    if (attestation) return attestation;
  }
  for (const [pattern, copy] of ERRORS) if (pattern.test(message)) return copy;
  return "That couldn’t be saved.";
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Mar 2027" from a `YYYY-MM-DD` date (calendar date, no time zone shift). */
export function renewalDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return `${day} ${SHORT_MONTHS[month - 1]} ${year}`;
}

/** The calendar date of an instant in the firm's zone. */
export function dayInZone(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** A hash shortened for display: "sha256 1a2b3c4d…". */
export function shortHash(hash: string | null): string | null {
  return hash ? `sha256 ${hash.slice(0, 10)}…` : null;
}

export type TimingSource = {
  source_url: string;
  source_section?: string | null;
  form_number?: string | null;
  form_modified_on?: string | null;
  checked_on: string;
  current_to?: string | null;
  snapshot_sha256: string | null;
  /** Approved without a snapshot: when the reviewer opened the page, and who (a name, already resolved). */
  page_attested_on?: string | null;
  attested_by?: string | null;
};

/**
 * The facts shown next to an official timing: section, form and its date modified, checked, current
 * to, hash; or, approved without a snapshot, "page not captured by Casevoya, checked by <reviewer> on <date>".
 */
export function timingFacts(row: TimingSource): string[] {
  const facts: string[] = [];
  if (row.source_section) facts.push(row.source_section);
  if (row.form_number) facts.push(row.form_modified_on ? `${row.form_number}, date modified ${renewalDate(row.form_modified_on)}` : row.form_number);
  facts.push(`checked ${renewalDate(row.checked_on)}`);
  if (row.current_to) facts.push(`current to ${renewalDate(row.current_to)}`);
  const attested =
    !row.snapshot_sha256 && row.page_attested_on
      ? `page not captured by Casevoya, checked by ${row.attested_by || "a licensed member"} on ${renewalDate(row.page_attested_on)}`
      : null;
  facts.push(shortHash(row.snapshot_sha256) ?? attested ?? "no page snapshot");
  return facts;
}

/** The page link's text: its host and path, without the scheme. */
export function sourceText(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}${parsed.hash}`;
  } catch {
    return url;
  }
}

export type CurrentFee = {
  name: string;
  amount_cents: number;
  currency?: string;
  source_url: string;
  retrieved_at: string;
  snapshot_sha256: string;
};

/** "Synthetic fee: CAD 150.00 (IRCC fee list, retrieved 24 Oct 2026)". Null when there's no approved fee. */
export function feeLine(fee: CurrentFee | null, timeZone: string): string | null {
  if (!fee || typeof fee.amount_cents !== "number") return null;
  return `${fee.name}: ${formatMoney(fee.amount_cents, fee.currency ?? "CAD")} (IRCC fee list, retrieved ${renewalDate(dayInZone(fee.retrieved_at, timeZone))})`;
}

/** The fee approved now under the same section, group and name as the reminder's, or null. */
export function currentFee<T extends { section: string | null; fee_group: string | null; name: string; status: string; reviewed_at: string | null }>(
  rows: T[],
  wanted: { fee_section: string | null; fee_group: string | null; fee_name: string | null },
): T | null {
  if (!wanted.fee_name) return null;
  const matches = rows.filter(
    (row) => row.status === "approved" && row.name === wanted.fee_name && row.section === wanted.fee_section && row.fee_group === wanted.fee_group,
  );
  matches.sort((a, b) => (b.reviewed_at ?? "").localeCompare(a.reviewed_at ?? ""));
  return matches[0] ?? null;
}

/** How the reminder date was set: an approved IRCC timing, or the firm's own choice. */
export function reminderBasis(timing: { timing_text: string; lead_days: number | null } | null): string {
  if (!timing) return "Reminder date chosen by the firm";
  return `Reminder date from IRCC’s timing${timing.lead_days ? ` (${timing.lead_days} days before expiry)` : ""}: “${timing.timing_text}”`;
}

export type PortalRenewalRow = {
  id: string;
  document_label: string;
  expires_on: string;
  remind_on: string;
  service_scope: string | null;
  timing: {
    text: string;
    source_url: string;
    checked_on: string;
    current_to: string | null;
    snapshot_sha256: string | null;
    page_attested_on?: string | null;
    page_attested_by?: string | null;
    /** DES-04 (20261025451000): the timing's status and its official page's freshness. Absent before that migration. */
    status?: string | null;
    source_review?: string | null;
    source_next_review?: string | null;
    source_change?: string | null;
    source_attempt?: string | null;
    source_attempt_at?: string | null;
  } | null;
  fee: CurrentFee | null;
};

export type PortalRenewalView = {
  title: string;
  lines: string[];
  timing: { text: string; href: string; facts: string } | null;
  fee: { text: string; href: string } | null;
  /** DES-04: why the official content shown may be out of date, in the client's words; null while current. */
  stale?: string[] | null;
};

/** A year, as the timing's "date checked" rule counts it (app.propose_renewal_timing: within the last year). */
const YEAR_MS = 366 * 24 * 60 * 60 * 1000;

function olderThanAYear(value: string | null | undefined, now: Date): boolean {
  if (!value) return false;
  const at = new Date(value.length === 10 ? `${value}T00:00:00Z` : value).getTime();
  return Number.isFinite(at) && now.getTime() - at > YEAR_MS;
}

/**
 * DES-04 stale-source: why IRCC's timing or fee on a reminder may no longer be current. Read from the
 * firm's own records (the timing's status, the official page's review and check state from SRC, the
 * dates checked and retrieved); nothing is fetched or guessed. Empty while everything is current.
 */
export function renewalStaleReasons(row: Pick<PortalRenewalRow, "timing" | "fee">, firmName: string, now: Date): string[] {
  const reasons: string[] = [];
  const timing = row.timing;
  if (timing) {
    if (timing.status && timing.status !== "approved") {
      reasons.push(`${firmName} withdrew this IRCC timing after the reminder was set.`);
    } else if (timing.source_review === "suspended") {
      reasons.push("The official page for this timing is suspended from use while it’s reviewed.");
    } else if (timing.source_review === "review_due" || (timing.source_next_review && new Date(timing.source_next_review).getTime() < now.getTime())) {
      reasons.push("The official page for this timing is due for review.");
    }
    if (timing.source_change === "change_detected") reasons.push("The official page has changed since this timing was checked.");
    if (timing.source_attempt === "failed" || timing.source_attempt === "blocked" || timing.source_attempt === "partial") {
      reasons.push("The last check of the official page didn’t complete.");
    }
    if (olderThanAYear(timing.checked_on, now)) reasons.push(`This timing was last checked on ${renewalDate(timing.checked_on)}, more than a year ago.`);
  }
  if (row.fee && olderThanAYear(row.fee.retrieved_at, now)) reasons.push("The fee was taken from the IRCC fee list more than a year ago.");
  return reasons;
}

/** The client's renewal reminders, in their words. Rows that aren't shaped as expected are left out. */
/** `now` turns on the stale-source check (DES-04); the portal's loader always passes it. */
export function portalRenewals(data: unknown, firmName: string, timeZone: string, now?: Date): PortalRenewalView[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw): PortalRenewalView[] => {
    const row = raw as Partial<PortalRenewalRow> | null;
    if (!row || typeof row.document_label !== "string" || typeof row.expires_on !== "string" || typeof row.remind_on !== "string") return [];
    const lines = [
      `Expires ${renewalDate(row.expires_on)}, as shown on your document.`,
      `${firmName} has a reminder to review your renewal on ${renewalDate(row.remind_on)}.`,
    ];
    if (row.service_scope) lines.push(`What ${firmName} would do for the renewal: ${row.service_scope}`);
    lines.push("This is a reminder only. It isn’t an invoice.");
    const fee = feeLine(row.fee ?? null, timeZone);
    return [
      {
        title: `Renewal reminder: ${row.document_label}`,
        lines,
        timing: row.timing
          ? {
              text: `IRCC’s timing: “${row.timing.text}”`,
              href: row.timing.source_url,
              facts: timingFacts({ ...row.timing, snapshot_sha256: row.timing.snapshot_sha256 ?? null, attested_by: row.timing.page_attested_by ?? null }).join(", "),
            }
          : null,
        fee: fee && row.fee ? { text: `Government fee: ${fee}`, href: row.fee.source_url } : null,
        ...(() => {
          const reasons = now ? renewalStaleReasons({ timing: row.timing ?? null, fee: fee ? (row.fee ?? null) : null }, firmName, now) : [];
          return reasons.length ? { stale: reasons } : {};
        })(),
      },
    ];
  });
}
