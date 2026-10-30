import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * The card refund cap (app.payment_refundable_cents, used by invoice_refund_context and
 * record_invoice_refund) also counts money moved off the invoice by a client credit (applied to
 * another invoice or refunded by bank), and card refunds on the invoice still pending at Stripe.
 * Test mode, synthetic Stripe ids only.
 */

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

function token(length = 14) {
  return randomUUID().replaceAll("-", "").slice(0, length);
}

const accountId = () => `acct_1Syn${token()}`;
const intentId = () => `pi_3Syn${token()}`;
const refundId = () => `re_3Syn${token()}`;
const eventId = () => `evt_Syn${token(20)}`;

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${id.slice(0, 8)}@example.test`]);
  return id;
}

type Firm = Awaited<ReturnType<typeof firm>>;

/** A firm with a connected account and two matters of the same applicant (a portal client). */
async function firm() {
  const account = accountId();
  const owner = await createUser("owner");
  const client = await createUser("client");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${token(12)}`]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, 'client'::public.org_role, 'active', now(), $3)`,
    [orgId, client, owner],
  );
  const matterId = randomUUID();
  const secondMatter = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true), ($3, $2, 'Second matter', true)`, [
    matterId,
    orgId,
    secondMatter,
  ]);
  const person = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`, [orgId, client]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $4, $3, 'applicant')`, [
    orgId,
    matterId,
    person.rows[0].id,
    secondMatter,
  ]);
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.record_firm_payment_account($1, $2, false)`, [orgId, account]);
  return { owner, client, orgId, matterId, secondMatter, account };
}

async function asStepUp(f: Firm) {
  await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
}

async function issue(f: Firm, amount: number, matterId: string = f.matterId) {
  await asStepUp(f);
  const created = await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation stage', $2, 'CAD', $3::date, $4) as id`, [matterId, amount, firmDay(3), `inv-${randomUUID()}`]);
  return created.rows[0].id;
}

/** A card payment of `amount` on the invoice, applied by Stripe's event. */
async function cardPayment(f: Firm, invoiceId: string, amount: number) {
  const intent = intentId();
  await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
  await db.query(`select public.record_invoice_payment_intent($1, $2, $3, $4, 'cad', 0, false)`, [invoiceId, intent, f.account, amount]);
  await asServiceRole(db);
  const applied = await db.query<{ r: { outcome: string } }>(
    `select public.apply_stripe_payment_event($1, $2, 'payment_intent.succeeded', $3, $4, $4, 'cad', false, null, '{}'::jsonb) as r`,
    [eventId(), f.account, intent, amount],
  );
  expect(applied.rows[0].r.outcome).toBe("applied");
  await asMaintenance(db);
  const payment = await db.query<{ id: string }>(`select id from public.invoice_payments where payment_intent_id = $1`, [intent]);
  return { paymentId: payment.rows[0].id, intent };
}

/**
 * A card-paid invoice whose card money partly became a client credit: a credit note on the paid
 * invoice (set directly here) leaves `creditCents` held beyond what the invoice asks for.
 */
async function cardPaidWithCredit(f: Firm, amount: number, creditCents: number) {
  const invoiceId = await issue(f, amount);
  const { paymentId, intent } = await cardPayment(f, invoiceId, amount);
  await asMaintenance(db);
  await db.query(`update public.invoices set credited_cents = credited_cents + $2 where id = $1`, [invoiceId, creditCents]);
  const credit = (
    await db.query<{ id: string; available: string }>(`select credit.id, app.client_credit_available_cents(credit.id) as available from public.client_credits credit where source_invoice_id = $1`, [
      invoiceId,
    ])
  ).rows[0];
  expect(Number(credit.available)).toBe(creditCents);
  return { invoiceId, paymentId, intent, creditId: credit.id };
}

async function refundable(f: Firm, paymentId: string) {
  await asStepUp(f);
  return (await db.query<{ c: { refundable: number } }>(`select public.invoice_refund_context($1) as c`, [paymentId])).rows[0].c.refundable;
}

async function requestRefund(f: Firm, paymentId: string, amount: number) {
  await asStepUp(f);
  const refund = refundId();
  const row = await db.query<{ id: string }>(`select public.record_invoice_refund($1, $2, $3, 'cad', 'requested_by_customer', false, $4) as id`, [paymentId, refund, amount, `rf-${randomUUID()}`]);
  return { id: row.rows[0].id, refund };
}

async function refundSucceeded(f: Firm, intent: string, refund: string, amount: number) {
  await asServiceRole(db);
  const result = await db.query<{ r: { outcome: string; refund_status: string; invoice_status: string } }>(
    `select public.apply_stripe_reversal_event($1, $2, 'refund.updated', $3, $4, null, $5, 'cad', 'succeeded', null, null, null, null, null, false, '{}'::jsonb) as r`,
    [eventId(), f.account, refund, intent, amount],
  );
  return result.rows[0].r;
}

async function invoiceRow(id: string) {
  await asMaintenance(db);
  const row = (await db.query<{ status: string; paid_cents: string; refunded_cents: string }>(`select status, paid_cents, refunded_cents from public.invoices where id = $1`, [id])).rows[0];
  return { status: row.status, paid: Number(row.paid_cents), refunded: Number(row.refunded_cents) };
}

describe("card refund cap counts money moved off the invoice", () => {
  it("still refunds a card payment in full when no credit moved", async () => {
    const f = await firm();
    const invoiceId = await issue(f, 40_000);
    const { paymentId, intent } = await cardPayment(f, invoiceId, 40_000);
    expect(await refundable(f, paymentId)).toBe(40_000);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 40001, 'cad', null, false, null)`, [paymentId, refundId()]), /exceeds the amount received/);
    const { refund } = await requestRefund(f, paymentId, 40_000);
    expect(await refundable(f, paymentId)).toBe(0);
    expect(await refundSucceeded(f, intent, refund, 40_000)).toMatchObject({ outcome: "applied", refund_status: "succeeded", invoice_status: "refunded" });
    expect(await invoiceRow(invoiceId)).toEqual({ status: "refunded", paid: 40_000, refunded: 40_000 });
  });

  it("shrinks after a credit is applied to another invoice, and refuses the old full amount", async () => {
    const f = await firm();
    const { invoiceId, paymentId, intent, creditId } = await cardPaidWithCredit(f, 100_000, 5_000);
    expect(await refundable(f, paymentId)).toBe(100_000);

    const second = await issue(f, 20_000, f.secondMatter);
    await asStepUp(f);
    await db.query(`select public.apply_client_credit($1, $2, 5000, $3)`, [creditId, second, `cc-${randomUUID()}`]);
    expect(await invoiceRow(invoiceId)).toMatchObject({ paid: 95_000 });

    // The payment received 100,000 but only 95,000 is still on the invoice.
    await asMaintenance(db);
    expect(Number((await db.query<{ n: string }>(`select app.payment_refundable_cents($1) as n`, [paymentId])).rows[0].n)).toBe(95_000);
    expect(await refundable(f, paymentId)).toBe(95_000);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 100000, 'cad', null, false, null)`, [paymentId, refundId()]), /exceeds the amount received/);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 95001, 'cad', null, false, null)`, [paymentId, refundId()]), /exceeds the amount received/);

    // What is left is refunded, and Stripe's success event is applied to the ledger.
    const { refund } = await requestRefund(f, paymentId, 95_000);
    expect(await refundable(f, paymentId)).toBe(0);
    expect(await refundSucceeded(f, intent, refund, 95_000)).toMatchObject({ outcome: "applied", refund_status: "succeeded" });
    expect(await invoiceRow(invoiceId)).toMatchObject({ paid: 95_000, refunded: 95_000 });
  });

  it("shrinks after a bank refund of the credit", async () => {
    const f = await firm();
    const { invoiceId, paymentId, creditId } = await cardPaidWithCredit(f, 60_000, 6_000);
    await asStepUp(f);
    await db.query(`select public.record_client_credit_bank_refund($1, 6000, 'e_transfer', 'ET-SYN-1', $2::date, $3)`, [creditId, firmDay(0), `cb-${randomUUID()}`]);
    expect(await invoiceRow(invoiceId)).toMatchObject({ paid: 54_000 });
    expect(await refundable(f, paymentId)).toBe(54_000);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 60000, 'cad', null, false, null)`, [paymentId, refundId()]), /exceeds the amount received/);
    await requestRefund(f, paymentId, 54_000);
    expect(await refundable(f, paymentId)).toBe(0);
  });

  it("counts pending refunds once, so a second refund cannot pass what the invoice still holds", async () => {
    const f = await firm();
    const { invoiceId, paymentId, intent, creditId } = await cardPaidWithCredit(f, 100_000, 5_000);
    const second = await issue(f, 20_000, f.secondMatter);
    await asStepUp(f);
    await db.query(`select public.apply_client_credit($1, $2, 5000, $3)`, [creditId, second, `cc-${randomUUID()}`]);

    // A pending refund of 50,000: the invoice holds 45,000 more, the payment 50,000.
    const first = await requestRefund(f, paymentId, 50_000);
    expect(await refundable(f, paymentId)).toBe(45_000);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 50000, 'cad', null, false, null)`, [paymentId, refundId()]), /exceeds the amount received/);

    // Once it succeeds it counts through refunded_cents instead, not twice.
    expect(await refundSucceeded(f, intent, first.refund, 50_000)).toMatchObject({ outcome: "applied", refund_status: "succeeded" });
    expect(await invoiceRow(invoiceId)).toMatchObject({ paid: 95_000, refunded: 50_000 });
    expect(await refundable(f, paymentId)).toBe(45_000);
    const rest = await requestRefund(f, paymentId, 45_000);
    expect(await refundable(f, paymentId)).toBe(0);
    expect(await refundSucceeded(f, intent, rest.refund, 45_000)).toMatchObject({ outcome: "applied", refund_status: "succeeded", invoice_status: "refunded" });
  });
});
