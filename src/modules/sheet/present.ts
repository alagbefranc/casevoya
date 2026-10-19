/** Pure Sheet wiring: sample-mode stays on the captured pages; live firms use these labels. */

export const STAFF_ROLES = [
  "firm_owner",
  "licensed_consultant",
  "case_manager",
  "assistant",
  "finance_user",
] as const;

export const MATTER_STAGES = [
  "engagement_pending",
  "intake",
  "evidence_collection",
  "preparation",
  "consultant_review",
  "client_confirmation",
  "ready_to_submit",
  "submitted",
  "government_processing",
  "decision_review",
  "post_decision",
  "closed",
] as const;

export const GOVERNMENT_STATUSES = [
  "not_recorded",
  "receipt_on_file",
  "processing_reported",
  "additional_request_open",
  "decision_evidence_on_file",
] as const;

export const MATTER_OUTCOMES = [
  "approved",
  "refused",
  "withdrawn",
  "returned_or_incomplete",
  "abandoned",
  "other_verified",
] as const;

const STAGE_LABEL: Record<string, string> = {
  engagement_pending: "Engagement pending",
  intake: "Intake",
  evidence_collection: "Evidence collection",
  preparation: "Preparation",
  consultant_review: "Consultant review",
  client_confirmation: "Client confirmation",
  ready_to_submit: "Ready to submit",
  submitted: "Submitted",
  government_processing: "Government processing",
  decision_review: "Decision review",
  post_decision: "Post decision",
  closed: "Closed",
};

const GOVERNMENT_LABEL: Record<string, string> = {
  not_recorded: "Not recorded",
  receipt_on_file: "Receipt on file",
  processing_reported: "Processing reported",
  additional_request_open: "Additional request open",
  decision_evidence_on_file: "Decision evidence on file",
};

const OUTCOME_LABEL: Record<string, string> = {
  approved: "Approved",
  refused: "Refused",
  withdrawn: "Withdrawn",
  returned_or_incomplete: "Returned or incomplete",
  abandoned: "Abandoned",
  other_verified: "Other verified outcome",
};

const ROLE_LABEL: Record<string, string> = {
  firm_owner: "Firm owner",
  licensed_consultant: "Licensed consultant",
  case_manager: "Case manager",
  assistant: "Assistant",
  finance_user: "Finance",
  client: "Client",
  adult_dependant: "Adult dependant",
  sponsor: "Sponsor",
  employer_contact: "Employer contact",
  guardian: "Guardian",
};

/** Pages and matter/settings tabs whose backend is not on main. They render a marked slot. */
const SLOTS: Record<string, string> = {
  finance: "Client funds, reconciliation, refunds and disputes are not connected yet. Invoices and Stripe card payments are on the Invoices and Payments tabs. This screen reads and writes nothing.",
  inbox: "Messages and the email inbox are not connected. The mailer is in flight on another branch, so this screen does not touch email.",
  drafts: "Vo drafts are not connected. Nothing on this screen is generated, stored or sent.",
  ai: "Vo and AI settings are not connected. These switches are not saved.",
  pipeline: "Leads are not stored yet. The board is sample data only.",
  lead: "Lead detail is not stored yet. Convert, dedupe and CSV import do not write a record.",
  consultations: "Consultations and booking fees are not stored yet.",
  "calendar:week": "Appointments are not stored yet. Open Deadlines for dates the firm has recorded.",
  notifications: "A notification inbox is not stored yet.",
  reports: "Reports are not stored yet. Nothing here is exported.",
  automations: "Automations and run history are not stored yet.",
  complaints: "A complaints register is not stored yet.",
  privacy: "Subject-access requests are not stored yet.",
  exports: "Client-file export jobs are not stored yet.",
  migration: "Migration import is not stored yet.",
  enquiry: "The hosted enquiry form is not saved. There is no lead record behind it.",
  book: "The public booking page does not create an appointment.",
  "matter:messages": "Matter messages are not connected. The mailer is in flight on another branch.",
  "matter:billing": "Matter billing is not on this tab yet. Invoices and Stripe card payments are on the Finance page.",
  "matter:forms": "Prepared government forms are not stored yet. Intake answers are on the Intake tab.",
  "matter:submissions": "Submission packages are not stored yet. Casevoya does not submit to IRCC.",
  "settings:billing": "Subscription billing is not connected. It waits for the Stripe batch.",
  "settings:integrations": "Practice integrations are not connected.",
  "settings:ai": "Vo settings are not connected. These switches are not saved.",
  "settings:notifications": "Firm notification preferences are not stored yet.",
  "settings:branding": "Firm branding is not stored yet.",
  "settings:language": "Language preferences are not stored yet. The firm timezone is on Firm.",
  "settings:retention": "A firm-wide retention policy is not stored yet. A matter’s retention date is on Closure.",
  "settings:security": "Security preferences are not stored on this screen.",
  "settings:offboarding": "Offboarding is not connected. Moving tasks, authority and access does not run from this screen.",
};

const DEFAULT_TAB: Record<string, string> = {
  invitations: "staff",
  clients: "dir",
  pipeline: "board",
  ai: "settings",
  consultations: "upcoming",
  settings: "general",
  matter: "overview",
  documents: "review",
  agreements: "list",
  licence: "lic",
  automations: "builder",
  finance: "invoices",
  reports: "ops",
  calendar: "week",
  inbox: "conv",
  tasks: "internal",
  grants: "grants",
  migration: "map",
  templates: "program",
  "intake-builder": "build",
  notifications: "all",
};

export type SheetQuery = {
  tab?: string;
  view?: string;
  outcome?: string;
  hold?: string;
  ready?: string;
  dlg?: string;
  q?: string;
  state?: string;
  limit?: string;
  /** The person shown on the Clients page's person and household tabs. */
  person?: string;
  /** The Calendar page's week: any date in it, YYYY-MM-DD. */
  week?: string;
  /** A month box's month, YYYY-MM: the home right column, Consultations > Availability, Calendar. */
  month?: string;
  /** The open conversation on a matter's Messages tab. */
  thread?: string;
  /** The Intake form builder's form (stable key) and selected field (field key). */
  form?: string;
  field?: string;
  /** The lead shown on the lead page. */
  id?: string;
  /** The Lead pipeline's Stage (a stage key) and Owner (a membership id, or "none") filters. */
  stage?: string;
  owner?: string;
  /** A Vo draft or document reading to open (matter Messages and Documents tabs). */
  vo?: string;
  /** Where the page was opened from ("settings": Vo and AI reached from Settings › AI keeps that trail). */
  from?: string;
};

export function sheetVariant(page: string, query: SheetQuery): string {
  const parts: string[] = [];
  const tab = query.tab || DEFAULT_TAB[page];
  if (tab) parts.push(`tab-${tab}`);
  if (query.outcome) parts.push(`outcome-${query.outcome}`);
  if (query.hold) parts.push(`hold-${query.hold}`);
  if (query.ready) parts.push(`ready-${query.ready}`);
  if (query.dlg) parts.push(`dlg-${query.dlg}`);
  return parts.join("--") || "default";
}

export function defaultTab(page: string): string | undefined {
  return DEFAULT_TAB[page];
}

/** Null means the screen is wired. A string is the slot copy, and the screen must not show sample rows. */
export function slotFor(page: string, tab?: string): string | null {
  if (tab && SLOTS[`${page}:${tab}`]) return SLOTS[`${page}:${tab}`];
  if (page === "calendar" && tab === "deadlines") return null;
  return SLOTS[page] ?? null;
}

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

export function governmentLabel(status: string): string {
  return GOVERNMENT_LABEL[status] ?? status;
}

export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABEL[outcome] ?? outcome;
}

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

export function statusBadge(kind: "ok" | "rev" | "chg" | "bad" | "gr" | "unv", label: string): { className: string; label: string } {
  return { className: `bd ${kind}`, label };
}

export function taskBadge(status: string): { className: string; label: string } {
  if (status === "done") return statusBadge("ok", "Done");
  if (status === "blocked") return statusBadge("bad", "Blocked");
  if (status === "cancelled") return statusBadge("unv", "Cancelled");
  return statusBadge("rev", "Open");
}

export function deadlineBadge(verification: string): { className: string; label: string } {
  return verification === "confirmed" ? statusBadge("ok", "Confirmed") : statusBadge("chg", "Unverified");
}

export type MatterViewInput = {
  onHold: boolean;
  stage: string;
  nextDue: string | null;
  /** The soonest open task's due date on the matter, when known. */
  nextTaskDue?: string | null;
  pendingReview: boolean;
  /**
   * The viewer is on the matter (responsible consultant or on its team). When given,
   * "Awaiting my review" lists only those matters; absent, it is firm-wide (the demo bundle).
   */
  mine?: boolean;
  title: string;
  reference: string | null;
};

export function matterMatches(matter: MatterViewInput, view: string | undefined, query: string | undefined, today: string): boolean {
  const needle = (query ?? "").trim().toLowerCase();
  if (needle) {
    const hay = `${matter.title} ${matter.reference ?? ""}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  const week = plusDays(today, 7);
  const within = (date: string | null | undefined) => Boolean(date && date >= today && date <= week);
  if (view === "blocked") return matter.onHold;
  if (view === "review") return (matter.pendingReview || matter.stage === "consultant_review") && matter.mine !== false;
  // Due this week: a deadline or an open task due in the next 7 days (the firm's calendar).
  if (view === "due") return within(matter.nextDue) || within(matter.nextTaskDue);
  return true;
}

export function isoDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function plusDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function practiceCounts(input: {
  tasks: { status: string; dueOn: string | null }[];
  documentsPending: number;
  mattersOnHold: number;
  today: string;
}): { dueToday: number; awaitingReview: number; blocked: number } {
  return {
    dueToday: input.tasks.filter((task) => (task.status === "open" || task.status === "blocked") && task.dueOn === input.today).length,
    awaitingReview: input.documentsPending,
    blocked: input.mattersOnHold,
  };
}

export function invitationLabel(
  row: { revokedAt: string | null; consumedAt: string | null; declinedAt?: string | null; expiresAt: string },
  nowIso: string,
): "Revoked" | "Accepted" | "Declined" | "Expired" | "Open" {
  if (row.revokedAt) return "Revoked";
  if (row.consumedAt) return "Accepted";
  if (row.declinedAt) return "Declined";
  if (row.expiresAt <= nowIso) return "Expired";
  return "Open";
}

export function mattersTitle(view: string | undefined): string {
  if (view === "due") return "Due this week";
  if (view === "review") return "Awaiting my review";
  if (view === "blocked") return "Blocked matters";
  return "Matters";
}

export const SHEET_STATE_COPY: Record<string, [string, string, string, string, string]> = {
  index: ["portal-caught-up", "Nothing needs you today", "Due tasks, documents to review and unsigned agreements appear here as they come in.", "Open all matters", "your overview"],
  matters: ["matters-empty", "No matters yet", "Matters start from a signed service agreement and a program template.", "New matter", "matters"],
  matter: ["matters-empty", "This matter has no records yet", "Requests, documents and events appear as the team works on the file.", "Request a document", "this matter"],
  tasks: ["portal-nothing-due", "No open tasks", "Client tasks and internal tasks appear here with owners and due dates.", "New task", "tasks"],
  documents: ["review-queue-empty", "No documents waiting", "Uploads that need a review across every matter appear here.", "Open matters", "documents"],
  agreements: ["templates-empty", "No agreements yet", "Quotes and service agreements start from an approved template.", "New quote", "agreements"],
  invitations: ["team-badges", "No invitations", "Staff and client invitations expire after 7 days and work once.", "Invite someone", "invitations"],
};

export function sheetStateCopy(page: string): [string, string, string, string, string] {
  return SHEET_STATE_COPY[page] ?? ["filter-empty", "Nothing here yet", "Records appear here as your team works.", "Go back", page];
}
