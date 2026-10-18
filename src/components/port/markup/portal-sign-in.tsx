/**
 * The account part of a portal invitation's sign-in step. Every piece is Designer markup from
 * the auth screens: the password field and its three rules from accept-staff.html, the
 * six-digit email code from start-trial.html, and the `.why` note and `.tl` link from the
 * accept screens. wire.ts shows the part that applies (`data-signin`); hidden parts are
 * skipped by the kit's validation.
 *
 * `then` is where the code step goes once the code is accepted: the Done step ("#4") on
 * accept-client, or the portal itself on screens without a Done step.
 */
export function PortalSignInFields({ email, then }: { email: string; then: string }) {
  return (
    <>
      <div data-signin="password">
        <div className="fld" data-req="Choose a password that meets all three rules" data-min="12" style={{ "marginTop": "18px", "maxWidth": "520px" }}><label htmlFor="ppw">Create a password</label><div className="pw"><input className="inp" id="ppw" type="password" autoComplete="new-password" /><button type="button" className="eye" aria-label="Show password"></button></div><ul className="rules"><li data-r="len"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-check-circle" /></svg>At least 12 characters</li><li data-r="mix"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-check-circle" /></svg>Letters plus a number or symbol</li><li data-r="known"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-check-circle" /></svg>Not a common or leaked password</li></ul><span className="emsg" id="ppw-e"><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-alert" /></svg><span>Choose a password that meets all three rules</span></span></div>
        <p style={{ "marginTop": "14px", "fontSize": "14.5px" }}><a className="tl" href="#" data-signin-mode="">Already have a Casevoya sign-in? Sign in</a></p>
      </div>
      <div data-signin="passkey" hidden>
        <p className="why" style={{ "marginTop": "12px" }}><svg className="ic s" aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-info" /></svg>Passkeys are coming to Casevoya. Create a password for now.</p>
      </div>
      <div data-signin="code" hidden>
        <div className="mail-card" style={{ "maxWidth": "520px" }}><svg className="ic " aria-hidden="true"><use href="/assets/icons-coreui/sprite.svg#i-mail" /></svg><div>We sent a six-digit code to <b style={{ "fontWeight": "500" }}>{email || "the invited email"}</b><small>Enter it to confirm your email. Check spam if it isn’t there in a minute.</small></div></div>
        <fieldset className="fld" style={{ "border": "0" }}><legend className="sr">Six-digit code</legend><div className="otp" data-then={then}><input inputMode="numeric" autoComplete="one-time-code" maxLength={1} aria-label="Digit 1 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 2 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 3 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 4 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 5 of 6" /><input inputMode="numeric" autoComplete="off" maxLength={1} aria-label="Digit 6 of 6" /></div><span className="otp-msg" role="status" aria-live="polite"></span></fieldset><div className="otp-meta"><a href="#" data-resend="30">Send a new code</a></div>
      </div>
    </>
  );
}
