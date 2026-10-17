"use client";

import { useRef, useState } from "react";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { createPlatformPaymentIntent } from "@/modules/finance/actions";
import { formatCents } from "@/modules/finance/money";
import type { FinancePlan, FinanceSnapshot } from "@/modules/finance/load";

function yearly(plan: FinancePlan, bps: number | null): number | null {
  if (plan.monthlyCents == null || bps == null) return null;
  return Math.floor((plan.monthlyCents * 12 * (10000 - bps)) / 10000);
}

/** Firm plan payment. The amount comes from the catalog snapshot, then a PaymentIntent. */
export function PlanPay({ organizationId, snapshot }: { organizationId: string; snapshot: FinanceSnapshot }) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [plan, setPlan] = useState(snapshot.subscriptionPlan ?? snapshot.plans.find((item) => !item.quoted)?.code ?? "");
  const [interval, setInterval] = useState(snapshot.subscriptionInterval ?? "month");
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);

  async function pay() {
    setError(null);
    if (stripeRef.current && elementsRef.current) {
      const confirmed = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });
      if (confirmed.error) setError(confirmed.error.message ?? "The bank didn’t confirm this payment.");
      return;
    }
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      setError("The publishable key is not set.");
      return;
    }
    const intent = await createPlatformPaymentIntent({ organizationId, planCode: plan, interval });
    if (intent.error || !intent.clientSecret) {
      setError(intent.error ?? "The plan payment couldn’t be opened.");
      return;
    }
    const stripe = await loadStripe(key);
    if (!stripe) return;
    const elements = stripe.elements({ clientSecret: intent.clientSecret });
    const slot = document.getElementById("cv-plan-payment");
    if (!slot) return;
    slot.replaceChildren();
    elements.create("payment").mount(slot);
    stripeRef.current = stripe;
    elementsRef.current = elements;
    setReady(true);
  }

  return (
    <div className="panel">
      <h2>Firm plan</h2>
      <p>
        {snapshot.subscriptionStatus ?? "trial"}
        {snapshot.subscriptionAmountCents != null ? ` · ${formatCents(snapshot.subscriptionAmountCents, snapshot.currency)}` : ""}
        {snapshot.extraSeatMonthlyCents != null ? ` · extra seat ${formatCents(snapshot.extraSeatMonthlyCents, snapshot.currency)}` : ""}
      </p>
      <div className="tabs" role="tablist">
        {snapshot.plans.map((item) => (
          <button key={item.code} type="button" role="tab" aria-selected={plan === item.code} className={plan === item.code ? "on" : ""} onClick={() => setPlan(item.code)}>
            {item.code}
            {item.quoted ? " · quoted" : item.monthlyCents != null ? ` · ${formatCents(item.monthlyCents, snapshot.currency)}` : ""}
          </button>
        ))}
      </div>
      <label className="fld">Interval
        <select value={interval} onChange={(event) => setInterval(event.target.value)}>
          <option value="month">Monthly</option>
          <option value="year">Yearly{plan ? "" : ""}</option>
        </select>
      </label>
      {snapshot.plans.filter((item) => item.code === plan && !item.quoted).map((item) => (
        <p key={item.code}>
          {interval === "year" && yearly(item, snapshot.annualDiscountBps) != null
            ? formatCents(yearly(item, snapshot.annualDiscountBps) ?? 0, snapshot.currency)
            : item.monthlyCents != null ? formatCents(item.monthlyCents, snapshot.currency) : "Quoted"}
          {item.seats != null ? ` · ${item.seats} seats` : ""}
          {item.activeMatters != null ? ` · ${item.activeMatters} matters` : ""}
        </p>
      ))}
      <button className="btn p sm" type="button" onClick={() => void pay()} disabled={!plan}>{ready ? "Confirm plan payment" : "Open plan payment"}</button>
      {error ? <p role="alert">{error}</p> : null}
      <div id="cv-plan-payment" />
    </div>
  );
}
