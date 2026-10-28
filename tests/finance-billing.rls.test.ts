import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * FIN-06 (20261025140000_fin_billing.sql): time entries and timers, draft invoices from time,
 * effective-dated tax rates, write-offs, invoices and instalment plans from an accepted quote,
 * and government fee lines with their source. Synthetic people, amounts and URLs only; the
 * fee list rows here are synthetic, not IRCC's.
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

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const FEE_LIST = "https://ircc.canada.ca/english/information/fees/fees.asp";
const key = (prefix = "fin") => `${prefix}-${randomUUID()}`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

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

/** A firm in sample mode with a sample matter: owner, assigned consultant and finance user, an unassigned finance user, a client. */
async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const finance = await createUser("finance");
  const otherFinance = await createUser("finance-other");
  const client = await createUser("client");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${randomUUID().replaceAll("-", "").slice(0, 12)}`]);
  const orgId = created.rows[0].id;
  const consultantMembership = await member(orgId, consultant, "licensed_consultant", owner);
  const financeMembership = await member(orgId, finance, "finance_user", owner);
  await member(orgId, otherFinance, "finance_user", owner);
  await member(orgId, client, "client", owner);
  await asMaintenance(db);
  const matterId = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true)`, [matterId, orgId]);
  const person = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`, [orgId, client]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, person.rows[0].id]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant'), ($1, $2, $4, 'assistant')`, [
    orgId,
    matterId,
    consultantMembership,
    financeMembership,
  ]);
  return { owner, consultant, finance, otherFinance, client, orgId, matterId, consultantMembership };
}

async function as(f: Firm, userId: string, stepUp = true) {
  await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: stepUp ? 0 : 20 * 60 });
}

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(sql, params)).rows[0].r;
}

async function invoice(id: string) {
  await asMaintenance(db);
  const row = (await db.query<Record<string, unknown>>(`select * from public.invoices where id = $1`, [id])).rows[0];
  return { ...row, status: String(row.status), issued_on: row.issued_on, amount: Number(row.amount_cents), credited: Number(row.credited_cents), writtenOff: Number(row.written_off_cents) };
}

async function lines(invoiceId: string) {
  await asMaintenance(db);
  return (await db.query<{ amount_cents: string; tax_cents: string; tax_rate_percent: string | null; category: string; minutes: number | null; source_url: string | null }>(
    `select * from public.invoice_lines where invoice_id = $1 order by position`,
    [invoiceId],
  )).rows.map((row) => ({ ...row, amount: Number(row.amount_cents), tax: Number(row.tax_cents) }));
}

async function logTime(f: Firm, userId: string, minutes: number, rate: number, worked = firmDay()) {
  await as(f, userId, false);
  return one<string>(`select public.log_time_entry($1, $2::date, $3, $4, 'Synthetic preparation', true) as r`, [f.matterId, worked, minutes, rate]);
}

/** An accepted quote on the matter: a professional fee, a disbursement, a government fee and two instalments. */
async function acceptedQuote(f: Firm) {
  await asMaintenance(db);
  const agreement = randomUUID();
  const version = randomUUID();
  await db.query(`insert into public.agreements (id, organization_id, matter_id, kind, title, status) values ($1, $2, $3, 'quote', 'Synthetic quote', 'draft')`, [agreement, f.orgId, f.matterId]);
  await db.query(
    `insert into public.agreement_versions (id, organization_id, agreement_id, version_number, canonical_body, scope_summary)
     values ($1, $2, $3, 1, 'Synthetic quote body', 'Synthetic scope summary')`,
    [version, f.orgId, agreement],
  );
  await db.query(
    `insert into public.quote_lines (organization_id, agreement_version_id, position, category, description, amount_cents, source_note, entered_by, entered_on, is_sample)
     values ($1, $2, 1, 'professional_fee', 'Preparation', 100000, null, null, null, true),
            ($1, $2, 2, 'disbursement', 'Courier', 5000, null, null, null, true),
            ($1, $2, 3, 'government_fee', 'Synthetic government fee', 15000, 'Synthetic dated reference', $3, $4::date, true)`,
    [f.orgId, version, f.owner, firmDay()],
  );
  await db.query(
    `insert into public.quote_instalments (organization_id, agreement_version_id, position, label, amount_cents, paid_as, is_sample)
     values ($1, $2, 1, 'On signing', 50000, 'advance', true), ($1, $2, 2, 'On submission', 55000, 'invoice_after_delivery', true)`,
    [f.orgId, version],
  );
  // Agreement rows change only through an agreement function (its write nonce, in one transaction).
  await db.exec(`do $$ begin perform app.open_esign_write('${agreement}'); update public.agreements set current_version_id = '${version}', status = 'accepted' where id = '${agreement}'; perform app.close_esign_write('${agreement}'); end $$`);
  return { agreement, version };
}

describe("time entries", () => {
  it("logs time and runs one timer per person; only matter staff log time; finance reads it", async () => {
    const f = await firm();
    const entry = await logTime(f, f.consultant, 90, 15_000);
    expect(entry).toMatch(/^[0-9a-f-]{36}$/);
    await as(f, f.consultant, false);
    await expectDbError(() => db.query(`select public.log_time_entry($1, $2::date, 30, 1000, 'x', true)`, [f.matterId, firmDay(1)]), /future/);
    await expectDbError(() => db.query(`select public.log_time_entry($1, $2::date, 0, 1000, 'x', true)`, [f.matterId, firmDay()]), /minutes/);
    const timer = await one<string>(`select public.start_timer($1, 12000, 'Call with the client', true) as r`, [f.matterId]);
    await expectDbError(() => db.query(`select public.start_timer($1, 12000, 'Second timer', true)`, [f.matterId]), /already have a timer running/);
    // Another person may not stop it.
    await as(f, f.owner, false);
    await expectDbError(() => db.query(`select public.stop_timer($1)`, [timer]), /time access denied/);
    await as(f, f.consultant, false);
    expect(await one<number>(`select public.stop_timer($1) as r`, [timer])).toBe(1);
    // A finance user and a client do not log time.
    for (const userId of [f.finance, f.client]) {
      await as(f, userId, false);
      await expectDbError(() => db.query(`select public.log_time_entry($1, $2::date, 30, 1000, 'x', true)`, [f.matterId, firmDay()]), /time access denied/);
    }
    await as(f, f.finance, false);
    expect((await db.query(`select id from public.time_entries where matter_id = $1`, [f.matterId])).rows).toHaveLength(2);
    await as(f, f.otherFinance, false);
    expect((await db.query(`select id from public.time_entries where matter_id = $1`, [f.matterId])).rows).toHaveLength(0);
    await as(f, f.client, false);
    expect((await db.query(`select id from public.time_entries`)).rows).toHaveLength(0);
  });

  it("rounds minutes x rate / 60 half away from zero", async () => {
    await asMaintenance(db);
    const rows = await db.query<{ a: string; b: string; c: string }>(
      `select app.time_amount_cents(90, 15000) as a, app.time_amount_cents(7, 10000) as b, app.tax_amount_cents(22500, 13) as c`,
    );
    expect(rows.rows[0]).toEqual({ a: 22500, b: 1167, c: 2925 });
  });

  it("pulls unbilled billable time into a draft invoice: 90 min at $150/h is a $225.00 line", async () => {
    const f = await firm();
    const entry = await logTime(f, f.consultant, 90, 15_000);
    await as(f, f.consultant, false);
    await expectDbError(() => db.query(`select public.create_time_invoice($1, null, $2::date, null, $3)`, [f.matterId, firmDay(30), key()]), /billing access denied/);
    await as(f, f.finance, false);
    const draft = await one<string>(`select public.create_time_invoice($1, null, $2::date, null, $3) as r`, [f.matterId, firmDay(30), key()]);
    const row = await invoice(draft);
    expect(row).toMatchObject({ status: "draft", amount: 22_500, issued_on: null });
    expect(await lines(draft)).toMatchObject([{ category: "professional_fee", minutes: 90, amount: 22_500, tax: 0 }]);
    // Billed time can't be pulled again or discarded; the client doesn't see a draft.
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.create_time_invoice($1, null, $2::date, null, $3)`, [f.matterId, firmDay(30), key()]), /no unbilled billable time/);
    await as(f, f.consultant, false);
    await expectDbError(() => db.query(`select public.discard_time_entry($1)`, [entry]), /on an invoice/);
    // The consultant doesn't read invoices but sees which one their time is on.
    expect((await db.query(`select invoice_status from public.matter_time_invoices($1)`, [f.matterId])).rows).toEqual([{ invoice_status: "draft" }]);
    await as(f, f.otherFinance, false);
    expect((await db.query(`select 1 from public.matter_time_invoices($1)`, [f.matterId])).rows).toHaveLength(0);
    await as(f, f.client, false);
    expect((await db.query(`select id from public.invoices where id = $1`, [draft])).rows).toHaveLength(0);
    // Issuing it: the client now sees the invoice and its line.
    await as(f, f.finance, false);
    expect(await one<{ status: string }>(`select public.issue_invoice_draft($1, null) as r`, [draft])).toMatchObject({ status: "issued" });
    const issued = await invoice(draft);
    expect(issued.status).toBe("issued");
    expect(new Date(String(issued.issued_on)).toISOString().slice(0, 10)).toBe(firmDay());
    await as(f, f.client, false);
    expect((await db.query(`select amount_cents from public.invoice_lines where invoice_id = $1`, [draft])).rows).toEqual([{ amount_cents: 22500 }]);
    // An issued invoice's lines don't change.
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.invoice_lines set amount_cents = 1 where invoice_id = $1`, [draft]), /can't be changed/);
  });

  it("frees the time of a discarded draft", async () => {
    const f = await firm();
    await logTime(f, f.consultant, 30, 20_000);
    await as(f, f.owner, false);
    const first = await one<string>(`select public.create_time_invoice($1, null, $2::date, null, $3) as r`, [f.matterId, firmDay(14), key()]);
    await expectDbError(() => db.query(`select public.discard_invoice_draft($1, 'x')`, [first]), /reason is required/);
    await db.query(`select public.discard_invoice_draft($1, 'Wrong rate')`, [first]);
    await as(f, f.owner, false);
    expect(await invoice(first)).toMatchObject({ status: "draft", discard_reason: "Wrong rate" });
    await as(f, f.owner, false);
    await expectDbError(() => db.query(`select public.issue_invoice_draft($1, null)`, [first]), /isn't a draft/);
    await as(f, f.owner, false);
    const second = await one<string>(`select public.create_time_invoice($1, null, $2::date, null, $3) as r`, [f.matterId, firmDay(14), key()]);
    expect(await invoice(second)).toMatchObject({ status: "draft", amount: 10_000 });
  });
});

describe("tax rates", () => {
  it("are added by the owner or finance with a step-up, never overlap, and draft lines use the rate in effect", async () => {
    const f = await firm();
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.add_tax_rate($1, 'HST Ontario', 13, $2::date, null, 'Synthetic accountant', null)`, [f.orgId, firmDay(-10)]), /step-up/);
    await as(f, f.consultant);
    await expectDbError(() => db.query(`select public.add_tax_rate($1, 'HST Ontario', 13, $2::date, null, 'Synthetic accountant', null)`, [f.orgId, firmDay(-10)]), /staff access denied/);
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.add_tax_rate($1, 'HST Ontario', 13.12345, $2::date, null, 'Synthetic accountant', null)`, [f.orgId, firmDay(-10)]), /four decimals/);
    const rate = await one<string>(`select public.add_tax_rate($1, 'HST Ontario', 13, $2::date, null, 'Synthetic accountant', null) as r`, [f.orgId, firmDay(-10)]);
    await expectDbError(() => db.query(`select public.add_tax_rate($1, 'hst ontario', 15, $2::date, null, 'Synthetic accountant', null)`, [f.orgId, firmDay(5)]), /already applies/);
    // Draft with tax.
    await logTime(f, f.consultant, 90, 15_000);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.create_time_invoice($1, null, $2::date, 'GST', $3)`, [f.matterId, firmDay(30), key()]), /no GST tax rate is in effect/);
    const draft = await one<string>(`select public.create_time_invoice($1, null, $2::date, 'HST Ontario', $3) as r`, [f.matterId, firmDay(30), key()]);
    expect(await invoice(draft)).toMatchObject({ amount: 25_425 });
    expect(await lines(draft)).toMatchObject([{ amount: 22_500, tax: 2_925, tax_rate_percent: "13.0000" }]);
    // Ending the rate before today: issuing refuses, there is no rate on the invoice date.
    await as(f, f.finance);
    await db.query(`select public.end_tax_rate($1, $2::date)`, [rate, firmDay(-1)]);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.issue_invoice_draft($1, null)`, [draft]), /no HST Ontario tax rate is in effect/);
    // A new rate from today: the draft is issued at that rate.
    await as(f, f.owner);
    await db.query(`select public.add_tax_rate($1, 'HST Ontario', 15, $2::date, null, 'Synthetic accountant', 'Synthetic note')`, [f.orgId, firmDay()]);
    await as(f, f.finance, false);
    await db.query(`select public.issue_invoice_draft($1, null)`, [draft]);
    expect(await invoice(draft)).toMatchObject({ status: "issued", amount: 25_875 });
    // Staff read the firm's rates; a client reads none.
    await as(f, f.consultant, false);
    expect((await db.query(`select id from public.tax_rates`)).rows).toHaveLength(2);
    await as(f, f.client, false);
    expect((await db.query(`select id from public.tax_rates`)).rows).toHaveLength(0);
  });
});

describe("write-offs", () => {
  it("reduce an issued invoice's balance with a reason, by billing staff with a step-up, audited and append-only", async () => {
    const f = await firm();
    await logTime(f, f.consultant, 90, 15_000);
    await as(f, f.owner, false);
    const id = await one<string>(`select public.create_time_invoice($1, null, $2::date, null, $3) as r`, [f.matterId, firmDay(30), key()]);
    await expectDbError(() => db.query(`select public.write_off_invoice($1, 2500, 'Goodwill', $2)`, [id, key()]), /step-up/);
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.write_off_invoice($1, 2500, 'Goodwill', $2)`, [id, key()]), /only an issued invoice/);
    await as(f, f.owner, false);
    await db.query(`select public.issue_invoice_draft($1, null)`, [id]);
    for (const userId of [f.consultant, f.otherFinance, f.client]) {
      await as(f, userId);
      await expectDbError(() => db.query(`select public.write_off_invoice($1, 2500, 'Goodwill', $2)`, [id, key()]), /billing access denied/);
    }
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.write_off_invoice($1, 2500, 'x', $2)`, [id, key()]), /reason is required/);
    await expectDbError(() => db.query(`select public.write_off_invoice($1, 22501, 'Goodwill', $2)`, [id, key()]), /more than the balance/);
    const k = key();
    const result = await one<{ status: string; written_off_cents: number }>(`select public.write_off_invoice($1, 2500, 'Goodwill on a late form', $2) as r`, [id, k]);
    expect(result).toMatchObject({ status: "issued", written_off_cents: 2500 });
    // A retry with the same key writes off once.
    await one(`select public.write_off_invoice($1, 2500, 'Goodwill on a late form', $2) as r`, [id, k]);
    expect(await invoice(id)).toMatchObject({ credited: 2500, writtenOff: 2500, status: "issued" });
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'invoice.written_off'`, [id])).rows).toHaveLength(1);
    expect((await db.query(`select 1 from public.invoice_credit_notes where invoice_id = $1`, [id])).rows).toHaveLength(0);
    await expectDbError(() => db.query(`update public.invoice_write_offs set reason = 'changed' where invoice_id = $1`, [id]), /append-only/);
    // Writing off the rest closes it; the client doesn't read write-off reasons.
    await as(f, f.finance);
    expect(await one<{ status: string }>(`select public.write_off_invoice($1, 20000, 'Uncollectable', $2) as r`, [id, key()])).toMatchObject({ status: "credited" });
    expect(await invoice(id)).toMatchObject({ credited: 22_500, writtenOff: 22_500 });
    await as(f, f.client, false);
    expect((await db.query(`select id from public.invoice_write_offs`)).rows).toHaveLength(0);
  });
});

describe("quotes and instalments", () => {
  it("makes one draft invoice from an accepted quote's fee and disbursement lines, once", async () => {
    const f = await firm();
    const quote = await acceptedQuote(f);
    await as(f, f.consultant, false);
    await expectDbError(() => db.query(`select public.create_quote_invoice($1, $2::date, null, $3)`, [quote.agreement, firmDay(30), key()]), /billing access denied/);
    await as(f, f.finance, false);
    const id = await one<string>(`select public.create_quote_invoice($1, $2::date, null, $3) as r`, [quote.agreement, firmDay(30), key()]);
    expect(await invoice(id)).toMatchObject({ status: "draft", amount: 105_000 });
    expect((await lines(id)).map((line) => line.category)).toEqual(["professional_fee", "disbursement"]);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.create_quote_invoice($1, $2::date, null, $3)`, [quote.agreement, firmDay(30), key()]), /already invoiced/);
    await expectDbError(() => db.query(`select public.create_instalment_plan($1, $2::date[])`, [quote.agreement, [firmDay(), firmDay(30)]]), /already invoiced/);
  });

  it("sets up dated instalments with reminder tasks, invoices an after-delivery instalment, and cancels the rest", async () => {
    const f = await firm();
    const quote = await acceptedQuote(f);
    await as(f, f.owner, false);
    await expectDbError(() => db.query(`select public.create_instalment_plan($1, $2::date[])`, [quote.agreement, [firmDay()]]), /due date for each of the 2/);
    await expectDbError(() => db.query(`select public.create_instalment_plan($1, $2::date[])`, [quote.agreement, [firmDay(-1), firmDay(30)]]), /today or later/);
    const plan = await one<string>(`select public.create_instalment_plan($1, $2::date[]) as r`, [quote.agreement, [firmDay(), firmDay(30)]]);
    await asMaintenance(db);
    const items = (await db.query<{ id: string; paid_as: string; due_on: string; task_id: string }>(`select id, paid_as, due_on::text, task_id from public.instalment_plan_items where plan_id = $1 order by position`, [plan])).rows;
    expect(items.map((item) => [item.paid_as, item.due_on])).toEqual([
      ["advance", firmDay()],
      ["invoice_after_delivery", firmDay(30)],
    ]);
    const tasks = (await db.query<{ due_on: string; status: string }>(`select due_on::text, status from public.tasks where id = any ($1::uuid[]) order by due_on`, [items.map((item) => item.task_id)])).rows;
    expect(tasks).toEqual([
      { due_on: firmDay(), status: "open" },
      { due_on: firmDay(30), status: "open" },
    ]);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.create_quote_invoice($1, $2::date, null, $3)`, [quote.agreement, firmDay(30), key()]), /instalment plan/);
    await expectDbError(() => db.query(`select public.invoice_instalment($1, $2::date, null, $3)`, [items[0].id, firmDay(30), key()]), /advance is requested into the client account/);
    const id = await one<string>(`select public.invoice_instalment($1, $2::date, null, $3) as r`, [items[1].id, firmDay(30), key()]);
    expect(await invoice(id)).toMatchObject({ status: "draft", amount: 55_000 });
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.invoice_instalment($1, $2::date, null, $3)`, [items[1].id, firmDay(30), key()]), /already invoiced/);
    expect(await one<number>(`select public.cancel_instalment_plan($1, 'Client withdrew') as r`, [plan])).toBe(2);
    await asMaintenance(db);
    expect((await db.query(`select status from public.tasks where id = any ($1::uuid[])`, [items.map((item) => item.task_id)])).rows).toEqual([{ status: "cancelled" }, { status: "cancelled" }]);
    await as(f, f.client, false);
    expect((await db.query(`select id from public.instalment_plans`)).rows).toHaveLength(0);
  });
});

describe("government fees", () => {
  it("adds a typed government fee only with an official source URL and a checked date", async () => {
    const f = await firm();
    await logTime(f, f.consultant, 60, 10_000);
    await as(f, f.finance, false);
    const id = await one<string>(`select public.create_time_invoice($1, null, $2::date, null, $3) as r`, [f.matterId, firmDay(30), key()]);
    await expectDbError(() => db.query(`select public.add_invoice_government_fee($1, null, 'Synthetic fee', 15000, 'https://example.com/fees', $2::date)`, [id, firmDay()]), /official Government of Canada page/);
    await expectDbError(() => db.query(`select public.add_invoice_government_fee($1, null, 'Synthetic fee', 15000, $2, $3::date)`, [id, FEE_LIST, firmDay(1)]), /not in the future/);
    const line = await one<string>(`select public.add_invoice_government_fee($1, null, 'Synthetic fee', 15000, $2, $3::date) as r`, [id, `${FEE_LIST}#temporary`, firmDay()]);
    expect(await invoice(id)).toMatchObject({ amount: 25_000 });
    expect((await lines(id))[1]).toMatchObject({ category: "government_fee", amount: 15_000, tax: 0, source_url: `${FEE_LIST}#temporary` });
    await as(f, f.finance, false);
    await db.query(`select public.remove_invoice_line($1)`, [line]);
    expect(await invoice(id)).toMatchObject({ amount: 10_000 });
  });

  it("records a fee list snapshot as pending; only a licensed member approves it; only approved rows can be picked", async () => {
    const f = await firm();
    const html = "<synthetic fee list>";
    const rows = [
      { section: "Temporary residence", group: "Synthetic group", name: "Synthetic permit fee", amount_cents: 12_345, anchor: "temporary" },
      { section: "Other", group: null, name: "Synthetic other fee", amount_cents: 500, anchor: "other" },
    ];
    await as(f, f.client, false);
    await expectDbError(() => db.query(`select public.record_government_fee_snapshot($1, $2, statement_timestamp(), $3, $4::jsonb)`, [f.orgId, FEE_LIST, sha(html), JSON.stringify(rows)]), /staff access denied/);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.record_government_fee_snapshot($1, 'https://example.com/x', statement_timestamp(), $2, $3::jsonb)`, [f.orgId, sha(html), JSON.stringify(rows)]), /official/);
    expect(await one<number>(`select public.record_government_fee_snapshot($1, $2, statement_timestamp(), $3, $4::jsonb) as r`, [f.orgId, FEE_LIST, sha(html), JSON.stringify(rows)])).toBe(2);
    expect(await one<number>(`select public.record_government_fee_snapshot($1, $2, statement_timestamp(), $3, $4::jsonb) as r`, [f.orgId, FEE_LIST, sha(html), JSON.stringify(rows)])).toBe(0);
    const refs = (await db.query<{ id: string; status: string; source_url: string }>(`select id, status, source_url from public.government_fee_references order by position`)).rows;
    expect(refs.map((ref) => [ref.status, ref.source_url])).toEqual([
      ["pending_review", `${FEE_LIST}#temporary`],
      ["pending_review", `${FEE_LIST}#other`],
    ]);
    await logTime(f, f.consultant, 60, 10_000);
    await as(f, f.finance, false);
    const id = await one<string>(`select public.create_time_invoice($1, null, $2::date, null, $3) as r`, [f.matterId, firmDay(30), key()]);
    await expectDbError(() => db.query(`select public.add_invoice_government_fee($1, $2, null, null, null, null)`, [id, refs[0].id]), /isn't approved/);
    // The finance user isn't licensed; the owner needs a licence record (declared and checked).
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.review_government_fee_snapshot($1, $2, 'approved', null)`, [f.orgId, sha(html)]), /denied/);
    await as(f, f.consultant);
    const credential = await one<string>(`select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as r`, [
      f.consultantMembership,
      `R${randomUUID().slice(0, 6).toUpperCase()}`,
      PROOF,
    ]);
    await as(f, f.owner);
    await db.query(
      `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, $3, 'Synthetic reviewer note')`,
      [credential, REGISTER, PROOF],
    );
    await as(f, f.consultant);
    expect(await one<number>(`select public.review_government_fee_snapshot($1, $2, 'approved', null) as r`, [f.orgId, sha(html)])).toBe(2);
    await as(f, f.finance, false);
    await expectDbError(() => db.query(`select public.add_invoice_government_fee($1, $2, null, 1, null, null)`, [id, refs[0].id]), /must match/);
    await db.query(`select public.add_invoice_government_fee($1, $2, null, null, null, null)`, [id, refs[0].id]);
    const added = (await lines(id))[1];
    expect(added).toMatchObject({ category: "government_fee", amount: 12_345, source_url: `${FEE_LIST}#temporary` });
    await asMaintenance(db);
    const stored = await db.query<{ source_sha256: string }>(`select source_sha256 from public.invoice_lines where invoice_id = $1 and category = 'government_fee'`, [id]);
    expect(stored.rows[0].source_sha256).toBe(sha(html));
  });
});

describe("isolation", () => {
  it("keeps another firm's time, lines and rates out, and anon reads nothing", async () => {
    const f = await firm();
    const g = await firm();
    await logTime(f, f.consultant, 30, 10_000);
    await as(f, f.owner);
    await db.query(`select public.add_tax_rate($1, 'GST', 5, $2::date, null, 'Synthetic accountant', null)`, [f.orgId, firmDay(-1)]);
    await as(g, g.owner, false);
    expect((await db.query(`select id from public.time_entries`)).rows).toHaveLength(0);
    expect((await db.query(`select id from public.tax_rates`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.create_time_invoice($1, null, $2::date, null, $3)`, [f.matterId, firmDay(30), key()]), /billing access denied/);
    await asAnon(db);
    await expectDbError(() => db.query(`select id from public.time_entries`), /permission denied/);
  });
});
