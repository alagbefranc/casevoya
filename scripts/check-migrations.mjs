#!/usr/bin/env node
// Guards supabase/migrations: additive-only, and every public table gets ENABLE + FORCE RLS.
// Usage: node scripts/check-migrations.mjs   (exit 1 on violation)
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "supabase", "migrations");

export function listMigrationFiles() {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(dir, f));
}

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Function bodies ($$ ... $$) may legitimately contain words like "delete" in trigger logic,
// so they are checked separately: only top-level statements are scanned for destructive DDL/DML.
function stripDollarBodies(sql) {
  return sql.replace(/\$([A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g, "$$$$ $$$$");
}

// Dropping a table, column, or function, deleting rows, and replacing views are
// forbidden. Replacing a function body and dropping a constraint (including a NOT NULL
// constraint: `alter column ... drop not null`) are allowed: a later migration may change a
// helper or relax a rule without deleting data.
const DESTRUCTIVE = [
  /\bdrop\s+(table|schema|function|view|policy|trigger|index|type|extension|column|role|materialized)\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
];

export function findDestructiveStatements(file) {
  const sql = stripDollarBodies(stripComments(readFileSync(file, "utf8")));
  const hits = [];
  for (const statement of sql.split(";")) {
    for (const re of DESTRUCTIVE) {
      // a TRUNCATE trigger definition is a guard, not a truncate
      if (re.source.includes("truncate") && /before\s+truncate\s+on/i.test(statement)) continue;
      if (re.test(statement)) hits.push(statement.trim().slice(0, 120));
    }
    if (/\balter\s+table\b/i.test(statement) && /\bdrop\b/i.test(statement)) {
      const drops = statement.match(/\bdrop\s+(?!constraint\b|not\s+null\b)\w+/gi) ?? [];
      if (drops.length) hits.push(statement.trim().slice(0, 120));
    }
    if (/\bcreate\s+or\s+replace\b/i.test(statement) && !/\bcreate\s+or\s+replace\s+function\b/i.test(statement)) {
      hits.push(statement.trim().slice(0, 120));
    }
  }
  return hits;
}

export function findTablesMissingRls(files = listMigrationFiles()) {
  const all = files.map((f) => stripComments(readFileSync(f, "utf8"))).join("\n");
  const created = [...all.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)].map((m) => m[1]);
  return created.filter((t) => {
    const enable = new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, "i");
    const force = new RegExp(`alter\\s+table\\s+public\\.${t}\\s+force\\s+row\\s+level\\s+security`, "i");
    return !enable.test(all) || !force.test(all);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let failed = false;
  for (const file of listMigrationFiles()) {
    const hits = findDestructiveStatements(file);
    if (hits.length) {
      failed = true;
      console.error(`Destructive statement(s) in ${path.basename(file)}:\n  ${hits.join("\n  ")}`);
    }
  }
  const missing = findTablesMissingRls();
  if (missing.length) {
    failed = true;
    console.error(`Tables without ENABLE + FORCE RLS: ${missing.join(", ")}`);
  }
  if (failed) process.exit(1);
  console.log(`OK: ${listMigrationFiles().length} migrations are additive and every public table has RLS forced.`);
}
