import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/** The monthly reconciliation workspace (FIN-12): outstanding deposits and cheques, the adjusted bank balance, locked months, the export audit. Synthetic data only. */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

const key = (prefix = "rec") => `${prefix}-${randomUUID()}`;
const day = (offset: number) => firmDay(offset);

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${id.slice(0, 8)}@example.test`]);
  return id;
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function firm() {
  const owner = await createUser("owner");
  const finance = await createUser("finance");
  const assistant = await createUser("assistant");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${randomUUID().slice(0, 12).replaceAll("-", "")}`]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  for (const [userId, role] of [
    [finance, "finance_user"],
    [assistant, "assistant"],
  ]) {
    await db.query(`insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, $3::public.org_role, 'active', now(), $4)`, [orgId, userId, role, owner]);
  }
  const matterId = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true)`, [matterId, orgId]);
  const person = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample) values ($1, 'Synthetic applicant', true) returning id`, [orgId]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, person.rows[0].id]);
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const account = await db.query<{ id: string }>(`select public.create_client_account($1, 'Client account', 'Synthetic Bank', '4410') as id`, [orgId]);
  return { owner, finance, assistant, orgId, matterId, personId: person.rows[0].id, accountId: account.rows[0].id };
}

async function as(f: Firm, userId: string, stepUp = true) {
  await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: stepUp ? 0 : 20 * 60 });
}

async function deposit(f: Firm, amount: number, on: string) {
  await as(f, f.owner);
  const row = await db.query<{ id: string }>(`select public.record_client_deposit($1, $2, $3, $4, 'cad', 'bank_transfer', 'RBC-1', $5::date, 'Statement line', $6) as id`, [
    f.accountId,
    f.matterId,
    f.personId,
    amount,
    on,
    key("dep"),
  ]);
  await db.query(`select public.verify_client_deposit($1)`, [row.rows[0].id]);
  return row.rows[0].id;
}

async function prepare(f: Firm, statementDate: string, balance: number) {
  await as(f, f.finance, false);
  return (await db.query<{ id: string }>(`select public.prepare_client_reconciliation($1, $2::date, $3, null, $4) as id`, [f.accountId, statementDate, balance, key()])).rows[0].id;
}

async function addItem(f: Firm, id: string, kind: string, amount: number, on: string, userId = f.finance) {
  await as(f, userId, false);
  return (await db.query<{ id: string }>(`select public.add_reconciliation_adjustment($1, $2, 'Branch deposit 14 Oct', 'DEP-9', $3::date, $4) as id`, [id, kind, on, amount])).rows[0].id;
}

async function sign(f: Firm, id: string, outcome: "reconciled" | "exceptions", notes: string | null = null) {
  await as(f, f.owner);
  return (await db.query<{ r: Record<string, unknown> }>(`select public.sign_client_reconciliation($1, $2, $3) as r`, [id, outcome, notes])).rows[0].r;
}

describe("outstanding deposits and cheques", () => {
  it("adjust the bank balance: a deposit in transit makes the statement agree, and the month signs as reconciled", async () => {
    const f = await firm();
    await deposit(f, 100_000, day(-3));
    // The bank shows CAD 600.00 on the statement; a CAD 400.00 deposit is in transit.
    const id = await prepare(f, day(-1), 60_000);
    await expectDbError(() => sign(f, id, "reconciled"), /difference must be zero/);
    await addItem(f, id, "deposit_in_transit", 40_000, day(-2));
    const signed = await sign(f, id, "reconciled");
    expect(signed).toMatchObject({ status: "reconciled", adjusted_balance_cents: 100_000 });
    await asMaintenance(db);
    const row = (await db.query<Record<string, unknown>>(`select * from public.client_account_reconciliations where id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ status: "reconciled", statement_balance_cents: 60_000, ledger_balance_cents: 100_000, difference_cents: -40_000, adjusted_balance_cents: 100_000 });
  });

  it("subtracts outstanding cheques, ignores removed items, and refuses items after the statement date", async () => {
    const f = await firm();
    await deposit(f, 50_000, day(-3));
    const id = await prepare(f, day(-1), 80_000);
    await expectDbError(() => addItem(f, id, "outstanding_cheque", 10_000, day(0)), /on or before the statement date/);
    await expectDbError(() => addItem(f, id, "something_else", 10_000, day(-1)), /deposit in transit or an outstanding cheque/);
    const wrong = await addItem(f, id, "outstanding_cheque", 20_000, day(-2));
    await addItem(f, id, "outstanding_cheque", 30_000, day(-2));
    await as(f, f.finance, false);
    await db.query(`select public.remove_reconciliation_adjustment($1)`, [wrong]);
    await expectDbError(() => db.query(`select public.remove_reconciliation_adjustment($1)`, [wrong]), /already removed/);
    expect(await sign(f, id, "reconciled")).toMatchObject({ adjusted_balance_cents: 50_000 });
  });

  it("locks the items once signed; billing staff only", async () => {
    const f = await firm();
    const g = await firm();
    await deposit(f, 10_000, day(-3));
    const id = await prepare(f, day(-1), 10_000);
    for (const userId of [f.assistant]) {
      await as(f, userId);
      await expectDbError(() => db.query(`select public.add_reconciliation_adjustment($1, 'outstanding_cheque', 'Cheque 12', null, $2::date, 100)`, [id, day(-2)]), /reconciliation access denied/);
      expect((await db.query(`select id from public.client_reconciliation_adjustments`)).rows).toHaveLength(0);
    }
    await as(g, g.owner);
    await expectDbError(() => db.query(`select public.add_reconciliation_adjustment($1, 'outstanding_cheque', 'Cheque 12', null, $2::date, 100)`, [id, day(-2)]), /reconciliation access denied/);
    const item = await addItem(f, id, "outstanding_cheque", 100, day(-2));
    await sign(f, id, "exceptions", "Cheque 12 not cleared");
    await expectDbError(() => addItem(f, id, "deposit_in_transit", 100, day(-2)), /only a reconciliation waiting for review/);
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.remove_reconciliation_adjustment($1)`, [item]), /signed or discarded/);
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.client_reconciliation_adjustments set amount_cents = 1 where id = $1`, [item]), /locked/);
    await expectDbError(() => db.query(`delete from public.client_reconciliation_adjustments where id = $1`, [item]), /append-only/);
  });
});

describe("a signed month is locked", () => {
  it("refuses entries dated on or before a signed statement date for that account", async () => {
    const f = await firm();
    await deposit(f, 10_000, day(-5));
    const id = await prepare(f, day(-2), 10_000);
    await sign(f, id, "reconciled");
    await expectDbError(() => deposit(f, 1_000, day(-2)), /signed reconciliation period/);
    await expectDbError(() => deposit(f, 1_000, day(-4)), /signed reconciliation period/);
    await deposit(f, 1_000, day(-1));
  });

  it("audits the report export for billing staff only", async () => {
    const f = await firm();
    await deposit(f, 10_000, day(-5));
    const id = await prepare(f, day(-2), 10_000);
    await as(f, f.finance, false);
    await db.query(`select public.record_reconciliation_export($1)`, [id]);
    await as(f, f.assistant);
    await expectDbError(() => db.query(`select public.record_reconciliation_export($1)`, [id]), /reconciliation access denied/);
    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 and action = 'client_funds.reconciliation_exported'`, [id]);
    expect(audit.rows).toHaveLength(1);
  });
});
