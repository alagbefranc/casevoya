/**
 * The setup header's trial pill (#330). Before a card is on file the trial has not started, so it
 * says "Free trial" with no countdown; after, the real days left from trial_ends_at. Never a
 * hardcoded length.
 *
 * This stays out of the client setup screen. /setup is a Server Component and calls it while
 * rendering a signed-in firm; a function exported from a "use client" module throws there
 * ("Attempted to call setupTrialBadge() from the server").
 */
export function setupTrialBadge(
  sub: { status?: string | null; trial_ends_at?: string | null; card_required?: boolean | null } | null,
  now: Date = new Date(),
): string {
  if (sub?.status === "trial" && sub.trial_ends_at && !sub.card_required) {
    const left = Math.max(0, Math.ceil((Date.parse(sub.trial_ends_at) - now.getTime()) / 86_400_000));
    if (Number.isFinite(left)) return `Trial · ${left} ${left === 1 ? "day" : "days"} left`;
  }
  return "Free trial";
}
