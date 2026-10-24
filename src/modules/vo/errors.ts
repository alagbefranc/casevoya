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
  "doc_classification",
  "ocr_normalisation",
  "missing_fields",
  "inconsistency_flags",
] as const;

export type VoSettingKey = (typeof VO_SETTING_KEYS)[number];

/** A switch on the page that changes several saved switches together. */
export const VO_SETTING_GROUPS = {
  // Vo drafts: "Missing-field and inconsistency flags" is one switch there, two in Vo and AI.
  doc_flags: ["missing_fields", "inconsistency_flags"],
} as const satisfies Record<string, readonly VoSettingKey[]>;

export type VoSwitchKey = VoSettingKey | keyof typeof VO_SETTING_GROUPS;

/** The saved switches one page switch changes; null for an unknown name. */
export function voSettingChanges(setting: string, on: boolean): Partial<Record<VoSettingKey, boolean>> | null {
  if ((VO_SETTING_KEYS as readonly string[]).includes(setting)) return { [setting]: on };
  const group = (VO_SETTING_GROUPS as Record<string, readonly VoSettingKey[]>)[setting];
  return group ? Object.fromEntries(group.map((key) => [key, on])) : null;
}

const MESSAGES: Record<string, string> = {
  unavailable: "Vo is unavailable right now. Write it yourself; everything else works as usual.",
  off: "Vo is off for this firm. The firm owner can turn it on in Vo and AI.",
  capability_off: "The firm owner has turned this Vo capability off.",
  sample_only: "In sample mode Vo works on sample records only.",
  rate_limited: "You’ve asked Vo for a lot in a short time. Try again later, or write it yourself.",
  firm_rate_limited: "Your firm has used today’s Vo allowance. Write it yourself; it resets tomorrow.",
  denied: "Only firm staff who can read this matter, signed in with two-step verification, can use Vo.",
  owner_only: "Only the firm owner, signed in with two-step verification, can change Vo settings.",
  // AI vendor terms (AI-06).
  vendor_terms: "Review and acknowledge the AI vendor terms before turning Vo on.",
  vendor_terms_changed: "The AI vendor terms changed. Reload the page and review them again.",
  no_message: "There’s no client message to reply to yet.",
  no_requests: "There are no open document requests for the people in this conversation.",
  placeholder: "Replace “[needs a sourced rule]” with a checked, sourced fact (or remove it) before sending.",
  reviewed: "Someone already sent or rejected this draft.",
  stale: "The matter changed after Vo drafted this. Open it with Edit and check it before sending.",
  empty: "Vo couldn’t produce a usable draft. Write it yourself, or try again.",
  failed: "Vo couldn’t finish. Nothing was sent. Write it yourself, or try again.",
  // Document reading.
  category_off: "The firm owner hasn’t let Vo read this kind of document. Review it yourself; nothing was read.",
  not_clean: "Vo reads only files that passed the upload check.",
  already_read: "Vo already read this version. Its proposals are waiting on the matter’s Documents tab.",
  unsupported_file: "Vo can read PDFs and JPEG, PNG, WebP or GIF images up to 20 MB (5 MB for an image). Review this one yourself.",
  refused: "Vo’s switches for this document are off. Nothing was read.",
  doc_failed: "Vo couldn’t read this document. Nothing was changed. Review it yourself, or try again.",
  doc_empty: "Vo found nothing to propose in this document. Review it yourself.",
  proposal_reviewed: "Someone already accepted or rejected this.",
  proposal_role: "Only the firm owner, a licensed consultant or a case manager can change a document’s purpose.",
};

export function voError(code: string): string {
  return MESSAGES[code] ?? MESSAGES.failed;
}
