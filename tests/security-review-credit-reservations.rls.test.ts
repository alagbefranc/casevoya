import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * 20261031017000 (R2-04, R2-05): active card refund reservations count on the client-credit paths
 * (apply, bank refund, the credit available), a credit's card refund is reserved against the
 * credit (app.reserve_client_credit_refund) and only such a refund links to it; a linked
 * reservation holds for 7 days, and only the staff member who reserved links it.
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
const key = () => `rf-${randomUUID()}`;

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${id.slice(0, 8)}@example.test`]);
  return id;
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function firm() {
  const account = accountId();
  const owner = await createUser("owner");
  const finance = await createUser("finance");
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
  const financeMembership = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, 'finance_user'::public.org_role, 'active', now(), $3) returning id`,
    [orgId, finance, owner],
  );
  const matterId = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true)`, [matterId, orgId]);
  const person = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`, [orgId, client]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, person.rows[0].id]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [orgId, matterId, financeMembership.rows[0].id]);
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.record_firm_payment_account($1, $2, false)`, [orgId, account]);
  return { owner, finance, client, orgId, matterId, account };
}

async function asStepUp(f: Firm, userId: string = f.owner) {
  await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
}

async function issue(f: Firm, amount: number) {
  await asStepUp(f);
  return (await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation stage', $2, 'CAD', $3::date, $4) as id`, [f.matterId, amount, firmDay(3), `inv-${randomUUID()}`])).rows[0].id;
}

async function paidByCard(f: Firm, amount: number) {
  const invoiceId = await issue(f, amount);
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
  return { invoiceId, paymentId: payment.rows[0].id, intent };
}

/** A card-paid invoice holding `creditCents` beyond what it asks for (a credit note on it). */
async function withCredit(f: Firm, amount: number, creditCents: number) {
  const paid = await paidByCard(f, amount);
  await asMaintenance(db);
  await db.query(`update public.invoices set credited_cents = credited_cents + $2 where id = $1`, [paid.invoiceId, creditCents]);
  const creditId = (await db.query<{ id: string }>(`select id from public.client_credits where source_invoice_id = $1`, [paid.invoiceId])).rows[0].id;
  expect(await available(creditId)).toBe(creditCents);
  return { ...paid, creditId };
}

async function available(creditId: string) {
  await asMaintenance(db);
  return Number((await db.query<{ n: string }>(`select app.client_credit_available_cents($1) as n`, [creditId])).rows[0].n);
}

async function reserve(f: Firm, paymentId: string, amount: number, k: string) {
  await asStepUp(f);
  return (await db.query<{ id: string }>(`select public.reserve_invoice_refund($1, $2, 'cad', false, $3) as id`, [paymentId, amount, k])).rows[0].id;
}

function reserveCredit(creditId: string, paymentId: string, amount: number, k: string) {
  return db.query<{ id: string }>(`select public.reserve_client_credit_refund($1, $2, $3, 'cad', false, $4) as id`, [creditId, paymentId, amount, k]);
}

// The server links and releases a reservation for the staff member who made it (20261031018000).
async function link(f: Firm, reservationId: string, refund: string, userId: string = f.owner) {
  await asServiceRole(db);
  await db.query(`select public.service_link_invoice_refund_reservation($1, $2, $3)`, [reservationId, userId, refund]);
}

async function record(f: Firm, paymentId: string, refund: string, amount: number, k: string | null) {
  await asStepUp(f);
  return (await db.query<{ id: string }>(`select public.record_invoice_refund($1, $2, $3, 'cad', 'requested_by_customer', false, $4) as id`, [paymentId, refund, amount, k])).rows[0].id;
}

async function reservation(id: string) {
  await asMaintenance(db);
  return (
    await db.query<{ status: string; client_credit_id: string | null; expires_in_days: string }>(
      `select status, client_credit_id, extract(epoch from (expires_at - now())) / 86400 as expires_in_days from public.invoice_refund_reservations where id = $1`,
      [id],
    )
  ).rows[0];
}

async function reservable(paymentId: string) {
  await asMaintenance(db);
  return Number((await db.query<{ n: string }>(`select app.payment_reservable_cents($1, null) as n`, [paymentId])).rows[0].n);
}

const bankRefund = (creditId: string, amount: number) =>
  db.query(`select public.record_client_credit_bank_refund($1, $2, 'e_transfer', 'ET-SYN-1', $3::date, $4)`, [creditId, amount, firmDay(0), `cb-${randomUUID()}`]);

describe("client-credit paths count active refund reservations", () => {
  it("refuses a bank refund and an over-large credit move while a card refund is reserved", async () => {
    const f = await firm();
    const { paymentId, creditId } = await withCredit(f, 100_000, 5_000);
    const target = await issue(f, 20_000);
    const held = await reserve(f, paymentId, 3_000, key());
    expect(await available(creditId)).toBe(2_000);

    await asStepUp(f);
    await expectDbError(() => bankRefund(creditId, 1_000), /still pending at Stripe/);
    await expectDbError(() => db.query(`select public.apply_client_credit($1, $2, 2001, $3)`, [creditId, target, `cc-${randomUUID()}`]), /more than the credit available/);
    await db.query(`select public.apply_client_credit($1, $2, 2000, $3)`, [creditId, target, `cc-${randomUUID()}`]);

    // Once the hold is freed (Stripe refused), the bank refund path is open again.
    await asServiceRole(db);
    await db.query(`select public.service_release_invoice_refund_reservation($1, $2)`, [held, f.owner]);
    expect(await available(creditId)).toBe(3_000);
    await asStepUp(f);
    await bankRefund(creditId, 3_000);
    expect(await available(creditId)).toBe(0);
  });

  it("reserves a credit's card refund against the credit, under the credit's lock", async () => {
    const f = await firm();
    const { paymentId, creditId } = await withCredit(f, 100_000, 5_000);
    const other = await paidByCard(f, 10_000);
    const k1 = key();
    await asStepUp(f);
    const first = (await reserveCredit(creditId, paymentId, 3_000, k1)).rows[0].id;
    expect(await reservation(first)).toMatchObject({ status: "pending", client_credit_id: creditId });
    expect(await available(creditId)).toBe(2_000);

    // The payment could take far more; the credit cannot.
    await asStepUp(f);
    await expectDbError(() => reserveCredit(creditId, paymentId, 3_000, key()), /more than the credit available/);
    await expectDbError(() => reserveCredit(creditId, paymentId, 3_000, k1), /already in progress/);
    await expectDbError(() => reserveCredit(creditId, other.paymentId, 1_000, key()), /not on this credit's invoice/);
    const plainKey = key();
    await reserve(f, paymentId, 500, plainKey);
    await asStepUp(f);
    await expectDbError(() => reserveCredit(creditId, paymentId, 500, plainKey), /idempotency key/);
    // What is left on the credit can still be held.
    await asStepUp(f);
    await reserveCredit(creditId, paymentId, 1_500, key());
    expect(await available(creditId)).toBe(0);

    // Billing access and step-up are required.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => reserveCredit(creditId, paymentId, 1, key()), /billing access denied|permission denied/);
  });

  it("links to the credit only a refund reserved from it, or one the overpayment covers", async () => {
    const f = await firm();
    const { paymentId, creditId } = await withCredit(f, 100_000, 5_000);

    // The credit flow: reserve from the credit, Stripe answers, recorded, linked.
    const k = key();
    await asStepUp(f);
    const held = (await reserveCredit(creditId, paymentId, 3_000, k)).rows[0].id;
    const refund = refundId();
    await link(f, held, refund);
    const row = await record(f, paymentId, refund, 3_000, k);
    await asStepUp(f);
    await db.query(`select public.link_client_credit_refund($1, $2)`, [creditId, row]);
    expect(await available(creditId)).toBe(2_000);

    // A refund reserved without naming a credit (the previous app reserved credit refunds through
    // reserve_invoice_refund) links when the overpayment covers it, and the reservation takes the credit.
    const pk = key();
    const plain = await reserve(f, paymentId, 1_000, pk);
    const plainRefund = refundId();
    await link(f, plain, plainRefund);
    const plainRow = await record(f, paymentId, plainRefund, 1_000, pk);
    await asStepUp(f);
    await db.query(`select public.link_client_credit_refund($1, $2)`, [creditId, plainRow]);
    expect((await reservation(plain)).client_credit_id).toBe(creditId);
    expect(await available(creditId)).toBe(1_000);

    // One the overpayment cannot cover is refused and stays untied.
    const ok = key();
    const over = await reserve(f, paymentId, 2_000, ok);
    const overRefund = refundId();
    await link(f, over, overRefund);
    const overRow = await record(f, paymentId, overRefund, 2_000, ok);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.link_client_credit_refund($1, $2)`, [creditId, overRow]), /more than the credit available/);
    expect((await reservation(over)).client_credit_id).toBeNull();

    // A refund reserved from another credit is refused.
    const second = await withCredit(f, 10_000, 500);
    await asMaintenance(db);
    await db.query(`update public.invoice_refund_reservations set client_credit_id = $2 where id = $1`, [over, second.creditId]);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.link_client_credit_refund($1, $2)`, [creditId, overRow]), /not taken from this credit/);

    // A refund recorded without a reservation that the overpayment cannot cover is refused.
    const big = await record(f, paymentId, refundId(), 50_000, null);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.link_client_credit_refund($1, $2)`, [creditId, big]), /more than the credit available/);
    await asMaintenance(db);
    expect((await db.query(`select kind from public.client_credit_allocations where credit_id = $1`, [creditId])).rows).toEqual([
      { kind: "card_refund" },
      { kind: "card_refund" },
    ]);
  });
});

describe("linked reservations", () => {
  it("hold for 7 days after the link, then stop counting", async () => {
    const f = await firm();
    const { paymentId } = await paidByCard(f, 40_000);
    const held = await reserve(f, paymentId, 40_000, key());
    await link(f, held, refundId());
    const row = await reservation(held);
    expect(row.status).toBe("linked");
    expect(Number(row.expires_in_days)).toBeGreaterThan(6.9);
    expect(Number(row.expires_in_days)).toBeLessThanOrEqual(7);
    expect(await reservable(paymentId)).toBe(0);

    await asMaintenance(db);
    await db.query(`update public.invoice_refund_reservations set expires_at = now() - interval '1 minute' where id = $1`, [held]);
    expect(await reservable(paymentId)).toBe(40_000);
    await reserve(f, paymentId, 40_000, key());
  });

  it("is linked only by the staff member who reserved it, never after release, and one refund id per reservation", async () => {
    const f = await firm();
    const { paymentId } = await paidByCard(f, 40_000);
    const held = await reserve(f, paymentId, 10_000, key());
    // Another billing user of the matter cannot attach a refund id to it.
    await expectDbError(() => link(f, held, refundId(), f.finance), /billing access denied/);
    expect((await reservation(held)).status).toBe("pending");

    const refund = refundId();
    await link(f, held, refund);
    const second = await reserve(f, paymentId, 10_000, key());
    await expectDbError(() => link(f, second, refund), /another payment/);
    await expectDbError(() => link(f, second, "re_bad id"), /refund id is invalid/);

    await asServiceRole(db);
    await db.query(`select public.service_release_invoice_refund_reservation($1, $2)`, [second, f.owner]);
    await expectDbError(() => link(f, second, refundId()), /released/);
  });
});
