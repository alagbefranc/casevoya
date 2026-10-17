#!/usr/bin/env node
// Applies one committed migration to the live project and records it in
// supabase_migrations.schema_migrations, in a single transaction.
// Usage: node scripts/ops/apply-migration.mjs supabase/migrations/<version>_<name>.sql
//
// Refuses: files outside supabase/migrations, versions already recorded, and
// files with destructive statements (those need the product owner's approval
// and are applied by hand).
import { readFileSync } from "node:fs";
import path from "node:path";
import { runSql } from "./supabase-api.mjs";
import { isDestructive } from "./destructive.mjs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/ops/apply-migration.mjs supabase/migrations/<file>.sql");
  process.exit(2);
}
const resolved = path.resolve(file);
const dir = path.resolve("supabase/migrations");
const match = path.basename(resolved).match(/^(\d{14})_([a-z0-9_]+)\.sql$/);
if (path.dirname(resolved) !== dir || !match) {
  console.error("Only files named supabase/migrations/<14-digit version>_<name>.sql can be applied.");
  process.exit(2);
}
const [, version, name] = match;
const sql = readFileSync(resolved, "utf8");
if (isDestructive(sql)) {
  console.error("This migration contains destructive SQL. Get explicit approval and apply it by hand.");
  process.exit(3);
}

const applied = await runSql(
  `select 1 from supabase_migrations.schema_migrations where version = '${version}'`,
);
if (applied.length > 0) {
  console.log(`${version}_${name} is already applied.`);
  process.exit(0);
}

const quoted = (value) => `'${value.replace(/'/g, "''")}'`;
await runSql(
  `begin;\n${sql}\n;\ninsert into supabase_migrations.schema_migrations (version, name) values (${quoted(version)}, ${quoted(name)});\ncommit;`,
);
console.log(`Applied ${version}_${name}.`);
