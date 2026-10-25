"use client";

import { goStepUp } from "@/lib/auth/step-up-resume";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { loadConnectAndInitialize, type StripeConnectInstance } from "@stripe/connect-js/pure";
import { ConnectAccountOnboarding, ConnectComponentsProvider, ConnectNotificationBanner } from "@stripe/react-connect-js";
import { Icon, Sep } from "@/components/sheet/designer/frame";
import { Badge } from "@/components/sheet/designer/matters";
import type { ConnectCardData, FinanceAccountData } from "@/modules/finance/connect-present";
import { connectStripeAccount, createAccountSession, refreshStripeAccount } from "@/modules/finance/staff-actions";
import { financeNeedsStepUp, financeStepUpLocation } from "@/modules/sheet/finance-present";

/** The Designer dialog that holds Stripe's onboarding, and the `?dlg=` value that reopens it after step-up. */
export const STRIPE_DIALOG = "dlgStripe";
const STRIPE_DIALOG_PARAM = "stripe";

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

/** The Designer's banner (`.alert` in the slot of its "bank payment to verify" banner), with an optional action. */
function Banner({ tone, icon, title, children, action }: { tone: "warn" | "info" | "bad"; icon: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`alert ${tone} rv`} style={{ "--i": "1" } as React.CSSProperties}>
      <Icon name={icon} />
      <div>
        <b>{title}</b>
        {children}
      </div>
      {action ? <div className={"acts"}>{action}</div> : null}
    </div>
  );
}

function stepUp(dialog: string | null) {
  goStepUp(financeStepUpLocation(window.location.pathname, window.location.search, dialog, "payment_settings"));
}

/**
 * Stripe's onboarding (Connect embedded components) in the Designer's `.dlg`, shared by the
 * Finance banner and the Settings card: Connect.js loads only once the owner opens the dialog, a
 * step-up round trip reopens it (`?dlg=stripe`), and closing it reads the account from Stripe again.
 */
function useStripeOnboarding(data: FinanceAccountData) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [opened, setOpened] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const ready = data.account?.cardPayments === "active";
  const needsMore = Boolean(data.account) && (!ready || (data.account?.requirementsDue ?? 0) > 0);
  const canFinish = data.configured && data.isOwner && needsMore && Boolean(data.publishableKey);

  // Connect.js loads only once the owner opens the dialog: no account session on a plain visit.
  const instance = useMemo<StripeConnectInstance | null>(() => {
    if (!opened || !canFinish || !data.publishableKey) return null;
    return loadConnectAndInitialize({
      publishableKey: data.publishableKey,
      appearance: APPEARANCE,
      locale: "en-CA",
      fetchClientSecret: async () => {
        const result = await createAccountSession({ organizationId: data.organizationId });
        if ("error" in result) {
          if (financeNeedsStepUp(result.error)) stepUp(STRIPE_DIALOG_PARAM);
          else setError(result.error);
          throw new Error(result.error);
        }
        return result.clientSecret;
      },
    });
  }, [opened, canFinish, data.publishableKey, data.organizationId]);

  // Back from step-up with ?dlg=stripe: open the dialog again, then drop the flag.
  useEffect(() => {
    if (!canFinish) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("dlg") !== STRIPE_DIALOG_PARAM) return;
    url.searchParams.delete("dlg");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    const timer = window.setTimeout(() => {
      setOpened(true);
      if (dialog.current && !dialog.current.open) dialog.current.showModal();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [canFinish]);

  const create = () =>
    start(async () => {
      setError(null);
      const result = await connectStripeAccount({ organizationId: data.organizationId });
      if ("error" in result) {
        if (financeNeedsStepUp(result.error)) return stepUp(null);
        setError(result.error);
        return;
      }
      router.refresh();
    });

  // Closing the dialog (or leaving Stripe's onboarding), or Check with Stripe, re-reads the account from Stripe.
  const settle = () =>
    start(async () => {
      setError(null);
      const result = await refreshStripeAccount({ organizationId: data.organizationId });
      if ("error" in result) {
        if (financeNeedsStepUp(result.error)) return stepUp(null);
        setError(result.error);
      }
      router.refresh();
    });

  return { error, pending, ready, needsMore, canFinish, instance, dialog, open: () => setOpened(true), create, settle };
}

function OnboardingDialog({
  dialogRef,
  instance,
  onClose,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  instance: StripeConnectInstance | null;
  onClose: () => void;
}) {
  return (
    <dialog className={"dlg"} id={STRIPE_DIALOG} aria-labelledby={`${STRIPE_DIALOG}H`} ref={dialogRef} onClose={onClose}>
      <div className={"dh"}>
        <h2 id={`${STRIPE_DIALOG}H`}>{"Finish with Stripe"}</h2>
        <button className={"x"} type={"button"} aria-label={"Close"} data-close={STRIPE_DIALOG}>
          <Icon name={"close"} cls={"ic s"} />
        </button>
      </div>
      <div className={"db"}>
        {instance ? (
          <ConnectComponentsProvider connectInstance={instance}>
            <ConnectNotificationBanner />
            <ConnectAccountOnboarding onExit={() => dialogRef.current?.close()} />
          </ConnectComponentsProvider>
        ) : (
          <small className={"hint"}>{"Loading Stripe…"}</small>
        )}
      </div>
      <div className={"df"}>
        <button className={"btn"} type={"button"} data-close={STRIPE_DIALOG}>
          {"Close"}
        </button>
      </div>
    </dialog>
  );
}

/**
 * The firm's Stripe account on the Payments tab, shown only when something is needed:
 * - no account: the owner sets one up (test mode);
 * - card payments not active, or Stripe has requirements due: a banner whose "Finish with Stripe"
 *   opens Stripe's own onboarding and notification banner (Connect embedded components; Stripe
 *   collects the identity and bank details) inside the Designer's `.dlg`.
 * The full status (requirements, payouts, refund and loss liability) is the Settings card,
 * `StripeConnectCard`, built on the same hook. Payments, payouts and the balance are Casevoya's
 * own page. TEST MODE ONLY.
 */
export function StripeAccountStatus({ data }: { data: FinanceAccountData }) {
  const { error, pending, ready, needsMore, canFinish, instance, dialog, open, create, settle } = useStripeOnboarding(data);

  if (!data.canBill) return null;
  if (!data.configured) {
    return (
      <Banner tone={"warn"} icon={"info"} title={"Payments aren’t configured"}>
        {"This environment has no Stripe test keys, so card payments are off. Nothing can be charged. Invoices can still be issued."}
      </Banner>
    );
  }
  if (!data.isOwner) {
    if (!data.account || !ready) {
      return (
        <Banner tone={"info"} icon={"info"} title={"Card payments aren’t set up yet"}>
          {"The firm owner sets up the firm’s Stripe account on this tab."}
        </Banner>
      );
    }
    return needsMore ? (
      <Banner tone={"info"} icon={"info"} title={"Stripe needs more information"}>
        {"The firm owner finishes it with Stripe on this tab."}
      </Banner>
    ) : null;
  }
  if (!data.account) {
    return (
      <>
        <Banner
          tone={"info"}
          icon={"info"}
          title={"Set up card payments"}
          action={
            <button className={"btn p sm"} type={"button"} onClick={create} disabled={pending} aria-busy={pending || undefined}>
              {pending ? "Setting up…" : "Set up Stripe (test mode)"}
            </button>
          }
        >
          {`Casevoya creates a Stripe account for ${data.firmName} in test mode. You finish it here, in Casevoya; clients’ payments go to that account, never to Casevoya. You’ll confirm with your authenticator first.`}
        </Banner>
        {error ? (
          <Banner tone={"bad"} icon={"info"} title={"Not set up"}>
            {error}
          </Banner>
        ) : null}
      </>
    );
  }
  if (!canFinish) return null;

  return (
    <>
      <Banner
        tone={"warn"}
        icon={"bank"}
        title={"Stripe needs more information"}
        action={
          <button className={"btn p sm"} type={"button"} data-dlg={STRIPE_DIALOG} onClick={open} disabled={pending} aria-busy={pending || undefined}>
            {"Finish with Stripe"}
          </button>
        }
      >
        {ready
          ? "Card payments are on, but Stripe asks for more details to keep them and payouts running. Stripe collects them; in test mode use Stripe’s test values."
          : "Stripe needs the firm’s business and bank details before clients can pay by card. Stripe collects them; in test mode use Stripe’s test values."}
      </Banner>
      {error ? (
        <Banner tone={"bad"} icon={"info"} title={"Stripe"}>
          {error}
        </Banner>
      ) : null}
      <OnboardingDialog dialogRef={dialog} instance={instance} onClose={settle} />
    </>
  );
}

const STILL_NEEDS = "Stripe still needs";

/**
 * Settings > Subscription: the firm's Stripe account (FIN-02), one card. A live-only panel built
 * from the Designer's parts (`section.panel`, `h2` with its icon and badge, `.fp-pad`, `dl.fp-dl`,
 * `.fp-row` of `.btn`, `.fp-note`): not connected / onboarding incomplete (with Stripe's own list of
 * requirements) / charges enabled / payouts enabled, the refund and loss liability from the
 * account's configuration, and for the owner Set up, Continue onboarding (a recent step-up, then
 * Stripe's form) and Check with Stripe.
 */
export function StripeConnectCard({ data, card, index }: { data: FinanceAccountData; card: ConnectCardData; index: number }) {
  const { error, pending, canFinish, instance, dialog, open, create, settle } = useStripeOnboarding(data);
  return (
    <>
      <section className={"panel rv"} style={{ "--i": String(index) } as React.CSSProperties} id={"card-payments"} aria-label={"Card payments from clients"}>
        <h2>
          <Icon name={"credit-card"} />
          {"Card payments from clients"}
          <span style={{ marginLeft: "auto" }}>
            <Badge badge={card.badge} />
          </span>
        </h2>
        <div className={"fp-pad"}>
          {card.rows.length ? (
            <dl className={"fp-dl"}>
              {card.rows.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>
                    {term === STILL_NEEDS && card.requirements.length
                      ? card.requirements.map((line, n) => (
                          <Fragment key={n}>
                            {n > 0 ? <Sep /> : null}
                            {`${n > 0 ? " " : ""}${line}${n < card.requirements.length - 1 ? " " : ""}`}
                          </Fragment>
                        ))
                      : value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {card.actions.length ? (
            <div className={"fp-row"} style={{ marginTop: "12px" }}>
              {card.actions.map((action) =>
                action.act === "continue" ? (
                  <button
                    key={action.act}
                    className={action.primary ? "btn p sm" : "btn sm"}
                    type={"button"}
                    data-dlg={STRIPE_DIALOG}
                    onClick={open}
                    disabled={pending || !canFinish}
                    aria-busy={pending || undefined}
                  >
                    {action.label}
                  </button>
                ) : (
                  <button
                    key={action.act}
                    className={action.primary ? "btn p sm" : "btn sm"}
                    type={"button"}
                    onClick={action.act === "setup" ? create : settle}
                    disabled={pending}
                    aria-busy={pending || undefined}
                  >
                    {pending && action.act !== "setup" ? "Checking…" : action.label}
                  </button>
                ),
              )}
            </div>
          ) : null}
          {error ? (
            <div className={"alert bad"} style={{ margin: "12px 0 0" }} role={"alert"}>
              <Icon name={"x-circle"} />
              <div>
                <b>{"Stripe"}</b>
                {error}
              </div>
            </div>
          ) : null}
        </div>
      </section>
      <p className={"fp-note rv"} style={{ "--i": String(index + 1) } as React.CSSProperties}>
        <Icon name={"info"} cls={"ic s"} />
        {` ${card.note}`}
      </p>
      {canFinish ? <OnboardingDialog dialogRef={dialog} instance={instance} onClose={settle} /> : null}
    </>
  );
}
