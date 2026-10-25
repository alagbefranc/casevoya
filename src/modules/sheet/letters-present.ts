/**
 * AI-01: a matter's letters (matter_letters, matter_letter_versions) in the words of the matter
 * page's right column and dialogs (src/components/sheet/designer/matter-letters.tsx). Pure, so the
 * copy, the switches and the review rules shown are tested. The database decides every change.
 */
import type { MatterBadge } from "@/components/sheet/designer/matters";
import {
  NEW_LETTER_DIALOG,
  VO_LETTER_DIALOG,
  type LetterAttrs,
  type LetterDialog,
  type LetterDialogsData,
  type LetterFactRow,
  type LetterSourceRow,
  type MatterLettersData,
} from "@/components/sheet/designer/matter-letters";
import { factText, LETTER_TYPES, letterTypeLabel, stripCitations } from "@/modules/vo/letter";
import { longDate } from "@/modules/sheet/matter-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";

export type LetterRow = {
  id: string;
  letter_type: string;
  title: string;
  origin: string;
  status: string;
  current_version: number;
  approved_version: number | null;
  approved_by_membership_id: string | null;
  approved_at: string | null;
  approved_self: boolean | null;
  created_at: string;
  updated_at: string;
  version: number;
  is_sample: boolean;
};

export type LetterVersionRow = {
  letter_id: string;
  version_number: number;
  title: string;
  body: string;
  facts: unknown;
  official: unknown;
  left_out: unknown;
  origin: string;
  created_by: string;
  created_at: string;
};

export type LettersViewer = {
  organizationId: string;
  matterId: string;
  timeZone: string;
  /** The person may write, revise and discard letters on this matter. */
  canWrite: boolean;
  /** The person holds a licensed membership (approval still needs a fresh step-up). */
  licensed: boolean;
  /** Vo and its letter switch are on for the firm, and whether the Vo service is reachable. */
  vo: "on" | "unavailable" | "off";
};

export type LetterNames = {
  member: (membershipId: string | null) => string;
  user: (userId: string | null) => string;
};

const SHOWN = 8;

export function letterDialogId(letterId: string): string {
  return `dLt${letterId.replace(/-/g, "").slice(0, 12)}`;
}

export function letterBadge(status: string): MatterBadge {
  if (status === "approved") return { tone: "ok", label: "Approved" };
  if (status === "discarded") return { tone: "gr", label: "Discarded" };
  return { tone: "chg", label: "Draft, needs licensed review" };
}

function day(at: string | null | undefined, timeZone: string): string | null {
  if (!at) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(at) ? at : isoDateInTimeZone(new Date(at), timeZone);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? longDate(date) : null;
}

type FactJson = { ref?: string; person?: string; form?: string; label?: string; value?: string; field_type?: string; reviewer_membership_id?: string; reviewed_at?: string };
type SourceJson = {
  ref?: string;
  kind?: string;
  label?: string;
  content?: string;
  source_url?: string;
  source_section?: string | null;
  form_number?: string | null;
  form_modified_on?: string | null;
  checked_on?: string | null;
  current_to?: string | null;
  snapshot_sha256?: string | null;
  attested_on?: string | null;
  reviewed_at?: string | null;
};

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === "object") as T[]) : [];
}

export function factRows(value: unknown, names: LetterNames, timeZone: string): LetterFactRow[] {
  return list<FactJson>(value).map((fact) => {
    const approved = day(fact.reviewed_at, timeZone);
    return {
      ref: String(fact.ref ?? ""),
      text: `${fact.person ? `${fact.person}: ` : ""}${fact.label ?? "Answer"}: ${factText(String(fact.field_type ?? ""), String(fact.value ?? ""))}`,
      detail: [
        fact.form ? `From the intake form “${fact.form}”` : "From an intake form",
        `approved by ${names.member(fact.reviewer_membership_id ?? null)}${approved ? ` on ${approved}` : ""}`,
      ].join(" · "),
    };
  });
}

const SOURCE_KIND: Record<string, string> = {
  fee: "IRCC fee",
  submission_requirement: "Submission step",
  renewal_timing: "Renewal timing",
  follow_up_step: "Step after approval",
  rule_version: "Program rule",
};

/** Only an https link is shown as a link; anything else is shown as text. */
function httpsUrl(value: string | undefined): string | null {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sourceRows(value: unknown, timeZone: string): LetterSourceRow[] {
  return list<SourceJson>(value).map((source) => {
    const href = httpsUrl(source.source_url);
    const checked = day(source.checked_on, timeZone);
    const modified = day(source.form_modified_on, timeZone);
    const currentTo = day(source.current_to, timeZone);
    const attested = day(source.attested_on, timeZone);
    const reviewed = day(source.reviewed_at, timeZone);
    const detail = [
      source.source_section ? `section: ${source.source_section}` : null,
      source.form_number ? `form ${source.form_number}${modified ? `, date modified ${modified}` : ""}` : null,
      checked ? `checked ${checked}` : "date checked unknown",
      currentTo ? `current to ${currentTo}` : null,
      source.snapshot_sha256
        ? `page fingerprint (SHA-256) ${source.snapshot_sha256.slice(0, 12)}…`
        : attested
          ? `page not captured by Casevoya; the reviewer checked it on ${attested}`
          : null,
      reviewed ? `approved by a licensed member on ${reviewed}` : null,
    ].filter((part): part is string => Boolean(part));
    return {
      ref: String(source.ref ?? ""),
      text: `${SOURCE_KIND[source.kind ?? ""] ?? "Official source"}: ${source.content ?? source.label ?? ""}`,
      href,
      linkText: href ? href.replace(/^https:\/\//, "").slice(0, 90) : String(source.source_url ?? "Source not recorded").slice(0, 90),
      detail: detail.join(" · "),
    };
  });
}

function leftOut(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((line): line is string => typeof line === "string" && Boolean(line.trim())).slice(0, 20) : [];
}

function wire(viewer: LettersViewer, row: LetterRow, key: string): LetterAttrs {
  return { [key]: row.id, "data-org": viewer.organizationId, "data-version": String(row.version) };
}

function reviewLine(row: LetterRow, names: LetterNames, timeZone: string): string {
  if (row.status === "approved") {
    const on = day(row.approved_at, timeZone);
    return `Approved by ${names.member(row.approved_by_membership_id)}${on ? ` on ${on}` : ""} (version ${row.approved_version})${row.approved_self ? ", who wrote this version (no other licensed member could review it)" : ""}. Download gives the approved text without the citation markers; each download is recorded.`;
  }
  if (row.status === "discarded") return "Discarded. It stays on record and can’t be released.";
  return "DRAFT. It can’t be released or used as final until a licensed member of the firm approves this version. Approving needs a fresh two-step check and is recorded in the audit log. Saving a change makes a new version that needs its own approval.";
}

function letterDialog(row: LetterRow, current: LetterVersionRow | undefined, viewer: LettersViewer, names: LetterNames): LetterDialog {
  const draft = row.status === "draft";
  const created = day(row.created_at, viewer.timeZone);
  const meta = [
    letterTypeLabel(row.letter_type),
    `version ${row.current_version}`,
    current?.origin === "vo" ? "drafted by Vo" : `written by ${names.user(current?.created_by ?? null)}`,
    ...(created ? [`started ${created}`] : []),
    ...(row.is_sample ? ["sample"] : []),
  ];
  const approve: LetterAttrs | null = !draft
    ? null
    : viewer.licensed
      ? { ...wire(viewer, row, "data-letter-approve"), title: "Approve this version (needs a fresh two-step check)" }
      : { disabled: true, title: "Only a licensed member of the firm can approve a letter" };
  return {
    id: letterDialogId(row.id),
    title: row.title,
    badge: letterBadge(row.status),
    meta,
    body: current?.body ?? "",
    editable: draft && viewer.canWrite,
    facts: factRows(current?.facts, names, viewer.timeZone),
    sources: sourceRows(current?.official, viewer.timeZone),
    leftOut: leftOut(current?.left_out),
    review: reviewLine(row, names, viewer.timeZone),
    revise: draft && viewer.canWrite ? wire(viewer, row, "data-letter-revise") : null,
    approve,
    discard: draft && viewer.canWrite ? wire(viewer, row, "data-letter-discard") : null,
    download: row.status === "approved" ? `/api/letters/${row.id}?organizationId=${viewer.organizationId}` : null,
  };
}

/** The letters shown: drafts and approved letters, newest first (discarded ones stay on record only). */
function shown(rows: readonly LetterRow[]): LetterRow[] {
  return rows
    .filter((row) => row.status !== "discarded")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, SHOWN);
}

export function lettersRbar(rows: readonly LetterRow[], viewer: LettersViewer): MatterLettersData {
  return {
    cards: shown(rows).map((row) => ({
      id: row.id,
      title: row.title,
      badge: letterBadge(row.status),
      parts: [letterTypeLabel(row.letter_type), `v${row.current_version}`, row.origin === "vo" ? "drafted by Vo" : "written by staff"],
      open: { "data-dlg": letterDialogId(row.id) },
    })),
    vo: viewer.canWrite && viewer.vo !== "off" ? (viewer.vo === "on" ? { "data-dlg": VO_LETTER_DIALOG } : { disabled: true, title: "Vo is unavailable right now. Write the letter yourself." }) : null,
    manual: viewer.canWrite ? { "data-dlg": NEW_LETTER_DIALOG } : null,
    empty: "No letters on this matter yet.",
  };
}

export function lettersDialogs(rows: readonly LetterRow[], versions: readonly LetterVersionRow[], viewer: LettersViewer, names: LetterNames): LetterDialogsData {
  const current = new Map(versions.map((version) => [`${version.letter_id}:${version.version_number}`, version]));
  const target = { "data-org": viewer.organizationId, "data-matter": viewer.matterId };
  return {
    types: Object.entries(LETTER_TYPES).map(([value, label]) => ({ value, label })),
    vo: viewer.canWrite && viewer.vo === "on" ? { "data-vo-letter": "1", ...target } : null,
    manual: viewer.canWrite ? { "data-letter-new": "1", ...target } : null,
    letters: shown(rows).map((row) => letterDialog(row, current.get(`${row.id}:${row.current_version}`), viewer, names)),
  };
}

/**
 * Vo's Assist card in the right column: the newest Vo letter draft waiting for review. Accept and
 * Edit open the letter (where a licensed member approves it); Reject discards it.
 */
export function voLetterCard(rows: readonly LetterRow[], versions: readonly LetterVersionRow[], viewer: LettersViewer) {
  const row = shown(rows).find((letter) => letter.origin === "vo" && letter.status === "draft");
  if (!row) return null;
  const version = versions.find((item) => item.letter_id === row.id && item.version_number === row.current_version);
  const text = stripCitations(version?.body ?? "");
  const facts = list(version?.facts).length;
  const sources = list(version?.official).length;
  const open: LetterAttrs = { "data-dlg": letterDialogId(row.id) };
  const reject: LetterAttrs = viewer.canWrite ? { ...wire(viewer, row, "data-letter-discard"), title: "Discard this draft" } : { disabled: true };
  return {
    draft: `${row.title}: “${text.length > 220 ? `${text.slice(0, 220).trimEnd()}…` : text}”`,
    sources: `Cites ${facts} approved ${facts === 1 ? "fact" : "facts"} and ${sources} official ${sources === 1 ? "source" : "sources"} · a licensed member approves it before release`,
    accept: { ...open, title: "Open the letter to review and approve it" },
    edit: open,
    reject,
  };
}
