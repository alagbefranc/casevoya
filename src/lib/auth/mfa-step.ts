/** Code entry when a factor is already verified. Setup otherwise. Explicit recovery and step-up steps stay available. */
export function mfaActiveStep(hasVerifiedFactor: boolean, requested: number | null): number {
  if (!hasVerifiedFactor) return 2;
  if (requested === 1 || requested === 5 || requested === 6) return requested;
  return 0;
}

/** The Designer's step-up line, written for exporting a client file. */
export const EXPORT_STEP_UP_LEAD = "Exporting a whole client file needs a fresh check, even when you’re already signed in.";

/** What the step-up page names: the line under the title and the action card below it. */
export type StepUpAction = { icon: string; title: string; detail: string };

/** The Designer's action card, written for exporting a client file. */
export const EXPORT_STEP_UP_ACTION: StepUpAction = { icon: "download", title: "Export a client file", detail: "All documents, forms and the audit trail" };

/**
 * SEC-01: every step-up caller names its action (`/mfa?step=6&for=<key>`), so "Confirm it’s you"
 * says exactly what the check is for. `phrase` completes "…to <phrase>"; the card repeats it with
 * what the action touches. Only these keys are read from the URL; anything else falls back to the
 * route-based text below.
 */
const ACTIONS = {
  export: { phrase: "export client files", icon: "download", title: "Export a client file", detail: "All documents, forms and the audit trail" },
  reconciliation: { phrase: "sign a reconciliation", icon: "bank", title: "Sign a reconciliation", detail: "The month’s bank balance, control ledger and client ledgers" },
  role: { phrase: "change a role", icon: "users", title: "Change a role or access", detail: "What this team member can see and do" },
  offboard: { phrase: "offboard a team member", icon: "logout", title: "Offboard a team member", detail: "Their access ends and their work is handed over" },
  continuity: { phrase: "change the continuity contact", icon: "user-check", title: "Change the continuity contact", detail: "Who takes over the firm’s files if you can’t" },
  staff_invite: { phrase: "invite a team member", icon: "user-plus", title: "Invite a team member", detail: "A new staff account for this firm" },
  firm_transfer: { phrase: "record a firm transfer", icon: "move-up", title: "Record a firm transfer", detail: "Matters and client authority moving between firms" },
  plan: { phrase: "change the firm’s plan", icon: "credit-card", title: "Change the firm’s plan", detail: "Plan, billing interval and seats" },
  retention: { phrase: "change the retention period", icon: "archive", title: "Change the retention period", detail: "How long closed matters are kept" },
  idle_timeout: { phrase: "change the idle sign-out time", icon: "clock", title: "Change the idle sign-out time", detail: "How long staff can be idle before Casevoya signs them out" },
  firm_settings: { phrase: "change firm settings", icon: "building", title: "Change firm settings", detail: "The firm’s details, offices and branding" },
  licence: { phrase: "update licence records", icon: "id-card", title: "Update licence records", detail: "Consultant licences and the matters they cover" },
  access_grant: { phrase: "grant access to records", icon: "key", title: "Grant access", detail: "Who can see a person’s records, and until when" },
  access_revoke: { phrase: "revoke access to records", icon: "key", title: "Revoke access", detail: "Access to a person’s records ends now" },
  support_access: { phrase: "answer a support access request", icon: "shield", title: "Answer a support request", detail: "Casevoya support opening your records" },
  connected_accounts: { phrase: "change connected accounts", icon: "plug", title: "Change connected accounts", detail: "Apps Vo and your team can reach" },
  messaging_channel: { phrase: "change the WhatsApp number", icon: "message", title: "Change the WhatsApp number", detail: "The firm’s number for client notices" },
  notification_settings: { phrase: "change notification settings", icon: "bell", title: "Change notification settings", detail: "Quiet hours and who is told what" },
  reminder_settings: { phrase: "change reminder settings", icon: "lightning", title: "Change reminder settings", detail: "Automatic reminder days and quiet hours" },
  booking_settings: { phrase: "change booking settings", icon: "calendar", title: "Change booking settings", detail: "Booking types, times and your public page" },
  enquiry_page: { phrase: "turn the enquiry page on or off", icon: "globe", title: "Change the enquiry page", detail: "The public form new clients use to reach you" },
  intake_publish: { phrase: "publish an intake form", icon: "file", title: "Publish an intake form", detail: "The questions clients are asked" },
  intake_delete: { phrase: "delete an intake form", icon: "trash", title: "Delete an intake form", detail: "The form stops being offered to clients" },
  portal_policy: { phrase: "publish a portal policy", icon: "privacy", title: "Publish a portal policy", detail: "Terms and privacy notice clients accept" },
  portal_invite: { phrase: "invite a client to the portal", icon: "user-plus", title: "Invite a client to the portal", detail: "What this person can see once they join" },
  go_live: { phrase: "switch the firm to live", icon: "toggle", title: "Switch to live", detail: "Real clients and records from now on" },
  import_signoff: { phrase: "sign off an import", icon: "import", title: "Sign off an import", detail: "Records moving into Casevoya from another system" },
  compliance: { phrase: "record a privacy request or complaint", icon: "privacy", title: "Record a privacy step", detail: "Privacy requests and the complaints register" },
  new_matter: { phrase: "open a new matter", icon: "briefcase", title: "Open a new matter", detail: "A new client file and who works on it" },
  matter_change: { phrase: "change this matter", icon: "briefcase", title: "Change this matter", detail: "Its stage, hold, deadlines or consultant" },
  matter_stage: { phrase: "change a matter’s stage", icon: "kanban", title: "Change the stage", detail: "Where this matter is in its work" },
  matter_hold: { phrase: "place or lift a hold", icon: "pause", title: "Place or lift a hold", detail: "Work and reminders on this matter" },
  matter_deadline: { phrase: "add a deadline", icon: "alarm", title: "Add a deadline", detail: "A date the matter must meet" },
  matter_consultant: { phrase: "change the responsible consultant", icon: "user-check", title: "Change the consultant", detail: "Who is responsible for this matter" },
  government_letter: { phrase: "record a government letter", icon: "mail", title: "Record a government letter", detail: "Correspondence from IRCC or another issuer" },
  submission: { phrase: "record a submission step", icon: "send", title: "Record a submission step", detail: "What was sent to the government, and when" },
  government_status: { phrase: "update government status", icon: "flag", title: "Update government status", detail: "What the government says about this application" },
  decision: { phrase: "record a decision step", icon: "check-circle", title: "Record a decision step", detail: "Approval follow-up, conditions and delivery" },
  renewal: { phrase: "change renewal details", icon: "repeat", title: "Change renewal details", detail: "Expiry dates and renewal reminders" },
  document_request: { phrase: "request a document", icon: "document-scan", title: "Request a document", detail: "What the client is asked to upload" },
  document_review: { phrase: "review a document", icon: "file-check", title: "Review a document", detail: "Accept or reject a client’s upload" },
  document_open: { phrase: "open a client document", icon: "eye", title: "Open a client document", detail: "The file is logged in the download audit" },
  file_email: { phrase: "file an email to a client", icon: "inbox", title: "File an email", detail: "The email joins this person’s matter" },
  intake_send: { phrase: "send a form to a client", icon: "send", title: "Send a form", detail: "Questions the client answers in their portal" },
  task_change: { phrase: "change a task", icon: "task", title: "Change a task", detail: "Its status, owner or due date" },
  reassign_work: { phrase: "reassign work", icon: "queue", title: "Reassign work", detail: "Tasks moving to another team member" },
  invoice: { phrase: "issue an invoice", icon: "invoice", title: "Issue an invoice", detail: "What the client is billed" },
  refund: { phrase: "refund a payment", icon: "refund", title: "Refund a payment", detail: "Money going back to the client" },
  credit_note: { phrase: "issue a credit note", icon: "invoice", title: "Issue a credit note", detail: "A correction to an invoice" },
  dispute_evidence: { phrase: "send dispute evidence", icon: "shield", title: "Send dispute evidence", detail: "Evidence sent to the card issuer" },
  client_funds: { phrase: "move client funds", icon: "wallet", title: "Move client funds", detail: "Money held in trust for a client" },
  manual_payment: { phrase: "record a payment", icon: "wallet", title: "Record a payment", detail: "A payment received outside Casevoya" },
  payment_settings: { phrase: "change payment settings", icon: "credit-card", title: "Change payment settings", detail: "How the firm takes card payments" },
  finance_correction: { phrase: "correct a finance record", icon: "reconcile", title: "Correct a finance record", detail: "Credit notes, voids and reconciliation items" },
  billing: { phrase: "change billing", icon: "invoice", title: "Change billing", detail: "Fees, retainers and what the client is billed" },
  agreement: { phrase: "change an agreement", icon: "signature", title: "Change an agreement", detail: "Terms the client signs" },
  countersign: { phrase: "countersign an agreement", icon: "signature", title: "Countersign an agreement", detail: "The firm’s signature on the client’s agreement" },
  quote: { phrase: "change a quote", icon: "invoice", title: "Change a quote", detail: "Fees offered to the client" },
  retention_delete: { phrase: "approve deleting a matter’s files", icon: "trash", title: "Approve a deletion", detail: "Files of a matter whose retention has ended" },
  subscription_cancel: { phrase: "cancel the subscription", icon: "credit-card", title: "Cancel the subscription", detail: "Ends at the close of the paid period; nothing is deleted" },
  subscription_end: { phrase: "choose what happens after cancelling", icon: "archive", title: "Choose the archive or transfer", detail: "Where the firm’s records go after the export window" },
  firm_index: { phrase: "download the firm export index", icon: "download", title: "Download the firm index", detail: "Every client-file package with its SHA-256" },
  privacy_response: { phrase: "build or open a privacy response", icon: "privacy", title: "Build a privacy response", detail: "The person’s records, with third-party information withheld" },
  privacy_download: { phrase: "download your privacy response", icon: "download", title: "Download your privacy response", detail: "Your records the firm sent through the portal" },
  letter_approve: { phrase: "approve a letter", icon: "file-check", title: "Approve a letter", detail: "The version that can be released to the client or the government" },
} as const satisfies Record<string, { phrase: string } & StepUpAction>;

export type StepUpActionKey = keyof typeof ACTIONS;

/** True for a key the step-up page knows. Anything else in `?for=` is ignored. */
export function isStepUpActionKey(value: unknown): value is StepUpActionKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ACTIONS, value);
}

/**
 * The step-up page for an action, coming back to `next` afterwards. `action` names what the check
 * is for; without it the page falls back to the route-based text.
 */
export function stepUpHref(next: string, action?: StepUpActionKey | null): string {
  const base = `/mfa?step=6&next=${encodeURIComponent(next)}`;
  return action ? `${base}&for=${action}` : base;
}

/** The phrase "to …" for an action key: "to change a role". */
export function stepUpPhrase(action: StepUpActionKey): string {
  return `to ${ACTIONS[action].phrase}`;
}

type StepUpKind = "export" | "reconciliation" | "other";

/** Where the person goes back to (`next`) after the check. */
function stepUpKind(next: string | null | undefined): StepUpKind {
  let url: URL | null = null;
  try {
    url = next ? new URL(next, "https://app.invalid") : null;
  } catch {
    url = null;
  }
  if (url?.pathname.startsWith("/sheet/exports")) return "export";
  if (url?.pathname === "/sheet/finance" && (url.searchParams.get("tab") === "reconciliation" || url.searchParams.get("dlg") === "recon")) {
    return "reconciliation";
  }
  return "other";
}

/** The action named by `?for=`, else the one the route implies (exports, reconciliation), else none. */
function actionFor(next: string | null | undefined, action: string | null | undefined): StepUpActionKey | null {
  if (isStepUpActionKey(action)) return action;
  const kind = stepUpKind(next);
  return kind === "other" ? null : kind;
}

/**
 * The step-up page's lead line. The caller's action (`?for=`) wins: "A fresh check is needed to
 * change a role, even when you’re already signed in." Export keeps the Designer's own line.
 */
export function stepUpLead(next: string | null | undefined, action?: string | null): string {
  const key = actionFor(next, action);
  if (key === "export") return EXPORT_STEP_UP_LEAD;
  if (key === "reconciliation") return "Signing a reconciliation needs a fresh check, even when you’re already signed in.";
  if (key) return `A fresh check is needed ${stepUpPhrase(key)}, even when you’re already signed in.`;
  return "This needs a fresh check, even when you’re already signed in.";
}

/** The step-up page's action card: the caller's action (`?for=`), else the route's, else a generic one. */
export function stepUpAction(next: string | null | undefined, action?: string | null): StepUpAction {
  const key = actionFor(next, action);
  if (key === "export") return EXPORT_STEP_UP_ACTION;
  if (key) {
    const found = ACTIONS[key];
    return { icon: found.icon, title: found.title, detail: found.detail };
  }
  return { icon: "arrow-right", title: "Finish what you were doing", detail: "You go back to the same page after the check" };
}
