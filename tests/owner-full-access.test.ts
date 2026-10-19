import { describe, expect, it } from "vitest";
import { isLicensedMembership, STAFF_ROLES, type LicenceFacts } from "@/lib/tenant/roles";
import { buildDecisions, buildSubmissions, type GovernmentContext, type GovernmentRecords } from "@/modules/sheet/government-present";

// UI gates for "firm_owner has every staff ability, including regulated actions (owners are
// regulated consultants)" (decision 2026-10-19). The database decides; these only choose which
// controls show.

const SUSPENDED: LicenceFacts = {
  status: "suspended",
  discipline_revoked: false,
  discipline_suspended: true,
  register_status: "active",
  entitlement_to_practise: true,
};

describe("isLicensedMembership", () => {
  it("offers regulated controls to every firm owner, with or without a credential, like a licensed consultant", () => {
    expect(isLicensedMembership("firm_owner", null)).toBe(true);
    expect(isLicensedMembership("firm_owner")).toBe(true);
    expect(isLicensedMembership("licensed_consultant", null)).toBe(true);
    // A blocked credential is refused by the database's licence locks for both roles alike.
    expect(isLicensedMembership("firm_owner", SUSPENDED)).toBe(isLicensedMembership("licensed_consultant", SUSPENDED));
  });

  it("keeps other roles out of regulated controls", () => {
    for (const role of STAFF_ROLES.filter((r) => r !== "firm_owner" && r !== "licensed_consultant")) {
      expect(isLicensedMembership(role, null)).toBe(false);
    }
    for (const role of ["client", "adult_dependant", "sponsor", "guardian"]) expect(isLicensedMembership(role, null)).toBe(false);
  });
});

describe("government controls for the firm owner", () => {
  const letter = {
    id: "l1",
    kind: "decision" as const,
    channel: "portal_message" as const,
    received_on: "2026-10-12",
    document_date: "2026-10-08",
    action_requested: null,
    stated_deadline: null,
    evidence_version_id: null,
    evidence_locator: "Synthetic letter, page 1",
    verified_by_membership_id: "m2",
    verified_at: "2026-10-16T15:00:00Z",
    shared_with_client_at: null,
    created_by: "u1",
    created_at: "2026-10-12T16:00:00Z",
    version: 1,
  };
  const records: GovernmentRecords = {
    handoffs: [
      {
        id: "h1",
        package_label: "Package v3",
        package_sha256: "a".repeat(64),
        channel: "online_portal",
        status: "awaiting_signoff",
        signoff_membership_id: null,
        signed_off_at: null,
        submitted_by_membership_id: null,
        external_reference: null,
        submitted_at: null,
        receipt_version_id: null,
        receipt_locator: null,
        acknowledged_on: null,
        verified_by_membership_id: null,
        verified_at: null,
        cancel_reason: null,
        cancelled_at: null,
        created_by: "u1",
        created_at: "2026-10-15T15:00:00Z",
        version: 1,
      },
    ],
    letters: [letter],
    decisions: [
      {
        id: "d1",
        correspondence_id: "l1",
        outcome: "refused",
        milestone: null,
        decided_on: null,
        authority_reasons: "Synthetic quoted reasons",
        state: "awaiting_confirmation",
        consultant_interpretation: null,
        next_steps: null,
        confirmed_by_membership_id: null,
        confirmed_at: null,
        created_by: "u1",
        created_at: "2026-10-16T15:00:00Z",
        version: 1,
      },
    ],
    followUps: [],
    steps: [],
    checks: [],
    transitions: [],
    deadlines: [],
    representation: true,
    documents: { total: 4, open: 1 },
    expiring: [],
  };
  function ctx(role: string): GovernmentContext {
    return {
      organizationId: "org",
      matterId: "matter",
      stage: "ready_to_submit",
      timezone: "America/Toronto",
      today: "2026-10-18",
      now: new Date("2026-10-18T14:00:00Z"),
      memberName: () => "Synthetic Member",
      userName: () => "Synthetic Member",
      consultant: "Synthetic Consultant",
      me: "Synthetic Owner",
      role,
      licensed: isLicensedMembership(role, null),
      representatives: [],
    };
  }

  it("shows decision Confirm and package sign-off to an owner with no credential, not to a case manager", () => {
    expect(buildDecisions(records, ctx("firm_owner")).decision?.confirm?.wire).toMatchObject({ "data-gov": "confirm", "data-id": "d1" });
    expect(buildDecisions(records, ctx("case_manager")).decision?.confirm).toBeNull();
    const owner = JSON.stringify(buildSubmissions(records, ctx("firm_owner")).tab);
    const manager = JSON.stringify(buildSubmissions(records, ctx("case_manager")).tab);
    expect(owner).toContain('"data-gov":"signoff"');
    expect(manager).not.toContain('"data-gov":"signoff"');
  });
});
