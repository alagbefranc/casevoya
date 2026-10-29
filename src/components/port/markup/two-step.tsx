"use client";

import { useState } from "react";
import { toast2 } from "../kit";
import { EXPORT_STEP_UP_ACTION, EXPORT_STEP_UP_LEAD, type StepUpAction } from "@/lib/auth/mfa-step";
/** Converted from site/app-v2/auth/two-step.html. Same DOM, classes and copy. */

function copyKey(button: HTMLElement) {
  const key = button.closest(".key")?.querySelector("b")?.textContent?.replace(/\s/g, "") ?? "";
  if (!key || !navigator.clipboard) {
    toast2("Select the key and copy it", { kind: "warn" });
    return;
  }
  navigator.clipboard.writeText(key).then(
    () => toast2("Key copied", { kind: "ok" }),
    () => toast2("Select the key and copy it", { kind: "warn" }),
  );
}

/**
 * "Add a passkey instead" on two-step setup (issue #261). Passkey sign-in exists, but setting one up
 * as the account's second step doesn't yet: nothing registers the passkey, makes its recovery codes
 * or counts it as two-step being on. The option says so and does nothing, instead of opening the
 * recovery-codes step with no codes.
 */
export const PASSKEY_SETUP = { note: " · Coming later", title: "Coming later: set up two-step with an authenticator app for now" } as const;

export type TotpEnrollment = {
  factorId: string;
  secret: string;
  qr: string;
};

export function TwoStepMarkup({
  email,
  activeStep = 0,
  enrollment = null,
  stepUpLead = EXPORT_STEP_UP_LEAD,
  stepUpAction = EXPORT_STEP_UP_ACTION,
  doneLabel = "Go to the Sheet",
}: {
  email?: string | null;
  activeStep?: number;
  enrollment?: TotpEnrollment | null;
  stepUpLead?: string;
  stepUpAction?: StepUpAction;
  /** The "All set" button (mfaDoneLabel): "Continue setup" when it goes on to firm setup. */
  doneLabel?: string;
} = {}) {
  const secret = (enrollment?.secret ?? "").replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();
  // The first render's step only; see PortScreen. A refresh must not move `.on` to another panel.
  const [shownStep] = useState(activeStep);
  const stepOn = (step: number) => (step === shownStep ? "on" : undefined);
  return (
    <>
      <a className="sr" href="#main">Skip to content</a><picture className="au-sky" aria-hidden="true"><source type="image/avif" srcSet="/assets/sky/sky-A-800.avif 800w, /assets/sky/sky-A-1440.avif 1440w, /assets/sky/sky-A-2048.avif 2048w" sizes="100vw" /><source type="image/webp" srcSet="/assets/sky/sky-A-800.webp 800w, /assets/sky/sky-A-1440.webp 1440w, /assets/sky/sky-A-2048.webp 2048w" sizes="100vw" /><img src="/assets/sky/sky-A-1440.webp" alt="" width="2048" height="1152" fetchPriority="high" decoding="async" /></picture>
<div className="au-grid"><main className="au-sheet" id="main"><div className="au-top"><a href="/"><img src="/assets/casevoya-wordmark.png" alt="Casevoya home" width="188" height="30" /></a><span className="lnk"><a href="/sign-in" style={{ "margin": "0" }}>Use a different account</a></span></div>
<div className="au-body">
<section data-step="0" className={stepOn(0)} data-title="Enter your code" data-vo="lock"><div className="au-vo" data-size="56" data-pose="lock"></div><h1>Enter your code</h1><p className="lead">Open your authenticator app and enter the six-digit code for Casevoya.</p>
<fieldset className="fld" style={{ "border": "0" }}><legend className="sr">Six-digit code</legend><div className="otp" data-then="/sheet"><input inputMode="numeric" autoComplete="one-time-code" maxLength={1} aria-label="Digit 1 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 2 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 3 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 4 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 5 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 6 of 6" /></div><span className="otp-msg" role="status" aria-live="polite"></span></fieldset><div className="otp-meta"><span>{email ? `Signing in as ${email}` : ""}</span></div>
<label style={{ "display": "flex", "gap": "8px", "alignItems": "center", "fontSize": "14.5px", "marginBottom": "22px" }}><input type="checkbox" style={{ "accentColor": "var(--blue)", "width": "17px", "height": "17px" }} /> Don’t ask again on this device for 30 days</label>
<button className="opt" data-go="1" data-novalidate="" data-instant=""><span className="oi"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-more" /></svg></span><span>Use another way<small>Passkey or a recovery code</small></span><svg className="ic s go" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-chevron-right" /></svg></button>
<p style={{ "marginTop": "14px", "fontSize": "13.5px", "color": "var(--t2)" }}>Enter the six-digit code from your authenticator app.</p></section>
<section data-step="1" className={stepOn(1)} data-title="Another way" data-vo="point"><div className="au-vo" data-size="56" data-pose="point"></div><h1>Use another way</h1><p className="lead">Pick something you still have with you.</p>
<button className="opt" data-href="/sheet" data-novalidate="" data-instant=""><span className="oi"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-key" /></svg></span><span>Passkey on this device<small>Face, fingerprint or device PIN</small></span><svg className="ic s go" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-chevron-right" /></svg></button>
<button className="opt" data-go="5" data-novalidate="" data-instant=""><span className="oi"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-document-scan" /></svg></span><span>Recovery code<small>One of the ten codes you saved when you set up two-step</small></span><svg className="ic s go" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-chevron-right" /></svg></button>
<button className="opt" data-href="/recovery?step=4" data-novalidate="" data-instant=""><span className="oi"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-help" /></svg></span><span>I’ve lost my device and codes<small>Your firm owner confirms it’s you. Every step is logged.</small></span><svg className="ic s go" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-chevron-right" /></svg></button>
<p style={{ "marginTop": "18px" }}><button className="btn" data-go="0" data-novalidate="" data-instant=""><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-chevron-left" /></svg>Back to the code</button></p></section>
<section data-step="2" className={stepOn(2)} data-title="Set up two-step" data-vo="lock"><span className="au-art" aria-hidden="true"><img src="/assets/generated/b2/two-step-72@1x.webp" srcSet="/assets/generated/b2/two-step-72@2x.webp 2x" width="72" height="72" alt="" decoding="async" /></span><div className="dots" aria-hidden="true"><i></i><i></i><i></i></div><h1>Set up two-step sign-in</h1><p className="lead">Your firm requires it for every staff account. It takes about two minutes.</p>
<div className="qr" data-factor={enrollment?.factorId}>{enrollment ? <img src={enrollment.qr} alt="QR code for your authenticator app" width={132} height={132} /> : <p role="status" aria-live="polite">Preparing your setup code…</p>}<div className="key">Scan this with an authenticator app, like Google Authenticator, 1Password or Microsoft Authenticator.<br />Can’t scan? Enter this key:<b>{secret}</b><button className="btn sm" type="button" onClick={(event) => { event.preventDefault(); copyKey(event.currentTarget); }}><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-paperclip" /></svg>Copy key</button></div></div>
<p style={{ "fontSize": "14.5px", "marginBottom": "10px" }}>Then enter the six-digit code the app shows.</p><fieldset className="fld" style={{ "border": "0" }}><legend className="sr">Six-digit code</legend><div className="otp" data-then="#3"><input inputMode="numeric" autoComplete="one-time-code" maxLength={1} aria-label="Digit 1 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 2 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 3 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 4 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 5 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 6 of 6" /></div><span className="otp-msg" role="status" aria-live="polite"></span></fieldset>
<div className="au-or">or</div><button className="opt" type="button" aria-disabled="true" title={PASSKEY_SETUP.title}><span className="oi"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-key" /></svg></span><span>Add a passkey instead<small>{`Works with Face ID, Touch ID, Windows Hello and Android${PASSKEY_SETUP.note}`}</small></span><svg className="ic s go" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-chevron-right" /></svg></button></section>
<section data-step="3" className={stepOn(3)} data-title="Save your codes" data-vo="holding"><div className="au-vo" data-size="56" data-pose="holding"></div><div className="dots" aria-hidden="true"><i></i><i></i><i></i></div><h1>Save your recovery codes</h1><p className="lead">If you lose your phone, each code gets you in once. Keep them somewhere safe and away from your phone.</p>
<div className="codes" aria-label="Recovery codes"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
<div style={{ "display": "flex", "gap": "8px", "flexWrap": "wrap", "marginBottom": "18px" }}><button className="btn" type="button" onClick={(event) => { event.preventDefault(); toast2("Codes downloaded", { kind: "ok", sub: "casevoya-recovery-codes.txt" }); }}><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-download" /></svg>Download</button><button className="btn" type="button" onClick={(event) => { event.preventDefault(); toast2("Codes copied", { kind: "ok" }); }}><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-paperclip" /></svg>Copy</button><button className="btn" type="button" onClick={() => window.print()}>Print</button></div>
<label className="check" data-req="Confirm you’ve saved your codes"><input type="checkbox" id="saved" /><span>I’ve saved my recovery codes somewhere safe</span></label>
<div style={{ "marginTop": "16px" }}><button className="btn p blk" data-go="4"><span className="lab">Finish setup</span><span className="spin" aria-hidden="true"></span></button></div></section>
<section data-step="4" className={stepOn(4)} data-title="All set" data-vo="cheer"><div className="au-vo" data-size="72" data-pose="cheer"></div><div className="dots" aria-hidden="true"><i></i><i></i><i></i></div><h1>Two-step sign-in is on</h1><p className="lead">From now on you’ll enter a code, or use your passkey, when you sign in on a new device.</p>
<div className="alert ok"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-check-circle" /></svg><div><b>Recorded in the audit log</b>Two-step sign-in is on for this account.</div></div>
<button className="btn p blk" data-href="/sheet" data-novalidate="" data-instant=""><span className="lab">{doneLabel}</span><span className="spin" aria-hidden="true"></span></button></section>
<section data-step="5" className={stepOn(5)} data-title="Recovery code" data-vo="lock"><span className="au-art" aria-hidden="true"><img src="/assets/generated/b2/recovery-72@1x.webp" srcSet="/assets/generated/b2/recovery-72@2x.webp 2x" width="72" height="72" alt="" decoding="async" /></span><h1>Enter a recovery code</h1><p className="lead">Each code works once. After you’re in, we’ll ask you to set up two-step again.</p>
<div className="fld" data-req="Enter one of your saved recovery codes"><label htmlFor="rc">Recovery code</label><input className="inp" id="rc" type="text" autoComplete="one-time-code" defaultValue="" placeholder="XXXX-XXXX" aria-describedby="rc-h rc-e" /><span className="emsg" id="rc-e"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-alert" /></svg><span>Enter one of your saved recovery codes</span></span></div>
<button className="btn p blk" data-href="/sheet"><span className="lab">Continue</span><span className="spin" aria-hidden="true"></span></button><p style={{ "marginTop": "14px" }}><button className="btn" data-go="1" data-novalidate="" data-instant=""><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-chevron-left" /></svg>Back</button></p></section>
<section data-step="6" className={stepOn(6)} data-title="Confirm it’s you" data-vo="lock"><div className="au-vo" data-size="56" data-pose="lock"></div><h1>Confirm it’s you</h1><p className="lead">{stepUpLead}</p>
<div className="mail-card"><svg className="ic " aria-hidden="true"><use href={`/assets/icons-coreui/sprite.svg#i-${stepUpAction.icon}`} /></svg><div><b style={{ "fontWeight": "500" }}>{stepUpAction.title}</b><small>{stepUpAction.detail}</small></div></div>
<fieldset className="fld" style={{ "border": "0" }}><legend className="sr">Six-digit code</legend><div className="otp" data-then="/sheet/matter?tab=documents"><input inputMode="numeric" autoComplete="one-time-code" maxLength={1} aria-label="Digit 1 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 2 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 3 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 4 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 5 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 6 of 6" /></div><span className="otp-msg" role="status" aria-live="polite"></span></fieldset><div className="otp-meta"><span>Or <a className="tl" href="#" onClick={(event) => { event.preventDefault(); toast2("Passkey check", { sub: "Your device would ask for Face ID or your PIN here." }); }}>use your passkey</a></span></div>
<p style={{ "fontSize": "13.5px", "color": "var(--t2)" }}>Exports, payment settings, role changes and sensitive downloads always ask for this.</p></section>
</div><footer className="au-foot"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/help">Help centre</a><a href="/status">Service status</a><span className="sp"><a href="#" aria-current="true">English</a> · <a href="#" onClick={(event) => { event.preventDefault(); toast2("Fran\u00e7ais arrive bient\u00f4t", { sub: "The French version of these screens is being designed." }); }}>Français</a></span></footer></main>
<div className="au-poster" aria-hidden="true"><p className="big">One more check.</p><p className="cap">Two-step sign-in is on for every staff account, so a password alone never opens a client file.</p></div></div>


    </>
  );
}
