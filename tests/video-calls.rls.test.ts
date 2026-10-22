import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// In-app video calls (20261022100000): who may join a booking's LiveKit room, the join window,
// the lobby (a host admits the client), cancelling closes the room, and LiveKit webhooks.
// Everything here is synthetic; no LiveKit call is made (the app server mints tokens).

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

const TZ = "America/Toronto";
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function createUser(label: string, name?: string) {
  await asMaintenance(db);
  const id = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@example.test`;
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3::jsonb)`, [
    id,
    email,
    JSON.stringify(name ? { display_name: name } : {}),
  ]);
  return { id, email };
}

async function membership(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
    [orgId, userId, role],
  );
  return row.rows[0].id;
}

const staff = (userId: string, orgId: string) => ({ userId, aal: "aal2" as const, orgId, totpAgeSeconds: 0 });
const client = (userId: string, orgId: string | null) => ({ userId, aal: "aal1" as const, orgId });

async function firm() {
  const owner = await createUser("owner", "Synthetic Owner");
  await asUser(db, { userId: owner.id, aal: "aal2", totpAgeSeconds: 0 });
  const firmSlug = slug();
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", firmSlug])).rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false, timezone = $2 where id = $1`, [orgId, TZ]);
  const host = await createUser("host", "Synthetic Host");
  const hostMembership = await membership(orgId, host.id, "licensed_consultant");
  await asMaintenance(db);
  await db.query(`update public.profiles set display_name = 'Synthetic Host' where id = $1`, [host.id]);
  await asUser(db, staff(host.id, orgId));
  await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [orgId, hostMembership, TZ, JSON.stringify(EVERY_DAY)]);
  await asUser(db, staff(owner.id, orgId));
  for (const [kind, detail, eventSlug] of [
    ["video", null, "video"],
    ["meeting_link", "https://meet.example.test/room", "link"],
  ] as const) {
    await db.query(
      `select public.save_booking_event_type($1, null, null, $2, $3, null, 30, null, 0, 0, 0, 14, null,
         $4::public.booking_location_kind, $5, $6::uuid[], true)`,
      [orgId, kind === "video" ? "Video consultation" : "Link consultation", eventSlug, kind, detail, [hostMembership]],
    );
  }
  const clientUser = await createUser("client", "Synthetic Client");
  await membership(orgId, clientUser.id, "client");
  await asMaintenance(db);
  const personId = (
    await db.query<{ id: string }>(`insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Synthetic Client', $3) returning id`, [
      orgId,
      clientUser.id,
      clientUser.email,
    ])
  ).rows[0].id;
  return { orgId, firmSlug, owner, host, hostMembership, client: clientUser, personId };
}

type Ctx = Awaited<ReturnType<typeof firm>>;

async function futureSlot(days: number): Promise<string> {
  await asMaintenance(db);
  return (
    await db.query<{ at: string }>(
      `select to_char(app.local_instant((now() at time zone $1)::date + $2::integer, '10:00'::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
      [TZ, days],
    )
  ).rows[0].at;
}

/**
 * The client books a call on the public page (signed in, so the booking is their own), then the
 * booking is moved to start `startsInMin` minutes from now (the window is relative to now).
 */
async function book(ctx: Ctx, options: { event?: "video" | "link"; startsInMin?: number } = {}) {
  await asUser(db, client(ctx.client.id, null));
  const hold = (
    await db.query<{ r: { public_ref: string; error?: string } }>(
      `select public.booking_public_hold($1, $2, $3::timestamptz, 'Synthetic Client', $4, null, $5, $6, null) as r`,
      [ctx.firmSlug, options.event ?? "video", await futureSlot(3), ctx.client.email, TZ, randomUUID()],
    )
  ).rows[0].r;
  if (hold.error) throw new Error(hold.error);
  await asMaintenance(db);
  const startsIn = options.startsInMin ?? 5;
  await db.query(
    `update public.bookings set starts_at = now() + make_interval(mins => $2), ends_at = now() + make_interval(mins => $2 + 30),
       blocked_from = now() + make_interval(mins => $2), blocked_until = now() + make_interval(mins => $2 + 30), person_id = $3
     where public_ref = $1`,
    [hold.public_ref, startsIn, ctx.personId],
  );
  return (await db.query<{ id: string; public_ref: string; version: number }>(`select id, public_ref, version from public.bookings where public_ref = $1`, [hold.public_ref])).rows[0];
}

type Join = { state: string; reason?: string; role?: string; identity?: string; name?: string; admitted?: boolean; room_name?: string; room_created?: boolean; ttl_seconds?: number };

async function join(who: ReturnType<typeof staff> | ReturnType<typeof client>, orgId: string, ref: string, issue = true): Promise<Join> {
  await asUser(db, who);
  return (await db.query<{ r: Join }>(`select public.video_join($1, $2, $3) as r`, [orgId, ref, issue])).rows[0].r;
}

describe("video calls: who may join", () => {
  it("the host joins admitted; the client joins in the lobby until the host lets them in", async () => {
    const ctx = await firm();
    const booking = await book(ctx);

    const host = await join(staff(ctx.host.id, ctx.orgId), ctx.orgId, booking.public_ref);
    expect(host).toMatchObject({ state: "open", role: "host", identity: `staff:${ctx.host.id}`, name: "Synthetic Host", admitted: true, room_created: false });
    expect(host.room_name).toBe(`cv-${booking.id.replaceAll("-", "")}`);
    expect(host.ttl_seconds).toBeGreaterThan(60);
    expect(host.ttl_seconds).toBeLessThanOrEqual(7200);

    const waiting = await join(client(ctx.client.id, ctx.orgId), ctx.orgId, booking.public_ref);
    expect(waiting).toMatchObject({ state: "open", role: "client", identity: `client:${ctx.client.id}`, name: "Synthetic Client", admitted: false });

    // A client cannot let themselves in.
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.video_admit($1, $2, $3, true)`, [ctx.orgId, booking.public_ref, `client:${ctx.client.id}`]), /only the host/);

    await asUser(db, staff(ctx.host.id, ctx.orgId));
    const admitted = (await db.query<{ r: { room_name: string; identity: string } }>(`select public.video_admit($1, $2, $3, true) as r`, [ctx.orgId, booking.public_ref, `client:${ctx.client.id}`])).rows[0].r;
    expect(admitted).toEqual({ room_name: host.room_name, identity: `client:${ctx.client.id}` });
    expect(await join(client(ctx.client.id, ctx.orgId), ctx.orgId, booking.public_ref)).toMatchObject({ admitted: true });

    // Sent away: the next ask goes back to the lobby.
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await db.query(`select public.video_admit($1, $2, $3, false)`, [ctx.orgId, booking.public_ref, `client:${ctx.client.id}`]);
    expect(await join(client(ctx.client.id, ctx.orgId), ctx.orgId, booking.public_ref)).toMatchObject({ admitted: false });

    // Audited without any token.
    await asMaintenance(db);
    const actions = (await db.query<{ action: string; context: Record<string, unknown> }>(`select action, context from public.audit_log where object_id = $1 and action like 'video.%' order by occurred_at`, [booking.id])).rows;
    expect(actions.map((a) => a.action)).toEqual(["video.join_issued", "video.join_issued", "video.admitted", "video.join_issued", "video.removed", "video.join_issued"]);
    expect(JSON.stringify(actions)).not.toMatch(/token/i);
  });

  it("a firm owner joins as a host; other staff, another client and another firm are refused like a missing booking", async () => {
    const ctx = await firm();
    const booking = await book(ctx);
    expect(await join(staff(ctx.owner.id, ctx.orgId), ctx.orgId, booking.public_ref)).toMatchObject({ state: "open", role: "host", admitted: true });

    const assistant = await createUser("assistant");
    await membership(ctx.orgId, assistant.id, "assistant");
    await asUser(db, staff(assistant.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.video_join($1, $2, false)`, [ctx.orgId, booking.public_ref]), /call access denied/);

    const other = await createUser("other-client");
    await membership(ctx.orgId, other.id, "client");
    await asUser(db, client(other.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.video_join($1, $2, false)`, [ctx.orgId, booking.public_ref]), /call access denied/);

    const elsewhere = await firm();
    await asUser(db, staff(elsewhere.owner.id, elsewhere.orgId));
    await expectDbError(() => db.query(`select public.video_join($1, $2, false)`, [ctx.orgId, booking.public_ref]), /call access denied/);
    await expectDbError(() => db.query(`select public.video_join($1, $2, false)`, [elsewhere.orgId, booking.public_ref]), /call access denied/);

    // Staff without staff MFA are not hosts.
    await asUser(db, { userId: ctx.host.id, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.video_join($1, $2, false)`, [ctx.orgId, booking.public_ref]), /call access denied/);
  });

  it("nobody reads the rooms table but the firm's scheduling staff", async () => {
    const ctx = await firm();
    const booking = await book(ctx);
    await join(staff(ctx.host.id, ctx.orgId), ctx.orgId, booking.public_ref);
    await asUser(db, client(ctx.client.id, ctx.orgId));
    expect((await db.query(`select id from public.video_sessions`)).rows).toHaveLength(0);
    expect((await db.query(`select id from public.video_participants`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select id from public.video_token_issues`), /permission denied/);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    expect((await db.query(`select id from public.video_sessions where booking_id = $1`, [booking.id])).rows).toHaveLength(1);
  });
});

describe("video calls: the window", () => {
  it("before the window the call is early, after it closed; previewing writes nothing", async () => {
    const ctx = await firm();
    const later = await book(ctx, { startsInMin: 60 });
    expect(await join(client(ctx.client.id, ctx.orgId), ctx.orgId, later.public_ref)).toMatchObject({ state: "early" });

    const past = await book(ctx, { startsInMin: -70 });
    expect(await join(client(ctx.client.id, ctx.orgId), ctx.orgId, past.public_ref)).toMatchObject({ state: "closed" });

    const soon = await book(ctx, { startsInMin: 10 });
    expect(await join(client(ctx.client.id, ctx.orgId), ctx.orgId, soon.public_ref, false)).toMatchObject({ state: "open", role: "client" });
    await asMaintenance(db);
    expect((await db.query(`select id from public.video_sessions where booking_id = any($1::uuid[])`, [[later.id, past.id, soon.id]])).rows).toHaveLength(0);
  });

  it("a meeting-link booking is not a Casevoya call", async () => {
    const ctx = await firm();
    const booking = await book(ctx, { event: "link" });
    expect(await join(client(ctx.client.id, ctx.orgId), ctx.orgId, booking.public_ref)).toMatchObject({ state: "unavailable", reason: "not_video" });
  });

  it("cancelling the booking closes the room: no token is issued again", async () => {
    const ctx = await firm();
    const booking = await book(ctx, { startsInMin: 3 * 60 });
    // Open the room early as maintenance would see it (the window is not open yet for anyone).
    await asMaintenance(db);
    await db.query(`update public.bookings set starts_at = now() + interval '5 minutes', ends_at = now() + interval '35 minutes', blocked_from = now() + interval '5 minutes', blocked_until = now() + interval '35 minutes' where id = $1`, [booking.id]);
    await join(staff(ctx.host.id, ctx.orgId), ctx.orgId, booking.public_ref);
    const version = (await db.query<{ version: number }>(`select version from public.bookings where id = $1`, [booking.id])).rows[0].version;
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await db.query(`select public.portal_cancel_booking($1, $2, $3, null)`, [ctx.orgId, booking.id, version]);
    await asMaintenance(db);
    expect((await db.query<{ status: string }>(`select status from public.video_sessions where booking_id = $1`, [booking.id])).rows[0].status).toBe("cancelled");
    expect(await join(staff(ctx.host.id, ctx.orgId), ctx.orgId, booking.public_ref)).toMatchObject({ state: "unavailable", reason: "cancelled" });
  });

  it("joins are rate limited per person and room", async () => {
    const ctx = await firm();
    const booking = await book(ctx);
    for (let n = 0; n < 10; n += 1) await join(client(ctx.client.id, ctx.orgId), ctx.orgId, booking.public_ref);
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.video_join($1, $2, true)`, [ctx.orgId, booking.public_ref]), /too many join attempts/);
    // The host is counted separately.
    expect(await join(staff(ctx.host.id, ctx.orgId), ctx.orgId, booking.public_ref)).toMatchObject({ state: "open" });
  });
});

describe("video calls: ending and webhooks", () => {
  it("only a host ends the call", async () => {
    const ctx = await firm();
    const booking = await book(ctx);
    await join(staff(ctx.host.id, ctx.orgId), ctx.orgId, booking.public_ref);
    await db.query(`select public.video_room_created($1, $2)`, [ctx.orgId, booking.public_ref]);
    expect(await join(staff(ctx.host.id, ctx.orgId), ctx.orgId, booking.public_ref)).toMatchObject({ room_created: true });
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.video_end($1, $2)`, [ctx.orgId, booking.public_ref]), /only the host/);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    expect((await db.query<{ r: { room_name: string } }>(`select public.video_end($1, $2) as r`, [ctx.orgId, booking.public_ref])).rows[0].r.room_name).toBe(`cv-${booking.id.replaceAll("-", "")}`);
    await asMaintenance(db);
    expect((await db.query<{ status: string }>(`select status from public.video_sessions where booking_id = $1`, [booking.id])).rows[0].status).toBe("ended");
    // Ended for everyone: the client gets no token, not even a preview of an open call.
    expect(await join(client(ctx.client.id, ctx.orgId), ctx.orgId, booking.public_ref)).toMatchObject({ state: "unavailable", reason: "ended" });
    expect(await join(client(ctx.client.id, ctx.orgId), ctx.orgId, booking.public_ref, false)).toMatchObject({ state: "unavailable", reason: "ended" });
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.video_participants where identity = $1`, [`client:${ctx.client.id}`])).rows).toHaveLength(0);
    // When the call's room was first created is kept after the end (the app re-creates the room on every join).
    expect((await db.query<{ room_created_at: Date | null }>(`select room_created_at from public.video_sessions where booking_id = $1`, [booking.id])).rows[0].room_created_at).not.toBeNull();
    // The host restarts it inside the window; then the client can join.
    expect(await join(staff(ctx.host.id, ctx.orgId), ctx.orgId, booking.public_ref)).toMatchObject({ state: "open", room_created: true });
    expect(await join(client(ctx.client.id, ctx.orgId), ctx.orgId, booking.public_ref)).toMatchObject({ state: "open", role: "client", admitted: false });
  });

  it("a room that closes on its own (everyone left) is not an end: the client can rejoin", async () => {
    const ctx = await firm();
    const booking = await book(ctx);
    const host = await join(staff(ctx.host.id, ctx.orgId), ctx.orgId, booking.public_ref);
    await asServiceRole(db);
    await db.query(`select public.apply_livekit_event($1::jsonb)`, [JSON.stringify({ id: `EV_${booking.id}`, event: "room_finished", room: { name: host.room_name } })]);
    expect(await join(client(ctx.client.id, ctx.orgId), ctx.orgId, booking.public_ref)).toMatchObject({ state: "open", role: "client" });
  });

  it("LiveKit events move the room and the participants once each; unknown rooms are ignored", async () => {
    const ctx = await firm();
    const booking = await book(ctx);
    const host = await join(staff(ctx.host.id, ctx.orgId), ctx.orgId, booking.public_ref);
    await join(client(ctx.client.id, ctx.orgId), ctx.orgId, booking.public_ref);
    const at = Math.floor(Date.now() / 1000);
    const apply = async (event: Record<string, unknown>) => {
      await asServiceRole(db);
      return (await db.query<{ r: { outcome: string } }>(`select public.apply_livekit_event($1::jsonb) as r`, [JSON.stringify(event)])).rows[0].r.outcome;
    };
    expect(await apply({ id: "EV_1", event: "room_started", room: { name: host.room_name }, createdAt: String(at) })).toBe("applied");
    expect(await apply({ id: "EV_2", event: "participant_joined", room: { name: host.room_name }, participant: { identity: `client:${ctx.client.id}` }, createdAt: at + 5 })).toBe("applied");
    expect(await apply({ id: "EV_2", event: "participant_joined", room: { name: host.room_name }, participant: { identity: `client:${ctx.client.id}` }, createdAt: at + 5 })).toBe("duplicate");
    expect(await apply({ id: "EV_3", event: "participant_left", room: { name: host.room_name }, participant: { identity: `client:${ctx.client.id}` }, createdAt: at + 60 })).toBe("applied");
    expect(await apply({ id: "EV_4", event: "room_finished", room: { name: host.room_name }, createdAt: at + 90 })).toBe("applied");
    expect(await apply({ id: "EV_5", event: "room_started", room: { name: "cv-00000000000000000000000000000000" }, createdAt: at })).toBe("ignored");
    expect(
      await apply({
        id: "EV_6",
        event: "track_published",
        room: { name: host.room_name },
        participant: { identity: `client:${ctx.client.id}` },
        track: { sid: "TR_synthetic", type: "VIDEO", source: "CAMERA", muted: true, width: 1280, height: 720, mimeType: "video/VP8" },
        createdAt: at,
      }),
    ).toBe("ignored");

    await asMaintenance(db);
    const session = (await db.query<{ status: string; started_at: Date; ended_at: Date; room_created_at: Date | null }>(`select status, started_at, ended_at, room_created_at from public.video_sessions where booking_id = $1`, [booking.id])).rows[0];
    expect(session.status).toBe("ended");
    expect(session.started_at.getTime()).toBe(at * 1000);
    expect(session.ended_at.getTime()).toBe((at + 90) * 1000);
    // room_started's time is kept after room_finished (prod 2026-10-22: it was cleared, so every ended call showed NULL).
    expect(session.room_created_at?.getTime()).toBe(at * 1000);
    // A track event keeps what the track was (no track id), for diagnosing a black tile.
    const track = (await db.query<{ payload: { track?: Record<string, unknown> } }>(`select payload from public.webhook_inbox where provider = 'livekit' and event_id = 'EV_6'`)).rows[0].payload.track;
    expect(track).toEqual({ source: "CAMERA", type: "VIDEO", muted: true, width: 1280, height: 720, mime_type: "video/VP8" });
    const part = (await db.query<{ first_joined_at: Date; last_left_at: Date }>(`select first_joined_at, last_left_at from public.video_participants where identity = $1`, [`client:${ctx.client.id}`])).rows[0];
    expect(part.first_joined_at.getTime()).toBe((at + 5) * 1000);
    expect(part.last_left_at.getTime()).toBe((at + 60) * 1000);

    // Only the service role applies events.
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.apply_livekit_event('{"id":"EV_7"}'::jsonb)`), /permission denied/);
  });
});
