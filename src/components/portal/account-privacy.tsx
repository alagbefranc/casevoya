"use client";

import { useRef, useState, type CSSProperties } from "react";
import { toast2 } from "@/components/port/kit";
import { confirmMyTwoStep, setMyConsent, startMyTwoStep, turnOffMyTwoStep } from "@/modules/portal/account-actions";
import {
  consentCopy,
  PROCESSING_WITHDRAWAL_NOTE,
  twoStepCopy,
  withdrawalToast,
  type ConsentState,
  type PortalAccountExtras,
  type PortalConsentPurpose,
  type TwoStepState,
} from "@/modules/portal/account-present";

function Icon({ name }: { name: string }) {
  return (
    <svg className="ic s" aria-hidden="true">
      <use href={`/assets/icons-coreui/sprite.svg#i-${name}`}></use>
    </svg>
  );
}

/** "ABCD EFGH …" so the key is easier to type. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * SEC-01, live only: the client's two-step sign-in, a row in the Account page's "Signing in" panel.
 * The Designer has no such row or dialog, so it is the portal's `.li` row with a `.bd` badge and a
 * `.btn sm`, and the Designer's `.dlg` dialog (`.dh` / `.db` / `.df`, `.fld` / `.inp`).
 */
export function TwoStepRow({ organizationId, firm, state }: { organizationId: string; firm: string; state: TwoStepState | null }) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [mode, setMode] = useState<"on" | "off">("on");
  const [setup, setSetup] = useState<{ factorId: string; secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const copy = twoStepCopy(state, firm);
  const on = state === "ok" || state === "needs_check";

  const open = async () => {
    setCode("");
    if (on) {
      setMode("off");
      dialog.current?.showModal();
      return;
    }
    setMode("on");
    setBusy(true);
    const started = await startMyTwoStep();
    setBusy(false);
    if ("error" in started) {
      toast2("Two-step didn’t start", { kind: "warn", sub: started.error });
      return;
    }
    setSetup(started);
    dialog.current?.showModal();
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(code.trim())) {
      toast2("Enter the six-digit code", { kind: "warn", sub: "Use the newest code from your authenticator app." });
      return;
    }
    setBusy(true);
    const result =
      mode === "on" && setup
        ? await confirmMyTwoStep({ organizationId, factorId: setup.factorId, code: code.trim() })
        : await turnOffMyTwoStep({ organizationId, code: code.trim() });
    setBusy(false);
    if ("error" in result) {
      toast2(mode === "on" ? "Two-step isn’t on yet" : "Two-step is still on", { kind: "warn", sub: result.error });
      return;
    }
    dialog.current?.close();
    toast2(mode === "on" ? "Two-step sign-in is on" : "Two-step sign-in is off", {
      kind: "ok",
      sub: mode === "on" ? "You’ll be asked for a code each time you sign in." : "You sign in with your email and password only.",
    });
    // The page is read again so every row shows the stored state.
    window.setTimeout(() => window.location.reload(), 900);
  };

  return (
    <>
      <div className="li">
        <div>
          <b>Two-step sign-in</b>
          <small>{copy.detail}</small>
        </div>
        <span className="r">
          <span className={`bd ${copy.badge.tone}`}>
            <i></i>
            {copy.badge.label}
          </span>
          {state ? (
            <button className="btn sm" type="button" onClick={() => void open()} disabled={busy} aria-busy={busy || undefined}>
              {on ? "Turn off" : "Turn on"}
            </button>
          ) : null}
        </span>
      </div>
      <dialog className="dlg" id="dTwoStep" ref={dialog} aria-labelledby="dTwoStepH">
        <div className="dh">
          <h2 id="dTwoStepH">{mode === "on" ? "Turn on two-step sign-in" : "Turn off two-step sign-in"}</h2>
          <button className="x" type="button" aria-label="Close" onClick={() => dialog.current?.close()}>
            <Icon name="close" />
          </button>
        </div>
        <div className="db">
          {mode === "on" && setup ? (
            <>
              <p>Scan this with an authenticator app (for example Google Authenticator or 1Password), then enter the code it shows.</p>
              <img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} style={{ display: "block", margin: "8px auto" }} />
              <p className="lbl">
                Can’t scan? Type this key: <b className="num">{grouped(setup.secret)}</b>
              </p>
            </>
          ) : (
            <p>Turning two-step off is a high-risk change, so enter a code from your authenticator app first.</p>
          )}
          <div className="fld">
            <label htmlFor="tsC">Six-digit code</label>
            <input className="inp" id="tsC" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
          </div>
        </div>
        <div className="df">
          <button className="btn" type="button" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button className="btn p" type="button" onClick={() => void confirm()} disabled={busy} aria-busy={busy || undefined}>
            {mode === "on" ? "Turn on" : "Turn off"}
          </button>
        </div>
      </dialog>
    </>
  );
}

/**
 * SEC-05, live only: the client's optional consents, each saved at once for that purpose. The
 * switches are the portal's own `.k2-sw` (as on the notice choices); core processing is withdrawn
 * through the Designer's `.dlg`, which says plainly that nothing is deleted.
 */
export function ConsentsPanel({ organizationId, firm, consents }: { organizationId: string; firm: string; consents: NonNullable<PortalAccountExtras["consents"]> }) {
  const [state, setState] = useState<Record<PortalConsentPurpose, ConsentState>>(consents);
  const [busy, setBusy] = useState<PortalConsentPurpose | null>(null);
  const confirmDialog = useRef<HTMLDialogElement | null>(null);

  const save = async (purpose: PortalConsentPurpose, granted: boolean, button?: HTMLElement | null) => {
    setBusy(purpose);
    const result = await setMyConsent({ organizationId, purpose, granted });
    setBusy(null);
    if ("error" in result) {
      // The portal kit flips a switch on click; put it back to what is stored.
      button?.setAttribute("aria-checked", String(state[purpose] === true));
      toast2("Not saved", { kind: "warn", sub: result.error });
      return;
    }
    setState((current) => ({ ...current, [purpose]: result.granted }));
    if (result.granted) toast2("Saved", { kind: "ok", sub: "Recorded with today’s date." });
    else {
      const words = withdrawalToast(purpose, firm);
      toast2(words.title, { kind: "ok", sub: words.sub });
    }
  };

  const switchRow = (purpose: "ai_drafting" | "marketing") => {
    const copy = consentCopy(purpose, firm);
    const id = purpose === "ai_drafting" ? "consent-ai" : "consent-marketing";
    return (
      <div className="li" key={purpose}>
        <div>
          <b>{copy.label}</b>
          <small>{copy.detail}</small>
        </div>
        <span className="r">
          <button
            type="button"
            className="k2-sw"
            role="switch"
            id={id}
            aria-checked={state[purpose] === true}
            disabled={busy !== null}
            aria-busy={busy === purpose || undefined}
            onClick={(event) => void save(purpose, state[purpose] !== true, event.currentTarget)}
          >
            <span className="k2-th" aria-hidden="true" />
            <span className="k2-sr">{copy.label}</span>
          </button>
        </span>
      </div>
    );
  };

  const processing = consentCopy("processing", firm);
  const given = state.processing === true;
  return (
    <div className="panel rv" style={{ "--i": "4", marginTop: 22 } as CSSProperties}>
      <h2>
        <Icon name="privacy" />
        Your consents
      </h2>
      <div className="pad">
        {switchRow("ai_drafting")}
        {switchRow("marketing")}
        <div className="li">
          <div>
            <b>{processing.label}</b>
            <small>{processing.detail}</small>
          </div>
          <span className="r">
            <span className={`bd ${given ? "ok" : "gr"}`}>
              <i></i>
              {given ? "Given" : state.processing === false ? "Withdrawn" : "Not recorded"}
            </span>
            {given ? (
              <button className="btn sm" type="button" disabled={busy !== null} onClick={() => confirmDialog.current?.showModal()}>
                Withdraw
              </button>
            ) : (
              <button className="btn sm" type="button" disabled={busy !== null} aria-busy={busy === "processing" || undefined} onClick={() => void save("processing", true)}>
                Give consent
              </button>
            )}
          </span>
        </div>
        <p className="lbl" style={{ marginTop: 10 }}>
          Each change is saved at once and recorded with the date. Withdrawing a consent never deletes records {firm} must keep.
        </p>
      </div>
      <dialog className="dlg" id="dWithdraw" ref={confirmDialog} aria-labelledby="dWithdrawH">
        <div className="dh">
          <h2 id="dWithdrawH">Withdraw consent?</h2>
          <button className="x" type="button" aria-label="Close" onClick={() => confirmDialog.current?.close()}>
            <Icon name="close" />
          </button>
        </div>
        <div className="db">
          <p>{`${firm} may not be able to keep working on your application without it.`}</p>
          <p>{PROCESSING_WITHDRAWAL_NOTE}</p>
        </div>
        <div className="df">
          <button className="btn" type="button" onClick={() => confirmDialog.current?.close()}>
            Keep consent
          </button>
          <button
            className="btn p"
            type="button"
            disabled={busy !== null}
            aria-busy={busy === "processing" || undefined}
            onClick={() => {
              confirmDialog.current?.close();
              void save("processing", false);
            }}
          >
            Withdraw
          </button>
        </div>
      </dialog>
    </div>
  );
}
