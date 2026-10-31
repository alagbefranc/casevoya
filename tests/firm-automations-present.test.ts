import { describe, expect, it } from "vitest";
import { automationError, automationProblem, automationsData, kindList, readFirmAutomation } from "@/modules/sheet/automations-present";

const NOW = new Date("2026-10-18T15:00:00Z");
const ZONE = "America/Toronto";

const rule = readFirmAutomation({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Synthetic letters",
  status: "active",
  deadline_kinds: ["correspondence", "legal"],
  offset_days: [2, 30, 7],
  version: 3,
  copied_from: null,
});

describe("Firm automations on the Automations page", () => {
  it("reads a row and checks the editor's fields like the database", () => {
    expect(rule).toMatchObject({ status: "active", kinds: ["correspondence", "legal"], days: [30, 7, 2], copiedFromBuiltIn: false });
    expect(kindList(["legal", "correspondence", "internal"])).toBe("any kind of deadline");
    expect(kindList(["correspondence", "legal"])).toBe("legal deadlines and IRCC and other letters");
    expect(automationProblem({ name: " ", kinds: ["legal"], days: "7" })).toEqual({ error: "Give the automation a name." });
    expect(automationProblem({ name: "X", kinds: [], days: "7" })).toEqual({ error: "Choose at least one kind of deadline." });
    expect(automationProblem({ name: "X", kinds: ["legal"], days: "400" })).toHaveProperty("error");
    expect(automationProblem({ name: "X", kinds: ["legal"], days: "2, 30 7" })).toEqual({ days: [30, 7, 2] });
    expect(automationError("someone else changed this automation; reload")).toMatch(/Reload/);
    expect(automationError("automation denied")).toMatch(/firm owner or licensed consultant/);
    expect(automationError('relation "x" does not exist')).toBe("That action could not be completed.");
  });

  it("lists the built-in rule and the firm's automations, and shows the chosen one with its own steps", () => {
    const paused = { ...rule, id: "22222222-2222-4222-8222-222222222222", name: "Synthetic paused", status: "paused" as const };
    const base = { tab: "builder" as const, days: [14, 7], firmSet: true, quiet: "21:00–08:00", runs: [], now: NOW, timeZone: ZONE, automations: [rule, paused] };
    const builtIn = automationsData({ ...base, manage: { organizationId: "org" } });
    expect(builtIn.name).toBe("Deadline reminders");
    expect(builtIn.manage?.selected).toBeNull();
    expect(builtIn.manage?.builtInDays).toEqual([14, 7]);
    expect(builtIn.others.map((o) => [o.label, o.on, o.current])).toEqual([
      ["Deadline reminders (built in)", true, true],
      ["Synthetic letters", true, false],
      ["Synthetic paused", false, false],
    ]);
    expect(builtIn.intro).toContain("Make a copy");

    const shown = automationsData({ ...base, selectedId: rule.id, manage: { organizationId: "org" } });
    expect(shown.name).toBe("Synthetic letters");
    expect(shown.pills[0]).toBe("Active");
    expect(shown.manage?.selected?.id).toBe(rule.id);
    expect(shown.steps.map((s) => s.title)).toEqual(["When", "If", "Then", "And", "Stop when"]);
    expect(shown.steps[2].text).toEqual({ left: "Email client reminders 30, 7 and 2 days before", right: expect.stringContaining("approved reminder email") });
    expect(shown.settings.find((s) => s.label === "Reminder days")?.value).toBe("30, 7 and 2");

    const readOnly = automationsData({ ...base, selectedId: paused.id });
    expect(readOnly.pills[0]).toBe("Paused");
    expect(readOnly.manage).toBeNull();
    expect(readOnly.intro).toContain("A firm owner or licensed consultant can change it.");
  });
});
