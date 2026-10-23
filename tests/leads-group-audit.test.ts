import { describe, expect, it } from "vitest";
import { duplicateAlert, duplicateFor, type LeadRow } from "@/modules/leads/present";

function lead(overrides: Partial<LeadRow>): LeadRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    display_name: "Sam Example",
    email: null,
    phone: null,
    date_of_birth: null,
    service_interest: null,
    source: "phone",
    source_detail: null,
    stage_id: "s-new",
    owner_membership_id: null,
    proposed_fee_cents: null,
    same_person_lead_id: null,
    converted_at: null,
    lost_at: null,
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z",
    version: 1,
    is_sample: false,
    ...overrides,
  };
}

describe("Pipeline: duplicate suggestions compare email without case (CRM-02)", () => {
  const mine = lead({ email: "Sam@Example.test " });
  const older = lead({ id: "00000000-0000-4000-8000-000000000002", email: "sam@example.test", created_at: "2025-03-01T12:00:00Z" });

  it("matches the same name and the same address written in another case", () => {
    const match = duplicateFor(mine, [mine, older], []);
    expect(match?.matched).toEqual(["name", "email"]);
    expect(duplicateAlert(mine, match!).copy).toBe("Same name and email. Nothing is merged until you confirm.");
  });

  it("still never matches on a shared email alone (families share inboxes)", () => {
    const sibling = lead({ id: "00000000-0000-4000-8000-000000000003", display_name: "Kim Example", email: "SAM@example.test" });
    expect(duplicateFor(mine, [mine, sibling], [])).toBeNull();
  });
});
