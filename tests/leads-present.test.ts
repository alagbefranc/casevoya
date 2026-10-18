import { describe, expect, it } from "vitest";
import { mapColumns, parseCsv, readLeadsCsv } from "@/modules/leads/csv";
import { ENQUIRY_CONSENT, readEnquiry } from "@/modules/leads/enquiry";
import {
  boardKey,
  buildPipeline,
  cardFee,
  consentValues,
  duplicateAlert,
  duplicateFor,
  feeCents,
  historyItems,
  leadError,
  listFee,
  nextSteps,
  preferredLabel,
  ringOffset,
  type LeadRow,
  type StageRow,
} from "@/modules/leads/present";

const TZ = "America/Toronto";

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

describe("lead money and rings", () => {
  it("formats fees as the Designer does and reads typed amounts", () => {
    expect(cardFee(240000)).toBe("CAD 2,400");
    expect(cardFee(240050)).toBe("CAD 2,400.50");
    expect(cardFee(null)).toBe("—");
    expect(listFee(290000)).toBe("2,900.00");
    expect(feeCents("2,400.5")).toBe(240050);
    expect(feeCents("")).toBeNull();
    expect(feeCents("12abc")).toBe("invalid");
    expect(ringOffset(4)).toBe("0");
    expect(Number(ringOffset(0))).toBeCloseTo(47.1);
  });
});

describe("duplicate suggestions (CRM-02)", () => {
  const a = lead({ id: "a", display_name: "Hamid Rahimi", email: "family@example.test", date_of_birth: "1990-06-02", created_at: "2024-05-01T00:00:00Z" });
  it("needs the name plus another detail, and never a shared email alone", () => {
    const sharedInbox = lead({ id: "b", display_name: "Leila Rahimi", email: "family@example.test" });
    expect(duplicateFor(sharedInbox, [a, sharedInbox], [])).toBeNull();
    const sameName = lead({ id: "c", display_name: "hamid  RAHIMI", email: "other@example.test" });
    expect(duplicateFor(sameName, [a, sameName], [])).toBeNull();
    const twin = lead({ id: "d", display_name: "Hamid Rahimi", email: "hamid.r@example.test", date_of_birth: "1990-06-02" });
    const match = duplicateFor(twin, [a, twin], []);
    expect(match?.other.id).toBe("a");
    expect(match && duplicateAlert(twin, match)).toEqual({
      title: "Possible duplicate: Hamid Rahimi (2024 lead)",
      copy: "Same name and date of birth; different email. Nothing is merged until you confirm.",
    });
  });
  it("drops a pair someone answered and leads already linked as one person", () => {
    const twin = lead({ id: "d", display_name: "Hamid Rahimi", date_of_birth: "1990-06-02" });
    expect(duplicateFor(twin, [a, twin], [{ lead_id: "a", other_lead_id: "d", same_person: false }])).toBeNull();
    const linked = { ...twin, same_person_lead_id: "a" };
    expect(duplicateFor(linked, [a, linked], [])).toBeNull();
  });
});

describe("next steps and the board", () => {
  const now = new Date("2026-10-16T14:00:00Z"); // Friday 10:00 in Toronto
  it("puts overdue follow-ups first, then the soonest step", () => {
    const steps = nextSteps(
      "l",
      [
        { id: "f1", lead_id: "l", title: "Call", due_on: "2026-10-13", completed_at: null, owner_membership_id: null },
        { id: "f2", lead_id: "l", title: "Send link", due_on: "2026-10-16", completed_at: null, owner_membership_id: null },
        { id: "f3", lead_id: "l", title: "Done already", due_on: "2026-10-10", completed_at: "2026-10-11T00:00:00Z", owner_membership_id: null },
      ],
      [{ lead_id: "l", starts_at: "2026-10-22T14:30:00Z", status: "confirmed", title: "Initial consultation" }],
      now,
      TZ,
    );
    expect(steps.map((step) => step.label)).toEqual(["3d", "Today", "Thu 10:30"]);
  });

  it("filters by stage and owner, counts open leads only in the pills, and keeps Archived off the board", () => {
    const stages: StageRow[] = [
      { id: "s-new", key: "new", label: "New", kind: "open", position: 1 },
      { id: "s-won", key: "converted", label: "Converted", kind: "converted", position: 7 },
      { id: "s-lost", key: "lost", label: "Lost", kind: "lost", position: 8 },
      { id: "s-arch", key: "archived", label: "Archived", kind: "archived", position: 9 },
    ];
    const leads = [
      lead({ id: "1", owner_membership_id: "m1", proposed_fee_cents: 100000 }),
      lead({ id: "2", owner_membership_id: "m2", proposed_fee_cents: 50000 }),
      lead({ id: "3", stage_id: "s-won", converted_at: "2026-10-10T00:00:00Z", proposed_fee_cents: 900000 }),
      lead({ id: "4", stage_id: "s-arch" }),
    ];
    const owners = new Map([
      ["m1", { name: "Kim Host" }],
      ["m2", { name: "Lee Case" }],
    ]);
    const all = buildPipeline({ tab: "board", stages, leads, followUps: [], bookings: [], decisions: [], owners, filter: { stage: null, owner: null }, organizationId: "o", timeZone: TZ, now });
    expect(all.pills).toEqual(["2 open leads", "Proposed fees CAD 1,500"]);
    expect(all.data.columns.map((column) => column.label)).toEqual(["New", "Converted", "Lost"]);
    expect(all.data.columns[0].cards.map((card) => card.id)).toEqual(["1", "2"]);
    expect(all.data.columns[0].data).toEqual({ "data-stage-id": "s-new", "data-kind": "open" });
    expect(all.data.columns[0].cards[0].data).toEqual({ "data-version": "1", "data-href": "/sheet/lead?id=1" });
    expect(all.data.filters[1].options.map((option) => [option.label, option.count])).toEqual([
      ["Anyone", undefined],
      ["Kim Host", "1"],
      ["Lee Case", "1"],
      ["Unassigned", "1"],
    ]);

    const mine = buildPipeline({ tab: "list", stages, leads, followUps: [], bookings: [], decisions: [], owners, filter: { stage: "new", owner: "m1" }, organizationId: "o", timeZone: TZ, now });
    expect(mine.data.rows.map((row) => row.href)).toEqual(["/sheet/lead?id=1"]);
    expect(mine.data.filters[0].value).toBe("New");
    expect(mine.data.filters[1].value).toBe("Kim Host");
    expect(mine.data.filters[0].options[0].data).toEqual({ "data-href": "/sheet/pipeline?tab=list&owner=m1" });
    expect(boardKey(leads)).not.toBe(boardKey([{ ...leads[0], version: 2 }, ...leads.slice(1)]));
  });
});

describe("the lead page's words", () => {
  it("keeps reply consent and marketing apart, latest answer first", () => {
    const values = consentValues(
      [
        { purpose: "enquiry_reply", granted: true, captured_via: "hosted_page", recorded_at: "2026-10-15T14:00:00Z" },
        { purpose: "marketing", granted: true, captured_via: "hosted_page", recorded_at: "2026-10-15T14:00:00Z" },
        { purpose: "marketing", granted: false, captured_via: "staff", recorded_at: "2026-10-16T14:00:00Z" },
      ],
      TZ,
    );
    expect(values.reply).toEqual({ left: "Service messages", right: "15 Oct, hosted page" });
    expect(values.marketing).toEqual({ left: "Opted out", right: "16 Oct" });
    expect(consentValues([], TZ)).toEqual({ reply: "Not recorded", marketing: "Not given" });
    expect(preferredLabel("phone", "a@b.c", "1")).toBe("Phone, then email");
  });

  it("reads the history newest first and never passes a database message through", () => {
    const items = historyItems(
      [
        { kind: "created", from_stage_id: null, to_stage_id: "s1", reason: null, payload: { source: "hosted_page" }, actor_user_id: null, created_at: "2026-10-15T14:00:00Z" },
        { kind: "lost", from_stage_id: "s1", to_stage_id: "s9", reason: "Chose another firm", payload: {}, actor_user_id: "u1", created_at: "2026-10-16T14:00:00Z" },
      ],
      new Map([["s1", "New"]]),
      new Map([["u1", "Kim Host"]]),
      TZ,
    );
    expect(items[0]).toEqual({ what: "Closed as lost: Chose another firm", who: "Kim Host", when: "16 Oct 2026, 10:00" });
    expect(items[1].what).toBe("Created from hosted page in New");
    expect(items[1].who).toBe("The enquiry form");
    expect(leadError("lead changed by someone else")).toBe("This lead changed since you opened it. Reload and try again.");
    expect(leadError("use convert to matter to convert a lead")).toBe("Use convert to matter to convert a lead.");
    expect(leadError('duplicate key value violates unique constraint "x"')).toBe("That couldn’t be saved. Try again.");
  });
});

describe("CSV import", () => {
  it("parses quoted fields and maps columns by their headers", () => {
    expect(parseCsv('Name,Notes\r\n"Tehrani, Mina","said ""Jan"""\n')).toEqual([
      ["Name", "Notes"],
      ["Tehrani, Mina", 'said "Jan"'],
    ]);
    expect(mapColumns(["Full name", "E-mail", "Mobile", "Interest", "Heard via", "Comments"])).toEqual({
      name: 0,
      email: 1,
      phone: 2,
      service_interest: 3,
      source: 4,
      note: 5,
    });
    const read = readLeadsCsv("Name,Contact,Interest\nMina Tehrani,mina.t@example.test,Study permit\nAli Reza,+1 416 555 0100,\n");
    expect("error" in read ? read.error : read.rows).toEqual([
      { name: "Mina Tehrani", email: "mina.t@example.test", service_interest: "Study permit" },
      { name: "Ali Reza", phone: "+1 416 555 0100" },
    ]);
    expect(readLeadsCsv("Email\nx@example.test")).toEqual({ error: "Add a Name column to the file." });
  });
});

describe("public enquiry", () => {
  it("requires the reply consent, keeps marketing optional and separate, and drops a filled honeypot", () => {
    const base = { name: " Wei  Zhang ", contact: "wei@example.test", reply: true, key: "k-12345678", service: "Study" };
    expect(readEnquiry(base)).toEqual({
      input: { name: "Wei Zhang", contact: "wei@example.test", preferred: null, service: "Study", country: null, language: null, reply: true, marketing: false, source: "hosted_page", key: "k-12345678" },
    });
    expect(readEnquiry({ ...base, reply: false })).toEqual({ error: "consent_required" });
    expect(readEnquiry({ ...base, website: "spam" })).toEqual({ error: "invalid" });
    expect(readEnquiry({ ...base, contact: "x@" })).toEqual({ error: "email_invalid" });
    expect(readEnquiry({ ...base, contact: "call me" })).toEqual({ error: "phone_invalid" });
    expect("input" in readEnquiry({ ...base, marketing: true }) && readEnquiry({ ...base, marketing: true })).toMatchObject({ input: { marketing: true } });
    expect(ENQUIRY_CONSENT.reply).not.toMatch(/news/i);
    expect(ENQUIRY_CONSENT.marketing).toMatch(/separate/i);
  });
});
