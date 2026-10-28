/**
 * GOV-05 parts of the Government status page: each status's source, evidence link, last checked
 * time and Mark checked; Share with client and its preview; and IRCC's processing-time estimate
 * next to the submission status. Pure; the loader reads the rows as the signed-in member and the
 * database checks every control again.
 */
import type { GovernmentRow } from "@/components/sheet/designer/government";
import type { GovShareDialog, GovStatusDialogsData, GovStatusWire } from "@/components/sheet/designer/gov-status-dialogs";
import {
  clientRecordView,
  currentEstimates,
  ESTIMATE_NOTE,
  estimateSource,
  fullDay,
  dayIn,
  lastCheckedAt,
  PROCESSING_TIMES_URL,
  statusSource,
  type EstimateRow,
} from "@/modules/government/status-provenance";
import type { GovernmentContext, GovernmentRecords, HandoffRow, LetterRow } from "@/modules/sheet/government-present";
import { dayMonth } from "@/modules/sheet/home-present";
import { isoDateInTimeZone } from "@/modules/sheet/present";

const STAFF = new Set(["firm_owner", "licensed_consultant", "case_manager", "assistant"]);
/** app.share_government_record: an owner or a licensed consultant, with a recent step-up. */
const SHARERS = new Set(["firm_owner", "licensed_consultant"]);

export const NOT_CHECKED = "Not checked yet";

function wire(act: string, ctx: GovernmentContext, extra: Record<string, string> = {}): GovStatusWire {
  const out: GovStatusWire = { "data-govs": act, "data-org": ctx.organizationId, "data-matter": ctx.matterId };
  for (const [key, value] of Object.entries(extra)) out[`data-${key}`] = value;
  return out;
}

/** "Today 09:12" or "14 Oct 18:40", as government-present's whenFull (kept here to avoid an import cycle). */
function whenFull(iso: string, timeZone: string, today: string): string {
  const date = isoDateInTimeZone(new Date(iso), timeZone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return date === today ? `Today ${time}` : `${dayMonth(date)} ${time}`;
}

const shareDialogId = (letterId: string) => `dGovShare-${letterId.slice(0, 8)}`;

function checked(at: string | null, ctx: GovernmentContext): string {
  return at ? whenFull(at, ctx.timezone, ctx.today) : NOT_CHECKED;
}

/** Provenance for a letter's row: source, evidence link, last checked, Mark checked, sharing. */
export function letterProvenance(letter: LetterRow, records: GovernmentRecords, ctx: GovernmentContext): Partial<GovernmentRow> {
  const staff = STAFF.has(ctx.role);
  return {
    source: statusSource(letter.channel),
    evidenceOpen: letter.evidence_version_id ? { "data-doc-open": letter.evidence_version_id, "data-org": ctx.organizationId } : null,
    lastChecked: checked(lastCheckedAt(records.checks, letter.id), ctx),
    check: staff ? wire("check", ctx, { id: letter.id }) : null,
    share: letter.verified_at && !letter.shared_with_client_at && SHARERS.has(ctx.role) ? { "data-open": shareDialogId(letter.id) } : null,
    shared: letter.shared_with_client_at ? `Shared with client ${fullDay(dayIn(letter.shared_with_client_at, ctx.timezone))}` : null,
  };
}

/** Provenance for the Submission row (a check of the whole matter). */
export function submissionProvenance(handoff: HandoffRow | null, records: GovernmentRecords, ctx: GovernmentContext): Partial<GovernmentRow> {
  return {
    source: handoff ? statusSource(handoff.channel) : null,
    evidenceOpen: handoff?.receipt_version_id ? { "data-doc-open": handoff.receipt_version_id, "data-org": ctx.organizationId } : null,
    lastChecked: checked(lastCheckedAt(records.checks, null), ctx),
    check: STAFF.has(ctx.role) ? wire("check", ctx) : null,
  };
}

/** IRCC's processing-time estimate, next to the submission status. Absent when none was entered. */
export function estimateTableRow(records: GovernmentRecords, ctx: GovernmentContext): GovernmentRow | null {
  const { approved, pending } = currentEstimates(records.estimates ?? []);
  const shown = approved ?? pending;
  if (!shown) return null;
  const waiting = !approved;
  const reviewer = approved?.reviewed_by_membership_id ? ctx.memberName(approved.reviewed_by_membership_id) : null;
  return {
    item: "IRCC processing time",
    status: waiting ? { tone: "chg", label: "Waiting for licensed review" } : { tone: "blue", label: shown.estimate_text, detail: "IRCC’s estimate" },
    recordedBy: ctx.memberName(shown.entered_by_membership_id),
    evidence: `${shown.application_type}. ${ESTIMATE_NOTE}.`,
    evidenceHref: shown.source_url,
    source: estimateSource(shown, ctx.memberName),
    verified: approved && reviewer && approved.reviewed_at ? `${reviewer}, ${whenFull(approved.reviewed_at, ctx.timezone, ctx.today)}` : "Waiting for licensed review",
    review: pending && ctx.licensed ? { "data-open": "dGovEstRev" } : null,
    lastChecked: fullDay(shown.checked_on),
  };
}

function reviewFacts(row: EstimateRow, ctx: GovernmentContext): [string, string][] {
  return [
    ["Application type", row.application_type],
    ["IRCC’s estimate", row.estimate_text],
    ["Date checked", fullDay(row.checked_on)],
    ["Entered by", ctx.memberName(row.entered_by_membership_id)],
    ["Page", estimateSource(row, ctx.memberName).replace(/^Source: /, "")],
  ];
}

/** The page's GOV-05 dialogs and the Add IRCC estimate opener. */
export function statusDialogs(records: GovernmentRecords, ctx: GovernmentContext): { estimate: GovStatusWire | null; dialogs: GovStatusDialogsData } {
  const firm = ctx.firmName ?? "your firm";
  const shares: GovShareDialog[] = SHARERS.has(ctx.role)
    ? records.letters
        .filter((letter) => letter.verified_at && !letter.shared_with_client_at)
        .map((letter) => ({
          id: shareDialogId(letter.id),
          view: clientRecordView(letter, firm, ctx.timezone),
          wire: wire("share", ctx, { id: letter.id }),
        }))
    : [];
  const { pending } = currentEstimates(records.estimates ?? []);
  const staff = STAFF.has(ctx.role);
  return {
    estimate: staff ? { "data-open": "dGovEst" } : null,
    dialogs: {
      shares,
      estimate: staff ? { wire: wire("estimate", ctx), url: PROCESSING_TIMES_URL, today: ctx.today } : null,
      review:
        pending && ctx.licensed
          ? {
              approve: wire("estimate-review", ctx, { id: pending.id, version: String(pending.version), decision: "approved" }),
              reject: wire("estimate-review", ctx, { id: pending.id, version: String(pending.version), decision: "rejected" }),
              facts: reviewFacts(pending, ctx),
              href: pending.source_url,
              // No page capture: approving needs the reviewer's attestation (decided 2026-10-24).
              attest: pending.snapshot_sha256 ? null : { today: ctx.today },
            }
          : null,
    },
  };
}
