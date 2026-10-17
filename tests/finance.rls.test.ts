import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const NOTE = "Government fees are paid to the authority, not to the firm.";
const SERVICE = "Services delivered for this matter.";

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, now(), '{}'::jsonb)`,
    [id, address],
  );
  return id;
}

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(
    `select (public.create_organization($1, $2, $3)).id as id`,
    ["Synthetic Legal Name", "Synthetic Firm", slug()],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new Error("organization was not created");
  return id;
}

async function activeMembership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4)
     returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const client = await createUser(email("client"));
  const sponsor = await createUser(email("sponsor"));
  const outsider = await createUser(email("outsider"));
  const orgId = await createOrg(owner);
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  await activeMembership(orgId, client, "client", owner);
  await activeMembership(orgId, sponsor, "sponsor", owner);
  await asMaintenance(db);
  const ownerMembership = (
    await db.query<{ id: string }>(
      `select id from public.memberships where organization_id = $1 and user_id = $2`,
      [orgId, owner],
    )
  ).rows[0].id;
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check(
       $1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note'
     )`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { ok: boolean; id: string } }>(
    `select public.create_engaged_matter(
       'Synthetic matter', false, $1, null, 'Prepare a real application and nothing else.'
     ) as result`,
    [consultantMembership],
  );
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  const applicantId = randomUUID();
  const sponsorId = randomUUID();
  await db.query(
    `insert into public.persons (id, organization_id, display_name, is_sample, date_of_birth, birth_date_precision, user_id)
     values ($1, $2, 'Synthetic applicant', false, '1990-01-01', 'day', $3),
            ($4, $2, 'Synthetic sponsor', false, '1988-02-02', 'day', $5)`,
    [applicantId, orgId, client, sponsorId, sponsor],
  );
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role)
     values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`,
    [orgId, matterId, applicantId, sponsorId],
  );
  const otherOrg = await createOrg(outsider);
  return { owner, consultant, client, sponsor, outsider, orgId, otherOrg, consultantMembership, ownerMembership, matterId, applicantId, sponsorId };
}

const LINES = (cents: number, category: string) =>
  JSON.stringify([{ description: "Synthetic professional work", quantity: 1, unit_amount_cents: cents, fee_category: category }]);

async function asOwner(ctx: Awaited<ReturnType<typeof firm>>) {
  await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
}

async function document(ctx: Awaited<ReturnType<typeof firm>>, kind: string, cents: number, category: string, currency = "cad") {
  await asOwner(ctx);
  const created = await db.query<{ id: string }>(
    `select public.create_billing_document($1, $2, $3::public.billing_document_kind, $4::jsonb, $5, current_date + 14, $6, $7) as id`,
    [ctx.matterId, ctx.applicantId, kind, LINES(cents, category), NOTE, kind === "professional_services" ? SERVICE : null, currency],
  );
  return created.rows[0].id;
}

async function issue(ctx: Awaited<ReturnType<typeof firm>>, id: string) {
  await asOwner(ctx);
  await db.query(`select public.issue_billing_document($1, $2)`, [id, SERVICE]);
}

async function funds(ctx: Awaited<ReturnType<typeof firm>>) {
  await asOwner(ctx);
  const row = await db.query<{ client: string; earned: string }>(
    `select public.client_funds_cents($1, $2, 'cad') as client, public.earned_fee_cents($1, $2, 'cad') as earned`,
    [ctx.matterId, ctx.applicantId],
  );
  return { client: Number(row.rows[0].client), earned: Number(row.rows[0].earned) };
}

describe("client funds, invoices, and stripe events", () => {
  it("forces RLS on every finance table and does not alter storage", async () => {
    const names = [
      "tax_rates", "invoice_counters", "invoices", "invoice_lines", "time_entries", "payments",
      "ledger_accounts", "journal_entries", "journal_lines", "payment_allocations", "receipts",
      "credit_notes", "refunds", "payment_disputes", "installment_plans", "installments",
      "earned_fee_transfers", "processor_accounts", "reconciliation_periods", "reconciliation_exceptions",
    ];
    const flags = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1::text[])`,
      [names],
    );
    expect(flags.rows).toHaveLength(names.length);
    for (const row of flags.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
    const sql = readFileSync(path.resolve("supabase/migrations/20261017210100_finance_ledger.sql"), "utf8");
    expect(sql).not.toMatch(/alter\s+table\s+storage/i);
    const enums = readFileSync(path.resolve("supabase/migrations/20261017210000_finance_enums.sql"), "utf8");
    expect(enums).toMatch(/past_due/);
    expect(enums).not.toMatch(/create table/i);
  });

  it("keeps an advance as client funds and an earned transfer as the remainder", async () => {
    const ctx = await firm();
    const advance = await document(ctx, "advance_request", 100_000, "advance");
    await issue(ctx, advance);
    await asOwner(ctx);
    const pending = await db.query<{ id: string }>(
      `select public.record_manual_payment($1, 100000, 'bank_transfer', 'wire-1000', current_date, 'Operating bank', 'Bank advice 1000') as id`,
      [advance],
    );
    expect((await funds(ctx)).client).toBe(0);
    await asOwner(ctx);
    await db.query(`select public.verify_manual_payment($1)`, [pending.rows[0].id]);
    expect(await funds(ctx)).toEqual({ client: 100_000, earned: 0 });
    const again = await db.query<{ id: string }>(
      `select public.record_manual_payment($1, 100000, 'bank_transfer', 'wire-1000', current_date, 'Operating bank', 'Bank advice 1000') as id`,
      [advance],
    );
    expect(again.rows[0].id).toBe(pending.rows[0].id);
    await db.query(`select public.verify_manual_payment($1)`, [pending.rows[0].id]);
    expect(await funds(ctx)).toEqual({ client: 100_000, earned: 0 });

    const professional = await document(ctx, "professional_services", 30_000, "professional_fee");
    await issue(ctx, professional);
    const total = await db.query<{ total: string; note: string }>(
      `select total_cents::text as total, government_fee_note as note from public.invoices where id = $1`,
      [professional],
    );
    expect(Number(total.rows[0].total)).toBe(30_000);
    expect(total.rows[0].note).toBe(NOTE);
    await asOwner(ctx);
    const transfer = await db.query<{ id: string }>(
      `select public.propose_earned_transfer($1, 30000, 'Services were delivered') as id`,
      [professional],
    );
    await db.query(`select public.approve_earned_transfer($1, 'Solo firm, services delivered')`, [transfer.rows[0].id]);
    expect(await funds(ctx)).toEqual({ client: 70_000, earned: 30_000 });

    const journals = await db.query<{ n: string }>(
      `select count(*)::text as n from public.journal_entries where organization_id = $1 and posting_key = $2`,
      [ctx.orgId, `payment:${pending.rows[0].id}`],
    );
    expect(Number(journals.rows[0].n)).toBe(1);
  });

  it("scopes invoices to the organization and the billing party", async () => {
    const ctx = await firm();
    const id = await document(ctx, "professional_services", 5_000, "professional_fee");
    await issue(ctx, id);
    const finance = await createUser(email("finance"));
    await activeMembership(ctx.orgId, finance, "finance_user", ctx.owner);
    await asUser(db, { userId: finance, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const hidden = await db.query(`select id from public.invoices where id = $1`, [id]);
    expect(hidden.rows).toHaveLength(0);
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const seen = await db.query(`select id from public.invoices where id = $1`, [id]);
    expect(seen.rows).toHaveLength(1);
    const journals = await db.query(`select id from public.journal_lines`);
    expect(journals.rows).toHaveLength(0);
    await asUser(db, { userId: ctx.sponsor, aal: "aal1", orgId: ctx.orgId });
    const sponsor = await db.query(`select id from public.invoices where id = $1`, [id]);
    expect(sponsor.rows).toHaveLength(0);
    await asUser(db, { userId: ctx.outsider, aal: "aal2", orgId: ctx.otherOrg, totpAgeSeconds: 0 });
    const other = await db.query(`select id from public.invoices where organization_id = $1`, [ctx.orgId]);
    expect(other.rows).toHaveLength(0);
    await asOwner(ctx);
    await expectDbError(
      () => db.query(`insert into public.invoices (organization_id, matter_id, billing_person_id, number, kind, currency) values ($1, $2, $3, 'X', 'quote', 'cad')`, [ctx.orgId, ctx.matterId, ctx.applicantId]),
      /permission|42501/,
    );
  });

  it("rejects a CAD payment against a USD invoice and keeps issued lines immutable", async () => {
    const ctx = await firm();
    const usd = await document(ctx, "professional_services", 4_000, "professional_fee", "usd");
    await issue(ctx, usd);
    await asOwner(ctx);
    const payment = await db.query<{ id: string }>(
      `select public.record_manual_payment($1, 4000, 'bank_transfer', 'usd-wire', current_date, 'USD bank', 'Advice') as id`,
      [usd],
    );
    await asMaintenance(db);
    await db.query(`update public.payments set currency = 'cad' where id = $1`, [payment.rows[0].id]);
    await expectDbError(
      () => db.query(`select app.allocate_succeeded_payment($1)`, [payment.rows[0].id]),
      /currency/,
    );
    const balance = await db.query<{ balance: string }>(`select balance_cents::text as balance from public.invoices where id = $1`, [usd]);
    expect(Number(balance.rows[0].balance)).toBe(4_000);
    await asServiceRole(db);
    const mismatch = await db.query<{ result: string }>(
      `select public.record_stripe_event($1, 'acct_x', 'payment_intent.succeeded', $2::jsonb, $3) as result`,
      [
        `evt-${randomUUID()}`,
        JSON.stringify({ flow: "client_fee", payment_id: payment.rows[0].id, amount_cents: "4000", currency: "cad", organization_id: ctx.orgId }),
        ctx.orgId,
      ],
    );
    expect(mismatch.rows[0].result).toBe("payment_mismatch");
    await asMaintenance(db);
    await expectDbError(
      () => db.query(`update public.invoice_lines set description = 'Changed' where invoice_id = $1`, [usd]),
      /immutable/,
    );
    await asOwner(ctx);
    await expectDbError(
      () => db.query(
        `select public.create_billing_document($1, $2, 'professional_services', $3::jsonb, $4, null, $5, 'cad')`,
        [ctx.matterId, ctx.applicantId, JSON.stringify([{ description: "Fee", quantity: 1, unit_amount_cents: 100, fee_category: "professional_fee", government_fee_cents: 50 }]), NOTE, SERVICE],
      ),
      /government fees are a note only/,
    );
  });

  it("does not double-post a webhook, and a later failure does not unpay", async () => {
    const ctx = await firm();
    await asOwner(ctx);
    await db.query(`select public.upsert_processor_account('acct_firm_test')`);
    await asServiceRole(db);
    const enabled = await db.query<{ result: string }>(
      `select public.record_stripe_event('evt_connect', 'acct_firm_test', 'connect.updated', '{"connect_status":"enabled"}'::jsonb, $1) as result`,
      [ctx.orgId],
    );
    expect(enabled.rows[0].result).toBe("processed");
    const invoice = await document(ctx, "professional_services", 8_000, "professional_fee");
    await issue(ctx, invoice);
    await asOwner(ctx);
    const reserved = await db.query<{ id: string }>(`select public.reserve_card_payment($1) as id`, [invoice]);
    const paymentId = reserved.rows[0].id;
    await db.query(`select public.attach_payment_intent($1, 'pi_test_1')`, [paymentId]);
    const payload = JSON.stringify({
      flow: "client_fee",
      payment_id: paymentId,
      invoice_id: invoice,
      organization_id: ctx.orgId,
      amount_cents: "8000",
      currency: "cad",
    });
    await asServiceRole(db);
    const first = await db.query<{ result: string }>(
      `select public.record_stripe_event('evt_pay_1', 'acct_firm_test', 'payment_intent.succeeded', $1::jsonb, $2) as result`,
      [payload, ctx.orgId],
    );
    const second = await db.query<{ result: string }>(
      `select public.record_stripe_event('evt_pay_1', 'acct_firm_test', 'payment_intent.succeeded', $1::jsonb, $2) as result`,
      [payload, ctx.orgId],
    );
    expect(first.rows[0].result).toBe("processed");
    expect(second.rows[0].result).toBe("duplicate");
    const failed = await db.query<{ result: string }>(
      `select public.record_stripe_event('evt_fail_late', 'acct_firm_test', 'payment_intent.payment_failed', $1::jsonb, $2) as result`,
      [payload, ctx.orgId],
    );
    expect(failed.rows[0].result).toBe("processed");
    await asOwner(ctx);
    const state = await db.query<{ state: string; balance: string }>(
      `select pay.state::text, inv.balance_cents::text as balance
       from public.payments pay join public.invoices inv on inv.id = pay.invoice_id
       where pay.id = $1`,
      [paymentId],
    );
    expect(state.rows[0].state).toBe("succeeded");
    expect(Number(state.rows[0].balance)).toBe(0);
    const audits = await db.query<{ n: string }>(
      `select count(*)::text as n from public.audit_log where organization_id = $1 and action = 'billing.webhook_processed'`,
      [ctx.orgId],
    );
    expect(Number(audits.rows[0].n)).toBeGreaterThan(0);
    const outbox = await db.query<{ n: string }>(
      `select count(*)::text as n from public.outbox_events where organization_id = $1 and event_type = 'webhook.processed'`,
      [ctx.orgId],
    );
    expect(Number(outbox.rows[0].n)).toBeGreaterThan(0);

    await asServiceRole(db);
    await db.query(
      `select public.record_stripe_event('evt_dispute', 'acct_firm_test', 'dispute.opened', $1::jsonb, $2)`,
      [JSON.stringify({ flow: "client_fee", payment_id: paymentId, provider_dispute_id: "dp_1", amount_cents: "8000", currency: "cad" }), ctx.orgId],
    );
    await db.query(
      `select public.record_stripe_event('evt_dispute_2', 'acct_firm_test', 'dispute.opened', $1::jsonb, $2)`,
      [JSON.stringify({ flow: "client_fee", payment_id: paymentId, provider_dispute_id: "dp_1", amount_cents: "8000", currency: "cad" }), ctx.orgId],
    );
    await asMaintenance(db);
    const after = await db.query<{ balance: string; stage: string; invoices: string; disputes: string }>(
      `select inv.balance_cents::text as balance, matter.stage::text as stage,
              (select count(*) from public.invoices where id = inv.id)::text as invoices,
              (select count(*) from public.payment_disputes where provider_dispute_id = 'dp_1')::text as disputes
       from public.invoices inv join public.matters matter on matter.id = inv.matter_id
       where inv.id = $1`,
      [invoice],
    );
    expect(Number(after.rows[0].balance)).toBe(8_000);
    expect(after.rows[0].stage).toBe("engagement_pending");
    expect(Number(after.rows[0].invoices)).toBe(1);
    expect(Number(after.rows[0].disputes)).toBe(1);
  });

  it("settles a refund once and reads plan prices from settings", async () => {
    const ctx = await firm();
    const invoice = await document(ctx, "professional_services", 2_000, "professional_fee");
    await issue(ctx, invoice);
    await asOwner(ctx);
    const payment = await db.query<{ id: string }>(
      `select public.record_manual_payment($1, 2000, 'manual', 'cash-2000', current_date, 'Front desk', 'Receipt book 12') as id`,
      [invoice],
    );
    await db.query(`select public.verify_manual_payment($1)`, [payment.rows[0].id]);
    const refund = await db.query<{ id: string }>(
      `select public.request_refund($1, 500, 'Courtesy reduction') as id`,
      [payment.rows[0].id],
    );
    await db.query(`select public.approve_refund($1)`, [refund.rows[0].id]);
    await asServiceRole(db);
    await db.query(`select public.settle_refund($1, 're_test_1', 'stripe')`, [refund.rows[0].id]);
    await db.query(`select public.settle_refund($1, 're_test_1', 'stripe')`, [refund.rows[0].id]);
    await asMaintenance(db);
    const journals = await db.query<{ n: string }>(
      `select count(*)::text as n from public.journal_entries where posting_key = 'refund:re_test_1'`,
    );
    expect(Number(journals.rows[0].n)).toBe(1);
    await asOwner(ctx);
    const credit = await db.query<{ id: string }>(
      `select public.issue_credit_note($1, 200, 'Writing correction') as id`,
      [invoice],
    );
    expect(credit.rows[0].id).toBeTruthy();
    const refunds = await db.query<{ n: string }>(`select count(*)::text as n from public.refunds where payment_id = $1`, [payment.rows[0].id]);
    expect(Number(refunds.rows[0].n)).toBe(1);

    await asOwner(ctx);
    const solo = await db.query<{ amount: string }>(`select public.billing_plan_amount('solo', 'month') as amount`);
    expect(Number(solo.rows[0].amount)).toBe(12_900);
    await asMaintenance(db);
    await db.query(
      `update public.product_settings
       set value = jsonb_set(value, '{plans,solo,monthly_cents}', '11100')
       where key = 'billing.plans'`,
    );
    const changed = await db.query<{ amount: string; practice: string }>(
      `select public.billing_plan_amount('solo', 'month') as amount, public.billing_plan_amount('practice', 'month') as practice`,
    );
    expect(Number(changed.rows[0].amount)).toBe(11_100);
    expect(Number(changed.rows[0].practice)).toBe(29_900);
    const body = await db.query<{ def: string }>(`select pg_get_functiondef('app.plan_amount_cents(text,text)'::regprocedure) as def`);
    expect(body.rows[0].def).not.toMatch(/12900|29900|59900|\b2500\b/);
    await asOwner(ctx);
    const snapshot = await db.query<{ snapshot: { amount_cents: number } }>(
      `select public.select_firm_plan('practice', 'month') as snapshot`,
    );
    expect(Number(snapshot.rows[0].snapshot.amount_cents)).toBe(29_900);
    const status = await db.query<{ status: string }>(
      `select status::text from public.organization_subscriptions where organization_id = $1`,
      [ctx.orgId],
    );
    expect(status.rows[0].status).not.toBe("active");
    await asServiceRole(db);
    await db.query(
      `select public.record_stripe_event('evt_plan', '', 'platform_subscription.activated', $1::jsonb, $2)`,
      [JSON.stringify({ flow: "platform_subscription", amount_cents: "29900", currency: "cad", customer_id: "cus_1", subscription_id: "pi_plan" }), ctx.orgId],
    );
    await asMaintenance(db);
    const active = await db.query<{ status: string }>(
      `select status::text from public.organization_subscriptions where organization_id = $1`,
      [ctx.orgId],
    );
    expect(active.rows[0].status).toBe("active");
  });

  it("requires a second approver when two billing staff are active, and reconciles the bank not the processor", async () => {
    const ctx = await firm();
    const advance = await document(ctx, "advance_request", 50_000, "advance");
    await issue(ctx, advance);
    await asOwner(ctx);
    const payment = await db.query<{ id: string }>(
      `select public.record_manual_payment($1, 50000, 'bank_transfer', 'wire-500', current_date, 'Trust bank', 'Advice 500') as id`,
      [advance],
    );
    await db.query(`select public.verify_manual_payment($1)`, [payment.rows[0].id]);
    const professional = await document(ctx, "professional_services", 10_000, "professional_fee");
    await issue(ctx, professional);
    const finance = await createUser(email("finance"));
    const financeMembership = await activeMembership(ctx.orgId, finance, "finance_user", ctx.owner);
    await asMaintenance(db);
    await db.query(
      `insert into public.matter_participants (organization_id, matter_id, membership_id, role)
       values ($1, $2, $3, 'assistant')`,
      [ctx.orgId, ctx.matterId, financeMembership],
    );
    await asUser(db, { userId: finance, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const transfer = await db.query<{ id: string }>(
      `select public.propose_earned_transfer($1, 10000, 'Work is complete') as id`,
      [professional],
    );
    await expectDbError(
      () => db.query(`select public.approve_earned_transfer($1, 'Same person')`, [transfer.rows[0].id]),
      /second person/,
    );
    await asOwner(ctx);
    await db.query(`select public.approve_earned_transfer($1, 'Owner confirms delivery')`, [transfer.rows[0].id]);
    expect((await funds(ctx)).client).toBe(40_000);
    const period = await db.query<{ id: string }>(
      `select public.record_reconciliation(current_date - 30, current_date, 1000, 999999) as id`,
    );
    const exceptions = await db.query<{ detail: string }>(
      `select detail from public.reconciliation_exceptions where period_id = $1`,
      [period.rows[0].id],
    );
    expect(exceptions.rows.map((row) => row.detail).join(" ")).toMatch(/not the client account/);
    const control = await db.query<{ control: string }>(
      `select control_cents::text as control from public.reconciliation_periods where id = $1`,
      [period.rows[0].id],
    );
    expect(Number(control.rows[0].control)).toBe(40_000);
  });

  it("refuses sample matters, quotes, and treats installments and credits as invoice records", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const sample = await db.query<{ result: { id: string } }>(
      `select public.create_engaged_matter('Sample only', true, $1, null, 'Fictional scope for a sample.') as result`,
      [ctx.consultantMembership],
    );
    await asMaintenance(db);
    const samplePerson = randomUUID();
    await db.query(
      `insert into public.persons (id, organization_id, display_name, is_sample, date_of_birth, birth_date_precision)
       values ($1, $2, 'Sample person', true, '1991-03-03', 'day')`,
      [samplePerson, ctx.orgId],
    );
    await asOwner(ctx);
    await expectDbError(
      () => db.query(
        `select public.create_billing_document($1, $2, 'professional_services', $3::jsonb, $4, null, $5, 'cad')`,
        [sample.rows[0].result.id, ctx.applicantId, LINES(1000, "professional_fee"), NOTE, SERVICE],
      ),
      /sample/,
    );
    const quote = await document(ctx, "quote", 9_000, "professional_fee");
    await issue(ctx, quote);
    await asOwner(ctx);
    const quoted = await db.query<{ id: string }>(
      `select public.record_manual_payment($1, 9000, 'bank_transfer', 'quote-wire', current_date, 'Bank', 'Advice') as id`,
      [quote],
    );
    await expectDbError(
      () => db.query(`select public.verify_manual_payment($1)`, [quoted.rows[0].id]),
      /quote is not payable/,
    );
    const invoice = await document(ctx, "professional_services", 9_000, "professional_fee");
    await issue(ctx, invoice);
    await asOwner(ctx);
    const plan = await db.query<{ id: string }>(`select public.create_installment_plan($1, 3) as id`, [invoice]);
    const parts = await db.query<{ amount: string }>(
      `select amount_cents::text as amount from public.installments where plan_id = $1 order by sequence_no`,
      [plan.rows[0].id],
    );
    expect(parts.rows.map((row) => Number(row.amount)).reduce((sum, value) => sum + value, 0)).toBe(9_000);
    await db.query(`select public.issue_credit_note($1, 1000, 'Courtesy credit')`, [invoice]);
    const balance = await db.query<{ balance: string }>(`select balance_cents::text as balance from public.invoices where id = $1`, [invoice]);
    expect(Number(balance.rows[0].balance)).toBe(8_000);
    const pdf = await db.query<{ pdf: Uint8Array }>(`select public.billing_document_pdf($1) as pdf`, [invoice]);
    expect(Buffer.from(pdf.rows[0].pdf).subarray(0, 4).toString()).toBe("%PDF");
    await db.query(`select public.record_time_entry($1, 30, 10000, 'File review notes')`, [ctx.matterId]);
    const invoices = await db.query<{ n: string }>(`select count(*)::text as n from public.invoices where matter_id = $1`, [ctx.matterId]);
    const times = await db.query<{ n: string }>(`select count(*)::text as n from public.time_entries where matter_id = $1`, [ctx.matterId]);
    expect(Number(times.rows[0].n)).toBe(1);
    expect(Number(invoices.rows[0].n)).toBe(2);
  });
});
