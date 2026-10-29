/**
 * Pure: SEC-07 (Settings > Retention: eligible for deletion, deletion jobs, tombstones) and SEC-10
 * (Settings > Subscription: after cancelling; the banner across the app) from the database's JSON
 * (public.retention_deletion_overview, public.firm_subscription's continuity,
 * public.subscription_continuity). Dates in the firm's timezone. Nothing here invents a period:
 * the retention period is the firm's own setting and is labelled so.
 */
import { longDate } from "@/modules/sheet/matter-present";
import { publishedOn } from "@/modules/portal-policies/present";

// ---------------------------------------------------------------------------
// SEC-07
// ---------------------------------------------------------------------------

export type EligibleMatter = {
  matterId: string;
  reference: string;
  title: string;
  isSample: boolean;
  closedOn: string | null;
  retentionOn: string;
  retentionYears: number | null;
  policyVersion: number | null;
};

export type DeletionJob = {
  id: string;
  reference: string;
  status: "approved" | "running" | "blocked" | "failed";
  approvedAt: string;
  approvedBy: string;
  itemCount: number;
  pending: number;
  blockedReason: string | null;
  failureReason: string | null;
};

export type Tombstone = {
  id: string;
  reference: string;
  completedAt: string;
  approvedAt: string;
  approvedBy: string;
  policyVersion: number | null;
  retentionYears: number | null;
  retentionOn: string | null;
  removed: Record<string, number>;
  kept: { kind: string; reason: string; count: number }[];
};

export type DeletionOverview = { today: string | null; eligible: EligibleMatter[]; held: number; jobs: DeletionJob[]; tombstones: Tombstone[] };

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function int(value: unknown): number | null {
  const n = Number(value);
  return value != null && Number.isInteger(n) ? n : null;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(obj).filter((row): row is Record<string, unknown> => Boolean(row)) : [];
}

const JOB_STATUSES = new Set(["approved", "running", "blocked", "failed"]);

/** Reads public.retention_deletion_overview; null when it isn't the expected shape. */
export function readDeletionOverview(value: unknown): DeletionOverview | null {
  const row = obj(value);
  if (!row || !Array.isArray(row.eligible) || !Array.isArray(row.jobs) || !Array.isArray(row.tombstones)) return null;
  return {
    today: str(row.today),
    held: int(row.held) ?? 0,
    eligible: rows(row.eligible)
      .filter((item) => str(item.matter_id) && str(item.retention_on))
      .map((item) => ({
        matterId: item.matter_id as string,
        reference: str(item.reference) ?? "Matter",
        title: str(item.title) ?? "",
        isSample: item.is_sample === true,
        closedOn: str(item.closed_on),
        retentionOn: item.retention_on as string,
        retentionYears: int(item.retention_years),
        policyVersion: int(item.policy_version),
      })),
    jobs: rows(row.jobs)
      .filter((item) => str(item.id) && JOB_STATUSES.has(String(item.status)))
      .map((item) => ({
        id: item.id as string,
        reference: str(item.reference) ?? "Matter",
        status: item.status as DeletionJob["status"],
        approvedAt: str(item.approved_at) ?? "",
        approvedBy: str(item.approved_by) ?? "",
        itemCount: int(item.item_count) ?? 0,
        pending: int(item.pending) ?? 0,
        blockedReason: str(item.blocked_reason),
        failureReason: str(item.failure_reason),
      })),
    tombstones: rows(row.tombstones)
      .filter((item) => str(item.id) && str(item.completed_at))
      .map((item) => {
        const removed: Record<string, number> = {};
        for (const [kind, count] of Object.entries(obj(item.removed) ?? {})) {
          const n = int(count);
          if (n !== null) removed[kind] = n;
        }
        return {
          id: item.id as string,
          reference: str(item.reference) ?? "Matter",
          completedAt: item.completed_at as string,
          approvedAt: str(item.approved_at) ?? (item.completed_at as string),
          approvedBy: str(item.approved_by) ?? "",
          policyVersion: int(item.policy_version),
          retentionYears: int(item.retention_years),
          retentionOn: str(item.retention_on),
          removed,
          kept: rows(item.kept).map((kept) => ({ kind: str(kept.kind) ?? "", reason: str(kept.reason) ?? "", count: int(kept.count) ?? 0 })),
        };
      }),
  };
}

const REMOVED_LABEL: Record<string, [string, string]> = {
  document_file: ["stored file", "stored files"],
  inbox_file: ["filed email attachment", "filed email attachments"],
  export_file: ["client-file export", "client-file exports"],
  vo_reading: ["Vo document reading", "Vo document readings"],
  vo_draft: ["unsent Vo draft", "unsent Vo drafts"],
};

function plural(n: number, [one, many]: [string, string]): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 stored files, 1 client-file export, 1 Vo document reading removed", or "Nothing was stored". */
export function removedText(removed: Record<string, number>): string {
  const parts = Object.entries(REMOVED_LABEL)
    .map(([kind, label]) => (removed[kind] ? plural(removed[kind], label) : null))
    .filter((part): part is string => Boolean(part));
  return parts.length ? `${parts.join(", ")} removed` : "Nothing was stored, so nothing was removed";
}

/** "Policy R-2: 7 years, set by the firm", or a plain line when the closure had no version. */
export function policyText(version: number | null, years: number | null): string {
  const period = years ? `${years} ${years === 1 ? "year" : "years"}, set by the firm` : "set by the firm";
  return version ? `Policy R-${version}: ${period}` : `Firm retention period: ${period}`;
}

export type EligibleRow = { matterId: string; matter: string; closed: string; ended: string; policy: string; sample: boolean };
export type JobRow = { id: string; matter: string; badge: { tone: "blue" | "chg" | "bad"; label: string }; detail: string };
export type TombstoneRow = { id: string; matter: string; when: string; who: string; policy: string; removed: string; kept: string | null };

export type RetentionDeletionData = {
  organizationId: string;
  eligible: EligibleRow[];
  heldNote: string | null;
  jobs: JobRow[];
  tombstones: TombstoneRow[];
};

export function retentionDeletionData(overview: DeletionOverview, input: { organizationId: string; timeZone: string; names: Map<string, string> }): RetentionDeletionData {
  const on = (iso: string) => publishedOn(iso, input.timeZone);
  const name = (id: string) => input.names.get(id) ?? "the firm owner";
  return {
    organizationId: input.organizationId,
    eligible: overview.eligible.map((item) => ({
      matterId: item.matterId,
      matter: item.title ? `${item.reference} · ${item.title}` : item.reference,
      closed: item.closedOn ? longDate(item.closedOn) : "—",
      ended: longDate(item.retentionOn),
      policy: policyText(item.policyVersion, item.retentionYears),
      sample: item.isSample,
    })),
    heldNote:
      overview.held > 0
        ? `${overview.held} ${overview.held === 1 ? "matter is" : "matters are"} past the retention end but under a legal hold, so not listed. Release the hold first if the records may go.`
        : null,
    jobs: overview.jobs.map((job) => {
      const approved = `Approved by ${name(job.approvedBy)} on ${on(job.approvedAt)}`;
      if (job.status === "blocked") return { id: job.id, matter: job.reference, badge: { tone: "bad", label: "Stopped" }, detail: `${approved}. ${job.blockedReason ?? "Stopped."} Nothing more is removed; approve again once it is eligible.` };
      if (job.status === "failed") return { id: job.id, matter: job.reference, badge: { tone: "bad", label: "Failed" }, detail: `${approved}. ${job.failureReason ?? "It failed."}` };
      const done = Math.max(0, job.itemCount - job.pending);
      const progress = job.status === "running" ? `${done} of ${job.itemCount} items done` : "Waiting for the deletion runner";
      return { id: job.id, matter: job.reference, badge: { tone: job.status === "running" ? "chg" : "blue", label: job.status === "running" ? "Removing" : "Approved" }, detail: `${approved}. ${progress}.` };
    }),
    tombstones: overview.tombstones.map((tomb) => ({
      id: tomb.id,
      matter: tomb.reference,
      when: `Deleted ${on(tomb.completedAt)}`,
      who: `Approved by ${name(tomb.approvedBy)} on ${on(tomb.approvedAt)}`,
      policy: `${policyText(tomb.policyVersion, tomb.retentionYears)}${tomb.retentionOn ? `, ended ${longDate(tomb.retentionOn)}` : ""}`,
      removed: removedText(tomb.removed),
      kept: tomb.kept.length ? `Kept: ${tomb.kept.map((kept) => `${kept.count} (${kept.reason.replace(/\.$/, "")})`).join("; ")}.` : null,
    })),
  };
}

/** The database's refusals for Approve deletion, in plain words; null for access refusals. */
export function deletionError(message: string): string | null {
  if (/legal hold/i.test(message)) return "This matter is under a legal hold. Nothing can be deleted while it is.";
  if (/retention period has not ended/i.test(message)) return "This matter’s retention period hasn’t ended yet.";
  if (/not closed/i.test(message)) return "Only a closed matter’s files can be deleted.";
  if (/already deleted/i.test(message)) return "This matter’s files were already deleted.";
  if (/already waiting/i.test(message)) return "A deletion of this matter is already waiting to run.";
  if (/at least 10 characters/i.test(message)) return "Give a reason of at least 10 characters.";
  return null;
}

// ---------------------------------------------------------------------------
// SEC-10
// ---------------------------------------------------------------------------

export type ContinuityPhase = "none" | "ending" | "window" | "archived";

export type Continuity = {
  phase: ContinuityPhase;
  periodEnd: string | null;
  cancelledAt: string | null;
  archivedAt: string | null;
  windowDays: number;
  windowEndsAt: string | null;
  arrangement: "custodial_archive" | "transfer" | null;
  transfer: { id: string; receivingFirm: string; status: string; verified: boolean } | null;
  coverage: { since: string | null; matters: number; covered: number; nextMatterId: string | null; nextReference: string | null } | null;
};

const PHASES = new Set(["none", "ending", "window", "archived"]);

/** Reads the continuity JSON; null when it isn't the expected shape. */
export function readContinuity(value: unknown): Continuity | null {
  const row = obj(value);
  if (!row || !PHASES.has(String(row.phase))) return null;
  const transfer = obj(row.transfer);
  const coverage = obj(row.coverage);
  const arrangement = row.arrangement === "custodial_archive" || row.arrangement === "transfer" ? row.arrangement : null;
  return {
    phase: row.phase as ContinuityPhase,
    periodEnd: str(row.period_end),
    cancelledAt: str(row.cancelled_at),
    archivedAt: str(row.archived_at),
    windowDays: Math.max(90, int(row.window_days) ?? 90),
    windowEndsAt: str(row.window_ends_at),
    arrangement,
    transfer:
      transfer && str(transfer.id)
        ? { id: transfer.id as string, receivingFirm: str(transfer.receiving_firm) ?? "another firm", status: str(transfer.status) ?? "open", verified: transfer.verified === true }
        : null,
    coverage: coverage
      ? {
          since: str(coverage.since),
          matters: int(coverage.matters) ?? 0,
          covered: int(coverage.covered) ?? 0,
          nextMatterId: str(coverage.next_matter_id),
          nextReference: str(coverage.next_reference),
        }
      : null,
  };
}

function afterWindow(c: Continuity): string {
  if (c.arrangement === "transfer" && c.transfer) {
    return c.transfer.verified
      ? `the matters go to ${c.transfer.receivingFirm} under the completed transfer`
      : `the matters go to ${c.transfer.receivingFirm} if that transfer is completed by then, otherwise into Casevoya’s custodial archive`;
  }
  return "your records stay in Casevoya’s custodial archive, read-only";
}

export type ContinuityBannerData = { tone: "warn" | "info"; title: string; body: string; href: string | null };

/** The banner across the app for every staff member, or null when nothing is ending. */
export function continuityBanner(c: Continuity | null, timeZone: string, canOpenSubscription: boolean): ContinuityBannerData | null {
  if (!c || c.phase === "none") return null;
  const on = (iso: string | null) => (iso ? publishedOn(iso, timeZone) : "—");
  const href = canOpenSubscription ? "/sheet/settings?tab=billing" : null;
  if (c.phase === "ending") {
    return {
      tone: "warn",
      title: `The subscription ends on ${on(c.periodEnd)}`,
      body: ` After that, new matters and invitations stop. Everyone keeps read-only access, and client files can be exported until at least ${on(c.windowEndsAt)}. Nothing is deleted.`,
      href,
    };
  }
  if (c.phase === "window") {
    return {
      tone: "warn",
      title: `Export window: until ${on(c.windowEndsAt)}`,
      body: ` The subscription ended${c.cancelledAt ? ` on ${on(c.periodEnd ?? c.cancelledAt)}` : ""}, so new matters and invitations are stopped. Export your client files before then; after it, ${afterWindow(c)}. Nothing is deleted.`,
      href,
    };
  }
  return {
    tone: "info",
    title: "This firm is archived",
    body: ` ${c.arrangement === "transfer" && c.transfer ? `Matters were transferred to ${c.transfer.receivingFirm}; the` : "The"} records here are kept read-only under each matter’s retention. Nothing was deleted. Choose a plan to carry on.`,
    href,
  };
}

export type ContinuityPanelData = {
  organizationId: string;
  rows: [string, string][];
  /** Firm owner only. */
  exportNext: { href: string; label: string } | null;
  canIndex: boolean;
  canChoose: boolean;
  dialog: EndArrangementDialogData | null;
};

export type EndArrangementDialogData = {
  organizationId: string;
  current: "custodial_archive" | "transfer";
  transferId: string | null;
  transfers: { id: string; label: string }[];
};

/** Settings > Subscription, "After cancelling": shown once the subscription is ending, in its window or archived. */
export function continuityPanel(
  c: Continuity | null,
  input: { organizationId: string; timeZone: string; isOwner: boolean; transfers: { id: string; receivingFirm: string; status: string }[] },
): ContinuityPanelData | null {
  if (!c || c.phase === "none") return null;
  const on = (iso: string | null) => (iso ? publishedOn(iso, input.timeZone) : "—");
  const rows: [string, string][] = [];
  rows.push(["Paid period ends", c.phase === "ending" ? `${on(c.periodEnd)} (from Stripe)` : `Ended ${on(c.periodEnd ?? c.cancelledAt)}`]);
  rows.push(["New work", c.phase === "ending" ? `Stops on ${on(c.periodEnd)}: no new matters, staff or client invitations.` : "Stopped: no new matters, staff or client invitations."]);
  rows.push(["Read access", "Continues for everyone at the firm, read-only, for as long as the records are kept."]);
  if (c.phase !== "archived") rows.push(["Export window", `At least ${c.windowDays} days: until ${on(c.windowEndsAt)}`]);
  if (c.coverage) {
    const since = c.coverage.since ? ` since ${on(c.coverage.since)}` : "";
    rows.push([
      "Full firm export",
      c.coverage.matters === 0
        ? "No real matters to export."
        : `${c.coverage.covered} of ${c.coverage.matters} matters have a client-file export${since}.${c.coverage.covered < c.coverage.matters ? " Export each one, then download the firm index." : " Download the firm index to keep with them."}`,
    ]);
  }
  const arrangement =
    c.phase === "archived"
      ? c.arrangement === "transfer" && c.transfer
        ? `Transferred to ${c.transfer.receivingFirm} (completed transfer).`
        : "Custodial archive: Casevoya keeps the records read-only under each matter’s retention."
      : c.arrangement === "transfer" && c.transfer
        ? `Transfer to ${c.transfer.receivingFirm}: ${c.transfer.verified ? "completed." : "not completed yet. If it isn’t completed by the end of the window, the records go into the custodial archive."}`
        : "Custodial archive (unless you choose a transfer): Casevoya keeps the records read-only under each matter’s retention.";
  rows.push([c.phase === "archived" ? "Now" : "After the window", arrangement]);
  rows.push(["Deletion", "None. Cancelling never deletes records; a matter’s files are deleted only by an approved deletion job after its own retention end."]);

  const next = c.coverage?.nextMatterId && input.isOwner && c.phase !== "archived" ? { href: `/sheet/exports?view=${c.coverage.nextMatterId}`, label: `Export next matter${c.coverage.nextReference ? ` (${c.coverage.nextReference})` : ""}` } : null;
  const canChoose = input.isOwner && c.phase !== "archived";
  const open = input.transfers.filter((transfer) => transfer.status !== "cancelled");
  return {
    organizationId: input.organizationId,
    rows,
    exportNext: next,
    canIndex: input.isOwner,
    canChoose,
    dialog: canChoose
      ? {
          organizationId: input.organizationId,
          current: c.arrangement === "transfer" && c.transfer ? "transfer" : "custodial_archive",
          transferId: c.transfer?.id ?? null,
          transfers: open.map((transfer) => ({ id: transfer.id, label: `${transfer.receivingFirm} (${transfer.status === "completed" ? "completed" : "open"})` })),
        }
      : null,
  };
}

export type CancelDialogData = { organizationId: string; periodEnd: string; windowEnd: string; windowDays: number };

/** The Cancel subscription dialog's dates: the paid period's end from Stripe and the earliest window end. */
export function cancelDialog(input: { organizationId: string; periodEnd: string | null; windowDays: number; timeZone: string }): CancelDialogData {
  const days = Math.max(90, input.windowDays);
  const end = input.periodEnd ? publishedOn(input.periodEnd, input.timeZone) : "the end of the paid period";
  const windowEnd = input.periodEnd ? publishedOn(new Date(new Date(input.periodEnd).getTime() + days * 86_400_000).toISOString(), input.timeZone) : `${days} days after that`;
  return { organizationId: input.organizationId, periodEnd: end, windowEnd, windowDays: days };
}

/** The database's refusals for the SEC-10 actions, in plain words; null for access refusals. */
export function continuityError(message: string): string | null {
  if (/no paid subscription to cancel/i.test(message)) return "There is no paid subscription to cancel.";
  if (/already ends at the period end/i.test(message)) return "The subscription already ends at the end of the paid period.";
  if (/once the subscription is cancelled/i.test(message)) return "Choose this after cancelling the subscription.";
  if (/open or completed firm transfer/i.test(message)) return "Choose one of the firm’s open or completed transfers.";
  return null;
}
