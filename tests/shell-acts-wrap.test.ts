import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Below 900px a page header's actions wrap instead of pushing the last button off a 390px screen (Automations: Edit, Pause, Duplicate, New automation). */
describe("page header actions on a phone", () => {
  it("wrap inside the screen width", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/kit/shell.css"), "utf8");
    const mobile = css.slice(css.indexOf("@media (max-width:900px)"));
    expect(mobile).toMatch(/\.acts\{[^}]*flex-wrap:wrap/);
    expect(mobile).toMatch(/\.acts\{[^}]*max-width:100%/);
  });
});
