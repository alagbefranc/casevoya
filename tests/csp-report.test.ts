import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSP_REPORT_MAX_BYTES, CSP_REPORT_MAX_PER_REQUEST } from "@/lib/security/csp-report";

const calls = vi.hoisted(() => ({ claims: 0 }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => {
        calls.claims += 1;
        return { data: null };
      },
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));

const LEGACY = {
  "csp-report": {
    "effective-directive": "script-src",
    "blocked-uri": "https://evil.example/steal?token=secret",
    "document-uri": "https://app.casevoya.ca/sheet?token=secret",
    "source-file": "https://cdn.example/app.js?token=secret",
    disposition: "report",
    "line-number": 12,
    "original-policy": "script-src 'self'; report-uri /api/csp-report",
    cookie: "session=secret",
  },
};

function post(body: string, type: string) {
  return new Request("https://app.casevoya.ca/api/csp-report", {
    method: "POST",
    headers: { "content-type": type },
    body,
  });
}

beforeEach(() => {
  calls.claims = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/csp-report", () => {
  it("returns 204 for both report content types, without Origin or a session", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const legacy = await POST(post(JSON.stringify(LEGACY), "application/csp-report"));
    expect(legacy.status).toBe(204);
    expect(legacy.headers.get("location")).toBeNull();

    const modern = await POST(
      post(
        JSON.stringify([
          {
            type: "csp-violation",
            body: {
              effectiveDirective: "connect-src",
              blockedURL: "https://blocked.example/path?q=1",
              documentURL: "https://app.casevoya.ca/portal?next=/secret",
              sourceFile: "https://js.stripe.com/v3?x=1",
              disposition: "report",
              lineNumber: 4,
            },
          },
        ]),
        "application/reports+json",
      ),
    );
    expect(modern.status).toBe(204);

    const lines = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      event: "csp.violation",
      directive: "script-src",
      blocked_uri: "https://evil.example",
      document_uri: "/sheet",
      disposition: "report",
      source_file: "https://cdn.example",
      line: 12,
    });
    expect(JSON.parse(lines[1])).toEqual({
      event: "csp.violation",
      directive: "connect-src",
      blocked_uri: "https://blocked.example",
      document_uri: "/portal",
      disposition: "report",
      source_file: "https://js.stripe.com",
      line: 4,
    });
    expect(lines.join("\n")).not.toContain("token");
    expect(lines.join("\n")).not.toContain("secret");
    expect(lines.join("\n")).not.toContain("?");
    expect(lines.join("\n")).not.toContain("cookie");
  });

  it("refuses an oversized body and drops a malformed one", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const over = await POST(post("x".repeat(CSP_REPORT_MAX_BYTES + 1), "application/csp-report"));
    expect(over.status).toBe(413);
    const bad = await POST(post("{", "application/csp-report"));
    expect(bad.status).toBe(204);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("logs only the first reports in one request", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const reports = Array.from({ length: CSP_REPORT_MAX_PER_REQUEST + 4 }, (_, index) => ({
      type: "csp-violation",
      body: { effectiveDirective: "script-src", documentURL: `https://app.casevoya.ca/sheet/${index}`, disposition: "report" },
    }));
    const response = await POST(post(JSON.stringify(reports), "application/reports+json"));
    expect(response.status).toBe(204);
    expect(vi.mocked(console.warn).mock.calls).toHaveLength(CSP_REPORT_MAX_PER_REQUEST);
  });

  it("is reachable through the proxy without auth and without an Origin", async () => {
    const { proxy } = await import("@/proxy");
    const { POST } = await import("@/app/api/csp-report/route");
    const passed = await proxy(new NextRequest("https://app.casevoya.ca/api/csp-report", { method: "POST" }));
    expect(passed.status).toBe(200);
    expect(passed.headers.get("location")).toBeNull();
    expect(calls.claims).toBe(0);

    const response = await POST(post(JSON.stringify(LEGACY), "application/csp-report; charset=utf-8"));
    expect(response.status).toBe(204);
    expect(new Request("https://app.casevoya.ca/api/csp-report", { method: "POST" }).headers.get("origin")).toBeNull();
  });
});
