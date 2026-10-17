import path from "node:path";
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

  it("still rejects drop table, delete, and create or replace view", () => {
    const hits = findDestructiveStatements(
      path.resolve(import.meta.dirname, "fixtures/destructive-migration.sql"),
    );
    const text = hits.join("\n");
    expect(text).toMatch(/drop table/i);
    expect(text).toMatch(/create or replace view/i);
    expect(text).toMatch(/delete from public\.example/i);
    expect(text).not.toMatch(/drop constraint/i);
    expect(text).not.toMatch(/only_inside_function/i);
  });
});
