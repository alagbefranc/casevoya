import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetSettingsTeam } from "@/components/sheet/designer/settings";
import { ContinuityDialog, MemberDialog, OffboardDialog } from "@/components/sheet/designer/settings-staff-admin";
import { SettingsMarkup } from "@/components/sheet/markup/settings";
import { teamData } from "@/modules/sheet/settings-present";
import {
  continuityDialog,
  handoverHtml,
  memberDialog,
  offboardDialog,
  offboardDone,
  offboardItems,
  parseOffboardFacts,
  parseOffboardResult,
  readHandover,
  staffAdminError,
  type OffboardFacts,
} from "@/modules/sheet/settings-staff-admin-present";
import type { DirectoryMember } from "@/modules/sheet/staff-present";

// Settings > Team and seats staff admin: the Designer's Offboard dialog filled from the database's
// preview, and the live Change role or access and Continuity contact dialogs.

const ORG = "00000000-0000-4000-8000-000000000001";
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const CONSULTANT = "00000000-0000-4000-8000-0000000000b2";
const MANAGER = "00000000-0000-4000-8000-0000000000c3";
const FINANCE = "00000000-0000-4000-8000-0000000000d4";

const MEMBERS: DirectoryMember[] = [
  { membershipId: OWNER, name: "Dana Lee", email: "dana@maple.test", role: "firm_owner", status: "active", licensed: true, twoStep: true },
  { membershipId: CONSULTANT, name: "Sam Rivers", email: "sam@maple.test", role: "licensed_consultant", status: "active", licensed: true, twoStep: true },
  { membershipId: MANAGER, name: "Kai Moss", email: "kai@maple.test", role: "case_manager", status: "suspended", licensed: false, twoStep: false },
  { membershipId: FINANCE, name: "Lou Park", email: "lou@maple.test", role: "finance_user", status: "active", licensed: false, twoStep: true },
];

const RAW = {
  tasks: [
    { title: "Review employment letter", matter: "MAP-2026-0004" },
    { title: "Call notes", matter: "MAP-2026-0007" },
    { title: "Prepare forms", matter: null },
    { title: "Fourth", matter: "MAP-2026-0009" },
  ],
  deadlines: [
    {
      label: "Biometrics",
      matter: "MAP-2026-0004",
      due_on: "2026-11-04",
      confirmed: true,
      source_url: "https://www.canada.ca/en/immigration-refugees-citizenship.html",
      source_retrieved_on: "2026-10-12",
      rule: false,
    },
  ],
  authority: [
    { matter: "MAP-2026-0004", authorities: 1 },
    { matter: "MAP-2026-0007", authorities: 0 },
  ],
  assignments: 2,
  sessions: 2,
  connections: 1,
};

describe("offboarding preview", () => {
  it("parses the database preview and refuses anything else", () => {
    const facts = parseOffboardFacts(RAW)!;
    expect(facts.tasks).toHaveLength(4);
    expect(facts.deadlines[0]).toMatchObject({ dueOn: "2026-11-04", confirmed: true, sourceRetrievedOn: "2026-10-12" });
    expect(facts.sessions).toBe(2);
    expect(parseOffboardFacts(null)).toBeNull();
    expect(parseOffboardFacts([])).toBeNull();
    expect(parseOffboardFacts({ sessions: null })?.sessions).toBeNull();
  });

  it("says what moves in the Designer's four steps, with matter labels and the receiver", () => {
    const items = offboardItems(parseOffboardFacts(RAW)!, "Sam Rivers", "Dana Lee");
    expect(items.map((item) => item.title)).toEqual([
      "4 open tasks",
      "1 verified deadline",
      "2 matters where Sam is the consultant of record",
      "Access closes last",
    ]);
    expect(items[0].detail).toEqual([
      "Review employment letter (MAP-2026-0004), Call notes (MAP-2026-0007), Prepare forms and 1 more → Dana Lee",
      "2 matter assignments move too",
    ]);
    expect(items[1].detail).toEqual(["Biometrics, MAP-2026-0004", "4 Nov", "source: canada.ca, 12 Oct", "owner changes, the date and its source do not"]);
    expect(items[2]).toMatchObject({ done: false, aria: "Needs a decision" });
    expect(items[2].detail).toContain("MAP-2026-0004 and MAP-2026-0007.");
    expect(items[2].detail).toContain("needs a verified licence");
    expect(items[3].detail).toBe("2 sessions, 1 connection and their access to this firm end when the steps above are done.");
  });

  it("is honest when there is nothing to move", () => {
    const empty: OffboardFacts = { tasks: [], deadlines: [], authority: [], assignments: 0, sessions: null, connections: 0, leads: [], bookingTypes: [], bookings: [] };
    const items = offboardItems(empty, "Kai Moss", "Dana Lee");
    expect(items.map((item) => item.title)).toEqual(["No open tasks", "No deadlines", "No matters where Kai is the consultant of record", "Access closes last"]);
    expect(items.every((item) => item.done)).toBe(true);
    expect(items[3].detail).toBe("Their sign-in sessions, 0 connections and their access to this firm end when the steps above are done.");
  });
});

describe("Offboard dialog (live)", () => {
  it("lists everyone but you, takes work only to active non-finance staff, and carries the hold, not the prototype toast", () => {
    const data = offboardDialog({ organizationId: ORG, members: MEMBERS, selfMembershipId: OWNER, facts: parseOffboardFacts(RAW) })!;
    expect(data.title).toBe("Offboard Sam Rivers");
    expect(data.people.map((person) => person.value)).toEqual([CONSULTANT, MANAGER, FINANCE]);
    expect(data.people[1].label).toEqual(["Kai Moss", "Case manager (suspended)"]);
    expect(data.receivers.map((receiver) => receiver.value)).toEqual([OWNER, CONSULTANT]);
    const html = renderToStaticMarkup(createElement(OffboardDialog, { data }));
    expect(html).toContain(`data-offboard="1" data-org="${ORG}"`);
    expect(html).not.toContain("data-toast");
    expect(html).not.toMatch(/Grace|Amara|Okafor|IMM 5476|Clients are told/);
    expect(html).toContain("<option value=\"" + CONSULTANT + "\">Sam Rivers <span class=\"sep\" aria-hidden=\"true\"></span> Licensed consultant</option>");

    // Live-only attributes stripped, the classes are exactly the Designer's dialog's.
    const captured = renderToStaticMarkup(createElement(SettingsMarkup, { variant: "tab-team" })).match(/<dialog class="dlg wide" id="dlgOff"[\s\S]*?<\/dialog>/)![0];
    const classes = (markup: string) => [...new Set([...markup.matchAll(/class="([^"]*)"/g)].map((match) => match[1]))].sort();
    // The ORG-06 handover block (div.ofh) is a live-only addition after the Designer's list.
    expect(classes(html.replace(/<div class="ofh"[^>]*>[\s\S]*?<\/div>(?=<p class="fp-note")/, ""))).toEqual(classes(captured));
  });

  it("is not offered when you're the only one on the team", () => {
    expect(offboardDialog({ organizationId: ORG, members: [MEMBERS[0]], selfMembershipId: OWNER, facts: null })).toBeNull();
    expect(memberDialog({ organizationId: ORG, members: [MEMBERS[0]], selfMembershipId: OWNER })).toBeNull();
  });

  it("reports the result in counts", () => {
    const result = parseOffboardResult({ tasks: 3, deadlines: 1, assignments: 2, authority: 2, review_tasks: 2, connections: 1, sessions: 2 });
    const done = offboardDone(result, "Sam Rivers", "Dana Lee");
    expect(done.title).toBe("Sam Rivers is offboarded");
    expect(done.sub).toBe(
      "3 tasks and 1 deadline moved to Dana. 2 matter assignments moved. 2 matters now have Dana as consultant of record, each with a review task. Access closed: 2 sessions ended.",
    );
  });
});

describe("offboarding hands over leads and booking hosting (ORG-06)", () => {
  const RECEIVERS = [
    { label: "Dana Lee", value: OWNER },
    { label: "Sam Rivers", value: "33333333-3333-4333-8333-333333333333" },
  ];
  const facts = parseOffboardFacts({
    ...RAW,
    leads: [{ id: "l1", label: "Synthetic Lead <A>", stage: "New" }],
    booking_types: [{ id: "t1", title: "Initial consultation", published: true, other_hosts: 0 }],
    bookings: [{ id: "b1", title: "Initial consultation", starts_at: "2026-10-29T14:00:00Z", time_zone: "America/Toronto" }],
  })!;

  it("parses what needs a new owner or host", () => {
    expect(facts.leads).toEqual([{ id: "l1", label: "Synthetic Lead <A>", stage: "New" }]);
    expect(facts.bookingTypes).toEqual([{ id: "t1", title: "Initial consultation", published: true, otherHosts: 0 }]);
    expect(facts.bookings[0]).toMatchObject({ id: "b1", startsAt: "2026-10-29T14:00:00Z" });
    expect(parseOffboardFacts(RAW)).toMatchObject({ leads: [], bookingTypes: [], bookings: [] });
  });

  it("draws one choice per item with no default, never offering the leaver, escaped", () => {
    const html = handoverHtml(facts, RECEIVERS, OWNER);
    expect(html).toContain("Open leads: new owner");
    expect(html).toContain("Booking types they host: new host");
    expect(html).toContain("Upcoming consultations: new host");
    expect(html).toContain("Synthetic Lead &lt;A&gt;");
    expect(html).toContain("Published · no other host");
    expect(html).toContain("Thu 29 Oct, 10:00 · same time, same link");
    expect(html.match(/<select /g)).toHaveLength(3);
    expect(html.match(/<option value="" selected>Choose a person<\/option>/g)).toHaveLength(3);
    expect(html).not.toContain(`value="${OWNER}"`);
    expect(handoverHtml(parseOffboardFacts(RAW)!, RECEIVERS, OWNER)).toBe("");
  });

  it("needs every choice before it sends anything", () => {
    expect(readHandover([{ kind: "leads", id: "l1", value: "", label: "New owner for Lead" }])).toEqual({ missing: "New owner for Lead" });
    expect(
      readHandover([
        { kind: "leads", id: "l1", value: "m1", label: "" },
        { kind: "booking_types", id: "t1", value: "m2", label: "" },
        { kind: "bookings", id: "b1", value: "m2", label: "" },
      ]),
    ).toEqual({ ok: { leads: { l1: "m1" }, booking_types: { t1: "m2" }, bookings: { b1: "m2" } } });
  });

  it("says what went to the people chosen", () => {
    const result = parseOffboardResult({ tasks: 0, deadlines: 0, sessions: 1, leads: 2, booking_types: 1, bookings: 1 });
    expect(offboardDone(result, "Sam Rivers", "Dana Lee").sub).toContain("2 leads, 1 booking type and 1 upcoming consultation went to the people you chose.");
  });

  it("puts the choices in the dialog only when there is something to hand over", () => {
    const dialog = offboardDialog({ organizationId: ORG, members: MEMBERS, selfMembershipId: OWNER, facts });
    expect(dialog?.handover).toContain("data-handover=\"leads\"");
    expect(offboardDialog({ organizationId: ORG, members: MEMBERS, selfMembershipId: OWNER, facts: parseOffboardFacts(RAW) })?.handover).toBe("");
  });
});

describe("Team tab controls", () => {
  const base = {
    members: MEMBERS,
    security: [],
    invites: [],
    continuity: { name: "Pat Backup", email: "pat@maple.test", succession: null },
    now: new Date("2026-10-18T15:00:00Z"),
    timeZone: "America/Toronto",
  };

  it("gives a firm owner the Designer's Offboard button, Change role or access, and the continuity dialog", () => {
    const html = renderToStaticMarkup(createElement(SheetSettingsTeam, { data: teamData({ ...base, canInvite: true, canManage: true }) }));
    expect(html).toContain('<button class="btn sm" data-dlg="dlgOff" data-fpd="1">Offboard someone</button><button class="btn sm" data-dlg="dlgMem">Change role or access</button>');
    expect(html).toContain('<button class="btn sm" data-dlg="dlgCont" data-fpb="1">Change continuity contact</button>');
    expect(html).not.toContain("Preview the client notice");
    expect(html).not.toContain("data-toast");
  });

  it("gives everyone else none of them", () => {
    const html = renderToStaticMarkup(createElement(SheetSettingsTeam, { data: teamData({ ...base, canInvite: false }) }));
    expect(html).not.toMatch(/dlgOff|dlgMem|dlgCont|Change continuity contact/);
    expect(html).toContain("Only a firm owner can change the continuity contact.");
  });

  it("builds Change role or access and Continuity contact from the Designer's dialog parts", () => {
    const member = memberDialog({ organizationId: ORG, members: MEMBERS, selfMembershipId: OWNER })!;
    expect(member.people.map((person) => person.value)).toEqual([CONSULTANT, MANAGER, FINANCE]);
    const memberHtml = renderToStaticMarkup(createElement(MemberDialog, { data: member }));
    expect(memberHtml).toContain('data-role="case_manager" data-suspended="1"');
    expect(memberHtml).toContain('data-member-act="status"');
    const continuityHtml = renderToStaticMarkup(createElement(ContinuityDialog, { data: continuityDialog(ORG, base.continuity) }));
    expect(continuityHtml).toContain('value="Pat Backup"');
    const allowed = new Set(["dlg", "dh", "x", "ic s", "db", "fld", "sel", "inp", "ta", "hint", "why", "df", "btn", "btn p"]);
    for (const html of [memberHtml, continuityHtml]) {
      for (const [, cls] of html.matchAll(/class="([^"]*)"/g)) expect(allowed.has(cls)).toBe(true);
    }
  });
});

describe("refusals in plain words", () => {
  it("maps each database refusal", () => {
    expect(staffAdminError("firm owner step-up is required")).toMatchObject({ stepUp: true });
    expect(staffAdminError("cannot remove or demote the last firm owner")?.error).toMatch(/at least one active owner/);
    expect(staffAdminError("you cannot change your own access; ask another firm owner")?.error).toMatch(/your own access/);
    expect(staffAdminError("the receiving consultant needs a verified licence")?.error).toMatch(/verified licence/);
    expect(staffAdminError("move their matters to another licensed consultant first")?.error).toMatch(/consultant of record/);
    expect(staffAdminError("something else")).toBeNull();
  });
});
