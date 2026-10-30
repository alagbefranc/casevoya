import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { publishTestPrivacyNotice } from "./helpers/privacy-notice";
import { parseAvailability, slotsFromAvailability } from "@/modules/scheduling/availability";

// Portal appointments (20261020150000–20261020150200): a client moves or cancels their own
// upcoming consultation, reads the free times for moving it, EM16b/EM16c go to them, and the host
// and the firm owner get an in-app notice. Everything here is synthetic.

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

async function firm(options: { notice?: number; capacity?: number | null } = {}) {
  const ownerUser = await createUser("owner", "Synthetic Owner");
  await asUser(db, { userId: ownerUser.id, aal: "aal2", totpAgeSeconds: 0 });
  const firmSlug = slug();
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", firmSlug]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false, timezone = $2 where id = $1`, [orgId, TZ]);
  // #263-A: booking pages need the firm's published privacy notice.
  await publishTestPrivacyNotice(db, orgId);
  const host = await createUser("host", "Synthetic Host");
  const hostMembership = await membership(orgId, host.id, "licensed_consultant");
  await asUser(db, staff(host.id, orgId));
  await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [orgId, hostMembership, TZ, JSON.stringify(EVERY_DAY)]);
  await asUser(db, staff(ownerUser.id, orgId));
  const typeId = (
    await db.query<{ id: string }>(
      `select public.save_booking_event_type($1, null, null, 'Package review call', 'review', null, 30, null, 0, 0, $2, 14, $3,
         'meeting_link'::public.booking_location_kind, 'https://meet.example.test/room', $4::uuid[], true) as id`,
      [orgId, options.notice ?? 60, options.capacity ?? null, [hostMembership]],
    )
  ).rows[0].id;
  // The client: a portal login linked to their own person.
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
  return { orgId, firmSlug, owner: ownerUser, host, hostMembership, typeId, client: clientUser, personId };
}

type Ctx = Awaited<ReturnType<typeof firm>>;

/** A local time in the host's zone, `days` days from today, as an ISO instant. */
async function localStart(days: number, time = "10:00"): Promise<string> {
  await asMaintenance(db);
  const row = await db.query<{ at: string }>(
    `select to_char(app.local_instant((now() at time zone $1)::date + $2::integer, $3::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
    [TZ, days, time],
  );
  return row.rows[0].at;
}

/** The client books on the firm's public page, signed in, so the booking is their own. */
async function book(ctx: Ctx, start: string, options: { as?: { id: string; email: string } } = {}) {
  const who = options.as ?? ctx.client;
  // The hold is service role only; the server names the signed-in visitor (20261030231500).
  await asServiceRole(db);
  const row = await db.query<{ r: { public_ref: string; error?: string } }>(
    `select public.booking_public_hold($1, 'review', $2::timestamptz, 'Synthetic Client', $3, null, 'America/Vancouver', $4, $5, $6::uuid) as r`,
    [ctx.firmSlug, start, who.email, randomUUID(), createHash("sha256").update(randomUUID()).digest("hex"), who.id],
  );
  if (row.rows[0].r.error) throw new Error(row.rows[0].r.error);
  await asMaintenance(db);
  const booking = (
    await db.query<{ id: string; version: number; person_id: string | null }>(`select id, version, person_id from public.bookings where public_ref = $1`, [row.rows[0].r.public_ref])
  ).rows[0];
  return booking;
}

async function outboxTypes(bookingId: string) {
  await asMaintenance(db);
  return (await db.query<{ event_type: string; payload: Record<string, unknown>; idempotency_key: string }>(`select event_type, payload, idempotency_key from public.outbox_events where aggregate_id = $1 order by occurred_at`, [bookingId])).rows;
}

type Item = { id: string; kind: string; actor_name: string | null; subject: string | null; detail: string | null; href: string };

async function notices(userId: string, orgId: string): Promise<Item[]> {
  await asUser(db, staff(userId, orgId));
  return (await db.query<{ items: Item[] }>(`select public.staff_notifications($1, 50) as items`, [orgId])).rows[0].items;
}

async function prepareMail(eventType: string, orgId: string) {
  await asServiceRole(db);
  const worker = `worker-${randomUUID().slice(0, 8)}`;
  const claimed = (await db.query<{ c: { id: string; event_type: string; organization_id: string }[] }>(`select public.claim_mail_events($1, 50) as c`, [worker])).rows[0].c;
  const event = claimed.find((row) => row.event_type === eventType && row.organization_id === orgId);
  expect(event, eventType).toBeTruthy();
  return (await db.query<{ p: { action: string; messages: { to: string; template: string; context: Record<string, unknown> }[] } }>(`select public.prepare_email_delivery($1, $2) as p`, [event!.id, worker])).rows[0].p;
}

describe("portal appointments: cancel", () => {
  it("the client cancels their own upcoming call: history, EM16c (cancelled by the client), the staff notice and the audit row", async () => {
    const ctx = await firm();
    const booking = await book(ctx, await localStart(5));
    expect(booking.person_id).toBe(ctx.personId);

    await asUser(db, client(ctx.client.id, ctx.orgId));
    const result = (await db.query<{ r: { late: boolean } }>(`select public.portal_cancel_booking($1, $2, $3, null) as r`, [ctx.orgId, booking.id, booking.version])).rows[0].r;
    expect(result).toEqual({ late: false });

    await asMaintenance(db);
    const row = (await db.query<{ status: string; cancelled_by: string; cancelled_at: Date | null }>(`select status, cancelled_by, cancelled_at from public.bookings where id = $1`, [booking.id])).rows[0];
    expect(row).toMatchObject({ status: "cancelled", cancelled_by: "client" });
    expect(row.cancelled_at).not.toBeNull();
    const history = (await db.query<{ kind: string; actor: string; payload: Record<string, unknown> }>(`select kind, actor, payload from public.booking_events where booking_id = $1 order by created_at`, [booking.id])).rows;
    expect(history.map((h) => [h.kind, h.actor])).toEqual([
      ["held", "client"],
      ["confirmed", "client"],
      ["cancelled", "client"],
    ]);
    expect(history[2].payload).toMatchObject({ late: false, notice_min: 60 });

    const events = await outboxTypes(booking.id);
    const cancelled = events.find((e) => e.event_type === "booking.cancelled");
    expect(cancelled?.idempotency_key).toBe(`booking-cancelled-email:${booking.id}`);
    expect(cancelled?.payload).toMatchObject({ booking_id: booking.id, cancelled_by: "client", late: false });
    expect(events.find((e) => e.event_type === "booking.cancelled_by_client")?.payload).toMatchObject({ booking_id: booking.id, late: false });

    // EM16c goes to the client, and knows the client cancelled.
    const mail = await prepareMail("booking.cancelled", ctx.orgId);
    expect(mail.action).toBe("send");
    expect(mail.messages[0]).toMatchObject({ to: ctx.client.email, template: "consultation_cancelled" });
    expect(mail.messages[0].context).toMatchObject({ cancelled_by: "client", portal: true, time_zone: "America/Vancouver" });

    // The host and the owner see "<client> cancelled <title>, <when>"; an assistant who is not the host does not.
    for (const who of [ctx.host.id, ctx.owner.id]) {
      const item = (await notices(who, ctx.orgId)).find((i) => i.kind === "booking_cancelled");
      expect(item, who).toMatchObject({ actor_name: "Synthetic Client", subject: "Package review call", href: "/sheet/consultations" });
      expect(item?.detail).toMatch(/^\d{4}-\d{2}-\d{2}T10:00$/);
    }
    const assistant = await createUser("assistant");
    await membership(ctx.orgId, assistant.id, "assistant");
    expect((await notices(assistant.id, ctx.orgId)).some((i) => i.kind === "booking_cancelled")).toBe(false);

    await asMaintenance(db);
    const audit = (await db.query<{ context: Record<string, unknown>; actor_user_id: string }>(`select context, actor_user_id from public.audit_log where action = 'booking.cancelled' and object_id = $1`, [booking.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_user_id: ctx.client.id, context: { by: "client", late: false } });
  });

  it("inside the minimum notice the call is still cancelled, recorded late", async () => {
    const ctx = await firm();
    const booking = await book(ctx, await localStart(5));
    await asMaintenance(db);
    // The firm raises the notice after the booking was made; cancelling now is inside it.
    await db.query(`update public.booking_event_types set min_notice_min = 525600 where id = $1`, [ctx.typeId]);
    await asUser(db, client(ctx.client.id, ctx.orgId));
    const result = (await db.query<{ r: { late: boolean } }>(`select public.portal_cancel_booking($1, $2, null, 'Something came up') as r`, [ctx.orgId, booking.id])).rows[0].r;
    expect(result).toEqual({ late: true });
    await asMaintenance(db);
    expect((await db.query<{ cancel_reason: string }>(`select cancel_reason from public.bookings where id = $1`, [booking.id])).rows[0].cancel_reason).toBe("Something came up");
    expect((await outboxTypes(booking.id)).find((e) => e.event_type === "booking.cancelled")?.payload).toMatchObject({ late: true });
    expect((await notices(ctx.host.id, ctx.orgId)).find((i) => i.kind === "booking_cancelled")).toBeTruthy();
  });

  it("refuses another client, the firm's staff, another firm and a stale version", async () => {
    const ctx = await firm();
    const booking = await book(ctx, await localStart(6));
    const cancel = (version: number | null) => db.query(`select public.portal_cancel_booking($1, $2, $3, null)`, [ctx.orgId, booking.id, version]);

    // Another client of the same firm.
    const other = await createUser("other", "Other Client");
    await membership(ctx.orgId, other.id, "client");
    await asMaintenance(db);
    await db.query(`insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Other Client', $3)`, [ctx.orgId, other.id, other.email]);
    await asUser(db, client(other.id, ctx.orgId));
    await expectDbError(() => cancel(null), /booking access denied/);
    // Staff use the staff function, not this one.
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    await expectDbError(() => cancel(null), /booking access denied/);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await expectDbError(() => cancel(null), /booking access denied/);
    // The client of another firm, even with the workspace pointed here.
    const elsewhere = await firm();
    await asUser(db, client(elsewhere.client.id, ctx.orgId));
    await expectDbError(() => cancel(null), /booking access denied/);
    // A stale version.
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await expectDbError(() => cancel(booking.version + 3), /changed by someone else/);
    await asMaintenance(db);
    expect((await db.query<{ status: string }>(`select status from public.bookings where id = $1`, [booking.id])).rows[0].status).toBe("confirmed");
    expect((await outboxTypes(booking.id)).map((e) => e.event_type)).toEqual(["booking.confirmed"]);
  });

  it("a cancelled or past call cannot be cancelled again", async () => {
    const ctx = await firm();
    const booking = await book(ctx, await localStart(7));
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await db.query(`select public.portal_cancel_booking($1, $2, null, null)`, [ctx.orgId, booking.id]);
    await expectDbError(() => db.query(`select public.portal_cancel_booking($1, $2, null, null)`, [ctx.orgId, booking.id]), /only an upcoming confirmed booking/);
    // The in-app notice and the email are queued once.
    expect((await outboxTypes(booking.id)).map((e) => e.event_type).sort()).toEqual(["booking.cancelled", "booking.cancelled_by_client", "booking.confirmed"]);
  });

  it("a sample booking is cancelled with the staff notice but no email", async () => {
    const ctx = await firm();
    const booking = await book(ctx, await localStart(8));
    await asMaintenance(db);
    await db.query(`update public.bookings set is_sample = true where id = $1`, [booking.id]);
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await db.query(`select public.portal_cancel_booking($1, $2, null, null)`, [ctx.orgId, booking.id]);
    const events = (await outboxTypes(booking.id)).map((e) => e.event_type).sort();
    expect(events).toEqual(["booking.cancelled_by_client", "booking.confirmed"]);
    expect((await notices(ctx.owner.id, ctx.orgId)).find((i) => i.kind === "booking_cancelled")).toBeTruthy();
  });
});

describe("portal appointments: reschedule", () => {
  it("the client moves their own call: same reference, SEQUENCE + 1, their zone, EM16b and the staff notice", async () => {
    const ctx = await firm();
    const first = await localStart(9);
    const booking = await book(ctx, first);
    const moved = await localStart(9, "14:00");

    await asUser(db, client(ctx.client.id, ctx.orgId));
    await db.query(`select public.portal_reschedule_booking($1, $2, $3::timestamptz, 'Asia/Kolkata', $4)`, [ctx.orgId, booking.id, moved, booking.version]);

    await asMaintenance(db);
    const after = (
      await db.query<{ ics_sequence: number; starts_at: Date; status: string; attendee_time_zone: string; version: number }>(
        `select ics_sequence, starts_at, status, attendee_time_zone, version from public.bookings where id = $1`,
        [booking.id],
      )
    ).rows[0];
    expect(after).toMatchObject({ ics_sequence: 1, status: "confirmed", attendee_time_zone: "Asia/Kolkata" });
    expect(new Date(after.starts_at).toISOString()).toBe(new Date(moved).toISOString());
    expect(after.version).toBeGreaterThan(booking.version);
    expect((await db.query<{ time_zone: string }>(`select time_zone from public.booking_attendees where booking_id = $1 and role = 'primary'`, [booking.id])).rows[0].time_zone).toBe("Asia/Kolkata");
    const history = (await db.query<{ kind: string; actor: string; payload: Record<string, unknown> }>(`select kind, actor, payload from public.booking_events where booking_id = $1 order by created_at`, [booking.id])).rows;
    expect(history[2]).toMatchObject({ kind: "rescheduled", actor: "client", payload: { sequence: 1 } });

    const events = await outboxTypes(booking.id);
    expect(events.find((e) => e.event_type === "booking.rescheduled")?.idempotency_key).toBe(`booking-rescheduled-email:${booking.id}:1`);
    expect(events.find((e) => e.event_type === "booking.rescheduled_by_client")?.payload).toMatchObject({ booking_id: booking.id, sequence: 1 });

    // EM16b in the zone the client chose.
    const mail = await prepareMail("booking.rescheduled", ctx.orgId);
    expect(mail.action).toBe("send");
    expect(mail.messages[0]).toMatchObject({ to: ctx.client.email, template: "consultation_rescheduled" });
    expect(mail.messages[0].context).toMatchObject({ time_zone: "Asia/Kolkata", portal: true });

    // "<client> moved <title> to <when>" for the host and the owner, at the new time.
    for (const who of [ctx.host.id, ctx.owner.id]) {
      const item = (await notices(who, ctx.orgId)).find((i) => i.kind === "booking_rescheduled");
      expect(item, who).toMatchObject({ actor_name: "Synthetic Client", subject: "Package review call" });
      expect(item?.detail).toMatch(/^\d{4}-\d{2}-\d{2}T14:00$/);
    }

    // The old time is free again: another client can book it.
    const other = await createUser("other", "Other Client");
    await membership(ctx.orgId, other.id, "client");
    await asMaintenance(db);
    await db.query(`insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Other Client', $3)`, [ctx.orgId, other.id, other.email]);
    await expect(book(ctx, first, { as: other })).resolves.toBeTruthy();
  });

  it("holds the client to the minimum notice and the booking window, and keeps the host free of double bookings", async () => {
    const ctx = await firm({ notice: 2880 });
    const booking = await book(ctx, await localStart(10));
    const move = (start: string, version: number | null = null) =>
      db.query(`select public.portal_reschedule_booking($1, $2, $3::timestamptz, 'America/Toronto', $4)`, [ctx.orgId, booking.id, start, version]);

    const soon = await localStart(1, "15:00");
    const far = await localStart(20, "15:00");
    const evening = await localStart(11, "20:00");
    const offStep = await localStart(11, "10:07");
    const same = await localStart(10);
    const free = await localStart(11, "13:00");
    // Inside 48 hours: staff could, a client cannot.
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await expectDbError(() => move(soon), /slot_unavailable/);
    // Past the 14-day window.
    await expectDbError(() => move(far), /slot_unavailable/);
    // Off the host's hours and off the step.
    await expectDbError(() => move(evening), /slot_unavailable/);
    await expectDbError(() => move(offStep), /slot_unavailable/);
    // Taken by another booking of the same host.
    const other = await createUser("other", "Other Client");
    await membership(ctx.orgId, other.id, "client");
    await asMaintenance(db);
    await db.query(`insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Other Client', $3)`, [ctx.orgId, other.id, other.email]);
    const taken = await localStart(11, "11:00");
    await book(ctx, taken, { as: other });
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await expectDbError(() => move(taken), /slot_unavailable/);
    // The same time is not a move.
    await expectDbError(() => move(same), /slot_unavailable/);
    // A stale version.
    await expectDbError(() => move(free, booking.version + 1), /changed by someone else/);
    // Nothing moved.
    await asMaintenance(db);
    expect((await db.query<{ ics_sequence: number }>(`select ics_sequence from public.bookings where id = $1`, [booking.id])).rows[0].ics_sequence).toBe(0);
    expect((await outboxTypes(booking.id)).map((e) => e.event_type)).toEqual(["booking.confirmed"]);
    // A free time inside the window works.
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await move(free, booking.version);
  });

  it("refuses another client, staff and a bad zone, and a sample booking moves without email", async () => {
    const ctx = await firm();
    const booking = await book(ctx, await localStart(12));
    const target = await localStart(12, "15:00");
    const move = () => db.query(`select public.portal_reschedule_booking($1, $2, $3::timestamptz, 'America/Toronto', null)`, [ctx.orgId, booking.id, target]);
    const other = await createUser("other", "Other Client");
    await membership(ctx.orgId, other.id, "client");
    await asMaintenance(db);
    await db.query(`insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Other Client', $3)`, [ctx.orgId, other.id, other.email]);
    await asUser(db, client(other.id, ctx.orgId));
    await expectDbError(move, /booking access denied/);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await expectDbError(move, /booking access denied/);
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.portal_reschedule_booking($1, $2, $3::timestamptz, 'Mars/Olympus', null)`, [ctx.orgId, booking.id, target]), /choose a time zone/);

    await asMaintenance(db);
    await db.query(`update public.bookings set is_sample = true where id = $1`, [booking.id]);
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await move();
    expect((await outboxTypes(booking.id)).map((e) => e.event_type).sort()).toEqual(["booking.confirmed", "booking.rescheduled_by_client"]);
  });

  it("staff_reschedule_booking still moves a booking without the notice check, as staff", async () => {
    const ctx = await firm({ notice: 2880 });
    const booking = await book(ctx, await localStart(13));
    const soon = await localStart(1, "15:00");
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await db.query(`select public.staff_reschedule_booking($1, $2, $3::timestamptz, $4)`, [ctx.orgId, booking.id, soon, booking.version]);
    await asMaintenance(db);
    const history = (await db.query<{ kind: string; actor: string }>(`select kind, actor from public.booking_events where booking_id = $1 order by created_at`, [booking.id])).rows;
    expect(history[2]).toMatchObject({ kind: "rescheduled", actor: "staff" });
    expect((await outboxTypes(booking.id)).map((e) => e.event_type).sort()).toEqual(["booking.confirmed", "booking.rescheduled"]);
    const audit = (await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where action = 'booking.rescheduled' and object_id = $1`, [booking.id])).rows[0];
    expect(audit.context).toMatchObject({ by: "staff" });
  });
});

describe("portal appointments: free times and rules", () => {
  it("gives the client the booking's host only, without ids, in the shape the slot library reads", async () => {
    const ctx = await firm();
    // A second host of the type: never offered for a move (the host stays).
    const second = await createUser("host2", "Second Host");
    const secondMembership = await membership(ctx.orgId, second.id, "licensed_consultant");
    await asUser(db, staff(second.id, ctx.orgId));
    await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [ctx.orgId, secondMembership, TZ, JSON.stringify(EVERY_DAY)]);
    await asMaintenance(db);
    const version = (await db.query<{ version: number }>(`select version from public.booking_event_types where id = $1`, [ctx.typeId])).rows[0].version;
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    await db.query(
      `select public.save_booking_event_type($1, $2, $3, 'Package review call', 'review', null, 30, null, 0, 0, 60, 14, null,
         'meeting_link'::public.booking_location_kind, 'https://meet.example.test/room', $4::uuid[], true)`,
      [ctx.orgId, ctx.typeId, version, [ctx.hostMembership, secondMembership]],
    );
    const booking = await book(ctx, await localStart(3));

    await asUser(db, client(ctx.client.id, ctx.orgId));
    const payload = (
      await db.query<{ a: { event: Record<string, unknown>; hosts: Record<string, unknown>[]; now: string } }>(
        `select public.portal_booking_availability($1, $2, now(), now() + interval '14 days') as a`,
        [ctx.orgId, booking.id],
      )
    ).rows[0].a;
    expect(payload.event).toMatchObject({ duration_min: 30, min_notice_min: 60, max_advance_days: 14 });
    expect(payload.hosts).toHaveLength(1);
    expect(payload.hosts[0]).not.toHaveProperty("membership_id");
    expect(JSON.stringify(payload)).not.toMatch(/Synthetic|@example|title/);
    const parsed = parseAvailability(payload);
    expect(parsed).not.toBeNull();
    const now = Date.now();
    const starts = slotsFromAvailability(parsed!, { fromUtc: now, toUtc: now + 14 * 86_400_000, nowUtc: now });
    expect(starts.length).toBeGreaterThan(10);
    // The booking's own time is excluded from busy, so it is offered (the move refuses it anyway).
    expect(starts).toContain(Date.parse(await localStart(3)));

    // Another client, staff and a stranger are refused.
    const other = await createUser("other", "Other Client");
    await membership(ctx.orgId, other.id, "client");
    await asUser(db, client(other.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.portal_booking_availability($1, $2, now(), now() + interval '14 days')`, [ctx.orgId, booking.id]), /booking access denied/);
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.portal_booking_availability($1, $2, now(), now() + interval '14 days')`, [ctx.orgId, booking.id]), /booking access denied/);
  });

  it("portal_booking_rules lists the client's own upcoming calls with the notice and whether cancelling is late", async () => {
    const ctx = await firm();
    const booking = await book(ctx, await localStart(4));
    await asUser(db, client(ctx.client.id, ctx.orgId));
    let rules = (await db.query<{ r: Record<string, { min_notice_min: number; late: boolean }> }>(`select public.portal_booking_rules($1) as r`, [ctx.orgId])).rows[0].r;
    expect(rules).toEqual({ [booking.id]: { min_notice_min: 60, late: false } });
    await asMaintenance(db);
    await db.query(`update public.booking_event_types set min_notice_min = 525600 where id = $1`, [ctx.typeId]);
    await asUser(db, client(ctx.client.id, ctx.orgId));
    rules = (await db.query<{ r: Record<string, { min_notice_min: number; late: boolean }> }>(`select public.portal_booking_rules($1) as r`, [ctx.orgId])).rows[0].r;
    expect(rules[booking.id]).toEqual({ min_notice_min: 525600, late: true });
    // Nobody else sees anything.
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    expect((await db.query<{ r: unknown }>(`select public.portal_booking_rules($1) as r`, [ctx.orgId])).rows[0].r).toEqual({});
    const other = await createUser("other", "Other Client");
    await membership(ctx.orgId, other.id, "client");
    await asUser(db, client(other.id, ctx.orgId));
    expect((await db.query<{ r: unknown }>(`select public.portal_booking_rules($1) as r`, [ctx.orgId])).rows[0].r).toEqual({});
  });
});
