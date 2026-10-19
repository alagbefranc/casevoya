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

  it("still rejects drop table, drop column, delete, and create or replace view", () => {
    const hits = findDestructiveStatements(
      path.resolve(import.meta.dirname, "fixtures/destructive-migration.sql"),
    );
    const text = hits.join("\n");
    expect(text).toMatch(/drop table/i);
    expect(text).toMatch(/create or replace view/i);
    expect(text).toMatch(/delete from public\.example/i);
    expect(text).not.toMatch(/drop constraint/i);
    // Relaxing NOT NULL keeps every row; dropping a column does not.
    expect(text).not.toMatch(/drop not null/i);
    expect(text).toMatch(/drop column gone/i);
    expect(text).not.toMatch(/only_inside_function/i);
  });
});
