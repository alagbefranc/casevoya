/**
 * Pure helpers for the Agreements page's Quote builder, Agreement editor and Compare versions
 * tabs: the words for quote lines and instalments, money in cents to the Designer's "1,600.00",
 * which tab an agreement opens in, what the Edit quote, New quote and clause dialogs send, how
 * database refusals read, and the diff sections of two versions. The database decides every
 * create, save, send and edit.
 */
import type { CompareSection } from "@/components/sheet/designer/agreements-compare";
import type { QuoteInstalmentInput, QuoteLineInput } from "@/components/sheet/designer/agreements-quote";
import type { MatterBadge } from "@/components/sheet/designer/matters";
import { safeAccessError } from "@/lib/auth/step-up";
import { diffParagraphs, diffTexts, hasChanges } from "@/modules/agreements/diff";
import { formatAmount } from "@/modules/finance/money";
import { parseFeeMinor } from "@/modules/sheet/agreements-present";

export const QUOTE_CATEGORY_LABEL: Record<string, string> = {
  professional_fee: "Professional fee",
  tax: "Tax",
  disbursement: "Disbursement",
  government_fee: "Government fee",
};

export function quoteCategoryLabel(category: string): string {
  return QUOTE_CATEGORY_LABEL[category] ?? category.replaceAll("_", " ");
}

/** The Designer's "Paid as" words: "Advance · client account" or "Invoice after delivery". */
export function paidAsParts(paidAs: string): string[] {
  return paidAs === "advance" ? ["Advance", "client account"] : ["Invoice after delivery"];
}

/** Minor units as the Designer's money column: "1,600.00". */
export function amountMajor(cents: number | string | null | undefined, currency = "CAD"): string {
  const value = cents == null || cents === "" ? 0 : Math.trunc(Number(cents));
  return formatAmount(Number.isFinite(value) ? value : 0, currency);
}

/** Minor units as the dialog's amount field ("1600.00"). */
export function amountInput(cents: number | string | null | undefined): string {
  const value = cents == null || cents === "" ? 0 : Math.trunc(Number(cents));
  if (!Number.isFinite(value) || value < 0) return "";
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

/** Text typed one item per line (or separated by " · ") as the Designer's separated parts. */
export function textParts(text: string | null | undefined, empty = "—"): string[] {
  const parts = (text ?? "")
    .split(/\n|\s·\s/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [empty];
}

/** Basis points as the dialog's percent field ("13" for 1300, "5.25" for 525). */
export function bpsToPercent(bps: number | null | undefined): string {
  if (bps == null) return "";
  const whole = Math.floor(bps / 100);
  const minor = bps % 100;
  return minor ? `${whole}.${String(minor).padStart(2, "0").replace(/0$/, "")}` : String(whole);
}

/** A percent typed in the dialog as basis points; blank is null. */
export function percentToBps(value: string | null | undefined): { bps: number | null } | { error: string } {
  const text = (value ?? "").replace(/[\s%]/g, "");
  if (!text) return { bps: null };
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return { error: "Enter the tax rate as a percent, like 13." };
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (bps > 10000) return { error: "A tax rate is between 0 and 100 percent." };
  return { bps };
}

export type QuoteLineRow = { category: string; amount_cents: number | string };

/** The totals the database also computes: the professional fee and the total to the firm (no government fees). */
export function quoteTotals(lines: readonly QuoteLineRow[]): { feeCents: number; firmCents: number } {
  let feeCents = 0;
  let firmCents = 0;
  for (const line of lines) {
    const amount = Math.trunc(Number(line.amount_cents)) || 0;
    if (line.category === "professional_fee") feeCents += amount;
    if (line.category !== "government_fee") firmCents += amount;
  }
  return { feeCents, firmCents };
}

/**
 * Which tab an All agreements row opens: a quote in the Quote builder, an unsent draft service or
 * consultation agreement in the Agreement editor, anything with an envelope in Envelope.
 */
export function agreementViewHref(agreement: { id: string; kind: string; status: string }, hasEnvelope: boolean): string {
  const tab = agreement.kind === "quote" ? "quote" : agreement.status === "draft" && !hasEnvelope ? "editor" : "envelope";
  return `/sheet/agreements?${new URLSearchParams({ tab, view: agreement.id })}`;
}

export function agreementTabHref(tab: "quote" | "editor" | "compare" | "envelope", agreementId: string): string {
  return `/sheet/agreements?${new URLSearchParams({ tab, view: agreementId })}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Multi-line text as typed: line breaks kept, blank edges dropped. Empty is null. */
function paragraphs(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text ? text : null;
}

export type QuoteEditFields = {
  scope?: string | null;
  services?: string | null;
  exclusions?: string | null;
  deliverables?: string | null;
  feeStructure?: string | null;
  refund?: string | null;
  expiry?: string | null;
  government?: string | null;
};

export type QuoteLineJson = { category: string; description: string; amount_cents: number; tax_rate_bps: number | null; source_note: string | null };
export type QuoteInstalmentJson = { label: string; amount_cents: number; paid_as: string };

export type QuoteEditInput = {
  agreementId: string;
  scope: string;
  services: string | null;
  exclusions: string | null;
  deliverables: string | null;
  feeStructure: string | null;
  refundPolicy: string | null;
  expiresOn: string;
  governmentFeeNote: string | null;
  lines: QuoteLineJson[];
  instalments: QuoteInstalmentJson[];
};

const CATEGORIES = new Set(["professional_fee", "tax", "disbursement", "government_fee"]);
const PAID_AS = new Set(["advance", "invoice_after_delivery"]);

/** What Edit quote sends, or the first thing to fix. The database checks everything again. */
export function readQuoteEdit(
  agreementId: string | null | undefined,
  fields: QuoteEditFields,
  lines: readonly QuoteLineInput[],
  instalments: readonly QuoteInstalmentInput[],
): { input: QuoteEditInput } | { error: string } {
  const id = clean(agreementId);
  if (!UUID.test(id)) return { error: "Choose the quote to save." };
  const scope = clean(fields.scope);
  if (scope.length < 3) return { error: "Describe the scope: what the firm will do for this client." };
  if (scope.length > 2000) return { error: "Keep the scope to 2,000 characters." };
  const services = paragraphs(fields.services);
  if (services && services.length > 2000) return { error: "Keep the services to 2,000 characters." };
  const exclusions = paragraphs(fields.exclusions);
  if (exclusions && exclusions.length > 2000) return { error: "Keep what is not included to 2,000 characters." };
  const deliverables = paragraphs(fields.deliverables);
  if (deliverables && deliverables.length > 2000) return { error: "Keep the deliverables to 2,000 characters." };
  const feeStructure = clean(fields.feeStructure) || null;
  if (feeStructure && feeStructure.length > 500) return { error: "Keep the fee structure to 500 characters." };
  const refundPolicy = paragraphs(fields.refund);
  if (refundPolicy && refundPolicy.length > 2000) return { error: "Keep the refund policy to 2,000 characters." };
  const governmentFeeNote = paragraphs(fields.government);
  if (governmentFeeNote && governmentFeeNote.length > 500) return { error: "Keep the government fees note to 500 characters." };
  const expiresOn = clean(fields.expiry);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || Number.isNaN(Date.parse(`${expiresOn}T12:00:00Z`))) return { error: "Enter the date the quote expires." };
  if (lines.length > 50) return { error: "Keep the quote to 50 lines." };
  if (instalments.length > 12) return { error: "Keep the quote to 12 instalments." };
  const outLines: QuoteLineJson[] = [];
  for (const [index, line] of lines.entries()) {
    const n = index + 1;
    const category = clean(line.category);
    if (!CATEGORIES.has(category)) return { error: `Choose a category for line ${n}.` };
    const description = clean(line.description);
    if (!description) return { error: `Describe line ${n}.` };
    if (description.length > 300) return { error: `Keep line ${n}'s description to 300 characters.` };
    const amount = parseFeeMinor(line.amount);
    if ("error" in amount) return { error: `Line ${n}: ${amount.error}` };
    if (amount.cents == null) return { error: `Enter an amount for line ${n}, like 1,600.00.` };
    const rate = percentToBps(line.taxRate);
    if ("error" in rate) return { error: `Line ${n}: ${rate.error}` };
    const sourceNote = clean(line.sourceNote) || null;
    if (category === "government_fee" && (!sourceNote || sourceNote.length < 3)) {
      return { error: `Line ${n}: a government fee needs the official fee list it comes from and the date you read it.` };
    }
    if (sourceNote && sourceNote.length > 500) return { error: `Keep line ${n}'s source to 500 characters.` };
    outLines.push({ category, description, amount_cents: amount.cents, tax_rate_bps: rate.bps, source_note: sourceNote });
  }
  const outInstalments: QuoteInstalmentJson[] = [];
  for (const [index, row] of instalments.entries()) {
    const n = index + 1;
    const label = clean(row.label);
    if (!label) return { error: `Say when instalment ${n} is paid, like “On signing” or a milestone.` };
    if (label.length > 200) return { error: `Keep instalment ${n}'s label to 200 characters.` };
    const amount = parseFeeMinor(row.amount);
    if ("error" in amount) return { error: `Instalment ${n}: ${amount.error}` };
    if (amount.cents == null) return { error: `Enter an amount for instalment ${n}.` };
    const paidAs = clean(row.paidAs);
    if (!PAID_AS.has(paidAs)) return { error: `Choose how instalment ${n} is paid.` };
    outInstalments.push({ label, amount_cents: amount.cents, paid_as: paidAs });
  }
  const totals = quoteTotals(outLines);
  const paid = outInstalments.reduce((sum, row) => sum + row.amount_cents, 0);
  if (outInstalments.length && paid !== totals.firmCents) {
    return { error: `Instalments add up to ${amountMajor(paid)}, but the total to the firm is ${amountMajor(totals.firmCents)}. Make them match.` };
  }
  return {
    input: { agreementId: id, scope, services, exclusions, deliverables, feeStructure, refundPolicy, expiresOn, governmentFeeNote, lines: outLines, instalments: outInstalments },
  };
}

/** What New quote sends, or the first thing to fix. */
export function readNewQuote(fields: { matter?: string | null; template?: string | null; title?: string | null }): { input: { matterId: string; templateId: string | null; title: string | null } } | { error: string } {
  const matterId = clean(fields.matter);
  if (!UUID.test(matterId)) return { error: "Choose the client’s matter." };
  const template = clean(fields.template);
  if (template && !UUID.test(template)) return { error: "Choose what to start from." };
  const title = clean(fields.title) || null;
  if (title && title.length > 200) return { error: "Keep the title to 200 characters." };
  return { input: { matterId, templateId: template || null, title } };
}

/** What a clause dialog sends, or the first thing to fix. */
export function readClauseEdit(fields: { agreementId?: string | null; clauseId?: string | null; body?: string | null }): { input: { agreementId: string; clauseId: string; body: string } } | { error: string } {
  const agreementId = clean(fields.agreementId);
  const clauseId = clean(fields.clauseId);
  if (!UUID.test(agreementId) || !UUID.test(clauseId)) return { error: "Choose the clause to edit." };
  const body = paragraphs(fields.body);
  if (!body) return { error: "Add the clause’s wording." };
  if (body.length > 20000) return { error: "Keep the clause to 20,000 characters." };
  return { input: { agreementId, clauseId, body } };
}

/** What Turn into agreement sends. */
export function readQuoteConvert(fields: { agreementId?: string | null; template?: string | null }): { input: { agreementId: string; templateId: string } } | { error: string } {
  const agreementId = clean(fields.agreementId);
  const templateId = clean(fields.template);
  if (!UUID.test(agreementId)) return { error: "Choose the quote." };
  if (!UUID.test(templateId)) return { error: "Choose an approved service agreement template." };
  return { input: { agreementId, templateId } };
}

/** User-facing copy for a refused quote or clause write. Never passes a database message through. */
export function quoteError(message: string): string {
  if (/sample mode/i.test(message)) return "This firm is in sample mode, so only sample matters take quotes. Turn sample mode off for a real client’s quote.";
  if (/licence blocks/i.test(message)) return "The responsible consultant’s licence blocks new work on this matter.";
  if (/approved template is required/i.test(message)) return "Choose an approved template of the right kind.";
  if (/accepted quote cannot be edited/i.test(message)) return "The client accepted this quote, so it can’t change. Make a new quote.";
  if (/only a quote/i.test(message)) return "That record isn’t a quote.";
  if (/only a draft quote/i.test(message)) return "This quote was already sent. Edit it to make a new version first.";
  if (/send the quote before/i.test(message)) return "Send the quote first. It turns into an agreement once it is sent or accepted.";
  if (/dated reference/i.test(message)) return "A government fee needs the official fee list it comes from and the date you read it.";
  if (/add up to the total/i.test(message)) return "Instalments must add up to the total to the firm.";
  if (/today or later/i.test(message)) return "The quote’s expiry must be today or later.";
  if (/whole amount in cents|category is not supported|payment kind is not supported|needs a description|needs a label/i.test(message)) return "Check the lines and instalments: each needs a category, a description and an amount.";
  if (/too long/i.test(message)) return "One of the quote texts is too long.";
  if (/scope is required/i.test(message)) return "Describe the scope.";
  if (/professional reviewer/i.test(message)) return "This clause is mandatory. Your professional reviewer owns it; it can’t be edited here.";
  if (/executed agreement cannot be edited/i.test(message)) return "This agreement is executed, so its wording can’t change. Send an amendment instead.";
  if (/clause denied/i.test(message)) return "That clause isn’t on the current version. Reload the page.";
  if (/clause text is required/i.test(message)) return "Add the clause’s wording.";
  if (/check constraint|violates check/i.test(message)) return "One of the values is too long or not valid.";
  if (/agreement denied/i.test(message)) return "You can’t work on this agreement.";
  if (/staff access denied/i.test(message)) return "Only a licensed consultant or the firm owner builds and sends quotes.";
  return safeAccessError(message);
}

/** The first line of a clause, shortened, for the clause list. */
export function clauseSummary(body: string, max = 110): string {
  const line = body.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  if (!line) return "No wording yet";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** The compare page's badge for one version ("v1 voided", "v2 sent"). */
export function versionBadge(number: number, state: string): MatterBadge {
  const label = `v${number} ${versionStateWords(state)}`;
  switch (state) {
    case "completed":
      return { tone: "ok", label };
    case "sent":
    case "partially_signed":
      return { tone: "rev", label };
    case "declined":
      return { tone: "bad", label };
    default:
      return { tone: "gr", label };
  }
}

export function versionStateWords(state: string): string {
  switch (state) {
    case "completed":
      return "executed";
    case "partially_signed":
      return "partly signed";
    case "accepted":
      return "accepted";
    case "superseded":
      return "replaced";
    default:
      return state.replaceAll("_", " ");
  }
}

/** The history table's state badge for one version. */
export function versionStateBadge(state: string): MatterBadge {
  switch (state) {
    case "completed":
      return { tone: "ok", label: "Executed" };
    case "accepted":
      return { tone: "ok", label: "Accepted" };
    case "sent":
      return { tone: "rev", label: "Sent" };
    case "partially_signed":
      return { tone: "blue", label: "Partially signed" };
    case "declined":
      return { tone: "bad", label: "Declined" };
    case "voided":
      return { tone: "gr", label: "Voided" };
    case "expired":
      return { tone: "gr", label: "Expired" };
    case "superseded":
      return { tone: "gr", label: "Replaced" };
    case "draft":
      return { tone: "gr", label: "Draft" };
    default:
      return { tone: "gr", label: state.replaceAll("_", " ") };
  }
}

export type ClauseText = { position: number; title: string; body: string };

/**
 * The sections of the Compare tab: each clause whose wording differs between the two versions,
 * diffed word by word; a clause only in one version shows as all removed or all added. Versions
 * without clause rows (made before the clause model) are compared as one "Whole text" section.
 */
export function compareSections(
  previous: { clauses: ClauseText[]; body: string | null },
  current: { clauses: ClauseText[]; body: string | null },
  badges: MatterBadge[],
): CompareSection[] {
  const sections: CompareSection[] = [];
  if (previous.clauses.length === 0 && current.clauses.length === 0) {
    const tokens = diffTexts(previous.body ?? "", current.body ?? "");
    sections.push({
      key: "whole",
      label: "Whole text",
      name: "Agreement text",
      badges,
      paragraphs: hasChanges(tokens) ? diffParagraphs(tokens) : [],
      unchanged: "The wording is the same in both versions.",
    });
    return sections;
  }
  const byTitle = (list: ClauseText[]) => new Map(list.map((clause) => [clause.title.trim().toLowerCase(), clause]));
  const before = byTitle(previous.clauses);
  const seen = new Set<string>();
  for (const clause of current.clauses) {
    const key = clause.title.trim().toLowerCase();
    seen.add(key);
    const old = before.get(key);
    const tokens = diffTexts(old?.body ?? "", clause.body);
    if (!hasChanges(tokens)) continue;
    sections.push({ key: `c${clause.position}`, label: `Section ${clause.position}`, name: clause.title, badges, paragraphs: diffParagraphs(tokens) });
  }
  for (const clause of previous.clauses) {
    const key = clause.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    sections.push({ key: `p${clause.position}`, label: `Section ${clause.position}`, name: clause.title, badges, paragraphs: diffParagraphs(diffTexts(clause.body, "")) });
  }
  if (!sections.length) {
    sections.push({ key: "same", label: "Whole text", name: "No wording changes", badges, paragraphs: [], unchanged: "The clauses read the same in both versions; only the terms outside the text (fee, scope or notes) changed." });
  }
  return sections;
}
