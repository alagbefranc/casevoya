import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rowsDigest, sha256Hex } from "@/modules/migration/csv";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * MIG-01 (gap #187): the staged import's new kinds (relationships, notes, tasks, key dates,
 * documents, opening balances) and the sensitivity classification, through the same pipeline as
 * clients and matters. Synthetic data only: every name, email and reference here is fake.
 */

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
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
  const email = `${label}-${id.slice(0, 8)}@example.test`;
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, email]);
  return { id, email };
}

async function member(orgId: string, userId: string, role: string, by: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, by],
  );
  return row.rows[0].id;
}

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  const finance = await createUser("finance");
  await asUser(db, { userId: owner.id, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await member(orgId, consultant.id, "licensed_consultant", owner.id);
  const managerMembership = await member(orgId, manager.id, "case_manager", owner.id);
  const financeMembership = await member(orgId, finance.id, "finance_user", owner.id);
  await asUser(db, { userId: consultant.id, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner.id, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       $3, $4, false, false, null, $5, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, true, false, PROOF],
  );
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  return { owner, consultant, manager, finance, orgId, consultantMembership, managerMembership, financeMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const as = (ctx: Firm, who: "owner" | "manager" | "consultant" | "finance" = "owner", stepUp = true) =>
  asUser(db, { userId: ctx[who].id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: stepUp ? 0 : 3600 });

async function rpc<T = unknown>(sql: string, params: unknown[]): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

async function stage(ctx: Firm, kind: string, headers: string[], rows: string[][]) {
  await as(ctx);
  const batch = await rpc<string>(`public.stage_migration_batch($1, $2, $3, $4, $5, $6, $7)`, [
    ctx.orgId,
    `${kind}.csv`,
    await sha256Hex(`synthetic ${kind} ${randomUUID()}`),
    1024,
    rows.length,
    await rowsDigest(rows),
    headers,
  ]);
  if (kind !== "clients_matters") await rpc(`public.set_migration_kind($1, $2, $3)`, [ctx.orgId, batch, kind]);
  await rpc(`public.append_migration_rows($1, $2, 2, $3)`, [ctx.orgId, batch, JSON.stringify(rows)]);
  const sealed = await rpc<{ ok: boolean }>(`public.seal_migration_batch($1, $2)`, [ctx.orgId, batch]);
  expect(sealed.ok).toBe(true);
  return batch;
}

async function dryRun(ctx: Firm, batch: string, mapping: Record<string, unknown>) {
  await as(ctx);
  await rpc(`public.save_migration_mapping($1, $2, $3)`, [ctx.orgId, batch, JSON.stringify({ date_order: "ymd", values: {}, ...mapping })]);
  return rpc<Record<string, number | string>>(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, batch]);
}

async function batchPlan(batch: string) {
  await asMaintenance(db);
  return (await db.query<{ plan_hash: string; kind: string }>(`select plan_hash, kind from public.migration_batches where id = $1`, [batch])).rows[0];
}

/** One commit chunk: clients and matters through commit_migration_chunk, every other kind through commit_migration_kind_chunk. */
async function chunk(ctx: Firm, batch: string, kind: string, limit = 2) {
  await as(ctx);
  return kind === "clients_matters"
    ? rpc<{ remaining: number; status: string }>(`public.commit_migration_chunk($1, $2, $3)`, [ctx.orgId, batch, limit])
    : rpc<{ remaining: number; status: string }>(`public.commit_migration_kind_chunk($1, $2, $3)`, [ctx.orgId, batch, limit]);
}

async function chunks(ctx: Firm, batch: string, kind: string) {
  let left = 1;
  while (left > 0) left = (await chunk(ctx, batch, kind)).remaining;
}

/**
 * The one place every test signs a batch off, as MIG-02's commit() helper in
 * migration-import.rls.test.ts does: a pilot of the first record (or matter), its chunks, the firm
 * owner's sign-off with a note, then the full run's start (begin_migration_commit). The caller
 * runs the full run's chunks.
 */
async function begin(ctx: Firm, batch: string, size = 1) {
  const { plan_hash: hash, kind } = await batchPlan(batch);
  await as(ctx);
  const piloted = await rpc<{ ok: boolean; reason?: string }>(`public.begin_migration_pilot($1, $2, $3, $4)`, [ctx.orgId, batch, hash, size]);
  if (!piloted.ok) return piloted;
  await chunks(ctx, batch, kind);
  await as(ctx);
  await rpc(`public.sign_off_migration_pilot($1, $2, 'Synthetic pilot checked')`, [ctx.orgId, batch]);
  return rpc<{ ok: boolean; reason?: string }>(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, hash]);
}

async function commitKind(ctx: Firm, batch: string) {
  const begun = await begin(ctx, batch);
  expect(begun.ok).toBe(true);
  await chunks(ctx, batch, (await batchPlan(batch)).kind);
}

async function rows(batch: string) {
  await asMaintenance(db);
  return (
    await db.query<{ row_number: number; plan: string; problems: { column: string; problem: string }[]; match_record_id: string | null; match_row_number: number | null }>(
      `select row_number, plan::text, problems, match_record_id, match_row_number from public.migration_rows where batch_id = $1 order by row_number`,
      [batch],
    )
  ).rows;
}

/** Two synthetic matters (old references SYN-1 and SYN-2) and three people, through a clients import. */
async function withClients(ctx: Firm) {
  const batch = await stage(ctx, "clients_matters", ["Name", "Email", "File", "Role"], [
    ["Synthetic Applicant A", "applicant.a@example.test", "SYN-1", "applicant"],
    ["Synthetic Spouse A", "spouse.a@example.test", "SYN-1", "dependant"],
    ["Synthetic Applicant B", "applicant.b@example.test", "SYN-2", "applicant"],
  ]);
  await as(ctx);
  await rpc(`public.save_migration_mapping($1, $2, $3)`, [
    ctx.orgId,
    batch,
    JSON.stringify({ columns: { name: 0, email: 1, reference: 2, role: 3 }, date_order: "dmy", default_consultant: ctx.consultantMembership, values: {} }),
  ]);
  await rpc(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, batch]);
  expect((await begin(ctx, batch)).ok).toBe(true);
  await chunks(ctx, batch, "clients_matters");
  await asMaintenance(db);
  const matters = await db.query<{ id: string; source_reference: string }>(
    `select record_id as id, source_reference from public.migration_records where batch_id = $1 and record_table = 'matters'`,
    [batch],
  );
  const people = await db.query<{ id: string; email: string }>(`select id, email from public.persons where organization_id = $1`, [ctx.orgId]);
  const matter = (ref: string) => matters.rows.find((row) => row.source_reference === ref)!.id;
  const person = (email: string) => people.rows.find((row) => row.email === email)!.id;
  return { clientsBatch: batch, matter1: matter("SYN-1"), matter2: matter("SYN-2"), applicantA: person("applicant.a@example.test"), spouseA: person("spouse.a@example.test"), applicantB: person("applicant.b@example.test") };
}

describe("MIG-01 tasks import (the spec's UI test)", () => {
  it("previews a 5-row tasks CSV with one row error, then creates 4 tasks with imported_at and source_system", async () => {
    const ctx = await firm();
    const clients = await withClients(ctx);
    const batch = await stage(ctx, "tasks", ["Matter", "Task", "Due", "Assignee", "Status"], [
      ["SYN-1", "Synthetic task one", "2026-11-02", ctx.manager.email, "Open"],
      ["SYN-1", "Synthetic task two", "2026-11-03", ctx.consultant.email, "Done"],
      ["SYN-2", "Synthetic task three", "", "", "Open"],
      ["SYN-2", "Synthetic task four", "2026-12-01", ctx.manager.email, "Cancelled"],
      ["SYN-9", "Synthetic task with a bad matter", "2026-31-31", ctx.manager.email, "Open"],
    ]);
    const counts = await dryRun(ctx, batch, {
      columns: { reference: 0, title: 1, due_on: 2, assignee: 3, status: 4 },
      default_owner: ctx.managerMembership,
    });
    expect(counts).toMatchObject({ kind: "tasks", rows: 5, create: 4, error: 1, ready: 4, problem_rows: 1 });
    const planned = await rows(batch);
    expect(planned.filter((row) => row.plan === "error").map((row) => row.row_number)).toEqual([6]);
    expect(planned[4].problems.map((problem) => problem.problem)).toEqual(
      expect.arrayContaining(["No matter has the reference “SYN-9”", "“2026-31-31” isn’t a real date"]),
    );

    // A case manager can't run any step; the owner signs off with a step-up.
    await as(ctx, "manager");
    await expectDbError(() => rpc(`public.commit_migration_kind_chunk($1, $2, 5)`, [ctx.orgId, batch]), /step-up is required/);
    await commitKind(ctx, batch);

    await asMaintenance(db);
    const tasks = await db.query<{ id: string; title: string; status: string; owner_membership_id: string; due_on: string | null; matter_id: string }>(
      `select id, title, status::text, owner_membership_id, due_on::text, matter_id from public.tasks where organization_id = $1 order by title`,
      [ctx.orgId],
    );
    expect(tasks.rows.map((task) => task.title)).toEqual(["Synthetic task four", "Synthetic task one", "Synthetic task three", "Synthetic task two"]);
    expect(tasks.rows.find((task) => task.title === "Synthetic task two")).toMatchObject({ status: "done", owner_membership_id: ctx.consultantMembership, matter_id: clients.matter1 });
    expect(tasks.rows.find((task) => task.title === "Synthetic task three")).toMatchObject({ owner_membership_id: ctx.managerMembership, due_on: null, matter_id: clients.matter2 });
    // Provenance (what MIG-02's imported_record_provenance reads): one migration_records row per
    // task, record_table "tasks", imported_at (created_at) and the batch's source system; no
    // invented task history.
    const records = await db.query<{ record_id: string; record_table: string; imported_at: string | null; source_system: string; created: boolean }>(
      `select r.record_id, r.record_table, r.created_at as imported_at, b.source_system, r.created
       from public.migration_records r join public.migration_batches b on b.id = r.batch_id where r.batch_id = $1`,
      [batch],
    );
    expect(records.rows).toHaveLength(4);
    expect(records.rows.every((row) => row.created && row.record_table === "tasks" && row.imported_at && row.source_system === "spreadsheet")).toBe(true);
    expect(records.rows.map((row) => row.record_id).sort()).toEqual(tasks.rows.map((task) => task.id).sort());
    expect((await db.query(`select 1 from public.task_events where task_id = any($1)`, [tasks.rows.map((task) => task.id)])).rows).toHaveLength(0);
    const batchRow = await db.query<{ status: string; result_counts: Record<string, number>; exceptions: { problem: string }[] }>(
      `select status::text, result_counts, exceptions from public.migration_batches where id = $1`,
      [batch],
    );
    expect(batchRow.rows[0]).toMatchObject({ status: "committed", result_counts: { records_created: 4, records_linked: 0, not_imported: 1 } });
    // The exception report keeps no value from the file.
    expect(JSON.stringify(batchRow.rows[0].exceptions)).not.toContain("SYN-9");

    // Rollback removes the four tasks; a changed task would have stopped it.
    await as(ctx);
    const rolled = await rpc<{ ok: boolean; records: number }>(`public.rollback_migration_batch($1, $2)`, [ctx.orgId, batch]);
    expect(rolled).toMatchObject({ ok: true, records: 4 });
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.tasks where organization_id = $1`, [ctx.orgId])).rows).toHaveLength(0);
  });

  it("proposes an existing task as a duplicate and never merges it silently", async () => {
    const ctx = await firm();
    await withClients(ctx);
    const first = await stage(ctx, "tasks", ["Matter", "Task", "Due"], [["SYN-1", "Synthetic follow-up", "2026-11-02"]]);
    await dryRun(ctx, first, { columns: { reference: 0, title: 1, due_on: 2 }, default_owner: ctx.managerMembership });
    await commitKind(ctx, first);

    const second = await stage(ctx, "tasks", ["Matter", "Task", "Due"], [
      ["SYN-1", "Synthetic follow-up", "2026-11-02"],
      ["SYN-2", "Synthetic second task", "2026-11-05"],
      ["SYN-2", "Synthetic second task", "2026-11-05"],
    ]);
    const counts = await dryRun(ctx, second, { columns: { reference: 0, title: 1, due_on: 2 }, default_owner: ctx.managerMembership });
    expect(counts).toMatchObject({ confirm: 2, create: 1 });
    const planned = await rows(second);
    expect(planned[0].match_record_id).not.toBeNull();
    expect(planned[2].match_row_number).toBe(3);
    // Waiting decisions stop the sign-off.
    await expectDbError(() => begin(ctx, second), /decide every possible match/);
    await as(ctx);
    await rpc(`public.decide_migration_duplicate($1, $2, 2, true)`, [ctx.orgId, second]);
    await rpc(`public.decide_migration_duplicate($1, $2, 4, false)`, [ctx.orgId, second]);
    await commitKind(ctx, second);
    await asMaintenance(db);
    const titles = await db.query<{ title: string }>(`select title from public.tasks where organization_id = $1 order by title`, [ctx.orgId]);
    // The existing task is kept (linked, not created again); "different" made the third row its own task.
    expect(titles.rows.map((row) => row.title)).toEqual(["Synthetic follow-up", "Synthetic second task", "Synthetic second task"]);
    const linked = await db.query<{ created: boolean }>(`select created from public.migration_records where batch_id = $1 order by row_number`, [second]);
    expect(linked.rows.map((row) => row.created)).toEqual([false, true, true]);
  });
});

describe("MIG-01 notes, key dates and relationships", () => {
  it("imports notes with the original author and date, and rolls them back although notes are append-only", async () => {
    const ctx = await firm();
    await withClients(ctx);
    const batch = await stage(ctx, "notes", ["Matter", "Client", "Note", "Author", "Written"], [
      ["SYN-1", "", "Synthetic note line one.\nSynthetic line two.", "Former Staff Member", "2025-03-04"],
      ["", "applicant.b@example.test", "Synthetic note found through the person", "", "2025-04-05"],
      ["", "spouse.a@example.test", "", "", "2099-01-01"],
    ]);
    const counts = await dryRun(ctx, batch, { columns: { reference: 0, person: 1, body: 2, author: 3, written_on: 4 } });
    expect(counts).toMatchObject({ create: 2, error: 1 });
    expect((await rows(batch))[2].problems.map((problem) => problem.problem)).toEqual(
      expect.arrayContaining(["No note text", "The note date is in the future"]),
    );
    await commitKind(ctx, batch);
    await asMaintenance(db);
    const notes = await db.query<{ id: string; body: string; original_author_name: string | null; original_written_on: string; author_user_id: string }>(
      `select id, body, original_author_name, original_written_on::text, author_user_id from public.matter_staff_notes where organization_id = $1 order by original_written_on`,
      [ctx.orgId],
    );
    expect(notes.rows[0]).toMatchObject({ body: "Synthetic note line one.\nSynthetic line two.", original_author_name: "Former Staff Member", original_written_on: "2025-03-04", author_user_id: ctx.owner.id });
    expect(notes.rows[1].original_author_name).toBeNull();
    const records = await db.query<{ record_table: string; original_day: string }>(
      `select record_table, (original_at at time zone 'America/Toronto')::date::text as original_day from public.migration_records where batch_id = $1 order by row_number`,
      [batch],
    );
    expect(records.rows).toEqual([
      { record_table: "matter_staff_notes", original_day: "2025-03-04" },
      { record_table: "matter_staff_notes", original_day: "2025-04-05" },
    ]);
    // Still append-only outside a rollback.
    await expectDbError(() => db.query(`delete from public.matter_staff_notes where id = $1`, [notes.rows[0].id]), /append-only/);
    await as(ctx);
    expect(await rpc(`public.rollback_migration_batch($1, $2)`, [ctx.orgId, batch])).toMatchObject({ ok: true, records: 2 });
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.matter_staff_notes where organization_id = $1`, [ctx.orgId])).rows).toHaveLength(0);
  });

  it("imports key dates as tentative deadlines with a chosen kind, and maps values only when told", async () => {
    const ctx = await firm();
    await withClients(ctx);
    const batch = await stage(ctx, "key_dates", ["Matter", "What", "When", "Kind"], [
      ["SYN-1", "Synthetic permit expiry", "2027-02-01", "Expiry"],
      ["SYN-2", "Synthetic reply due", "2026-12-15", "Letter"],
    ]);
    let counts = await dryRun(ctx, batch, { columns: { reference: 0, label: 1, date: 2, date_kind: 3 } });
    expect(counts).toMatchObject({ review: 2, create: 0 });
    counts = await dryRun(ctx, batch, {
      columns: { reference: 0, label: 1, date: 2, date_kind: 3 },
      values: { date_kind: { expiry: "legal", letter: "correspondence" } },
    });
    expect(counts).toMatchObject({ create: 2 });
    await commitKind(ctx, batch);
    await asMaintenance(db);
    const deadlines = await db.query<{ label: string; kind: string; verification: string; due_on: string; source_url: string | null }>(
      `select label, kind::text, verification::text, due_on::text, source_url from public.deadlines where organization_id = $1 order by due_on`,
      [ctx.orgId],
    );
    expect(deadlines.rows).toEqual([
      { label: "Synthetic reply due", kind: "correspondence", verification: "tentative", due_on: "2026-12-15", source_url: null },
      { label: "Synthetic permit expiry", kind: "legal", verification: "tentative", due_on: "2027-02-01", source_url: null },
    ]);
  });

  it("links existing people with the existing relationship types, and refuses a second identical link", async () => {
    const ctx = await firm();
    const clients = await withClients(ctx);
    await asMaintenance(db);
    await db.query(`insert into public.person_relationships (organization_id, from_person_id, to_person_id, relationship_type) values ($1, $2, $3, 'payer')`, [
      ctx.orgId,
      clients.applicantB,
      clients.applicantA,
    ]);
    const batch = await stage(ctx, "relationships", ["Person", "Related", "Relationship"], [
      ["applicant.a@example.test", "spouse.a@example.test", "Spouse"],
      ["Synthetic Applicant B", "Synthetic Applicant A", "payer"],
      ["Nobody Synthetic", "applicant.a@example.test", "spouse"],
      ["applicant.a@example.test", "applicant.a@example.test", "spouse"],
    ]);
    const counts = await dryRun(ctx, batch, { columns: { person: 0, related: 1, relationship: 2 } });
    expect(counts).toMatchObject({ create: 1, confirm: 1, error: 2 });
    const planned = await rows(batch);
    expect(planned[2].problems[0].problem).toBe("No client record matches “Nobody Synthetic”");
    expect(planned[3].problems.map((problem) => problem.problem)).toContain("Both columns name the same person");
    // "Different" on an exact existing link is refused; "same" keeps the existing link.
    await as(ctx);
    const refused = await rpc<Record<string, number>>(`public.decide_migration_duplicate($1, $2, 3, false)`, [ctx.orgId, batch]);
    expect(refused).toMatchObject({ error: 3 });
    await rpc(`public.decide_migration_duplicate($1, $2, 3, true)`, [ctx.orgId, batch]);
    await commitKind(ctx, batch);
    await asMaintenance(db);
    const links = await db.query<{ relationship_type: string }>(`select relationship_type::text from public.person_relationships where organization_id = $1 order by relationship_type`, [ctx.orgId]);
    expect(links.rows.map((row) => row.relationship_type)).toEqual(["payer", "spouse"]);
  });
});

describe("MIG-01 opening balances", () => {
  it("holds balances for a reviewer, posts nothing to invoices or client accounts, and needs a step-up to review", async () => {
    const ctx = await firm();
    await withClients(ctx);
    const batch = await stage(ctx, "opening_balances", ["Matter", "Type", "Balance", "As of", "Memo"], [
      ["SYN-1", "AR", "$1,250.50", "2026-09-30", "Synthetic unpaid fees"],
      ["SYN-2", "Retainer", "400", "2026-09-30", ""],
      ["SYN-2", "AR", "-20", "2026-09-30", ""],
    ]);
    const counts = await dryRun(ctx, batch, {
      columns: { reference: 0, balance_kind: 1, amount: 2, as_of: 3, description: 4 },
      values: { balance_kind: { ar: "receivable", retainer: "advance" } },
      sensitivity: { "2": "financial" },
    });
    expect(counts).toMatchObject({ create: 2, error: 1 });
    await asMaintenance(db);
    expect((await db.query<{ sensitivity: unknown }>(`select sensitivity from public.migration_batches where id = $1`, [batch])).rows[0].sensitivity).toEqual({ "2": "financial" });
    // The mapping audit counts sensitive columns and names no value.
    const audit = await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where object_id = $1 and action = 'migration.mapped' order by occurred_at desc limit 1`, [batch]);
    expect(audit.rows[0].context).toMatchObject({ sensitive_columns: 1 });
    expect(JSON.stringify(audit.rows[0].context)).not.toContain("1,250");

    await commitKind(ctx, batch);
    await asMaintenance(db);
    const balances = await db.query<{ id: string; kind: string; amount_cents: string; status: string; currency: string }>(
      `select id, kind, amount_cents::text, status, currency from public.opening_balances where organization_id = $1 order by kind`,
      [ctx.orgId],
    );
    expect(balances.rows.map((row) => [row.kind, row.amount_cents, row.status, row.currency])).toEqual([
      ["advance", "40000", "pending_review", "CAD"],
      ["receivable", "125050", "pending_review", "CAD"],
    ]);
    expect((await db.query(`select 1 from public.invoices where organization_id = $1`, [ctx.orgId])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.client_fund_ledgers where organization_id = $1`, [ctx.orgId])).rows).toHaveLength(0);

    // A case manager can't see or review them; the owner needs a fresh step-up; a rejection needs a reason.
    await as(ctx, "manager");
    expect((await db.query(`select 1 from public.opening_balances`)).rows).toHaveLength(0);
    await expectDbError(() => rpc(`public.review_opening_balance($1, $2, true, null)`, [ctx.orgId, balances.rows[0].id]), /billing access denied/);
    await as(ctx, "owner", false);
    await expectDbError(() => rpc(`public.review_opening_balance($1, $2, true, null)`, [ctx.orgId, balances.rows[0].id]), /step-up is required/);
    await as(ctx);
    await expectDbError(() => rpc(`public.review_opening_balance($1, $2, false, null)`, [ctx.orgId, balances.rows[0].id]), /a reason is required/);
    expect(await rpc(`public.review_opening_balance($1, $2, true, 'Synthetic check against old ledger')`, [ctx.orgId, balances.rows[0].id])).toMatchObject({ status: "approved" });
    await expectDbError(() => rpc(`public.review_opening_balance($1, $2, true, null)`, [ctx.orgId, balances.rows[0].id]), /already reviewed/);
    // Approval still posts nothing.
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.client_fund_ledgers where organization_id = $1`, [ctx.orgId])).rows).toHaveLength(0);
    // A reviewed balance stops the rollback.
    await as(ctx);
    const refused = await rpc<{ ok: boolean; reasons: string[] }>(`public.rollback_migration_batch($1, $2)`, [ctx.orgId, batch]);
    expect(refused.ok).toBe(false);
    expect(refused.reasons).toContain("The opening balance from row 3 was already reviewed.");
  });
});

describe("MIG-01 documents (ZIP + manifest)", () => {
  const PDF_SHA = "a".repeat(64);

  it("checks every manifest row against the ZIP's entries, then stores files through the upload path", async () => {
    const ctx = await firm();
    const clients = await withClients(ctx);
    const batch = await stage(ctx, "documents", ["File", "Client", "Matter", "Type", "Dated"], [
      ["passport.pdf", "applicant.a@example.test", "SYN-1", "Synthetic passport copy", "2024-01-02"],
      ["missing.pdf", "applicant.a@example.test", "SYN-1", "Synthetic missing file", ""],
      ["renamed.pdf", "applicant.a@example.test", "SYN-1", "Synthetic renamed image", ""],
      ["letter.pdf", "applicant.b@example.test", "SYN-1", "Synthetic letter", ""],
    ]);
    // A dry run needs the ZIP first.
    await as(ctx);
    await rpc(`public.save_migration_mapping($1, $2, $3)`, [
      ctx.orgId,
      batch,
      JSON.stringify({ columns: { file: 0, person: 1, reference: 2, document_type: 3, dated_on: 4 }, date_order: "ymd", values: {}, sensitivity: { "0": "identity" } }),
    ]);
    await expectDbError(() => rpc(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, batch]), /add the ZIP of files first/);
    const files = [
      { path: "scans/passport.pdf", base_name: "passport.pdf", byte_size: 2048, sha256: PDF_SHA, media_type: "application/pdf", problem: null },
      { path: "renamed.pdf", base_name: "renamed.pdf", byte_size: 512, sha256: "b".repeat(64), media_type: "image/png", problem: null },
      { path: "letter.pdf", base_name: "letter.pdf", byte_size: 512, sha256: "c".repeat(64), media_type: "application/pdf", problem: null },
    ];
    expect(await rpc(`public.stage_migration_files($1, $2, 'synthetic.zip', $3, 4096, $4)`, [ctx.orgId, batch, "d".repeat(64), JSON.stringify(files)])).toBe(3);
    // Once only.
    await expectDbError(() => rpc(`public.stage_migration_files($1, $2, 'again.zip', $3, 4096, '[]')`, [ctx.orgId, batch, "e".repeat(64)]), /doesn't take a ZIP now/);
    const counts = await rpc<Record<string, number>>(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, batch]);
    expect(counts).toMatchObject({ create: 1, error: 3 });
    const planned = await rows(batch);
    expect(planned[1].problems[0].problem).toBe("No file named “missing.pdf” in the ZIP");
    expect(planned[2].problems[0].problem).toBe("The file’s contents don’t match its name");
    expect(planned[3].problems[0].problem).toBe("This person isn’t on that matter");

    // MIG-02's pilot of the first file (the app sends the same ZIP again for it).
    const { plan_hash: hash } = await batchPlan(batch);
    await as(ctx);
    expect(await rpc(`public.begin_migration_pilot($1, $2, $3, 1)`, [ctx.orgId, batch, hash])).toMatchObject({ ok: true, matters: 1 });
    const next = await rpc<{ zip_sha256: string; rows: { row: number; person_id: string; matter_id: string; purpose: string; file_name: string; file_bytes: number }[] }>(
      `public.migration_document_rows($1, $2, 10)`,
      [ctx.orgId, batch],
    );
    expect(next.zip_sha256).toBe("d".repeat(64));
    expect(next.rows).toEqual([expect.objectContaining({ row: 2, person_id: clients.applicantA, matter_id: clients.matter1, file_name: "passport.pdf", file_bytes: 2048 })]);
    // The pilot can't finish while its file waits.
    expect(await rpc<{ remaining: number }>(`public.commit_migration_kind_chunk($1, $2, 5)`, [ctx.orgId, batch])).toMatchObject({ remaining: 1, phase: "pilot" });

    // The app's upload path: an intent as the owner, the stored object, the server's check.
    const intent = await rpc<{ version_id: string; storage_key: string }>(
      `public.create_upload_intent($1, $2, 'passport.pdf', 2048, 'Synthetic passport copy', 'ordinary', 'subject', null, null, null)`,
      [clients.matter1, clients.applicantA],
    );
    // A file that wasn't checked yet is refused.
    await expectDbError(() => rpc(`public.record_migration_document($1, $2, 2, $3)`, [ctx.orgId, batch, intent.version_id]), /hasn't been checked yet/);
    await asMaintenance(db);
    await db.query(`insert into storage.objects (id, bucket_id, name, metadata) values ($1, 'documents', $2, jsonb_build_object('size', 2048))`, [randomUUID(), intent.storage_key]);
    await asServiceRole(db);
    await db.query(`select public.finish_verified_document_upload($1, $2, $3, 2048, 'application/pdf')`, [intent.version_id, ctx.owner.id, PDF_SHA]);
    // Another user's version can't be recorded for the row.
    await as(ctx, "manager");
    await expectDbError(() => rpc(`public.record_migration_document($1, $2, 2, $3)`, [ctx.orgId, batch, intent.version_id]), /step-up is required/);
    await as(ctx);
    expect(await rpc(`public.record_migration_document($1, $2, 2, $3)`, [ctx.orgId, batch, intent.version_id])).toMatchObject({ document_id: expect.any(String) });
    expect(await rpc(`public.commit_migration_kind_chunk($1, $2, 5)`, [ctx.orgId, batch])).toMatchObject({ remaining: 0, status: "pilot_done" });
    // Nothing more until the firm owner signs the pilot off; then the full run (the ZIP again) finishes it.
    await expectDbError(() => rpc(`public.commit_migration_kind_chunk($1, $2, 5)`, [ctx.orgId, batch]), /sign-off before the full import/);
    await expectDbError(() => rpc(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, hash]), /needs the firm owner's sign-off/);
    await rpc(`public.sign_off_migration_pilot($1, $2, 'Synthetic pilot file checked')`, [ctx.orgId, batch]);
    expect(await rpc(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, hash])).toMatchObject({ ok: true, matters: 0 });
    expect(await rpc(`public.migration_document_rows($1, $2, 10)`, [ctx.orgId, batch])).toMatchObject({ rows: [] });
    expect(await rpc(`public.commit_migration_kind_chunk($1, $2, 5)`, [ctx.orgId, batch])).toMatchObject({ remaining: 0, status: "committed" });
    await asMaintenance(db);
    // The run report (MIG-02's shape, in records), with the ZIP's checksum beside the manifest's.
    const report = await db.query<{ run_report: Record<string, unknown> }>(`select run_report from public.migration_batches where id = $1`, [batch]);
    expect(report.rows[0].run_report).toMatchObject({
      kind: "documents",
      source: { checksum_matches: true, attachment_sha256: "d".repeat(64), rows_in_file: 4 },
      records: { documents: { created: 1, linked: 0 } },
      totals: { records_created: 1, records_linked: 0, files_held: 0 },
      rows: { rows: 4, imported: 1, error: 3 },
      pilot: { size: 1, counts: { records_created: 1 }, note: "Synthetic pilot file checked" },
    });
    expect((await db.query(`select 1 from public.migration_files where batch_id = $1`, [batch])).rows).toHaveLength(0);
    // The file's date is kept as original_at: the start of that day in the firm's timezone.
    const record = await db.query<{ original_day: string; record_table: string }>(
      `select (original_at at time zone 'America/Toronto')::text as original_day, record_table from public.migration_records where batch_id = $1`,
      [batch],
    );
    expect(record.rows).toEqual([{ original_day: "2024-01-02 00:00:00", record_table: "documents" }]);
    // Documents are never deleted, so a documents import isn't rolled back.
    await as(ctx);
    const refused = await rpc<{ ok: boolean; reasons: string[] }>(`public.rollback_migration_batch($1, $2)`, [ctx.orgId, batch]);
    expect(refused.ok).toBe(false);
    expect(refused.reasons[0]).toMatch(/never deletes a document/);
  });
});

describe("MIG-01 kinds through MIG-02's pilot, sign-off and run report", () => {
  it("creates only the pilot's records, waits for the sign-off, then writes the run report", async () => {
    const ctx = await firm();
    await withClients(ctx);
    const batch = await stage(ctx, "tasks", ["Matter", "Task", "Due"], [
      ["SYN-1", "Synthetic pilot task one", "2026-11-02"],
      ["SYN-1", "Synthetic pilot task two", "2026-11-03"],
      ["SYN-2", "Synthetic full-run task", "2026-11-04"],
      ["SYN-9", "Synthetic task with a bad matter", "2026-11-05"],
    ]);
    await dryRun(ctx, batch, { columns: { reference: 0, title: 1, due_on: 2 }, default_owner: ctx.managerMembership });
    const { plan_hash: hash } = await batchPlan(batch);
    // The full run is refused before a pilot.
    await as(ctx);
    await expectDbError(() => rpc(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, hash]), /run a pilot first/);
    // The pilot needs the firm owner's step-up.
    await as(ctx, "owner", false);
    await expectDbError(() => rpc(`public.begin_migration_pilot($1, $2, $3, 2)`, [ctx.orgId, batch, hash]), /step-up is required/);
    await as(ctx);
    expect(await rpc(`public.begin_migration_pilot($1, $2, $3, 2, 'Synthetic Old System')`, [ctx.orgId, batch, hash])).toEqual({ ok: true, matters: 2 });
    expect(await chunk(ctx, batch, "tasks", 50)).toMatchObject({ remaining: 0, status: "pilot_done", phase: "pilot" });
    await asMaintenance(db);
    const titles = async () =>
      (await db.query<{ title: string }>(`select title from public.tasks where organization_id = $1 order by title`, [ctx.orgId])).rows.map((row) => row.title);
    expect(await titles()).toEqual(["Synthetic pilot task one", "Synthetic pilot task two"]);
    const pilot = await db.query<{ pilot_counts: Record<string, unknown>; pilot_completed_at: string | null }>(
      `select pilot_counts, pilot_completed_at from public.migration_batches where id = $1`,
      [batch],
    );
    expect(pilot.rows[0]).toMatchObject({ pilot_counts: { kind: "tasks", records_created: 2, records_linked: 0 }, pilot_completed_at: expect.anything() });
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'migration.pilot_completed'`, [batch])).rows).toHaveLength(1);
    // Nothing more until the sign-off.
    await as(ctx);
    await expectDbError(() => chunk(ctx, batch, "tasks"), /sign-off before the full import/);
    await expectDbError(() => rpc(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, hash]), /needs the firm owner's sign-off/);
    await as(ctx);
    await rpc(`public.sign_off_migration_pilot($1, $2, 'Synthetic tasks checked on both matters')`, [ctx.orgId, batch]);
    expect(await rpc(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, hash])).toEqual({ ok: true, matters: 1 });
    expect(await chunk(ctx, batch, "tasks", 50)).toMatchObject({ remaining: 0, status: "committed" });
    await asMaintenance(db);
    expect(await titles()).toEqual(["Synthetic full-run task", "Synthetic pilot task one", "Synthetic pilot task two"]);
    const done = await db.query<{ run_report: Record<string, unknown>; result_counts: Record<string, unknown>; exceptions: unknown[] }>(
      `select run_report, result_counts, exceptions from public.migration_batches where id = $1`,
      [batch],
    );
    expect(done.rows[0].result_counts).toMatchObject({ kind: "tasks", records_created: 3, records_linked: 0, not_imported: 1 });
    expect(done.rows[0].exceptions).toHaveLength(1);
    expect(done.rows[0].run_report).toMatchObject({
      kind: "tasks",
      source: { source_system: "Synthetic Old System", rows_in_file: 4, rows_staged: 4, checksum_matches: true, verified_at_commit: expect.anything() },
      records: { tasks: { created: 3, linked: 0 } },
      totals: { records_created: 3, records_linked: 0 },
      rows: { rows: 4, imported: 3, created: 3, error: 1, exception_lines: 1 },
      pilot: { size: 2, counts: { records_created: 2 }, note: "Synthetic tasks checked on both matters" },
      full_run_started_at: expect.anything(),
    });
    // The report holds no value from the file.
    expect(JSON.stringify(done.rows[0].run_report)).not.toContain("SYN-9");
    // The firm owner can download it (audited).
    await as(ctx);
    await rpc(`public.record_migration_report_download($1, $2, 'csv')`, [ctx.orgId, batch]);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'migration.report_downloaded'`, [batch])).rows).toHaveLength(1);
  });

  it("rolls a key dates pilot back before its sign-off", async () => {
    const ctx = await firm();
    await withClients(ctx);
    const batch = await stage(ctx, "key_dates", ["Matter", "What", "When"], [
      ["SYN-1", "Synthetic pilot date", "2027-02-01"],
      ["SYN-2", "Synthetic later date", "2027-03-01"],
    ]);
    await dryRun(ctx, batch, { columns: { reference: 0, label: 1, date: 2 }, default_date_kind: "internal" });
    const { plan_hash: hash } = await batchPlan(batch);
    await as(ctx);
    expect(await rpc(`public.begin_migration_pilot($1, $2, $3, 1)`, [ctx.orgId, batch, hash])).toEqual({ ok: true, matters: 1 });
    expect(await chunk(ctx, batch, "key_dates", 50)).toMatchObject({ status: "pilot_done" });
    await as(ctx);
    expect(await rpc(`public.migration_rollback_check($1, $2)`, [ctx.orgId, batch])).toEqual([]);
    expect(await rpc(`public.rollback_migration_batch($1, $2)`, [ctx.orgId, batch])).toMatchObject({ ok: true, records: 1 });
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.deadlines where organization_id = $1`, [ctx.orgId])).rows).toHaveLength(0);
    expect((await db.query<{ status: string }>(`select status::text from public.migration_batches where id = $1`, [batch])).rows[0].status).toBe("rolled_back");
  });
});

describe("MIG-01 mapping rules and access", () => {
  it("validates each kind's columns, the sensitivity classes, and when the kind can change", async () => {
    const ctx = await firm();
    await withClients(ctx);
    const batch = await stage(ctx, "tasks", ["Matter", "Task", "Passport"], [["SYN-1", "Synthetic task", "X0000000"]]);
    await as(ctx);
    const save = (mapping: Record<string, unknown>) =>
      rpc(`public.save_migration_mapping($1, $2, $3)`, [ctx.orgId, batch, JSON.stringify({ date_order: "ymd", values: {}, ...mapping })]);
    await expectDbError(() => save({ columns: { title: 1 } }), /required field \(reference\)/);
    await expectDbError(() => save({ columns: { reference: 0, title: 1, name: 2 } }), /mapping is not valid/);
    await expectDbError(() => save({ columns: { reference: 0, title: 1 }, sensitivity: { "2": "secret" } }), /mapping is not valid/);
    await expectDbError(() => save({ columns: { reference: 0, title: 1 }, sensitivity: { "9": "identity" } }), /mapping is not valid/);
    await expectDbError(() => save({ columns: { reference: 0, title: 1 }, values: { program: {} } }), /mapping is not valid/);
    await save({ columns: { reference: 0, title: 1 }, sensitivity: { "2": "identity" }, default_owner: ctx.managerMembership });
    // The kind is chosen before mapping only.
    await expectDbError(() => rpc(`public.set_migration_kind($1, $2, 'notes')`, [ctx.orgId, batch]), /kind can't change now/);
    // Only the firm owner can set a kind.
    await as(ctx, "manager");
    await expectDbError(() => rpc(`public.set_migration_kind($1, $2, 'notes')`, [ctx.orgId, batch]), /staff access denied/);
    // The clients import keeps its own rule and message.
    await as(ctx);
    await rpc(`public.discard_migration_batch($1, $2)`, [ctx.orgId, batch]);
    const clients = await stage(ctx, "clients_matters", ["Name"], [["Synthetic Person"]]);
    await expectDbError(() => rpc(`public.save_migration_mapping($1, $2, $3)`, [ctx.orgId, clients, JSON.stringify({ columns: { title: 0 }, date_order: "dmy", values: {} })]), /map a column to the person's name/);
    await expectDbError(() => rpc(`public.set_migration_kind($1, $2, 'gifts')`, [ctx.orgId, clients]), /choose what the file holds/);
  });

  it("keeps the new tables under forced RLS", async () => {
    const forced = await db.query<{ relname: string; relforcerowsecurity: boolean }>(
      `select relname, relforcerowsecurity from pg_class where relname in ('migration_files', 'opening_balances') order by relname`,
    );
    expect(forced.rows).toEqual([
      { relname: "migration_files", relforcerowsecurity: true },
      { relname: "opening_balances", relforcerowsecurity: true },
    ]);
  });
});
