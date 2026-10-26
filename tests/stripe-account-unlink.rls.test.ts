import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * Bug 8: the firm owner disconnects the firm's Stripe connected account (test mode), with a fresh
 * step-up, typed DISCONNECT and a reason; refused while card payments, refunds or disputes are
 * open on it; the ended link stays in the history; the firm can then connect another account.
 * Synthetic Stripe ids only.
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
const disputeId = () => `du_1Syn${token()}`;
const eventId = () => `evt_Syn${token(20)}`;

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${id.slice(0, 8)}@example.test`]);
  return id;
}

async function member(orgId: string, userId: string, role: string, by: string) {
  await asMaintenance(db);
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4)`,
    [orgId, userId, role, by],
  );
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
  await member(orgId, finance, "finance_user", owner);
  await member(orgId, client, "client", owner);
  await asMaintenance(db);
  const matterId = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true)`, [matterId, orgId]);
  const person = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`, [orgId, client]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, person.rows[0].id]);
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.record_firm_payment_account($1, $2, false)`, [orgId, account]);
  return { owner, finance, client, orgId, matterId, account };
}

async function asStepUp(f: Firm, userId: string = f.owner) {
  await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
}

async function issue(f: Firm, amount = 50_000) {
  await asStepUp(f);
  const created = await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation stage', $2, 'CAD', $3::date, $4) as id`, [f.matterId, amount, firmDay(3), `inv-${randomUUID()}`]);
  return created.rows[0].id;
}

async function startPayment(f: Firm, amount = 50_000) {
  const invoiceId = await issue(f, amount);
  const intent = intentId();
  await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
  await db.query(`select public.record_invoice_payment_intent($1, $2, $3, $4, 'cad', 0, false)`, [invoiceId, intent, f.account, amount]);
  return { invoiceId, intent };
}

async function paymentEvent(f: Firm, type: string, intent: string, amount: number, received = 0) {
  await asServiceRole(db);
  const result = await db.query<{ r: { outcome: string } }>(
    `select public.apply_stripe_payment_event($1, $2, $3, $4, $5, $6, 'cad', false, null, '{}'::jsonb) as r`,
    [eventId(), f.account, type, intent, amount, received],
  );
  return result.rows[0].r;
}

async function paidInvoice(f: Firm, amount = 50_000) {
  const { invoiceId, intent } = await startPayment(f, amount);
  expect((await paymentEvent(f, "payment_intent.succeeded", intent, amount, amount)).outcome).toBe("applied");
  await asMaintenance(db);
  const payment = await db.query<{ id: string }>(`select id from public.invoice_payments where payment_intent_id = $1`, [intent]);
  return { invoiceId, paymentId: payment.rows[0].id, intent };
}

async function reversal(f: Firm, type: string, object: string, intent: string, amount: number, status: string | null) {
  await asServiceRole(db);
  const result = await db.query<{ r: { outcome: string } }>(
    `select public.apply_stripe_reversal_event($1, $2, $3, $4, $5, null, $6, 'cad', $7, null, null, null, null, null, false, '{}'::jsonb) as r`,
    [eventId(), f.account, type, object, intent, amount, status],
  );
  return result.rows[0].r;
}

/** Moves a payment's start back in time (triggers keep created_at, so they are off for this one update). */
async function backdate(where: string, params: unknown[], age: string) {
  await asMaintenance(db);
  await db.exec("set session_replication_role = replica");
  try {
    await db.query(`update public.invoice_payments set created_at = now() - interval '${age}' where ${where}`, params);
  } finally {
    await db.exec("set session_replication_role = origin");
  }
}

type Unlinked = { unlinked: boolean; history_id?: string; blockers?: { kind: string; number: string; status: string }[] };

async function unlink(f: Firm, reason = "Moving to the firm's new Stripe account", confirmation = "DISCONNECT", account: string = f.account) {
  const row = await db.query<{ r: Unlinked }>(`select public.unlink_stripe_account($1, $2, $3, $4) as r`, [f.orgId, account, confirmation, reason]);
  return row.rows[0].r;
}

async function currentLink(orgId: string) {
  await asMaintenance(db);
  return (await db.query<{ id: string; account_id: string }>(`select id, account_id from public.firm_payment_accounts where organization_id = $1`, [orgId])).rows;
}

describe("disconnecting the firm's Stripe account (bug 8)", () => {
  it("is for the firm owner with a fresh step-up, typed DISCONNECT and a reason", async () => {
    const f = await firm();
    await asUser(db, { userId: f.finance, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => unlink(f), /step-up/);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => unlink(f), /step-up|permission denied/);
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => unlink(f), /step-up/);
    await asUser(db, { userId: f.owner, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => unlink(f), /step-up/);

    await asStepUp(f);
    await expectDbError(() => unlink(f, "Moving", "disconnect please"), /type DISCONNECT/);
    await expectDbError(() => unlink(f, "  "), /reason/);
    await expectDbError(() => unlink(f, "Moving", "DISCONNECT", accountId()), /changed/);

    // Another firm's owner can't end this firm's link.
    const other = await firm();
    await asStepUp(other);
    await expectDbError(() => unlink({ ...other, account: f.account, orgId: f.orgId }), /step-up/);

    expect(await currentLink(f.orgId)).toHaveLength(1);
    await asMaintenance(db);
    await expectDbError(() => db.query(`delete from public.firm_payment_accounts where organization_id = $1`, [f.orgId]), /rows are retained/);
  });

  it("refuses while a card payment is in flight, a refund is pending or a dispute is open, and lists them", async () => {
    const f = await firm();
    const { intent: pending } = await startPayment(f, 40_000);
    const { paymentId, intent: paid } = await paidInvoice(f, 50_000);
    const { invoiceId: processingInvoice, intent: processing } = await startPayment(f, 60_000);
    expect((await paymentEvent(f, "payment_intent.processing", processing, 60_000)).outcome).toBe("applied");

    // A refund pending at Stripe and an open dispute on the paid invoice.
    await asStepUp(f);
    const refund = refundId();
    await db.query(`select public.record_invoice_refund($1, $2, 10000, 'cad', 'requested_by_customer', false, $3)`, [paymentId, refund, `rf-${randomUUID()}`]);
    const dispute = disputeId();
    expect((await reversal(f, "charge.dispute.created", dispute, paid, 50_000, "needs_response")).outcome).toBe("applied");

    await asStepUp(f);
    const refused = await unlink(f);
    expect(refused.unlinked).toBe(false);
    expect(refused.blockers?.map((item) => item.kind).sort()).toEqual(["dispute", "payment", "payment", "refund"]);
    expect(refused.blockers?.find((item) => item.kind === "dispute")?.status).toBe("needs_response");
    expect(refused.blockers?.filter((item) => item.kind === "payment").map((item) => item.status).sort()).toEqual(["processing", "requires_payment"]);
    expect(await currentLink(f.orgId)).toHaveLength(1);
    await asMaintenance(db);
    const audit = await db.query<{ result: string }>(`select result from public.audit_log where organization_id = $1 and action = 'stripe.account_unlink_refused'`, [f.orgId]);
    expect(audit.rows.map((row) => row.result)).toEqual(["denied"]);

    // A checkout abandoned over a day ago no longer holds the account; the rest still do.
    await backdate(`payment_intent_id = $1`, [pending], "25 hours");
    await asStepUp(f);
    expect((await unlink(f)).blockers).toHaveLength(3);

    // Settle the processing payment, the refund and the dispute: then it goes.
    expect((await paymentEvent(f, "payment_intent.succeeded", processing, 60_000, 60_000)).outcome).toBe("applied");
    expect((await reversal(f, "refund.updated", refund, paid, 10_000, "succeeded")).outcome).toBe("applied");
    expect((await reversal(f, "charge.dispute.closed", dispute, paid, 50_000, "won")).outcome).toBe("applied");
    await asStepUp(f);
    expect(await unlink(f)).toMatchObject({ unlinked: true });
    expect(await currentLink(f.orgId)).toEqual([]);
    expect(processingInvoice).toBeTruthy();
  });

  it("keeps the ended link in the history, audited, readable by billing staff and never changed", async () => {
    const f = await firm();
    const [link] = await currentLink(f.orgId);
    await asStepUp(f);
    const done = await unlink(f, "  Moving to a new account  ");
    expect(done.unlinked).toBe(true);

    await asUser(db, { userId: f.finance, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 3600 });
    const history = await db.query<{ id: string; payment_account_id: string; account_id: string; ended_by: string; end_reason: string; linked_by: string }>(
      `select id, payment_account_id, account_id, ended_by, end_reason, linked_by from public.firm_payment_account_history where organization_id = $1`,
      [f.orgId],
    );
    expect(history.rows).toEqual([{ id: done.history_id, payment_account_id: link.id, account_id: f.account, ended_by: f.owner, end_reason: "Moving to a new account", linked_by: f.owner }]);
    await expectDbError(() => db.query(`update public.firm_payment_account_history set end_reason = 'x' where organization_id = $1`, [f.orgId]), /permission denied/);

    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    expect((await db.query(`select 1 from public.firm_payment_account_history where organization_id = $1`, [f.orgId])).rows).toEqual([]);
    const other = await firm();
    await asStepUp(other);
    expect((await db.query(`select 1 from public.firm_payment_account_history where organization_id = $1`, [f.orgId])).rows).toEqual([]);

    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.firm_payment_account_history set end_reason = 'Changed' where id = $1`, [done.history_id]), /append-only/);
    await expectDbError(() => db.query(`delete from public.firm_payment_account_history where id = $1`, [done.history_id]), /append-only/);
    const audit = await db.query<{ object_id: string; context: { account_id: string; reason: string } }>(
      `select object_id, context from public.audit_log where organization_id = $1 and action = 'stripe.account_unlinked'`,
      [f.orgId],
    );
    expect(audit.rows).toEqual([{ object_id: done.history_id, context: expect.objectContaining({ account_id: f.account, reason: "Moving to a new account" }) }]);
  });

  it("lets the firm connect another account afterwards, keeps one active link, and never one account for two firms", async () => {
    const f = await firm();
    const other = await firm();
    // One account, one active firm.
    await asStepUp(other);
    await expectDbError(() => db.query(`select public.record_firm_payment_account($1, $2, false)`, [other.orgId, f.account]), /already has a Stripe account|duplicate key/);

    const { invoiceId } = await startPayment(f, 70_000);
    await backdate(`invoice_id = $1`, [invoiceId], "2 days");
    await asStepUp(f);
    expect((await unlink(f)).unlinked).toBe(true);

    // Nothing reads the ended link: the client's checkout has no account and doesn't offer the old intent.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    const context = (await db.query<{ c: { account_id: string | null; open_payment_intent_id: string | null } }>(`select public.invoice_payment_context($1) as c`, [invoiceId])).rows[0].c;
    expect(context).toMatchObject({ account_id: null, open_payment_intent_id: null });
    await asStepUp(f);
    expect((await db.query<{ a: string | null }>(`select public.firm_payment_account_for_owner($1) as a`, [f.orgId])).rows[0].a).toBeNull();

    // Another firm can't take the ended account.
    await asStepUp(other);
    const freeOther = { ...other };
    await db.query(`select public.unlink_stripe_account($1, $2, 'DISCONNECT', 'Testing a move')`, [other.orgId, other.account]);
    await expectDbError(() => db.query(`select public.record_firm_payment_account($1, $2, false)`, [freeOther.orgId, f.account]), /belongs to another firm/);

    // The firm connects a new account (the move), and could reconnect its own old one later.
    const next = accountId();
    await asStepUp(f);
    await db.query(`select public.record_firm_payment_account($1, $2, false)`, [f.orgId, next]);
    expect((await currentLink(f.orgId)).map((row) => row.account_id)).toEqual([next]);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.record_firm_payment_account($1, $2, false)`, [f.orgId, f.account]), /already has a Stripe account/);
    expect(await unlink({ ...f, account: next })).toMatchObject({ unlinked: true });
    await asStepUp(f);
    await db.query(`select public.record_firm_payment_account($1, $2, false)`, [f.orgId, f.account]);
    expect((await currentLink(f.orgId)).map((row) => row.account_id)).toEqual([f.account]);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.firm_payment_account_history where organization_id = $1`, [f.orgId])).rows).toHaveLength(2);

    // A new payment goes to the current account only.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.record_invoice_payment_intent($1, $2, $3, 70000, 'cad', 0, false)`, [invoiceId, intentId(), next]), /does not match the firm/);
  });
});

type Closed = { unlinked: boolean; history_id: string; account_id: string; open_requests: { payment_id: string; payment_intent_id: string; invoice_number: string }[] };

async function paymentRow(intent: string) {
  await asMaintenance(db);
  return (await db.query<{ id: string; status: string; invoice_id: string }>(`select id, status, invoice_id from public.invoice_payments where payment_intent_id = $1`, [intent])).rows[0];
}

describe("closing the old account's open payment requests (bug 8 follow-up)", () => {
  it("returns every open request on the old account, of any age, and records what Stripe answered", async () => {
    const f = await firm();
    const { intent: stale } = await startPayment(f, 41_000);
    await backdate(`payment_intent_id = $1`, [stale], "3 days");
    const { intent: failed } = await startPayment(f, 42_000);
    expect((await paymentEvent(f, "payment_intent.payment_failed", failed, 42_000)).outcome).toBe("applied");
    const { intent: broken } = await startPayment(f, 43_000);
    await backdate(`payment_intent_id = $1`, [broken], "2 days");
    const { intent: paid } = await paidInvoice(f, 44_000);

    await asStepUp(f);
    const done = (await db.query<{ r: Closed }>(`select public.unlink_stripe_account($1, $2, 'DISCONNECT', 'Moving to a new account') as r`, [f.orgId, f.account])).rows[0].r;
    expect(done.unlinked).toBe(true);
    expect(done.account_id).toBe(f.account);
    expect(done.open_requests.map((item) => item.payment_intent_id).sort()).toEqual([stale, failed, broken].sort());
    expect(done.open_requests.map((item) => item.payment_intent_id)).not.toContain(paid);

    const ids: Record<string, string> = {};
    for (const intent of [stale, failed, broken]) ids[intent] = (await paymentRow(intent)).id;
    const results = [
      { payment_id: ids[stale], result: "canceled" },
      { payment_id: ids[failed], result: "already_finished" },
      { payment_id: ids[broken], result: "failed" },
    ];

    // Only the owner who disconnected it, with a fresh step-up, and only requests on that account.
    await asUser(db, { userId: f.finance, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.record_stripe_unlink_cancellations($1, $2::jsonb)`, [done.history_id, JSON.stringify(results)]), /step-up/);
    const other = await firm();
    const { intent: elsewhere } = await startPayment(other, 45_000);
    const foreign = (await paymentRow(elsewhere)).id;
    await asStepUp(f);
    await expectDbError(
      () => db.query(`select public.record_stripe_unlink_cancellations($1, $2::jsonb)`, [done.history_id, JSON.stringify([{ payment_id: "not-a-uuid", result: "canceled" }])]),
      /not on the disconnected account/,
    );
    await expectDbError(
      () => db.query(`select public.record_stripe_unlink_cancellations($1, $2::jsonb)`, [done.history_id, JSON.stringify([{ payment_id: foreign, result: "canceled" }])]),
      /not on the disconnected account/,
    );
    await expectDbError(() => db.query(`select public.record_stripe_unlink_cancellations($1, $2::jsonb)`, [done.history_id, JSON.stringify([{ payment_id: ids[stale], result: "maybe" }])]), /unknown result/);

    const recorded = (await db.query<{ r: { canceled: number; failed: number; task_id: string | null } }>(`select public.record_stripe_unlink_cancellations($1, $2::jsonb) as r`, [done.history_id, JSON.stringify(results)])).rows[0].r;
    expect(recorded).toMatchObject({ canceled: 1, failed: 1 });
    expect(recorded.task_id).toBeTruthy();
    await expectDbError(() => db.query(`select public.record_stripe_unlink_cancellations($1, $2::jsonb)`, [done.history_id, JSON.stringify(results)]), /already recorded/);

    expect((await paymentRow(stale)).status).toBe("canceled");
    expect((await paymentRow(failed)).status).toBe("failed");
    expect((await paymentRow(broken)).status).toBe("requires_payment");

    // The unlink stands; the failure is audited and is a task for the firm owner, due today in the firm's timezone.
    expect(await currentLink(f.orgId)).toEqual([]);
    await asMaintenance(db);
    const task = (
      await db.query<{ title: string; priority: string; due_on: string; today: string; owner_user: string }>(
        `select t.title, t.priority, t.due_on::text, app.firm_today(t.organization_id)::text as today, m.user_id as owner_user
         from public.tasks t join public.memberships m on m.id = t.owner_membership_id where t.id = $1`,
        [recorded.task_id],
      )
    ).rows[0];
    expect(task).toMatchObject({ title: "Cancel 1 card payment request on the disconnected Stripe account at Stripe", priority: "high", owner_user: f.owner });
    expect(task.due_on).toBe(task.today);
    const audit = (
      await db.query<{ result: string; context: { results: { payment_intent_id: string; result: string }[] } }>(
        `select result, context from public.audit_log where object_id = $1 and action = 'stripe.account_unlink_requests_closed'`,
        [done.history_id],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].result).toBe("failure");
    expect(audit[0].context.results.map((item) => `${item.payment_intent_id}:${item.result}`).sort()).toEqual([`${stale}:canceled`, `${failed}:already_finished`, `${broken}:failed`].sort());
  });

  it("still records a later Stripe event for a payment on the old account", async () => {
    const f = await firm();
    const { invoiceId, intent } = await startPayment(f, 46_000);
    await backdate(`payment_intent_id = $1`, [intent], "2 days");
    await asStepUp(f);
    const done = (await db.query<{ r: Closed }>(`select public.unlink_stripe_account($1, $2, 'DISCONNECT', 'Moving to a new account') as r`, [f.orgId, f.account])).rows[0].r;
    const paymentId = (await paymentRow(intent)).id;
    await asStepUp(f);
    await db.query(`select public.record_stripe_unlink_cancellations($1, $2::jsonb)`, [done.history_id, JSON.stringify([{ payment_id: paymentId, result: "canceled" }])]);
    expect((await paymentRow(intent)).status).toBe("canceled");

    // Stripe's own canceled event changes nothing; a payment that raced the cancel still lands.
    expect((await paymentEvent(f, "payment_intent.canceled", intent, 46_000)).outcome).toBe("unchanged");
    expect((await paymentEvent(f, "payment_intent.succeeded", intent, 46_000, 46_000)).outcome).toBe("applied");
    await asMaintenance(db);
    const invoice = (await db.query<{ status: string; paid_cents: string }>(`select status, paid_cents from public.invoices where id = $1`, [invoiceId])).rows[0];
    expect({ status: invoice.status, paid: Number(invoice.paid_cents) }).toEqual({ status: "paid", paid: 46_000 });
    const events = await db.query<{ outcome: string }>(`select outcome from public.invoice_payment_events where payment_id = $1 order by created_at`, [paymentId]);
    expect(events.rows.map((row) => row.outcome)).toEqual(["unchanged", "applied"]);
  });
});
