import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BOOK_PAGE_CSS } from "@/components/sheet/designer/book";
import { QuietSheet } from "@/components/sheet/live";
import { SheetScreen } from "@/components/sheet/screen";
import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { pricingPage, type PricingCard, type PricingCardPrice } from "@/modules/subscription/pricing-page";
import { readPublicPricing } from "@/modules/subscription/pricing";

export const metadata: Metadata = {
  title: "Pricing · Casevoya",
  description: "Casevoya plans for Canadian immigration consultants: Solo, Practice and Firm. 14-day free trial, cancel anytime.",
};

const TIME_ZONE = "America/Toronto";

/** The annual toggle is two radio buttons and CSS: no script, so the page works under the strict CSP. */
const CSS = `
.pr-toggle{display:inline-flex;border:1px solid #d9d5cf;border-radius:999px;padding:3px;margin:18px 0 6px}
.pr-toggle input{position:absolute;opacity:0;pointer-events:none}
.pr-toggle label{padding:6px 16px;border-radius:999px;cursor:pointer;font-size:14px}
#pr-m:checked~.pr-toggle label[for=pr-m],#pr-y:checked~.pr-toggle label[for=pr-y]{background:#1f1d1b;color:#fff}
#pr-m:focus-visible~.pr-toggle label[for=pr-m],#pr-y:focus-visible~.pr-toggle label[for=pr-y]{outline:2px solid #2f6fdf;outline-offset:2px}
.pr-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:18px}
.pr-card{border:1px solid #e6e3df;border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:8px;background:#fff}
.pr-card.f{border-color:#1f1d1b}
.pr-card h2{font-size:20px;margin:0}
.pr-amt{font-size:28px;font-weight:600}
.pr-amt small{font-size:14px;font-weight:400;color:#615d59}
.pr-sm{font-size:13px;color:#615d59;line-height:1.45;margin:0}
.pr-card ul{margin:4px 0;padding-left:18px;font-size:14px;line-height:1.5}
.pr-cta{margin-top:auto;display:inline-block;text-align:center;padding:10px 14px;border-radius:10px;background:#1f1d1b;color:#fff;text-decoration:none;font-weight:500}
.pr-y{display:none}
#pr-y:checked~.pr-cards .pr-y{display:block}
#pr-y:checked~.pr-cards .pr-m{display:none}
.pr-offer{margin-top:14px;padding:10px 14px;border-radius:10px;background:#f6f1e7;font-size:14px}
`;

function Price({ price, cls }: { price: PricingCardPrice; cls: string }) {
  return (
    <div className={cls}>
      <div className="pr-amt">
        {price.price}
        <small>{`${price.per} + applicable taxes`}</small>
      </div>
      {price.saving ? <p className="pr-sm">{price.saving}</p> : null}
      {price.founding ? <p className="pr-sm">{price.founding}</p> : null}
      <p className="pr-sm" data-disclosure={"1"}>
        {price.disclosure}
      </p>
    </div>
  );
}

function Card({ card, trialDays }: { card: PricingCard; trialDays: number }) {
  return (
    <section className={card.featured ? "pr-card f" : "pr-card"} data-plan={card.plan}>
      <h2>{card.name}</h2>
      <p className="pr-sm">{card.blurb}</p>
      <Price price={card.month} cls="pr-m" />
      <Price price={card.year} cls="pr-y" />
      <ul>
        {card.allowances.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <Link className="pr-cta" href="/start-trial">
        {trialDays > 0 ? `Start ${trialDays}-day free trial` : "Get started"}
      </Link>
    </section>
  );
}

async function Body() {
  let raw: unknown = null;
  if (hasPublicSupabaseEnv()) {
    try {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("public_pricing");
      raw = error ? null : data;
    } catch {
      raw = null;
    }
  }
  const page = raw ? pricingPage(readPublicPricing(raw), new Date(), TIME_ZONE) : null;
  if (!page) {
    return (
      <SheetScreen page="book" tone="public">
        <QuietSheet title="Pricing" copy="Prices couldn’t be read just now. Try again in a moment." />
      </SheetScreen>
    );
  }
  return (
    <SheetScreen page="book" tone="public">
      <style dangerouslySetInnerHTML={{ __html: BOOK_PAGE_CSS + CSS }} />
      <div className="pb">
        <header>
          <Link href="/" style={{ color: "inherit", textDecoration: "none" }}>
            Casevoya
          </Link>
        </header>
        <main id="m" style={{ display: "block", maxWidth: "1000px" }}>
          <h1>Pricing</h1>
          <p className="lead">
            {page.trialDays > 0
              ? `Every plan starts with a ${page.trialDays}-day free trial. ${page.cardRequired ? "Add a card to start; $0 today. " : ""}Cancel anytime. Prices in Canadian dollars.`
              : "Prices in Canadian dollars. Cancel anytime."}
          </p>
          <input type="radio" name="pr-i" id="pr-m" defaultChecked />
          <input type="radio" name="pr-i" id="pr-y" />
          <div className="pr-toggle" role="group" aria-label="Billing interval">
            <label htmlFor="pr-m">Monthly</label>
            <label htmlFor="pr-y">Annual</label>
          </div>
          {page.founding ? <p className="pr-offer">{page.founding.line}</p> : null}
          <div className="pr-cards">
            {page.cards.map((card) => (
              <Card key={card.plan} card={card} trialDays={page.trialDays} />
            ))}
            <section className="pr-card" data-plan="enterprise">
              <h2>Enterprise</h2>
              <p className="pr-sm">For large firms and networks: more seats, custom terms, onboarding help.</p>
              <div className="pr-amt">Let’s talk</div>
              <ul>
                <li>Seats and storage arranged with you</li>
                <li>Invoiced billing</li>
              </ul>
              <a className="pr-cta" href="mailto:hello@casevoya.ca?subject=Casevoya%20Enterprise">
                Contact us
              </a>
            </section>
          </div>
          <div style={{ marginTop: "22px", display: "grid", gap: "6px", color: "#615d59", fontSize: "14px", lineHeight: 1.5 }}>
            {page.extraSeat ? <p style={{ margin: 0 }}>{page.extraSeat}</p> : null}
            <p style={{ margin: 0 }}>
              {page.trialDays > 0 && page.billedOn
                ? `Start today and pay $0 now: you are billed on ${page.billedOn} unless you cancel; cancel anytime in Settings > Subscription. One free trial per firm.`
                : "Cancel anytime in Settings > Subscription."}
            </p>
            <p style={{ margin: 0 }}>
              {"Prices exclude GST/HST/QST, which are added at checkout where they apply. Payment by Stripe; Casevoya never sees or stores your card. "}
              <a href="https://casevoya.ca/terms/">Terms</a>
              {" · "}
              <a href="https://casevoya.ca/privacy/">Privacy</a>
            </p>
          </div>
        </main>
        <footer>
          <span>Casevoya</span>
          <span>Dates in Eastern time</span>
        </footer>
      </div>
    </SheetScreen>
  );
}

/** The public price list (card trial, 20261101100100): the catalog, trial and founding offer from public.public_pricing. */
export default function PricingPageRoute() {
  return (
    <Suspense fallback={<SheetScreen page="book" tone="public"><QuietSheet title="Pricing" copy="Loading…" /></SheetScreen>}>
      <Body />
    </Suspense>
  );
}
