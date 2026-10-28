import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetConsultationRecord, SheetConsultations, type ConsultationRecordData, type PossibleMatchData } from "@/components/sheet/designer/consultations";
import { POSSIBLE_MATCH_CHIP, possibleMatchError, possibleMatchPanel, upcomingRows, type StaffBooking } from "@/modules/scheduling/sheet-present";

// #263-C: the Consultations list badge and the record's Possible match panel (Link, Not this person).

const ZONE = "America/Toronto";
const NOW = Date.parse("2026-10-28T12:00:00Z");
const wire = { organizationId: "11111111-1111-4111-8111-111111111111", bookingId: "22222222-2222-4222-8222-222222222222", version: 3 };
const ANA = { id: "33333333-3333-4333-8333-333333333333", name: "Ana Ferreira", portal: true };
const BEN = { id: "44444444-4444-4444-8444-444444444444", name: "Ben Ferreira", portal: false };

const booking = (extra: Partial<StaffBooking> = {}): StaffBooking => ({
  id: wire.bookingId,
  title: "Initial consultation",
  startsAt: "2026-10-30T14:00:00Z",
  endsAt: "2026-10-30T14:30:00Z",
  status: "confirmed",
  hostName: "Synthetic Host",
  locationKind: "video",
  version: 3,
  attendee: "Somebody Typing",
  ...extra,
});

function record(possibleMatch: PossibleMatchData | null): ConsultationRecordData {
  return {
    picker: [],
    empty: { title: "", copy: "" },
    record: {
      attendee: "Somebody Typing",
      notes: { items: [], copy: "No notes yet.", lead: null },
      outcome: { chip: { tone: "blue", label: "Upcoming" }, copy: "Not yet.", actions: [] },
      details: [{ term: "Booked", value: "On the booking page" }],
      history: [],
      possibleMatch,
    },
  };
}

describe("possible match: presentation (#263-C)", () => {
  it("the Upcoming row carries the badge only when the booking has an open possible match", () => {
    const [flagged, plain] = upcomingRows([booking({ possibleMatch: true }), booking({ id: "x", possibleMatch: false })], ZONE, NOW);
    expect(flagged.match).toEqual(POSSIBLE_MATCH_CHIP);
    expect(plain.match).toBeUndefined();
    const html = renderToStaticMarkup(createElement(SheetConsultations, { data: { tab: "upcoming", upcoming: { rows: [flagged, plain] } } }));
    expect(html.match(/Possible match/g)).toHaveLength(1);
    expect(html).toContain('<span class="bd chg"><i></i>Possible match</span>');
  });

  it("no panel once linked or with nobody to show", () => {
    expect(possibleMatchPanel({ linked: true, people: [ANA], wire })).toBeNull();
    expect(possibleMatchPanel({ linked: false, people: [], wire })).toBeNull();
  });

  it("one match: named in the title, with Link and Not this person wired to the booking, person and version", () => {
    const panel = possibleMatchPanel({ linked: false, people: [ANA], wire })!;
    expect(panel.title).toBe("Possible match: Ana Ferreira");
    expect(panel.items[0].detail).toBe("Same email · has a portal login");
    expect(panel.items[0].link).toEqual({ "data-org": wire.organizationId, "data-booking": wire.bookingId, "data-version": "3", "data-match-link": ANA.id, "data-name": "Ana Ferreira" });
    expect(panel.items[0].dismiss).toMatchObject({ "data-match-dismiss": ANA.id, "data-version": "3" });
    const html = renderToStaticMarkup(createElement(SheetConsultationRecord, { data: record(panel) }));
    expect(html).toContain("Possible match: Ana Ferreira");
    expect(html).toContain("isn’t linked");
    expect(html).toContain(`data-match-link="${ANA.id}"`);
    expect(html).toContain(">Link</button>");
    expect(html).toContain(">Not this person</button>");
  });

  it("several matches are all listed", () => {
    const panel = possibleMatchPanel({ linked: false, people: [ANA, BEN], wire })!;
    expect(panel.title).toBe("Possible matches: 2 people");
    expect(panel.items.map((item) => [item.name, item.detail])).toEqual([
      ["Ana Ferreira", "Same email · has a portal login"],
      ["Ben Ferreira", "Same email · no portal login"],
    ]);
    const html = renderToStaticMarkup(createElement(SheetConsultationRecord, { data: record(panel) }));
    expect(html.match(/data-match-link=/g)).toHaveLength(2);
    expect(html.match(/data-match-dismiss=/g)).toHaveLength(2);
  });

  it("a record without a possible match renders no panel", () => {
    const html = renderToStaticMarkup(createElement(SheetConsultationRecord, { data: record(null) }));
    expect(html).not.toContain("Possible match");
    expect(html).not.toContain("data-match-link");
  });

  it("database refusals become plain words", () => {
    expect(possibleMatchError("this booking was changed by someone else; reload")).toMatch(/Reload and try again/);
    expect(possibleMatchError("this booking is already linked to a client")).toMatch(/already linked/);
    expect(possibleMatchError("this possible match was already decided")).toMatch(/no longer open/);
    expect(possibleMatchError("no possible match for this person")).toMatch(/no longer open/);
    expect(possibleMatchError("this person's email no longer matches the booking")).toMatch(/email has changed/);
    expect(possibleMatchError("staff access denied")).toBe("You can’t change bookings in this firm.");
    expect(possibleMatchError("boom")).toBe("That couldn’t be saved. Try again.");
  });
});
