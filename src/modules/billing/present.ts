/**
 * Pure helpers for FIN-06 billing: time amounts and their rounding, durations, tax rates,
 * write-offs, government fee lines, ageing buckets and the refusals in the firm's words. Money is
 * integer cents (CAD). The database computes the real amounts (app.time_amount_cents,
 * app.tax_amount_cents); these mirror them for what the page previews.
 */
import { formatMoney, parseAmount } from "@/modules/finance/money";
import { safeAccessError } from "@/lib/auth/step-up";

/**
 * A time line's amount: minutes x cents per hour / 60, rounded half away from zero to whole cents
 * (Postgres `round(numeric)`). 90 min at 15000 c/h is 22500 c ($225.00); 7 min at 10000 c/h is 1167 c.
 */
export function timeAmountCents(minutes: number, rateCents: number): number {
  return Math.round((minutes * rateCents) / 60);
}

/** Tax on a line: amount x percent / 100, rounded half away from zero to whole cents. */
export function taxCents(amountCents: number, ratePercent: number): number {
  // Percent has at most four decimals: scale to integers so 9.975% stays exact.
  const scaled = Math.round(ratePercent * 10_000);
  return Math.round((amountCents * scaled) / 1_000_000);
}

/** "1 h 30 min", "45 min", "2 h". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

/** "CAD 150.00/h". */
export function rateLabel(rateCents: number, currency = "CAD"): string {
  return `${formatMoney(rateCents, currency)}/h`;
}

/** "13", "9.975", "5.0" into a percent with at most four decimals (0 to 100), or null. */
export function parseRatePercent(text: string): number | null {
  const cleaned = text.trim().replace(/\s|%/g, "");
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value >= 0 && value <= 100 ? value : null;
}

/** "13%" or "9.975%". */
export function percentLabel(value: number | string): string {
  const text = String(Number(value));
  return `${text}%`;
}

/** "1:30", "90", "1.5h" into whole minutes (1 to 1440), or null. */
export function parseMinutes(text: string): number | null {
  const value = text.trim().toLowerCase();
  let minutes: number | null = null;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{1,2}):([0-5]\d)$/.exec(value))) minutes = Number(match[1]) * 60 + Number(match[2]);
  else if ((match = /^(\d{1,4})\s*(m|min|mins|minutes)?$/.exec(value))) minutes = Number(match[1]);
  else if ((match = /^(\d{1,2}(?:\.\d{1,2})?)\s*(h|hr|hrs|hours)$/.exec(value))) minutes = Math.round(Number(match[1]) * 60);
  return minutes !== null && minutes >= 1 && minutes <= 1440 ? minutes : null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export type TimeFields = { matter: string; date: string; minutes: string; rate: string; description: string; billable: boolean };

export function readTimeEntry(
  fields: TimeFields,
  today: string,
): { input: { matterId: string; workedOn: string; minutes: number; rateCents: number; description: string; billable: boolean } } | { error: string } {
  if (!fields.matter) return { error: "Choose a matter." };
  if (!ISO.test(fields.date)) return { error: "Choose the date of the work." };
  if (fields.date > today) return { error: "The date can’t be in the future." };
  const minutes = parseMinutes(fields.minutes);
  if (minutes === null) return { error: "Enter the time as minutes (90) or hours and minutes (1:30), up to 24 hours." };
  const rate = readRate(fields.rate);
  if ("error" in rate) return rate;
  const description = fields.description.trim();
  if (!description || description.length > 500) return { error: "Say what the time was for (up to 500 characters)." };
  return { input: { matterId: fields.matter, workedOn: fields.date, minutes, rateCents: rate.cents, description, billable: fields.billable } };
}

export function readRate(text: string): { cents: number } | { error: string } {
  const trimmed = text.trim();
  if (/^0+(\.0{1,2})?$/.test(trimmed)) return { cents: 0 };
  const cents = parseAmount(trimmed, "CAD");
  if (cents === null || cents > 10_000_000) return { error: "Enter the hourly rate in CAD, like 150.00." };
  return { cents };
}

export type TaxRateFields = { name: string; rate: string; from: string; to: string; approvedBy: string; note: string };

export function readTaxRate(
  fields: TaxRateFields,
): { input: { name: string; ratePercent: number; from: string; to: string | null; approvedBy: string; note: string | null } } | { error: string } {
  const name = fields.name.trim();
  if (!name || name.length > 80) return { error: "Name the tax, like HST Ontario." };
  const ratePercent = parseRatePercent(fields.rate);
  if (ratePercent === null) return { error: "Enter the rate as a percent between 0 and 100, up to four decimals." };
  if (!ISO.test(fields.from)) return { error: "Choose the date the rate starts." };
  const to = fields.to.trim();
  if (to && (!ISO.test(to) || to < fields.from)) return { error: "The end date must be on or after the start date." };
  const approvedBy = fields.approvedBy.trim();
  if (approvedBy.length < 2 || approvedBy.length > 200) return { error: "Say who approved this rate: the firm or its accountant." };
  const note = fields.note.trim();
  if (note && (note.length < 3 || note.length > 500)) return { error: "The source note is too short or too long." };
  return { input: { name, ratePercent, from: fields.from, to: to || null, approvedBy, note: note || null } };
}

export function readWriteOff(fields: { amount: string; reason: string }, maxCents: number | null): { input: { amountCents: number; reason: string } } | { error: string } {
  const amountCents = parseAmount(fields.amount, "CAD");
  if (amountCents === null) return { error: "Enter an amount above zero." };
  if (maxCents !== null && amountCents > maxCents) return { error: `That’s more than the ${formatMoney(maxCents, "CAD")} still owed.` };
  const reason = fields.reason.trim();
  if (reason.length < 3 || reason.length > 500) return { error: "Say why it’s written off." };
  return { input: { amountCents, reason } };
}

/** Hosts a typed government fee's source may be on: Government of Canada pages (canada.ca and its subdomains, https). */
export function isOfficialFeeUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && !parsed.port && !parsed.username && (host === "canada.ca" || host.endsWith(".canada.ca"));
  } catch {
    return false;
  }
}

export type GovernmentFeeFields = { reference: string; name: string; amount: string; url: string; checked: string };

export function readGovernmentFee(
  fields: GovernmentFeeFields,
  today: string,
): { input: { referenceId: string | null; name: string | null; amountCents: number | null; url: string | null; checkedOn: string | null } } | { error: string } {
  if (fields.reference) return { input: { referenceId: fields.reference, name: null, amountCents: null, url: null, checkedOn: null } };
  const name = fields.name.trim();
  if (name.length < 3 || name.length > 300) return { error: "Name the government fee as the official page does." };
  const amountCents = parseAmount(fields.amount, "CAD");
  if (amountCents === null) return { error: "Enter the fee amount in CAD." };
  if (!isOfficialFeeUrl(fields.url)) return { error: "The source must be an official Government of Canada page (https://…canada.ca)." };
  if (!ISO.test(fields.checked) || fields.checked > today) return { error: "Say when you checked the source (not in the future)." };
  return { input: { referenceId: null, name, amountCents, url: fields.url.trim(), checkedOn: fields.checked } };
}

// ---------------------------------------------------------------------------
// Invoice state, with drafts discarded and balances written off
// ---------------------------------------------------------------------------

type InvoiceStateLike = { tone: "blue" | "ok" | "unv" | "chg" | "bad" | "rev" | "gr"; label: string; flag: string; detail?: string };

/**
 * finance-present's invoiceState, told about FIN-06: a discarded draft says so, an invoice closed by
 * a write-off says "Written off" (not "Credited"), and an open one says how much was written off.
 */
export function billingInvoiceState<T extends InvoiceStateLike>(
  row: { status: string; currency: string; credited_cents: number; written_off_cents?: number | null; discarded_at?: string | null },
  state: T,
): T {
  const writtenOff = row.written_off_cents ?? 0;
  if (row.discarded_at) return { ...state, tone: "gr", label: "Discarded draft", flag: "closed", detail: undefined };
  if (row.status === "credited" && writtenOff > 0 && writtenOff >= row.credited_cents) return { ...state, label: "Written off", detail: undefined };
  if (writtenOff > 0 && !state.detail && (row.status === "issued" || row.status === "partially_paid" || row.status === "paid" || row.status === "credited")) {
    return { ...state, detail: `${formatMoney(writtenOff, row.currency)} written off` };
  }
  return state;
}

// ---------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------

export const AGEING_BUCKETS = ["Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;

export type AgeingInvoice = { status: string; currency: string; amount_cents: number; paid_cents: number; credited_cents: number; due_on: string; is_sample?: boolean };

function days(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** Which bucket an open invoice sits in: by days past its due date, counted on the firm's today. */
export function ageingBucket(dueOn: string, today: string): number {
  const late = dueOn >= today ? 0 : days(dueOn, today);
  if (late === 0) return 0;
  if (late <= 30) return 1;
  if (late <= 60) return 2;
  if (late <= 90) return 3;
  return 4;
}

/** Open CAD invoices (issued or partly paid, something still owed) by days past due. */
export function invoiceAgeing(invoices: readonly AgeingInvoice[], today: string) {
  const rows = AGEING_BUCKETS.map((label) => ({ label, invoices: 0, cents: 0 }));
  for (const invoice of invoices) {
    if (invoice.status !== "issued" && invoice.status !== "partially_paid") continue;
    if (invoice.currency.toUpperCase() !== "CAD") continue;
    const owed = Math.max(0, invoice.amount_cents - invoice.paid_cents - invoice.credited_cents);
    if (owed <= 0) continue;
    const row = rows[ageingBucket(invoice.due_on, today)];
    row.invoices++;
    row.cents += owed;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Refusals, in the firm's words
// ---------------------------------------------------------------------------

const MESSAGES: [RegExp, string][] = [
  [/sample mode/i, "This firm is in sample mode, so only sample matters take this. Turn sample mode off for a real client."],
  [/time access denied/i, "Only the firm owner or staff on this matter log time here."],
  [/billing access denied/i, "Only the firm owner or the matter’s finance user can do that."],
  [/already have a timer running/i, "You already have a timer running. Stop it first."],
  [/timer isn't running/i, "That timer isn’t running any more."],
  [/more than 24 hours/i, "That timer ran for more than 24 hours. Discard it and log the time by hand."],
  [/no unbilled billable time/i, "There’s no unbilled billable time on this matter."],
  [/already billed, not billable/i, "Some of that time is already billed, not billable, discarded or still running."],
  [/on an invoice; discard the draft/i, "That time is on an invoice. Discard the draft first."],
  [/no (.+) tax rate is in effect on (\d{4}-\d{2}-\d{2})/i, "No tax rate of that name is in effect on the invoice date. Add it under Tax rates, or choose none."],
  [/already applies in that period/i, "A rate with that name already applies in that period. End it first."],
  [/used this rate; end it on or after/i, "An issued invoice used this rate after that date. End it later."],
  [/only an accepted quote/i, "Only an accepted quote can be invoiced."],
  [/quote is already invoiced/i, "This quote is already invoiced."],
  [/has an instalment plan/i, "This quote has an instalment plan. Invoice its instalments instead, or cancel the plan first."],
  [/no professional fee or disbursement/i, "This quote has no professional fee or disbursement to invoice."],
  [/no instalments/i, "This quote has no instalments."],
  [/due date for each/i, "Give a due date for each instalment."],
  [/due dates must be today or later|due date must be today or later/i, "The due date can’t be in the past."],
  [/advance is requested into the client account/i, "An advance is requested into the client account, not invoiced."],
  [/instalment is already invoiced/i, "This instalment is already invoiced."],
  [/plan is cancelled|plan is already cancelled/i, "This instalment plan is cancelled."],
  [/only an issued invoice with a balance/i, "Only an issued invoice with something still owed can be written off."],
  [/more than the balance still owed/i, "That’s more than the balance still owed."],
  [/write-off amount must be positive/i, "Enter an amount above zero."],
  [/official Government of Canada page/i, "The source must be an official Government of Canada page (https)."],
  [/source was checked/i, "Say when you checked the source (not in the future)."],
  [/fee reference isn't approved/i, "That fee reference isn’t approved for use yet."],
  [/must match the fee reference/i, "The amount must match the fee reference."],
  [/lines are added to a draft|lines can't be changed|isn't a draft|only a draft can be discarded/i, "That invoice isn’t a draft any more."],
  [/discard the draft instead/i, "A draft needs at least one line. Discard the draft instead."],
  [/reason is required/i, "Give a reason."],
  [/nothing is waiting for review/i, "There’s no fee list waiting for review."],
  [/rejected/i, "Say why it’s rejected."],
  [/retrieval time must be now|no fees were read|page hash/i, "The fee list couldn’t be read. Nothing was recorded."],
  [/staff access denied/i, "You don’t have access to that."],
];

export function billingError(message: string): string {
  for (const [pattern, text] of MESSAGES) if (pattern.test(message)) return text;
  return safeAccessError(message);
}
