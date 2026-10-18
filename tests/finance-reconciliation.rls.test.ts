import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/** Client-account reconciliation (FIN-12): the math, the sign-off and its immutability. Synthetic data only. */

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

function token(length = 12) {
  return randomUUID().replaceAll("-", "").slice(0, length);
}

const key = (prefix = "rec") => `${prefix}-${randomUUID()}`;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${id.slice(0, 8)}@example.test`]);
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

type Firm = Awaited<ReturnType<typeof firm>>;

/** A firm (sample mode) with a client account, two clients on two matters, and two finance users (one unassigned). */
async function firm() {
  const owner = await createUser("owner");
  const finance = await createUser("finance");
  const otherFinance = await createUser("finance-unassigned");
  const assistant = await createUser("assistant");
  const client = await createUser("client");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${token(12)}`]);
  const orgId = created.rows[0].id;
  const financeMembership = await member(orgId, finance, "finance_user", owner);
  await member(orgId, otherFinance, "finance_user", owner);
  await member(orgId, assistant, "assistant", owner);
  await member(orgId, client, "client", owner);
  await asMaintenance(db);
  // Dates in these tests are UTC days; the firm's day matches them whatever the hour.
  await db.query(`update public.organizations set timezone = 'UTC' where id = $1`, [orgId]);
  const matterId = randomUUID();
  const otherMatter = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true), ($3, $2, 'Other matter', true)`, [matterId, orgId, otherMatter]);
  const person = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`, [orgId, client]);
  const otherPerson = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample) values ($1, 'Other applicant', true) returning id`, [orgId]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $4, $5, 'applicant')`, [
    orgId,
    matterId,
    person.rows[0].id,
    otherMatter,
    otherPerson.rows[0].id,
  ]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [orgId, matterId, financeMembership]);
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const account = await db.query<{ id: string }>(`select public.create_client_account($1, 'Client account', 'Synthetic Bank', '4410') as id`, [orgId]);
  return { owner, finance, otherFinance, assistant, client, orgId, matterId, otherMatter, personId: person.rows[0].id, otherPersonId: otherPerson.rows[0].id, accountId: account.rows[0].id };
}

async function as(f: Firm, userId: string, stepUp = true) {
  await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: stepUp ? 0 : 20 * 60 });
}

/** A deposit received on `on`, verified unless `pending`. The owner records; the finance user (or owner) verifies. */
async function deposit(f: Firm, amount: number, on: string, options: { pending?: boolean; matterId?: string; personId?: string } = {}) {
  await as(f, f.owner);
  const row = await db.query<{ id: string }>(
    `select public.record_client_deposit($1, $2, $3, $4, 'cad', 'bank_transfer', 'RBC-1', $5::date, 'Statement line', $6) as id`,
    [f.accountId, options.matterId ?? f.matterId, options.personId ?? f.personId, amount, on, key("dep")],
  );
  const id = row.rows[0].id;
  if (!options.pending) {
    await as(f, f.owner);
    await db.query(`select public.verify_client_deposit($1)`, [id]);
  }
  return id;
}

async function ledgerOf(entryId: string) {
  await asMaintenance(db);
  return (await db.query<{ ledger_id: string }>(`select ledger_id from public.client_fund_entries where id = $1`, [entryId])).rows[0].ledger_id;
}

/** An approved earned-fee transfer of `amount` to a new invoice; the bank transfer recorded on `sentOn` if given. */
async function transfer(f: Firm, ledgerId: string, amount: number, sentOn?: string) {
  await as(f, f.owner);
  const invoice = await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation delivered', $2, 'CAD', $3::date, $4) as id`, [f.matterId, amount, day(3), key("inv")]);
  await as(f, f.finance);
  const entry = await db.query<{ id: string }>(`select public.request_client_transfer($1, $2, $3, 'Milestone', $4) as id`, [ledgerId, invoice.rows[0].id, amount, key("tr")]);
  await as(f, f.owner);
  await db.query(`select public.approve_client_transfer($1)`, [entry.rows[0].id]);
  if (sentOn) await db.query(`select public.record_client_transfer_bank($1, $2::date, 'BANK-REF-1', null)`, [entry.rows[0].id, sentOn]);
  return entry.rows[0].id;
}

async function prepare(f: Firm, statementDate: string, balance: number, userId: string = f.finance, note: string | null = null) {
  await as(f, userId, false);
  const row = await db.query<{ id: string }>(`select public.prepare_client_reconciliation($1, $2::date, $3, $4, $5) as id`, [f.accountId, statementDate, balance, note, key()]);
  return row.rows[0].id;
}

async function rec(id: string) {
  await asMaintenance(db);
  const row = await db.query<Record<string, unknown>>(`select * from public.client_account_reconciliations where id = $1`, [id]);
  return row.rows[0];
}

async function sign(f: Firm, id: string, userId: string, outcome: "reconciled" | "exceptions", notes: string | null = null) {
  await as(f, userId);
  return (await db.query<{ r: { status: string; owner_self_signed: boolean } }>(`select public.sign_client_reconciliation($1, $2, $3) as r`, [id, outcome, notes])).rows[0].r;
}

describe("reconciliation math", () => {
  it("computes the control ledger, the client sub-ledgers and the outstanding items as of the statement date", async () => {
    const f = await firm();
    // Two clients' advances, verified; one more advance on the statement still pending verification.
    const first = await deposit(f, 150_000, day(-5));
    await deposit(f, 50_000, day(-5), { matterId: f.otherMatter, personId: f.otherPersonId });
    const pending = await deposit(f, 180_800, day(-2), { pending: true });
    const ledgerId = await ledgerOf(first);
    // An approved transfer the bank already sent, and one still to send.
    await transfer(f, ledgerId, 30_000, day(0));
    const notSent = await transfer(f, ledgerId, 20_000);
    // A refund to the client, and a correction of it.
    await as(f, f.owner);
    const refund = await db.query<{ id: string }>(`select public.record_client_refund($1, 10000, 'cheque', 'CHQ-1', $2::date, 'Returned unused advance', $3) as id`, [ledgerId, day(-2), key("rf")]);
    await db.query(`select public.record_client_fund_correction($1, 'Refund cheque was voided', $2)`, [refund.rows[0].id, key("fix")]);

    const id = await prepare(f, day(0), 1_000_000, f.finance, "Statement page 3");
    const row = await rec(id);
    // Control ledger (money in the account per the ledger): 150,000 + 50,000 - 30,000 (sent) - 10,000 + 10,000 = 170,000.
    // Client sub-ledgers (owed to clients): 150,000 + 50,000 - 30,000 - 20,000 (approved) - 10,000 + 10,000 = 150,000.
    expect(row).toMatchObject({
      status: "pending_review",
      statement_balance_cents: 1_000_000,
      ledger_balance_cents: 170_000,
      client_ledgers_total_cents: 150_000,
      difference_cents: 830_000,
      client_count: 2,
      item_count: 2,
      prepared_by: f.finance,
      preparer_note: "Statement page 3",
      currency: "CAD",
      is_sample: true,
    });
    const items = row.items as { kind: string; entry_id: string; amount_cents: number }[];
    expect(items.map((item) => [item.kind, item.entry_id, item.amount_cents])).toEqual([
      ["deposit_pending_verification", pending, 180_800],
      ["transfer_not_sent", notSent, 20_000],
    ]);
  });

  it("counts only what happened on or before the statement date", async () => {
    const f = await firm();
    await deposit(f, 40_000, day(-5));
    await deposit(f, 7_000, day(0), { matterId: f.otherMatter, personId: f.otherPersonId });
    await deposit(f, 3_000, day(0), { pending: true });
    const id = await prepare(f, day(-1), 40_000);
    expect(await rec(id)).toMatchObject({ ledger_balance_cents: 40_000, client_ledgers_total_cents: 40_000, difference_cents: 0, client_count: 1, item_count: 0, items: [] });
  });

  it("signs as reconciled only when the statement matches the control ledger; otherwise with exception notes", async () => {
    const f = await firm();
    await deposit(f, 100_000, day(-3));
    const matching = await prepare(f, day(-1), 100_000);
    expect((await rec(matching)).difference_cents).toBe(0);
    expect(await sign(f, matching, f.owner, "reconciled")).toMatchObject({ status: "reconciled", owner_self_signed: false });
    expect(await rec(matching)).toMatchObject({ status: "reconciled", signed_by: f.owner, review_notes: null });

    await deposit(f, 5_000, day(0), { pending: true });
    const off = await prepare(f, day(0), 105_000);
    expect(await rec(off)).toMatchObject({ difference_cents: 5_000, item_count: 1, period_start: expect.anything() });
    await expectDbError(() => sign(f, off, f.owner, "reconciled"), /difference must be zero/);
    await expectDbError(() => sign(f, off, f.owner, "exceptions"), /exceptions need notes/);
    expect(await sign(f, off, f.owner, "exceptions", "CF deposit on the statement, verified next business day")).toMatchObject({ status: "exceptions" });
    expect(await rec(off)).toMatchObject({ status: "exceptions", review_notes: "CF deposit on the statement, verified next business day" });
  });
});

describe("reconciliation sign-off", () => {
  it("needs someone other than the preparer, with a step-up; the firm owner may sign their own after a fresh step-up", async () => {
    const f = await firm();
    await deposit(f, 10_000, day(-3));
    const byFinance = await prepare(f, day(-2), 10_000, f.finance);
    await expectDbError(() => sign(f, byFinance, f.finance, "reconciled"), /preparer cannot sign their own/);
    await as(f, f.otherFinance, false);
    await expectDbError(() => db.query(`select public.sign_client_reconciliation($1, 'reconciled', null)`, [byFinance]), /step-up is required/);
    expect(await sign(f, byFinance, f.otherFinance, "reconciled")).toMatchObject({ owner_self_signed: false });

    const byOwner = await prepare(f, day(-1), 10_000, f.owner);
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 120 });
    await expectDbError(() => db.query(`select public.sign_client_reconciliation($1, 'reconciled', null)`, [byOwner]), /signing your own reconciliation needs a step-up after it was prepared/);
    expect(await sign(f, byOwner, f.owner, "reconciled")).toMatchObject({ status: "reconciled", owner_self_signed: true });
    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 and action like 'client_funds.reconciliation_%' order by occurred_at`, [byOwner]);
    expect(audit.rows.map((row) => row.action)).toEqual(["client_funds.reconciliation_prepared", "client_funds.reconciliation_signed_owner_self"]);
  });

  it("refuses to sign when the ledger changed since preparation, and allows a discard and a fresh preparation", async () => {
    const f = await firm();
    await deposit(f, 10_000, day(-3));
    const pending = await deposit(f, 2_000, day(-3), { pending: true });
    const id = await prepare(f, day(-1), 12_000);
    await expectDbError(() => prepare(f, day(-1), 12_000), /waiting for review/);
    // The pending deposit is verified after the reconciliation was prepared.
    await as(f, f.finance);
    await db.query(`select public.verify_client_deposit($1)`, [pending]);
    await expectDbError(() => sign(f, id, f.owner, "exceptions", "Late verification"), /ledger changed since this reconciliation was prepared/);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.discard_client_reconciliation($1, 'x')`, [id]), /reason is required/);
    await db.query(`select public.discard_client_reconciliation($1, 'Ledger changed; prepared again')`, [id]);
    expect(await rec(id)).toMatchObject({ status: "discarded", discarded_by: f.finance });
    const again = await prepare(f, day(-1), 12_000);
    expect(await rec(again)).toMatchObject({ difference_cents: 0, item_count: 0 });
    expect(await sign(f, again, f.owner, "reconciled")).toMatchObject({ status: "reconciled" });
    // The next one must be dated after the last signed one, and not in the future.
    await expectDbError(() => prepare(f, day(-1), 12_000), /after the last signed reconciliation/);
    await expectDbError(() => prepare(f, day(2), 12_000), /future/);
  });

  it("is immutable once signed and can't be forged", async () => {
    const f = await firm();
    await deposit(f, 10_000, day(-3));
    const id = await prepare(f, day(-1), 10_000);
    await as(f, f.owner);
    await expectDbError(() => db.query(`update public.client_account_reconciliations set status = 'reconciled', signed_by = $2, signed_at = now() where id = $1`, [id, f.owner]), /permission denied/);
    await expectDbError(
      () => db.query(`insert into public.client_account_reconciliations (organization_id, client_account_id, period_start, statement_date, statement_balance_cents, ledger_balance_cents, client_ledgers_total_cents, difference_cents, client_count, item_count, idempotency_key, prepared_by) values ($1, $2, current_date, current_date, 0, 0, 0, 0, 0, 0, 'forged-key-1', $3)`, [f.orgId, f.accountId, f.owner]),
      /permission denied/,
    );
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.client_account_reconciliations set status = 'reconciled', signed_by = prepared_by, signed_at = now() where id = $1`, [id]), /check constraint/);
    await sign(f, id, f.owner, "reconciled");
    await asMaintenance(db);
    for (const change of ["statement_balance_cents = 1", "status = 'exceptions', review_notes = 'Changed my mind'", "review_notes = 'Later note'", "status = 'discarded', discarded_by = signed_by, discarded_at = now(), discard_reason = 'Undo'"]) {
      await expectDbError(() => db.query(`update public.client_account_reconciliations set ${change} where id = $1`, [id]), /append-only/);
    }
    await expectDbError(() => db.query(`delete from public.client_account_reconciliations where id = $1`, [id]), /append-only/);
    await expectDbError(() => sign(f, id, f.otherFinance, "reconciled"), /only a reconciliation waiting for review/);
  });
});

describe("who reconciles", () => {
  it("the firm owner and finance users (the client account is firm-wide); no one else, and never across firms", async () => {
    const f = await firm();
    const g = await firm();
    await deposit(f, 10_000, day(-3));
    // An unassigned finance user may prepare (firm-wide account); assistants and clients may not.
    const id = await prepare(f, day(-1), 10_000, f.otherFinance);
    for (const userId of [f.owner, f.finance, f.otherFinance]) {
      await as(f, userId, false);
      expect((await db.query(`select id from public.client_account_reconciliations`)).rows).toHaveLength(1);
    }
    for (const userId of [f.assistant]) {
      await as(f, userId);
      expect((await db.query(`select id from public.client_account_reconciliations`)).rows).toHaveLength(0);
      await expectDbError(() => db.query(`select public.prepare_client_reconciliation($1, $2::date, 0, null, $3)`, [f.accountId, day(-1), key()]), /reconciliation access denied/);
      await expectDbError(() => db.query(`select public.sign_client_reconciliation($1, 'reconciled', null)`, [id]), /reconciliation access denied/);
    }
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    expect((await db.query(`select id from public.client_account_reconciliations`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.prepare_client_reconciliation($1, $2::date, 0, null, $3)`, [f.accountId, day(-1), key()]), /reconciliation access denied/);
    await asAnon(db);
    await expectDbError(() => db.query(`select id from public.client_account_reconciliations`), /permission denied/);

    // Another firm's owner: in their own workspace, or claiming this one.
    await as(g, g.owner);
    expect((await db.query(`select id from public.client_account_reconciliations`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.prepare_client_reconciliation($1, $2::date, 0, null, $3)`, [f.accountId, day(-1), key()]), /reconciliation access denied/);
    await expectDbError(() => db.query(`select public.sign_client_reconciliation($1, 'reconciled', null)`, [id]), /reconciliation access denied/);
    await asUser(db, { userId: g.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    expect((await db.query(`select id from public.client_account_reconciliations`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.sign_client_reconciliation($1, 'reconciled', null)`, [id]), /reconciliation access denied/);
    expect((await rec(id)).status).toBe("pending_review");
  });
});
