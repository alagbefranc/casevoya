import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { publishTestPrivacyNotice } from "./helpers/privacy-notice";

// CRM-03 Manage your booking (20261024160000_booking_manage_link.sql): a token link for a booker
// without a portal, to see, move or cancel their consultation. The helpers are the scheduling
// tests'. Everything here is synthetic.

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

const owner = (ctx: { orgId: string; owner: { id: string } }) => ({ userId: ctx.owner.id, aal: "aal2" as const, orgId: ctx.orgId, totpAgeSeconds: 0 });

async function firm(options: { sample?: boolean; hosts?: number } = {}) {
  const ownerUser = await createUser("owner", "Synthetic Owner");
  await asUser(db, { userId: ownerUser.id, aal: "aal2", totpAgeSeconds: 0 });
  const firmSlug = slug();
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", firmSlug]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  if (!options.sample) await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  // #263-A: booking pages need the firm's published privacy notice.
  await publishTestPrivacyNotice(db, orgId);
  const hosts: { user: { id: string; email: string }; membershipId: string }[] = [];
  for (let i = 0; i < (options.hosts ?? 1); i++) {
    const user = await createUser(`host${i}`, `Synthetic Host ${i + 1}`);
    hosts.push({ user, membershipId: await membership(orgId, user.id, "licensed_consultant") });
  }
  const ctx = { orgId, firmSlug, owner: ownerUser, hosts };
  for (const host of hosts) {
    await asUser(db, { userId: host.user.id, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [orgId, host.membershipId, TZ, JSON.stringify(EVERY_DAY)]);
  }
  return ctx;
}

type Ctx = Awaited<ReturnType<typeof firm>>;

async function eventType(
  ctx: Ctx,
  options: { publish?: boolean; capacity?: number | null; slug?: string; notice?: number; kind?: string; detail?: string | null } = {},
) {
  await asUser(db, owner(ctx));
  const row = await db.query<{ id: string }>(
    `select public.save_booking_event_type($1, null, null, 'Initial consultation', $2, null, 30, null, 15, 15, $3, 60, $4,
       $7::public.booking_location_kind, $8, $5::uuid[], $6) as id`,
    [
      ctx.orgId,
      options.slug ?? "initial",
      options.notice ?? 60,
      options.capacity ?? null,
      ctx.hosts.map((h) => h.membershipId),
      options.publish ?? true,
      options.kind ?? "video",
      options.detail ?? null,
    ],
  );
  return row.rows[0].id;
}

/** 10:00 Toronto (or another local time), `days` days from today. */
async function localStart(days: number, time = "10:00"): Promise<string> {
  await asMaintenance(db);
  const row = await db.query<{ at: string }>(
    `select to_char(app.local_instant((now() at time zone $1)::date + $2::integer, $3::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
    [TZ, days, time],
  );
  return row.rows[0].at;
}

type Summary = { public_ref: string; status: string; starts_at: string; time_zone: string; title: string; firm_name: string; location_detail: string | null; practice: boolean };

async function hold(
  ctx: Ctx,
  start: string,
  options: { email?: string; key?: string; hash?: string | null; event?: string; as?: string; session?: Parameters<typeof asUser>[1] } = {},
) {
  if (options.session) await asUser(db, options.session);
  else if (options.as) await asUser(db, { userId: options.as, aal: "aal1" });
  else await asAnon(db);
  const row = await db.query<{ result: Summary & { error?: string } }>(
    `select public.booking_public_hold($1, $2, $3::timestamptz, 'Sam Example', $4, null, 'America/Vancouver', $5, $6) as result`,
    [ctx.firmSlug, options.event ?? "initial", start, options.email ?? "sam@example.test", options.key ?? randomUUID(), options.hash === undefined ? null : options.hash],
  );
  const result = row.rows[0].result;
  // Refusals come back as {error}; tests treat them like thrown errors.
  if (result.error) throw new Error(result.error);
  return result;
}


async function confirmedDelivery(ctx: Ctx, ref: string): Promise<string> {
  await asServiceRole(db);
  const claimed = (await db.query<{ c: { id: string; event_type: string; payload: Record<string, unknown> }[] }>(`select public.claim_mail_events('test-worker', 50) as c`)).rows[0].c;
  await asMaintenance(db);
  const booking = (await db.query<{ id: string }>(`select id from public.bookings where public_ref = $1`, [ref])).rows[0].id;
  const event = claimed.find((row) => row.event_type === "booking.confirmed" && row.payload.booking_id === booking);
  if (!event) throw new Error("no booking.confirmed event");
  await asServiceRole(db);
  const prepared = (await db.query<{ p: { messages: { delivery_id: string; template: string }[] } }>(`select public.prepare_email_delivery($1, 'test-worker') as p`, [event.id])).rows[0].p;
  return prepared.messages[0].delivery_id;
}

const sha = (token: string) => createHash("sha256").update(token).digest("hex");

describe("Manage your booking (CRM-03)", () => {
  it("issues a token for the confirmation to a booker without a portal, and opens the booking with it only", async () => {
    const ctx = await firm();
    await eventType(ctx, { notice: 0 });
    const summary = await hold(ctx, await localStart(5));
    const delivery = await confirmedDelivery(ctx, summary.public_ref);
    const token = randomUUID() + randomUUID();
    await asServiceRole(db);
    const ref = (await db.query<{ r: string | null }>(`select public.issue_booking_manage_token($1, $2) as r`, [delivery, sha(token)])).rows[0].r;
    expect(ref).toBe(summary.public_ref);
    await asAnon(db);
    await expectDbError(() => db.query(`select public.issue_booking_manage_token($1, $2)`, [delivery, sha(token)]), /permission denied|worker role/);
    const view = (await db.query<{ v: Record<string, unknown> | null }>(`select public.booking_manage_view($1, $2) as v`, [ref, sha(token)])).rows[0].v;
    expect(view).toMatchObject({ ref, firm_name: "Synthetic Firm", title: "Initial consultation", status: "confirmed", upcoming: true });
    expect((await db.query<{ v: unknown }>(`select public.booking_manage_view($1, $2) as v`, [ref, sha("wrong-token")])).rows[0].v).toBeNull();
    // A newer email's token replaces this one.
    await asServiceRole(db);
    await db.query(`select public.issue_booking_manage_token($1, $2)`, [delivery, sha(token + "x")]);
    await asAnon(db);
    expect((await db.query<{ v: unknown }>(`select public.booking_manage_view($1, $2) as v`, [ref, sha(token)])).rows[0].v).toBeNull();
  });

  it("moves the booking within the type's rules, then cancels it with a reason; the link then stops working", async () => {
    const ctx = await firm();
    await eventType(ctx, { notice: 0 });
    const summary = await hold(ctx, await localStart(5));
    const delivery = await confirmedDelivery(ctx, summary.public_ref);
    const token = randomUUID() + randomUUID();
    await asServiceRole(db);
    const ref = (await db.query<{ r: string }>(`select public.issue_booking_manage_token($1, $2) as r`, [delivery, sha(token)])).rows[0].r;
    await asAnon(db);
    const view = (await db.query<{ v: { version: number } }>(`select public.booking_manage_view($1, $2) as v`, [ref, sha(token)])).rows[0].v;
    const availability = (await db.query<{ a: { hosts: unknown[] } }>(`select public.booking_manage_availability($1, $2, now(), now() + interval '14 days') as a`, [ref, sha(token)])).rows[0].a;
    expect(availability.hosts).toHaveLength(1);
    const later = await localStart(6, "11:00");
    await asAnon(db);
    await db.query(`select public.booking_manage_reschedule($1, $2, $3::timestamptz, 'America/Vancouver', $4)`, [ref, sha(token), later, view.version]);
    await asMaintenance(db);
    const moved = (await db.query<{ starts_at: string; status: string }>(`select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as starts_at, status from public.bookings where public_ref = $1`, [ref])).rows[0];
    expect(moved).toEqual({ starts_at: later, status: "confirmed" });
    const used = await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where action = 'booking.manage_link_used' and organization_id = $1`, [ctx.orgId]);
    expect(used.rows.map((row) => row.context.action)).toEqual(["rescheduled"]);

    await asAnon(db);
    const again = (await db.query<{ v: { version: number } }>(`select public.booking_manage_view($1, $2) as v`, [ref, sha(token)])).rows[0].v;
    await expectDbError(() => db.query(`select public.booking_manage_cancel($1, $2, $3, '')`, [ref, sha(token), again.version]), /say why/);
    await db.query(`select public.booking_manage_cancel($1, $2, $3, 'Found another firm')`, [ref, sha(token), again.version]);
    await asMaintenance(db);
    const cancelled = (await db.query<{ status: string; cancelled_by: string; cancel_reason: string }>(`select status, cancelled_by::text, cancel_reason from public.bookings where public_ref = $1`, [ref])).rows[0];
    expect(cancelled).toEqual({ status: "cancelled", cancelled_by: "client", cancel_reason: "Found another firm" });
    const events = await db.query<{ kind: string; actor: string; payload: Record<string, unknown> }>(`select kind, actor::text, payload from public.booking_events where booking_id = (select id from public.bookings where public_ref = $1) and kind = 'cancelled'`, [ref]);
    expect(events.rows[0]).toMatchObject({ actor: "client", payload: { via: "manage_link" } });
    await asAnon(db);
    expect((await db.query<{ v: unknown }>(`select public.booking_manage_view($1, $2) as v`, [ref, sha(token)])).rows[0].v).toBeNull();
  });

  it("gives no link for a booker with a portal login", async () => {
    const ctx = await firm();
    await eventType(ctx, { notice: 0 });
    const summary = await hold(ctx, await localStart(7));
    await asMaintenance(db);
    const client = await createUser("client");
    const person = (await db.query<{ id: string }>(`insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Sam Example', 'sam@example.test') returning id`, [ctx.orgId, client.id])).rows[0].id;
    await db.query(`update public.booking_attendees set person_id = $1 where booking_id = (select id from public.bookings where public_ref = $2)`, [person, summary.public_ref]);
    const delivery = await confirmedDelivery(ctx, summary.public_ref);
    await asServiceRole(db);
    expect((await db.query<{ r: string | null }>(`select public.issue_booking_manage_token($1, $2) as r`, [delivery, sha("t".repeat(40))])).rows[0].r).toBeNull();
  });
});

describe("joining the video call with the Manage token (CRM-03)", () => {
  async function tokenFor(startDays: number, time = "10:00") {
    const ctx = await firm();
    await eventType(ctx, { notice: 0 });
    const summary = await hold(ctx, await localStart(startDays, time));
    const delivery = await confirmedDelivery(ctx, summary.public_ref);
    const token = randomUUID() + randomUUID();
    await asServiceRole(db);
    await db.query(`select public.issue_booking_manage_token($1, $2)`, [delivery, sha(token)]);
    return { ctx, ref: summary.public_ref, token };
  }

  it("says early before the window, and refuses a wrong token", async () => {
    const { ref, token } = await tokenFor(5);
    await asAnon(db);
    const view = (await db.query<{ v: { state: string; role: string; booked_name: string } }>(`select public.video_join_guest($1, $2, false) as v`, [ref, sha(token)])).rows[0].v;
    expect(view).toMatchObject({ state: "early", role: "client", booked_name: "Sam Example" });
    await expectDbError(() => db.query(`select public.video_join_guest($1, $2, false)`, [ref, sha("nope")]), /call access denied/);
  });

  it("inside the window gives a lobby grant under the confirmed name, as client:<booking id>", async () => {
    const { ref, token } = await tokenFor(5);
    await asMaintenance(db);
    // Move the booking to start in five minutes (inside the 15-minute window).
    await db.query(
      `update public.bookings set starts_at = now() + interval '5 minutes', ends_at = now() + interval '35 minutes',
         blocked_from = now() + interval '5 minutes', blocked_until = now() + interval '35 minutes' where public_ref = $1`,
      [ref],
    );
    await asAnon(db);
    const grant = (await db.query<{ v: Record<string, unknown> }>(`select public.video_join_guest($1, $2, true, ' Sam E. ') as v`, [ref, sha(token)])).rows[0].v;
    await asMaintenance(db);
    const id = (await db.query<{ id: string }>(`select id from public.bookings where public_ref = $1`, [ref])).rows[0].id;
    expect(grant).toMatchObject({ state: "open", identity: `client:${id}`, name: "Sam E.", admitted: false });
    const part = await db.query<{ user_id: string | null; role: string }>(`select user_id, role from public.video_participants where identity = $1`, [`client:${id}`]);
    expect(part.rows[0]).toEqual({ user_id: null, role: "client" });
  });
});
