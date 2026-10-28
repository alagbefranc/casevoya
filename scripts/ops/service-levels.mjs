#!/usr/bin/env node
// ADM-04: support response times and the monthly service-level report, for platform admins.
// There is no platform admin web UI; this wraps the database functions (20261025360000).
//
// Record when a firm's support request reached Casevoya support and when support first replied
// (leave --responded out while it waits; run again with the same --ticket to set or correct it):
//   node scripts/ops/service-levels.mjs record <firm-id> --ticket CS-2291 \
//        --received 2026-10-25T14:05:00-04:00 [--responded 2026-10-25T15:20:00-04:00] \
//        --recorded-by <platform-admin-user-id> [--dry-run]
//
// Read a firm's monthly report (months in the firm's timezone; the read is audited on the firm):
//   node scripts/ops/service-levels.mjs report <firm-id> [--months 6]
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (the service role) unless --dry-run.
// --recorded-by must be a row in public.platform_admins. Times need a UTC offset or "Z".
// Metadata only: never pass a subject, message or anything the firm wrote. Uptime is not
// measured (no monitoring source is recorded), and this script never reports a figure for it.
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// An ISO 8601 date-time with seconds optional and a required offset.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const USAGE = [
  "Usage:",
  "  node scripts/ops/service-levels.mjs record <firm-id> --ticket <ref> --received <iso> [--responded <iso>] --recorded-by <platform-admin-user-id> [--dry-run]",
  "  node scripts/ops/service-levels.mjs report <firm-id> [--months 6]",
].join("\n");

export function parseArgs(argv) {
  const [command, firm, ...rest] = argv;
  if (command !== "record" && command !== "report") throw new Error(USAGE);
  if (!firm || !UUID.test(firm)) throw new Error(`Give the firm id (a uuid).\n${USAGE}`);
  const args = { command, firm, ticket: null, received: null, responded: null, recordedBy: null, months: 6, dryRun: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--ticket") args.ticket = rest[++i] ?? null;
    else if (arg === "--received") args.received = rest[++i] ?? null;
    else if (arg === "--responded") args.responded = rest[++i] ?? null;
    else if (arg === "--recorded-by") args.recordedBy = rest[++i] ?? null;
    else if (arg === "--months") args.months = Number(rest[++i]);
    else if (arg === "--dry-run") args.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
  }
  if (command === "report") {
    if (!Number.isInteger(args.months) || args.months < 1 || args.months > 24) throw new Error("--months is 1 to 24.");
    return args;
  }
  const ticket = (args.ticket ?? "").trim();
  if (ticket.length < 1 || ticket.length > 60) throw new Error("--ticket <ref> is required (1 to 60 characters).");
  args.ticket = ticket;
  for (const [flag, value] of [["--received", args.received], ["--responded", args.responded]]) {
    if (value === null && flag === "--responded") continue;
    if (!value || !INSTANT.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`${flag} needs a date-time with a UTC offset, e.g. 2026-10-25T14:05:00-04:00.`);
  }
  if (args.responded && Date.parse(args.responded) < Date.parse(args.received)) throw new Error("--responded is before --received.");
  if (!args.recordedBy || !UUID.test(args.recordedBy)) throw new Error("--recorded-by <platform-admin-user-id> is required.");
  return args;
}

function minutes(seconds) {
  if (seconds === null || seconds === undefined) return "-";
  return seconds < 60 ? "<1 min" : `${Math.round(seconds / 60)} min`;
}

async function client() {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
    if (!process.env[name]) throw new Error(`${name} is not set.`);
  }
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "record") {
    console.log(`Firm ${args.firm} · ticket ${args.ticket} · received ${args.received} · first reply ${args.responded ?? "waiting"}`);
    if (args.dryRun) {
      console.log("Dry run: nothing was sent.");
      return;
    }
    const admin = await client();
    const { data, error } = await admin.rpc("record_support_response", {
      p_organization_id: args.firm,
      p_ticket_ref: args.ticket,
      p_received_at: args.received,
      p_first_response_at: args.responded,
      p_recorded_by: args.recordedBy,
    });
    if (error) throw new Error(`record_support_response: ${error.message}`);
    console.log(`Recorded ${data}`);
    return;
  }
  const admin = await client();
  const { data, error } = await admin.rpc("service_level_report", { p_organization_id: args.firm, p_months: args.months });
  if (error) throw new Error(`service_level_report: ${error.message}`);
  console.log(`Firm ${args.firm} · months in ${data.timezone}`);
  console.log(`Uptime: ${data.uptime?.measured ? "measured" : "Not measured yet (no monitoring source is recorded)"}`);
  console.log("Month     Requests  Answered  Waiting  Median    Longest");
  for (const row of data.months ?? []) {
    const s = row.support;
    console.log(
      `${row.month}   ${String(s.received).padEnd(8)}  ${String(s.answered).padEnd(8)}  ${String(s.waiting).padEnd(7)}  ${minutes(s.median_seconds).padEnd(8)}  ${minutes(s.longest_seconds)}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
