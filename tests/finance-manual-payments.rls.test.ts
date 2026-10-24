import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/** Manual payments pending verification (FIN-09): record, verify, reject, reverse; advances with evidence and a reviewer. Synthetic data only. */

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

function token(length = 12) {
  return randomUUID().replaceAll("-", "").slice(0, length);
}

const key = (prefix = "mp") => `${prefix}-${randomUUID()}`;
const day = (offset: number) => firmDay(offset);

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
 * A firm (sample mode) with an operating account, a client account, a matter with a client, a finance
 * user assigned to it, an unassigned finance user, an assistant, and an issued CAD 500.00 invoice.
 */
async function firm(options: { withFinance?: boolean } = {}) {
  const withFinance = options.withFinance ?? true;
  const owner = await createUser("owner");
  const finance = await createUser("finance");
  const otherFinance = await createUser("finance-unassigned");
  const assistant = await createUser("assistant");
  const client = await createUser("client");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${token(12)}`]);
  const orgId = created.rows[0].id;
  const financeMembership = withFinance ? await member(orgId, finance, "finance_user", owner) : null;
  if (withFinance) await member(orgId, otherFinance, "finance_user", owner);
  await member(orgId, assistant, "assistant", owner);
  await member(orgId, client, "client", owner);
  await asMaintenance(db);
  const ownerMembership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2 and role = 'firm_owner'`, [orgId, owner])).rows[0].id;
  const matterId = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample, stage) values ($1, $2, 'Synthetic matter', true, 'engagement_pending')`, [matterId, orgId]);
  const person = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`, [orgId, client]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, person.rows[0].id]);
  if (financeMembership) {
    await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [orgId, matterId, financeMembership]);
  }
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const operating = await db.query<{ id: string }>(`select public.create_firm_operating_account($1, 'Operating', 'Synthetic Bank', '1234') as id`, [orgId]);
  const clientAccount = await db.query<{ id: string }>(`select public.create_client_account($1, 'Client account', 'Synthetic Bank', '4410') as id`, [orgId]);
  const invoice = await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation delivered', 50000, 'CAD', $2::date, $3) as id`, [matterId, day(30), key("inv")]);
  return {
    owner,
    finance,
    otherFinance,
    assistant,
    client,
    orgId,
    matterId,
    ownerMembership,
    personId: person.rows[0].id,
    operatingId: operating.rows[0].id,
    clientAccountId: clientAccount.rows[0].id,
    invoiceId: invoice.rows[0].id,
  };
}

async function as(f: Firm, userId: string, stepUp = true) {
  await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: stepUp ? 0 : 20 * 60 });
}

/** A cleared staff-only upload filed on the matter, as the document path leaves it. */
async function evidenceFile(f: Firm, matterId = f.matterId) {
  await asMaintenance(db);
  const doc = await db.query<{ id: string }>(
    `insert into public.documents (organization_id, person_id, purpose, audience, created_by) values ($1, $2, 'Payment evidence', 'staff', $3) returning id`,
    [f.orgId, f.personId, f.owner],
  );
  const version = await db.query<{ id: string }>(
    `insert into public.document_versions (organization_id, document_id, version_number, storage_key, original_filename, declared_media_type, declared_byte_size, upload_state, intent_expires_at, created_by)
     values ($1, $2, 1, $3, 'etransfer.pdf', 'application/pdf', 2048, 'clean', now() + interval '15 minutes', $4) returning id`,
    [f.orgId, doc.rows[0].id, `${f.orgId}/files/${randomUUID()}`, f.owner],
  );
  await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by) values ($1, $2, $3, $4)`, [f.orgId, doc.rows[0].id, matterId, f.owner]);
  return version.rows[0].id;
}

async function record(
  f: Firm,
  options: { by?: string; amount?: number; reviewer?: string; evidenceVersion?: string | null; note?: string | null; invoiceId?: string; reference?: string; idempotency?: string } = {},
) {
  await as(f, options.by ?? f.finance);
  const row = await db.query<{ id: string }>(
    `select public.record_invoice_manual_payment($1, $2, 'interac_e_transfer', $3, $4::date, $5, $6, $7, $8, $9) as id`,
    [
      options.invoiceId ?? f.invoiceId,
      options.amount ?? 10_000,
      options.reference ?? "CA1xYz",
      day(-1),
      f.operatingId,
      options.evidenceVersion ?? null,
      options.note === undefined ? "Bank statement line 14 Oct" : options.note,
      options.reviewer ?? f.owner,
      options.idempotency ?? key(),
    ],
  );
  return row.rows[0].id;
}

async function invoice(id: string) {
  await asMaintenance(db);
  return (await db.query<{ status: string; paid_cents: number; manual_paid_cents: number }>(`select status, paid_cents, manual_paid_cents from public.invoices where id = $1`, [id])).rows[0];
}

async function payment(id: string) {
  await asMaintenance(db);
  return (await db.query<Record<string, unknown>>(`select * from public.invoice_manual_payments where id = $1`, [id])).rows[0];
}

describe("recording a manual payment", () => {
  it("records it pending verification with all its fields; the invoice isn't paid yet", async () => {
    const f = await firm();
    const file = await evidenceFile(f);
    const id = await record(f, { evidenceVersion: file, note: null });
    expect(await payment(id)).toMatchObject({
      status: "pending_verification",
      number: "MP-0001",
      method: "interac_e_transfer",
      external_reference: "CA1xYz",
      received_on: expect.anything(),
      operating_account_id: f.operatingId,
      evidence_version_id: file,
      evidence_note: null,
      amount_cents: 10_000,
      currency: "CAD",
      reviewer_user_id: f.owner,
      recorded_by: f.finance,
      is_sample: true,
    });
    expect(await invoice(f.invoiceId)).toMatchObject({ status: "issued", paid_cents: 0, manual_paid_cents: 0 });
    // The same key records it once.
    const again = await record(f, { idempotency: (await payment(id)).idempotency_key as string });
    expect(again).toBe(id);
  });

  it("refuses missing evidence or reference, a file from another matter, more than is due, and a reviewer who isn't eligible", async () => {
    const f = await firm();
    await expectDbError(() => record(f, { note: null }), /evidence is required/);
    await expectDbError(() => record(f, { reference: " " }), /external reference is required/);
    await asMaintenance(db);
    const otherMatter = randomUUID();
    await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Other', true)`, [otherMatter, f.orgId]);
    const elsewhere = await evidenceFile(f, otherMatter);
    await expectDbError(() => record(f, { evidenceVersion: elsewhere }), /cleared upload on this matter/);
    await expectDbError(() => record(f, { amount: 50_001 }), /exceeds the amount due/);
    await record(f, { amount: 40_000 });
    // Pending payments hold their amount.
    await expectDbError(() => record(f, { amount: 10_001 }), /exceeds the amount due/);
    // The assistant and the unassigned finance user can't review this matter; the recorder can't name themselves.
    await expectDbError(() => record(f, { reviewer: f.assistant }), /choose a reviewer/);
    await expectDbError(() => record(f, { reviewer: f.otherFinance }), /choose a reviewer/);
    await expectDbError(() => record(f, { reviewer: f.finance }), /reviewer other than yourself/);
  });

  it("only the matter's billing staff record it; no one reads it across firms", async () => {
    const f = await firm();
    const g = await firm();
    const id = await record(f);
    for (const userId of [f.assistant, f.otherFinance]) {
      await as(f, userId);
      await expectDbError(
        () => db.query(`select public.record_invoice_manual_payment($1, 100, 'cheque', 'CHQ 1', $2::date, $3, null, 'note', $4, $5)`, [f.invoiceId, day(0), f.operatingId, f.owner, key()]),
        /billing access denied/,
      );
      expect((await db.query(`select id from public.invoice_manual_payments`)).rows).toHaveLength(0);
    }
    await as(g, g.owner);
    expect((await db.query(`select id from public.invoice_manual_payments`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.verify_invoice_manual_payment($1)`, [id]), /billing access denied/);
    await asAnon(db);
    await expectDbError(() => db.query(`select id from public.invoice_manual_payments`), /permission denied/);
    // Writes go through the functions only.
    await as(f, f.owner);
    await expectDbError(() => db.query(`update public.invoice_manual_payments set status = 'verified' where id = $1`, [id]), /permission denied/);
    await expectDbError(() => db.query(`update public.invoices set manual_paid_cents = 1 where id = $1`, [f.invoiceId]), /permission denied/);
  });
});

describe("verifying", () => {
  it("the named reviewer verifies with a step-up; then it counts as paid", async () => {
    const f = await firm();
    const id = await record(f, { amount: 50_000, reviewer: f.owner });
    await as(f, f.owner, false);
    await expectDbError(() => db.query(`select public.verify_invoice_manual_payment($1)`, [id]), /step-up is required/);
    await as(f, f.owner);
    const result = (await db.query<{ r: Record<string, unknown> }>(`select public.verify_invoice_manual_payment($1) as r`, [id])).rows[0].r;
    expect(result).toMatchObject({ status: "verified", self_verified: false, invoice_status: "paid" });
    expect(await invoice(f.invoiceId)).toMatchObject({ status: "paid", paid_cents: 50_000, manual_paid_cents: 50_000 });
    expect(await payment(id)).toMatchObject({ verified_by: f.owner });
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.verify_invoice_manual_payment($1)`, [id]), /only a payment pending verification/);
  });

  it("a second person: the recorder can't verify while someone else is eligible; only the named reviewer or the owner", async () => {
    const f = await firm();
    // The owner records and names the finance user.
    const id = await record(f, { by: f.owner, reviewer: f.finance });
    await as(f, f.otherFinance);
    await expectDbError(() => db.query(`select public.verify_invoice_manual_payment($1)`, [id]), /billing access denied/);
    await as(f, f.finance);
    await db.query(`select public.verify_invoice_manual_payment($1)`, [id]);
    expect(await invoice(f.invoiceId)).toMatchObject({ status: "partially_paid", paid_cents: 10_000 });

    // The finance user records and names the owner; the finance user can't verify their own.
    const own = await record(f, { reviewer: f.owner });
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.verify_invoice_manual_payment($1)`, [own]), /only the named reviewer or the firm owner/);
  });

  it("the owner may verify their own entry after a fresh step-up, marked self-verified; so may a firm with no one else", async () => {
    const f = await firm();
    const id = await record(f, { by: f.owner, reviewer: f.finance });
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 120 });
    await expectDbError(() => db.query(`select public.verify_invoice_manual_payment($1)`, [id]), /needs a step-up after it was recorded/);
    await as(f, f.owner);
    expect((await db.query<{ r: Record<string, unknown> }>(`select public.verify_invoice_manual_payment($1) as r`, [id])).rows[0].r).toMatchObject({ self_verified: true });
    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 and action like 'invoice.manual_payment_%' order by occurred_at`, [id]);
    expect(audit.rows.map((row) => row.action)).toEqual(["invoice.manual_payment_recorded", "invoice.manual_payment_verified_self"]);

    // An owner with no finance users names themselves and verifies.
    const solo = await firm({ withFinance: false });
    const mine = await record(solo, { by: solo.owner, reviewer: solo.owner });
    await as(solo, solo.owner);
    expect((await db.query<{ r: Record<string, unknown> }>(`select public.verify_invoice_manual_payment($1) as r`, [mine])).rows[0].r).toMatchObject({ self_verified: true });
  });

  it("rejects a payment recorded by mistake with a reason; it never counts", async () => {
    const f = await firm();
    const id = await record(f);
    await as(f, f.owner, false);
    await expectDbError(() => db.query(`select public.reject_invoice_manual_payment($1, 'x')`, [id]), /reason is required/);
    await db.query(`select public.reject_invoice_manual_payment($1, 'Not on the statement')`, [id]);
    expect(await payment(id)).toMatchObject({ status: "rejected", rejected_by: f.owner });
    expect(await invoice(f.invoiceId)).toMatchObject({ status: "issued", paid_cents: 0 });
  });
});

describe("reversed or failed", () => {
  it("reopens a verified payment's balance, creates a task for the matter's consultant, and leaves the stage alone", async () => {
    const f = await firm();
    await asMaintenance(db);
    await db.query(`update public.matters set responsible_consultant_membership_id = $2 where id = $1`, [f.matterId, f.ownerMembership]).catch(() => undefined);
    const id = await record(f, { amount: 50_000 });
    await as(f, f.owner);
    await db.query(`select public.verify_invoice_manual_payment($1)`, [id]);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.reverse_invoice_manual_payment($1, 'reversed', 'Recalled by the sender')`, [id]), /step-up is required/);
    await as(f, f.finance);
    const result = (await db.query<{ r: { status: string; reopened_cents: number; task_id: string } }>(`select public.reverse_invoice_manual_payment($1, 'reversed', 'Recalled by the sender') as r`, [id])).rows[0].r;
    expect(result).toMatchObject({ status: "reversed", reopened_cents: 50_000, invoice_status: "issued" });
    expect(await invoice(f.invoiceId)).toMatchObject({ status: "issued", paid_cents: 0, manual_paid_cents: 0 });
    await asMaintenance(db);
    const task = await db.query<{ matter_id: string; audience: string; owner_membership_id: string; priority: string; title: string }>(`select * from public.tasks where id = $1`, [result.task_id]);
    expect(task.rows[0]).toMatchObject({ matter_id: f.matterId, audience: "internal", owner_membership_id: f.ownerMembership, priority: "high" });
    expect(task.rows[0].title).toMatch(/MP-0001 was reversed/);
    const matter = await db.query<{ stage: string }>(`select stage::text from public.matters where id = $1`, [f.matterId]);
    expect(matter.rows[0].stage).toBe("engagement_pending");
    expect(await payment(id)).toMatchObject({ status: "reversed", reversal_task_id: result.task_id, reopened_cents: 50_000 });
    await expectDbError(() => db.query(`update public.invoice_manual_payments set status = 'verified' where id = $1`, [id]), /append-only/);
  });

  it("marks a pending payment failed without touching the invoice; a pending one can't be 'reversed'", async () => {
    const f = await firm();
    const id = await record(f);
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.reverse_invoice_manual_payment($1, 'reversed', 'NSF cheque')`, [id]), /mark a pending one failed/);
    const result = (await db.query<{ r: { status: string; reopened_cents: number } }>(`select public.reverse_invoice_manual_payment($1, 'failed', 'Cheque returned NSF') as r`, [id])).rows[0].r;
    expect(result).toMatchObject({ status: "failed", reopened_cents: 0 });
    expect(await invoice(f.invoiceId)).toMatchObject({ status: "issued", paid_cents: 0 });
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.reverse_invoice_manual_payment($1, 'failed', 'Again')`, [id]), /only a pending or verified payment/);
  });
});

describe("what the client sees", () => {
  it("a party on the matter reads the payment's number, state and amount, never the evidence or reviewer", async () => {
    const f = await firm();
    const id = await record(f);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    expect((await db.query(`select id from public.invoice_manual_payments`)).rows).toHaveLength(0);
    const summary = await db.query<Record<string, unknown>>(`select * from public.invoice_manual_payment_summary($1::uuid[])`, [[f.invoiceId]]);
    expect(summary.rows).toEqual([
      { payment_id: id, invoice_id: f.invoiceId, number: "MP-0001", status: "pending_verification", amount_cents: 10_000, currency: "CAD", received_on: expect.anything(), method: "interac_e_transfer" },
    ]);
    // Someone who isn't a party reads nothing.
    await as(f, f.assistant);
    expect((await db.query(`select * from public.invoice_manual_payment_summary($1::uuid[])`, [[f.invoiceId]])).rows).toHaveLength(0);
  });
});

describe("operating accounts and reviewers", () => {
  it("only the firm owner with a step-up adds an operating account; billing staff list reviewers", async () => {
    const f = await firm();
    await as(f, f.owner, false);
    await expectDbError(() => db.query(`select public.create_firm_operating_account($1, 'Second', 'Bank', '9999')`, [f.orgId]), /firm owner step-up/);
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.create_firm_operating_account($1, 'Second', 'Bank', '9999')`, [f.orgId]), /firm owner step-up/);
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.create_firm_operating_account($1, 'Second', 'Bank', '99')`, [f.orgId]), /last four digits/);
    expect((await db.query(`select id from public.firm_operating_accounts`)).rows).toHaveLength(1);
    const reviewers = await db.query<{ user_id: string; role: string; matter_ids: string[] | null }>(`select * from public.list_payment_reviewers($1)`, [f.orgId]);
    const byUser = new Map(reviewers.rows.map((row) => [row.user_id, row]));
    expect(byUser.get(f.owner)).toMatchObject({ role: "firm_owner", matter_ids: null });
    expect(byUser.get(f.finance)).toMatchObject({ role: "finance_user", matter_ids: [f.matterId] });
    expect(byUser.get(f.otherFinance)).toMatchObject({ role: "finance_user", matter_ids: [] });
    expect(byUser.has(f.assistant)).toBe(false);
    await as(f, f.assistant);
    await expectDbError(() => db.query(`select * from public.list_payment_reviewers($1)`, [f.orgId]), /billing access denied/);
  });
});

describe("client-funds advances", () => {
  it("records an advance with its evidence file and reviewer; only that reviewer or the owner verifies it", async () => {
    const f = await firm();
    const file = await evidenceFile(f);
    await as(f, f.owner);
    const entry = (
      await db.query<{ id: string }>(`select public.record_client_advance($1, $2, $3, 25000, 'cheque', 'CHQ 104', $4::date, $5, null, $6, $7) as id`, [
        f.clientAccountId,
        f.matterId,
        f.personId,
        day(-1),
        file,
        f.finance,
        key("adv"),
      ])
    ).rows[0].id;
    await asMaintenance(db);
    expect((await db.query(`select status from public.client_fund_entries where id = $1`, [entry])).rows[0]).toMatchObject({ status: "pending_verification" });
    expect((await db.query(`select * from public.client_fund_deposit_reviews where entry_id = $1`, [entry])).rows[0]).toMatchObject({ evidence_version_id: file, reviewer_user_id: f.finance });
    await expectDbError(() => db.query(`update public.client_fund_deposit_reviews set reviewer_user_id = $2 where entry_id = $1`, [entry, f.owner]), /append-only/);
    // Another finance user on the matter would not be the named reviewer.
    await as(f, f.finance);
    await db.query(`select public.verify_client_deposit($1)`, [entry]);

    // A deposit the finance user records naming the owner: the finance user can't verify it.
    await as(f, f.finance);
    const named = (
      await db.query<{ id: string }>(`select public.record_client_advance($1, $2, $3, 5000, 'cash', 'Receipt 7', $4::date, null, 'Cash counted with the client', $5, $6) as id`, [
        f.clientAccountId,
        f.matterId,
        f.personId,
        day(-1),
        f.owner,
        key("adv"),
      ])
    ).rows[0].id;
    await expectDbError(() => db.query(`select public.record_client_advance($1, $2, $3, 5000, 'cash', 'R', $4::date, null, null, $5, $6)`, [f.clientAccountId, f.matterId, f.personId, day(-1), f.finance, key("adv")]), /evidence is required/);
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.verify_client_deposit($1)`, [named]), /only the named reviewer or the firm owner/);
  });
});
