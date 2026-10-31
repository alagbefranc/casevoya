import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Firm automations: a firm owner or licensed consultant (recent step-up) creates, edits, pauses
 * and resumes the firm's own deadline-reminder automations; other staff only read; other firms see
 * nothing; table writes go only through the audited functions. An active automation adds its days
 * to the deadlines of its kinds when reminders are scheduled; a paused one adds nothing.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
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

async function activeMembership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const finance = await createUser("finance");
  const manager = await createUser("manager");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  await activeMembership(orgId, finance, "finance_user", owner);
  await activeMembership(orgId, manager, "case_manager", owner);

  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);

  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, null, null, null, $2, null, null) as result`, [
    "Synthetic Applicant",
    consultantMembership,
  ]);
  return { owner, consultant, finance, manager, orgId, matterId: matter.rows[0].result.id };
}


const fresh = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
const stale = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 3600 });

async function rpc<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

const SAVE = `public.save_firm_automation($1, $2, $3, $4::text[], $5::integer[], $6)`;
const PAUSE = `public.set_firm_automation_paused($1, $2, $3)`;

async function deadline(ctx: { consultant: string; orgId: string; matterId: string }, kind: string) {
  await stale(ctx.consultant, ctx.orgId);
  const saved = await db.query<{ id: string }>(
    `select public.record_deadline($1, null, $2::public.deadline_kind, $3, null, null, '2026-12-20'::date, null, 'America/Toronto', null, null, null, null, null) as id`,
    [ctx.matterId, kind, `Synthetic ${kind} deadline`],
  );
  const id = saved.rows[0].id;
  await db.query(`select public.schedule_deadline_reminders($1, '2026-10-19T12:00:00Z')`, [id]);
  await asMaintenance(db);
  const rows = await db.query<{ offset_days: number }>(
    `select offset_days from public.reminder_schedules where deadline_id = $1 and reminder_kind = 'routine' and status = 'pending' order by offset_days desc`,
    [id],
  );
  return rows.rows.map((row) => row.offset_days);
}

describe("firm automations", () => {
  it("lets an owner create and a consultant edit; others read only; stale versions, bad input, no step-up and other firms are refused", async () => {
    const ctx = await firm();
    const other = await firm();

    await fresh(ctx.owner, ctx.orgId);
    const made = await rpc<{ id: string; version: number }>(SAVE, [null, null, "Synthetic letters", ["correspondence", "legal"], [7, 30, 7], null]);
    expect(made.version).toBe(1);
    const row = await db.query<{ status: string; deadline_kinds: string; offset_days: number[] }>(
      `select status, deadline_kinds::text, offset_days from public.firm_automations where id = $1`,
      [made.id],
    );
    expect(row.rows[0]).toEqual({ status: "active", deadline_kinds: "{legal,correspondence}", offset_days: [30, 7] });

    await fresh(ctx.consultant, ctx.orgId);
    const edited = await rpc<{ version: number }>(SAVE, [made.id, 1, "Synthetic letters v2", ["correspondence"], [10], null]);
    expect(edited.version).toBe(2);
    await expectDbError(() => rpc(SAVE, [made.id, 1, "Stale", ["legal"], [5], null]), /someone else changed/);
    await expectDbError(() => rpc(SAVE, [null, null, " ", ["legal"], [5], null]), /name/);
    await expectDbError(() => rpc(SAVE, [null, null, "X", ["appeal"], [5], null]), /kind of deadline/);
    await expectDbError(() => rpc(SAVE, [null, null, "X", ["legal"], [0], null]), /between 1 and 365/);
    await expectDbError(() => rpc(SAVE, [null, null, "X", ["legal"], [5], "anything"]), /cannot be copied/);
    const copy = await rpc<{ id: string }>(SAVE, [null, null, "Copy of Deadline reminders", ["legal", "correspondence", "internal"], [14, 7, 3, 1], "builtin_deadline_reminders"]);
    expect(copy.id).toMatch(/^[0-9a-f-]{36}$/);

    // A recent step-up is needed.
    await stale(ctx.owner, ctx.orgId);
    await expectDbError(() => rpc(SAVE, [null, null, "No step-up", ["legal"], [5], null]), /step|recent|mfa|denied|permission/i);

    // Case managers and finance read but do not write; direct table writes are refused.
    for (const userId of [ctx.manager, ctx.finance]) {
      await fresh(userId, ctx.orgId);
      expect((await db.query(`select id from public.firm_automations`)).rows).toHaveLength(2);
      await expectDbError(() => rpc(SAVE, [null, null, "Denied", ["legal"], [5], null]), /permission|denied|role/i);
      await expectDbError(() => rpc(PAUSE, [made.id, 2, true]), /permission|denied|role/i);
    }
    await fresh(ctx.owner, ctx.orgId);
    await expectDbError(
      () => db.query(`insert into public.firm_automations (organization_id, name, deadline_kinds, offset_days) values ($1, 'x', '{legal}', '{1}')`, [ctx.orgId]),
      /permission denied/,
    );
    await expectDbError(() => db.query(`update public.firm_automations set name = 'x' where id = $1`, [made.id]), /permission denied/);

    // Another firm sees nothing and cannot change this firm's automation.
    await fresh(other.owner, other.orgId);
    expect((await db.query(`select id from public.firm_automations`)).rows).toHaveLength(0);
    await expectDbError(() => rpc(PAUSE, [made.id, 2, true]), /denied/);

    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log where organization_id = $1 and action like 'automation.%' order by occurred_at`,
      [ctx.orgId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["automation.created", "automation.saved", "automation.created"]);
  });

  it("adds an active automation's days to its kinds of deadline, and nothing once paused", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    await db.query(`insert into public.firm_reminder_offsets (organization_id, offset_days) values ($1, 14), ($1, 7)`, [ctx.orgId]);
    await fresh(ctx.owner, ctx.orgId);
    const rule = await rpc<{ id: string; version: number }>(SAVE, [null, null, "Synthetic internal", ["internal"], [30, 7, 2], null]);

    expect(await deadline(ctx, "internal")).toEqual([30, 14, 7, 2]);
    expect(await deadline(ctx, "correspondence")).toEqual([14, 7]);

    await fresh(ctx.owner, ctx.orgId);
    const paused = await rpc<{ version: number }>(PAUSE, [rule.id, rule.version, true]);
    expect(paused.version).toBe(2);
    expect(await deadline(ctx, "internal")).toEqual([14, 7]);

    await fresh(ctx.consultant, ctx.orgId);
    await rpc(PAUSE, [rule.id, 2, false]);
    expect(await deadline(ctx, "internal")).toEqual([30, 14, 7, 2]);

    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log where organization_id = $1 and action like 'automation.%' order by occurred_at`,
      [ctx.orgId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["automation.created", "automation.paused", "automation.resumed"]);
  });

  it("is not callable by anon", async () => {
    await asMaintenance(db);
    for (const signature of ["public.save_firm_automation(uuid, integer, text, text[], integer[], text)", "public.set_firm_automation_paused(uuid, integer, boolean)"]) {
      const grants = await db.query<{ anon: boolean; authenticated: boolean }>(
        `select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as authenticated`,
        [signature],
      );
      expect(grants.rows[0]).toEqual({ anon: false, authenticated: true });
    }
  });
});
