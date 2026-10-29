/**
 * MIG-03: how imported opening balances are grouped for Finance, and how a row is compared
 * with the source file. Pure. Amounts stay in cents.
 */

export type OpeningBalanceKind = "receivable" | "advance";
export type OpeningBalanceStatus = "pending_review" | "approved" | "rejected";

export type OpeningBalanceCorrection = {
  reason: string;
  beforeAmountCents: number;
  afterAmountCents: number;
  beforeKind: string;
  afterKind: string;
  createdAt: string;
};

export type OpeningBalanceRow = {
  id: string;
  matterId: string;
  matterTitle: string;
  clientName: string;
  kind: OpeningBalanceKind;
  amountCents: number;
  currency: string;
  asOf: string;
  description: string | null;
  sourceKind: OpeningBalanceKind;
  sourceAmountCents: number;
  sourceCurrency: string;
  sourceAsOf: string;
  status: OpeningBalanceStatus;
  reviewNote: string | null;
  version: number;
  batchId: string;
  fileName: string;
  fileSha256: string;
  fileRowCount: number;
  sourceSystem: string;
  createdAt: string;
  importedBySelf: boolean;
  corrections: OpeningBalanceCorrection[];
};

export type OpeningBalanceTotal = {
  currency: string;
  kind: OpeningBalanceKind;
  sourceCents: number;
  currentCents: number;
  mismatch: boolean;
};

export type OpeningBalanceGroup = {
  clientName: string;
  matterId: string;
  matterTitle: string;
  rows: OpeningBalanceRow[];
};

export type OpeningBalanceFile = {
  batchId: string;
  fileName: string;
  fileSha256: string;
  fileRowCount: number;
  importedCount: number;
  /** The file's row count and the number of balances imported from it differ. */
  countMismatch: boolean;
  totals: OpeningBalanceTotal[];
  groups: OpeningBalanceGroup[];
};

const KINDS = new Set<OpeningBalanceKind>(["receivable", "advance"]);
const STATUSES = new Set<OpeningBalanceStatus>(["pending_review", "approved", "rejected"]);

export function kindLabel(kind: OpeningBalanceKind): string {
  return kind === "receivable" ? "Receivable" : "Advance";
}

export function statusLabel(status: OpeningBalanceStatus): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Awaiting review";
}

/** True when the balance no longer matches the source file, including a rejection. */
export function mismatchesSource(row: OpeningBalanceRow): boolean {
  return (
    row.status === "rejected" ||
    row.amountCents !== row.sourceAmountCents ||
    row.kind !== row.sourceKind ||
    row.currency !== row.sourceCurrency ||
    row.asOf.slice(0, 10) !== row.sourceAsOf.slice(0, 10)
  );
}

export function isLocked(row: OpeningBalanceRow): boolean {
  return row.status !== "pending_review";
}

function asKind(value: unknown): OpeningBalanceKind | null {
  return typeof value === "string" && KINDS.has(value as OpeningBalanceKind) ? (value as OpeningBalanceKind) : null;
}

function asStatus(value: unknown): OpeningBalanceStatus | null {
  return typeof value === "string" && STATUSES.has(value as OpeningBalanceStatus) ? (value as OpeningBalanceStatus) : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Reads the review payload. A row that is missing a required field is left out. */
export function readOpeningBalanceRows(data: unknown): OpeningBalanceRow[] {
  const root = asRecord(data);
  const list = Array.isArray(root?.rows) ? root.rows : Array.isArray(data) ? data : [];
  const rows: OpeningBalanceRow[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const kind = asKind(row.kind);
    const sourceKind = asKind(row.source_kind);
    const status = asStatus(row.status);
    const amount = asNumber(row.amount_cents);
    const sourceAmount = asNumber(row.source_amount_cents);
    const version = asNumber(row.version);
    const fileRowCount = asNumber(row.file_row_count);
    if (!kind || !sourceKind || !status || amount == null || sourceAmount == null || version == null || fileRowCount == null) continue;
    if (typeof row.id !== "string" || typeof row.matter_id !== "string" || typeof row.batch_id !== "string") continue;
    const corrections: OpeningBalanceCorrection[] = [];
    if (Array.isArray(row.corrections)) {
      for (const entry of row.corrections) {
        const correction = asRecord(entry);
        const before = correction ? asNumber(correction.before_amount_cents) : null;
        const after = correction ? asNumber(correction.after_amount_cents) : null;
        if (!correction || typeof correction.reason !== "string" || before == null || after == null) continue;
        corrections.push({
          reason: correction.reason,
          beforeAmountCents: before,
          afterAmountCents: after,
          beforeKind: typeof correction.before_kind === "string" ? correction.before_kind : kind,
          afterKind: typeof correction.after_kind === "string" ? correction.after_kind : kind,
          createdAt: typeof correction.created_at === "string" ? correction.created_at : "",
        });
      }
    }
    rows.push({
      id: row.id,
      matterId: row.matter_id,
      matterTitle: typeof row.matter_title === "string" && row.matter_title ? row.matter_title : "Matter",
      clientName: typeof row.client_name === "string" && row.client_name ? row.client_name : "No applicant on the matter",
      kind,
      amountCents: amount,
      currency: typeof row.currency === "string" ? row.currency : "CAD",
      asOf: typeof row.as_of === "string" ? row.as_of.slice(0, 10) : "",
      description: typeof row.description === "string" ? row.description : null,
      sourceKind,
      sourceAmountCents: sourceAmount,
      sourceCurrency: typeof row.source_currency === "string" ? row.source_currency : "CAD",
      sourceAsOf: typeof row.source_as_of === "string" ? row.source_as_of.slice(0, 10) : "",
      status,
      reviewNote: typeof row.review_note === "string" ? row.review_note : null,
      version,
      batchId: row.batch_id,
      fileName: typeof row.file_name === "string" ? row.file_name : "Source file",
      fileSha256: typeof row.file_sha256 === "string" ? row.file_sha256 : "",
      fileRowCount,
      sourceSystem: typeof row.source_system === "string" ? row.source_system : "the source file",
      createdAt: typeof row.created_at === "string" ? row.created_at : "",
      importedBySelf: row.imported_by_self === true,
      corrections,
    });
  }
  return rows;
}

function add(map: Map<string, OpeningBalanceTotal>, currency: string, kind: OpeningBalanceKind, source: number, current: number) {
  const key = `${currency}:${kind}`;
  const found = map.get(key) ?? { currency, kind, sourceCents: 0, currentCents: 0, mismatch: false };
  found.sourceCents += source;
  found.currentCents += current;
  found.mismatch = found.sourceCents !== found.currentCents;
  map.set(key, found);
}

/** Groups balances by source file, then by client and matter, with source and current totals. */
export function groupOpeningBalances(rows: readonly OpeningBalanceRow[]): OpeningBalanceFile[] {
  const files = new Map<string, OpeningBalanceRow[]>();
  for (const row of rows) {
    const list = files.get(row.batchId) ?? [];
    list.push(row);
    files.set(row.batchId, list);
  }
  return [...files.entries()].map(([batchId, fileRows]) => {
    const first = fileRows[0];
    const totals = new Map<string, OpeningBalanceTotal>();
    for (const row of fileRows) {
      add(totals, row.sourceCurrency, row.sourceKind, row.sourceAmountCents, 0);
      if (row.status !== "rejected") add(totals, row.currency, row.kind, 0, row.amountCents);
    }
    const groups = new Map<string, OpeningBalanceGroup>();
    for (const row of fileRows) {
      const key = `${row.clientName}\n${row.matterId}`;
      const group = groups.get(key) ?? { clientName: row.clientName, matterId: row.matterId, matterTitle: row.matterTitle, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
    return {
      batchId,
      fileName: first.fileName,
      fileSha256: first.fileSha256,
      fileRowCount: first.fileRowCount,
      importedCount: fileRows.length,
      countMismatch: fileRows.length !== first.fileRowCount,
      totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.kind.localeCompare(b.kind)),
      groups: [...groups.values()].sort((a, b) => a.clientName.localeCompare(b.clientName) || a.matterTitle.localeCompare(b.matterTitle)),
    };
  });
}

export function openingBalanceError(message: string): string {
  if (/step-up is required/i.test(message)) return "Confirm it’s you with your authenticator, then try again.";
  if (/already reviewed|is locked/i.test(message)) return "That opening balance is locked. Reload the page.";
  if (/a reason is required/i.test(message)) return "Write a reason of at least 3 characters.";
  if (/billing access denied/i.test(message)) return "Only the firm owner and finance staff can review opening balances.";
  if (/conflict/i.test(message)) return "Someone else changed this balance. Reload the page.";
  if (/nothing is different/i.test(message)) return "Change the amount, kind, currency, date or description before saving.";
  if (/importer cannot review/i.test(message)) return "You imported this balance, so someone else approves it.";
  return "That didn’t work. Reload the page and try again.";
}
