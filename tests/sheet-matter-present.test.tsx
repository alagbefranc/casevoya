import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatterDialogs, MatterRbar, MatterTopBar, matterTab, SheetMatter, type MatterPageData } from "@/components/sheet/designer/matter";
import { safeNext } from "@/lib/auth/redirect";
import { safeAccessError } from "@/lib/auth/step-up";
import { letterNote, letterStatus, needsStepUp, stageAt, stepUpLocation, withoutDialog } from "@/modules/sheet/matter-wire";
import {
  agreementState,
  deadlineBadge,
  documentState,
  dueIn,
  eventWhen,
  headerPills,
  longDate,
  stageIndex,
  taskRowBadge,
  weekdayDayMonth,
} from "@/modules/sheet/matter-present";

const TODAY = "2026-10-17";

describe("Matter page words", () => {
  it("formats dates the Designer's way", () => {
    expect(longDate("2026-09-02")).toBe("2 Sep 2026");
    expect(weekdayDayMonth("2026-10-30")).toBe("Fri 30 Oct");
    expect(dueIn("2026-10-23", TODAY)).toBe("due in 6 days");
    expect(dueIn("2026-10-17", TODAY)).toBe("due today");
    expect(dueIn("2026-10-14", TODAY)).toBe("3 days overdue");
  });

  it("states when the file changed and when it was opened, in the firm's timezone", () => {
    const now = new Date("2026-10-17T14:00:00Z");
    expect(headerPills("2026-10-17T13:44:00Z", "2026-09-02T15:00:00Z", "America/Toronto", now)).toEqual(["Updated 16 min ago", "Opened 2 Sep 2026"]);
    expect(eventWhen("2026-10-17T12:41:00Z", "America/Toronto", TODAY)).toBe("Today 08:41");
    expect(eventWhen("2026-10-15T12:41:00Z", "America/Toronto", TODAY)).toBe("15 Oct");
  });

  it("keeps upload state and firm review separate", () => {
    expect(documentState({ requestStatus: "open", version: null }, TODAY)).toMatchObject({
      upload: { tone: "unv", label: "Not uploaded" },
      review: { tone: "gr", label: "Requested" },
      bucket: "outstanding",
    });
    const clean = { uploadState: "clean", reviewState: "pending", versionNumber: 2, expiresOn: null };
    expect(documentState({ requestStatus: "open", version: clean }, TODAY)).toMatchObject({
      upload: { tone: "gr", label: "Uploaded", detail: "scanned" },
      review: { tone: "rev", label: "Awaiting review" },
      version: "v2",
      bucket: "review",
    });
    expect(documentState({ requestStatus: null, version: { ...clean, reviewState: "accepted" } }, TODAY).bucket).toBe("accepted");
    expect(documentState({ requestStatus: null, version: { ...clean, reviewState: "accepted", expiresOn: "2026-01-01" } }, TODAY).review).toEqual({ tone: "bad", label: "Expired" });
    expect(documentState({ requestStatus: null, version: { ...clean, uploadState: "quarantined" } }, TODAY).review.label).toBe("Requested");
    expect(documentState({ requestStatus: "waived", version: null }, TODAY).bucket).toBeNull();
  });

  it("says whether the next deadline is verified and never invents one", () => {
    expect(deadlineBadge(null)).toEqual({ tone: "unv", label: "Next deadline", detail: "—" });
    expect(deadlineBadge({ dueOn: "2026-10-30", dueAt: "2026-10-30T21:00:00Z", timezone: "America/Toronto", verification: "confirmed" })).toEqual({
      tone: "ok",
      label: "Next deadline",
      detail: "Fri 30 Oct, 17:00 ET (verified)",
    });
    expect(deadlineBadge({ dueOn: "2026-10-30", dueAt: null, timezone: "America/Toronto", verification: "tentative" }).detail).toBe("Fri 30 Oct (unverified)");
  });

  it("maps stages, tasks and agreements", () => {
    expect(stageIndex("evidence_collection")).toBe(2);
    expect(stageIndex("unknown")).toBe(0);
    expect(taskRowBadge("blocked", null, TODAY)).toEqual({ tone: "bad", label: "Blocked" });
    expect(taskRowBadge("open", "2026-10-01", TODAY)).toEqual({ tone: "bad", label: "Overdue" });
    expect(agreementState("completed")).toEqual({ tone: "ok", label: "Completed" });
    expect(agreementState("partially_signed").label).toBe("Waiting on signatures");
    expect(matterTab("billing")).toBe("billing");
    expect(matterTab("nope")).toBe("overview");
    expect(matterTab(undefined)).toBe("overview");
  });
});

describe("Matter dialog wiring", () => {
  it("recognises a step-up refusal and nothing else", () => {
    expect(needsStepUp(safeAccessError("step-up is required"))).toBe(true);
    expect(needsStepUp(safeAccessError("aal2 required"))).toBe(true);
    expect(needsStepUp(safeAccessError("matter version conflict"))).toBe(false);
    expect(needsStepUp(safeAccessError("staff access denied"))).toBe(false);
    expect(needsStepUp(null)).toBe(false);
  });

  it("sends a step-up to /mfa step 6 and back to the same matter with the dialog open", () => {
    const id = "6f1c2f9e-3b1a-4c2d-9e8f-0a1b2c3d4e5f";
    const location = stepUpLocation(`/sheet/matters/${id}`, "?tab=overview", "stage");
    expect(location).toBe(`/mfa?step=6&next=${encodeURIComponent(`/sheet/matters/${id}?tab=overview&dlg=stage`)}`);
    const next = new URLSearchParams(location.split("?")[1]).get("next");
    expect(safeNext(next)).toBe(`/sheet/matters/${id}?tab=overview&dlg=stage`);
    expect(stepUpLocation("/sheet/matters/x", "?dlg=hold", null)).toBe(`/mfa?step=6&next=${encodeURIComponent("/sheet/matters/x")}`);
    expect(stepUpLocation("/sheet/matters/x", "", "letter")).toBe(`/mfa?step=6&next=${encodeURIComponent("/sheet/matters/x?dlg=letter")}`);
    expect(withoutDialog("/sheet/matters/x", "?tab=people&dlg=hold")).toBe("/sheet/matters/x?tab=people");
    expect(withoutDialog("/sheet/matters/x", "?dlg=hold")).toBe("/sheet/matters/x");
  });

  it("maps the Designer's dialog fields to what the database records", () => {
    expect(stageAt("3")).toBe("preparation");
    expect(stageAt("11")).toBe("closed");
    expect(stageAt("12")).toBeNull();
    expect(stageAt("x")).toBeNull();
    expect(stageAt(undefined)).toBeNull();
    expect(letterStatus("Acknowledgement of receipt")).toBe("receipt_on_file");
    expect(letterStatus("Request for documents")).toBe("additional_request_open");
    expect(letterStatus("Decision")).toBe("decision_evidence_on_file");
    expect(letterStatus("Anything else")).toBeNull();
    expect(letterNote({ type: "Decision", receivedOn: "2026-10-17", via: "Email", deadline: "" })).toBe("Decision letter, received 2026-10-17, by Email");
    expect(letterNote({ type: "Request for documents", receivedOn: "2026-10-17", via: "Mail", deadline: " 30 days " })).toBe(
      "Request for documents letter, received 2026-10-17, by Mail. Deadline in the letter: 30 days",
    );
  });

  it("puts the matter on the confirm buttons only when the page is wired", () => {
    const wire = { organizationId: "org-1", matterId: "m-1", version: 7 };
    const dialogs = { current: 2, target: 3, version: 7, evidence: [], reason: "", owners: [{ id: "mem-1", name: "Dana Lee" }], reviewOn: "2026-10-31", receivedOn: "2026-10-17" };
    const live = renderToStaticMarkup(createElement(MatterDialogs, { data: { ...dialogs, wire } }));
    expect(live).toContain('id="stGo" data-act="stage" data-org="org-1" data-matter="m-1" data-version="7"');
    expect(live).toContain('id="holdGo" data-act="hold"');
    expect(live).toContain('id="letGo" data-act="letter"');
    expect(live).toContain('<option value="mem-1">Dana Lee</option>');
    expect(live).not.toContain("data-toast");
    const inert = renderToStaticMarkup(createElement(MatterDialogs, { data: dialogs }));
    expect(inert).not.toContain("data-act");
    const header = renderToStaticMarkup(
      createElement(MatterTopBar, { data: { client: { name: "Dana Lee" }, pills: [], hold: { reason: "Waiting on client", parts: ["Owner Dana Lee"] }, tab: "overview", wire } }),
    );
    expect(header).toContain('id="holdOff" data-act="resume"');
    expect(header).toContain('data-goto-tab="documents"');
  });

  it("asks a consultant to confirm an outcome only when decision evidence is on file", () => {
    const wire = { organizationId: "org-1", matterId: "m-1", version: 7 };
    const html = renderToStaticMarkup(
      createElement(SheetMatter, {
        data: { ...EMPTY_FIRM, tab: "decisions", confirmOutcome: { options: [{ value: "approved", label: "Approved" }], wire } },
      }),
    );
    expect(html).toContain("Confirm the outcome");
    expect(html).toContain('data-act="outcome"');
    expect(renderToStaticMarkup(createElement(SheetMatter, { data: { ...EMPTY_FIRM, tab: "decisions" } }))).toContain("No decision recorded");
  });
});

const EMPTY_FIRM: MatterPageData = {
  tab: "overview",
  overview: {
    client: { name: "Dana Lee" },
    facts: ["MP-2026-0001"],
    badges: [{ tone: "blue", label: "Stage", detail: "Intake" }],
    stage: { index: 1, total: 12, label: "Intake" },
    documents: { accepted: 0, review: 0, outstanding: 0 },
    requests: [],
    blockers: [],
    people: [],
    events: [],
  },
  people: { cards: [], relationships: [] },
  documents: { checklist: null, people: [], rows: [] },
  agreements: { rows: [], signing: null },
  tasks: { deadline: null, tasks: [] },
  outcome: null,
  closure: { closed: false, retention: null },
};

const DEMO = /Northline|Amara|Priya|Kofi|Olena|Rafael|Daniel|Lena|DocuSign|NL-2026|CAD 1,500|Sample previews/;

describe("Matter page with a firm's own records", () => {
  it("renders every tab without the Designer's sample people or numbers", () => {
    for (const tab of ["overview", "intake", "forms", "documents", "submissions", "decisions", "people", "agreements", "tasks", "messages", "billing", "closure", "timeline", "audit"] as const) {
      const html = renderToStaticMarkup(createElement(SheetMatter, { data: { ...EMPTY_FIRM, tab } }));
      expect(html, tab).not.toMatch(DEMO);
      expect(html.length, tab).toBeGreaterThan(0);
    }
    const header = renderToStaticMarkup(createElement(MatterTopBar, { data: { client: { name: "Dana Lee" }, pills: ["Updated just now"], hold: null, tab: "billing" } }));
    expect(header).toContain('data-t="billing" class="on"');
    expect(header).toContain('<span class="av" aria-hidden="true">DL</span>');
    const rbar = renderToStaticMarkup(createElement(MatterRbar, { data: { agreement: { title: "No agreement yet", state: null, parts: ["Quotes and service agreements start from an approved template."] } } }));
    expect(rbar).not.toContain("voAssist");
    expect(rbar).not.toContain("Pinned note");
  });

  it("shows the Designer's empty states for tabs that have no backend yet", () => {
    const billing = renderToStaticMarkup(createElement(SheetMatter, { data: { ...EMPTY_FIRM, tab: "billing" } }));
    expect(billing).toContain("No invoices yet");
    expect(billing).toContain("invoice-plain-160@1x.webp");
    const overview = renderToStaticMarkup(createElement(SheetMatter, { data: EMPTY_FIRM }));
    expect(overview).toContain("No open requests");
    expect(overview).toContain("Nothing blocking");
    expect(overview).toContain('data-count="0"');
    expect(overview).not.toContain("Money");
  });
});
