/**
 * Approval without a page capture (decided 2026-10-24, Francis delegated to engineering): when
 * Casevoya's server couldn't read an official page, a licensed reviewer may still approve the entry
 * by attesting "I opened the official page myself on <date> and the entry matches it". The database
 * stores who attested, the date and when (20261025220000_gov_review_attestation_self_approval.sql);
 * the value then shows "page not captured by Casevoya, checked by <reviewer> on <date>" wherever its
 * source shows. Shared by official steps and channel names, issuers and IRCC estimates. Pure.
 *
 * Self-approval (same decision): a licensed member approves their own entry only when the firm has
 * no other active licensed member; the database refuses otherwise.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "24 Oct 2026" from a `YYYY-MM-DD` calendar date. */
function day(isoDate: string): string {
  const [year, month, date] = isoDate.slice(0, 10).split("-").map(Number);
  if (!year || !month || !date) return isoDate;
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

export type Attestation = { page_attested_by_membership_id?: string | null; page_attested_on?: string | null };

/** The checkbox's words in the approve controls. */
export const ATTEST_LABEL = "I opened the official page myself on this date and the entry matches it";

/** Why the attestation is asked for, under the controls. */
export const ATTEST_WHY =
  "Casevoya couldn’t capture this page, so there is no snapshot to compare. Your attestation is kept with your name and the time, and the value shows “page not captured by Casevoya, checked by you on this date”.";

/**
 * "page not captured by Casevoya, checked by Ana Diaz on 24 Oct 2026", or null when the row has no
 * attestation (a captured page, or one not approved yet).
 */
export function attestationNote(row: Attestation, memberName: ((membershipId: string | null) => string) | undefined, format: (isoDate: string) => string = day): string | null {
  if (!row.page_attested_on) return null;
  const who = memberName ? memberName(row.page_attested_by_membership_id ?? null) : "a licensed member";
  return `page not captured by Casevoya, checked by ${who} on ${format(row.page_attested_on)}`;
}

/** The reviewer's attestation as read from the controls: the date, or what's missing. */
export function readAttestation(ticked: boolean, openedOn: string, today: string): { openedOn: string } | { error: string } {
  if (!ticked) return { error: "Tick that you opened the official page yourself and the entry matches it." };
  if (!DATE.test(openedOn)) return { error: "Add the date you opened the official page." };
  if (today && openedOn > today) return { error: "The date you opened the page can’t be in the future." };
  return { openedOn };
}

/**
 * Reads PageAttestFields inside `scope` (the dialog or row with the Approve button). Null when the
 * scope has no attestation fields (the entry has a capture, so none is asked for).
 */
export function readAttestationFrom(scope: ParentNode): { openedOn: string } | { error: string } | null {
  const tick = scope.querySelector<HTMLInputElement>("input[data-attest]");
  const date = scope.querySelector<HTMLInputElement>("input[data-attest-on]");
  if (!tick || !date) return null;
  return readAttestation(tick.checked, date.value.trim(), date.max ?? "");
}

/** The database's refusals for these two rules, in the Sheet's words; null when it isn't one. */
const ERRORS: [RegExp, string][] = [
  [/needs your attestation/, "Casevoya has no capture of this page. Tick that you opened the official page yourself and the entry matches it."],
  [/between the day the entry was made and today/, "The date you opened the page must be between the day the entry was made and today."],
  [/another licensed member/, "You entered this yourself, so another licensed member of the firm approves it."],
];

export function attestationError(message: string): string | null {
  for (const [pattern, copy] of ERRORS) if (pattern.test(message)) return copy;
  return null;
}
