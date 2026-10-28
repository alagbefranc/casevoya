#!/usr/bin/env node
// #263-B backfill (NOT RUN): virus-scans the files stored before scanning was turned on
// (document_versions clean with scan_engine 'structural_only'; sealed agreements are skipped).
// It calls the app's scan runner (POST /api/documents/scan/run, {"backfill": true}) a batch at a
// time until nothing is left. The runner does the work in the app Worker, which has the
// AV_SCANNER binding and the service key; this script holds neither.
//
// A file stays open while it is rescanned: clean marks it virus-scanned, infected quarantines it
// (audited as document.scan_infected, staff notified), and an error leaves it as it was (tried
// again later, up to documents.virus_scan_retry max_attempts).
//
// Before running: the scanner is deployed and bound, and documents.accept_structural_inspection
// is false. Run off-hours: each claimed row's version number moves on, so a review dialog open
// on that file at the same moment has to be reopened.
//
// Usage:
//   APP_URL=https://app.casevoya.ca EMAIL_DISPATCH_SECRET=... node scripts/rescan-legacy-documents.mjs [--batch 5] [--max 1000]
// The secret comes from the environment only (the Worker's EMAIL_DISPATCH_SECRET); never put it in a file.

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  const value = at > 0 ? Number(process.argv[at + 1]) : NaN;
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
const secret = process.env.EMAIL_DISPATCH_SECRET ?? "";
if (!/^https?:\/\//.test(base) || !secret) {
  console.error("Set APP_URL and EMAIL_DISPATCH_SECRET in the environment.");
  process.exit(1);
}
const batch = Math.min(option("batch", 5), 10);
const max = option("max", 1000);

let scanned = 0;
const totals = { clean: 0, infected: 0, errors: 0 };
while (scanned < max) {
  const response = await fetch(`${base}/api/documents/scan/run`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({ backfill: true, limit: batch }),
  });
  if (!response.ok) {
    console.error(`Runner answered ${response.status}; stopping.`);
    process.exit(1);
  }
  const summary = await response.json();
  if (!summary.claimed) break;
  scanned += summary.claimed;
  totals.clean += summary.clean;
  totals.infected += summary.infected;
  totals.errors += summary.errors;
  console.log(`Scanned ${scanned}: ${totals.clean} clean, ${totals.infected} infected, ${totals.errors} could not be checked.`);
  // Files that errored wait for their backoff; stop when a batch made no progress.
  if (summary.errors === summary.claimed) break;
}
console.log(`Done: ${totals.clean} clean, ${totals.infected} infected (quarantined), ${totals.errors} could not be checked (left as they were).`);
