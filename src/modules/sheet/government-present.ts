/**
 * Pure builders for the Government status page and the matter's Submissions and Decisions
 * tabs (T036 to T039). The loader reads the rows as the signed-in member (row-level security
 * decides what is visible); these only turn them into the Designer's words and the data
 * attributes the Sheet's government acts read. Every control is still checked by the database.
 */
import type { GovernmentPageData, GovernmentRow } from "@/components/sheet/designer/government";
import type {
  DecisionView,
  FollowUpRow,
  GovBadge,
  GovDialogsData,
  GovLetterRow,
  GovWire,
  MatterDecisionsData,
  MatterSubmissionsData,
  SubmissionRecord,
} from "@/components/sheet/designer/matter-government";
import type { SidebarPerson } from "@/components/sheet/designer/sidebar";
import {
  channelLabel,
  correspondenceLabel,
  handoffBadge,
  milestoneLabel,
  MILESTONE_OPTIONS,
  outcomeHeading,
  shortHash,
  STATUS_OPTIONS,
  stepLabel,
  SUBMISSION_CHANNEL_OPTIONS,
  WITHDRAWAL_STEPS,
} from "@/modules/government/present";
import { staffPerson } from "@/modules/sheet/avatar";
import type { EstimateRow } from "@/modules/government/status-provenance";
import { estimateTableRow, letterProvenance, statusDialogs, submissionProvenance } from "@/modules/sheet/gov-status-present";
import { dayMonth } from "@/modules/sheet/home-present";
import { dayMonthYear, firstName, longDate, taskDue } from "@/modules/sheet/matter-present";
import { isoDateInTimeZone, MATTER_OUTCOMES, outcomeLabel, stageLabel } from "@/modules/sheet/present";
import type { IssuerRow } from "@/modules/government/letters";
import { issuerList, letterIssuerParts, letterTaskLines, type LetterTaskRow } from "@/modules/sheet/letter-present";

export type HandoffRow = {
  id: string;
  package_label: string;
  package_sha256: string | null;
  channel: string;
  status: string;
  signoff_membership_id: string | null;
  signed_off_at: string | null;
  submitted_by_membership_id: string | null;
  external_reference: string | null;
  submitted_at: string | null;
  receipt_version_id: string | null;
  receipt_locator: string | null;
  acknowledged_on: string | null;
  verified_by_membership_id: string | null;
  verified_at: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
  version: number;
  /** GOV-03: the manifest pinned at release (20261025170000). */
  manifest_sha256?: string | null;
  manifest_file_count?: number | null;
  manifest_pinned_at?: string | null;
};

/** GOV-01: the checklist's verdict for Record submission, and IRCC's official channel names. */
export type SubmissionGate = { blocked: string[] | null; why: string | null; channelName?: (channel: string) => string };

export type LetterRow = {
  id: string;
  kind: string;
  channel: string;
  received_on: string;
  document_date: string | null;
  action_requested: string | null;
  stated_deadline: string | null;
  evidence_version_id: string | null;
  evidence_locator: string | null;
  verified_by_membership_id: string | null;
  verified_at: string | null;
  shared_with_client_at: string | null;
  created_by: string | null;
  created_at: string;
  version: number;
  /** GOV-04: who sent it, as recorded, and the approved issuer it names (null when typed). */
  issuer?: string | null;
  issuer_id?: string | null;
};

export type DecisionRow = {
  id: string;
  correspondence_id: string;
  outcome: string;
  milestone: string | null;
  decided_on: string | null;
  authority_reasons: string | null;
  state: string;
  consultant_interpretation: string | null;
  next_steps: string | null;
  confirmed_by_membership_id: string | null;
  confirmed_at: string | null;
  created_by: string | null;
  created_at: string;
  version: number;
};

export type FollowUp = {
  decision_id: string;
  kind: string;
  document_version_id: string | null;
  task: { id: string; title: string; status: string; priority: string; due_on: string | null; owner_membership_id: string | null; version: number } | null;
};

export type StepRow = { decision_id: string; step: string; note: string | null; done_by_membership_id: string; done_at: string };
/** `correspondence_id`: the status a check was about (GOV-05 Mark checked); null for the whole matter. */
export type CheckRow = { note: string; checked_by_membership_id: string; checked_at: string; correspondence_id?: string | null };
export type TransitionRow = { to_stage: string; actor_user_id: string | null; created_at: string };
export type DeadlineLink = { correspondence_id: string; due_on: string | null };
export type ExpiringDocument = { versionId: string; purpose: string; expiresOn: string };

export type GovernmentRecords = {
  handoffs: HandoffRow[];
  letters: LetterRow[];
  decisions: DecisionRow[];
  followUps: FollowUp[];
  steps: StepRow[];
  checks: CheckRow[];
  transitions: TransitionRow[];
  deadlines: DeadlineLink[];
  representation: boolean;
  documents: { total: number; open: number };
  expiring: ExpiringDocument[];
  /** GOV-04 (matter page only): the tasks each letter created, the firm's issuer list, client names. */
  letterTasks?: LetterTaskRow[];
  issuers?: IssuerRow[];
  people?: Map<string, string>;
  /** GOV-05: IRCC processing-time estimates entered on this matter. */
  estimates?: EstimateRow[];
};

export type GovernmentContext = {
  organizationId: string;
  matterId: string;
  stage: string;
  timezone: string;
  today: string;
  now: Date;
  /** Membership id to name, and user id to name, for "recorded by". */
  memberName: (membershipId: string | null) => string;
  userName: (userId: string | null) => string;
  /** The responsible consultant's name, if any. */
  consultant: string | null;
  me: string;
  role: string;
  /** The signed-in member holds a licence the database accepts. */
  licensed: boolean;
  /** Licensed members who can be the submitting representative. */
  representatives: { id: string; name: string }[];
  /** GOV-05: the firm's name, for "Recorded by <firm> on <date>" in the share preview. */
  firmName?: string;
};

const STAFF = new Set(["firm_owner", "licensed_consultant", "case_manager", "assistant"]);
const VERIFIERS = new Set(["firm_owner", "licensed_consultant", "case_manager"]);
const SUBMITTED_STAGES = new Set(["submitted", "government_processing", "decision_review", "post_decision"]);
const OPEN_FOR_HANDOFF = new Set(["evidence_collection", "preparation", "consultant_review", "client_confirmation", "ready_to_submit", "submitted", "government_processing"]);

const staffAvatar = (name: string): SidebarPerson => staffPerson(name);

/** "Today 09:12" or "14 Oct 18:40". */
export function whenFull(iso: string, timeZone: string, today: string): string {
  const date = isoDateInTimeZone(new Date(iso), timeZone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return date === today ? `Today ${time}` : `${dayMonth(date)} ${time}`;
}

/** `YYYY-MM-DDTHH:MM` for a datetime-local input, in the firm's zone. */
export function localInput(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function wire(act: string, ctx: GovernmentContext, extra: Record<string, string> = {}): GovWire {
  const out: GovWire = { "data-gov": act, "data-org": ctx.organizationId, "data-matter": ctx.matterId };
  for (const [key, value] of Object.entries(extra)) out[`data-${key}`] = value;
  return out;
}

const READ_ONLY: GovWire = { "data-gov": "ro" };

function latestOpen(handoffs: HandoffRow[]) {
  return handoffs.find((row) => row.status === "awaiting_signoff" || row.status === "authorized") ?? null;
}

function latestSubmitted(handoffs: HandoffRow[]) {
  return handoffs.find((row) => row.status === "submission_unverified" || row.status === "submission_verified") ?? null;
}

/* ------------------------------------------------------------ submissions */

export function buildSubmissions(records: GovernmentRecords, ctx: GovernmentContext, gate?: SubmissionGate): { tab: MatterSubmissionsData; dialogs: GovDialogsData } {
  const open = latestOpen(records.handoffs);
  const submitted = latestSubmitted(records.handoffs);
  const current = open ?? submitted;
  const canPrepare = STAFF.has(ctx.role) && OPEN_FOR_HANDOFF.has(ctx.stage);
  const canSubmit = VERIFIERS.has(ctx.role);
  const unverified = records.handoffs.find((row) => row.status === "submission_unverified") ?? null;

  let pkg: MatterSubmissionsData["package"] = null;
  if (current) {
    const signed = Boolean(current.signed_off_at);
    const recorded = current.status === "submission_unverified" || current.status === "submission_verified";
    const outstanding = records.documents.open;
    const reviewer = current.signoff_membership_id ? ctx.memberName(current.signoff_membership_id) : ctx.consultant ?? "A licensed consultant";
    const hold =
      current.status === "awaiting_signoff" && ctx.licensed && records.representation
        ? wire("signoff", ctx, { id: current.id, version: String(current.version) })
        : null;
    const why =
      current.status !== "awaiting_signoff" || hold
        ? null
        : { text: records.representation ? "A licensed consultant signs off the package" : "Opens when representation authority is on file" };
    pkg = {
      title: [current.package_label, signed ? "signed off" : "draft"],
      badge: handoffBadge(current.status),
      hash: shortHash(current.package_sha256),
      checks: [
        {
          title: "Required documents accepted by firm",
          done: records.documents.total > 0 && outstanding === 0,
          note: records.documents.total === 0 ? "No documents requested yet" : outstanding ? `${outstanding} outstanding` : null,
          wire: READ_ONLY,
        },
        { title: "Representation authority on file", done: records.representation, note: records.representation ? null : "Record it before sign-off", wire: READ_ONLY },
        { title: `Consultant sign-off of ${current.package_label}`, done: signed, wire: READ_ONLY },
        { title: "Submission recorded with its reference", done: recorded, wire: READ_ONLY },
        { title: "Receipt on file", done: current.status === "submission_verified", wire: READ_ONLY },
      ],
      approvals: [
        {
          person: staffAvatar(reviewer),
          title: "Consultant review",
          who: [reviewer, "licensed consultant"],
          badge: signed && current.signed_off_at
            ? { tone: "ok", label: `Signed off ${dayMonth(isoDateInTimeZone(new Date(current.signed_off_at), ctx.timezone))}` }
            : { tone: "gr", label: "Waiting for sign-off" },
        },
      ],
      note: "The sign-off is tied to this package version and its hash. A changed package needs a new handoff.",
      hold,
      why,
    };
  }

  const submittedRow = (row: HandoffRow): SubmissionRecord => {
    const at = row.submitted_at ? whenFull(row.submitted_at, ctx.timezone, ctx.today) : "—";
    const parts = [`Submitted ${at}`, `by ${ctx.memberName(row.submitted_by_membership_id)}`, gate?.channelName ? gate.channelName(row.channel) : channelLabel(row.channel)];
    if (row.manifest_sha256) {
      parts.push(`manifest ${row.manifest_file_count ?? 0} ${row.manifest_file_count === 1 ? "file" : "files"}, ${shortHash(row.manifest_sha256)}`);
    }
    if (row.status === "submission_verified") {
      parts.push(row.acknowledged_on ? `acknowledged ${dayMonth(row.acknowledged_on)}` : "receipt on file");
    } else {
      parts.push("no receipt yet");
    }
    return {
      dot: row.status === "submission_verified" ? "#2e9d5b" : "#f0a200",
      title: [row.external_reference ?? "No reference", row.package_label],
      parts,
      badge: handoffBadge(row.status),
      action: row.status === "submission_unverified" && canSubmit ? { label: "Add receipt", wire: { "data-open": "dSubRcpt" } } : null,
    };
  };

  const records_ = records.handoffs.filter((row) => row.status === "submission_unverified" || row.status === "submission_verified").map(submittedRow);
  const earlier: SubmissionRecord[] = records.handoffs
    .filter((row) => row.status === "cancelled")
    .map((row) => ({
      dot: "#d9d5d0",
      title: [row.package_label, "cancelled"],
      parts: [row.cancel_reason ?? "Cancelled", row.cancelled_at ? dayMonth(isoDateInTimeZone(new Date(row.cancelled_at), ctx.timezone)) : "—"],
      badge: handoffBadge("cancelled"),
    }));

  // GOV-01: Record submission opens only when the database's checklist has nothing blocking.
  const gatesClear = !gate || (gate.blocked !== null && gate.blocked.length === 0);
  const record = open?.status === "authorized" && canSubmit && gatesClear ? { "data-open": "dSubRec" } : null;
  const start = !current && canPrepare ? { "data-open": "dSubPrep" } : null;
  // Why Record submission is not open yet, said on the disabled button.
  const recordWhy = record
    ? null
    : !canSubmit
      ? "An owner, consultant or case manager records the submission."
      : open?.status === "awaiting_signoff"
        ? "Opens once a licensed consultant signs off the package."
        : open?.status === "authorized" && !gatesClear
          ? (gate?.why ?? "The submission checklist couldn’t load, so Record submission stays closed. Reload the page to try again.")
          : current
          ? null
          : "Start a submission handoff first. A licensed consultant signs it off, then the submission is recorded.";
  const tab: MatterSubmissionsData = { package: pkg, start, records: records_, record, recordWhy, earlier };
  // The database lets a handoff start from Evidence collection; it says so when documents are still outstanding.
  const outstanding = records.documents.open;
  const warning =
    outstanding > 0
      ? `${outstanding} requested ${outstanding === 1 ? "document is" : "documents are"} not accepted yet. You can start the handoff, but the checklist stays open until ${outstanding === 1 ? "it is" : "they are"} accepted.`
      : records.documents.total === 0
        ? "No documents have been requested on this matter yet. Check the package is complete before starting."
        : null;
  const dialogs: GovDialogsData = {
    prepare: start ? { wire: wire("prepare", ctx), channels: [...SUBMISSION_CHANNEL_OPTIONS], warning } : null,
    submit:
      record && open
        ? { wire: wire("submit", ctx, { id: open.id, version: String(open.version) }), representatives: ctx.representatives, now: localInput(ctx.now, ctx.timezone), timezone: ctx.timezone }
        : null,
    receipt: unverified && canSubmit ? { wire: wire("receipt", ctx, { id: unverified.id, version: String(unverified.version) }), today: ctx.today } : null,
  };
  return { tab, dialogs };
}

/* -------------------------------------------------------------- decisions */

function letterRows(records: GovernmentRecords, ctx: GovernmentContext): GovLetterRow[] {
  const canVerify = VERIFIERS.has(ctx.role);
  return records.letters.map((letter) => {
    const label = correspondenceLabel(letter.kind);
    const hasEvidence = Boolean(letter.evidence_version_id || letter.evidence_locator);
    const deadlines = records.deadlines.filter((link) => link.correspondence_id === letter.id && link.due_on);
    const parts = [`Received ${dayMonth(letter.received_on)} by ${channelLabel(letter.channel)}`, `recorded by ${firstName(ctx.userName(letter.created_by))}`];
    if (letter.document_date) parts.splice(1, 0, `dated ${dayMonthYear(letter.document_date, ctx.today)}`);
    for (const link of deadlines) parts.push(`created the ${dayMonth(link.due_on as string)} deadline`);
    if (letter.stated_deadline) parts.push(`letter says: ${statedDeadline(letter.stated_deadline, ctx.today)}`);
    const tasks = (records.letterTasks ?? []).filter((task) => task.correspondence_id === letter.id);
    const urgent = letter.kind === "request" || letter.kind === "procedural_fairness" || letter.kind === "decision";
    return {
      dot: urgent ? "#0075DE" : "#2e9d5b",
      title: letter.action_requested ? [label, letter.action_requested] : label,
      parts,
      badge: letter.verified_at ? { tone: "ok", label: "Verified" } : hasEvidence ? { tone: "chg", label: "Not verified yet" } : { tone: "gr", label: "No evidence yet" },
      verify:
        !letter.verified_at && hasEvidence && canVerify
          ? wire("verify-letter", ctx, { id: letter.id, version: String(letter.version) })
          : null,
      // A letter recorded without its evidence: attach it, then it can be verified.
      attach: !letter.verified_at && !hasEvidence && STAFF.has(ctx.role) ? wire("attach-letter", ctx, { id: letter.id, version: String(letter.version) }) : null,
      issuer: letterIssuerParts(letter.issuer, letter.issuer_id, records.issuers ?? [], ctx.memberName),
      tasks: letterTaskLines(tasks, { member: ctx.memberName, person: (id) => (id ? records.people?.get(id) : undefined) ?? "the client" }, ctx.today),
    };
  });
}

/** A letter's stated deadline: a date the Sheet recorded ("20 Nov"), or the words as written on older letters. */
export function statedDeadline(value: string, today: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? dayMonthYear(value, today) : value;
}

function decisionView(records: GovernmentRecords, ctx: GovernmentContext, decision: DecisionRow): DecisionView {
  const letter = records.letters.find((row) => row.id === decision.correspondence_id) ?? null;
  const confirmed = decision.state === "confirmed";
  const consultantFirst = firstName(ctx.consultant ?? "the consultant");
  const confirmer = decision.confirmed_by_membership_id ? ctx.memberName(decision.confirmed_by_membership_id) : null;
  const group: DecisionView["outcome"] = decision.outcome === "approved" || decision.outcome === "refused" || decision.outcome === "withdrawn" ? decision.outcome : "other";
  const badge: GovBadge = confirmed
    ? {
        tone: "ok",
        label: `Confirmed by ${confirmer ?? "a consultant"}${decision.confirmed_at ? `, ${longDate(isoDateInTimeZone(new Date(decision.confirmed_at), ctx.timezone))}` : ""}`,
      }
    : group === "refused"
      ? { tone: "bad", label: "Urgent consultant review" }
      : { tone: "chg", label: "Waiting for consultant confirmation" };
  const confirm = !confirmed && ctx.licensed ? { wire: wire("confirm", ctx, { id: decision.id, version: String(decision.version) }) } : null;

  const decisionIds = new Set(records.decisions.map((row) => row.id));
  const followUps: FollowUpRow[] = records.followUps
    .filter((row) => decisionIds.has(row.decision_id) && row.task && (row.task.status === "open" || row.task.status === "blocked"))
    .map((row) => {
      const task = row.task as NonNullable<FollowUp["task"]>;
      const owner = ctx.memberName(task.owner_membership_id);
      return {
        title: task.title,
        note: taskDue(task.due_on, ctx.today) ?? "No due date",
        owner: staffAvatar(owner),
        urgent: row.kind === "refusal_review" || task.priority === "critical",
        wire: wire("task-done", ctx, { id: task.id, version: String(task.version) }),
      };
    });
  // DEC-02: expiry reminders are recorded on the Expiry and renewal card (renewal-present.ts), where the
  // date is an approved IRCC timing or the firm's choice. No row here defaults it to the expiry date.

  const view: DecisionView = {
    outcome: group,
    heading: outcomeHeading(decision.outcome).title,
    tint:
      group === "approved"
        ? { art: "post-decision", title: "Follow-ups after the decision", copy: "Expiry and renewal reminders are added here as tasks for your review." }
        : {
            art: "p3-decision",
            title: "Decision recorded from the letter",
            copy: "Casevoya doesn’t set reconsideration or new-application deadlines. Any that apply are recorded after consultant review.",
          },
    badge,
    confirm,
    followUps,
    consultantFirst,
  };

  if (group === "refused") {
    view.record = {
      received: letter ? longDate(letter.received_on) : "—",
      recordedBy: ctx.userName(decision.created_by),
      confirmedBy: confirmer ?? `Waiting for ${consultantFirst}`,
    };
    view.reasons = decision.authority_reasons;
    view.interpretation = decision.consultant_interpretation;
    return view;
  }
  if (group === "withdrawn") {
    const done = records.steps.filter((row) => row.decision_id === decision.id);
    view.steps = WITHDRAWAL_STEPS.map((step) => {
      const row = done.find((item) => item.step === step);
      const label = stepLabel(step);
      return {
        title: label.title,
        note: row
          ? `${ctx.memberName(row.done_by_membership_id)}, ${dayMonth(isoDateInTimeZone(new Date(row.done_at), ctx.timezone))}${row.note ? `, ${row.note}` : ""}`
          : label.empty,
        done: Boolean(row),
        wire: row ? READ_ONLY : VERIFIERS.has(ctx.role) ? wire("step", ctx, { id: decision.id, step }) : READ_ONLY,
      };
    });
    const count = done.length;
    if (confirmed || count) {
      view.badge = count === WITHDRAWAL_STEPS.length ? { tone: "ok", label: "All steps recorded" } : { tone: "chg", label: `In progress, ${count} of ${WITHDRAWAL_STEPS.length}` };
    }
    return view;
  }
  view.milestoneLabel = decision.milestone ? milestoneLabel(decision.milestone)?.toLowerCase() ?? null : null;
  view.evidence = {
    line: letter
      ? [correspondenceLabel(letter.kind), `received ${longDate(letter.received_on)}`, `recorded by ${firstName(ctx.userName(letter.created_by))}`]
      : ["Decision letter"],
  };
  const approvals = records.decisions.filter((row) => row.outcome === decision.outcome);
  view.milestones = approvals.map((row) => ({
    label: milestoneLabel(row.milestone) ?? outcomeLabel(row.outcome),
    badge:
      row.state === "confirmed"
        ? { tone: "ok", label: row.decided_on ? dayMonth(row.decided_on) : "Confirmed" }
        : { tone: "rev", label: "Waiting for confirmation" },
  }));
  view.summary = {
    title: "Next steps",
    copy: decision.next_steps ?? "The consultant writes the reviewed next steps when they confirm the outcome.",
  };
  return view;
}

export function buildDecisions(records: GovernmentRecords, ctx: GovernmentContext): MatterDecisionsData {
  const latest = records.decisions[0] ?? null;
  const letters = letterRows(records, ctx);
  // GOV-04: the firm's issuer list, on the matter page only (the loader reads it there).
  const issuers = records.issuers
    ? issuerList({ organizationId: ctx.organizationId, today: ctx.today, issuers: records.issuers, canAdd: STAFF.has(ctx.role), canReview: ctx.licensed, memberName: ctx.memberName })
    : null;
  if (latest) return { decision: decisionView(records, ctx, latest), letter: STAFF.has(ctx.role), letters, issuers };
  const verifiedDecision = records.letters.find((row) => row.kind === "decision" && row.verified_at) ?? null;
  return {
    decision: null,
    letter: STAFF.has(ctx.role),
    letters,
    issuers,
    recordForm:
      verifiedDecision && VERIFIERS.has(ctx.role)
        ? {
            wire: wire("decision", ctx, { id: verifiedDecision.id }),
            outcomes: MATTER_OUTCOMES.map((value) => ({ value, label: outcomeLabel(value) })),
            milestones: [...MILESTONE_OPTIONS],
          }
        : null,
  };
}

/* ------------------------------------------------- Government status page */

function letterTableRow(letter: LetterRow, ctx: GovernmentContext, item?: string, records?: GovernmentRecords): GovernmentRow {
  const hasEvidence = Boolean(letter.evidence_version_id || letter.evidence_locator);
  return {
    item: item ?? correspondenceLabel(letter.kind),
    status: letter.verified_at ? { tone: "ok", label: "Verified" } : { tone: "chg", label: "Received", detail: hasEvidence ? "unverified" : "no evidence yet" },
    recordedBy: ctx.userName(letter.created_by),
    evidence: letter.evidence_locator ?? (letter.evidence_version_id ? `File on the matter, received ${dayMonth(letter.received_on)}` : "No evidence yet"),
    verified: letter.verified_at ? `${ctx.memberName(letter.verified_by_membership_id)}, ${whenFull(letter.verified_at, ctx.timezone, ctx.today)}` : "Not verified by staff",
    lastChecked: whenFull(letter.created_at, ctx.timezone, ctx.today),
    verify: !letter.verified_at && hasEvidence && VERIFIERS.has(ctx.role) ? wire("verify-letter", ctx, { id: letter.id, version: String(letter.version) }) : null,
    attach: !letter.verified_at && !hasEvidence && STAFF.has(ctx.role) ? wire("attach-letter", ctx, { id: letter.id, version: String(letter.version) }) : null,
    // GOV-05: source, evidence link, last checked (this status or the whole matter), Mark checked, sharing.
    ...(records ? letterProvenance(letter, records, ctx) : {}),
  };
}

export function buildGovernmentPage(records: GovernmentRecords, ctx: GovernmentContext): GovernmentPageData {
  const lastCheck = records.checks[0] ?? null;
  const lastChecked = lastCheck ? whenFull(lastCheck.checked_at, ctx.timezone, ctx.today) : "—";
  const submitted = latestSubmitted(records.handoffs);
  const latest = records.handoffs[0] ?? null;
  const submissionsTab = `/sheet/matters/${ctx.matterId}?tab=submissions`;

  let alert: GovernmentPageData["alert"] = null;
  if (submitted?.status === "submission_unverified") {
    alert = {
      copy: `A submission was recorded${submitted.submitted_at ? ` on ${dayMonth(isoDateInTimeZone(new Date(submitted.submitted_at), ctx.timezone))}` : ""}, but no confirmation is on file. Upload the confirmation to verify it.`,
      // GOV-03: the confirmation needs its acknowledgement date too, so both open the receipt dialog.
      upload: { "data-nav": VERIFIERS.has(ctx.role) ? `${submissionsTab}&dlg=receipt` : submissionsTab },
      manual: { "data-nav": `${submissionsTab}&dlg=receipt` },
    };
  } else if (SUBMITTED_STAGES.has(ctx.stage) && !submitted) {
    alert = {
      copy: `The matter is at “${stageLabel(ctx.stage)}” in our stages, but no verified submission is recorded here. Record it on the matter’s Submissions tab.`,
      upload: { "data-nav": submissionsTab },
      manual: { "data-nav": submissionsTab },
    };
  }

  const rows: GovernmentRow[] = [];
  if (latest) {
    const recorder = latest.submitted_by_membership_id ? ctx.memberName(latest.submitted_by_membership_id) : ctx.userName(latest.created_by);
    rows.push({
      item: "Submission",
      status: handoffBadge(latest.status),
      recordedBy: recorder,
      evidence:
        latest.status === "submission_verified"
          ? (latest.receipt_locator ?? "Receipt file on the matter")
          : latest.status === "submission_unverified"
            ? "No confirmation uploaded yet"
            : `${latest.package_label}, not submitted yet`,
      verified: latest.verified_at ? `${ctx.memberName(latest.verified_by_membership_id)}, ${whenFull(latest.verified_at, ctx.timezone, ctx.today)}` : "—",
      lastChecked,
      ...submissionProvenance(latest, records, ctx),
    });
  } else {
    rows.push({ item: "Submission", status: { tone: "gr", label: "Not recorded" }, recordedBy: "—", evidence: "—", verified: "—", lastChecked, ...submissionProvenance(null, records, ctx) });
  }
  // GOV-05: IRCC's processing-time estimate sits next to the submission status, once entered.
  const estimate = estimateTableRow(records, ctx);
  if (estimate) rows.push(estimate);
  const number = records.letters.find((row) => row.kind === "application_number");
  rows.push(
    number
      ? letterTableRow(number, ctx, "Application number", records)
      : { item: "Application number", status: { tone: "gr", label: "Not yet recorded" }, recordedBy: "—", evidence: "—", verified: "—", lastChecked: "—" },
  );
  const biometrics = records.letters.find((row) => row.kind === "biometrics_instruction");
  rows.push(
    biometrics
      ? letterTableRow(biometrics, ctx, "Biometrics", records)
      : { item: "Biometrics", status: { tone: "gr", label: "Not recorded" }, recordedBy: "—", evidence: "—", verified: "—", lastChecked: "—" },
  );
  for (const letter of records.letters) {
    if (letter === number || letter === biometrics) continue;
    rows.push(letterTableRow(letter, ctx, undefined, records));
  }

  type Event = { at: string; text: string };
  const events: Event[] = [];
  for (const check of records.checks) events.push({ at: check.checked_at, text: `${firstName(ctx.memberName(check.checked_by_membership_id))} checked: ${check.note}` });
  for (const letter of records.letters) {
    const who = firstName(ctx.userName(letter.created_by));
    events.push({ at: letter.created_at, text: `${who} recorded ${correspondenceLabel(letter.kind).toLowerCase()}, received ${dayMonth(letter.received_on)}${letter.verified_at ? "" : " (unverified)"}.` });
    if (letter.verified_at) {
      events.push({ at: letter.verified_at, text: `${firstName(ctx.memberName(letter.verified_by_membership_id))} verified ${correspondenceLabel(letter.kind).toLowerCase()}.` });
    }
  }
  for (const handoff of records.handoffs) {
    events.push({ at: handoff.created_at, text: `${firstName(ctx.userName(handoff.created_by))} started a handoff for ${handoff.package_label}.` });
    if (handoff.signed_off_at) events.push({ at: handoff.signed_off_at, text: `${firstName(ctx.memberName(handoff.signoff_membership_id))} signed off ${handoff.package_label}.` });
    if (handoff.verified_at) events.push({ at: handoff.verified_at, text: `${firstName(ctx.memberName(handoff.verified_by_membership_id))} verified the submission receipt.` });
  }
  for (const move of records.transitions) events.push({ at: move.created_at, text: `Stage moved to ${stageLabel(move.to_stage)} by ${firstName(ctx.userName(move.actor_user_id))}.` });
  events.sort((a, b) => b.at.localeCompare(a.at));
  const history = events.slice(0, 8).map((event) => ({ text: event.text, when: whenFull(event.at, ctx.timezone, ctx.today) }));

  const provenance = statusDialogs(records, ctx);
  return {
    intro: "What the firm knows about the government application, who recorded it, from what evidence, and when it was last checked. This is a record kept by the firm, not a live feed.",
    alert,
    rows,
    estimate: provenance.estimate,
    dialogs: provenance.dialogs,
    record: STAFF.has(ctx.role)
      ? { options: [{ value: "check", label: "Checked, no change" }, ...STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))], save: wire("status", ctx, { today: ctx.today }) }
      : null,
    history: history.length ? history : [{ text: "Nothing recorded yet.", when: "—" }],
  };
}

export const GOVERNMENT_PILLS = ["No live government connection", "Every entry needs a source"];
