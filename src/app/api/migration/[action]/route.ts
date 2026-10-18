import { NextResponse } from "next/server";
import { isMigrationAction, runMigrationAction, uploadMigrationFile, type MigrationResult } from "@/modules/migration/actions";

/**
 * Migration import (T044): `/api/migration/upload` takes the CSV as multipart form data and parses
 * it here (5 MB, 5,000 rows); `map`, `decide`, `commit`, `rollback` and `discard` take JSON. The
 * database functions decide every write as the signed-in firm owner.
 */
function reply(result: MigrationResult) {
  if ("error" in result) {
    const status = result.error === "Sign in first." ? 401 : result.stepUp ? 403 : result.reasons ? 409 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "This request must come from Casevoya." }, { status: 403 });
  }
  const { action } = await params;
  if (action === "upload") {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 6 * 1024 * 1024) return NextResponse.json({ error: "The file is larger than 5 MB. Split it and import each part." }, { status: 413 });
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Choose a CSV file." }, { status: 400 });
    }
    const org = form.get("organizationId");
    const file = form.get("file");
    return reply(await uploadMigrationFile(typeof org === "string" ? org : "", file instanceof File ? file : null));
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
