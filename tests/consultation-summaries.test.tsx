import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppointmentsLive } from "@/components/portal/appointments-live";
import { SheetConsultationRecord, SummaryDialog, type ConsultationRecordData } from "@/components/sheet/designer/consultations";
import { summaryView } from "@/modules/scheduling/sheet-present";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const wire = { "data-org": "o1", "data-booking": "b1" };
const row = (over: Partial<{ body: string; status: string; shared_body: string | null; shared_at: string | null; version: number }> = {}) => ({
  body: "We discussed a family-class PR application. Next: we send a quote.",
  status: "needs_review",
  shared_body: null,
  shared_at: null,
  version: 1,
  ...over,
});

describe("Consultation record: outcome summary (CRM-04)", () => {
  it("waits for a licensed reviewer: only they get Approve and share", () => {
    const reviewer = summaryView({ first: "Tomás", attended: true, reviewer: true, row: row(), wire });
    expect(reviewer.panel.title).toBe("Outcome summary for Tomás");
    expect(reviewer.panel.chip).toEqual({ tone: "rev", label: "Needs consultant review" });
    expect(reviewer.panel.share).toMatchObject({ "data-summary-share": "1", "data-booking": "b1", "data-version": "1" });
    expect(reviewer.panel.edit).toEqual({ label: "Edit", attrs: { "data-dlg": "dlgSum" } });
    const caseManager = summaryView({ first: "Tomás", attended: true, reviewer: false, row: row(), wire });
    expect(caseManager.panel.share).toBeNull();
    expect(caseManager.dialog?.hint).toContain("licensed consultant reviews it");
  });

  it("shared: no Approve; an edit waiting for review says the client keeps the shared text", () => {
    const shared = summaryView({ first: "Tomás", attended: true, reviewer: true, row: row({ status: "shared", shared_body: "x", shared_at: "2026-10-23T10:00:00Z", version: 2 }), wire });
    expect(shared.panel.chip).toEqual({ tone: "ok", label: "Shared with Tomás" });
    expect(shared.panel.share).toBeNull();
    const edited = summaryView({ first: "Tomás", attended: true, reviewer: true, row: row({ shared_body: "x", shared_at: "2026-10-23T10:00:00Z", version: 3 }), wire });
    expect(edited.panel.sharedNote).toContain("still sees the version shared before");
  });

  it("before the consultation is attended there is nothing to write; after, Write the summary", () => {
    const before = summaryView({ first: "Tomás", attended: false, reviewer: true, row: null, wire });
    expect(before.panel.edit).toBeNull();
    expect(before.dialog).toBeNull();
    expect(before.panel.empty).toContain("marked attended");
    const after = summaryView({ first: "Tomás", attended: true, reviewer: true, row: null, wire });
    expect(after.panel.edit?.label).toBe("Write the summary");
    expect(after.dialog?.submit).toMatchObject({ "data-summary-save": "1", "data-version": "0" });
  });

  it("renders the Designer's panel: title, review chip, text, Approve and share and Edit", () => {
    const view = summaryView({ first: "Tomás", attended: true, reviewer: true, row: row(), wire });
    const data: ConsultationRecordData = {
      picker: [],
      empty: { title: "", copy: "" },
      record: {
        attendee: "Tomás Duarte",
        notes: { items: [], copy: "No notes yet.", lead: null },
        outcome: { chip: { tone: "ok", label: "Attended" }, copy: "Attended.", actions: [] },
        summary: view.panel,
        details: [],
        history: [],
      },
    };
    const html = renderToStaticMarkup(createElement(SheetConsultationRecord, { data }));
    expect(html).toContain("The outcome summary the client sees is reviewed by the consultant first.");
    expect(html).toContain("Outcome summary for Tomás");
    expect(html).toContain('<span class="bd rev"><i></i>Needs consultant review</span>');
    expect(html).toContain(">Approve and share</button>");
    expect(html).toContain('data-dlg="dlgSum">Edit</button>');
    // Attendance keeps its own panel.
    expect(html).toContain("Attendance");
    const dialog = renderToStaticMarkup(createElement(SummaryDialog, { data: view.dialog! }));
    expect(dialog).toContain('id="dlgSum"');
    expect(dialog).toContain('data-summary-save="1"');
  });
});

describe("Portal Appointments: the shared summary on a past consultation", () => {
  it("shows the firm's shared summary under the attended call, and nothing on the others", () => {
    const viewer = {
      organizationId: "00000000-0000-4000-8000-00000000000a",
      organizationName: "Northline",
      organizationSlug: "example-firm",
      timezone: "America/Toronto",
      role: "client",
      person: null,
      matters: [],
      people: [],
      grants: [],
      shares: [],
      prefs: null,
      sections: [],
    } as unknown as Parameters<typeof AppointmentsLive>[0]["viewer"];
    const past = (id: string, summary: string | null) => ({
      id,
      publicRef: "abcdefghijklmnopqrstuvwxyc",
      title: "Initial consultation",
      startsAt: "2026-10-01T14:00:00Z",
      endsAt: "2026-10-01T14:45:00Z",
      status: "completed",
      hostName: "Amara Osei",
      locationKind: "phone",
      locationDetail: null,
      timeZone: "America/Toronto",
      version: 2,
      isSample: false,
      rules: null,
      summary,
    });
    const html = renderToStaticMarkup(
      createElement(AppointmentsLive, {
        viewer,
        data: { now: Date.parse("2026-10-23T12:00:00Z"), rows: [past("00000000-0000-4000-8000-0000000000d1", "Next: we send a quote."), past("00000000-0000-4000-8000-0000000000d2", null)], bookable: [] },
      }),
    );
    expect(html.match(/Summary from Northline: /g)).toHaveLength(1);
    expect(html).toContain("Next: we send a quote.");
  });
});
