import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { firmDay } from "./helpers/firm-day";
import { asMaintenance, asUser, createTestDb, expectDbError, queryInternal, type TestDb } from "./helpers/postgres";

/**
 * Quote builder, Agreement editor and Compare versions (20261020140000–20261020140100): quotes
 * with lines and instalments, clause splitting and editing, locked versions, role gates, tenant
 * isolation and sample mode. The database decides who may do each.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const SCOPE = "Prepare a fictional application and nothing else.";
const TEMPLATE_BODY = [
  "## !Parties and consultant identity",
  "The firm and the client, named on the matter.",
  "",
  "## Scope of services",
  "The services in the scope summary.",
  "",
  "## Communication",
  "Portal messages; replies within 2 business days.",
  "",
  "## Fees and disbursements",
  "Professional fees, tax and disbursements shown separately.",
].join("\n");

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

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, address]);
  return id;
}

async function membership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const manager = await createUser(email("manager"));
  const assistant = await createUser(email("assistant"));
  const client = await createUser(email("client"));
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await membership(orgId, manager, "case_manager", owner);
  const assistantMembership = await membership(orgId, assistant, "assistant", owner);
  await membership(orgId, client, "client", owner);
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
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const made = await db.query<{ result: { id: string } }>(`select public.create_engaged_matter($1, true, $2, null, $3) as result`, [
    "Synthetic sample matter",
    consultantMembership,
    SCOPE,
  ]);
  const matterId = made.rows[0].result.id;
  await db.query(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2)`, [orgId, client]);
  const person = await db.query<{ id: string }>(`select id from public.persons where organization_id = $1 and user_id = $2`, [orgId, client]);
  const applicant = person.rows[0].id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, applicant]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [
    orgId,
    matterId,
    managerMembership,
  ]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [
    orgId,
    matterId,
    assistantMembership,
  ]);
  const consultantSession = () => asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  return { orgId, owner, consultant, manager, assistant, client, matterId, applicant, consultantSession };
}

async function approvedTemplate(kind: string, name: string, body: string, mandatory: string[] | null = null) {
  const row = await db.query<{ id: string }>(`select public.create_agreement_template($1::public.agreement_kind, $2, $3) as id`, [kind, name, body]);
  const id = row.rows[0].id;
  if (mandatory) {
    await asMaintenance(db);
    await db.query(`update public.agreement_templates set mandatory_clauses = $2 where id = $1`, [id, mandatory]);
  }
  return id;
}

const LINES = JSON.stringify([
  { category: "professional_fee", description: "Milestone 1", amount_cents: 160000 },
  { category: "professional_fee", description: "Milestone 2", amount_cents: 100000 },
  { category: "tax", description: "HST 13% on professional fees", amount_cents: 33800, tax_rate_bps: 1300 },
  { category: "disbursement", description: "Courier, estimated", amount_cents: 6200 },
  { category: "government_fee", description: "IRCC fee per adult", amount_cents: 152500, source_note: "IRCC fee list, read 12 Oct 2026" },
]);
const INSTALMENTS = JSON.stringify([
  { label: "On signing", amount_cents: 150000, paid_as: "advance" },
  { label: "Package released", amount_cents: 150000, paid_as: "invoice_after_delivery" },
]);

async function saveQuote(quoteId: string, lines = LINES, instalments = INSTALMENTS, expires = "current_date + 30") {
  return db.query<{ id: string }>(
    `select public.save_quote($1, $2, 'Eligibility review and forms', 'Appeals', 'Submission package', 'Milestones', 'Unearned advances refunded', ${expires}, 'Paid to IRCC by the client', $3::jsonb, $4::jsonb) as id`,
    [quoteId, SCOPE, lines, instalments],
  );
}

describe("quotes", () => {
  it("creates a quote on a matter with the default expiry, saves its lines in cents and totals them server-side", async () => {
    const ctx = await firm();
    await ctx.consultantSession();
    const quoteId = (await db.query<{ id: string }>(`select public.create_quote($1, 'PR, family class', null) as id`, [ctx.matterId])).rows[0].id;
    const made = await db.query<{ status: string; quote_expires_on: string; days: number }>(
      `select status::text, quote_expires_on::text, (quote_expires_on - current_date)::int as days from public.agreements where id = $1`,
      [quoteId],
    );
    expect(made.rows[0].status).toBe("draft");
    expect(made.rows[0].days).toBeGreaterThanOrEqual(29);
    expect(made.rows[0].days).toBeLessThanOrEqual(31);

    const versionId = (await saveQuote(quoteId)).rows[0].id;
    const version = await db.query<{ fee_cents: string | number; services: string; deliverables: string; fee_structure: string; body: string }>(
      `select fee_cents, services, deliverables, fee_structure, body from public.agreement_versions where id = $1`,
      [versionId],
    );
    // The professional fee snapshot is the sum of the professional_fee lines; the text covers every line.
    expect(Number(version.rows[0].fee_cents)).toBe(260000);
    expect(version.rows[0].services).toBe("Eligibility review and forms");
    expect(version.rows[0].body).toContain("government_fee | IRCC fee per adult | 152500");
    expect(version.rows[0].body).toContain("Total to the firm: 300000 CAD");
    const lines = await db.query<{ category: string; amount_cents: string | number; entered_by: string | null; entered_on: string | null; is_sample: boolean }>(
      `select category::text, amount_cents, entered_by, entered_on, is_sample from public.quote_lines where agreement_version_id = $1 order by position`,
      [versionId],
    );
    expect(lines.rows).toHaveLength(5);
    expect(lines.rows.every((row) => row.is_sample)).toBe(true);
    const government = lines.rows[4];
    expect(government.category).toBe("government_fee");
    expect(government.entered_by).toBe(ctx.consultant);
    expect(government.entered_on).not.toBeNull();
    const instalments = await db.query<{ label: string; paid_as: string }>(`select label, paid_as::text from public.quote_instalments where agreement_version_id = $1 order by position`, [
      versionId,
    ]);
    expect(instalments.rows.map((row) => row.paid_as)).toEqual(["advance", "invoice_after_delivery"]);

    // Saving again edits the unlocked draft in place: same version, replaced rows.
    const again = (await saveQuote(quoteId, JSON.stringify([{ category: "professional_fee", description: "Flat fee", amount_cents: 500000 }]), "[]")).rows[0].id;
    expect(again).toBe(versionId);
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.quote_lines where agreement_version_id = $1`, [versionId]);
    expect(count.rows[0].n).toBe(1);
  });

  it("never invents a government fee and keeps instalments equal to the total to the firm", async () => {
    const ctx = await firm();
    await ctx.consultantSession();
    const quoteId = (await db.query<{ id: string }>(`select public.create_quote($1, 'Quote', null) as id`, [ctx.matterId])).rows[0].id;
    await expectDbError(
      () => saveQuote(quoteId, JSON.stringify([{ category: "government_fee", description: "IRCC fee", amount_cents: 152500 }]), "[]"),
      /dated reference/i,
    );
    await expectDbError(
      () => saveQuote(quoteId, LINES, JSON.stringify([{ label: "On signing", amount_cents: 1, paid_as: "advance" }])),
      /add up to the total/i,
    );
    // Yesterday in the firm's timezone (save_quote counts days there, not in UTC).
    await expectDbError(() => saveQuote(quoteId, LINES, "[]", `'${firmDay(-1)}'::date`), /today or later/i);
    await expectDbError(() => saveQuote(quoteId, JSON.stringify([{ category: "professional_fee", description: "Fee", amount_cents: "12.50" }]), "[]"), /whole amount in cents/i);
  });

  it("sends a quote (locked, no envelope, no email), revises it as a new version, and records who accepted", async () => {
    const ctx = await firm();
    await ctx.consultantSession();
    const quoteId = (await db.query<{ id: string }>(`select public.create_quote($1, 'Quote', null) as id`, [ctx.matterId])).rows[0].id;
    const v1 = (await saveQuote(quoteId)).rows[0].id;
    await expectDbError(() => db.query(`select public.quote_to_agreement($1, null)`, [quoteId]), /send the quote/i);
    const sent = await db.query<{ result: { status: string } }>(`select public.send_quote($1) as result`, [quoteId]);
    expect(sent.rows[0].result.status).toBe("sent");
    const locked = await db.query<{ locked_at: string | null; content_sha256: string | null }>(`select locked_at, content_sha256 from public.agreement_versions where id = $1`, [v1]);
    expect(locked.rows[0].locked_at).not.toBeNull();
    expect(locked.rows[0].content_sha256).toMatch(/^[0-9a-f]{64}$/);
    await asMaintenance(db);
    const envelopes = await db.query<{ n: number }>(`select count(*)::int as n from public.signature_envelopes where agreement_id = $1`, [quoteId]);
    expect(envelopes.rows[0].n).toBe(0);
    const outbox = await db.query<{ n: number }>(`select count(*)::int as n from public.outbox_events where aggregate_id = $1`, [quoteId]);
    expect(outbox.rows[0].n).toBe(0);
    // Locked lines never change, even for the service role path inside a function: a save makes v2.
    await expectDbError(() => db.query(`update public.quote_lines set amount_cents = 1 where agreement_version_id = $1`, [v1]), /locked|permission|denied/i);

    await ctx.consultantSession();
    const v2 = (await saveQuote(quoteId, JSON.stringify([{ category: "professional_fee", description: "Flat fee", amount_cents: 290000 }]), "[]")).rows[0].id;
    expect(v2).not.toBe(v1);
    const revised = await db.query<{ status: string; version_number: number; comparison_note: string; lines: number }>(
      `select agreement.status::text, ver.version_number, ver.comparison_note,
              (select count(*)::int from public.quote_lines line where line.agreement_version_id = $1) as lines
       from public.agreements agreement join public.agreement_versions ver on ver.id = agreement.current_version_id
       where agreement.id = $2`,
      [v1, quoteId],
    );
    expect(revised.rows[0]).toMatchObject({ status: "draft", version_number: 2, comparison_note: "Quote revised", lines: 5 });
    await db.query(`select public.send_quote($1)`, [quoteId]);

    // The client accepts in the portal: who and when are recorded; the quote can't be edited after.
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const seen = await db.query<{ n: number }>(`select count(*)::int as n from public.quote_lines where agreement_version_id = $1`, [v2]);
    expect(seen.rows[0].n).toBe(1);
    await db.query(`select public.accept_quote($1)`, [quoteId]);
    const accepted = await db.query<{ status: string; accepted_by: string; accepted_at: string }>(`select status::text, accepted_by, accepted_at from public.agreements where id = $1`, [quoteId]);
    expect(accepted.rows[0]).toMatchObject({ status: "accepted", accepted_by: ctx.client });
    expect(accepted.rows[0].accepted_at).not.toBeNull();
    await ctx.consultantSession();
    await expectDbError(() => saveQuote(quoteId), /accepted quote/i);

    // Turn into agreement: a service draft from an approved service template, terms carried over.
    const templateId = await approvedTemplate("service", "Synthetic service", TEMPLATE_BODY);
    await ctx.consultantSession();
    await db.query(`select public.approve_agreement_template($1)`, [templateId]);
    const serviceId = (await db.query<{ id: string }>(`select public.quote_to_agreement($1, $2) as id`, [quoteId, templateId])).rows[0].id;
    const service = await db.query<{ kind: string; status: string; fee_cents: string | number; scope_summary: string; clauses: number }>(
      `select agreement.kind::text, agreement.status::text, ver.fee_cents, ver.scope_summary,
              (select count(*)::int from public.agreement_clauses clause where clause.agreement_version_id = ver.id) as clauses
       from public.agreements agreement join public.agreement_versions ver on ver.id = agreement.current_version_id
       where agreement.id = $1`,
      [serviceId],
    );
    expect(service.rows[0]).toMatchObject({ kind: "service", status: "draft", scope_summary: SCOPE, clauses: 4 });
    expect(Number(service.rows[0].fee_cents)).toBe(290000);
  });

  it("gates quote writes to licensed staff (or the owner) with a step-up, and isolates tenants", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.create_quote($1, 'Quote', null)`, [ctx.matterId]), /denied/i);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 60 * 30 });
    await expectDbError(() => db.query(`select public.create_quote($1, 'Quote', null)`, [ctx.matterId]), /step-up/i);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const quoteId = (await db.query<{ id: string }>(`select public.create_quote($1, 'Owner quote', null) as id`, [ctx.matterId])).rows[0].id;
    await saveQuote(quoteId);
    await asUser(db, { userId: ctx.assistant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => saveQuote(quoteId), /denied/i);
    await expectDbError(() => db.query(`select public.send_quote($1)`, [quoteId]), /denied/i);

    // Another firm sees nothing and can do nothing with it.
    const other = await firm();
    await other.consultantSession();
    const rows = await db.query<{ n: number }>(`select count(*)::int as n from public.quote_lines`);
    expect(rows.rows[0].n).toBe(0);
    await expectDbError(() => saveQuote(quoteId), /denied/i);
    await expectDbError(() => db.query(`select public.send_quote($1)`, [quoteId]), /denied/i);
    await expectDbError(() => db.query(`insert into public.quote_lines (organization_id, agreement_version_id, position, category, description, amount_cents) values ($1, $2, 9, 'tax', 'x', 1)`, [other.orgId, quoteId]), /permission|denied|violates/i);
  });
});

describe("agreement clauses", () => {
  it("splits a template into clauses, marks the mandatory ones, and lets only non-mandatory ones be edited", async () => {
    const ctx = await firm();
    await ctx.consultantSession();
    const templateId = await approvedTemplate("service", "Synthetic service", TEMPLATE_BODY, ["Fees and disbursements"]);
    await ctx.consultantSession();
    await db.query(`select public.approve_agreement_template($1)`, [templateId]);
    const agreementId = (
      await db.query<{ id: string }>(
        `select public.create_agreement($1, 'service'::public.agreement_kind, 'Synthetic service', null, $2, null, null, 150000, 'CAD', null, $3, null, null, null) as id`,
        [ctx.matterId, SCOPE, templateId],
      )
    ).rows[0].id;
    const versionId = (await db.query<{ id: string }>(`select current_version_id as id from public.agreements where id = $1`, [agreementId])).rows[0].id;
    const clauses = await db.query<{ id: string; position: number; title: string; body: string; mandatory: boolean; source: string }>(
      `select id, position, title, body, mandatory, source::text from public.agreement_clauses where agreement_version_id = $1 order by position`,
      [versionId],
    );
    expect(clauses.rows.map((row) => [row.position, row.title, row.mandatory, row.source])).toEqual([
      [1, "Parties and consultant identity", true, "template"],
      [2, "Scope of services", false, "template"],
      [3, "Communication", false, "template"],
      [4, "Fees and disbursements", true, "template"],
    ]);
    expect(clauses.rows[2].body).toBe("Portal messages; replies within 2 business days.");

    const parties = clauses.rows[0];
    const communication = clauses.rows[2];
    await expectDbError(() => db.query(`select public.edit_agreement_clause($1, $2, 'Changed')`, [agreementId, parties.id]), /professional reviewer/i);
    await expectDbError(() => db.query(`select public.edit_agreement_clause($1, $2, 'Changed')`, [agreementId, clauses.rows[3].id]), /professional reviewer/i);

    // Unlocked draft: edited in place, same version, text rebuilt with the convention kept.
    const same = (await db.query<{ id: string }>(`select public.edit_agreement_clause($1, $2, 'Portal messages; replies within 1 business day.') as id`, [agreementId, communication.id])).rows[0].id;
    expect(same).toBe(versionId);
    const after = await db.query<{ body: string; clauses: { title: string; body: string; source: string }[] }>(
      `select ver.body, (select jsonb_agg(jsonb_build_object('title', c.title, 'body', c.body, 'source', c.source) order by c.position) from public.agreement_clauses c where c.agreement_version_id = ver.id) as clauses
       from public.agreement_versions ver where ver.id = $1`,
      [versionId],
    );
    expect(after.rows[0].body).toContain("## !Parties and consultant identity\n");
    expect(after.rows[0].body).toContain("## Communication\nPortal messages; replies within 1 business day.");
    expect(after.rows[0].clauses[2]).toEqual({ title: "Communication", body: "Portal messages; replies within 1 business day.", source: "edited" });
    expect(after.rows[0].clauses[1].source).toBe("template");

    // Sent: the version is locked, so an edit supersedes the envelope and makes v2 (comparison kept).
    await db.query(`select public.send_agreement($1, $2::jsonb, $3, null)`, [
      agreementId,
      JSON.stringify([{ role: "client", person_id: ctx.applicant, display_name: "Synthetic applicant" }]),
      `sheet-send-${agreementId}`,
    ]);
    const v2Clauses = await db.query<{ id: string }>(`select id from public.agreement_clauses where agreement_version_id = (select current_version_id from public.agreements where id = $1) and title = 'Communication'`, [agreementId]);
    const v2 = (await db.query<{ id: string }>(`select public.edit_agreement_clause($1, $2, 'Email and portal messages.') as id`, [agreementId, v2Clauses.rows[0].id])).rows[0].id;
    expect(v2).not.toBe(versionId);
    const state = await db.query<{ status: string; version_number: number; comparison_note: string; envelope: string }>(
      `select agreement.status::text, ver.version_number, ver.comparison_note,
              (select status::text from public.signature_envelopes env where env.agreement_id = agreement.id order by sent_at desc limit 1) as envelope
       from public.agreements agreement join public.agreement_versions ver on ver.id = agreement.current_version_id where agreement.id = $1`,
      [agreementId],
    );
    expect(state.rows[0]).toMatchObject({ status: "draft", version_number: 2, comparison_note: "Clause 3 (Communication) edited", envelope: "superseded" });
    // The locked v1 keeps its clauses.
    await asMaintenance(db);
    await expectDbError(() => db.query(`delete from public.agreement_clauses where agreement_version_id = $1`, [versionId]), /locked/i);
    const kept = await db.query<{ n: number }>(`select count(*)::int as n from public.agreement_clauses where agreement_version_id = $1`, [versionId]);
    expect(kept.rows[0].n).toBe(4);
  });

  it("never edits an executed agreement, and a case manager edits while an assistant and another firm cannot", async () => {
    const ctx = await firm();
    await ctx.consultantSession();
    const templateId = await approvedTemplate("service", "Synthetic service", TEMPLATE_BODY);
    await ctx.consultantSession();
    await db.query(`select public.approve_agreement_template($1)`, [templateId]);
    const agreementId = (
      await db.query<{ id: string }>(
        `select public.create_agreement($1, 'service'::public.agreement_kind, 'Synthetic service', null, $2, null, null, null, 'CAD', null, $3, null, null, null) as id`,
        [ctx.matterId, SCOPE, templateId],
      )
    ).rows[0].id;
    const clause = (await db.query<{ id: string }>(`select id from public.agreement_clauses where agreement_version_id = (select current_version_id from public.agreements where id = $1) and title = 'Communication'`, [agreementId])).rows[0].id;
    await asUser(db, { userId: ctx.assistant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.edit_agreement_clause($1, $2, 'x')`, [agreementId, clause]), /denied/i);
    const other = await firm();
    await other.consultantSession();
    await expectDbError(() => db.query(`select public.edit_agreement_clause($1, $2, 'x')`, [agreementId, clause]), /denied/i);
    const invisible = await db.query<{ n: number }>(`select count(*)::int as n from public.agreement_clauses where id = $1`, [clause]);
    expect(invisible.rows[0].n).toBe(0);
    await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.edit_agreement_clause($1, $2, 'Replies within 3 business days.')`, [agreementId, clause]);

    // Signed by everyone: executed, never editable (AGR-04).
    await ctx.consultantSession();
    await db.query(`select public.send_agreement($1, $2::jsonb, $3, null)`, [
      agreementId,
      JSON.stringify([{ role: "client", person_id: ctx.applicant, display_name: "Synthetic applicant" }]),
      `sheet-send-${agreementId}`,
    ]);
    const envelopeId = (await db.query<{ id: string }>(`select id from public.signature_envelopes where agreement_id = $1`, [agreementId])).rows[0].id;
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await queryInternal(db, `select app.sign_agreement($1, true, $2, '203.0.113.10'::inet, 'SyntheticAgent/1.0')`, [envelopeId, `sign-${randomUUID()}`]);
    await ctx.consultantSession();
    const current = (await db.query<{ id: string }>(`select id from public.agreement_clauses where agreement_version_id = (select current_version_id from public.agreements where id = $1) and title = 'Communication'`, [agreementId])).rows[0].id;
    await expectDbError(() => db.query(`select public.edit_agreement_clause($1, $2, 'Changed after signing')`, [agreementId, current]), /executed agreement cannot be edited/i);
  });

  it("splits text without titles into one editable clause and keeps a preamble", async () => {
    const split = await db.query<{ clause_position: number; clause_title: string; clause_body: string; clause_mandatory: boolean; clause_headed: boolean }>(
      `select * from app.split_agreement_clauses($1)`,
      ["Intro line.\n\n## !Fees\nFee text.\n## Scope\n\nScope text.\n"],
    );
    expect(split.rows.map((row) => [row.clause_title, row.clause_body, row.clause_mandatory, row.clause_headed])).toEqual([
      ["Preamble", "Intro line.", false, false],
      ["Fees", "Fee text.", true, true],
      ["Scope", "Scope text.", false, true],
    ]);
    const plain = await db.query<{ clause_title: string; clause_headed: boolean }>(`select clause_title, clause_headed from app.split_agreement_clauses('Just text.')`);
    expect(plain.rows).toEqual([{ clause_title: "Agreement text", clause_headed: false }]);
  });
});
