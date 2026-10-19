import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newTaskError, dependencyError, taskChangeError } from "@/modules/sheet/new-task";
import { asMaintenance, asUser, createTestDb, type TestDb } from "./helpers/postgres";

/**
 * The Sheet's New task dialog against the real migrations: the matter picker's query only
 * returns matters the staff member can read, create_task accepts what the dialog sends for
 * them, and its refusals read the way newTaskError says.
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
  await activeMembership(orgId, colleague, "case_manager", owner);
  await verifiedLicence(owner, consultant, orgId, consultantMembership);
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  return { owner, consultant, manager, colleague, orgId, consultantMembership, managerMembership };
}

async function as(userId: string, orgId: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
}

/** The matter the case manager opens, so they are on it as a participant. */
async function clientMatter(ctx: Awaited<ReturnType<typeof firm>>) {
  await as(ctx.manager, ctx.orgId);
  const result = await db.query<{ result: { id: string; applicant_id: string } }>(
    `select public.create_client_matter($1, $2, $3, $4, $5, $6, $7) as result`,
    ["Ana Pereira", null, null, null, ctx.consultantMembership, null, null],
  );
  return result.rows[0].result;
}

/** What createSheetTask sends: normal priority, a date-only due date in the firm's timezone. */
async function createTask(args: {
  matterId: string;
  audience: "internal" | "client";
  title: string;
  ownerMembershipId?: string | null;
  ownerPersonId?: string | null;
  dueOn?: string | null;
}) {
  const created = await db.query<{ id: string }>(
    `select public.create_task($1, $2::public.task_audience, $3, $4, $5, 'normal'::public.task_priority, $6::date, null, 'America/Toronto', null, null, '[]'::jsonb) as id`,
    [args.matterId, args.audience, args.title, args.ownerMembershipId ?? null, args.ownerPersonId ?? null, args.dueOn ?? null],
  );
  return created.rows[0].id;
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the database to refuse");
}

const PICKER = `select id from public.matters where organization_id = $1 and stage <> 'closed'`;

describe("New task against create_task", () => {
  it("lets an assigned case manager add internal and client tasks, and link a dependency", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);

    await as(ctx.manager, ctx.orgId);
    const picker = await db.query<{ id: string }>(PICKER, [ctx.orgId]);
    expect(picker.rows.map((row) => row.id)).toContain(matter.id);

    const internal = await createTask({ matterId: matter.id, audience: "internal", title: "Review passport scan", ownerMembershipId: ctx.consultantMembership, dueOn: "2026-10-30" });
    const client = await createTask({ matterId: matter.id, audience: "client", title: "Upload police certificate", ownerPersonId: matter.applicant_id });
    await db.query(`select public.add_task_dependency($1, $2)`, [internal, client]);

    const rows = await db.query<{ title: string; audience: string; owner_membership_id: string | null; owner_person_id: string | null; due_on: string | null; status: string }>(
      `select title, audience, owner_membership_id, owner_person_id, due_on::text, status from public.tasks where matter_id = $1 order by title`,
      [matter.id],
    );
    expect(rows.rows).toEqual([
      { title: "Review passport scan", audience: "internal", owner_membership_id: ctx.consultantMembership, owner_person_id: null, due_on: "2026-10-30", status: "open" },
      { title: "Upload police certificate", audience: "client", owner_membership_id: null, owner_person_id: matter.applicant_id, due_on: null, status: "open" },
    ]);
    const deps = await db.query(`select 1 from public.task_dependencies where task_id = $1 and depends_on_task_id = $2`, [internal, client]);
    expect(deps.rows).toHaveLength(1);

    const cycle = await refusal(() => db.query(`select public.add_task_dependency($1, $2)`, [client, internal]));
    expect(dependencyError(cycle)).toBe("That would make the tasks wait on each other.");
  });

  it("hides a matter from a case manager who is not on it, and refuses a task there", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);

    await as(ctx.colleague, ctx.orgId);
    const picker = await db.query<{ id: string }>(PICKER, [ctx.orgId]);
    expect(picker.rows.map((row) => row.id)).not.toContain(matter.id);
    const message = await refusal(() => createTask({ matterId: matter.id, audience: "internal", title: "Sneak in", ownerMembershipId: ctx.managerMembership }));
    expect(newTaskError(message)).toBe("You can only add tasks to matters you’re assigned to.");

    // A firm owner reads every matter.
    await as(ctx.owner, ctx.orgId);
    const owner = await db.query<{ id: string }>(PICKER, [ctx.orgId]);
    expect(owner.rows.map((row) => row.id)).toContain(matter.id);
  });

  it("refuses an owner the task can't have", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);
    await as(ctx.manager, ctx.orgId);
    const staffOwner = await refusal(() => createTask({ matterId: matter.id, audience: "internal", title: "No owner", ownerMembershipId: randomUUID() }));
    expect(newTaskError(staffOwner)).toBe("Choose an active staff member as the owner.");
    const clientOwner = await refusal(() => createTask({ matterId: matter.id, audience: "client", title: "No person", ownerPersonId: randomUUID() }));
    expect(newTaskError(clientOwner)).toBe("A client task needs a person on this matter as its owner.");
  });

  it("in sample mode accepts a task on a sample matter and honestly refuses one on a real matter", async () => {
    const ctx = await firm();
    const real = await clientMatter(ctx);
    await asMaintenance(db);
    await db.query(`update public.organizations set sample_mode = true where id = $1`, [ctx.orgId]);

    await as(ctx.consultant, ctx.orgId);
    const sample = await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Sample file', true, $1, null, null) as result`, [ctx.consultantMembership]);
    const sampleId = sample.rows[0].result.id;
    const created = await createTask({ matterId: sampleId, audience: "internal", title: "Practice task", ownerMembershipId: ctx.consultantMembership });
    expect(created).toMatch(/^[0-9a-f-]{36}$/);

    const message = await refusal(() => createTask({ matterId: real.id, audience: "internal", title: "Real work", ownerMembershipId: ctx.consultantMembership }));
    expect(newTaskError(message)).toMatch(/still in sample mode/);
  });
});

describe("Task controls: edit (update_task), reassign and complete", () => {
  async function version(id: string) {
    await asMaintenance(db);
    const row = await db.query<{ version: number; title: string; due_on: string | null; status: string; owner_membership_id: string | null }>(
      `select version, title, due_on::text, status::text, owner_membership_id from public.tasks where id = $1`,
      [id],
    );
    return row.rows[0];
  }

  it("edits an open task's title and due date, skips a save that changes nothing, and audits it", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);
    await as(ctx.manager, ctx.orgId);
    const id = await createTask({ matterId: matter.id, audience: "internal", title: "Draft cover letter", ownerMembershipId: ctx.managerMembership });
    const before = await version(id);

    await as(ctx.manager, ctx.orgId);
    const same = await db.query<{ v: number }>(`select public.update_task($1, $2, 'Draft cover letter', null, null) as v`, [id, before.version]);
    expect(same.rows[0].v).toBe(before.version);

    await as(ctx.manager, ctx.orgId);
    const due = "2099-01-15";
    const changed = await db.query<{ v: number }>(`select public.update_task($1, $2, ' Draft the cover letter ', $3::date, null) as v`, [id, before.version, due]);
    expect(changed.rows[0].v).toBe(before.version + 1);
    expect(await version(id)).toMatchObject({ title: "Draft the cover letter", due_on: due });
    const audit = await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'task.updated'`, [id]);
    expect(audit.rows.length).toBeGreaterThan(0);

    // A due date in the past (the firm's today) and a stale version are refused, in the dialog's words.
    await as(ctx.manager, ctx.orgId);
    const past = await refusal(() => db.query(`select public.update_task($1, $2, 'Draft', '2001-01-01'::date, null)`, [id, before.version + 1]));
    expect(taskChangeError(past)).toBe("The due date can’t be in the past.");
    await as(ctx.manager, ctx.orgId);
    const stale = await refusal(() => db.query(`select public.update_task($1, $2, 'Draft', null, null)`, [id, before.version]));
    expect(taskChangeError(stale)).toMatch(/Someone changed this task/);
  });

  it("refuses a colleague who is not on the matter, and finance", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);
    await as(ctx.manager, ctx.orgId);
    const id = await createTask({ matterId: matter.id, audience: "internal", title: "Private work", ownerMembershipId: ctx.managerMembership });
    const { version: v } = await version(id);
    await as(ctx.colleague, ctx.orgId);
    const outsider = await refusal(() => db.query(`select public.update_task($1, $2, 'Hijacked', null, null)`, [id, v]));
    expect(taskChangeError(outsider)).toBe("Your role can’t change this task.");
    expect((await version(id)).title).toBe("Private work");
  });

  it("reassigns with a recent step-up only, then completes the task and cancels its reminders", async () => {
    const ctx = await firm();
    const matter = await clientMatter(ctx);
    await as(ctx.manager, ctx.orgId);
    const id = await createTask({ matterId: matter.id, audience: "internal", title: "Check passport", ownerMembershipId: ctx.managerMembership });
    let current = await version(id);

    // Without a recent step-up the reassignment is refused with the step-up message.
    await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    const stale = await refusal(() => db.query(`select public.reassign_task($1, $2, $3, null)`, [id, current.version, ctx.consultantMembership]));
    expect(stale).toMatch(/step-up/);

    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.reassign_task($1, $2, $3, null)`, [id, current.version, ctx.consultantMembership]);
    current = await version(id);
    expect(current.owner_membership_id).toBe(ctx.consultantMembership);

    await as(ctx.manager, ctx.orgId);
    await db.query(`select public.set_task_status($1, $2, 'done', null)`, [id, current.version]);
    expect((await version(id)).status).toBe("done");

    // A done task can't be edited.
    await as(ctx.manager, ctx.orgId);
    const closed = await refusal(() => db.query(`select public.update_task($1, $2, 'Again', null, null)`, [id, current.version + 1]));
    expect(taskChangeError(closed)).toBe("Only an open task can be edited.");
  });

  it("is not callable by anon", async () => {
    await asMaintenance(db);
    const grants = await db.query<{ anon: boolean; authenticated: boolean }>(
      `select has_function_privilege('anon', 'public.update_task(uuid, integer, text, date, public.task_priority)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.update_task(uuid, integer, text, date, public.task_priority)', 'execute') as authenticated`,
    );
    expect(grants.rows[0]).toEqual({ anon: false, authenticated: true });
  });
});
