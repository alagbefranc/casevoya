import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * A card refund reserves its amount (app.reserve_invoice_refund) before Stripe is called: the
 * payment is locked and the refundable cap less the other active reservations is checked, so two
 * refunds at once cannot both pass it. Released or expired reservations free the amount; a recorded
 * refund (server or Stripe's event) consumes its reservation, so it is counted once.
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
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true)`, [matterId, orgId]);
  const person = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`, [orgId, client]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, person.rows[0].id]);
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.record_firm_payment_account($1, $2, false)`, [orgId, account]);
  return { owner, client, orgId, matterId, account };
}

async function asStepUp(f: Firm) {
  await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
}

/** An issued invoice of `amount` paid in full by card (Stripe's event applied). */
async function paidByCard(f: Firm, amount: number) {
  await asStepUp(f);
  const created = await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation stage', $2, 'CAD', $3::date, $4) as id`, [f.matterId, amount, firmDay(3), `inv-${randomUUID()}`]);
  const invoiceId = created.rows[0].id;
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

async function reserve(f: Firm, paymentId: string, amount: number, idempotencyKey: string) {
  await asStepUp(f);
  return (await db.query<{ id: string }>(`select public.reserve_invoice_refund($1, $2, 'cad', false, $3) as id`, [paymentId, amount, idempotencyKey])).rows[0].id;
}

async function release(f: Firm, reservationId: string) {
  await asStepUp(f);
  await db.query(`select public.release_invoice_refund_reservation($1)`, [reservationId]);
}

async function link(f: Firm, reservationId: string, refund: string) {
  await asStepUp(f);
  await db.query(`select public.link_invoice_refund_reservation($1, $2)`, [reservationId, refund]);
}

async function record(f: Firm, paymentId: string, refund: string, amount: number, idempotencyKey: string | null) {
  await asStepUp(f);
  return (await db.query<{ id: string }>(`select public.record_invoice_refund($1, $2, $3, 'cad', 'requested_by_customer', false, $4) as id`, [paymentId, refund, amount, idempotencyKey])).rows[0].id;
}

async function refundEvent(f: Firm, intent: string, refund: string, amount: number, status: string) {
  await asServiceRole(db);
  const result = await db.query<{ r: { outcome: string; detail: string | null; refund_status: string; invoice_status: string } }>(
    `select public.apply_stripe_reversal_event($1, $2, $3, $4, $5, null, $6, 'cad', $7, null, null, null, null, null, false, '{}'::jsonb) as r`,
    [eventId(), f.account, status === "succeeded" ? "refund.updated" : "refund.created", refund, intent, amount, status],
  );
  return result.rows[0].r;
}

async function reservation(id: string) {
  await asMaintenance(db);
  return (await db.query<{ status: string; refund_id: string | null; invoice_refund_id: string | null }>(`select status, refund_id, invoice_refund_id from public.invoice_refund_reservations where id = $1`, [id])).rows[0];
}

async function reservable(paymentId: string) {
  await asMaintenance(db);
  return Number((await db.query<{ n: string }>(`select app.payment_reservable_cents($1, null) as n`, [paymentId])).rows[0].n);
}

async function refundRows(paymentId: string) {
  await asMaintenance(db);
  return (await db.query<{ id: string; amount_cents: string }>(`select id, amount_cents from public.invoice_refunds where payment_id = $1`, [paymentId])).rows;
}

describe("card refund reservations", () => {
  it("refuses a second reservation that would pass the cap, and a direct record while the amount is held", async () => {
    const f = await firm();
    const { paymentId } = await paidByCard(f, 40_000);
    const first = await reserve(f, paymentId, 30_000, key());
    expect((await reservation(first)).status).toBe("pending");
    expect(await reservable(paymentId)).toBe(10_000);

    await asStepUp(f);
    await expectDbError(() => db.query(`select public.reserve_invoice_refund($1, 20000, 'cad', false, $2)`, [paymentId, key()]), /exceeds the amount received/);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 20000, 'cad', null, false, $3)`, [paymentId, refundId(), key()]), /exceeds the amount received/);
    // What is left can still be held.
    await reserve(f, paymentId, 10_000, key());
    expect(await reservable(paymentId)).toBe(0);
  });

  it("refuses the same key while its reservation is pending, and another payment's key", async () => {
    const f = await firm();
    const { paymentId } = await paidByCard(f, 40_000);
    const other = await paidByCard(f, 10_000);
    const k = key();
    await reserve(f, paymentId, 5_000, k);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.reserve_invoice_refund($1, 5000, 'cad', false, $2)`, [paymentId, k]), /already in progress/);
    await expectDbError(() => db.query(`select public.reserve_invoice_refund($1, 5000, 'cad', false, $2)`, [other.paymentId, k]), /idempotency key/);
  });

  it("frees the amount when released or expired", async () => {
    const f = await firm();
    const { paymentId } = await paidByCard(f, 40_000);
    const first = await reserve(f, paymentId, 40_000, key());
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.reserve_invoice_refund($1, 1, 'cad', false, $2)`, [paymentId, key()]), /exceeds the amount received/);

    await release(f, first);
    expect((await reservation(first)).status).toBe("released");
    expect(await reservable(paymentId)).toBe(40_000);
    const second = await reserve(f, paymentId, 40_000, key());

    // A crashed request: the pending hold expires after 15 minutes.
    await asMaintenance(db);
    await db.query(`update public.invoice_refund_reservations set expires_at = now() - interval '1 minute' where id = $1`, [second]);
    expect(await reservable(paymentId)).toBe(40_000);
    await reserve(f, paymentId, 40_000, key());
  });

  it("does not release a reservation already linked to a Stripe refund", async () => {
    const f = await firm();
    const { paymentId } = await paidByCard(f, 40_000);
    const held = await reserve(f, paymentId, 40_000, key());
    const refund = refundId();
    await link(f, held, refund);
    await release(f, held);
    expect(await reservation(held)).toMatchObject({ status: "linked", refund_id: refund });
    // A linked hold does not expire: Stripe made that refund.
    await asMaintenance(db);
    await db.query(`update public.invoice_refund_reservations set expires_at = now() - interval '1 hour' where id = $1`, [held]);
    expect(await reservable(paymentId)).toBe(0);
  });

  it("is consumed when the server records the refund, counted once", async () => {
    const f = await firm();
    const { paymentId, intent, invoiceId } = await paidByCard(f, 40_000);
    const k = key();
    const held = await reserve(f, paymentId, 40_000, k);
    const refund = refundId();
    await link(f, held, refund);
    const id = await record(f, paymentId, refund, 40_000, k);
    expect(await reservation(held)).toMatchObject({ status: "consumed", refund_id: refund, invoice_refund_id: id });
    expect(await reservable(paymentId)).toBe(0);

    // A retry of the same key gets the same refund back.
    expect(await reserve(f, paymentId, 40_000, k)).toBe(held);
    expect(await record(f, paymentId, refund, 40_000, k)).toBe(id);
    expect(await refundRows(paymentId)).toHaveLength(1);

    expect(await refundEvent(f, intent, refund, 40_000, "succeeded")).toMatchObject({ outcome: "applied", refund_status: "succeeded", invoice_status: "refunded" });
    await asMaintenance(db);
    expect(Number((await db.query<{ n: string }>(`select refunded_cents as n from public.invoices where id = $1`, [invoiceId])).rows[0].n)).toBe(40_000);
  });

  it("is consumed when the server records it without the link step (matched by key)", async () => {
    const f = await firm();
    const { paymentId } = await paidByCard(f, 40_000);
    const k = key();
    const held = await reserve(f, paymentId, 25_000, k);
    const id = await record(f, paymentId, refundId(), 25_000, k);
    expect(await reservation(held)).toMatchObject({ status: "consumed", invoice_refund_id: id });
    expect(await reservable(paymentId)).toBe(15_000);
    // A key's hold is for one amount.
    const other = key();
    await reserve(f, paymentId, 5_000, other);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 6000, 'cad', null, false, $3)`, [paymentId, refundId(), other]), /idempotency key/);
  });

  it("is consumed by Stripe's event, without double counting, whether it arrives after or before the link", async () => {
    const f = await firm();
    const { paymentId, intent } = await paidByCard(f, 40_000);

    // Linked first, then Stripe's event records the refund.
    const k1 = key();
    const first = await reserve(f, paymentId, 30_000, k1);
    const refund1 = refundId();
    await link(f, first, refund1);
    expect(await refundEvent(f, intent, refund1, 30_000, "pending")).toMatchObject({ outcome: "applied", refund_status: "pending" });
    const rows = await refundRows(paymentId);
    expect(rows).toHaveLength(1);
    expect(await reservation(first)).toMatchObject({ status: "consumed", invoice_refund_id: rows[0].id });
    expect(await reservable(paymentId)).toBe(10_000);
    // The server's record afterwards returns the same row.
    expect(await record(f, paymentId, refund1, 30_000, k1)).toBe(rows[0].id);
    expect(await reservable(paymentId)).toBe(10_000);

    // Stripe's event first, then the link.
    const second = await reserve(f, paymentId, 10_000, key());
    const refund2 = refundId();
    expect(await refundEvent(f, intent, refund2, 10_000, "pending")).toMatchObject({ outcome: "applied" });
    await link(f, second, refund2);
    expect((await reservation(second)).status).toBe("consumed");
    expect(await reservable(paymentId)).toBe(0);
    expect(await refundRows(paymentId)).toHaveLength(2);
  });

  it("needs billing access and a recent step-up; the table is not readable directly", async () => {
    const f = await firm();
    const { paymentId } = await paidByCard(f, 40_000);
    const held = await reserve(f, paymentId, 1_000, key());

    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 3_600 });
    await expectDbError(() => db.query(`select public.reserve_invoice_refund($1, 1000, 'cad', false, $2)`, [paymentId, key()]), /step-up is required/);
    await expectDbError(() => db.query(`select public.release_invoice_refund_reservation($1)`, [held]), /step-up is required/);

    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.reserve_invoice_refund($1, 1000, 'cad', false, $2)`, [paymentId, key()]), /billing access denied|permission denied/);
    await expectDbError(() => db.query(`select public.release_invoice_refund_reservation($1)`, [held]), /billing access denied|permission denied/);
    await expectDbError(() => db.query(`select public.link_invoice_refund_reservation($1, $2)`, [held, refundId()]), /billing access denied|permission denied/);
    await expectDbError(() => db.query(`select id from public.invoice_refund_reservations`), /permission denied/);
    expect((await reservation(held)).status).toBe("pending");
  });
});
