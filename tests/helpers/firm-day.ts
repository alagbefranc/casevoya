/**
 * A date (YYYY-MM-DD) counted in the firm's timezone, the way the database counts days
 * (`statement_timestamp() at time zone` the firm's zone, America/Toronto by default). A UTC date
 * runs a day ahead every evening between midnight UTC and midnight in Toronto. The offset is
 * added in calendar days to the firm's today, not as 24-hour steps, so it stays right across a
 * daylight-saving change (19 × 24 h after 00:12 on 19 Oct lands on 6 Nov, an hour short).
 */
export function firmDay(offsetDays = 0, timeZone = "America/Toronto"): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offsetDays);
  return day.toISOString().slice(0, 10);
}
