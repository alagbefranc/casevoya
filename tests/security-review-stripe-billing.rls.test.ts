import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * Security review (20261031013000): Casevoya billing events are tied to the stored subscription and
 * ordered by Stripe's `created`; Checkout activates only once paid; a paid invoice lifts past due
 * only for a real payment on the stored subscription. Connect payment events: a payment recovered
 * from metadata needs an open invoice and the balance due; `processing` after `failed` applies only
 * when newer. Synthetic Stripe ids only.
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

const eventId = () => `evt_Syn${token(20)}`;
const subId = () => `sub_Syn${token()}`;
const invoiceId = () => `in_Syn${token()}`;
const intentId = () => `pi_3Syn${token()}`;

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${id.slice(0, 8)}@example.test`]);
  return id;
}

async function createOrg(owner: string) {
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${token(12)}`]);
  return created.rows[0].id;
}

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

const T = 1_792_000_000;

async function billingFirm() {
  const owner = await createUser("owner");
  const orgId = await createOrg(owner);
  return { owner, orgId, customer: `cus_Syn${token()}`, sub: subId() };
}
type BillingFirm = Awaited<ReturnType<typeof billingFirm>>;

async function apply(event: Record<string, unknown>) {
  await asServiceRole(db);
  return (await db.query<{ r: Row }>(`select public.apply_stripe_subscription_event($1::jsonb) as r`, [JSON.stringify(event)])).rows[0].r;
}

function subscriptionEvent(f: BillingFirm, type: string, created: number, sub: Record<string, unknown> = {}) {
  return {
    id: eventId(),
    type,
    created,
    livemode: false,
    organization_id: f.orgId,
    customer: f.customer,
    subscription: { id: f.sub, status: "active", plan: "practice", interval: "month", extra_seats: 0, current_period_end: "2026-11-19T15:00:00Z", cancel_at: null, ...sub },
  };
}

function checkoutEvent(f: BillingFirm, type: string, created: number, paymentStatus: string, sub: string = f.sub) {
  return {
    id: eventId(),
    type,
    created,
    livemode: false,
    organization_id: f.orgId,
    customer: f.customer,
    subscription: { id: sub, status: "complete", plan: "solo", interval: "month", extra_seats: 0, payment_status: paymentStatus },
  };
}

function invoiceEvent(f: BillingFirm, type: "invoice.paid" | "invoice.payment_failed", created: number, inv: Record<string, unknown>) {
  const paid = type === "invoice.paid";
  return {
    id: eventId(),
    type,
    created,
    livemode: false,
    organization_id: f.orgId,
    customer: f.customer,
    invoice: {
      id: invoiceId(),
      subscription: f.sub,
      billing_reason: "subscription_cycle",
      number: "CV-0001",
      status: paid ? "paid" : "open",
      amount_due: 29900,
      amount_paid: paid ? 29900 : 0,
      amount_remaining: paid ? 0 : 29900,
      currency: "cad",
      period_start: "2026-10-19T15:00:00Z",
      period_end: "2026-11-19T15:00:00Z",
      created: "2026-10-19T15:00:00Z",
      ...inv,
    },
  };
}

async function subscription(orgId: string) {
  await asMaintenance(db);
  return (
    await db.query<Row>(
      `select status::text, plan::text, stripe_subscription_id, cancel_at, cancelled_at, past_due_since, restricted_at, last_stripe_event_created
         from public.organization_subscriptions where organization_id = $1`,
      [orgId],
    )
  ).rows[0];
}

async function setSubscription(orgId: string, sql: string, params: unknown[] = []) {
  await asMaintenance(db);
  await db.query(`update public.organization_subscriptions set ${sql} where organization_id = $1`, [orgId, ...params]);
}

describe("billing: invoice.paid restores access only for the overdue subscription (B-1)", () => {
  it("ignores a $0 invoice, a proration while the renewal is open, and another subscription's invoice", async () => {
    const f = await billingFirm();
    await apply(subscriptionEvent(f, "customer.subscription.created", T));
    const renewal = invoiceEvent(f, "invoice.payment_failed", T + 10, {});
    expect(await apply(renewal)).toMatchObject({ outcome: "applied", status: "past_due" });
    const since = (await subscription(f.orgId)).past_due_since;
    expect(since).not.toBeNull();

    // A $0 invoice on the same subscription.
    expect(await apply(invoiceEvent(f, "invoice.paid", T + 20, { amount_due: 0, amount_paid: 0, billing_reason: "subscription_update" }))).toMatchObject({ status: "past_due" });
    // A small paid proration while the renewal is still open.
    expect(await apply(invoiceEvent(f, "invoice.paid", T + 30, { amount_due: 500, amount_paid: 500, billing_reason: "subscription_update" }))).toMatchObject({ status: "past_due" });
    // Another subscription's invoice, and a one-off invoice with no subscription.
    expect(await apply(invoiceEvent(f, "invoice.paid", T + 40, { subscription: subId() }))).toMatchObject({ status: "past_due" });
    expect(await apply(invoiceEvent(f, "invoice.paid", T + 50, { subscription: null }))).toMatchObject({ status: "past_due" });
    // The grace clock was not restarted.
    expect((await subscription(f.orgId)).past_due_since).toEqual(since);

    // The renewal itself is paid: active again.
    const paid = { ...invoiceEvent(f, "invoice.paid", T + 60, {}), invoice: { ...renewal.invoice, status: "paid", amount_paid: 29900, amount_remaining: 0 } };
    expect(await apply(paid)).toEqual({ outcome: "applied", status: "active" });
    expect(await subscription(f.orgId)).toMatchObject({ status: "active", past_due_since: null, restricted_at: null });
  });
});

describe("billing: Checkout activates only once paid (B-2)", () => {
  it("keeps an unpaid Checkout and an incomplete subscription without the plan; async success activates", async () => {
    const f = await billingFirm();
    expect(await apply(checkoutEvent(f, "checkout.session.completed", T, "unpaid"))).toEqual({ outcome: "applied", status: "trial" });
    expect(await subscription(f.orgId)).toMatchObject({ status: "trial", plan: null, stripe_subscription_id: f.sub });
    expect(await apply(subscriptionEvent(f, "customer.subscription.created", T, { status: "incomplete" }))).toEqual({ outcome: "applied", status: "trial" });
    expect((await subscription(f.orgId)).plan).toBeNull();
    expect(await apply(checkoutEvent(f, "checkout.session.async_payment_failed", T + 5, "unpaid"))).toEqual({ outcome: "applied", status: "trial" });

    expect(await apply(checkoutEvent(f, "checkout.session.async_payment_succeeded", T + 10, "paid"))).toEqual({ outcome: "applied", status: "active" });
    expect(await subscription(f.orgId)).toMatchObject({ status: "active", plan: "solo", stripe_subscription_id: f.sub });
  });

  it("marks an active firm past due when the async payment fails, and ends one whose first payment expired", async () => {
    const f = await billingFirm();
    await setSubscription(f.orgId, `status = 'active', plan = 'practice', stripe_subscription_id = $2`, [f.sub]);
    expect(await apply(checkoutEvent(f, "checkout.session.async_payment_failed", T, "unpaid"))).toEqual({ outcome: "applied", status: "past_due" });
    // Another subscription's failure changes nothing.
    expect(await apply(checkoutEvent(f, "checkout.session.async_payment_failed", T + 1, "unpaid", subId()))).toMatchObject({ outcome: "ignored", reason: "other_subscription" });

    const g = await billingFirm();
    await setSubscription(g.orgId, `status = 'active', plan = 'practice', stripe_subscription_id = $2`, [g.sub]);
    expect(await apply(subscriptionEvent(g, "customer.subscription.updated", T, { status: "incomplete_expired" }))).toEqual({ outcome: "applied", status: "cancelled" });
    expect((await subscription(g.orgId)).cancelled_at).not.toBeNull();
    // That subscription has ended: a later event for it changes nothing.
    expect(await apply(subscriptionEvent(g, "customer.subscription.updated", T + 10, { status: "active" }))).toMatchObject({ outcome: "ignored", reason: "subscription_ended" });
  });
});

describe("billing: events are bound to the stored subscription and ordered (B-3)", () => {
  it("ignores stale and foreign events; deleted is final; a paid Checkout for a new subscription takes over", async () => {
    const f = await billingFirm();
    await apply(subscriptionEvent(f, "customer.subscription.created", T));
    expect(await apply(subscriptionEvent(f, "customer.subscription.updated", T + 30, { cancel_at: "2026-11-19T15:00:00Z" }))).toMatchObject({ outcome: "applied" });
    const scheduled = (await subscription(f.orgId)).cancel_at;
    expect(scheduled).not.toBeNull();
    expect(Number((await subscription(f.orgId)).last_stripe_event_created)).toBe(T + 30);

    // A delayed retry of an older update does not clear the scheduled cancellation.
    expect(await apply(subscriptionEvent(f, "customer.subscription.updated", T + 20, { cancel_at: null }))).toEqual({ outcome: "ignored", status: "active", reason: "stale_event" });
    expect((await subscription(f.orgId)).cancel_at).toEqual(scheduled);

    // Another subscription of the same customer does not overwrite the stored one.
    const other = subId();
    expect(await apply({ ...subscriptionEvent(f, "customer.subscription.updated", T + 40, { plan: "firm" }), subscription: { id: other, status: "active", plan: "firm", interval: "year" } })).toMatchObject({
      outcome: "ignored",
      reason: "other_subscription",
    });
    expect(await subscription(f.orgId)).toMatchObject({ stripe_subscription_id: f.sub, plan: "practice" });

    // Deleted, then a late active update for it (older, and newer): the firm stays cancelled.
    expect(await apply(subscriptionEvent(f, "customer.subscription.deleted", T + 50, { status: "canceled", canceled_at: "2026-11-19T15:00:00Z" }))).toEqual({ outcome: "applied", status: "cancelled" });
    expect(await apply(subscriptionEvent(f, "customer.subscription.updated", T + 45))).toMatchObject({ outcome: "ignored", reason: "stale_event" });
    expect(await apply(subscriptionEvent(f, "customer.subscription.updated", T + 60))).toMatchObject({ outcome: "ignored", reason: "subscription_ended" });
    expect(await apply(checkoutEvent(f, "checkout.session.completed", T + 61, "paid"))).toMatchObject({ outcome: "ignored", reason: "subscription_ended" });
    expect((await subscription(f.orgId)).status).toBe("cancelled");

    // The owner subscribes again: a paid Checkout naming the new subscription activates it.
    const next = subId();
    expect(await apply(checkoutEvent(f, "checkout.session.completed", T + 100, "paid", next))).toEqual({ outcome: "applied", status: "active" });
    expect(await subscription(f.orgId)).toMatchObject({ status: "active", stripe_subscription_id: next, cancelled_at: null });
    // The old subscription's events no longer apply.
    expect(await apply(subscriptionEvent(f, "customer.subscription.updated", T + 110, { status: "past_due" }))).toMatchObject({ outcome: "ignored" });
    expect((await subscription(f.orgId)).status).toBe("active");
  });

  it("lets a new subscription's events apply once the stored one has ended", async () => {
    const f = await billingFirm();
    await apply(subscriptionEvent(f, "customer.subscription.created", T));
    await apply(subscriptionEvent(f, "customer.subscription.deleted", T + 10, { status: "canceled" }));
    const next = subId();
    expect(await apply({ ...subscriptionEvent(f, "customer.subscription.created", T + 20), subscription: { id: next, status: "active", plan: "firm", interval: "month", extra_seats: 0 } })).toEqual({
      outcome: "applied",
      status: "active",
    });
    expect(await subscription(f.orgId)).toMatchObject({ stripe_subscription_id: next, plan: "firm" });
  });
});

// ---------------------------------------------------------------------------
// Connect payments
// ---------------------------------------------------------------------------

async function paymentFirm() {
  const account = `acct_1Syn${token()}`;
  const owner = await createUser("owner");
  const client = await createUser("client");
  const orgId = await createOrg(owner);
  await asMaintenance(db);
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, 'client'::public.org_role, 'active', now(), $3)`,
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
type PaymentFirm = Awaited<ReturnType<typeof paymentFirm>>;

async function issue(f: PaymentFirm, amount: number) {
  await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
  return (await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation stage', $2, 'CAD', $3::date, $4) as id`, [f.matterId, amount, firmDay(3), `inv-${randomUUID()}`])).rows[0].id;
}

async function paymentEvent(f: PaymentFirm, args: { id?: string; type: string; intent: string; amount: number; received?: number; invoice?: string | null; created?: number | null }) {
  await asServiceRole(db);
  const payload = args.created == null ? {} : { created: args.created };
  return (
    await db.query<{ r: Row }>(`select public.apply_stripe_payment_event($1, $2, $3, $4, $5, $6, 'cad', false, $7, $8::jsonb) as r`, [
      args.id ?? eventId(),
      f.account,
      args.type,
      args.intent,
      args.amount,
      args.received ?? 0,
      args.invoice ?? null,
      JSON.stringify(payload),
    ])
  ).rows[0].r;
}

async function invoiceState(id: string) {
  await asMaintenance(db);
  return (await db.query<{ status: string; paid_cents: string }>(`select status::text, paid_cents::text from public.invoices where id = $1`, [id])).rows[0];
}

async function unmatchedTasks(orgId: string) {
  await asMaintenance(db);
  return Number((await db.query<{ n: string }>(`select count(*) as n from public.tasks where organization_id = $1 and task_key = 'payment_unmatched'`, [orgId])).rows[0].n);
}

describe("payments: recovery from metadata applies the invoice checks (P-1)", () => {
  it("refuses a recovered payment for the wrong amount or a paid invoice, once, and recovers a matching one", async () => {
    const f = await paymentFirm();
    const invoice = await issue(f, 50_000);

    // Wrong amount: nothing booked, the event kept as failed, one task for the owner.
    const wrong = { id: eventId(), type: "payment_intent.succeeded", intent: intentId(), amount: 10_000, received: 10_000, invoice };
    expect(await paymentEvent(f, wrong)).toEqual({ outcome: "rejected", reason: "invoice_not_payable" });
    expect(await paymentEvent(f, wrong)).toEqual({ outcome: "rejected", reason: "invoice_not_payable" });
    expect(await invoiceState(invoice)).toMatchObject({ status: "issued", paid_cents: "0" });
    expect(await unmatchedTasks(f.orgId)).toBe(1);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.invoice_payments where payment_intent_id = $1`, [wrong.intent])).rows).toHaveLength(0);

    // The balance due: recovered and applied.
    const intent = intentId();
    expect(await paymentEvent(f, { type: "payment_intent.succeeded", intent, amount: 50_000, received: 50_000, invoice })).toMatchObject({ outcome: "applied", payment_status: "succeeded", invoice_status: "paid" });

    // The invoice is paid now: another recovered payment for it is refused.
    expect(await paymentEvent(f, { type: "payment_intent.succeeded", intent: intentId(), amount: 50_000, received: 50_000, invoice })).toEqual({ outcome: "rejected", reason: "invoice_not_payable" });
    expect(await invoiceState(invoice)).toMatchObject({ status: "paid", paid_cents: "50000" });
    expect(await unmatchedTasks(f.orgId)).toBe(2);
  });
});

describe("payments: event order (P-2)", () => {
  it("does not move a failed payment back to processing unless the event is newer", async () => {
    const f = await paymentFirm();
    const invoice = await issue(f, 30_000);
    const intent = intentId();
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await db.query(`select public.record_invoice_payment_intent($1, $2, $3, 30000, 'cad', 0, false)`, [invoice, intent, f.account]);

    expect(await paymentEvent(f, { type: "payment_intent.payment_failed", intent, amount: 30_000, created: T + 20 })).toMatchObject({ outcome: "applied", payment_status: "failed" });
    expect(await paymentEvent(f, { type: "payment_intent.processing", intent, amount: 30_000, created: T + 10 })).toMatchObject({ outcome: "unchanged", payment_status: "failed" });
    expect(await paymentEvent(f, { type: "payment_intent.processing", intent, amount: 30_000, created: T + 20 })).toMatchObject({ outcome: "unchanged", payment_status: "failed" });
    expect(await paymentEvent(f, { type: "payment_intent.processing", intent, amount: 30_000, created: null })).toMatchObject({ outcome: "unchanged", payment_status: "failed" });
    // A new attempt on the same PaymentIntent: newer, so it applies.
    expect(await paymentEvent(f, { type: "payment_intent.processing", intent, amount: 30_000, created: T + 30 })).toMatchObject({ outcome: "applied", payment_status: "processing" });
    // The older failure arriving again does not undo it.
    expect(await paymentEvent(f, { type: "payment_intent.payment_failed", intent, amount: 30_000, created: T + 25 })).toMatchObject({ outcome: "unchanged", payment_status: "processing" });
    // Success always applies.
    expect(await paymentEvent(f, { type: "payment_intent.succeeded", intent, amount: 30_000, received: 30_000, created: T + 5 })).toMatchObject({ outcome: "applied", payment_status: "succeeded", invoice_status: "paid" });
  });
});
