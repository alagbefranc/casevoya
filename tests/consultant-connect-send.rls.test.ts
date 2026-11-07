import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// Human Send (20261107170000). Synthetic firms and requests only. No mail.

const STATEMENT =
  "I agree that Casevoya may read my request and share it with one licensed consultant who can help. Nothing is sent until I press Send.";
const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
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

async function firm(options: { sample?: boolean; licence?: boolean; optIn?: boolean } = {}) {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const slug = `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", slug]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = $2 where id = $1`, [orgId, options.sample ?? false]);
  if (options.licence !== false) {
    const consultant = await createUser("consultant");
    const consultantMembership = await membership(orgId, consultant, "licensed_consultant");
    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const credential = await db.query<{ id: string }>(
      `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
      [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
    );
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(
      `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, $3, $4, false, false, null, $5, 'Synthetic reviewer note')`,
      [credential.rows[0].id, REGISTER, true, false, PROOF],
    );
  }
  if (options.optIn !== false) {
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(`select public.set_accept_find_introductions(true)`);
  }
  return { orgId, owner };
}

async function admin(role = "operator") {
  const id = await createUser("admin");
  await asMaintenance(db);
  await db.query(`insert into public.platform_admins (user_id, role) values ($1, $2)`, [id, role]);
  return id;
}

async function request(email = "rohan@example.com") {
  await asServiceRole(db);
  const hash = createHash("sha256").update(randomUUID()).digest("hex");
  const row = await db.query<{ id: string }>(
    `select public.submit_consultant_connect(
       'Study in Canada', 'Nigeria', 'NG', 'Africa/Lagos', 'English', 'Rohan Adeyemi', $1,
       true, $2, 'find-consent-2026-11-07', $3, 'vitest'
     ) as id`,
    [email, STATEMENT, hash],
  );
  return row.rows[0].id;
}

async function send(requestId: string, orgId: string, adminId: string) {
  await asServiceRole(db);
  const row = await db.query<{ result: { lead_id: string; status: string; replayed: boolean; organization_id: string } }>(
    `select public.platform_send_consultant_connect($1, $2, $3) as result`,
    [requestId, orgId, adminId],
  );
  return row.rows[0].result;
}

async function counts(orgId: string) {
  await asMaintenance(db);
  const outbox = await db.query<{ n: number }>(`select count(*)::int as n from public.outbox_events where organization_id = $1`, [orgId]);
  const mail = await db.query<{ n: number }>(`select count(*)::int as n from public.email_deliveries where organization_id = $1`, [orgId]);
  const leads = await db.query<{ n: number }>(`select count(*)::int as n from public.leads where organization_id = $1`, [orgId]);
  return { outbox: outbox.rows[0].n, mail: mail.rows[0].n, leads: leads.rows[0].n };
}

describe("platform_send_consultant_connect", () => {
  it("creates one lead for one opted-in firm and a repeat does not create another", async () => {
    const ctx = await firm();
    const operator = await admin();
    const id = await request();
    const before = await counts(ctx.orgId);
    const first = await send(id, ctx.orgId, operator);
    const again = await send(id, ctx.orgId, operator);
    expect(first.replayed).toBe(false);
    expect(again).toMatchObject({ replayed: true, lead_id: first.lead_id, organization_id: ctx.orgId, status: "Sent" });
    await asMaintenance(db);
    const stored = await db.query<{ status: string; lead_id: string; source: string; email: string; via: string }>(
      `select r.status, r.lead_id, l.source::text, l.email, c.captured_via as via
         from public.consultant_connect_requests r
         join public.leads l on l.id = r.lead_id
         join public.lead_consents c on c.lead_id = l.id
        where r.id = $1`,
      [id],
    );
    expect(stored.rows).toEqual([
      { status: "Sent", lead_id: first.lead_id, source: "other", email: "rohan@example.com", via: "find" },
    ]);
    const after = await counts(ctx.orgId);
    expect(after.leads).toBe(before.leads + 1);
    expect(after.outbox).toBe(before.outbox);
    expect(after.mail).toBe(before.mail);
  });

  it("refuses a second firm and leaves the first lead in place", async () => {
    const first = await firm();
    const second = await firm();
    const operator = await admin();
    const id = await request("ada@example.com");
    const sent = await send(id, first.orgId, operator);
    await expectDbError(() => send(id, second.orgId, operator), /already sent to another firm/);
    await asMaintenance(db);
    const leads = await db.query<{ n: number }>(`select count(*)::int as n from public.leads where submission_key = $1`, [`find:${id}`]);
    const row = await db.query<{ organization_id: string; lead_id: string }>(
      `select organization_id, lead_id from public.consultant_connect_requests where id = $1`,
      [id],
    );
    expect(leads.rows[0].n).toBe(1);
    expect(row.rows[0]).toEqual({ organization_id: first.orgId, lead_id: sent.lead_id });
  });

  it("refuses a firm that is not opted in, a sample firm, and a firm with no verified licence", async () => {
    const closed = await firm({ optIn: false });
    const sample = await firm({ sample: true });
    const unlicensed = await firm({ licence: false });
    const operator = await admin();
    for (const ctx of [closed, sample, unlicensed]) {
      const id = await request(`p-${ctx.orgId.slice(0, 8)}@example.com`);
      await expectDbError(() => send(id, ctx.orgId, operator), /not accepting introductions|Sample firms|no verified licence/);
      await asMaintenance(db);
      const row = await db.query<{ status: string }>(`select status from public.consultant_connect_requests where id = $1`, [id]);
      const leads = await db.query<{ n: number }>(`select count(*)::int as n from public.leads where organization_id = $1`, [ctx.orgId]);
      expect(row.rows[0].status).toBe("New");
      expect(leads.rows[0].n).toBe(0);
    }
  });

  it("refuses a viewer, an anonymous caller, and a consultant opting the firm in", async () => {
    const ctx = await firm();
    const viewer = await admin("viewer");
    const id = await request("viewer-case@example.com");
    await expectDbError(() => send(id, ctx.orgId, viewer), /platform operator/);
    await expectDbError(async () => {
      await asAnon(db);
      await db.query(`select public.platform_send_consultant_connect($1, $2, $3)`, [id, ctx.orgId, viewer]);
    }, /permission denied|42501/i);
    await expectDbError(async () => {
      await asAnon(db);
      await db.query(`select public.platform_consultant_connect_requests('new', 10, 0)`);
    }, /permission denied|42501/i);
    const consultant = await createUser("other");
    await membership(ctx.orgId, consultant, "licensed_consultant");
    await expectDbError(async () => {
      await asUser(db, { userId: consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
      await db.query(`select public.set_accept_find_introductions(false)`);
    }, /42501|firm owner|step-up|denied/i);
    await asMaintenance(db);
    const still = await db.query<{ status: string }>(`select status from public.consultant_connect_requests where id = $1`, [id]);
    expect(still.rows[0].status).toBe("New");
  });

  it("lists New rows for the service role without the address hash", async () => {
    const id = await request("listed@example.com");
    await asServiceRole(db);
    const page = await db.query<{ result: { items: { id: string; email: string; status: string }[]; counts: { new: number } } }>(
      `select public.platform_consultant_connect_requests('new', 50, 0) as result`,
    );
    const item = page.rows[0].result.items.find((row) => row.id === id);
    expect(item).toMatchObject({ status: "New", email: "listed@example.com" });
    expect(JSON.stringify(item)).not.toContain("ip_hash");
    expect(page.rows[0].result.counts.new).toBeGreaterThan(0);
    const firms = await db.query<{ result: { items: { id: string }[] } }>(`select public.platform_find_introduction_firms() as result`);
    expect(firms.rows[0].result.items.length).toBeGreaterThan(0);
  });
});

describe("set_accept_find_introductions", () => {
  async function flag(orgId: string) {
    await asMaintenance(db);
    const row = await db.query<{ on: boolean }>(`select accept_find_introductions as on from public.organizations where id = $1`, [orgId]);
    return row.rows[0].on;
  }

  it("lets a firm owner with a fresh step-up turn it on and off, and keeps the flag when the check is stale or the person is not the owner", async () => {
    const ctx = await firm({ optIn: false });
    expect(await flag(ctx.orgId)).toBe(false);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.set_accept_find_introductions(true)`);
    expect(await flag(ctx.orgId)).toBe(true);

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.set_accept_find_introductions(false)`), /step-up/i);
    expect(await flag(ctx.orgId)).toBe(true);

    const consultant = await createUser("staff");
    await membership(ctx.orgId, consultant, "licensed_consultant");
    await asUser(db, { userId: consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.set_accept_find_introductions(false)`), /step-up|42501/i);
    expect(await flag(ctx.orgId)).toBe(true);

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.set_accept_find_introductions(false)`);
    expect(await flag(ctx.orgId)).toBe(false);
    const leads = await db.query<{ n: number }>(`select count(*)::int as n from public.leads where organization_id = $1`, [ctx.orgId]);
    const mail = await db.query<{ n: number }>(`select count(*)::int as n from public.email_deliveries where organization_id = $1`, [ctx.orgId]);
    expect(leads.rows[0].n).toBe(0);
    expect(mail.rows[0].n).toBe(0);
  });
});

describe("send before the migration", () => {
  it("has no send function when 20261107170000 has not been applied", async () => {
    const early = await createTestDb({ stopBefore: "20261107170000" });
    try {
      await asServiceRole(early);
      await expectDbError(
        () => early.query(`select public.platform_send_consultant_connect(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())`),
        /does not exist|42883/i,
      );
      const hash = createHash("sha256").update("early").digest("hex");
      const stored = await early.query<{ id: string | null }>(
        `select public.submit_consultant_connect(
           'Study in Canada', 'Nigeria', 'NG', 'Africa/Lagos', 'English', 'Rohan', 'early@example.com',
           true, $1, 'find-consent-2026-11-07', $2, 'vitest'
         ) as id`,
        [STATEMENT, hash],
      );
      expect(stored.rows[0].id).toBeTruthy();
    } finally {
      await early.close();
    }
  }, 180_000);
});
