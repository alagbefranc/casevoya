import { describe, expect, it } from "vitest";
import { findDestructiveStatements, findTablesMissingRls, listMigrationFiles } from "../scripts/check-migrations.mjs";

describe("migrations", () => {
  it("are additive only", () => {
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(findDestructiveStatements(file), file).toEqual([]);
  });

  it("ENABLE + FORCE RLS on every public table", () => {
    expect(findTablesMissingRls()).toEqual([]);
  });
});
