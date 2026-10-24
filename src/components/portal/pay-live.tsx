"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type Appearance } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { createInvoicePayment } from "@/modules/portal/actions";
import type { PortalInvoice } from "@/modules/finance/portal-load";
import { formatAmount, formatMoney } from "@/modules/finance/money";
import { PAY_CSS } from "./pay-css";

const SPRITE = "/assets/icons-coreui/sprite.svg";

const APPEARANCE: Appearance = {
  theme: "flat",
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

const FORM = "cv-pay-form";

function Icon({ name }: { name: string }) {
  return (
    <svg className="ic s" aria-hidden="true">
      <use href={`${SPRITE}#i-${name}`} />
    </svg>
  );
}

function Sep() {
  return <span className="sep" aria-hidden="true"></span>;
}

function dueLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString("en-CA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

type Started = { clientSecret: string; stripeAccount: string } | { error: string } | null;

/**
 * The Designer's pay page (`markup/portal-pay.tsx`) for one real invoice. The card form is Stripe's
 * Payment Element, mounted in the Designer's `#cv-payment` slot; the PaymentIntent is a direct
 * charge on the firm's connected account. Confirmation stays in the page (3-D Secure opens in
 * Stripe's own modal). TEST MODE ONLY. The invoice turns paid only when Stripe's webhook says so.
 */
export function PayLive({
  invoice,
  organizationId,
  firmName,
  billedTo,
  publishableKey,
  payable,
}: {
  invoice: PortalInvoice;
  organizationId: string;
  firmName: string;
  billedTo: string;
  publishableKey: string | null;
  payable: boolean;
}) {
  const due = Math.max(0, invoice.amountCents - invoice.paidCents - invoice.creditedCents);
  const money = formatMoney(due, invoice.currency);
  // FIN-09: a payment the firm recorded by hand is being checked; paying again by card could pay twice.
  const pending = invoice.pendingCents ?? 0;
  const canPay = payable && Boolean(publishableKey) && invoice.open && !invoice.processing && pending === 0;
  const [started, setStarted] = useState<Started>(null);

  useEffect(() => {
    if (!canPay) return;
    let live = true;
    void createInvoicePayment({ organizationId, invoiceId: invoice.id }).then((result) => {
      if (live) setStarted("error" in result ? { error: result.error } : { clientSecret: result.clientSecret, stripeAccount: result.stripeAccount });
    });
    return () => {
      live = false;
    };
  }, [canPay, organizationId, invoice.id]);

  const account = started && "stripeAccount" in started ? started.stripeAccount : null;
  const stripePromise = useMemo(() => (publishableKey && account ? loadStripe(publishableKey, { stripeAccount: account }) : null), [publishableKey, account]);

  return (
    <div id="pc">
      <style dangerouslySetInnerHTML={{ __html: PAY_CSS }} />
      <a className="lbl" href="/portal/payments" style={{ display: "inline-flex", gap: "6px", alignItems: "center", marginBottom: "12px" }}>
        <Icon name="chevron-left" />
        {"Payments"}
      </a>
      <div className="ph pp-h rv" style={{ "--i": "0" } as React.CSSProperties}>
        <div>
          <h1 className="display">{`Pay ${firmName}`}</h1>
          <p>{`A secure card payment for your invoice. The money goes to ${firmName}, never to Casevoya.`}</p>
        </div>
      </div>
      <div className="pay rv" style={{ "--i": "1" } as React.CSSProperties}>
        <details className="sum" open id="sum">
          <summary>
            <span>
              <span className="lbl">
                {`Invoice ${invoice.number} `}
                <Sep />
                {invoice.paidCents ? " balance" : " total"}
              </span>
            </span>
            <span>
              <span className="tot num">{money}</span>{" "}
              <span className="ch">
                <Icon name="chevron-down" />
              </span>
            </span>
          </summary>
          <div className="firm" style={{ marginTop: "16px" }}>
            <b style={{ fontWeight: 500 }}>{firmName}</b>
          </div>
          <div className="meta">
            <span>{"Paid to"}</span>
            <b style={{ fontWeight: 400 }}>{firmName}</b>
            <span>{"For"}</span>
            <b style={{ fontWeight: 400 }}>{invoice.matterTitle}</b>
            <span>{"Billed to"}</span>
            <b style={{ fontWeight: 400 }}>{billedTo}</b>
            <span>{"Due"}</span>
            <b style={{ fontWeight: 400 }} className="num">
              {dueLabel(invoice.dueOn)}
            </b>
          </div>
          <table className="lines">
            <caption className="sr">{"Invoice lines"}</caption>
            <tbody>
              <tr>
                <td>{invoice.description}</td>
                <td>{formatAmount(invoice.amountCents, invoice.currency)}</td>
              </tr>
              {invoice.paidCents ? (
                <tr className="pd">
                  <td>{"Paid"}</td>
                  <td>{`-${formatAmount(invoice.paidCents, invoice.currency)}`}</td>
                </tr>
              ) : null}
              <tr className="tt">
                <td>
                  {"Balance due "}
                  <Sep />
                  {` ${invoice.currency}`}
                </td>
                <td>{formatAmount(due, invoice.currency)}</td>
              </tr>
            </tbody>
          </table>
          <p className="fine" style={{ textAlign: "left", marginTop: "14px" }}>
            {"Government fees are not on this invoice. You pay those to IRCC directly."}
          </p>
        </details>
        <div className="card" id="card">
          <h2 style={{ font: "400 20px/1.2 var(--font-erode)", margin: "0 0 14px" }}>{invoice.open ? `Pay ${money}` : invoice.state.label}</h2>
          {!invoice.open ? (
            <Note title={invoice.status === "paid" ? "This invoice is paid" : "This invoice is closed"}>{"Nothing is due on it."}</Note>
          ) : invoice.processing ? (
            <Note title="Your payment is processing">{"Stripe is confirming it with your bank. This page shows it paid once Stripe confirms."}</Note>
          ) : pending > 0 ? (
            <Note title="Your payment is being verified">
              {`${firmName} recorded a payment of ${formatMoney(pending, invoice.currency)} you sent by e-Transfer, cheque, wire or cash. It shows as paid once they’ve checked it against their bank. Contact them before paying again.`}
            </Note>
          ) : !payable || !publishableKey ? (
            <Note title="Card payments aren’t configured" tone="warn">
              {"Nothing can be charged here yet. Your firm can tell you other ways to pay."}
            </Note>
          ) : started && "error" in started ? (
            <Note title="The payment couldn’t start" tone="warn">
              {started.error}
            </Note>
          ) : started && stripePromise ? (
            <Elements stripe={stripePromise} options={{ clientSecret: started.clientSecret, appearance: APPEARANCE, fonts: [{ cssSrc: `${typeof window === "undefined" ? "" : window.location.origin}/fonts/erode.css` }] }}>
              <PayForm money={money} />
            </Elements>
          ) : (
            <p className="lbl">{"Loading the secure card form…"}</p>
          )}
          <p className="sec">
            <Icon name="lock" />
            <span>{`Secured by Stripe (test mode). Card details go straight to Stripe; ${firmName} and Casevoya never see your full card number.`}</span>
          </p>
        </div>
      </div>
      {canPay && started && "clientSecret" in started ? (
        <div className="paybar" role="region" aria-label="Pay">
          <div>
            <b className="num">{money}</b>
            <small>{`to ${firmName}`}</small>
          </div>
          <button className="btn p" id="go2" type="submit" form={FORM}>
            <span className="lab">{"Pay"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Note({ title, tone = "info", children }: { title: string; tone?: "info" | "warn"; children: React.ReactNode }) {
  return (
    <div className={`alert ${tone}`}>
      <svg className="ic" aria-hidden="true">
        <use href={`${SPRITE}#i-info`} />
      </svg>
      <div>
        <b>{title}</b>
        {children}
      </div>
    </div>
  );
}

function PayForm({ money }: { money: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | "succeeded" | "processing">(null);

  useEffect(() => {
    if (!done) return;
    // The webhook marks the invoice paid; refresh a few times to show it.
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      router.refresh();
      if (count >= 6) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [done, router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements || busy || done) return;
    setBusy(true);
    setError(null);
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Check the card details.");
      setBusy(false);
      return;
    }
    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: window.location.href },
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "The bank didn’t confirm this payment. Nothing was charged.");
      return;
    }
    const status = result.paymentIntent?.status;
    if (status === "succeeded" || status === "processing") setDone(status);
  };

  if (done) {
    return (
      <div className="done">
        <h2>{done === "succeeded" ? "Payment sent" : "Payment processing"}</h2>
        <p>{"Stripe has your payment. Your invoice shows paid as soon as Stripe confirms it to your firm, usually within a minute."}</p>
        <a className="btn" href="/portal/payments" style={{ marginTop: "14px" }}>
          {"Back to payments"}
        </a>
      </div>
    );
  }

  return (
    <form id={FORM} onSubmit={submit}>
      <div className="pe" id="cv-payment">
        <div className="w">
          <PaymentElement options={{ layout: { type: "accordion", defaultCollapsed: false, radios: "never", spacedAccordionItems: false } }} />
        </div>
      </div>
      {error ? (
        <p className="err" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
        </p>
      ) : null}
      <button className={busy ? "btn p gobtn inl is-loading" : "btn p gobtn inl"} id="go" type="submit" disabled={!stripe || busy} aria-busy={busy || undefined}>
        <span className="lab">{busy ? "Paying…" : `Pay ${money}`}</span>
      </button>
      <p className="fine">{"By paying you agree to your firm’s payment terms in your service agreement."}</p>
    </form>
  );
}
