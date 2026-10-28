import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetTasks, TaskEditDialog, TasksHeader, type TasksData } from "@/components/sheet/designer/tasks";
import { notificationParts, readItems, type NotificationItem } from "@/modules/sheet/notifications-present";
import {
  blockerRecorded,
  checklistPart,
  checklistProgress,
  dueTimeIn,
  estimateLabel,
  historyLine,
  readChecklist,
  readChecklistText,
  readDueTime,
  readEstimate,
  recurrencePart,
  taskDetailError,
  zoneOptions,
} from "@/modules/sheet/task-detail";
import { dueInZone, TASK_ESCALATE_ROLES } from "@/modules/sheet/tasks-present";

/** OPS-01: the Task dialog's detail, the Watching chip, Escalate overdue and task notifications. */
describe("Task detail presentation", () => {
  it("reads a checklist and shows its progress", () => {
    const items = readChecklist([{ text: " Passport ", done: true }, { text: "Photos", done: true }, { text: "Police certificate" }, { nope: 1 }, "x"]);
    expect(items).toEqual([
      { text: "Passport", done: true },
      { text: "Photos", done: true },
      { text: "Police certificate", done: false },
    ]);
    expect(checklistProgress(items)).toBe("2/3 done");
    expect(checklistProgress([])).toBe("No items yet");
    expect(checklistPart(items)).toBe("Checklist 2/3");
    expect(checklistPart([])).toBeNull();
  });

  it("words estimates, repeats, due times and history", () => {
    expect(estimateLabel(45)).toBe("45 min");
    expect(estimateLabel(90)).toBe("1 h 30 min");
    expect(estimateLabel(120)).toBe("2 h");
    expect(estimateLabel(null)).toBeNull();
    expect(recurrencePart("weekly")).toBe("Repeats weekly");
    expect(recurrencePart("daily")).toBeNull();
    expect(dueTimeIn("2030-01-15T13:30:00Z", "America/Halifax")).toBe("09:30");
    expect(dueTimeIn(null, "America/Halifax")).toBe("");
    const names = { user: (id: string | null) => (id === "u1" ? "Dana Lee" : "Someone"), member: (id: string | null) => (id === "m2" ? "Sam Roy" : "a former member") };
    const at = "2026-10-23T18:05:00Z";
    expect(historyLine({ event_kind: "reassigned", to_status: null, to_membership_id: "m2", actor_user_id: "u1", created_at: at }, names, "America/Toronto")).toBe(
      "Dana Lee gave it to Sam Roy · 23 Oct, 14:05",
    );
    expect(historyLine({ event_kind: "status", to_status: "blocked", to_membership_id: null, actor_user_id: "u1", created_at: at }, names, "America/Toronto")).toBe(
      "Dana Lee marked it blocked · 23 Oct, 14:05",
    );
    expect(blockerRecorded("Dana Lee", at, "America/Toronto")).toBe("Recorded by Dana Lee, 23 Oct, 14:05");
  });

  it("checks what the dialog sends", () => {
    expect(readEstimate("")).toEqual({ minutes: null });
    expect(readEstimate("30")).toEqual({ minutes: 30 });
    expect(readEstimate("-1")).toEqual({ error: "The estimate is a number of minutes, up to 100000." });
    expect(readEstimate("100001")).toEqual({ error: "The estimate is a number of minutes, up to 100000." });
    expect(readDueTime("09:30")).toEqual({ time: "09:30" });
    expect(readDueTime("25:00")).toEqual({ error: "Enter the due time as HH:MM." });
    expect(readChecklistText("  Call  the client ")).toEqual({ text: "Call the client" });
    expect("error" in readChecklistText(" ")).toBe(true);
    expect(zoneOptions("America/Toronto", "Europe/Paris")).toContain("Europe/Paris");
    expect(zoneOptions("America/Toronto").filter((zone) => zone === "America/Toronto")).toHaveLength(1);
  });

  it("never passes a database message through", () => {
    expect(taskDetailError("a task with an open dependency cannot be completed")).toBe("It waits on another task that is still open. Finish that one first.");
    expect(taskDetailError("task dependencies cannot cycle")).toBe("That would make the tasks wait on each other.");
    expect(taskDetailError("a watcher must be active staff")).toBe("Choose an active staff member to watch it.");
    expect(taskDetailError("task version conflict")).toMatch(/Someone changed this task/);
    expect(taskDetailError("task watcher denied")).toBe("Your role can’t change this task.");
  });

  it("shows a date-only due in another zone than the firm's with that zone", () => {
    expect(dueInZone("2030-01-15", null, "America/Toronto", "America/Toronto", "2030-01-01")).toBe("Tue 15 Jan");
    expect(dueInZone("2030-01-15", null, "America/Halifax", "America/Toronto", "2030-01-01")).toBe("Tue 15 Jan (AT)");
    expect(dueInZone("2030-01-15", "2030-01-15T13:30:00Z", "America/Halifax", "America/Toronto", "2030-01-01")).toBe("Tue 15 Jan 09:30 AT");
  });
});

describe("Task dialog, Watching chip and Escalate overdue", () => {
  const dialog = renderToStaticMarkup(
    createElement(TaskEditDialog, { data: { organizationId: "org-1", timezone: "America/Toronto", today: "2026-10-24", owners: [], zones: zoneOptions("America/Toronto") } }),
  );

  it("keeps the Task dialog and adds the detail fields in the Designer's parts", () => {
    expect(dialog).toContain('<dialog class="dlg" id="dTask"');
    for (const id of ["teTm", "teZ", "teE", "teR", "teW", "teWS", "teP", "tePS", "teK", "teKI", "teKP", "teB", "teBR", "teH"]) expect(dialog).toContain(`id="${id}"`);
    expect(dialog).toContain('<option value="America/Toronto">America/Toronto</option>');
    expect(dialog).toContain('<option value="weekly">Weekly</option>');
    expect(dialog).toContain('<textarea class="ta" id="teB"');
    expect(dialog).toContain('data-task-watch="add"');
    expect(dialog).toContain('data-task-dep="add"');
    expect(dialog).toContain('data-task-check="add"');
    expect(dialog).toContain('data-task-block="set"');
    expect(dialog).toContain("Watchers get the same in-app notifications as the owner");
  });

  const tasks = (over: Partial<NonNullable<TasksData["internal"]>>): TasksData => ({
    tab: "internal",
    counts: { open: 1, escalated: 0 },
    internal: { alert: null, rows: [], ...over },
    dialog: { owners: [], dependsOn: [] },
  });

  it("offers the Watching chip on the live page only", () => {
    expect(renderToStaticMarkup(createElement(SheetTasks, { data: tasks({ watching: true }) }))).toContain('<button class="fchip" aria-pressed="false">Watching</button>');
    expect(renderToStaticMarkup(createElement(SheetTasks, { data: tasks({}) }))).not.toContain("Watching");
  });

  it("offers Escalate overdue to owners and consultants only", () => {
    expect(TASK_ESCALATE_ROLES).toEqual(["firm_owner", "licensed_consultant"]);
    const live = renderToStaticMarkup(createElement(TasksHeader, { tab: "internal", counts: { open: 1, escalated: 0 }, escalate: { "data-task-escalate": "org-1" } }));
    expect(live).toContain('data-task-escalate="org-1"');
    expect(live).toContain("Escalate overdue");
    expect(renderToStaticMarkup(createElement(TasksHeader, { tab: "internal", counts: { open: 1, escalated: 0 } }))).not.toContain("Escalate overdue");
  });
});

describe("Task notifications", () => {
  const base: NotificationItem = {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "task",
    occurred_at: "2026-10-24T14:00:00Z",
    matter_id: "m-1",
    actor_name: "Dana Lee",
    subject: "Review passport",
    detail: "done",
    href: "/sheet/matters/m-1?tab=tasks",
    read: false,
  };
  const matter = () => "ON-2026-0002 (Ana Pereira)";

  it("keeps task rows from the database", () => {
    expect(readItems([base])).toHaveLength(1);
  });

  it("says what happened to the task", () => {
    const text = (detail: string) =>
      notificationParts({ ...base, detail }, matter)
        .map((part) => (typeof part === "string" ? part : part.b))
        .join("");
    expect(text("done")).toBe("Dana Lee marked done Review passport on ON-2026-0002 (Ana Pereira)");
    expect(text("blocked")).toBe("Dana Lee marked blocked Review passport on ON-2026-0002 (Ana Pereira)");
    expect(text("reassigned_you")).toBe("Dana Lee gave you Review passport on ON-2026-0002 (Ana Pereira)");
    expect(text("reassigned")).toBe("Dana Lee reassigned Review passport on ON-2026-0002 (Ana Pereira)");
    expect(text("escalated")).toBe("Overdue and escalated: Review passport on ON-2026-0002 (Ana Pereira)");
  });
});
