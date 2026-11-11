import { NextResponse } from "next/server";
import { readLimitedBody } from "@/lib/http/limited-body";
import { CSP_REPORT_MAX_BYTES, cspViolationLogs } from "@/lib/security/csp-report";

/**
 * Browser CSP reports. No session and no Origin check: browsers send these without a reliable
 * Origin. A body over 16 KB is refused. A malformed body is dropped. Each kept violation is one
 * warning line for the Workers logs. Nothing is written to the database.
 */
export async function POST(request: Request) {
  const media = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (media !== "application/csp-report" && media !== "application/reports+json") {
    return new NextResponse(null, { status: 204 });
  }
  const body = await readLimitedBody(request, CSP_REPORT_MAX_BYTES);
  if (!body.ok) return new NextResponse(null, { status: 413 });
  let parsed: unknown = null;
  try {
    const text = new TextDecoder().decode(body.bytes);
    if (text.length > 0) parsed = JSON.parse(text) as unknown;
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  for (const violation of cspViolationLogs(media, parsed)) {
    console.warn(JSON.stringify(violation));
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
