import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * SEC-01 client two-step, part 3: invoices and payments, client funds, and portal notices. A
 * portal person with a verified second factor reaches them only from a session that completed it;
 * a client without a factor keeps working at aal1. Staff are unchanged.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 12);

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${tag()}@example.test`,
  ]);
  return id;
}

async function membership(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
    [orgId, userId, role],
  );
  return row.rows[0].id;
}

async function client(orgId: string, matterId: string, name: string, factor: "verified" | null) {
  const userId = await createUser("client");
  await membership(orgId, userId, "client");
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, user_id, display_name, is_sample) values ($1, $2, $3, true) returning id`,
    [orgId, userId, name],
  );
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [
    orgId,
    matterId,
    person.rows[0].id,
  ]);
  if (factor) {
    await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', $3)`, [randomUUID(), userId, factor]);
  }
  return { userId, personId: person.rows[0].id };
}

/** A firm (sample mode) with a sample matter, a guarded client (verified factor) and an open one. */
async function firm() {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${tag()}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const matter = await db.query<{ id: string }>(`insert into public.matters (organization_id, title, is_sample) values ($1, 'Synthetic matter', true) returning id`, [orgId]);
  const matterId = matter.rows[0].id;
  const guarded = await client(orgId, matterId, "Synthetic Guarded", "verified");
  const open = await client(orgId, matterId, "Synthetic Open", null);
  return { orgId, matterId, owner, guarded, open };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const asOwner = (f: Firm) => asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
const asClient = (f: Firm, userId: string, aal: "aal1" | "aal2") =>
  asUser(db, { userId, aal, orgId: f.orgId, ...(aal === "aal2" ? { totpAgeSeconds: 30 } : {}) });

async function invoiceFor(f: Firm) {
  const account = `acct_1Syn${tag()}`;
  await asOwner(f);
  await db.query(`select public.record_firm_payment_account($1, $2, false)`, [f.orgId, account]);
  const created = await db.query<{ id: string }>(`select public.create_invoice($1, 'Preparation stage', 113000, 'CAD', $2::date, $3) as id`, [
    f.matterId,
    firmDay(3),
    `inv-${randomUUID()}`,
  ]);
  return created.rows[0].id;
}

async function fundedLedger(f: Firm, personId: string) {
  await asOwner(f);
  const account = await db.query<{ id: string }>(`select public.create_client_account($1, 'Client account', 'Synthetic Bank', '4410') as id`, [f.orgId]);
  const entry = await db.query<{ id: string }>(
    `select public.record_client_deposit($1, $2, $3, 50000, 'cad', 'bank_transfer', 'RBC-0001', $4::date, 'Statement line', $5) as id`,
    [account.rows[0].id, f.matterId, personId, firmDay(), `cf-${randomUUID()}`],
  );
  await db.query(`select public.verify_client_deposit($1)`, [entry.rows[0].id]);
  return entry.rows[0].id;
}

async function ownFunds(personId: string) {
  const ledgers = await db.query(`select id from public.client_fund_ledgers where person_id = $1`, [personId]);
  const entries = await db.query(`select id from public.client_fund_entries where person_id = $1`, [personId]);
  return { ledgers: ledgers.rows.length, entries: entries.rows.length };
}

async function notice(f: Firm, personId: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.portal_notices (organization_id, matter_id, person_id, kind, consultant_name) values ($1, $2, $3, 'consultant_changed', 'Synthetic Consultant') returning id`,
    [f.orgId, f.matterId, personId],
  );
  return row.rows[0].id;
}

const noticesForMe = async (f: Firm) =>
  (await db.query<{ n: Array<{ id: string }> }>(`select public.portal_notices_for_me($1) as n`, [f.orgId])).rows[0].n.map((item) => item.id);

describe("client two-step: invoices and payments", () => {
  it("hides invoices and refuses starting a payment at aal1 for a client with a verified factor", async () => {
    const f = await firm();
    const invoiceId = await invoiceFor(f);

    await asClient(f, f.guarded.userId, "aal1");
    expect((await db.query(`select id from public.invoices`)).rows).toHaveLength(0);
    const party = await db.query<{ ok: boolean }>(`select app.is_matter_party($1) as ok`, [f.matterId]);
    expect(party.rows[0].ok).toBe(false);
    await expectDbError(() => db.query(`select public.invoice_payment_context($1)`, [invoiceId]), /invoice not found/);

    await asClient(f, f.guarded.userId, "aal2");
    expect((await db.query(`select id from public.invoices`)).rows).toHaveLength(1);
    const context = await db.query<{ c: Record<string, unknown> }>(`select public.invoice_payment_context($1) as c`, [invoiceId]);
    expect(context.rows[0].c).toMatchObject({ amount_due: 113_000, currency: "CAD" });

    await asClient(f, f.open.userId, "aal1");
    expect((await db.query(`select id from public.invoices`)).rows).toHaveLength(1);
    const open = await db.query<{ c: Record<string, unknown> }>(`select public.invoice_payment_context($1) as c`, [invoiceId]);
    expect(open.rows[0].c).toMatchObject({ amount_due: 113_000 });

    await asOwner(f);
    expect((await db.query(`select id from public.invoices where id = $1`, [invoiceId])).rows).toHaveLength(1);
  });
});

describe("client two-step: client funds", () => {
  it("hides the client's own sub-ledger at aal1 for a client with a verified factor", async () => {
    const f = await firm();
    await fundedLedger(f, f.guarded.personId);
    const openEntry = await fundedLedger(f, f.open.personId);

    await asClient(f, f.guarded.userId, "aal1");
    expect(await ownFunds(f.guarded.personId)).toEqual({ ledgers: 0, entries: 0 });
    const own = await db.query<{ ok: boolean }>(`select app.is_own_person($1) as ok`, [f.guarded.personId]);
    expect(own.rows[0].ok).toBe(false);

    await asClient(f, f.guarded.userId, "aal2");
    expect(await ownFunds(f.guarded.personId)).toEqual({ ledgers: 1, entries: 1 });

    await asClient(f, f.open.userId, "aal1");
    expect(await ownFunds(f.open.personId)).toEqual({ ledgers: 1, entries: 1 });
    expect((await db.query(`select id from public.client_fund_entries where id = $1`, [openEntry])).rows).toHaveLength(1);

    await asOwner(f);
    expect(await ownFunds(f.guarded.personId)).toEqual({ ledgers: 1, entries: 1 });
  });
});

describe("client two-step: portal notices and notice contact", () => {
  it("hides and refuses the client's notices at aal1 for a client with a verified factor", async () => {
    const f = await firm();
    const guardedNotice = await notice(f, f.guarded.personId);
    const openNotice = await notice(f, f.open.personId);

    await asClient(f, f.guarded.userId, "aal1");
    expect(await noticesForMe(f)).toEqual([]);
    await expectDbError(() => db.query(`select public.dismiss_portal_notice($1)`, [guardedNotice]), /notice not found/);
    const seen = await db.query<{ n: number }>(`select public.mark_portal_announcements_seen($1) as n`, [f.orgId]);
    expect(seen.rows[0].n).toBe(0);
    const contact = await db.query<{ ok: boolean }>(`select app.can_read_person_contact($1, $2) as ok`, [f.guarded.personId, f.orgId]);
    expect(contact.rows[0].ok).toBe(false);
    await expectDbError(() => db.query(`select public.set_my_whatsapp_notices($1, 'email')`, [f.orgId]), /whatsapp preference denied/);

    await asClient(f, f.guarded.userId, "aal2");
    expect(await noticesForMe(f)).toEqual([guardedNotice]);
    const allowed = await db.query<{ ok: boolean }>(`select app.can_read_person_contact($1, $2) as ok`, [f.guarded.personId, f.orgId]);
    expect(allowed.rows[0].ok).toBe(true);
    await db.query(`select public.dismiss_portal_notice($1)`, [guardedNotice]);
    expect(await noticesForMe(f)).toEqual([]);

    await asClient(f, f.open.userId, "aal1");
    expect(await noticesForMe(f)).toEqual([openNotice]);
    await db.query(`select public.dismiss_portal_notice($1)`, [openNotice]);
    expect(await noticesForMe(f)).toEqual([]);
    const openContact = await db.query<{ ok: boolean }>(`select app.can_read_person_contact($1, $2) as ok`, [f.open.personId, f.orgId]);
    expect(openContact.rows[0].ok).toBe(true);
  });
});
