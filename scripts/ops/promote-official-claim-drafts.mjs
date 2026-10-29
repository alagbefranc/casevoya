#!/usr/bin/env node
// One-time, idempotent path to make captured official claims live (AI-04, decisions 2026-10-25).
// Do not run this against production from a pull request or a build. An operator runs it once,
// in a database maintenance session (the database owner through scripts/ops/supabase-api.mjs).
//
// Order:
//   1. Apply migration 20261029180000_src_recheck_conflicts_packs.sql (and 20261025600100 before it).
//   2. Dry run:  node scripts/ops/promote-official-claim-drafts.mjs
//   3. Apply:    node scripts/ops/promote-official-claim-drafts.mjs --apply
//
// What it does, and nothing else:
//   - app.promote_official_claim_drafts publishes official_capture versions that are still
//     draft or evidence_captured and already have a captured page. A second run promotes 0.
//   - scripts/ops/load-official-claims.mjs then loads the committed capture files
//     (captured-claims.json, captured-canada-ca.json, captured-all-sources.json). An unchanged
//     claim records a check. A new claim goes live. Processing times are refused.
//     Fee and law rows that were not re-read live are refused.
//
// It does not seed a fee, a form, a processing time or a program rule that is not already
// in those capture files with a URL, a section and a SHA-256.
import { loadOfficialClaims, readCaptureFiles, summary } from "./load-official-claims.mjs";

const APPLY = process.argv.includes("--apply");

const { runSql } = await import("./supabase-api.mjs");

const query = (sql) => runSql(sql);

const session = await query("select app.db_maintenance_session() as ok");
if (session?.[0]?.ok !== true) {
  console.error("Refused: this runs only in a database maintenance session (the database owner, no user or service-role session).");
  process.exit(1);
}

if (!APPLY) {
  const waiting = await query(`select count(*)::int as n from public.rule_versions where origin = 'official_capture' and status in ('draft', 'evidence_captured')`);
  console.log(`Official-capture versions still draft or evidence-captured: ${waiting?.[0]?.n ?? 0}. --apply publishes those that already have a captured page.`);
  const preview = await loadOfficialClaims({ query, files: readCaptureFiles(), dryRun: true, log: (line) => console.error(line) });
  console.log(summary(preview, true));
  console.log("Dry run only. Re-run with --apply to write. Safe to repeat: a second --apply changes nothing that is already live and unchanged.");
  process.exit(0);
}

const promoted = await query(`select app.promote_official_claim_drafts() as result`);
console.log(`Promoted official-capture drafts: ${JSON.stringify(promoted?.[0]?.result ?? null)}`);
const loaded = await loadOfficialClaims({ query, files: readCaptureFiles(), dryRun: false, log: (line) => console.error(line) });
console.log(summary(loaded, false));
