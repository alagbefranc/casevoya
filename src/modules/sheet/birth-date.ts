/**
 * A date of birth typed into a Sheet dialog (`<input type="date">`, so `YYYY-MM-DD`).
 * The database checks it again: app.sync_person_birth refuses a future date and
 * create_client_matter refuses one before 1900.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The earliest date of birth the dialogs accept. */
export const EARLIEST_BIRTH_DATE = "1900-01-01";

/** The firm's timezone when none is known: the database's default (organizations.timezone). */
export const DEFAULT_FIRM_TIME_ZONE = "America/Toronto";

/**
 * Today as `YYYY-MM-DD` in the firm's timezone, the calendar the database's app.firm_today uses
 * (America/Toronto when the zone is not given or not usable).
 */
export function todayIso(now: Date = new Date(), timeZone: string | null | undefined = DEFAULT_FIRM_TIME_ZONE): string {
  const format = (zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  try {
    return format(timeZone || DEFAULT_FIRM_TIME_ZONE);
  } catch {
    return format(DEFAULT_FIRM_TIME_ZONE);
  }
}

/**
 * The date as `YYYY-MM-DD`, `null` when left blank, or what to fix: a real calendar date,
 * not after `today`, and not before 1900.
 */
export function readBirthDate(value: string | null | undefined, today: string): { date: string | null } | { error: string } {
  const text = (value ?? "").trim();
  if (!text) return { date: null };
  const match = ISO_DATE.exec(text);
  if (!match) return { error: "Enter the date of birth as a full date." };
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return { error: "Enter the date of birth as a full date." };
  }
  if (text > today) return { error: "The date of birth can’t be in the future." };
  if (text < EARLIEST_BIRTH_DATE) return { error: "Check the date of birth. It is before 1900." };
  return { date: text };
}
