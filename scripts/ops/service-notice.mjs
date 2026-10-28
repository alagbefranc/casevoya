#!/usr/bin/env node
// Posts, updates, resolves and lists Casevoya service notices (ADM-04): maintenance, incident or
// information notices that firm staff see as a banner on every Sheet page while current, and in
// Settings > Security > Service notices. There is no platform admin web UI: a platform admin runs
// this with the service role, naming themselves (a public.platform_admins row) as the one who acts,
// like import-cicc-list.mjs. Every post, update and resolve is audited in public.audit_log with the
// acting admin. Decision 2026-10-25.
//
// Usage:
//   node scripts/ops/service-notice.mjs post --by <platform-admin-user-id> --kind maintenance|incident|info
//        --title "..." --body "..." [--severity info|minor|major] [--starts <ISO time>] [--ends <ISO time>]
//        (--all-firms | --firm <slug-or-id> [--firm ...]) [--draft] [--dry-run]
//   node scripts/ops/service-notice.mjs update <notice-id> --by <id> [--title ...] [--body ...]
//        [--severity ...] [--starts ...] [--ends ...] [--publish]
//   node scripts/ops/service-notice.mjs resolve <notice-id> --by <id> --note "How it was resolved"
//   node scripts/ops/service-notice.mjs list [--all]
//
// Times are ISO 8601 with an offset, e.g. 2026-10-25T22:00:00-04:00 (firms see them in their own
// timezone). Maintenance needs --ends. Text is plain (shown as text, never HTML): title 3-120
// characters, body up to 1000. Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (the service
// role) unless --dry-run. Prints ids and counts, never secrets.
import path from "node:path";

const KINDS = new Set(["maintenance", "incident", "info"]);
const SEVERITIES = new Set(["info", "minor", "major"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

/** Parses argv into { command, id, options }. Repeated --firm values are collected. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!["post", "update", "resolve", "list"].includes(command ?? "")) {
    throw new Error("Usage: node scripts/ops/service-notice.mjs post|update|resolve|list ... (see the header of this file)");
  }
  const options = { firms: [], allFirms: false, draft: false, publish: false, dryRun: false, all: false };
  let id = null;
  const value = (i, flag) => {
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
    return next;
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--by") options.by = value(i++, arg);
    else if (arg === "--kind") options.kind = value(i++, arg);
    else if (arg === "--severity") options.severity = value(i++, arg);
    else if (arg === "--title") options.title = value(i++, arg);
    else if (arg === "--body") options.body = value(i++, arg);
    else if (arg === "--starts") options.starts = value(i++, arg);
    else if (arg === "--ends") options.ends = value(i++, arg);
    else if (arg === "--note") options.note = value(i++, arg);
    else if (arg === "--firm") options.firms.push(value(i++, arg));
    else if (arg === "--all-firms") options.allFirms = true;
    else if (arg === "--draft") options.draft = true;
    else if (arg === "--publish") options.publish = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--all") options.all = true;
    else if (!arg.startsWith("--") && id === null) id = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { command, id, options };
}

function isoOrNull(text, flag) {
  if (text === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${flag} must be an ISO time with an offset, e.g. 2026-10-25T22:00:00-04:00.`);
  }
  return new Date(text).toISOString();
}

function requireAdmin(by) {
  if (!by || !UUID.test(by)) throw new Error("--by <platform-admin-user-id> is required: the platform admin who acts.");
  return by;
}

/** Checks a post request and returns the RPC arguments (firms still as given: slugs or ids). */
export function postRequest(options) {
  const by = options.dryRun ? (options.by ?? null) : requireAdmin(options.by);
  if (!KINDS.has(options.kind ?? "")) throw new Error("--kind must be maintenance, incident or info.");
  const severity = options.severity ?? "minor";
  if (!SEVERITIES.has(severity)) throw new Error("--severity must be info, minor or major.");
  const title = (options.title ?? "").trim();
  const body = (options.body ?? "").trim();
  if (title.length < 3 || title.length > 120) throw new Error("--title must be 3 to 120 characters.");
  if (body.length < 1 || body.length > 1000) throw new Error("--body must be 1 to 1000 characters.");
  const starts = isoOrNull(options.starts, "--starts");
  const ends = isoOrNull(options.ends, "--ends");
  if (options.kind === "maintenance" && !ends) throw new Error("Maintenance needs --ends.");
  if (ends && Date.parse(ends) <= Date.parse(starts ?? new Date().toISOString())) throw new Error("--ends must be after --starts (or after now).");
  if (options.allFirms === (options.firms.length > 0)) throw new Error("Choose --all-firms or one or more --firm <slug-or-id>.");
  for (const firm of options.firms) {
    if (!UUID.test(firm) && !SLUG.test(firm)) throw new Error(`Not a firm slug or id: ${firm}`);
  }
  return { by, kind: options.kind, severity, title, body, starts, ends, firms: options.allFirms ? null : [...new Set(options.firms)], publish: !options.draft };
}

async function client() {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
    if (!process.env[name]) throw new Error(`${name} is not set.`);
  }
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
}

/** Firm slugs or ids to ids; every one must exist. */
async function firmIds(admin, firms) {
  const ids = firms.filter((firm) => UUID.test(firm));
  const slugs = firms.filter((firm) => !UUID.test(firm));
  const found = new Map();
  if (ids.length) {
    const { data, error } = await admin.from("organizations").select("id, slug, display_name").in("id", ids);
    if (error) throw new Error(`organizations: ${error.message}`);
    for (const row of data ?? []) found.set(row.id, row);
  }
  if (slugs.length) {
    const { data, error } = await admin.from("organizations").select("id, slug, display_name").in("slug", slugs);
    if (error) throw new Error(`organizations: ${error.message}`);
    for (const row of data ?? []) found.set(row.slug, row);
  }
  const missing = firms.filter((firm) => !found.has(firm));
  if (missing.length) throw new Error(`No firm with slug or id: ${missing.join(", ")}`);
  return firms.map((firm) => found.get(firm));
}

async function main() {
  const { command, id, options } = parseArgs(process.argv.slice(2));
  if (command === "post") {
    const request = postRequest(options);
    console.log(`${request.publish ? "Publish" : "Draft"} ${request.kind} (${request.severity}) "${request.title}" to ${request.firms ? `${request.firms.length} firm(s)` : "all firms"}.`);
    if (options.dryRun) {
      console.log("Dry run: nothing was sent.");
      return;
    }
    const admin = await client();
    const firms = request.firms ? await firmIds(admin, request.firms) : null;
    if (firms) console.log(`Firms: ${firms.map((row) => `${row.slug} (${row.id})`).join(", ")}`);
    const { data, error } = await admin.rpc("post_service_notice", {
      p_kind: request.kind,
      p_severity: request.severity,
      p_title: request.title,
      p_body: request.body,
      p_starts_at: request.starts,
      p_ends_at: request.ends,
      p_organization_ids: firms ? firms.map((row) => row.id) : null,
      p_publish: request.publish,
      p_acting_admin: request.by,
    });
    if (error) throw new Error(`post_service_notice: ${error.message}`);
    console.log(`Notice ${data} ${request.publish ? "published" : "saved as a draft"}.`);
    return;
  }
  if (command === "update") {
    if (!id || !UUID.test(id)) throw new Error("update <notice-id> is required.");
    const by = requireAdmin(options.by);
    if (options.severity && !SEVERITIES.has(options.severity)) throw new Error("--severity must be info, minor or major.");
    const admin = await client();
    const { error } = await admin.rpc("update_service_notice", {
      p_notice_id: id,
      p_severity: options.severity ?? null,
      p_title: options.title ?? null,
      p_body: options.body ?? null,
      p_starts_at: isoOrNull(options.starts, "--starts"),
      p_ends_at: isoOrNull(options.ends, "--ends"),
      p_publish: options.publish,
      p_acting_admin: by,
    });
    if (error) throw new Error(`update_service_notice: ${error.message}`);
    console.log(`Notice ${id} updated${options.publish ? " and published" : ""}.`);
    return;
  }
  if (command === "resolve") {
    if (!id || !UUID.test(id)) throw new Error("resolve <notice-id> is required.");
    const by = requireAdmin(options.by);
    const note = (options.note ?? "").trim();
    if (note.length < 3 || note.length > 1000) throw new Error("--note (3 to 1000 characters) says how it was resolved; firms read it.");
    const admin = await client();
    const { error } = await admin.rpc("resolve_service_notice", { p_notice_id: id, p_resolution_note: note, p_acting_admin: by });
    if (error) throw new Error(`resolve_service_notice: ${error.message}`);
    console.log(`Notice ${id} resolved.`);
    return;
  }
  const admin = await client();
  let query = admin.from("service_notices").select("id, kind, severity, status, audience, title, starts_at, ends_at, resolved_at").order("created_at", { ascending: false }).limit(50);
  if (!options.all) query = query.neq("status", "resolved");
  const { data, error } = await query;
  if (error) throw new Error(`service_notices: ${error.message}`);
  if (!data?.length) console.log(options.all ? "No notices." : "No open notices (use --all to include resolved ones).");
  for (const row of data ?? []) {
    console.log(`${row.id}  ${row.status.padEnd(9)} ${row.kind.padEnd(11)} ${row.severity.padEnd(5)} ${row.audience.padEnd(12)} ${row.starts_at} -> ${row.ends_at ?? "open"}  ${row.title}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
