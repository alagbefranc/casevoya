import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetMigration } from "@/components/sheet/designer/migration";
import { SheetTasks, type TasksData } from "@/components/sheet/designer/tasks";
import { importedLabel, importedLine, readProvenance } from "@/modules/migration/provenance";
import { kindLabel, pilotDefault, pilotState, runReportFile, runReportFilename, runReportLines, type RunReport } from "@/modules/migration/report";
import { importedEvent, importedFacts, importedTask, withImport } from "@/modules/sheet/imported-present";
import { migrationError } from "@/modules/sheet/migration-present";
import { reportCsv } from "@/modules/sheet/reports-export";

/** MIG-02: the pilot's states, the run report's words and file, and imported provenance. Synthetic data only. */

const TZ = "America/Toronto";
const SHA = "a".repeat(64);

const REPORT: RunReport = {
  generated_at: "2026-10-25T18:00:00Z",
  source: {
    file_name: "synthetic-clients.csv",
    source_system: "Synthetic Old CRM",
    bytes: 4096,
    rows_in_file: 6,
    rows_staged: 6,
    sha256: SHA,
    staged_digest: "b".repeat(64),
    verified_at_upload: "2026-10-25T16:00:00Z",
    verified_at_commit: "2026-10-25T17:59:00Z",
    checksum_matches: true,
  },
  records: { matters: { created: 5, linked: 0 }, persons: { created: 5, linked: 0 } },
  totals: { matters: 5, people_created: 5, people_linked: 0 },
  rows: { rows: 6, imported: 5, created: 5, linked: 0, duplicates_found: 1, duplicates_same: 0, duplicates_different: 1, review: 0, error: 1, skipped: 0, exception_lines: 1 },
  pilot: { size: 3, counts: { matters: 3, people_created: 3, people_linked: 0 }, completed_at: "2026-10-25T17:00:00Z", signed_off_at: "2026-10-25T17:30:00Z", note: "Checked the three test matters" },
  full_run_started_at: "2026-10-25T17:59:00Z",
};

describe("MIG-02 pilot state", () => {
  const base = { status: "committing", pilot_size: 3, pilot_completed_at: null, pilot_signed_off_at: null, full_run_started_at: null };
  it("follows the batch from ready to pilot, review, signed and full", () => {
    expect(pilotState({ ...base, status: "checked", pilot_size: null })).toBe("ready");
    expect(pilotState(base)).toBe("pilot");
    expect(pilotState({ ...base, pilot_completed_at: "x" })).toBe("review");
    expect(pilotState({ ...base, pilot_completed_at: "x", pilot_signed_off_at: "y" })).toBe("signed");
    expect(pilotState({ ...base, pilot_completed_at: "x", pilot_signed_off_at: "y", full_run_started_at: "z" })).toBe("full");
    expect(pilotState({ ...base, pilot_size: null })).toBe("legacy");
    expect(pilotState({ ...base, status: "committed" })).toBe("other");
  });

  it("offers 10 matters by default, never more than the firm's maximum or the matters ready", () => {
    expect(pilotDefault(25, 64)).toBe(10);
    expect(pilotDefault(5, 64)).toBe(5);
    expect(pilotDefault(25, 3)).toBe(3);
    expect(pilotDefault(25, 0)).toBe(1);
  });

  it("words the database's pilot refusals plainly", () => {
    expect(migrationError("run a pilot first: the full import waits for the firm owner's sign-off of the pilot")).toBe("Run a pilot first. The full import waits for your sign-off of the pilot.");
    expect(migrationError("the pilot needs the firm owner's sign-off before the full import")).toBe("Sign off the pilot first. The full import waits for it.");
    expect(migrationError("a pilot is 1 to 25 matters")).toBe("A pilot is 1 to 25 matters.");
    expect(migrationError("add a note of 3 to 1,000 characters")).toMatch(/^Add a note of 3 to 1,000 characters/);
    expect(migrationError("the pilot is not finished yet")).toBe("The pilot isn’t finished yet. Continue it first.");
  });
});

describe("MIG-02 run report", () => {
  it("shows source counts, the checksum, totals by kind, duplicates, exceptions and the pilot", () => {
    const lines = runReportLines(REPORT, TZ);
    expect(lines.map((line) => line.term)).toEqual(["Source counts", "Checksum (SHA-256)", "Matters", "People", "Possible duplicates", "Not imported", "Pilot"]);
    expect(lines[0].value).toEqual(["6 rows in the file", "6 staged"]);
    expect(lines[1].value).toEqual([SHA, "rows matched it at upload and at commit"]);
    expect(lines[2].value).toEqual(["5 created", "0 linked to existing"]);
    expect(lines[4].value).toEqual(["1 found", "0 same person, 1 different people"]);
    expect(lines[6].value).toEqual(["3 of 3 matters", "signed off 25 Oct 2026, 13:30"]);
    expect(kindLabel("matter_staff_notes")).toBe("Notes");
    expect(kindLabel("opening_balances")).toBe("Opening balances");
  });

  it("downloads as CSV with every section, firm timezone times and no file values", () => {
    const file = runReportFile({
      report: REPORT,
      exceptions: [{ row: 7, column: "DOB", problem: "(value) isn’t a real date", fix: "Correct the date or leave it unknown" }],
      firm: "Synthetic Pilot Firm",
      timeZone: TZ,
      generated: "25 Oct 2026, 14:05 (America/Toronto)",
      madeBy: "Test Owner",
      signedOffBy: "Test Owner",
    });
    expect(file.sections.map((section) => section.title)).toEqual(["Source", "Record totals", "Rows", "Pilot and sign-off", "Exceptions"]);
    const csv = reportCsv(file);
    expect(csv).toContain(`"SHA-256 of the file","${SHA}"`);
    expect(csv).toContain('"Rows in the file","6"');
    expect(csv).toContain('"Matters","5","0"');
    expect(csv).toContain('"Rows checked again at commit","25 Oct 2026, 13:59"');
    expect(csv).toContain('"7","DOB","(value) isn’t a real date","Correct the date or leave it unknown"');
    expect(csv).toContain('"Note","Checked the three test matters"');
    expect(runReportFilename("My clients (final).csv", "2026-10-25", "pdf")).toBe("casevoya-migration-report-My-clients-final-2026-10-25.pdf");
  });
});

describe("MIG-02 imported provenance", () => {
  const rows = readProvenance([
    { id: "m1", system: "Synthetic Old CRM", imported_at: "2026-10-25T17:00:00Z", original_at: "2019-03-04T15:00:00Z", reference: "SYN-1", created: true, version_at_import: 1 },
    { id: "m2", system: "", imported_at: "2026-10-26T03:30:00Z", original_at: null, reference: null, created: true, version_at_import: 2 },
    { id: 7 },
  ]);

  it("reads “Imported from <system> on <date>” in the firm's timezone, with the original date", () => {
    expect(rows.size).toBe(2);
    expect(importedLabel(rows.get("m1")!, TZ)).toBe("Imported from Synthetic Old CRM on 25 Oct 2026");
    expect(importedLine(rows.get("m1")!, TZ)).toBe("Imported from Synthetic Old CRM on 25 Oct 2026 (originally 4 Mar 2019)");
    // 03:30 UTC on the 26th is still the 25th in Toronto.
    expect(importedLine(rows.get("m2")!, TZ)).toBe("Imported from another system on 25 Oct 2026");
  });

  it("shows the import in place of the creation it performed, never as a native event", () => {
    const audit = [
      { action: "matter.stage_transition", occurred_at: "2026-10-27T15:00:00Z" },
      { action: "matter.create", occurred_at: "2026-10-25T17:00:00Z" },
    ];
    expect(withImport(audit, null).rows).toHaveLength(2);
    const kept = withImport(audit, rows.get("m1")!);
    expect(kept.rows.map((row) => row.action)).toEqual(["matter.stage_transition"]);
    const event = importedEvent(rows.get("m1")!, TZ, "2026-10-28");
    expect(event).toEqual({
      dot: "#c9c5c0",
      title: "Imported from Synthetic Old CRM on 25 Oct 2026",
      parts: ["Migration import", "originally 4 Mar 2019", "old reference SYN-1"],
      badge: { tone: "unv", label: "Imported" },
      when: "25 Oct",
    });
  });

  it("marks an imported person's recorded facts, and says so differently once the record changed", () => {
    const facts = [
      { fact: "Date of birth", value: { num: "1 Feb 1980" }, source: "Person record", review: "—" },
      { fact: "Email", value: { unknown: true as const }, source: "Not recorded", review: "—" },
    ];
    expect(importedFacts(facts, null, TZ)).toBe(facts);
    expect(importedFacts(facts, rows.get("m1")!, TZ, 1).map((row) => row.source)).toEqual(["Imported from Synthetic Old CRM on 25 Oct 2026", "Not recorded"]);
    expect(importedFacts(facts, rows.get("m1")!, TZ, 2)[0].source).toBe("Person record (imported from Synthetic Old CRM on 25 Oct 2026)");
  });

  it("adds an imported line under an imported task's title only", () => {
    expect(importedTask(rows, "m1", TZ)).toEqual({ imported: "Imported from Synthetic Old CRM on 25 Oct 2026 (originally 4 Mar 2019)" });
    expect(importedTask(rows, "nope", TZ)).toEqual({});
  });
});

describe("MIG-02 Sign off tab (live additions)", () => {
  it("renders the pilot fields, the waiting notice, the pilot's records and the run report from Designer parts", () => {
    const html = renderToStaticMarkup(
      createElement(SheetMigration, {
        data: {
          tab: "signoff",
          signoff: {
            summary: [{ term: "Pilot", value: ["3 matters of 3", "3 new people, 0 linked"] }],
            action: { label: "Sign off the pilot", attrs: { "data-mig-act": "signoff", "data-org": "o1", "data-batch": "b1" } },
            rollback: { attrs: { "data-mig-act": "rollback" }, reasons: [], label: "Roll back the pilot" },
            fields: [{ id: "migN", label: "Sign-off note", hint: "What you checked.", kind: "textarea", attrs: { "data-mig-note": "1" }, value: "", maxLength: 1000 }],
            notice: { tone: "warn", title: "The full import waits for your sign-off", copy: "Check the records below." },
            pilot: { rows: [{ kind: "Matter", name: "SYN-1 · Test Client One", row: "2", reference: "SYN-1", href: "/sheet/matters/m1" }], more: null },
            report: { rows: [{ term: "Checksum (SHA-256)", value: [SHA, "rows matched it at upload and at commit"] }], downloads: [{ label: "Download report (CSV)", href: "/api/migration/report?batch=b1&format=csv" }] },
          },
        },
      }),
    );
    expect(html).toContain('<textarea class="ta" id="migN" rows="3" maxLength="1000" aria-describedby="migN-h" data-mig-note="1"></textarea>');
    expect(html).toContain('<small class="hint" id="migN-h">What you checked.</small>');
    expect(html).toContain('<div class="alert warn rv"');
    expect(html).toContain('<a href="/sheet/matters/m1">SYN-1 · Test Client One</a>');
    expect(html).toContain(">Roll back the pilot</button>");
    expect(html).toContain('href="/api/migration/report?batch=b1&amp;format=csv" download="">Download report (CSV)</a>');
    expect(html).toContain("Run report");
  });

  it("shows an imported task's provenance under its title, and nothing for a native task", () => {
    const row = { title: "Synthetic follow-up", matter: "SYN-1", owner: null, due: "—", priority: { tone: "gr" as const, label: "Normal" }, dependsOn: "—", state: "Open" };
    const html = (imported?: string) =>
      renderToStaticMarkup(createElement(SheetTasks, { data: { tab: "internal", counts: { open: 1, escalated: 0 }, internal: { alert: null, rows: [{ ...row, ...(imported ? { imported } : {}) }] } } as unknown as TasksData }));
    expect(html()).toContain("<td>Synthetic follow-up</td>");
    expect(html("Imported from Synthetic Old CRM on 25 Oct 2026")).toContain(
      '<td>Synthetic follow-up<span class="mu" style="display:block;font-size:12px">Imported from Synthetic Old CRM on 25 Oct 2026</span></td>',
    );
  });
});
