/**
 * Words and mappings for government handoff, correspondence and decisions (T036 to T039).
 * Pure: shared by the loaders, the server actions, the Sheet acts, and tests. None of these
 * labels states an immigration rule; they name what the firm recorded.
 */

import { localToUtc } from "@/modules/scheduling/slots";

export const CORRESPONDENCE_KINDS = [
  "acknowledgement",
  "application_number",
  "request",
  "biometrics_instruction",
  "procedural_fairness",
  "status_update",
  "decision",
  "other",
] as const;
export type CorrespondenceKind = (typeof CORRESPONDENCE_KINDS)[number];

export const CORRESPONDENCE_CHANNELS = ["portal_message", "email", "mail", "courier", "in_person", "other"] as const;
export type CorrespondenceChannel = (typeof CORRESPONDENCE_CHANNELS)[number];

export const SUBMISSION_CHANNELS = ["online_portal", "paper", "email", "in_person", "other"] as const;
export type SubmissionChannel = (typeof SUBMISSION_CHANNELS)[number];

export const DECISION_MILESTONES = [
  "approval_in_principle",
  "final_approval",
  "documents_issued",
  "arrival_confirmed",
  "status_expiry_recorded",
  "other",
] as const;
export type DecisionMilestone = (typeof DECISION_MILESTONES)[number];

export const WITHDRAWAL_STEPS = [
  "withdrawal_instructions",
  "consultant_review",
  "withdrawal_request_sent",
  "acknowledgement_received",
  "financial_reconciliation",
] as const;
export type WithdrawalStep = (typeof WITHDRAWAL_STEPS)[number];

/** The Designer's "Record a government letter" Type options, as the kind they record. */
const LETTER_TYPE: Record<string, CorrespondenceKind> = {
  "Request for documents": "request",
  "Acknowledgement of receipt": "acknowledgement",
  "Biometrics instruction": "biometrics_instruction",
  "Procedural fairness letter": "procedural_fairness",
  Decision: "decision",
};

/** The Designer's "How it arrived" options. */
const LETTER_CHANNEL: Record<string, CorrespondenceChannel> = {
  "IRCC portal message": "portal_message",
  Email: "email",
  Mail: "mail",
};

export function letterKind(type: string): CorrespondenceKind | null {
  return LETTER_TYPE[type.trim()] ?? null;
}

export function letterChannel(via: string): CorrespondenceChannel | null {
  return LETTER_CHANNEL[via.trim()] ?? null;
}

const KIND_LABEL: Record<CorrespondenceKind, string> = {
  acknowledgement: "Acknowledgement of receipt",
  application_number: "Application number issued",
  request: "Request for documents",
  biometrics_instruction: "Biometrics instruction",
  procedural_fairness: "Procedural fairness letter",
  status_update: "Status update",
  decision: "Decision letter",
  other: "Other correspondence",
};

export function correspondenceLabel(kind: string): string {
  return KIND_LABEL[kind as CorrespondenceKind] ?? "Correspondence";
}

/** The Government status page's "Record a status" options: what a staff member may record there. */
export const STATUS_OPTIONS: readonly { value: CorrespondenceKind; label: string }[] = [
  { value: "acknowledgement", label: "Acknowledgement of receipt" },
  { value: "application_number", label: "Application number issued" },
  { value: "biometrics_instruction", label: "Biometrics requested" },
  { value: "status_update", label: "Status update" },
];

const CHANNEL_LABEL: Record<string, string> = {
  portal_message: "portal message",
  email: "email",
  mail: "mail",
  courier: "courier",
  in_person: "in person",
  other: "another channel",
  online_portal: "online portal",
  paper: "paper",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel] ?? "another channel";
}

export const SUBMISSION_CHANNEL_OPTIONS: readonly { value: SubmissionChannel; label: string }[] = [
  { value: "online_portal", label: "Online portal" },
  { value: "paper", label: "Paper" },
  { value: "email", label: "Email" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other" },
];

const MILESTONE_LABEL: Record<DecisionMilestone, string> = {
  approval_in_principle: "Approval in principle",
  final_approval: "Final approval",
  documents_issued: "Documents issued",
  arrival_confirmed: "Arrival confirmed",
  status_expiry_recorded: "Status expiry",
  other: "Other milestone",
};

export function milestoneLabel(milestone: string | null | undefined): string | null {
  return milestone ? (MILESTONE_LABEL[milestone as DecisionMilestone] ?? null) : null;
}

export const MILESTONE_OPTIONS: readonly { value: DecisionMilestone; label: string }[] = DECISION_MILESTONES.map((value) => ({
  value,
  label: MILESTONE_LABEL[value],
}));

const STEP_LABEL: Record<WithdrawalStep, { title: string; empty: string }> = {
  withdrawal_instructions: { title: "Written instructions from the client", empty: "Record when they arrive" },
  consultant_review: { title: "Consultant review", empty: "A licensed consultant records this" },
  withdrawal_request_sent: { title: "Withdrawal request sent", empty: "Record the confirmation" },
  acknowledgement_received: { title: "Acknowledgement received", empty: "Add the letter when it arrives" },
  financial_reconciliation: { title: "Financial reconciliation", empty: "Settle the client account in Finance" },
};

export function stepLabel(step: WithdrawalStep) {
  return STEP_LABEL[step];
}

export type GovBadge = { tone: string; label: string; detail?: string };

/** A handoff's state, said plainly. "Submitted" is never claimed without receipt evidence (GOV-03). */
export function handoffBadge(status: string): GovBadge {
  switch (status) {
    case "awaiting_signoff":
      return { tone: "chg", label: "Waiting for consultant sign-off" };
    case "authorized":
      return { tone: "blue", label: "Signed off, not yet submitted" };
    case "submission_unverified":
      return { tone: "unv", label: "Submission unverified" };
    case "submission_verified":
      // GOV-03: only with the government confirmation on file and its acknowledgement date.
      return { tone: "ok", label: "Submitted to government" };
    default:
      return { tone: "gr", label: "Cancelled" };
  }
}

/** A letter's state: received and unverified until a staff member checks it against its evidence. */
export function letterBadge(letter: { verifiedAt: string | null; hasEvidence: boolean }): GovBadge {
  if (letter.verifiedAt) return { tone: "ok", label: "Verified" };
  return { tone: "chg", label: "Received", detail: letter.hasEvidence ? "unverified" : "no evidence yet" };
}

export function outcomeHeading(outcome: string): { icon: string; title: string } {
  switch (outcome) {
    case "approved":
      return { icon: "check-circle", title: "Approved" };
    case "refused":
      return { icon: "alert", title: "Refused" };
    case "withdrawn":
      return { icon: "x-circle", title: "Withdrawal" };
    case "returned_or_incomplete":
      return { icon: "info", title: "Returned or incomplete" };
    case "abandoned":
      return { icon: "info", title: "Abandoned" };
    default:
      return { icon: "info", title: "Other verified outcome" };
  }
}

/** Short hex for a hash pill: "sha256 9be2…11c4". */
export function shortHash(hash: string | null | undefined): string | null {
  return hash && hash.length >= 8 ? `sha256 ${hash.slice(0, 4)}…${hash.slice(-4)}` : null;
}

/** Database refusals the Government acts can hit, as the Sheet's own copy. Unknown messages get a safe line. */
const GOV_ERRORS: [RegExp, string][] = [
  // GOV-01 and GOV-03 (20261025170000): the checklist, the release and the receipt.
  [/checklist is not complete/, "The submission checklist isn’t complete. Clear each blocking gate, or ask the firm owner to override it with a reason."],
  [/no stored files to release/, "There are no stored files on this matter to release. Upload the package files to Documents first."],
  [/upload the government confirmation/, "Upload the government confirmation as a file. A note of where it is kept isn’t enough on its own."],
  [/acknowledgement date is required/, "Add the acknowledgement date, as shown on the confirmation."],
  [/representation authority/, "Record the representation authority on this matter before sign-off."],
  [/open submission handoff/, "This matter already has a handoff in progress."],
  [/only after consultant sign-off/, "A licensed consultant signs off the package before the submission is recorded."],
  [/licensed member/, "The submitting representative must be a licensed member of the firm."],
  [/receipt evidence is required|needs the receipt/, "Add the receipt: a file or where it is kept."],
  [/stored file on this matter/, "Use a file that is stored on this matter."],
  [/received date/, "Add the date the firm received it. It can’t be in the future."],
  [/future/, "That date can’t be in the future."],
  [/verified decision letter/, "Verify the decision letter first."],
  [/milestones belong/, "Milestones apply only to an approval."],
  [/next steps/, "Write the reviewed next steps before confirming."],
  [/already has its evidence/, "This letter already has its evidence."],
  [/already/, "That was already recorded."],
  [/attach it first/, "Attach the letter or say where it is kept before verifying it."],
  [/after the consultant confirms/, "Follow-ups start once a licensed consultant confirms the decision."],
  [/no recorded expiry/, "That document has no expiry date recorded."],
  [/on or before the expiry/, "Choose a reminder date on or before the expiry."],
  [/belong to a withdrawal/, "These steps belong to a withdrawal."],
  [/duplicate key|unique/, "That step is already recorded."],
  [/version conflict/, "Someone else changed this. Reload and try again."],
  [/sample mode/, "This firm is in sample mode. Only sample matters accept new records."],
  [/package hash/, "The package hash must be its sha256: 64 characters, 0–9 and a–f only. Leave it blank if you don’t have one."],
  [/package version/, "Name the package version, like “Package v3” (up to 80 characters)."],
  [/attach the letter file|say where it is kept/, "Attach the letter file, or say where it is kept."],
  [/submission reference/, "Add the submission reference."],
  [/submission time/, "Add when it was submitted. It can’t be in the future or before sign-off."],
  [/say what was checked/, "Say what was checked."],
  [/engaged, open matter/, "A submission handoff needs an engaged, open matter."],
  [/licence blocks/, "Your licence status blocks this consultant action."],
  [/denied|staff access/, "Your role can’t do this on this matter."],
];

export function governmentError(message: string): string {
  for (const [pattern, copy] of GOV_ERRORS) if (pattern.test(message)) return copy;
  return "That couldn’t be saved.";
}

/**
 * The "Submitted at" field as an instant. The dialog fills it with the firm's wall time, so it is
 * read back in the firm's timezone, not the browser's (they differ for staff working elsewhere).
 */
export function submittedInstant(local: string, timeZone: string | undefined): string {
  if (!local) return "";
  const [date, time] = local.split("T");
  if (timeZone && date && time) {
    try {
      return new Date(localToUtc(date, time.slice(0, 5), timeZone)).toISOString();
    } catch {
      // Not a zone this browser knows: fall through to the browser's own reading.
    }
  }
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? "" : at.toISOString();
}
