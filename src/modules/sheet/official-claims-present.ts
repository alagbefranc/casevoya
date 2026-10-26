/**
 * Live official claims in Source review (#188; Francis's decisions 2026-10-25). Pure. The input is
 * public.official_claims / public.official_claim / public.rule_claim_history JSON
 * (app.firm_rule_claim): a captured official claim is live with no label; a firm's licensed edit
 * shows only its stamp, "Edited by <name>, licence <number>, <date>"; when a re-capture changed the
 * claim since the edit, "Source changed since your edit" with the new official text beside it; an
 * overdue source says so. Nothing is filled in: a date the page didn't print says Unknown.
 */
import type { MatterBadge } from "@/components/sheet/designer/matters";
import type { ClaimEvidenceItem } from "@/components/sheet/designer/source-claims";
import { longDate } from "@/modules/sheet/matter-present";
import { programLabel } from "@/modules/sheet/matters-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";
import { UNKNOWN } from "@/modules/sheet/source-claims-present";

/** Rows per page of the Live official claims list. */
export const OFFICIAL_CLAIMS_PAGE = 50;

export type ClaimEditJson = {
  id?: unknown;
  claim?: unknown;
  value?: unknown;
  reason?: unknown;
  editor?: unknown;
  licence_number?: unknown;
  edited_at?: unknown;
  edited_on?: unknown;
  base_version_id?: unknown;
  base_version_number?: unknown;
};

export type OfficialClaimJson = {
  definition_id?: unknown;
  stable_key?: unknown;
  program_key?: unknown;
  jurisdiction?: unknown;
  category?: unknown;
  version_id?: unknown;
  version_number?: unknown;
  official_claim?: unknown;
  official_value?: unknown;
  claim?: unknown;
  value?: unknown;
  source_url?: unknown;
  section?: unknown;
  excerpt?: unknown;
  form_number?: unknown;
  modified_on?: unknown;
  last_amended_on?: unknown;
  current_to?: unknown;
  checked_on?: unknown;
  publisher?: unknown;
  sha256?: unknown;
  retrieved_at?: unknown;
  last_checked_at?: unknown;
  last_attempt_result?: unknown;
  recheck_days?: unknown;
  stale?: unknown;
  edit?: ClaimEditJson | null;
  source_changed?: unknown;
};

export type ClaimHistoryJson = {
  kind?: unknown;
  at?: unknown;
  version_number?: unknown;
  status?: unknown;
  claim?: unknown;
  value?: unknown;
  source_url?: unknown;
  section?: unknown;
  sha256?: unknown;
  retrieved_at?: unknown;
  modified_on?: unknown;
  current_to?: unknown;
  reviewer?: unknown;
  reason?: unknown;
  editor?: unknown;
  licence_number?: unknown;
  edited_on?: unknown;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const day = (value: unknown): string | null => {
  const raw = text(value);
  return raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
};

/** "Edited by Jane Roe, licence R123456, 25 Oct 2026": the only label a firm edit shows. */
export function claimStamp(edit: { editor?: unknown; edited_by?: unknown; licence_number?: unknown; edited_licence?: unknown; edited_on?: unknown } | null | undefined): string | null {
  if (!edit) return null;
  const who = text(edit.editor) ?? text(edit.edited_by);
  const licence = text(edit.licence_number) ?? text(edit.edited_licence);
  const on = day(edit.edited_on);
  if (!who || !licence || !on) return null;
  return `Edited by ${who}, licence ${licence}, ${longDate(on)}`;
}

export const SOURCE_CHANGED = "Source changed since your edit";

const CATEGORY: Record<string, string> = {
  fee: "Fee",
  form: "Form",
  checklist: "Checklist",
  program: "Program page",
  guide: "Guide",
  law: "Law",
};

export function categoryLabel(category: unknown): string {
  return CATEGORY[String(category)] ?? "Official page";
}

function instantDay(value: unknown, timeZone: string): string | null {
  const raw = text(value);
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : isoDateInTimeZone(at, timeZone);
}

/** The claim's state: Live, or overdue for a re-check (with when it was last checked). */
export function claimState(claim: OfficialClaimJson, timeZone: string): MatterBadge {
  const checked = instantDay(claim.last_checked_at, timeZone);
  if (claim.stale === true) {
    return { tone: "chg", label: "Overdue for a re-check", detail: checked ? `last checked ${longDate(checked)}` : "never checked" };
  }
  return { tone: "ok", label: "Live" };
}

export type OfficialClaimRow = {
  definitionId: string;
  key: string;
  href: string;
  claim: string;
  program: string;
  category: string;
  value: string | null;
  lastChecked: string;
  state: MatterBadge;
  stamp: string | null;
  sourceChanged: boolean;
  sourceUrl: string | null;
};

export function officialClaimRow(claim: OfficialClaimJson, timeZone: string): OfficialClaimRow | null {
  const definitionId = text(claim.definition_id);
  const key = text(claim.stable_key);
  if (!definitionId || !key) return null;
  const checked = instantDay(claim.last_checked_at, timeZone);
  const program = text(claim.program_key);
  return {
    definitionId,
    key,
    href: `?tab=rule&claim=${definitionId}`,
    claim: text(claim.claim) ?? "",
    program: program ? programLabel(program) : "Every program",
    category: categoryLabel(claim.category),
    value: text(claim.value),
    lastChecked: checked ? longDate(checked) : UNKNOWN,
    state: claimState(claim, timeZone),
    stamp: claimStamp(claim.edit ?? null),
    sourceChanged: claim.source_changed === true,
    sourceUrl: text(claim.source_url),
  };
}

export type LiveClaimsData = {
  rows: OfficialClaimRow[];
  total: number;
  query: string;
  offset: number;
  /** Links to the previous and next page, keeping the search. */
  previous: string | null;
  next: string | null;
  /** "Showing 1–50 of 2,160". */
  range: string;
};

function pageHref(query: string, offset: number): string {
  const params = new URLSearchParams({ tab: "sources" });
  if (query) params.set("cq", query);
  if (offset > 0) params.set("offset", String(offset));
  return `?${params.toString()}#live-claims`;
}

export function liveClaimsData(json: { total?: unknown; rows?: unknown } | null, input: { query: string; offset: number; timeZone: string }): LiveClaimsData {
  const rows = (Array.isArray(json?.rows) ? (json?.rows as OfficialClaimJson[]) : []).map((row) => officialClaimRow(row, input.timeZone)).filter((row): row is OfficialClaimRow => Boolean(row));
  const total = typeof json?.total === "number" ? json.total : rows.length;
  const first = rows.length ? input.offset + 1 : 0;
  const last = input.offset + rows.length;
  return {
    rows,
    total,
    query: input.query,
    offset: input.offset,
    previous: input.offset > 0 ? pageHref(input.query, Math.max(input.offset - OFFICIAL_CLAIMS_PAGE, 0)) : null,
    next: last < total ? pageHref(input.query, last) : null,
    range: total ? `Showing ${first.toLocaleString("en-CA")}–${last.toLocaleString("en-CA")} of ${total.toLocaleString("en-CA")}` : "",
  };
}

/** The claim's evidence in the Source review evidence block: the captured page, every date on its own. */
export function officialEvidence(claim: OfficialClaimJson, timeZone: string): ClaimEvidenceItem {
  const retrieved = instantDay(claim.retrieved_at, timeZone);
  const checked = instantDay(claim.last_checked_at, timeZone);
  const sha = text(claim.sha256);
  const dateOf = (value: unknown) => {
    const found = day(value);
    return found ? longDate(found) : UNKNOWN;
  };
  return {
    publisher: text(claim.publisher) ?? "Government of Canada",
    url: text(claim.source_url) ?? "",
    section: text(claim.section) ?? "—",
    excerpt: text(claim.excerpt),
    form: text(claim.form_number),
    capture: sha ? `Captured by Casevoya. SHA-256 ${sha}` : "Page not captured by Casevoya.",
    captured: Boolean(sha),
    dates: [
      { label: "Published", value: UNKNOWN },
      { label: "Modified", value: dateOf(claim.modified_on) },
      { label: "Last amended", value: dateOf(claim.last_amended_on) },
      { label: "Effective", value: UNKNOWN },
      { label: "Current to", value: dateOf(claim.current_to) },
      { label: "Retrieved", value: retrieved ? longDate(retrieved) : UNKNOWN },
      { label: "Last checked", value: checked ? longDate(checked) : UNKNOWN },
    ],
  };
}

export type ClaimHistoryRow = { when: string; what: string; text: string | null; detail: string | null };

/** History, oldest first: the capture, every re-capture with its evidence, every edit and revert with its stamp and reason. */
export function claimHistoryRows(history: unknown, timeZone: string): ClaimHistoryRow[] {
  const rows = Array.isArray(history) ? (history as ClaimHistoryJson[]) : [];
  return rows.map((row) => {
    const at = instantDay(row.at, timeZone);
    const when = at ? longDate(at) : UNKNOWN;
    const kind = String(row.kind);
    const value = text(row.value);
    const claimText = text(row.claim) ? `${text(row.claim)}${value && !String(row.claim).includes(value) ? ` (${value})` : ""}` : null;
    if (kind === "edit" || kind === "revert") {
      const stamp = claimStamp(row) ?? "Edited by a licensed member";
      return {
        when,
        what: kind === "edit" ? `Firm edit on version ${row.version_number ?? "?"}` : "Reverted to the official text",
        text: kind === "edit" ? claimText : null,
        detail: `${kind === "edit" ? stamp : stamp.replace(/^Edited by/, "Reverted by")}. Reason: ${text(row.reason) ?? UNKNOWN}`,
      };
    }
    const sha = text(row.sha256);
    const retrieved = instantDay(row.retrieved_at, timeZone);
    const evidence = [
      text(row.section) ? `Section: ${text(row.section)}` : null,
      retrieved ? `retrieved ${longDate(retrieved)}` : null,
      sha ? `SHA-256 ${sha.slice(0, 12)}…` : null,
      day(row.modified_on) ? `date modified ${longDate(day(row.modified_on) as string)}` : null,
      day(row.current_to) ? `current to ${longDate(day(row.current_to) as string)}` : null,
    ].filter(Boolean);
    const what =
      kind === "capture"
        ? `Captured, version ${row.version_number ?? 1}`
        : kind === "recapture"
          ? `Re-captured, version ${row.version_number ?? "?"}`
          : `Firm version ${row.version_number ?? "?"}${text(row.reviewer) ? `, approved by ${text(row.reviewer)}` : ""}`;
    return { when, what, text: claimText, detail: evidence.length ? evidence.join(" · ") : null };
  });
}

export type OfficialClaimView = {
  definitionId: string;
  baseVersionId: string;
  organizationId: string;
  title: { left: string; right: string };
  summary: string;
  claim: string;
  value: string | null;
  stamp: string | null;
  sourceChanged: { officialClaim: string; officialValue: string | null } | null;
  state: MatterBadge;
  evidence: ClaimEvidenceItem;
  history: ClaimHistoryRow[];
  /** Firm owner or licensed consultant: Edit, Revert and Keep (each needs a fresh step-up). */
  licensed: boolean;
  edited: boolean;
  officialClaim: string;
  officialValue: string | null;
  draft: { claim: string; value: string };
};

export function officialClaimView(
  claim: OfficialClaimJson | null,
  history: unknown,
  viewer: { organizationId: string; role: string; timeZone: string },
): OfficialClaimView | null {
  if (!claim) return null;
  const definitionId = text(claim.definition_id);
  const baseVersionId = text(claim.version_id);
  const key = text(claim.stable_key);
  if (!definitionId || !baseVersionId || !key) return null;
  const program = text(claim.program_key);
  const officialClaim = text(claim.official_claim) ?? "";
  const officialValue = text(claim.official_value);
  const edited = Boolean(claim.edit);
  const state = claimState(claim, viewer.timeZone);
  const recheck = typeof claim.recheck_days === "number" ? claim.recheck_days : null;
  return {
    definitionId,
    baseVersionId,
    organizationId: viewer.organizationId,
    title: { left: key, right: `v${typeof claim.version_number === "number" ? claim.version_number : "?"}` },
    summary: `${categoryLabel(claim.category)}. ${text(claim.jurisdiction) ?? "CA"}, ${program ? programLabel(program) : "every program"}. ${
      state.label === "Live" ? "Live" : `${state.label} (${state.detail})`
    }.${recheck ? ` Its source is due for a re-check ${recheck} days after its last successful check.` : ""}`,
    claim: text(claim.claim) ?? officialClaim,
    value: text(claim.value),
    stamp: claimStamp(claim.edit ?? null),
    sourceChanged: claim.source_changed === true ? { officialClaim, officialValue } : null,
    state,
    evidence: officialEvidence(claim, viewer.timeZone),
    history: claimHistoryRows(history, viewer.timeZone),
    licensed: viewer.role === "firm_owner" || viewer.role === "licensed_consultant",
    edited,
    officialClaim,
    officialValue,
    draft: { claim: text(claim.claim) ?? officialClaim, value: text(claim.value) ?? "" },
  };
}

/** The database's refusals of an edit, revert or unsuspend, in the Sheet's words. */
const ERRORS: [RegExp, string][] = [
  [/fresh step-up/, "Each change needs a fresh step-up. Confirm it’s you again."],
  [/version conflict/, "The official claim changed since you opened it. Reload the page and try again."],
  [/only a live official claim/, "Only a live official claim can be edited."],
  [/nothing to revert/, "Your firm already shows the official text."],
  [/licence isn.t recorded/, "Your licence isn’t recorded. Add it in Settings › Licence before editing a claim."],
  [/write the firm.s wording/, "Write your firm’s wording (3 to 2,000 characters)."],
  [/say why/, "Say why."],
  [/a newer version of this claim is live/, "A newer version of this claim is live, so this one stays suspended."],
  [/only a suspended version/, "This version isn’t suspended any more. Reload the page."],
  [/staff access denied|rule review denied/, "Only a firm owner or licensed consultant whose licence is in good standing can do that."],
];

export function officialClaimError(message: string): string {
  for (const [pattern, copy] of ERRORS) if (pattern.test(message)) return copy;
  return "That couldn’t be saved.";
}
