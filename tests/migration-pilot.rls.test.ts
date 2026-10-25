import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rowsDigest, sha256Hex } from "@/modules/migration/csv";
import type { RunReport } from "@/modules/migration/report";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * MIG-02 (gap #187): a pilot of the first matters, the firm owner's sign-off (step-up, with a note)
 * before the full run, the run report (source counts, checksums, record totals, exceptions), and
 * imported provenance without native audit events for imported history. Synthetic data only.
 */

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const FILE_SHA = "synthetic pilot file bytes";

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

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
    "Synthetic Pilot Firm",
    `p${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await member(orgId, consultant, "licensed_consultant", owner);
  await member(orgId, manager, "case_manager", owner);
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
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

const as = (ctx: Firm, who: "owner" | "manager" | "consultant" = "owner", stepUp = true) =>
  asUser(db, { userId: ctx[who], aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: stepUp ? 0 : 3600 });

async function rpc<T = unknown>(sql: string, params: unknown[]): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

const HEADERS = ["Full Name", "DOB", "Email", "File #"];

/** Obviously synthetic clients, one matter each, plus one row with an impossible date. */
const CLIENTS = [
  ["Test Client One", "01/02/1980", "one@example.test", "SYN-1"],
  ["Test Client Two", "02/03/1981", "two@example.test", "SYN-2"],
  ["Test Client Three", "03/04/1982", "three@example.test", "SYN-3"],
  ["Test Client Four", "04/05/1983", "four@example.test", "SYN-4"],
  ["Test Client Five", "05/06/1984", "five@example.test", "SYN-5"],
  ["Test Bad Date", "99/99/1990", "", "SYN-6"],
];

async function checked(ctx: Firm, rows = CLIENTS) {
  await as(ctx);
  const sha = await sha256Hex(FILE_SHA);
  const batch = await rpc<string>(`public.stage_migration_batch($1, 'synthetic-clients.csv', $2, 4096, $3, $4, $5)`, [
    ctx.orgId,
    sha,
    rows.length,
    await rowsDigest(rows),
    HEADERS,
  ]);
  await rpc(`public.append_migration_rows($1, $2, 2, $3)`, [ctx.orgId, batch, JSON.stringify(rows)]);
  expect(await rpc<{ ok: boolean }>(`public.seal_migration_batch($1, $2)`, [ctx.orgId, batch])).toMatchObject({ ok: true });
  const map = { columns: { name: 0, date_of_birth: 1, email: 2, reference: 3 }, date_order: "dmy", default_consultant: ctx.consultantMembership, values: {} };
  await rpc(`public.save_migration_mapping($1, $2, $3)`, [ctx.orgId, batch, JSON.stringify(map)]);
  const counts = await rpc<Record<string, number>>(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, batch]);
  await asMaintenance(db);
  const hash = (await db.query<{ plan_hash: string }>(`select plan_hash from public.migration_batches where id = $1`, [batch])).rows[0].plan_hash;
  return { batch, hash, sha, counts };
}

async function chunks(ctx: Firm, batch: string) {
  await as(ctx);
  let last: { remaining: number; status: string } = { remaining: 1, status: "committing" };
  while (last.remaining > 0) last = await rpc<{ remaining: number; status: string }>(`public.commit_migration_chunk($1, $2, 2)`, [ctx.orgId, batch]);
  return last;
}

async function batchRow(batch: string) {
  await asMaintenance(db);
  return (
    await db.query<{
      status: string;
      pilot_size: number | null;
      pilot_completed_at: string | null;
      pilot_counts: Record<string, number> | null;
      pilot_signed_off_at: string | null;
      pilot_signoff_note: string | null;
      run_report: RunReport | null;
      source_system: string;
      commit_started_at: string | null;
    }>(`select status::text, pilot_size, pilot_completed_at, pilot_counts, pilot_signed_off_at, pilot_signoff_note, run_report, source_system, commit_started_at from public.migration_batches where id = $1`, [batch])
  ).rows[0];
}

async function matterCount(batch: string) {
  await asMaintenance(db);
  return (await db.query<{ n: number }>(`select count(*)::int as n from public.migration_records r join public.matters m on m.id = r.record_id where r.batch_id = $1 and r.record_table = 'matters'`, [batch])).rows[0].n;
}

describe("MIG-02 pilot and sign-off", () => {
  it("spec: a pilot of 3 clients; the full run is blocked until sign-off; sign off; the report shows counts and checksum", async () => {
    const ctx = await firm();
    const { batch, hash, sha, counts } = await checked(ctx);
    expect(counts).toMatchObject({ rows: 6, create: 5, error: 1, matters: 5 });

    // No full run without a pilot.
    await as(ctx);
    await expectDbError(() => rpc(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, hash]), /run a pilot first/);

    // The pilot: step-up, the firm owner only, a size within the firm's limit.
    await as(ctx, "owner", false);
    await expectDbError(() => rpc(`public.begin_migration_pilot($1, $2, $3, 3)`, [ctx.orgId, batch, hash]), /firm owner step-up is required/);
    await as(ctx, "manager");
    await expectDbError(() => rpc(`public.begin_migration_pilot($1, $2, $3, 3)`, [ctx.orgId, batch, hash]), /firm owner step-up is required/);
    await as(ctx);
    await expectDbError(() => rpc(`public.begin_migration_pilot($1, $2, $3, 0)`, [ctx.orgId, batch, hash]), /a pilot is 1 to 25 matters/);
    await expectDbError(() => rpc(`public.begin_migration_pilot($1, $2, $3, 26)`, [ctx.orgId, batch, hash]), /a pilot is 1 to 25 matters/);
    const begun = await rpc<{ ok: boolean; matters: number }>(`public.begin_migration_pilot($1, $2, $3, 3, 'Synthetic Old CRM')`, [ctx.orgId, batch, hash]);
    expect(begun).toEqual({ ok: true, matters: 3 });
    const pilot = await chunks(ctx, batch);
    expect(pilot).toMatchObject({ remaining: 0, status: "pilot_done" });
    expect(await matterCount(batch)).toBe(3);
    const afterPilot = await batchRow(batch);
    expect(afterPilot).toMatchObject({ status: "committing", pilot_size: 3, source_system: "Synthetic Old CRM", pilot_signed_off_at: null });
    expect(afterPilot.pilot_counts).toEqual({ matters: 3, people_created: 3, people_linked: 0 });
    // The pilot's records are the first three in file order.
    await asMaintenance(db);
    const pilotRefs = await db.query<{ source_reference: string }>(`select source_reference from public.migration_records where batch_id = $1 and record_table = 'matters' order by row_number`, [batch]);
    expect(pilotRefs.rows.map((row) => row.source_reference)).toEqual(["SYN-1", "SYN-2", "SYN-3"]);

    // Blocked until sign-off: the full run and any further chunk.
    await as(ctx);
    await expectDbError(() => rpc(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, hash]), /needs the firm owner's sign-off/);
    await expectDbError(() => rpc(`public.commit_migration_chunk($1, $2, 25)`, [ctx.orgId, batch]), /needs the firm owner's sign-off/);
    expect(await matterCount(batch)).toBe(3);

    // Sign-off: firm owner, step-up, a note.
    await as(ctx, "owner", false);
    await expectDbError(() => rpc(`public.sign_off_migration_pilot($1, $2, 'Checked')`, [ctx.orgId, batch]), /firm owner step-up is required/);
    await as(ctx, "consultant");
    await expectDbError(() => rpc(`public.sign_off_migration_pilot($1, $2, 'Checked')`, [ctx.orgId, batch]), /firm owner step-up is required/);
    await as(ctx);
    await expectDbError(() => rpc(`public.sign_off_migration_pilot($1, $2, ' x ')`, [ctx.orgId, batch]), /note of 3 to 1,000 characters/);
    expect(await rpc(`public.sign_off_migration_pilot($1, $2, 'Checked the three test matters')`, [ctx.orgId, batch])).toEqual({ ok: true });
    await expectDbError(() => rpc(`public.sign_off_migration_pilot($1, $2, 'Again')`, [ctx.orgId, batch]), /already signed off/);

    // The full run, with the plan the page showed.
    expect(await rpc(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, "0".repeat(64)])).toEqual({ ok: false, reason: "plan_changed" });
    expect(await rpc(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, hash])).toEqual({ ok: true, matters: 2 });
    expect(await chunks(ctx, batch)).toMatchObject({ remaining: 0, status: "committed" });
    expect(await matterCount(batch)).toBe(5);

    const done = await batchRow(batch);
    expect(done.status).toBe("committed");
    expect(done.pilot_signoff_note).toBe("Checked the three test matters");
    const report = done.run_report!;
    expect(report.source).toMatchObject({ file_name: "synthetic-clients.csv", source_system: "Synthetic Old CRM", rows_in_file: 6, rows_staged: 6, sha256: sha, checksum_matches: true });
    expect(report.source?.staged_digest).toBe(await rowsDigest(CLIENTS));
    expect(report.source?.verified_at_commit).toBeTruthy();
    expect(report.records).toEqual({ matters: { created: 5, linked: 0 }, persons: { created: 5, linked: 0 } });
    expect(report.totals).toEqual({ matters: 5, people_created: 5, people_linked: 0 });
    expect(report.rows).toMatchObject({ rows: 6, imported: 5, created: 5, linked: 0, error: 1, skipped: 0, review: 0, duplicates_found: 0, exception_lines: 1 });
    expect(report.pilot).toMatchObject({ size: 3, counts: { matters: 3, people_created: 3, people_linked: 0 }, note: "Checked the three test matters" });
    expect(report.pilot?.signed_off_by).toBe(ctx.owner);

    // Downloading the report: the firm owner only, audited before the file is drawn.
    await as(ctx, "manager");
    await expectDbError(() => rpc(`public.record_migration_report_download($1, $2, 'csv')`, [ctx.orgId, batch]), /staff access denied/);
    await as(ctx, "owner", false);
    await expectDbError(() => rpc(`public.record_migration_report_download($1, $2, 'xls')`, [ctx.orgId, batch]), /choose csv or pdf/);
    await rpc(`public.record_migration_report_download($1, $2, 'csv')`, [ctx.orgId, batch]);

    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 order by occurred_at`, [batch]);
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "migration.pilot_started",
        "migration.pilot_completed",
        "migration.pilot_signed_off",
        "migration.commit_started",
        "migration.committed",
        "migration.report_downloaded",
      ]),
    );
    const refused = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where object_id = $1 and action = 'migration.commit_refused'`, [batch]);
    expect(refused.rows[0].n).toBe(1);
  });

  it("lists and rolls back the pilot's records with the existing rollback, which ends the batch", async () => {
    const ctx = await firm();
    const { batch, hash } = await checked(ctx);
    await as(ctx);
    await rpc(`public.begin_migration_pilot($1, $2, $3, 2)`, [ctx.orgId, batch, hash]);
    await chunks(ctx, batch);
    // The owner reads the pilot's records through RLS; other staff don't.
    await as(ctx);
    const records = await db.query<{ record_table: string }>(`select record_table from public.migration_records where batch_id = $1 order by row_number, record_table`, [batch]);
    expect(records.rows.map((row) => row.record_table)).toEqual(["matters", "persons", "matters", "persons"]);
    await as(ctx, "manager");
    expect((await db.query(`select 1 from public.migration_records where batch_id = $1`, [batch])).rows).toHaveLength(0);

    await as(ctx);
    expect(await rpc(`public.rollback_migration_batch($1, $2)`, [ctx.orgId, batch])).toEqual({ ok: true, matters: 2, people: 2 });
    expect((await batchRow(batch)).status).toBe("rolled_back");
    await as(ctx);
    await expectDbError(() => rpc(`public.sign_off_migration_pilot($1, $2, 'Too late')`, [ctx.orgId, batch]), /no pilot to sign off/);
  });

  it("refuses sign-off before the pilot is finished, and a pilot over the firm's maximum", async () => {
    const ctx = await firm();
    await as(ctx);
    await rpc(`public.set_migration_pilot_max($1, 2)`, [ctx.orgId]);
    await expectDbError(() => rpc(`public.set_migration_pilot_max($1, 51)`, [ctx.orgId]), /a pilot is 1 to 50 matters/);
    const { batch, hash } = await checked(ctx);
    await as(ctx);
    await expectDbError(() => rpc(`public.begin_migration_pilot($1, $2, $3, 3)`, [ctx.orgId, batch, hash]), /a pilot is 1 to 2 matters/);
    await rpc(`public.begin_migration_pilot($1, $2, $3, 2)`, [ctx.orgId, batch, hash]);
    expect(await rpc(`public.commit_migration_chunk($1, $2, 1)`, [ctx.orgId, batch])).toMatchObject({ remaining: 1, status: "committing", phase: "pilot" });
    await expectDbError(() => rpc(`public.sign_off_migration_pilot($1, $2, 'Not yet')`, [ctx.orgId, batch]), /not finished yet/);
    // Another firm's owner can't sign it off, even naming this firm.
    const other = await firm();
    await as(other);
    await expectDbError(() => rpc(`public.sign_off_migration_pilot($1, $2, 'Forged')`, [other.orgId, batch]), /migration batch not found/);
    await expectDbError(() => rpc(`public.sign_off_migration_pilot($1, $2, 'Forged')`, [ctx.orgId, batch]), /staff access denied/);
  });

  it("refuses a pilot when the staged rows no longer match the checksum taken at upload", async () => {
    const ctx = await firm();
    const { batch, hash } = await checked(ctx);
    await asMaintenance(db);
    await db.query(`update public.migration_rows set cells = array['Test Changed', '', '', 'SYN-1'] where batch_id = $1 and row_number = 2`, [batch]);
    await as(ctx);
    expect(await rpc(`public.begin_migration_pilot($1, $2, $3, 3)`, [ctx.orgId, batch, hash])).toEqual({ ok: false, reason: "checksum_changed" });
    expect((await batchRow(batch)).status).toBe("checked");
    await asMaintenance(db);
    const refused = await db.query<{ context: Record<string, string> }>(`select context from public.audit_log where object_id = $1 and action = 'migration.commit_refused'`, [batch]);
    expect(refused.rows.map((row) => row.context.reason)).toEqual(["staged rows changed"]);
  });
});

describe("MIG-02 imported provenance", () => {
  it("tells staff where imported records came from, and writes no native audit event for imported history", async () => {
    const ctx = await firm();
    const { batch, hash } = await checked(ctx, CLIENTS.slice(0, 2));
    await as(ctx);
    await rpc(`public.begin_migration_pilot($1, $2, $3, 1, 'Synthetic Old CRM')`, [ctx.orgId, batch, hash]);
    await chunks(ctx, batch);
    await rpc(`public.sign_off_migration_pilot($1, $2, 'Pilot checked')`, [ctx.orgId, batch]);
    await rpc(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, hash]);
    await chunks(ctx, batch);

    await asMaintenance(db);
    const records = await db.query<{ record_table: string; record_id: string; created_at: string }>(
      `select record_table, record_id, created_at from public.migration_records where batch_id = $1 order by row_number, record_table`,
      [batch],
    );
    const matters = records.rows.filter((row) => row.record_table === "matters").map((row) => row.record_id);
    const persons = records.rows.filter((row) => row.record_table === "persons").map((row) => row.record_id);
    // An importer that knows an item's original date records it (MIG-01 history kinds).
    await db.query(`update public.migration_records set original_at = '2019-03-04T15:00:00Z' where batch_id = $1 and record_table = 'matters' and source_reference = 'SYN-1'`, [batch]);

    // Any staff member of the firm (here a licensed consultant) reads the provenance.
    await as(ctx, "consultant");
    const provenance = await rpc<{ id: string; system: string; imported_at: string; original_at: string | null; reference: string }[]>(
      `public.imported_record_provenance($1, 'matters', $2)`,
      [ctx.orgId, [...matters, randomUUID()]],
    );
    expect(provenance).toHaveLength(2);
    expect(provenance.every((row) => row.system === "Synthetic Old CRM" && Boolean(row.imported_at))).toBe(true);
    const first = provenance.find((row) => row.reference === "SYN-1")!;
    expect(new Date(first.original_at!).toISOString()).toBe("2019-03-04T15:00:00.000Z");
    expect(await rpc(`public.imported_record_provenance($1, 'persons', $2)`, [ctx.orgId, persons])).toHaveLength(2);
    // Another firm's staff, and a forged firm id, get nothing.
    const other = await firm();
    await as(other, "consultant");
    expect(await rpc(`public.imported_record_provenance($1, 'matters', $2)`, [other.orgId, matters])).toEqual([]);
    await expectDbError(() => rpc(`public.imported_record_provenance($1, 'matters', $2)`, [ctx.orgId, matters]), /staff access denied/);

    // No native audit event for the imported history: nothing about the imported records is dated
    // before the import (the original date stays on the import record), while the import's own
    // steps are audited on the batch.
    await asMaintenance(db);
    const started = (await batchRow(batch)).commit_started_at!;
    const backdated = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log
       where (object_id = any($1) or object_id = any($2) or context ->> 'matter_id' = any($3::text[]))
         and occurred_at < $4`,
      [matters, persons, matters, started],
    );
    expect(backdated.rows[0].n).toBe(0);
    const historical = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where organization_id = $1 and occurred_at < '2020-01-01'`, [ctx.orgId]);
    expect(historical.rows[0].n).toBe(0);
    const own = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 and action like 'migration.%'`, [batch]);
    expect(own.rows.length).toBeGreaterThanOrEqual(6);
    // Every audit row about an imported record is an action Casevoya took now, never an
    // imported event (no action names the import's source).
    const onRecords = await db.query<{ action: string }>(
      `select distinct action from public.audit_log where object_id = any($1) or object_id = any($2)`,
      [matters, persons],
    );
    expect(onRecords.rows.every((row) => !/import|history/i.test(row.action))).toBe(true);

    // Rolled back records are no longer reported as imported.
    await as(ctx);
    expect(await rpc(`public.rollback_migration_batch($1, $2)`, [ctx.orgId, batch])).toMatchObject({ ok: true });
    await as(ctx, "consultant");
    expect(await rpc(`public.imported_record_provenance($1, 'matters', $2)`, [ctx.orgId, matters])).toEqual([]);
  });
});
