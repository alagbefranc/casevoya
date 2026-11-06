/**
 * Google Meet and Microsoft Teams links for a booking (pure).
 *
 * The database leaves the booking held. This asks the host's connected account to create one
 * link, stores that URL, then confirms. A retry of the same booking does not create a second
 * meeting. Reschedule and cancel do not call the provider: the allowlisted actions create a
 * Meet space or a Teams meeting and cannot update or cancel it, so the same join link stays
 * on the booking when the time changes, and cancelling Casevoya does not delete the provider
 * meeting or send a provider invitation.
 *
 * The provider call is injected. Nothing here talks to Composio or the database.
 */

export type MeetingProvider = "google_meet" | "microsoft_teams";

export type BeginMeeting =
  | { action: "skip" }
  | { action: "pending" }
  | { action: "stale" }
  | { action: "unavailable"; message: string }
  | { action: "ready"; join_url: string }
  | {
      action: "create";
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

export type CreateMeetingInput = {
  hostMembershipId: string;
  provider: MeetingProvider;
  slug: "GOOGLEMEET_CREATE_MEET" | "MICROSOFT_TEAMS_CREATE_MEETING";
  args: Record<string, unknown>;
};

/** Arguments for the allowlisted create action. No attendees, so the provider is not asked to invite anyone. */
export function meetingCreate(input: { provider: MeetingProvider; title: string; startsAt: string; endsAt: string; hostMembershipId: string }): CreateMeetingInput | { error: string } {
  const title = text(input.title).replace(/[\u0000-\u001f]/g, "").slice(0, 200);
  if (!title) return { error: "The booking has no title." };
  if (!Number.isFinite(Date.parse(input.startsAt)) || !Number.isFinite(Date.parse(input.endsAt))) return { error: "The booking has no time." };
  if (input.provider === "google_meet") {
    return { hostMembershipId: input.hostMembershipId, provider: input.provider, slug: "GOOGLEMEET_CREATE_MEET", args: {} };
  }
  return {
    hostMembershipId: input.hostMembershipId,
    provider: input.provider,
    slug: "MICROSOFT_TEAMS_CREATE_MEETING",
    args: { subject: title, start_date_time: new Date(input.startsAt).toISOString(), end_date_time: new Date(input.endsAt).toISOString() },
  };
}

/** The database's begin payload, or unavailable when it isn't one of the known actions. */
export function parseBegin(data: unknown): BeginMeeting {
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const action = row.action;
  if (action === "skip" || action === "pending" || action === "stale") return { action };
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
  store: (bookingId: string, joinUrl: string) => Promise<void>;
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
  if (begun.action === "stale" || begun.action === "unavailable") {
    await deps.release(bookingId);
    return { ok: false, error: begun.action === "stale" ? "The meeting link was not saved. Book the time again." : begun.message, retry: false };
  }
  if (begun.action === "ready") {
    const summary = await deps.confirm(bookingId);
    if (summary.status !== "confirmed" || !providerJoinUrl(summary.locationKind as MeetingProvider, summary.locationDetail ?? "")) {
      await deps.release(bookingId);
      return { ok: false, error: "The meeting link was not saved, so the booking was not confirmed.", retry: false };
    }
    return { ok: true, summary };
  }
  const request = meetingCreate({
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
  const joinUrl = joinUrlFromProvider(begun.provider, payload);
  if (!joinUrl) {
    await deps.release(bookingId);
    return { ok: false, error: "The meeting account didn’t return a join link. Nothing was confirmed.", retry: false };
  }
  try {
    await deps.store(bookingId, joinUrl);
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
