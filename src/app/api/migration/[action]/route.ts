import { NextResponse } from "next/server";
import { readLimitedBody } from "@/lib/http/limited-body";
import {
  commitMigrationDocuments,
  isMigrationAction,
  migrationRequestGate,
  runMigrationAction,
  uploadMigrationFile,
  type MigrationResult,
} from "@/modules/migration/actions";
import { MIGRATION_MAX_BYTES } from "@/modules/migration/csv";
import { migrationReportResponse } from "@/modules/migration/report-download";
import { MIGRATION_ZIP_MAX_BYTES } from "@/modules/migration/zip";

/**
 * Migration import (T044): `/api/migration/upload` takes the CSV as multipart form data and parses
 * it here (5 MB, 5,000 rows); `map`, `decide`, `pilot`, `signoff`, `commit`, `rollback` and `discard` take JSON. The
 * database functions decide every write as the signed-in firm owner.
 */
function reply(result: MigrationResult) {
  if ("error" in result) {
    const status = result.error === "Sign in first." ? 401 : result.stepUp ? 403 : result.reasons ? 409 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}

const MB = 1024 * 1024;
/** Request body limits, checked before (Content-Length) and while the body is read. */
const UPLOAD_MAX_BYTES = MIGRATION_ZIP_MAX_BYTES + MIGRATION_MAX_BYTES + 2 * MB; // ZIP + CSV + form overhead
const DOCUMENTS_MAX_BYTES = MIGRATION_ZIP_MAX_BYTES + MB;
const JSON_MAX_BYTES = MIGRATION_MAX_BYTES;

/** MIG-02: `/api/migration/report?batch=<id>&format=csv|pdf`, a finished import's run report (firm owner). */
export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action !== "report") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const url = new URL(request.url);
  return migrationReportResponse(url.searchParams.get("batch") ?? "", url.searchParams.get("format") === "pdf" ? "pdf" : "csv");
}

/** The body as form data, read within `maxBytes`; or the response that refuses it. */
async function readForm(request: Request, maxBytes: number, tooLarge: string, unreadable: string): Promise<FormData | NextResponse> {
  const body = await readLimitedBody(request, maxBytes);
  if (!body.ok) {
    return body.reason === "too_large"
      ? NextResponse.json({ error: tooLarge }, { status: 413 })
      : NextResponse.json({ error: unreadable }, { status: 400 });
  }
  try {
    return await new Response(body.bytes, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return NextResponse.json({ error: unreadable }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "This request must come from Casevoya." }, { status: 403 });
  }
  const { action } = await params;
  if (action !== "upload" && action !== "commit-documents" && !isMigrationAction(action)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  // Who may import is settled before any of the body is read.
  const gate = await migrationRequestGate();
  if ("error" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });

  if (action === "upload") {
    // MIG-01: a documents import sends its ZIP (up to 25 MB) with the manifest CSV.
    const form = await readForm(request, UPLOAD_MAX_BYTES, "The files are too large. Split them and import each part.", "Choose a CSV file.");
    if (form instanceof NextResponse) return form;
    const org = form.get("organizationId");
    const file = form.get("file");
    const kind = form.get("kind");
    const zip = form.get("zip");
    if (!(zip instanceof File) && file instanceof File && file.size > MIGRATION_MAX_BYTES) {
      return NextResponse.json({ error: "The file is larger than 5 MB. Split it and import each part." }, { status: 413 });
    }
    return reply(
      await uploadMigrationFile(
        typeof org === "string" ? org : "",
        file instanceof File ? file : null,
        typeof kind === "string" && kind ? kind : "clients_matters",
        zip instanceof File ? zip : null,
      ),
    );
  }
  if (action === "commit-documents") {
    const form = await readForm(request, DOCUMENTS_MAX_BYTES, "The ZIP is larger than 25 MB.", "Choose the same ZIP you uploaded.");
    if (form instanceof NextResponse) return form;
    const org = form.get("org");
    const batch = form.get("batch");
    const zip = form.get("zip");
    // MIG-02: the pilot of a documents import sends the pilot size (and source system) with the ZIP.
    const step = form.get("step");
    const size = form.get("size");
    const system = form.get("system");
    const pilot =
      step === "pilot"
        ? { size: Number(typeof size === "string" ? size : ""), ...(typeof system === "string" && system.trim() ? { system: system.trim() } : {}) }
        : null;
    return reply(
      await commitMigrationDocuments(typeof org === "string" ? org : "", typeof batch === "string" ? batch : "", zip instanceof File ? zip : null, pilot),
    );
  }
  if (!isMigrationAction(action)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const read = await readLimitedBody(request, JSON_MAX_BYTES);
  if (!read.ok) {
    return read.reason === "too_large"
      ? NextResponse.json({ error: "The request is too large." }, { status: 413 })
      : NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(read.bytes));
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  return reply(await runMigrationAction(action, body));
}
