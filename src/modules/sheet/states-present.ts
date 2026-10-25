/**
 * DES-04: the Sheet's incomplete and failed states, in plain words. Pure: loaders pass what the
 * database returned and these say what happened and what to do next. Nothing here fills a gap
 * with an invented value: a state is shown only from real rows (a role, a rule version's status
 * or dates, an official source's last check, a fee list or estimate waiting for review, a Stripe
 * payment's status, a read that hit its limit or failed).
 *
 * The views (`components/sheet/designer/state-views.tsx`) are built from the Designer's own
 * parts: the "No permission" panel and the `.alert` banner (System states reference sheet).
 */
import { longDate } from "@/modules/sheet/matter-present";
import { isoDateInTimeZone, roleLabel } from "@/modules/sheet/present";

// ---------------------------------------------------------------------------
// Shapes the views take
// ---------------------------------------------------------------------------

/** A link the state offers as its next step. */
export type StateAction = { label: string; href: string };

/** Permission denied: what is missing, who to ask, and the person's role. Never a blank table. */
export type NoAccessData = {
  title: string;
  /** What the page holds and who it is for, then who to ask. */
  copy: string;
  /** "Your role is Case manager." Null when the role isn't the reason. */
  role: string | null;
  action: StateAction | null;
};

/** A banner at the top of a page: stale official source, partial read, failed payment. */
export type StateAlertData = {
  kind: "stale-source" | "partial" | "failed-payment";
  tone: "warn" | "bad" | "info";
  icon: string;
  title: string;
  body: string;
  /** The specific records behind it, at most five, then "and N more". */
  items: string[];
  action: StateAction | null;
};

// ---------------------------------------------------------------------------
// Permission denied
// ---------------------------------------------------------------------------

const ROLES_LINK: StateAction = { label: "See what each role can do", href: "/sheet/roles" };

const BILLING = new Set(["firm_owner", "finance_user"]);

function yourRole(role: string): string {
  return `Your role is ${roleLabel(role)}.`;
}

/**
 * The permission-denied view for an area a role can't open. `copy` is what the area holds and
 * who it's for; who to ask always closes it.
 */
export function noAccess(area: string, holds: string, role: string, ask = "Ask your firm owner if you need access."): NoAccessData {
  return { title: `You don’t have access to ${area}`, copy: `${holds} ${ask}`, role: yourRole(role), action: ROLES_LINK };
}

/** Finance (every tab): the firm owner and finance users only (app.can_read_matter_billing). */
export function financeAccess(role: string): NoAccessData | null {
  if (BILLING.has(role)) return null;
  return noAccess("Finance", "Invoices, payments, client funds, reconciliation and refunds are for the firm owner and finance staff.", role);
}

/** A matter's Billing tab for a role that can't read its invoices (the Designer's own example). */
export const MATTER_BILLING_DENIED: NoAccessData = {
  title: "You don’t have access to Billing on this matter",
  copy: "The firm owner and the matter’s finance user see its invoices and client funds. Ask your firm owner if you need access.",
  role: null,
  action: ROLES_LINK,
};

/** A tab that already says who it's for (Reports, Privacy requests, Complaints) in the shared view. */
export function deniedView(title: string, copy: string): NoAccessData {
  return { title, copy, role: null, action: ROLES_LINK };
}

/** Settings › Subscription: the firm's plan, usage and bank accounts (firm_subscription answers owners and finance). */
export function subscriptionAccess(role: string): NoAccessData | null {
  if (BILLING.has(role)) return null;
  return noAccess("Subscription", "The firm’s plan, usage, payment setup and bank accounts are for the firm owner and finance staff.", role);
}

/** Practice › Access grants and Support access: the firm owner only (firm_access_grants, firm_support_access). */
export function grantsAccess(role: string, tab: "grants" | "support" | "limits"): NoAccessData | null {
  if (role === "firm_owner" || tab === "limits") return null;
  return tab === "support"
    ? noAccess("Support access", "Only the firm owner approves, ends or declines Casevoya support access to the firm’s records.", role)
    : noAccess("Access grants", "Only the firm owner gives and revokes access to a person or a matter.", role);
}

/** Compliance › Migration import: the firm owner only. */
export function migrationAccess(role: string): NoAccessData | null {
  if (role === "firm_owner") return null;
  return noAccess("Migration import", "An import brings client records in from another system, so only the firm owner can see and run one.", role, "Ask your firm owner to run it.");
}

/**
 * A record the person can't open: the database answers "not found" both when it doesn't exist and
 * when the person isn't assigned to it, so the view says both and doesn't guess which.
 */
export function recordNotOpen(kind: "matter" | "lead", role: string, back: StateAction): NoAccessData {
  return {
    title: `This ${kind} isn’t open to you`,
    copy:
      kind === "matter"
        ? "It may not exist, or you aren’t assigned to it. Ask your firm owner or the matter’s responsible consultant to add you to it."
        : "It may not exist, or your role can’t open leads. Ask your firm owner if you need access.",
    role: yourRole(role),
    action: back,
  };
}

// ---------------------------------------------------------------------------
// Stale official source
// ---------------------------------------------------------------------------

/** A rule version as read: its label ("IRCC.STUDY.FEE v2"), status and dates. */
export type RuleFact = { label: string; status: string; effectiveTo: string | null; nextReviewAt: string | null };
/** A program pack (rule_pack_versions). */
export type PackFact = { label: string; status: string; nextReviewAt: string | null };
/** An official page (official_sources): its review state and its last check. */
export type SourceFact = {
  label: string;
  reviewStatus: string;
  changeState: string;
  lastAttemptResult: string | null;
  lastAttemptAt: string | null;
  nextReviewAt: string | null;
};

/** Statuses whose content is (or was) in use, so a passed date or review makes it stale. */
const IN_USE = new Set(["published", "approved", "review_due"]);
const SHOWN = 5;

/** "20 Oct 2026": a calendar date as it is, an instant on the firm's calendar. */
function day(iso: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return longDate(iso);
  return longDate(isoDateInTimeZone(new Date(iso), timeZone));
}

function listed(lines: string[]): string[] {
  return lines.length > SHOWN ? [...lines.slice(0, SHOWN), `and ${lines.length - SHOWN} more`] : lines;
}

export function ruleReasons(rule: RuleFact, now: Date, timeZone: string): string[] {
  if (!IN_USE.has(rule.status)) return [];
  const reasons: string[] = [];
  if (rule.effectiveTo && Date.parse(rule.effectiveTo) <= now.getTime()) reasons.push(`expired ${day(rule.effectiveTo, timeZone)}`);
  if (rule.status === "review_due") reasons.push("review required");
  else if (rule.nextReviewAt && Date.parse(rule.nextReviewAt) < now.getTime()) reasons.push(`review was due ${day(rule.nextReviewAt, timeZone)}`);
  return reasons;
}

export function packReasons(pack: PackFact, now: Date, timeZone: string): string[] {
  if (!IN_USE.has(pack.status)) return [];
  if (pack.status === "review_due") return ["review required"];
  if (pack.nextReviewAt && Date.parse(pack.nextReviewAt) < now.getTime()) return [`review was due ${day(pack.nextReviewAt, timeZone)}`];
  return [];
}

export function sourceReasons(source: SourceFact, now: Date, timeZone: string): string[] {
  const reasons: string[] = [];
  if (source.lastAttemptResult === "failed" || source.lastAttemptResult === "blocked") {
    reasons.push(`${source.lastAttemptResult === "blocked" ? "the last check was blocked" : "the last check failed"}${source.lastAttemptAt ? ` (${day(source.lastAttemptAt, timeZone)})` : ""}`);
  }
  if (source.changeState === "change_detected") reasons.push("the page changed since it was reviewed");
  if (source.reviewStatus === "review_due") reasons.push("review required");
  else if (source.nextReviewAt && Date.parse(source.nextReviewAt) < now.getTime()) reasons.push(`review was due ${day(source.nextReviewAt, timeZone)}`);
  return reasons;
}

/**
 * The stale-source banner wherever official content shows: a rule version that is review due,
 * past its review date or expired; a program pack that is; an official page whose last check
 * failed or was blocked, or which changed since review. Null when nothing is stale.
 */
export function sourceStaleness(input: {
  rules: readonly RuleFact[];
  packs?: readonly PackFact[];
  sources?: readonly SourceFact[];
  now: Date;
  timeZone: string;
  /** Where to review (absent on the Source review page itself). */
  action?: StateAction | null;
  /** What the page shows from these sources ("This matter’s program rules"). */
  subject?: string;
}): StateAlertData | null {
  const lines: string[] = [];
  for (const rule of input.rules) {
    const reasons = ruleReasons(rule, input.now, input.timeZone);
    if (reasons.length) lines.push(`${rule.label}: ${reasons.join(", ")}`);
  }
  for (const pack of input.packs ?? []) {
    const reasons = packReasons(pack, input.now, input.timeZone);
    if (reasons.length) lines.push(`${pack.label}: ${reasons.join(", ")}`);
  }
  for (const source of input.sources ?? []) {
    const reasons = sourceReasons(source, input.now, input.timeZone);
    if (reasons.length) lines.push(`${source.label}: ${reasons.join(", ")}`);
  }
  if (!lines.length) return null;
  const subject = input.subject ?? "The official content on this page";
  return {
    kind: "stale-source",
    tone: "warn",
    icon: "clock",
    title: lines.length === 1 ? "An official source needs review" : `${lines.length} official sources need review`,
    body: `${subject} may be out of date. What’s shown is what a licensed reviewer last approved, with its source and dates. Check the official page and record a review before relying on it.`,
    items: listed(lines),
    action: input.action === undefined ? { label: "Open Source review", href: "/sheet/templates?tab=sources" } : input.action,
  };
}

/**
 * A newer reading of an official page waits for licensed review while the older approved one is
 * shown (IRCC's fee list, an IRCC processing-time estimate). Null unless both exist and the
 * waiting one is newer.
 */
export function newerReadingWaiting(input: {
  what: string;
  approvedAt: string | null;
  pendingAt: string | null;
  /** Whether the waiting one is the newer (default: its date is later than the approved one's). */
  newer?: boolean;
  timeZone: string;
  action?: StateAction | null;
}): StateAlertData | null {
  if (!input.approvedAt || !input.pendingAt) return null;
  if (!(input.newer ?? Date.parse(input.pendingAt) > Date.parse(input.approvedAt))) return null;
  return {
    kind: "stale-source",
    tone: "warn",
    icon: "clock",
    title: `A newer ${input.what} is waiting for licensed review`,
    body: `It was checked on ${day(input.pendingAt, input.timeZone)}. Until a licensed member reviews it, the approved one checked on ${day(input.approvedAt, input.timeZone)} is shown and used.`,
    items: [],
    action: input.action ?? null,
  };
}

// ---------------------------------------------------------------------------
// Partial: a read hit its limit or failed
// ---------------------------------------------------------------------------

/** One read behind a page: how many rows came back, the limit asked for, and whether it failed. */
export type ReadSource = { label: string; count: number; cap: number; failed?: boolean; /** Which rows a capped read keeps ("newest", "soonest"). */ order?: string };

export function partialAlert(sources: readonly ReadSource[]): StateAlertData | null {
  const failed = sources.filter((source) => source.failed);
  const capped = sources.filter((source) => !source.failed && source.count >= source.cap);
  if (!failed.length && !capped.length) return null;
  const items = [
    ...failed.map((source) => `${source.label}: couldn’t load`),
    ...capped.map((source) => `${source.label}: the ${source.order ?? "newest"} ${source.cap} are shown; the rest aren’t listed`),
  ];
  return {
    kind: "partial",
    tone: failed.length ? "bad" : "info",
    icon: failed.length ? "x-circle" : "info",
    title: failed.length ? "Part of this page couldn’t load" : "This page shows part of the list",
    body: failed.length
      ? "What’s shown is incomplete; nothing was changed. Reload the page to try again, and sign in again if it keeps happening."
      : "Counts and lists below cover only what was read.",
    items: listed(items),
    action: null,
  };
}

// ---------------------------------------------------------------------------
// Failed payment (Stripe test mode)
// ---------------------------------------------------------------------------

export type PaymentFact = { invoiceId: string; status: string; updatedAt: string };
export type DisputeFact = { number: string; status: string; evidenceDueBy: string | null };

const OPEN_DISPUTE = new Set(["needs_response", "warning_needs_response"]);

/** Each invoice's latest card payment attempt (a later one, such as a success, replaces a failure). */
export function latestPayments(payments: readonly PaymentFact[]): Map<string, PaymentFact> {
  const latest = new Map<string, PaymentFact>();
  for (const row of payments) {
    const seen = latest.get(row.invoiceId);
    if (!seen || row.updatedAt > seen.updatedAt) latest.set(row.invoiceId, row);
  }
  return latest;
}

/** A failed or canceled card attempt, in a few words; null for any other status. */
export function failedPaymentWords(status: string): string | null {
  if (status === "canceled") return "payment canceled";
  if (status === "failed") return "payment failed or declined";
  return null;
}

/**
 * Card payments whose latest attempt on an invoice failed or was canceled (Stripe's signed event
 * moved them; a later success clears it), and disputes waiting for evidence. Null when none.
 */
export function failedPaymentAlert(input: {
  payments: readonly PaymentFact[];
  invoices: ReadonlyMap<string, { number: string; client: string }>;
  disputes?: readonly DisputeFact[];
  now: Date;
  timeZone: string;
}): StateAlertData | null {
  const latest = latestPayments(input.payments);
  const failed = [...latest.values()].filter((row) => failedPaymentWords(row.status) !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const disputes = (input.disputes ?? []).filter((row) => OPEN_DISPUTE.has(row.status) && (!row.evidenceDueBy || Date.parse(row.evidenceDueBy) > input.now.getTime()));
  if (!failed.length && !disputes.length) return null;
  const items = [
    ...failed.map((row) => {
      const invoice = input.invoices.get(row.invoiceId);
      return `${invoice?.number ?? "Invoice"}${invoice?.client ? ` (${invoice.client})` : ""}: ${failedPaymentWords(row.status)} ${day(row.updatedAt, input.timeZone)}`;
    }),
    ...disputes.map((row) => `Dispute ${row.number}: needs evidence${row.evidenceDueBy ? ` by ${day(row.evidenceDueBy, input.timeZone)}` : ""}`),
  ];
  const first = failed[0];
  const title = failed.length
    ? failed.length === 1
      ? "A card payment didn’t go through"
      : `${failed.length} card payments didn’t go through`
    : disputes.length === 1
      ? "A disputed payment needs evidence"
      : `${disputes.length} disputed payments need evidence`;
  const body = failed.length
    ? "Stripe reported the payment as failed, declined or canceled. Nothing was charged and the invoice stays open. Next step: ask the client to pay again from their portal, or record a payment they made another way on the invoice."
    : "The client’s bank is asking about a card payment. Add evidence from Refunds and disputes before the due date.";
  return {
    kind: "failed-payment",
    tone: "bad",
    icon: "x-circle",
    title,
    body,
    items: listed(items),
    action: first ? { label: `Open ${input.invoices.get(first.invoiceId)?.number ?? "the invoice"}`, href: `/sheet/finance?tab=invoice&view=${first.invoiceId}` } : { label: "Refunds and disputes", href: "/sheet/finance?tab=refunds" },
  };
}
