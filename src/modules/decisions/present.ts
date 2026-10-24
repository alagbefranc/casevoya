/**
 * DEC-02 approval follow-up, pure: the Decisions tab's follow-up checklist, conditions summary and
 * delivery record, and their dialogs (20261025200000_dec_approval_follow_up.sql). The loader reads
 * the rows as the signed-in member; this only turns them into words and the data attributes the
 * Sheet's `data-dec` acts read. Every control is checked again by the database.
 *
 * Official steps show their source page, section, form, dates and snapshot hash next to them, the
 * same way the Submission checklist does. Nothing here is seeded or guessed: with no approved step
 * for the program, the checklist says so and offers the entry path.
 */
import type {
  ApprovalFollowUpData,
  ApprovalFollowUpDialogsData,
  DecWire,
  FollowUpCheckItem,
} from "@/components/sheet/designer/matter-approval-follow-up";
import type { MatterDecisionsData } from "@/components/sheet/designer/matter-government";
import { shortHash } from "@/modules/government/present";
import { dayMonthYear } from "@/modules/sheet/matter-present";
import { programLabel } from "@/modules/sheet/matters-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";
import { provenance, sourceText, type RequirementRow } from "@/modules/submissions/present";

export type FollowUpStepRow = {
  id: string;
  program_key: string;
  label: string;
  timing_text: string | null;
  source_url: string;
  source_section: string | null;
  form_number: string | null;
  form_modified_on: string | null;
  checked_on: string;
  current_to: string | null;
  snapshot_sha256: string | null;
  status: string;
  reviewed_by_membership_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  version: number;
};

export type FollowUpEventRow = { step_id: string; ticked: boolean; membership_id: string; created_at: string };

export type SummaryRow = {
  id: string;
  number: number | null;
  body: string;
  status: string;
  drafted_by_membership_id: string;
  approved_by_membership_id: string | null;
  approved_at: string | null;
  body_sha256: string | null;
  superseded_at: string | null;
  updated_at: string;
  version: number;
};

export type DeliveryRow = {
  id: string;
  document_version_id: string;
  document_label: string;
  method: string;
  delivered_at: string;
  note: string | null;
  delivered_by_membership_id: string;
  acknowledgement: string | null;
  acknowledged_at: string | null;
  acknowledged_on: string | null;
  ack_recorded_by_membership_id: string | null;
  ack_evidence_version_id: string | null;
  ack_evidence_note: string | null;
  version: number;
};

/** A decision follow-up task (closure task) with who finished it, from the task's own history. */
export type ClosureTaskRow = {
  kind: string;
  task: { id: string; title: string; status: string; owner_membership_id: string | null; version: number; completed_at?: string | null };
  doneBy: string | null;
};

export type ApprovalState = { id: string; state: string; confirmedAt: string | null };

export type ApprovalInput = {
  organizationId: string;
  matterId: string;
  role: string;
  licensed: boolean;
  timezone: string;
  today: string;
  /** `YYYY-MM-DDTHH:MM` now, in the firm's zone, for the delivery time field. */
  nowLocal: string;
  memberName: (membershipId: string | null) => string;
  userName: (userId: string | null) => string;
  /** The matter's latest approval, or null when none is recorded. */
  approval: ApprovalState | null;
  programKey: string | null;
  steps: FollowUpStepRow[];
  /** This matter's tick events, newest first. */
  events: FollowUpEventRow[];
  closure: ClosureTaskRow[];
  summaries: SummaryRow[];
  deliveries: DeliveryRow[];
  /** Stored, clean files on the matter: what can be recorded as delivered, or as evidence. */
  files: { versionId: string; label: string }[];
};

export const DELIVERY_METHODS = [
  { value: "portal", label: "Client portal" },
  { value: "email", label: "Email" },
  { value: "in_person", label: "In person" },
  { value: "mail", label: "Mail" },
] as const;

const STAFF = new Set(["firm_owner", "licensed_consultant", "case_manager", "assistant"]);
const WRITERS = new Set(["firm_owner", "licensed_consultant", "case_manager"]);

const CLOSURE_LABEL: Record<string, string> = {
  conditions_summary: "Conditions summary approved and shown to the client",
  document_delivery: "Decision documents delivered to the client",
  closure_checklist: "Closure checklist",
};

export function methodLabel(method: string): string {
  return DELIVERY_METHODS.find((option) => option.value === method)?.label ?? "Other";
}

function wire(act: string, input: ApprovalInput, extra: Record<string, string> = {}): DecWire {
  const out: DecWire = { "data-dec": act, "data-org": input.organizationId, "data-matter": input.matterId };
  for (const [key, value] of Object.entries(extra)) out[`data-${key}`] = value;
  return out;
}

function asRequirement(row: FollowUpStepRow): RequirementRow {
  return { ...row, channel: "", kind: "after_approval" };
}

export function buildApprovalFollowUp(input: ApprovalInput): { card: ApprovalFollowUpData; dialogs: ApprovalFollowUpDialogsData } | null {
  if (!input.approval || !STAFF.has(input.role)) return null;
  const date = (iso: string) => dayMonthYear(iso, input.today);
  const when = (iso: string) => dayMonthYear(isoDateInTimeZone(new Date(iso), input.timezone), input.today);
  const confirmed = input.approval.state === "confirmed";
  const writer = WRITERS.has(input.role);

  // Closure tasks: ordinary tasks the confirmation opened, ticked through the task itself.
  const closure: FollowUpCheckItem[] = input.closure
    // Expiry and renewal reminders stay in the Designer's follow-up rows (renewal work, not closure).
    .filter((row) => row.kind in CLOSURE_LABEL && row.task.status !== "cancelled")
    .map((row) => {
      const done = row.task.status === "done";
      const title = CLOSURE_LABEL[row.kind] ?? row.task.title;
      return {
        id: row.task.id,
        label: title,
        done,
        note: done
          ? `Done${row.doneBy ? ` by ${row.doneBy}` : ""}${row.task.completed_at ? `, ${when(row.task.completed_at)}` : ""}`
          : `Open, ${input.memberName(row.task.owner_membership_id)}`,
        source: null,
        wire:
          !done && row.task.status === "open"
            ? { "data-gov": "task-done", "data-org": input.organizationId, "data-matter": input.matterId, "data-id": row.task.id, "data-version": String(row.task.version) }
            : null,
        retire: null,
      };
    });

  // Official steps for the matter's program: approved ones, plus any retired one already ticked here.
  const latest = new Map<string, FollowUpEventRow>();
  for (const event of input.events) if (!latest.has(event.step_id)) latest.set(event.step_id, event);
  const program = input.programKey;
  const official: FollowUpCheckItem[] = input.steps
    .filter((row) => program && row.program_key === program && (row.status === "approved" || (row.status === "retired" && latest.has(row.id))))
    .map((row) => {
      const event = latest.get(row.id) ?? null;
      const done = Boolean(event?.ticked);
      const facts = provenance(asRequirement(row), date);
      return {
        id: row.id,
        label: row.label,
        done,
        note: [
          ...(row.timing_text ? [`Timing on the page: “${row.timing_text}”`] : []),
          ...(event ? [`${done ? "Done" : "Unticked"} by ${input.memberName(event.membership_id)}, ${when(event.created_at)}`] : []),
          ...(row.status === "retired" ? ["Retired from the firm’s list"] : []),
        ].join(" · "),
        source: { href: row.source_url, text: sourceText(row.source_url), facts },
        wire: confirmed && row.status === "approved" ? wire("tick", input, { step: row.id, ticked: done ? "false" : "true" }) : null,
        retire: input.licensed && row.status === "approved" ? wire("retire-open", input, { id: row.id, version: String(row.version) }) : null,
      };
    });
  const officialEmpty = official.length
    ? null
    : program
      ? `No official follow-up steps entered for ${programLabel(program)} yet. Add each one from its official IRCC or Government of Canada page; a licensed consultant approves it before it shows here.`
      : "This matter has no program set, so no program’s official follow-up steps can apply. The closure tasks above still do.";

  const pending = input.steps
    .filter((row) => row.status === "pending_review" && (!program || row.program_key === program))
    .map((row) => ({
      label: row.label,
      kind: programLabel(row.program_key),
      source: { href: row.source_url, text: sourceText(row.source_url), facts: provenance(asRequirement(row), date) },
      badge: row.snapshot_sha256 ? { tone: "chg", label: "Waiting for review" } : { tone: "bad", label: "No page snapshot" },
      approve: input.licensed && row.snapshot_sha256 ? wire("review", input, { id: row.id, version: String(row.version) }) : null,
      reject: input.licensed ? wire("reject-open", input, { id: row.id, version: String(row.version) }) : null,
    }));

  const all = [...closure, ...official];
  const doneCount = all.filter((item) => item.done).length;
  const badge = !confirmed
    ? { tone: "chg", label: "Starts when the approval is confirmed" }
    : all.length && doneCount === all.length
      ? { tone: "ok", label: "All done" }
      : { tone: "rev", label: `${doneCount} of ${all.length} done` };

  // Conditions summary.
  const current = input.summaries.find((row) => row.status === "approved") ?? null;
  const draft = input.summaries.find((row) => row.status === "draft") ?? null;
  const earlier = input.summaries.filter((row) => row.status === "superseded").sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
  const summary: ApprovalFollowUpData["summary"] = {
    badge: current
      ? { tone: "ok", label: `Version ${current.number} shown to the client` }
      : draft
        ? { tone: "chg", label: "Draft, waiting for consultant approval" }
        : { tone: "gr", label: "Not written yet" },
    current: current
      ? {
          body: current.body,
          line: [
            `Version ${current.number}`,
            `approved by ${input.memberName(current.approved_by_membership_id)}${current.approved_at ? `, ${when(current.approved_at)}` : ""}`,
            shortHash(current.body_sha256) ?? "no hash recorded",
            "Shown to the client in the portal as the firm’s summary",
          ],
        }
      : null,
    draft: draft
      ? {
          body: draft.body,
          line: [`Draft by ${input.memberName(draft.drafted_by_membership_id)}`, `last saved ${when(draft.updated_at)}`, "Not shown to the client"],
          approve: input.licensed && confirmed ? wire("approve-summary", input, { id: draft.id, version: String(draft.version) }) : null,
          edit: writer && confirmed ? { "data-open": "dDecSum" } : null,
        }
      : null,
    earlier: earlier.map((row) => `Version ${row.number}, approved ${row.approved_at ? when(row.approved_at) : "—"}, superseded ${row.superseded_at ? when(row.superseded_at) : "—"}`),
    write: writer && confirmed && !draft ? { "data-open": "dDecSum" } : null,
    note: confirmed
      ? "Staff draft it in plain words; a licensed consultant approves it after confirming with their authenticator. Only the approved version reaches the client."
      : "The summary is written once a licensed consultant confirms the approval.",
  };

  // Delivery record.
  const deliveries: ApprovalFollowUpData["deliveries"] = input.deliveries.map((row) => {
    const ack =
      row.acknowledgement === "client_portal"
        ? { tone: "ok", label: `Acknowledged by the client in the portal, ${row.acknowledged_at ? when(row.acknowledged_at) : "—"}` }
        : row.acknowledgement === "staff_recorded"
          ? { tone: "ok", label: `Acknowledged ${row.acknowledged_on ? date(row.acknowledged_on) : "—"}, recorded by ${input.memberName(row.ack_recorded_by_membership_id)}` }
          : { tone: "chg", label: "Not acknowledged yet" };
    const evidence =
      row.acknowledgement === "staff_recorded"
        ? row.ack_evidence_note
          ? `Evidence: “${row.ack_evidence_note}”`
          : `Evidence: ${input.files.find((file) => file.versionId === row.ack_evidence_version_id)?.label ?? "a file on the matter"}`
        : null;
    return {
      title: row.document_label,
      parts: [
        methodLabel(row.method),
        `delivered ${when(row.delivered_at)}`,
        `recorded by ${input.memberName(row.delivered_by_membership_id)}`,
        ...(row.note ? [row.note] : []),
        ...(evidence ? [evidence] : []),
      ],
      badge: ack,
      ack: !row.acknowledgement && writer ? wire("ack-open", input, { id: row.id, version: String(row.version) }) : null,
    };
  });

  const card: ApprovalFollowUpData = {
    badge,
    intro: confirmed
      ? "Added when the approval was recorded. Closure tasks come from the confirmation; official steps come only from IRCC or Government of Canada pages a licensed consultant approved for this program."
      : "Added when the approval was recorded. Ticking opens once a licensed consultant confirms the approval.",
    closure,
    official,
    officialTitle: program ? `Official steps for ${programLabel(program)}` : "Official steps",
    officialEmpty,
    pending,
    addStep: writer && program ? { "data-open": "dDecStep" } : null,
    summary,
    deliveries,
    deliveriesEmpty: "No decision documents recorded as delivered yet. Record which document went to the client, how and when.",
    recordDelivery: writer && confirmed && input.files.length ? { "data-open": "dDecDel" } : null,
    deliveryNote: confirmed && !input.files.length ? "Store the decision letter on the matter first; a delivery names a stored file." : null,
  };

  const dialogs: ApprovalFollowUpDialogsData = {
    step: writer && program ? { wire: wire("propose", input), program: { key: program, label: programLabel(program) }, today: input.today } : null,
    summary: writer && confirmed ? { wire: draft ? wire("revise-summary", input, { id: draft.id, version: String(draft.version) }) : wire("draft-summary", input), body: draft?.body ?? current?.body ?? "", editing: Boolean(draft) } : null,
    delivery: writer && confirmed && input.files.length ? { wire: wire("deliver", input), files: input.files, methods: [...DELIVERY_METHODS], now: input.nowLocal, timezone: input.timezone } : null,
    ack: deliveries.some((row) => row.ack) ? { wire: wire("ack", input), files: input.files, today: input.today } : null,
    reject: pending.some((row) => row.reject) ? { wire: wire("reject", input) } : null,
    retire: official.some((row) => row.retire) ? { wire: wire("retire", input) } : null,
  };
  return { card, dialogs };
}

/**
 * Adds the follow-up card to the Decisions tab. The closure tasks it lists are left out of the
 * Designer's "Follow-up after the decision" rows, so no task shows twice; expiry reminders and
 * other follow-ups stay there.
 */
export function withApprovalFollowUp(decisions: MatterDecisionsData, card: ApprovalFollowUpData): MatterDecisionsData {
  const listed = new Set(card.closure.map((item) => item.id));
  const decision = decisions.decision
    ? { ...decisions.decision, followUps: decisions.decision.followUps.filter((row) => !listed.has(row.wire?.["data-id"] ?? "")) }
    : decisions.decision;
  return { ...decisions, decision, approval: card };
}

/** Database refusals for the follow-up acts, as the Sheet's own copy. */
const ERRORS: [RegExp, string][] = [
  [/official Government of Canada page/, "Use the official page’s address: canada.ca or a gc.ca site, starting with https://."],
  [/section of the page|section anchor/, "Name the section of the page, or paste its link with the section anchor (#…)."],
  [/date checked/, "Add the date you checked the page. It can’t be in the future or more than a year ago."],
  [/date modified needs its form number/, "A form’s date modified needs the form number, and it can’t be in the future."],
  [/current-to date/, "The current-to date can’t be in the future."],
  [/choose the program/, "Choose the program the step applies to."],
  [/write the timing/, "Write the timing as the page gives it (3 to 300 characters), or leave it empty."],
  [/as the official page gives it/, "Write the step as the official page gives it (3 to 300 characters)."],
  [/goes live only with a snapshot/, "This step has no snapshot of its page, so it can’t be approved. Enter it again when the page can be fetched."],
  [/why it.s rejected|why it.s retired/, "Say why."],
  [/nothing is waiting for review/, "That step was already reviewed."],
  [/only an approved step/, "Only an approved step can be retired."],
  [/does not apply to this matter/, "That step isn’t for this matter’s program."],
  [/already marked so/, "That step is already marked so."],
  [/record the approval/, "Record the approval from its decision letter first."],
  [/after the consultant confirms/, "This opens once a licensed consultant confirms the approval."],
  [/at least 20/, "Write the summary (at least 20 characters)."],
  [/draft is already open/, "A draft is already open. Edit it instead."],
  [/approved summary is not edited/, "An approved summary isn’t edited. Write a new draft; it replaces the client’s version once approved."],
  [/only a draft is approved/, "That summary was already approved."],
  [/how it was delivered/, "Choose how it was delivered."],
  [/delivery time/, "Add when it was delivered. It can’t be in the future."],
  [/before the decision was recorded/, "The delivery can’t be before the decision was recorded."],
  [/between 3 and 500/, "Keep the note between 3 and 500 characters."],
  [/stored file on this matter/, "Choose a stored file on this matter."],
  [/add the evidence/, "Add the evidence: a file on the matter, or a note of what shows it."],
  [/at least 10 characters/, "Describe the evidence in at least 10 characters."],
  [/acknowledgement date/, "The acknowledgement date is required, on or after the delivery and not in the future."],
  [/already acknowledged/, "That delivery is already acknowledged."],
  [/version conflict/, "Someone else changed this. Reload and try again."],
  [/denied|staff access|licen/, "Your role can’t do this on this matter."],
];

export function followUpError(message: string): string {
  for (const [pattern, copy] of ERRORS) if (pattern.test(message)) return copy;
  return "That couldn’t be saved.";
}

/* ------------------------------------------------------------------ portal */

export type PortalFollowUpRaw = {
  summaries?: { matter_id: string; number: number; body: string; approved_at: string }[];
  deliveries?: { id: string; matter_id: string; label: string; method: string; delivered_at: string; acknowledgement: string | null; acknowledged_at: string | null }[];
};

export type PortalFollowUp = {
  summary: { body: string; line: string } | null;
  deliveries: { id: string; title: string; detail: string; acknowledged: string | null }[];
};

/** The client's part, for one matter: the firm's approved summary and the documents delivered. */
export function portalFollowUp(raw: unknown, matterId: string | null, firmName: string, timeZone: string): PortalFollowUp | null {
  if (!matterId || !raw || typeof raw !== "object") return null;
  const data = raw as PortalFollowUpRaw;
  const day = (iso: string) => {
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone }).format(at).replace("Sept", "Sep");
  };
  const summary = (data.summaries ?? []).find((row) => row.matter_id === matterId) ?? null;
  const deliveries = (data.deliveries ?? []).filter((row) => row.matter_id === matterId);
  if (!summary && !deliveries.length) return null;
  return {
    summary: summary ? { body: summary.body, line: `Written by ${firmName} and approved by your consultant on ${day(summary.approved_at)}. This is your firm’s summary, not an IRCC document.` } : null,
    deliveries: deliveries.map((row) => ({
      id: row.id,
      title: row.label,
      detail: `${methodLabel(row.method)}, ${day(row.delivered_at)}`,
      acknowledged:
        row.acknowledgement === "client_portal"
          ? `You confirmed you received it${row.acknowledged_at ? ` on ${day(row.acknowledged_at)}` : ""}.`
          : row.acknowledgement
            ? `${firmName} recorded that you received it.`
            : null,
    })),
  };
}
