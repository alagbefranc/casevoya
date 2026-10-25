import { NextResponse } from "next/server";
import { commitMigrationDocuments, isMigrationAction, runMigrationAction, uploadMigrationFile, type MigrationResult } from "@/modules/migration/actions";
import { migrationReportResponse } from "@/modules/migration/report-download";

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

/** MIG-02: `/api/migration/report?batch=<id>&format=csv|pdf`, a finished import's run report (firm owner). */
export async function GET(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action !== "report") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const url = new URL(request.url);
  return migrationReportResponse(url.searchParams.get("batch") ?? "", url.searchParams.get("format") === "pdf" ? "pdf" : "csv");
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "This request must come from Casevoya." }, { status: 403 });
  }
  const { action } = await params;
  if (action === "upload") {
    // MIG-01: a documents import sends its ZIP (up to 25 MB) with the manifest CSV.
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 32 * 1024 * 1024) return NextResponse.json({ error: "The files are too large. Split them and import each part." }, { status: 413 });
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Choose a CSV file." }, { status: 400 });
    }
    const org = form.get("organizationId");
    const file = form.get("file");
    const kind = form.get("kind");
    const zip = form.get("zip");
    if (!(zip instanceof File) && file instanceof File && file.size > 5 * 1024 * 1024) {
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
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 26 * 1024 * 1024) return NextResponse.json({ error: "The ZIP is larger than 25 MB." }, { status: 413 });
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Choose the same ZIP you uploaded." }, { status: 400 });
    }
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  return reply(await runMigrationAction(action, body));
}
