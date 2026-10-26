import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetFrame } from "@/components/sheet/designer/frame";
import { ServiceNoticeBanner } from "@/components/sheet/designer/service-notice-banner";
import { SheetServiceNotices } from "@/components/sheet/designer/service-notices";
import {
  noticeTime,
  readServiceNotices,
  SERVICE_NOTICES_HREF,
  serviceNoticeBanner,
  serviceNoticeHistory,
  serviceNoticeSecurityBadge,
  type ServiceNotice,
} from "@/modules/sheet/service-notices-present";
import { parseArgs, postRequest } from "../scripts/ops/service-notice.mjs";

/** ADM-04: the service notice banner, the history page and the ops script's argument checks. Synthetic notices. */
const ZONE = "America/Toronto";
const ORG = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-25T14:00:00Z"); // 10:00 in Toronto (EDT)

function notice(id: string, over: Partial<ServiceNotice> = {}): ServiceNotice {
  return {
    id,
    kind: "info",
    severity: "minor",
    title: `Notice ${id}`,
    body: "Synthetic notice text.",
    startsAt: "2026-10-25T12:00:00Z",
    endsAt: null,
    status: "published",
    resolvedAt: null,
    resolutionNote: null,
    ...over,
  };
}

const MAINTENANCE = notice("m1", { kind: "maintenance", startsAt: "2026-10-26T02:00:00Z", endsAt: "2026-10-26T04:00:00Z", title: "Database upgrade" });
const INCIDENT = notice("i1", { kind: "incident", severity: "major", startsAt: "2026-10-25T13:10:00Z", title: "Email delays" });
const INFO = notice("n1", { title: "New sign-in page" });

describe("service notice banner", () => {
  it("shows an incident above maintenance above information, in the firm's timezone", () => {
    const banner = serviceNoticeBanner([INFO, MAINTENANCE, INCIDENT], new Set(), { now: NOW, timeZone: ZONE, organizationId: ORG });
    expect(banner).toMatchObject({ id: "i1", tone: "bad", icon: "incident", title: "Service incident: Email delays", more: 2, href: SERVICE_NOTICES_HREF });
    expect(banner?.body).toBe(" Synthetic notice text. Since 25 Oct 2026, 09:10 (America/Toronto).");
  });

  it("drops what the person dismissed and what has ended or been resolved", () => {
    const ended = notice("e1", { kind: "incident", endsAt: "2026-10-25T13:00:00Z" });
    const resolved = notice("r1", { kind: "incident", status: "resolved", resolvedAt: "2026-10-25T13:30:00Z", resolutionNote: "Fixed" });
    const draft = notice("d1", { kind: "incident", status: "draft" });
    const banner = serviceNoticeBanner([ended, resolved, draft, INCIDENT, MAINTENANCE], new Set(["i1"]), { now: NOW, timeZone: ZONE, organizationId: ORG });
    expect(banner).toMatchObject({ id: "m1", tone: "info", icon: "clock", title: "Scheduled maintenance: Database upgrade", more: 0 });
    expect(banner?.body).toContain("From 25 Oct 2026, 22:00 to 26 Oct 2026, 00:00");
    expect(serviceNoticeBanner([INCIDENT], new Set(["i1"]), { now: NOW, timeZone: ZONE, organizationId: ORG })).toBeNull();
  });

  it("maintenance in progress is a warning", () => {
    const now = new Date("2026-10-26T03:00:00Z");
    expect(serviceNoticeBanner([MAINTENANCE], new Set(), { now, timeZone: ZONE, organizationId: ORG })).toMatchObject({ tone: "warn", title: "Maintenance in progress: Database upgrade" });
  });

  it("renders the Designer's alert with Notice history and Dismiss, inside the frame's content", () => {
    const banner = serviceNoticeBanner([INCIDENT], new Set(), { now: NOW, timeZone: ZONE, organizationId: ORG });
    if (!banner) throw new Error("expected a banner");
    const html = renderToStaticMarkup(createElement(ServiceNoticeBanner, { data: banner }));
    expect(html).toContain('<div class="alert bad" role="alert" data-service-notice="i1">');
    expect(html).toContain('href="/assets/icons-coreui/sprite.svg#i-incident"');
    expect(html).toContain(`<a class="btn sm" href="${SERVICE_NOTICES_HREF}">Notice history</a>`);
    expect(html).toContain(`<button class="btn sm" data-notice-dismiss="i1" data-org="${ORG}">Dismiss</button>`);
    const frame = renderToStaticMarkup(
      createElement(
        SheetFrame,
        {
          sidebar: {
            active: "/sheet",
            counts: {},
            pinned: [],
            me: { name: "Synthetic Person", role: "Firm owner", avatarUrl: null },
            tiles: { documents: "/sheet/documents", invoices: "/sheet/finance" },
            newMatter: { href: "#", toast: "New matter", toastSub: "" },
            createBoard: { href: "#", toast: "Create board", toastSub: "" },
          } as never,
          statusbar: { timezone: ZONE, notice: banner },
        },
        createElement("p", null, "page"),
      ),
    );
    expect(frame.indexOf("data-service-notice")).toBeGreaterThan(frame.indexOf('id="content"'));
    expect(frame.indexOf("data-service-notice")).toBeLessThan(frame.indexOf("<p>page</p>"));
  });

  it("is plain text: a notice body with markup is escaped", () => {
    const banner = serviceNoticeBanner([notice("x", { body: "<script>alert(1)</script>" })], new Set(), { now: NOW, timeZone: ZONE, organizationId: ORG });
    const html = renderToStaticMarkup(createElement(ServiceNoticeBanner, { data: banner! }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("service notice history", () => {
  it("lists current notices first, then past ones, with state, times and resolution", () => {
    const resolved = notice("r1", {
      kind: "incident",
      title: "Upload errors",
      startsAt: "2026-10-20T15:00:00Z",
      status: "resolved",
      resolvedAt: "2026-10-20T16:30:00Z",
      resolutionNote: "Storage provider recovered.",
    });
    const ended = notice("e1", { kind: "maintenance", title: "Old window", startsAt: "2026-10-10T02:00:00Z", endsAt: "2026-10-10T03:00:00Z" });
    const data = serviceNoticeHistory([resolved, ended, MAINTENANCE, INCIDENT, notice("d1", { status: "draft" })], { now: NOW, timeZone: ZONE });
    expect(data.rows.map((row) => row.id)).toEqual(["i1", "m1", "r1", "e1"]);
    expect(data.rows[0]).toMatchObject({ kind: "Incident", badge: { tone: "bad", label: "Active" }, resolution: "—" });
    expect(data.rows[1]).toMatchObject({ kind: "Maintenance", badge: { tone: "blue", label: "Scheduled" } });
    expect(data.rows[2]).toMatchObject({ badge: { tone: "ok", label: "Resolved" }, resolution: "20 Oct 2026, 12:30: Storage provider recovered." });
    expect(data.rows[3]).toMatchObject({ badge: { tone: "gr", label: "Ended" }, when: "From 9 Oct 2026, 22:00 to 9 Oct 2026, 23:00" });
    expect(data.note).toContain("not automatic status checks");
    expect(data.note).toContain(ZONE);

    const html = renderToStaticMarkup(createElement(SheetServiceNotices, { data }));
    expect(html).toContain('<h1 class="display">Service notices</h1>');
    expect(html).toContain('<table class="t">');
    expect(html).toContain('<span class="bd ok"><i></i>Resolved</span>');
    expect(html).toContain("Storage provider recovered.");
  });

  it("has honest empty and unreadable states", () => {
    const empty = renderToStaticMarkup(createElement(SheetServiceNotices, { data: serviceNoticeHistory([], { now: NOW, timeZone: ZONE }) }));
    expect(empty).toContain("No notices yet.");
    const failed = renderToStaticMarkup(createElement(SheetServiceNotices, { data: { ...serviceNoticeHistory([], { now: NOW, timeZone: ZONE }), unavailable: true } }));
    expect(failed).toContain("couldn’t be read");
  });

  it("counts current notices for the Security row", () => {
    expect(serviceNoticeSecurityBadge([INCIDENT, MAINTENANCE], NOW)).toEqual({ tone: "chg", label: "2 current" });
    expect(serviceNoticeSecurityBadge([], NOW)).toEqual({ tone: "gr", label: "None current" });
  });

  it("reads rows defensively and formats times in the firm's zone", () => {
    expect(readServiceNotices([{ id: "a", kind: "outage", severity: "minor", status: "published", title: "t", body: "b", starts_at: "2026-10-25T12:00:00Z" }])).toEqual([]);
    expect(readServiceNotices([{ id: "a", kind: "info", severity: "minor", status: "published", title: "t", body: "b", starts_at: "2026-10-25T12:00:00Z", ends_at: null }])).toHaveLength(1);
    expect(noticeTime("2026-10-25T12:00:00Z", "America/Vancouver")).toBe("25 Oct 2026, 05:00");
  });
});

describe("scripts/ops/service-notice.mjs", () => {
  const BY = "00000000-0000-4000-8000-0000000000aa";

  it("posts to listed firms by slug or id, or to all firms", () => {
    const parsed = parseArgs(["post", "--by", BY, "--kind", "maintenance", "--title", "Database upgrade", "--body", "Read-only for two hours.", "--ends", "2099-01-01T02:00:00-05:00", "--firm", "test-firm", "--firm", ORG]);
    const request = postRequest(parsed.options);
    expect(request).toMatchObject({ by: BY, kind: "maintenance", severity: "minor", firms: ["test-firm", ORG], publish: true, ends: "2099-01-01T07:00:00.000Z" });
    expect(postRequest(parseArgs(["post", "--by", BY, "--kind", "incident", "--title", "Email delays", "--body", "Late.", "--all-firms", "--draft"]).options)).toMatchObject({ firms: null, publish: false });
  });

  it("refuses an unclear audience, a missing admin, maintenance without an end and bad times", () => {
    const base = ["post", "--kind", "incident", "--title", "Email delays", "--body", "Late."];
    expect(() => postRequest(parseArgs([...base, "--by", BY]).options)).toThrow(/--all-firms or one or more --firm/);
    expect(() => postRequest(parseArgs([...base, "--by", BY, "--all-firms", "--firm", "x1"]).options)).toThrow(/--all-firms or one or more --firm/);
    expect(() => postRequest(parseArgs([...base, "--all-firms"]).options)).toThrow(/--by/);
    expect(() => postRequest(parseArgs(["post", "--by", BY, "--kind", "maintenance", "--title", "Upgrade", "--body", "x", "--all-firms"]).options)).toThrow(/needs --ends/);
    expect(() => postRequest(parseArgs([...base, "--by", BY, "--all-firms", "--ends", "tomorrow"]).options)).toThrow(/ISO time/);
    expect(() => postRequest(parseArgs([...base, "--by", BY, "--firm", "Not A Slug"]).options)).toThrow(/Not a firm slug/);
    expect(() => parseArgs(["delete"])).toThrow(/Usage/);
    expect(() => parseArgs(["post", "--title"])).toThrow(/needs a value/);
  });
});
