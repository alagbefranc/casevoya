#!/usr/bin/env node
// Foreign keys in supabase/migrations whose referencing columns are not the
// leftmost columns of any non-partial index (primary key, unique, or create index).
// Mirrors the Supabase unindexed-foreign-keys advisor. Does not connect to a database.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "supabase", "migrations");

function stripComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (ch === "'") {
      out += "''";
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function stripDollarBodies(sql) {
  return sql.replace(/\$([A-Za-z0-9_]*)\$[\s\S]*?\$\1\$/g, " ");
}

function statements(sql) {
  return stripDollarBodies(stripComments(sql))
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function ident(raw) {
  const text = raw.trim().replace(/"/g, "");
  const name = text.split(".").pop() ?? text;
  return name.toLowerCase();
}

function columnList(raw) {
  return raw
    .split(",")
    .map((part) => ident(part.trim().split(/\s+/)[0] ?? ""))
    .filter((name) => name && /^[a-z_][a-z0-9_]*$/.test(name));
}

function splitTop(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function tableBody(statement) {
  const open = statement.indexOf("(");
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < statement.length; i += 1) {
    if (statement[i] === "(") depth += 1;
    else if (statement[i] === ")") {
      depth -= 1;
      if (depth === 0) return statement.slice(open + 1, i);
    }
  }
  return null;
}

function qualifiedTable(statement) {
  const match = /(?:table|on)\s+(?:only\s+)?(?:if\s+(?:not\s+)?exists\s+)?((?:public|app)\.[a-z_][a-z0-9_]*)/i.exec(statement);
  if (!match) return null;
  const [schema, table] = match[1].toLowerCase().split(".");
  return { schema, table };
}

/** @typedef {{ schema: string, table: string, columns: string[] }} Key */

export function listMigrationFiles() {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => path.join(dir, file));
}

/**
 * @returns {{ foreignKeys: Key[], indexes: Key[] }}
 */
export function schemaKeys(files = listMigrationFiles()) {
  /** @type {Key[]} */
  const foreignKeys = [];
  /** @type {Key[]} */
  const indexes = [];

  const addIndex = (schema, table, columns) => {
    if (!schema || !table || columns.length === 0) return;
    indexes.push({ schema, table, columns });
  };
  const addFk = (schema, table, columns) => {
    if (!schema || !table || columns.length === 0) return;
    foreignKeys.push({ schema, table, columns });
  };

  for (const file of files) {
    for (const statement of statements(readFileSync(file, "utf8"))) {
      const head = statement.slice(0, 80).toLowerCase();
      if (head.startsWith("create table")) {
        const table = qualifiedTable(statement);
        const body = tableBody(statement);
        if (!table || !body) continue;
        for (const part of splitTop(body)) {
          const foreign = /foreign\s+key\s*\(([^)]+)\)/i.exec(part);
          const primary = /primary\s+key\s*\(([^)]+)\)/i.exec(part);
          const unique = /unique(?:\s+key)?\s*\(([^)]+)\)/i.exec(part);
          const column = ident(part.split(/\s+/)[0] ?? "");
          if (foreign) addFk(table.schema, table.table, columnList(foreign[1]));
          else if (/references\s+/i.test(part) && column) addFk(table.schema, table.table, [column]);
          if (primary) addIndex(table.schema, table.table, columnList(primary[1]));
          else if (/\bprimary\s+key\b/i.test(part) && column) addIndex(table.schema, table.table, [column]);
          if (unique && !/foreign\s+key/i.test(part)) addIndex(table.schema, table.table, columnList(unique[1]));
          else if (/\bunique\b/i.test(part) && !/foreign\s+key/i.test(part) && column) addIndex(table.schema, table.table, [column]);
        }
        continue;
      }
      if (head.startsWith("alter table")) {
        const table = qualifiedTable(statement);
        if (!table) continue;
        for (const match of statement.matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?("?[a-z_][a-z0-9_]*"?)\s+[^,;]*?\breferences\s+/gi)) {
          addFk(table.schema, table.table, [ident(match[1])]);
        }
        for (const match of statement.matchAll(/foreign\s+key\s*\(([^)]+)\)/gi)) {
          addFk(table.schema, table.table, columnList(match[1]));
        }
        for (const match of statement.matchAll(/(?:primary\s+key|unique(?:\s+key)?)\s*\(([^)]+)\)/gi)) {
          addIndex(table.schema, table.table, columnList(match[1]));
        }
        continue;
      }
      if (/^create\s+(?:unique\s+)?index\b/i.test(statement)) {
        const table = /on\s+(?:only\s+)?((?:public|app)\.[a-z_][a-z0-9_]*)/i.exec(statement);
        if (!table) continue;
        const [schema, name] = table[1].toLowerCase().split(".");
        const after = statement.slice((table.index ?? 0) + table[0].length);
        const cols = tableBody(after);
        if (!cols) continue;
        const rest = after.slice(after.indexOf("(") + cols.length + 2);
        if (/\bwhere\b/i.test(rest)) continue;
        if (/\(/.test(cols)) continue;
        addIndex(schema, name, columnList(cols));
      }
    }
  }
  return { foreignKeys, indexes };
}

export function indexCovers(indexColumns, fkColumns) {
  if (indexColumns.length < fkColumns.length) return false;
  return fkColumns.every((column, index) => indexColumns[index] === column);
}

/** @param {{ schema?: string }} [options] */
export function uncoveredForeignKeys(files = listMigrationFiles(), options = {}) {
  const schema = options.schema ?? "public";
  const { foreignKeys, indexes } = schemaKeys(files);
  const seen = new Set();
  const uncovered = [];
  for (const fk of foreignKeys) {
    if (fk.schema !== schema) continue;
    const key = `${fk.schema}.${fk.table}(${fk.columns.join(",")})`;
    if (seen.has(key)) continue;
    seen.add(key);
    const covered = indexes.some((index) => index.schema === fk.schema && index.table === fk.table && indexCovers(index.columns, fk.columns));
    if (!covered) uncovered.push(fk);
  }
  uncovered.sort((a, b) => `${a.table}.${a.columns.join(",")}`.localeCompare(`${b.table}.${b.columns.join(",")}`));
  return uncovered;
}

export function indexName(fk) {
  const raw = `${fk.table}_${fk.columns.join("_")}_fk_idx`;
  return raw.length <= 63 ? raw : `${raw.slice(0, 54)}_${raw.slice(-8)}`.slice(0, 63);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const uncovered = uncoveredForeignKeys();
  console.log(`uncovered public foreign keys: ${uncovered.length}`);
  for (const fk of uncovered) {
    console.log(`${indexName(fk)} on ${fk.schema}.${fk.table} (${fk.columns.join(", ")})`);
  }
}
