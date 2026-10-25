import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MONEY_ROLES, OPS_ROLES } from "@/modules/sheet/reports-present";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * REP-03 scheduled reports against the real migrations (20261025320000, 20261025320100): who can
 * schedule and manage, tenant isolation, the recipient recheck at send time, link-only deliveries,
 * once-per-due-time runs, and the in-app 'report' notification.
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

async function createUser(label: string, name: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3::jsonb)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
    JSON.stringify({ display_name: name }),
  ]);
  return id;
}

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  return created.rows[0].id;
}

async function member(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

async function firm() {
  const owner = await createUser("owner", "Synthetic Owner");
  const manager = await createUser("manager", "Synthetic Manager");
  const finance = await createUser("finance", "Synthetic Finance");
  const assistant = await createUser("assistant", "Synthetic Assistant");
  const orgId = await createOrg(owner);
  const managerMembership = await member(orgId, manager, "case_manager", owner);
  await member(orgId, finance, "finance_user", owner);
  await member(orgId, assistant, "assistant", owner);
  return { owner, manager, finance, assistant, orgId, managerMembership };
}
type Firm = Awaited<ReturnType<typeof firm>>;

async function as(userId: string, orgId: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
}

async function save(
  ctx: Firm,
  actor: string,
  input: { tab?: string; recipients: string[]; frequency?: string; weekday?: number | null; monthDay?: number | null; id?: string | null; version?: number | null },
) {
  await as(actor, ctx.orgId);
  const frequency = input.frequency ?? "weekly";
  const result = await db.query<{ id: string }>(
    `select public.save_scheduled_report($1, $2, $3, $4, $5, $6, $7::smallint, $8::smallint, $9::time, $10::uuid[], $11) as id`,
    [
      ctx.orgId,
      input.id ?? null,
      "Monday workload",
      input.tab ?? "ops",
      "90d",
      frequency,
      frequency === "weekly" ? (input.weekday ?? 1) : null,
      frequency === "monthly" ? (input.monthDay ?? 1) : null,
      "08:00",
      input.recipients,
      input.version ?? null,
    ],
  );
  return result.rows[0].id;
}

async function makeDue(id: string) {
  await asMaintenance(db);
  await db.query(`update public.scheduled_reports set next_run_at = statement_timestamp() - interval '1 minute' where id = $1`, [id]);
}

async function deliveries(scheduleId: string) {
  await asMaintenance(db);
  return (
    await db.query<{ user_id: string; status: string; skip_reason: string | null; link: string | null; kind: string }>(
      `select d.user_id, d.status, d.skip_reason, d.link, r.kind
       from public.scheduled_report_deliveries d join public.scheduled_report_runs r on r.id = d.run_id
       where d.schedule_id = $1 order by d.created_at, d.user_id`,
      [scheduleId],
    )
  ).rows;
}

async function runner() {
  await asServiceRole(db);
  const result = await db.query<{ result: { schedules: number; delivered: number; skipped: number } }>(
    `select public.service_run_scheduled_reports(50) as result`,
  );
  return result.rows[0].result;
}

describe("REP-03 scheduled reports (database)", () => {
  it("keeps the SQL tab roles equal to the page's canSeeTab roles", async () => {
    await asMaintenance(db);
    const roles = await db.query<{ tab: string; roles: string[] }>(
      `select t as tab, app.report_tab_roles(t)::text[] as roles from unnest(array['ops', 'money', 'outcomes']) t`,
    );
    const byTab = new Map(roles.rows.map((row) => [row.tab, [...row.roles].sort()]));
    expect(byTab.get("money")).toEqual([...MONEY_ROLES].sort());
    expect(byTab.get("ops")).toEqual([...OPS_ROLES].sort());
    expect(byTab.get("outcomes")).toEqual([...OPS_ROLES].sort());
  });

  it("lets staff who see a tab schedule it for staff who also see it, and nobody else", async () => {
    const ctx = await firm();
    const id = await save(ctx, ctx.manager, { recipients: [ctx.manager, ctx.owner] });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // A case manager can't schedule Money; nobody can send Money to a case manager.
    await expectDbError(() => save(ctx, ctx.manager, { tab: "money", recipients: [ctx.owner] }), /your role cannot see this report/);
    await expectDbError(() => save(ctx, ctx.owner, { tab: "money", recipients: [ctx.manager] }), /recipient cannot see this report/);
    // An assistant sees no report tab.
    await expectDbError(() => save(ctx, ctx.assistant, { recipients: [ctx.owner] }), /your role cannot see this report/);
    // No recipients, or someone from outside the firm.
    await expectDbError(() => save(ctx, ctx.owner, { recipients: [] }), /choose from 1 to 20 recipients/);
    const outsider = await createUser("outsider", "Synthetic Outsider");
    await expectDbError(() => save(ctx, ctx.owner, { recipients: [outsider] }), /recipient cannot see this report/);
    // A weekly schedule needs a weekday; monthly days stop at 28.
    await expectDbError(() => save(ctx, ctx.owner, { recipients: [ctx.owner], weekday: 9 }), /choose a weekday/);
    await expectDbError(() => save(ctx, ctx.owner, { recipients: [ctx.owner], frequency: "monthly", monthDay: 31 }), /day of the month/);

    const money = await save(ctx, ctx.finance, { tab: "money", recipients: [ctx.finance, ctx.owner], frequency: "monthly", monthDay: 1 });
    await asMaintenance(db);
    const audit = await db.query<{ action: string; context: Record<string, unknown> }>(
      `select action, context from public.audit_log where object_id = $1 order by occurred_at`,
      [money],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(["report.schedule_created"]);
    expect(audit.rows[0].context).toEqual({ tab: "money", range: "90d", frequency: "monthly", recipients: 2 });
  });

  it("shows each person only the schedules of the tabs they can see, in their own firm", async () => {
    const ctx = await firm();
    await save(ctx, ctx.manager, { recipients: [ctx.manager] });
    await save(ctx, ctx.finance, { tab: "money", recipients: [ctx.finance] });

    const overview = async (userId: string, orgId = ctx.orgId) => {
      await as(userId, orgId);
      const result = await db.query<{ data: { tabs: string[]; schedules: { tab: string; can_edit: boolean; recipients: { name: string }[] }[]; staff: { tabs: string[] }[] } }>(
        `select public.scheduled_reports_overview($1) as data`,
        [ctx.orgId],
      );
      return result.rows[0].data;
    };
    const owner = await overview(ctx.owner);
    expect(owner.tabs).toEqual(["ops", "money", "outcomes"]);
    expect(owner.schedules.map((row) => row.tab).sort()).toEqual(["money", "ops"]);
    expect(owner.schedules.every((row) => row.can_edit)).toBe(true);
    const manager = await overview(ctx.manager);
    expect(manager.tabs).toEqual(["ops", "outcomes"]);
    expect(manager.schedules.map((row) => row.tab)).toEqual(["ops"]);
    expect(manager.schedules[0].recipients[0].name).toBe("Synthetic Manager");
    const finance = await overview(ctx.finance);
    expect(finance.schedules.map((row) => row.tab)).toEqual(["money"]);
    const assistant = await overview(ctx.assistant);
    expect(assistant.schedules).toEqual([]);

    // Another firm's owner can't read this firm's schedules, even naming it.
    const other = await firm();
    await expectDbError(() => overview(other.owner, other.orgId), /scheduled reports denied/);
    await asAnon(db);
    await expectDbError(() => db.query(`select public.scheduled_reports_overview($1)`, [ctx.orgId]), /permission denied|sign in/);
    // The tables themselves are closed to signed-in users.
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select * from public.scheduled_reports`), /permission denied/);
    await expectDbError(() => db.query(`select * from public.scheduled_report_deliveries`), /permission denied/);
  });

  it("lets only who made it, or the firm owner, change, pause or delete it", async () => {
    const ctx = await firm();
    const colleague = await createUser("colleague", "Synthetic Colleague");
    await member(ctx.orgId, colleague, "licensed_consultant", ctx.owner);
    const id = await save(ctx, ctx.manager, { recipients: [ctx.manager] });

    await expectDbError(() => save(ctx, colleague, { id, recipients: [colleague] }), /only who made it or the firm owner/);
    await as(colleague, ctx.orgId);
    await expectDbError(() => db.query(`select public.set_scheduled_report_paused($1, true)`, [id]), /only who made it or the firm owner/);
    await expectDbError(() => db.query(`select public.delete_scheduled_report($1)`, [id]), /only who made it or the firm owner/);
    await expectDbError(() => db.query(`select public.run_scheduled_report_now($1)`, [id]), /only who made it or the firm owner/);

    // A stale version is refused.
    await expectDbError(() => save(ctx, ctx.manager, { id, recipients: [ctx.manager], version: 99 }), /version conflict/);
    await save(ctx, ctx.owner, { id, recipients: [ctx.manager, ctx.owner], version: 1 });

    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.set_scheduled_report_paused($1, true)`, [id]);
    await asMaintenance(db);
    expect((await db.query<{ paused: boolean; next_run_at: string | null }>(`select paused, next_run_at from public.scheduled_reports where id = $1`, [id])).rows[0]).toEqual({
      paused: true,
      next_run_at: null,
    });
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.set_scheduled_report_paused($1, false)`, [id]);
    await db.query(`select public.delete_scheduled_report($1)`, [id]);
    await asMaintenance(db);
    const row = (await db.query<{ deleted_at: string | null; next_run_at: string | null }>(`select deleted_at, next_run_at from public.scheduled_reports where id = $1`, [id])).rows[0];
    expect(row.deleted_at).not.toBeNull();
    expect(row.next_run_at).toBeNull();
    await expectDbError(() => db.query(`delete from public.scheduled_reports where id = $1`, [id]), /kept on record/);
    const actions = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 order by occurred_at`, [id]);
    expect(actions.rows.map((a) => a.action)).toEqual([
      "report.schedule_created",
      "report.schedule_updated",
      "report.schedule_paused",
      "report.schedule_resumed",
      "report.schedule_deleted",
    ]);
  });

  it("computes the next send on the firm's clock", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    await db.query(`update public.organizations set timezone = 'America/Winnipeg' where id = $1`, [ctx.orgId]);
    // Wednesday 2026-10-21 12:00 UTC is 07:00 in Winnipeg; the next Monday 08:00 there (CDT) is 13:00 UTC on the 26th.
    const weekly = await db.query<{ at: string }>(
      `select to_char(app.report_schedule_next_run($1, 'weekly', 1::smallint, null, '08:00'::time, '2026-10-21T12:00:00Z') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as at`,
      [ctx.orgId],
    );
    expect(weekly.rows[0].at).toBe("2026-10-26 13:00");
    // Monthly on the 15th at 07:00: 15 Nov 2026 is standard time (CST, UTC-6).
    const monthly = await db.query<{ at: string }>(
      `select to_char(app.report_schedule_next_run($1, 'monthly', null, 15::smallint, '07:00'::time, '2026-10-21T12:00:00Z') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as at`,
      [ctx.orgId],
    );
    expect(monthly.rows[0].at).toBe("2026-11-15 13:00");
  });

  it("rechecks every recipient at send time: a removed staff member gets nothing", async () => {
    const ctx = await firm();
    const id = await save(ctx, ctx.owner, { recipients: [ctx.owner, ctx.manager] });
    await makeDue(id);

    // The case manager leaves the firm after the schedule was made.
    await asMaintenance(db);
    await db.query(`update public.memberships set status = 'revoked', revoked_at = now() where id = $1`, [ctx.managerMembership]);

    const sent = await runner();
    expect(sent.schedules).toBeGreaterThanOrEqual(1);
    const rows = await deliveries(id);
    expect(rows).toHaveLength(2);
    const byUser = new Map(rows.map((row) => [row.user_id, row]));
    expect(byUser.get(ctx.owner)).toMatchObject({ status: "delivered", skip_reason: null, link: "/sheet/reports?tab=ops&view=90d", kind: "scheduled" });
    expect(byUser.get(ctx.manager)).toMatchObject({ status: "skipped", skip_reason: "not_active_staff", link: null });

    // A role change that no longer sees the tab is skipped too.
    const money = await save(ctx, ctx.owner, { tab: "money", recipients: [ctx.owner, ctx.finance] });
    await asMaintenance(db);
    await db.query(`update public.memberships set role = 'assistant' where organization_id = $1 and user_id = $2`, [ctx.orgId, ctx.finance]);
    await makeDue(money);
    await runner();
    const moneyRows = await deliveries(money);
    expect(moneyRows.find((row) => row.user_id === ctx.finance)).toMatchObject({ status: "skipped", skip_reason: "role_cannot_see_tab" });

    // The removed manager has no report notification; the owner has one, link only.
    await as(ctx.owner, ctx.orgId);
    const ownerItems = await db.query<{ data: { kind: string; subject: string; detail: string; href: string }[] }>(`select public.staff_notifications($1, 50) as data`, [ctx.orgId]);
    const reports = ownerItems.rows[0].data.filter((item) => item.kind === "report");
    expect(reports.map((item) => item.href).sort()).toEqual(["/sheet/reports?tab=money&view=90d", "/sheet/reports?tab=ops&view=90d"]);
    expect(reports.every((item) => item.subject === "Monday workload" && item.detail === "scheduled")).toBe(true);
  });

  it("sends once per due time however often the runner is called", async () => {
    const ctx = await firm();
    const id = await save(ctx, ctx.owner, { recipients: [ctx.owner] });
    await makeDue(id);
    await asMaintenance(db);
    const due = (await db.query<{ next_run_at: string }>(`select next_run_at::text from public.scheduled_reports where id = $1`, [id])).rows[0].next_run_at;

    await runner();
    await runner();
    expect(await deliveries(id)).toHaveLength(1);

    // A repeated due time (e.g. a restored schedule) adds no second run.
    await asMaintenance(db);
    await db.query(`update public.scheduled_reports set next_run_at = $2::timestamptz where id = $1`, [id, due]);
    await runner();
    expect(await deliveries(id)).toHaveLength(1);
    const runs = await db.query<{ n: number }>(`select count(*)::int as n from public.scheduled_report_runs where schedule_id = $1`, [id]);
    expect(runs.rows[0].n).toBe(1);
    const next = (await db.query<{ later: boolean }>(`select next_run_at > statement_timestamp() as later from public.scheduled_reports where id = $1`, [id])).rows[0];
    expect(next.later).toBe(true);

    // Paused and deleted schedules are not sent.
    const paused = await save(ctx, ctx.owner, { recipients: [ctx.owner] });
    await makeDue(paused);
    await as(ctx.owner, ctx.orgId);
    await db.query(`select public.set_scheduled_report_paused($1, true)`, [paused]);
    await runner();
    expect(await deliveries(paused)).toHaveLength(0);

    // The log can't be rewritten, and only the service role runs the runner.
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.scheduled_report_deliveries set link = null where schedule_id = $1`, [id]), /append-only/);
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.service_run_scheduled_reports(50)`), /permission denied/);
  });

  it("Run now (test) sends the link to the recipients now, once a minute, without moving the schedule", async () => {
    const ctx = await firm();
    const id = await save(ctx, ctx.owner, { recipients: [ctx.owner, ctx.manager] });
    await asMaintenance(db);
    const before = (await db.query<{ next_run_at: string }>(`select next_run_at::text from public.scheduled_reports where id = $1`, [id])).rows[0].next_run_at;

    await as(ctx.owner, ctx.orgId);
    const result = await db.query<{ r: { delivered: number; skipped: number } }>(`select public.run_scheduled_report_now($1) as r`, [id]);
    expect(result.rows[0].r).toMatchObject({ delivered: 2, skipped: 0 });
    await expectDbError(() => db.query(`select public.run_scheduled_report_now($1)`, [id]), /a test was just sent/);

    const rows = await deliveries(id);
    expect(rows.every((row) => row.kind === "test" && row.link === "/sheet/reports?tab=ops&view=90d")).toBe(true);
    await asMaintenance(db);
    const after = (await db.query<{ next_run_at: string }>(`select next_run_at::text from public.scheduled_reports where id = $1`, [id])).rows[0].next_run_at;
    expect(after).toBe(before);

    // Link only: no column of the run or delivery log can hold report figures, and the audit
    // records counts, never content.
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name in ('scheduled_report_runs', 'scheduled_report_deliveries')`,
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual(
      ["created_at", "due_at", "id", "kind", "organization_id", "run_by", "schedule_id", "created_at", "id", "link", "organization_id", "run_id", "schedule_id", "skip_reason", "status", "user_id"].sort(),
    );
    const audit = await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where object_id = $1 and action = 'report.schedule_test_run'`, [id]);
    expect(Object.keys(audit.rows[0].context).sort()).toEqual(["delivered", "run_id", "skipped", "tab"]);
    await expectDbError(
      () => db.query(`insert into public.scheduled_report_deliveries (organization_id, run_id, schedule_id, user_id, status, link) select organization_id, run_id, schedule_id, user_id, 'delivered', 'https://elsewhere.example/report.csv' from public.scheduled_report_deliveries where schedule_id = $1 limit 1`, [id]),
      /check constraint|violates/,
    );

    // The manager sees the test link in their notifications.
    await as(ctx.manager, ctx.orgId);
    const items = await db.query<{ data: { kind: string; detail: string; href: string }[] }>(`select public.staff_notifications($1, 50) as data`, [ctx.orgId]);
    expect(items.rows[0].data.filter((item) => item.kind === "report")).toEqual([expect.objectContaining({ detail: "test", href: "/sheet/reports?tab=ops&view=90d" })]);
  });
});
