import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatterAgreements, MatterClosure, MatterDocuments, MatterTasks, type MatterDeadline, type MatterTaskRow } from "@/components/sheet/designer/matter";
import { SheetMatters, type MattersData } from "@/components/sheet/designer/matters";
import { submittedInstant } from "@/modules/government/present";

const deadline = (over: Partial<MatterDeadline>): MatterDeadline => ({
  label: "Biometrics",
  due: "Mon 19 Oct 2026",
  verified: { tone: "ok", label: "Verified" },
  source: [],
  origin: "Not derived from a rule.",
  reminders: [],
  timezone: "Official: end of day (America/Toronto)",
  ...over,
});

const task = (over: Partial<MatterTaskRow>): MatterTaskRow => ({
  title: "Collect passport",
  parts: ["Internal", "Kim"],
  badge: { tone: "gr", label: "Due 20 Oct" },
  owner: { name: "Kim Staff" },
  ...over,
});

describe("matter tabs: Tasks and deadlines", () => {
  it("keeps a missed deadline on the tab, marked Past due", () => {
    const html = renderToStaticMarkup(createElement(MatterTasks, { deadlines: [deadline({ pastDue: true }), deadline({ label: "Medical" })], tasks: [] }));
    expect(html.match(/Past due/g)).toHaveLength(1);
    expect(html).toContain("Biometrics");
    expect(html).toContain("Medical");
  });

  it("a tick the viewer can't use is a read-only mark (the page's toggle skips it); a finished task shows ticked", () => {
    const html = renderToStaticMarkup(
      createElement(MatterTasks, {
        deadlines: [],
        tasks: [
          task({ done: { "data-task-done": "t1", "data-org": "o", "data-version": "1" } }),
          task({ title: "Assistant view", done: null }),
          task({ title: "Finished", done: null, completed: true }),
        ],
      }),
    );
    expect(html).toContain('role="checkbox" aria-checked="false" tabindex="0" aria-label="Mark “Collect passport” done" data-task-done="t1"');
    expect(html).toContain('<span class="ck" aria-readonly="true" aria-hidden="true"></span>');
    expect(html).toContain('<span class="ck on" aria-readonly="true" aria-hidden="true"></span>');
  });
});

describe("matter tabs: Documents", () => {
  it("offers Request a document on the empty tab to those who may, and points to the Documents page for review", () => {
    const empty = renderToStaticMarkup(createElement(MatterDocuments, { checklist: null, people: [], rows: [], filter: true, request: true }));
    expect(empty).toContain('data-open="dReq"');
    expect(empty).toContain("Request a document");
    expect(renderToStaticMarkup(createElement(MatterDocuments, { checklist: null, people: [], rows: [], filter: true }))).not.toContain("dReq");
    const rows = renderToStaticMarkup(
      createElement(MatterDocuments, {
        checklist: null,
        people: [],
        filter: true,
        rows: [{ title: "Passport", kind: "Identity", person: { name: "Ana Client" }, upload: { tone: "ok", label: "Uploaded" }, review: { tone: "rev", label: "Awaiting review" }, version: "v1" }],
      }),
    );
    expect(rows).toContain('<a class="tl" href="/sheet/documents">Documents</a>');
  });
});

describe("matter tabs: Agreements", () => {
  it("keeps New agreement when the matter already has one (an amendment), and only when it is offered", () => {
    const row = { title: "Service agreement", version: ["v1"], parties: "Ana", signatures: "1 of 2", state: { tone: "rev" as const, label: "Sent" }, href: "/sheet/agreements", action: "Open" };
    expect(renderToStaticMarkup(createElement(MatterAgreements, { rows: [row], signing: null, create: "/sheet/agreements?dlg=new&matter=m1" }))).toContain("New agreement");
    expect(renderToStaticMarkup(createElement(MatterAgreements, { rows: [row], signing: null, create: null }))).not.toContain("New agreement");
  });
});

describe("matter tabs: Closure", () => {
  it("shows the checklist as facts (read only) and links to the client-file export", () => {
    const html = renderToStaticMarkup(
      createElement(MatterClosure, {
        closed: false,
        retention: null,
        panel: { status: { tone: "gr", label: "Not ready", detail: "matter is open" }, items: [{ label: "Client account balance is zero", done: false }], retention: [], note: "n" },
      }),
    );
    expect(html).toContain('role="checkbox" aria-checked="false" aria-readonly="true" aria-label="Client account balance is zero"');
    expect(html).not.toContain("tabindex");
    expect(html).toContain('<a class="tl" href="/sheet/exports">Export the client file</a>');
  });

  it("links the export to this matter when the live page knows it", () => {
    const html = renderToStaticMarkup(
      createElement(MatterClosure, {
        closed: false,
        retention: null,
        panel: { status: { tone: "gr", label: "Not ready", detail: "matter is open" }, items: [], retention: [], note: "n", exportHref: "/sheet/exports?view=m1" },
      }),
    );
    expect(html).toContain('<a class="tl" href="/sheet/exports?view=m1">Export the client file</a>');
  });
});

describe("Matters list", () => {
  it("says the list couldn't load instead of 'No matters yet' when the read failed", () => {
    const data = { title: "All matters", counts: { active: 0, blocked: 0, mine: 0, everyone: 0 }, rows: [], shown: 0, total: 0, more: null, empty: { kind: "error" } } as unknown as MattersData;
    const html = renderToStaticMarkup(createElement(SheetMatters, { data }));
    expect(html).toContain("Matters couldn’t load");
    expect(html).not.toContain("No matters yet");
  });
});

describe("Submissions: Submitted at", () => {
  it("reads the typed time in the firm's timezone, not the browser's", () => {
    expect(submittedInstant("2026-10-22T09:30", "America/Toronto")).toBe("2026-10-22T13:30:00.000Z");
    expect(submittedInstant("2026-10-22T09:30", "America/Vancouver")).toBe("2026-10-22T16:30:00.000Z");
    expect(submittedInstant("", "America/Toronto")).toBe("");
  });
});
