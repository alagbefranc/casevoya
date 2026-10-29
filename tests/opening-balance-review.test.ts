import { describe, expect, it } from "vitest";
import { formatMoney } from "@/modules/finance/money";
import {
  groupOpeningBalances,
  mismatchesSource,
  readOpeningBalanceRows,
  type OpeningBalanceRow,
} from "@/modules/sheet/opening-balance-present";

function row(over: Partial<OpeningBalanceRow> = {}): OpeningBalanceRow {
  return {
    id: "b1",
    matterId: "m1",
    matterTitle: "Synthetic matter",
    clientName: "Synthetic Client",
    kind: "receivable",
    amountCents: 125050,
    currency: "CAD",
    asOf: "2026-09-30",
    description: null,
    sourceKind: "receivable",
    sourceAmountCents: 125050,
    sourceCurrency: "CAD",
    sourceAsOf: "2026-09-30",
    status: "pending_review",
    reviewNote: null,
    version: 1,
    batchId: "file-1",
    fileName: "balances.csv",
    fileSha256: "ab".repeat(32),
    fileRowCount: 2,
    sourceSystem: "spreadsheet",
    createdAt: "2026-10-29T12:00:00Z",
    importedBySelf: false,
    corrections: [],
    ...over,
  };
}

describe("MIG-03 opening balance review", () => {
  it("groups by file, client and matter and flags a file-count mismatch", () => {
    const files = groupOpeningBalances([
      row(),
      row({
        id: "b2",
        matterId: "m2",
        matterTitle: "Second matter",
        clientName: "Other Client",
        kind: "advance",
        amountCents: 40000,
        sourceKind: "advance",
        sourceAmountCents: 40000,
      }),
    ]);
    expect(files).toHaveLength(1);
    expect(files[0].importedCount).toBe(2);
    expect(files[0].fileRowCount).toBe(2);
    expect(files[0].countMismatch).toBe(false);
    expect(files[0].groups.map((group) => group.clientName)).toEqual(["Other Client", "Synthetic Client"]);
    expect(files[0].totals).toEqual([
      { currency: "CAD", kind: "advance", sourceCents: 40000, currentCents: 40000, mismatch: false },
      { currency: "CAD", kind: "receivable", sourceCents: 125050, currentCents: 125050, mismatch: false },
    ]);
    expect(formatMoney(125050, "CAD")).toBe("CAD 1,250.50");
  });

  it("keeps the source total when a balance is corrected or rejected", () => {
    const corrected = row({ amountCents: 100000, corrections: [{ reason: "File had a typo", beforeAmountCents: 125050, afterAmountCents: 100000, beforeKind: "receivable", afterKind: "receivable", createdAt: "2026-10-29" }] });
    const rejected = row({ id: "b2", status: "rejected", kind: "advance", sourceKind: "advance", amountCents: 40000, sourceAmountCents: 40000 });
    expect(mismatchesSource(corrected)).toBe(true);
    expect(mismatchesSource(rejected)).toBe(true);
    expect(mismatchesSource(row())).toBe(false);
    const [file] = groupOpeningBalances([corrected, rejected]);
    expect(file.countMismatch).toBe(false);
    const receivable = file.totals.find((total) => total.kind === "receivable");
    const advance = file.totals.find((total) => total.kind === "advance");
    expect(receivable).toMatchObject({ sourceCents: 125050, currentCents: 100000, mismatch: true });
    expect(advance).toMatchObject({ sourceCents: 40000, currentCents: 0, mismatch: true });
  });

  it("reads the review payload and drops a row that is missing its source amount", () => {
    const rows = readOpeningBalanceRows({
      rows: [
        {
          id: "b1",
          matter_id: "m1",
          matter_title: "Synthetic matter",
          client_name: "Synthetic Client",
          kind: "receivable",
          amount_cents: 100,
          currency: "CAD",
          as_of: "2026-09-30",
          source_kind: "receivable",
          source_amount_cents: "100",
          source_currency: "CAD",
          source_as_of: "2026-09-30",
          status: "pending_review",
          version: 1,
          batch_id: "file-1",
          file_name: "balances.csv",
          file_sha256: "ab",
          file_row_count: 3,
          source_system: "spreadsheet",
          created_at: "2026-10-29",
          corrections: [],
        },
        { id: "broken" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceAmountCents).toBe(100);
    expect(rows[0].fileRowCount).toBe(3);
  });
});
