"use client";

import { toast2 } from "../kit";
/** Converted from site/app-v2/auth/sign-in.html. Same DOM, classes and copy. */
export function SignInMarkup() {
  return (
    <>
      <a className="sr" href="#main">Skip to content</a><picture className="au-sky" aria-hidden="true"><source type="image/avif" srcSet="/assets/sky/sky-A-800.avif 800w, /assets/sky/sky-A-1440.avif 1440w, /assets/sky/sky-A-2048.avif 2048w" sizes="100vw" /><source type="image/webp" srcSet="/assets/sky/sky-A-800.webp 800w, /assets/sky/sky-A-1440.webp 1440w, /assets/sky/sky-A-2048.webp 2048w" sizes="100vw" /><img src="/assets/sky/sky-A-1440.webp" alt="" width="2048" height="1152" fetchPriority="high" decoding="async" /></picture>
<div className="au-grid"><main className="au-sheet" id="main"><div className="au-top"><a href="/"><img src="/assets/casevoya-wordmark.png" alt="Casevoya home" width="188" height="30" /></a><span className="lnk">New to Casevoya?<a href="/start-trial">Start a trial</a></span></div>
<div className="au-body">
<section data-step="0" data-title="Sign in" data-vo="wave"><span className="au-vo3d" aria-hidden="true"><img src="/assets/generated/b2/vo-3d-160@1x.webp" srcSet="/assets/generated/b2/vo-3d-160@2x.webp 2x" width="80" height="80" alt="" decoding="async" /></span><h1>Sign in</h1><p className="lead">Welcome back. Your firm’s files are where you left them.</p>
<div className="alert bad" role="alert" data-show="error"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-alert" /></svg><div><b>Email or password didn’t match</b>Check both and try again. After 5 tries we pause sign-in for 15 minutes to protect client files.</div></div>
<div className="alert warn" role="alert" data-show="locked"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-lock" /></svg><div><b>Sign-in paused for 15 minutes</b>There were too many attempts on this account. We emailed amara@northline.example so you know. You can <a className="tl" href="/recovery">reset your password</a> now.</div></div>
<form noValidate onSubmit={(event) => event.preventDefault()}><div className="fld" data-req="Enter your work email, like name@firm.ca"><label htmlFor="em">Work email</label><input className="inp" id="em" type="email" autoComplete="username" defaultValue="amara@northline.example" placeholder="" aria-describedby="em-h em-e" /><span className="emsg" id="em-e"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-alert" /></svg><span>Enter your work email, like name@firm.ca</span></span></div>
<div className="fld" data-req="Enter your password"><label htmlFor="pw">Password</label><div className="pw"><input className="inp" id="pw" type="password" autoComplete="current-password" defaultValue="" placeholder="" aria-describedby="pw-h pw-e" /><button type="button" className="eye" aria-label="Show password" aria-pressed="false"></button></div><span className="emsg" id="pw-e"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-alert" /></svg><span>Enter your password</span></span></div>
<div className="au-row"><label style={{ "display": "flex", "gap": "8px", "alignItems": "center" }}><input type="checkbox" style={{ "accentColor": "var(--blue)", "width": "17px", "height": "17px" }} /> Keep me signed in on this device</label><a className="tl" href="/recovery">Forgot password?</a></div>
<button className="btn p blk" data-href="/mfa" type="submit"><span className="lab">Sign in</span><span className="spin" aria-hidden="true"></span></button></form>
<div className="au-or">or</div>
<button className="opt" data-go="1" data-novalidate="" data-instant=""><span className="oi"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-key" /></svg></span><span>Sign in with a passkey<small>Face, fingerprint or your device PIN. No password needed.</small></span><svg className="ic s go" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-chevron-right" /></svg></button>
</section>
<section data-step="1" data-title="Choose a workspace" data-vo="point"><div className="au-vo" data-size="56" data-pose="point"></div><h1>Choose a workspace</h1><p className="lead">You belong to two firms. Each keeps its own clients and files. Nothing is shared between them.</p>
<div role="radiogroup" aria-label="Workspace">
<button className="opt" role="radio" aria-checked="true" data-href="/sheet" data-novalidate="" data-instant=""><img className="oi" src="/assets/firms/northline-mark-256.png" alt="" width="40" height="40" /><span>Northline Immigration<small>Owner · Licensed consultant · Toronto</small></span><svg className="ic s go" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-chevron-right" /></svg></button>
<button className="opt" role="radio" aria-checked="false" onClick={(event) => { event.preventDefault(); toast2("Harbourview is a second demo firm", { sub: "Only Northline is drawn in this prototype." }); }}><img className="oi" src="/assets/firms/harbourview-mark-256.png" alt="" width="40" height="40" /><span>Harbourview Legal Services<small>Licensed consultant · Halifax</small></span><svg className="ic s go" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-chevron-right" /></svg></button></div>
<p className="hint" style={{ "marginTop": "16px", "color": "var(--t2)", "fontSize": "13.5px" }}>You can switch later from the firm name at the top of the Sheet.</p>
</section></div><footer className="au-foot"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/help">Help centre</a><a href="/status">Service status</a><span className="sp"><a href="#" aria-current="true">English</a> · <a href="#" onClick={(event) => { event.preventDefault(); toast2("Fran\u00e7ais arrive bient\u00f4t", { sub: "The French version of these screens is being designed." }); }}>Français</a></span></footer></main>
<div className="au-poster" aria-hidden="true"><p className="big">Every file,<br />in order.</p></div></div>


    </>
  );
}
