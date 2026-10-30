import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { publishTestPrivacyNotice } from "./helpers/privacy-notice";

// Security review (20261030231500_public_client_hash_server_only): booking_public_hold and
// submit_enquiry are service role only, so the client-address hash always comes from the app
// server; a missing hash shares one bucket; one address cannot fill a firm's cap; practice pages
// still open for the firm's staff named by the server. Everything here is synthetic.

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
const hashOf = (value: string = randomUUID()) => createHash("sha256").update(value).digest("hex");

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
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", slug])).rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = $2 where id = $1`, [orgId, options.sample ?? false]);
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
  return { orgId, slug, owner, host };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function localStart(days: number, time = "10:00"): Promise<string> {
  await asMaintenance(db);
  const row = await db.query<{ at: string }>(
    `select to_char(app.local_instant((now() at time zone $1)::date + $2::integer, $3::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
    [TZ, days, time],
  );
  return row.rows[0].at;
}

const HOLD_10 = `select public.booking_public_hold($1, 'initial', $2::timestamptz, 'Sam Example', 'sam@example.test', null, 'UTC', $3, $4, $5::uuid) as r`;
const HOLD_9 = `select public.booking_public_hold($1, 'initial', $2::timestamptz, 'Sam Example', 'sam@example.test', null, 'UTC', $3, $4) as r`;
const HOLD_11 = `select public.booking_public_hold($1, 'initial', $2::timestamptz, 'Sam Example', 'sam@example.test', null, 'UTC', $3, $4, $5::uuid, $6) as r`;

/** As the service role (the app server), naming the viewer and their session assurance. */
async function hold(ctx: Firm, start: string, hash: string | null, viewer: string | null = null, aal: string | null = viewer ? "aal2" : null) {
  await asServiceRole(db);
  return (await db.query<{ r: { status?: string; error?: string; practice?: boolean; public_ref?: string } }>(HOLD_11, [ctx.slug, start, randomUUID(), hash, viewer, aal])).rows[0].r;
}

const ENQUIRY_ARGS = `$1, 'Wei Zhang', 'wei@example.test', 'email', 'Study', 'China', 'Mandarin', true,
  'Synthetic Firm may use these details to reply to my enquiry', false, null, 'enquiry-v2', 'web_form', $2, $3`;

async function enquire(ctx: Firm, hash: string | null, viewer: string | null = null, aal: string | null = viewer ? "aal2" : null) {
  await asServiceRole(db);
  return (
    await db.query<{ r: { ok?: boolean; error?: string } }>(`select public.submit_enquiry(${ENQUIRY_ARGS}, '{}'::jsonb, $4::uuid, $5::text) as r`, [ctx.slug, randomUUID(), hash, viewer, aal])
  ).rows[0].r;
}

describe("public hold and enquiry: service role only", () => {
  it("refuses anon and signed-in callers on every form, so they cannot choose the hash", async () => {
    const ctx = await firm();
    const start = await localStart(3);
    const callers: [string, () => Promise<void>][] = [
      ["anon", () => asAnon(db)],
      ["authenticated", () => asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 })],
    ];
    for (const [who, as] of callers) {
      await as();
      await expectDbError(() => db.query(HOLD_9, [ctx.slug, start, randomUUID(), hashOf()]), /permission denied/);
      await expectDbError(() => db.query(HOLD_10, [ctx.slug, start, randomUUID(), hashOf(), null]), /permission denied/);
      await expectDbError(() => db.query(`select public.submit_enquiry(${ENQUIRY_ARGS})`, [ctx.slug, randomUUID(), hashOf()]), /permission denied/);
      await expectDbError(() => db.query(`select public.submit_enquiry(${ENQUIRY_ARGS}, '{}'::jsonb)`, [ctx.slug, randomUUID(), hashOf()]), /permission denied/);
      await expectDbError(() => db.query(`select public.submit_enquiry(${ENQUIRY_ARGS}, '{}'::jsonb, null::uuid)`, [ctx.slug, randomUUID(), hashOf()]), /permission denied/);
      await expectDbError(() => db.query(`select public.submit_enquiry(${ENQUIRY_ARGS}, '{}'::jsonb, null::uuid, 'aal2')`, [ctx.slug, randomUUID(), hashOf()]), /permission denied/);
      await asMaintenance(db);
      expect((await db.query(`select 1 from public.booking_hold_attempts where organization_id = $1`, [ctx.orgId])).rows, who).toHaveLength(0);
    }
    // A session without the service role claim is refused inside the function too.
    await asMaintenance(db);
    await expectDbError(() => db.query(HOLD_10, [ctx.slug, start, randomUUID(), hashOf(), null]), /service role only/);
  });

  it("books and takes an enquiry for the service role, on the old and new forms", async () => {
    const ctx = await firm();
    expect(await hold(ctx, await localStart(3), hashOf())).toMatchObject({ status: "confirmed", practice: false });
    const later = await localStart(4);
    await asServiceRole(db);
    expect((await db.query<{ r: { status: string } }>(HOLD_9, [ctx.slug, later, randomUUID(), hashOf()])).rows[0].r).toMatchObject({ status: "confirmed" });
    expect(await enquire(ctx, hashOf())).toEqual({ ok: true });
    await asServiceRole(db);
    expect((await db.query<{ r: unknown }>(`select public.submit_enquiry(${ENQUIRY_ARGS}) as r`, [ctx.slug, randomUUID(), hashOf()])).rows[0].r).toEqual({ ok: true });
  });
});

describe("per-address limits", () => {
  it("limits one address to 8 holds in 10 minutes; another address is unaffected", async () => {
    const ctx = await firm();
    const start = await localStart(5, "20:00"); // outside hours: each call counts, then fails
    const hash = hashOf();
    for (let i = 0; i < 8; i++) expect(await hold(ctx, start, hash)).toEqual({ error: "slot_unavailable" });
    expect(await hold(ctx, start, hash)).toEqual({ error: "booking_rate_limited" });
    expect(await hold(ctx, start, hashOf())).toEqual({ error: "slot_unavailable" });
  });

  it("puts a missing or malformed hash in one shared bucket instead of skipping the limit", async () => {
    const ctx = await firm();
    const start = await localStart(6, "20:00");
    const misses: (string | null)[] = [null, "", "not-a-hash", "ABC", null, "z".repeat(64), null, " "];
    for (const miss of misses) expect(await hold(ctx, start, miss)).toEqual({ error: "slot_unavailable" });
    expect(await hold(ctx, start, null)).toEqual({ error: "booking_rate_limited" });
    expect(await hold(ctx, start, "still-not-a-hash")).toEqual({ error: "booking_rate_limited" });
    await asMaintenance(db);
    const stored = await db.query<{ client_hash: string }>(`select distinct client_hash from public.booking_hold_attempts where organization_id = $1`, [ctx.orgId]);
    expect(stored.rows).toEqual([{ client_hash: "0".repeat(64) }]);
  });

  it("limits one address to 5 enquiries, and buckets a missing hash", async () => {
    const ctx = await firm();
    const hash = hashOf();
    for (let i = 0; i < 5; i++) expect(await enquire(ctx, hash)).toEqual({ ok: true });
    expect(await enquire(ctx, hash)).toEqual({ error: "enquiry_rate_limited" });
    expect(await enquire(ctx, hashOf())).toEqual({ ok: true });
    // The shared bucket for requests without an address also stops at 5 (it may hold earlier
    // rows from this file: it is shared).
    let refused = false;
    for (let i = 0; i < 7 && !refused; i++) refused = (await enquire(ctx, null)).error === "enquiry_rate_limited";
    expect(refused).toBe(true);
  });
});

describe("firm-wide cap", () => {
  it("one address retrying cannot fill the firm's cap; many addresses still reach it", async () => {
    const ctx = await firm();
    const start = await localStart(7, "20:00");
    const noisy = hashOf();
    for (let i = 0; i < 70; i++) await hold(ctx, start, noisy);
    expect(await hold(ctx, start, noisy)).toEqual({ error: "booking_rate_limited" });
    // Others still reach the page.
    expect(await hold(ctx, await localStart(8), hashOf())).toMatchObject({ status: "confirmed" });
    // Eight addresses at their allowance pass the 60 backstop.
    for (let a = 0; a < 7; a++) {
      const h = hashOf();
      for (let i = 0; i < 8; i++) await hold(ctx, start, h);
    }
    expect(await hold(ctx, start, hashOf())).toEqual({ error: "booking_rate_limited" });
  });
});

describe("the viewer named by the server", () => {
  it("opens a practice page only for the firm's staff, and books it as a sample", async () => {
    const ctx = await firm({ sample: true });
    const other = await firm();
    const start = await localStart(3);
    for (const viewer of [null, other.owner, randomUUID()]) {
      await asServiceRole(db);
      await expectDbError(() => db.query(HOLD_10, [ctx.slug, start, randomUUID(), hashOf(), viewer]), /booking type not found/);
    }
    // 20261031017000 (R2-06): staff without staff MFA on their session are not shown the page.
    for (const aal of [null, "aal1", "AAL2", "passkey"]) {
      await asServiceRole(db);
      await expectDbError(() => db.query(HOLD_11, [ctx.slug, start, randomUUID(), hashOf(), ctx.host, aal]), /booking type not found/);
      await expectDbError(() => db.query(HOLD_10, [ctx.slug, start, randomUUID(), hashOf(), ctx.host]), /booking type not found/);
    }
    expect(await hold(ctx, start, hashOf(), ctx.host)).toMatchObject({ status: "confirmed", practice: true });
    expect(await hold(ctx, await localStart(4), hashOf(), ctx.host, "mfa")).toMatchObject({ status: "confirmed", practice: true });
    await asMaintenance(db);
    expect((await db.query<{ is_sample: boolean }>(`select is_sample from public.bookings where organization_id = $1`, [ctx.orgId])).rows).toEqual([{ is_sample: true }, { is_sample: true }]);
  });

  it("links a client with a second step only at the assurance app.session_assurance_ok accepts", async () => {
    const ctx = await firm();
    const client = await createUser("client");
    await asMaintenance(db);
    await db.query(`insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, 'client', 'active', now())`, [ctx.orgId, client]);
    await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', 'verified')`, [randomUUID(), client]);
    const person = (
      await db.query<{ id: string }>(`insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Synthetic Client', 'c2@example.test') returning id`, [
        ctx.orgId,
        client,
      ])
    ).rows[0].id;
    const unassured = await hold(ctx, await localStart(9), hashOf(), client, "aal1");
    const passkey = await hold(ctx, await localStart(10), hashOf(), client, "mfa");
    const totp = await hold(ctx, await localStart(11), hashOf(), client, "aal2");
    await asMaintenance(db);
    const rows = await db.query<{ public_ref: string; person_id: string | null }>(`select public_ref, person_id from public.bookings where organization_id = $1`, [ctx.orgId]);
    const byRef = Object.fromEntries(rows.rows.map((row) => [row.public_ref, row.person_id]));
    expect(byRef[unassured.public_ref!]).toBeNull();
    expect(byRef[passkey.public_ref!]).toBe(person);
    expect(byRef[totp.public_ref!]).toBe(person);
  });

  it("links a signed-in portal client's booking to their own person only", async () => {
    const ctx = await firm();
    const client = await createUser("client");
    await asMaintenance(db);
    await db.query(`insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, 'client', 'active', now())`, [ctx.orgId, client]);
    const person = (
      await db.query<{ id: string }>(`insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Synthetic Client', 'c@example.test') returning id`, [
        ctx.orgId,
        client,
      ])
    ).rows[0].id;
    const linked = await hold(ctx, await localStart(9), hashOf(), client);
    const anonymous = await hold(ctx, await localStart(10), hashOf(), null);
    await asMaintenance(db);
    const rows = await db.query<{ public_ref: string; person_id: string | null }>(`select public_ref, person_id from public.bookings where organization_id = $1`, [ctx.orgId]);
    const byRef = Object.fromEntries(rows.rows.map((row) => [row.public_ref, row.person_id]));
    expect(byRef[linked.public_ref!]).toBe(person);
    expect(byRef[anonymous.public_ref!]).toBeNull();
  });

  it("takes a practice enquiry only from the firm's staff, and names the viewer in the audit row", async () => {
    const ctx = await firm({ sample: true });
    const other = await firm();
    expect(await enquire(ctx, hashOf())).toEqual({ error: "form_unavailable" });
    expect(await enquire(ctx, hashOf(), other.owner)).toEqual({ error: "form_unavailable" });
    // 20261031017000 (R2-06): staff MFA on the visitor's session is required.
    expect(await enquire(ctx, hashOf(), ctx.host, "aal1")).toEqual({ error: "form_unavailable" });
    expect(await enquire(ctx, hashOf(), ctx.host, null)).toEqual({ error: "form_unavailable" });
    await asServiceRole(db);
    expect((await db.query<{ r: unknown }>(`select public.submit_enquiry(${ENQUIRY_ARGS}, '{}'::jsonb, $4::uuid) as r`, [ctx.slug, randomUUID(), hashOf(), ctx.host])).rows[0].r).toEqual({
      error: "form_unavailable",
    });
    expect(await enquire(ctx, hashOf(), ctx.host)).toEqual({ ok: true });
    await asMaintenance(db);
    const audit = await db.query<{ actor_user_id: string; sample: boolean }>(
      `select actor_user_id, (context ->> 'sample')::boolean as sample from public.audit_log where organization_id = $1 and action = 'lead.enquiry_received'`,
      [ctx.orgId],
    );
    expect(audit.rows).toEqual([{ actor_user_id: ctx.host, sample: true }]);
  });

  it("deploy window: before 20261031090000 the 17-argument form still takes a practice enquiry from staff", async () => {
    const ctx = await firm({ sample: true });
    const other = await firm();
    const legacy = (viewer: string | null) =>
      db.query<{ r: unknown }>(`select public.submit_enquiry(${ENQUIRY_ARGS}, '{}'::jsonb, $4::uuid) as r`, [ctx.slug, randomUUID(), hashOf(), viewer]);
    // The 2-argument check as 20261031017000 leaves it (membership only), before 090000 replaces it.
    const windowBody = `create or replace function app.public_viewer_is_staff(p_org uuid, p_viewer uuid)
      returns boolean language sql stable security definer set search_path = '' as $$
        select p_org is not null and p_viewer is not null and exists (
          select 1 from public.memberships m
          where m.organization_id = p_org and m.user_id = p_viewer and m.status = 'active' and m.role = any (app.staff_roles()))
      $$`;
    const finalBody = `create or replace function app.public_viewer_is_staff(p_org uuid, p_viewer uuid)
      returns boolean language sql stable security definer set search_path = '' as $$
        select app.public_viewer_is_staff(p_org, p_viewer, null::text)
      $$`;
    await asMaintenance(db);
    await db.query(windowBody);
    try {
      await asServiceRole(db);
      expect((await legacy(ctx.host)).rows[0].r).toEqual({ ok: true });
      expect((await legacy(other.owner)).rows[0].r).toEqual({ error: "form_unavailable" });
      expect((await legacy(null)).rows[0].r).toEqual({ error: "form_unavailable" });
      // The new form still needs staff MFA when it names an assurance.
      expect(await enquire(ctx, hashOf(), ctx.host, "aal1")).toEqual({ error: "form_unavailable" });
    } finally {
      await asMaintenance(db);
      await db.query(finalBody);
    }
    await asServiceRole(db);
    expect((await legacy(ctx.host)).rows[0].r).toEqual({ error: "form_unavailable" });
  });
});
