import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatterDialogs, MatterTopBar, SheetMatter, type MatterDialogsData, type MatterPageData } from "@/components/sheet/designer/matter";
import { safeAccessError } from "@/lib/auth/step-up";
import { dialogId, stepUpLocation } from "@/modules/sheet/matter-wire";
import { DEADLINE_KINDS, deadlineError, deadlineSource, looksOfficialUrl, readDeadline, zonedInstant } from "@/modules/sheet/new-deadline";

const IRCC = "https://www.canada.ca/en/immigration-refugees-citizenship.html";
const LETTER = {
  kind: "correspondence",
  label: "  Respond to   IRCC request ",
  dueOn: "2026-10-30",
  dueTime: "17:00",
  timezone: "America/Toronto",
  evidence: "IRCC request letter, page 2",
  sourceUrl: IRCC,
  retrievedOn: "2026-10-18",
};

describe("Record a deadline: what the dialog sends", () => {
  it("turns the dialog's fields into public.record_deadline's arguments", () => {
    expect(readDeadline(LETTER)).toEqual({
      input: {
        kind: "correspondence",
        label: "Respond to IRCC request",
        dueOn: "2026-10-30",
        dueAt: "2026-10-30T21:00:00.000Z",
        timezone: "America/Toronto",
        evidenceLocator: "IRCC request letter, page 2",
        sourceUrl: IRCC,
        sourceRetrievedOn: "2026-10-18",
      },
    });
    const internal = readDeadline({ kind: "internal", label: "Draft cover letter", dueOn: "2026-10-25", timezone: "America/Toronto" });
    expect(internal).toEqual({
      input: {
        kind: "internal",
        label: "Draft cover letter",
        dueOn: "2026-10-25",
        dueAt: null,
        timezone: "America/Toronto",
        evidenceLocator: null,
        sourceUrl: null,
        sourceRetrievedOn: null,
      },
    });
  });

  it("requires an official source, with its retrieval date, for a legal or letter deadline", () => {
    expect(readDeadline({ ...LETTER, sourceUrl: "", retrievedOn: "" })).toEqual({ error: "A legal or letter deadline needs its official source URL." });
    expect(readDeadline({ ...LETTER, kind: "legal", sourceUrl: "", retrievedOn: "" })).toEqual({ error: "A legal or letter deadline needs its official source URL." });
    expect(readDeadline({ ...LETTER, retrievedOn: "" })).toEqual({ error: "Add the date you retrieved the official source." });
    expect(readDeadline({ ...LETTER, sourceUrl: "http://www.canada.ca/x" })).toEqual({ error: "Use the official https:// page the deadline comes from." });
    expect(readDeadline({ kind: "internal", label: "x", dueOn: "2026-10-25", timezone: "UTC", retrievedOn: "2026-10-18" })).toEqual({
      error: "Add the official source URL, or clear the retrieval date.",
    });
  });

  it("checks the date, time, timezone and lengths before anything is sent", () => {
    expect(readDeadline({ ...LETTER, kind: "appeal" })).toEqual({ error: "Choose what kind of deadline this is." });
    expect(readDeadline({ ...LETTER, label: "   " })).toEqual({ error: "Say what is due." });
    expect(readDeadline({ ...LETTER, label: "x".repeat(201) })).toEqual({ error: "Keep what is due to 200 characters." });
    expect(readDeadline({ ...LETTER, dueOn: "" })).toEqual({ error: "Pick the due date." });
    expect(readDeadline({ ...LETTER, dueOn: "2026-02-30" })).toEqual({ error: "Pick the due date." });
    expect(readDeadline({ ...LETTER, dueTime: "5pm" })).toEqual({ error: "Enter the due time as HH:MM, or leave it blank." });
    expect(readDeadline({ ...LETTER, timezone: "" })).toEqual({ error: "Enter the official timezone, like America/Toronto." });
    expect(readDeadline({ ...LETTER, timezone: "Mars/Olympus" })).toEqual({ error: "Enter the official timezone, like America/Toronto." });
    expect(readDeadline({ ...LETTER, dueTime: "", timezone: "Mars/Olympus" })).toEqual({ error: "Enter the official timezone, like America/Toronto." });
    expect(readDeadline({ ...LETTER, evidence: "x".repeat(301) })).toEqual({ error: "Keep where it’s written to 300 characters." });
  });

  it("places a wall-clock time in the official timezone, across daylight saving", () => {
    expect(zonedInstant("2026-10-30", "17:00", "America/Toronto")).toBe("2026-10-30T21:00:00.000Z");
    expect(zonedInstant("2026-11-30", "17:00", "America/Toronto")).toBe("2026-11-30T22:00:00.000Z");
    expect(zonedInstant("2026-10-31", "02:30", "Asia/Kolkata")).toBe("2026-10-30T21:00:00.000Z");
    expect(zonedInstant("2026-10-30", "17:00", "UTC")).toBe("2026-10-30T17:00:00.000Z");
    expect(zonedInstant("2026-10-30", "17:00", "Nowhere/Real")).toBeNull();
    expect(zonedInstant("2026-10-30", "25:00", "UTC")).toBeNull();
  });

  it("only offers URLs app.official_url_host can accept", () => {
    expect(looksOfficialUrl(IRCC)).toBe(true);
    expect(looksOfficialUrl("https://user@www.canada.ca/")).toBe(false);
    expect(looksOfficialUrl("https://www.canada.ca:8443/")).toBe(false);
    expect(looksOfficialUrl("https://10.0.0.1/")).toBe(false);
    expect(looksOfficialUrl("https://localhost/")).toBe(false);
    expect(looksOfficialUrl("ftp://www.canada.ca/")).toBe(false);
  });

  it("reads the database's refusals as the dialog's own words, never the database message", () => {
    expect(deadlineError("this firm is in sample mode; only sample matters accept new work")).toMatch(/^This firm is still in sample mode/);
    expect(deadlineError("a deadline source must be an allowlisted official URL with a retrieval date")).toMatch(/official government allowlist/);
    expect(deadlineError("deadline timezone is not usable")).toBe("Enter the official timezone, like America/Toronto.");
    expect(deadlineError("deadline denied")).toBe("Your role can’t record deadlines on this matter.");
    expect(deadlineError("step-up is required")).toBe(safeAccessError("step-up is required"));
    expect(deadlineError("relation public.deadlines does not exist")).toBe("That action could not be completed.");
  });

  it("states where a deadline's source is written and when it was retrieved", () => {
    expect(deadlineSource("IRCC request letter, page 2", IRCC, "18 Oct")).toEqual(["IRCC request letter, page 2", "www.canada.ca", "retrieved 18 Oct"]);
    expect(deadlineSource(null, IRCC, "18 Oct")).toEqual(["www.canada.ca", "retrieved 18 Oct"]);
    expect(deadlineSource(null, null, null)).toEqual(["No source recorded"]);
    expect(deadlineSource(null, "not a url", null)).toEqual(["No source recorded"]);
  });

  it("reopens the deadline dialog after a step-up", () => {
    expect(dialogId("deadline")).toBe("dDeadline");
    expect(dialogId("letter")).toBe("dLetter");
    expect(dialogId("toString")).toBeNull();
    expect(dialogId(null)).toBeNull();
    expect(stepUpLocation("/sheet/matters/x", "?tab=tasks", "deadline")).toBe(`/mfa?step=6&next=${encodeURIComponent("/sheet/matters/x?tab=tasks&dlg=deadline")}`);
  });
});

const WIRE = { organizationId: "org-1", matterId: "m-1", version: 7 };
const DIALOGS: MatterDialogsData = {
  current: 2,
  target: 3,
  version: 7,
  evidence: [],
  reason: "",
  owners: [{ id: "mem-1", name: "Dana Lee" }],
  reviewOn: "2026-10-31",
  receivedOn: "2026-10-17",
};
const DEADLINE = { timezone: "America/Toronto", sampleMode: false, kinds: DEADLINE_KINDS };

const EMPTY_TASKS: MatterPageData = {
  tab: "tasks",
  overview: {
    client: { name: "Dana Lee" },
    facts: [],
    badges: [],
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

describe("Record a deadline: the dialog on the matter page", () => {
  it("renders only when the page is wired, with the Designer's letter-dialog classes", () => {
    const live = renderToStaticMarkup(createElement(MatterDialogs, { data: { ...DIALOGS, wire: WIRE, deadline: DEADLINE } }));
    expect(live).toContain('<dialog class="dlg wide" id="dDeadline" aria-labelledby="dDeadlineT">');
    expect(live).toContain('id="ddGo" data-act="deadline" data-org="org-1" data-matter="m-1" data-version="7"');
    expect(live).toContain('<input id="ddZ" autoComplete="off" value="America/Toronto"/>');
    expect(live).toContain('<option value="correspondence" selected="">Set in a government letter</option>');
    expect(live).toContain("Official source URL");
    expect(live).toContain("Source retrieved on");
    expect(live).not.toContain("This firm is in sample mode");
    expect(renderToStaticMarkup(createElement(MatterDialogs, { data: { ...DIALOGS, deadline: DEADLINE } }))).not.toContain("dDeadline");
    expect(renderToStaticMarkup(createElement(MatterDialogs, { data: { ...DIALOGS, wire: WIRE } }))).not.toContain("dDeadline");
  });

  it("says honestly that a sample-mode firm will refuse a real matter's deadline", () => {
    const html = renderToStaticMarkup(createElement(MatterDialogs, { data: { ...DIALOGS, wire: WIRE, deadline: { ...DEADLINE, sampleMode: true } } }));
    expect(html).toContain('<div class="alert warn" style="margin-bottom:12px">');
    expect(html).toContain("The firm will refuse this one.");
  });

  it("offers Record deadline on the Tasks and deadlines tab only, and only when wired for a role that may record", () => {
    const header = (tab: "tasks" | "overview", extra: object) =>
      renderToStaticMarkup(createElement(MatterTopBar, { data: { client: { name: "Dana Lee" }, pills: [], hold: null, tab, ...extra } }));
    expect(header("tasks", { wire: WIRE, deadline: true })).toContain('<button class="btn s sm" data-open="dDeadline">');
    expect(header("overview", { wire: WIRE, deadline: true })).not.toContain("dDeadline");
    expect(header("tasks", { wire: WIRE, deadline: false })).not.toContain("dDeadline");
    expect(header("tasks", { deadline: true })).not.toContain("dDeadline");
  });

  it("puts the action in the empty Tasks tab, without sample rows", () => {
    const html = renderToStaticMarkup(createElement(SheetMatter, { data: { ...EMPTY_TASKS, tasks: { deadline: null, tasks: [], record: true } } }));
    expect(html).toContain('<div class="emp-a"><button class="btn p sm" data-open="dDeadline">Record a deadline</button></div>');
    expect(html).not.toMatch(/Northline|Amara|Priya|Kofi|Rafael|Daniel|NL-2026|30 Oct/);
    expect(renderToStaticMarkup(createElement(SheetMatter, { data: EMPTY_TASKS }))).not.toContain("emp-a");
  });
});
