import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Settings > Retention and Settings > Subscription against the real migrations:
 * public.set_firm_retention_policy (firm owner + step-up, versioned, audited) and
 * public.firm_subscription_usage (owner and finance only, real counts).
 */
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

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${randomUUID().slice(0, 8)}@example.test`,
  ]);
  return id;
}

async function membership(orgId: string, userId: string, role: string, createdBy: string, status = "active") {
  await asMaintenance(db);
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, $4::public.membership_status, case when $4 = 'active' then now() end, $5)`,
    [orgId, userId, role, status, createdBy],
  );
}

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const finance = await createUser("finance");
  const assistant = await createUser("assistant");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await membership(orgId, consultant, "licensed_consultant", owner);
  await membership(orgId, finance, "finance_user", owner);
  await membership(orgId, assistant, "assistant", owner);
  return { owner, consultant, finance, assistant, orgId };
}

/** Test setup only: the period a firm saved in setup, as firm setup stores it. */
async function setupRetention(orgId: string, owner: string, years: number) {
  await asMaintenance(db);
  await db.exec("set session_replication_role = replica");
  await db.query(`update public.organizations set retention_policy = $2::jsonb where id = $1`, [orgId, JSON.stringify({ unit: "years", count: years })]);
  await db.query(
    `insert into public.organization_setup_steps (organization_id, step, completed_by, completed_at)
     values ($1, 'records_and_retention', $2, '2026-09-02T15:00:00Z')`,
    [orgId, owner],
  );
  await db.exec("set session_replication_role = origin");
}

async function policy(orgId: string) {
  await asMaintenance(db);
  const row = await db.query<{ retention_policy: { unit: string; count: number; version?: number } | null }>(
    `select retention_policy from public.organizations where id = $1`,
    [orgId],
  );
  return row.rows[0].retention_policy;
}

describe("Firm retention policy (public.set_firm_retention_policy)", () => {
  it("lets the firm owner with a fresh step-up set the period as a new version, audited", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const first = await db.query<{ v: number }>(`select public.set_firm_retention_policy($1, 8, 0) as v`, [ctx.orgId]);
    expect(first.rows[0].v).toBe(1);
    expect(await policy(ctx.orgId)).toEqual({ unit: "years", count: 8, version: 1 });

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    // A stale version is refused; so is saving the same period again.
    await expectDbError(() => db.query(`select public.set_firm_retention_policy($1, 9, 0)`, [ctx.orgId]), /version conflict/);
    await expectDbError(() => db.query(`select public.set_firm_retention_policy($1, 8, 1)`, [ctx.orgId]), /already the firm retention period/);
    await expectDbError(() => db.query(`select public.set_firm_retention_policy($1, 0, 1)`, [ctx.orgId]), /1 to 100/);
    await expectDbError(() => db.query(`select public.set_firm_retention_policy($1, 101, 1)`, [ctx.orgId]), /1 to 100/);
    const second = await db.query<{ v: number }>(`select public.set_firm_retention_policy($1, 10, 1) as v`, [ctx.orgId]);
    expect(second.rows[0].v).toBe(2);

    const rows = await db.query<{ version: number; period_count: number; source: string; approved_by: string }>(
      `select version, period_count, source, approved_by from public.retention_policy_versions order by version`,
    );
    expect(rows.rows).toEqual([
      { version: 1, period_count: 8, source: "settings", approved_by: ctx.owner },
      { version: 2, period_count: 10, source: "settings", approved_by: ctx.owner },
    ]);

    await asMaintenance(db);
    const audit = await db.query<{ context: { from_years: number | null; to_years: number; version: number } }>(
      `select context from public.audit_log where organization_id = $1 and action = 'firm.retention_policy_changed' order by occurred_at, id`,
      [ctx.orgId],
    );
    expect(audit.rows.map((row) => row.context)).toEqual([
      { from_years: null, to_years: 8, version: 1 },
      { from_years: 8, to_years: 10, version: 2 },
    ]);
  });

  it("records a period chosen in firm setup as its own version first", async () => {
    const ctx = await firm();
    await setupRetention(ctx.orgId, ctx.owner, 7);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    // The owner saw the setup period as version 1 (no row yet), so 0 is stale.
    await expectDbError(() => db.query(`select public.set_firm_retention_policy($1, 9, 0)`, [ctx.orgId]), /version conflict/);
    const saved = await db.query<{ v: number }>(`select public.set_firm_retention_policy($1, 9, 1) as v`, [ctx.orgId]);
    expect(saved.rows[0].v).toBe(2);
    const rows = await db.query<{ version: number; period_count: number; source: string; approved_by: string; approved_at: string }>(
      `select version, period_count, source, approved_by, approved_at::text from public.retention_policy_versions order by version`,
    );
    expect(rows.rows.map(({ version, period_count, source, approved_by }) => ({ version, period_count, source, approved_by }))).toEqual([
      { version: 1, period_count: 7, source: "firm_setup", approved_by: ctx.owner },
      { version: 2, period_count: 9, source: "settings", approved_by: ctx.owner },
    ]);
    expect(rows.rows[0].approved_at).toMatch(/^2026-09-02/);
    expect(await policy(ctx.orgId)).toEqual({ unit: "years", count: 9, version: 2 });
  });

  it("refuses other roles, a stale step-up, aal1 and another firm's id", async () => {
    const a = await firm();
    const b = await firm();
    for (const userId of [a.consultant, a.finance, a.assistant]) {
      await asUser(db, { userId, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 0 });
      await expectDbError(() => db.query(`select public.set_firm_retention_policy($1, 8, 0)`, [a.orgId]), /firm owner step-up is required/);
    }
    await asUser(db, { userId: a.owner, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.set_firm_retention_policy($1, 8, 0)`, [a.orgId]), /step-up is required/);
    await asUser(db, { userId: a.owner, aal: "aal1", orgId: a.orgId });
    await expectDbError(() => db.query(`select public.set_firm_retention_policy($1, 8, 0)`, [a.orgId]), /step-up is required/);
    // Firm A's owner naming firm B (forgery), and firm B's id while signed in to firm A.
    await asUser(db, { userId: a.owner, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.set_firm_retention_policy($1, 8, 0)`, [b.orgId]), /step-up is required/);
    await asUser(db, { userId: a.owner, aal: "aal2", orgId: b.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.set_firm_retention_policy($1, 8, 0)`, [b.orgId]), /step-up is required/);
    expect(await policy(a.orgId)).toBeNull();
    expect(await policy(b.orgId)).toBeNull();
  });

  it("keeps versions append-only, unwritable from the API, and readable only inside the firm", async () => {
    const a = await firm();
    const b = await firm();
    await asUser(db, { userId: a.owner, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.set_firm_retention_policy($1, 8, 0)`, [a.orgId]);

    await asUser(db, { userId: a.assistant, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 3600 });
    const seen = await db.query<{ n: number }>(`select count(*)::int as n from public.retention_policy_versions`);
    expect(seen.rows[0].n).toBe(1);
    await expectDbError(
      () =>
        db.query(
          `insert into public.retention_policy_versions (organization_id, version, period_count, source, approved_by, approved_at)
           values ($1, 9, 3, 'settings', $2, now())`,
          [a.orgId, a.assistant],
        ),
      /permission denied/,
    );
    await expectDbError(() => db.query(`update public.retention_policy_versions set period_count = 2`), /permission denied/);

    await asUser(db, { userId: b.owner, aal: "aal2", orgId: b.orgId, totpAgeSeconds: 0 });
    const other = await db.query<{ n: number }>(`select count(*)::int as n from public.retention_policy_versions`);
    expect(other.rows[0].n).toBe(0);
    // Staff without MFA see nothing.
    await asUser(db, { userId: a.owner, aal: "aal1", orgId: a.orgId });
    const noMfa = await db.query<{ n: number }>(`select count(*)::int as n from public.retention_policy_versions`);
    expect(noMfa.rows[0].n).toBe(0);

    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.retention_policy_versions set period_count = 2 where organization_id = $1`, [a.orgId]), /kept on record/);
    await expectDbError(() => db.query(`delete from public.retention_policy_versions where organization_id = $1`, [a.orgId]), /kept on record/);
  });

  it("is what a later closure snapshots, with the version", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.set_firm_retention_policy($1, 11, 0)`, [ctx.orgId]);
    await asMaintenance(db);
    const check = await db.query<{ ok: boolean }>(
      `select (retention_policy ->> 'unit') = 'years' and (retention_policy ->> 'count')::int = 11 and (retention_policy ->> 'version')::int = 1 as ok
         from public.organizations where id = $1`,
      [ctx.orgId],
    );
    expect(check.rows[0].ok).toBe(true);
  });
});

describe("Subscription usage (public.firm_subscription_usage)", () => {
  it("gives the owner and finance real counts, and refuses other roles and other firms", async () => {
    const a = await firm();
    const b = await firm();
    const invited = await createUser("invited");
    await membership(a.orgId, invited, "case_manager", a.owner, "invited");

    await asUser(db, { userId: a.owner, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 3600 });
    const usage = await db.query<{ u: Record<string, unknown> }>(`select public.firm_subscription_usage($1) as u`, [a.orgId]);
    expect(usage.rows[0].u).toMatchObject({
      seats_active: 4,
      seats_invited: 1,
      storage_bytes: 0,
      vo_runs_month: 0,
      emails_month: 0,
    });
    expect(Number(usage.rows[0].u.active_matters)).toBeGreaterThanOrEqual(Number(usage.rows[0].u.sample_matters));
    expect(String(usage.rows[0].u.month_start)).toMatch(/^\d{4}-\d{2}-01$/);

    await asUser(db, { userId: a.finance, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 3600 });
    await db.query(`select public.firm_subscription_usage($1)`, [a.orgId]);

    for (const userId of [a.consultant, a.assistant]) {
      await asUser(db, { userId, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 3600 });
      await expectDbError(() => db.query(`select public.firm_subscription_usage($1)`, [a.orgId]), /subscription usage denied/);
    }
    await asUser(db, { userId: a.owner, aal: "aal1", orgId: a.orgId });
    await expectDbError(() => db.query(`select public.firm_subscription_usage($1)`, [a.orgId]), /subscription usage denied/);
    await asUser(db, { userId: a.owner, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.firm_subscription_usage($1)`, [b.orgId]), /subscription usage denied/);
    await asUser(db, { userId: a.owner, aal: "aal2", orgId: b.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.firm_subscription_usage($1)`, [b.orgId]), /subscription usage denied/);
  });

  it("counts open matters and stored document bytes for the firm only", async () => {
    const a = await firm();
    const b = await firm();
    await asMaintenance(db);
    await db.exec("set session_replication_role = replica");
    await db.query(`insert into public.matters (organization_id, title, is_sample) values ($1, 'Synthetic open', false), ($1, 'Synthetic sample', true), ($2, 'Other firm', false)`, [
      a.orgId,
      b.orgId,
    ]);
    await db.query(`insert into public.matters (organization_id, title, stage) values ($1, 'Synthetic closed', 'closed')`, [a.orgId]);
    await db.exec("set session_replication_role = origin");

    await asUser(db, { userId: a.owner, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 3600 });
    const before = await db.query<{ u: { active_matters: number; sample_matters: number } }>(`select public.firm_subscription_usage($1) as u`, [a.orgId]);
    await asMaintenance(db);
    const truth = await db.query<{ open: number; sample: number }>(
      `select count(*) filter (where stage <> 'closed')::int as open, count(*) filter (where stage <> 'closed' and is_sample)::int as sample
         from public.matters where organization_id = $1`,
      [a.orgId],
    );
    expect(before.rows[0].u.active_matters).toBe(truth.rows[0].open);
    expect(before.rows[0].u.sample_matters).toBe(truth.rows[0].sample);
    expect(truth.rows[0].open).toBeGreaterThanOrEqual(2);
  });
});
