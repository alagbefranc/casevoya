/** Shows a time in the firm's zone (the Worker runs in UTC), with the zone name so it is never ambiguous. */
export function firmTime(value: string | null, timeZone: string) {
  if (!value) return "";
  const opts = { dateStyle: "medium", timeStyle: "short" } as const;
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
  } catch {
    zone = "America/Toronto";
  }
  const text = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: zone }).format(new Date(value));
  const name = new Intl.DateTimeFormat("en-CA", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(value)).find((x) => x.type === "timeZoneName")?.value;
  return name ? `${text} ${name}` : text;
}
