/**
 * Cloudflare Turnstile, off unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set.
 * The site key is public. The secret stays in Supabase (Auth CAPTCHA). This app
 * only collects the token and passes it as captchaToken. Do not put a key in the repo.
 *
 * Read the variable as process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY so Next can inline it
 * for the browser. A dynamic lookup would stay empty in the client bundle.
 */

export const CAPTCHA_MESSAGE = "Confirm you’re a person, then try again.";

export function turnstileSiteKey(): string | null {
  const value = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  return value.length > 0 ? value : null;
}

/** True when the challenge is on and this request did not bring a usable token. */
export function captchaMissing(token: string | null | undefined): boolean {
  if (!turnstileSiteKey()) return false;
  const value = token?.trim() ?? "";
  return value.length < 1 || value.length > 2048;
}

/** Options fragment for Supabase Auth. Empty when the challenge is off, so Auth is unchanged. */
export function captchaOptions(token: string | null | undefined): { captchaToken?: string } {
  if (!turnstileSiteKey()) return {};
  const value = token?.trim() ?? "";
  return value ? { captchaToken: value } : {};
}
