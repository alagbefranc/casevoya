import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatterBilling, MatterDialogs, MatterTasks, MatterTopBar, type MatterDialogsData } from "@/components/sheet/designer/matter";
import { SheetMatters, type MattersData } from "@/components/sheet/designer/matters";
import { SheetGovernment } from "@/components/sheet/designer/government";
import { MatterSubmissions } from "@/components/sheet/designer/matter-government";
import { SheetTasks, TaskEditDialog } from "@/components/sheet/designer/tasks";
import { governmentError } from "@/modules/government/present";
import { personDetailsChanged } from "@/modules/sheet/edit-person";
import { heldCents, matterBilling, moneyCell, owedCents } from "@/modules/sheet/matter-billing";
import { allowedStageIndexes, dayMonthYear, deadlineBadge, defaultTargetStage, taskDue, weekdayDayMonth } from "@/modules/sheet/matter-present";
import { consultantOptions } from "@/modules/sheet/new-matter";
import { readNewTask, readTaskEdit, taskChangeError } from "@/modules/sheet/new-task";
import { matterMatches, MATTER_STAGES } from "@/modules/sheet/present";
import { statedDeadline } from "@/modules/sheet/government-present";
import { dayLabel, deadlineConfirmable, taskManageWire } from "@/modules/sheet/tasks-present";

const WIRE = { organizationId: "org-1", matterId: "m-1", version: 7 };
const UUID = "11111111-1111-4111-8111-111111111111";

describe("Change stage offers only the moves the database allows", () => {
  it("mirrors app.matter_stage_transition_allowed", () => {
    const label = (stage: string) => allowedStageIndexes(stage).map((index) => MATTER_STAGES[index]);
    expect(label("engagement_pending")).toEqual(["intake"]);
    expect(label("evidence_collection")).toEqual(["intake", "preparation"]);
    expect(label("client_confirmation")).toEqual(["preparation", "consultant_review", "ready_to_submit"]);
    expect(label("closed")).toEqual(["engagement_pending", "post_decision"]);
    expect(MATTER_STAGES[defaultTargetStage("evidence_collection") as number]).toBe("preparation");
    expect(MATTER_STAGES[defaultTargetStage("closed") as number]).toBe("post_decision");
  });

  it("disables the other stages with the reason, picks the next one, and hides the internal version", () => {
    const data: MatterDialogsData = {
      current: 2,
      target: 3,
      version: 7,
      evidence: [],
      reason: "",
      owners: [{ id: UUID, name: "Walk Tester" }],
      reviewOn: "2026-11-02",
      receivedOn: "2026-10-19",
      wire: WIRE,
      allowed: allowedStageIndexes("evidence_collection"),
      minReview: "2026-10-20",
    };
    const html = renderToStaticMarkup(createElement(MatterDialogs, { data }));
    expect(html).not.toContain("version 7");
    // Intake (1) and Preparation (3) stay open; Consultant review (4) is disabled and says why.
    expect(html).toContain('<input type="radio" name="stg" value="1"/>');
    expect(html).toContain('<input type="radio" name="stg" checked="" value="3"/>');
    expect(html).toContain('<input type="radio" disabled="" name="stg" value="4"/>');
    expect(html).toContain("can’t move straight to Consultant review");
    expect(html).toContain("Not a next step");
    expect(html).toContain('id="stGo" data-act="stage"');
    expect(html).toContain('<input type="date" min="2026-10-20" value="2026-11-02"/>');
    // The letter's deadline is a date when wired.
    expect(html).toContain('<input id="ltD" type="date"/>');
  });
});

describe("The matter header", () => {
  it("shows Resume instead of reopening the hold dialog while the matter is on hold", () => {
    const html = renderToStaticMarkup(
      createElement(MatterTopBar, { data: { client: { name: "Ana" }, pills: [], hold: { reason: "Waiting on client", parts: [] }, tab: "overview", wire: WIRE } }),
    );
    expect(html).not.toContain("data-hold");
    expect(html).toContain('data-act="resume" data-org="org-1" data-matter="m-1" data-version="7"><svg');
    expect(html).toContain(">Resume</button>");
  });

  it("wires the crumbs and offers Add task on the Tasks tab", () => {
    const html = renderToStaticMarkup(
      createElement(MatterTopBar, { data: { client: { name: "Ana" }, pills: [], hold: null, tab: "tasks", wire: WIRE, crumbs: { client: "/sheet/clients?tab=person&person=p" }, addTask: true } }),
    );
    expect(html).toContain('<button class="crumb" data-nav="/sheet/matters">');
    expect(html).toContain('<button class="crumb" data-nav="/sheet/clients?tab=person&amp;person=p">');
    expect(html).toContain('data-dlg="dlgTask"');
  });
});

describe("Dates show their year when not in the current one", () => {
  it("labels task, deadline and list dates", () => {
    expect(dayMonthYear("2026-11-20", "2026-10-19")).toBe("20 Nov");
    expect(dayMonthYear("2020-06-01", "2026-10-19")).toBe("1 Jun 2020");
    expect(taskDue("2027-01-04", "2026-10-19")).toBe("due 4 Jan 2027");
    expect(dayLabel("2027-01-04", "2026-10-19")).toBe("Mon 4 Jan 2027");
    expect(dayLabel("2026-10-20", "2026-10-19")).toBe("Tue 20 Oct");
    expect(weekdayDayMonth("2027-01-04", "2026-10-19")).toBe("Mon 4 Jan 2027");
  });

  it("says how many more deadlines the matter has in the Next deadline pill", () => {
    expect(deadlineBadge({ dueOn: "2026-11-20", dueAt: null, timezone: "America/Toronto", verification: "tentative" }, 2, "2026-10-19").detail).toBe(
      "Fri 20 Nov (unverified), +2 more",
    );
    expect(deadlineBadge(null).detail).toBe("—");
  });
});

describe("Every upcoming deadline on the Tasks tab, with Confirm and task controls", () => {
  const deadline = (label: string, confirm: boolean) => ({
    label,
    due: "Fri 20 Nov 2026",
    verified: { tone: "chg" as const, label: "Not verified yet" },
    source: ["IRCC letter"],
    origin: "Not derived from a rule.",
    reminders: [],
    timezone: "Official: end of day (America/Toronto)",
    confirm: confirm ? { "data-deadline-confirm": "d-1", "data-org": "org-1", "data-version": "1" } : null,
    confirmWhy: confirm ? null : "A licensed consultant or the firm owner confirms a legal or letter deadline.",
  });

  it("lists each deadline and puts Confirm next to Not verified yet", () => {
    const html = renderToStaticMarkup(
      createElement(MatterTasks, {
        deadlines: [deadline("Respond to IRCC", true), deadline("Medical exam", false)],
        tasks: [
          {
            title: "Draft cover letter",
            parts: ["Internal"],
            badge: { tone: "gr", label: "Open" },
            owner: { name: "Walk Tester" },
            done: { "data-task-done": "t-1", "data-org": "org-1", "data-version": "2" },
            manage: { "data-task-open": "t-1" },
          },
        ],
      }),
    );
    expect(html.match(/<div class="panel rv"/g)).toHaveLength(2);
    expect(html).toContain('data-deadline-confirm="d-1" data-org="org-1" data-version="1"');
    expect(html).toContain('title="A licensed consultant or the firm owner confirms a legal or letter deadline."');
    expect(html).toContain('<span class="ck" role="checkbox" aria-checked="false" tabindex="0" aria-label="Mark “Draft cover letter” done" data-task-done="t-1"');
    expect(html).toContain('aria-label="Manage Draft cover letter" data-task-open="t-1"');
  });

  it("decides who may confirm as public.confirm_deadline does", () => {
    const letter = { kind: "correspondence", verification: "tentative", sourceUrl: "https://www.canada.ca/x", ruleVersionId: null };
    expect(deadlineConfirmable(letter, "firm_owner", true)).toEqual({ ok: true });
    expect(deadlineConfirmable(letter, "case_manager", false).ok).toBe(false);
    expect(deadlineConfirmable({ ...letter, sourceUrl: null }, "licensed_consultant", true)).toEqual({
      ok: false,
      why: "It stays tentative until it cites its official source or a published rule.",
    });
    expect(deadlineConfirmable({ ...letter, kind: "internal" }, "case_manager", false)).toEqual({ ok: true });
    expect(deadlineConfirmable({ ...letter, verification: "confirmed" }, "firm_owner", true)).toEqual({ ok: false, why: null });
  });

  it("gives the Tasks page rows a Manage button and the Deadlines rows a Confirm button", () => {
    const html = renderToStaticMarkup(
      createElement(SheetTasks, {
        data: {
          tab: "deadlines",
          counts: { open: 0, escalated: 0 },
          deadlines: {
            rows: [
              {
                label: "Respond to IRCC",
                matter: "CA-2026-0001",
                source: "canada.ca",
                local: { left: "Fri 20 Nov", right: "same zone" },
                verifiedBy: "—",
                state: { tone: "chg", label: "Tentative, confirm" },
                confirm: { "data-deadline-confirm": "d-1", "data-org": "org-1", "data-version": "3" },
              },
            ],
          },
          dialog: { owners: [], dependsOn: [] },
        },
      }),
    );
    expect(html).toContain('Tentative, confirm</span><button class="btn s sm" style="margin-left:8px" data-deadline-confirm="d-1"');
    const wire = taskManageWire({ id: "t-1", version: 4, title: "Call", audience: "internal", due_on: null, owner_membership_id: "m-9" });
    expect(wire).toEqual({ "data-task-open": "t-1", "data-version": "4", "data-title": "Call", "data-due": "", "data-owner": "m-9", "data-audience": "internal" });
  });

  it("renders the Task dialog with a date that can't go before today", () => {
    const html = renderToStaticMarkup(createElement(TaskEditDialog, { data: { organizationId: "org-1", timezone: "America/Toronto", today: "2026-10-19", owners: [{ value: UUID, label: "Walk Tester" }] } }));
    expect(html).toContain('<dialog class="dlg" id="dTask"');
    expect(html).toContain('id="teD" type="date" min="2026-10-19"');
    expect(html).toContain('data-task-done="dialog"');
    expect(html).toContain('data-task-save="1"');
  });
});

describe("Task and deadline dates in the past", () => {
  it("refuses a New task due date before the firm's today", () => {
    const base = { matter: UUID, title: "Call", kind: "internal", owner: UUID, dependsOn: "" };
    expect(readNewTask({ ...base, due: "18/10/2026", today: "2026-10-19" })).toEqual({ error: "The due date can’t be in the past." });
    expect("input" in readNewTask({ ...base, due: "19/10/2026", today: "2026-10-19" })).toBe(true);
    expect(readTaskEdit({ title: " ", due: "" })).toEqual({ error: "Add what the task is." });
    expect(readTaskEdit({ title: "Call", due: "2026-11-01" })).toEqual({ title: "Call", dueOn: "2026-11-01" });
    expect(taskChangeError("a task with an open dependency cannot be completed")).toMatch(/waits on another task/);
  });
});

describe("Billing tab and the Money column", () => {
  const invoice = (number: string, status: string, amount: number, paid: number) => ({
    number,
    amount_cents: amount,
    paid_cents: paid,
    credited_cents: 0,
    status,
    issued_on: "2026-10-02",
    due_on: "2026-11-06",
    fee_category: "professional_fee",
    currency: "CAD",
    is_sample: true,
  });

  it("adds up what is owed and held, in integer cents", () => {
    expect(owedCents(invoice("INV-0001", "partially_paid", 226000, 113000))).toBe(113000);
    expect(owedCents(invoice("INV-0002", "paid", 30000, 30000))).toBe(0);
    expect(
      heldCents([
        { kind: "deposit", status: "verified", direction: "in", amount_cents: 150000 },
        { kind: "deposit", status: "pending_verification", direction: "in", amount_cents: 5000 },
        { kind: "transfer", status: "approved", direction: "out", amount_cents: 30000 },
      ]),
    ).toEqual({ held: 120000, pending: 5000 });
    expect(moneyCell([invoice("INV-0001", "issued", 113000, 0)], [{ kind: "deposit", status: "verified", direction: "in", amount_cents: 50000 }])).toBe(
      "CAD 1,130.00 owed, CAD 500.00 held",
    );
    expect(moneyCell([], [])).toBe("—");
  });

  it("lists the matter's invoices (not “No invoices yet”) when there are some", () => {
    const data = matterBilling({ invoices: [invoice("INV-0001", "issued", 113000, 0), invoice("INV-0002", "paid", 30000, 30000)], entries: [], today: "2026-10-19", hidden: false });
    const html = renderToStaticMarkup(createElement(MatterBilling, { data }));
    expect(html).toContain("INV-0001 (sample)");
    expect(html).toContain("INV-0002 (sample)");
    expect(html).toContain("CAD 1,130.00 due 6 Nov");
    expect(html).not.toContain("No invoices yet");
    const none = renderToStaticMarkup(createElement(MatterBilling, { data: matterBilling({ invoices: [], entries: [], today: "2026-10-19", hidden: true }) }));
    expect(none).toContain("Invoices are shown to billing staff");
  });
});

describe("All matters: saved views, chips, search", () => {
  const base: MattersData = {
    title: "Matters",
    counts: { active: 1, blocked: 0, mine: 1, everyone: 1 },
    rows: [{ href: "/sheet/matters/1", client: { name: "Ana" }, reference: "CA-2026-0001", program: "Work permit", stage: { tone: "blue", label: "Intake" }, government: { tone: "unv", label: "—" }, money: "—", nextDeadline: "—", consultant: null }],
    shown: 1,
    total: 1,
    more: null,
    empty: null,
  };

  it("adds only attributes and a hidden no-match panel to the Designer's list", () => {
    const designer = renderToStaticMarkup(createElement(SheetMatters, { data: base }));
    const live = renderToStaticMarkup(createElement(SheetMatters, { data: { ...base, live: { view: null, chips: "Not yet" } } }));
    expect(live).toContain('<span class="fchip" aria-disabled="true" title="Not yet">Any program</span>');
    expect(live).toContain("data-matters-none");
    const stripped = live
      .replaceAll(' aria-disabled="true" title="Not yet"', "")
      .replace(' data-matters-showing=""', "")
      .replace(/<div class="panel rv" style="--i:4" data-matters-none=""[\s\S]*?<\/div><\/div><\/div>/, "");
    expect(stripped).toBe(designer);
  });

  it("marks the saved view that is shown", () => {
    const live = renderToStaticMarkup(createElement(SheetMatters, { data: { ...base, live: { view: "due", chips: "x" } } }));
    expect(live).toContain('<a class="fchip on" href="/sheet/matters" aria-current="page"');
    expect(live).toContain('<a class="fchip" href="?view=review">');
  });

  it("counts tasks due this week and filters “Awaiting my review” by the viewer", () => {
    const matter = { onHold: false, stage: "intake", nextDue: null, pendingReview: true, title: "Ana", reference: "CA-2026-0001" };
    expect(matterMatches({ ...matter, nextTaskDue: "2026-10-24" }, "due", undefined, "2026-10-19")).toBe(true);
    expect(matterMatches({ ...matter, nextTaskDue: "2026-11-24" }, "due", undefined, "2026-10-19")).toBe(false);
    expect(matterMatches({ ...matter, mine: false }, "review", undefined, "2026-10-19")).toBe(false);
    expect(matterMatches({ ...matter, mine: true }, "review", undefined, "2026-10-19")).toBe(true);
  });

  it("names a firm owner plainly as a responsible consultant (owners count as licensed)", () => {
    const options = consultantOptions(
      [
        { id: "a", name: "Walk Tester", role: "firm_owner" },
        { id: "b", name: "Pat Lee", role: "licensed_consultant" },
      ],
      new Map([["b", "pending"]]),
    );
    expect(options).toEqual([
      { value: "a", label: "Walk Tester" },
      { value: "b", label: "Pat Lee (licence declared)" },
    ]);
  });
});

describe("Government status and the submission handoff", () => {
  it("labels the Evidence field honestly when the page is wired", () => {
    const html = renderToStaticMarkup(
      createElement(SheetGovernment, {
        data: { intro: "", alert: null, rows: [], record: { options: [{ value: "check", label: "Checked, no change" }], save: { "data-gov": "status" } }, history: [] },
      }),
    );
    expect(html).toContain("“Checked, no change” needs none.");
  });

  it("offers Attach evidence on a letter recorded without it", () => {
    const html = renderToStaticMarkup(
      createElement(SheetGovernment, {
        data: {
          intro: "",
          alert: null,
          rows: [{ item: "Status update", status: { tone: "chg", label: "Received" }, recordedBy: "W", evidence: "No evidence yet", verified: "Not verified by staff", lastChecked: "—", attach: { "data-gov": "attach-letter", "data-id": "c-1" } }],
          record: null,
          history: null,
        },
      }),
    );
    expect(html).toContain('<button class="btn s sm" data-gov="attach-letter" data-id="c-1">Attach evidence</button>');
  });

  it("says why Record submission is disabled", () => {
    const html = renderToStaticMarkup(createElement(MatterSubmissions, { data: { package: null, start: null, records: [], record: null, recordWhy: "Start a submission handoff first.", earlier: [] } }));
    expect(html).toContain('aria-disabled="true" title="Start a submission handoff first."');
  });

  it("explains a bad package hash plainly, apart from the version", () => {
    expect(governmentError("a package hash is 64 hex characters")).toBe("The package hash must be its sha256: 64 characters, 0–9 and a–f only. Leave it blank if you don’t have one.");
    expect(governmentError("name the package version")).toMatch(/^Name the package version/);
    expect(statedDeadline("2026-11-20", "2026-10-19")).toBe("20 Nov");
    expect(statedDeadline("Within 30 days", "2026-10-19")).toBe("Within 30 days");
  });
});

describe("Edit details with no changes", () => {
  it("is not a change", () => {
    const current = { display_name: "Ana", email: "ana@example.test", contact_phone: null };
    expect(personDetailsChanged(current, { displayName: "Ana", email: "ana@example.test", phone: null })).toBe(false);
    expect(personDetailsChanged(current, { displayName: "Ana P", email: "ana@example.test", phone: null })).toBe(true);
  });
});
