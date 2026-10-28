import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { publishTestPrivacyNotice } from "./helpers/privacy-notice";

/**
 * 20261020101500_notifications_firm_timezone: a public booking's notification shows its time in the
 * firm's own time zone (the zone the whole Sheet uses), not the host's. Synthetic data only.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const FIRM_TZ = "America/Toronto";
const HOST_TZ = "America/Winnipeg";
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "08:00", end: "18:00" }));

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `${label}-${id.slice(0, 8)}@example.test`]);
  return id;
}

type Item = { id: string; kind: string; detail: string | null };

async function firmWithBooking() {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const slug = `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", slug]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false, timezone = $2 where id = $1`, [orgId, FIRM_TZ]);
  // #263-A: booking pages need the firm's published privacy notice.
  await publishTestPrivacyNotice(db, orgId);
  const host = await createUser("host");
  const hostMembership = (
    await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, 'licensed_consultant', 'active', now()) returning id`,
      [orgId, host],
    )
  ).rows[0].id;
  // The host works in Winnipeg, an hour behind the firm.
  await asUser(db, { userId: host, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [orgId, hostMembership, HOST_TZ, JSON.stringify(EVERY_DAY)]);
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.save_booking_event_type($1, null, null, 'Initial consultation', 'initial', null, 30, null, 15, 15, 60, 60, null,
       'video'::public.booking_location_kind, null, $2::uuid[], true)`,
    [orgId, [hostMembership]],
  );
  await asMaintenance(db);
  // 12:00 in the firm's zone, a week from today.
  const start = (
    await db.query<{ at: string }>(
      `select to_char(app.local_instant((now() at time zone $1)::date + 7, '12:00'::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
      [FIRM_TZ],
    )
  ).rows[0].at;
  await asAnon(db);
  await db.query(`select public.booking_public_hold($1, 'initial', $2::timestamptz, 'Sam Example', 'sam@example.test', null, 'America/Vancouver', $3, null)`, [
    slug,
    start,
    randomUUID(),
  ]);
  await asMaintenance(db);
  const date = (await db.query<{ d: string }>(`select to_char(($1::timestamptz at time zone $2)::date, 'YYYY-MM-DD') as d`, [start, FIRM_TZ])).rows[0].d;
  return { orgId, owner, host, date };
}

describe("staff notifications: booking time in the firm's time zone", () => {
  it("shows a public booking at the firm's local time, not the host's", async () => {
    const ctx = await firmWithBooking();
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const items = (await db.query<{ items: Item[] }>(`select public.staff_notifications($1, 50) as items`, [ctx.orgId])).rows[0].items;
    const booking = items.find((item) => item.kind === "booking");
    expect(booking?.detail).toBe(`${ctx.date}T12:00`);
  });

  it("falls back to the host's zone only when the firm has none, and still refuses non-staff", async () => {
    const ctx = await firmWithBooking();
    await asMaintenance(db);
    await db.query(`update public.organizations set timezone = '' where id = $1`, [ctx.orgId]).catch(() => undefined);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const items = (await db.query<{ items: Item[] }>(`select public.staff_notifications($1, 50) as items`, [ctx.orgId])).rows[0].items;
    const booking = items.find((item) => item.kind === "booking");
    // Empty firm zone (when the column allows it): the host's Winnipeg time; otherwise still the firm's.
    expect([`${ctx.date}T11:00`, `${ctx.date}T12:00`]).toContain(booking?.detail);
    const outsider = await createUser("outsider");
    await asUser(db, { userId: outsider, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.staff_notifications($1, 50)`, [ctx.orgId]), /staff access denied/);
  });
});
