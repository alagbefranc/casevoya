import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fulfillProviderMeeting, parseBegin } from "@/modules/integrations/meeting-links";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { publishTestPrivacyNotice } from "./helpers/privacy-notice";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const TZ = "America/Toronto";
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));
const MEET = "https://meet.google.com/abc-defg-hij";

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function createUser(label: string, name?: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3::jsonb)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
    JSON.stringify(name ? { display_name: name } : {}),
  ]);
  return { id };
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
  const owner = await createUser("owner", "Synthetic Owner");
  await asUser(db, { userId: owner.id, aal: "aal2", totpAgeSeconds: 0 });
  const firmSlug = slug();
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", firmSlug]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  await publishTestPrivacyNotice(db, orgId);
  const host = await createUser("host", "Synthetic Host");
  const hostMembership = await membership(orgId, host.id, "licensed_consultant");
  await asUser(db, { userId: host.id, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [orgId, hostMembership, TZ, JSON.stringify(EVERY_DAY)]);
  return { orgId, firmSlug, owner, host, hostMembership };
}

async function connect(ctx: Awaited<ReturnType<typeof firm>>, toolkit: string) {
  await asUser(db, { userId: ctx.owner.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  await db.query(`select public.set_composio_enabled($1, true, true)`, [ctx.orgId]);
  await asUser(db, { userId: ctx.host.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  await db.query(`select public.save_staff_connection($1, $2, 'active', $3)`, [ctx.orgId, toolkit, `ca_${toolkit}_test`]);
}

async function eventType(ctx: Awaited<ReturnType<typeof firm>>, kind: string) {
  await asUser(db, { userId: ctx.owner.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  const row = await db.query<{ id: string }>(
    `select public.save_booking_event_type($1, null, null, 'Initial consultation', 'initial', null, 30, null, 0, 0, 0, 60, null, $2::public.booking_location_kind, null, $3::uuid[], true) as id`,
    [ctx.orgId, kind, [ctx.hostMembership]],
  );
  return row.rows[0].id;
}

async function localStart(days: number, time = "10:00") {
  await asMaintenance(db);
  const row = await db.query<{ at: string }>(
    `select to_char(app.local_instant((now() at time zone $1)::date + $2::integer, $3::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
    [TZ, days, time],
  );
  return row.rows[0].at;
}

async function hold(ctx: Awaited<ReturnType<typeof firm>>, start: string, key = randomUUID()) {
  await asServiceRole(db);
  const row = await db.query<{ result: { public_ref: string; status: string; location_kind: string; location_detail: string | null; error?: string } }>(
    `select public.booking_public_hold($1, 'initial', $2::timestamptz, 'Sam Example', $3, null, 'America/Vancouver', $4, $5, null) as result`,
    [ctx.firmSlug, start, `sam-${key.slice(0, 8)}@example.test`, key, createHash("sha256").update(key).digest("hex")],
  );
  if (row.rows[0].result.error) throw new Error(row.rows[0].result.error);
  return { ...row.rows[0].result, key };
}

async function bookingId(ref: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string; status: string; location_detail: string | null; idempotency_key: string; version: number }>(
    `select id, status, location_detail, idempotency_key, version from public.bookings where public_ref = $1`,
    [ref],
  );
  return row.rows[0];
}

describe("Google Meet booking links", () => {
  it("refuses to publish until the host's Meet account is connected, and a booker cannot call the meeting functions", async () => {
    const ctx = await firm();
    await expectDbError(() => eventType(ctx, "google_meet"), /turned on connected|connect that meeting/);
    await connect(ctx, "googlemeet");
    await eventType(ctx, "google_meet");
    await asUser(db, { userId: ctx.host.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.begin_booking_meeting($1)`, [randomUUID()]), /permission denied/);
  });

  it("holds the booking, creates one link through the host, confirms, and a retry does not create another", async () => {
    const ctx = await firm();
    await connect(ctx, "googlemeet");
    await eventType(ctx, "google_meet");
    const summary = await hold(ctx, await localStart(5));
    expect(summary.status).toBe("held");
    expect(summary.location_detail).toBeNull();
    const row = await bookingId(summary.public_ref);
    const calls: { host: string; slug: string }[] = [];
    const deps = {
      async begin(id: string) {
        await asServiceRole(db);
        const result = (await db.query<{ result: unknown }>(`select public.begin_booking_meeting($1) as result`, [id])).rows[0].result;
        return parseBegin(result);
      },
      async store(id: string, joinUrl: string) {
        await asServiceRole(db);
        await db.query(`select public.store_booking_meeting($1, $2)`, [id, joinUrl]);
      },
      async confirm(id: string) {
        await asServiceRole(db);
        const result = (await db.query<{ result: { public_ref: string; status: string; location_kind: string; location_detail: string | null } }>(`select public.confirm_provider_booking($1) as result`, [id])).rows[0].result;
        return { publicRef: result.public_ref, status: result.status, locationKind: result.location_kind, locationDetail: result.location_detail };
      },
      async release(id: string) {
        await asServiceRole(db);
        await db.query(`select public.release_provider_booking($1)`, [id]);
      },
      async create(input: { hostMembershipId: string; slug: string }) {
        calls.push({ host: input.hostMembershipId, slug: input.slug });
        return { meetingUri: MEET };
      },
    };
    const first = await fulfillProviderMeeting(row.id, deps);
    expect(first.ok).toBe(true);
    const saved = await bookingId(summary.public_ref);
    expect(saved.status).toBe("confirmed");
    expect(saved.location_detail).toBe(MEET);
    expect(calls).toEqual([{ host: ctx.hostMembership, slug: "GOOGLEMEET_CREATE_MEET" }]);
    const again = await fulfillProviderMeeting(row.id, deps);
    expect(again.ok).toBe(true);
    expect(calls).toHaveLength(1);
    await asMaintenance(db);
    expect((await db.query<{ n: string }>(`select count(*)::text as n from public.booking_provider_meetings where booking_id = $1`, [row.id])).rows[0].n).toBe("1");
    expect((await db.query<{ n: string }>(`select count(*)::text as n from public.external_busy_blocks where organization_id = $1`, [ctx.orgId])).rows[0].n).toBe("0");

    const later = await localStart(6, "11:00");
    const version = (await bookingId(summary.public_ref)).version;
    await asUser(db, { userId: ctx.host.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.staff_reschedule_booking($1, $2, $3::timestamptz, $4)`, [ctx.orgId, row.id, later, version]);
    const moved = await bookingId(summary.public_ref);
    expect(moved.location_detail).toBe(MEET);
    expect(moved.status).toBe("confirmed");
    expect(calls).toHaveLength(1);
    await asUser(db, { userId: ctx.host.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.staff_cancel_booking($1, $2, null, $3)`, [ctx.orgId, row.id, moved.version]);
    await asMaintenance(db);
    const hidden = (await db.query<{ result: { status: string; location_detail: string | null } }>(`select app.booking_summary($1) as result`, [row.id])).rows[0].result;
    expect(hidden.status).toBe("cancelled");
    expect(hidden.location_detail).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("does not confirm when the provider fails, and the same idempotency key can book again", async () => {
    const ctx = await firm();
    await connect(ctx, "googlemeet");
    await eventType(ctx, "google_meet");
    const key = randomUUID();
    const summary = await hold(ctx, await localStart(5), key);
    const row = await bookingId(summary.public_ref);
    const result = await fulfillProviderMeeting(row.id, {
      async begin(id: string) {
        await asServiceRole(db);
        return parseBegin((await db.query<{ result: unknown }>(`select public.begin_booking_meeting($1) as result`, [id])).rows[0].result);
      },
      async store() {
        throw new Error("should not store");
      },
      async confirm() {
        throw new Error("should not confirm");
      },
      async release(id: string) {
        await asServiceRole(db);
        await db.query(`select public.release_provider_booking($1)`, [id]);
      },
      async create() {
        return { meetingUri: "https://evil.example/join" };
      },
    });
    expect(result.ok).toBe(false);
    const released = await bookingId(summary.public_ref);
    expect(released.status).toBe("cancelled");
    expect(released.location_detail).toBeNull();
    expect(released.idempotency_key).not.toBe(key);
    const again = await hold(ctx, await localStart(5), key);
    expect(again.status).toBe("held");
    expect(again.public_ref).not.toBe(summary.public_ref);
  });

  it("refuses a second provider call while the first is still pending, and refuses a Teams url on a Meet booking", async () => {
    const ctx = await firm();
    await connect(ctx, "googlemeet");
    await eventType(ctx, "google_meet");
    const summary = await hold(ctx, await localStart(5));
    const row = await bookingId(summary.public_ref);
    await asServiceRole(db);
    const first = parseBegin((await db.query<{ result: unknown }>(`select public.begin_booking_meeting($1) as result`, [row.id])).rows[0].result);
    expect(first.action).toBe("create");
    if (first.action === "create") expect(first.host_membership_id).toBe(ctx.hostMembership);
    const second = parseBegin((await db.query<{ result: unknown }>(`select public.begin_booking_meeting($1) as result`, [row.id])).rows[0].result);
    expect(second.action).toBe("pending");
    await expectDbError(() => db.query(`select public.store_booking_meeting($1, $2)`, [row.id, "https://teams.microsoft.com/l/meetup-join/abc"]), /meeting link refused/);
    await asUser(db, { userId: ctx.host.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.store_booking_meeting($1, $2)`, [row.id, MEET]), /permission denied/);
  });
});

describe("Calendly import", () => {
  const event = (id: string, status: string, start: string) => ({
    uri: `https://api.calendly.com/scheduled_events/${id}`,
    name: "Intro call",
    status,
    starts_at: start,
    ends_at: new Date(Date.parse(start) + 30 * 60_000).toISOString(),
  });

  async function importer(ctx: Awaited<ReturnType<typeof firm>>) {
    await connect(ctx, "calendly");
    await asUser(db, { userId: ctx.host.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  }

  it("upserts the member's events, updates a repeat, and does not create clients or busy times", async () => {
    const ctx = await firm();
    await importer(ctx);
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const start = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const first = await db.query<{ result: { imported: number; canceled: number; truncated: boolean } }>(
      `select public.replace_calendly_import($1, $2::timestamptz, $3::timestamptz, $4::jsonb, true) as result`,
      [ctx.orgId, from, to, JSON.stringify([event("EV1", "active", start)])],
    );
    expect(first.rows[0].result).toEqual({ imported: 1, canceled: 0, truncated: false });
    const moved = new Date(Date.parse(start) + 3_600_000).toISOString();
    await db.query(`select public.replace_calendly_import($1, $2::timestamptz, $3::timestamptz, $4::jsonb, true)`, [
      ctx.orgId,
      from,
      to,
      JSON.stringify([event("EV1", "active", moved), event("EV2", "canceled", start)]),
    ]);
    await asMaintenance(db);
    const rows = await db.query<{ external_uri: string; status: string; starts_at: string }>(
      `select external_uri, status, starts_at::text from public.calendly_imported_events where organization_id = $1 order by external_uri`,
      [ctx.orgId],
    );
    expect(rows.rows.map((row) => [row.external_uri.slice(-3), row.status])).toEqual([
      ["EV1", "active"],
      ["EV2", "canceled"],
    ]);
    expect(Date.parse(rows.rows[0].starts_at)).toBe(Date.parse(moved));
    expect((await db.query<{ n: string }>(`select count(*)::text as n from public.persons where organization_id = $1`, [ctx.orgId])).rows[0].n).toBe("0");
    expect((await db.query<{ n: string }>(`select count(*)::text as n from public.bookings where organization_id = $1`, [ctx.orgId])).rows[0].n).toBe("0");
    expect((await db.query<{ n: string }>(`select count(*)::text as n from public.external_busy_blocks where organization_id = $1`, [ctx.orgId])).rows[0].n).toBe("0");
  });

  it("a complete import marks a vanished event canceled, and a truncated one does not", async () => {
    const ctx = await firm();
    await importer(ctx);
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const start = new Date(Date.now() + 4 * 86_400_000).toISOString();
    await db.query(`select public.replace_calendly_import($1, $2::timestamptz, $3::timestamptz, $4::jsonb, false)`, [ctx.orgId, from, to, JSON.stringify([event("KEEP", "active", start), event("GONE", "active", start)])]);
    await db.query(`select public.replace_calendly_import($1, $2::timestamptz, $3::timestamptz, $4::jsonb, false)`, [ctx.orgId, from, to, JSON.stringify([event("KEEP", "active", start)])]);
    await asMaintenance(db);
    const afterPartial = await db.query<{ status: string }>(`select status from public.calendly_imported_events where organization_id = $1 and external_uri like '%GONE'`, [ctx.orgId]);
    expect(afterPartial.rows[0].status).toBe("active");
    await asUser(db, { userId: ctx.host.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.replace_calendly_import($1, $2::timestamptz, $3::timestamptz, $4::jsonb, true)`, [ctx.orgId, from, to, JSON.stringify([event("KEEP", "active", start)])]);
    await asMaintenance(db);
    const afterFull = await db.query<{ status: string }>(`select status from public.calendly_imported_events where organization_id = $1 and external_uri like '%GONE'`, [ctx.orgId]);
    expect(afterFull.rows[0].status).toBe("canceled");
  });

  it("another member cannot overwrite the import, and a colleague cannot read it", async () => {
    const ctx = await firm();
    await importer(ctx);
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString();
    await db.query(`select public.replace_calendly_import($1, $2::timestamptz, $3::timestamptz, $4::jsonb, true)`, [ctx.orgId, from, to, JSON.stringify([event("MINE", "active", start)])]);
    const colleague = await createUser("colleague");
    const colleagueMembership = await membership(ctx.orgId, colleague.id, "case_manager");
    await asUser(db, { userId: ctx.owner.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await asUser(db, { userId: colleague.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.save_staff_connection($1, 'calendly', 'active', 'ca_calendly_other')`, [ctx.orgId]);
    await expectDbError(
      () => db.query(`select public.replace_calendly_import($1, $2::timestamptz, $3::timestamptz, $4::jsonb, true)`, [ctx.orgId, from, to, JSON.stringify([event("MINE", "canceled", start)])]),
      /another person/,
    );
    await asUser(db, { userId: colleague.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const seen = await db.query<{ result: { events: unknown[] } }>(`select public.sheet_calendar_providers($1, $2::timestamptz, $3::timestamptz) as result`, [ctx.orgId, from, to]);
    const body = seen.rows[0].result as { events: unknown[] };
    expect(body.events).toEqual([]);
    await asUser(db, { userId: ctx.owner.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const ownerView = await db.query<{ result: { events: { name: string }[] } }>(`select public.sheet_calendar_providers($1, $2::timestamptz, $3::timestamptz) as result`, [ctx.orgId, from, to]);
    expect(ownerView.rows[0].result.events.map((item) => item.name)).toEqual(["Intro call"]);
    expect(colleagueMembership).toBeTruthy();
  });
});
