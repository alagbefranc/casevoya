import type { Action, DlRow, Line, StateBadge, Step } from "@/components/sheet/designer/compliance";
import { PRIVACY_DIALOG, type PrivacyData, type PrivacyDialogsData, type PrivacyHeaderData, type PrivacySelected, type Worklist } from "@/components/sheet/designer/privacy";
import { CHANNEL_LABEL, CONSENT_LABEL, KIND_LABEL, OUTCOME_LABEL, REDACTION_LABEL, dayMonth, dayMonthYear, localDate } from "./format";
import {
  effectiveDue,
  foundPanel,
  limitsPanel,
  responseActions,
  responseDialogs,
  responseRows,
  type ExtensionFields,
  type PrivacyExtras,
} from "./privacy-response-present";

/**
 * Privacy requests page (SEC-05, SEC-06) from the firm's rows. Pure: the loader reads the
 * database as the signed-in staff member and passes the rows here. The due date is the firm's
 * own target; nothing here states a legal deadline.
 */

export type PrivacyRequestRow = ExtensionFields & {
  id: string;
  reference: string;
  kind: string;
  requester_name: string;
  person_id: string | null;
  details: string;
  channel: string;
  received_on: string;
  target_days: number | null;
  due_on: string | null;
  assignee_membership_id: string;
  identity_verified_at: string | null;
  identity_method: string | null;
  scope_at: string | null;
  scope_note: string | null;
  redaction_at: string | null;
  redaction_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  closed_at: string | null;
  outcome: string | null;
  outcome_note: string | null;
  refusal_reason: string | null;
  delivery_method: string | null;
  evidence_note: string | null;
};

export type RedactionRow = { id: string; request_id: string; record_label: string; third_party: string; removed: string; state: string; done_by: string | null };
export type ConsentRow = { id: string; purpose: string; created_at: string; granted: boolean; withdrawn_at: string | null };
export type KeptRecord = { matter_id?: string; reference?: string; reason?: string; retention_on?: string | null };

export type PrivacyContext = {
  organizationId: string;
  timezone: string;
  today: string;
  /** Display names: staff by user id, and by membership id. */
  userName: (userId: string | null) => string;
  memberName: (membershipId: string) => string;
  /** The signed-in staff member's memberships in this firm. */
  myMemberships: string[];
  isOwner: boolean;
  /** Owner, licensed consultant or case manager: may record requests. */
  canRecord: boolean;
  privacyContact: string | null;
  selectedId: string | undefined;
};

type NextStep = "identity" | "scope" | "redaction" | "review" | "close";

export function nextStep(row: PrivacyRequestRow): NextStep {
  if (!row.identity_verified_at) return "identity";
  if (!row.scope_at) return "scope";
  if (row.kind === "access" && !row.redaction_at) return "redaction";
  if (!row.reviewed_at) return "review";
  return "close";
}

const STAGE: Record<NextStep, { tone: string; label: string }> = {
  identity: { tone: "rev", label: "Identity to check" },
  scope: { tone: "blue", label: "Searching" },
  redaction: { tone: "blue", label: "Redacting" },
  review: { tone: "chg", label: "Awaiting review" },
  close: { tone: "blue", label: "Ready to close" },
};

export function requestBadge(row: PrivacyRequestRow, today: string, timezone: string): StateBadge {
  if (row.closed_at && row.outcome) {
    const on = dayMonth(localDate(row.closed_at, timezone));
    const tone = row.outcome === "refused" ? "bad" : row.outcome === "withdrawn" ? "gr" : "ok";
    return { tone, label: `${OUTCOME_LABEL[row.outcome] ?? "Closed"} ${on}` };
  }
  const stage = STAGE[nextStep(row)];
  const due = effectiveDue(row);
  if (due && due < today) return { tone: "bad", label: "Past target", detail: stage.label.toLowerCase() };
  return stage;
}

function scopeTitle(kind: string): string {
  if (kind === "consent_withdrawal") return "Impact reviewed";
  if (kind === "deletion") return "Records checked";
  return "Scope searched";
}

function finalTitle(kind: string): string {
  if (kind === "access") return "Exported and delivered";
  if (kind === "correction") return "Corrected and confirmed";
  if (kind === "consent_withdrawal") return "Consent withdrawn";
  return "Decision recorded";
}

function closedSummary(row: PrivacyRequestRow, timezone: string): Line {
  const on = dayMonth(localDate(row.closed_at as string, timezone));
  const what = OUTCOME_LABEL[row.outcome ?? ""] ?? "Closed";
  return row.delivery_method ? [`${what} ${on}`, row.delivery_method] : `${what} ${on}`;
}

export function requestSteps(row: PrivacyRequestRow, ctx: PrivacyContext, lines: RedactionRow[]): Step[] {
  const tz = ctx.timezone;
  const closed = Boolean(row.closed_at);
  const steps: { key: NextStep; title: string; done: boolean; small: Line | undefined }[] = [
    {
      key: "identity",
      title: "Identity verified",
      done: Boolean(row.identity_verified_at),
      small: row.identity_verified_at ? `${row.identity_method ?? "Checked"}, ${dayMonth(localDate(row.identity_verified_at, tz))}` : "Not checked yet",
    },
    { key: "scope", title: scopeTitle(row.kind), done: Boolean(row.scope_at), small: row.scope_note ?? undefined },
  ];
  if (row.kind === "access") {
    const done = lines.filter((line) => line.state !== "to_do").length;
    steps.push({
      key: "redaction",
      title: "Third-party information redacted",
      done: Boolean(row.redaction_at),
      small: row.redaction_note ?? (lines.length ? [`${lines.length} ${lines.length === 1 ? "line" : "lines"} on the worklist`, `${done} of ${lines.length} done`] : "Other people’s private details removed"),
    });
  }
  steps.push({
    key: "review",
    title: "Reviewed",
    done: Boolean(row.reviewed_at),
    small: row.reviewed_at ? ctx.userName(row.reviewed_by) : ctx.memberName(row.assignee_membership_id),
  });
  steps.push({ key: "close", title: finalTitle(row.kind), done: closed, small: closed ? closedSummary(row, tz) : "Recorded when the request closes" });
  let current = closed ? -1 : steps.findIndex((step) => !step.done);
  if (current === -1 && !closed) current = steps.length - 1;
  return steps.map((step, index) => ({
    state: step.done ? "done" : index === current ? "now" : "",
    title: step.title,
    ...(step.small !== undefined ? { small: step.small } : {}),
  }));
}

function notes(row: PrivacyRequestRow): string[] {
  const out = [`They asked: ${row.details}`];
  if (row.kind === "access") out.push("Remove other people’s private information before anything is shared. Their own records stay in full.");
  if (row.kind === "consent_withdrawal")
    out.push("Withdrawing consent starts an impact review. It doesn’t delete records the firm must keep, or any under a legal hold.");
  if (row.kind === "deletion")
    out.push("Casevoya never deletes records here. Records the firm must keep, or that are under a hold, stay. Record the decision and the reason.");
  if (row.refusal_reason) out.push(`Reason for refusing: ${row.refusal_reason}`);
  if (row.outcome_note) out.push(row.outcome_note);
  return out;
}

const KEPT_REASON: Record<string, string> = {
  on_hold: "Matter on hold",
  open: "Matter still open",
  retention: "Retention period",
  retention_unset: "Closed, no retention date recorded",
};

function worklist(row: PrivacyRequestRow, ctx: PrivacyContext, lines: RedactionRow[], consents: ConsentRow[] | null, kept: KeptRecord[] | null, editable: boolean): Worklist | null {
  if (row.kind === "access") {
    return {
      icon: "eye",
      title: ["Redaction worklist", row.reference],
      label: "Redactions",
      columns: ["Record", "Third party", "What’s removed", "By", "State"],
      empty: "Nothing on the worklist yet. Add a line for each record that mentions someone else.",
      rows: lines.map((line) => ({
        cells: [
          { text: line.record_label },
          { text: line.third_party },
          { text: line.removed },
          { text: line.done_by ? ctx.userName(line.done_by) : "—" },
          { badge: REDACTION_LABEL[line.state] ?? { tone: "gr", label: line.state } },
        ],
        attrs: editable
          ? { "data-redaction-edit": line.id, "data-record": line.record_label, "data-party": line.third_party, "data-removed": line.removed, "data-state": line.state }
          : undefined,
      })),
    };
  }
  if (row.kind === "deletion") {
    return {
      icon: "shield",
      title: ["Records kept", row.reference],
      label: "Records kept",
      columns: ["Matter", "Why it’s kept", "Until"],
      empty: row.person_id ? "No matter keeps this person’s records. Casevoya still doesn’t delete them; record your decision." : "Not linked to a client record.",
      rows: (kept ?? []).map((record) => ({
        cells: [
          { text: record.reference ?? "Matter" },
          { text: KEPT_REASON[record.reason ?? ""] ?? "Kept" },
          { text: record.retention_on ? dayMonthYear(record.retention_on) : "—" },
        ],
      })),
    };
  }
  if (row.kind === "consent_withdrawal") {
    return {
      icon: "check-circle",
      title: ["Consents", row.reference],
      label: "Consents",
      columns: ["Consent", "Given", "State"],
      empty: row.person_id ? "No consent records for this person." : "Not linked to a client record.",
      rows: (consents ?? []).map((consent) => ({
        cells: [
          { text: CONSENT_LABEL[consent.purpose] ?? consent.purpose },
          { text: dayMonthYear(localDate(consent.created_at, ctx.timezone)) },
          {
            badge: !consent.granted
              ? { tone: "gr", label: "Declined" }
              : consent.withdrawn_at
                ? { tone: "gr", label: `Withdrawn ${dayMonth(localDate(consent.withdrawn_at, ctx.timezone))}` }
                : { tone: "ok", label: "Active" },
          },
        ],
      })),
    };
  }
  return null;
}

const STEP_BUTTON: Record<Exclude<NextStep, "close">, (kind: string) => string> = {
  identity: () => "Record identity check",
  scope: (kind) => (kind === "consent_withdrawal" ? "Record impact review" : kind === "deletion" ? "Record records check" : "Record scope search"),
  redaction: () => "Mark redaction done",
  review: () => "Record review",
};

export function canWork(row: PrivacyRequestRow, ctx: PrivacyContext): boolean {
  return ctx.isOwner || ctx.myMemberships.includes(row.assignee_membership_id);
}

function deadline(row: PrivacyRequestRow, ctx: PrivacyContext, lines: RedactionRow[], extras: PrivacyExtras | undefined): { rows: DlRow[]; actions: Action[] } {
  const rows: DlRow[] = [
    { term: "Firm target", value: row.due_on && row.target_days ? [`${row.target_days} days from receipt`, dayMonthYear(row.due_on)] : "None set" },
    { term: "Received", value: [dayMonthYear(row.received_on), `by ${CHANNEL_LABEL[row.channel] ?? row.channel}`] },
    { term: "Handled by", value: ctx.memberName(row.assignee_membership_id) },
  ];
  // SEC-06: the legal time limit (when approved), the extension, the package and its delivery proof.
  if (extras) rows.push(...responseRows(row, extras, ctx));
  if (row.closed_at) {
    rows.push({ term: "Outcome", value: closedSummary(row, ctx.timezone) });
    if (row.evidence_note) rows.push({ term: "Evidence", value: row.evidence_note });
  } else if (!extras || row.kind !== "access") {
    rows.push({ term: "Delivery", value: "Recorded when the request closes" });
  }
  const actions: Action[] = [];
  if (!row.closed_at && canWork(row, ctx)) {
    const next = nextStep(row);
    if (next !== "close") actions.push({ label: STEP_BUTTON[next](row.kind), primary: true, attrs: { "data-dlg": PRIVACY_DIALOG.step } });
    if (extras) actions.push(...responseActions(row, extras, ctx.organizationId));
    if (row.kind === "access" && row.scope_at && !row.redaction_at) actions.push({ label: "Add redaction line", attrs: { "data-redaction-new": "1" } });
    if (row.kind !== "deletion" || ctx.isOwner) actions.push({ label: "Close request", primary: next === "close", attrs: { "data-dlg": PRIVACY_DIALOG.close } });
    else rows.push({ term: "Closing", value: "Only the firm owner closes a deletion request" });
    if (row.kind === "access" && lines.some((line) => line.state === "to_do") && next === "redaction")
      rows.push({ term: "Worklist", value: `${lines.filter((line) => line.state === "to_do").length} still to do` });
  }
  return { rows, actions };
}

const STEP_DIALOG: Record<Exclude<NextStep, "close">, { title: string; label: string; hint: string }> = {
  identity: {
    title: "Identity verified",
    label: "How you checked who they are",
    hint: "Check identity before you search for or share anything. Don’t rely on details anyone could know.",
  },
  scope: { title: "Scope searched", label: "What you searched and what you found", hint: "Name the matters and kinds of records, not their contents." },
  redaction: { title: "Third-party information redacted", label: "What was removed, in short", hint: "Every worklist line must be done first." },
  review: { title: "Reviewed", label: "Review note", hint: "The review is recorded with your name and the time." },
};

export function presentPrivacy(input: {
  ctx: PrivacyContext;
  /** Null when this person can't see privacy requests. */
  rows: PrivacyRequestRow[] | null;
  lines: RedactionRow[];
  consents: ConsentRow[] | null;
  kept: KeptRecord[] | null;
  /** SEC-06: legal time limits and the selected request's records found, packages and delivery. */
  extras?: PrivacyExtras;
}): { header: PrivacyHeaderData; page: PrivacyData; selectedRow: PrivacyRequestRow | null } {
  const { ctx } = input;
  const rows = input.rows;
  const selectedRow = rows ? (rows.find((row) => row.id === ctx.selectedId) ?? rows.find((row) => !row.closed_at) ?? rows[0] ?? null) : null;
  const open = rows ? rows.filter((row) => !row.closed_at).length : 0;
  const actions: Action[] = [];
  if (ctx.isOwner) actions.push({ label: "Response target", attrs: { "data-dlg": PRIVACY_DIALOG.settings } });
  if (ctx.canRecord && input.extras) actions.push({ label: "Add legal time limit", attrs: { "data-dlg": "dlgPTL" } });
  if (ctx.canRecord) actions.push({ label: "Record a request", primary: true, attrs: { "data-dlg": PRIVACY_DIALOG.record } });
  const header: PrivacyHeaderData = {
    pills: [...(rows ? [`${open} open`] : []), `Privacy contact: ${ctx.privacyContact ?? "not set"}`],
    actions,
  };
  let selected: PrivacySelected | null = null;
  if (selectedRow) {
    const lines = input.lines.filter((line) => line.request_id === selectedRow.id);
    const editable = !selectedRow.closed_at && !selectedRow.redaction_at && Boolean(selectedRow.scope_at) && canWork(selectedRow, ctx);
    selected = {
      title: [selectedRow.reference, selectedRow.requester_name],
      steps: requestSteps(selectedRow, ctx, lines),
      notes: notes(selectedRow),
      worklist: worklist(selectedRow, ctx, lines, input.consents, input.kept, editable),
      deadline: deadline(selectedRow, ctx, lines, input.extras),
      ...(input.extras ? { found: foundPanel(selectedRow, input.extras.items, !selectedRow.closed_at && !selectedRow.redaction_at && canWork(selectedRow, ctx)) } : {}),
    };
  }
  const page: PrivacyData = {
    rows: rows
      ? rows.map((row) => ({
          ref: row.reference,
          person: row.requester_name,
          type: KIND_LABEL[row.kind] ?? row.kind,
          received: dayMonth(row.received_on),
          due: row.closed_at || !effectiveDue(row) ? null : dayMonthYear(effectiveDue(row) as string),
          state: requestBadge(row, ctx.today, ctx.timezone),
          href: `/sheet/privacy?view=${row.id}`,
        }))
      : null,
    selected,
    ...(input.extras && rows ? { limits: limitsPanel(input.extras.limits, input.extras.canReview, ctx) } : {}),
  };
  return { header, page, selectedRow };
}

export function privacyDialogs(input: {
  ctx: PrivacyContext;
  selectedRow: PrivacyRequestRow | null;
  record: PrivacyDialogsData["record"];
  consents: ConsentRow[] | null;
  settingsDays: number | null;
  /** SEC-06 dialogs: extend, a record's decision, deliver, add and review a legal time limit. */
  extras?: PrivacyExtras;
  captured?: (readonly [string, string])[];
}): PrivacyDialogsData {
  const { ctx, selectedRow: row } = input;
  const working = row && !row.closed_at && canWork(row, ctx) ? row : null;
  const next = working ? nextStep(working) : null;
  return {
    organizationId: ctx.organizationId,
    record: ctx.canRecord ? input.record : null,
    step: working && next && next !== "close" ? { requestId: working.id, step: next, ...STEP_DIALOG[next], title: next === "scope" ? scopeTitle(working.kind) : STEP_DIALOG[next].title } : null,
    redaction: working && working.kind === "access" && working.scope_at && !working.redaction_at ? { requestId: working.id, reference: working.reference } : null,
    close:
      working && (working.kind !== "deletion" || ctx.isOwner)
        ? {
            requestId: working.id,
            reference: working.reference,
            outcomes:
              working.kind === "deletion"
                ? [
                    ["refused", "Refused (give the reason)"],
                    ["withdrawn", "Withdrawn by the person"],
                  ]
                : [
                    ["fulfilled", "Done"],
                    ["partly_fulfilled", "Partly done"],
                    ["refused", "Refused (give the reason)"],
                    ["withdrawn", "Withdrawn by the person"],
                  ],
            consents:
              working.kind === "consent_withdrawal"
                ? (input.consents ?? [])
                    .filter((consent) => consent.granted && !consent.withdrawn_at)
                    .map((consent) => [consent.id, `${CONSENT_LABEL[consent.purpose] ?? consent.purpose}, given ${dayMonthYear(localDate(consent.created_at, ctx.timezone))}`] as const)
                : null,
            note:
              working.kind === "deletion"
                ? "Nothing is deleted. The matters that keep their records are noted on the request. Closing asks you to confirm it’s you."
                : "Closing asks you to confirm it’s you. The outcome and evidence can’t be changed afterwards.",
          }
        : null,
    settings: ctx.isOwner ? { days: input.settingsDays === null ? "" : String(input.settingsDays) } : null,
    ...(input.extras
      ? { response: responseDialogs({ row, working: Boolean(working), extras: input.extras, canRecord: ctx.canRecord, today: ctx.today, captured: input.captured ?? [] }) }
      : {}),
  };
}
