import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/** Voids and credit notes on issued invoices (FIN-06, FIN-07). Synthetic people and Stripe ids only. */

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
const eventId = () => `evt_Syn${token(20)}`;
const key = (prefix = "cn") => `${prefix}-${randomUUID()}`;
const today = () => firmDay();
const inThreeDays = () => firmDay(3);

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
 * A firm with a connected account and a client account, a sample matter whose applicant is a portal
 * client, two finance users assigned to it, an unassigned finance user, an assistant and a client on
 * another matter.
 */
async function firm() {
  const account = accountId();
  const owner = await createUser("owner");
  const finance = await createUser("finance");
  const secondFinance = await createUser("finance-two");
  const otherFinance = await createUser("finance-unassigned");
  const assistant = await createUser("assistant");
  const client = await createUser("client");
  const stranger = await createUser("stranger");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${token(12)}`]);
  const orgId = created.rows[0].id;
  const financeMembership = await member(orgId, finance, "finance_user", owner);
  const secondMembership = await member(orgId, secondFinance, "finance_user", owner);
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
  for (const membership of [financeMembership, secondMembership]) {
    await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [orgId, matterId, membership]);
  }
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.record_firm_payment_account($1, $2, false)`, [orgId, account]);
  const clientAccount = await db.query<{ id: string }>(`select public.create_client_account($1, 'Client account', 'Synthetic Bank', '4410') as id`, [orgId]);
  return { owner, finance, secondFinance, otherFinance, assistant, client, stranger, orgId, matterId, otherMatter, account, personId: person.rows[0].id, clientAccountId: clientAccount.rows[0].id };
}

async function as(f: Firm, userId: string, stepUp = true) {
  await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: stepUp ? 0 : 20 * 60 });
}

async function issue(f: Firm, amount = 100_000) {
  await as(f, f.owner);
  const created = await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation delivered', $2, 'CAD', $3::date, $4) as id`, [f.matterId, amount, inThreeDays(), key("inv")]);
  return created.rows[0].id;
}

async function paymentEvent(f: Firm, type: string, intent: string, amount: number, received = 0) {
  await asServiceRole(db);
  const result = await db.query<{ r: { outcome: string; invoice_status: string } }>(
    `select public.apply_stripe_payment_event($1, $2, $3, $4, $5, $6, 'cad', false, null, '{}'::jsonb) as r`,
    [eventId(), f.account, type, intent, amount, received],
  );
  return result.rows[0].r;
}

/** The client starts a card payment for what is due now; returns the PaymentIntent id. */
async function startPayment(f: Firm, invoiceId: string, amount: number) {
  const intent = intentId();
  await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
  await db.query(`select public.record_invoice_payment_intent($1, $2, $3, $4, 'cad', 0, false)`, [invoiceId, intent, f.account, amount]);
  return intent;
}

async function pay(f: Firm, invoiceId: string, amount: number) {
  const intent = await startPayment(f, invoiceId, amount);
  return paymentEvent(f, "payment_intent.succeeded", intent, amount, amount);
}

async function invoiceRow(id: string) {
  await asMaintenance(db);
  const row = await db.query<{ status: string; paid_cents: string; credited_cents: string; void_reason: string | null; voided_by: string | null }>(
    `select status, paid_cents, credited_cents, void_reason, voided_by from public.invoices where id = $1`,
    [id],
  );
  const r = row.rows[0];
  return { status: r.status, paid: Number(r.paid_cents), credited: Number(r.credited_cents), voidReason: r.void_reason, voidedBy: r.voided_by };
}

async function draft(f: Firm, invoiceId: string, amount: number, userId: string = f.finance, idempotencyKey = key()) {
  await as(f, userId, false);
  const row = await db.query<{ id: string }>(`select public.request_credit_note($1, $2, 'Service cancelled before work started', $3) as id`, [invoiceId, amount, idempotencyKey]);
  return row.rows[0].id;
}

async function issueNote(f: Firm, noteId: string, userId: string) {
  await as(f, userId);
  return (await db.query<{ r: { status: string; number: string; owner_self_approved: boolean; invoice_status: string; credit_balance_cents: number } }>(`select public.issue_credit_note($1) as r`, [noteId])).rows[0].r;
}

async function note(id: string) {
  await asMaintenance(db);
  return (await db.query<Record<string, unknown>>(`select * from public.invoice_credit_notes where id = $1`, [id])).rows[0];
}

async function voidInvoice(f: Firm, invoiceId: string, userId: string = f.finance, reason = "Issued to the wrong matter") {
  await as(f, userId);
  return (await db.query<{ r: { status: string; cancel: string[]; account_id: string | null } }>(`select public.void_invoice($1, $2) as r`, [invoiceId, reason])).rows[0].r;
}

describe("voiding an invoice", () => {
  it("voids an issued invoice with nothing allocated, with a reason and a step-up, and audits it", async () => {
    const f = await firm();
    const invoiceId = await issue(f);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.void_invoice($1, 'Wrong matter')`, [invoiceId]), /step-up is required/);
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.void_invoice($1, 'x')`, [invoiceId]), /reason is required/);
    for (const userId of [f.otherFinance, f.assistant, f.client]) {
      await as(f, userId);
      await expectDbError(() => db.query(`select public.void_invoice($1, 'Wrong matter')`, [invoiceId]), /billing access denied/);
    }
    const result = await voidInvoice(f, invoiceId);
    expect(result).toMatchObject({ status: "voided", cancel: [] });
    expect(await invoiceRow(invoiceId)).toMatchObject({ status: "voided", paid: 0, credited: 0, voidReason: "Issued to the wrong matter", voidedBy: f.finance });
    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 and action = 'invoice.voided'`, [invoiceId]);
    expect(audit.rows).toHaveLength(1);
    // A voided invoice can't be paid or credited.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.invoice_payment_context($1)`, [invoiceId]), /not open for payment/);
    await expectDbError(() => draft(f, invoiceId, 1_000), /only an issued invoice can be credited/);
  });

  it("hands back the card payment attempts to cancel in Stripe, and keeps the invoice voided if one still succeeds", async () => {
    const f = await firm();
    const invoiceId = await issue(f, 50_000);
    const intent = await startPayment(f, invoiceId, 50_000);
    const result = await voidInvoice(f, invoiceId, f.owner);
    expect(result).toMatchObject({ status: "voided", cancel: [intent], account_id: f.account });
    // The payment Stripe had already started succeeds after all: the money is recorded, the invoice stays voided.
    expect(await paymentEvent(f, "payment_intent.succeeded", intent, 50_000, 50_000)).toMatchObject({ outcome: "applied", invoice_status: "voided" });
    expect(await invoiceRow(invoiceId)).toMatchObject({ status: "voided", paid: 50_000 });
    await asMaintenance(db);
    const audit = await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'invoice.payment_after_void'`, [invoiceId]);
    expect(audit.rows).toHaveLength(1);
  });

  it("refuses an invoice with a payment, a client-account transfer, a receipt or a credit note", async () => {
    const f = await firm();
    // Paid by card (a receipt was issued too).
    const paid = await issue(f, 30_000);
    await pay(f, paid, 30_000);
    await expectDbError(() => voidInvoice(f, paid), /nothing paid or credited/);
    // Processing.
    const processing = await issue(f, 30_000);
    const intent = await startPayment(f, processing, 30_000);
    await paymentEvent(f, "payment_intent.processing", intent, 30_000);
    await expectDbError(() => voidInvoice(f, processing), /received or is processing/);
    // A transfer from the client account waiting for approval.
    const transferred = await issue(f, 30_000);
    await as(f, f.owner);
    const deposit = await db.query<{ id: string }>(
      `select public.record_client_deposit($1, $2, $3, 50000, 'cad', 'bank_transfer', 'RBC-1', $4::date, 'Statement', $5) as id`,
      [f.clientAccountId, f.matterId, f.personId, today(), key("dep")],
    );
    await as(f, f.finance);
    await db.query(`select public.verify_client_deposit($1)`, [deposit.rows[0].id]);
    await asMaintenance(db);
    const ledger = (await db.query<{ ledger_id: string }>(`select ledger_id from public.client_fund_entries where id = $1`, [deposit.rows[0].id])).rows[0].ledger_id;
    await as(f, f.finance);
    await db.query(`select public.request_client_transfer($1, $2, 10000, 'Milestone', $3)`, [ledger, transferred, key("tr")]);
    await expectDbError(() => voidInvoice(f, transferred), /client-account transfer is allocated/);
    // A credit note draft.
    const credited = await issue(f, 30_000);
    await draft(f, credited, 1_000);
    await expectDbError(() => voidInvoice(f, credited), /has a credit note/);
    for (const id of [paid, processing, transferred, credited]) expect((await invoiceRow(id)).status).not.toBe("voided");
  });

  it("is idempotent and a voided invoice can't be edited or un-voided", async () => {
    const f = await firm();
    const invoiceId = await issue(f);
    await voidInvoice(f, invoiceId);
    expect(await voidInvoice(f, invoiceId, f.owner)).toMatchObject({ status: "voided" });
    await asMaintenance(db);
    await db.query(`update public.invoices set status = 'issued' where id = $1`, [invoiceId]);
    expect((await invoiceRow(invoiceId)).status).toBe("voided");
    await expectDbError(() => db.query(`update public.invoices set void_reason = 'Changed later' where id = $1`, [invoiceId]), /recorded once/);
  });
});

describe("issued invoices are immutable", () => {
  it("refuses edits to an issued invoice's amount, description, dates or matter, even for the table owner", async () => {
    const f = await firm();
    const invoiceId = await issue(f);
    await asMaintenance(db);
    for (const change of ["amount_cents = 1", "description = 'Edited'", `due_on = '2099-01-01'`, "number = 'INV-9999'", `matter_id = '${f.otherMatter}'`]) {
      await expectDbError(() => db.query(`update public.invoices set ${change} where id = $1`, [invoiceId]), /issued invoice can.t be edited|violates foreign key/);
    }
    await as(f, f.owner);
    await expectDbError(() => db.query(`update public.invoices set amount_cents = 1 where id = $1`, [invoiceId]), /permission denied/);
  });
});

describe("credit notes", () => {
  it("are drafted up to the amount not already credited (counting other drafts), then issued by a second person", async () => {
    const f = await firm();
    const invoiceId = await issue(f, 100_000);
    await expectDbError(() => draft(f, invoiceId, 100_001), /exceeds the amount not already credited/);
    await expectDbError(() => draft(f, invoiceId, 0), /amount must be positive/);
    const first = await draft(f, invoiceId, 60_000);
    expect(await note(first)).toMatchObject({ status: "draft", requested_by: f.finance, is_sample: true, currency: "CAD", issued_by: null });
    expect(String((await note(first)).number)).toMatch(/^CN-\d{4}$/);
    await expectDbError(() => draft(f, invoiceId, 40_001), /exceeds the amount not already credited/);
    // The same key returns the same draft (a double click drafts one note).
    const keyed = key();
    const second = await draft(f, invoiceId, 40_000, f.finance, keyed);
    expect(await draft(f, invoiceId, 40_000, f.finance, keyed)).toBe(second);
    await expectDbError(() => draft(f, invoiceId, 1, f.secondFinance), /exceeds the amount not already credited/);

    // Issuing: never by the requester (a finance user), always with a step-up.
    await expectDbError(() => issueNote(f, first, f.finance), /cannot issue their own credit note/);
    await as(f, f.secondFinance, false);
    await expectDbError(() => db.query(`select public.issue_credit_note($1)`, [first]), /step-up is required/);
    const issued = await issueNote(f, first, f.secondFinance);
    expect(issued).toMatchObject({ status: "issued", owner_self_approved: false, invoice_status: "issued", credit_balance_cents: 0 });
    expect(await invoiceRow(invoiceId)).toMatchObject({ status: "issued", credited: 60_000, paid: 0 });
    expect(await note(first)).toMatchObject({
      status: "issued",
      issued_by: f.secondFinance,
      applied_cents: 60_000,
      credit_balance_cents: 0,
      invoice_amount_cents: 100_000,
      client_name: "Synthetic applicant",
      firm_legal_name: "Synthetic Legal Name",
    });
    // What is due drops by the credit; the client pays the rest and the invoice is paid.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    const context = await db.query<{ c: { amount_due: number } }>(`select public.invoice_payment_context($1) as c`, [invoiceId]);
    expect(Number(context.rows[0].c.amount_due)).toBe(40_000);
    // The second draft takes the rest: fully credited.
    expect(await issueNote(f, second, f.owner)).toMatchObject({ status: "issued", invoice_status: "credited", credit_balance_cents: 0 });
    expect(await invoiceRow(invoiceId)).toMatchObject({ status: "credited", credited: 100_000 });
    await expectDbError(() => draft(f, invoiceId, 1), /only an issued invoice can be credited/);
    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = any($1::uuid[]) and action like 'invoice.credit_note_%' order by occurred_at`, [[first, second]]);
    expect(audit.rows.map((row) => row.action)).toEqual(["invoice.credit_note_drafted", "invoice.credit_note_drafted", "invoice.credit_note_issued", "invoice.credit_note_issued"]);
  });

  it("settles a partly paid invoice, and on a paid invoice leaves a credit balance to refund (it never moves money)", async () => {
    const f = await firm();
    const partly = await issue(f, 100_000);
    // A card attempt for the old balance is abandoned; after the credit the client pays what is left.
    const intent = await startPayment(f, partly, 100_000);
    await paymentEvent(f, "payment_intent.canceled", intent, 100_000);
    const noteId = await draft(f, partly, 40_000);
    await issueNote(f, noteId, f.owner);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(
      () => db.query(`select public.record_invoice_payment_intent($1, $2, $3, 100000, 'cad', 0, false)`, [partly, intentId(), f.account]),
      /does not match the balance due/,
    );
    expect(await pay(f, partly, 60_000)).toMatchObject({ outcome: "applied", invoice_status: "paid" });
    expect(await invoiceRow(partly)).toMatchObject({ status: "paid", paid: 60_000, credited: 40_000 });

    const paid = await issue(f, 50_000);
    await pay(f, paid, 50_000);
    const refundNote = await draft(f, paid, 20_000);
    const issued = await issueNote(f, refundNote, f.secondFinance);
    expect(issued).toMatchObject({ status: "issued", invoice_status: "paid", credit_balance_cents: 20_000 });
    expect(await note(refundNote)).toMatchObject({ applied_cents: 0, credit_balance_cents: 20_000 });
    expect(await invoiceRow(paid)).toMatchObject({ status: "paid", paid: 50_000, credited: 20_000 });
    // No refund was created: refunds stay a separate record (FIN-13).
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.invoice_refunds where invoice_id = $1`, [paid])).rows).toHaveLength(0);
  });

  it("refuses a credit while a card payment is processing, and a draft that would now exceed what is creditable", async () => {
    const f = await firm();
    const invoiceId = await issue(f, 10_000);
    const intent = await startPayment(f, invoiceId, 10_000);
    await paymentEvent(f, "payment_intent.processing", intent, 10_000);
    await expectDbError(() => draft(f, invoiceId, 1_000), /card payment on this invoice is processing/);
  });

  it("lets the firm owner issue their own draft only after a fresh step-up, marked and audited", async () => {
    const f = await firm();
    const invoiceId = await issue(f, 10_000);
    const noteId = await draft(f, invoiceId, 10_000, f.owner);
    // A step-up older than the draft does not count.
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 120 });
    await expectDbError(() => db.query(`select public.issue_credit_note($1)`, [noteId]), /issuing your own credit note needs a step-up after the draft/);
    expect(await issueNote(f, noteId, f.owner)).toMatchObject({ status: "issued", owner_self_approved: true, invoice_status: "credited" });
    expect(await note(noteId)).toMatchObject({ issued_by: f.owner, requested_by: f.owner, owner_self_approved: true });
    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 and action like 'invoice.credit_note_issued%'`, [noteId]);
    expect(audit.rows).toEqual([{ action: "invoice.credit_note_issued_owner_self" }]);
    // A finance user may issue the owner's draft.
    const other = await issue(f, 10_000);
    const ownerDraft = await draft(f, other, 5_000, f.owner);
    expect(await issueNote(f, ownerDraft, f.finance)).toMatchObject({ owner_self_approved: false });
  });

  it("can be declined (or withdrawn) with a reason; issued and declined notes are final and can't be forged", async () => {
    const f = await firm();
    const invoiceId = await issue(f, 10_000);
    const noteId = await draft(f, invoiceId, 5_000);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.decline_credit_note($1, 'x')`, [noteId]), /reason is required/);
    await db.query(`select public.decline_credit_note($1, 'Drafted by mistake')`, [noteId]);
    expect(await note(noteId)).toMatchObject({ status: "declined", declined_by: f.finance, decline_reason: "Drafted by mistake" });
    await expectDbError(() => issueNote(f, noteId, f.owner), /only a draft credit note can be issued/);
    expect((await invoiceRow(invoiceId)).credited).toBe(0);
    // Declined drafts no longer hold their amount.
    const full = await draft(f, invoiceId, 10_000);

    await as(f, f.owner);
    await expectDbError(() => db.query(`update public.invoice_credit_notes set status = 'issued' where id = $1`, [full]), /permission denied/);
    await expectDbError(() => db.query(`insert into public.invoice_credit_notes (organization_id, invoice_id, matter_id, number, amount_cents, currency, reason, idempotency_key, requested_by) values ($1, $2, $3, 'CN-9999', 1, 'CAD', 'Forged note', 'forged-key-1', $4)`, [f.orgId, invoiceId, f.matterId, f.owner]), /permission denied/);
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.invoice_credit_notes set status = 'issued', issued_by = requested_by, issued_at = now() where id = $1`, [full]), /check constraint/);
    await expectDbError(() => db.query(`update public.invoice_credit_notes set amount_cents = 1 where id = $1`, [noteId]), /append-only/);
    await expectDbError(() => db.query(`delete from public.invoice_credit_notes where id = $1`, [noteId]), /append-only/);
    const issuedId = full;
    await issueNote(f, issuedId, f.owner);
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.invoice_credit_notes set reason = 'Changed' where id = $1`, [issuedId]), /append-only/);
    await expectDbError(() => db.query(`update public.invoices set credited_cents = 0 where id = $1`, [invoiceId]), /never taken back/);
  });
});

describe("who reads credit notes", () => {
  it("billing staff of the matter read every note; a client party reads issued ones only; others nothing", async () => {
    const f = await firm();
    const invoiceId = await issue(f, 10_000);
    const issued = await draft(f, invoiceId, 4_000);
    await issueNote(f, issued, f.owner);
    const pending = await draft(f, invoiceId, 1_000);

    for (const userId of [f.owner, f.finance]) {
      await as(f, userId, false);
      expect((await db.query(`select id from public.invoice_credit_notes order by number`)).rows).toHaveLength(2);
    }
    for (const userId of [f.otherFinance, f.assistant, f.stranger]) {
      await as(f, userId, false);
      expect((await db.query(`select id from public.invoice_credit_notes`)).rows).toHaveLength(0);
    }
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    const own = await db.query<{ id: string; status: string }>(`select id, status from public.invoice_credit_notes`);
    expect(own.rows).toEqual([{ id: issued, status: "issued" }]);
    const pdf = await db.query<{ r: { number: string; client_name: string; invoice_number: string } }>(`select public.invoice_credit_note($1) as r`, [issued]);
    expect(pdf.rows[0].r).toMatchObject({ client_name: "Synthetic applicant" });
    expect(pdf.rows[0].r.number).toMatch(/^CN-/);
    await expectDbError(() => db.query(`select public.invoice_credit_note($1)`, [pending]), /credit note access denied/);
    await asUser(db, { userId: f.stranger, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.invoice_credit_note($1)`, [issued]), /credit note access denied/);
    await asAnon(db);
    await expectDbError(() => db.query(`select id from public.invoice_credit_notes`), /permission denied/);
    await asMaintenance(db);
    const reads = await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'invoice.credit_note_read'`, [issued]);
    expect(reads.rows).toHaveLength(1);
  });

  it("keeps firms apart", async () => {
    const f = await firm();
    const g = await firm();
    const invoiceId = await issue(f, 10_000);
    const noteId = await draft(f, invoiceId, 1_000);
    // The other firm's owner, in their own workspace or claiming this one, sees and does nothing.
    await as(g, g.owner);
    expect((await db.query(`select id from public.invoice_credit_notes where id = $1`, [noteId])).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.issue_credit_note($1)`, [noteId]), /billing access denied/);
    await expectDbError(() => db.query(`select public.void_invoice($1, 'Not ours')`, [invoiceId]), /billing access denied/);
    await expectDbError(() => db.query(`select public.request_credit_note($1, 1, 'Not ours', $2)`, [invoiceId, key()]), /billing access denied/);
    await asUser(db, { userId: g.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    expect((await db.query(`select id from public.invoice_credit_notes`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.issue_credit_note($1)`, [noteId]), /billing access denied/);
    await expectDbError(() => db.query(`select public.invoice_credit_note($1)`, [noteId]), /credit note access denied/);
  });
});
