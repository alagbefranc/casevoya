"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadConnectAndInitialize, type StripeConnectInstance } from "@stripe/connect-js/pure";
import {
  ConnectAccountManagement,
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
  ConnectPayments,
  ConnectPayouts,
} from "@stripe/react-connect-js";
import type { FinanceAccountData } from "@/modules/sheet/finance-load";
import { connectStripeAccount, createAccountSession, refreshStripeAccount } from "@/modules/finance/staff-actions";
import { financeNeedsStepUp, financeStepUpLocation } from "@/modules/sheet/finance-present";

const SPRITE = "/assets/icons-coreui/sprite.svg";

function Alert({ tone, title, children }: { tone: "warn" | "info" | "bad"; title: string; children?: React.ReactNode }) {
  return (
    <div className={`alert ${tone}`} style={{ marginBottom: "14px" }}>
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

const APPEARANCE = {
  overlays: "dialog" as const,
  variables: {
    colorPrimary: "#0075DE",
    colorText: "#111111",
    colorDanger: "#c4382b",
    borderRadius: "10px",
    fontFamily: "Inter, system-ui, sans-serif",
  },
};

function noop() {
  return () => {};
}

function stepUp() {
  window.location.assign(financeStepUpLocation(window.location.pathname, window.location.search, null));
}

/**
 * The firm's Stripe account through Connect embedded components (onboarding, notification banner,
 * account management, payments, payouts). No Stripe-hosted page and no redirect: Stripe may open
 * its own sign-in popup when it needs the account holder to authenticate. TEST MODE ONLY.
 */
export function StripeConnectPanel({ data }: { data: FinanceAccountData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const hasAccount = Boolean(data.account);
  const ready = data.account?.cardPayments === "active";
  // Connect.js runs in the browser only; the server renders the loading line.
  const browser = useSyncExternalStore(noop, () => true, () => false);
  const enabled = browser && data.isOwner && hasAccount && Boolean(data.publishableKey);
  const instance = useMemo<StripeConnectInstance | null>(() => {
    if (!enabled || !data.publishableKey) return null;
    return loadConnectAndInitialize({
      publishableKey: data.publishableKey,
      appearance: APPEARANCE,
      locale: "en-CA",
      fetchClientSecret: async () => {
        const result = await createAccountSession({ organizationId: data.organizationId });
        if ("error" in result) {
          if (financeNeedsStepUp(result.error)) stepUp();
          else setError(result.error);
          throw new Error(result.error);
        }
        return result.clientSecret;
      },
    });
  }, [enabled, data.publishableKey, data.organizationId]);

  if (!data.configured) {
    return (
      <Alert tone="warn" title="Payments aren’t configured">
        {"This environment has no Stripe test keys, so card payments are off. Nothing can be charged. Invoices can still be issued."}
      </Alert>
    );
  }
  if (!data.isOwner) {
    return (
      <Alert tone="info" title={ready ? "Card payments are on" : "Card payments aren’t set up yet"}>
        {ready ? "Clients pay invoices by card in their portal (Stripe test mode)." : "The firm owner sets up the firm’s Stripe account here."}
      </Alert>
    );
  }
  if (!hasAccount) {
    const create = () =>
      start(async () => {
        setError(null);
        const result = await connectStripeAccount({ organizationId: data.organizationId });
        if ("error" in result) {
          if (financeNeedsStepUp(result.error)) return stepUp();
          setError(result.error);
          return;
        }
        router.refresh();
      });
    return (
      <>
        <Alert tone="info" title="Set up card payments">
          {`Casevoya creates a Stripe account for ${data.firmName} in test mode. You finish it here, in Casevoya; clients’ payments go to that account, never to Casevoya. You’ll confirm with your authenticator first.`}
        </Alert>
        {error ? <Alert tone="bad" title="Not set up">{error}</Alert> : null}
        <button className="btn p" type="button" onClick={create} disabled={pending} aria-busy={pending || undefined}>
          {pending ? "Setting up…" : "Set up Stripe (test mode)"}
        </button>
      </>
    );
  }
  if (!instance) return <p className="lbl">{"Loading your Stripe account…"}</p>;

  const settle = () =>
    start(async () => {
      const result = await refreshStripeAccount({ organizationId: data.organizationId });
      if ("error" in result) setError(result.error);
      router.refresh();
    });

  return (
    <ConnectComponentsProvider connectInstance={instance}>
      {error ? <Alert tone="bad" title="Stripe">{error}</Alert> : null}
      <ConnectNotificationBanner />
      {ready ? (
        <>
          <h2 style={{ margin: "8px 0 12px" }}>{"Payments"}</h2>
          <ConnectPayments />
          <h2 style={{ margin: "24px 0 12px" }}>{"Payouts"}</h2>
          <ConnectPayouts />
          <h2 style={{ margin: "24px 0 12px" }}>{"Account"}</h2>
          <ConnectAccountManagement />
        </>
      ) : (
        <>
          <Alert tone="info" title="Finish the Stripe account">
            {"Stripe needs the firm’s business and bank details before clients can pay by card. In test mode use Stripe’s test values."}
          </Alert>
          <ConnectAccountOnboarding onExit={settle} />
        </>
      )}
    </ConnectComponentsProvider>
  );
}
