#!/usr/bin/env node
// MIG decision 6 (gap #187): measure the documents import's 25 MB ZIP limit on Workers.
//
// Builds a synthetic ZIP of obviously fake PDFs (default 1,000 files, just under 25 MB; every
// file says "SYNTHETIC TEST FILE - NOT A REAL DOCUMENT") and a manifest CSV, then times the
// import's own HTTP steps against a deployment, signed in as a TEST firm's owner:
//
//   stage  (default) upload (CSV + ZIP: the server reads, hashes and types every entry), Map
//          columns + dry run, then Discard. Nothing is created; the firm's import is closed again.
//   pilot  stage, then a documents pilot of --pilot files (each request re-sends the ZIP). The
//          pilot's documents are REAL and CAN'T BE REMOVED (a documents import is never rolled
//          back), and the import stays open waiting for sign-off until --mode full finishes it.
//   full   pilot, the owner's sign-off, and the full run: every file in the ZIP becomes a
//          document on the test firm that can't be removed.
//   local  build the ZIP and manifest only (no network); with --out, write them to disk.
//
// Usage:
//   node scripts/ops/measure-migration-zip.mjs --mode local [--files 1000] [--mb 25] [--out <dir>]
//   node scripts/ops/measure-migration-zip.mjs --base-url <https://test deployment> \
//        --credentials <file outside the repo> --confirm-test-firm <org id> \
//        --matter <reference of a matter on the test firm> --person <email of a client on it> \
//        [--mode stage|pilot|full] [--pilot 5] [--files 1000] [--mb 25] [--method deflate|stored]
//
// The credentials file holds KEY=value lines (the format bootstrap-e2e-owner.mjs writes):
//   E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD, E2E_OWNER_TOTP_SECRET, E2E_ORG_ID,
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// (the last two may come from the environment instead). Secrets are never taken from the command
// line and never printed. --confirm-test-firm must repeat E2E_ORG_ID: the run is refused unless
// you name the test firm twice. Only for a dedicated test firm (the Walk test firm); never a
// real firm's data, never real documents.
//
// Prints each step's wall time, the response, and the local process's memory. Workers memory and
// CPU are not visible from here: watch `wrangler tail` (or the dashboard's Workers metrics) during
// the run for "exceededMemory"/"exceededCpu" outcomes and CPU time per request.
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

export const ZIP_LIMIT_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USAGE = [
  "Usage:",
  "  node scripts/ops/measure-migration-zip.mjs --mode local [--files 1000] [--mb 25] [--method deflate|stored] [--out <dir>]",
  "  node scripts/ops/measure-migration-zip.mjs --base-url <url> --credentials <file> --confirm-test-firm <org id> --matter <ref> --person <email>",
  "       [--mode stage|pilot|full] [--pilot 5] [--files 1000] [--mb 25] [--method deflate|stored]",
].join("\n");

export function parseArgs(argv) {
  const args = { mode: "stage", baseUrl: null, credentials: null, confirm: null, matter: null, person: null, pilot: 5, files: 1000, mb: 25, method: "deflate", out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--mode") args.mode = next();
    else if (arg === "--base-url") args.baseUrl = next();
    else if (arg === "--credentials") args.credentials = next();
    else if (arg === "--confirm-test-firm") args.confirm = next();
    else if (arg === "--matter") args.matter = next();
    else if (arg === "--person") args.person = next();
    else if (arg === "--pilot") args.pilot = Number(next());
    else if (arg === "--files") args.files = Number(next());
    else if (arg === "--mb") args.mb = Number(next());
    else if (arg === "--method") args.method = next();
    else if (arg === "--out") args.out = next();
    else throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
  }
  if (!["local", "stage", "pilot", "full"].includes(args.mode)) throw new Error(`--mode is local, stage, pilot or full.\n${USAGE}`);
  if (!Number.isInteger(args.files) || args.files < 1 || args.files > 1000) throw new Error("--files is 1 to 1,000 (the import's limit).");
  if (!(args.mb > 0 && args.mb <= 25)) throw new Error("--mb is above 0 and at most 25 (the import's limit).");
  if (!["deflate", "stored"].includes(args.method)) throw new Error("--method is deflate or stored.");
  if (!Number.isInteger(args.pilot) || args.pilot < 1 || args.pilot > 50) throw new Error("--pilot is 1 to 50.");
  if (args.mode === "local") return args;
  let url;
  try {
    url = new URL(args.baseUrl ?? "");
  } catch {
    throw new Error(`--base-url <url> is required.\n${USAGE}`);
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("--base-url must be https (or localhost).");
  // The marketing site is not the app.
  if (url.hostname === "casevoya.ca" || url.hostname === "www.casevoya.ca") throw new Error("--base-url must be the app, not the casevoya.ca site.");
  args.baseUrl = url.origin;
  if (!args.credentials) throw new Error("--credentials <file outside the repository> is required.");
  if (path.resolve(args.credentials).startsWith(path.resolve("."))) throw new Error("The credentials file must be outside the repository.");
  if (!args.confirm || !UUID.test(args.confirm)) throw new Error("--confirm-test-firm <the test firm's org id> is required.");
  if (!args.matter || !args.person) throw new Error("--matter <reference> and --person <email> of a client on that matter, both on the test firm, are required.");
  return args;
}

/** One synthetic PDF: a valid header, the words that say it is fake, and padding to the size. */
export function syntheticPdf(index, size, method = "deflate") {
  const head = Buffer.from(
    `%PDF-1.4\n% SYNTHETIC TEST FILE - NOT A REAL DOCUMENT - Casevoya migration measurement file ${index}\n` +
      "1 0 obj << /Type /Catalog >> endobj\n" +
      "2 0 obj << /Length 0 >> stream\n",
    "latin1",
  );
  const tail = Buffer.from("\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");
  const fill = Math.max(0, size - head.length - tail.length);
  // Deflate: random bytes, so the ZIP is as large as its contents (as with real scans). Stored:
  // a repeated fake line (the ZIP stores it as is).
  const pad = method === "deflate" ? randomBytes(fill) : Buffer.alloc(fill, "SYNTHETIC PADDING ");
  return Buffer.concat([head, pad, tail]);
}

/**
 * A ZIP (no ZIP64, no encryption) of `files` synthetic PDFs, sized to land just under `targetBytes`.
 * Returns the bytes and the entries' paths.
 */
export function buildSyntheticZip({ files = 1000, targetBytes = ZIP_LIMIT_BYTES - 64 * 1024, method = "deflate" } = {}) {
  const names = Array.from({ length: files }, (_, i) => `synthetic/synthetic-test-file-${String(i + 1).padStart(4, "0")}.pdf`);
  // Per entry: local header (30 + name) + central header (46 + name); end record 22 bytes.
  const overhead = names.reduce((sum, name) => sum + 76 + 2 * Buffer.byteLength(name), 22);
  // Deflate of random bytes adds a little (stored blocks); leave room for it.
  const each = Math.floor(((targetBytes - overhead) * (method === "deflate" ? 0.998 : 1)) / files);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [index, name] of names.entries()) {
    const data = syntheticPdf(index + 1, each, method);
    const body = method === "deflate" ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method === "deflate" ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method === "deflate" ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files, 8);
  end.writeUInt16LE(files, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const bytes = new Uint8Array(Buffer.concat([...locals, directory, end]));
  return { bytes, names };
}

/** The manifest CSV for those files: one documents-import row each, on one test matter and client. */
export function buildManifest(names, { matter, person, day = "2019-03-04" }) {
  const quote = (value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = ["File name,Client,Matter,Document type,Document date"];
  for (const name of names) lines.push([name, person, matter, "Synthetic test file", day].map(quote).join(","));
  return `${lines.join("\n")}\n`;
}

function memory() {
  const used = process.memoryUsage();
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `local rss ${mb(used.rss)}, heap ${mb(used.heapUsed)}, buffers ${mb(used.arrayBuffers)}`;
}

async function timed(label, run) {
  const started = performance.now();
  const result = await run();
  const ms = performance.now() - started;
  console.log(`${label}: ${(ms / 1000).toFixed(2)} s${result?.status ? ` (HTTP ${result.status})` : ""}`);
  return { ms, result };
}

function readCredentials(file) {
  const values = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) values[name] ??= process.env[name];
  for (const name of ["E2E_OWNER_EMAIL", "E2E_OWNER_PASSWORD", "E2E_OWNER_TOTP_SECRET", "E2E_ORG_ID", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
    if (!values[name]) throw new Error(`${name} is missing from the credentials file (or the environment).`);
  }
  return values;
}

/** Signs in with password and a fresh TOTP (two-step, so the step-up is fresh) and returns the app's session cookies. */
async function signIn(creds) {
  const { createClient } = await import("@supabase/supabase-js");
  const { createServerClient } = await import("@supabase/ssr");
  const { totp } = await import("./totp.mjs");
  const supabase = createClient(creds.NEXT_PUBLIC_SUPABASE_URL, creds.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const signedIn = await supabase.auth.signInWithPassword({ email: creds.E2E_OWNER_EMAIL, password: creds.E2E_OWNER_PASSWORD });
  if (signedIn.error) throw new Error(`Sign-in failed: ${signedIn.error.message}`);
  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp?.[0];
  if (!factor) throw new Error("The test owner has no two-step factor.");
  const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(creds.E2E_OWNER_TOTP_SECRET) });
  if (verified.error) throw new Error(`Two-step failed: ${verified.error.message}`);
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("No session after sign-in.");
  const jar = new Map();
  const ssr = createServerClient(creds.NEXT_PUBLIC_SUPABASE_URL, creds.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  await ssr.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function post(base, cookie, action, body) {
  const json = !(body instanceof FormData);
  const response = await fetch(`${base}/api/migration/${action}`, {
    method: "POST",
    headers: { origin: base, cookie, ...(json ? { "content-type": "application/json" } : {}) },
    body: json ? JSON.stringify(body) : body,
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = { error: `not JSON (HTTP ${response.status})` };
  }
  return { status: response.status, data };
}

function zipForm(org, batch, zip, pilot) {
  const form = new FormData();
  form.set("org", org);
  form.set("batch", batch);
  form.set("zip", new Blob([zip], { type: "application/zip" }), "synthetic-measurement.zip");
  if (pilot) {
    form.set("step", "pilot");
    form.set("size", String(pilot));
    form.set("system", "Synthetic measurement");
  }
  return form;
}

/** Re-sends the ZIP until the documents step reports nothing left, timing each request. */
async function documentsLoop(base, cookie, org, batch, zip, pilot) {
  const times = [];
  for (let round = 1; round <= 400; round += 1) {
    const { ms, result } = await timed(`  ${pilot ? "pilot" : "full run"} request ${round}`, () => post(base, cookie, "commit-documents", zipForm(org, batch, zip, round === 1 ? pilot : null)));
    times.push(ms);
    if (result.status !== 200) {
      console.log(`  stopped: ${JSON.stringify(result.data)}`);
      return { times, ok: false };
    }
    if (!(Number(result.data.remaining) > 0)) return { times, ok: true, status: result.data.status };
  }
  return { times, ok: false };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetBytes = Math.min(ZIP_LIMIT_BYTES - 64 * 1024, Math.floor(args.mb * 1024 * 1024) - 64 * 1024);
  console.log(`Building a synthetic ZIP: ${args.files} files, about ${(targetBytes / 1024 / 1024).toFixed(2)} MB, ${args.method}.`);
  const built = await timed("Build ZIP", async () => buildSyntheticZip({ files: args.files, targetBytes, method: args.method }));
  const { bytes, names } = built.result;
  console.log(`ZIP: ${bytes.length.toLocaleString("en-CA")} bytes (limit ${ZIP_LIMIT_BYTES.toLocaleString("en-CA")}). ${memory()}`);
  if (bytes.length > ZIP_LIMIT_BYTES) throw new Error("The synthetic ZIP came out over 25 MB; lower --mb.");

  if (args.mode === "local") {
    if (args.out) {
      mkdirSync(args.out, { recursive: true });
      writeFileSync(path.join(args.out, "synthetic-measurement.zip"), bytes);
      writeFileSync(path.join(args.out, "synthetic-manifest.csv"), buildManifest(names, { matter: "SYN-TEST-1", person: "synthetic.client@example.test" }));
      console.log(`Wrote synthetic-measurement.zip and synthetic-manifest.csv to ${args.out}. Delete them when done.`);
    }
    return;
  }

  const creds = readCredentials(args.credentials);
  if (creds.E2E_ORG_ID !== args.confirm) throw new Error("--confirm-test-firm doesn't match the credentials' E2E_ORG_ID. Refusing.");
  const org = creds.E2E_ORG_ID;
  const base = args.baseUrl;
  console.log(`Target ${base}, test firm ${org}, mode ${args.mode}.`);
  if (args.mode !== "stage") {
    console.log(
      args.mode === "pilot"
        ? `The pilot stores ${args.pilot} synthetic documents on ${args.person} that can't be removed, and leaves the import open until it is signed off and finished (--mode full).`
        : `The full run stores all ${args.files} synthetic documents on ${args.person}; they can't be removed.`,
    );
  }
  const cookie = await signIn(creds);
  const manifest = buildManifest(names, { matter: args.matter, person: args.person });

  const upload = new FormData();
  upload.set("organizationId", org);
  upload.set("kind", "documents");
  upload.set("file", new Blob([manifest], { type: "text/csv" }), "synthetic-manifest.csv");
  upload.set("zip", new Blob([bytes], { type: "application/zip" }), "synthetic-measurement.zip");
  const staged = await timed("Upload (CSV + ZIP read, hashed and typed on the server)", () => post(base, cookie, "upload", upload));
  console.log(`  ${JSON.stringify(staged.result.data)} · ${memory()}`);
  const batch = staged.result.data.id;
  if (staged.result.status !== 200 || !batch) return;

  const mapping = { columns: { file: 0, person: 1, reference: 2, document_type: 3, dated_on: 4 }, date_order: "ymd", values: {} };
  const mapped = await timed("Map columns + dry run", () => post(base, cookie, "map", { org, batch, mapping }));
  console.log(`  ${JSON.stringify(mapped.result.data)}`);

  if (args.mode === "stage" || mapped.result.status !== 200) {
    const discarded = await timed("Discard (nothing created)", () => post(base, cookie, "discard", { org, batch }));
    console.log(`  ${JSON.stringify(discarded.result.data)}`);
    return;
  }

  const pilot = await documentsLoop(base, cookie, org, batch, bytes, args.pilot);
  console.log(`Pilot: ${pilot.times.length} request(s), ${(pilot.times.reduce((a, b) => a + b, 0) / 1000).toFixed(2)} s in all.`);
  if (!pilot.ok || args.mode === "pilot") return;

  const signed = await timed("Sign off the pilot", () => post(base, cookie, "signoff", { org, batch, note: "Synthetic measurement pilot checked (test firm, fake files)." }));
  console.log(`  ${JSON.stringify(signed.result.data)}`);
  if (signed.result.status !== 200) return;
  const full = await documentsLoop(base, cookie, org, batch, bytes, null);
  console.log(`Full run: ${full.times.length} request(s), ${(full.times.reduce((a, b) => a + b, 0) / 1000).toFixed(2)} s in all, status ${full.status ?? "stopped"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
