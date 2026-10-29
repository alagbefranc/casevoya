import { formatMoney } from "@/modules/finance/money";

/**
 * The firm's Stripe connected account as Settings > Subscription's "Card payments from clients"
 * card and the Finance banner show it (FIN-02). Every value comes from what Stripe reported (cached
 * in firm_payment_accounts) or from Casevoya's own account configuration; nothing is guessed.
 * Pure: no server or browser APIs, so it is unit tested.
 */

/** What Casevoya asks Stripe for when it creates a firm's account (accountCreateParams). */
export const REQUESTED_RESPONSIBILITIES = { fees_collector: "stripe", losses_collector: "stripe" } as const;

export type ConnectRequirement = { description: string; due: "currently_due" | "past_due" | "eventually_due"; from: "user" | "stripe" };

export type ConnectAccount = {
  /** "acct_…": shown shortened. */
  accountId: string;
  cardPayments: string;
  payouts: string;
  requirementsDue: number;
  requirements: ConnectRequirement[];
  feesCollector: string | null;
  lossesCollector: string | null;
  /** When the status was last read from Stripe, if ever. */
  checkedAt: string | null;
};

export type FinanceAccountData = {
  organizationId: string;
  firmName: string;
  isOwner: boolean;
  /** Both the server's secret key and a publishable key of the same Stripe mode are set. */
  configured: boolean;
  publishableKey: string | null;
  /** The server runs Stripe in live mode (real cards). Absent means test mode. */
  live?: boolean;
  /** The firm's link was made in the other mode (test, before the server went live). */
  otherModeLink?: boolean;
  account: null | ConnectAccount;
  /** Firm owner or finance user: the staff who see the firm's billing. */
  canBill: boolean;
};

export type ConnectStage = "not_connected" | "onboarding" | "charges" | "payouts";

/** Not connected; onboarding incomplete (card payments not on, or Stripe needs something); charges enabled; payouts enabled too. */
export function connectStage(account: Pick<ConnectAccount, "cardPayments" | "payouts" | "requirementsDue"> | null): ConnectStage {
  if (!account) return "not_connected";
  if (account.cardPayments !== "active") return "onboarding";
  if (account.payouts === "active") return account.requirementsDue > 0 ? "charges" : "payouts";
  return "charges";
}

const CAPABILITY: Record<string, string> = {
  active: "On",
  pending: "Not yet: Stripe is waiting for information or checking it",
  restricted: "Paused by Stripe until it gets more information",
  unsupported: "Not available for this account",
};

const DUE: Record<ConnectRequirement["due"], string> = {
  past_due: "overdue",
  currently_due: "due now",
  eventually_due: "due later",
};

/** "Provide a tax ID (due now)", or "(Stripe is checking)" when Stripe, not the firm, must act. */
export function requirementLine(requirement: ConnectRequirement): string {
  return `${requirement.description} (${requirement.from === "stripe" ? "Stripe is checking" : DUE[requirement.due]})`;
}

/** "acct_1Sxy…9AbC": enough to match Stripe's Dashboard, not the whole id. */
export function shortAccount(accountId: string): string {
  return accountId.length > 16 ? `${accountId.slice(0, 9)}…${accountId.slice(-4)}` : accountId;
}

function feesText(collector: string): string {
  if (collector === "stripe") return "Stripe collects its processing fees from the firm’s own Stripe account";
  return "Casevoya, the platform, pays Stripe’s fees and collects them from the firm";
}

function lossesText(collector: string): string {
  if (collector === "stripe") return "Stripe covers a loss the firm’s Stripe balance can’t (an unpaid refund or a lost dispute)";
  return "Casevoya, the platform, covers a loss the firm’s Stripe balance can’t (an unpaid refund or a lost dispute)";
}

/**
 * Refund and loss liability, from the account's own configuration: what Stripe reported
 * (`defaults.responsibilities`), or, before it was read, what Casevoya asked for when it created
 * the account, said as such. The raw Stripe values are quoted so they can be checked.
 */
export function liabilityText(account: Pick<ConnectAccount, "feesCollector" | "lossesCollector"> | null): string {
  if (!account || (!account.feesCollector && !account.lossesCollector)) {
    const requested = `${feesText(REQUESTED_RESPONSIBILITIES.fees_collector)}; ${lossesText(REQUESTED_RESPONSIBILITIES.losses_collector)}`;
    return account
      ? `Not read from Stripe yet. Casevoya asked for: ${requested} (fees_collector “${REQUESTED_RESPONSIBILITIES.fees_collector}”, losses_collector “${REQUESTED_RESPONSIBILITIES.losses_collector}”).`
      : `Casevoya asks Stripe for: ${requested} (fees_collector “${REQUESTED_RESPONSIBILITIES.fees_collector}”, losses_collector “${REQUESTED_RESPONSIBILITIES.losses_collector}”).`;
  }
  const parts = [
    account.feesCollector ? `${feesText(account.feesCollector)} (fees_collector “${account.feesCollector}”)` : null,
    account.lossesCollector ? `${lossesText(account.lossesCollector)} (losses_collector “${account.lossesCollector}”)` : null,
  ].filter(Boolean);
  return `${parts.join("; ")}. As Stripe reports it.`;
}

export type ConnectCardAction = "setup" | "continue" | "refresh" | "disconnect";

export type ConnectCardData = {
  badge: { tone: "ok" | "chg" | "gr" | "bad"; label: string };
  rows: [string, string][];
  /** Stripe's open requirements, each as one line; empty when there are none. */
  requirements: string[];
  /** Owner-only buttons, in order. */
  actions: { act: ConnectCardAction; label: string; primary: boolean }[];
  /** Under the rows: what to expect, or why there is nothing to do here. */
  note: string;
};

const BADGE: Record<ConnectStage, ConnectCardData["badge"]> = {
  not_connected: { tone: "gr", label: "Not connected" },
  onboarding: { tone: "chg", label: "Onboarding incomplete" },
  charges: { tone: "ok", label: "Charges enabled" },
  payouts: { tone: "ok", label: "Charges and payouts enabled" },
};

function checkedText(checkedAt: string | null, timeZone: string): string {
  if (!checkedAt) return "Not read from Stripe yet";
  const at = new Date(checkedAt);
  if (Number.isNaN(at.getTime())) return "Not read from Stripe yet";
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(at);
}

/** The Settings card for the firm's Stripe account. */
/** "(test mode)" or "(live)" after an account id. */
function modeTag(live: boolean): string {
  return live ? "(live)" : "(test mode)";
}

export function connectCard(data: FinanceAccountData, timeZone: string): ConnectCardData {
  const account = data.account;
  const stage = connectStage(account);
  const live = data.live === true;
  if (!data.canBill) {
    return {
      badge: { tone: "gr", label: "Billing staff only" },
      rows: [],
      requirements: [],
      actions: [],
      note: "The firm’s Stripe account is shown to the firm owner and finance users.",
    };
  }
  if (!data.configured) {
    return {
      badge: account ? BADGE[stage] : { tone: "gr", label: "Not available" },
      rows: account ? [["Stripe account", `${shortAccount(account.accountId)}`]] : [],
      requirements: [],
      actions: [],
      note: "This environment has no Stripe keys, so Casevoya can’t read or finish the Stripe account here. Nothing can be charged.",
    };
  }
  if (account && data.otherModeLink) {
    return {
      badge: { tone: "chg", label: "Reconnect" },
      rows: [["Stripe account", `${shortAccount(account.accountId)} ${modeTag(!live)}`]],
      requirements: [],
      actions: data.isOwner ? [{ act: "disconnect", label: "Disconnect Stripe account", primary: true }] : [],
      note: data.isOwner
        ? `This Stripe account was connected in ${live ? "test mode" : "live mode"}, and Casevoya now runs Stripe in ${live ? "live mode" : "test mode"}. Clients can’t pay by card until you disconnect it and set up ${data.firmName}’s ${live ? "live" : "test"} Stripe account. Disconnecting cancels the payment requests still open on the old account.`
        : "The firm owner reconnects the firm’s Stripe account. Until then clients can’t pay by card.",
    };
  }
  if (!account) {
    return {
      badge: BADGE.not_connected,
      rows: [
        ["Stripe account", "Not connected"],
        ["Refunds and losses", liabilityText(null)],
      ],
      requirements: [],
      actions: data.isOwner ? [{ act: "setup", label: live ? "Set up Stripe" : "Set up Stripe (test mode)", primary: true }] : [],
      note: data.isOwner
        ? `Casevoya creates a Stripe account for ${data.firmName}${live ? "" : " in test mode"}; you finish it here. Clients’ card payments go to that account, never to Casevoya. You’ll confirm with your authenticator first.`
        : "The firm owner sets up the firm’s Stripe account.",
    };
  }
  const rows: [string, string][] = [
    ["Stripe account", `${shortAccount(account.accountId)} ${modeTag(live)}`],
    ["Card payments", CAPABILITY[account.cardPayments] ?? account.cardPayments],
    ["Payouts", CAPABILITY[account.payouts] ?? account.payouts],
    ["Stripe still needs", account.requirements.length ? `${account.requirements.length} ${account.requirements.length === 1 ? "item" : "items"}, listed below` : account.requirementsDue > 0 ? `${account.requirementsDue} ${account.requirementsDue === 1 ? "item" : "items"}; check with Stripe to list them` : "Nothing"],
    ["Refunds and losses", liabilityText(account)],
    ["Last checked with Stripe", checkedText(account.checkedAt, timeZone)],
  ];
  const actions: ConnectCardData["actions"] = [];
  if (data.isOwner) {
    if (stage === "onboarding" || account.requirementsDue > 0) actions.push({ act: "continue", label: "Continue onboarding", primary: true });
    actions.push({ act: "refresh", label: "Check with Stripe", primary: actions.length === 0 });
    actions.push({ act: "disconnect", label: "Disconnect Stripe account", primary: false });
  }
  const note =
    stage === "onboarding"
      ? data.isOwner
        ? `Stripe collects the firm’s business and bank details in its own form, opened here.${live ? "" : " In test mode use Stripe’s test values."} Continuing asks you to confirm it’s you first.`
        : "The firm owner finishes onboarding with Stripe. Until then clients can’t pay by card."
      : "Clients pay earned-fee invoices by card into this account (a direct charge: the firm is the merchant). Advances for the client account are never paid by card.";
  return { badge: BADGE[stage], rows, requirements: account.requirements.map(requirementLine), actions, note };
}

/** The account as the database row holds it, for the pages. */
export function connectAccountFromRow(row: {
  account_id: string;
  card_payments_status: string;
  payouts_status: string;
  requirements_due: number;
  requirements?: unknown;
  fees_collector?: string | null;
  losses_collector?: string | null;
  status_checked_at?: string | null;
}): ConnectAccount {
  const list = Array.isArray(row.requirements) ? row.requirements : [];
  return {
    accountId: row.account_id,
    cardPayments: row.card_payments_status,
    payouts: row.payouts_status,
    requirementsDue: row.requirements_due,
    requirements: list
      .map((item): ConnectRequirement | null => {
        const entry = item as Partial<ConnectRequirement> | null;
        if (!entry || typeof entry.description !== "string" || !entry.description.trim()) return null;
        const due = entry.due === "past_due" || entry.due === "eventually_due" ? entry.due : "currently_due";
        return { description: entry.description.trim(), due, from: entry.from === "stripe" ? "stripe" : "user" };
      })
      .filter((entry): entry is ConnectRequirement => entry !== null),
    feesCollector: row.fees_collector ?? null,
    lossesCollector: row.losses_collector ?? null,
    checkedAt: row.status_checked_at ?? null,
  };
}

/** What the owner types to confirm disconnecting the firm's Stripe account (app.unlink_stripe_account checks it too). */
export const DISCONNECT_WORD = "DISCONNECT";

export type DisconnectInput = { confirmation: string; reason: string };

/** The disconnect dialog's fields, checked before the database is asked. */
export function readDisconnect(fields: { confirmation?: unknown; reason?: unknown }): { input: DisconnectInput } | { error: string } {
  const confirmation = typeof fields.confirmation === "string" ? fields.confirmation.trim() : "";
  const reason = typeof fields.reason === "string" ? fields.reason.trim() : "";
  if (confirmation !== DISCONNECT_WORD) return { error: `Type ${DISCONNECT_WORD} to confirm.` };
  if (reason.length < 3) return { error: "Say why the account is being disconnected." };
  if (reason.length > 500) return { error: "Keep the reason under 500 characters." };
  return { input: { confirmation, reason } };
}

/** One thing still running on the account, as app.stripe_account_unlink_blockers lists it. */
export type UnlinkBlocker = { kind: "payment" | "refund" | "dispute"; number: string; invoice_number: string; amount_cents: number; currency: string; status: string };

const BLOCKER_STATUS: Record<string, string> = {
  processing: "processing at Stripe",
  requires_payment: "started by the client in the last 24 hours",
  pending: "pending at Stripe",
  requires_action: "waiting on the client at Stripe",
  warning_needs_response: "inquiry needs a response",
  warning_under_review: "inquiry under review",
  needs_response: "needs a response",
  under_review: "under review",
};

/** "Card payment on INV-0001, CAD 400.00: processing at Stripe". */
export function blockerLine(blocker: UnlinkBlocker): string {
  const amount = formatMoney(Number(blocker.amount_cents), blocker.currency);
  const status = BLOCKER_STATUS[blocker.status] ?? blocker.status;
  if (blocker.kind === "refund") return `Refund ${blocker.number} of ${blocker.invoice_number}, ${amount}: ${status}`;
  if (blocker.kind === "dispute") return `Dispute ${blocker.number} on ${blocker.invoice_number}, ${amount}: ${status}`;
  return `Card payment on ${blocker.invoice_number}, ${amount}: ${status}`;
}

/** "Card payment request on INV-0001, CAD 400.00 (pi_…)": one request Stripe didn't cancel. */
export function openRequestLine(request: { invoice_number: string; amount_cents: number; currency: string; payment_intent_id: string }): string {
  return `Card payment request on ${request.invoice_number || "an invoice"}, ${formatMoney(Number(request.amount_cents), request.currency)} (${request.payment_intent_id})`;
}

/** Wording for the database's refusals of a disconnect. */
export function disconnectError(message: string): string | null {
  if (/type DISCONNECT/i.test(message)) return `Type ${DISCONNECT_WORD} to confirm.`;
  if (/reason/i.test(message)) return "Say why the account is being disconnected (3 to 500 characters).";
  if (/changed; reload/i.test(message)) return "The firm’s Stripe account changed. Reload the page and try again.";
  if (/no Stripe account to disconnect/i.test(message)) return "This firm has no Stripe account connected.";
  return null;
}

/**
 * Stripe's idempotency key for creating the firm's account. The first account keeps the original
 * key; after each disconnect the count of ended links makes a new one, so setting up again creates
 * a new account instead of returning the disconnected one.
 */
export function connectIdempotencyKey(organizationId: string, endedLinks: number): string {
  return endedLinks > 0 ? `casevoya-connect-${organizationId}-${endedLinks}` : `casevoya-connect-${organizationId}`;
}

/** The invoice kinds a client may pay by card (app.is_card_payable_category): earned fees and incurred costs. */
export const CARD_PAYABLE_CATEGORIES = ["professional_fee", "disbursement", "consultation_fee"] as const;

export function isCardPayableCategory(category: string | null | undefined): boolean {
  return (CARD_PAYABLE_CATEGORIES as readonly string[]).includes(category ?? "");
}

/** Why an advance can't be paid by card, in the client's words (FIN-02, FIN-03). */
export function advanceRefusal(firmName: string): { title: string; copy: string } {
  return {
    title: "This invoice can’t be paid by card",
    copy: `It asks for an advance that ${firmName} holds in its client (trust) account until the work is done. Card payments are for earned fees only, so pay an advance by bank transfer as ${firmName} asks. Nothing was charged.`,
  };
}

/** Whether the owner's page should read the account from Stripe again: not finished, never read, or read over an hour ago. */
export function accountNeedsRefresh(account: ConnectAccount, now: Date): boolean {
  if (account.cardPayments !== "active" || account.requirementsDue > 0) return true;
  if (!account.checkedAt || (!account.feesCollector && !account.lossesCollector)) return true;
  const at = Date.parse(account.checkedAt);
  return !Number.isFinite(at) || now.getTime() - at > 60 * 60 * 1000;
}
