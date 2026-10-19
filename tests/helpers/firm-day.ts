/**
 * A date (YYYY-MM-DD) counted in the firm's timezone, the way the database counts days
 * (`statement_timestamp() at time zone` the firm's zone, America/Toronto by default). A UTC date
 * runs a day ahead every evening between midnight UTC and midnight in Toronto.
 */
export function firmDay(offsetDays = 0, timeZone = "America/Toronto"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(Date.now() + offsetDays * 86_400_000));
}
