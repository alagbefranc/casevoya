/**
 * Pure builder for the Submissions tab's checklist card, package manifest and dialogs (GOV-01,
 * GOV-03). The loader reads the rows as the signed-in member; the gates come from the database
 * (public.submission_checklist). Every control here is checked again by the database.
 */
import type {
  ChecklistGateView,
  ManifestView,
  OutsideStepView,
  PendingView,
  SubmissionChecklistData,
  SubmissionChecklistDialogsData,
  SubWire,
} from "@/components/sheet/designer/matter-submissions-checklist";
import { SUBMISSION_CHANNEL_OPTIONS } from "@/modules/government/present";
import { dayMonthYear } from "@/modules/sheet/matter-present";
import { programLabel } from "@/modules/sheet/matters-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";
import {
  blockedWhy,
  channelName,
  gateBadge,
  gateDetail,
  gateLink,
  gateTitle,
  OVERRIDABLE,
  provenance,
  sourceText,
  type ChecklistState,
  type GateKey,
  type RequirementRow,
} from "@/modules/submissions/present";

export type ChecklistEvent = { kind: string; item_key: string; ticked: boolean; note: string | null; membership_id: string; created_at: string };
export type ManifestFile = { position: number; file_name: string; file_sha256: string | null; review_state: string; byte_size: number | null };
export type ManifestHandoff = { id: string; package_label: string; manifest_sha256: string | null; manifest_file_count: number | null; manifest_pinned_at: string | null };

export type ChecklistInput = {
  organizationId: string;
  matterId: string;
  role: string;
  licensed: boolean;
  timezone: string;
  today: string;
  memberName: (membershipId: string | null) => string;
  /** null: the database's checklist couldn't be read. */
  state: ChecklistState | null;
  requirements: RequirementRow[];
  /** Checklist events of the open handoff, newest first. */
  events: ChecklistEvent[];
  /** The handoff whose manifest is shown (open or latest submitted), and its pinned files. */
  manifest: { handoff: ManifestHandoff; files: ManifestFile[] } | null;
};

const STAFF = new Set(["firm_owner", "licensed_consultant", "case_manager", "assistant"]);
const PROPOSERS = new Set(["firm_owner", "licensed_consultant", "case_manager"]);
const DOT: Record<string, string> = { ok: "#2e9d5b", overridden: "#f0a200", none: "#d9d5d0", blocked: "#d64545" };

function wire(act: string, input: ChecklistInput, extra: Record<string, string> = {}): SubWire {
  const out: SubWire = { "data-sub": act, "data-org": input.organizationId, "data-matter": input.matterId };
  for (const [key, value] of Object.entries(extra)) out[`data-${key}`] = value;
  return out;
}

function shortHash(hash: string | null): string {
  return hash ? `sha256 ${hash.slice(0, 4)}…${hash.slice(-4)}` : "no hash recorded";
}

function latest(events: ChecklistEvent[], kind: string, key: string): ChecklistEvent | null {
  return events.find((event) => event.kind === kind && event.item_key === key) ?? null;
}

function applies(row: RequirementRow, channel: string | null, program: string | null): boolean {
  return row.channel === channel && (row.program_key === null || row.program_key === program);
}

export function buildSubmissionChecklist(input: ChecklistInput): { card: SubmissionChecklistData; dialogs: SubmissionChecklistDialogsData } {
  const date = (iso: string) => dayMonthYear(iso, input.today);
  const when = (iso: string) => dayMonthYear(isoDateInTimeZone(new Date(iso), input.timezone), input.today);
  const state = input.state;
  const handoffId = state?.handoff_id ?? null;
  const channel = state?.channel ?? null;
  const program = state?.program_key ?? null;
  const isOwner = input.role === "firm_owner";

  const gates: ChecklistGateView[] | null = state
    ? state.gates.map((gate) => ({
        key: gate.key,
        title: gateTitle(gate.key),
        detail: gateDetail(gate, date),
        link: gateLink(gate.key, input.matterId),
        badge: gateBadge(gate.state),
        dot: DOT[gate.state] ?? DOT.blocked,
        override:
          gate.state === "overridden" && gate.override_reason
            ? `Owner override: “${gate.override_reason}”, ${input.memberName(gate.override_by ?? null)}${gate.override_at ? `, ${when(gate.override_at)}` : ""}`
            : null,
      }))
    : null;

  const blocked = state?.blocked ?? [];
  const badge = !state
    ? { tone: "bad", label: "Not loaded" }
    : blocked.length
      ? { tone: "bad", label: `${blocked.length} ${blocked.length === 1 ? "gate" : "gates"} blocking` }
      : handoffId
        ? { tone: "ok", label: "Ready to record" }
        : { tone: "gr", label: "No handoff yet" };
  const intro = handoffId
    ? `Each gate is read from this matter’s own records. ${blockedWhy(blocked) ?? "Record submission is open."}`
    : "Each gate is read from this matter’s own records. Start a submission handoff to work through it; Record submission opens when nothing is blocking.";

  // The channel: IRCC's official name when approved, with its source.
  const names = input.requirements.filter((row) => row.kind === "channel_name");
  let channelView: SubmissionChecklistData["channel"] = null;
  if (channel) {
    const named = channelName(channel, names, program);
    channelView = {
      name: named.name,
      source: named.official ? { href: named.official.source_url, text: sourceText(named.official.source_url), facts: provenance(named.official, date, input.memberName) } : null,
      note: named.official ? null : "IRCC’s official name for this channel isn’t captured yet",
      retire: named.official && input.licensed ? wire("retire-open", input, { id: named.official.id, version: String(named.official.version) }) : null,
    };
  }

  const canTick = Boolean(handoffId) && STAFF.has(input.role);
  const steps: OutsideStepView[] = input.requirements
    .filter((row) => row.kind === "outside_step" && row.status === "approved" && applies(row, channel, program))
    .map((row) => {
      const event = latest(input.events, "outside_step", row.id);
      const done = Boolean(event?.ticked);
      return {
        id: row.id,
        label: row.label,
        done,
        wire: canTick && handoffId ? wire("tick", input, { handoff: handoffId, requirement: row.id, ticked: done ? "false" : "true" }) : null,
        source: { href: row.source_url, text: sourceText(row.source_url), facts: provenance(row, date, input.memberName) },
        by: event ? `${done ? "Done" : "Unticked"} by ${input.memberName(event.membership_id)}, ${when(event.created_at)}` : null,
        retire: input.licensed ? wire("retire-open", input, { id: row.id, version: String(row.version) }) : null,
      };
    });
  const stepsEmpty = steps.length
    ? null
    : !handoffId
      ? "The steps depend on the channel. They show once a handoff is started."
      : "No official steps for this program and channel are approved yet. Add each one from its official IRCC page; a licensed consultant approves it before it shows here.";

  const pending: PendingView[] = input.requirements
    .filter((row) => row.status === "pending_review" && (!channel || row.channel === channel))
    .map((row) => ({
      label: row.label,
      kind: row.kind === "channel_name" ? "Channel name" : "Outside step",
      source: { href: row.source_url, text: sourceText(row.source_url), facts: provenance(row, date, input.memberName) },
      badge: row.snapshot_sha256 ? { tone: "chg", label: "Waiting for review" } : { tone: "bad", label: "No page snapshot" },
      // No snapshot: Approve opens the attestation dialog (decided 2026-10-24).
      approve: input.licensed
        ? row.snapshot_sha256
          ? wire("review", input, { id: row.id, version: String(row.version), decision: "approved" })
          : wire("attest-open", input, { id: row.id, version: String(row.version) })
        : null,
      reject: input.licensed ? wire("reject-open", input, { id: row.id, version: String(row.version) }) : null,
    }));

  const feeEvent = latest(input.events, "fee_confirmation", "fees");
  const fees = feeEvent?.ticked && feeEvent.note ? `Fee handling: “${feeEvent.note}”, confirmed by ${input.memberName(feeEvent.membership_id)}, ${when(feeEvent.created_at)}` : null;
  const canConfirm = Boolean(handoffId) && PROPOSERS.has(input.role);
  const overridable = (state?.gates ?? []).filter((gate) => gate.state === "blocked" && OVERRIDABLE.includes(gate.key));

  let manifest: ManifestView | null = null;
  if (input.manifest?.handoff.manifest_pinned_at) {
    const pinned = input.manifest.handoff;
    manifest = {
      title: `Package manifest, ${pinned.package_label}`,
      hash: pinned.manifest_sha256 ? shortHash(pinned.manifest_sha256) : null,
      pinned: `Pinned when the package was released, ${when(pinned.manifest_pinned_at as string)}: ${pinned.manifest_file_count ?? input.manifest.files.length} ${
        (pinned.manifest_file_count ?? input.manifest.files.length) === 1 ? "file" : "files"
      }, each with the SHA-256 it was stored with. The same list is written to the audit trail when the submission is recorded.`,
      rows: input.manifest.files.map((file) => ({
        name: file.file_name,
        hash: shortHash(file.file_sha256),
        note: file.review_state === "accepted" ? "Accepted by the firm" : "Not reviewed yet",
      })),
    };
  }

  const card: SubmissionChecklistData = {
    badge,
    intro,
    gates,
    channel: channelView,
    steps,
    stepsEmpty,
    pending,
    fees,
    actions: {
      addStep: PROPOSERS.has(input.role) ? { "data-open": "dSubReq" } : null,
      fees: canConfirm ? { "data-open": "dSubFee" } : null,
      override: isOwner && handoffId && overridable.length ? { "data-open": "dSubOvr" } : null,
    },
    manifest,
  };

  const programOption = program ? { key: program, label: programLabel(program) } : null;
  const dialogs: SubmissionChecklistDialogsData = {
    requirement: PROPOSERS.has(input.role)
      ? { wire: wire("propose", input), channels: [...SUBMISSION_CHANNEL_OPTIONS], channel, program: programOption, today: input.today }
      : null,
    fees: canConfirm && handoffId ? { wire: wire("fees", input, { handoff: handoffId }), confirmed: Boolean(feeEvent?.ticked), note: feeEvent?.ticked ? feeEvent.note : null } : null,
    override:
      card.actions.override && handoffId
        ? { wire: wire("override", input, { handoff: handoffId }), gates: overridable.map((gate) => ({ value: gate.key, label: gateTitle(gate.key as GateKey) })) }
        : null,
    reject: pending.some((row) => row.reject) ? { wire: wire("reject", input) } : null,
    attest: pending.some((row) => row.approve?.["data-sub"] === "attest-open") ? { wire: wire("attest", input), today: input.today } : null,
    retire: steps.some((row) => row.retire) || channelView?.retire ? { wire: wire("retire", input) } : null,
  };
  return { card, dialogs };
}
