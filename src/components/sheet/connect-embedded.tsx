"use client";

import { useState } from "react";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { startConnectOnboarding } from "@/modules/finance/actions";

/** Mounts Stripe Connect account onboarding and payouts in the in-app slots. */
export function ConnectEmbedded({ organizationId, status }: { organizationId: string; status: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function openPayouts() {
    setError(null);
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      setError("The publishable key is not set, so payout onboarding stays closed.");
      return;
    }
    const session = await startConnectOnboarding({ organizationId });
    if (session.error || !session.clientSecret) {
      setError(session.error ?? "Payout onboarding couldn’t be opened.");
      return;
    }
    const connect = loadConnectAndInitialize({
      publishableKey: key,
      fetchClientSecret: async () => session.clientSecret ?? "",
    });
    setOpen(true);
    const onboarding = document.getElementById("cv-connect-onboarding");
    const payouts = document.getElementById("cv-connect-payouts");
    if (onboarding) onboarding.replaceChildren(connect.create("account-onboarding"));
    if (payouts) payouts.replaceChildren(connect.create("payouts"));
  }

  return (
    <div className="panel">
      <h2>Payouts</h2>
      <p>Status {status ?? "not started"}. Onboarding and payouts stay inside Casevoya.</p>
      <div className="panel" data-slot="designer">
        <div className="emp">
          <b>Connect screens</b>
          <small>The designer Connect screens are not separate sources on main. The embedded components mount in the slots below.</small>
        </div>
      </div>
      <button className="btn p sm" type="button" onClick={() => void openPayouts()}>Open payout account</button>
      {error ? <p role="alert">{error}</p> : null}
      <div id="cv-connect-onboarding" hidden={!open} />
      <div id="cv-connect-payouts" hidden={!open} />
    </div>
  );
}
