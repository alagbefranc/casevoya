import { describe, expect, it } from "vitest";
import { assembleWorkflows, cleanStages, move, workflowError, workflowProblem, workflowSummary } from "@/modules/sheet/workflows-present";

describe("workflows presenter", () => {
  it("moves an entry one place and ignores moves off either end", () => {
    expect(move(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(move(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(move(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(move(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("cleans stages and finds what to fix before saving", () => {
    const stages = cleanStages([
      { name: " Intake ", items: [{ kind: "document", title: " Passport ", detail: " ", owner: "client", due_offset_days: 400 }, { kind: "step", title: "  ", detail: "", owner: "staff", due_offset_days: null }] },
    ]);
    expect(stages).toEqual([{ name: "Intake", items: [{ kind: "document", title: "Passport", detail: "", owner: "client", due_offset_days: 365 }] }]);
    expect(workflowProblem("", stages)).toMatch(/name/);
    expect(workflowProblem("W", [])).toMatch(/at least one stage/);
    expect(workflowProblem("W", [{ name: "", items: [] }])).toBe("Name stage 1.");
    expect(workflowProblem("W", stages)).toBeNull();
    expect(workflowSummary({ stages })).toBe("1 stage · 0 steps · 1 document request");
  });

  it("puts database refusals in words", () => {
    expect(workflowError("someone else changed this workflow; reload")).toMatch(/Reload/);
    expect(workflowError("workflow denied")).toMatch(/firm owner or a licensed consultant/);
    expect(workflowError("stage 2 needs a name of up to 120 characters")).toBe("Stage 2 needs a name of up to 120 characters.");
    expect(workflowError("weird internal")).toMatch(/wasn’t saved/);
  });

  it("assembles workflows in stage and item order with the shared source", () => {
    const [view] = assembleWorkflows(
      [{ id: "w", name: "W", program_key: null, description: null, status: "active", version: 3, updated_at: "2026-10-30", source_template_id: "t", source_version_id: "v" }],
      [
        { id: "s2", workflow_id: "w", position: 1, name: "Second" },
        { id: "s1", workflow_id: "w", position: 0, name: "First" },
      ],
      [
        { id: "i2", stage_id: "s1", position: 1, kind: "document", title: "B", detail: null, owner: "client", due_offset_days: 5 },
        { id: "i1", stage_id: "s1", position: 0, kind: "step", title: "A", detail: "d", owner: "staff", due_offset_days: null },
      ],
      new Map([["t", { title: "Shared", versionNumbers: new Map([["v", 2]]) }]]),
    );
    expect(view.stages.map((stage) => stage.name)).toEqual(["First", "Second"]);
    expect(view.stages[0].items.map((item) => item.title)).toEqual(["A", "B"]);
    expect(view.copiedFrom).toEqual({ templateId: "t", title: "Shared", versionNumber: 2 });
    expect(view.rowVersion).toBe(3);
  });
});
