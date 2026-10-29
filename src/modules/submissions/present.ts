/**
 * The submission checklist (GOV-01) and package manifest (GOV-03), as words. Pure: shared by the
 * loader, the server actions and tests. The database decides every gate
 * (app.submission_gates_for); this only says what it found, with a link to where it is fixed, and
 * shows each official step with its source. Nothing here states an immigration rule: steps and
 * channel names come only from rows a licensed member approved from an official page.
 */

import { attestationError, attestationNote } from "@/modules/government/page-attestation";
import { SUBMISSION_CHANNEL_OPTIONS } from "@/modules/government/present";

export const GATE_KEYS = ["representation", "package", "deadlines", "signatures", "fees", "outside_steps"] as const;
export type GateKey = (typeof GATE_KEYS)[number];
/** Every gate but the package can be overridden by the firm owner, with a reason. */
export const OVERRIDABLE: readonly GateKey[] = ["representation", "deadlines", "signatures", "fees", "outside_steps"];

export type GateState = "ok" | "blocked" | "overridden" | "none";

/** One gate as app.submission_gates_for returns it. */
export type GateRow = {
  key: GateKey;
  state: GateState;
  since?: string | null;
  released?: boolean | null;
  pinned?: boolean | null;
  label?: string | null;
  files?: number | null;
  changed?: number;
  /** PREP-04: pinned form versions or approved facts no longer match the release. */
  scope_changed?: number;
  candidates?: number;
  tentative?: number;
  waiting?: number;
  signed?: boolean;
  fee_lines?: number;
  total?: number;
  done?: number;
  override_reason?: string | null;
  override_by?: string | null;
  override_at?: string | null;
};

export type ChecklistState = {
  handoff_id: string | null;
  channel: string | null;
  program_key: string | null;
  gates: GateRow[];
  blocked: GateKey[];
};

/** Reads the database's checklist JSON; anything unexpected is "not loaded" (null), never "all clear". */
export function readChecklist(value: unknown): ChecklistState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.gates) || !Array.isArray(raw.blocked)) return null;
  const gates = raw.gates.filter(
    (gate): gate is GateRow =>
      Boolean(gate) && typeof gate === "object" && GATE_KEYS.includes((gate as GateRow).key) && ["ok", "blocked", "overridden", "none"].includes((gate as GateRow).state),
  );
  if (gates.length !== GATE_KEYS.length) return null;
  return {
    handoff_id: typeof raw.handoff_id === "string" ? raw.handoff_id : null,
    channel: typeof raw.channel === "string" ? raw.channel : null,
    program_key: typeof raw.program_key === "string" ? raw.program_key : null,
    gates,
    blocked: raw.blocked.filter((key): key is GateKey => GATE_KEYS.includes(key as GateKey)),
  };
}

const GATE_TITLE: Record<GateKey, string> = {
  representation: "Representation current (Use of a Representative on file)",
  package: "Package version released",
  deadlines: "Deadlines reviewed",
  signatures: "Required signatures complete",
  fees: "Government fee handling confirmed",
  outside_steps: "Steps done outside Casevoya",
};

export function gateTitle(key: GateKey): string {
  return GATE_TITLE[key];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** What the gate found, in plain words. `date` formats a YYYY-MM-DD for the firm. */
export function gateDetail(gate: GateRow, date: (iso: string) => string): string {
  switch (gate.key) {
    case "representation":
      return gate.since ? `Authority on file, effective ${date(gate.since)}` : "No current representation authority on this matter";
    case "package":
      if (!gate.released) {
        const candidates = gate.candidates ?? 0;
        return candidates
          ? `Not released. A licensed consultant’s sign-off pins ${plural(candidates, "stored file", "stored files")} with their SHA-256`
          : "Not released, and no stored files on this matter to release";
      }
      if (!gate.pinned) return "Released before manifests were kept. Cancel this handoff and start a new one to pin the files";
      if (gate.changed || gate.scope_changed) {
        const parts: string[] = [];
        if (gate.changed) parts.push(`${plural(gate.changed, "pinned file was", "pinned files were")} replaced or removed after release`);
        if (gate.scope_changed) parts.push("the form versions or approved facts no longer match the release");
        return `${parts.join(", and ")}. Start a new handoff`;
      }
      return `${gate.label ?? "Package"} released, ${plural(gate.files ?? 0, "file", "files")} pinned`;
    case "deadlines":
      return gate.tentative ? `${plural(gate.tentative, "legal or correspondence deadline is", "legal or correspondence deadlines are")} not confirmed yet` : "Every legal and correspondence deadline is confirmed";
    case "signatures": {
      const parts: string[] = [];
      if (!gate.signed) parts.push("No signed service agreement");
      if (gate.waiting) parts.push(`${plural(gate.waiting, "agreement is", "agreements are")} waiting for a signature`);
      return parts.length ? parts.join("; ") : "Service agreement signed; nothing waiting for a signature";
    }
    case "fees": {
      const lines = gate.fee_lines ? `${plural(gate.fee_lines, "government fee line", "government fee lines")} on invoices` : "No government fee lines on invoices";
      return gate.state === "ok" || gate.state === "overridden" ? lines : `Not confirmed yet. ${lines}`;
    }
    case "outside_steps":
      if (gate.state === "none") return gate.total ? "" : "No approved official steps for this program and channel yet";
      return `${gate.done ?? 0} of ${gate.total ?? 0} done`;
  }
}

/** Where each gate is fixed. */
export function gateLink(key: GateKey, matterId: string): { href: string; label: string } | null {
  switch (key) {
    case "representation":
      return { href: "/sheet/agreements?tab=authority", label: "Representation authority" };
    case "package":
      return { href: `/sheet/matters/${matterId}?tab=documents`, label: "Documents" };
    case "deadlines":
      return { href: `/sheet/matters/${matterId}?tab=tasks`, label: "Deadlines" };
    case "signatures":
      return { href: `/sheet/matters/${matterId}?tab=agreements`, label: "Agreements" };
    case "fees":
      return { href: `/sheet/matters/${matterId}?tab=billing`, label: "Billing" };
    default:
      return null;
  }
}

export type GateBadge = { tone: string; label: string };

export function gateBadge(state: GateState): GateBadge {
  switch (state) {
    case "ok":
      return { tone: "ok", label: "Done" };
    case "overridden":
      return { tone: "chg", label: "Overridden by owner" };
    case "none":
      return { tone: "gr", label: "Nothing to tick" };
    default:
      return { tone: "bad", label: "Blocking" };
  }
}

/** "Opens when the checklist is complete: deadlines reviewed, fees confirmed." */
export function blockedWhy(blocked: GateKey[]): string | null {
  if (!blocked.length) return null;
  const names: Record<GateKey, string> = {
    representation: "representation current",
    package: "package released",
    deadlines: "deadlines reviewed",
    signatures: "signatures complete",
    fees: "fee handling confirmed",
    outside_steps: "outside steps done",
  };
  return `Opens when the submission checklist is complete: ${blocked.map((key) => names[key]).join(", ")}.`;
}

/** An official requirement row (public.submission_requirements), as read by the loader. */
export type RequirementRow = {
  id: string;
  program_key: string | null;
  channel: string;
  kind: string;
  label: string;
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
  /** Set when a licensed member approved it without a snapshot, attesting they opened the page. */
  page_attested_by_membership_id?: string | null;
  page_attested_on?: string | null;
};

/**
 * The provenance shown next to an official value: source page, form, dates, snapshot hash; or,
 * approved without a snapshot, "page not captured by Casevoya, checked by <reviewer> on <date>".
 */
export function provenance(row: RequirementRow, date: (iso: string) => string, memberName?: (membershipId: string | null) => string): string[] {
  const parts: string[] = [];
  if (row.source_section) parts.push(`section “${row.source_section}”`);
  if (row.form_number) parts.push(row.form_modified_on ? `${row.form_number}, date modified ${date(row.form_modified_on)}` : row.form_number);
  parts.push(`checked ${date(row.checked_on)}`);
  if (row.current_to) parts.push(`current to ${date(row.current_to)}`);
  const attested = row.snapshot_sha256 ? null : attestationNote(row, memberName, date);
  parts.push(row.snapshot_sha256 ? `snapshot sha256 ${row.snapshot_sha256.slice(0, 4)}…${row.snapshot_sha256.slice(-4)}` : (attested ?? "no page snapshot"));
  return parts;
}

/** A source link's text: the host and path, without the scheme. */
export function sourceText(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.length > 48 ? `${parsed.pathname.slice(0, 45)}…` : parsed.pathname;
    return `${parsed.hostname}${path}${parsed.hash}`;
  } catch {
    return url;
  }
}

/**
 * The channel's name: IRCC's official name when a licensed member approved one for this program
 * and channel (with its source), otherwise Casevoya's own neutral label, said as such.
 */
export function channelName(
  channel: string,
  names: RequirementRow[],
  programKey: string | null,
): { name: string; official: RequirementRow | null } {
  const approved = names.filter((row) => row.kind === "channel_name" && row.status === "approved" && row.channel === channel);
  const official = approved.find((row) => row.program_key === programKey) ?? approved.find((row) => row.program_key === null) ?? null;
  const fallback = SUBMISSION_CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? "Other";
  return { name: official?.label ?? fallback, official };
}

/** Database refusals for the checklist acts, as the Sheet's own copy. */
const ERRORS: [RegExp, string][] = [
  [/official Government of Canada page/, "Use the official page’s address: canada.ca or a gc.ca site, starting with https://."],
  [/section of the page|section anchor/, "Name the section of the page, or paste its link with the section anchor (#…)."],
  [/date checked/, "Add the date you checked the page. It can’t be in the future or more than a year ago."],
  [/date modified needs its form number/, "A form’s date modified needs the form number, and it can’t be in the future."],
  [/current-to date/, "The current-to date can’t be in the future."],
  [/as the official page gives it/, "Write the step or name as the official page gives it (3 to 300 characters)."],
  [/why it.s rejected|why it.s retired/, "Say why."],
  [/nothing is waiting for review/, "That entry was already reviewed."],
  [/only an approved requirement/, "Only an approved step can be retired."],
  [/does not apply to this submission/, "That step isn’t for this matter’s program and channel."],
  [/already marked so/, "That step is already marked so."],
  [/how the government fee was handled/, "Say how the government fee was handled (3 to 500 characters)."],
  [/cannot be overridden/, "The package release can’t be overridden: a licensed consultant signs it off."],
  [/reason of at least 10/, "Give the reason for the override (at least 10 characters)."],
  [/not blocking/, "That gate isn’t blocking anymore."],
  [/firm owner step-up/, "Only the firm owner can override, after confirming with their authenticator."],
  [/not submitted yet/, "This handoff was already recorded or cancelled."],
  [/version conflict/, "Someone else changed this. Reload and try again."],
  [/denied|staff access|licen/, "Your role can’t do this on this matter."],
];

export function checklistError(message: string): string {
  const attestation = attestationError(message);
  if (attestation) return attestation;
  for (const [pattern, copy] of ERRORS) if (pattern.test(message)) return copy;
  return "That couldn’t be saved.";
}
