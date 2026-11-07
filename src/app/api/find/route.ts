import { NextResponse } from "next/server";
import { rateLimit, requestIp, tooManyRequests } from "@/lib/security/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import { FIND_CONSENT_STATEMENT, FIND_CONSENT_VERSION, FIND_NOT_SENT, findAddressHash, readFindRequest } from "@/modules/find/request";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Public consultant introduction on find.casevoya.ca. Unauthenticated. Stores one row with
 * status New. It does not create a firm lead, email a firm, or record a fee.
 */
export async function POST(request: Request) {
  if (!(await rateLimit("RL_PUBLIC", requestIp(request.headers)))) return tooManyRequests();
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return NextResponse.json({ error: "invalid", message: FIND_NOT_SENT }, { status: 415, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid", message: FIND_NOT_SENT }, { status: 400, headers: NO_STORE });
  }
  const read = readFindRequest(body);
  if ("error" in read) {
    return NextResponse.json({ error: read.error, message: FIND_NOT_SENT }, { status: 400, headers: NO_STORE });
  }
  const input = read.input;
  try {
    const hash = await findAddressHash(request.headers, process.env.BOOKING_CLIENT_SALT ?? "");
    const { data, error } = await createServiceClient().rpc("submit_consultant_connect", {
      p_goal: input.goal,
      p_country: input.country,
      p_code: input.code,
      p_zone: input.zone,
      p_language: input.language,
      p_name: input.name,
      p_email: input.email,
      p_consent: true,
      p_statement: FIND_CONSENT_STATEMENT,
      p_consent_version: FIND_CONSENT_VERSION,
      p_ip_hash: hash,
      p_user_agent: request.headers.get("user-agent"),
    });
    if (error) throw new Error("submit_consultant_connect failed");
    if (!data) {
      return NextResponse.json(
        { error: "rate_limited", message: FIND_NOT_SENT },
        { status: 429, headers: { ...NO_STORE, "Retry-After": "600" } },
      );
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "unavailable", message: FIND_NOT_SENT }, { status: 502, headers: NO_STORE });
  }
}
