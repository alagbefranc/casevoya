import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rowsDigest, sha256Hex } from "@/modules/migration/csv";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * MIG-03: finance reviews imported opening balances. Totals are compared with the source
 * file snapshot. A correction needs a reason. Approval locks the row and posts nothing.
 */

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 180_000);

afterAll(async () => {
  await db?.close();
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
  const finance = await createUser("finance");
  const otherFinance = await createUser("finance2");
  const assistant = await createUser("assistant");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await member(orgId, consultant, "licensed_consultant", owner);
  await member(orgId, finance, "finance_user", owner);
  await member(orgId, otherFinance, "finance_user", owner);
  await member(orgId, assistant, "assistant", owner);
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
  return { owner, consultant, finance, otherFinance, assistant, orgId, consultantMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const as = (ctx: Firm, who: "owner" | "finance" | "otherFinance" | "assistant" = "owner", stepUp = true) =>
  asUser(db, { userId: ctx[who], aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: stepUp ? 0 : 3600 });

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
  expect((await rpc<{ ok: boolean }>(`public.seal_migration_batch($1, $2)`, [ctx.orgId, batch])).ok).toBe(true);
  return batch;
}

async function commit(ctx: Firm, batch: string) {
  await asMaintenance(db);
  const plan = (await db.query<{ plan_hash: string; kind: string }>(`select plan_hash, kind from public.migration_batches where id = $1`, [batch])).rows[0];
  await as(ctx);
  const piloted = await rpc<{ ok: boolean }>(`public.begin_migration_pilot($1, $2, $3, $4)`, [ctx.orgId, batch, plan.plan_hash, 1]);
  expect(piloted.ok).toBe(true);
  let left = 1;
  while (left > 0) {
    const chunk = await rpc<{ remaining: number }>(
      plan.kind === "clients_matters" ? `public.commit_migration_chunk($1, $2, $3)` : `public.commit_migration_kind_chunk($1, $2, $3)`,
      [ctx.orgId, batch, 5],
    );
    left = chunk.remaining;
  }
  await rpc(`public.sign_off_migration_pilot($1, $2, 'Synthetic pilot checked')`, [ctx.orgId, batch]);
  expect((await rpc<{ ok: boolean }>(`public.begin_migration_commit($1, $2, $3)`, [ctx.orgId, batch, plan.plan_hash])).ok).toBe(true);
  left = 1;
  while (left > 0) {
    const chunk = await rpc<{ remaining: number }>(
      plan.kind === "clients_matters" ? `public.commit_migration_chunk($1, $2, $3)` : `public.commit_migration_kind_chunk($1, $2, $3)`,
      [ctx.orgId, batch, 5],
    );
    left = chunk.remaining;
  }
}

describe("MIG-03 finance review of opening balances", () => {
  it("shows source totals, lets finance correct or reject, and locks an approval", async () => {
    const ctx = await firm();
    const clients = await stage(ctx, "clients_matters", ["Name", "Email", "File", "Role"], [
      ["Synthetic Applicant A", "applicant.a@example.test", "SYN-1", "applicant"],
      ["Synthetic Applicant B", "applicant.b@example.test", "SYN-2", "applicant"],
    ]);
    await as(ctx);
    await rpc(`public.save_migration_mapping($1, $2, $3)`, [
      ctx.orgId,
      clients,
      JSON.stringify({ columns: { name: 0, email: 1, reference: 2, role: 3 }, date_order: "ymd", default_consultant: ctx.consultantMembership, values: {} }),
    ]);
    await rpc(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, clients]);
    await commit(ctx, clients);

    const batch = await stage(ctx, "opening_balances", ["Matter", "Type", "Balance", "As of"], [
      ["SYN-1", "AR", "1250.50", "2026-09-30"],
      ["SYN-2", "Retainer", "400", "2026-09-30"],
      ["SYN-2", "AR", "-20", "2026-09-30"],
    ]);
    await as(ctx);
    await rpc(`public.save_migration_mapping($1, $2, $3)`, [
      ctx.orgId,
      batch,
      JSON.stringify({
        date_order: "ymd",
        columns: { reference: 0, balance_kind: 1, amount: 2, as_of: 3 },
        values: { balance_kind: { ar: "receivable", retainer: "advance" } },
      }),
    ]);
    const planned = await rpc<Record<string, number>>(`public.run_migration_dry_run($1, $2)`, [ctx.orgId, batch]);
    expect(planned.create).toBe(2);
    await commit(ctx, batch);

    await as(ctx, "assistant");
    expect((await db.query(`select 1 from public.opening_balances`)).rows).toHaveLength(0);
    await expectDbError(() => rpc(`public.opening_balance_review($1)`, [ctx.orgId]), /billing access denied/);

    await as(ctx, "otherFinance");
    const review = await rpc<{ rows: { id: string; client_name: string; source_amount_cents: number; amount_cents: number; file_row_count: number; status: string; version: number; kind: string }[] }>(
      `public.opening_balance_review($1)`,
      [ctx.orgId],
    );
    expect(review.rows).toHaveLength(2);
    expect(review.rows.every((row) => row.file_row_count === 3)).toBe(true);
    expect(new Set(review.rows.map((row) => row.client_name))).toEqual(new Set(["Synthetic Applicant A", "Synthetic Applicant B"]));
    const receivable = review.rows.find((row) => row.kind === "receivable");
    expect(Number(receivable?.source_amount_cents)).toBe(125050);
    expect(Number(receivable?.amount_cents)).toBe(125050);

    await as(ctx, "finance", false);
    await expectDbError(
      () => rpc(`public.correct_opening_balance($1, $2, $3, $4, $5, $6, $7::date, $8, $9)`, [ctx.orgId, receivable!.id, receivable!.version, "receivable", 100000, "CAD", "2026-09-30", "", "Source file had a typo"]),
      /step-up is required/,
    );
    await as(ctx, "finance");
    await expectDbError(
      () => rpc(`public.correct_opening_balance($1, $2, $3, $4, $5, $6, $7::date, $8, $9)`, [ctx.orgId, receivable!.id, receivable!.version, "receivable", 100000, "CAD", "2026-09-30", "", ""]),
      /a reason is required/,
    );
    const corrected = await rpc<{ version: number }>(
      `public.correct_opening_balance($1, $2, $3, $4, $5, $6, $7::date, $8, $9)`,
      [ctx.orgId, receivable!.id, receivable!.version, "receivable", 100000, "CAD", "2026-09-30", "", "Source file had a typo"],
    );
    expect(corrected.version).toBeGreaterThan(receivable!.version);

    await asMaintenance(db);
    const snap = await db.query<{ source_amount_cents: string; amount_cents: string }>(
      `select source_amount_cents::text, amount_cents::text from public.opening_balances where id = $1`,
      [receivable!.id],
    );
    expect(snap.rows[0]).toEqual({ source_amount_cents: "125050", amount_cents: "100000" });
    const correctionAudit = await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'opening_balance.corrected'`, [receivable!.id]);
    expect(correctionAudit.rows).toHaveLength(1);

    const advance = review.rows.find((row) => row.kind === "advance");
    await as(ctx, "finance");
    await expectDbError(() => rpc(`public.review_opening_balance($1, $2, false, null)`, [ctx.orgId, advance!.id]), /a reason is required/);
    expect(await rpc(`public.review_opening_balance($1, $2, true, 'Checked against the synthetic file')`, [ctx.orgId, advance!.id])).toMatchObject({ status: "approved" });
    await expectDbError(
      () => rpc(`public.correct_opening_balance($1, $2, $3, $4, $5, $6, $7::date, $8, $9)`, [ctx.orgId, advance!.id, advance!.version, "advance", 100, "CAD", "2026-09-30", "", "Too late"]),
      /locked/,
    );
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.opening_balances set amount_cents = 100 where id = $1`, [advance!.id]), /locked/);
    expect((await db.query(`select 1 from public.invoices where organization_id = $1`, [ctx.orgId])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.client_fund_ledgers where organization_id = $1`, [ctx.orgId])).rows).toHaveLength(0);
  });
});
