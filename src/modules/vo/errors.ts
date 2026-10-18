/** Plain-language messages for Vo, and the switches the owner can change. Pure. */

export const VO_SETTING_KEYS = [
  "enabled",
  "reply_drafts",
  "staff_answers",
  "read_client_messages",
  "read_identity",
  "read_relationship",
  "read_financial",
  "read_medical",
  "read_criminal",
  "read_narratives",
] as const;

export type VoSettingKey = (typeof VO_SETTING_KEYS)[number];

const MESSAGES: Record<string, string> = {
  unavailable: "Vo is unavailable right now. Write it yourself; everything else works as usual.",
  off: "Vo is off for this firm. The firm owner can turn it on in Vo and AI.",
  capability_off: "The firm owner has turned this Vo capability off.",
  sample_only: "In sample mode Vo works on sample records only.",
  rate_limited: "You’ve asked Vo for a lot in a short time. Try again later, or write it yourself.",
  firm_rate_limited: "Your firm has used today’s Vo allowance. Write it yourself; it resets tomorrow.",
  denied: "Only firm staff who can read this matter, signed in with two-step verification, can use Vo.",
  owner_only: "Only the firm owner, signed in with two-step verification, can change Vo settings.",
  no_message: "There’s no client message to reply to yet.",
  no_requests: "There are no open document requests for the people in this conversation.",
  placeholder: "Replace “[needs a sourced rule]” with a checked, sourced fact (or remove it) before sending.",
  reviewed: "Someone already sent or rejected this draft.",
  empty: "Vo couldn’t produce a usable draft. Write it yourself, or try again.",
  failed: "Vo couldn’t finish. Nothing was sent. Write it yourself, or try again.",
};

export function voError(code: string): string {
  return MESSAGES[code] ?? MESSAGES.failed;
}
