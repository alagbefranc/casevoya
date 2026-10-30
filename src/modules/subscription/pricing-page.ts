import { money, PLAN_NAMES, type Catalog, type PaidPlan } from "@/modules/subscription/catalog";
import { foundingCents, trialDisclosure, type PublicPricing } from "@/modules/subscription/pricing";

/** One plan card on the public /pricing page, for each interval. Pure. */
export type PricingCard = {
  plan: PaidPlan;
  name: string;
  blurb: string;
  allowances: string[];
  month: PricingCardPrice;
  year: PricingCardPrice;
  featured: boolean;
};

export type PricingCardPrice = {
  /** "CAD 249" */
  price: string;
  /** "/month" or "/year" */
  per: string;
  /** Founding offer: "CAD 186.75/month for the first 12 months", or null. */
  founding: string | null;
  /** "2 months free" on annual. */
  saving: string | null;
  disclosure: string;
};

export type PricingPage = {
  cards: PricingCard[];
  extraSeat: string | null;
  trialDays: number;
  cardRequired: boolean;
  founding: { line: string } | null;
  billedOn: string | null;
};

const BLURBS: Record<PaidPlan, string> = {
  solo: "For a consultant working alone or with one assistant.",
  practice: "For a growing practice with a small team.",
  firm: "For established firms with several consultants.",
};

function longDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone }).format(date);
}

function price(catalog: Catalog, cents: number, per: "month" | "year", pricing: PublicPricing, billedOn: string | null, saving: string | null): PricingCardPrice {
  const founding = pricing.founding ? foundingCents(cents, pricing.founding.percent) : null;
  const first = founding ?? cents;
  return {
    price: money(cents, catalog.currency),
    per: `/${per}`,
    founding:
      pricing.founding && founding !== null
        ? `${money(founding, catalog.currency)}/${per} for the first ${pricing.founding.months} months with the founding-firm offer`
        : null,
    saving,
    disclosure: trialDisclosure({ amount: `${money(first, catalog.currency)}`, trialDays: pricing.trialDays, billedOn }),
  };
}

export function pricingPage(pricing: PublicPricing, now: Date, timeZone = "America/Toronto"): PricingPage | null {
  const catalog = pricing.catalog;
  if (!catalog) return null;
  const billedOn = pricing.trialDays > 0 ? longDay(new Date(now.getTime() + pricing.trialDays * 86_400_000), timeZone) : null;
  const free = 12 - catalog.annualMonths;
  const cards: PricingCard[] = [];
  for (const plan of ["solo", "practice", "firm"] as const) {
    const tier = catalog.plans[plan];
    if (!tier) continue;
    const allowances = [
      tier.seats ? `${tier.seats} staff seats` : null,
      tier.matters ? `${tier.matters.toLocaleString("en-CA")} active matters` : null,
      tier.storageGb ? `${tier.storageGb} GB document storage` : null,
      "Client portal, intake, e-signature, invoicing and Vo drafts",
    ].filter((line): line is string => Boolean(line));
    cards.push({
      plan,
      name: PLAN_NAMES[plan],
      blurb: BLURBS[plan],
      allowances,
      month: price(catalog, tier.monthlyCents, "month", pricing, billedOn, null),
      year: price(catalog, tier.monthlyCents * catalog.annualMonths, "year", pricing, billedOn, free > 0 ? `${free} months free` : null),
      featured: plan === "practice",
    });
  }
  return {
    cards,
    extraSeat: catalog.extraSeatMonthlyCents
      ? `Extra seats ${money(catalog.extraSeatMonthlyCents, catalog.currency)}/month or ${money(catalog.extraSeatMonthlyCents * catalog.annualMonths, catalog.currency)}/year each, + applicable taxes.`
      : null,
    trialDays: pricing.trialDays,
    cardRequired: pricing.cardRequired,
    founding: pricing.founding
      ? {
          line: `Founding-firm offer: ${pricing.founding.percent}% off your first ${pricing.founding.months} months${pricing.founding.maxFirms ? ` for the first ${pricing.founding.maxFirms} firms` : ""}. Applied automatically at checkout while places last.`,
        }
      : null,
    billedOn,
  };
}
