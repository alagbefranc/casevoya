import "server-only";
import type Stripe from "stripe";
import { REQUESTED_RESPONSIBILITIES } from "@/modules/finance/connect-present";

/**
 * The firm's connected account, Accounts v2 (https://docs.stripe.com/connect/saas/tasks/create).
 *
 * Design (TEST MODE ONLY):
 * - Merchant configuration with card_payments: the firm accepts its own clients' card payments.
 * - Stripe collects its fees from the firm and is responsible for losses (fees_collector and
 *   losses_collector "stripe", Managed Risk). That needs direct charges, which is what a SaaS
 *   platform uses: the charge is the firm's, on the firm's account (FIN-02).
 * - Dashboard "none" by default: the firm finishes the account through Connect embedded
 *   components in Casevoya (onboarding, notification banner) and sees its payments, balance and
 *   payouts on Casevoya's own Payments tab, never a Stripe-hosted page. STRIPE_CONNECT_DASHBOARD=full gives the firm Stripe
 *   Dashboard access too, if the platform's Connect settings refuse "none".
 */

export type CapabilityStatus = "pending" | "active" | "restricted" | "unsupported";

export function connectDashboard(): "none" | "full" {
  return process.env.STRIPE_CONNECT_DASHBOARD?.trim() === "full" ? "full" : "none";
}

export function accountCreateParams(input: { organizationId: string; displayName: string; email: string | null }): Stripe.V2.Core.AccountCreateParams {
  return {
    display_name: input.displayName.slice(0, 100),
    ...(input.email ? { contact_email: input.email } : {}),
    dashboard: connectDashboard(),
    identity: { country: "ca", entity_type: "company" },
    configuration: {
      merchant: { capabilities: { card_payments: { requested: true } } },
    },
    defaults: {
      currency: "cad",
      locales: ["en-CA"],
      responsibilities: { ...REQUESTED_RESPONSIBILITIES },
    },
    metadata: { casevoya_organization_id: input.organizationId },
    include: ["configuration.merchant", "requirements"],
  };
}

function status(value: string | undefined): CapabilityStatus {
  if (value === "active" || value === "pending" || value === "unsupported") return value;
  if (value === "restricted" || value === "rejected") return "restricted";
  return "pending";
}

/** One open requirement as Stripe states it (Accounts v2 `requirements.entries`). */
export type AccountRequirement = {
  description: string;
  /** How soon: Stripe's `minimum_deadline.status`. */
  due: "currently_due" | "past_due" | "eventually_due";
  /** Who must act: the firm ("user") or Stripe itself. */
  from: "user" | "stripe";
};

export type AccountResponsibilities = { feesCollector: string | null; lossesCollector: string | null };

const FEES_COLLECTORS = ["application", "application_custom", "application_express", "stripe"];
const LOSSES_COLLECTORS = ["application", "stripe"];

/** Requirements Stripe reports, in Stripe's words, most urgent first. Nothing is made up or reworded. */
export function accountRequirements(account: Pick<Stripe.V2.Core.Account, "requirements">): AccountRequirement[] {
  const rank = { past_due: 0, currently_due: 1, eventually_due: 2 } as const;
  const entries = account.requirements?.entries ?? [];
  return entries
    .map((entry): AccountRequirement | null => {
      const description = typeof entry?.description === "string" ? entry.description.trim().slice(0, 300) : "";
      if (!description) return null;
      const deadline = entry.minimum_deadline?.status;
      const due = deadline === "past_due" || deadline === "eventually_due" ? deadline : "currently_due";
      return { description, due, from: entry.awaiting_action_from === "stripe" ? "stripe" : "user" };
    })
    .filter((entry): entry is AccountRequirement => entry !== null)
    .sort((a, b) => rank[a.due] - rank[b.due])
    .slice(0, 50);
}

/** Who collects Stripe's fees and who covers losses on the account, as Stripe reports them (`defaults.responsibilities`). */
export function accountResponsibilities(account: Pick<Stripe.V2.Core.Account, "defaults">): AccountResponsibilities {
  const responsibilities = account.defaults?.responsibilities;
  const fees = responsibilities?.fees_collector;
  const losses = responsibilities?.losses_collector;
  return {
    feesCollector: typeof fees === "string" && FEES_COLLECTORS.includes(fees) ? fees : null,
    lossesCollector: typeof losses === "string" && LOSSES_COLLECTORS.includes(losses) ? losses : null,
  };
}

/** What the firm's Finance page, Settings and the pay check need from the account. */
export function accountStatus(account: Stripe.V2.Core.Account) {
  const capabilities = account.configuration?.merchant?.capabilities;
  return {
    livemode: account.livemode,
    cardPayments: status(capabilities?.card_payments?.status),
    payouts: status(capabilities?.stripe_balance?.payouts?.status),
    requirementsDue: account.requirements?.entries?.length ?? 0,
    requirements: accountRequirements(account),
    ...accountResponsibilities(account),
  };
}

export type AccountStatus = ReturnType<typeof accountStatus>;

export async function retrieveAccountStatus(stripe: Stripe, accountId: string) {
  const account = await stripe.v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant", "requirements", "defaults"] });
  return accountStatus(account);
}

/**
 * The arguments of public.sync_firm_payment_account_status for what Stripe reported: capability
 * statuses, open requirements and the account's responsibilities (left out when Stripe gave none,
 * so the stored ones stay).
 */
export function syncStatusArgs(organizationId: string, accountId: string, read: AccountStatus) {
  return {
    p_org: organizationId,
    p_account_id: accountId,
    p_card_payments_status: read.cardPayments,
    p_payouts_status: read.payouts,
    p_requirements: read.requirements,
    ...(read.feesCollector ? { p_fees_collector: read.feesCollector } : {}),
    ...(read.lossesCollector ? { p_losses_collector: read.lossesCollector } : {}),
  };
}

/**
 * Connect embedded components the firm owner may use (https://docs.stripe.com/api/account_sessions/create).
 * Only Stripe's onboarding and notification banner (identity and bank details stay with Stripe);
 * payments, payouts and the balance are Casevoya's own Payments tab.
 */
export const ACCOUNT_SESSION_COMPONENTS: Stripe.AccountSessionCreateParams.Components = {
  account_onboarding: { enabled: true, features: { external_account_collection: true } },
  notification_banner: { enabled: true, features: { external_account_collection: true } },
};
