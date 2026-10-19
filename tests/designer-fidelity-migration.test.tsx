import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetFrame } from "@/components/sheet/designer/frame";
import type { SidebarData } from "@/components/sheet/designer/sidebar";
import { MigrationHeader, SheetMigration, type MigrationData, type MigrationTab } from "@/components/sheet/designer/migration";
import { MigrationMarkup } from "@/components/sheet/markup/migration";
import { withCopy } from "./helpers/designer-copy";

/**
 * Compliance > Migration import (T044): the data-driven page must produce the same HTML as each
 * captured Designer tab when given the Designer's own sample values. The sample values live only in
 * this test; the app never renders them.
 */

const SIGN_OUT = /<form [^>]*action="\/sign-out"[^>]*>[\s\S]*?<\/form>/g;

function withoutPreloads(html: string): string {
  return html.replace(/<link rel="preload"[^>]*\/>/g, "").replace(SIGN_OUT, "");
}

function sameMarkup(live: string, captured: string) {
  if (live !== captured) {
    let i = 0;
    while (i < live.length && live[i] === captured[i]) i++;
    console.log("DIFF@" + i + "\nEXP " + captured.slice(i - 160, i + 200) + "\nGOT " + live.slice(i - 160, i + 200));
  }
  expect(live).toBe(captured);
}

const SIDEBAR: SidebarData = {
  active: "/sheet/migration",
  counts: { notifications: 5, drafts: 3, tasks: 7, inbox: 4, finance: 2, pipeline: 10, sourcesReview: 2 },
  pinned: [
    { href: "/sheet/matters/priya", name: "Priya Sharma", avatarUrl: "/assets/av-priya-applicant.png" },
    { href: "/sheet/matters?q=Kofi", name: "Kofi Mensah", avatarUrl: "/assets/av-kofi-client.png" },
  ],
  me: { name: "Amara Osei", role: "Licensed consultant", avatarUrl: "/assets/av-amara-consultant.png" },
  tiles: { documents: "/sheet/matters/priya?tab=documents", invoices: "/sheet/matters/priya?tab=billing" },
  newMatter: { href: "#", toast: "New matter", toastSub: "Starts from a versioned program template (prototype)." },
  createBoard: { href: "#", toast: "Create board", toastSub: "Saves the current filters as a board (prototype)." },
};

const STATUSBAR = {
  timezone: "America/Toronto",
  queue: { label: "Reminder queue healthy", detail: "0 retries" },
  sample: { label: "Demo data", detail: "fictional firm “Northline Immigration”" },
};

const DESIGNER: Record<MigrationTab, MigrationData> = {
  map: {
    tab: "map",
    map: {
      rows: [
        { column: "Full Name", sample: "Priya Sharma", field: ["Person", "legal name"], check: "OK" },
        { column: "DOB", sample: "09/03/1984", field: ["Person", "date of birth"], check: "Day/month order confirmed" },
        { column: "Email", sample: "priya@example.com", field: ["Person", "email"], check: "OK" },
        { column: "File #", sample: "2026-142", field: ["Matter", "old reference"], check: "Kept as an alias" },
        { column: "Status", sample: "Active", field: null, check: { tone: "chg", label: "Choose: not imported, or map to stage" } },
      ],
      next: { href: "?tab=preview" },
    },
  },
  preview: {
    tab: "preview",
    preview: {
      rows: [
        { row: "2", person: "Priya Sharma", birth: "1984-03-09", matter: "NL-2026-0142", result: { tone: "ok", label: "Matches existing", detail: "update" } },
        { row: "3", person: "Rafael Sharma", birth: "1981-11-21", matter: "NL-2026-0142", result: { tone: "ok", label: "New person" } },
        { row: "4", person: "K. Mensah", birth: "—", matter: "NL-2026-0131", result: { tone: "chg", label: "Possible match", detail: "confirm" } },
      ],
    },
  },
  errors: {
    tab: "errors",
    errors: {
      title: "3 of 214 rows have errors",
      copy: "211 rows are ready.",
      rows: [
        { row: "17", column: "DOB", problem: "“31/02/1990” isn’t a real date", fix: "Correct the date or leave it unknown" },
        { row: "58", column: "Email", problem: "Two people share “family@example.com”", fix: "Kept as two people; pick who it belongs to" },
        { row: "133", column: "Passport", problem: "Number in a notes field", fix: "Move it to the passport field so it’s masked" },
      ],
    },
  },
  signoff: {
    tab: "signoff",
    signoff: {
      summary: [
        { term: "People", value: ["198 new", "13 updated"] },
        { term: "Matters", value: ["64", "all in Intake until reviewed"] },
        { term: "Not imported", value: "3 rows with errors" },
        { term: "Source file", value: ["clients.csv", "hash 51c0…e2"] },
      ],
      action: {
        label: "Sign off and import",
        attrs: { "data-run": "ok", "data-done": "Import finished", "data-sub": "211 rows. A copy of the report is in the audit trail.", "data-fpr": "1" },
      },
    },
  },
};

const VARIANT: Record<MigrationTab, string> = { map: "tab-map", preview: "tab-preview", errors: "tab-errors", signoff: "tab-signoff" };

function render(tab: MigrationTab, data: MigrationData) {
  return withoutPreloads(
    renderToStaticMarkup(
      createElement(
        SheetFrame,
        { sidebar: SIDEBAR, header: createElement(MigrationHeader, { data: { tab, pill: ["Import 2 of 2", "clients.csv"] } }), statusbar: STATUSBAR },
        createElement(SheetMigration, { data }),
      ),
    ),
  );
}

describe("Designer fidelity: Migration import", () => {
  for (const tab of ["map", "preview", "errors", "signoff"] as const) {
    it(`renders the ${tab} tab exactly as the captured Designer markup`, () => {
      const raw = withoutPreloads(renderToStaticMarkup(createElement(MigrationMarkup, { variant: VARIANT[tab] })));
      // Text-only change (2026-10-19 audit): the page has no in-page row edits, so it doesn't promise them.
      const captured =
        tab === "errors"
          ? withCopy(raw, [["Fix them in your file or here.", "Fix them in your file and upload it again, or map their values on Map columns."]])
          : raw;
      sameMarkup(render(tab, DESIGNER[tab]), captured);
    });
  }

  it("shows a firm with no import an upload empty state and no sample people", () => {
    const html = renderToStaticMarkup(createElement(SheetMigration, { data: { tab: "map", upload: { attrs: { "data-mig-act": "upload", "data-org": "o1" } } } }));
    expect(html).toContain('class="emp"');
    expect(html).toContain('<button class="btn p sm" data-mig-act="upload" data-org="o1">Choose a CSV file</button>');
    expect(html).toContain('<input type="file" accept=".csv,text/csv" hidden="" data-mig-file="1"/>');
    expect(html).not.toMatch(/Priya|Rafael|Mensah|Northline|clients\.csv/);
    for (const tab of ["preview", "errors", "signoff"] as const) {
      const empty = renderToStaticMarkup(createElement(SheetMigration, { data: { tab, empty: { title: "No import yet", copy: "Upload a file on Map columns." } } }));
      expect(empty).toContain("No import yet");
      expect(empty).not.toContain("<table");
    }
  });

  it("wires live controls by data attributes, with no Designer toast or prototype run", () => {
    const html = renderToStaticMarkup(
      createElement(SheetMigration, {
        data: {
          tab: "map",
          map: {
            rows: [
              {
                column: "Name",
                sample: "Dana Lee",
                field: ["Person", "legal name"],
                check: "OK",
                select: { attrs: { "data-mig-col": "0" }, value: "name", options: [["", "Not imported"], ["name", "Person · legal name"]] },
              },
            ],
            next: { attrs: { "data-mig-act": "map", "data-org": "o1", "data-batch": "b1" } },
            settings: {
              dateOrder: { attrs: { "data-mig-date": "1" }, value: "dmy", options: [["dmy", "Day / month / year"]] },
              consultant: { attrs: { "data-mig-default": "1" }, value: "", options: [["", "Choose…"]] },
            },
            values: [{ column: "Program", value: "Express Entry", rows: "3", select: { attrs: { "data-mig-val": "program", "data-key": "express entry" }, value: "", options: [["", "Needs review"], ["none", "Not imported"]] } }],
            discard: { "data-mig-act": "discard", "data-org": "o1", "data-batch": "b1" },
          },
        },
      }),
    );
    expect(html).toContain('<select class="sel" data-mig-col="0"><option value="">Not imported</option><option value="name" selected="">Person · legal name</option></select>');
    expect(html).toContain('<button class="btn p sm" data-mig-act="map" data-org="o1" data-batch="b1">Continue to preview</button>');
    expect(html).toContain('data-mig-val="program" data-key="express entry"');
    expect(html).toContain('<button class="btn sm" data-mig-act="discard"');
    const signoff = renderToStaticMarkup(
      createElement(SheetMigration, {
        data: {
          tab: "signoff",
          signoff: {
            summary: [{ term: "People", value: ["2 new", "1 linked to existing"] }],
            action: null,
            rollback: { attrs: { "data-mig-act": "rollback", "data-org": "o1", "data-batch": "b1" }, reasons: ["The person from row 2 was edited after the import."] },
          },
        },
      }),
    );
    expect(signoff).toContain('data-mig-act="rollback"');
    expect(signoff).toContain("The person from row 2 was edited after the import.");
    expect(html + signoff).not.toMatch(/data-toast|data-run/);
  });
});
