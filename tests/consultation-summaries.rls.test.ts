import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { publishTestPrivacyNotice } from "./helpers/privacy-notice";

// Consultation outcome summaries (20261023150000, CRM-04): staff write the summary after an
// attended consultation; only a licensed reviewer shares it; the client reads only the shared
// text of their own consultations. Everything here is synthetic.

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
  await asUser(db, client(who.id, null));
  const row = await db.query<{ r: { public_ref: string; error?: string } }>(
    `select public.booking_public_hold($1, 'review', $2::timestamptz, 'Synthetic Client', $3, null, 'America/Vancouver', $4, null) as r`,
    [ctx.firmSlug, start, who.email, randomUUID()],
  );
  if (row.rows[0].r.error) throw new Error(row.rows[0].r.error);
  await asMaintenance(db);
  const booking = (
    await db.query<{ id: string; version: number; person_id: string | null }>(`select id, version, person_id from public.bookings where public_ref = $1`, [row.rows[0].r.public_ref])
  ).rows[0];
  return booking;
}


async function attended(bookingId: string) {
  await asMaintenance(db);
  await db.query(`set session_replication_role = replica`);
  await db.query(`update public.bookings set status = 'completed' where id = $1`, [bookingId]);
  await db.query(`set session_replication_role = origin`);
}

const save = (bookingId: string, body: string, version: number) =>
  db.query<{ v: number }>(`select public.save_consultation_summary($1, $2, $3) as v`, [bookingId, body, version]);
const share = (bookingId: string, version: number) => db.query<{ v: number }>(`select public.share_consultation_summary($1, $2) as v`, [bookingId, version]);
const portal = (orgId: string) =>
  db.query<{ booking_id: string; summary: string }>(`select booking_id, summary from public.portal_consultation_summaries($1)`, [orgId]);

describe("consultation outcome summaries (CRM-04)", () => {
  it("staff write it after the meeting, a licensed reviewer shares it, and only then the client sees it", async () => {
    const ctx = await firm();
    const caseManager = await createUser("cm", "Synthetic Case Manager");
    await membership(ctx.orgId, caseManager.id, "case_manager");
    const booking = await book(ctx, await localStart(3));

    // Not before the consultation is marked attended.
    await asUser(db, staff(caseManager.id, ctx.orgId));
    await expectDbError(() => save(booking.id, "We discussed a study permit.", 0), /attended/);

    await attended(booking.id);
    await asUser(db, staff(caseManager.id, ctx.orgId));
    expect((await save(booking.id, "We discussed a study permit. Next: we send a quote.", 0)).rows[0].v).toBe(1);
    // A stale version is a conflict.
    await expectDbError(() => save(booking.id, "Another text", 0), /changed by someone else/);

    // The client sees nothing yet; a case manager can't share.
    await asUser(db, client(ctx.client.id, ctx.orgId));
    expect((await portal(ctx.orgId)).rows).toEqual([]);
    await asUser(db, staff(caseManager.id, ctx.orgId));
    await expectDbError(() => share(booking.id, 1), /denied/);

    // The licensed consultant approves and shares it.
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    expect((await share(booking.id, 1)).rows[0].v).toBe(2);
    await asUser(db, client(ctx.client.id, ctx.orgId));
    expect((await portal(ctx.orgId)).rows).toEqual([{ booking_id: booking.id, summary: "We discussed a study permit. Next: we send a quote." }]);

    // Editing after sharing needs review again; the client keeps the shared text meanwhile.
    await asUser(db, staff(caseManager.id, ctx.orgId));
    expect((await save(booking.id, "Revised: we send a quote this week.", 2)).rows[0].v).toBe(3);
    await asMaintenance(db);
    expect((await db.query<{ status: string }>(`select status from public.consultation_summaries where booking_id = $1`, [booking.id])).rows[0].status).toBe("needs_review");
    await asUser(db, client(ctx.client.id, ctx.orgId));
    expect((await portal(ctx.orgId)).rows[0].summary).toBe("We discussed a study permit. Next: we send a quote.");

    // The client can't read the staff table, and the audit trail has both acts.
    expect((await db.query(`select body from public.consultation_summaries`)).rows).toEqual([]);
    await asMaintenance(db);
    const actions = (await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 and action like 'consultation_summary.%' order by occurred_at`, [booking.id])).rows.map((row) => row.action);
    expect(actions).toEqual(["consultation_summary.saved", "consultation_summary.shared", "consultation_summary.saved"]);
  });

  it("another client never sees someone else's summary", async () => {
    const ctx = await firm();
    const booking = await book(ctx, await localStart(4));
    await attended(booking.id);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await save(booking.id, "Private outcome for the first client.", 0);
    await share(booking.id, 1);
    const other = await createUser("other", "Other Client");
    await membership(ctx.orgId, other.id, "client");
    await asMaintenance(db);
    await db.query(`insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Other Client', $3)`, [ctx.orgId, other.id, other.email]);
    await asUser(db, client(other.id, ctx.orgId));
    expect((await portal(ctx.orgId)).rows).toEqual([]);
  });
});
