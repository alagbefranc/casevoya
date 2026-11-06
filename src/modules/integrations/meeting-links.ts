/**
 * Google Meet and Microsoft Teams links for a booking (pure).
 *
 * The database leaves the booking held. This asks the host's connected account to create one
 * link, stores that URL, then confirms. A retry of the same booking does not create a second
 * meeting. Google Meet is a standing room: the same link stays when the time changes, and
 * cancelling ends a live call but cannot delete the room. Teams is created idempotently,
 * moved when Microsoft returned an organizer id, and deleted on cancel when that id exists.
 * Nobody is invited.
 *
 * The provider call is injected. Nothing here talks to Composio or the database.
 */

export type MeetingProvider = "google_meet" | "microsoft_teams";

export type BeginMeeting =
  | { action: "skip" }
  | { action: "pending" }
  | { action: "stale"; provider: MeetingProvider | null; booking_id: string; host_membership_id: string; title: string; starts_at: string; ends_at: string }
  | { action: "unavailable"; message: string }
  | { action: "ready"; join_url: string }
  | {
      action: "create";
      booking_id: string;
      organization_id: string;
      host_membership_id: string;
      provider: MeetingProvider;
      title: string;
      starts_at: string;
      ends_at: string;
    };

export type MeetingSummary = {
  publicRef: string;
  status: string;
  locationKind: string;
  locationDetail: string | null;
};

export function isMeetingProvider(kind: string): kind is MeetingProvider {
  return kind === "google_meet" || kind === "microsoft_teams";
}

/** A join URL we will store and show. The host has to be the provider's, not a lookalike. */
export function providerJoinUrl(provider: MeetingProvider, value: string): string | null {
  const url = value.trim();
  if (url.length > 1000 || /\s/.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  const allowed =
    provider === "google_meet"
      ? host === "meet.google.com"
      : host === "teams.microsoft.com" || host === "teams.live.com" || host.endsWith(".teams.microsoft.com");
  if (!allowed || !parsed.pathname || parsed.pathname === "/") return null;
  return url;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The first allowlisted join URL in a provider payload, at most a few levels down. */
export function joinUrlFromProvider(provider: MeetingProvider, data: unknown): string | null {
  const preferred = ["meetingUri", "meeting_uri", "joinWebUrl", "joinUrl", "join_url", "hangoutLink", "url"];
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number): string | null => {
    if (value == null || depth > 5 || seen.has(value)) return null;
    if (typeof value === "string") return providerJoinUrl(provider, value);
    if (typeof value !== "object") return null;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of preferred) {
      if (key in record) {
        const found = walk(record[key], depth + 1);
        if (found) return found;
      }
    }
    for (const key of Object.keys(record)) {
      if (preferred.includes(key)) continue;
      const found = walk(record[key], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(data, 0);
}

export type MeetingSlug =
  | "GOOGLEMEET_CREATE_MEET"
  | "GOOGLEMEET_END_ACTIVE_CONFERENCE"
  | "MICROSOFT_TEAMS_CREATE_OR_GET_ONLINE_MEETING"
  | "MICROSOFT_TEAMS_UPDATE_ONLINE_MEETING"
  | "MICROSOFT_TEAMS_DELETE_USER_ONLINE_MEETING";

export type CreateMeetingInput = {
  hostMembershipId: string;
  provider: MeetingProvider;
  slug: MeetingSlug;
  args: Record<string, unknown>;
};

export type MeetingResource = { joinUrl: string; providerRef: string | null; organizerRef: string | null };

/** A stable Teams external id. The same booking always resolves to the same meeting. */
export function teamsExternalId(bookingId: string): string {
  return `casevoya:${bookingId}`.slice(0, 256);
}

/**
 * Create arguments. Google Meet is a standing room (no start or end). Teams uses the idempotent
 * create-or-get action and sends no participant list, so nobody is invited.
 */
export function meetingCreate(input: { bookingId: string; provider: MeetingProvider; title: string; startsAt: string; endsAt: string; hostMembershipId: string }): CreateMeetingInput | { error: string } {
  const title = text(input.title).replace(/[\u0000-\u001f]/g, "").slice(0, 200);
  if (!title) return { error: "The booking has no title." };
  if (!Number.isFinite(Date.parse(input.startsAt)) || !Number.isFinite(Date.parse(input.endsAt))) return { error: "The booking has no time." };
  if (input.provider === "google_meet") {
    return { hostMembershipId: input.hostMembershipId, provider: input.provider, slug: "GOOGLEMEET_CREATE_MEET", args: {} };
  }
  return {
    hostMembershipId: input.hostMembershipId,
    provider: input.provider,
    slug: "MICROSOFT_TEAMS_CREATE_OR_GET_ONLINE_MEETING",
    args: {
      externalId: teamsExternalId(input.bookingId),
      subject: title,
      startDateTime: new Date(input.startsAt).toISOString(),
      endDateTime: new Date(input.endsAt).toISOString(),
    },
  };
}

function spaceName(value: string): string | null {
  const name = value.trim();
  if (/^spaces\/[A-Za-z0-9_-]{3,200}$/.test(name)) return name;
  return null;
}

/** Space name, Teams meeting id, and organizer id from a provider payload. The join URL is allowlisted. */
export function meetingResource(provider: MeetingProvider, data: unknown): MeetingResource | null {
  const joinUrl = joinUrlFromProvider(provider, data);
  if (!joinUrl) return null;
  let providerRef: string | null = null;
  let organizerRef: string | null = null;
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    const name = text(record.name);
    const id = text(record.id);
    if (!providerRef && provider === "google_meet" && spaceName(name)) providerRef = spaceName(name);
    if (!providerRef && provider === "microsoft_teams" && id.length >= 8 && id.length <= 400) providerRef = id;
    const user = record.user && typeof record.user === "object" ? (record.user as Record<string, unknown>) : null;
    const organizer = text(user?.id);
    if (!organizerRef && /^[0-9a-f-]{36}$/i.test(organizer)) organizerRef = organizer;
    for (const child of Object.values(record)) walk(child, depth + 1);
  };
  walk(data, 0);
  return { joinUrl, providerRef, organizerRef };
}

export type ProviderState = {
  locationKind: string;
  providerRef: string | null;
  organizerRef: string | null;
  hostMembershipId: string;
};

/** What a time change may do. Meet has no clock. Teams is updated only when Microsoft gave us both ids. */
export function reschedulePlan(state: ProviderState | null, startIso: string, endIso: string): { call: CreateMeetingInput | null; error: string | null; note: string | null } {
  if (!state || !isMeetingProvider(state.locationKind)) return { call: null, error: null, note: null };
  if (state.locationKind === "google_meet") {
    return { call: null, error: null, note: "Google Meet is a standing room, so the same link stays. The new time is kept in Casevoya." };
  }
  if (!state.providerRef || !state.organizerRef) {
    return { call: null, error: "This Teams meeting can’t be moved from Casevoya. Microsoft didn’t return the organizer id. The time was not changed.", note: null };
  }
  return {
    call: {
      hostMembershipId: state.hostMembershipId,
      provider: "microsoft_teams",
      slug: "MICROSOFT_TEAMS_UPDATE_ONLINE_MEETING",
      args: { user_id: state.organizerRef, online_meeting_id: state.providerRef, start_date_time: startIso, end_date_time: endIso },
    },
    error: null,
    note: null,
  };
}

/** What a cancellation may do. No participant list is sent. */
export function cancelPlan(state: ProviderState | null): { call: CreateMeetingInput | null; note: string | null; block: string | null } {
  if (!state || !isMeetingProvider(state.locationKind)) return { call: null, note: null, block: null };
  if (state.locationKind === "google_meet") {
    if (!state.providerRef) return { call: null, note: "Google doesn’t offer a way to delete this Meet room. The link is hidden here; the room can remain in the host’s account.", block: null };
    return {
      call: {
        hostMembershipId: state.hostMembershipId,
        provider: "google_meet",
        slug: "GOOGLEMEET_END_ACTIVE_CONFERENCE",
        args: { space_name: state.providerRef },
      },
      note: "Any live Meet call was ended. Google doesn’t offer a way to delete the room, so it can remain in the host’s account. The link is hidden here.",
      block: null,
    };
  }
  if (!state.providerRef || !state.organizerRef) {
    return { call: null, note: "Microsoft didn’t return the organizer id, so the Teams meeting was not deleted. The link is hidden here.", block: null };
  }
  return {
    call: {
      hostMembershipId: state.hostMembershipId,
      provider: "microsoft_teams",
      slug: "MICROSOFT_TEAMS_DELETE_USER_ONLINE_MEETING",
      args: { user_id: state.organizerRef, online_meeting_id: state.providerRef },
    },
    note: null,
    block: null,
  };
}

/** The database's begin payload, or unavailable when it isn't one of the known actions. */
export function parseBegin(data: unknown): BeginMeeting {
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const action = row.action;
  if (action === "skip" || action === "pending") return { action };
  if (action === "stale") {
    return {
      action,
      provider: isMeetingProvider(text(row.provider)) ? (text(row.provider) as MeetingProvider) : null,
      booking_id: text(row.booking_id),
      host_membership_id: text(row.host_membership_id),
      title: text(row.title),
      starts_at: text(row.starts_at),
      ends_at: text(row.ends_at),
    };
  }
  if (action === "unavailable") return { action, message: text(row.message) || "The host’s meeting account is not connected." };
  if (action === "ready") {
    const url = text(row.join_url);
    if (providerJoinUrl("google_meet", url) || providerJoinUrl("microsoft_teams", url)) return { action, join_url: url };
    return { action: "unavailable", message: "The saved meeting link isn’t usable." };
  }
  if (
    action === "create" &&
    isMeetingProvider(text(row.provider)) &&
    text(row.host_membership_id) &&
    text(row.organization_id) &&
    text(row.starts_at) &&
    text(row.ends_at)
  ) {
    return {
      action,
      booking_id: text(row.booking_id),
      organization_id: text(row.organization_id),
      host_membership_id: text(row.host_membership_id),
      provider: text(row.provider) as MeetingProvider,
      title: text(row.title),
      starts_at: text(row.starts_at),
      ends_at: text(row.ends_at),
    };
  }
  return { action: "unavailable", message: "The meeting account couldn’t be used." };
}

export type MeetingDeps = {
  begin: (bookingId: string) => Promise<BeginMeeting>;
  store: (bookingId: string, joinUrl: string, meta: { providerRef: string | null; organizerRef: string | null }) => Promise<void>;
  confirm: (bookingId: string) => Promise<MeetingSummary>;
  release: (bookingId: string) => Promise<void>;
  create: (input: CreateMeetingInput) => Promise<unknown>;
};

export type MeetingResult = { ok: true; summary: MeetingSummary } | { ok: false; error: string; retry: boolean };

/**
 * Create the host's link once and confirm the held booking. `bookingId` is the row the hold just
 * wrote; the provider is called only as that row's host.
 */
export async function fulfillProviderMeeting(bookingId: string, deps: MeetingDeps): Promise<MeetingResult> {
  const begun = await deps.begin(bookingId);
  if (begun.action === "skip") return { ok: false, error: "This booking does not use a meeting account.", retry: false };
  if (begun.action === "pending") return { ok: false, error: "The meeting link is still being created. Send this booking again in a moment.", retry: true };
  if (begun.action === "unavailable") {
    await deps.release(bookingId);
    return { ok: false, error: begun.message, retry: false };
  }
  if (begun.action === "stale") {
    if (begun.provider !== "microsoft_teams") {
      await deps.release(bookingId);
      return { ok: false, error: "The Meet link wasn’t saved. Book the time again. An unused Meet room may remain in the host’s account.", retry: false };
    }
    return finishCreated(bookingId, { ...begun, provider: "microsoft_teams" }, deps);
  }
  if (begun.action === "ready") {
    const summary = await deps.confirm(bookingId);
    if (summary.status !== "confirmed" || !providerJoinUrl(summary.locationKind as MeetingProvider, summary.locationDetail ?? "")) {
      await deps.release(bookingId);
      return { ok: false, error: "The meeting link was not saved, so the booking was not confirmed.", retry: false };
    }
    return { ok: true, summary };
  }
  return finishCreated(bookingId, begun, deps);
}

async function finishCreated(
  bookingId: string,
  begun: { provider: MeetingProvider; booking_id?: string; title: string; starts_at: string; ends_at: string; host_membership_id: string },
  deps: MeetingDeps,
): Promise<MeetingResult> {
  const request = meetingCreate({
    bookingId: begun.booking_id || bookingId,
    provider: begun.provider,
    title: begun.title,
    startsAt: begun.starts_at,
    endsAt: begun.ends_at,
    hostMembershipId: begun.host_membership_id,
  });
  if ("error" in request) {
    await deps.release(bookingId);
    return { ok: false, error: request.error, retry: false };
  }
  let payload: unknown;
  try {
    payload = await deps.create(request);
  } catch {
    await deps.release(bookingId);
    return { ok: false, error: "The meeting account didn’t answer. Nothing was confirmed.", retry: false };
  }
  const resource = meetingResource(begun.provider, payload);
  if (!resource) {
    await deps.release(bookingId);
    return { ok: false, error: "The meeting account didn’t return a join link. Nothing was confirmed.", retry: false };
  }
  const joinUrl = resource.joinUrl;
  try {
    await deps.store(bookingId, joinUrl, { providerRef: resource.providerRef, organizerRef: resource.organizerRef });
    const summary = await deps.confirm(bookingId);
    if (summary.status !== "confirmed" || summary.locationDetail !== joinUrl) {
      await deps.release(bookingId);
      return { ok: false, error: "The meeting link was not saved, so the booking was not confirmed.", retry: false };
    }
    return { ok: true, summary };
  } catch {
    await deps.release(bookingId);
    return { ok: false, error: "The meeting link was not saved, so the booking was not confirmed.", retry: false };
  }
}
