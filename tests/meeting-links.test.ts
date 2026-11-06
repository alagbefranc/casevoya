import { describe, expect, it } from "vitest";
import { cancelPlan, joinUrlFromProvider, meetingCreate, meetingResource, parseBegin, providerJoinUrl, reschedulePlan, fulfillProviderMeeting, type BeginMeeting, type MeetingDeps } from "@/modules/integrations/meeting-links";
import { calendlyNextToken, mergeCalendlyPages, parseCalendlyEvent, parseCalendlyPage, parseCalendlyUser, planCalendlyImport } from "@/modules/integrations/calendly-import";

describe("meeting link parsing", () => {
  it("accepts the provider's host and refuses lookalikes", () => {
    expect(providerJoinUrl("google_meet", "https://meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(providerJoinUrl("google_meet", "https://meet.google.com.evil.com/abc")).toBeNull();
    expect(providerJoinUrl("google_meet", "https://user:pass@meet.google.com/abc")).toBeNull();
    expect(providerJoinUrl("microsoft_teams", "https://teams.microsoft.com/l/meetup-join/19%3ameeting")).toBe("https://teams.microsoft.com/l/meetup-join/19%3ameeting");
    expect(providerJoinUrl("microsoft_teams", "https://teams.microsoft.com.evil.com/l/meetup-join/x")).toBeNull();
    expect(providerJoinUrl("google_meet", "https://teams.microsoft.com/l/meetup-join/x")).toBeNull();
  });

  it("reads a join link out of the provider payload and ignores a second, unrelated url", () => {
    expect(joinUrlFromProvider("google_meet", { meetingUri: "https://meet.google.com/abc-defg-hij", extra: "https://evil.example/x" })).toBe("https://meet.google.com/abc-defg-hij");
    expect(joinUrlFromProvider("microsoft_teams", { onlineMeeting: { joinWebUrl: "https://teams.microsoft.com/l/meetup-join/abc" } })).toBe("https://teams.microsoft.com/l/meetup-join/abc");
    expect(joinUrlFromProvider("google_meet", { meetingUri: "https://evil.example/meet" })).toBeNull();
  });

  it("asks Teams for a timed meeting and Meet for a link, with no attendees", () => {
    const teams = meetingCreate({ bookingId: "booking-1", provider: "microsoft_teams", title: "Intake", startsAt: "2026-11-20T15:00:00.000Z", endsAt: "2026-11-20T15:30:00.000Z", hostMembershipId: "host-1" });
    expect(teams).toEqual({
      hostMembershipId: "host-1",
      provider: "microsoft_teams",
      slug: "MICROSOFT_TEAMS_CREATE_OR_GET_ONLINE_MEETING",
      args: { externalId: "casevoya:booking-1", subject: "Intake", startDateTime: "2026-11-20T15:00:00.000Z", endDateTime: "2026-11-20T15:30:00.000Z" },
    });
    expect(JSON.stringify(teams)).not.toContain("participants");
    const meet = meetingCreate({ bookingId: "booking-1", provider: "google_meet", title: "Intake", startsAt: "2026-11-20T15:00:00.000Z", endsAt: "2026-11-20T15:30:00.000Z", hostMembershipId: "host-1" });
    expect(meet).toMatchObject({ slug: "GOOGLEMEET_CREATE_MEET", args: {} });
  });
});

describe("fulfillProviderMeeting", () => {
  function harness(create: MeetingDeps["create"]) {
    const calls: string[] = [];
    let phase: BeginMeeting = {
      action: "create",
      booking_id: "booking-1",
      organization_id: "org",
      host_membership_id: "host-1",
      provider: "google_meet",
      title: "Intake",
      starts_at: "2026-11-20T15:00:00.000Z",
      ends_at: "2026-11-20T15:30:00.000Z",
    };
    let url: string | null = null;
    let status = "held";
    const deps: MeetingDeps = {
      async begin() {
        calls.push("begin");
        if (url && status === "confirmed") return { action: "ready", join_url: url };
        return phase;
      },
      async store(_id, joinUrl) {
        calls.push("store");
        url = joinUrl;
      },
      async confirm() {
        calls.push("confirm");
        status = "confirmed";
        return { publicRef: "abcdefghijklmnopqrstuvwxyz", status, locationKind: "google_meet", locationDetail: url };
      },
      async release() {
        calls.push("release");
        status = "cancelled";
        url = null;
      },
      create,
    };
    return { calls, deps, setPhase: (next: BeginMeeting) => { phase = next; } };
  }

  it("creates one link, confirms, and a second pass does not call the provider", async () => {
    let created = 0;
    const { calls, deps } = harness(async (input) => {
      created += 1;
      expect(input.hostMembershipId).toBe("host-1");
      expect(input.args).toEqual({});
      return { meetingUri: "https://meet.google.com/abc-defg-hij" };
    });
    const first = await fulfillProviderMeeting("booking-1", deps);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.summary.locationDetail).toBe("https://meet.google.com/abc-defg-hij");
    const second = await fulfillProviderMeeting("booking-1", deps);
    expect(second.ok).toBe(true);
    expect(created).toBe(1);
    expect(calls.filter((call) => call === "store")).toHaveLength(1);
  });

  it("releases the hold when the provider returns no usable link", async () => {
    const { calls, deps } = harness(async () => ({ meetingUri: "https://evil.example/join" }));
    const result = await fulfillProviderMeeting("booking-1", deps);
    expect(result).toEqual({ ok: false, error: "The meeting account didn’t return a join link. Nothing was confirmed.", retry: false });
    expect(calls).toContain("release");
    expect(calls).not.toContain("confirm");
  });

  it("does not create a meeting while another attempt is still pending", async () => {
    let created = 0;
    const { deps, setPhase } = harness(async () => {
      created += 1;
      return { meetingUri: "https://meet.google.com/abc-defg-hij" };
    });
    setPhase({ action: "pending" });
    const result = await fulfillProviderMeeting("booking-1", deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retry).toBe(true);
    expect(created).toBe(0);
  });

  it("refuses a begin payload that names no host", () => {
    expect(parseBegin({ action: "create", provider: "google_meet" }).action).toBe("unavailable");
  });

  it("keeps a Meet room on reschedule and will not move Teams without an organizer id", () => {
    const meet = reschedulePlan({ locationKind: "google_meet", providerRef: "spaces/abc", organizerRef: null, hostMembershipId: "h" }, "2026-11-21T15:00:00.000Z", "2026-11-21T15:30:00.000Z");
    expect(meet.call).toBeNull();
    expect(meet.error).toBeNull();
    expect(meet.note).toMatch(/standing room/);
    const blocked = reschedulePlan({ locationKind: "microsoft_teams", providerRef: "meet-1", organizerRef: null, hostMembershipId: "h" }, "2026-11-21T15:00:00.000Z", "2026-11-21T15:30:00.000Z");
    expect(blocked.error).toMatch(/organizer id/);
    expect(blocked.call).toBeNull();
    const teams = reschedulePlan({ locationKind: "microsoft_teams", providerRef: "meet-1", organizerRef: "11111111-1111-1111-1111-111111111111", hostMembershipId: "h" }, "2026-11-21T15:00:00.000Z", "2026-11-21T15:30:00.000Z");
    expect(teams.call?.slug).toBe("MICROSOFT_TEAMS_UPDATE_ONLINE_MEETING");
    expect(teams.call?.args).not.toHaveProperty("participants");
  });

  it("ends a live Meet and deletes a Teams meeting only when the organizer id is known", () => {
    expect(cancelPlan({ locationKind: "google_meet", providerRef: "spaces/abc", organizerRef: null, hostMembershipId: "h" }).call?.slug).toBe("GOOGLEMEET_END_ACTIVE_CONFERENCE");
    const hidden = cancelPlan({ locationKind: "microsoft_teams", providerRef: null, organizerRef: null, hostMembershipId: "h" });
    expect(hidden.call).toBeNull();
    expect(hidden.note).toMatch(/not deleted/);
    expect(cancelPlan({ locationKind: "microsoft_teams", providerRef: "meet-1", organizerRef: "11111111-1111-1111-1111-111111111111", hostMembershipId: "h" }).call?.slug).toBe("MICROSOFT_TEAMS_DELETE_USER_ONLINE_MEETING");
    expect(meetingResource("google_meet", { name: "spaces/abc", meetingUri: "https://meet.google.com/abc-defg-hij" })?.providerRef).toBe("spaces/abc");
  });
});

describe("Calendly import plan", () => {
  const user = { resource: { uri: "https://api.calendly.com/users/USER1" } };
  const from = new Date("2026-11-06T00:00:00.000Z");
  const to = new Date("2027-01-05T00:00:00.000Z");

  it("keeps name and time, drops invitee fields, and marks a next page as incomplete", () => {
    const page = {
      collection: [
        { uri: "https://api.calendly.com/scheduled_events/EV1", name: "Intro call", status: "active", start_time: "2026-11-10T15:00:00.000Z", end_time: "2026-11-10T15:30:00.000Z", invitees: [{ email: "hidden@example.test" }] },
        { uri: "not-a-uri", name: "Skip", status: "active", start_time: "2026-11-10T16:00:00.000Z", end_time: "2026-11-10T16:30:00.000Z" },
      ],
      pagination: { next_page: "https://api.calendly.com/scheduled_events?page=2" },
    };
    const plan = planCalendlyImport({ user, page, from, to });
    expect(plan).toMatchObject({ complete: false, userUri: "https://api.calendly.com/users/USER1" });
    if (!("error" in plan)) {
      expect(plan.events).toEqual([{ uri: "https://api.calendly.com/scheduled_events/EV1", name: "Intro call", status: "active", starts_at: "2026-11-10T15:00:00.000Z", ends_at: "2026-11-10T15:30:00.000Z" }]);
      expect(JSON.stringify(plan.events)).not.toContain("hidden@example.test");
    }
  });

  it("follows a page token and does not treat a capped import as complete", () => {
    const page = { collection: [{ uri: "https://api.calendly.com/scheduled_events/EV1", name: "Intro", status: "active", start_time: "2026-11-10T15:00:00.000Z", end_time: "2026-11-10T15:30:00.000Z" }], pagination: { next_page_token: "next-1" } };
    expect(calendlyNextToken(page)).toBe("next-1");
    expect(parseCalendlyPage(page).truncated).toBe(true);
    const merged = mergeCalendlyPages([parseCalendlyPage(page)], true);
    expect(merged.complete).toBe(false);
    expect(merged.events).toHaveLength(1);
  });

  it("parses a complete page and a user", () => {
    expect(parseCalendlyUser(user)).toBe("https://api.calendly.com/users/USER1");
    expect(parseCalendlyEvent({ uri: "https://api.calendly.com/scheduled_events/EV1", name: "Intro", status: "canceled", start_time: "2026-11-10T15:00:00.000Z", end_time: "2026-11-10T15:30:00.000Z" })?.status).toBe("canceled");
    expect(parseCalendlyPage({ collection: [] }).truncated).toBe(false);
  });
});
