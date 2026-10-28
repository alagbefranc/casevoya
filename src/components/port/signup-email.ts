/** The start-trial code step's "We sent a six-digit code to …" names the address typed on step 0 (issue #259). */
export const SIGNUP_EMAIL_SLOT = '[data-step="1"] .mail-card b';

/** Puts the typed work email (#wem) in the code step's card. Leaves the Designer's words when none was typed. */
export function showSignupEmail(root: ParentNode): void {
  const email = (root.querySelector<HTMLInputElement>("#wem")?.value ?? "").trim();
  const slot = root.querySelector<HTMLElement>(SIGNUP_EMAIL_SLOT);
  if (email && slot) slot.textContent = email;
}
