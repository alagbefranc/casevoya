import { readCatalog, type Catalog } from "@/modules/subscription/catalog";

/**
 * public.public_pricing(): the catalog with the trial and the founding offer, as the public
 * /pricing page and the Choose a plan dialog show them. Pure; anything malformed reads as absent.
 */
export type PublicPricing = {
  catalog: Catalog | null;
  trialDays: number;
  cardRequired: boolean;
  founding: { percent: number; months: number; maxFirms: number | null } | null;
};

function int(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function readPublicPricing(value: unknown): PublicPricing {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const offer = row.founding_offer && typeof row.founding_offer === "object" ? (row.founding_offer as Record<string, unknown>) : null;
  const percent = int(offer?.percent_off, 1, 99);
  const months = int(offer?.months, 1, 60);
  return {
    catalog: readCatalog(row.catalog),
    trialDays: int(row.trial_days, 0, 365) ?? 0,
    cardRequired: row.card_required === true,
    founding: offer?.active === true && percent && months ? { percent, months, maxFirms: int(offer.max_firms, 1, 100_000) } : null,
  };
}

/** Whole cents after the founding discount, rounded as Stripe rounds a percent-off coupon. */
export function foundingCents(cents: number, percent: number): number {
  return Math.round((cents * (100 - percent)) / 100);
}

/**
 * The disclosure under a plan: what is charged today and when billing starts. Amounts are before
 * taxes; the page says "+ applicable taxes" next to every price.
 */
export function trialDisclosure(input: { amount: string; trialDays: number; billedOn: string | null }): string {
  if (input.trialDays <= 0 || !input.billedOn) return `Billed ${input.amount} today, + applicable taxes. Cancel anytime.`;
  return `$0 today, billed ${input.amount} on ${input.billedOn} unless you cancel; cancel anytime. + applicable taxes.`;
}
