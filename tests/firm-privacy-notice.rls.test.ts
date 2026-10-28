import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// #263-A (20261028120000_firm_privacy_notice): a firm's public booking and enquiry pages need its
// published privacy notice; the owner can unpublish it (step-up, audited) only while those pages
// are off; booking pages already live without one get a warning period
// (organizations.privacy_notice_due_at) and close when it ends. Everything here is synthetic.

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

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
  ]);
  return id;
}

async function firm(options: { sample?: boolean } = {}) {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const slug = `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", slug]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = $2, timezone = $3 where id = $1`, [orgId, options.sample ?? false, TZ]);
  const host = await createUser("host");
  const hostMembership = (
    await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, 'licensed_consultant', 'active', now()) returning id`,
      [orgId, host],
    )
  ).rows[0].id;
  const manager = await createUser("manager");
  await db.query(`insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, 'case_manager', 'active', now())`, [orgId, manager]);
  await asUser(db, { userId: host, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [orgId, hostMembership, TZ, JSON.stringify(EVERY_DAY)]);
  return { orgId, slug, owner, host, hostMembership, manager };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const asOwner = (ctx: Firm, totpAgeSeconds = 0) => asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds });

async function publishNotice(ctx: Firm, label = "1") {
  await asOwner(ctx);
  await db.query(`select public.publish_portal_policy('privacy_notice', $1, 'Privacy notice', 'Synthetic Firm is responsible for this notice.')`, [label]);
}

async function saveType(ctx: Firm, publish: boolean, id: string | null = null) {
  await asOwner(ctx);
  const row = await db.query<{ id: string }>(
    `select public.save_booking_event_type($1, $2, null, 'Initial consultation', 'initial', null, 30, null, 0, 0, 60, 60, null,
       'video', null, $3::uuid[], $4) as id`,
    [ctx.orgId, id, [ctx.hostMembership], publish],
  );
  return row.rows[0].id;
}

/** A booking page that was live before #263-A: published directly, as the old rule allowed. */
async function legacyLiveType(ctx: Firm) {
  const id = await saveType(ctx, false);
  await asMaintenance(db);
  await db.query(`update public.booking_event_types set is_published = true where id = $1`, [id]);
  return id;
}

async function setEnquiry(ctx: Firm, enabled: boolean) {
  await asOwner(ctx);
  await db.query(`select public.set_enquiry_page_enabled($1, $2)`, [ctx.orgId, enabled]);
}

async function unpublish(ctx: Firm) {
  await db.query(`select public.unpublish_privacy_notice($1)`, [ctx.orgId]);
}

async function publicNotice(slug: string) {
  await asAnon(db);
  return (await db.query<{ r: Record<string, unknown> | null }>(`select public.public_privacy_notice($1) as r`, [slug])).rows[0].r;
}

async function publicTypes(slug: string) {
  await asAnon(db);
  return (await db.query<{ r: { types: unknown[]; held: boolean } }>(`select public.booking_public_event_types($1) as r`, [slug])).rows[0].r;
}

async function publicEvent(slug: string) {
  await asAnon(db);
  return (await db.query<{ r: Record<string, unknown> | null }>(`select public.booking_public_event($1, 'initial') as r`, [slug])).rows[0].r;
}

async function localStart(days: number): Promise<string> {
  await asMaintenance(db);
  const row = await db.query<{ at: string }>(
    `select to_char(app.local_instant((now() at time zone $1)::date + $2::integer, '10:00'::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
    [TZ, days],
  );
  return row.rows[0].at;
}

async function hold(ctx: Firm, start: string) {
  await asAnon(db);
  const row = await db.query<{ r: { status?: string; error?: string } }>(
    `select public.booking_public_hold($1, 'initial', $2::timestamptz, 'Sam Example', 'sam@example.test', null, 'America/Vancouver', $3, null) as r`,
    [ctx.slug, start, randomUUID()],
  );
  return row.rows[0].r;
}

async function setDue(ctx: Firm, interval: string | null) {
  await asMaintenance(db);
  await db.query(`update public.organizations set privacy_notice_due_at = case when $2::text is null then null else now() + $2::interval end where id = $1`, [ctx.orgId, interval]);
}

describe("turning public pages on needs a published privacy notice", () => {
  it("refuses to turn the enquiry page on without one, and allows it once published", async () => {
    const ctx = await firm();
    await setEnquiry(ctx, false);
    await expectDbError(() => setEnquiry(ctx, true), /publish a privacy notice before you turn on the enquiry page/);
    await publishNotice(ctx);
    await setEnquiry(ctx, true);
    await asMaintenance(db);
    expect((await db.query<{ on: boolean }>(`select enquiry_page_enabled as on from public.organizations where id = $1`, [ctx.orgId])).rows[0].on).toBe(true);
  });

  it("refuses to publish a booking page without one; an unpublished type saves, and publishes after the notice", async () => {
    const ctx = await firm();
    await expectDbError(() => saveType(ctx, true), /publish a privacy notice before you publish a booking page/);
    const id = await saveType(ctx, false);
    await expectDbError(() => saveType(ctx, true, id), /publish a privacy notice before you publish a booking page/);
    await publishNotice(ctx);
    await saveType(ctx, true, id);
    expect(await publicEvent(ctx.slug)).toMatchObject({ title: "Initial consultation", privacy_notice: true });
  });

  it("lets a sample-mode firm publish a practice page without one (only its staff can open it)", async () => {
    const ctx = await firm({ sample: true });
    await saveType(ctx, true);
    await asMaintenance(db);
    expect((await db.query<{ s: boolean; p: boolean }>(`select is_sample as s, is_published as p from public.booking_event_types where organization_id = $1`, [ctx.orgId])).rows).toEqual([{ s: true, p: true }]);
  });

  it("lets a page that was already live be edited and kept live during the warning period", async () => {
    const ctx = await firm();
    const id = await legacyLiveType(ctx);
    await setDue(ctx, "30 days");
    await saveType(ctx, true, id);
    // Taking it off and on again is turning it on: refused until the notice is published.
    await saveType(ctx, false, id);
    await expectDbError(() => saveType(ctx, true, id), /publish a privacy notice before you publish a booking page/);
  });
});

describe("the warning period for booking pages live without a notice", () => {
  it("keeps the pages open before the date, closes them after it, and reopens them when a notice is published", async () => {
    const ctx = await firm();
    const id = await legacyLiveType(ctx);

    await setDue(ctx, "30 days");
    expect(await publicTypes(ctx.slug)).toMatchObject({ types: [expect.objectContaining({ slug: "initial" })], held: false });
    expect(await publicEvent(ctx.slug)).toMatchObject({ title: "Initial consultation", privacy_notice: false });
    expect(await hold(ctx, await localStart(3))).toMatchObject({ status: "confirmed" });

    await setDue(ctx, "-1 minute");
    expect(await publicTypes(ctx.slug)).toEqual({ firm_name: "Synthetic Firm", firm_slug: ctx.slug, types: [], held: true });
    expect(await publicEvent(ctx.slug)).toBeNull();
    await asAnon(db);
    await expectDbError(() => db.query(`select public.booking_public_busy($1, now(), now() + interval '7 days')`, [id]), /booking type not found/);
    await expectDbError(() => hold(ctx, "2099-01-01T15:00:00Z"), /booking type not found/);
    // Nothing was switched off: the type is still published, and the booking made stays.
    await asMaintenance(db);
    expect((await db.query<{ p: boolean }>(`select is_published as p from public.booking_event_types where id = $1`, [id])).rows[0].p).toBe(true);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.bookings where organization_id = $1 and status = 'confirmed'`, [ctx.orgId])).rows[0].n).toBe(1);

    await publishNotice(ctx);
    expect(await publicTypes(ctx.slug)).toMatchObject({ types: [expect.objectContaining({ slug: "initial" })], held: false });
    expect(await publicEvent(ctx.slug)).toMatchObject({ privacy_notice: true });
  });

  it("closes a live page with no warning period at once, and leaves a firm with no live pages unheld", async () => {
    const ctx = await firm();
    expect(await publicTypes(ctx.slug)).toMatchObject({ types: [], held: false });
    await legacyLiveType(ctx);
    expect(await publicTypes(ctx.slug)).toMatchObject({ types: [], held: true });
  });

  it("keeps the helpers private", async () => {
    const ctx = await firm();
    await asOwner(ctx);
    await expectDbError(() => db.query(`select app.firm_booking_pages_open($1)`, [ctx.orgId]), /permission denied/);
    await expectDbError(() => db.query(`select app.firm_privacy_notice_published($1)`, [ctx.orgId]), /permission denied/);
    await asAnon(db);
    await expectDbError(() => db.query(`select public.unpublish_privacy_notice($1)`, [ctx.orgId]), /permission denied/);
  });
});

describe("unpublish_privacy_notice", () => {
  it("is for the firm owner with a recent step-up, in their own firm", async () => {
    const ctx = await firm();
    const other = await firm();
    await publishNotice(ctx);
    await setEnquiry(ctx, false);
    await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => unpublish(ctx), /firm owner step-up is required/);
    await asUser(db, { userId: ctx.host, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => unpublish(ctx), /firm owner step-up is required/);
    await asOwner(ctx, 3600);
    await expectDbError(() => unpublish(ctx), /firm owner step-up is required/);
    await asUser(db, { userId: other.owner, aal: "aal2", orgId: other.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => unpublish(ctx), /firm owner step-up is required/);
    expect(await publicNotice(ctx.slug)).toMatchObject({ title: "Privacy notice" });
  });

  it("is refused while the enquiry page or a live booking page is on, or when nothing is published", async () => {
    const ctx = await firm();
    await asOwner(ctx);
    await expectDbError(() => unpublish(ctx), /no privacy notice is published/);
    await publishNotice(ctx);
    const id = await saveType(ctx, true);
    await asOwner(ctx);
    await expectDbError(() => unpublish(ctx), /turn off the enquiry page and booking pages/);
    await setEnquiry(ctx, false);
    await asOwner(ctx);
    await expectDbError(() => unpublish(ctx), /turn off the enquiry page and booking pages/);
    await saveType(ctx, false, id);
    await asOwner(ctx);
    await unpublish(ctx);
    expect(await publicNotice(ctx.slug)).toBeNull();
  });

  it("takes the notice off its public page and the portal, is audited, keeps every version, and a new version restores it", async () => {
    const ctx = await firm();
    await publishNotice(ctx, "1");
    await setEnquiry(ctx, false);
    await asOwner(ctx);
    await unpublish(ctx);

    expect(await publicNotice(ctx.slug)).toBeNull();
    await asMaintenance(db);
    expect((await db.query<{ id: string | null }>(`select (app.current_portal_policy($1, 'privacy_notice')).id as id`, [ctx.orgId])).rows[0].id).toBeNull();
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.portal_policy_documents where organization_id = $1`, [ctx.orgId])).rows[0].n).toBe(1);
    const audit = await db.query<{ action: string; context: Record<string, unknown> }>(
      `select action, context from public.audit_log where organization_id = $1 and action in ('portal_policy.published', 'privacy_notice.unpublished') order by occurred_at, action`,
      [ctx.orgId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(["portal_policy.published", "privacy_notice.unpublished"]);
    expect(audit.rows[1].context).toMatchObject({ version_label: "1" });
    // The enquiry page can't come back on, and its public page is gone, until a notice is published.
    await expectDbError(() => setEnquiry(ctx, true), /publish a privacy notice before you turn on the enquiry page/);
    await asAnon(db);
    expect((await db.query<{ r: unknown }>(`select public.enquiry_public_firm($1) as r`, [ctx.slug])).rows[0].r).toBeNull();
    await asOwner(ctx);
    await expectDbError(() => unpublish(ctx), /no privacy notice is published/);

    await publishNotice(ctx, "2");
    expect(await publicNotice(ctx.slug)).toMatchObject({ version_label: "2" });
    await setEnquiry(ctx, true);
  });

  it("can't be forged: the withdrawal and the warning period are not writable through the API", async () => {
    const ctx = await firm();
    await asOwner(ctx);
    await expectDbError(
      () => db.query(`update public.organizations set privacy_notice_withdrawn_at = now(), privacy_notice_due_at = now() + interval '1 year' where id = $1`, [ctx.orgId]),
      /permission denied/,
    );
  });
});
