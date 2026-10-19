import { describe, expect, it } from "vitest";
import {
  birthDateLabel,
  clientsTab,
  findDuplicate,
  householdCell,
  mattersLabel,
  matterStateBadge,
  openTasksLabel,
  partyRoleLabel,
  leadRow,
  personFacts,
  personHref,
  personParam,
  personSummary,
  portalState,
  possessive,
  relationshipLabel,
  roleFlags,
  rolesLabel,
  type DuplicatePerson,
} from "@/modules/sheet/clients-present";

const NOW = new Date("2026-10-18T12:00:00Z");
const ID = "3f2b8c1e-8d4a-4c55-9a51-0d3c9e7a1b22";

describe("Clients page words", () => {
  it("picks a known tab and falls back to People", () => {
    expect(clientsTab("person")).toBe("person");
    expect(clientsTab("household")).toBe("household");
    expect(clientsTab(undefined)).toBe("dir");
    expect(clientsTab("nope")).toBe("dir");
  });

  it("accepts only a well-formed person id from the URL", () => {
    expect(personParam(ID)).toBe(ID);
    expect(personParam(ID.toUpperCase())).toBe(ID);
    expect(personParam("x,from_person_id.eq.1")).toBeNull();
    expect(personParam(undefined)).toBeNull();
    expect(personHref(ID)).toBe(`?tab=person&person=${ID}`);
  });

  it("names roles the Designer's way and filters by them", () => {
    expect(partyRoleLabel("dependant", false)).toBe("Adult dependant");
    expect(partyRoleLabel("dependant", true)).toBe("Minor dependant");
    expect(rolesLabel(["sponsor", "applicant", "applicant"], false)).toBe("Applicant, Sponsor");
    expect(rolesLabel(["case_manager"], false)).toBe("—");
    expect(rolesLabel([], false)).toBe("—");
    expect(roleFlags(["dependant", "applicant"])).toEqual(["applicant", "dependant"]);
    expect(roleFlags(["employer"])).toEqual([]);
  });

  it("lists matter references once", () => {
    expect(mattersLabel(["NL-1", "NL-2", "NL-1"])).toBe("NL-1, NL-2");
    expect(mattersLabel([])).toBe("—");
    expect(personSummary("Applicant", ["NL-1"])).toBe("Applicant on NL-1.");
    expect(personSummary("—", [])).toBe("Not on a matter you’re assigned to.");
  });

  it("states the portal from a login or an open invitation only", () => {
    const open = { expires_at: "2026-10-20T00:00:00Z", consumed_at: null, revoked_at: null, declined_at: null };
    expect(portalState(true, [], NOW)).toBe("Portal active");
    expect(portalState(false, [open], NOW)).toBe("Invited");
    expect(portalState(false, [{ ...open, expires_at: "2026-10-01T00:00:00Z" }], NOW)).toBe("Not invited");
    expect(portalState(false, [{ ...open, revoked_at: "2026-10-02T00:00:00Z" }], NOW)).toBe("Not invited");
    expect(portalState(false, [], NOW)).toBe("Not invited");
  });

  it("shows a birth date at its recorded precision and never invents one", () => {
    expect(birthDateLabel("1984-03-09", "day")).toBe("1984-03-09");
    expect(birthDateLabel("1984-03-01", "month")).toBe("1984-03");
    expect(birthDateLabel("1984-01-01", "year")).toBe("1984");
    expect(personFacts(null, null)[0]).toEqual({ fact: "Date of birth", value: { unknown: true }, source: "Not recorded", review: "—" });
    expect(personFacts("1984-03-09", "day")[0].value).toEqual({ num: "1984-03-09" });
  });

  it("shows the person's email and phone, and says plainly when none is on file", () => {
    expect(personFacts(null, null, { email: "ana@example.test", phone: "+14165550100" }).slice(1)).toEqual([
      { fact: "Email", value: { text: "ana@example.test" }, source: "Person record", review: "—" },
      { fact: "Phone", value: { num: "+14165550100" }, source: "Person record", review: "—" },
    ]);
    expect(personFacts(null, null).slice(1).map((row) => row.value)).toEqual([{ unknown: true }, { unknown: true }]);
  });

  it("lists an open lead as a Lead row the Leads chip shows, opening the lead", () => {
    expect(leadRow({ id: "l-1", display_name: "Sam Example", language: "English", is_sample: true })).toEqual({
      href: "/sheet/lead?id=l-1",
      flags: ["lead"],
      person: { name: "Sam Example" },
      role: "Lead",
      matter: "Lead (sample)",
      language: "English",
      timezone: "—",
      portal: "Not invited",
    });
  });

  it("reads matter state, open tasks and relationships plainly", () => {
    expect(matterStateBadge("closed").tone).toBe("ok");
    expect(matterStateBadge("intake").tone).toBe("blue");
    expect(openTasksLabel(0)).toBe("No open tasks");
    expect(openTasksLabel(1)).toBe("1 task open");
    expect(openTasksLabel(3)).toBe("3 tasks open");
    expect(relationshipLabel("parent", false)).toBe("Parent");
    expect(relationshipLabel("parent", true)).toBe("Child");
    expect(relationshipLabel("spouse", true)).toBe("Spouse");
    expect(possessive("Priya Sharma")).toBe("Priya’s");
  });

  it("never lets a household grant access: only the person or a live grant does", () => {
    expect(householdCell("a", "a", null)).toBe("Yes");
    expect(householdCell("a", "b", null)).toBe("—");
    expect(householdCell("a", "b", [])).toEqual({ left: "No", right: "private" });
    expect(householdCell("a", "b", [{ grantee: "a", subject: "b", kind: "explicit" }])).toEqual({ left: "Yes", right: "access granted" });
    expect(householdCell("a", "b", [{ grantee: "a", subject: "b", kind: "guardian" }])).toEqual({ left: "Yes", right: "guardian" });
    expect(householdCell("b", "a", [{ grantee: "a", subject: "b", kind: "explicit" }])).toEqual({ left: "No", right: "private" });
  });

  it("points out a possible duplicate only on the same name and full date of birth", () => {
    const base: DuplicatePerson = { id: "1", name: "Hamid Rahimi", email: "h@example.com", phone: null, dateOfBirth: "1990-06-02", precision: "day", createdAt: "2024-03-01T00:00:00Z", reference: "NL-2024-0001" };
    const later: DuplicatePerson = { ...base, id: "2", name: "hamid  rahimi", email: "hr@example.org", phone: "+14165550144", createdAt: "2026-10-01T00:00:00Z", reference: null };
    const found = findDuplicate([later, base]);
    expect(found?.title).toBe("Possible duplicate: Hamid Rahimi (NL-2024-0001) and hamid  rahimi (Added 1 Oct 2026)");
    expect(found?.detail).toBe("Same name and date of birth, different email. Review before merging.");
    expect(found?.rows.find((row) => row.label === "Phone")?.values).toEqual(["—", "+14165550144"]);
    // Merging is not wired: the button says so instead of claiming a merge.
    expect(found?.merge.kind).toBe("warn");
    expect(findDuplicate([base, { ...later, dateOfBirth: "1990-06-03" }])).toBeNull();
    expect(findDuplicate([base, { ...later, name: "Someone Else", email: base.email }])).toBeNull();
    expect(findDuplicate([{ ...base, precision: "year" }, { ...later, precision: "year" }])).toBeNull();
  });
});
