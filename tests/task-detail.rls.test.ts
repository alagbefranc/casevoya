import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { taskChangeError } from "@/modules/sheet/new-task";
import { taskDetailError } from "@/modules/sheet/task-detail";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * OPS-01 against the real migrations: the task detail's watchers, depends on, checklist,
 * estimate, due time and timezone, recurrence (20261025100000), and the 'task' notifications for
 * the owner, the watchers and the matter's responsible consultant (20261025100100).
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

beforeEach(async () => {
  await asMaintenance(db);
});

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, address]);
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

async function activeMembership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

async function verifiedLicence(owner: string, consultant: string, orgId: string, membershipId: string) {
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membershipId, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       $3, $4, false, false, null, $5, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, true, false, PROOF],
  );
}

async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const manager = await createUser(email("manager"));
  const colleague = await createUser(email("colleague"));
  const orgId = await createOrg(owner);
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  const colleagueMembership = await activeMembership(orgId, colleague, "case_manager", owner);
  await verifiedLicence(owner, consultant, orgId, consultantMembership);
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  const ownerMembership = (
    await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner])
  ).rows[0].id;
  return { owner, consultant, manager, colleague, orgId, ownerMembership, consultantMembership, managerMembership, colleagueMembership };
}
type Firm = Awaited<ReturnType<typeof firm>>;

async function as(userId: string, orgId: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
}

/** A matter the case manager opens, with the consultant as its responsible consultant. */
async function clientMatter(ctx: Firm) {
  await as(ctx.manager, ctx.orgId);
  const result = await db.query<{ result: { id: string; applicant_id: string } }>(
    `select public.create_client_matter($1, $2, $3, $4, $5, $6, $7) as result`,
    ["Ana Pereira", null, null, null, ctx.consultantMembership, null, null],
  );
  return result.rows[0].result;
}

async function createTask(ctx: Firm, matterId: string, title: string, dueOn: string | null = null, owner = ctx.managerMembership) {
  await as(ctx.manager, ctx.orgId);
  const created = await db.query<{ id: string }>(
    `select public.create_task($1, 'internal'::public.task_audience, $2, $3, null, 'normal'::public.task_priority, $4::date, null, 'America/Toronto', null, null, '[]'::jsonb) as id`,
    [matterId, title, owner, dueOn],
  );
  return created.rows[0].id;
}

type TaskRow = {
  version: number;
  status: string;
  checklist: { text: string; done: boolean }[];
  estimated_minutes: number | null;
  due_on: string | null;
  due_at: string | null;
  due_timezone: string;
  recurrence: string | null;
  recurrence_parent_id: string | null;
  owner_membership_id: string | null;
  escalated_at: string | null;
};

async function task(id: string): Promise<TaskRow> {
  await asMaintenance(db);
  const row = await db.query<TaskRow>(
    `select version, status::text, checklist, estimated_minutes, due_on::text, due_at::text, due_timezone, recurrence,
            recurrence_parent_id, owner_membership_id, escalated_at::text
     from public.tasks where id = $1`,
    [id],
  );
  return row.rows[0];
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the database to refuse");
}

type Item = { id: string; kind: string; subject: string | null; detail: string | null; href: string; read: boolean };

async function taskItems(userId: string, orgId: string): Promise<Item[]> {
  await as(userId, orgId);
  const items = (await db.query<{ items: Item[] }>(`select public.staff_notifications($1, 200) as items`, [orgId])).rows[0].items;
  return items.filter((item) => item.kind === "task");
}

describe("Task detail: watchers and depends on", () => {
  it("adds and removes a watcher, refuses someone who can't read the task", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);
    const id = await createTask(ctx, matter.id, "Review passport");
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.add_task_watcher($1, $2)`, [id, ctx.ownerMembership]);
    await as(ctx.manager, ctx.orgId);
    expect((await db.query(`select membership_id from public.task_watchers where task_id = $1`, [id])).rows).toEqual([{ membership_id: ctx.ownerMembership }]);

    // A colleague not on the matter can't read the task, so can't remove its watchers.
    await as(ctx.colleague, ctx.orgId);
    await expectDbError(() => db.query(`select public.remove_task_watcher($1, $2)`, [id, ctx.ownerMembership]), /task watcher denied/);

    await as(ctx.manager, ctx.orgId);
    const removed = await db.query<{ ok: boolean }>(`select public.remove_task_watcher($1, $2) as ok`, [id, ctx.ownerMembership]);
    expect(removed.rows[0].ok).toBe(true);
    await as(ctx.manager, ctx.orgId);
    const again = await db.query<{ ok: boolean }>(`select public.remove_task_watcher($1, $2) as ok`, [id, ctx.ownerMembership]);
    expect(again.rows[0].ok).toBe(false);
  });

  it("refuses completing a task while what it depends on is open, in plain words, and allows it once removed", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);
    const a = await createTask(ctx, matter.id, "Task A");
    const b = await createTask(ctx, matter.id, "Task B");
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.add_task_dependency($1, $2)`, [b, a]);

    await as(ctx.manager, ctx.orgId);
    const refused = await refusal(() => db.query(`select public.set_task_status($1, $2, 'done', null)`, [b, 1]));
    expect(taskChangeError(refused)).toBe("It waits on another task that is still open. Finish that one first.");

    await as(ctx.manager, ctx.orgId);
    const removed = await db.query<{ ok: boolean }>(`select public.remove_task_dependency($1, $2) as ok`, [b, a]);
    expect(removed.rows[0].ok).toBe(true);
    const vb = (await task(b)).version;
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.set_task_status($1, $2, 'done', null)`, [b, vb]);
    expect((await task(b)).status).toBe("done");

    await as(ctx.colleague, ctx.orgId);
    await expectDbError(() => db.query(`select public.remove_task_dependency($1, $2)`, [b, a]), /task dependency denied/);
  });
});

describe("Task detail: checklist, estimate, due time and timezone", () => {
  it("saves a checklist as text and ticks, with a version, and refuses a malformed item", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);
    const id = await createTask(ctx, matter.id, "Checklist task");
    const list = [
      { text: " Passport ", done: true },
      { text: "Photos", done: true },
      { text: "Police certificate", done: false },
    ];
    await as(ctx.manager, ctx.orgId);
    const v = await db.query<{ v: number }>(`select public.set_task_checklist($1, 1, $2::jsonb) as v`, [id, JSON.stringify(list)]);
    expect(v.rows[0].v).toBe(2);
    const row = await task(id);
    expect(row.checklist).toEqual([
      { text: "Passport", done: true },
      { text: "Photos", done: true },
      { text: "Police certificate", done: false },
    ]);
    expect(row.checklist.filter((item) => item.done).length).toBe(2);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'task.checklist_updated'`, [id])).rows).toHaveLength(1);

    await as(ctx.manager, ctx.orgId);
    const bad = await refusal(() => db.query(`select public.set_task_checklist($1, 2, '[{"text":""}]'::jsonb)`, [id]));
    expect(taskDetailError(bad)).toBe("Each checklist item needs a few words, up to 200 characters.");
    await as(ctx.manager, ctx.orgId);
    const stale = await refusal(() => db.query(`select public.set_task_checklist($1, 1, '[]'::jsonb)`, [id]));
    expect(taskDetailError(stale)).toMatch(/Someone changed this task/);
    await as(ctx.colleague, ctx.orgId);
    await expectDbError(() => db.query(`select public.set_task_checklist($1, 2, '[]'::jsonb)`, [id]), /task update denied/);
  });

  it("saves an estimate, a due time in the chosen timezone and a repeat, and refuses what doesn't fit", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);
    const id = await createTask(ctx, matter.id, "Timed task", "2030-01-15");
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.update_task_details($1, 1, 45, '09:30'::time, 'America/Halifax', 'weekly')`, [id]);
    const row = await task(id);
    expect(row).toMatchObject({ estimated_minutes: 45, due_timezone: "America/Halifax", recurrence: "weekly", version: 2 });
    // 09:30 in Halifax (AST, UTC-4) on 15 Jan 2030.
    expect(new Date(row.due_at!).toISOString()).toBe("2030-01-15T13:30:00.000Z");

    // The same values again change nothing.
    await as(ctx.manager, ctx.orgId);
    const same = await db.query<{ v: number }>(`select public.update_task_details($1, 2, 45, '09:30'::time, 'America/Halifax', 'weekly') as v`, [id]);
    expect(same.rows[0].v).toBe(2);

    await as(ctx.manager, ctx.orgId);
    expect(taskDetailError(await refusal(() => db.query(`select public.update_task_details($1, 2, null, null, null, 'daily')`, [id])))).toBe(
      "A task repeats weekly or monthly.",
    );
    await as(ctx.manager, ctx.orgId);
    expect(taskDetailError(await refusal(() => db.query(`select public.update_task_details($1, 2, -5, null, null, null)`, [id])))).toBe(
      "The estimate is a number of minutes, up to 100000.",
    );
    await as(ctx.manager, ctx.orgId);
    expect(taskDetailError(await refusal(() => db.query(`select public.update_task_details($1, 2, null, null, 'Mars/Base', null)`, [id])))).toBe(
      "Choose a timezone from the list.",
    );
    const undated = await createTask(ctx, matter.id, "Undated");
    await as(ctx.manager, ctx.orgId);
    expect(taskDetailError(await refusal(() => db.query(`select public.update_task_details($1, 1, null, '10:00'::time, null, null)`, [undated])))).toBe(
      "Set a due date before a due time.",
    );
  });
});

describe("Recurring tasks", () => {
  it("completing a weekly task creates the next one a week later, with its watchers and an unticked checklist, once", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);
    const id = await createTask(ctx, matter.id, "Weekly check-in", "2099-01-15");
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.update_task_details($1, 1, 30, null, null, 'weekly')`, [id]);
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.set_task_checklist($1, 2, '[{"text":"Call","done":true}]'::jsonb)`, [id]);
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.add_task_watcher($1, $2)`, [id, ctx.ownerMembership]);
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.set_task_status($1, 3, 'done', null)`, [id]);

    await asMaintenance(db);
    const next = await db.query<{ id: string }>(`select id from public.tasks where recurrence_parent_id = $1`, [id]);
    expect(next.rows).toHaveLength(1);
    const made = await task(next.rows[0].id);
    expect(made).toMatchObject({ status: "open", due_on: "2099-01-22", recurrence: "weekly", estimated_minutes: 30, owner_membership_id: ctx.managerMembership });
    expect(made.checklist).toEqual([{ text: "Call", done: false }]);
    expect((await db.query(`select membership_id from public.task_watchers where task_id = $1`, [next.rows[0].id])).rows).toEqual([
      { membership_id: ctx.ownerMembership },
    ]);
    expect((await db.query(`select 1 from public.task_events where task_id = $1 and event_kind = 'created'`, [next.rows[0].id])).rows).toHaveLength(1);

    // Reopened and completed again: still one next occurrence.
    const v1 = (await task(id)).version;
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.set_task_status($1, $2, 'open', null)`, [id, v1]);
    const v2 = (await task(id)).version;
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.set_task_status($1, $2, 'done', null)`, [id, v2]);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.tasks where recurrence_parent_id = $1`, [id])).rows).toHaveLength(1);
  });

  it("steps a monthly task on the calendar, and an undated one from the firm's today", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);
    const monthly = await createTask(ctx, matter.id, "Monthly report", "2099-01-31");
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.update_task_details($1, 1, null, null, null, 'monthly')`, [monthly]);
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.set_task_status($1, 2, 'done', null)`, [monthly]);
    await asMaintenance(db);
    expect((await db.query(`select due_on::text from public.tasks where recurrence_parent_id = $1`, [monthly])).rows).toEqual([{ due_on: "2099-02-28" }]);

    const undated = await createTask(ctx, matter.id, "Weekly tidy");
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.update_task_details($1, 1, null, null, null, 'weekly')`, [undated]);
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.set_task_status($1, 2, 'done', null)`, [undated]);
    await asMaintenance(db);
    const stepped = await db.query<{ ok: boolean }>(
      `select due_on = app.firm_today($2) + 7 as ok from public.tasks where recurrence_parent_id = $1`,
      [undated, ctx.orgId],
    );
    expect(stepped.rows).toEqual([{ ok: true }]);
  });
});

describe("Task notifications: owner, watchers, new owner, responsible consultant", () => {
  it("tells the owner and watchers about a status change, the new owner about a reassignment, and the lead about an escalation", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);
    const id = await createTask(ctx, matter.id, "Notify task", "2099-01-15");
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.add_task_watcher($1, $2)`, [id, ctx.ownerMembership]);

    // The consultant blocks it: the owner (manager) and the watcher (firm owner) are told, not the consultant.
    await as(ctx.consultant, ctx.orgId);
    await db.query(`select public.set_task_status($1, 1, 'blocked', 'Waiting on the client')`, [id]);
    expect((await taskItems(ctx.manager, ctx.orgId)).map((item) => [item.subject, item.detail])).toEqual([["Notify task", "blocked"]]);
    expect((await taskItems(ctx.owner, ctx.orgId)).map((item) => item.detail)).toEqual(["blocked"]);
    expect(await taskItems(ctx.consultant, ctx.orgId)).toEqual([]);
    expect(await taskItems(ctx.colleague, ctx.orgId)).toEqual([]);
    expect((await taskItems(ctx.manager, ctx.orgId))[0].href).toBe(`/sheet/matters/${matter.id}?tab=tasks`);

    // The manager unblocks and reassigns it to the consultant: the consultant hears it is theirs.
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.set_task_status($1, 2, 'open', null)`, [id]);
    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.reassign_task($1, 3, $2, null)`, [id, ctx.consultantMembership]);
    const consultantItems = await taskItems(ctx.consultant, ctx.orgId);
    expect(consultantItems.map((item) => item.detail)).toEqual(["reassigned_you"]);
    expect((await taskItems(ctx.owner, ctx.orgId)).map((item) => item.detail).sort()).toEqual(["blocked", "open", "reassigned"]);

    // The firm owner escalates overdue work (any priority): the consultant, owner and matter lead, is told.
    await as(ctx.owner, ctx.orgId);
    const count = await db.query<{ n: number }>(`select public.escalate_overdue_work('2100-01-01T00:00:00Z') as n`);
    expect(count.rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await task(id)).escalated_at).not.toBeNull();
    expect((await taskItems(ctx.consultant, ctx.orgId)).map((item) => item.detail).sort()).toEqual(["escalated", "reassigned_you"]);
    // Not the former owner, who neither owns nor watches it now.
    expect((await taskItems(ctx.manager, ctx.orgId)).map((item) => item.detail)).toEqual(["blocked"]);
  });

  it("tells the matter's responsible consultant about an escalated task someone else owns", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);
    const id = await createTask(ctx, matter.id, "Overdue work", "2099-01-15");
    await as(ctx.owner, ctx.orgId);
    await db.query(`select public.escalate_overdue_work('2100-01-01T00:00:00Z')`);
    expect((await taskItems(ctx.consultant, ctx.orgId)).map((item) => [item.subject, item.detail])).toEqual([["Overdue work", "escalated"]]);
    expect((await taskItems(ctx.manager, ctx.orgId)).map((item) => item.detail)).toEqual(["escalated"]);
    // Another firm's staff never see it.
    const other = await firm();
    expect(await taskItems(other.owner, other.orgId)).toEqual([]);
    expect(id).toBeTruthy();
  });
});

describe("Grants", () => {
  it("are callable by signed-in staff, not anon", async () => {
    await asMaintenance(db);
    for (const fn of [
      "public.update_task_details(uuid, integer, integer, time, text, text)",
      "public.set_task_checklist(uuid, integer, jsonb)",
      "public.remove_task_watcher(uuid, uuid)",
      "public.remove_task_dependency(uuid, uuid)",
    ]) {
      const grants = await db.query<{ anon: boolean; authenticated: boolean }>(
        `select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as authenticated`,
        [fn],
      );
      expect(grants.rows[0], fn).toEqual({ anon: false, authenticated: true });
    }
  });
});
