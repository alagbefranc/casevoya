import type { Action, DlRow, Line, StateBadge, Step } from "@/components/sheet/designer/compliance";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_DIALOG,
  type ComplaintsData,
  type ComplaintsDialogsData,
  type ComplaintsHeaderData,
  type ComplaintSelected,
} from "@/components/sheet/designer/complaints";
import { COMPLIANCE_CHANNELS } from "@/components/sheet/designer/privacy";
import { CATEGORY_LABEL, CHANNEL_LABEL, dayMonth, dmy } from "./format";

/**
 * The complaints register (ADM-05) from the firm's rows. Pure: the loader reads the database as
 * the signed-in staff member. Targets and the escalation path are the firm's own settings; nothing
 * here states a regulatory time limit.
 */

export type ComplaintRowData = {
  id: string;
  reference: string;
  complainant_name: string;
  matter_id: string | null;
  category: string;
  channel: string;
  issue: string;
  received_on: string;
  ack_due_on: string | null;
  response_due_on: string | null;
  assignee_membership_id: string;
  acknowledged_on: string | null;
  /** Optional; older loaders don't read it. */
  ack_note?: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  evidence_note: string | null;
  response_sent_on: string | null;
  response_note: string | null;
  resolved_on: string | null;
  resolution: string | null;
};

export type ComplaintsContext = {
  organizationId: string;
  firmName: string;
  today: string;
  isOwner: boolean;
  /** The firm owner or a designated handler. */
  isHandler: boolean;
  userName: (userId: string | null) => string;
  memberName: (membershipId: string) => string;
  matterRef: (matterId: string | null) => string;
  /** Who sees the register: owners and handlers, by name. */
  visibleTo: string[];
  escalation: string | null;
  selectedId: string | undefined;
};

type Next = "acknowledge" | "review" | "respond" | "resolve" | null;

export function complaintNext(row: ComplaintRowData): Next {
  if (row.resolved_on) return null;
  if (!row.acknowledged_on) return "acknowledge";
  if (!row.reviewed_at) return "review";
  if (!row.response_sent_on) return "respond";
  return "resolve";
}

export function complaintBadge(row: ComplaintRowData, today: string): StateBadge {
  if (row.resolved_on) return { tone: "ok", label: `Resolved ${dayMonth(row.resolved_on)}` };
  if (row.response_sent_on) return { tone: "blue", label: `Response sent ${dayMonth(row.response_sent_on)}` };
  if (row.acknowledged_on) {
    if (row.response_due_on && row.response_due_on < today) return { tone: "bad", label: "Past response target" };
    return { tone: "chg", label: `Acknowledged ${dayMonth(row.acknowledged_on)}` };
  }
  if (row.ack_due_on && row.ack_due_on < today) return { tone: "bad", label: "Past acknowledgement target" };
  return { tone: "rev", label: "Received" };
}

function nextMilestone(row: ComplaintRowData): string {
  const next = complaintNext(row);
  if (next === "acknowledge") return row.ack_due_on ? `Acknowledge by ${dayMonth(row.ack_due_on)}` : "Acknowledge";
  if (next === "review") return "Review the evidence";
  if (next === "respond") return row.response_due_on ? `Response due ${dayMonth(row.response_due_on)}` : "Send the response";
  if (next === "resolve") return "Record the resolution";
  return "—";
}

function short(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function complaintSteps(row: ComplaintRowData, ctx: ComplaintsContext): Step[] {
  const ackNote = row.ack_note?.trim() ? [short(row.ack_note)] : [];
  const ack: Line | undefined = row.acknowledged_on
    ? row.ack_due_on
      ? [dayMonth(row.acknowledged_on), row.acknowledged_on <= row.ack_due_on ? "within the firm’s target" : "after the firm’s target", ...ackNote]
      : [dayMonth(row.acknowledged_on), ...ackNote]
    : row.ack_due_on
      ? `Due ${dayMonth(row.ack_due_on)}`
      : undefined;
  const reviewed = row.evidence_note?.trim() ? `Evidence reviewed: ${short(row.evidence_note)}` : "No evidence note";
  const steps: { title: string; done: boolean; small?: Line }[] = [
    { title: "Received", done: true, small: `${dayMonth(row.received_on)}, by ${CHANNEL_LABEL[row.channel] ?? row.channel}` },
    { title: "Acknowledged", done: Boolean(row.acknowledged_on), small: ack },
    {
      title: "Reviewed",
      done: Boolean(row.reviewed_at),
      small: row.reviewed_at ? [ctx.userName(row.reviewed_by), reviewed] : ctx.memberName(row.assignee_membership_id),
    },
    {
      title: "Response sent",
      done: Boolean(row.response_sent_on),
      small: row.response_sent_on
        ? row.response_note?.trim()
          ? [dayMonth(row.response_sent_on), short(row.response_note)]
          : dayMonth(row.response_sent_on)
        : row.response_due_on
          ? `Due ${dayMonth(row.response_due_on)}`
          : undefined,
    },
    { title: "Resolution recorded", done: Boolean(row.resolved_on), small: row.resolved_on ? [dayMonth(row.resolved_on), row.resolution ?? ""] : undefined },
  ];
  const current = steps.findIndex((step) => !step.done);
  return steps.map((step, index) => ({
    state: step.done ? "done" : index === current ? "now" : "",
    title: step.title,
    ...(step.small !== undefined ? { small: step.small } : {}),
  }));
}

const STEP_LABEL: Record<Exclude<Next, null>, string> = {
  acknowledge: "Record acknowledgement",
  review: "Record review",
  respond: "Record response sent",
  resolve: "Record resolution",
};

function evidenceRows(row: ComplaintRowData, ctx: ComplaintsContext): DlRow[] {
  return [
    { term: "Evidence", value: row.evidence_note ?? "Listed when the complaint is reviewed" },
    { term: "Hold", value: "Kept with its evidence. Complaints are never deleted." },
    { term: "Routes to", value: `${ctx.firmName} (professional service)` },
    { term: "Not", value: "A Casevoya software support ticket" },
    { term: "Category", value: CATEGORY_LABEL[row.category] ?? row.category },
    { term: "Escalation", value: ctx.escalation ?? "Not set. The firm owner adds your firm’s escalation path in Settings." },
  ];
}

export function presentComplaints(input: { ctx: ComplaintsContext; rows: ComplaintRowData[] | null }): {
  header: ComplaintsHeaderData;
  page: ComplaintsData;
  selectedRow: ComplaintRowData | null;
} {
  const { ctx } = input;
  const rows = ctx.isHandler ? input.rows ?? [] : null;
  const selectedRow = rows ? (rows.find((row) => row.id === ctx.selectedId) ?? rows.find((row) => !row.resolved_on) ?? rows[0] ?? null) : null;
  const actions: Action[] = [];
  if (ctx.isOwner) actions.push({ label: "Settings", attrs: { "data-dlg": COMPLAINT_DIALOG.settings } });
  if (ctx.isHandler) actions.push({ label: "Record a complaint", primary: true, attrs: { "data-dlg": COMPLAINT_DIALOG.record } });
  let selected: ComplaintSelected | null = null;
  if (selectedRow) {
    const next = complaintNext(selectedRow);
    selected = {
      title: [selectedRow.reference, selectedRow.complainant_name],
      steps: complaintSteps(selectedRow, ctx),
      rows: evidenceRows(selectedRow, ctx),
      actions: next ? [{ label: STEP_LABEL[next], primary: true, attrs: { "data-dlg": COMPLAINT_DIALOG.step } }] : [],
    };
  }
  return {
    header: { pills: ctx.isHandler ? [`Visible to: ${ctx.visibleTo.join(", ") || "the firm owner"}`] : [], actions },
    page: {
      firmName: ctx.firmName,
      rows: rows
        ? rows.map((row) => ({
            ref: row.reference,
            complainant: row.complainant_name,
            matter: row.matter_id ? ctx.matterRef(row.matter_id) : "—",
            issue: short(row.issue),
            received: dayMonth(row.received_on),
            owner: ctx.memberName(row.assignee_membership_id),
            next: nextMilestone(row),
            state: complaintBadge(row, ctx.today),
            href: `/sheet/complaints?view=${row.id}`,
          }))
        : null,
      selected,
    },
    selectedRow,
  };
}

const STEP_DIALOG: Record<Exclude<Next, null>, { title: string; dated: boolean; label: string; note?: string }> = {
  acknowledge: { title: "Acknowledged", dated: true, label: "Note (optional)", note: "Use the date you told the complainant you received it." },
  review: { title: "Reviewed", dated: false, label: "Evidence reviewed", note: "Name the records you reviewed, such as a quote, emails or a call note." },
  respond: { title: "Response sent", dated: true, label: "What the response said, in short" },
  resolve: { title: "Resolution recorded", dated: true, label: "Resolution", note: "Resolving asks you to confirm it’s you. It can’t be reopened." },
};

export function complaintsDialogs(input: {
  ctx: ComplaintsContext;
  selectedRow: ComplaintRowData | null;
  people: (readonly [string, string])[];
  matters: (readonly [string, string])[];
  assignable: (readonly [string, string])[];
  me: string | null;
  staff: (readonly [string, string])[];
  handlers: string[];
  settings: { ackDays: number | null; responseDays: number | null; escalation: string | null };
}): ComplaintsDialogsData {
  const { ctx } = input;
  const next = input.selectedRow ? complaintNext(input.selectedRow) : null;
  return {
    organizationId: ctx.organizationId,
    record: ctx.isHandler
      ? {
          about: [
            ["service", `${ctx.firmName}’s professional service`],
            ["software", "The Casevoya software (sends to Casevoya support)"],
          ],
          received: dmy(ctx.today),
          save: { "data-complaint-new": "1", "data-org": ctx.organizationId },
          more: [
            { kind: "select", id: "cP", label: "Client record", options: [["none", "Not linked"], ...input.people] },
            { kind: "select", id: "cM", label: "Matter", options: [["none", "Not linked"], ...input.matters] },
            { kind: "select", id: "cG", label: "Category", options: COMPLAINT_CATEGORIES },
            { kind: "select", id: "cH", label: "How it arrived", options: COMPLIANCE_CHANNELS },
            { kind: "select", id: "cA", label: "Handled by", options: input.assignable, value: input.me ?? undefined },
          ],
        }
      : null,
    step:
      input.selectedRow && next && ctx.isHandler
        ? { complaintId: input.selectedRow.id, step: next, today: dmy(ctx.today), ...STEP_DIALOG[next] }
        : null,
    settings: ctx.isOwner
      ? {
          ackDays: input.settings.ackDays === null ? "" : String(input.settings.ackDays),
          responseDays: input.settings.responseDays === null ? "" : String(input.settings.responseDays),
          escalation: input.settings.escalation ?? "",
          // The firm owner always handles complaints; an empty list says why instead of looking broken.
          staff: input.staff.length ? input.staff : [["", "No other active staff yet. Invite staff in Settings › Staff, then choose them here."]],
          handlers: input.handlers,
        }
      : null,
  };
}
