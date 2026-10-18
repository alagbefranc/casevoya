import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOTICE } from "@/modules/sheet/home-present";
import { MATTER_EVENT } from "@/modules/sheet/matter-present";

/** Every audit action name the migrations can write, as quoted 'area.verb' strings. */
function writtenActions(): Set<string> {
  const dir = join(process.cwd(), "supabase", "migrations");
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql"))) {
    for (const match of readFileSync(join(dir, file), "utf8").matchAll(/'([a-z_]+\.[a-z_]+)'/g)) names.add(match[1]);
  }
  return names;
}

describe("activity lists", () => {
  // The lists filter audit_log by action. A name the database never writes shows nothing, silently.
  it("only name audit actions the database actually writes", () => {
    const written = writtenActions();
    const missing = [...Object.keys(NOTICE), ...Object.keys(MATTER_EVENT)].filter((action) => !written.has(action));
    expect(missing).toEqual([]);
  });

  it("show stage changes, holds and the sample case", () => {
    for (const action of ["matter.stage_override", "matter.on_hold_set", "matter.on_hold_cleared", "firm.sample_case_created"]) {
      expect(NOTICE[action]).toBeTruthy();
      expect(MATTER_EVENT[action]).toBeTruthy();
    }
  });
});
