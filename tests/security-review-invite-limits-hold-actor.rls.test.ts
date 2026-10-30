import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { publishTestPrivacyNotice } from "./helpers/privacy-notice";

// Security review (20261031004000_invite_limits_signing_definer_public_hold_actor):
//   A) staff and portal invitations are rate limited in the database;
//   B) app.client_fund_ledger_totals is internal only (signing: tests/agreements.rls.test.ts);
//   C) rows written by a public booking hold name the server-supplied viewer, or actor 'public'.
// Everything here is synthetic.

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

const address = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.test`;
const tokenHash = () => randomBytes(32).toString("hex");

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, address(label)]);
  return id;
}

async function createFirm() {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const slug = `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", slug])).rows[0].id;
  return { owner, orgId, slug };
}

async function inviteStaff(owner: string, orgId: string, email: string) {
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  return (await db.query<{ token: string }>(`select public.create_staff_invitation($1, $2, 'assistant'::public.org_role) as token`, [orgId, email])).rows[0].token;
}

/** Revoked staff invitations created now (they take no seat), as earlier sends. */
async function seedSent(orgId: string, count: number, createdBy: string | null) {
  await asMaintenance(db);
  for (let i = 0; i < count; i++) {
    await db.query(
      `insert into public.invitations (organization_id, email, role, token_hash, expires_at, revoked_at, created_by)
       values ($1, $2, 'assistant', $3, now() + interval '7 days', now(), $4)`,
      [orgId, address(`seed${i}`), tokenHash(), createdBy],
    );
  }
}

describe("A) invitation limits", () => {
  it("allows 5 staff invitations (resends included) to one address a day, then refuses; other addresses still work", async () => {
    const { owner, orgId } = await createFirm();
    const target = address("invitee");
    for (let i = 0; i < 5; i++) expect(await inviteStaff(owner, orgId, target)).toMatch(/^[0-9a-f]{64}$/);
    await expectDbError(() => inviteStaff(owner, orgId, target), /invitation limit reached: this address/);
    await expectDbError(() => inviteStaff(owner, orgId, target.toUpperCase()), /invitation limit reached: this address/);
    expect(await inviteStaff(owner, orgId, address("other"))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses the 51st invitation from one firm in an hour", async () => {
    const { owner, orgId } = await createFirm();
    await seedSent(orgId, 50, null);
    await expectDbError(() => inviteStaff(owner, orgId, address("late")), /invitation limit reached: this firm/);
    await asMaintenance(db);
    // Age the earlier sends past the window (touch_row keeps created_at, so bypass triggers).
    await db.exec(`
      begin;
      set local session_replication_role = replica;
      update public.invitations set created_at = now() - interval '2 hours' where organization_id = '${orgId}';
      commit;
    `);
    expect(await inviteStaff(owner, orgId, address("later"))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a user's 31st invitation in an hour", async () => {
    const { owner, orgId } = await createFirm();
    await seedSent(orgId, 30, owner);
    await expectDbError(() => inviteStaff(owner, orgId, address("late")), /invitation limit reached: you sent 30/);
  });

  it("counts portal invitations to one address across people, as one limit", async () => {
    const { owner, orgId } = await createFirm();
    await asMaintenance(db);
    const matterId = randomUUID();
    await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic sample matter', true)`, [matterId, orgId]);
    const people: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = randomUUID();
      await db.query(
        `insert into public.persons (id, organization_id, display_name, is_sample, date_of_birth, birth_date_precision)
         values ($1, $2, $3, true, date '1990-05-05', 'day'::public.date_precision)`,
        [id, orgId, `Synthetic Person ${i}`],
      );
      await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, id]);
      people.push(id);
    }
    const shared = address("shared");
    const invite = async (personId: string) => {
      await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
      return (
        await db.query<{ r: { ok: boolean; error?: string } }>(`select public.create_portal_invitation($1, $2, 'client'::public.org_role, $3, '{}'::uuid[]) as r`, [
          personId,
          matterId,
          shared,
        ])
      ).rows[0].r;
    };
    for (let i = 0; i < 5; i++) expect(await invite(people[i])).toMatchObject({ ok: true });
    await expectDbError(() => invite(people[5]), /invitation limit reached: this address/);
    // A staff invitation to the same address in the same firm counts too.
    await expectDbError(() => inviteStaff(owner, orgId, shared), /invitation limit reached: this address/);
  });
});

describe("B) client fund totals are internal", () => {
  it("is not callable by a signed-in user", async () => {
    const { owner, orgId } = await createFirm();
    const grants = await db.query<{ authed: boolean; anon: boolean }>(
      `select has_function_privilege('authenticated', 'app.client_fund_ledger_totals(uuid)', 'execute') as authed,
              has_function_privilege('anon', 'app.client_fund_ledger_totals(uuid)', 'execute') as anon`,
    );
    expect(grants.rows[0]).toEqual({ authed: false, anon: false });
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select * from app.client_fund_ledger_totals($1)`, [randomUUID()]), /permission denied/);
  });
});

// ---------------------------------------------------------------------------
// C) public booking hold actor
// ---------------------------------------------------------------------------

const TZ = "America/Toronto";
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));
const hashOf = () => createHash("sha256").update(randomUUID()).digest("hex");

async function bookingFirm() {
  const { owner, orgId, slug } = await createFirm();
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  await publishTestPrivacyNotice(db, orgId);
  const host = await createUser("host");
  const membershipId = (
    await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, 'licensed_consultant', 'active', now()) returning id`,
      [orgId, host],
    )
  ).rows[0].id;
  await asUser(db, { userId: host, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [orgId, membershipId, TZ, JSON.stringify(EVERY_DAY)]);
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.save_booking_event_type($1, null, null, 'Initial consultation', 'initial', null, 30, null, 15, 15, 60, 60, null,
       'video'::public.booking_location_kind, null, $2::uuid[], true)`,
    [orgId, [membershipId]],
  );
  return { owner, orgId, slug };
}

async function localStart(days: number): Promise<string> {
  await asMaintenance(db);
  const row = await db.query<{ at: string }>(
    `select to_char(app.local_instant((now() at time zone $1)::date + $2::integer, '10:00'::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
    [TZ, days],
  );
  return row.rows[0].at;
}

async function hold(slug: string, start: string, viewer: string | null) {
  await asServiceRole(db);
  return (
    await db.query<{ r: { status?: string; public_ref?: string } }>(
      `select public.booking_public_hold($1, 'initial', $2::timestamptz, 'Sam Example', 'sam@example.test', null, 'UTC', $3, $4, $5::uuid) as r`,
      [slug, start, randomUUID(), hashOf(), viewer],
    )
  ).rows[0].r;
}

async function actorsOf(publicRef: string) {
  await asMaintenance(db);
  const booking = (await db.query<{ id: string }>(`select id from public.bookings where public_ref = $1`, [publicRef])).rows[0].id;
  const audit = await db.query<{ action: string; actor_type: string; actor_user_id: string | null }>(
    `select action, actor_type, actor_user_id from public.audit_log where object_id = $1 order by occurred_at`,
    [booking],
  );
  const events = await db.query<{ actor_user_id: string | null }>(`select actor_user_id from public.booking_events where booking_id = $1`, [booking]);
  const outbox = await db.query<{ created_by: string | null }>(`select created_by from public.outbox_events where aggregate_id = $1`, [booking]);
  return { audit: audit.rows, events: events.rows, outbox: outbox.rows };
}

describe("C) public booking hold actor", () => {
  it("names the signed-in viewer as the actor of every row the hold writes", async () => {
    const ctx = await bookingFirm();
    const visitor = await createUser("visitor");
    const held = await hold(ctx.slug, await localStart(3), visitor);
    expect(held).toMatchObject({ status: "confirmed" });
    const rows = await actorsOf(held.public_ref!);
    expect(rows.audit.length).toBeGreaterThan(0);
    expect(rows.audit.map((row) => row.action)).toContain("booking.confirmed");
    for (const row of rows.audit) expect(row).toMatchObject({ actor_type: "user", actor_user_id: visitor });
    expect(rows.events.length).toBeGreaterThan(0);
    for (const row of rows.events) expect(row.actor_user_id).toBe(visitor);
    expect(rows.outbox.length).toBeGreaterThan(0);
    for (const row of rows.outbox) expect(row.created_by).toBe(visitor);
  });

  it("records actor type 'public' with no user for a signed-out booker (and an unknown viewer id)", async () => {
    const ctx = await bookingFirm();
    for (const [days, viewer] of [
      [4, null],
      [5, randomUUID()],
    ] as const) {
      const held = await hold(ctx.slug, await localStart(days), viewer);
      expect(held).toMatchObject({ status: "confirmed" });
      const rows = await actorsOf(held.public_ref!);
      expect(rows.audit.length).toBeGreaterThan(0);
      for (const row of rows.audit) expect(row).toMatchObject({ actor_type: "public", actor_user_id: null });
      for (const row of rows.events) expect(row.actor_user_id).toBeNull();
      for (const row of rows.outbox) expect(row.created_by).toBeNull();
    }
  });

  it("ignores the setting outside the service role, and service rows outside a hold stay 'service'", async () => {
    const { owner, orgId } = await createFirm();
    const other = await createUser("other");
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(`select set_config('app.public_actor', $1, false)`, [other]);
    const mine = (await db.query<{ id: string }>(`select app.record_audit_event($1, 'synthetic.check', null, null, 'success', '{}'::jsonb) as id`, [orgId])).rows[0].id;
    await db.query(`select set_config('app.public_actor', '', false)`);
    await asServiceRole(db);
    const service = (await db.query<{ id: string }>(`select app.record_audit_event($1, 'synthetic.service', null, null, 'success', '{}'::jsonb) as id`, [orgId])).rows[0].id;
    await asMaintenance(db);
    const rows = await db.query<{ id: string; actor_type: string; actor_user_id: string | null }>(
      `select id, actor_type, actor_user_id from public.audit_log where id = any($1::uuid[])`,
      [[mine, service]],
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row]));
    expect(byId[mine]).toMatchObject({ actor_type: "user", actor_user_id: owner });
    expect(byId[service]).toMatchObject({ actor_type: "service", actor_user_id: null });
  });
});
