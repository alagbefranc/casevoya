import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Billing hardening (20261102100000): a card trial that ends before it converts pauses new work;
 * a second paid subscription is not stored and is answered with a cancel instruction; the Stripe
 * customer is recorded by the server only; subscription events have their own ordering, and a
 * trial Checkout records the trial claims. Synthetic firms and test-mode Stripe ids only.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const T = 1_792_500_000;

beforeAll(async () => {
  db = await createTestDb({ cardRequired: true, supabaseDefaultPrivileges: true });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

type Row = Record<string, unknown>;
const token = (length = 14) => randomUUID().replaceAll("-", "").slice(0, length);
const email = (label: string) => `${label}-${token(8)}@example.test`;
const eventId = () => `evt_Syn${token(20)}`;
const subId = () => `sub_Syn${token()}`;

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, email(label)]);
  return id;
}

async function as(userId: string, orgId: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
}

/** A firm with an owner (licence on file) and a verified licensed consultant; sample mode off. */
async function firm(licence = `R${token(6).toUpperCase()}`) {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization('Synthetic Legal Name', 'Synthetic Firm', $1)).id as id`, [`f${token(12)}`])).rows[0].id;
  await asMaintenance(db);
  const consultantMembership = (
    await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
      [orgId, consultant, owner],
    )
  ).rows[0].id;
  await as(consultant, orgId);
  const credential = await db.query<{ id: string }>(`select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`, [
    consultantMembership,
    `R${token(6).toUpperCase()}`,
    PROOF,
  ]);
  await as(owner, orgId);
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  const ownerMembership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner])).rows[0].id;
  await as(owner, orgId);
  await db.query(`select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3)`, [ownerMembership, licence, PROOF]);
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  return { owner, consultant, consultantMembership, orgId, customer: `cus_Syn${token()}`, sub: subId() };
}
type Firm = Awaited<ReturnType<typeof firm>>;

async function apply(event: Record<string, unknown>) {
  await asServiceRole(db);
  return (await db.query<{ r: Row }>(`select public.apply_stripe_subscription_event($1::jsonb) as r`, [JSON.stringify(event)])).rows[0].r;
}

function subscriptionEvent(f: Firm, type: string, created: number, sub: Record<string, unknown> = {}) {
  return {
    id: eventId(),
    type,
    created,
    livemode: false,
    organization_id: f.orgId,
    customer: f.customer,
    subscription: {
      id: f.sub,
      status: "trialing",
      plan: "practice",
      interval: "month",
      extra_seats: 0,
      current_period_end: "2026-11-16T15:00:00Z",
      trial_start: "2026-11-02T15:00:00Z",
      trial_end: "2026-11-16T15:00:00Z",
      cancel_at_period_end: false,
      ...sub,
    },
  };
}

function checkoutEvent(f: Firm, created: number, sub: Record<string, unknown> = {}) {
  return {
    id: eventId(),
    type: "checkout.session.completed",
    created,
    livemode: false,
    organization_id: f.orgId,
    customer: f.customer,
    subscription: { id: f.sub, status: "complete", plan: "practice", interval: "month", extra_seats: 0, payment_status: "no_payment_required", trial: true, ...sub },
  };
}

async function row(orgId: string) {
  await asMaintenance(db);
  return (
    await db.query<Row>(
      `select status::text, plan::text, card_required, stripe_subscription_id, trial_ends_at, cancel_at_period_end from public.organization_subscriptions where organization_id = $1`,
      [orgId],
    )
  ).rows[0];
}

async function entitlements(orgId: string) {
  await asMaintenance(db);
  return (await db.query<{ e: Row }>(`select app.subscription_entitlements($1) as e`, [orgId])).rows[0].e;
}

async function claims(orgId: string) {
  await asMaintenance(db);
  return (await db.query<{ kind: string }>(`select kind from public.subscription_trial_claims where organization_id = $1 order by kind`, [orgId])).rows.map((r) => r.kind);
}

async function realMatter(f: Firm, sample = false) {
  await as(f.consultant, f.orgId);
  return (await db.query<{ r: { ok: boolean } }>(`select public.create_engaged_matter($1, $2, $3, null, null) as r`, [`Matter ${token(6)}`, sample, f.consultantMembership])).rows[0].r;
}

describe("a card trial that ends before it converts (#305)", () => {
  it("pauses real matters and staff invitations until the firm checks out; sample work continues", async () => {
    const f = await firm();
    expect(await apply(subscriptionEvent(f, "customer.subscription.created", T))).toMatchObject({ outcome: "applied", status: "trial" });
    expect((await realMatter(f)).ok).toBe(true);

    expect(await apply(subscriptionEvent(f, "customer.subscription.deleted", T + 10, { status: "canceled" }))).toMatchObject({ outcome: "applied", status: "trial_ended" });
    expect(await row(f.orgId)).toMatchObject({ status: "trial_ended", card_required: true });
    expect(await entitlements(f.orgId)).toMatchObject({ status: "trial_ended", new_work_blocked: true, checkout_required: true });

    await expectDbError(() => realMatter(f), /subscription paused/);
    expect((await realMatter(f, true)).ok).toBe(true);
    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(`select public.create_staff_invitation($1, $2, 'assistant'::public.org_role)`, [f.orgId, email("staff")]), /subscription paused/);
    await asMaintenance(db);
    expect((await db.query<{ b: string[] }>(`select app.real_client_invite_blockers($1) as b`, [f.orgId])).rows[0].b).toContain("trial_ended");

    // Checkout again (no second trial), paid: work opens.
    await as(f.owner, f.orgId);
    const allowed = (await db.query<{ r: Row }>(`select public.subscription_checkout_allowed($1, 'practice'::public.subscription_plan, 'month'::public.billing_interval, 0) as r`, [f.orgId])).rows[0].r;
    expect(allowed).toMatchObject({ ok: true, trial_days: 0, trial_reason: "firm_used" });
    const next = subId();
    expect(await apply(checkoutEvent(f, T + 20, { id: next, payment_status: "paid", trial: false }))).toEqual({ outcome: "applied", status: "active" });
    expect(await entitlements(f.orgId)).toMatchObject({ status: "active", new_work_blocked: false });
    expect((await realMatter(f)).ok).toBe(true);
  });
});

describe("a second paid subscription (#306)", () => {
  it("keeps the stored live subscription and answers a cancel instruction, repeated on retry until Stripe ends it", async () => {
    const f = await firm();
    await apply(subscriptionEvent(f, "customer.subscription.created", T, { status: "active" }));
    expect(await row(f.orgId)).toMatchObject({ status: "active", stripe_subscription_id: f.sub, plan: "practice" });

    const extra = subId();
    const duplicate = checkoutEvent(f, T + 10, { id: extra, plan: "firm", payment_status: "paid", trial: false });
    expect(await apply(duplicate)).toEqual({ outcome: "ignored", status: "active", reason: "duplicate_subscription", cancel_subscription: extra });
    expect(await row(f.orgId)).toMatchObject({ status: "active", stripe_subscription_id: f.sub, plan: "practice" });
    // A retried delivery repeats the instruction.
    expect(await apply(duplicate)).toEqual({ outcome: "duplicate", cancel_subscription: extra });
    // Stripe reports the extra subscription deleted: it changes nothing, and the retry stops asking.
    expect(await apply({ ...subscriptionEvent(f, "customer.subscription.deleted", T + 20, { status: "canceled" }), subscription: { id: extra, status: "canceled", plan: "firm", interval: "month" } })).toMatchObject({
      outcome: "ignored",
    });
    expect(await apply(duplicate)).toEqual({ outcome: "duplicate" });
    expect(await row(f.orgId)).toMatchObject({ status: "active", stripe_subscription_id: f.sub, plan: "practice" });
  });

  it("answers the cancel instruction when the extra Checkout arrives after a newer event on the kept subscription", async () => {
    const f = await firm();
    await apply(subscriptionEvent(f, "customer.subscription.created", T, { status: "active" }));
    const invoice = {
      id: eventId(),
      type: "invoice.payment_failed",
      created: T + 30,
      livemode: false,
      organization_id: f.orgId,
      customer: f.customer,
      invoice: { id: `in_Syn${token()}`, subscription: f.sub, status: "open", amount_due: 4900, amount_paid: 0, currency: "cad" },
    };
    expect(await apply(invoice)).toMatchObject({ outcome: "applied", status: "past_due" });

    const extra = subId();
    expect(await apply(checkoutEvent(f, T + 10, { id: extra, plan: "firm", payment_status: "paid", trial: false }))).toEqual({
      outcome: "ignored",
      status: "past_due",
      reason: "duplicate_subscription",
      cancel_subscription: extra,
    });
    expect(await row(f.orgId)).toMatchObject({ status: "past_due", stripe_subscription_id: f.sub, plan: "practice" });
    // An older paid Checkout for the kept subscription is still stale.
    expect(await apply(checkoutEvent(f, T + 20, { payment_status: "paid", trial: false }))).toEqual({ outcome: "ignored", status: "past_due", reason: "stale_event" });
  });

  it("still applies a paid Checkout for the stored subscription, or for any subscription when none is stored", async () => {
    const f = await firm();
    expect(await apply(checkoutEvent(f, T, { payment_status: "paid", trial: false }))).toEqual({ outcome: "applied", status: "active" });
    expect(await apply(checkoutEvent(f, T + 1, { payment_status: "paid", trial: false }))).toEqual({ outcome: "applied", status: "active" });
    expect((await row(f.orgId)).stripe_subscription_id).toBe(f.sub);
  });
});

describe("the Stripe customer is recorded by the server only (#304)", () => {
  it("refuses signed-in calls, a non-owner actor, and a customer another firm holds", async () => {
    const a = await firm();
    const b = await firm();
    await as(a.owner, a.orgId);
    await expectDbError(() => db.query(`select public.record_subscription_customer($1, $2)`, [a.orgId, a.customer]), /permission denied/);
    await expectDbError(() => db.query(`select public.replace_subscription_customer($1, $2, $3)`, [a.orgId, a.customer, b.customer]), /permission denied/);
    await expectDbError(() => db.query(`select public.service_record_subscription_customer($1, $2, $3)`, [a.orgId, a.customer, a.owner]), /permission denied/);

    await asServiceRole(db);
    await db.query(`select public.service_record_subscription_customer($1, $2, $3)`, [a.orgId, a.customer, a.owner]);
    await expectDbError(() => db.query(`select public.service_record_subscription_customer($1, $2, $3)`, [b.orgId, b.customer, a.owner]), /step-up is required/);
    await expectDbError(() => db.query(`select public.service_record_subscription_customer($1, $2, $3)`, [b.orgId, b.customer, b.consultant]), /step-up is required/);
    await expectDbError(() => db.query(`select public.service_record_subscription_customer($1, $2, $3)`, [b.orgId, a.customer, b.owner]), /belongs to another firm/);

    await db.query(`select public.service_record_subscription_customer($1, $2, $3)`, [b.orgId, b.customer, b.owner]);
    const fresh = `cus_Syn${token()}`;
    await expectDbError(() => db.query(`select public.service_replace_subscription_customer($1, $2, $3, $4)`, [b.orgId, b.customer, a.customer, b.owner]), /belongs to another firm/);
    await db.query(`select public.service_replace_subscription_customer($1, $2, $3, $4)`, [b.orgId, b.customer, fresh, b.owner]);
    await asMaintenance(db);
    const stored = await db.query<{ organization_id: string; stripe_customer_id: string }>(
      `select organization_id, stripe_customer_id from public.organization_subscriptions where organization_id = any($1::uuid[])`,
      [[a.orgId, b.orgId]],
    );
    expect(Object.fromEntries(stored.rows.map((r) => [r.organization_id, r.stripe_customer_id]))).toEqual({ [a.orgId]: a.customer, [b.orgId]: fresh });
  });
});

describe("subscription events have their own ordering; a trial Checkout records claims (#307)", () => {
  it("applies customer.subscription.created after a newer Checkout, with Stripe's trial dates", async () => {
    const f = await firm();
    const card = token(32) + token(32);
    expect(await apply(checkoutEvent(f, T + 50, { card_hash: card }))).toEqual({ outcome: "applied", status: "trial" });
    expect(await claims(f.orgId)).toEqual(["card", "licence"]);
    expect((await row(f.orgId)).trial_ends_at).toBeNull();

    expect(await apply(subscriptionEvent(f, "customer.subscription.created", T + 10))).toEqual({ outcome: "applied", status: "trial" });
    expect(new Date((await row(f.orgId)).trial_ends_at as string).toISOString()).toBe("2026-11-16T15:00:00.000Z");
    expect(await apply(subscriptionEvent(f, "customer.subscription.updated", T + 30, { cancel_at_period_end: true }))).toMatchObject({ outcome: "applied" });
    expect((await row(f.orgId)).cancel_at_period_end).toBe(true);
    // Subscription events stay ordered among themselves.
    expect(await apply(subscriptionEvent(f, "customer.subscription.updated", T + 20, { cancel_at_period_end: false }))).toMatchObject({ outcome: "ignored", reason: "stale_event" });
    expect((await row(f.orgId)).cancel_at_period_end).toBe(true);
  });

  it("ends a repeat trial from the Checkout event, by licence or by card", async () => {
    const licence = `R${token(6).toUpperCase()}`;
    const card = token(32) + token(32);
    const first = await firm(licence);
    await apply(checkoutEvent(first, T, { card_hash: card }));

    const sameLicence = await firm(` ${licence.toLowerCase()} `);
    expect(await apply(checkoutEvent(sameLicence, T))).toEqual({ outcome: "applied", status: "trial", end_trial: sameLicence.sub });
    expect(await claims(sameLicence.orgId)).toEqual([]);

    const sameCard = await firm();
    expect(await apply(checkoutEvent(sameCard, T, { card_hash: card }))).toEqual({ outcome: "applied", status: "trial", end_trial: sameCard.sub });
    expect(await claims(sameCard.orgId)).toEqual([]);
  });
});
