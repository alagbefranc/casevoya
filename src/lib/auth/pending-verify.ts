/** `?verify=` (#330): a sign-up waiting for its email code, kept across a reload or a sign-in attempt. */
export function pendingVerifyEmail(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const email = (raw ?? "").trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Where an unconfirmed sign-up resumes: the code step for that email. */
export function verifyHref(email: string): string {
  return `/start-trial?verify=${encodeURIComponent(email.trim())}`;
}
