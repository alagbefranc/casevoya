/**
 * REP-01: a filter page opened with `?f=<token>` (a Reports card's link, e.g. `/sheet/tasks?f=overdue`)
 * starts with that chip on. Returns the chip label whose token is named, or null.
 */
export function presetChipLabel(tokens: Record<string, string>, labels: string[], token: string | null): string | null {
  if (!token) return null;
  return labels.find((label) => tokens[label] === token) ?? null;
}
