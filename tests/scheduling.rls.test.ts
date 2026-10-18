import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, countOf, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// Scheduling (20261019180000_scheduling_enums, 20261019180100_scheduling_core,
// 20261019180200_scheduling_mail): RLS, the no-double-booking exclusion constraint, the public
// booking functions and the EM16 mail events. Everything here is synthetic.

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

describe("scheduling: public booking page", () => {
  it("shows a published free type and busy ranges with no names, emails or ids", async () => {
    const ctx = await firm({ hosts: 2 });
    const typeId = await eventType(ctx);
    const start = await localStart(3);
    await hold(ctx, start);

    await asAnon(db);
    const event = (await db.query<{ e: Record<string, unknown> }>(`select public.booking_public_event($1, 'initial') as e`, [ctx.firmSlug])).rows[0].e;
    expect(event).toMatchObject({ title: "Initial consultation", duration_min: 30, price_cents: 0, firm_name: "Synthetic Firm", location_kind: "video" });
    const busy = (await db.query<{ b: { hosts: Record<string, unknown>[] } }>(
      `select public.booking_public_busy($1, now(), now() + interval '30 days') as b`,
      [typeId],
    )).rows[0].b;
    expect(busy.hosts).toHaveLength(2);
    const text = JSON.stringify(busy);
    expect(text).not.toMatch(/sam@example|Sam Example|Synthetic Host|membership_id|user_id/);
    expect(text).not.toContain(ctx.hosts[0].membershipId);
    expect((busy.hosts[0].busy as unknown[]).length).toBe(1);
    expect(busy.hosts[0]).toMatchObject({ time_zone: TZ });

    const list = (await db.query<{ l: { types: unknown[] } }>(`select public.booking_public_event_types($1) as l`, [ctx.firmSlug])).rows[0].l;
    expect(list.types).toHaveLength(1);
  });

  it("anonymous visitors cannot read any scheduling table", async () => {
    await asAnon(db);
    for (const table of ["bookings", "booking_attendees", "booking_event_types", "availability_rules", "booking_events", "booking_hold_attempts"]) {
      await expectDbError(() => db.query(`select count(*) from public.${table}`), /permission denied/);
    }
  });

  it("books a free consultation: confirmed at once, history, audit and the EM16a outbox event", async () => {
    const ctx = await firm();
    await eventType(ctx);
    const start = await localStart(4);
    const summary = await hold(ctx, start);
    expect(summary.status).toBe("confirmed");
    expect(summary.public_ref).toMatch(/^[a-z2-7]{26}$/);
    expect(summary.time_zone).toBe("America/Vancouver");
    await asMaintenance(db);
    const booking = (await db.query<{ id: string; status: string; source: string; host_time_zone: string; ends_at: string; blocked_from: string }>(
      `select id, status, source, host_time_zone, ends_at, blocked_from from public.bookings where public_ref = $1`,
      [summary.public_ref],
    )).rows[0];
    expect(booking).toMatchObject({ status: "confirmed", source: "public", host_time_zone: TZ });
    const kinds = (await db.query<{ kind: string }>(`select kind from public.booking_events where booking_id = $1 order by created_at`, [booking.id])).rows.map((r) => r.kind);
    expect(kinds).toEqual(["held", "confirmed"]);
    const outbox = await db.query<{ event_type: string; payload: Record<string, unknown> }>(`select event_type, payload from public.outbox_events where aggregate_id = $1`, [booking.id]);
    expect(outbox.rows.map((r) => r.event_type)).toEqual(["booking.confirmed"]);
    expect(Object.keys(outbox.rows[0].payload).sort()).toEqual(["booking_id", "starts_at"]);
    const audit = await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'booking.confirmed'`, [booking.id]);
    expect(audit.rows).toHaveLength(1);
  });

  it("never gives the same host's time twice: a second booking at an overlapping start is refused", async () => {
    const ctx = await firm();
    await eventType(ctx);
    const start = await localStart(5);
    await hold(ctx, start);
    await expectDbError(() => hold(ctx, start, { email: "other@example.test" }), /slot_unavailable/);
    // 10:30 starts right after the first meeting, but the buffers (15 minutes each side) overlap.
    const close = await localStart(5, "10:30");
    await expectDbError(() => hold(ctx, close, { email: "other@example.test" }), /slot_unavailable/);
  });

  it("concurrent requests for one slot allocate it once (PRD CRM-03)", async () => {
    const ctx = await firm();
    await eventType(ctx);
    const start = await localStart(6);
    await asAnon(db);
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        db.query<{ r: { status?: string; error?: string } }>(`select public.booking_public_hold($1, 'initial', $2::timestamptz, 'Person', $3, null, 'UTC', $4, null) as r`, [
          ctx.firmSlug,
          start,
          `p${i}@example.test`,
          randomUUID(),
        ]),
      ),
    );
    const results = attempts.map((a) => a.rows[0].r);
    expect(results.filter((r) => r.status === "confirmed")).toHaveLength(1);
    expect(results.filter((r) => r.error === "slot_unavailable")).toHaveLength(4);
    await asMaintenance(db);
    const live = await db.query(`select 1 from public.bookings where organization_id = $1 and status = 'confirmed'`, [ctx.orgId]);
    expect(live.rows).toHaveLength(1);
  });

  it("the exclusion constraint itself rejects an overlapping live row, whoever writes it", async () => {
    const ctx = await firm();
    const typeId = await eventType(ctx);
    const start = await localStart(7);
    await hold(ctx, start);
    await asMaintenance(db);
    const host = ctx.hosts[0];
    await expectDbError(
      () =>
        db.query(
          `insert into public.bookings (organization_id, public_ref, event_type_id, host_membership_id, host_user_id, title, starts_at, ends_at,
             blocked_from, blocked_until, host_time_zone, attendee_time_zone, location_kind, status, confirmed_at, source, idempotency_key)
           values ($1, app.booking_public_ref(), $2, $3, $4, 'Direct', $5::timestamptz + interval '20 minutes', $5::timestamptz + interval '50 minutes',
             $5::timestamptz + interval '20 minutes', $5::timestamptz + interval '50 minutes', $6, $6, 'video', 'confirmed', now(), 'staff', $7)`,
          [ctx.orgId, typeId, host.membershipId, host.user.id, start, TZ, randomUUID()],
        ),
      /bookings_no_double_booking|exclusion/,
    );
  });

  it("gives the next host the slot when the first is booked", async () => {
    const ctx = await firm({ hosts: 2 });
    await eventType(ctx);
    const start = await localStart(8);
    await hold(ctx, start);
    await hold(ctx, start, { email: "second@example.test" });
    await expectDbError(() => hold(ctx, start, { email: "third@example.test" }), /slot_unavailable/);
    await asMaintenance(db);
    const hosts = await db.query<{ host_membership_id: string }>(`select host_membership_id from public.bookings where organization_id = $1 order by host_membership_id`, [ctx.orgId]);
    expect(new Set(hosts.rows.map((r) => r.host_membership_id)).size).toBe(2);
  });

  it("an expired hold frees its range", async () => {
    const ctx = await firm();
    const typeId = await eventType(ctx);
    const start = await localStart(9);
    await asMaintenance(db);
    const host = ctx.hosts[0];
    const stale = await db.query<{ id: string }>(
      `insert into public.bookings (organization_id, public_ref, event_type_id, host_membership_id, host_user_id, title, starts_at, ends_at,
         blocked_from, blocked_until, host_time_zone, attendee_time_zone, location_kind, status, hold_expires_at, source, idempotency_key)
       values ($1, app.booking_public_ref(), $2, $3, $4, 'Held', $5::timestamptz, $5::timestamptz + interval '30 minutes',
         $5::timestamptz, $5::timestamptz + interval '30 minutes', $6, $6, 'video', 'held', now() - interval '1 minute', 'public', $7) returning id`,
      [ctx.orgId, typeId, host.membershipId, host.user.id, start, TZ, randomUUID()],
    );
    const summary = await hold(ctx, start);
    expect(summary.status).toBe("confirmed");
    await asMaintenance(db);
    expect((await db.query<{ status: string }>(`select status from public.bookings where id = $1`, [stale.rows[0].id])).rows[0].status).toBe("expired");
  });

  it("expire_booking_holds is for the service role only and expires run-out holds", async () => {
    const ctx = await firm();
    await eventType(ctx);
    await asUser(db, owner(ctx));
    await expectDbError(() => db.query(`select public.expire_booking_holds(now())`), /permission denied|worker role/);
    await asServiceRole(db);
    const n = await db.query<{ n: number }>(`select public.expire_booking_holds(now()) as n`);
    expect(countOf(n.rows[0].n)).toBeGreaterThanOrEqual(0);
  });

  it("a retry with the same key returns the same booking as it stands; a different start with that key is refused", async () => {
    const ctx = await firm();
    await eventType(ctx);
    const start = await localStart(10);
    const key = randomUUID();
    const first = await hold(ctx, start, { key });
    const again = await hold(ctx, start, { key });
    expect(again.public_ref).toBe(first.public_ref);
    expect(again.status).toBe("confirmed");
    await expectDbError(() => hold(ctx, start, { key, email: "else@example.test" }), /idempotency key reused/);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.bookings where organization_id = $1`, [ctx.orgId])).rows).toHaveLength(1);
  });

  it("refuses starts outside working hours, off the step, inside the notice, or past the booking window", async () => {
    const ctx = await firm();
    await eventType(ctx, { notice: 2 * 24 * 60 });
    await expectDbError(async () => hold(ctx, await localStart(3, "20:00")), /slot_unavailable/);
    await expectDbError(async () => hold(ctx, await localStart(3, "10:10")), /slot_unavailable/);
    await expectDbError(async () => hold(ctx, await localStart(1, "10:00")), /slot_unavailable/);
    await expectDbError(async () => hold(ctx, await localStart(80, "10:00")), /slot_unavailable/);
    expect((await hold(ctx, await localStart(3, "16:30"))).status).toBe("confirmed");
  });

  it("enforces a daily capacity per host", async () => {
    const ctx = await firm();
    await eventType(ctx, { capacity: 1 });
    await hold(ctx, await localStart(11, "10:00"));
    await expectDbError(async () => hold(ctx, await localStart(11, "14:00"), { email: "b@example.test" }), /slot_unavailable/);
    expect((await hold(ctx, await localStart(12, "14:00"), { email: "b@example.test" })).status).toBe("confirmed");
  });

  it("subtracts busy time from a connected calendar", async () => {
    const ctx = await firm();
    await eventType(ctx);
    const start = await localStart(13);
    await asMaintenance(db);
    await db.query(
      `insert into public.external_busy_blocks (organization_id, membership_id, source, starts_at, ends_at) values ($1, $2, 'manual', $3::timestamptz, $3::timestamptz + interval '1 hour')`,
      [ctx.orgId, ctx.hosts[0].membershipId, start],
    );
    await expectDbError(() => hold(ctx, start), /slot_unavailable/);
  });

  it("limits requests per client address", async () => {
    const ctx = await firm();
    await eventType(ctx);
    const hash = createHash("sha256").update(randomUUID()).digest("hex");
    const start = await localStart(14, "20:00"); // outside hours: each call fails after counting
    for (let i = 0; i < 8; i++) await expectDbError(() => hold(ctx, start, { hash }), /slot_unavailable/);
    await expectDbError(() => hold(ctx, start, { hash }), /booking_rate_limited/);
  });

  it("publishes a sample-mode firm's type as a sample row (a practice page); a paid type can never be published", async () => {
    const sampleFirm = await firm({ sample: true });
    const id = await eventType(sampleFirm);
    await asMaintenance(db);
    expect((await db.query<{ is_sample: boolean; is_published: boolean }>(`select is_sample, is_published from public.booking_event_types where id = $1`, [id])).rows[0]).toEqual({
      is_sample: true,
      is_published: true,
    });
    // A practice page is still free only.
    await expectDbError(() => db.query(`update public.booking_event_types set price_cents = 30000 where id = $1`, [id]), /booking_event_types_paid_not_published/);

    const ctx = await firm();
    const typeId = await eventType(ctx);
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.booking_event_types set price_cents = 30000 where id = $1`, [typeId]), /booking_event_types_paid_not_published/);
    await db.query(`update public.booking_event_types set is_published = false, price_cents = 30000 where id = $1`, [typeId]);
    await asAnon(db);
    expect((await db.query<{ e: unknown }>(`select public.booking_public_event($1, 'initial') as e`, [ctx.firmSlug])).rows[0].e).toBeNull();
  });

  it("only the firm owner with a step-up edits booking types; staff set their own hours", async () => {
    const ctx = await firm();
    const host = ctx.hosts[0];
    await asUser(db, { userId: host.user.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.save_booking_event_type($1, null, null, 'X', 'x', null, 30, null, 0, 0, 60, 30, null, 'video', null, $2::uuid[], false)`, [ctx.orgId, [host.membershipId]]),
      /step-up/,
    );
    await asUser(db, { userId: ctx.owner.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.save_availability($1, $2, $3, '[]'::jsonb, '[]'::jsonb)`, [ctx.orgId, host.membershipId, TZ]), /step-up/);
    await asUser(db, { userId: host.user.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[{"date":"2030-01-01","start":null,"end":null}]'::jsonb)`, [ctx.orgId, host.membershipId, TZ, JSON.stringify(EVERY_DAY)]);
    await expectDbError(() => db.query(`select public.save_availability($1, $2, 'Mars/Base', '[]'::jsonb, '[]'::jsonb)`, [ctx.orgId, host.membershipId]), /time zone/);
    await expectDbError(() => db.query(`select public.save_availability($1, $2, $3, '[{"weekday":1,"start":"17:00","end":"09:00"}]'::jsonb, '[]'::jsonb)`, [ctx.orgId, host.membershipId, TZ]), /end after its start/);
  });
});

describe("scheduling: practice booking pages (sample mode)", () => {
  const staffSession = (ctx: Ctx) => ({ userId: ctx.owner.id, aal: "aal2" as const, totpAgeSeconds: 0 });

  async function publicView(firmSlug: string, typeId: string) {
    const event = (await db.query<{ e: Record<string, unknown> | null }>(`select public.booking_public_event($1, 'initial') as e`, [firmSlug])).rows[0].e;
    const list = (await db.query<{ l: { types: Record<string, unknown>[] } | null }>(`select public.booking_public_event_types($1) as l`, [firmSlug])).rows[0].l;
    let busy: string;
    try {
      await db.query(`select public.booking_public_busy($1, now(), now() + interval '7 days')`, [typeId]);
      busy = "ok";
    } catch (error) {
      busy = error instanceof Error ? error.message : String(error);
    }
    return { event, types: list?.types ?? [], busy };
  }

  async function prepareMail(eventType: string, orgId: string) {
    await asServiceRole(db);
    const worker = `worker-${randomUUID().slice(0, 8)}`;
    const claimed = (await db.query<{ c: { id: string; event_type: string; organization_id: string }[] }>(`select public.claim_mail_events($1, 50) as c`, [worker])).rows[0].c;
    const event = claimed.find((row) => row.event_type === eventType && row.organization_id === orgId);
    expect(event, eventType).toBeTruthy();
    return (await db.query<{ p: { action: string; messages: { to: string; context: Record<string, unknown> }[] } }>(`select public.prepare_email_delivery($1, $2) as p`, [event!.id, worker])).rows[0].p;
  }

  it("hides a practice page from anonymous visitors, other firms, the firm's portal clients and staff without MFA, exactly like an unpublished page", async () => {
    const ctx = await firm({ sample: true });
    const typeId = await eventType(ctx);
    // An unpublished type is the baseline: what a visitor sees must be the same, so nothing leaks.
    const real = await firm();
    const hiddenId = await eventType(real, { publish: false });
    await asAnon(db);
    const unpublished = await publicView(real.firmSlug, hiddenId);
    expect(unpublished).toMatchObject({ event: null, types: [] });
    expect(unpublished.busy).toMatch(/booking type not found/);

    const other = await firm();
    const client = await createUser("client", "Synthetic Client");
    await membership(ctx.orgId, client.id, "client");
    await asMaintenance(db);
    await db.query(`insert into public.persons (organization_id, user_id, display_name, email, is_sample) values ($1, $2, 'Synthetic Client', $3, true)`, [
      ctx.orgId,
      client.id,
      client.email,
    ]);
    const viewers: [string, () => Promise<void>][] = [
      ["anonymous", () => asAnon(db)],
      ["another firm's owner", () => asUser(db, { userId: other.owner.id, aal: "aal2", totpAgeSeconds: 0 })],
      ["another firm's owner pointing at this firm", () => asUser(db, { userId: other.owner.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 })],
      ["the firm's portal client", () => asUser(db, { userId: client.id, aal: "aal1", orgId: ctx.orgId })],
      ["the firm's owner without MFA", () => asUser(db, { userId: ctx.owner.id, aal: "aal1" })],
    ];
    for (const [who, as] of viewers) {
      await as();
      const view = await publicView(ctx.firmSlug, typeId);
      expect(view.event, who).toBeNull();
      expect(view.types, who).toEqual([]);
      expect(view.busy, who).toMatch(/booking type not found/);
      await expectDbError(
        () =>
          db.query(`select public.booking_public_hold($1, 'initial', now() + interval '3 days', 'Sam Example', 'sam@example.test', null, 'UTC', $2, null)`, [
            ctx.firmSlug,
            randomUUID(),
          ]),
        /booking type not found/,
      );
    }
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.bookings where organization_id = $1`, [ctx.orgId])).rows).toHaveLength(0);
  });

  it("opens a practice page to the firm's staff and books it as a sample booking, with the same checks", async () => {
    const ctx = await firm({ sample: true });
    const typeId = await eventType(ctx, { capacity: 1 });
    // Any active staff member with MFA may open it, without choosing a workspace.
    for (const session of [staffSession(ctx), { userId: ctx.hosts[0].user.id, aal: "aal2" as const, totpAgeSeconds: 0 }]) {
      await asUser(db, session);
      const view = await publicView(ctx.firmSlug, typeId);
      expect(view.event).toMatchObject({ title: "Initial consultation", practice: true, price_cents: 0 });
      expect(view.types).toEqual([expect.objectContaining({ slug: "initial", practice: true })]);
      expect(view.busy).toBe("ok");
    }

    const start = await localStart(3);
    const key = randomUUID();
    const summary = await hold(ctx, start, { session: staffSession(ctx), key, email: "practice@example.test" });
    expect(summary).toMatchObject({ status: "confirmed", practice: true });
    // Idempotency: the same key returns the same booking.
    expect((await hold(ctx, start, { session: staffSession(ctx), key, email: "practice@example.test" })).public_ref).toBe(summary.public_ref);
    // The slot, the daily limit and the working hours hold as on a real page.
    await expectDbError(() => hold(ctx, start, { session: staffSession(ctx), email: "again@example.test" }), /slot_unavailable/);
    await expectDbError(async () => hold(ctx, await localStart(3, "14:00"), { session: staffSession(ctx), email: "again@example.test" }), /slot_unavailable/);
    await expectDbError(async () => hold(ctx, await localStart(4, "20:00"), { session: staffSession(ctx), email: "again@example.test" }), /slot_unavailable/);

    await asMaintenance(db);
    const booking = (await db.query<{ id: string; is_sample: boolean; source: string; person_id: string | null }>(
      `select id, is_sample, source, person_id from public.bookings where public_ref = $1`,
      [summary.public_ref],
    )).rows[0];
    expect(booking).toMatchObject({ is_sample: true, source: "public", person_id: null });
    expect((await db.query(`select 1 from public.bookings where organization_id = $1`, [ctx.orgId])).rows).toHaveLength(1);
    // The attendee and history rows belong to the sample booking.
    expect((await db.query(`select 1 from public.booking_attendees where booking_id = $1`, [booking.id])).rows).toHaveLength(1);
    const kinds = (await db.query<{ kind: string }>(`select kind from public.booking_events where booking_id = $1 order by created_at`, [booking.id])).rows.map((r) => r.kind);
    expect(kinds).toEqual(["held", "confirmed"]);
    // Sample mail goes out like every other sample record's mail.
    const prepared = await prepareMail("booking.confirmed", ctx.orgId);
    expect(prepared.action).toBe("send");
    expect(prepared.messages[0]).toMatchObject({ to: "practice@example.test" });
    expect(prepared.messages[0].context).toMatchObject({ portal: false, location_kind: "video" });
  });

  it("leaves a real firm's page as it was: open to everyone, real bookings, practice false", async () => {
    const ctx = await firm();
    await eventType(ctx);
    await asAnon(db);
    expect((await db.query<{ e: Record<string, unknown> }>(`select public.booking_public_event($1, 'initial') as e`, [ctx.firmSlug])).rows[0].e).toMatchObject({ practice: false });
    const summary = await hold(ctx, await localStart(4));
    expect(summary.practice).toBe(false);
    await asMaintenance(db);
    expect((await db.query<{ is_sample: boolean }>(`select is_sample from public.bookings where public_ref = $1`, [summary.public_ref])).rows[0].is_sample).toBe(false);
  });

  it("gives the mail how they meet, the in-person address, portal only for a portal login, and the booking page on a cancellation", async () => {
    const ctx = await firm();
    await eventType(ctx, { kind: "in_person", detail: "1 Example Street, Toronto" });
    const client = await createUser("client", "Synthetic Client");
    await membership(ctx.orgId, client.id, "client");
    await asMaintenance(db);
    await db.query(`insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Synthetic Client', $3)`, [ctx.orgId, client.id, client.email]);

    await hold(ctx, await localStart(19), { as: client.id, email: client.email });
    const portalMail = await prepareMail("booking.confirmed", ctx.orgId);
    expect(portalMail.messages[0].context).toMatchObject({ portal: true, location_kind: "in_person", address: "1 Example Street, Toronto" });

    const visitor = await hold(ctx, await localStart(19, "14:00"), { email: "visitor@example.test" });
    const visitorMail = await prepareMail("booking.confirmed", ctx.orgId);
    expect(visitorMail.messages[0]).toMatchObject({ to: "visitor@example.test" });
    expect(visitorMail.messages[0].context).toMatchObject({ portal: false, location_kind: "in_person" });

    await asMaintenance(db);
    const id = (await db.query<{ id: string }>(`select id from public.bookings where public_ref = $1`, [visitor.public_ref])).rows[0].id;
    await asUser(db, owner(ctx));
    await db.query(`select public.staff_cancel_booking($1, $2, null, null)`, [ctx.orgId, id]);
    const cancelled = await prepareMail("booking.cancelled", ctx.orgId);
    expect(cancelled.messages[0].context).toMatchObject({ portal: false, booking_page: ctx.firmSlug });
    expect(cancelled.messages[0].context).not.toHaveProperty("address");
  });
});

describe("scheduling: RLS", () => {
  it("staff of another firm see none of this firm's bookings or settings", async () => {
    const a = await firm();
    await eventType(a);
    await hold(a, await localStart(15));
    const b = await firm();
    await asUser(db, owner(b));
    for (const table of ["bookings", "booking_attendees", "booking_event_types", "availability_schedules", "availability_rules"]) {
      const rows = await db.query<{ organization_id: string }>(`select organization_id from public.${table}`);
      expect(rows.rows.every((row) => row.organization_id === b.orgId), table).toBe(true);
    }
    // Pointing the workspace at firm A does not help a non-member.
    await asUser(db, { userId: b.owner.id, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 0 });
    expect((await db.query(`select 1 from public.bookings`)).rows).toHaveLength(0);
    // Firm A's own staff see the booking and its attendee.
    await asUser(db, owner(a));
    expect((await db.query(`select 1 from public.bookings`)).rows).toHaveLength(1);
    expect((await db.query(`select email from public.booking_attendees`)).rows).toHaveLength(1);
    // Without MFA, staff see nothing.
    await asUser(db, { userId: a.owner.id, aal: "aal1", orgId: a.orgId });
    expect((await db.query(`select 1 from public.bookings`)).rows).toHaveLength(0);
  });

  it("a signed-in portal client who books is linked to their own person and sees only their own bookings", async () => {
    const ctx = await firm();
    await eventType(ctx);
    const client = await createUser("client", "Synthetic Client");
    await membership(ctx.orgId, client.id, "client");
    await asMaintenance(db);
    const person = await db.query<{ id: string }>(
      `insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Synthetic Client', $3) returning id`,
      [ctx.orgId, client.id, client.email],
    );
    const mine = await hold(ctx, await localStart(16), { as: client.id, email: client.email });
    await hold(ctx, await localStart(16, "13:00"), { email: "stranger@example.test" });
    await asMaintenance(db);
    expect((await db.query<{ person_id: string }>(`select person_id from public.bookings where public_ref = $1`, [mine.public_ref])).rows[0].person_id).toBe(person.rows[0].id);

    await asUser(db, { userId: client.id, aal: "aal1", orgId: ctx.orgId });
    const visible = await db.query<{ public_ref: string }>(`select public_ref from public.bookings`);
    expect(visible.rows.map((r) => r.public_ref)).toEqual([mine.public_ref]);
    expect((await db.query(`select 1 from public.booking_attendees`)).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.availability_rules`)).rows).toHaveLength(0);
  });
});

describe("scheduling: staff cancel, reschedule and book, with EM16 mail", () => {
  async function claimAndPrepare(eventType: string, orgId: string) {
    await asServiceRole(db);
    const worker = `worker-${randomUUID().slice(0, 8)}`;
    const claimed = (await db.query<{ c: { id: string; event_type: string; organization_id: string }[] }>(`select public.claim_mail_events($1, 50) as c`, [worker])).rows[0].c;
    const event = claimed.find((row) => row.event_type === eventType && row.organization_id === orgId);
    expect(event, eventType).toBeTruthy();
    const prepared = (await db.query<{ p: { action: string; messages: { to: string; template: string; context: Record<string, unknown> }[] } }>(
      `select public.prepare_email_delivery($1, $2) as p`,
      [event!.id, worker],
    )).rows[0].p;
    return prepared;
  }

  it("queues EM16a to the attendee with their zone and the consultant's name", async () => {
    const ctx = await firm();
    await eventType(ctx);
    await hold(ctx, await localStart(17), { email: "mailme@example.test" });
    const prepared = await claimAndPrepare("booking.confirmed", ctx.orgId);
    expect(prepared.action).toBe("send");
    expect(prepared.messages).toHaveLength(1);
    expect(prepared.messages[0]).toMatchObject({ to: "mailme@example.test", template: "consultation_booked" });
    expect(prepared.messages[0].context).toMatchObject({ time_zone: "America/Vancouver", consultant_name: "Synthetic Host 1", firm: "Synthetic Firm" });
    expect(typeof prepared.messages[0].context.starts_at).toBe("string");
  });

  it("moves a booking in place (same reference, SEQUENCE + 1, old time freed) and cancels it, with EM16b and EM16c", async () => {
    const ctx = await firm();
    await eventType(ctx);
    const first = await localStart(18);
    const summary = await hold(ctx, first, { email: "move@example.test" });
    await asMaintenance(db);
    const booking = (await db.query<{ id: string; version: number }>(`select id, version from public.bookings where public_ref = $1`, [summary.public_ref])).rows[0];

    // Assistants and other operational staff may; a portal client may not.
    const outsider = await createUser("outsider");
    await membership(ctx.orgId, outsider.id, "client");
    await asUser(db, { userId: outsider.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.staff_cancel_booking($1, $2, null, null)`, [ctx.orgId, booking.id]), /staff access denied/);

    const moved = await localStart(18, "14:00");
    await asUser(db, owner(ctx));
    await expectDbError(() => db.query(`select public.staff_reschedule_booking($1, $2, $3::timestamptz, $4)`, [ctx.orgId, booking.id, moved, booking.version + 5]), /changed by someone else/);
    await db.query(`select public.staff_reschedule_booking($1, $2, $3::timestamptz, $4)`, [ctx.orgId, booking.id, moved, booking.version]);
    await asMaintenance(db);
    const after = (await db.query<{ public_ref: string; ics_sequence: number; starts_at: Date; status: string }>(`select public_ref, ics_sequence, starts_at, status from public.bookings where id = $1`, [booking.id])).rows[0];
    expect(after).toMatchObject({ public_ref: summary.public_ref, ics_sequence: 1, status: "confirmed" });
    expect(new Date(after.starts_at).toISOString()).toBe(new Date(moved).toISOString());
    // The old time is free again.
    expect((await hold(ctx, first, { email: "next@example.test" })).status).toBe("confirmed");

    const rescheduled = await claimAndPrepare("booking.rescheduled", ctx.orgId);
    expect(rescheduled.messages[0]).toMatchObject({ to: "move@example.test", template: "consultation_rescheduled" });

    await asUser(db, owner(ctx));
    await db.query(`select public.staff_cancel_booking($1, $2, 'Firm closed', null)`, [ctx.orgId, booking.id]);
    await asMaintenance(db);
    expect((await db.query<{ status: string; cancelled_by: string }>(`select status, cancelled_by from public.bookings where id = $1`, [booking.id])).rows[0]).toMatchObject({ status: "cancelled", cancelled_by: "staff" });
    const cancelled = await claimAndPrepare("booking.cancelled", ctx.orgId);
    expect(cancelled.messages[0]).toMatchObject({ to: "move@example.test", template: "consultation_cancelled" });
    // The cancelled time is free.
    expect((await hold(ctx, moved, { email: "later@example.test" })).status).toBe("confirmed");
    await asMaintenance(db);
    const kinds = (await db.query<{ kind: string }>(`select kind from public.booking_events where booking_id = $1 order by created_at`, [booking.id])).rows.map((r) => r.kind);
    expect(kinds).toEqual(["held", "confirmed", "rescheduled", "cancelled"]);
  });

  it("staff book a consultation for a client they can see, linking the person", async () => {
    const ctx = await firm();
    const typeId = await eventType(ctx, { publish: false });
    const host = ctx.hosts[0];
    await asMaintenance(db);
    const person = await db.query<{ id: string }>(
      `insert into public.persons (organization_id, display_name, email, created_by) values ($1, 'Synthetic Client', 'client.person@example.test', $2) returning id`,
      [ctx.orgId, host.user.id],
    );
    const start = await localStart(0, "16:30"); // staff are not held to minimum notice
    await asUser(db, { userId: host.user.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const future = new Date(start).getTime() > Date.now();
    const at = future ? start : await localStart(1, "16:30");
    await asUser(db, { userId: host.user.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const key = randomUUID();
    const id = (await db.query<{ id: string }>(`select public.staff_book_consultation($1, $2, $3, $4::timestamptz, $5, $6) as id`, [ctx.orgId, typeId, person.rows[0].id, at, TZ, key])).rows[0].id;
    expect((await db.query<{ id: string }>(`select public.staff_book_consultation($1, $2, $3, $4::timestamptz, $5, $6) as id`, [ctx.orgId, typeId, person.rows[0].id, at, TZ, key])).rows[0].id).toBe(id);
    const row = (await db.query<{ person_id: string; source: string; status: string }>(`select person_id, source, status from public.bookings where id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ person_id: person.rows[0].id, source: "staff", status: "confirmed" });
    // Staff see availability with host ids (for the dialogs); the public never does.
    const availability = (await db.query<{ a: { hosts: { membership_id: string }[] } }>(`select public.staff_booking_availability($1, $2, now(), now() + interval '7 days') as a`, [ctx.orgId, typeId])).rows[0].a;
    expect(availability.hosts[0].membership_id).toBe(host.membershipId);
  });
});
