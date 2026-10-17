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
 * A live invoice puts its amount on #cv-payment. The demo markup has no invoice id, so it stays a preview.
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
    const invoiceId = paymentSlot.dataset.invoiceId;
    const organizationId = paymentSlot.dataset.organizationId;
    const amountCents = Number(paymentSlot.dataset.amountCents || "113000");
    const currency = (paymentSlot.dataset.currency || "cad").toLowerCase();

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
        organizationId,
        invoiceId,
        amountCents,
        currency,
        description: "Invoice balance",
      });
      if (!intent.clientSecret) {
        const sub = intent.reason === "advance_card_disabled"
          ? "Advances stay a bank transfer until the firm verifies them. Nothing was charged."
          : intent.reason === "connect_required"
            ? "The firm’s payout account is not enabled yet. Nothing was charged."
            : "Nothing was charged. A live invoice creates the PaymentIntent.";
        toast2("Payment isn’t connected yet", { sub });
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
        amount: amountCents,
        currency,
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
