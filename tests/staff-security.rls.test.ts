import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// Settings > Team and seats and Security read sign-in security per staff member through
// public.firm_staff_security (20261019212000_firm_staff_security.sql): a firm owner only.

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${id.slice(0, 8)}@example.test`]);
  return id;
}

async function membership(orgId: string, userId: string, role: string, status = "active") {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, revoked_at)
     values ($1, $2, $3::public.org_role, $4::public.membership_status, now(), case when $4 = 'revoked' then now() end)
     returning id`,
    [orgId, userId, role, status],
  );
  return inserted.rows[0].id;
}

async function session(userId: string, opts: { notAfter?: string; createdAgo?: string } = {}) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.sessions (id, user_id, created_at, updated_at, not_after, user_agent, ip)
     values ($1, $2, now() - coalesce($3::interval, interval '0'), now() - coalesce($3::interval, interval '0'), $4::timestamptz, 'Secret Agent', '10.0.0.1')`,
    [id, userId, opts.createdAgo ?? null, opts.notAfter ?? null],
  );
  return id;
}

type Row = { membership_id: string; second_factor: boolean; passkeys: number | null; active_sessions: number | null; last_active_at: string | null };

async function security(userId: string, orgId: string, aal: "aal1" | "aal2" = "aal2") {
  await asUser(db, { userId, aal, orgId, totpAgeSeconds: aal === "aal2" ? 3600 : undefined });
  const result = await db.query<Row>(`select * from public.firm_staff_security($1)`, [orgId]);
  return result.rows;
}

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const assistant = await createUser("assistant");
  const client = await createUser("client");
  const former = await createUser("former");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", slug()]);
  const orgId = created.rows[0].id;
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant");
  const assistantMembership = await membership(orgId, assistant, "assistant", "suspended");
  const clientMembership = await membership(orgId, client, "client");
  const formerMembership = await membership(orgId, former, "case_manager", "revoked");
  await asMaintenance(db);
  await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', 'verified')`, [randomUUID(), consultant]);
  await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', 'unverified')`, [randomUUID(), assistant]);
  await db.query(`insert into auth.webauthn_credentials (id, user_id) values ($1, $2), ($3, $2)`, [randomUUID(), assistant, randomUUID()]);
  return { orgId, owner, consultant, assistant, client, consultantMembership, assistantMembership, clientMembership, formerMembership };
}

describe("firm_staff_security", () => {
  it("gives a firm owner each staff member's second factor, passkeys and open sessions", async () => {
    const ctx = await firm();
    await session(ctx.consultant);
    await session(ctx.consultant, { notAfter: new Date(Date.now() - 60_000).toISOString() });
    const revoked = await session(ctx.consultant);
    await asMaintenance(db);
    await db.query(`insert into public.session_revocations (user_id, session_id, revoked_by) values ($1, $2, $1)`, [ctx.consultant, revoked]);
    const rows = await security(ctx.owner, ctx.orgId);
    const ids = rows.map((row) => row.membership_id);
    expect(ids).toContain(ctx.consultantMembership);
    expect(ids).toContain(ctx.assistantMembership);
    expect(ids).not.toContain(ctx.clientMembership);
    expect(ids).not.toContain(ctx.formerMembership);
    const consultant = rows.find((row) => row.membership_id === ctx.consultantMembership);
    expect(consultant).toMatchObject({ second_factor: true, passkeys: 0, active_sessions: 1 });
    expect(consultant?.last_active_at).not.toBeNull();
    const assistant = rows.find((row) => row.membership_id === ctx.assistantMembership);
    expect(assistant).toMatchObject({ second_factor: false, passkeys: 2, active_sessions: 0, last_active_at: null });
    // Counts and times only: nothing about the device or network.
    expect(JSON.stringify(rows)).not.toMatch(/Secret Agent|10\.0\.0\.1/);
  });

  it("does not count sessions started before an MFA reset cut-off", async () => {
    const ctx = await firm();
    await session(ctx.consultant, { createdAgo: "2 hours" });
    await session(ctx.consultant);
    await asMaintenance(db);
    await db.query(`insert into public.auth_session_cutoffs (user_id, sessions_valid_after) values ($1, now() - interval '1 hour')`, [ctx.consultant]);
    const rows = await security(ctx.owner, ctx.orgId);
    expect(rows.find((row) => row.membership_id === ctx.consultantMembership)?.active_sessions).toBe(1);
  });

  it("refuses staff who are not owners, portal members, another firm's owner and a session without MFA", async () => {
    const ctx = await firm();
    const other = await firm();
    await expectDbError(() => security(ctx.consultant, ctx.orgId), /staff access denied/);
    await expectDbError(() => security(ctx.client, ctx.orgId), /staff access denied/);
    await expectDbError(() => security(other.owner, ctx.orgId), /staff access denied/);
    await expectDbError(() => security(ctx.owner, ctx.orgId, "aal1"), /staff access denied/);
  });

  it("is a definer function with a fixed search path, not callable by anon", async () => {
    await asMaintenance(db);
    const fn = await db.query<{ definer: boolean; config: string[] | null; anon: boolean; authed: boolean }>(
      `select p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'firm_staff_security'`,
    );
    expect(fn.rows[0]).toMatchObject({ definer: true, anon: false, authed: true });
    expect(fn.rows[0].config).toContain('search_path=""');
  });
});
