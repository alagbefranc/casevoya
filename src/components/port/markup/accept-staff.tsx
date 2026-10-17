"use client";

import { showFace, type InviteFace } from "@/lib/auth/invite-face";
import { toast2 } from "../kit";
/** Converted from site/app-v2/auth/accept-staff.html. Same DOM, classes and copy. */
export function AcceptStaffMarkup({ face }: { face?: InviteFace } = {}) {
  const firm = showFace(face?.firm, "");
  const person = showFace(face?.person, "");
  const email = showFace(face?.email, "");
  const consultant = showFace(face?.consultant, "the person who invited you");
  const role = showFace(face?.role, "team member");
  const firmLabel = firm || "your firm";
  return (
    <>
      <a className="sr" href="#main">Skip to content</a><picture className="au-sky" aria-hidden="true"><source type="image/avif" srcSet="/assets/sky/sky-A-800.avif 800w, /assets/sky/sky-A-1440.avif 1440w, /assets/sky/sky-A-2048.avif 2048w" sizes="100vw" /><source type="image/webp" srcSet="/assets/sky/sky-A-800.webp 800w, /assets/sky/sky-A-1440.webp 1440w, /assets/sky/sky-A-2048.webp 2048w" sizes="100vw" /><img src="/assets/sky/sky-A-1440.webp" alt="" width="2048" height="1152" fetchPriority="high" decoding="async" /></picture>
<div className="au-grid"><main className="au-sheet" id="main"><div className="au-top"><a href="/"><img src="/assets/casevoya-wordmark.png" alt="Casevoya home" width="188" height="30" /></a><span className="lnk"><a href="/sign-in" style={{ "margin": "0" }}>Sign in</a></span></div>
<div className="au-body">
<section data-step="0" className="on" data-title="Join your team" data-vo="wave"><span className="au-art" aria-hidden="true"><img src="/assets/generated/b2/team-badges-72@1x.webp" srcSet="/assets/generated/b2/team-badges-72@2x.webp 2x" width="72" height="72" alt="" decoding="async" /></span><h1>Join {firm || "your team"}</h1>
<div className="alert warn" role="alert" data-show="expired"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-clock" /></svg><div><b>This invitation has expired</b>Invitations work for 7 days and only once. Ask {consultant} to send a new one.</div></div>
<div className="alert info" role="alert" data-show="used"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-info" /></svg><div><b>This invitation was already used</b>If that was you, <a className="tl" href="/sign-in">sign in</a>. If not, tell {consultant} now.</div></div>
<div className="inv"><img src="" alt="" /><div><b style={{ "fontWeight": "500" }}>{consultant} invited you as a {role}</b><small>{firmLabel}</small></div><div className="meta"><span className="bd ok"><i></i>{email ? `For ${email}` : "For the invited address"}</span><span className="bd unv"><i></i>Single use</span></div></div>
<form noValidate onSubmit={(event) => event.preventDefault()} data-form=""><div className="fld" data-req="Enter your name"><label htmlFor="sn">Your name</label><input className="inp" id="sn" type="text" autoComplete="name" defaultValue={person} placeholder="Your name" aria-describedby="sn-h sn-e" /><span className="emsg" id="sn-e"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-alert" /></svg><span>Enter your name</span></span></div>
<div className="fld"><label htmlFor="sem">Email</label><span className="hint" id="sem-h">Set by your invitation. Ask {consultant} to change it.</span><input className="inp" id="sem" type="email" autoComplete="email" defaultValue={email} placeholder="name@firm.ca" aria-describedby="sem-h sem-e" /><span className="emsg" id="sem-e"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-alert" /></svg><span></span></span></div>
<div className="fld" data-req="Choose a password that meets all three rules" data-min="12"><label htmlFor="spw">Create a password</label><div className="pw"><input className="inp" id="spw" type="password" autoComplete="new-password" /><button type="button" className="eye" aria-label="Show password"></button></div><ul className="rules"><li data-r="len"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-check-circle" /></svg>At least 12 characters</li><li data-r="mix"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-check-circle" /></svg>Letters plus a number or symbol</li><li data-r="known"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-check-circle" /></svg>Not a common or leaked password</li></ul><span className="emsg" id="spw-e"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-alert" /></svg><span>Choose a password that meets all three rules</span></span></div>
<button className="btn p blk" data-href="/mfa?step=2" type="submit"><span className="lab">Join and set up two-step</span><span className="spin" aria-hidden="true"></span></button></form>
<p style={{ "marginTop": "14px", "fontSize": "13.5px", "color": "var(--t2)" }}>Your role decides what you can see and do. Case managers can’t release submissions.</p></section></div><footer className="au-foot"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/help">Help centre</a><a href="/status">Service status</a><span className="sp"><a href="#" aria-current="true">English</a> · <a href="#" onClick={(event) => { event.preventDefault(); toast2("Fran\u00e7ais arrive bient\u00f4t", { sub: "The French version of these screens is being designed." }); }}>Français</a></span></footer></main>
<div className="au-poster" aria-hidden="true"><p className="big">{firmLabel}’s files, in order.</p><p className="cap">{consultant} invited you to {firmLabel} on Casevoya.</p></div></div>


    </>
  );
}
