import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * FIN-02 (Connect status, earned-fee checkout only) and FIN-13 (dispute tasks and evidence, failed
 * refund tasks, overpayment credits), test mode, with synthetic Stripe ids only.
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
const fileId = () => `file_1Syn${token()}`;

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

/**
 * A firm with a connected account; two matters of the same applicant (a portal client), one of
 * another applicant; an assigned finance user (on the first matter only) and an unassigned one.
 */
async function firm() {
  const account = accountId();
  const owner = await createUser("owner");
  const finance = await createUser("finance");
  const otherFinance = await createUser("finance-unassigned");
  const client = await createUser("client");
  const stranger = await createUser("stranger");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${token(12)}`]);
  const orgId = created.rows[0].id;
  const financeMembership = await member(orgId, finance, "finance_user", owner);
  await member(orgId, otherFinance, "finance_user", owner);
  await member(orgId, client, "client", owner);
  await member(orgId, stranger, "client", owner);
  await asMaintenance(db);
  const matterId = randomUUID();
  const secondMatter = randomUUID();
  const otherMatter = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true), ($3, $2, 'Second matter', true), ($4, $2, 'Other matter', true)`, [
    matterId,
    orgId,
    secondMatter,
    otherMatter,
  ]);
  const person = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`, [orgId, client]);
  const strangerPerson = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Other applicant', true, $2) returning id`, [orgId, stranger]);
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $4, $3, 'applicant'), ($1, $5, $6, 'applicant')`,
    [orgId, matterId, person.rows[0].id, secondMatter, otherMatter, strangerPerson.rows[0].id],
  );
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [orgId, matterId, financeMembership]);
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.record_firm_payment_account($1, $2, false)`, [orgId, account]);
  return { owner, finance, otherFinance, client, stranger, orgId, matterId, secondMatter, otherMatter, account };
}

async function asStepUp(f: Firm, userId: string = f.owner) {
  await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
}

async function issue(f: Firm, amount = 113_000, matterId: string = f.matterId) {
  await asStepUp(f);
  const created = await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation stage', $2, 'CAD', $3::date, $4) as id`, [matterId, amount, firmDay(3), `inv-${randomUUID()}`]);
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

async function paidInvoice(f: Firm, amount = 113_000, matterId: string = f.matterId) {
  const invoiceId = await issue(f, amount, matterId);
  const intent = intentId();
  await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
  await db.query(`select public.record_invoice_payment_intent($1, $2, $3, $4, 'cad', 0, false)`, [invoiceId, intent, f.account, amount]);
  expect((await paymentEvent(f, "payment_intent.succeeded", intent, amount, amount)).outcome).toBe("applied");
  await asMaintenance(db);
  const payment = await db.query<{ id: string }>(`select id from public.invoice_payments where payment_intent_id = $1`, [intent]);
  return { invoiceId, paymentId: payment.rows[0].id, intent };
}

type Reversal = { type: string; object: string; intent: string; amount: number; status?: string | null; reason?: string | null; failure?: string | null; evidenceDue?: string | null; id?: string };

async function reversal(f: Firm, event: Reversal) {
  await asServiceRole(db);
  const result = await db.query<{ r: { outcome: string; refund_status?: string | null; dispute_status?: string | null } }>(
    `select public.apply_stripe_reversal_event($1, $2, $3, $4, $5, null, $6, 'cad', $7, $8, $9, $10::timestamptz, null, null, false, '{}'::jsonb) as r`,
    [event.id ?? eventId(), f.account, event.type, event.object, event.intent, event.amount, event.status ?? null, event.reason ?? null, event.failure ?? null, event.evidenceDue ?? null],
  );
  return result.rows[0].r;
}

async function requestRefund(f: Firm, paymentId: string, amount: number) {
  await asStepUp(f);
  const refund = refundId();
  const row = await db.query<{ id: string }>(`select public.record_invoice_refund($1, $2, $3, 'cad', 'requested_by_customer', false, $4) as id`, [paymentId, refund, amount, `rf-${randomUUID()}`]);
  return { id: row.rows[0].id, refund };
}

async function invoiceMoney(id: string) {
  await asMaintenance(db);
  const row = (await db.query<{ status: string; paid_cents: string }>(`select status, paid_cents from public.invoices where id = $1`, [id])).rows[0];
  return { status: row.status, paid: Number(row.paid_cents) };
}

/** Money arriving on an invoice from outside the card flow (a manual or client-account payment). */
async function overpay(invoiceId: string, cents: number) {
  await asMaintenance(db);
  await db.query(`update public.invoices set paid_cents = paid_cents + $2 where id = $1`, [invoiceId, cents]);
}

async function creditOf(invoiceId: string) {
  await asMaintenance(db);
  return (
    await db.query<{ id: string; number: string; status: string; opened_cents: string; available: string }>(
      `select credit.*, app.client_credit_available_cents(credit.id) as available from public.client_credits credit where source_invoice_id = $1`,
      [invoiceId],
    )
  ).rows[0];
}

describe("the connected account's status (FIN-02)", () => {
  it("lets the firm owner store Stripe's requirements and responsibilities, cleaned, and nobody else", async () => {
    const f = await firm();
    const requirements = [
      { description: "Provide the business's tax ID", due: "currently_due", from: "user", extra: "dropped" },
      { description: "Stripe is reviewing", due: "eventually_due", from: "stripe" },
      { description: "   " },
      "not an object",
    ];
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 3600 });
    await db.query(`select public.sync_firm_payment_account_status($1, $2, 'pending', 'pending', $3::jsonb, 'stripe', 'stripe')`, [f.orgId, f.account, JSON.stringify(requirements)]);
    await asMaintenance(db);
    const row = (await db.query<{ requirements: unknown; requirements_due: number; fees_collector: string; losses_collector: string; status_checked_at: Date | null }>(`select * from public.firm_payment_accounts where organization_id = $1`, [f.orgId])).rows[0];
    expect(row.requirements).toEqual([
      { description: "Provide the business's tax ID", due: "currently_due", from: "user" },
      { description: "Stripe is reviewing", due: "eventually_due", from: "stripe" },
    ]);
    expect(row.requirements_due).toBe(2);
    expect(row.fees_collector).toBe("stripe");
    expect(row.losses_collector).toBe("stripe");
    expect(row.status_checked_at).not.toBeNull();

    await asUser(db, { userId: f.finance, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.sync_firm_payment_account_status($1, $2, 'active', 'active', '[]'::jsonb, null, null)`, [f.orgId, f.account]), /./);
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.sync_firm_payment_account_status($1, $2, 'enabled', 'active', '[]'::jsonb, null, null)`, [f.orgId, f.account]), /unknown capability status/);
    await expectDbError(() => db.query(`select public.sync_firm_payment_account_status($1, $2, 'active', 'active', '[]'::jsonb, 'platform', null)`, [f.orgId, f.account]), /unknown fees collector/);
    // Another firm's account id changes nothing.
    await db.query(`select public.sync_firm_payment_account_status($1, $2, 'active', 'active', '[]'::jsonb, null, null)`, [f.orgId, accountId()]);
    await asMaintenance(db);
    expect((await db.query<{ card_payments_status: string }>(`select card_payments_status from public.firm_payment_accounts where organization_id = $1`, [f.orgId])).rows[0].card_payments_status).toBe("pending");
  });

  it("allows card checkout for earned-fee invoices only", async () => {
    const f = await firm();
    const invoiceId = await issue(f);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    expect((await db.query<{ c: unknown }>(`select public.invoice_card_checkout_check($1) as c`, [invoiceId])).rows[0].c).toEqual({ allowed: true, reason: null });
    await asUser(db, { userId: f.stranger, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.invoice_card_checkout_check($1)`, [invoiceId]), /invoice not found/);
    await asMaintenance(db);
    const kinds = await db.query<{ fee: boolean; dis: boolean; con: boolean; adv: boolean; nul: boolean }>(
      `select app.is_card_payable_category('professional_fee') as fee, app.is_card_payable_category('disbursement') as dis,
              app.is_card_payable_category('consultation_fee') as con, app.is_card_payable_category('advance') as adv,
              app.is_card_payable_category(null) as nul`,
    );
    expect(kinds.rows[0]).toEqual({ fee: true, dis: true, con: true, adv: false, nul: false });
  });
});

describe("disputes (FIN-13)", () => {
  it("opens a task for the firm owner on the invoice's matter, due on the evidence deadline in the firm's timezone, once", async () => {
    const f = await firm();
    const { intent } = await paidInvoice(f);
    const dispute = disputeId();
    const due = `${firmDay(10)}T15:00:00Z`;
    const opened = await reversal(f, { type: "charge.dispute.created", object: dispute, intent, amount: 113_000, status: "needs_response", reason: "fraudulent", evidenceDue: due });
    expect(opened).toMatchObject({ outcome: "applied", dispute_status: "needs_response" });
    await asMaintenance(db);
    const row = (await db.query<{ task_id: string; number: string }>(`select task_id, number from public.invoice_disputes where dispute_id = $1`, [dispute])).rows[0];
    expect(row.task_id).toBeTruthy();
    const task = (
      await db.query<{ title: string; matter_id: string; due_on: string; priority: string; audience: string; task_key: string; owner_user: string }>(
        `select t.title, t.matter_id, t.due_on::text, t.priority, t.audience, t.task_key, m.user_id as owner_user
         from public.tasks t join public.memberships m on m.id = t.owner_membership_id where t.id = $1`,
        [row.task_id],
      )
    ).rows[0];
    expect(task).toMatchObject({ matter_id: f.matterId, due_on: firmDay(10), priority: "critical", audience: "internal", task_key: "card_dispute", owner_user: f.owner });
    expect(task.title).toMatch(new RegExp(`^Respond to card dispute ${row.number} on INV-`));
    expect(Number((await db.query<{ n: string }>(`select count(*) as n from public.task_events where task_id = $1 and event_kind = 'created'`, [row.task_id])).rows[0].n)).toBe(1);

    // Updates and redelivery make no second task.
    await reversal(f, { type: "charge.dispute.updated", object: dispute, intent, amount: 113_000, status: "needs_response", evidenceDue: due });
    await asMaintenance(db);
    expect(Number((await db.query<{ n: string }>(`select count(*) as n from public.tasks where organization_id = $1 and task_key = 'card_dispute'`, [f.orgId])).rows[0].n)).toBe(1);
  });

  it("takes evidence from billing staff with a step-up while the dispute is open, and shows it only to them", async () => {
    const f = await firm();
    const { intent } = await paidInvoice(f);
    const dispute = disputeId();
    await reversal(f, { type: "charge.dispute.created", object: dispute, intent, amount: 113_000, status: "needs_response", evidenceDue: `${firmDay(10)}T15:00:00Z` });
    await asMaintenance(db);
    const id = (await db.query<{ id: string }>(`select id from public.invoice_disputes where dispute_id = $1`, [dispute])).rows[0].id;

    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 20 * 60 });
    await expectDbError(() => db.query(`select public.dispute_evidence_context($1)`, [id]), /step-up is required/);
    await asStepUp(f, f.otherFinance);
    await expectDbError(() => db.query(`select public.dispute_evidence_context($1)`, [id]), /billing access denied/);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.dispute_evidence_context($1)`, [id]), /./);

    await asStepUp(f, f.finance);
    const context = (await db.query<{ c: { dispute_id: string; account_id: string } }>(`select public.dispute_evidence_context($1) as c`, [id])).rows[0].c;
    expect(context).toMatchObject({ dispute_id: dispute, account_id: f.account });
    await expectDbError(
      () => db.query(`select public.record_dispute_evidence($1, $2, 'letter.pdf', 'application/pdf', 1200, 'Signed retainer', true, true)`, [id, fileId()]),
      /only test-mode evidence/,
    );
    await expectDbError(() => db.query(`select public.record_dispute_evidence($1, $2, 'letter.exe', 'application/x-msdownload', 1200, null, true, false)`, [id, fileId()]), /./);
    await db.query(`select public.record_dispute_evidence($1, $2, 'letter.pdf', 'application/pdf', 1200, 'Signed retainer and delivered work', true, false)`, [id, fileId()]);
    await asMaintenance(db);
    const row = (await db.query<{ evidence_submitted_at: Date | null; evidence_submitted_by: string }>(`select * from public.invoice_disputes where id = $1`, [id])).rows[0];
    expect(row.evidence_submitted_at).not.toBeNull();
    expect(row.evidence_submitted_by).toBe(f.finance);

    await asStepUp(f, f.finance);
    expect((await db.query(`select * from public.invoice_dispute_evidence where dispute_id = $1`, [id])).rows).toHaveLength(1);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    expect((await db.query(`select * from public.invoice_dispute_evidence where dispute_id = $1`, [id])).rows).toHaveLength(0);
    await asStepUp(f, f.otherFinance);
    expect((await db.query(`select * from public.invoice_dispute_evidence where dispute_id = $1`, [id])).rows).toHaveLength(0);
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.invoice_dispute_evidence set file_name = 'x.pdf' where dispute_id = $1`, [id]), /append-only/);

    // Under review: no more evidence.
    await reversal(f, { type: "charge.dispute.updated", object: dispute, intent, amount: 113_000, status: "under_review" });
    await asStepUp(f);
    await expectDbError(() => db.query(`select public.dispute_evidence_context($1)`, [id]), /no longer takes evidence/);
  });
});

describe("failed refunds (FIN-13)", () => {
  it("shows the reason and opens one task for the firm owner", async () => {
    const f = await firm();
    const { paymentId, intent } = await paidInvoice(f);
    const { id, refund } = await requestRefund(f, paymentId, 10_000);
    const failed = await reversal(f, { type: "refund.failed", object: refund, intent, amount: 10_000, status: "failed", failure: "expired_or_canceled_card" });
    expect(failed).toMatchObject({ outcome: "applied", refund_status: "failed" });
    await asMaintenance(db);
    const row = (await db.query<{ status: string; failure_reason: string; task_id: string; number: string }>(`select * from public.invoice_refunds where id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ status: "failed", failure_reason: "expired_or_canceled_card" });
    const task = (await db.query<{ title: string; due_on: string; task_key: string; matter_id: string }>(`select title, due_on::text, task_key, matter_id from public.tasks where id = $1`, [row.task_id])).rows[0];
    expect(task).toMatchObject({ due_on: firmDay(0), task_key: "refund_failed", matter_id: f.matterId });
    expect(task.title).toContain(`Refund ${row.number} failed`);
    expect(task.title).toContain("expired_or_canceled_card");
    await reversal(f, { type: "refund.updated", object: refund, intent, amount: 10_000, status: "failed", failure: "expired_or_canceled_card" });
    await asMaintenance(db);
    expect(Number((await db.query<{ n: string }>(`select count(*) as n from public.tasks where organization_id = $1 and task_key = 'refund_failed'`, [f.orgId])).rows[0].n)).toBe(1);
  });
});

describe("overpayments become a client credit (FIN-13)", () => {
  it("opens a credit for money above the balance and applies it to the same client's other invoice, keeping the link", async () => {
    const f = await firm();
    const { invoiceId } = await paidInvoice(f, 100_000);
    expect(await creditOf(invoiceId)).toBeUndefined();
    await overpay(invoiceId, 5_000);
    const credit = await creditOf(invoiceId);
    expect(credit).toMatchObject({ number: "CR-0001", status: "open" });
    expect(Number(credit.opened_cents)).toBe(5_000);
    expect(Number(credit.available)).toBe(5_000);

    const second = await issue(f, 20_000, f.secondMatter);
    const strangers = await issue(f, 20_000, f.otherMatter);

    // Billing staff with a step-up only.
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 20 * 60 });
    await expectDbError(() => db.query(`select public.apply_client_credit($1, $2, 5000, $3)`, [credit.id, second, `cc-${randomUUID()}`]), /step-up is required/);
    await asStepUp(f, f.otherFinance);
    await expectDbError(() => db.query(`select public.apply_client_credit($1, $2, 5000, $3)`, [credit.id, second, `cc-${randomUUID()}`]), /billing access denied/);

    await asStepUp(f);
    await expectDbError(() => db.query(`select public.apply_client_credit($1, $2, 5000, $3)`, [credit.id, strangers, `cc-${randomUUID()}`]), /same client/);
    await expectDbError(() => db.query(`select public.apply_client_credit($1, $2, 5001, $3)`, [credit.id, second, `cc-${randomUUID()}`]), /more than the credit available/);
    await expectDbError(() => db.query(`select public.apply_client_credit($1, $2, 5000, $3)`, [credit.id, invoiceId, `cc-${randomUUID()}`]), /another invoice/);
    const key = `cc-${randomUUID()}`;
    const allocation = (await db.query<{ id: string }>(`select public.apply_client_credit($1, $2, 5000, $3) as id`, [credit.id, second, key])).rows[0].id;
    // A retry with the same key is the same allocation.
    expect((await db.query<{ id: string }>(`select public.apply_client_credit($1, $2, 5000, $3) as id`, [credit.id, second, key])).rows[0].id).toBe(allocation);

    expect(await invoiceMoney(invoiceId)).toEqual({ status: "paid", paid: 100_000 });
    expect(await invoiceMoney(second)).toEqual({ status: "partially_paid", paid: 5_000 });
    expect(await creditOf(invoiceId)).toMatchObject({ status: "settled" });
    await asMaintenance(db);
    const link = (await db.query<{ kind: string; target_invoice_id: string; amount_cents: string }>(`select * from public.client_credit_allocations where credit_id = $1`, [credit.id])).rows;
    expect(link).toHaveLength(1);
    expect(link[0]).toMatchObject({ kind: "invoice", target_invoice_id: second });
    await expectDbError(() => db.query(`update public.client_credit_allocations set amount_cents = 1 where id = $1`, [allocation]), /append-only/);

    // The client and the unassigned finance user don't see credits; the assigned one does.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    expect((await db.query(`select * from public.client_credits`)).rows).toHaveLength(0);
    await asStepUp(f, f.otherFinance);
    expect((await db.query(`select * from public.client_credits`)).rows).toHaveLength(0);
    await asStepUp(f, f.finance);
    expect((await db.query(`select * from public.client_credits`)).rows).toHaveLength(1);
    expect((await db.query(`select * from public.client_credit_allocations`)).rows).toHaveLength(1);
  });

  it("refuses a bank refund while a card refund of that invoice is pending at Stripe, then records one", async () => {
    const f = await firm();
    const { invoiceId, paymentId, intent } = await paidInvoice(f, 100_000);
    await overpay(invoiceId, 5_000);
    const credit = await creditOf(invoiceId);

    // A card refund of the credit, pending at Stripe and linked.
    await asStepUp(f);
    const context = (await db.query<{ c: { payment_id: string; refundable: number; available: number } }>(`select public.client_credit_refund_context($1) as c`, [credit.id])).rows[0].c;
    expect(context).toMatchObject({ payment_id: paymentId, refundable: 100_000, available: 5_000 });
    const { id: refundRow, refund } = await requestRefund(f, paymentId, 3_000);
    await asStepUp(f);
    await db.query(`select public.link_client_credit_refund($1, $2)`, [credit.id, refundRow]);
    expect(Number((await creditOf(invoiceId)).available)).toBe(2_000);

    await asStepUp(f);
    await expectDbError(
      () => db.query(`select public.record_client_credit_bank_refund($1, 2000, 'e_transfer', 'ET-123', $2::date, $3)`, [credit.id, firmDay(0), `cb-${randomUUID()}`]),
      /card refund of this invoice is still pending/,
    );

    // Stripe confirms the card refund: the bank refund of what is left goes through.
    expect((await reversal(f, { type: "refund.updated", object: refund, intent, amount: 3_000, status: "succeeded" })).refund_status).toBe("succeeded");
    expect(Number((await creditOf(invoiceId)).available)).toBe(2_000);
    await asStepUp(f);
    await expectDbError(
      () => db.query(`select public.record_client_credit_bank_refund($1, 2000, 'e_transfer', 'ET-123', $2::date, $3)`, [credit.id, firmDay(1), `cb-${randomUUID()}`]),
      /future/,
    );
    await expectDbError(
      () => db.query(`select public.record_client_credit_bank_refund($1, 2001, 'e_transfer', 'ET-123', $2::date, $3)`, [credit.id, firmDay(0), `cb-${randomUUID()}`]),
      /more than the credit available/,
    );
    await db.query(`select public.record_client_credit_bank_refund($1, 2000, 'e_transfer', 'ET-123', $2::date, $3)`, [credit.id, firmDay(0), `cb-${randomUUID()}`]);
    expect(await creditOf(invoiceId)).toMatchObject({ status: "settled" });
    await asMaintenance(db);
    const kinds = (await db.query<{ kind: string }>(`select kind from public.client_credit_allocations where credit_id = $1 order by created_at`, [credit.id])).rows.map((row) => row.kind);
    expect(kinds).toEqual(["card_refund", "bank_refund"]);
  });

  it("keeps each firm's credits to itself", async () => {
    const a = await firm();
    const b = await firm();
    const { invoiceId } = await paidInvoice(a, 100_000);
    await overpay(invoiceId, 1_000);
    const credit = await creditOf(invoiceId);
    await asStepUp(b);
    expect((await db.query(`select * from public.client_credits where id = $1`, [credit.id])).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.client_credit_refund_context($1)`, [credit.id]), /billing access denied/);
  });
});
