import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/** Client funds: the manual client-account ledger (FIN-03, FIN-09..11). Synthetic people only. */

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

const key = (prefix = "cf") => `${prefix}-${randomUUID()}`;
const today = () => new Date().toISOString().slice(0, 10);
const inThreeDays = () => new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

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

/**
 * A firm (in sample mode, as new firms are) with a sample matter whose applicant is a portal client,
 * a second matter with another client, and a client account. `finance: false` makes an owner-only firm.
 */
async function firm(options: { finance?: boolean; secondFinance?: boolean } = {}) {
  const owner = await createUser("owner");
  const finance = await createUser("finance");
  const secondFinance = await createUser("finance-two");
  const otherFinance = await createUser("finance-unassigned");
  const assistant = await createUser("assistant");
  const client = await createUser("client");
  const stranger = await createUser("stranger");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${token(12)}`]);
  const orgId = created.rows[0].id;
  const withFinance = options.finance !== false;
  const financeMembership = withFinance ? await member(orgId, finance, "finance_user", owner) : null;
  const secondMembership = options.secondFinance ? await member(orgId, secondFinance, "finance_user", owner) : null;
  await member(orgId, assistant, "assistant", owner);
  await member(orgId, client, "client", owner);
  await member(orgId, stranger, "client", owner);
  if (withFinance) await member(orgId, otherFinance, "finance_user", owner);
  await asMaintenance(db);
  const matterId = randomUUID();
  const otherMatter = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true), ($3, $2, 'Other matter', true)`, [matterId, orgId, otherMatter]);
  const person = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`, [orgId, client]);
  const strangerPerson = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Other applicant', true, $2) returning id`, [orgId, stranger]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $4, $5, 'applicant')`, [
    orgId,
    matterId,
    person.rows[0].id,
    otherMatter,
    strangerPerson.rows[0].id,
  ]);
  for (const membership of [financeMembership, secondMembership]) {
    if (membership) await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [orgId, matterId, membership]);
  }
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const account = await db.query<{ id: string }>(`select public.create_client_account($1, 'Client account', 'Synthetic Bank', '4410') as id`, [orgId]);
  return {
    owner,
    finance,
    secondFinance,
    otherFinance,
    assistant,
    client,
    stranger,
    orgId,
    matterId,
    otherMatter,
    personId: person.rows[0].id,
    strangerPersonId: strangerPerson.rows[0].id,
    accountId: account.rows[0].id,
  };
}

async function as(f: Firm, userId: string, stepUp = true) {
  await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: stepUp ? 0 : 20 * 60 });
}

async function deposit(f: Firm, amount: number, options: { userId?: string; matterId?: string; personId?: string; key?: string } = {}) {
  await as(f, options.userId ?? f.finance, false);
  const row = await db.query<{ id: string }>(
    `select public.record_client_deposit($1, $2, $3, $4, 'cad', 'bank_transfer', 'RBC-0001', $5::date, 'Statement line', $6) as id`,
    [f.accountId, options.matterId ?? f.matterId, options.personId ?? f.personId, amount, today(), options.key ?? key()],
  );
  return row.rows[0].id;
}

async function verify(f: Firm, entryId: string, userId: string = f.owner) {
  await as(f, userId, false);
  await db.query(`select public.verify_client_deposit($1)`, [entryId]);
}

async function ledgerOf(entryId: string) {
  await asMaintenance(db);
  return (await db.query<{ ledger_id: string }>(`select ledger_id from public.client_fund_entries where id = $1`, [entryId])).rows[0].ledger_id;
}

async function totals(ledgerId: string) {
  await asMaintenance(db);
  const row = await db.query<{ balance: string; pending_out: string }>(`select * from app.client_fund_ledger_totals($1)`, [ledgerId]);
  return { balance: Number(row.rows[0].balance), pending: Number(row.rows[0].pending_out) };
}

async function issue(f: Firm, amount = 30_000, matterId: string = f.matterId) {
  await as(f, f.owner);
  const created = await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation delivered', $2, 'CAD', $3::date, $4) as id`, [matterId, amount, inThreeDays(), key("inv")]);
  return created.rows[0].id;
}

async function requestTransfer(f: Firm, ledgerId: string, invoiceId: string, amount: number, userId: string = f.finance) {
  await as(f, userId);
  const row = await db.query<{ id: string }>(`select public.request_client_transfer($1, $2, $3, 'Milestone 1', $4) as id`, [ledgerId, invoiceId, amount, key()]);
  return row.rows[0].id;
}

async function approve(f: Firm, entryId: string, userId: string) {
  await as(f, userId);
  return (await db.query<{ r: { status: string; owner_self_approved: boolean; invoice_status: string } }>(`select public.approve_client_transfer($1) as r`, [entryId])).rows[0].r;
}

async function entry(id: string) {
  await asMaintenance(db);
  return (await db.query<Record<string, unknown>>(`select * from public.client_fund_entries where id = $1`, [id])).rows[0];
}

async function invoiceRow(id: string) {
  await asMaintenance(db);
  const row = await db.query<{ status: string; paid_cents: string; client_funds_paid_cents: string }>(`select status, paid_cents, client_funds_paid_cents from public.invoices where id = $1`, [id]);
  return { status: row.rows[0].status, paid: Number(row.rows[0].paid_cents), fromFunds: Number(row.rows[0].client_funds_paid_cents) };
}

/** A verified balance of `amount` for the firm's applicant; returns the deposit and ledger ids. */
async function funded(f: Firm, amount = 150_000) {
  const depositId = await deposit(f, amount, { userId: f.owner });
  await verify(f, depositId);
  return { depositId, ledgerId: await ledgerOf(depositId) };
}

describe("client accounts", () => {
  it("are added by the firm owner with a recent step-up, and read only by billing staff", async () => {
    const f = await firm();
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 20 * 60 });
    await expectDbError(() => db.query(`select public.create_client_account($1, 'Second', 'Bank', '1234')`, [f.orgId]), /step-up/);
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.create_client_account($1, 'Second', 'Bank', '1234')`, [f.orgId]), /firm owner step-up/);
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.create_client_account($1, 'Second', 'Bank', '12345')`, [f.orgId]), /last four digits/);

    for (const userId of [f.owner, f.finance, f.otherFinance]) {
      await as(f, userId, false);
      expect((await db.query(`select id from public.client_accounts`)).rows).toHaveLength(1);
    }
    for (const userId of [f.assistant, f.client]) {
      await as(f, userId, false);
      expect((await db.query(`select id from public.client_accounts`)).rows).toHaveLength(0);
    }
    await asAnon(db);
    await expectDbError(() => db.query(`select id from public.client_accounts`), /permission denied/);
  });
});

describe("deposits", () => {
  it("are recorded pending verification and count only once verified, with who and when", async () => {
    const f = await firm();
    const depositId = await deposit(f, 180_800);
    const ledgerId = await ledgerOf(depositId);
    const recorded = await entry(depositId);
    expect(recorded).toMatchObject({ kind: "deposit", status: "pending_verification", direction: "in", requested_by: f.finance, is_sample: true });
    expect(String(recorded.number)).toMatch(/^CF-\d{4}$/);
    expect(await totals(ledgerId)).toEqual({ balance: 0, pending: 0 });

    await verify(f, depositId, f.owner);
    const verified = await entry(depositId);
    expect(verified).toMatchObject({ status: "verified", verified_by: f.owner });
    expect(verified.verified_at).toBeTruthy();
    expect(await totals(ledgerId)).toEqual({ balance: 180_800, pending: 0 });

    await as(f, f.owner, false);
    await expectDbError(() => db.query(`select public.verify_client_deposit($1)`, [depositId]), /only a deposit pending verification/);
    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 order by occurred_at`, [depositId]);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(["client_funds.deposit_recorded", "client_funds.deposit_verified"]));
  });

  it("refuses people without billing access, people not on the matter, and future dates", async () => {
    const f = await firm();
    for (const userId of [f.assistant, f.otherFinance, f.client]) {
      await as(f, userId, false);
      await expectDbError(
        () => db.query(`select public.record_client_deposit($1, $2, $3, 100, 'cad', 'cheque', null, $4::date, null, $5)`, [f.accountId, f.matterId, f.personId, today(), key()]),
        /billing access denied/,
      );
    }
    await as(f, f.finance, false);
    await expectDbError(
      () => db.query(`select public.record_client_deposit($1, $2, $3, 100, 'cad', 'cheque', null, $4::date, null, $5)`, [f.accountId, f.matterId, f.strangerPersonId, today(), key()]),
      /party on the matter/,
    );
    await expectDbError(
      () => db.query(`select public.record_client_deposit($1, $2, $3, 100, 'cad', 'cheque', null, $4::date, null, $5)`, [f.accountId, f.matterId, f.personId, inThreeDays(), key()]),
      /future/,
    );
    await expectDbError(
      () => db.query(`select public.record_client_deposit($1, $2, $3, 100, 'usd', 'cheque', null, $4::date, null, $5)`, [f.accountId, f.matterId, f.personId, today(), key()]),
      /only CAD/,
    );
    await expectDbError(
      () => db.query(`select public.record_client_deposit($1, $2, $3, 100, 'cad', 'crypto', null, $4::date, null, $5)`, [f.accountId, f.matterId, f.personId, today(), key()]),
      /method is invalid/,
    );
  });

  it("are idempotent on the dialog's key, and a rejected deposit never counts", async () => {
    const f = await firm();
    const k = key();
    const first = await deposit(f, 50_000, { key: k });
    expect(await deposit(f, 50_000, { key: k })).toBe(first);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.reject_client_deposit($1, '')`, [first]), /reason is required/);
    await db.query(`select public.reject_client_deposit($1, 'Not on the October statement')`, [first]);
    expect(await entry(first)).toMatchObject({ status: "rejected", rejected_by: f.finance });
    expect(await totals(await ledgerOf(first))).toEqual({ balance: 0, pending: 0 });
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.verify_client_deposit($1)`, [first]), /only a deposit pending verification/);
  });

  it("follows sample mode: a real matter takes no client funds until sample mode is off, and rows carry is_sample", async () => {
    const f = await firm();
    await asMaintenance(db);
    const realMatter = randomUUID();
    await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Real matter', false)`, [realMatter, f.orgId]);
    const realPerson = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample) values ($1, 'Real applicant', false) returning id`, [f.orgId]);
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [f.orgId, realMatter, realPerson.rows[0].id]);
    await as(f, f.owner, false);
    await expectDbError(
      () => db.query(`select public.record_client_deposit($1, $2, $3, 100, 'cad', 'cheque', null, $4::date, null, $5)`, [f.accountId, realMatter, realPerson.rows[0].id, today(), key()]),
      /sample mode/,
    );
    await asMaintenance(db);
    await db.query(`update public.organizations set sample_mode = false where id = $1`, [f.orgId]);
    const real = await deposit(f, 100, { userId: f.owner, matterId: realMatter, personId: realPerson.rows[0].id });
    expect(await entry(real)).toMatchObject({ is_sample: false });
    expect(await entry(await deposit(f, 100))).toMatchObject({ is_sample: true });
  });
});

describe("earned-fee transfers", () => {
  it("pay only an issued invoice on the same matter, within the available balance and the amount due", async () => {
    const f = await firm();
    const { ledgerId } = await funded(f, 150_000);
    const otherInvoice = await issue(f, 30_000, f.otherMatter);
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.request_client_transfer($1, $2, 1000, null, $3)`, [ledgerId, otherInvoice, key()]), /same matter/);

    const invoiceId = await issue(f, 30_000);
    await expectDbError(() => db.query(`select public.request_client_transfer($1, $2, 30001, null, $3)`, [ledgerId, invoiceId, key()]), /exceeds the amount due/);
    const big = await issue(f, 500_000);
    await expectDbError(() => db.query(`select public.request_client_transfer($1, $2, 150001, null, $3)`, [ledgerId, big, key()]), /available balance/);

    // Pending verification money is not available.
    await deposit(f, 99_000);
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.request_client_transfer($1, $2, 150001, null, $3)`, [ledgerId, big, key()]), /available balance/);

    // A pending transfer holds its amount: a second one can't spend the same money or the same amount due.
    const first = await requestTransfer(f, ledgerId, big, 100_000);
    expect(await entry(first)).toMatchObject({ kind: "transfer", status: "pending_approval", requested_by: f.finance });
    expect(await totals(ledgerId)).toEqual({ balance: 150_000, pending: 100_000 });
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.request_client_transfer($1, $2, 50001, null, $3)`, [ledgerId, big, key()]), /available balance/);
  });

  it("needs a recent step-up, and billing access to the matter", async () => {
    const f = await firm();
    const { ledgerId } = await funded(f);
    const invoiceId = await issue(f);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.request_client_transfer($1, $2, 100, null, $3)`, [ledgerId, invoiceId, key()]), /step-up is required/);
    for (const userId of [f.assistant, f.otherFinance, f.client]) {
      await as(f, userId);
      await expectDbError(() => db.query(`select public.request_client_transfer($1, $2, 100, null, $3)`, [ledgerId, invoiceId, key()]), /billing access denied/);
    }
  });

  it("are approved by someone else (maker-checker), which pays the invoice from client funds", async () => {
    const f = await firm();
    const { ledgerId } = await funded(f, 150_000);
    const invoiceId = await issue(f, 50_000);
    const transferId = await requestTransfer(f, ledgerId, invoiceId, 30_000, f.finance);

    // The finance user who asked can never approve it.
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.approve_client_transfer($1)`, [transferId]), /cannot approve their own transfer/);
    // Without a step-up, no approval.
    await as(f, f.owner, false);
    await expectDbError(() => db.query(`select public.approve_client_transfer($1)`, [transferId]), /step-up is required/);

    const result = await approve(f, transferId, f.owner);
    expect(result).toMatchObject({ status: "approved", owner_self_approved: false, invoice_status: "partially_paid" });
    expect(await entry(transferId)).toMatchObject({ status: "approved", approved_by: f.owner, owner_self_approved: false });
    expect(await invoiceRow(invoiceId)).toEqual({ status: "partially_paid", paid: 30_000, fromFunds: 30_000 });
    expect(await totals(ledgerId)).toEqual({ balance: 120_000, pending: 0 });

    // The rest of the invoice: the invoice turns paid.
    // A finance user may approve the owner's request.
    const rest = await requestTransfer(f, ledgerId, invoiceId, 20_000, f.owner);
    expect((await approve(f, rest, f.finance)).invoice_status).toBe("paid");
    expect(await invoiceRow(invoiceId)).toEqual({ status: "paid", paid: 50_000, fromFunds: 50_000 });
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.request_client_transfer($1, $2, 1, null, $3)`, [ledgerId, invoiceId, key()]), /only an issued invoice/);

    await asMaintenance(db);
    const matter = await db.query<{ stage: string }>(`select stage from public.matters where id = $1`, [f.matterId]);
    expect(matter.rows[0].stage).not.toBe("closed");
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1`, [transferId]);
    expect(audit.rows.map((row) => row.action)).toContain("client_funds.transfer_approved");
  });

  it("lets a declined transfer release its hold, with a reason", async () => {
    const f = await firm();
    const { ledgerId } = await funded(f, 10_000);
    const invoiceId = await issue(f, 10_000);
    const transferId = await requestTransfer(f, ledgerId, invoiceId, 10_000);
    await as(f, f.owner, false);
    await expectDbError(() => db.query(`select public.decline_client_transfer($1, 'no')`, [transferId]), /reason is required/);
    await db.query(`select public.decline_client_transfer($1, 'Milestone not delivered yet')`, [transferId]);
    expect(await entry(transferId)).toMatchObject({ status: "declined", declined_by: f.owner });
    expect(await totals(ledgerId)).toEqual({ balance: 10_000, pending: 0 });
    await expectDbError(() => approve(f, transferId, f.owner), /only a transfer waiting for approval/);
    expect(await invoiceRow(invoiceId)).toEqual({ status: "issued", paid: 0, fromFunds: 0 });
  });

  it("re-checks the balance at approval time", async () => {
    const f = await firm();
    const { depositId, ledgerId } = await funded(f, 10_000);
    const invoiceId = await issue(f, 10_000);
    const transferId = await requestTransfer(f, ledgerId, invoiceId, 10_000);
    // The deposit can't be reversed while a transfer holds the money.
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.record_client_fund_correction($1, 'Wrong client', $2)`, [depositId, key()]), /negative/);
    expect((await approve(f, transferId, f.owner)).status).toBe("approved");
  });
});

describe("the firm owner may approve their own request (decided by Francis)", () => {
  for (const [label, options] of [
    ["in an owner-only firm", { finance: false }],
    ["when the firm has other finance people", { secondFinance: true }],
  ] as const) {
    it(`lets the owner approve their own transfer ${label}, marked and audited, after a fresh step-up`, async () => {
      const f = await firm(options);
      const { ledgerId } = await funded(f, 20_000);
      const invoiceId = await issue(f, 20_000);
      const transferId = await requestTransfer(f, ledgerId, invoiceId, 20_000, f.owner);

      // A step-up older than the request does not count for approving one's own request.
      await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 120 });
      await expectDbError(() => db.query(`select public.approve_client_transfer($1)`, [transferId]), /step-up is required: approving your own request/);

      const result = await approve(f, transferId, f.owner);
      expect(result).toMatchObject({ status: "approved", owner_self_approved: true, invoice_status: "paid" });
      expect(await entry(transferId)).toMatchObject({ approved_by: f.owner, requested_by: f.owner, owner_self_approved: true });
      await asMaintenance(db);
      const audit = await db.query<{ action: string; context: { owner_self_approved: boolean } }>(
        `select action, context from public.audit_log where object_id = $1 and action like 'client_funds.transfer_approved%'`,
        [transferId],
      );
      expect(audit.rows).toEqual([
        expect.objectContaining({ action: "client_funds.transfer_approved_owner_self", context: expect.objectContaining({ owner_self_approved: true }) }),
      ]);
    });
  }

  it("never lets a finance user approve their own transfer; another finance user or the owner may", async () => {
    const f = await firm({ secondFinance: true });
    const { ledgerId } = await funded(f, 20_000);
    const invoiceId = await issue(f, 20_000);
    const first = await requestTransfer(f, ledgerId, invoiceId, 10_000, f.finance);
    await expectDbError(() => approve(f, first, f.finance), /cannot approve their own transfer/);
    expect((await approve(f, first, f.secondFinance)).owner_self_approved).toBe(false);
    const second = await requestTransfer(f, ledgerId, invoiceId, 10_000, f.finance);
    await expectDbError(() => approve(f, second, f.finance), /cannot approve their own transfer/);
    expect((await approve(f, second, f.owner)).owner_self_approved).toBe(false);
  });

  it("can't be forged by writing to the table", async () => {
    const f = await firm({ finance: false });
    const { ledgerId } = await funded(f, 20_000);
    const invoiceId = await issue(f, 20_000);
    const transferId = await requestTransfer(f, ledgerId, invoiceId, 20_000, f.owner);
    await as(f, f.owner);
    await expectDbError(() => db.query(`update public.client_fund_entries set status = 'approved', approved_by = $2, approved_at = now(), owner_self_approved = true where id = $1`, [transferId, f.owner]), /permission denied/);
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.client_fund_entries set status = 'approved', approved_by = requested_by, approved_at = now() where id = $1`, [transferId]), /check constraint/);
  });
});

describe("refunds and corrections", () => {
  it("refund no more than the available balance, need a step-up and a reason", async () => {
    const f = await firm();
    const { ledgerId } = await funded(f, 50_000);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.record_client_refund($1, 100, 'cheque', null, $2::date, 'Unused advance', $3)`, [ledgerId, today(), key()]), /step-up is required/);
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.record_client_refund($1, 50001, 'cheque', null, $2::date, 'Unused advance', $3)`, [ledgerId, today(), key()]), /available balance/);
    await expectDbError(() => db.query(`select public.record_client_refund($1, 100, 'cheque', null, $2::date, '', $3)`, [ledgerId, today(), key()]), /reason is required/);
    const refund = await db.query<{ id: string }>(`select public.record_client_refund($1, 50000, 'cheque', 'CHQ 118', $2::date, 'Engagement ended', $3) as id`, [ledgerId, today(), key()]);
    expect(await entry(refund.rows[0].id)).toMatchObject({ kind: "refund", status: "recorded", direction: "out" });
    expect(await totals(ledgerId)).toEqual({ balance: 0, pending: 0 });
  });

  it("are reversing entries, once per entry; entries are never edited or deleted", async () => {
    const f = await firm();
    const { depositId, ledgerId } = await funded(f, 40_000);
    await as(f, f.finance);
    const refund = await db.query<{ id: string }>(`select public.record_client_refund($1, 10000, 'bank_transfer', null, $2::date, 'Partial refund', $3) as id`, [ledgerId, today(), key()]);
    const undo = await db.query<{ id: string }>(`select public.record_client_fund_correction($1, 'Refund was not sent', $2) as id`, [refund.rows[0].id, key()]);
    expect(await entry(undo.rows[0].id)).toMatchObject({ kind: "correction", direction: "in", reverses_entry_id: refund.rows[0].id });
    expect(await totals(ledgerId)).toEqual({ balance: 40_000, pending: 0 });
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.record_client_fund_correction($1, 'Again', $2)`, [refund.rows[0].id, key()]), /already corrected/);
    await expectDbError(() => db.query(`select public.record_client_fund_correction($1, 'Nope', $2)`, [undo.rows[0].id, key()]), /only a verified deposit or a refund/);

    const reversed = await db.query<{ id: string }>(`select public.record_client_fund_correction($1, 'Deposit was another client''s', $2) as id`, [depositId, key()]);
    expect(await entry(reversed.rows[0].id)).toMatchObject({ direction: "out", amount_cents: 40000 });
    expect(await totals(ledgerId)).toEqual({ balance: 0, pending: 0 });

    // Even the table owner can't edit money or delete an entry.
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.client_fund_entries set amount_cents = 1 where id = $1`, [depositId]), /append-only/);
    await expectDbError(() => db.query(`update public.client_fund_entries set status = 'rejected', rejected_by = requested_by, rejected_at = now(), rejection_reason = 'xyz' where id = $1`, [depositId]), /append-only/);
    await expectDbError(() => db.query(`delete from public.client_fund_entries where id = $1`, [depositId]), /append-only/);
    await expectDbError(() => db.query(`delete from public.client_fund_ledgers where id = $1`, [ledgerId]), /append-only/);
  });

  it("can never leave a client balance below zero, even when written directly", async () => {
    const f = await firm();
    const { ledgerId } = await funded(f, 1_000);
    await asMaintenance(db);
    const row = (await db.query<Record<string, string>>(`select * from public.client_fund_entries where ledger_id = $1`, [ledgerId])).rows[0];
    await expectDbError(
      () =>
        db.query(
          `insert into public.client_fund_entries (organization_id, ledger_id, client_account_id, matter_id, person_id, number, kind, status, direction, amount_cents, method, occurred_on, idempotency_key, requested_by)
           values ($1, $2, $3, $4, $5, 'CF-9999', 'refund', 'recorded', 'out', 1001, 'cash', current_date, $6, $7)`,
          [row.organization_id, ledgerId, row.client_account_id, row.matter_id, row.person_id, key(), row.requested_by],
        ),
      /cannot go negative/,
    );
  });
});

describe("who reads the ledger", () => {
  it("billing staff of the matter read every entry; others see nothing; the client sees their own counted entries", async () => {
    const f = await firm();
    const { ledgerId } = await funded(f, 50_000);
    const pending = await deposit(f, 7_000);
    const invoiceId = await issue(f, 20_000);
    const approved = await requestTransfer(f, ledgerId, invoiceId, 10_000);
    await approve(f, approved, f.owner);
    const waiting = await requestTransfer(f, ledgerId, invoiceId, 5_000);
    await deposit(f, 3_000, { matterId: f.otherMatter, personId: f.strangerPersonId, userId: f.owner });

    for (const [userId, count] of [
      [f.owner, 5],
      [f.finance, 4],
      [f.otherFinance, 0],
      [f.assistant, 0],
    ] as const) {
      await as(f, userId, false);
      expect((await db.query(`select id from public.client_fund_entries`)).rows, userId).toHaveLength(count);
    }

    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    const own = await db.query<{ id: string; kind: string; status: string }>(`select id, kind, status from public.client_fund_entries order by created_at`);
    expect(own.rows.map((row) => `${row.kind}:${row.status}`)).toEqual(["deposit:verified", "transfer:approved"]);
    expect(own.rows.map((row) => row.id)).not.toContain(pending);
    expect(own.rows.map((row) => row.id)).not.toContain(waiting);
    expect((await db.query(`select id from public.client_fund_ledgers`)).rows).toHaveLength(1);
    expect((await db.query(`select id from public.client_accounts`)).rows).toHaveLength(0);

    await asUser(db, { userId: f.stranger, aal: "aal1", orgId: f.orgId });
    expect((await db.query(`select id from public.client_fund_entries`)).rows).toHaveLength(0);

    // Writes only through the functions.
    await as(f, f.owner);
    await expectDbError(() => db.query(`insert into public.client_accounts (organization_id, label, institution, account_last4) values ($1, 'x', 'y', '0000')`, [f.orgId]), /permission denied/);
    await expectDbError(() => db.query(`delete from public.client_fund_entries`), /permission denied/);
  });

  it("is isolated between firms", async () => {
    const a = await firm();
    const b = await firm();
    const { ledgerId } = await funded(a, 1_000);
    await as(b, b.owner, false);
    expect((await db.query(`select id from public.client_fund_entries`)).rows).toHaveLength(0);
    expect((await db.query(`select id from public.client_fund_ledgers`)).rows).toHaveLength(0);
    // B's owner, in B's workspace, can't act on A's ledger or account.
    await as(b, b.owner);
    const invoiceB = await issue(b, 500);
    await expectDbError(() => db.query(`select public.request_client_transfer($1, $2, 100, null, $3)`, [ledgerId, invoiceB, key()]), /billing access denied/);
    await expectDbError(
      () => db.query(`select public.record_client_deposit($1, $2, $3, 100, 'cad', 'cheque', null, $4::date, null, $5)`, [a.accountId, b.matterId, b.personId, today(), key()]),
      /client account/,
    );
    await expectDbError(() => db.query(`select public.client_fund_staff_names($1)`, [a.orgId]), /billing access denied/);
  });
});
