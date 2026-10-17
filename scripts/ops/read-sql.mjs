#!/usr/bin/env node
// Runs one read-only query against the live project and prints the rows as JSON lines.
// The session is set to read-only first, so a write in the query fails.
// Usage: node scripts/ops/read-sql.mjs "select ..."
import { runSql } from "./supabase-api.mjs";

const query = process.argv[2];
if (!query) {
  console.error('Usage: node scripts/ops/read-sql.mjs "select ..."');
  process.exit(2);
}
const rows = await runSql(`set session characteristics as transaction read only;\n${query}`);
for (const row of rows) console.log(JSON.stringify(row));
