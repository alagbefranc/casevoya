import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/** Refunds and disputes on card payments (FIN-13), test mode, with synthetic Stripe ids only. */

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
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, by],
  );
  return row.rows[0].id;
}

type Firm = Awaited<ReturnType<typeof firm>>;

/** A firm with a connected account, a sample matter, its applicant (a portal client), an unassigned finance user and an outsider client. */
async function firm() {
  const account = accountId();
  const owner = await createUser("owner");
  const finance = await createUser("finance");
  const otherFinance = await createUser("finance-unassigned");
  const assistant = await createUser("assistant");
  const client = await createUser("client");
  const stranger = await createUser("stranger");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${token(12)}`]);
  const orgId = created.rows[0].id;
  const financeMembership = await member(orgId, finance, "finance_user", owner);
  await member(orgId, otherFinance, "finance_user", owner);
  await member(orgId, assistant, "assistant", owner);
  await member(orgId, client, "client", owner);
  await member(orgId, stranger, "client", owner);
  await asMaintenance(db);
  const matterId = randomUUID();
  const otherMatter = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true), ($3, $2, 'Other matter', true)`, [matterId, orgId, otherMatter]);
  const person = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`, [orgId, client]);
  const strangerPerson = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Other applicant', true, $2) returning id`, [orgId, stranger]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $4, $5, 'applicant')`, [
    orgId,
    matterId,
    person.rows[0].id,
    otherMatter,
    strangerPerson.rows[0].id,
  ]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [orgId, matterId, financeMembership]);
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.record_firm_payment_account($1, $2, false)`, [orgId, account]);
  return { owner, finance, otherFinance, assistant, client, stranger, orgId, matterId, account };
}

const inThreeDays = () => firmDay(3);

async function issue(f: Firm, amount = 113_000) {
  await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation stage', $2, 'CAD', $3::date, $4) as id`, [f.matterId, amount, inThreeDays(), `inv-${randomUUID()}`]);
  return created.rows[0].id;
}

async function paymentEvent(f: Firm, type: string, intent: string, amount: number, received = 0) {
  await asServiceRole(db);
  const result = await db.query<{ r: { outcome: string } }>(
    `select public.apply_stripe_payment_event($1, $2, $3, $4, $5, $6, 'cad', false, null, '{}'::jsonb) as r`,
    [eventId(), f.account, type, intent, amount, received],
  );
  return result.rows[0].r;
}

/** An issued invoice the client paid in full by card; returns the invoice and payment ids. */
async function paidInvoice(f: Firm, amount = 113_000) {
  const invoiceId = await issue(f, amount);
  const intent = intentId();
  await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
  await db.query(`select public.record_invoice_payment_intent($1, $2, $3, $4, 'cad', 0, false)`, [invoiceId, intent, f.account, amount]);
  expect((await paymentEvent(f, "payment_intent.succeeded", intent, amount, amount)).outcome).toBe("applied");
  await asMaintenance(db);
  const payment = await db.query<{ id: string }>(`select id from public.invoice_payments where payment_intent_id = $1`, [intent]);
  return { invoiceId, paymentId: payment.rows[0].id, intent };
}

async function asStepUp(f: Firm, userId: string = f.owner) {
  await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
}

async function requestRefund(f: Firm, paymentId: string, amount: number, options: { refund?: string; key?: string | null; reason?: string | null; userId?: string } = {}) {
  await asStepUp(f, options.userId ?? f.owner);
  const refund = options.refund ?? refundId();
  const row = await db.query<{ id: string }>(`select public.record_invoice_refund($1, $2, $3, 'cad', $4, false, $5) as id`, [
    paymentId,
    refund,
    amount,
    options.reason === undefined ? "requested_by_customer" : options.reason,
    options.key === undefined ? `rf-${randomUUID()}` : options.key,
  ]);
  return { id: row.rows[0].id, refund };
}

type Reversal = {
  id?: string;
  type: string;
  object: string;
  intent: string;
  amount: number;
  status?: string | null;
  account?: string;
  currency?: string;
  reason?: string | null;
  failure?: string | null;
  evidenceDue?: string | null;
  amountRefunded?: number | null;
  created?: number | null;
  livemode?: boolean;
};

async function reversal(f: Firm, event: Reversal) {
  await asServiceRole(db);
  const result = await db.query<{ r: { outcome: string; detail?: string | null; refund_status?: string | null; dispute_status?: string | null; invoice_status?: string } }>(
    `select public.apply_stripe_reversal_event($1, $2, $3, $4, $5, null, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13, $14, '{}'::jsonb) as r`,
    [
      event.id ?? eventId(),
      event.account ?? f.account,
      event.type,
      event.object,
      event.intent,
      event.amount,
      event.currency ?? "cad",
      event.status ?? null,
      event.reason ?? null,
      event.failure ?? null,
      event.evidenceDue ?? null,
      event.amountRefunded ?? null,
      event.created ?? null,
      event.livemode ?? false,
    ],
  );
  return result.rows[0].r;
}

async function invoiceRow(id: string) {
  await asMaintenance(db);
  const row = await db.query<{ status: string; paid_cents: string; refunded_cents: string }>(`select status, paid_cents, refunded_cents from public.invoices where id = $1`, [id]);
  return { status: row.rows[0].status, paid: Number(row.rows[0].paid_cents), refunded: Number(row.rows[0].refunded_cents) };
}

async function refundRow(id: string) {
  await asMaintenance(db);
  return (await db.query<{ status: string; number: string; amount_cents: string; failure_reason: string | null; requested_by: string | null }>(`select * from public.invoice_refunds where id = $1`, [id])).rows[0];
}

async function refundable(f: Firm, paymentId: string) {
  await asStepUp(f);
  const context = await db.query<{ c: { refundable: number; received: number; payment_intent_id: string; account_id: string } }>(`select public.invoice_refund_context($1) as c`, [paymentId]);
  return context.rows[0].c;
}

describe("refunding a card payment", () => {
  it("needs the firm owner or the matter's finance user, at aal2 with a recent step-up", async () => {
    const f = await firm();
    const { paymentId, intent } = await paidInvoice(f);

    // No step-up: the same refusal the Sheet turns into the step-up screen.
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 20 * 60 });
    await expectDbError(() => db.query(`select public.invoice_refund_context($1)`, [paymentId]), /step-up is required/);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 100, 'cad', null, false, null)`, [paymentId, refundId()]), /step-up is required/);
    await asUser(db, { userId: f.owner, aal: "aal1", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.invoice_refund_context($1)`, [paymentId]), /billing access denied/);

    // Not billing staff for this matter.
    for (const userId of [f.otherFinance, f.assistant]) {
      await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
      await expectDbError(() => db.query(`select public.invoice_refund_context($1)`, [paymentId]), /billing access denied/);
    }
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.invoice_refund_context($1)`, [paymentId]), /billing access denied|permission denied/);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 100, 'cad', null, false, null)`, [paymentId, refundId()]), /billing access denied|permission denied/);

    // The owner and the assigned finance user, with step-up.
    const context = await refundable(f, paymentId);
    expect(context).toMatchObject({ refundable: 113_000, received: 113_000, payment_intent_id: intent, account_id: f.account });
    await asStepUp(f, f.finance);
    const viaFinance = await db.query<{ c: { refundable: number } }>(`select public.invoice_refund_context($1) as c`, [paymentId]);
    expect(viaFinance.rows[0].c.refundable).toBe(113_000);
    const made = await requestRefund(f, paymentId, 1_000, { userId: f.finance });
    expect((await refundRow(made.id)).requested_by).toBe(f.finance);

    // No API role writes the tables directly.
    await asStepUp(f);
    await expectDbError(() => db.query(`update public.invoice_refunds set status = 'succeeded'`), /permission denied/);
    await expectDbError(() => db.query(`update public.invoices set refunded_cents = 0`), /permission denied/);
  });

  it("refuses a payment that was not received, a live refund, another currency or a bad reason", async () => {
    const f = await firm();
    const invoiceId = await issue(f);
    const intent = intentId();
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await db.query(`select public.record_invoice_payment_intent($1, $2, $3, 113000, 'cad', 0, false)`, [invoiceId, intent, f.account]);
    await asMaintenance(db);
    const pending = (await db.query<{ id: string }>(`select id from public.invoice_payments where payment_intent_id = $1`, [intent])).rows[0].id;
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.invoice_refund_context($1)`, [pending]), /only a received card payment/);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 100, 'cad', null, false, null)`, [pending, refundId()]), /only a received card payment/);

    const { paymentId } = await paidInvoice(f);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 100, 'cad', null, true, null)`, [paymentId, refundId()]), /test-mode/);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 100, 'usd', null, false, null)`, [paymentId, refundId()]), /currency/);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, 'ch_notARefund01', 100, 'cad', null, false, null)`, [paymentId]), /refund id is invalid/);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 100, 'cad', 'because', false, null)`, [paymentId, refundId()]), /reason/);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 0, 'cad', null, false, null)`, [paymentId, refundId()]), /positive/);
  });

  it("never refunds more than was received, counting pending refunds; a failed refund frees its amount", async () => {
    const f = await firm();
    const { paymentId, intent } = await paidInvoice(f, 50_000);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 50001, 'cad', null, false, null)`, [paymentId, refundId()]), /exceeds the amount received/);

    const first = await requestRefund(f, paymentId, 30_000);
    expect((await refundRow(first.id)).status).toBe("pending");
    expect((await refundRow(first.id)).number).toBe("RF-0001");
    expect((await refundable(f, paymentId)).refundable).toBe(20_000);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 20001, 'cad', null, false, null)`, [paymentId, refundId()]), /exceeds the amount received/);

    // Stripe says the first refund failed: its amount can be refunded again.
    const failed = await reversal(f, { type: "refund.failed", object: first.refund, intent, amount: 30_000, status: "failed", failure: "expired_or_canceled_card" });
    expect(failed).toMatchObject({ outcome: "applied", refund_status: "failed", invoice_status: "paid" });
    expect((await refundRow(first.id)).failure_reason).toBe("expired_or_canceled_card");
    expect((await refundable(f, paymentId)).refundable).toBe(50_000);
    const second = await requestRefund(f, paymentId, 50_000);
    expect((await refundRow(second.id)).number).toBe("RF-0002");
    expect((await refundable(f, paymentId)).refundable).toBe(0);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 1, 'cad', null, false, null)`, [paymentId, refundId()]), /exceeds the amount received/);
  });

  it("partial then full: the invoice stays paid and shows the refund, then turns refunded; the matter does not move", async () => {
    const f = await firm();
    await asMaintenance(db);
    const before = (await db.query<{ stage: string; government_status: string }>(`select stage, government_status from public.matters where id = $1`, [f.matterId])).rows[0];
    const { invoiceId, paymentId, intent } = await paidInvoice(f);

    const partial = await requestRefund(f, paymentId, 13_000);
    expect(await invoiceRow(invoiceId)).toEqual({ status: "paid", paid: 113_000, refunded: 0 });
    const done = await reversal(f, { type: "refund.updated", object: partial.refund, intent, amount: 13_000, status: "succeeded" });
    expect(done).toMatchObject({ outcome: "applied", refund_status: "succeeded", invoice_status: "paid" });
    expect(await invoiceRow(invoiceId)).toEqual({ status: "paid", paid: 113_000, refunded: 13_000 });

    const rest = await requestRefund(f, paymentId, 100_000);
    const full = await reversal(f, { type: "refund.created", object: rest.refund, intent, amount: 100_000, status: "succeeded" });
    expect(full).toMatchObject({ outcome: "applied", refund_status: "succeeded", invoice_status: "refunded" });
    expect(await invoiceRow(invoiceId)).toEqual({ status: "refunded", paid: 113_000, refunded: 113_000 });
    await asMaintenance(db);
    const payment = (await db.query<{ refunded_cents: string; status: string }>(`select refunded_cents, status from public.invoice_payments where id = $1`, [paymentId])).rows[0];
    expect(Number(payment.refunded_cents)).toBe(113_000);
    expect(payment.status).toBe("succeeded");
    const after = (await db.query<{ stage: string; government_status: string }>(`select stage, government_status from public.matters where id = $1`, [f.matterId])).rows[0];
    expect(after).toEqual(before);

    // The charge's running total is a check only.
    const check = await reversal(f, { type: "charge.refunded", object: "ch_3SynCharge0001", intent, amount: 113_000, amountRefunded: 113_000 });
    expect(check).toMatchObject({ outcome: "unchanged", detail: "refund total matches" });

    // A refunded invoice is not open for payment.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.invoice_payment_context($1)`, [invoiceId]), /not open for payment/);
    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where organization_id = $1 and action like 'invoice.refund_%' order by occurred_at`, [f.orgId]);
    expect(audit.rows.map((row) => row.action)).toEqual(["invoice.refund_requested", "invoice.refund_succeeded", "invoice.refund_requested", "invoice.refund_succeeded"]);
  });

  it("is idempotent: the same refund recorded twice, the same event twice, the same key reused", async () => {
    const f = await firm();
    const { invoiceId, paymentId, intent } = await paidInvoice(f);
    const key = `rf-${randomUUID()}`;
    const first = await requestRefund(f, paymentId, 10_000, { key });
    const again = await requestRefund(f, paymentId, 10_000, { key, refund: first.refund });
    expect(again.id).toBe(first.id);
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 10000, 'cad', null, false, $3)`, [paymentId, refundId(), key]), /idempotency key/);

    const id = eventId();
    expect((await reversal(f, { id, type: "refund.updated", object: first.refund, intent, amount: 10_000, status: "succeeded" })).outcome).toBe("applied");
    expect((await reversal(f, { id, type: "refund.updated", object: first.refund, intent, amount: 10_000, status: "succeeded" })).outcome).toBe("duplicate");
    expect(await invoiceRow(invoiceId)).toMatchObject({ refunded: 10_000 });
    await asMaintenance(db);
    const events = await db.query<{ n: number }>(`select count(*)::int as n from public.invoice_reversal_events where refund_id = $1`, [first.id]);
    expect(events.rows[0].n).toBe(1);
    const inbox = await db.query<{ n: number }>(`select count(*)::int as n from public.webhook_inbox where provider = 'stripe' and event_id = $1`, [id]);
    expect(inbox.rows[0].n).toBe(1);
    await expectDbError(() => db.query(`update public.invoice_reversal_events set outcome = 'applied' where refund_id = $1`, [first.id]), /append-only/);
    await expectDbError(() => db.query(`delete from public.invoice_reversal_events where refund_id = $1`, [first.id]), /append-only/);
  });

  it("keeps a refund's final state whatever order the events arrive in", async () => {
    const f = await firm();
    const { invoiceId, paymentId, intent } = await paidInvoice(f);
    const a = await requestRefund(f, paymentId, 20_000);
    // Succeeded arrives before created (pending): the late pending, and a late failure, change nothing.
    expect((await reversal(f, { type: "refund.updated", object: a.refund, intent, amount: 20_000, status: "succeeded" })).outcome).toBe("applied");
    expect(await reversal(f, { type: "refund.created", object: a.refund, intent, amount: 20_000, status: "pending" })).toMatchObject({ outcome: "unchanged", refund_status: "succeeded" });
    expect(await reversal(f, { type: "refund.failed", object: a.refund, intent, amount: 20_000, status: "failed" })).toMatchObject({ outcome: "unchanged", refund_status: "succeeded" });
    expect((await refundRow(a.id)).status).toBe("succeeded");
    expect(await invoiceRow(invoiceId)).toMatchObject({ status: "paid", refunded: 20_000 });

    // A failed refund stays failed.
    const b = await requestRefund(f, paymentId, 5_000);
    expect((await reversal(f, { type: "refund.failed", object: b.refund, intent, amount: 5_000, status: "failed" })).outcome).toBe("applied");
    expect(await reversal(f, { type: "refund.updated", object: b.refund, intent, amount: 5_000, status: "succeeded" })).toMatchObject({ outcome: "unchanged", refund_status: "failed" });
    expect(await invoiceRow(invoiceId)).toMatchObject({ refunded: 20_000 });

    // Account, amount and currency must match.
    const c = await requestRefund(f, paymentId, 7_000);
    expect((await reversal(f, { type: "refund.updated", object: c.refund, intent, amount: 7_001, status: "succeeded" })).outcome).toBe("rejected");
    expect((await reversal(f, { type: "refund.updated", object: c.refund, intent, amount: 7_000, status: "succeeded", currency: "usd" })).outcome).toBe("rejected");
    expect((await reversal(f, { type: "refund.updated", object: c.refund, intent, amount: 7_000, status: "succeeded", account: accountId() })).outcome).toBe("rejected");
    expect((await reversal(f, { type: "refund.updated", object: c.refund, intent, amount: 7_000, status: "succeeded", livemode: true })).outcome).toBe("ignored");
    expect((await refundRow(c.id)).status).toBe("pending");
  });

  it("recovers a refund Stripe made before Casevoya recorded it, and still refuses an over-refund", async () => {
    const f = await firm();
    const { invoiceId, paymentId, intent } = await paidInvoice(f, 40_000);
    const early = refundId();
    const result = await reversal(f, { type: "refund.created", object: early, intent, amount: 15_000, status: "pending", reason: "duplicate" });
    expect(result).toMatchObject({ outcome: "applied", refund_status: "pending" });
    // The server action's record call, arriving after, finds the same row and keeps who asked.
    const recorded = await requestRefund(f, paymentId, 15_000, { refund: early });
    const row = await refundRow(recorded.id);
    expect(row.requested_by).toBe(f.owner);
    expect(row.number).toBe("RF-0001");
    expect((await refundable(f, paymentId)).refundable).toBe(25_000);
    expect((await reversal(f, { type: "refund.created", object: refundId(), intent, amount: 25_001, status: "pending" })).outcome).toBe("rejected");
    expect(await invoiceRow(invoiceId)).toMatchObject({ status: "paid", refunded: 0 });
  });
});

describe("disputes", () => {
  it("records a dispute with its status, amount, reason and evidence deadline, moving only forward", async () => {
    const f = await firm();
    const { invoiceId, intent } = await paidInvoice(f);
    const dispute = disputeId();
    const due = "2026-11-02T23:59:59Z";
    const opened = await reversal(f, { type: "charge.dispute.created", object: dispute, intent, amount: 113_000, status: "needs_response", reason: "fraudulent", evidenceDue: due, created: 100 });
    expect(opened).toMatchObject({ outcome: "applied", dispute_status: "needs_response", invoice_status: "paid" });
    await asMaintenance(db);
    const row = (await db.query<{ number: string; status: string; reason: string; amount_cents: string; evidence_due_by: Date }>(`select * from public.invoice_disputes where dispute_id = $1`, [dispute])).rows[0];
    expect(row).toMatchObject({ number: "DP-0001", status: "needs_response", reason: "fraudulent" });
    expect(Number(row.amount_cents)).toBe(113_000);
    expect(new Date(row.evidence_due_by).toISOString()).toBe("2026-11-02T23:59:59.000Z");

    expect((await reversal(f, { type: "charge.dispute.updated", object: dispute, intent, amount: 113_000, status: "under_review", created: 300 })).outcome).toBe("applied");
    // An older event (needs_response, or an earlier timestamp) does not move it back.
    expect(await reversal(f, { type: "charge.dispute.updated", object: dispute, intent, amount: 113_000, status: "needs_response", created: 200 })).toMatchObject({ outcome: "unchanged", dispute_status: "under_review" });
    const closed = await reversal(f, { type: "charge.dispute.closed", object: dispute, intent, amount: 113_000, status: "lost", created: 400 });
    expect(closed).toMatchObject({ outcome: "applied", dispute_status: "lost" });
    expect(await reversal(f, { type: "charge.dispute.updated", object: dispute, intent, amount: 113_000, status: "under_review", created: 500 })).toMatchObject({ outcome: "unchanged", dispute_status: "lost" });
    // Disputes are recorded, not acted on: the invoice keeps its payment state.
    expect((await invoiceRow(invoiceId)).status).toBe("paid");

    // More than the payment received, another account, or an unknown payment.
    expect((await reversal(f, { type: "charge.dispute.created", object: disputeId(), intent, amount: 113_001, status: "needs_response" })).outcome).toBe("rejected");
    expect((await reversal(f, { type: "charge.dispute.created", object: disputeId(), intent, amount: 1_000, status: "needs_response", account: accountId() })).outcome).toBe("rejected");
    expect((await reversal(f, { type: "charge.dispute.created", object: disputeId(), intent: intentId(), amount: 1_000, status: "needs_response" })).outcome).toBe("ignored");
  });
});

describe("who sees refunds and disputes", () => {
  it("only service_role applies events", async () => {
    const f = await firm();
    const { intent } = await paidInvoice(f);
    for (const session of [
      { userId: f.owner, aal: "aal2" as const, orgId: f.orgId, totpAgeSeconds: 0 },
      { userId: f.client, aal: "aal1" as const, orgId: f.orgId },
    ]) {
      await asUser(db, session);
      await expectDbError(
        () => db.query(`select public.apply_stripe_reversal_event('evt_x', $1, 'refund.updated', 're_3SynX000001', $2, null, 1, 'cad', 'succeeded', null, null, null, null, null, false, '{}'::jsonb)`, [f.account, intent]),
        /permission denied/,
      );
    }
  });

  it("billing staff and the paying client read them; other clients, other staff and other firms do not", async () => {
    const f = await firm();
    const g = await firm();
    const { paymentId, intent } = await paidInvoice(f);
    const refund = await requestRefund(f, paymentId, 1_000);
    await reversal(f, { type: "refund.updated", object: refund.refund, intent, amount: 1_000, status: "succeeded" });
    await reversal(f, { type: "charge.dispute.created", object: disputeId(), intent, amount: 5_000, status: "warning_needs_response" });

    const count = async (table: string) => (await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0].n;
    await asStepUp(f);
    expect([await count("invoice_refunds"), await count("invoice_disputes"), await count("invoice_reversal_events")]).toEqual([1, 1, 2]);
    await asUser(db, { userId: f.finance, aal: "aal2", orgId: f.orgId });
    expect([await count("invoice_refunds"), await count("invoice_disputes")]).toEqual([1, 1]);

    // The client who is a party on the matter sees the refund and dispute on their invoice, not the event log.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    expect([await count("invoice_refunds"), await count("invoice_disputes"), await count("invoice_reversal_events")]).toEqual([1, 1, 0]);
    const seen = await db.query<{ refunded_cents: string; status: string }>(`select refunded_cents, status from public.invoices`);
    expect(seen.rows.map((row) => [Number(row.refunded_cents), row.status])).toEqual([[1_000, "paid"]]);

    for (const userId of [f.stranger, f.otherFinance, f.assistant]) {
      await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
      expect([await count("invoice_refunds"), await count("invoice_disputes"), await count("invoice_reversal_events")]).toEqual([0, 0, 0]);
    }

    // Another firm's owner sees nothing of this firm, in either workspace, and cannot refund its payment.
    for (const orgId of [g.orgId, f.orgId]) {
      await asUser(db, { userId: g.owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
      expect([await count("invoice_refunds"), await count("invoice_disputes"), await count("invoice_reversal_events")]).toEqual([0, 0, 0]);
    }
    await asUser(db, { userId: g.owner, aal: "aal2", orgId: g.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.invoice_refund_context($1)`, [paymentId]), /billing access denied/);
    await expectDbError(() => db.query(`select public.record_invoice_refund($1, $2, 1, 'cad', null, false, null)`, [paymentId, refundId()]), /billing access denied/);
    // Firm G's account cannot move firm F's refund.
    expect((await reversal(f, { type: "refund.updated", object: refund.refund, intent, amount: 1_000, status: "failed", account: g.account })).outcome).toBe("rejected");
  });
});
