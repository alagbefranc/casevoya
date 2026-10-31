import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * SaaS subscription billing (T042; ADM-02, SEC-10, FIN-01): 20261020160000 and 20261020160100.
 * Plans and prices come from product_settings; Stripe is never called here. The webhook function is
 * exercised with the redacted summaries the route builds (tests/subscription-webhook.test.ts covers
 * the route's mapping from Stripe events).
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

beforeAll(async () => {
  db = await createTestDb();
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

async function subscription(orgId: string): Promise<Row> {
  await asMaintenance(db);
  const row = await db.query<Row>(
    `select status::text, plan::text, billing_interval::text, extra_seats, stripe_customer_id, stripe_subscription_id,
            current_period_end, cancel_at, cancelled_at, past_due_since, restricted_at, archived_at,
            latest_invoice_status, latest_invoice_url, last_webhook_event_id
       from public.organization_subscriptions where organization_id = $1`,
    [orgId],
  );
  return row.rows[0];
}

async function setSubscription(orgId: string, sql: string, params: unknown[] = []) {
  await asMaintenance(db);
  await db.query(`update public.organization_subscriptions set ${sql} where organization_id = $1`, [orgId, ...params]);
}

let eventCounter = 0;
function eventId() {
  eventCounter += 1;
  return `evt_Synthetic${String(eventCounter).padStart(6, "0")}`;
}

async function applyEvent(event: Record<string, unknown>) {
  await asServiceRole(db);
  const result = await db.query<{ result: Row }>(`select public.apply_stripe_subscription_event($1::jsonb) as result`, [JSON.stringify(event)]);
  return result.rows[0].result;
}

/** One synthetic Stripe customer, subscription and invoice per firm (Stripe ids are unique per firm). */
function stripeIds(orgId: string) {
  const tail = orgId.replaceAll("-", "").slice(0, 12);
  return { customer: `cus_Syn${tail}`, subscription: `sub_Syn${tail}`, invoice: `in_Syn${tail}` };
}

function subscriptionEvent(orgId: string, type: string, sub: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const ids = stripeIds(orgId);
  return {
    id: eventId(),
    type,
    created: 1_792_000_000,
    livemode: false,
    organization_id: orgId,
    customer: ids.customer,
    subscription: { id: ids.subscription, status: "active", plan: "practice", interval: "month", extra_seats: 1, current_period_end: "2026-11-19T15:00:00Z", ...sub },
    ...extra,
  };
}

function invoiceEvent(orgId: string, type: "invoice.paid" | "invoice.payment_failed", inv: Record<string, unknown> = {}) {
  const ids = stripeIds(orgId);
  return {
    id: eventId(),
    type,
    created: 1_792_000_000,
    livemode: false,
    organization_id: orgId,
    customer: ids.customer,
    invoice: {
      id: ids.invoice,
      subscription: ids.subscription,
      billing_reason: "subscription_cycle",
      amount_remaining: type === "invoice.paid" ? 0 : 32400,
      number: "CV-0001",
      status: type === "invoice.paid" ? "paid" : "open",
      amount_due: 32400,
      amount_paid: type === "invoice.paid" ? 32400 : 0,
      currency: "cad",
      period_start: "2026-10-19T15:00:00Z",
      period_end: "2026-11-19T15:00:00Z",
      hosted_invoice_url: "https://invoice.stripe.com/i/synthetic",
      pdf_url: "https://pay.stripe.com/invoice/synthetic/pdf",
      created: "2026-10-19T15:00:00Z",
      ...inv,
    },
  };
}

async function audits(orgId: string, action: string) {
  await asMaintenance(db);
  const rows = await db.query<{ context: Row }>(`select context from public.audit_log where organization_id = $1 and action = $2 order by occurred_at`, [orgId, action]);
  return rows.rows.map((row) => row.context);
}

async function invite(owner: string, orgId: string, address: string, fresh = true) {
  await as(owner, orgId, fresh);
  const result = await db.query<{ token: string }>(`select public.create_staff_invitation($1, $2, 'assistant'::public.org_role) as token`, [orgId, address]);
  return result.rows[0].token;
}

type Created = { ok: boolean; id?: string; blocked?: string };

async function newMatter(ctx: Awaited<ReturnType<typeof firm>>, sample = false): Promise<Created> {
  await as(ctx.consultant, ctx.orgId);
  const result = await db.query<{ result: Created }>(`select public.create_engaged_matter($1, $2, $3) as result`, [
    `Matter ${randomUUID().slice(0, 6)}`,
    sample,
    ctx.consultantMembership,
  ]);
  return result.rows[0].result;
}

describe("plan catalog and entitlements", () => {
  it("serves the configured plans to any signed-in user, never to anon, and limits nothing during a trial", async () => {
    const ctx = await firm();
    await as(ctx.assistant, ctx.orgId);
    const catalog = await db.query<{ catalog: Row }>(`select public.subscription_plan_catalog() as catalog`);
    expect(catalog.rows[0].catalog).toMatchObject({
      currency: "CAD",
      annual_months: 10,
      extra_seat_monthly_cents: 2500,
      solo: { monthly_cents: 9900, seats: 2, matters: 100, storage_gb: 25 },
      practice: { monthly_cents: 24900, seats: 6, matters: 500, storage_gb: 100 },
      firm: { monthly_cents: 54900, seats: 15, matters: 1500, storage_gb: 250 },
    });
    await asAnon(db);
    await expectDbError(() => db.query(`select public.subscription_plan_catalog()`), /permission denied|sign in is required/i);

    await as(ctx.assistant, ctx.orgId);
    const ent = await db.query<{ ent: Row }>(`select public.subscription_entitlements($1) as ent`, [ctx.orgId]);
    expect(ent.rows[0].ent).toEqual({ status: "trial", plan: null, basis: "trial", seats: null, matters: null, storage_gb: null, extra_seats: 0, new_work_blocked: false, checkout_required: false });
    // Another firm's staff cannot read this firm's allowances.
    const other = await firm();
    await as(other.assistant, other.orgId);
    await expectDbError(() => db.query(`select public.subscription_entitlements($1)`, [ctx.orgId]), /entitlements denied/);
  });

  it("firm_subscription answers the owner and finance with usage, catalog and an empty invoice list; not an assistant", async () => {
    const ctx = await firm();
    for (const user of [ctx.owner, ctx.finance]) {
      await as(user, ctx.orgId);
      const page = await db.query<{ page: Row }>(`select public.firm_subscription($1) as page`, [ctx.orgId]);
      const data = page.rows[0].page as { subscription: Row; entitlements: Row; usage: Row; catalog: Row; invoices: unknown[]; grace: Row };
      expect(data.subscription).toMatchObject({ status: "trial", plan: null, has_billing_account: false, has_stripe_subscription: false });
      expect(data.entitlements).toMatchObject({ basis: "trial", seats: null, matters: null });
      expect(data.usage).toMatchObject({ seats_active: 4, active_matters: 0 });
      expect(data.catalog).toMatchObject({ currency: "CAD" });
      expect(data.invoices).toEqual([]);
      expect(data.grace).toEqual({ past_due_days: 7, export_window_days: 90 });
      // No Stripe id or card detail leaves the database.
      expect(JSON.stringify(data)).not.toMatch(/cus_|sub_|card/);
    }
    await as(ctx.assistant, ctx.orgId);
    await expectDbError(() => db.query(`select public.firm_subscription($1)`, [ctx.orgId]), /subscription denied/);
  });
});

describe("checkout and portal intents", () => {
  it("lets the owner with a fresh step-up request Checkout, records the intent and refuses everyone else", async () => {
    const ctx = await firm();
    await as(ctx.owner, ctx.orgId);
    const allowed = await db.query<{ result: Row }>(
      `select public.subscription_checkout_allowed($1, 'practice'::public.subscription_plan, 'year'::public.billing_interval, 2) as result`,
      [ctx.orgId],
    );
    const result = allowed.rows[0].result as { ok: boolean; idempotency_key: string; stripe_customer_id: string | null; firm_name: string; billing_email: string; catalog: Row };
    expect(result.ok).toBe(true);
    expect(result.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.stripe_customer_id).toBeNull();
    expect(result.firm_name).toBe("Synthetic Firm");
    expect(result.billing_email).toMatch(/^owner-.*@example\.test$/);
    expect(result.catalog).toMatchObject({ practice: { monthly_cents: 24900 } });
    expect(await audits(ctx.orgId, "subscription.checkout_requested")).toEqual([{ plan: "practice", interval: "year", extra_seats: 2, idempotency_key: result.idempotency_key, trial: "remaining" }]);
    const events = await db.query<{ kind: string; payload: Row }>(`select kind, payload from public.subscription_events where organization_id = $1`, [ctx.orgId]);
    expect(events.rows).toEqual([{ kind: "checkout.requested", payload: { plan: "practice", interval: "year", extra_seats: 2, idempotency_key: result.idempotency_key } }]);

    await as(ctx.owner, ctx.orgId, false);
    await expectDbError(
      () => db.query(`select public.subscription_checkout_allowed($1, 'solo'::public.subscription_plan, 'month'::public.billing_interval, 0)`, [ctx.orgId]),
      /step-up is required/,
    );
    await as(ctx.finance, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.subscription_checkout_allowed($1, 'solo'::public.subscription_plan, 'month'::public.billing_interval, 0)`, [ctx.orgId]),
      /step-up is required/,
    );
    await as(ctx.owner, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.subscription_checkout_allowed($1, 'enterprise'::public.subscription_plan, 'month'::public.billing_interval, 0)`, [ctx.orgId]),
      /arranged with Casevoya/,
    );
    await expectDbError(
      () => db.query(`select public.subscription_checkout_allowed($1, 'solo'::public.subscription_plan, 'month'::public.billing_interval, 501)`, [ctx.orgId]),
      /0 to 500/,
    );
    // Another firm's owner cannot request Checkout for this firm.
    const other = await firm();
    await as(other.owner, other.orgId);
    await expectDbError(
      () => db.query(`select public.subscription_checkout_allowed($1, 'solo'::public.subscription_plan, 'month'::public.billing_interval, 0)`, [ctx.orgId]),
      /step-up is required/,
    );
  });

  it("records the Stripe customer once, and opens the portal only when there is a billing account", async () => {
    const ctx = await firm();
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.subscription_portal_allowed($1)`, [ctx.orgId]), /no billing account yet/);
    // The customer is recorded by the server (service role) for the firm owner who passed step-up.
    await expectDbError(() => db.query(`select public.record_subscription_customer($1, 'cus_SyntheticFirm02')`, [ctx.orgId]), /permission denied/);
    await expectDbError(() => db.query(`select public.service_record_subscription_customer($1, 'cus_SyntheticFirm02', $2)`, [ctx.orgId, ctx.owner]), /permission denied/);
    await asServiceRole(db);
    await db.query(`select public.service_record_subscription_customer($1, 'cus_SyntheticFirm02', $2)`, [ctx.orgId, ctx.owner]);
    await db.query(`select public.service_record_subscription_customer($1, 'cus_SyntheticFirm02', $2)`, [ctx.orgId, ctx.owner]);
    await expectDbError(() => db.query(`select public.service_record_subscription_customer($1, 'cus_SyntheticOther', $2)`, [ctx.orgId, ctx.owner]), /already has a billing account/);
    await expectDbError(() => db.query(`select public.service_record_subscription_customer($1, 'not-a-customer', $2)`, [ctx.orgId, ctx.owner]), /invalid/);
    await as(ctx.owner, ctx.orgId);
    const portal = await db.query<{ result: Row }>(`select public.subscription_portal_allowed($1) as result`, [ctx.orgId]);
    expect(portal.rows[0].result).toEqual({ ok: true, stripe_customer_id: "cus_SyntheticFirm02" });
    expect(await audits(ctx.orgId, "subscription.portal_opened")).toHaveLength(1);
    await as(ctx.finance, ctx.orgId);
    await expectDbError(() => db.query(`select public.subscription_portal_allowed($1)`, [ctx.orgId]), /step-up is required/);
    expect((await subscription(ctx.orgId)).stripe_customer_id).toBe("cus_SyntheticFirm02");

    // Stripe live: a customer made in test mode is replaced once, by the server for the owner, before any subscription.
    await as(ctx.owner, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.replace_subscription_customer($1, 'cus_SyntheticFirm02', 'cus_SyntheticLive01')`, [ctx.orgId]),
      /permission denied/,
    );
    await asServiceRole(db);
    await expectDbError(
      () => db.query(`select public.service_replace_subscription_customer($1, 'cus_SyntheticFirm02', 'cus_SyntheticLive01', $2)`, [ctx.orgId, ctx.finance]),
      /step-up is required/,
    );
    await expectDbError(
      () => db.query(`select public.service_replace_subscription_customer($1, 'cus_SyntheticWrong', 'cus_SyntheticLive01', $2)`, [ctx.orgId, ctx.owner]),
      /already has a billing account/,
    );
    await db.query(`select public.service_replace_subscription_customer($1, 'cus_SyntheticFirm02', 'cus_SyntheticLive01', $2)`, [ctx.orgId, ctx.owner]);
    await db.query(`select public.service_replace_subscription_customer($1, 'cus_SyntheticFirm02', 'cus_SyntheticLive01', $2)`, [ctx.orgId, ctx.owner]);
    expect((await subscription(ctx.orgId)).stripe_customer_id).toBe("cus_SyntheticLive01");
    expect(await audits(ctx.orgId, "subscription.customer_replaced")).toHaveLength(1);
  });
});

describe("Stripe billing events", () => {
  it("is service role only, dedupes on the event id, applies live-mode events and ignores unknown firms", async () => {
    const ctx = await firm();
    const event = subscriptionEvent(ctx.orgId, "customer.subscription.created", {});
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.apply_stripe_subscription_event($1::jsonb)`, [JSON.stringify(event)]), /permission denied/);
    expect(await applyEvent(event)).toEqual({ outcome: "applied", status: "active" });
    expect(await applyEvent(event)).toEqual({ outcome: "duplicate" });
    // Stripe live: the webhook route drops the other mode's events; the database applies either.
    const liveId = eventId();
    expect((await applyEvent({ ...event, id: liveId, livemode: true })).outcome).not.toBe("ignored");
    expect(await applyEvent({ ...event, id: eventId(), organization_id: randomUUID(), customer: "cus_Nobody000" })).toEqual({ outcome: "ignored", reason: "unknown_firm" });
    await expectDbError(() => applyEvent({ ...event, id: "bogus" }), /event id is required/);
    const row = await subscription(ctx.orgId);
    expect(row).toMatchObject({
      status: "active",
      plan: "practice",
      billing_interval: "month",
      extra_seats: 1,
      stripe_customer_id: stripeIds(ctx.orgId).customer,
      stripe_subscription_id: stripeIds(ctx.orgId).subscription,
      last_webhook_event_id: liveId,
    });
    // The firm is found by its Stripe customer when the event carries no organization id.
    expect(await applyEvent({ ...subscriptionEvent(ctx.orgId, "customer.subscription.updated", { extra_seats: 3 }), organization_id: undefined })).toEqual({ outcome: "applied", status: "active" });
    expect((await subscription(ctx.orgId)).extra_seats).toBe(3);
    const applied = await audits(ctx.orgId, "subscription.webhook_applied");
    expect(applied[0]).toMatchObject({ event_type: "customer.subscription.created", outcome: "applied", status_before: "trial", status_after: "active" });
  });

  it("Checkout completion activates the plan; the owner then sees it as Practice with its allowances", async () => {
    const ctx = await firm();
    expect(
      await applyEvent({
        id: eventId(),
        type: "checkout.session.completed",
        created: 1_792_000_000,
        livemode: false,
        organization_id: ctx.orgId,
        customer: stripeIds(ctx.orgId).customer,
        subscription: { id: stripeIds(ctx.orgId).subscription, plan: "firm", interval: "year", extra_seats: 0, payment_status: "paid" },
      }),
    ).toEqual({ outcome: "applied", status: "active" });
    await as(ctx.owner, ctx.orgId);
    const page = await db.query<{ page: { subscription: Row; entitlements: Row } }>(`select public.firm_subscription($1) as page`, [ctx.orgId]);
    expect(page.rows[0].page.subscription).toMatchObject({ status: "active", plan: "firm", billing_interval: "year", has_billing_account: true, has_stripe_subscription: true });
    expect(page.rows[0].page.entitlements).toEqual({ status: "active", plan: "firm", basis: "plan", seats: 15, matters: 1500, storage_gb: 250, extra_seats: 0, new_work_blocked: false });
    // A live subscription changes in the portal, not through a second Checkout.
    await expectDbError(
      () => db.query(`select public.subscription_checkout_allowed($1, 'solo'::public.subscription_plan, 'month'::public.billing_interval, 0)`, [ctx.orgId]),
      /billing portal/,
    );
  });

  it("a failed renewal is past due, restricted after the 7-day grace, and active again once paid; invoices are the firm's own", async () => {
    const ctx = await firm();
    await applyEvent(subscriptionEvent(ctx.orgId, "customer.subscription.created", {}));
    expect(await applyEvent(invoiceEvent(ctx.orgId, "invoice.payment_failed"))).toEqual({ outcome: "applied", status: "past_due" });
    let row = await subscription(ctx.orgId);
    expect(row.past_due_since).not.toBeNull();
    expect(row.latest_invoice_status).toBe("payment_failed");
    // Inside the grace: new work is still allowed.
    await as(ctx.owner, ctx.orgId);
    let ent = await db.query<{ ent: Row }>(`select public.subscription_entitlements($1) as ent`, [ctx.orgId]);
    expect(ent.rows[0].ent).toMatchObject({ status: "past_due", new_work_blocked: false });
    let blockers = await db.query<{ blockers: string[] }>(`select app.real_client_invite_blockers($1) as blockers`, [ctx.orgId]);
    expect(blockers.rows[0].blockers).not.toContain("subscription_restricted");

    // Eight days later the clock marks the firm restricted and real client invites pause.
    await setSubscription(ctx.orgId, `past_due_since = statement_timestamp() - interval '8 days'`);
    await as(ctx.owner, ctx.orgId);
    blockers = await db.query(`select app.real_client_invite_blockers($1) as blockers`, [ctx.orgId]);
    expect(blockers.rows[0].blockers).toContain("subscription_restricted");
    expect(blockers.rows[0].blockers.at(-1)).toBe("subscription_restricted");
    ent = await db.query(`select public.subscription_entitlements($1) as ent`, [ctx.orgId]);
    expect(ent.rows[0].ent).toMatchObject({ status: "restricted", new_work_blocked: true });
    row = await subscription(ctx.orgId);
    expect(row.status).toBe("restricted");
    expect(row.restricted_at).not.toBeNull();
    expect(await audits(ctx.orgId, "subscription.restricted")).toEqual([expect.objectContaining({ grace_days: 7 })]);
    // Reads stay open: the owner still reads the page and the invoice.
    await as(ctx.owner, ctx.orgId);
    const page = await db.query<{ page: { invoices: Row[] } }>(`select public.firm_subscription($1) as page`, [ctx.orgId]);
    expect(page.rows[0].page.invoices).toEqual([
      expect.objectContaining({ number: "CV-0001", status: "open", amount_due_cents: 32400, amount_paid_cents: 0, currency: "cad", hosted_invoice_url: "https://invoice.stripe.com/i/synthetic" }),
    ]);
    const direct = await db.query(`select stripe_invoice_id from public.subscription_invoices`);
    expect(direct.rows).toHaveLength(1);
    await as(ctx.assistant, ctx.orgId);
    expect((await db.query(`select stripe_invoice_id from public.subscription_invoices`)).rows).toHaveLength(0);
    expect((await db.query(`select kind from public.subscription_events`)).rows).toHaveLength(0);
    const other = await firm();
    await as(other.owner, other.orgId);
    expect((await db.query(`select stripe_invoice_id from public.subscription_invoices`)).rows).toHaveLength(0);
    expect((await db.query(`select kind from public.subscription_events`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`insert into public.subscription_invoices (organization_id, stripe_invoice_id, status, amount_due_cents, currency) values ($1, 'in_Forged0001', 'paid', 1, 'cad')`, [other.orgId]), /permission denied/);

    // Paid: active again, the invoice updated, the grace dates cleared.
    expect(await applyEvent(invoiceEvent(ctx.orgId, "invoice.paid"))).toEqual({ outcome: "applied", status: "active" });
    row = await subscription(ctx.orgId);
    expect(row).toMatchObject({ status: "active", past_due_since: null, restricted_at: null, latest_invoice_status: "paid", latest_invoice_url: "https://invoice.stripe.com/i/synthetic" });
    await as(ctx.finance, ctx.orgId);
    const paid = await db.query<{ page: { invoices: Row[] } }>(`select public.firm_subscription($1) as page`, [ctx.orgId]);
    expect(paid.rows[0].page.invoices).toEqual([expect.objectContaining({ number: "CV-0001", status: "paid", amount_paid_cents: 32400 })]);
    await as(ctx.owner, ctx.orgId);
    blockers = await db.query(`select app.real_client_invite_blockers($1) as blockers`, [ctx.orgId]);
    expect(blockers.rows[0].blockers).not.toContain("subscription_restricted");
  });

  it("cancellation at the period end keeps everything readable; archived after 90 days marks state only", async () => {
    const ctx = await firm();
    await applyEvent(subscriptionEvent(ctx.orgId, "customer.subscription.created", {}));
    await applyEvent(subscriptionEvent(ctx.orgId, "customer.subscription.updated", { cancel_at: "2026-11-19T15:00:00Z" }));
    let row = await subscription(ctx.orgId);
    expect(row.status).toBe("active");
    expect(row.cancel_at).not.toBeNull();
    expect(await applyEvent(subscriptionEvent(ctx.orgId, "customer.subscription.deleted", { status: "canceled", canceled_at: "2026-11-19T15:00:00Z" }))).toEqual({ outcome: "applied", status: "cancelled" });
    row = await subscription(ctx.orgId);
    expect(row).toMatchObject({ status: "cancelled", cancel_at: null });
    expect(row.cancelled_at).not.toBeNull();
    // New work pauses; reads do not.
    await as(ctx.owner, ctx.orgId);
    const blockers = await db.query<{ blockers: string[] }>(`select app.real_client_invite_blockers($1) as blockers`, [ctx.orgId]);
    expect(blockers.rows[0].blockers).toContain("subscription_restricted");
    await expectDbError(() => invite(ctx.owner, ctx.orgId, email("late")), /subscription paused/);
    await expectDbError(() => newMatter(ctx), /subscription paused/);
    expect((await newMatter(ctx, true)).ok).toBe(true);
    await as(ctx.owner, ctx.orgId);
    const page = await db.query<{ page: { subscription: Row; usage: Row } }>(`select public.firm_subscription($1) as page`, [ctx.orgId]);
    expect(page.rows[0].page.subscription).toMatchObject({ status: "cancelled" });
    // 91 days after the end of the paid period: archived. Nothing is deleted; the firm, people and
    // matters are still there. (SEC-10: the window counts from the later of the cancellation and the
    // period end.)
    await setSubscription(ctx.orgId, `cancelled_at = statement_timestamp() - interval '91 days', current_period_end = statement_timestamp() - interval '91 days'`);
    await as(ctx.owner, ctx.orgId);
    const ent = await db.query<{ ent: Row }>(`select public.subscription_entitlements($1) as ent`, [ctx.orgId]);
    expect(ent.rows[0].ent).toMatchObject({ status: "archived", new_work_blocked: true });
    row = await subscription(ctx.orgId);
    expect(row.archived_at).not.toBeNull();
    expect(await audits(ctx.orgId, "subscription.archived")).toEqual([expect.objectContaining({ export_window_days: 90, records_deleted: false })]);
    await asMaintenance(db);
    expect((await db.query(`select count(*)::int as n from public.matters where organization_id = $1`, [ctx.orgId])).rows[0]).toEqual({ n: 1 });
    // The owner may choose a plan again: Checkout is allowed from cancelled and archived.
    await as(ctx.owner, ctx.orgId);
    const again = await db.query<{ result: { ok: boolean } }>(
      `select public.subscription_checkout_allowed($1, 'solo'::public.subscription_plan, 'month'::public.billing_interval, 0) as result`,
      [ctx.orgId],
    );
    expect(again.rows[0].result.ok).toBe(true);
  });
});

describe("entitlements where work is created", () => {
  it("limits nothing during a trial or an ended trial: a third staff member and many matters are fine", async () => {
    const ctx = await firm();
    // The firm already has four staff; a trial may invite more and open matters freely.
    await invite(ctx.owner, ctx.orgId, "fifth@example.test");
    await invite(ctx.owner, ctx.orgId, "sixth@example.test");
    for (let n = 0; n < 3; n += 1) expect((await newMatter(ctx)).ok).toBe(true);
    await setSubscription(ctx.orgId, `status = 'trial_ended'`);
    await invite(ctx.owner, ctx.orgId, "seventh@example.test");
    expect((await newMatter(ctx)).ok).toBe(true);
    await as(ctx.owner, ctx.orgId);
    const ent = await db.query<{ ent: Row }>(`select public.subscription_entitlements($1) as ent`, [ctx.orgId]);
    expect(ent.rows[0].ent).toMatchObject({ status: "trial_ended", basis: "trial", seats: null, matters: null, new_work_blocked: false });
  });

  it("refuses a staff invitation beyond the chosen plan's seat allowance, naming the limit; extra seats lift it", async () => {
    const owner = await createUser(email("owner"));
    const orgId = await createOrg(owner);
    // Solo: 2 seats. The owner holds one.
    await applyEvent(subscriptionEvent(orgId, "customer.subscription.created", { plan: "solo", extra_seats: 0 }));
    await invite(owner, orgId, "first@example.test");
    await expectDbError(() => invite(owner, orgId, "second@example.test"), /seat allowance reached: 2 of 2 staff seats are in use; add a seat in Settings > Subscription/);
    // Inviting the same person again replaces the open invitation and takes no extra seat.
    await invite(owner, orgId, "first@example.test");
    // A revoked invitation frees its seat.
    await asMaintenance(db);
    await db.query(`update public.invitations set revoked_at = now() where organization_id = $1 and email = 'first@example.test'`, [orgId]);
    await invite(owner, orgId, "second@example.test");
    await expectDbError(() => invite(owner, orgId, "third@example.test"), /seat allowance reached/);
    // Solo (2 seats) plus one extra seat: three in all.
    await applyEvent(subscriptionEvent(orgId, "customer.subscription.updated", { plan: "solo", extra_seats: 1 }));
    await as(owner, orgId);
    const ent = await db.query<{ ent: Row }>(`select public.subscription_entitlements($1) as ent`, [orgId]);
    expect(ent.rows[0].ent).toMatchObject({ plan: "solo", seats: 3, extra_seats: 1 });
    await invite(owner, orgId, "third@example.test");
    await expectDbError(() => invite(owner, orgId, "fourth@example.test"), /3 of 3 staff seats/);
    // An enterprise plan has no seat limit.
    await applyEvent(subscriptionEvent(orgId, "customer.subscription.updated", { plan: "enterprise" }));
    await invite(owner, orgId, "fourth@example.test");
  });

  it("refuses a real matter beyond the chosen plan's active-matter allowance; sample matters never count; a bigger plan lifts it", async () => {
    const ctx = await firm();
    await applyEvent(subscriptionEvent(ctx.orgId, "customer.subscription.created", { plan: "solo", extra_seats: 0 }));
    await asMaintenance(db);
    await db.query(`update public.product_settings set value = jsonb_set(value, '{solo,matters}', '1'::jsonb) where key = 'subscription.plans'`);
    try {
      expect((await newMatter(ctx, true)).ok).toBe(true);
      expect((await newMatter(ctx, true)).ok).toBe(true);
      const first = await newMatter(ctx);
      expect(first.ok).toBe(true);
      await expectDbError(() => newMatter(ctx), /active-matter allowance reached: 1 of 1 active matters are open; close a matter or change plan in Settings > Subscription/);
      // Sample matters are still fine.
      expect((await newMatter(ctx, true)).ok).toBe(true);
      // Practice raises the allowance.
      await applyEvent(subscriptionEvent(ctx.orgId, "customer.subscription.updated", { plan: "practice" }));
      expect((await newMatter(ctx)).ok).toBe(true);
    } finally {
      await asMaintenance(db);
      await db.query(`update public.product_settings set value = jsonb_set(value, '{solo,matters}', '100'::jsonb) where key = 'subscription.plans'`);
    }
  });
});
