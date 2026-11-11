import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { indexName, uncoveredForeignKeys } from "../scripts/unindexed-foreign-keys.mjs";

const migrationsDir = path.resolve("supabase/migrations");
const migration = path.join(migrationsDir, "20261111120000_unindexed_foreign_keys.sql");

function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => path.join(migrationsDir, file));
}

describe("unindexed foreign keys", () => {
  it("the migration creates a non-concurrent index for every uncovered public foreign key", () => {
    const before = migrationFiles().filter((file) => path.basename(file) !== "20261111120000_unindexed_foreign_keys.sql");
    const uncovered = uncoveredForeignKeys(before);
    const sql = readFileSync(migration, "utf8").toLowerCase();
    expect(uncovered.length).toBeGreaterThan(0);
    expect(sql.match(/create index if not exists /g)).toHaveLength(uncovered.length);
    expect(sql).not.toMatch(/\bconcurrently\b/);
    for (const fk of uncovered) {
      expect(sql).toContain(`create index if not exists ${indexName(fk)} on ${fk.schema}.${fk.table} (${fk.columns.join(", ")});`);
    }
    expect(uncoveredForeignKeys(migrationFiles())).toHaveLength(0);
  });
});
