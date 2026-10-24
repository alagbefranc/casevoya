/**
 * "Manage your booking" (CRM-03): the page a booker without a portal opens from their email,
 * /booking/<ref>?t=<token>. Pure: the token check, its hash, and what booking_manage_view returned.
 */
const REF = /^[a-z2-7]{26}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export function managePath(ref: string, token: string): string {
  return `/booking/${ref}?t=${encodeURIComponent(token)}`;
}

export function isBookingRef(value: string): boolean {
  return REF.test(value);
}

export function isManageToken(value: string): boolean {
  return TOKEN.test(value);
}

/** SHA-256 hex of the token, as the database stores it. */
export async function manageTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A new single-purpose token: 32 random bytes, base64url. */
export function newManageToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type ManagedBooking = {
  id: string;
  ref: string;
  firmName: string;
  firmSlug: string;
  title: string;
  hostName: string | null;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  locationKind: string;
  status: string;
  cancelledBy: string | null;
  version: number;
  upcoming: boolean;
  minNoticeMin: number;
  late: boolean;
};

export function parseManagedBooking(raw: unknown): ManagedBooking | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  const ref = text(row.ref);
  const startsAt = text(row.starts_at);
  const endsAt = text(row.ends_at);
  if (!ref || !REF.test(ref) || !startsAt || !endsAt) return null;
  return {
    id: text(row.id) ?? "",
    ref,
    firmName: text(row.firm_name) ?? "The firm",
    firmSlug: text(row.firm_slug) ?? "",
    title: text(row.title) ?? "Consultation",
    hostName: text(row.host_name),
    startsAt,
    endsAt,
    timeZone: text(row.time_zone) ?? "America/Toronto",
    locationKind: text(row.location_kind) ?? "video",
    status: text(row.status) ?? "confirmed",
    cancelledBy: text(row.cancelled_by),
    version: typeof row.version === "number" ? row.version : 1,
    upcoming: row.upcoming === true,
    minNoticeMin: typeof row.min_notice_min === "number" ? row.min_notice_min : 1440,
    late: row.late === true,
  };
}

/** A database refusal as words the booker can act on. */
export function manageError(message: string): string {
  if (/slot_unavailable/.test(message)) return "That time is no longer free. Choose another.";
  if (/changed by someone else/.test(message)) return "This booking changed since you opened it. Reload and try again.";
  if (/only an upcoming/.test(message)) return "Only an upcoming, confirmed consultation can be changed.";
  if (/minimum notice|too soon|notice/.test(message)) return "That time is too soon for this kind of consultation. Choose a later one.";
  if (/say why/.test(message)) return "Tell the firm why you’re cancelling (a few words).";
  if (/choose a time zone/.test(message)) return "Choose a time zone.";
  if (/access denied/.test(message)) return "This link no longer works. Use the link in your latest email, or contact the firm.";
  return "That couldn’t be saved. Try again.";
}

/** /call/<ref>?t=<token>: a guest's call link (CRM-03). Only its shape; the database checks the token. */
export function isGuestCallPath(pathname: string, search: string): boolean {
  const match = /^\/call\/([a-z2-7]{26})\/?$/.exec(pathname);
  if (!match) return false;
  const token = new URLSearchParams(search).get("t");
  return Boolean(token && TOKEN.test(token));
}
