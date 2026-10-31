import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// firm_mfa_resets and decide_mfa_reset check app.in_active_org, which only reads the
// x-casevoya-org header. Without it the owner page listed nothing in production.
describe("/app/two-step-resets sends the firm as the active org", () => {
  it("lists each firm with an org-scoped client", () => {
    const page = readFileSync("src/app/app/two-step-resets/page.tsx", "utf8");
    expect(page).toMatch(/createClient\(\{ organizationId: f\.id \}\)/);
    expect(page).toMatch(/name="orgId" value=\{firm\.id\}/);
  });
  it("decides with an org-scoped client", () => {
    const actions = readFileSync("src/app/app/two-step-resets/actions.ts", "utf8");
    expect(actions).toMatch(/createClient\(\{ organizationId: orgId \}\)/);
    expect(actions).toMatch(/!isUuid\(orgId\)/);
  });
});
