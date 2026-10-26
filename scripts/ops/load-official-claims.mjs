#!/usr/bin/env node
// Loads Casevoya's committed captures of official pages as live official claims (#188; Francis's
// decisions 2026-10-25 11:42 / 11:50 CDT and 4:48 PM CDT). A captured claim becomes a platform rule
// version (organization_id null, origin official_capture) shared by every firm, live on load with
// its evidence: the exact URL and section, the page's SHA-256 and retrieval time, and the dates the
// page prints (or Unknown).
//
// Usage:
//   node scripts/ops/load-official-claims.mjs --dry-run      prints new / changed / unchanged / refused, writes nothing
//   node scripts/ops/load-official-claims.mjs                loads
//   [--file captured-all-sources.json] loads one capture file only
//
// Where it runs: a database maintenance session only, i.e. as the database owner through the
// Supabase Management API (scripts/ops/supabase-api.mjs, SUPABASE_ACCESS_TOKEN), never with the
// service role or a user's session. The database refuses anything else (app.load_official_claims
// checks app.db_maintenance_session), and the script checks first and stops. swe runs it once per
// capture, after the migration 20261025600100_src_live_claims.sql.
//
// What is loaded, from src/modules/content-governance/:
//   captured-claims.json        IRCC fee list rows and IRPR/IRPA sections (re-read live by
//                               capture-official-claims.mjs --only official);
//   captured-canada-ca.json     canada.ca form pages, PDF editions, the IMM 5483 checklist, program pages (#248);
//   captured-all-sources.json   the all-sources capture, with the fee list and Justice Laws re-read
//                               live (capture-official-claims.mjs --all-sources).
// Refused, never loaded, and counted by category: a claim the capture marked `refused` (a fee that
// didn't match the live fee list, a law section not on the live page, a split row), the fee list's
// loading placeholder ("Error loading fee", `feePlaceholder`), a homepage or non-federal source
// (claimUrlProblem, the same rule as the database), a claim with no page capture (no SHA-256), a fee
// or law claim that wasn't re-read live, and a key that appears twice.
//
// Idempotent: keyed on the claim's stable key and the page's content hash. An unchanged claim
// records a successful check of its page and nothing else; a changed hash or text loads a new
// version that goes live and supersedes the old one; a suspended claim stays suspended.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claimUrlProblem } from "../../src/modules/content-governance/claim-capture.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CAPTURE_DIR = path.join(HERE, "..", "..", "src", "modules", "content-governance");
export const CAPTURE_FILES = ["captured-claims.json", "captured-canada-ca.json", "captured-all-sources.json"];
const CATEGORIES = new Set(["fee", "form", "checklist", "program", "guide", "law"]);
const PLACEHOLDER = /error loading fee/i;
const BATCH = 150;

/** The claim's category: as captured, or from its key for captured-claims.json (fee list and laws). */
export function categoryOf(claim) {
  if (CATEGORIES.has(claim.category)) return claim.category;
  if (/^CA\.FEES\./.test(claim.key)) return "fee";
  if (/^CA\.(IRPR|IRPA)\./.test(claim.key)) return "law";
  return null;
}

const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Every claim of the capture files, as the database loads it, or refused with the reason. Nothing
 * is filled in: a date the page didn't print stays null.
 */
export function preparedClaims(files) {
  const claims = [];
  const refused = [];
  const seen = new Set();
  for (const { name, data } of files) {
    const pages = new Map((data.pages ?? []).map((page) => [page.url, page]));
    for (const claim of data.claims ?? []) {
      const category = categoryOf(claim);
      const refuse = (reason) => refused.push({ key: claim.key, file: name, category: category ?? "unknown", reason });
      if (!category) {
        refuse("unknown category");
        continue;
      }
      if (seen.has(claim.key)) {
        refuse("the same key is in another capture file");
        continue;
      }
      seen.add(claim.key);
      if (claim.refused) {
        refuse(String(claim.refused));
        continue;
      }
      if ("feePlaceholder" in claim || [claim.claim, claim.value, claim.excerpt, claim.sectionText].some((field) => typeof field === "string" && PLACEHOLDER.test(field))) {
        refuse("the page's fee placeholder (“Error loading fee”) is not a claim");
        continue;
      }
      if (/PROCESSING_TIME/.test(claim.key)) {
        refuse("processing times are entered by staff, never loaded");
        continue;
      }
      const problem = claimUrlProblem(String(claim.sourceUrl ?? ""), text(claim.section));
      if (problem) {
        refuse(problem);
        continue;
      }
      const page = pages.get(claim.page);
      if (!page || !/^[0-9a-f]{64}$/.test(String(page.sha256 ?? ""))) {
        refuse("no capture of the page (no SHA-256)");
        continue;
      }
      if (name === "captured-all-sources.json" && (category === "fee" || category === "law") && !claim.liveCheck) {
        refuse("not re-read from the live page");
        continue;
      }
      claims.push({
        file: name,
        payload: {
          key: claim.key,
          category,
          program: text(claim.program),
          jurisdiction: text(claim.jurisdiction) ?? "CA",
          claim: claim.claim,
          value: text(claim.value),
          source_url: claim.sourceUrl,
          section: text(claim.section),
          excerpt: text(claim.excerpt),
          form_number: text(claim.formNumber),
          page: {
            url: page.url,
            final_url: page.finalUrl ?? page.url,
            publisher: text(page.publisher),
            title: text(page.title),
            sha256: page.sha256,
            retrieved_at: page.retrievedAt,
            http_status: typeof page.httpStatus === "number" ? page.httpStatus : null,
            modified_on: page.modifiedOn ?? null,
            last_amended_on: page.lastAmendedOn ?? null,
            current_to: page.currentTo ?? null,
          },
        },
      });
    }
  }
  return { claims, refused };
}

/** A dollar-quoted SQL literal whose tag isn't in the text. */
export function dollarQuoted(value) {
  let tag = "claims";
  while (value.includes(`$${tag}$`)) tag = `${tag}_${Math.random().toString(36).slice(2, 8)}`;
  return `$${tag}$${value}$${tag}$`;
}

function tally(counts, category, result) {
  counts[category] ??= { new: 0, changed: 0, unchanged: 0, suspended: 0, refused: 0 };
  counts[category][result] += 1;
}

/**
 * Loads (or with dryRun, only counts) the prepared claims through app.load_official_claims.
 * `query(sql)` runs one statement as the database owner and returns its rows.
 */
export async function loadOfficialClaims({ query, files, dryRun = true, batch = BATCH, log = () => {} }) {
  let maintenance = null;
  try {
    maintenance = await query("select app.db_maintenance_session() as ok");
  } catch {
    maintenance = null;
  }
  if (maintenance?.[0]?.ok !== true) {
    throw new Error("Refused: official claims load only in a database maintenance session (the database owner, no user or service-role session).");
  }
  const { claims, refused } = preparedClaims(files);
  const counts = {};
  const refusedAll = [...refused];
  for (const item of refused) tally(counts, item.category, "refused");
  for (let at = 0; at < claims.length; at += batch) {
    const slice = claims.slice(at, at + batch);
    const sql = `select app.load_official_claims(${dollarQuoted(JSON.stringify(slice.map((item) => item.payload)))}::jsonb, ${dryRun ? "true" : "false"}) as results`;
    const rows = await query(sql);
    const results = rows?.[0]?.results;
    const list = typeof results === "string" ? JSON.parse(results) : results;
    if (!Array.isArray(list) || list.length !== slice.length) throw new Error("The database didn't answer for every claim; nothing more was sent.");
    list.forEach((entry, index) => {
      const category = slice[index].payload.category;
      const result = String(entry.result ?? "");
      if (result.startsWith("refused")) {
        tally(counts, category, "refused");
        refusedAll.push({ key: slice[index].payload.key, file: slice[index].file, category, reason: result.replace(/^refused:\s*/, "") });
      } else if (["new", "changed", "unchanged", "suspended"].includes(result)) {
        tally(counts, category, result);
      } else {
        throw new Error(`Unexpected result for ${slice[index].payload.key}: ${result}`);
      }
    });
    log(`${dryRun ? "Checked" : "Loaded"} ${Math.min(at + batch, claims.length)} of ${claims.length}`);
  }
  return { counts, refused: refusedAll, considered: claims.length + refused.length };
}

export function readCaptureFiles(names = CAPTURE_FILES, dir = CAPTURE_DIR) {
  return names.map((name) => ({ name, data: JSON.parse(readFileSync(path.join(dir, name), "utf8")) }));
}

export function summary(result, dryRun) {
  const lines = [`${dryRun ? "Dry run (nothing written)" : "Loaded"}: ${result.considered} claims considered.`];
  const total = { new: 0, changed: 0, unchanged: 0, suspended: 0, refused: 0 };
  for (const [category, count] of Object.entries(result.counts).sort()) {
    lines.push(`  ${category}: new ${count.new}, changed ${count.changed}, unchanged ${count.unchanged}, suspended ${count.suspended}, refused ${count.refused}`);
    for (const key of Object.keys(total)) total[key] += count[key];
  }
  lines.push(`  all: new ${total.new}, changed ${total.changed}, unchanged ${total.unchanged}, suspended ${total.suspended}, refused ${total.refused}`);
  for (const item of result.refused) lines.push(`  refused ${item.key} (${item.file}): ${item.reason}`);
  return lines.join("\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileAt = args.indexOf("--file");
  const names = fileAt >= 0 ? [args[fileAt + 1]] : CAPTURE_FILES;
  if (!names.every((name) => CAPTURE_FILES.includes(name))) {
    console.error(`--file is one of ${CAPTURE_FILES.join(", ")}`);
    process.exit(2);
  }
  const { runSql } = await import("./supabase-api.mjs");
  try {
    const result = await loadOfficialClaims({ query: (sql) => runSql(sql), files: readCaptureFiles(names), dryRun, log: (line) => console.error(line) });
    console.log(summary(result, dryRun));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
