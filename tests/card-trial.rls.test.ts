import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Card-required 14-day trial (20261101100100): new firms add a card in Stripe Checkout to start the
 * trial; one trial per firm, owner licence and card; the trial reminder and failed-payment mail.
 * Synthetic firms and test-mode Stripe ids only; Stripe is never called.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
type Prepared = { action: string; messages: { to: string; template: string; context: Record<string, unknown> }[] };

beforeAll(async () => {
  db = await createTestDb({ cardRequired: true });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

async function createUser(address = email("user")) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, address]);
  return id;
}

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  return created.rows[0].id;
}

async function activeMembership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

async function verifiedLicence(owner: string, consultant: string, orgId: string, membershipId: string) {
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membershipId, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
}

/** A live firm: owner, a licensed consultant, a finance user and an assistant. */
async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const finance = await createUser(email("finance"));
  const assistant = await createUser(email("assistant"));
  const orgId = await createOrg(owner);
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  await activeMembership(orgId, finance, "finance_user", owner);
  await activeMembership(orgId, assistant, "assistant", owner);
  await verifiedLicence(owner, consultant, orgId, consultantMembership);
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  return { owner, consultant, finance, assistant, orgId, consultantMembership };
}

/** Signed in with two-step; `fresh` is a step-up inside the window. */
async function as(userId: string, orgId: string, fresh = true) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: fresh ? 0 : 60 * 60 });
}

type Row = Record<string, unknown>;




/** The owner's own CICC licence on file (the one-trial-per-licence check reads it). */
async function ownerLicence(owner: string, orgId: string, collegeId: string) {
  await asMaintenance(db);
  const membership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner])).rows[0].id;
  await as(owner, orgId);
  await db.query(`select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3)`, [membership, collegeId, PROOF]);
}

let counter = 0;
const eventId = () => `evt_SynTrial${String(++counter).padStart(6, "0")}`;
function ids(orgId: string) {
  const tail = orgId.replaceAll("-", "").slice(0, 12);
  return { customer: `cus_Syn${tail}`, subscription: `sub_Syn${tail}`, invoice: `in_Syn${tail}` };
}
async function apply(event: Record<string, unknown>) {
  await asServiceRole(db);
  return (await db.query<{ result: Row }>(`select public.apply_stripe_subscription_event($1::jsonb) as result`, [JSON.stringify(event)])).rows[0].result;
}
function trialing(orgId: string, sub: Record<string, unknown> = {}, type = "customer.subscription.created") {
  const i = ids(orgId);
  return {
    id: eventId(),
    type,
    created: 1_792_000_000 + counter,
    livemode: false,
    organization_id: orgId,
    customer: i.customer,
    subscription: {
      id: i.subscription,
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
async function outbox(orgId: string, type: string) {
  await asMaintenance(db);
  return (await db.query<{ id: string; payload: Row }>(`select id, payload from public.outbox_events where organization_id = $1 and event_type = $2`, [orgId, type])).rows;
}
async function prepare(eventId: string): Promise<Prepared> {
  await asServiceRole(db);
  const worker = `trial-${randomUUID().slice(0, 8)}`;
  const claimed = await db.query<{ events: { id: string }[] }>(`select public.claim_mail_events($1, 50) as events`, [worker]);
  expect(claimed.rows[0].events.map((row) => row.id)).toContain(eventId);
  return (await db.query<{ result: Prepared }>(`select public.prepare_email_delivery($1, $2, null, null) as result`, [eventId, worker])).rows[0].result;
}
async function checkout(owner: string, orgId: string) {
  await as(owner, orgId);
  return (
    await db.query<{ result: Row }>(`select public.subscription_checkout_allowed($1, 'practice'::public.subscription_plan, 'month'::public.billing_interval, 0) as result`, [orgId])
  ).rows[0].result;
}

describe("public pricing", () => {
  it("anyone can read the price list, the trial and the founding offer, never the coupon id", async () => {
    await asAnon(db);
    const result = (await db.query<{ p: Row }>(`select public.public_pricing() as p`)).rows[0].p;
    expect(result).toMatchObject({
      trial_days: 14,
      card_required: true,
      founding_offer: { active: true, percent_off: 25, months: 12, max_firms: 50 },
      catalog: { currency: "CAD", annual_months: 10, extra_seat_monthly_cents: 2500, solo: { monthly_cents: 9900 }, practice: { monthly_cents: 24900 }, firm: { monthly_cents: 54900 } },
    });
    expect(JSON.stringify(result)).not.toContain("coupon");
  });
});

describe("a new firm needs a card", () => {
  it("starts in trial with no end date, blocks real matters and invitations, and tells the owner why", async () => {
    const ctx = await firm();
    const sub = (await asMaintenance(db), await db.query<Row>(`select status::text, card_required, trial_ends_at, trial_used_at from public.organization_subscriptions where organization_id = $1`, [ctx.orgId])).rows[0];
    expect(sub).toMatchObject({ status: "trial", card_required: true, trial_used_at: null });
    expect((await db.query<{ ent: Row }>(`select app.subscription_entitlements($1) as ent`, [ctx.orgId])).rows[0].ent).toMatchObject({ checkout_required: true });
    expect((await db.query<{ blockers: string[] }>(`select app.real_client_invite_blockers($1) as blockers`, [ctx.orgId])).rows[0].blockers).toContain("card_required");
    await as(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.create_engaged_matter('Synthetic matter', false, $1, null, null)`, [ctx.consultantMembership]), /card required/);
  });

  it("offers the owner 14 days and the founding coupon at Checkout", async () => {
    const ctx = await firm();
    const result = await checkout(ctx.owner, ctx.orgId);
    expect(result).toMatchObject({ ok: true, trial_days: 14, trial_end: null, trial_reason: "new", founding_coupon: "casevoya_founding_25", founding_percent: 25, founding_months: 12 });
  });

  it("a trialing subscription starts the trial: plan allowances, matters open, card no longer required", async () => {
    const ctx = await firm();
    await ownerLicence(ctx.owner, ctx.orgId, `R${randomUUID().slice(0, 6).toUpperCase()}`);
    const result = await apply(trialing(ctx.orgId));
    expect(result).toMatchObject({ outcome: "applied", status: "trial" });
    expect(result).not.toHaveProperty("end_trial");
    await asMaintenance(db);
    const sub = (await db.query<Row>(`select status::text, card_required, plan::text, trial_ends_at, trial_used_at, stripe_subscription_id from public.organization_subscriptions where organization_id = $1`, [ctx.orgId])).rows[0];
    expect(sub).toMatchObject({ status: "trial", card_required: false, plan: "practice", stripe_subscription_id: ids(ctx.orgId).subscription });
    expect(new Date(sub.trial_ends_at as string).toISOString()).toBe("2026-11-16T15:00:00.000Z");
    expect(sub.trial_used_at).not.toBeNull();
    expect((await db.query<{ blockers: string[] }>(`select app.real_client_invite_blockers($1) as blockers`, [ctx.orgId])).rows[0].blockers).not.toContain("card_required");
    await as(ctx.consultant, ctx.orgId);
    const matter = await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', false, $1, null, null) as result`, [ctx.consultantMembership]);
    expect(matter.rows[0].result.id).toMatch(/^[0-9a-f-]{36}$/);
    // The same firm cannot take a second trial.
    await asMaintenance(db);
    await db.query(`update public.organization_subscriptions set stripe_subscription_id = null, status = 'trial_ended' where organization_id = $1`, [ctx.orgId]);
    expect(await checkout(ctx.owner, ctx.orgId)).toMatchObject({ trial_days: 0, trial_end: null, trial_reason: "firm_used" });
  });
});

describe("one trial per licence and per card", () => {
  it("refuses a second trial to the same owner licence and ends a repeat card's trial", async () => {
    const licence = `R${randomUUID().slice(0, 6).toUpperCase()}`;
    const card = "a".repeat(64);
    const first = await firm();
    await ownerLicence(first.owner, first.orgId, licence);
    expect(await apply(trialing(first.orgId, { card_hash: card }))).toMatchObject({ outcome: "applied", status: "trial" });

    const second = await firm();
    await ownerLicence(second.owner, second.orgId, ` ${licence.toLowerCase()} `);
    const result = await checkout(second.owner, second.orgId);
    expect(result).toMatchObject({ ok: true, trial_days: 0, trial_end: null, trial_reason: "licence_used" });

    const third = await firm();
    await ownerLicence(third.owner, third.orgId, `R${randomUUID().slice(0, 6).toUpperCase()}`);
    const repeat = await apply(trialing(third.orgId, { card_hash: card }));
    expect(repeat).toMatchObject({ outcome: "applied", end_trial: ids(third.orgId).subscription });
    await asMaintenance(db);
    const claims = await db.query<{ n: number }>(`select count(*)::int as n from public.subscription_trial_claims where organization_id = $1`, [third.orgId]);
    expect(claims.rows[0].n).toBe(0);
  });

  it("keeps the claims away from every signed-in role", async () => {
    const ctx = await firm();
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select * from public.subscription_trial_claims`), /permission denied/);
  });
});

describe("trial and payment mail", () => {
  it("sends the owners one trial-ending reminder", async () => {
    const ctx = await firm();
    await ownerLicence(ctx.owner, ctx.orgId, `R${randomUUID().slice(0, 6).toUpperCase()}`);
    await apply(trialing(ctx.orgId));
    await apply(trialing(ctx.orgId, {}, "customer.subscription.trial_will_end"));
    await apply(trialing(ctx.orgId, {}, "customer.subscription.trial_will_end"));
    const events = await outbox(ctx.orgId, "subscription.trial_will_end");
    expect(events).toHaveLength(1);
    const mail = await prepare(events[0].id);
    expect(mail.action).toBe("send");
    expect(mail.messages.map((message) => message.template)).toEqual(["trial_ending"]);
    expect(mail.messages[0].to).toMatch(/^owner-.*@example\.test$/);
  });

  it("a failed first charge after the trial starts the 7-day grace and emails the owners once per invoice", async () => {
    const ctx = await firm();
    await ownerLicence(ctx.owner, ctx.orgId, `R${randomUUID().slice(0, 6).toUpperCase()}`);
    await apply(trialing(ctx.orgId));
    const i = ids(ctx.orgId);
    const failed = () => ({
      id: eventId(),
      type: "invoice.payment_failed",
      created: 1_792_000_000 + counter,
      livemode: false,
      organization_id: ctx.orgId,
      customer: i.customer,
      invoice: {
        id: i.invoice,
        subscription: i.subscription,
        billing_reason: "subscription_cycle",
        amount_remaining: 24900,
        number: "CV-0001",
        status: "open",
        amount_due: 24900,
        amount_paid: 0,
        currency: "cad",
        period_start: "2026-11-16T15:00:00Z",
        period_end: "2026-12-16T15:00:00Z",
        hosted_invoice_url: "https://invoice.stripe.com/i/synthetic",
        pdf_url: "https://pay.stripe.com/invoice/synthetic/pdf",
        created: "2026-11-16T15:00:00Z",
      },
    });
    await apply(failed());
    await apply(failed());
    await asMaintenance(db);
    const sub = (await db.query<Row>(`select status::text, past_due_since from public.organization_subscriptions where organization_id = $1`, [ctx.orgId])).rows[0];
    expect(sub.status).toBe("past_due");
    expect(sub.past_due_since).not.toBeNull();
    const events = await outbox(ctx.orgId, "subscription.payment_failed");
    expect(events).toHaveLength(1);
    const mail = await prepare(events[0].id);
    expect(mail.messages.map((message) => message.template)).toEqual(["billing_payment_failed"]);
  });
});
