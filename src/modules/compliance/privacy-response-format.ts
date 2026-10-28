import { complianceError } from "./format";

/**
 * SEC-06 refusals from the database, worded plainly (never echoed). Anything not listed here falls
 * back to the privacy requests' own wording (complianceError).
 */
export function privacyResponseError(message: string): string {
  const known: [RegExp, string][] = [
    [/official Government of Canada page/i, "Use the official page’s link (canada.ca or a gc.ca site such as Justice Laws)."],
    [/name the section/i, "Name the section of the law, for example s. 8(3)."],
    [/copy the provision/i, "Copy the provision word for word from the official page."],
    [/name the law/i, "Name the law as the official page does."],
    [/only when the provision states a number/i, "Enter days only when the provision states a number, between 1 and 365."],
    [/date checked is required/i, "Enter the date you checked the page, within the last year."],
    [/current-to date cannot be in the future/i, "The current-to date can’t be in the future."],
    [/time to respond or the extension/i, "Choose whether it’s the time to respond or the extension."],
    [/attestation/i, "Casevoya has no capture of this page. Enter the date you opened the official page yourself to approve it."],
    [/date you opened the page/i, "The date you opened the page must be between the day it was entered and today."],
    [/another licensed member/i, "You entered this yourself, so another licensed member of the firm approves it."],
    [/approving your own entry needs a step-up/i, "Confirm with your authenticator, passkey, or a recovery code, then try again."],
    [/version conflict/i, "Someone changed this first. Refresh the page."],
    [/nothing is waiting for review/i, "This was already reviewed. Refresh the page."],
    [/say why it's rejected/i, "Say why it’s rejected."],
    [/say why it's retired/i, "Say why it’s retired."],
    [/only an approved time limit/i, "Only an approved time limit can be retired."],
    [/time limit review denied/i, "Only a licensed member of the firm reviews legal time limits."],
    [/staff access denied/i, "You don’t have access to that."],
    [/already extended/i, "This request is already extended. Refresh the page."],
    [/reason for the extension/i, "Give the reason for the extension (3 to 500 characters). They see it."],
    [/their recourse/i, "Write their recourse in 3 to 500 characters, or leave it empty."],
    [/after today/i, "The new due date must be after today."],
    [/after the current one/i, "The new due date must be after the current one."],
    [/too far from the received date/i, "The new due date is too far from the received date."],
    [/approved official extension/i, "Choose an approved official extension, or set the date as the firm."],
    [/official time to respond from the same law/i, "Approve the official time to respond from the same law first."],
    [/later than the official extension/i, "That’s later than the official extension allows."],
    [/no portal login: say how you told them/i, "They have no portal login. Say how you told them about the extension."],
    [/only an access or correction request is extended/i, "Only an access or correction request can be extended."],
    [/only an access or correction request has a scope search/i, "Only an access or correction request has a scope search."],
    [/link the request to a client record/i, "Link the request to a client record first."],
    [/choose a decision/i, "Choose a decision."],
    [/choose the fields/i, "Choose the fields to withhold."],
    [/whose information/i, "Name whose information it is."],
    [/give the reason in 3 to 500/i, "Give the reason (3 to 500 characters). They see it."],
    [/run the scope search first/i, "Search their records first."],
    [/already being built/i, "A package is already being built. Refresh the page."],
    [/only an access request has a response package/i, "Only an access request has a response package."],
    [/build the response package first/i, "Build the response package first."],
    [/no portal login to download it/i, "They have no portal login. Deliver it another way and close the request."],
    [/not ready/i, "That package isn’t ready."],
    [/download has expired/i, "This download has expired. Ask the firm for a new copy."],
    [/privacy response access denied/i, "That download isn’t available to you."],
  ];
  for (const [pattern, text] of known) if (pattern.test(message)) return text;
  return complianceError(message);
}

export const SOURCE_LABEL: Record<string, string> = {
  person: "Client record",
  matter: "Matter",
  document: "Document",
  message_thread: "Messages",
  intake_response: "Intake form",
  invoice: "Invoice",
  consent: "Consent",
  booking: "Consultation",
  lead: "Enquiry",
  audit: "Activity log",
};

export const ITEM_DECISIONS = [
  ["include", "Include"],
  ["withhold", "Withhold the whole record"],
  ["redact", "Withhold some fields"],
] as const;

/** A short form of a SHA-256 for the page (the full value is in the manifest and the audit trail). */
export function shortHash(value: string | null | undefined): string {
  return value ? `${value.slice(0, 12)}…` : "—";
}
