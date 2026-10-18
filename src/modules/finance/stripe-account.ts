import "server-only";
import type Stripe from "stripe";

/**
 * The firm's connected account, Accounts v2 (https://docs.stripe.com/connect/saas/tasks/create).
 *
 * Design (TEST MODE ONLY):
 * - Merchant configuration with card_payments: the firm accepts its own clients' card payments.
 * - Stripe collects its fees from the firm and is responsible for losses (fees_collector and
 *   losses_collector "stripe", Managed Risk). That needs direct charges, which is what a SaaS
 *   platform uses: the charge is the firm's, on the firm's account (FIN-02).
 * - Dashboard "none" by default: the firm manages the account through Connect embedded
 *   components in Casevoya (onboarding, account management, notification banner, payments,
 *   payouts), never a Stripe-hosted page. STRIPE_CONNECT_DASHBOARD=full gives the firm Stripe
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
      responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
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

/** What the firm's Finance page and the pay check need from the account. */
export function accountStatus(account: Stripe.V2.Core.Account) {
  const capabilities = account.configuration?.merchant?.capabilities;
  return {
    livemode: account.livemode,
    cardPayments: status(capabilities?.card_payments?.status),
    payouts: status(capabilities?.stripe_balance?.payouts?.status),
    requirementsDue: account.requirements?.entries?.length ?? 0,
  };
}

export async function retrieveAccountStatus(stripe: Stripe, accountId: string) {
  const account = await stripe.v2.core.accounts.retrieve(accountId, { include: ["configuration.merchant", "requirements"] });
  return accountStatus(account);
}

/** Connect embedded components the firm owner may use (https://docs.stripe.com/api/account_sessions/create). */
export const ACCOUNT_SESSION_COMPONENTS: Stripe.AccountSessionCreateParams.Components = {
  account_onboarding: { enabled: true, features: { external_account_collection: true } },
  account_management: { enabled: true, features: { external_account_collection: true } },
  notification_banner: { enabled: true, features: { external_account_collection: true } },
  payments: { enabled: true, features: { refund_management: true, dispute_management: true, capture_payments: true } },
  payouts: { enabled: true, features: { instant_payouts: false, standard_payouts: true, edit_payout_schedule: true, external_account_collection: true } },
};
