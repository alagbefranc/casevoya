/**
 * Lost two-step device (20261102100100): what /recovery says once a reset request is recorded.
 * Matches what happens: route "firm" emails and notifies the firm's other owners; route
 * "platform" (the only owner asked) goes to Casevoya support's queue. Either way the request
 * expires after 24 hours, and the person is emailed the outcome.
 */
export type MfaResetRoute = "firm" | "platform";

export function mfaResetSentCopy(route: MfaResetRoute, existing: boolean): { heading: string; lead: string } {
  const after = "Requests expire after 24 hours if nobody approves them. When it’s approved, we email you: sign in with your password and set up two-step again.";
  if (route === "platform") {
    return {
      heading: existing ? "Your request is waiting" : "Request sent",
      lead: `You’re your firm’s only owner, so Casevoya support reviews this request and contacts you to confirm it’s you. ${after}`,
    };
  }
  return {
    heading: existing ? "Your request is waiting" : "Request sent",
    lead: `${existing ? "We already emailed your firm’s other owners about your open request." : "We emailed your firm’s other owners."} One of them confirms it’s you and approves it. ${after}`,
  };
}
