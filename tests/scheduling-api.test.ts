import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeStarts } from "@/modules/scheduling/slots";
import { buildIcs, icsText } from "@/modules/scheduling/ics";
import { clientHash, getPublicEvent, getPublicSlots, postPublicHold, type HoldArgs, type PublicDeps } from "@/modules/scheduling/public-api";

const NOW = Date.parse("2026-10-19T12:00:00Z"); // Monday 08:00 in Toronto
const EVENT = {
  event_type_id: "11111111-1111-4111-8111-111111111111",
  firm_name: "Synthetic Firm",
  firm_slug: "synthetic",
  firm_time_zone: "America/Toronto",
  slug: "initial",
  title: "Initial consultation",
  description: null,
  duration_min: 30,
  location_kind: "video",
  location_detail: null,
  price_cents: 0,
  currency: "CAD",
  min_notice_min: 60,
  max_advance_days: 30,
};

function availability(busy: { start: string; end: string }[] = []) {
  return {
    event: { duration_min: 30, slot_step_min: null, buffer_before_min: 0, buffer_after_min: 0, min_notice_min: 60, max_advance_days: 30, daily_capacity: null },
    now: new Date(NOW).toISOString(),
    hosts: [
      {
        position: 1,
        time_zone: "America/Toronto",
        rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "12:00" })),
        overrides: [],
        busy,
        day_counts: {},
      },
    ],
  };
}

function deps(overrides: Partial<PublicDeps> = {}): PublicDeps & { holds: HoldArgs[] } {
  const holds: HoldArgs[] = [];
  return {
    holds,
    event: async () => EVENT,
    busy: async () => availability(),
    hold: async (args) => {
      holds.push(args);
      return {
        public_ref: "abcdefghijklmnopqrstuvwxyz",
        status: "confirmed",
        starts_at: args.p_start,
        ends_at: new Date(Date.parse(args.p_start) + 30 * 60_000).toISOString(),
        duration_min: 30,
        title: "Initial consultation",
        host_name: "Sam Host",
        firm_name: "Synthetic Firm",
        time_zone: args.p_time_zone,
        host_time_zone: "America/Toronto",
        location_kind: "video",
        location_detail: null,
        ics_sequence: 0,
      };
    },
    now: () => NOW,
    ...overrides,
  };
}

const goodBody = (start = "2026-10-19T14:00:00Z") => ({
  start,
  name: "Sam Example",
  email: "Sam@Example.test",
  tz: "America/Vancouver",
  idempotencyKey: "key-12345678",
  website: "",
  elapsedMs: 9000,
});

describe("public booking API", () => {
  it("returns encoded UTC starts after the minimum notice, with the booker's zone echoed", async () => {
    const result = await getPublicSlots(deps(), "synthetic", "initial", { from: "2026-10-19T00:00:00Z", to: "2026-10-20T00:00:00Z", tz: "America/Vancouver" });
    expect(result.status).toBe(200);
    const starts = decodeStarts(result.body.starts).map((ms) => new Date(ms).toISOString());
    // 09:00 Toronto is inside the 60-minute notice from 08:00; 09:00 is the first at or after 09:00.
    expect(starts[0]).toBe("2026-10-19T13:00:00.000Z");
    expect(starts).toHaveLength(6);
    expect(result.body.tz).toBe("America/Vancouver");
    expect(result.headers?.["Cache-Control"]).toContain("max-age=30");
  });

  it("clamps the range to 62 days and refuses a backwards range", async () => {
    const seen: string[][] = [];
    const d = deps({ busy: async (_id, from, to) => (seen.push([from, to]), availability()) });
    await getPublicSlots(d, "synthetic", "initial", { from: "2026-10-19T00:00:00Z", to: "2027-10-19T00:00:00Z" });
    expect(Date.parse(seen[0][1]) - Date.parse(seen[0][0])).toBe(62 * 86_400_000);
    expect((await getPublicSlots(d, "synthetic", "initial", { from: "2026-11-01T00:00:00Z", to: "2026-10-01T00:00:00Z" })).status).toBe(400);
  });

  it("is a 404 for an unknown, malformed or paid type", async () => {
    expect((await getPublicSlots(deps({ event: async () => null }), "synthetic", "initial", {})).status).toBe(404);
    expect((await getPublicSlots(deps(), "Bad Slug!", "initial", {})).status).toBe(404);
    expect((await getPublicSlots(deps({ event: async () => ({ ...EVENT, price_cents: 30000 }) }), "synthetic", "initial", {})).status).toBe(404);
  });

  it("books a free consultation and returns the confirmation with a calendar file", async () => {
    const d = deps();
    const result = await postPublicHold(d, "synthetic", "initial", goodBody(), "a".repeat(64));
    expect(result.status).toBe(201);
    expect(d.holds[0]).toMatchObject({ p_email: "sam@example.test", p_time_zone: "America/Vancouver", p_client_hash: "a".repeat(64), p_start: "2026-10-19T14:00:00.000Z" });
    const booking = result.body.booking as { status: string; timeZone: string };
    expect(booking).toMatchObject({ status: "confirmed", timeZone: "America/Vancouver" });
    expect(String(result.body.ics)).toContain("UID:abcdefghijklmnopqrstuvwxyz@casevoya");
  });

  it("links the booking type's consultation agreement when one is waiting to be signed", async () => {
    const open = deps({ agreement: async () => ({ state: "open", title: "C-02" }) });
    expect((await postPublicHold(open, "synthetic", "initial", goodBody(), null)).body.agreement).toEqual({
      title: "C-02",
      href: "/consultation/abcdefghijklmnopqrstuvwxyz/agreement",
    });
    // None sent, a failed read, or no reader: the booking is reported without one.
    expect((await postPublicHold(deps({ agreement: async () => ({ state: "unavailable" }) }), "synthetic", "initial", goodBody(), null)).body.agreement).toBeNull();
    const failing = deps({ agreement: async () => { throw new Error("down"); } });
    const result = await postPublicHold(failing, "synthetic", "initial", goodBody(), null);
    expect(result.status).toBe(201);
    expect(result.body.agreement).toBeNull();
    expect((await postPublicHold(deps(), "synthetic", "initial", goodBody(), null)).body.agreement).toBeNull();
  });

  it("re-checks the start on the server: an unoffered or busy time never reaches the database", async () => {
    const d = deps({ busy: async () => availability([{ start: "2026-10-19T14:00:00Z", end: "2026-10-19T14:30:00Z" }]) });
    expect((await postPublicHold(d, "synthetic", "initial", goodBody(), null)).status).toBe(409);
    expect((await postPublicHold(d, "synthetic", "initial", goodBody("2026-10-19T14:10:00Z"), null)).status).toBe(409);
    expect((await postPublicHold(d, "synthetic", "initial", goodBody("2026-10-19T20:00:00Z"), null)).status).toBe(409);
    expect(d.holds).toHaveLength(0);
  });

  it("turns away a filled honeypot, a form sent too fast, bad input and a bad zone", async () => {
    const d = deps();
    expect((await postPublicHold(d, "synthetic", "initial", { ...goodBody(), website: "http://spam" }, null)).status).toBe(409);
    expect((await postPublicHold(d, "synthetic", "initial", { ...goodBody(), elapsedMs: 300 }, null)).status).toBe(429);
    expect((await postPublicHold(d, "synthetic", "initial", { ...goodBody(), email: "nope" }, null)).status).toBe(400);
    expect((await postPublicHold(d, "synthetic", "initial", { ...goodBody(), tz: "Mars/Base" }, null)).status).toBe(400);
    expect((await postPublicHold(d, "synthetic", "initial", "not json", null)).status).toBe(400);
    expect(d.holds).toHaveLength(0);
  });

  it("maps the database's refusals and never reports an unconfirmed booking as confirmed", async () => {
    const refused = (error: string) => deps({ hold: async () => ({ error }) });
    expect((await postPublicHold(refused("slot_unavailable"), "synthetic", "initial", goodBody(), null)).status).toBe(409);
    expect((await postPublicHold(refused("booking_rate_limited"), "synthetic", "initial", goodBody(), null)).status).toBe(429);
    const held = deps({ hold: async (args) => ({ public_ref: "abcdefghijklmnopqrstuvwxyz", status: "held", starts_at: args.p_start, ends_at: args.p_start }) });
    const result = await postPublicHold(held, "synthetic", "initial", goodBody(), null);
    expect(result.status).toBe(202);
    expect(result.body.ics).toBeNull();
    const reused = deps({ hold: async () => Promise.reject(new Error("idempotency key reused for a different booking")) });
    expect((await postPublicHold(reused, "synthetic", "initial", goodBody(), null)).status).toBe(409);
  });

  it("serves a practice page (sample mode) like any page, but never to a shared cache", async () => {
    const practice = deps({ event: async () => ({ ...EVENT, practice: true }) });
    const event = await getPublicEvent(practice, "synthetic", "initial");
    expect(event.status).toBe(200);
    expect((event.body.event as { practice: boolean }).practice).toBe(true);
    expect(event.headers?.["Cache-Control"]).toBe("private, no-store");
    const slots = await getPublicSlots(practice, "synthetic", "initial", { from: "2026-10-19T00:00:00Z", to: "2026-10-20T00:00:00Z" });
    expect(slots.status).toBe(200);
    expect(slots.headers?.["Cache-Control"]).toBe("private, no-store");
    // A real page keeps its short public cache and says it is not a practice page.
    const real = await getPublicEvent(deps(), "synthetic", "initial");
    expect((real.body.event as { practice: boolean }).practice).toBe(false);
    expect(real.headers?.["Cache-Control"]).toBe("public, max-age=30");
    // Someone the database does not show the practice page to gets the unpublished page's answer.
    const hidden = deps({ event: async () => null });
    const unpublished = await getPublicEvent(hidden, "synthetic", "initial");
    expect(unpublished).toEqual(await getPublicEvent(deps({ event: async () => null }), "synthetic", "other"));
    expect(unpublished.status).toBe(404);
    expect((await postPublicHold(hidden, "synthetic", "initial", goodBody(), null)).status).toBe(404);
    // A booking made on a practice page says it is a sample.
    const booked = await postPublicHold(
      deps({ event: async () => ({ ...EVENT, practice: true }), hold: async (args) => ({ ...(await deps().hold(args) as object), practice: true }) }),
      "synthetic",
      "initial",
      goodBody(),
      null,
    );
    expect(booked.status).toBe(201);
    expect((booked.body.booking as { practice: boolean }).practice).toBe(true);
  });

  it("hashes the client address; nothing raw is sent", async () => {
    const hash = await clientHash("203.0.113.9, 10.0.0.1", "salt");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await clientHash("203.0.113.9", "salt")).toBe(hash);
    expect(await clientHash(null)).toBeNull();
  });
});

describe("public booking routes", () => {
  const holds: unknown[] = [];
  beforeEach(() => {
    holds.length = 0;
    vi.resetModules();
    vi.doMock("@/modules/scheduling/public-deps", () => ({
      clientAddress: (headers: Headers) => headers.get("cf-connecting-ip"),
      publicDeps: async () => ({
        ...deps(),
        hold: async (args: HoldArgs) => {
          holds.push(args);
          return deps().hold(args);
        },
        now: () => NOW,
      }),
    }));
  });

  it("GET /api/book/[firm]/[event]/slots answers JSON with cache headers", async () => {
    const { GET } = await import("@/app/api/book/[firm]/[event]/slots/route");
    const response = await GET(new Request("https://app.test/api/book/synthetic/initial/slots?from=2026-10-19T00:00:00Z&to=2026-10-20T00:00:00Z&tz=UTC"), {
      params: Promise.resolve({ firm: "Synthetic", event: "initial" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=30");
    const body = (await response.json()) as { starts: number[] };
    expect(decodeStarts(body.starts).length).toBeGreaterThan(0);
  });

  it("POST /api/book/[firm]/[event]/hold books, hashes the address and refuses non-JSON", async () => {
    const { POST } = await import("@/app/api/book/[firm]/[event]/hold/route");
    const ctx = { params: Promise.resolve({ firm: "synthetic", event: "initial" }) };
    const form = await POST(new Request("https://app.test/x", { method: "POST", body: "a=1", headers: { "content-type": "application/x-www-form-urlencoded" } }), ctx);
    expect(form.status).toBe(415);
    const response = await POST(
      new Request("https://app.test/x", { method: "POST", body: JSON.stringify(goodBody()), headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" } }),
      { params: Promise.resolve({ firm: "synthetic", event: "initial" }) },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((holds[0] as HoldArgs).p_client_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(holds[0])).not.toContain("203.0.113.9");
  });
});

describe("calendar file", () => {
  const base = { publicRef: "abcdefghijklmnopqrstuvwxyz", startsAt: "2026-10-22T14:30:00Z", endsAt: "2026-10-22T15:00:00Z", title: "Initial consultation", firmName: "Synthetic, Firm; Ltd", stampedAt: "2026-10-18T12:00:00Z" };

  it("keeps one UID and bumps SEQUENCE on reschedule; cancels with METHOD:CANCEL", () => {
    const first = buildIcs({ ...base, sequence: 0 });
    const moved = buildIcs({ ...base, sequence: 1, startsAt: "2026-10-27T14:30:00Z", endsAt: "2026-10-27T15:00:00Z" });
    const cancelled = buildIcs({ ...base, sequence: 2, cancelled: true });
    for (const file of [first, moved, cancelled]) expect(file).toContain("UID:abcdefghijklmnopqrstuvwxyz@casevoya\r\n");
    expect(first).toContain("SEQUENCE:0");
    expect(moved).toContain("SEQUENCE:1");
    expect(moved).toContain("DTSTART:20261027T143000Z");
    expect(cancelled).toContain("METHOD:CANCEL");
    expect(cancelled).toContain("STATUS:CANCELLED");
    expect(first).toContain("SUMMARY:Initial consultation with Synthetic\\, Firm\\; Ltd");
    expect(first.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("escapes text and folds long lines", () => {
    expect(icsText("a\\b\nc")).toBe("a\\\\b\\nc");
    const long = buildIcs({ ...base, sequence: 0, title: "x".repeat(200) });
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(() => buildIcs({ ...base, publicRef: "BAD", sequence: 0 })).toThrow();
  });
});
