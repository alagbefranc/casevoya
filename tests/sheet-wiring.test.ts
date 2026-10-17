import { describe, expect, it } from "vitest";
import {
  invitationLabel,
  isoDateInTimeZone,
  matterMatches,
  mattersTitle,
  plusDays,
  practiceCounts,
  sheetVariant,
  slotFor,
  stageLabel,
} from "@/modules/sheet/present";

describe("sheet wiring", () => {
  it("keeps Northline off live slots and names the missing backends", () => {
    expect(slotFor("finance")).toMatch(/Stripe/);
    expect(slotFor("inbox")).toMatch(/mailer/);
    expect(slotFor("drafts")).toMatch(/Vo/);
    expect(slotFor("ai")).toMatch(/not connected/);
    expect(slotFor("matter", "billing")).toMatch(/Stripe/);
    expect(slotFor("matter", "messages")).toMatch(/mailer/);
    expect(slotFor("settings", "billing")).toMatch(/Stripe/);
    expect(slotFor("settings", "general")).toBeNull();
    expect(slotFor("calendar", "deadlines")).toBeNull();
    expect(slotFor("calendar")).toBeNull();
    expect(slotFor("calendar", "week")).toMatch(/Appointments/);
    expect(slotFor("settings", "branding")).toMatch(/not stored/);
    expect(slotFor("settings", "offboarding")).toMatch(/Offboarding/);
    expect(slotFor("settings", "team")).toBeNull();
    expect(slotFor("matters")).toBeNull();
    expect(slotFor("tasks")).toBeNull();
    expect(slotFor("documents")).toBeNull();
    expect(slotFor("agreements")).toBeNull();
    expect(slotFor("invitations")).toBeNull();
  });

  it("maps matter tabs and saved views without mixing sample rows into a filter", () => {
    expect(sheetVariant("matter", { tab: "documents" })).toBe("tab-documents");
    expect(sheetVariant("matter", {})).toBe("tab-overview");
    expect(sheetVariant("index", {})).toBe("default");
    expect(sheetVariant("matter", { tab: "decisions", outcome: "refused", dlg: "letter" })).toBe(
      "tab-decisions--outcome-refused--dlg-letter",
    );
    expect(mattersTitle("due")).toBe("Due this week");
    expect(stageLabel("evidence_collection")).toBe("Evidence collection");

    const priya = {
      onHold: false,
      stage: "evidence_collection",
      nextDue: "2026-10-20",
      pendingReview: true,
      title: "Priya Sharma",
      reference: "NL-2026-0142",
    };
    expect(matterMatches(priya, "due", undefined, "2026-10-17")).toBe(true);
    expect(matterMatches(priya, "blocked", undefined, "2026-10-17")).toBe(false);
    expect(matterMatches(priya, "review", "kofi", "2026-10-17")).toBe(false);
    expect(matterMatches({ ...priya, onHold: true }, "blocked", undefined, "2026-10-17")).toBe(true);
    expect(plusDays("2026-10-17", 7)).toBe("2026-10-24");
  });

  it("counts live work and invitation state from records, not the demo firm", () => {
    expect(
      practiceCounts({
        tasks: [
          { status: "open", dueOn: "2026-10-17" },
          { status: "done", dueOn: "2026-10-17" },
          { status: "blocked", dueOn: "2026-10-18" },
        ],
        documentsPending: 2,
        mattersOnHold: 1,
        today: "2026-10-17",
      }),
    ).toEqual({ dueToday: 1, awaitingReview: 2, blocked: 1 });

    const now = "2026-10-17T12:00:00.000Z";
    expect(invitationLabel({ revokedAt: null, consumedAt: null, expiresAt: "2026-10-20T00:00:00.000Z" }, now)).toBe("Open");
    expect(invitationLabel({ revokedAt: "2026-10-01T00:00:00.000Z", consumedAt: null, expiresAt: "2026-10-20T00:00:00.000Z" }, now)).toBe("Revoked");
    expect(invitationLabel({ revokedAt: null, consumedAt: null, expiresAt: "2026-10-01T00:00:00.000Z" }, now)).toBe("Expired");
    expect(isoDateInTimeZone(new Date("2026-10-17T03:00:00.000Z"), "America/Toronto")).toBe("2026-10-16");
  });
});
