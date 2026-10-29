import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rowsDigest, sha256Hex } from "@/modules/migration/csv";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * MIG follow-ups (gap #187, Francis's MIG decisions): one kind of record per file (a file whose
 * columns match more than one kind is refused at staging and at mapping, naming the kinds), and
 * key dates, relationships and opening balances carry "Imported from <system> on <date>" through
 * public.imported_record_provenance like people, matters, tasks and notes. Synthetic data only:
 * every name, email and reference here is fake.
 */

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const SYSTEM = "Synthetic Legacy CRM";

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
  await asUser(db, { userId: owner.id, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await member(orgId, consultant.id, "licensed_consultant", owner.id);
  await member(orgId, manager.id, "case_manager", owner.id);
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
  return { owner, consultant, manager, orgId, consultantMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const as = (ctx: Firm, who: "owner" | "manager" = "owner") => asUser(db, { userId: ctx[who].id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });

async function rpc<T = unknown>(sql: string, params: unknown[]): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

/** Stages a file (and sets its kind, as the upload does for every kind); seals it when asked. */
async function stage(ctx: Firm, kind: string | null, headers: string[], rows: string[][]) {
  await as(ctx);
  const batch = await rpc<string>(`public.stage_migration_batch($1, $2, $3, $4, $5, $6, $7)`, [
    ctx.orgId,
    "synthetic.csv",
    await sha256Hex(`synthetic ${randomUUID()}`),
    1024,
    rows.length,
    await rowsDigest(rows),
    headers,
  ]);
  if (kind) await rpc(`public.set_migration_kind($1, $2, $3)`, [ctx.orgId, batch, kind]);
  await rpc(`public.append_migration_rows($1, $2, 2, $3)`, [ctx.orgId, batch, JSON.stringify(rows)]);
  const sealed = await rpc<{ ok: boolean }>(`public.seal_migration_batch($1, $2)`, [ctx.orgId, batch]);
  expect(sealed.ok).toBe(true);
  return batch;
}

async function kindsIn(headers: string[]) {
  await asMaintenance(db);
  return (await db.query<{ kinds: string[] }>(`select app.migration_kinds_in_headers($1::text[]) as kinds`, [headers])).rows[0].kinds;
}

async function chunks(ctx: Firm, batch: string, kind: string) {
  let left = 1;
  while (left > 0) {
    await as(ctx);
    const state =
      kind === "clients_matters"
        ? await rpc<{ remaining: number }>(`public.commit_migration_chunk($1, $2, 5)`, [ctx.orgId, batch])
        : await rpc<{ remaining: number }>(`public.commit_migration_kind_chunk($1, $2, 5)`, [ctx.orgId, batch]);
    left = state.remaining;
  }
}

/** Map, dry run, pilot of one record named from SYSTEM, sign-off, full run. */
async function importAll(ctx: Firm, batch: string, kind: string, mapping: Record<string, unknown>) {
  await as(ctx);
  await rpc(`public.save_migration_mapping($1, $2, $3)`, [ctx.orgId, batch, JSON.stringify({ date_order: "ymd", values: {}, ...mapping })]);
  await rpc(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, batch]);
  await asMaintenance(db);
  const hash = (await db.query<{ plan_hash: string }>(`select plan_hash from public.migration_batches where id = $1`, [batch])).rows[0].plan_hash;
  await as(ctx);
  const piloted = await rpc<{ ok: boolean }>(`public.begin_migration_pilot($1, $2, $3, $4, $5)`, [ctx.orgId, batch, hash, 1, SYSTEM]);
  expect(piloted.ok).toBe(true);
  await chunks(ctx, batch, kind);
  await as(ctx);
  await rpc(`public.sign_off_migration_pilot($1, $2, 'Synthetic pilot checked')`, [ctx.orgId, batch]);
  const begun = await rpc<{ ok: boolean }>(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, hash]);
  expect(begun.ok).toBe(true);
  await chunks(ctx, batch, kind);
}

describe("MIG decision 2: one kind of record per file", () => {
  it("finds kinds only from headings distinctive to them", async () => {
    expect(await kindsIn(["Matter", "Task", "Due", "Key date", "Date type"])).toEqual(["Tasks", "Key dates"]);
    expect(await kindsIn(["First name", "Last name", "Program", "Task", "Assignee", "Opening balance"])).toEqual([
      "Clients and matters",
      "Tasks",
      "Financial opening balances",
    ]);
    expect(await kindsIn(["Person", "Related to", "Relationship", "Note text"])).toEqual(["People relationships", "Notes"]);
    // A clients file with a Notes or Relationship column (the role on the matter) is still one kind.
    expect(await kindsIn(["Full Name", "DOB", "Email", "File #", "Program", "Status", "Role", "Relationship", "Notes"])).toEqual(["Clients and matters"]);
    // The headings every kind shares point to none.
    expect(await kindsIn(["Matter", "Client", "Date", "Type", "Description"])).toEqual([]);
    // The single-kind files the import's own tests use stay single-kind.
    for (const headers of [
      ["Name", "Email", "File", "Role"],
      ["Matter", "Task", "Due", "Assignee", "Status"],
      ["Matter", "Client", "Note", "Author", "Written"],
      ["Matter", "What", "When", "Kind"],
      ["Person", "Related", "Relationship"],
      ["Matter", "Type", "Balance", "As of", "Memo"],
      ["File", "Client", "Matter", "Type", "Dated"],
    ]) {
      expect((await kindsIn(headers)).length).toBeLessThanOrEqual(1);
    }
  });

  it("refuses a mixed file at staging, naming the kinds, for every kind chosen", async () => {
    const ctx = await firm();
    const headers = ["Matter", "Task", "Due", "Key date", "Date type"];
    for (const kind of ["tasks", "key_dates", "clients_matters"]) {
      await as(ctx);
      const batch = await rpc<string>(`public.stage_migration_batch($1, $2, $3, $4, $5, $6, $7)`, [
        ctx.orgId,
        "mixed.csv",
        await sha256Hex(`synthetic mixed ${randomUUID()}`),
        512,
        1,
        await rowsDigest([["SYN-1", "Synthetic task", "2026-11-02", "Synthetic expiry", "Expiry"]]),
        headers,
      ]);
      await expectDbError(() => rpc(`public.set_migration_kind($1, $2, $3)`, [ctx.orgId, batch, kind]), /more than one kind of record: Tasks; Key dates/);
      // The upload discards the batch; nothing was taken.
      await rpc(`public.discard_migration_batch($1, $2)`, [ctx.orgId, batch]);
    }
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.migration_rows r join public.migration_batches b on b.id = r.batch_id where b.organization_id = $1`, [ctx.orgId])).rows).toHaveLength(0);
    expect(
      (await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where organization_id = $1 and action = 'migration.kind_set'`, [ctx.orgId])).rows[0].n,
    ).toBe(0);
  });

  it("refuses a mixed file at mapping too (a batch staged before the check), and lets a single-kind file through", async () => {
    const ctx = await firm();
    // Staged without set_migration_kind, as a clients upload was before this change.
    const mixed = await stage(ctx, null, ["Full Name", "Email", "File #", "Program", "Task", "Assignee"], [
      ["Synthetic Person", "synthetic.person@example.test", "SYN-1", "Synthetic program", "Synthetic task", "nobody@example.test"],
    ]);
    await as(ctx);
    await expectDbError(
      () =>
        rpc(`public.save_migration_mapping($1, $2, $3)`, [
          ctx.orgId,
          mixed,
          JSON.stringify({ columns: { name: 0, email: 1, reference: 2 }, date_order: "dmy", default_consultant: ctx.consultantMembership, values: {} }),
        ]),
      /more than one kind of record: Clients and matters; Tasks/,
    );
    await asMaintenance(db);
    expect((await db.query<{ mapping: unknown }>(`select mapping from public.migration_batches where id = $1`, [mixed])).rows[0].mapping).toEqual({});
    await as(ctx);
    await rpc(`public.discard_migration_batch($1, $2)`, [ctx.orgId, mixed]);

    const single = await stage(ctx, "clients_matters", ["Full Name", "Email", "File #", "Notes"], [["Synthetic Person B", "synthetic.b@example.test", "SYN-2", "Synthetic note"]]);
    await as(ctx);
    await rpc(`public.save_migration_mapping($1, $2, $3)`, [
      ctx.orgId,
      single,
      JSON.stringify({ columns: { name: 0, email: 1, reference: 2 }, date_order: "dmy", default_consultant: ctx.consultantMembership, values: {} }),
    ]);
    const counts = await rpc<Record<string, number>>(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, single]);
    expect(counts).toMatchObject({ create: 1 });
  });
});

describe("MIG follow-ups: key dates, relationships and opening balances say where they came from", () => {
  it("gives any staff member the source system, import date and original date of each", async () => {
    const ctx = await firm();
    const clients = await stage(ctx, "clients_matters", ["Name", "Email", "File", "Role"], [
      ["Synthetic Applicant A", "applicant.a@example.test", "SYN-1", "applicant"],
      ["Synthetic Spouse A", "spouse.a@example.test", "SYN-1", "dependant"],
      ["Synthetic Applicant B", "applicant.b@example.test", "SYN-2", "applicant"],
    ]);
    await importAll(ctx, clients, "clients_matters", { columns: { name: 0, email: 1, reference: 2, role: 3 }, date_order: "dmy", default_consultant: ctx.consultantMembership });

    const dates = await stage(ctx, "key_dates", ["Matter", "What", "When", "Kind", "Recorded"], [
      ["SYN-1", "Synthetic permit expiry", "2027-02-01", "legal", "2019-03-04"],
      ["SYN-1", "Synthetic reply due", "2026-12-15", "correspondence", ""],
    ]);
    await importAll(ctx, dates, "key_dates", { columns: { reference: 0, label: 1, date: 2, date_kind: 3, recorded_on: 4 } });

    const links = await stage(ctx, "relationships", ["Person", "Related", "Relationship"], [
      ["applicant.a@example.test", "spouse.a@example.test", "spouse"],
      ["applicant.b@example.test", "applicant.a@example.test", "payer"],
    ]);
    await importAll(ctx, links, "relationships", { columns: { person: 0, related: 1, relationship: 2 } });

    const balances = await stage(ctx, "opening_balances", ["Matter", "Type", "Balance", "As of"], [
      ["SYN-1", "receivable", "125.00", "2026-09-30"],
      ["SYN-2", "receivable", "50.00", "2026-09-30"],
    ]);
    await importAll(ctx, balances, "opening_balances", { columns: { reference: 0, balance_kind: 1, amount: 2, as_of: 3 } });

    await asMaintenance(db);
    const deadlineIds = (await db.query<{ id: string; label: string }>(`select id, label from public.deadlines where organization_id = $1 order by label`, [ctx.orgId])).rows;
    const relationshipIds = (await db.query<{ id: string }>(`select id from public.person_relationships where organization_id = $1`, [ctx.orgId])).rows.map((row) => row.id);
    const balanceIds = (await db.query<{ id: string }>(`select id from public.opening_balances where organization_id = $1`, [ctx.orgId])).rows.map((row) => row.id);
    expect(deadlineIds).toHaveLength(2);
    expect(relationshipIds).toHaveLength(2);
    expect(balanceIds).toHaveLength(2);

    // A case manager (staff, two-step) reads the provenance; no cell values come back.
    await as(ctx, "manager");
    type Row = { id: string; system: string; imported_at: string; original_at: string | null; created: boolean };
    const provenance = async (table: string, ids: string[]) => rpc<Row[]>(`public.imported_record_provenance($1, $2, $3::uuid[])`, [ctx.orgId, table, ids]);
    const deadlines = await provenance("deadlines", deadlineIds.map((row) => row.id));
    expect(deadlines).toHaveLength(2);
    expect(deadlines.every((row) => row.system === SYSTEM && row.created && row.imported_at)).toBe(true);
    const expiry = deadlines.find((row) => row.id === deadlineIds.find((d) => d.label === "Synthetic permit expiry")!.id)!;
    const reply = deadlines.find((row) => row.id === deadlineIds.find((d) => d.label === "Synthetic reply due")!.id)!;
    expect(expiry.original_at).not.toBeNull();
    expect(reply.original_at).toBeNull();
    const relationships = await provenance("person_relationships", relationshipIds);
    expect(relationships).toHaveLength(2);
    expect(relationships.every((row) => row.system === SYSTEM && row.created)).toBe(true);
    const opening = await provenance("opening_balances", balanceIds);
    expect(opening).toHaveLength(2);
    expect(opening.every((row) => row.system === SYSTEM && row.created && row.original_at)).toBe(true);
    // No label, amount or address leaks into provenance. The amount is matched as a whole JSON value:
    // a random uuid or a millisecond timestamp can contain the digits 125.
    expect(JSON.stringify([deadlines, relationships, opening])).not.toMatch(/Synthetic permit|[:"]125(\.0+)?[",}\]]|applicant\.a/);

    // Imported history is not a native audit event: no deadline, relationship or balance audit row
    // dated at the file's original date exists.
    await asMaintenance(db);
    const old = await db.query(`select 1 from public.audit_log where organization_id = $1 and occurred_at < now() - interval '1 day'`, [ctx.orgId]);
    expect(old.rows).toHaveLength(0);

    // Another firm's staff can't read them.
    const other = await firm();
    await asUser(db, { userId: other.manager.id, aal: "aal2", orgId: other.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => rpc(`public.imported_record_provenance($1, 'deadlines', $2::uuid[])`, [ctx.orgId, deadlineIds.map((row) => row.id)]), /staff access denied/);
    expect(await rpc<Row[]>(`public.imported_record_provenance($1, 'deadlines', $2::uuid[])`, [other.orgId, deadlineIds.map((row) => row.id)])).toEqual([]);
  });
});
