import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261019235000_leads_calendar_fixes: Edit lead's Source (set_lead_source), archiving a booking
// type (archive_booking_event_type), and a cancelled consultation moving its lead back
// (bookings_lead_retreat). Role checks, step-up, versions, tenant isolation. Everything synthetic.

let db: TestDb;

const TZ = "America/Toronto";
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
  ]);
  return id;
}

async function membership(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
    [orgId, userId, role],
  );
  return row.rows[0].id;
}

async function firm() {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const slug = `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", slug]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  const finance = await createUser("finance");
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant");
  await membership(orgId, manager, "case_manager");
  await membership(orgId, finance, "finance_user");
  return { orgId, slug, owner, consultant, manager, finance, consultantMembership };
}

type Ctx = Awaited<ReturnType<typeof firm>>;

const as = (ctx: Ctx, userId: string, totpAgeSeconds = 0) => asUser(db, { userId, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds });

async function createLead(ctx: Ctx, source = "phone") {
  await as(ctx, ctx.manager);
  const row = await db.query<{ id: string }>(
    `select public.create_lead($1, 'Sam Example', 'sam@example.test', null, 'email', 'Work permit', null, null, $2::public.lead_source, null, null, null,
       array[]::text[], null, true, false) as id`,
    [ctx.orgId, source],
  );
  return row.rows[0].id;
}

async function lead(id: string) {
  await asMaintenance(db);
  return (await db.query<{ stage_id: string; source: string; version: number }>(`select stage_id, source::text, version from public.leads where id = $1`, [id])).rows[0];
}

async function stage(ctx: Ctx, key: string) {
  await asMaintenance(db);
  return (await db.query<{ id: string }>(`select id from public.lead_stages where organization_id = $1 and key = $2`, [ctx.orgId, key])).rows[0].id;
}

async function bookingType(ctx: Ctx) {
  await as(ctx, ctx.consultant);
  await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [ctx.orgId, ctx.consultantMembership, TZ, JSON.stringify(EVERY_DAY)]);
  await as(ctx, ctx.owner);
  const row = await db.query<{ id: string }>(
    `select public.save_booking_event_type($1, null, null, 'Initial consultation', 'initial', null, 30, null, 0, 0, 60, 60, null,
       'video'::public.booking_location_kind, null, $2::uuid[], true) as id`,
    [ctx.orgId, [ctx.consultantMembership]],
  );
  return row.rows[0].id;
}

/** A public booking `days` ahead at 10:00 Toronto time; returns its id. */
async function publicBooking(ctx: Ctx, days: number, email: string) {
  await asMaintenance(db);
  const start = await db.query<{ at: string }>(
    `select to_char(app.local_instant((now() at time zone $1)::date + $2::integer, '10:00'::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
    [TZ, days],
  );
  await asAnon(db);
  const held = await db.query<{ r: { error?: string; booking?: { id?: string } } }>(
    `select public.booking_public_hold($1, 'initial', $2::timestamptz, 'Ana Ferreira', $3, null, 'America/Toronto', $4, null) as r`,
    [ctx.slug, start.rows[0].at, email, randomUUID()],
  );
  expect(held.rows[0].r.error).toBeUndefined();
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(`select id from public.bookings where organization_id = $1 and starts_at = $2::timestamptz`, [ctx.orgId, start.rows[0].at]);
  return row.rows[0].id;
}

async function cancel(ctx: Ctx, booking: string) {
  await as(ctx, ctx.manager);
  await db.query(`select public.staff_cancel_booking($1, $2, 'Client asked', null)`, [ctx.orgId, booking]);
}

describe("Edit lead: Source", () => {
  it("changes a staff-recorded source with the version, writes history, and keeps system sources", async () => {
    const ctx = await firm();
    const id = await createLead(ctx);
    const before = await lead(id);
    await as(ctx, ctx.manager);
    const version = (await db.query<{ v: number }>(`select public.set_lead_source($1, $2, $3, 'referral') as v`, [ctx.orgId, id, before.version])).rows[0].v;
    const after = await lead(id);
    expect(after).toMatchObject({ source: "referral", version });
    expect(version).toBeGreaterThan(before.version);
    await asMaintenance(db);
    const events = await db.query<{ payload: Record<string, string> }>(`select payload from public.lead_events where lead_id = $1 and kind = 'updated'`, [id]);
    expect(events.rows.at(-1)?.payload).toEqual({ source_from: "phone", source_to: "referral" });
    const audit = await db.query(`select id from public.audit_log where object_id = $1 and action = 'lead.source_changed'`, [id]);
    expect(audit.rows).toHaveLength(1);

    // A stale version, a system source, and a lead that arrived from the booking page are refused.
    await as(ctx, ctx.manager);
    await expectDbError(() => db.query(`select public.set_lead_source($1, $2, $3, 'event')`, [ctx.orgId, id, before.version]), /changed by someone else/);
    await expectDbError(() => db.query(`select public.set_lead_source($1, $2, $3, 'web_form')`, [ctx.orgId, id, version]), /choose where this lead came from/);
    await asMaintenance(db);
    await db.query(`update public.leads set source = 'booking_page' where id = $1`, [id]);
    const current = await lead(id);
    await as(ctx, ctx.manager);
    await expectDbError(() => db.query(`select public.set_lead_source($1, $2, $3, 'phone')`, [ctx.orgId, id, current.version]), /recorded when it came in/);
  });

  it("refuses finance staff and another firm's staff", async () => {
    const ctx = await firm();
    const other = await firm();
    const id = await createLead(ctx);
    const { version } = await lead(id);
    await as(ctx, ctx.finance);
    await expectDbError(() => db.query(`select public.set_lead_source($1, $2, $3, 'referral')`, [ctx.orgId, id, version]), /staff access denied/);
    await asUser(db, { userId: other.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.set_lead_source($1, $2, $3, 'referral')`, [ctx.orgId, id, version]), /staff access denied/);
    await asUser(db, { userId: other.manager, aal: "aal2", orgId: other.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.set_lead_source($1, $2, $3, 'referral')`, [other.orgId, id, version]), /lead not found/);
    expect((await lead(id)).source).toBe("phone");
  });
});

describe("Archive a booking type", () => {
  it("lets only the firm owner with a step-up archive; the page goes, bookings stay", async () => {
    const ctx = await firm();
    const typeId = await bookingType(ctx);
    const booking = await publicBooking(ctx, 3, "ana.f@example.test");
    await asMaintenance(db);
    const { version } = (await db.query<{ version: number }>(`select version from public.booking_event_types where id = $1`, [typeId])).rows[0];

    await as(ctx, ctx.consultant);
    await expectDbError(() => db.query(`select public.archive_booking_event_type($1, $2, $3)`, [ctx.orgId, typeId, version]), /step-up|denied/);
    await as(ctx, ctx.owner, 3600);
    await expectDbError(() => db.query(`select public.archive_booking_event_type($1, $2, $3)`, [ctx.orgId, typeId, version]), /step-up/);
    await as(ctx, ctx.owner);
    await expectDbError(() => db.query(`select public.archive_booking_event_type($1, $2, $3)`, [ctx.orgId, typeId, version + 5]), /changed by someone else/);
    await db.query(`select public.archive_booking_event_type($1, $2, $3)`, [ctx.orgId, typeId, version]);

    await asMaintenance(db);
    const row = (await db.query<{ is_published: boolean; archived_at: string | null }>(`select is_published, archived_at from public.booking_event_types where id = $1`, [typeId])).rows[0];
    expect(row.is_published).toBe(false);
    expect(row.archived_at).not.toBeNull();
    expect((await db.query<{ status: string }>(`select status::text from public.bookings where id = $1`, [booking])).rows[0].status).not.toBe("cancelled");
    const audit = await db.query<{ context: { upcoming_bookings: number } }>(`select context from public.audit_log where object_id = $1 and action = 'booking_type.archived'`, [typeId]);
    expect(audit.rows[0].context.upcoming_bookings).toBe(1);
    await asAnon(db);
    expect((await db.query<{ e: unknown }>(`select public.booking_public_event($1, 'initial') as e`, [ctx.slug])).rows[0].e).toBeNull();

    await as(ctx, ctx.owner);
    const archived = (await db.query<{ version: number }>(`select version from public.booking_event_types where id = $1`, [typeId])).rows[0].version;
    await expectDbError(() => db.query(`select public.archive_booking_event_type($1, $2, $3)`, [ctx.orgId, typeId, archived]), /already archived/);
  });

  it("can't archive another firm's booking type", async () => {
    const ctx = await firm();
    const other = await firm();
    const typeId = await bookingType(ctx);
    await asUser(db, { userId: other.owner, aal: "aal2", orgId: other.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.archive_booking_event_type($1, $2, 1)`, [other.orgId, typeId]), /booking type not found/);
    await asUser(db, { userId: other.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.archive_booking_event_type($1, $2, 1)`, [ctx.orgId, typeId]), /denied|step-up|owner/);
  });
});

describe("A cancelled consultation moves its lead back", () => {
  it("returns a lead made from a booking to New when its only booking is cancelled", async () => {
    const ctx = await firm();
    await bookingType(ctx);
    const booking = await publicBooking(ctx, 3, "ana.f@example.test");
    await as(ctx, ctx.manager);
    const id = (await db.query<{ id: string }>(`select public.create_lead_from_booking($1, $2) as id`, [ctx.orgId, booking])).rows[0].id;
    expect((await lead(id)).stage_id).toBe(await stage(ctx, "consultation_scheduled"));
    await cancel(ctx, booking);
    expect((await lead(id)).stage_id).toBe(await stage(ctx, "new"));
    await asMaintenance(db);
    const last = await db.query<{ reason: string; payload: { booking_id: string } }>(
      `select reason, payload from public.lead_events where lead_id = $1 and kind = 'stage_changed' order by created_at desc limit 1`,
      [id],
    );
    expect(last.rows[0]).toMatchObject({ reason: "Consultation cancelled", payload: { booking_id: booking } });
  });

  it("goes back to the stage it came from (Contacted), and stays while another booking is live", async () => {
    const ctx = await firm();
    await bookingType(ctx);
    const id = await createLead(ctx);
    const { version } = await lead(id);
    const contacted = await stage(ctx, "contacted");
    await as(ctx, ctx.manager);
    await db.query(`select public.move_lead_stage($1, $2, $3, $4, null)`, [ctx.orgId, id, contacted, version]);
    const first = await publicBooking(ctx, 3, "one@example.test");
    const second = await publicBooking(ctx, 4, "two@example.test");
    await as(ctx, ctx.manager);
    await db.query(`select public.link_booking_to_lead($1, $2, $3)`, [ctx.orgId, first, id]);
    await db.query(`select public.link_booking_to_lead($1, $2, $3)`, [ctx.orgId, second, id]);
    expect((await lead(id)).stage_id).toBe(await stage(ctx, "consultation_scheduled"));
    await cancel(ctx, first);
    expect((await lead(id)).stage_id).toBe(await stage(ctx, "consultation_scheduled"));
    await cancel(ctx, second);
    expect((await lead(id)).stage_id).toBe(await stage(ctx, "contacted"));
  });

  it("leaves a lead someone already moved on (Qualified) where it is", async () => {
    const ctx = await firm();
    await bookingType(ctx);
    const id = await createLead(ctx);
    const booking = await publicBooking(ctx, 3, "q@example.test");
    await as(ctx, ctx.manager);
    await db.query(`select public.link_booking_to_lead($1, $2, $3)`, [ctx.orgId, booking, id]);
    const { version } = await lead(id);
    const qualified = await stage(ctx, "qualified");
    await as(ctx, ctx.manager);
    await db.query(`select public.move_lead_stage($1, $2, $3, $4, null)`, [ctx.orgId, id, qualified, version]);
    await cancel(ctx, booking);
    expect((await lead(id)).stage_id).toBe(await stage(ctx, "qualified"));
  });
});
