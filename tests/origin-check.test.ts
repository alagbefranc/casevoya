import { describe, expect, it, vi } from "vitest";
import { SAME_ORIGIN_ERROR } from "@/lib/security/origin";

const leads = vi.hoisted(() => ({ calls: 0 }));
const video = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/modules/leads/actions", () => ({
  isLeadAction: (action: string) => action === "move",
  runLeadAction: async () => {
    leads.calls += 1;
    return { ok: true };
  },
}));

vi.mock("@/modules/video/service", () => ({
  validCall: () => true,
  endCall: async () => {
    video.calls += 1;
    return { ok: true as const };
  },
}));

function post(url: string, origin?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new Request(url, { method: "POST", headers, body: "{}" });
}

describe("mutating routes require this site's Origin", () => {
  it("refuses /api/leads without this origin and accepts a same-origin post", async () => {
    const { POST } = await import("@/app/api/leads/[action]/route");
    leads.calls = 0;
    const cross = await POST(post("https://app.casevoya.ca/api/leads/move", "https://evil.example"), { params: Promise.resolve({ action: "move" }) });
    expect(cross.status).toBe(403);
    expect(await cross.json()).toEqual({ error: SAME_ORIGIN_ERROR });
    const missing = await POST(post("https://app.casevoya.ca/api/leads/move"), { params: Promise.resolve({ action: "move" }) });
    expect(missing.status).toBe(403);
    expect(leads.calls).toBe(0);
    const same = await POST(post("https://app.casevoya.ca/api/leads/move", "https://app.casevoya.ca"), { params: Promise.resolve({ action: "move" }) });
    expect(same.status).toBe(200);
    expect(leads.calls).toBe(1);
  });

  it("refuses /api/video/:ref/end without this origin and accepts a same-origin post", async () => {
    const { POST } = await import("@/app/api/video/[ref]/end/route");
    video.calls = 0;
    const cross = await POST(post("https://app.casevoya.ca/api/video/abc/end", "https://other.example"), { params: Promise.resolve({ ref: "abc" }) });
    expect(cross.status).toBe(403);
    expect(await cross.json()).toEqual({ error: SAME_ORIGIN_ERROR });
    expect(video.calls).toBe(0);
    const same = await POST(post("https://app.casevoya.ca/api/video/abc/end", "https://app.casevoya.ca"), { params: Promise.resolve({ ref: "abc" }) });
    expect(same.status).toBe(200);
    expect(video.calls).toBe(1);
  });
});
