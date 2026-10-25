import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetMigration } from "@/components/sheet/designer/migration";
import { runReportFile, runReportLines, type RunReport } from "@/modules/migration/report";
import {
  hiddenValue,
  isMigrationKind,
  KIND_FIELDS,
  kindLabel,
  maskProblem,
  migrationError,
  MIGRATION_KINDS,
  money,
  planCounts,
  readSensitivity,
  suggestKindColumns,
  suggestKindValue,
  suggestSensitivity,
} from "@/modules/sheet/migration-present";
import { cleanZipPath, describeZip, zipFileBytes } from "@/modules/migration/zip";

/** MIG-01: the import kinds' words, suggestions, sensitivity masking, the ZIP reader and the live page parts. Synthetic data only. */

describe("import kinds and mapping suggestions", () => {
  it("lists every kind the database accepts, clients first", () => {
    expect(MIGRATION_KINDS.map((entry) => entry.kind)).toEqual(["clients_matters", "relationships", "notes", "tasks", "key_dates", "documents", "opening_balances"]);
    expect(isMigrationKind("tasks")).toBe(true);
    expect(isMigrationKind("gifts")).toBe(false);
    expect(kindLabel("documents")).toBe("Documents");
    expect(kindLabel("opening_balances")).toBe("Financial opening balances");
  });

  it("suggests each kind's columns by heading, each column once", () => {
    expect(suggestKindColumns("tasks", ["Matter", "Task", "Due", "Assigned to", "Status"])).toEqual({ reference: 0, title: 1, due_on: 2, assignee: 3, status: 4 });
    expect(suggestKindColumns("opening_balances", ["File #", "Type", "Balance", "As of"])).toEqual({ reference: 0, balance_kind: 1, amount: 2, as_of: 3 });
    expect(suggestKindColumns("documents", ["Filename", "Client email", "Matter", "Document type"])).toEqual({ file: 0, person: 1, reference: 2, document_type: 3 });
    // Every kind requires at least one field, and the field keys match the database's (app.migration_kind_columns).
    expect(KIND_FIELDS.notes.map((field) => field.field)).toEqual(["reference", "person", "person_birth", "body", "author", "written_on"]);
  });

  it("maps a source value only when it is the value's exact word or label", () => {
    expect(suggestKindValue("status", "done")).toBe("done");
    expect(suggestKindValue("status", "completed")).toBeNull();
    expect(suggestKindValue("relationship", "spouse")).toBe("spouse");
    expect(suggestKindValue("balance_kind", "receivable")).toBe("receivable");
    expect(suggestKindValue("balance_kind", "none")).toBeNull();
    expect(suggestKindValue("date_kind", "legal deadline")).toBe("legal");
  });
});

describe("sensitivity classification", () => {
  it("suggests classes from headings, and reads only valid saved classes", () => {
    expect(suggestSensitivity(["Name", "Passport #", "Medical history", "Refusal reasons", "Amount owing", "UCI"])).toEqual({
      "1": "identity",
      "2": "health",
      "3": "narrative",
      "4": "financial",
      "5": "identity",
    });
    expect(readSensitivity({ "1": "identity", x: "health", "2": "secret" })).toEqual({ "1": "identity" });
  });

  it("never echoes a sensitive value: its class shows instead, and quoted values leave row problems", () => {
    expect(hiddenValue("identity")).toBe("Hidden · identity number");
    expect(maskProblem("“X0000000” isn’t a real date", true)).toBe("This value isn’t a real date");
    expect(maskProblem("“X0000000” isn’t a real date", false)).toBe("“X0000000” isn’t a real date");
    expect(money(125050, "CAD")).toBe("$1,250.50 CAD");
  });

  it("reads ready counts for every kind and words each new refusal without passing the database text through", () => {
    expect(planCounts({ matters: 3 })?.ready).toBe(3);
    expect(planCounts({ matters: 3, ready: 4 })?.ready).toBe(4);
    expect(migrationError("map a column to each required field (title)")).toBe("Map a column to each required field: task title.");
    expect(migrationError("add the ZIP of files first")).toBe("Add the ZIP of files first.");
    expect(migrationError("migration row 4: the stored file doesn't match the ZIP")).toMatch(/couldn’t be stored as the preview showed/);
    expect(migrationError("this opening balance was already reviewed")).toBe("That opening balance was already reviewed. Reload the page.");
  });
});

/** A ZIP built in the test: synthetic entries, stored or deflated. */
function makeZip(entries: { name: string; data: Uint8Array; deflate?: boolean; encrypted?: boolean }[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const body = entry.deflate ? deflateRawSync(entry.data) : Buffer.from(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.encrypted ? 1 : 0, 6);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.encrypted ? 1 : 0, 8);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const PDF = new TextEncoder().encode("%PDF-1.7\nsynthetic test file\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe("reading a documents import's ZIP", () => {
  it("lists each file with its size, SHA-256 and real type, skipping folders and macOS files", () => {
    const zip = makeZip([
      { name: "scans/", data: new Uint8Array(0) },
      { name: "scans/passport.pdf", data: PDF, deflate: true },
      { name: "__MACOSX/scans/._passport.pdf", data: PDF },
      { name: "photo.pdf", data: PNG },
      { name: "secret.pdf", data: PDF, encrypted: true },
      { name: "../escape.pdf", data: PDF },
    ]);
    const read = describeZip(zip);
    if ("error" in read) throw new Error(read.error);
    expect(read.sha256).toBe(createHash("sha256").update(zip).digest("hex"));
    expect(read.files).toEqual([
      { path: "scans/passport.pdf", base_name: "passport.pdf", byte_size: PDF.length, sha256: createHash("sha256").update(PDF).digest("hex"), media_type: "application/pdf", problem: null },
      { path: "photo.pdf", base_name: "photo.pdf", byte_size: PNG.length, sha256: createHash("sha256").update(PNG).digest("hex"), media_type: "image/png", problem: null },
      { path: "secret.pdf", base_name: "secret.pdf", byte_size: PDF.length, sha256: null, media_type: null, problem: "The file is encrypted in the ZIP" },
      { path: "../escape.pdf", base_name: "escape.pdf", byte_size: PDF.length, sha256: null, media_type: null, problem: "The file’s path in the ZIP isn’t allowed" },
    ]);
    // At sign-off a file is read again and must hash the same.
    const sha = createHash("sha256").update(PDF).digest("hex");
    expect(zipFileBytes(zip, "scans/passport.pdf", sha)).toEqual(PDF);
    expect(zipFileBytes(zip, "scans/passport.pdf", "0".repeat(64))).toBeNull();
    expect(zipFileBytes(zip, "missing.pdf", sha)).toBeNull();
  });

  it("refuses what isn't a ZIP, a duplicate name, and unsafe paths", () => {
    expect(describeZip(PDF)).toEqual({ error: "That isn’t a ZIP file." });
    expect(describeZip(makeZip([{ name: "a.pdf", data: PDF }, { name: "a.pdf", data: PDF }]))).toEqual({ error: "The ZIP names one file twice." });
    expect(cleanZipPath("/etc/passwd")).toBeNull();
    expect(cleanZipPath("C:/files/a.pdf")).toBeNull();
    expect(cleanZipPath("folder\\a.pdf")).toBe("folder/a.pdf");
  });
});

describe("the live page's MIG-01 parts", () => {
  it("offers the kind picker and a hidden ZIP input on the upload empty state", () => {
    const html = renderToStaticMarkup(
      createElement(SheetMigration, {
        data: {
          tab: "map",
          upload: {
            attrs: { "data-mig-act": "upload", "data-org": "o1" },
            kinds: { attrs: { "data-mig-kind": "1" }, value: "clients_matters", options: [["clients_matters", "Clients and matters"], ["tasks", "Tasks"]] },
            copy: "Choose what the file holds.",
          },
        },
      }),
    );
    expect(html).toContain('<label for="migK">What’s in the file</label><select class="sel" id="migK" data-mig-kind="1">');
    expect(html).toContain('<button class="btn p sm" data-mig-act="upload" data-org="o1">Choose a CSV file</button>');
    expect(html).toContain('data-mig-zip="1"');
    expect(html).toContain("Choose what the file holds.");
  });

  it("shows the Sensitive columns table, kind headings on Preview, and opening balances with review buttons", () => {
    const map = renderToStaticMarkup(
      createElement(SheetMigration, {
        data: {
          tab: "map",
          map: {
            rows: [{ column: "Passport #", sample: "Hidden · identity number", field: null, check: "Not imported" }],
            next: { attrs: { "data-mig-act": "map" } },
            settings: { dateOrder: { attrs: { "data-mig-date": "1" }, value: "ymd", options: [["ymd", "Year first"]] }, owner: { attrs: { "data-mig-owner": "1" }, value: "", options: [["", "Choose…"]] } },
            sensitivity: [{ column: "Passport #", select: { attrs: { "data-mig-sens": "0" }, value: "identity", options: [["", "Not sensitive"], ["identity", "Identity number"]] } }],
          },
        },
      }),
    );
    expect(map).toContain("Hidden · identity number");
    expect(map).toContain('aria-label="Sensitive columns"');
    expect(map).toContain('data-mig-sens="0"');
    expect(map).toContain("Assignee when a row names none");
    expect(map).not.toContain("Responsible consultant when a row names none");

    const preview = renderToStaticMarkup(
      createElement(SheetMigration, {
        data: { tab: "preview", preview: { rows: [{ row: "2", person: "Synthetic task", birth: "2026-11-02", matter: "SYN-1", result: { tone: "ok", label: "New record" } }], heads: ["Task", "Due", "Matter"] } },
      }),
    );
    expect(preview).toContain('<th scope="col">Task</th><th scope="col">Due</th><th scope="col">Matter</th>');

    const signoff = renderToStaticMarkup(
      createElement(SheetMigration, {
        data: {
          tab: "signoff",
          signoff: {
            summary: [{ term: "Kind", value: "Financial opening balances" }],
            action: null,
            balances: [
              {
                key: "b1",
                matter: "SYN-1",
                kind: "Receivable (the client owes it)",
                amount: "$1,250.50 CAD",
                asOf: "2026-09-30",
                state: { tone: "chg", label: "Pending review" },
                actions: [{ label: "Approve", attrs: { "data-mig-act": "review-balance", "data-id": "b1", "data-approve": "1" } }],
              },
            ],
          },
        },
      }),
    );
    expect(signoff).toContain('aria-label="Opening balances"');
    expect(signoff).toContain("$1,250.50 CAD");
    expect(signoff).toContain('data-mig-act="review-balance"');
  });
});

describe("MIG-01 kinds in MIG-02's run report", () => {
  const report: RunReport = {
    generated_at: "2026-10-25T18:00:00Z",
    kind: "documents",
    source: { file_name: "synthetic-manifest.csv", rows_in_file: 4, rows_staged: 4, sha256: "a".repeat(64), checksum_matches: true },
    records: { documents: { created: 2, linked: 0 } },
    totals: { records_created: 2, records_linked: 0, files_held: 1 },
    rows: { rows: 4, imported: 2, created: 2, linked: 0, duplicates_found: 1, duplicates_same: 1, duplicates_different: 0, review: 0, error: 1, skipped: 0, exception_lines: 2 },
    pilot: { size: 1, counts: { records_created: 1, records_linked: 0 }, signed_off_at: "2026-10-25T17:30:00Z", note: "Synthetic file checked" },
  };

  it("counts records, not matters and people, and lists held files", () => {
    const lines = runReportLines(report, "America/Toronto");
    expect(lines.map((line) => line.term)).toEqual(["Source counts", "Checksum (SHA-256)", "Documents", "Possible duplicates", "Not imported", "Files held", "Pilot"]);
    expect(lines[3].value).toEqual(["1 found", "1 same record, 0 different"]);
    expect(lines[4].value).toEqual(["1 with errors, 0 needing review", "0 skipped"]);
    expect(lines[6].value).toEqual(["1 of 1 records", "signed off 25 Oct 2026, 13:30"]);
    const file = runReportFile({ report, exceptions: [], firm: "Synthetic Firm", timeZone: "America/Toronto", generated: "now", madeBy: "Test Owner", signedOffBy: null });
    expect(file.sections[0].rows[0]).toEqual(["Kind", "Documents"]);
    expect(file.sections.find((section) => section.title === "Pilot and sign-off")?.rows.slice(0, 2)).toEqual([
      ["Pilot size (records)", "1"],
      ["Pilot created", "1 new, 0 kept as existing"],
    ]);
  });
});
