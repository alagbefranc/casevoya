import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FIRM_SETTINGS,
  HOME_QUICK,
  HOME_TASK_READ,
  HOME_TASK_SHOWN,
  TASKS_PAGE,
  activityMatter,
  calendarDayHref,
  filterHidden,
  homeMonth,
  homeTaskTokens,
  monthNav,
  nextHomeChip,
  notificationHref,
  shiftMonth,
  withoutParam,
} from "@/modules/sheet/home-controls";
import { INVOICE_DRAFT_MS, invoiceDialogOpening } from "@/modules/sheet/finance-present";
import { voDraftsWaiting } from "@/modules/sheet/vo-present";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MATTER = "33333333-3333-4333-8333-333333333333";
const TODAY = "2026-10-19";

describe("home task bar", () => {
  it("tags a task mine, today or overdue", () => {
    expect(homeTaskTokens({ owner_membership_id: ME, due_on: TODAY }, ME, TODAY)).toBe("mine today");
    expect(homeTaskTokens({ owner_membership_id: ME, due_on: "2026-10-01" }, ME, TODAY)).toBe("mine overdue");
    expect(homeTaskTokens({ owner_membership_id: OTHER, due_on: "2026-10-01" }, ME, TODAY)).toBe("overdue");
    expect(homeTaskTokens({ owner_membership_id: OTHER, due_on: "2026-11-01" }, ME, TODAY)).toBe("");
    expect(homeTaskTokens({ owner_membership_id: null, due_on: null }, ME, TODAY)).toBe("");
    expect(homeTaskTokens({ owner_membership_id: ME, due_on: null }, ME, TODAY)).toBe("mine");
  });

  const rows = [
    { text: "Review passport Priya Sharma", flags: "mine today" },
    { text: "Call Kofi Mensah", flags: "overdue" },
    { text: "Send proposal Tomás", flags: "mine" },
    { text: "Confirm biometrics", flags: "today" },
  ];

  it("matches search text case-insensitively and the chip's token", () => {
    expect(filterHidden(rows, "", "mine").hidden).toEqual([false, true, false, true]);
    expect(filterHidden(rows, "", "today").hidden).toEqual([false, true, true, false]);
    expect(filterHidden(rows, "  PRIYA ", "").hidden).toEqual([false, true, true, true]);
    expect(filterHidden(rows, "kofi", "mine")).toEqual({ hidden: [true, true, true, true], shown: 0 });
    expect(filterHidden(rows, "", "").shown).toBe(4);
  });

  it("shows at most the cap of matching rows", () => {
    const many = Array.from({ length: HOME_TASK_READ }, (_, index) => ({ text: `Task ${index}`, flags: index % 2 ? "mine" : "" }));
    const all = filterHidden(many, "", "", HOME_TASK_SHOWN);
    expect(all.shown).toBe(8);
    expect(all.hidden.slice(0, 8)).toEqual(Array(8).fill(false));
    const mine = filterHidden(many, "", "mine", HOME_TASK_SHOWN);
    expect(mine.shown).toBe(8);
    expect(mine.hidden.filter((hidden) => !hidden)).toHaveLength(8);
    expect(mine.hidden[1]).toBe(false);
    expect(mine.hidden[0]).toBe(true);
  });

  it("keeps Mine and Today exclusive, and turns the chip that is on off", () => {
    expect(nextHomeChip("Mine", "Today")).toBe("Today");
    expect(nextHomeChip("Today", "Mine")).toBe("Mine");
    expect(nextHomeChip("Mine", "Mine")).toBeNull();
    expect(nextHomeChip(null, "Mine")).toBe("Mine");
  });

  it("reads more tasks than it shows, and Filter opens the Tasks page", () => {
    expect(HOME_TASK_READ).toBe(30);
    expect(HOME_TASK_SHOWN).toBe(8);
    expect(TASKS_PAGE).toBe("/sheet/tasks");
  });
});

describe("home quick actions and header", () => {
  it("start each action on its page", () => {
    expect(HOME_QUICK).toEqual({
      lead: "/sheet/pipeline?new=1",
      document: "/sheet/documents",
      consultation: "/sheet/consultations?dlg=book",
      invoice: "/sheet/finance?dlg=invoice",
      draft: "/sheet/drafts",
    });
  });

  it("sends the firm-name button to Settings > Firm", () => {
    expect(FIRM_SETTINGS).toBe("/sheet/settings");
  });

  it("the target pages open the dialog each action names", () => {
    const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");
    // Lead pipeline: ?new=1 opens New lead.
    expect(read("src/components/sheet/pipeline-acts.ts")).toContain('if (params.get("new") === "1") window.setTimeout(() => open("dlgLead"), 300);');
    // Consultations: ?dlg=book opens Book for a client.
    expect(read("src/components/sheet/use-sheet.ts")).toContain('if (dialogParam === "book") window.setTimeout(() => openDialog("dlgBook"), 300);');
  });
});

describe("New invoice from ?dlg=invoice", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  const draft = { matter: "m1", amount: "100.00", key: "inv-1", at: now - 60_000 };

  it("opens empty from a plain link", () => {
    expect(invoiceDialogOpening("?dlg=invoice", null, now)).toEqual({ open: true, draft: null });
  });

  it("refills a fresh step-up draft, never a stale or undated one", () => {
    expect(invoiceDialogOpening("?dlg=invoice", draft, now)).toEqual({ open: true, draft });
    expect(invoiceDialogOpening("?dlg=invoice", { ...draft, at: now - INVOICE_DRAFT_MS - 1 }, now).draft).toBeNull();
    expect(invoiceDialogOpening("?dlg=invoice", { matter: "m1", key: "inv-1" }, now).draft).toBeNull();
  });

  it("stays shut without the flag", () => {
    expect(invoiceDialogOpening("", draft, now)).toEqual({ open: false, draft: null });
    expect(invoiceDialogOpening("?dlg=refund", draft, now).open).toBe(false);
  });

  it("drops only the dialog flag when it closes", () => {
    expect(withoutParam("/sheet/finance", "?dlg=invoice", "dlg")).toBe("/sheet/finance");
    expect(withoutParam("/sheet/finance", "?tab=payments&dlg=invoice", "dlg")).toBe("/sheet/finance?tab=payments");
    expect(withoutParam("/sheet/consultations", "?dlg=book", "dlg")).toBe("/sheet/consultations");
  });
});

describe("home calendar", () => {
  const current = { year: 2026, month: 10 };

  it("reads ?month=YYYY-MM, else the current month", () => {
    expect(homeMonth("2026-12", current)).toEqual({ year: 2026, month: 12 });
    expect(homeMonth(undefined, current)).toEqual(current);
    expect(homeMonth("2026-13", current)).toEqual(current);
    expect(homeMonth("1999-01", current)).toEqual(current);
    expect(homeMonth("2026-1", current)).toEqual(current);
    expect(homeMonth("x", current)).toEqual(current);
  });

  it("moves across years", () => {
    expect(shiftMonth(2026, 12, 1)).toBe("2027-01");
    expect(shiftMonth(2026, 1, -1)).toBe("2025-12");
    expect(monthNav("/sheet", 2026, 10)).toEqual({ prev: "/sheet?month=2026-09", next: "/sheet?month=2026-11" });
    expect(monthNav("/sheet/sample-mode", 2026, 1).prev).toBe("/sheet/sample-mode?month=2025-12");
  });

  it("opens the Calendar on a day's week", () => {
    expect(calendarDayHref(2026, 10, 5)).toBe("/sheet/calendar?week=2026-10-05");
    expect(calendarDayHref(2027, 1, 31)).toBe("/sheet/calendar?week=2027-01-31");
  });
});

describe("home notifications", () => {
  it("finds the matter an activity row is about", () => {
    expect(activityMatter({ object_table: "public.matters", object_id: MATTER, context: {} })).toBe(MATTER);
    expect(activityMatter({ object_table: "public.agreements", object_id: OTHER, context: { matter_id: MATTER } })).toBe(MATTER);
    expect(activityMatter({ object_table: "public.inbound_emails", object_id: OTHER, context: { message_id: "x" } })).toBeNull();
    expect(activityMatter({ object_table: null, object_id: null, context: { matter_id: "not-a-uuid" } })).toBeNull();
    expect(activityMatter({ object_table: null, object_id: null, context: null })).toBeNull();
  });

  it("links each to its source", () => {
    expect(notificationHref("document.request_created", MATTER)).toBe("/sheet/documents");
    expect(notificationHref("document.uploaded", null)).toBe("/sheet/documents");
    expect(notificationHref("email.received", null)).toBe("/sheet/inbox");
    expect(notificationHref("matter.stage_transition", MATTER)).toBe(`/sheet/matters/${MATTER}`);
    expect(notificationHref("agreement.quote_accepted", MATTER)).toBe(`/sheet/matters/${MATTER}`);
    expect(notificationHref("agreement.signed", null)).toBe("/sheet/agreements");
    expect(notificationHref("invitation.accepted", null)).toBe("/sheet/invitations");
    expect(notificationHref("task.overdue", null)).toBe("/sheet/tasks");
    expect(notificationHref("deadline.confirmed", null)).toBe("/sheet/calendar?tab=deadlines");
    expect(notificationHref("firm.other", null)).toBe("/sheet/notifications");
  });
});

describe("Vo drafts count", () => {
  it("counts reply drafts and document readings, as the drafts page lists them", () => {
    expect(voDraftsWaiting(3, 1)).toBe(4);
    expect(voDraftsWaiting(null, undefined)).toBe(0);
    expect(voDraftsWaiting(2, null)).toBe(2);
  });
});
