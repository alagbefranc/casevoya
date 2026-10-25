import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rowsDigest, sha256Hex } from "@/modules/migration/csv";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Migration import (T044, PRD §25): staging with count and checksum verification, mapping, the dry
 * run, duplicate review, sign-off (owner + step-up) through create_client_matter, and rollback with
 * its refusals. Synthetic data only.
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
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
  ]);
  return id;
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

async function publishPack(orgId: string, programKey: string) {
  await asMaintenance(db);
  await db.exec(`alter table public.rule_pack_versions disable trigger rule_pack_versions_guard`);
  const pack = await db.query<{ id: string }>(
    `insert into public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version, status, content_frozen)
     values ($1, 'CA', $2, 1, 'published', true) returning id`,
    [orgId, programKey],
  );
  await db.exec(`alter table public.rule_pack_versions enable trigger rule_pack_versions_guard`);
  return pack.rows[0].id;
}

async function firm({ sampleMode = false }: { sampleMode?: boolean } = {}) {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await member(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await member(orgId, manager, "case_manager", owner);
  await verifiedLicence(owner, consultant, orgId, consultantMembership);
  const pack = await publishPack(orgId, `express_entry_${randomUUID().slice(0, 6)}`);
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = $2 where id = $1`, [orgId, sampleMode]);
  return { owner, consultant, manager, orgId, consultantMembership, managerMembership, pack };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const as = (ctx: Firm, who: "owner" | "manager" | "consultant" = "owner", stepUp = true) =>
  asUser(db, { userId: ctx[who], aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: stepUp ? 0 : 3600 });

async function rpc<T = unknown>(sql: string, params: unknown[]): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

const HEADERS = ["Full Name", "DOB", "Email", "File #", "Program", "Status", "Role"];

async function stage(ctx: Firm, rows: string[][], options: { digest?: string; declared?: number } = {}) {
  await as(ctx);
  const batch = await rpc<string>(`public.stage_migration_batch($1, $2, $3, $4, $5, $6, $7)`, [
    ctx.orgId,
    "clients.csv",
    await sha256Hex("synthetic file bytes"),
    2048,
    options.declared ?? rows.length,
    options.digest ?? (await rowsDigest(rows)),
    HEADERS,
  ]);
  await rpc(`public.append_migration_rows($1, $2, 2, $3)`, [ctx.orgId, batch, JSON.stringify(rows)]);
  const sealed = await rpc<{ ok: boolean; rows: number }>(`public.seal_migration_batch($1, $2)`, [ctx.orgId, batch]);
  return { batch, sealed };
}

function mapping(ctx: Firm, extra: Record<string, unknown> = {}) {
  return {
    columns: { name: 0, date_of_birth: 1, email: 2, reference: 3, program: 4, stage: 5, role: 6 },
    date_order: "dmy",
    default_consultant: ctx.consultantMembership,
    values: {
      program: { "express entry": ctx.pack },
      stage: { active: "intake" },
    },
    ...extra,
  };
}

async function dryRun(ctx: Firm, batch: string, map = mapping(ctx)) {
  await as(ctx);
  await rpc(`public.save_migration_mapping($1, $2, $3)`, [ctx.orgId, batch, JSON.stringify(map)]);
  return rpc<Record<string, number | string>>(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, batch]);
}

async function planHash(ctx: Firm, batch: string) {
  await asMaintenance(db);
  return (await db.query<{ plan_hash: string }>(`select plan_hash from public.migration_batches where id = $1`, [batch])).rows[0].plan_hash;
}

async function chunks(ctx: Firm, batch: string) {
  let left = 1;
  while (left > 0) {
    const chunk = await rpc<{ remaining: number }>(`public.commit_migration_chunk($1, $2, 2)`, [ctx.orgId, batch]);
    left = chunk.remaining;
  }
}

/** MIG-02: a pilot (the first matter), the firm owner's sign-off, then the full run. */
async function commit(ctx: Firm, batch: string) {
  const hash = await planHash(ctx, batch);
  await as(ctx);
  const begun = await rpc<{ ok: boolean; reason?: string }>(`public.begin_migration_pilot($1, $2, $3, 1)`, [ctx.orgId, batch, hash]);
  if (!begun.ok) return begun;
  await chunks(ctx, batch);
  await rpc(`public.sign_off_migration_pilot($1, $2, 'Synthetic pilot checked')`, [ctx.orgId, batch]);
  await rpc(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, hash]);
  await chunks(ctx, batch);
  return begun;
}

async function rows(batch: string) {
  await asMaintenance(db);
  return (
    await db.query<{ row_number: number; plan: string; problems: { column: string; problem: string; fix: string }[]; match_person_id: string | null; match_row_number: number | null }>(
      `select row_number, plan::text, problems, match_person_id, match_row_number from public.migration_rows where batch_id = $1 order by row_number`,
      [batch],
    )
  ).rows;
}

const PRIYA = ["Priya Sharma", "09/03/1984", "priya@example.test", "2026-142", "Express Entry", "Active", "applicant"];
const RAFAEL = ["Rafael Sharma", "21/11/1981", "", "2026-142", "Express Entry", "Active", "sponsor"];
const KOFI = ["Kofi Mensah", "02/05/1990", "", "2026-131", "Express Entry", "Active", "applicant"];

describe("migration import: staging, verification and access", () => {
  it("stages a verified batch for the firm owner only, with forced RLS on every table", async () => {
    const ctx = await firm();
    const { batch, sealed } = await stage(ctx, [PRIYA, RAFAEL]);
    expect(sealed).toMatchObject({ ok: true, rows: 2 });

    await as(ctx);
    expect((await db.query(`select id from public.migration_batches where id = $1`, [batch])).rows).toHaveLength(1);
    expect((await db.query(`select id from public.migration_rows where batch_id = $1`, [batch])).rows).toHaveLength(2);

    // A case manager and a licensed consultant of the same firm see nothing and can't stage.
    for (const who of ["manager", "consultant"] as const) {
      await as(ctx, who);
      expect((await db.query(`select id from public.migration_batches`)).rows).toHaveLength(0);
      expect((await db.query(`select id from public.migration_rows`)).rows).toHaveLength(0);
      await expectDbError(
        () => rpc(`public.stage_migration_batch($1, 'x.csv', repeat('a', 64), 10, 1, repeat('b', 64), array['Name'])`, [ctx.orgId]),
        /staff access denied/,
      );
      await expectDbError(() => rpc(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, batch]), /staff access denied/);
    }

    // Another firm's owner: no rows, and naming this batch under their own firm finds nothing.
    const other = await firm();
    await as(other);
    expect((await db.query(`select id from public.migration_batches where id = $1`, [batch])).rows).toHaveLength(0);
    await expectDbError(() => rpc(`public.run_migration_dry_run($1, $2)`, [other.orgId, batch]), /migration batch not found/);
    // Forging the firm id: refused before anything is read.
    await expectDbError(() => rpc(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, batch]), /staff access denied/);

    const forced = await db.query<{ relname: string; relforcerowsecurity: boolean }>(
      `select relname, relforcerowsecurity from pg_class where relname in ('migration_batches', 'migration_rows', 'migration_records', 'migration_settings') order by relname`,
    );
    expect(forced.rows.every((row) => row.relforcerowsecurity)).toBe(true);
    expect(forced.rows).toHaveLength(4);
  });

  it("discards a batch whose staged rows don't match the parser's checksum, and purges its rows", async () => {
    const ctx = await firm();
    const { batch, sealed } = await stage(ctx, [PRIYA], { digest: await rowsDigest([KOFI]) });
    expect(sealed.ok).toBe(false);
    await asMaintenance(db);
    const row = await db.query<{ status: string; staging_purged_at: string | null }>(`select status::text, staging_purged_at from public.migration_batches where id = $1`, [batch]);
    expect(row.rows[0].status).toBe("discarded");
    expect(row.rows[0].staging_purged_at).not.toBeNull();
    expect((await db.query(`select 1 from public.migration_rows where batch_id = $1`, [batch])).rows).toHaveLength(0);
    // The checksum the database computes equals the app's for the same cells.
    const ok = await stage(ctx, [PRIYA, ["Ünïcödé “quoted”", "", "", "", "", "", ""]]);
    expect(ok.sealed.ok).toBe(true);
  });

  it("enforces the row limits, the declared count, order, and one open import per firm", async () => {
    const ctx = await firm();
    await as(ctx);
    await expectDbError(
      () => rpc(`public.stage_migration_batch($1, 'big.csv', repeat('a', 64), 100, 5001, repeat('b', 64), array['Name'])`, [ctx.orgId]),
      /up to 5,000 rows/,
    );
    await expectDbError(
      () => rpc(`public.stage_migration_batch($1, 'big.csv', repeat('a', 64), 5242881, 10, repeat('b', 64), array['Name'])`, [ctx.orgId]),
      /larger than 5 MB/,
    );
    const batch = await rpc<string>(`public.stage_migration_batch($1, 'a.csv', repeat('a', 64), 100, 1, repeat('b', 64), array['Name'])`, [ctx.orgId]);
    await expectDbError(() => rpc(`public.append_migration_rows($1, $2, 3, '[["A"]]'::jsonb)`, [ctx.orgId, batch]), /in order/);
    await expectDbError(() => rpc(`public.append_migration_rows($1, $2, 2, '[["A"],["B"]]'::jsonb)`, [ctx.orgId, batch]), /more rows than the file declared/);
    await expectDbError(
      () => rpc(`public.stage_migration_batch($1, 'b.csv', repeat('a', 64), 100, 1, repeat('b', 64), array['Name'])`, [ctx.orgId]),
      /finish or discard the open import/,
    );
    await rpc(`public.discard_migration_batch($1, $2)`, [ctx.orgId, batch]);
    await rpc<string>(`public.stage_migration_batch($1, 'b.csv', repeat('a', 64), 100, 1, repeat('b', 64), array['Name'])`, [ctx.orgId]);
  });
});

describe("migration import: dry run, values and duplicates", () => {
  it("reports row-level errors and unknown values as needs review, never inventing a value", async () => {
    const ctx = await firm();
    const { batch } = await stage(ctx, [
      PRIYA,
      ["Ana Lima", "31/02/1990", "ana@example.test", "", "Express Entry", "Active", "applicant"],
      ["Omar Haddad", "", "", "", "Startup Visa", "Active", "applicant"],
      ["Lena Park", "", "", "", "Express Entry", "Archived", "applicant"],
      ["", "", "", "", "", "", ""],
      ["Child Haddad", "", "", "2026-142", "Express Entry", "Active", "grandchild"],
    ]);
    const counts = await dryRun(ctx, batch);
    const plan = await rows(batch);
    expect(plan.map((row) => [row.row_number, row.plan])).toEqual([
      [2, "create"],
      [3, "error"],
      [4, "review"],
      [5, "review"],
      [6, "error"],
      [7, "review"],
    ]);
    expect(plan[1].problems[0]).toEqual({ column: "DOB", problem: "“31/02/1990” isn’t a real date", fix: "Correct the date or leave it unknown" });
    expect(plan[2].problems[0].problem).toBe("Program “Startup Visa” isn’t one of your programs");
    expect(plan[3].problems[0].problem).toBe("Stage “Archived” isn’t a Casevoya stage");
    expect(plan[4].problems[0].problem).toBe("No name");
    expect(plan[5].problems[0].problem).toBe("Role “grandchild” isn’t mapped");
    expect(counts).toMatchObject({ rows: 6, create: 1, error: 2, review: 3, matters: 1, problem_rows: 5 });

    // Mapping the unknown values (or choosing not imported) clears them; nothing else changes.
    const fixed = await dryRun(
      ctx,
      batch,
      mapping(ctx, { values: { program: { "express entry": ctx.pack, "startup visa": "none" }, stage: { active: "intake", archived: "none" }, role: { grandchild: "dependant" } } }),
    );
    expect(fixed).toMatchObject({ create: 4, error: 2, review: 0, matters: 3 });
  });

  it("suggests a possible duplicate by name plus one more detail, waits for a person, and never merges", async () => {
    const ctx = await firm();
    // An existing client: same name and date of birth as row 2; same email alone (row 3) is not a match.
    await asMaintenance(db);
    const existing = await db.query<{ id: string }>(
      `insert into public.persons (organization_id, display_name, email, date_of_birth, birth_date_precision, is_sample)
       values ($1, 'Priya  Sharma', 'other@example.test', '1984-03-09', 'day', false) returning id`,
      [ctx.orgId],
    );
    const { batch } = await stage(ctx, [
      PRIYA,
      ["Someone Else", "", "other@example.test", "2026-200", "Express Entry", "Active", "applicant"],
      ["Kofi Mensah", "02/05/1990", "", "2026-131", "Express Entry", "Active", "applicant"],
      ["K. Mensah", "02/05/1990", "", "2026-150", "Express Entry", "Active", "applicant"],
      ["Kofi Mensah", "02/05/1990", "", "2026-151", "Express Entry", "Active", "applicant"],
    ]);
    const counts = await dryRun(ctx, batch);
    const plan = await rows(batch);
    expect(plan[0]).toMatchObject({ plan: "confirm", match_person_id: existing.rows[0].id });
    expect(plan[1].plan).toBe("create");
    expect(plan[2].plan).toBe("create");
    expect(plan[3].plan).toBe("create"); // a different name is not a match
    expect(plan[4]).toMatchObject({ plan: "confirm", match_row_number: 4 });
    expect(counts).toMatchObject({ confirm: 2, matters_waiting: 2 });

    // Sign-off waits for every decision.
    const hash = await planHash(ctx, batch);
    await as(ctx);
    await expectDbError(() => rpc(`public.begin_migration_pilot($1, $2, $3)`, [ctx.orgId, batch, hash]), /decide every possible match/);

    await rpc(`public.decide_migration_duplicate($1, $2, 2, true)`, [ctx.orgId, batch]);
    const decided = await rpc<Record<string, number>>(`public.decide_migration_duplicate($1, $2, 6, false)`, [ctx.orgId, batch]);
    expect(decided).toMatchObject({ confirm: 0, link: 1, create: 4, matters: 5 });

    await commit(ctx, batch);
    await asMaintenance(db);
    // The existing person is the applicant of a new matter; their record is untouched.
    const person = await db.query<{ display_name: string; email: string; version: number }>(`select display_name, email, version from public.persons where id = $1`, [existing.rows[0].id]);
    expect(person.rows[0]).toEqual({ display_name: "Priya  Sharma", email: "other@example.test", version: 1 });
    const applicants = await db.query<{ n: number }>(
      `select count(*)::int as n from public.matter_participants where person_id = $1 and role = 'applicant'`,
      [existing.rows[0].id],
    );
    expect(applicants.rows[0].n).toBe(1);
    const kofis = await db.query<{ n: number }>(`select count(*)::int as n from public.persons where organization_id = $1 and display_name = 'Kofi Mensah'`, [ctx.orgId]);
    expect(kofis.rows[0].n).toBe(2);
  });
});

describe("migration import: sign-off", () => {
  it("creates exactly what the dry run planned, through create_client_matter, verified and audited", async () => {
    const ctx = await firm();
    const { batch } = await stage(ctx, [PRIYA, RAFAEL, KOFI, ["Bad Date", "99/99/1990", "", "", "", "", "applicant"]]);
    const planned = await dryRun(ctx, batch);
    expect(planned).toMatchObject({ create: 3, matters: 2, error: 1 });

    // Step-up and the plan hash are required.
    const hash = await planHash(ctx, batch);
    await as(ctx, "owner", false);
    await expectDbError(() => rpc(`public.begin_migration_pilot($1, $2, $3)`, [ctx.orgId, batch, hash]), /firm owner step-up is required/);
    await as(ctx, "manager");
    await expectDbError(() => rpc(`public.begin_migration_pilot($1, $2, $3)`, [ctx.orgId, batch, hash]), /firm owner step-up is required/);
    await as(ctx);
    const stale = await rpc<{ ok: boolean; reason: string }>(`public.begin_migration_pilot($1, $2, $3)`, [ctx.orgId, batch, "0".repeat(64)]);
    expect(stale).toEqual({ ok: false, reason: "plan_changed" });

    await commit(ctx, batch);
    await asMaintenance(db);
    const result = await db.query<{ status: string; result_counts: Record<string, number>; staging_purged_at: string | null; exceptions: unknown[] }>(
      `select status::text, result_counts, staging_purged_at, exceptions from public.migration_batches where id = $1`,
      [batch],
    );
    expect(result.rows[0].status).toBe("committed");
    expect(result.rows[0].result_counts).toEqual({ matters: 2, people_created: 3, people_linked: 0, not_imported: 1, rows: 4 });
    expect(result.rows[0].staging_purged_at).not.toBeNull();
    expect(result.rows[0].exceptions).toEqual([{ row: 5, column: "DOB", problem: "(value) isn’t a real date", fix: "Correct the date or leave it unknown" }]);
    expect((await db.query(`select 1 from public.migration_rows where batch_id = $1`, [batch])).rows).toHaveLength(0);

    const matters = await db.query<{ title: string; is_sample: boolean; stage: string; program_pack_id: string; people: string[] }>(
      `select m.title, m.is_sample, m.stage::text, m.program_pack_id,
              array_agg(p.display_name || ':' || mp.role::text order by p.display_name) as people
       from public.migration_records r
       join public.matters m on m.id = r.record_id
       join public.matter_participants mp on mp.matter_id = m.id and mp.person_id is not null
       join public.persons p on p.id = mp.person_id
       where r.batch_id = $1 and r.record_table = 'matters'
       group by m.id order by m.title`,
      [batch],
    );
    expect(matters.rows).toEqual([
      { title: "Kofi Mensah", is_sample: false, stage: "engagement_pending", program_pack_id: ctx.pack, people: ["Kofi Mensah:applicant"] },
      { title: "Priya Sharma", is_sample: false, stage: "engagement_pending", program_pack_id: ctx.pack, people: ["Priya Sharma:applicant", "Rafael Sharma:sponsor"] },
    ]);
    // The mapped source stage and old reference are kept on the import record, not applied.
    const records = await db.query<{ source_reference: string; imported_stage: string }>(
      `select source_reference, imported_stage::text from public.migration_records where batch_id = $1 and record_table = 'matters' order by row_number`,
      [batch],
    );
    expect(records.rows).toEqual([
      { source_reference: "2026-142", imported_stage: "intake" },
      { source_reference: "2026-131", imported_stage: "intake" },
    ]);
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 order by occurred_at, action`, [batch]);
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["migration.staged", "migration.verified", "migration.mapped", "migration.dry_run", "migration.commit_started", "migration.committed"]),
    );
  });

  it("reuses an earlier row's person when a person confirms it, keeps phones only with a country code, and adds the mapped case manager", async () => {
    const ctx = await firm();
    await as(ctx);
    const batch = await rpc<string>(`public.stage_migration_batch($1, $2, $3, 100, 4, $4, $5)`, [
      ctx.orgId,
      "people.csv",
      await sha256Hex("x"),
      await rowsDigest([
        ["Ana Lima", "1990-01-02", "+1 (416) 555-0101", "A-1", "applicant", "Kim"],
        ["Ana Lima", "1990-01-02", "", "A-2", "sponsor", ""],
        ["Bo Chen", "", "416 555 0102", "B-1", "applicant", ""],
        ["Bo Chen", "", "", "A-2", "applicant", ""],
      ]),
      ["Name", "Birth", "Phone", "Ref", "Role", "Manager"],
    ]);
    await rpc(`public.append_migration_rows($1, $2, 2, $3)`, [
      ctx.orgId,
      batch,
      JSON.stringify([
        ["Ana Lima", "1990-01-02", "+1 (416) 555-0101", "A-1", "applicant", "Kim"],
        ["Ana Lima", "1990-01-02", "", "A-2", "sponsor", ""],
        ["Bo Chen", "", "416 555 0102", "B-1", "applicant", ""],
        ["Bo Chen", "", "", "A-2", "applicant", ""],
      ]),
    ]);
    expect(await rpc<{ ok: boolean }>(`public.seal_migration_batch($1, $2)`, [ctx.orgId, batch])).toMatchObject({ ok: true });
    const map = {
      columns: { name: 0, date_of_birth: 1, phone: 2, reference: 3, role: 4, case_manager: 5 },
      date_order: "dmy",
      default_consultant: ctx.consultantMembership,
      values: { case_manager: { kim: ctx.managerMembership } },
    };
    await rpc(`public.save_migration_mapping($1, $2, $3)`, [ctx.orgId, batch, JSON.stringify(map)]);
    await rpc(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, batch]);
    const plan = await rows(batch);
    expect(plan.map((row) => row.plan)).toEqual(["create", "confirm", "error", "create"]);
    expect(plan[1].match_row_number).toBe(2);
    expect(plan[2].problems[0].problem).toBe("“416 555 0102” isn’t a phone number with a country code");

    await as(ctx);
    const decided = await rpc<Record<string, number>>(`public.decide_migration_duplicate($1, $2, 3, true)`, [ctx.orgId, batch]);
    expect(decided).toMatchObject({ create: 2, link: 1, matters: 2 });
    await commit(ctx, batch);
    await asMaintenance(db);
    const people = await db.query<{ display_name: string; contact_phone: string | null; roles: string[] }>(
      `select p.display_name, p.contact_phone, array_agg(mp.role::text order by mp.role::text) as roles
       from public.migration_records r join public.persons p on p.id = r.record_id
       join public.matter_participants mp on mp.person_id = p.id
       where r.batch_id = $1 and r.record_table = 'persons' group by p.id order by p.display_name`,
      [batch],
    );
    expect(people.rows).toEqual([
      { display_name: "Ana Lima", contact_phone: "+14165550101", roles: ["applicant", "sponsor"] },
      { display_name: "Bo Chen", contact_phone: null, roles: ["applicant"] },
    ]);
    const managers = await db.query<{ membership_id: string }>(
      `select mp.membership_id from public.migration_records r join public.matter_participants mp on mp.matter_id = r.record_id
       where r.batch_id = $1 and r.record_table = 'matters' and r.row_number = 2 and mp.role = 'case_manager' order by mp.membership_id`,
      [batch],
    );
    expect(managers.rows.map((row) => row.membership_id)).toContain(ctx.managerMembership);
  });

  it("imports sample records in a sample-mode firm", async () => {
    const ctx = await firm({ sampleMode: true });
    const { batch } = await stage(ctx, [PRIYA, RAFAEL]);
    await dryRun(ctx, batch);
    await commit(ctx, batch);
    await asMaintenance(db);
    const flags = await db.query<{ batch: boolean; matters: boolean[]; persons: boolean[] }>(
      `select b.is_sample as batch,
              (select array_agg(m.is_sample) from public.migration_records r join public.matters m on m.id = r.record_id where r.batch_id = b.id) as matters,
              (select array_agg(p.is_sample) from public.migration_records r join public.persons p on p.id = r.record_id where r.batch_id = b.id) as persons
       from public.migration_batches b where b.id = $1`,
      [batch],
    );
    expect(flags.rows[0]).toEqual({ batch: true, matters: [true], persons: [true, true] });
  });
});

describe("migration import: rollback", () => {
  async function committed() {
    const ctx = await firm();
    const { batch } = await stage(ctx, [PRIYA, RAFAEL, KOFI]);
    await dryRun(ctx, batch);
    await commit(ctx, batch);
    await asMaintenance(db);
    const ids = await db.query<{ record_table: string; record_id: string }>(`select record_table, record_id from public.migration_records where batch_id = $1 order by row_number, record_table`, [batch]);
    return { ctx, batch, matters: ids.rows.filter((row) => row.record_table === "matters").map((row) => row.record_id), persons: ids.rows.filter((row) => row.record_table === "persons").map((row) => row.record_id) };
  }

  it("removes only the batch's untouched records, with step-up, and audits it", async () => {
    const { ctx, batch, matters, persons } = await committed();
    await as(ctx, "owner", false);
    await expectDbError(() => rpc(`public.rollback_migration_batch($1, $2)`, [ctx.orgId, batch]), /firm owner step-up is required/);
    await as(ctx);
    expect(await rpc(`public.migration_rollback_check($1, $2)`, [ctx.orgId, batch])).toEqual([]);
    const done = await rpc<{ ok: boolean; matters: number; people: number }>(`public.rollback_migration_batch($1, $2)`, [ctx.orgId, batch]);
    expect(done).toEqual({ ok: true, matters: 2, people: 3 });
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.matters where id = any($1)`, [matters])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.persons where id = any($1)`, [persons])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.matter_rule_bindings where matter_id = any($1)`, [matters])).rows).toHaveLength(0);
    const status = await db.query<{ status: string }>(`select status::text from public.migration_batches where id = $1`, [batch]);
    expect(status.rows[0].status).toBe("rolled_back");
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'migration.rolled_back'`, [batch])).rows).toHaveLength(1);
    // A second rollback is refused with a reason.
    await as(ctx);
    const again = await rpc<{ ok: boolean; reasons: string[] }>(`public.rollback_migration_batch($1, $2)`, [ctx.orgId, batch]);
    expect(again).toEqual({ ok: false, reasons: ["Only an imported batch can be rolled back."] });
  });

  it("refuses when a record changed, gained new work, or is under a legal hold, and says why", async () => {
    const { ctx, batch, matters, persons } = await committed();
    await asMaintenance(db);
    await db.query(`update public.persons set contact_phone = '+14165550101' where id = $1`, [persons[0]]);
    await db.query(
      `insert into public.tasks (organization_id, matter_id, title, audience, status, priority, owner_membership_id) values ($1, $2, 'Synthetic follow-up', 'internal', 'open', 'normal', $3)`,
      [ctx.orgId, matters[1], ctx.consultantMembership],
    );
    await as(ctx);
    const refused = await rpc<{ ok: boolean; reasons: string[] }>(`public.rollback_migration_batch($1, $2)`, [ctx.orgId, batch]);
    expect(refused.ok).toBe(false);
    expect(refused.reasons).toEqual(["The person from row 2 was edited after the import.", "1 new tasks linked to imported records since the import."]);
    await asMaintenance(db);
    // Nothing was removed, and the refusal is audited.
    expect((await db.query(`select 1 from public.matters where id = any($1)`, [matters])).rows).toHaveLength(2);
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'migration.rollback_refused'`, [batch])).rows).toHaveLength(1);

    await db.query(`update public.matters set title = 'Renamed' where id = $1`, [matters[0]]);
    await db.query(
      `insert into public.matter_legal_holds (organization_id, matter_id, reason, placed_by) select organization_id, id, 'Synthetic hold reason', $2 from public.matters where id = $1`,
      [matters[0], ctx.owner],
    );
    await as(ctx);
    const reasons = await rpc<string[]>(`public.migration_rollback_check($1, $2)`, [ctx.orgId, batch]);
    expect(reasons.some((reason) => /was changed after the import/.test(reason))).toBe(true);
    expect(reasons.some((reason) => /under a legal hold/.test(reason))).toBe(true);
  });

  it("stops a commit whose matter is refused, keeps what earlier chunks made, and rolls that back", async () => {
    const ctx = await firm();
    const { batch } = await stage(ctx, [PRIYA, KOFI]);
    await dryRun(ctx, batch);
    const hash = await planHash(ctx, batch);
    await as(ctx);
    await rpc(`public.begin_migration_pilot($1, $2, $3, 2)`, [ctx.orgId, batch, hash]);
    const first = await rpc<{ remaining: number; done: number }>(`public.commit_migration_chunk($1, $2, 1)`, [ctx.orgId, batch]);
    expect(first).toMatchObject({ remaining: 1, done: 1, status: "committing", phase: "pilot" });
    // The consultant leaves before the rest is created: create_engaged_matter refuses, nothing of this chunk stays.
    await asMaintenance(db);
    await db.query(`update public.memberships set status = 'suspended' where id = $1`, [ctx.consultantMembership]);
    await as(ctx);
    await expectDbError(() => rpc(`public.commit_migration_chunk($1, $2, 1)`, [ctx.orgId, batch]), /.+/);
    await rpc(`public.note_migration_commit_failure($1, $2, 'refused')`, [ctx.orgId, batch]);
    await asMaintenance(db);
    const state = await db.query<{ status: string; n: number }>(
      `select b.status::text, (select count(*)::int from public.migration_records r where r.batch_id = b.id and r.record_table = 'matters') as n
       from public.migration_batches b where b.id = $1`,
      [batch],
    );
    expect(state.rows[0]).toEqual({ status: "committing", n: 1 });
    await as(ctx);
    expect(await rpc(`public.rollback_migration_batch($1, $2)`, [ctx.orgId, batch])).toEqual({ ok: true, matters: 1, people: 1 });
  });

  it("keeps rule pack bindings retained outside a rollback", async () => {
    const { matters } = await committed();
    await asMaintenance(db);
    await expectDbError(() => db.query(`delete from public.matter_rule_bindings where matter_id = $1`, [matters[0]]), /matter rule bindings are retained/);
    await db.query(`select set_config('app.migration_rollback', $1, false)`, [randomUUID()]);
    await expectDbError(() => db.query(`delete from public.matter_rule_bindings where matter_id = $1`, [matters[0]]), /matter rule bindings are retained/);
    await db.query(`select set_config('app.migration_rollback', '', false)`);
  });
});

describe("migration import: staging purge", () => {
  it("discards unfinished batches past the staging period and purges their rows", async () => {
    const ctx = await firm();
    const { batch } = await stage(ctx, [PRIYA]);
    await asMaintenance(db);
    await db.query(`update public.migration_batches set purge_after = now() - interval '1 minute' where id = $1`, [batch]);
    const purged = await db.query<{ n: number }>(`select app.purge_expired_migration_staging() as n`);
    expect(purged.rows[0].n).toBeGreaterThanOrEqual(1);
    const row = await db.query<{ status: string }>(`select status::text from public.migration_batches where id = $1`, [batch]);
    expect(row.rows[0].status).toBe("discarded");
    expect((await db.query(`select 1 from public.migration_rows where batch_id = $1`, [batch])).rows).toHaveLength(0);
    // The staging period is the firm's setting (1 to 90 days), changed by the owner after step-up.
    await as(ctx);
    await rpc(`public.set_migration_staging_days($1, 7)`, [ctx.orgId]);
    await expectDbError(() => rpc(`public.set_migration_staging_days($1, 365)`, [ctx.orgId]), /1 to 90 days/);
    const next = await rpc<string>(`public.stage_migration_batch($1, 'c.csv', repeat('a', 64), 100, 1, repeat('b', 64), array['Name'])`, [ctx.orgId]);
    await asMaintenance(db);
    const days = await db.query<{ days: number }>(`select round(extract(epoch from purge_after - created_at) / 86400)::int as days from public.migration_batches where id = $1`, [next]);
    expect(days.rows[0].days).toBe(7);
  });
});
