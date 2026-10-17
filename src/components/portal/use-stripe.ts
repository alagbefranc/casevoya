"use client";

import { useEffect, type RefObject } from "react";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { toast2 } from "@/components/port/kit";
import { createPortalPaymentIntent } from "@/modules/portal/actions";

const APPEARANCE = {
  theme: "flat" as const,
  variables: {
    colorPrimary: "#0075DE",
    colorBackground: "#ffffff",
    colorText: "#111111",
    colorDanger: "#c4382b",
    borderRadius: "10px",
    fontFamily: "Erode, Georgia, serif",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": { border: "1px solid #c9c5c0" },
    ".Input:focus": { boxShadow: "0 0 0 3px rgba(0,117,222,.18)" },
  },
};

/**
 * Mounts Stripe's Payment Element and Express Checkout Element in the designed slots.
 * Without NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY the stand-in fields stay.
 * Confirming still needs a PaymentIntent from createPortalPaymentIntent, which is stubbed.
 */
export function useStripePay(ref: RefObject<HTMLElement | null>, page: string) {
  useEffect(() => {
    if (page !== "pay") return;
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const root = ref.current;
    const state = new URLSearchParams(location.search).get("state") || "ready";
    if (!key || !root || state !== "ready") return;
    const paymentSlot = root.querySelector<HTMLElement>("#cv-payment");
    const expressSlot = root.querySelector<HTMLElement>("#cv-express");
    if (!paymentSlot || !expressSlot || root.dataset.stripe === "1") return;

    let stripe: Stripe | null = null;
    let elements: StripeElements | null = null;
    let cancelled = false;

    const pay = async () => {
      if (!stripe || !elements) return;
      root.querySelector("#card")?.classList.add("busy");
      const { error: submitError } = await elements.submit();
      root.querySelector("#card")?.classList.remove("busy");
      if (submitError) {
        toast2(submitError.message || "Check the card details.", { kind: "bad" });
        return;
      }
      const intent = await createPortalPaymentIntent({
        amountCents: 113_000,
        currency: "cad",
        description: "Invoice balance",
      });
      if (!intent.clientSecret) {
        toast2("Payment isn’t connected yet", {
          sub: "Nothing was charged. Invoices will create the PaymentIntent.",
        });
        return;
      }
      const confirmed = await stripe.confirmPayment({
        elements,
        clientSecret: intent.clientSecret,
        confirmParams: { return_url: location.href },
        redirect: "if_required",
      });
      if (confirmed.error) toast2(confirmed.error.message || "The bank didn’t confirm this payment.", { kind: "bad" });
    };

    void (async () => {
      stripe = await loadStripe(key);
      if (!stripe || cancelled) return;
      elements = stripe.elements({
        mode: "payment",
        amount: 113_000,
        currency: "cad",
        appearance: APPEARANCE,
        fonts: [{ cssSrc: `${location.origin}/fonts/erode.css` }],
      });
      expressSlot.replaceChildren();
      paymentSlot.replaceChildren();
      elements.create("expressCheckout").mount(expressSlot);
      elements.create("payment", {
        layout: { type: "accordion", defaultCollapsed: false, radios: "never", spacedAccordionItems: false },
        wallets: { applePay: "never", googlePay: "never", link: "never" },
      }).mount(paymentSlot);
      if (cancelled) return;
      root.dataset.stripe = "1";
      root.querySelector("#go")?.addEventListener("click", () => void pay());
      root.querySelector("#go2")?.addEventListener("click", () => void pay());
    })();

    return () => {
      cancelled = true;
    };
  }, [page, ref]);
}
