#!/usr/bin/env node
// Keeps the platform's support catalogue (SRC-12): the programs, jurisdictions and case types on
// "What Casevoya supports" (/supported and Practice > Templates). Support itself is never set here:
// a program reads Supported only when an approved, sourced rule pack exists for it.
//
// capture: fetches a program's official canada.ca (or other allowlisted) page, stores it as a
// platform official source with a snapshot (retrieval time, SHA-256 of the exact bytes, the page's
// "Date modified" exactly as it shows it, or none), and saves the catalogue program with IRCC's name
// for it as the page's main heading shows it (or --official-name). The snapshot starts as a draft:
// the name and link show publicly once the snapshot is verified in the source review workflow.
// A homepage or landing page is refused. Nothing is guessed: if the page can't be fetched, nothing
// is saved; add the program without a source with `entry` (it then shows "Source not captured").
//
// Usage:
//   node scripts/ops/support-catalogue.mjs capture --by <platform-admin-user-id> --key <program_key>
//        --label "Working label" --jurisdiction CA --url <official deep URL> [--section <anchor>]
//        [--case-type ircc_application] [--official-name "..."] [--position 50] [--dry-run]
//   node scripts/ops/support-catalogue.mjs entry --by <id> --kind program|jurisdiction|case_type
//        --key <key> --label "..." [--jurisdiction CA] [--case-type ...] [--note "..."] [--position N] [--inactive]
//   node scripts/ops/support-catalogue.mjs list
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (the service role) unless --dry-run. Every
// save is audited (support_catalogue.saved) with the acting platform admin. Prints ids, never secrets.
import { createHash } from "node:crypto";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9_]{1,80}$/;
const JURISDICTION = /^[A-Z]{2}(-[A-Z0-9]{1,6})?$/;
const KINDS = new Set(["program", "jurisdiction", "case_type"]);
const ALLOWED = ["canada.ca", "cic.gc.ca", "justice.gc.ca", "gc.ca"];
// The homepage rule of app.official_claim_url (SRC-01) and app.src_deep_official_url: at least two
// path segments besides language folders and index pages.
const LANGUAGE_OR_INDEX = /^(en|fr|eng|fra|english|francais|index|home|default|accueil|welcome)$/;

/** Parses argv into { command, options }. */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!["capture", "entry", "list"].includes(command ?? "")) {
    throw new Error("Usage: node scripts/ops/support-catalogue.mjs capture|entry|list ... (see the header of this file)");
  }
  const options = { dryRun: false, active: true };
  const value = (i, flag) => {
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value.`);
    return next;
  };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--by") options.by = value(i++, arg);
    else if (arg === "--kind") options.kind = value(i++, arg);
    else if (arg === "--key") options.key = value(i++, arg);
    else if (arg === "--label") options.label = value(i++, arg);
    else if (arg === "--jurisdiction") options.jurisdiction = value(i++, arg);
    else if (arg === "--case-type") options.caseType = value(i++, arg);
    else if (arg === "--url") options.url = value(i++, arg);
    else if (arg === "--section") options.section = value(i++, arg);
    else if (arg === "--official-name") options.officialName = value(i++, arg);
    else if (arg === "--note") options.note = value(i++, arg);
    else if (arg === "--position") options.position = Number(value(i++, arg));
    else if (arg === "--inactive") options.active = false;
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return { command, options };
}

/** True for an https URL on an official host with a page path: never a site root or landing page (the database's rule). */
export function isDeepOfficialUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (!ALLOWED.some((domain) => host === domain || host.endsWith(`.${domain}`))) return false;
  const meaningful = url.pathname
    .toLowerCase()
    .split("/")
    .map((part) => part.replace(/\.(html?|aspx?|php)$/, ""))
    .filter((part) => part !== "" && !LANGUAGE_OR_INDEX.test(part));
  return meaningful.length >= 2;
}

/** The page's "Date modified" as canada.ca marks it up (YYYY-MM-DD), or null. Never inferred. */
export function parseDateModified(html) {
  const marked = html.match(/<time[^>]*property=["']dateModified["'][^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/time>/i);
  if (marked) return marked[1];
  const labelled = html.match(/Date modified:\s*(?:<[^>]+>\s*)*(\d{4}-\d{2}-\d{2})/i);
  return labelled ? labelled[1] : null;
}

/** The page's main heading, as text, or null. */
export function parseHeading(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return null;
  const text = match[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "’")
    .replace(/\s+/g, " ")
    .trim();
  return text && text.length <= 300 ? text : null;
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireAdmin(by) {
  if (!by || !UUID.test(by)) throw new Error("--by <platform-admin-user-id> is required: the platform admin who acts.");
  return by;
}

/** Checks a capture request. */
export function captureRequest(options) {
  const by = options.dryRun ? (options.by ?? null) : requireAdmin(options.by);
  if (!KEY.test(options.key ?? "")) throw new Error("--key must be a program key: lower case letters, digits and _.");
  const label = (options.label ?? "").trim();
  if (label.length < 1 || label.length > 200) throw new Error("--label must be 1 to 200 characters.");
  if (!JURISDICTION.test(options.jurisdiction ?? "")) throw new Error("--jurisdiction must be a code such as CA or CA-ON.");
  if (options.caseType !== undefined && !KEY.test(options.caseType)) throw new Error("--case-type must be a case type key.");
  if (!isDeepOfficialUrl(options.url ?? "")) throw new Error("--url must be the program's own official page (https, canada.ca or gc.ca), not a homepage or landing page.");
  if (options.section !== undefined && !/^[A-Za-z][\w-]{0,120}$/.test(options.section)) throw new Error("--section must be the page's section anchor (the part after #).");
  return { by, key: options.key, label, jurisdiction: options.jurisdiction, caseType: options.caseType ?? null, url: options.url, section: options.section ?? null };
}

async function client() {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
    if (!process.env[name]) throw new Error(`${name} is not set.`);
  }
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "user-agent": "Casevoya support catalogue capture" } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, finalUrl: response.url || url, bytes };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "capture") {
    const request = captureRequest(options);
    console.log(`Fetching ${request.url} ...`);
    let page;
    try {
      page = await fetchPage(request.url);
    } catch (error) {
      throw new Error(`The page could not be fetched (${error instanceof Error ? error.message : error}). Nothing was saved.`);
    }
    if (page.status !== 200) throw new Error(`The page answered HTTP ${page.status}. Nothing was saved.`);
    if (!isDeepOfficialUrl(page.finalUrl)) throw new Error(`The page redirected to ${page.finalUrl}, which is not a deep official link. Nothing was saved.`);
    const html = new TextDecoder().decode(page.bytes);
    const hash = sha256Hex(page.bytes);
    const modified = parseDateModified(html);
    const heading = parseHeading(html);
    const officialName = (options.officialName ?? heading ?? "").trim() || null;
    const retrievedAt = new Date().toISOString();
    console.log(`SHA-256 ${hash}; date modified ${modified ?? "not shown"}; heading ${heading ? `"${heading}"` : "not found"}.`);
    if (options.dryRun) {
      console.log("Dry run: nothing was saved.");
      return;
    }
    const admin = await client();
    const host = new URL(page.finalUrl).hostname;
    const existing = await admin.from("official_sources").select("id").is("organization_id", null).eq("canonical_url", request.url).maybeSingle();
    if (existing.error) throw new Error(`official_sources: ${existing.error.message}`);
    let sourceId = existing.data?.id ?? null;
    if (!sourceId) {
      const inserted = await admin
        .from("official_sources")
        .insert({
          publisher: host.endsWith("justice.gc.ca") ? "Justice Laws" : "Immigration, Refugees and Citizenship Canada",
          canonical_url: request.url,
          jurisdiction: request.jurisdiction,
          content_kind: "program_guidance",
          title: heading,
          source_language: /\/fr\//.test(new URL(request.url).pathname) ? "fr" : "en",
        })
        .select("id")
        .single();
      if (inserted.error) throw new Error(`official_sources: ${inserted.error.message}`);
      sourceId = inserted.data.id;
    }
    const snapshot = await admin
      .from("source_snapshots")
      .insert({
        source_id: sourceId,
        final_url: page.finalUrl,
        publisher: host.endsWith("justice.gc.ca") ? "Justice Laws" : "Immigration, Refugees and Citizenship Canada",
        retrieved_at: retrievedAt,
        modified_on: modified,
        content_hash: hash,
        retrieval_result: "success",
        http_status: page.status,
      })
      .select("id, snapshot_number")
      .single();
    if (snapshot.error) throw new Error(`source_snapshots: ${snapshot.error.message}`);
    const { data, error } = await admin.rpc("save_support_catalogue_entry", {
      p_scope_kind: "program",
      p_scope_key: request.key,
      p_label: request.label,
      p_jurisdiction: request.jurisdiction,
      p_case_type_key: request.caseType,
      p_snapshot_id: snapshot.data.id,
      p_official_name: officialName,
      p_source_section: request.section,
      p_note: null,
      p_position: Number.isFinite(options.position) ? options.position : null,
      p_active: options.active,
      p_acting_admin: request.by,
    });
    if (error) throw new Error(`save_support_catalogue_entry: ${error.message}`);
    console.log(`Catalogue program ${request.key} saved (${data}) with snapshot ${snapshot.data.id} (#${snapshot.data.snapshot_number}). The snapshot is a draft until it is verified in source review.`);
    return;
  }
  if (command === "entry") {
    const by = requireAdmin(options.by);
    if (!KINDS.has(options.kind ?? "")) throw new Error("--kind must be program, jurisdiction or case_type.");
    const keyOk = options.kind === "jurisdiction" ? JURISDICTION.test(options.key ?? "") : KEY.test(options.key ?? "");
    if (!keyOk) throw new Error("--key is not valid for that kind.");
    const label = (options.label ?? "").trim();
    if (label.length < 1 || label.length > 200) throw new Error("--label must be 1 to 200 characters.");
    const admin = await client();
    const { data, error } = await admin.rpc("save_support_catalogue_entry", {
      p_scope_kind: options.kind,
      p_scope_key: options.key,
      p_label: label,
      p_jurisdiction: options.jurisdiction ?? null,
      p_case_type_key: options.caseType ?? null,
      p_snapshot_id: null,
      p_official_name: null,
      p_source_section: null,
      p_note: options.note ?? null,
      p_position: Number.isFinite(options.position) ? options.position : null,
      p_active: options.active,
      p_acting_admin: by,
    });
    if (error) throw new Error(`save_support_catalogue_entry: ${error.message}`);
    console.log(`Catalogue ${options.kind} ${options.key} saved (${data}).`);
    return;
  }
  const admin = await client();
  const { data, error } = await admin.rpc("support_catalogue", {});
  if (error) throw new Error(`support_catalogue: ${error.message}`);
  for (const row of data?.jurisdictions ?? []) console.log(`jurisdiction ${row.key.padEnd(8)} ${row.supported ? "supported    " : "not supported"} ${row.label}`);
  for (const row of data?.case_types ?? []) console.log(`case type    ${row.key.padEnd(18)} ${row.supported ? "supported    " : "not supported"} ${row.label}`);
  for (const row of data?.programs ?? []) {
    const source = row.official ? `${row.official.reviewed ? "reviewed" : "draft"} ${row.official.url}` : "source not captured";
    console.log(`program      ${row.key.padEnd(30)} ${row.supported ? `supported v${row.pack_version}` : "not supported"}  ${source}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
