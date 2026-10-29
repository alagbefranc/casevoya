import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

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

/** Each firm gets its own synthetic connected account ids (the test database is shared). */
let ACCOUNT = "acct_1SyntheticFirmA";
let OTHER_ACCOUNT = "acct_1SyntheticFirmB";

function accountId() {
  return `acct_1Syn${randomUUID().replaceAll("-", "").slice(0, 14)}`;
}

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
  ]);
  return id;
}

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    slug(),
  ]);
  return created.rows[0].id;
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

/** A firm with a sample matter, its applicant (a portal client) and an outsider client. */
async function firm() {
  ACCOUNT = accountId();
  OTHER_ACCOUNT = accountId();
  const owner = await createUser("owner");
  const finance = await createUser("finance");
  const client = await createUser("client");
  const stranger = await createUser("stranger");
  const orgId = await createOrg(owner);
  const financeMembership = await member(orgId, finance, "finance_user", owner);
  await member(orgId, client, "client", owner);
  await member(orgId, stranger, "client", owner);
  await asMaintenance(db);
  const matterId = randomUUID();
  const otherMatter = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true), ($3, $2, 'Other matter', true)`, [
    matterId,
    orgId,
    otherMatter,
  ]);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`,
    [orgId, client],
  );
  const strangerPerson = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Other applicant', true, $2) returning id`,
    [orgId, stranger],
  );
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $4, $5, 'applicant')`,
    [orgId, matterId, person.rows[0].id, otherMatter, strangerPerson.rows[0].id],
  );
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [
    orgId,
    matterId,
    financeMembership,
  ]);
  return { owner, finance, client, stranger, orgId, matterId };
}

const tomorrow = () => firmDay(3);

async function connect(orgId: string, owner: string, account = ACCOUNT) {
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.record_firm_payment_account($1, $2, false)`, [orgId, account]);
}

async function issue(f: Awaited<ReturnType<typeof firm>>, amount = 113_000, key = `inv-${randomUUID()}`) {
  await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation stage', $2, 'CAD', $3::date, $4) as id`, [
    f.matterId,
    amount,
    tomorrow(),
    key,
  ]);
  return created.rows[0].id;
}

async function startPayment(f: Awaited<ReturnType<typeof firm>>, invoiceId: string, intent: string, amount = 113_000) {
  await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
  await db.query(`select public.record_invoice_payment_intent($1, $2, $3, $4, 'cad', 0, false)`, [invoiceId, intent, ACCOUNT, amount]);
}

type EventInput = { id: string; type: string; intent: string; amount?: number; received?: number; currency?: string; account?: string; livemode?: boolean; invoiceId?: string | null };

async function deliver(event: EventInput) {
  await asServiceRole(db);
  const result = await db.query<{ r: { outcome: string; invoice_status?: string; payment_status?: string } }>(
    `select public.apply_stripe_payment_event($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb) as r`,
    [
      event.id,
      event.account ?? ACCOUNT,
      event.type,
      event.intent,
      event.amount ?? 113_000,
      event.received ?? 0,
      event.currency ?? "cad",
      event.livemode ?? false,
      event.invoiceId ?? null,
    ],
  );
  return result.rows[0].r;
}

async function invoiceRow(id: string) {
  await asMaintenance(db);
  return (
    await db.query<{ status: string; paid_cents: string | number; number: string }>(`select status, paid_cents, number from public.invoices where id = $1`, [id])
  ).rows[0];
}

describe("firm payment account", () => {
  it("needs a firm owner with a recent step-up, and keeps the account's Stripe mode", async () => {
    const f = await firm();
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 20 * 60 });
    await expectDbError(() => db.query(`select public.record_firm_payment_account($1, $2, false)`, [f.orgId, ACCOUNT]), /step-up/);
    await asUser(db, { userId: f.finance, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.firm_payment_account_for_owner($1)`, [f.orgId]), /step-up/);
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.record_firm_payment_account($1, $2, null)`, [f.orgId, ACCOUNT]), /mode is required/);
    await db.query(`select public.record_firm_payment_account($1, $2, false)`, [f.orgId, ACCOUNT]);
    // Recording the same account again is a no-op; a second, different account is refused.
    await db.query(`select public.record_firm_payment_account($1, $2, false)`, [f.orgId, ACCOUNT]);
    await expectDbError(() => db.query(`select public.record_firm_payment_account($1, $2, false)`, [f.orgId, OTHER_ACCOUNT]), /already has/);
    const owned = await db.query<{ account: string }>(`select public.firm_payment_account_for_owner($1) as account`, [f.orgId]);
    expect(owned.rows[0].account).toBe(ACCOUNT);
    await expectDbError(() => db.query(`update public.firm_payment_accounts set livemode = true`), /permission denied/);
    // A client cannot see the account row.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    const seen = await db.query(`select id from public.firm_payment_accounts`);
    expect(seen.rows).toHaveLength(0);

    // Live mode (Stripe live): the link records the mode of the account it names.
    const g = await firm();
    await asUser(db, { userId: g.owner, aal: "aal2", orgId: g.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.record_firm_payment_account($1, $2, true)`, [g.orgId, "acct_1SyntheticLiveAcct"]);
    const live = await db.query<{ livemode: boolean }>(`select livemode from public.firm_payment_accounts where organization_id = $1`, [g.orgId]);
    expect(live.rows).toEqual([{ livemode: true }]);
  });
});

describe("invoices", () => {
  it("issues firm-numbered invoices for billing staff only, idempotently, in CAD minor units", async () => {
    const f = await firm();
    const key = `inv-${randomUUID()}`;
    const first = await issue(f, 113_000, key);
    const again = await issue(f, 113_000, key);
    expect(again).toBe(first);
    const second = await issue(f, 5_000);
    expect((await invoiceRow(first)).number).toBe("INV-0001");
    expect((await invoiceRow(second)).number).toBe("INV-0002");
    expect((await invoiceRow(first)).status).toBe("issued");

    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.create_invoice($1, 'x', 100, 'USD', $2::date, $3)`, [f.matterId, tomorrow(), `inv-${randomUUID()}`]),
      /only CAD/,
    );
    await expectDbError(
      () => db.query(`select public.create_invoice($1, 'x', 0, 'CAD', $2::date, $3)`, [f.matterId, tomorrow(), `inv-${randomUUID()}`]),
      /positive/,
    );
    await expectDbError(
      () => db.query(`select public.create_invoice($1, 'x', 100, 'CAD', '2000-01-01'::date, $2)`, [f.matterId, `inv-${randomUUID()}`]),
      /due date/,
    );
    await expectDbError(() => db.query(`insert into public.invoices (organization_id, matter_id, number, description, amount_cents, due_on, idempotency_key) values ($1, $2, 'INV-9999', 'x', 1, now()::date, 'abcdefghij')`, [f.orgId, f.matterId]), /permission denied/);

    // A portal client cannot issue, and sees only invoices on their own matter.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(
      () => db.query(`select public.create_invoice($1, 'x', 100, 'CAD', $2::date, $3)`, [f.matterId, tomorrow(), `inv-${randomUUID()}`]),
      /billing access denied/,
    );
    const mine = await db.query(`select id from public.invoices order by number`);
    expect(mine.rows).toHaveLength(2);
    await asUser(db, { userId: f.stranger, aal: "aal1", orgId: f.orgId });
    expect((await db.query(`select id from public.invoices`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.invoice_payment_context($1)`, [first]), /invoice not found/);
  });

  it("refuses a real matter's invoice while the firm is in sample mode", async () => {
    const f = await firm();
    await asMaintenance(db);
    const real = randomUUID();
    await db.query(`insert into public.matters (id, organization_id, title) values ($1, $2, 'Real matter')`, [real, f.orgId]);
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.create_invoice($1, 'x', 100, 'CAD', $2::date, $3)`, [real, tomorrow(), `inv-${randomUUID()}`]),
      /sample mode/,
    );
  });
});

describe("paying an invoice", () => {
  it("records the client's PaymentIntent only for the balance, currency and the firm's account", async () => {
    const f = await firm();
    await connect(f.orgId, f.owner);
    const invoiceId = await issue(f);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    const context = await db.query<{ c: Record<string, unknown> }>(`select public.invoice_payment_context($1) as c`, [invoiceId]);
    expect(context.rows[0].c).toMatchObject({ amount_due: 113_000, currency: "CAD", account_id: ACCOUNT, attempts: 0 });
    await expectDbError(
      () => db.query(`select public.record_invoice_payment_intent($1, 'pi_3Synthetic01', $2, 1000, 'cad', 0, false)`, [invoiceId, ACCOUNT]),
      /balance due/,
    );
    await expectDbError(
      () => db.query(`select public.record_invoice_payment_intent($1, 'pi_3Synthetic01', $2, 113000, 'usd', 0, false)`, [invoiceId, ACCOUNT]),
      /currency/,
    );
    await expectDbError(
      () => db.query(`select public.record_invoice_payment_intent($1, 'pi_3Synthetic01', $2, 113000, 'cad', 0, false)`, [invoiceId, OTHER_ACCOUNT]),
      /does not match the firm/,
    );
    await expectDbError(
      () => db.query(`select public.record_invoice_payment_intent($1, 'pi_3Synthetic01', $2, 113000, 'cad', 0, true)`, [invoiceId, ACCOUNT]),
      /other Stripe mode/,
    );
    await startPayment(f, invoiceId, "pi_3Synthetic01");
    await startPayment(f, invoiceId, "pi_3Synthetic01");
    const reused = await db.query<{ c: Record<string, unknown> }>(`select public.invoice_payment_context($1) as c`, [invoiceId]);
    expect(reused.rows[0].c).toMatchObject({ open_payment_intent_id: "pi_3Synthetic01", attempts: 1 });
    await asUser(db, { userId: f.stranger, aal: "aal1", orgId: f.orgId });
    await expectDbError(
      () => db.query(`select public.record_invoice_payment_intent($1, 'pi_3Synthetic02', $2, 113000, 'cad', 0, false)`, [invoiceId, ACCOUNT]),
      /invoice not found/,
    );
  });
});

describe("Stripe live mode", () => {
  it("takes a live payment on a live link and applies only live events to it", async () => {
    const f = await firm();
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.record_firm_payment_account($1, $2, true)`, [f.orgId, ACCOUNT]);
    const invoiceId = await issue(f);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    // A test-mode payment can't start on a live link.
    await expectDbError(
      () => db.query(`select public.record_invoice_payment_intent($1, 'pi_3SyntheticLive1', $2, 113000, 'cad', 0, false)`, [invoiceId, ACCOUNT]),
      /other Stripe mode/,
    );
    await db.query(`select public.record_invoice_payment_intent($1, 'pi_3SyntheticLive1', $2, 113000, 'cad', 0, true)`, [invoiceId, ACCOUNT]);
    expect((await deliver({ id: "evt_live_test", type: "payment_intent.succeeded", intent: "pi_3SyntheticLive1", received: 113_000 })).outcome).toBe("ignored");
    const paid = await deliver({ id: "evt_live_paid", type: "payment_intent.succeeded", intent: "pi_3SyntheticLive1", livemode: true, received: 113_000 });
    expect(paid).toMatchObject({ outcome: "applied", invoice_status: "paid" });
    await asServiceRole(db);
    const row = await db.query<{ livemode: boolean }>(`select livemode from public.invoice_payments where payment_intent_id = 'pi_3SyntheticLive1'`);
    expect(row.rows).toEqual([{ livemode: true }]);
  });
});

describe("Stripe webhook events", () => {
  it("only service_role applies events", async () => {
    const f = await firm();
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.apply_stripe_payment_event('evt_x', $1, 'payment_intent.succeeded', 'pi_3SyntheticX', 1, 1, 'cad', false, null, '{}'::jsonb)`, [ACCOUNT]),
      /permission denied/,
    );
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(
      () => db.query(`select app.apply_stripe_payment_event('evt_x', $1, 'payment_intent.succeeded', 'pi_3SyntheticX', 1, 1, 'cad', false, null, '{}'::jsonb)`, [ACCOUNT]),
      /permission denied/,
    );
  });

  it("marks the invoice paid once, however often or late the events arrive", async () => {
    const f = await firm();
    await connect(f.orgId, f.owner);
    const invoiceId = await issue(f);
    await startPayment(f, invoiceId, "pi_3Synthetic10");

    expect((await deliver({ id: "evt_10_processing", type: "payment_intent.processing", intent: "pi_3Synthetic10" })).outcome).toBe("applied");
    const paid = await deliver({ id: "evt_10_succeeded", type: "payment_intent.succeeded", intent: "pi_3Synthetic10", received: 113_000 });
    expect(paid).toMatchObject({ outcome: "applied", invoice_status: "paid", payment_status: "succeeded" });
    // The same event again (Stripe retries) changes nothing.
    expect((await deliver({ id: "evt_10_succeeded", type: "payment_intent.succeeded", intent: "pi_3Synthetic10", received: 113_000 })).outcome).toBe("duplicate");
    // A late, out-of-order processing or failure event never moves a paid invoice back.
    expect((await deliver({ id: "evt_10_late_failed", type: "payment_intent.payment_failed", intent: "pi_3Synthetic10" })).outcome).toBe("unchanged");
    expect((await deliver({ id: "evt_10_late_processing", type: "payment_intent.processing", intent: "pi_3Synthetic10" })).outcome).toBe("unchanged");
    const row = await invoiceRow(invoiceId);
    expect(row.status).toBe("paid");
    expect(Number(row.paid_cents)).toBe(113_000);

    await asMaintenance(db);
    const events = await db.query<{ n: number }>(`select count(*)::int as n from public.invoice_payment_events where invoice_id = $1`, [invoiceId]);
    expect(events.rows[0].n).toBe(4);
    const inbox = await db.query<{ n: number }>(`select count(*)::int as n from public.webhook_inbox where provider = 'stripe' and event_id = 'evt_10_succeeded'`);
    expect(inbox.rows[0].n).toBe(1);
    await expectDbError(() => db.query(`update public.invoice_payment_events set outcome = 'applied' where invoice_id = $1`, [invoiceId]), /append-only/);
    await expectDbError(() => db.query(`delete from public.invoice_payment_events where invoice_id = $1`, [invoiceId]), /append-only/);

    // The client sees their invoice paid; no longer open for payment.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    const seen = await db.query<{ status: string }>(`select status from public.invoices where id = $1`, [invoiceId]);
    expect(seen.rows[0].status).toBe("paid");
    await expectDbError(() => db.query(`select public.invoice_payment_context($1)`, [invoiceId]), /not open for payment/);
  });

  it("refuses an event whose account, amount or currency differs, and ignores live or unknown ones", async () => {
    const f = await firm();
    await connect(f.orgId, f.owner);
    const invoiceId = await issue(f);
    await startPayment(f, invoiceId, "pi_3Synthetic20");
    expect((await deliver({ id: "evt_20_amount", type: "payment_intent.succeeded", intent: "pi_3Synthetic20", amount: 1, received: 1 })).outcome).toBe("rejected");
    expect((await deliver({ id: "evt_20_currency", type: "payment_intent.succeeded", intent: "pi_3Synthetic20", currency: "usd", received: 113_000 })).outcome).toBe("rejected");
    expect((await deliver({ id: "evt_20_account", type: "payment_intent.succeeded", intent: "pi_3Synthetic20", account: OTHER_ACCOUNT, received: 113_000 })).outcome).toBe("rejected");
    expect((await deliver({ id: "evt_20_live", type: "payment_intent.succeeded", intent: "pi_3Synthetic20", livemode: true, received: 113_000 })).outcome).toBe("ignored");
    expect((await deliver({ id: "evt_20_unknown", type: "payment_intent.succeeded", intent: "pi_3SyntheticUnknown", received: 113_000 })).outcome).toBe("ignored");
    expect((await invoiceRow(invoiceId)).status).toBe("issued");
  });

  it("recovers a payment the browser never recorded from the PaymentIntent's invoice id", async () => {
    const f = await firm();
    await connect(f.orgId, f.owner);
    const invoiceId = await issue(f, 5_000);
    const result = await deliver({ id: "evt_30", type: "payment_intent.succeeded", intent: "pi_3Synthetic30", amount: 5_000, received: 5_000, invoiceId });
    expect(result).toMatchObject({ outcome: "applied", invoice_status: "paid" });
    // A recovered payment is still checked against the firm's account.
    const other = await issue(f, 7_000);
    expect(
      (await deliver({ id: "evt_31", type: "payment_intent.succeeded", intent: "pi_3Synthetic31", amount: 7_000, received: 7_000, invoiceId: other, account: OTHER_ACCOUNT })).outcome,
    ).toBe("ignored");
    expect((await invoiceRow(other)).status).toBe("issued");
  });
});
