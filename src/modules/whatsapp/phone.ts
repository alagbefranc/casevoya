/**
 * Phone numbers for WhatsApp (pure). Mirrors app.normalize_phone_e164 in
 * supabase/migrations/20261019230100_whatsapp_zernio.sql exactly: spaces, dashes, dots and
 * brackets are dropped; 00 becomes +; a 10-digit or 1-prefixed 11-digit North American number
 * gets +1. Anything else that is not + and 8 to 15 digits is refused (null).
 */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  let digits = String(raw ?? "").replace(/[\s().-]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (/^\+[1-9][0-9]{7,14}$/.test(digits)) return digits;
  if (/^1[2-9][0-9]{9}$/.test(digits)) return `+${digits}`;
  if (/^[2-9][0-9]{9}$/.test(digits)) return `+1${digits}`;
  return null;
}

/** Zernio's participantId for WhatsApp: the number's digits, country code included, no "+". */
export function participantId(e164: string): string {
  const normalized = normalizePhoneE164(e164);
  if (!normalized) throw new Error("Not a phone number in E.164.");
  return normalized.slice(1);
}

/** A number for display: "+1 431 275 3986" for North America, otherwise "+<digits>". */
export function displayPhone(e164: string | null | undefined): string | null {
  const normalized = normalizePhoneE164(e164);
  if (!normalized) return null;
  const nanp = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(normalized);
  return nanp ? `+1 ${nanp[1]} ${nanp[2]} ${nanp[3]}` : normalized;
}
