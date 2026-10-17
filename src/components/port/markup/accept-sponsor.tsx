"use client";

import { showFace, type InviteFace } from "@/lib/auth/invite-face";
/** Converted from site/app-v2/auth/accept-sponsor.html. Same DOM, classes and copy. */
export function AcceptSponsorMarkup({ face }: { face?: InviteFace } = {}) {
  const firm = showFace(face?.firm, "your firm");
  const person = showFace(face?.person, "");
  const email = showFace(face?.email, "");
  const consultant = showFace(face?.consultant, "your consultant");
  const applicant = showFace(face?.applicant, "the applicant");
  return (
    <>
      <a className="sr" href="#main">Skip to content</a>
<div className="wz"><aside className="rail" aria-label="Steps"><div className="firmhd"><span className="firmlogo"><img src="" alt="" width="22" height="22" style={{ "display": "block" }} /></span>{firm}</div><h2>Sponsor invitation</h2><p className="sub">Three short steps.</p><ol className="stp"><i className="fill" aria-hidden="true"></i><li><button type="button"><span className="n">1</span><span>Your invitation</span></button></li><li><button type="button"><span className="n">2</span><span>What you’ll see</span></button></li><li><button type="button"><span className="n">3</span><span>Sign-in</span></button></li></ol><p className="mstep" data-stepname=""></p><div className="foot"><span className="pwrd">Powered by Casevoya</span></div></aside>
<div className="wz-sheet"><div className="wz-top"><span data-stepname=""></span></div><main className="wz-main" id="main">
<section data-step="0" className="on" data-title="Your invitation" data-vo="wave"><div className="wz-head"><div><h1>{person ? `Hi ${person}` : "Your invitation"}</h1><p className="lead">You’re the sponsor on {applicant}’s file. {firm} invited you to answer your own questions, upload your documents and sign.</p></div><span className="wz-art" aria-hidden="true"><img src="/assets/generated/b2/sponsor-window-72@1x.webp" srcSet="/assets/generated/b2/sponsor-window-72@2x.webp 2x" width="72" height="72" alt="" decoding="async" /></span></div>
<div className="inv"><img src="" alt="" /><div><b style={{ "fontWeight": "500" }}>Invited by {consultant}, {firm}</b><small>Role on the file: sponsor</small></div><div className="meta"><span className="bd ok"><i></i>{email ? `For ${email}` : "For the invited address"}</span><span className="bd unv"><i></i>Single use</span></div></div></section>
<section data-step="1" data-title="What you’ll see" data-vo="lock"><div className="wz-head"><div className="wz-vo" data-size="64" data-pose="lock"></div><div><h1>What you’ll see</h1><p className="lead">Sponsor and applicant each have private records. That keeps both of you safe.</p></div></div>
<div className="who"><div className="y"><h4><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-eye" /></svg>You’ll see</h4><ul><li>Your own questions, documents and tasks</li><li>Shared items, like the marriage certificate and photos</li><li>Invoices you agree to pay</li></ul></div><div className="n"><h4><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-lock" /></svg>You won’t see</h4><ul><li>{applicant}’s private records, like a police certificate</li><li>Other family members’ records, unless they share them</li></ul></div></div>
<p className="why"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-info" /></svg>Paying an invoice doesn’t give access to anyone else’s records.</p>
<label className="check" data-req="Accept the portal terms to continue"><input type="checkbox" id="r1" /><span>I understand and accept {firm}’s portal terms</span></label></section>
<section data-step="2" data-title="Sign-in" data-vo="cheer" data-cta="Create my account"><div className="wz-head"><div className="wz-vo" data-size="64" data-pose="cheer"></div><div><h1>Create your sign-in</h1><p className="lead">Separate from {applicant}’s account.</p></div></div>
<div role="radiogroup" aria-label="Sign-in method" style={{ "maxWidth": "520px" }}><button className="opt" role="radio" aria-checked="true" type="button"><span className="oi"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-key" /></svg></span><span>Use a passkey<small>Face, fingerprint or phone PIN</small></span></button><button className="opt" role="radio" aria-checked="false" type="button"><span className="oi"><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-lock" /></svg></span><span>Create a password</span></button></div>
<fieldset className="fld" style={{ "border": "0", "marginTop": "18px" }}><legend>Portal language</legend><div className="seg" role="group" aria-label="Language"><button type="button" aria-pressed="true">English</button><button type="button" aria-pressed="false">Français</button></div></fieldset></section></main><footer className="wz-foot"><button className="btn" data-prev="" type="button"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-chevron-left" /></svg>Back</button><span className="save"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-check-circle" /></svg>Your answers are saved</span><span className="sp"></span><button className="btn p" data-next=""><span className="lab">Continue</span><span className="spin" aria-hidden="true"></span></button></footer></div></div>


    </>
  );
}
