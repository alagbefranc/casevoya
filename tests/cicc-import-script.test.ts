import { describe, expect, it } from "vitest";
import { mapHeaders, parseCsv, toRow } from "../scripts/ops/import-cicc-list.mjs";

// scripts/ops/import-cicc-list.mjs: CSV parsing and the configurable column mapping. Synthetic rows.

describe("CICC list import script", () => {
  it("parses quoted values, doubled quotes, CRLF and a BOM, and drops blank lines", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\nlast,row')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["last", "row"],
    ]);
    expect(() => parseCsv('a\n"open')).toThrow(/quoted/);
  });

  it("maps headers case-insensitively and keeps the other columns as text", () => {
    const mapping = mapHeaders(["LICENCE NUMBER", "First Name", "Last Name", "Status", "Company"]);
    expect(mapping.index).toEqual({ licence_number: 0, first_name: 1, last_name: 2, status: 3 });
    expect(mapping.extra).toEqual([["Company", 4]]);
    expect(toRow(["r512345", "Mei", "Chen", "ACTIVE", "Synthetic Co"], mapping)).toEqual({
      licence_number: "r512345",
      full_name: "Mei Chen",
      first_name: "Mei",
      last_name: "Chen",
      status: "Active",
      entitlement: null,
      licence_class: null,
      fields: { Company: "Synthetic Co" },
    });
    expect(toRow(["", "No", "Number", "Active", ""], mapping)).toBeNull();
    expect(toRow(["R1", "A", "B", "Lapsed", ""], mapping)?.status).toBe("Lapsed");
  });

  it("refuses a file without a licence number, status or name column", () => {
    expect(() => mapHeaders(["Name", "Status"])).toThrow(/licence number/);
    expect(() => mapHeaders(["Licence Number", "Name"])).toThrow(/status/);
    expect(() => mapHeaders(["Licence Number", "Status", "First Name"])).toThrow(/name/);
  });
});
