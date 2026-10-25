/**
 * DEC-02 renewal follow-up on the matter's Decisions tab: the Expiry and renewal card, its official
 * timings and its dialogs, from the firm's records. Pure, so it is tested without a database.
 * Nothing is defaulted: a reminder date is an approved IRCC timing or the firm's choice, a fee is
 * shown only from the approved IRCC fee list, and a renewal reminder is offered only when the
 * client's own contact choices allow it (the reason is shown when they don't).
 */
import type { RenewalPanelData, RenewalWire } from "@/components/sheet/designer/matter-renewal";
import { formatMoney } from "@/modules/finance/money";
import { leadHref } from "@/modules/leads/present";
import { currentFee, dayInZone, feeLine, reminderBasis, renewalDate, sourceText, timingFacts } from "@/modules/renewals/present";

const RECORDERS = new Set(["firm_owner", "licensed_consultant", "case_manager"]);

export type RenewalRow = {
  id: string;
  decision_id: string;
  document_label: string;
  expires_on: string;
  document_version_id: string | null;
  remind_on: string;
  timing_id: string | null;
  task_id: string;
  owner_membership_id: string;
  recorded_by_membership_id: string;
  client_person_id: string | null;
  service_scope: string | null;
  fee_section: string | null;
  fee_group: string | null;
  fee_name: string | null;
  lead_id: string | null;
  reminder_set_at: string | null;
  reminder_set_by_membership_id: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  version: number;
};

export type TimingRow = {
  id: string;
  program_key: string | null;
  applies_to: string;
  timing_text: string;
  lead_days: number | null;
  source_url: string;
  source_section: string | null;
  form_number: string | null;
  form_modified_on: string | null;
  checked_on: string;
  current_to: string | null;
  snapshot_sha256: string | null;
  status: string;
  version: number;
  /** Approved without a snapshot: the licensed reviewer's attestation (2026-10-24). */
  page_attested_by_membership_id?: string | null;
  page_attested_on?: string | null;
};

export type FeeRow = {
  id: string;
  section: string | null;
  fee_group: string | null;
  name: string;
  amount_cents: number;
  currency: string;
  source_url: string;
  retrieved_at: string;
  snapshot_sha256: string;
  status: string;
  reviewed_at: string | null;
};

export type ContactState = { allowed: boolean; reason: string; name: string | null } | null;

export type RenewalInput = {
  organizationId: string;
  role: string;
  licensed: boolean;
  today: string;
  timezone: string;
  /** The consultant-confirmed approval expiries are recorded from; null when there is none. */
  decisionId: string | null;
  sample: boolean;
  closed: boolean;
  program: { key: string; label: string } | null;
  renewals: RenewalRow[];
  tasks: Map<string, { status: string; due_on: string | null }>;
  timings: TimingRow[];
  fees: FeeRow[] | null;
  contact: ContactState;
  files: { id: string; label: string }[];
  memberName: (id: string | null) => string;
};

function wire(act: string, input: RenewalInput, extra: Record<string, string> = {}): RenewalWire {
  const out: RenewalWire = { "data-ren": act, "data-org": input.organizationId };
  for (const [key, value] of Object.entries(extra)) out[`data-${key}`] = value;
  return out;
}

function source(row: TimingRow, memberName: (id: string | null) => string) {
  const attestedBy = row.page_attested_on ? memberName(row.page_attested_by_membership_id ?? null) : null;
  return { href: row.source_url, text: sourceText(row.source_url), facts: timingFacts({ ...row, attested_by: attestedBy }) };
}

function taskState(task: { status: string; due_on: string | null } | undefined): string {
  if (!task) return "Reminder task not visible to you";
  if (task.status === "done") return "Reminder task done";
  if (task.status === "cancelled") return "Reminder task cancelled";
  return "Reminder task open";
}

export function buildRenewalPanel(input: RenewalInput): RenewalPanelData {
  const canRecord = RECORDERS.has(input.role) && !input.closed;
  const live = input.renewals.filter((row) => !row.cancelled_at);
  const approved = input.timings.filter((row) => row.status === "approved");
  const pending = input.timings.filter((row) => row.status === "pending_review");
  const timingById = new Map(input.timings.map((row) => [row.id, row]));
  const contact = input.contact;
  const contactText = contact
    ? contact.reason
    : "The client’s contact choices couldn’t be read, so a renewal reminder can’t be set from here.";
  const canSet = canRecord && !input.sample && Boolean(contact?.allowed);

  const rows = input.renewals.map((row) => {
    const timing = row.timing_id ? (timingById.get(row.timing_id) ?? null) : null;
    const parts = [`Reminder ${renewalDate(row.remind_on)}`, taskState(input.tasks.get(row.task_id)), `recorded by ${input.memberName(row.recorded_by_membership_id)}`];
    const client: string[] = [];
    let feeText: string | null = null;
    let feeHref: string | null = null;
    if (row.reminder_set_at) {
      client.push(
        `Client renewal reminder set ${renewalDate(dayInZone(row.reminder_set_at, input.timezone))} by ${input.memberName(row.reminder_set_by_membership_id)}, shown in the portal`,
      );
      if (row.service_scope) client.push(`Scope of the new service: ${row.service_scope}`);
      if (row.fee_name) {
        const fee = input.fees ? currentFee(input.fees, row) : null;
        feeText = fee ? feeLine(fee, input.timezone) : `${row.fee_name}: not in the approved IRCC fee list now, so the client sees no fee`;
        feeHref = fee?.source_url ?? null;
        if (fee === null && input.fees === null) feeText = `${row.fee_name}: the fee list couldn’t be read here`;
      }
    }
    const cancelled = Boolean(row.cancelled_at);
    return {
      id: row.id,
      title: `${row.document_label} expires ${renewalDate(row.expires_on)}`,
      parts: cancelled ? [`Cancelled: ${row.cancel_reason ?? ""}`.trim()] : parts,
      basis: {
        text: reminderBasis(timing),
        source: timing ? source(timing, input.memberName) : null,
      },
      client,
      fee: feeText ? { text: `IRCC fee: ${feeText}`, href: feeHref } : null,
      lead: row.lead_id ? { href: leadHref(row.lead_id), label: "Open the renewal lead" } : null,
      badge: cancelled
        ? { tone: "gr", label: "Cancelled" }
        : row.reminder_set_at
          ? { tone: "ok", label: "Client reminder set" }
          : { tone: "rev", label: "Internal reminder" },
      dot: cancelled ? "#9b9a97" : row.reminder_set_at ? "#2e9d5b" : "#0075DE",
      set: !cancelled && !row.reminder_set_at && canSet ? wire("set-open", input, { id: row.id, version: String(row.version) }) : null,
      cancel: !cancelled && canRecord ? wire("cancel-open", input, { id: row.id, version: String(row.version) }) : null,
    };
  });

  const recordReady = canRecord && Boolean(input.decisionId);
  return {
    badge: live.length ? { tone: "ok", label: `${live.length} recorded` } : { tone: "gr", label: "Nothing recorded" },
    intro:
      "Record the expiry date shown on the client’s issued document, for example a permit or a PR card. The reminder is an internal task. Its date follows an IRCC timing a licensed consultant approved, or it is the firm’s choice. Casevoya sends no email.",
    contact: { allowed: Boolean(contact?.allowed), text: input.sample ? "This is a sample matter: renewal reminders are set on real matters only." : contactText },
    rows,
    empty: rows.length
      ? null
      : input.decisionId
        ? "No expiry recorded yet."
        : "Expiries are recorded once a licensed consultant confirms an approval.",
    timings: approved.map((row) => ({
      label: `${row.applies_to}: “${row.timing_text}”${row.lead_days ? `, ${row.lead_days} days before expiry` : ", no number of days stated"}`,
      source: source(row, input.memberName),
      retire: input.licensed ? wire("retire-open", input, { id: row.id, version: String(row.version) }) : null,
    })),
    timingsEmpty: approved.length
      ? null
      : "No IRCC renewal timing is approved yet, so every reminder date is the firm’s choice. Add one from the official page.",
    pending: pending.map((row) => ({
      label: `${row.applies_to}: “${row.timing_text}”${row.lead_days ? `, ${row.lead_days} days before expiry` : ""}`,
      source: source(row, input.memberName),
      badge: row.snapshot_sha256 ? { tone: "chg", label: "Waiting for licensed review" } : { tone: "bad", label: "No page snapshot" },
      // No snapshot: Approve opens the reviewer's attestation (DEC follows the GOV review rules, 2026-10-24).
      approve: input.licensed
        ? row.snapshot_sha256
          ? wire("approve", input, { id: row.id, version: String(row.version) })
          : wire("attest-open", input, { id: row.id, version: String(row.version) })
        : null,
      reject: input.licensed ? wire("reject-open", input, { id: row.id, version: String(row.version) }) : null,
    })),
    actions: {
      record: recordReady ? { "data-open": "dRenExp" } : null,
      timing: RECORDERS.has(input.role) ? { "data-open": "dRenTim" } : null,
    },
    dialogs: {
      expiry: recordReady
        ? {
            wire: wire("expiry", input, { id: input.decisionId as string }),
            today: input.today,
            files: input.files,
            timings: approved
              .filter((row) => row.lead_days && (!row.program_key || row.program_key === input.program?.key))
              .map((row) => ({ value: row.id, label: `IRCC timing for ${row.applies_to}: ${row.lead_days} days before expiry (checked ${renewalDate(row.checked_on)})` })),
          }
        : null,
      set: canSet
        ? {
            wire: wire("set", input),
            client: contact?.name ?? "The client",
            fees: input.fees
              ? input.fees
                  .filter((fee) => fee.status === "approved")
                  .map((fee) => ({
                    value: fee.id,
                    label: `${fee.name}: ${formatMoney(fee.amount_cents, fee.currency)} (retrieved ${renewalDate(dayInZone(fee.retrieved_at, input.timezone))})`,
                  }))
              : [],
          }
        : null,
      cancel: canRecord && live.length ? { wire: wire("cancel", input) } : null,
      timing: RECORDERS.has(input.role) ? { wire: wire("timing", input), program: input.program, today: input.today } : null,
      reject: input.licensed && pending.length ? { wire: wire("reject", input) } : null,
      attest: input.licensed && pending.some((row) => !row.snapshot_sha256) ? { wire: wire("attest", input), today: input.today } : null,
      retire: input.licensed && approved.length ? { wire: wire("retire", input) } : null,
    },
  };
}
