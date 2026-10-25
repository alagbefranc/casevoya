import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261025360000: ADM-04 service-level report. Platform admins (or the service role naming one)
// record support response times; the firm's owner reads their own firm's monthly report, a
// platform admin any firm's (audited); uptime is never computed. Synthetic people only.

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

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function as(userId: string, orgId: string, aal: "aal1" | "aal2" = "aal2") {
  await asUser(db, { userId, aal, orgId, totpAgeSeconds: 0 });
}

async function user(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `${label}-${tag()}@example.test`]);
  return id;
}

async function platformAdmin() {
  const id = await user("admin");
  await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'Synthetic support')`, [id]);
  return id;
}

async function firm(timezone = "America/Toronto") {
  const owner = await user("owner");
  const consultant = await user("consultant");
  await as(owner, "");
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set timezone = $2 where id = $1`, [orgId, timezone]);
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, 'licensed_consultant', 'active', now(), $3)`,
    [orgId, consultant, owner],
  );
  return { orgId, owner, consultant };
}

/** A timestamp relative to the database clock, e.g. "-3 hours". */
async function ago(offset: string) {
  await asMaintenance(db);
  return (await db.query<{ at: string }>(`select (statement_timestamp() + $1::interval)::text as at`, [offset])).rows[0].at;
}

async function record(input: { orgId: string; ticket: string; received: string; responded: string | null; admin: string }) {
  await asServiceRole(db);
  return (
    await db.query<{ id: string }>(`select public.record_support_response($1, $2, $3::timestamptz, $4::timestamptz, $5) as id`, [
      input.orgId,
      input.ticket,
      input.received,
      input.responded,
      input.admin,
    ])
  ).rows[0].id;
}

type Report = {
  timezone: string;
  uptime: { measured: boolean };
  months: { month: string; support: { received: number; answered: number; waiting: number; median_seconds: number | null; longest_seconds: number | null } }[];
};

async function report(orgId: string, months = 6) {
  return (await db.query<{ report: Report }>(`select public.service_level_report($1, $2) as report`, [orgId, months])).rows[0].report;
}

async function audits(orgId: string, action: string) {
  await asMaintenance(db);
  return (await db.query<{ context: Record<string, unknown>; actor_type: string }>(`select context, actor_type from public.audit_log where organization_id = $1 and action = $2`, [orgId, action])).rows;
}

describe("Recording support response times", () => {
  it("lets a platform admin at aal2, or the service role naming one, record and correct; audited", async () => {
    const f = await firm();
    const admin = await platformAdmin();
    const received = await ago("-3 hours");
    const responded = await ago("-2 hours");

    await as(admin, "");
    const id = (
      await db.query<{ id: string }>(`select public.record_support_response($1, 'CS-1', $2::timestamptz, null, null) as id`, [f.orgId, received])
    ).rows[0].id;
    const recorded = await audits(f.orgId, "service_level.support_response_recorded");
    expect(recorded).toHaveLength(1);
    expect(recorded[0].context).toMatchObject({ ticket_ref: "CS-1", recorded_by: admin });

    // The same ticket again (service role naming the admin) sets the first reply: same row, audited.
    expect(await record({ orgId: f.orgId, ticket: "CS-1", received, responded, admin })).toBe(id);
    const updated = await audits(f.orgId, "service_level.support_response_updated");
    expect(updated).toHaveLength(1);
    expect(updated[0].context).toMatchObject({ ticket_ref: "CS-1", previous_first_response_at: null });
    // Unchanged values are a no-op.
    expect(await record({ orgId: f.orgId, ticket: "CS-1", received, responded, admin })).toBe(id);
    expect(await audits(f.orgId, "service_level.support_response_updated")).toHaveLength(1);
  });

  it("refuses firm staff, a platform admin without two-step, the service role naming nobody, and bad times", async () => {
    const f = await firm();
    const admin = await platformAdmin();
    const received = await ago("-3 hours");
    const call = `select public.record_support_response($1, 'CS-2', $2::timestamptz, null, $3)`;

    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(call, [f.orgId, received, admin]), /platform admin access denied/);
    await as(f.consultant, f.orgId);
    await expectDbError(() => db.query(call, [f.orgId, received, null]), /platform admin access denied/);
    await as(admin, "", "aal1");
    await expectDbError(() => db.query(call, [f.orgId, received, null]), /platform admin access denied/);
    await asServiceRole(db);
    await expectDbError(() => db.query(call, [f.orgId, received, null]), /name the platform admin/);
    await expectDbError(() => db.query(call, [f.orgId, received, f.owner]), /name the platform admin/);

    const future = await ago("1 day");
    const before = await ago("-4 hours");
    await expectDbError(() => record({ orgId: f.orgId, ticket: "CS-3", received: future, responded: null, admin }), /not in the future/);
    await expectDbError(() => record({ orgId: f.orgId, ticket: "CS-3", received, responded: before, admin }), /after the request/);
    await expectDbError(() => record({ orgId: f.orgId, ticket: " ", received, responded: null, admin }), /ticket reference/);
    await expectDbError(() => record({ orgId: randomUUID(), ticket: "CS-3", received, responded: null, admin }), /does not exist/);
  });

  it("allows no direct writes and keeps each firm's rows to its owners and platform admins", async () => {
    const a = await firm();
    const b = await firm();
    const admin = await platformAdmin();
    await record({ orgId: a.orgId, ticket: "CS-A", received: await ago("-1 hour"), responded: null, admin });

    await as(a.owner, a.orgId);
    expect((await db.query(`select id from public.support_response_records`)).rows).toHaveLength(1);
    await expectDbError(
      () => db.query(`insert into public.support_response_records (organization_id, ticket_ref, received_at, recorded_by_user_id) values ($1, 'X', now(), $2)`, [a.orgId, admin]),
      /permission denied/,
    );
    await expectDbError(() => db.query(`update public.support_response_records set first_response_at = now()`), /permission denied/);
    await as(b.owner, b.orgId);
    expect((await db.query(`select id from public.support_response_records where organization_id = $1`, [a.orgId])).rows).toHaveLength(0);
    await as(a.consultant, a.orgId);
    expect((await db.query(`select id from public.support_response_records`)).rows).toHaveLength(0);
    await as(a.owner, a.orgId, "aal1");
    expect((await db.query(`select id from public.support_response_records`)).rows).toHaveLength(0);
    await as(admin, "");
    expect((await db.query(`select id from public.support_response_records where organization_id = $1`, [a.orgId])).rows).toHaveLength(1);
  });
});

describe("The monthly service-level report", () => {
  it("gives the firm owner median, longest, answered and waiting for their firm; uptime is not measured", async () => {
    const f = await firm();
    const admin = await platformAdmin();
    // This month, in the firm's zone: three answered (10, 30, 60 minutes) and one waiting.
    const start = await ago("-5 minutes");
    await asMaintenance(db);
    const plus = async (minutes: number) =>
      (await db.query<{ at: string }>(`select ($1::timestamptz - make_interval(mins => 70) + make_interval(mins => $2))::text as at`, [start, minutes])).rows[0].at;
    const base = await plus(0);
    await record({ orgId: f.orgId, ticket: "CS-10", received: base, responded: await plus(10), admin });
    await record({ orgId: f.orgId, ticket: "CS-11", received: base, responded: await plus(30), admin });
    await record({ orgId: f.orgId, ticket: "CS-12", received: base, responded: await plus(60), admin });
    await record({ orgId: f.orgId, ticket: "CS-13", received: base, responded: null, admin });

    await as(f.owner, f.orgId);
    const page = await report(f.orgId, 3);
    expect(page.uptime).toEqual({ measured: false });
    expect(page.timezone).toBe("America/Toronto");
    expect(page.months).toHaveLength(3);
    await asMaintenance(db);
    const month = (await db.query<{ m: string }>(`select to_char($1::timestamptz at time zone 'America/Toronto', 'YYYY-MM') as m`, [base])).rows[0].m;
    const current = page.months.find((row) => row.month === month);
    expect(current?.support).toEqual({ received: 4, answered: 3, waiting: 1, median_seconds: 1800, longest_seconds: 3600 });
    const others = page.months.filter((row) => row.month !== month);
    for (const row of others) expect(row.support).toEqual({ received: 0, answered: 0, waiting: 0, median_seconds: null, longest_seconds: null });
    // The owner's own read is not a Casevoya read: nothing audited.
    expect(await audits(f.orgId, "service_level.report_read")).toHaveLength(0);
  });

  it("buckets by month in the firm's timezone", async () => {
    const f = await firm("Pacific/Kiritimati");
    const admin = await platformAdmin();
    await asMaintenance(db);
    const edge = (
      await db.query<{ start: string; before: string; after: string; prev: string; cur: string }>(`
        with b as (select (date_trunc('month', statement_timestamp() at time zone 'Pacific/Kiritimati') at time zone 'Pacific/Kiritimati') as start)
        select start::text,
               (start - interval '1 minute')::text as before,
               (start + interval '1 minute')::text as after,
               to_char((start - interval '1 minute') at time zone 'Pacific/Kiritimati', 'YYYY-MM') as prev,
               to_char((start + interval '1 minute') at time zone 'Pacific/Kiritimati', 'YYYY-MM') as cur
        from b`)
    ).rows[0];
    await record({ orgId: f.orgId, ticket: "CS-20", received: edge.before, responded: null, admin });
    await record({ orgId: f.orgId, ticket: "CS-21", received: edge.after, responded: null, admin });
    await as(f.owner, f.orgId);
    const page = await report(f.orgId, 2);
    expect(page.months.map((row) => row.month)).toEqual([edge.cur, edge.prev]);
    expect(page.months.map((row) => row.support.received)).toEqual([1, 1]);
  });

  it("refuses other firms' owners and non-owners; a platform admin and the service role read any firm, audited", async () => {
    const a = await firm();
    const b = await firm();
    const admin = await platformAdmin();
    await as(b.owner, b.orgId);
    await expectDbError(() => report(a.orgId), /service level report denied/);
    await as(a.consultant, a.orgId);
    await expectDbError(() => report(a.orgId), /service level report denied/);
    await as(a.owner, a.orgId, "aal1");
    await expectDbError(() => report(a.orgId), /service level report denied/);

    await as(admin, "");
    expect((await report(a.orgId)).months).toHaveLength(6);
    await asServiceRole(db);
    expect((await report(a.orgId, 99)).months).toHaveLength(24);
    const reads = await audits(a.orgId, "service_level.report_read");
    expect(reads.map((row) => row.context.by).sort()).toEqual(["platform_admin", "service"]);
    expect(await audits(b.orgId, "service_level.report_read")).toHaveLength(0);
  });
});
