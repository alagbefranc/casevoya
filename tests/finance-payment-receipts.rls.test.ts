import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyMigrationsFrom,
  asAnon,
  asMaintenance,
  asServiceRole,
  asUser,
  createTestDb,
  expectDbError,
  type TestDb,
} from "./helpers/postgres";

/**
 * Receipts for payments of invoices (CICC Code s. 33(3)): one per succeeded card payment (issued from
 * the Stripe webhook path) and one per approved client-account transfer, PR-0001 per firm.
 * Synthetic people and synthetic Stripe ids only.
 */

const MIGRATION = "20261019140000";

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

const hex = (length: number) => randomUUID().replaceAll("-", "").slice(0, length);
const key = (prefix = "k") => `${prefix}-${randomUUID()}`;
const today = () => new Date().toISOString().slice(0, 10);
const inThreeDays = () => new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

async function createUser(target: TestDb, label: string) {
  await asMaintenance(target);
  const id = randomUUID();
  await target.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${id.slice(0, 8)}@example.test`]);
  return id;
}

async function member(target: TestDb, orgId: string, userId: string, role: string, by: string) {
  await asMaintenance(target);
  const row = await target.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, by],
  );
  return row.rows[0].id;
}

/**
 * A firm (sample mode, sample matters) with a connected test-mode Stripe account, a client account,
 * a matter whose applicant is a portal client, and a second matter with another client.
 */
async function firm(target: TestDb = db) {
  const owner = await createUser(target, "owner");
  const finance = await createUser(target, "finance");
  const otherFinance = await createUser(target, "finance-unassigned");
  const assistant = await createUser(target, "assistant");
  const client = await createUser(target, "client");
  const stranger = await createUser(target, "stranger");
  await asUser(target, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await target.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${hex(12)}`]);
  const orgId = created.rows[0].id;
  const financeMembership = await member(target, orgId, finance, "finance_user", owner);
  await member(target, orgId, otherFinance, "finance_user", owner);
  await member(target, orgId, assistant, "assistant", owner);
  await member(target, orgId, client, "client", owner);
  await member(target, orgId, stranger, "client", owner);
  await asMaintenance(target);
  const matterId = randomUUID();
  const otherMatter = randomUUID();
  await target.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true), ($3, $2, 'Other matter', true)`, [
    matterId,
    orgId,
    otherMatter,
  ]);
  const person = await target.query<{ id: string }>(
    `insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`,
    [orgId, client],
  );
  const strangerPerson = await target.query<{ id: string }>(
    `insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Other applicant', true, $2) returning id`,
    [orgId, stranger],
  );
  await target.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $4, $5, 'applicant')`,
    [orgId, matterId, person.rows[0].id, otherMatter, strangerPerson.rows[0].id],
  );
  await target.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [
    orgId,
    matterId,
    financeMembership,
  ]);
  const account = `acct_1Syn${hex(14)}`;
  await asUser(target, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await target.query(`select public.record_firm_payment_account($1, $2, false)`, [orgId, account]);
  const clientAccount = await target.query<{ id: string }>(`select public.create_client_account($1, 'Client account', 'Synthetic Bank', '4410') as id`, [orgId]);
  return {
    target,
    owner,
    finance,
    otherFinance,
    assistant,
    client,
    stranger,
    orgId,
    matterId,
    otherMatter,
    account,
    personId: person.rows[0].id,
    strangerPersonId: strangerPerson.rows[0].id,
    clientAccountId: clientAccount.rows[0].id,
  };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function as(f: Firm, userId: string, stepUp = true) {
  await asUser(f.target, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: stepUp ? 0 : 20 * 60 });
}

async function issue(f: Firm, amount = 113_000, matterId = f.matterId) {
  await as(f, f.owner);
  const created = await f.target.query<{ id: string }>(`select public.create_invoice($1, 'Preparation stage', $2, 'CAD', $3::date, $4) as id`, [
    matterId,
    amount,
    inThreeDays(),
    key("inv"),
  ]);
  return created.rows[0].id;
}

/** The client starts paying (records the PaymentIntent), as the portal does. */
async function startPayment(f: Firm, invoiceId: string, amount = 113_000, userId = f.client) {
  const intent = `pi_3Syn${hex(16)}`;
  await asUser(f.target, { userId, aal: "aal1", orgId: f.orgId });
  await f.target.query(`select public.record_invoice_payment_intent($1, $2, $3, $4, 'cad', 0, false)`, [invoiceId, intent, f.account, amount]);
  return intent;
}

/** A verified Stripe event, through the webhook function (service_role). */
async function deliver(f: Firm, event: { id?: string; type: string; intent: string; amount?: number; received?: number; invoiceId?: string | null }) {
  await asServiceRole(f.target);
  const id = event.id ?? `evt_1Syn${hex(16)}`;
  const result = await f.target.query<{ r: { outcome: string } }>(
    `select public.apply_stripe_payment_event($1, $2, $3, $4, $5, $6, 'cad', false, $7, '{}'::jsonb) as r`,
    [id, f.account, event.type, event.intent, event.amount ?? 113_000, event.received ?? 0, event.invoiceId ?? null],
  );
  return { id, outcome: result.rows[0].r.outcome };
}

async function payByCard(f: Firm, invoiceId: string, amount = 113_000) {
  const intent = await startPayment(f, invoiceId, amount);
  const event = await deliver(f, { type: "payment_intent.succeeded", intent, amount, received: amount });
  return { intent, event };
}

async function paymentId(f: Firm, intent: string) {
  await asMaintenance(f.target);
  return (await f.target.query<{ id: string }>(`select id from public.invoice_payments where payment_intent_id = $1`, [intent])).rows[0].id;
}

async function receiptFor(f: Firm, where: { paymentId?: string; entryId?: string }) {
  await asMaintenance(f.target);
  const rows = await f.target.query<Record<string, unknown>>(
    `select * from public.invoice_payment_receipts where ${where.paymentId ? "payment_id" : "entry_id"} = $1`,
    [where.paymentId ?? where.entryId],
  );
  return rows.rows;
}

async function receiptCount(f: Firm) {
  await asMaintenance(f.target);
  return Number((await f.target.query<{ n: string }>(`select count(*) as n from public.invoice_payment_receipts where organization_id = $1`, [f.orgId])).rows[0].n);
}

/** A verified client-account balance for the applicant; returns the sub-ledger. */
async function funded(f: Firm, amount = 150_000) {
  await as(f, f.owner, false);
  const deposit = await f.target.query<{ id: string }>(
    `select public.record_client_deposit($1, $2, $3, $4, 'cad', 'bank_transfer', 'RBC-0001', $5::date, 'Statement line', $6) as id`,
    [f.clientAccountId, f.matterId, f.personId, amount, today(), key("cf")],
  );
  // The owner verifying their own deposit needs a step-up taken after it was recorded.
  await as(f, f.owner, true);
  await f.target.query(`select public.verify_client_deposit($1)`, [deposit.rows[0].id]);
  await asMaintenance(f.target);
  return (await f.target.query<{ ledger_id: string }>(`select ledger_id from public.client_fund_entries where id = $1`, [deposit.rows[0].id])).rows[0].ledger_id;
}

async function requestTransfer(f: Firm, ledgerId: string, invoiceId: string, amount: number) {
  await as(f, f.finance);
  const row = await f.target.query<{ id: string }>(`select public.request_client_transfer($1, $2, $3, 'Milestone 1', $4) as id`, [ledgerId, invoiceId, amount, key("tr")]);
  return row.rows[0].id;
}

async function approve(f: Firm, entryId: string) {
  await as(f, f.owner);
  await f.target.query(`select public.approve_client_transfer($1)`, [entryId]);
}

describe("receipt for a card payment (s. 33(3))", () => {
  it("is issued once when the webhook marks the payment succeeded, naming the invoice", async () => {
    const f = await firm();
    const invoiceId = await issue(f);
    const intent = await startPayment(f, invoiceId);
    const payment = await paymentId(f, intent);
    await deliver(f, { type: "payment_intent.processing", intent });
    expect(await receiptFor(f, { paymentId: payment })).toEqual([]);

    const succeeded = await deliver(f, { type: "payment_intent.succeeded", intent, received: 113_000 });
    expect(succeeded.outcome).toBe("applied");
    const [receipt] = await receiptFor(f, { paymentId: payment });
    expect(receipt).toMatchObject({
      number: "PR-0001",
      source: "card",
      method: "card",
      entry_id: null,
      invoice_id: invoiceId,
      invoice_number: "INV-0001",
      invoice_description: "Preparation stage",
      invoice_amount_cents: 113_000,
      amount_cents: 113_000,
      currency: "CAD",
      reference: intent,
      person_id: f.personId,
      client_name: "Synthetic applicant",
      matter_label: expect.stringMatching(/Synthetic matter$/),
      firm_legal_name: "Synthetic Legal Name",
      firm_display_name: "Synthetic Firm",
      consultant_licence: null,
      account_last4: null,
      issued_by: null,
      is_sample: true,
    });
    // Date paid is the firm's local date of the succeeded event.
    await asMaintenance(db);
    const paid = await db.query<{ same: boolean }>(
      `select receipt.paid_on = app.firm_local_date(receipt.organization_id, payment.succeeded_at) as same
       from public.invoice_payment_receipts receipt join public.invoice_payments payment on payment.id = receipt.payment_id where receipt.id = $1`,
      [receipt.id],
    );
    expect(paid.rows[0].same).toBe(true);

    // A replayed event, and a second succeeded event for the same payment, issue nothing more.
    expect((await deliver(f, { id: succeeded.id, type: "payment_intent.succeeded", intent, received: 113_000 })).outcome).toBe("duplicate");
    expect((await deliver(f, { type: "payment_intent.succeeded", intent, received: 113_000 })).outcome).toBe("unchanged");
    expect(await receiptFor(f, { paymentId: payment })).toHaveLength(1);
    expect(await receiptCount(f)).toBe(1);

    // Issuing again directly returns the same receipt.
    await asMaintenance(db);
    const again = await db.query<{ id: string }>(`select app.issue_invoice_payment_receipt($1, null) as id`, [payment]);
    expect(again.rows[0].id).toBe(receipt.id);

    await asMaintenance(db);
    const audit = await db.query<{ n: string }>(`select count(*) as n from public.audit_log where action = 'invoice.payment_receipt_issued' and object_id = $1`, [receipt.id]);
    expect(Number(audit.rows[0].n)).toBe(1);
  });

  it("is not issued for a failed or canceled payment, and the matter stage is untouched", async () => {
    const f = await firm();
    const invoiceId = await issue(f);
    const failed = await startPayment(f, invoiceId);
    await deliver(f, { type: "payment_intent.payment_failed", intent: failed });
    await deliver(f, { type: "payment_intent.canceled", intent: failed });
    expect(await receiptCount(f)).toBe(0);
    await payByCard(f, invoiceId);
    expect(await receiptCount(f)).toBe(1);
    await asMaintenance(db);
    const matter = await db.query<{ stage: string }>(`select stage::text from public.matters where id = $1`, [f.matterId]);
    expect(matter.rows[0].stage).toBe("engagement_pending");
  });

  it("names the matter's applicant when the payment was recovered from the webhook alone", async () => {
    const f = await firm();
    const invoiceId = await issue(f);
    const intent = `pi_3Syn${hex(16)}`;
    expect((await deliver(f, { type: "payment_intent.succeeded", intent, received: 113_000, invoiceId })).outcome).toBe("applied");
    const [receipt] = await receiptFor(f, { paymentId: await paymentId(f, intent) });
    expect(receipt).toMatchObject({ number: "PR-0001", person_id: f.personId, client_name: "Synthetic applicant" });
  });

  it("keeps the receipt as issued after a refund", async () => {
    const f = await firm();
    const invoiceId = await issue(f);
    const { intent } = await payByCard(f, invoiceId);
    const payment = await paymentId(f, intent);
    const [before] = await receiptFor(f, { paymentId: payment });
    await asMaintenance(db);
    await db.query(`update public.invoice_payments set refunded_cents = 13_000 where id = $1`, [payment]);
    const after = await receiptFor(f, { paymentId: payment });
    expect(after).toEqual([before]);
    await expectDbError(() => db.query(`update public.invoice_payment_receipts set amount_cents = 1 where id = $1`, [before.id]), /append-only/);
    await expectDbError(() => db.query(`delete from public.invoice_payment_receipts where id = $1`, [before.id]), /append-only/);
  });
});

describe("receipt for a client-account transfer applied to an invoice (s. 33(3))", () => {
  it("is issued when the transfer is approved, not while pending or when declined", async () => {
    const f = await firm();
    const ledgerId = await funded(f, 150_000);
    const invoiceId = await issue(f, 30_000);
    const declined = await requestTransfer(f, ledgerId, invoiceId, 10_000);
    await as(f, f.owner, false);
    await db.query(`select public.decline_client_transfer($1, 'Not yet earned')`, [declined]);
    const pending = await requestTransfer(f, ledgerId, invoiceId, 30_000);
    expect(await receiptFor(f, { entryId: declined })).toEqual([]);
    expect(await receiptFor(f, { entryId: pending })).toEqual([]);

    await approve(f, pending);
    await asMaintenance(db);
    const entryNumber = (await db.query<{ number: string }>(`select number from public.client_fund_entries where id = $1`, [pending])).rows[0].number;
    const [receipt] = await receiptFor(f, { entryId: pending });
    expect(receipt).toMatchObject({
      number: "PR-0001",
      source: "client_funds",
      method: "client_account",
      payment_id: null,
      invoice_id: invoiceId,
      invoice_number: "INV-0001",
      amount_cents: 30_000,
      reference: entryNumber,
      person_id: f.personId,
      client_name: "Synthetic applicant",
      account_label: "Client account",
      account_institution: "Synthetic Bank",
      account_last4: "4410",
      issued_by: f.owner,
      is_sample: true,
    });
    expect(await receiptCount(f)).toBe(1);
  });

  it("numbers card and client-account receipts in one PR- series per firm, apart from RC- receipts", async () => {
    const f = await firm();
    const ledgerId = await funded(f, 150_000);
    await payByCard(f, await issue(f, 20_000), 20_000);
    const transfer = await requestTransfer(f, ledgerId, await issue(f, 30_000), 30_000);
    await approve(f, transfer);
    await payByCard(f, await issue(f, 5_000), 5_000);
    await asMaintenance(db);
    const numbers = await db.query<{ number: string; source: string }>(
      `select number, source from public.invoice_payment_receipts where organization_id = $1 order by number`,
      [f.orgId],
    );
    expect(numbers.rows).toEqual([
      { number: "PR-0001", source: "card" },
      { number: "PR-0002", source: "client_funds" },
      { number: "PR-0003", source: "card" },
    ]);
    const advances = await db.query<{ number: string }>(`select number from public.client_fund_receipts where organization_id = $1`, [f.orgId]);
    expect(advances.rows).toEqual([{ number: "RC-0001" }]);

    const other = await firm();
    await payByCard(other, await issue(other, 1_000), 1_000);
    await asMaintenance(db);
    const otherNumbers = await db.query<{ number: string }>(`select number from public.invoice_payment_receipts where organization_id = $1`, [other.orgId]);
    expect(otherNumbers.rows).toEqual([{ number: "PR-0001" }]);
  });
});

describe("reading a payment receipt", () => {
  it("lets the matter's billing staff and the client who paid read it, audits each read, and nobody else", async () => {
    const f = await firm();
    const { intent } = await payByCard(f, await issue(f));
    const [receipt] = await receiptFor(f, { paymentId: await paymentId(f, intent) });
    // A second payment by the other client, on their own matter.
    const theirs = await issue(f, 5_000, f.otherMatter);
    const theirIntent = await startPayment(f, theirs, 5_000, f.stranger);
    await deliver(f, { type: "payment_intent.succeeded", intent: theirIntent, amount: 5_000, received: 5_000 });

    for (const userId of [f.owner, f.finance]) {
      await as(f, userId, false);
      const row = await db.query<{ r: { number: string; invoice_number: string } }>(`select public.invoice_payment_receipt($1) as r`, [receipt.id]);
      expect(row.rows[0].r).toMatchObject({ number: "PR-0001", invoice_number: "INV-0001" });
    }
    await as(f, f.owner, false);
    expect((await db.query(`select id from public.invoice_payment_receipts`)).rows).toHaveLength(2);
    await as(f, f.finance, false);
    expect((await db.query(`select id from public.invoice_payment_receipts`)).rows).toHaveLength(1);

    for (const userId of [f.otherFinance, f.assistant]) {
      await as(f, userId, false);
      await expectDbError(() => db.query(`select public.invoice_payment_receipt($1)`, [receipt.id]), /receipt access denied/);
      expect((await db.query(`select id from public.invoice_payment_receipts`)).rows).toHaveLength(0);
    }

    // The paying client sees their own receipt only.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    expect((await db.query<{ r: { number: string } }>(`select public.invoice_payment_receipt($1) as r`, [receipt.id])).rows[0].r.number).toBe("PR-0001");
    expect((await db.query<{ number: string }>(`select number from public.invoice_payment_receipts`)).rows).toEqual([{ number: "PR-0001" }]);
    await asUser(db, { userId: f.stranger, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.invoice_payment_receipt($1)`, [receipt.id]), /receipt access denied/);
    expect((await db.query<{ number: string }>(`select number from public.invoice_payment_receipts`)).rows).toEqual([{ number: "PR-0002" }]);

    // Another firm's owner, in their own workspace or naming this one without membership, can't read it.
    const other = await firm();
    await as(other, other.owner, false);
    await expectDbError(() => db.query(`select public.invoice_payment_receipt($1)`, [receipt.id]), /receipt access denied/);
    expect((await db.query(`select id from public.invoice_payment_receipts where id = $1`, [receipt.id])).rows).toHaveLength(0);
    await asUser(db, { userId: other.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.invoice_payment_receipt($1)`, [receipt.id]), /receipt access denied/);

    await asAnon(db);
    await expectDbError(() => db.query(`select public.invoice_payment_receipt($1)`, [receipt.id]), /permission denied/);
    await expectDbError(() => db.query(`select id from public.invoice_payment_receipts`), /permission denied/);

    // Nobody writes receipts directly, and the issuing function isn't callable.
    await as(f, f.owner);
    await expectDbError(() => db.query(`update public.invoice_payment_receipts set amount_cents = 1`), /permission denied/);
    await expectDbError(() => db.query(`select app.issue_invoice_payment_receipt(null, null)`), /permission denied/);

    await asMaintenance(db);
    const reads = await db.query<{ actor_user_id: string }>(
      `select actor_user_id from public.audit_log where action = 'invoice.payment_receipt_read' and object_id = $1`,
      [receipt.id],
    );
    expect(reads.rows.map((row) => row.actor_user_id).sort()).toEqual([f.owner, f.finance, f.client].sort());
  });

  it("lets the client whose client-account money paid the invoice read that receipt", async () => {
    const f = await firm();
    const ledgerId = await funded(f, 50_000);
    const transfer = await requestTransfer(f, ledgerId, await issue(f, 20_000), 20_000);
    await approve(f, transfer);
    const [receipt] = await receiptFor(f, { entryId: transfer });
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    expect((await db.query<{ r: { method: string; account_last4: string } }>(`select public.invoice_payment_receipt($1) as r`, [receipt.id])).rows[0].r).toMatchObject({
      method: "client_account",
      account_last4: "4410",
    });
    await asUser(db, { userId: f.stranger, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.invoice_payment_receipt($1)`, [receipt.id]), /receipt access denied/);
  });
});

describe("backfill", () => {
  it("issues receipts for payments that succeeded and transfers approved before the migration, in paid order", async () => {
    const old = await createTestDb({ supabaseDefaultPrivileges: true, stopBefore: MIGRATION });
    try {
      const f = await firm(old);
      const ledgerId = await funded(f, 100_000);
      const card = await payByCard(f, await issue(f, 20_000), 20_000);
      const transfer = await requestTransfer(f, ledgerId, await issue(f, 30_000), 30_000);
      await approve(f, transfer);
      const failedInvoice = await issue(f, 7_000);
      const failed = await startPayment(f, failedInvoice, 7_000);
      await deliver(f, { type: "payment_intent.payment_failed", intent: failed, amount: 7_000 });
      const pending = await requestTransfer(f, ledgerId, failedInvoice, 7_000);

      const second = await firm(old);
      await payByCard(second, await issue(second, 1_000), 1_000);

      await applyMigrationsFrom(old, MIGRATION);
      const rows = await old.query<{ number: string; source: string; payment_id: string | null; entry_id: string | null; organization_id: string }>(
        `select number, source, payment_id, entry_id, organization_id from public.invoice_payment_receipts order by organization_id, number`,
      );
      const mine = rows.rows.filter((row) => row.organization_id === f.orgId);
      expect(mine).toEqual([
        { number: "PR-0001", source: "card", payment_id: await paymentId(f, card.intent), entry_id: null, organization_id: f.orgId },
        { number: "PR-0002", source: "client_funds", payment_id: null, entry_id: transfer, organization_id: f.orgId },
      ]);
      expect(rows.rows.filter((row) => row.organization_id === second.orgId).map((row) => row.number)).toEqual(["PR-0001"]);
      expect(rows.rows.some((row) => row.entry_id === pending)).toBe(false);

      // After the migration, new payments continue the series.
      await approve(f, pending);
      await asMaintenance(old);
      const next = await old.query<{ number: string }>(`select number from public.invoice_payment_receipts where entry_id = $1`, [pending]);
      expect(next.rows).toEqual([{ number: "PR-0003" }]);
    } finally {
      await old.close();
    }
  }, 240_000);
});
