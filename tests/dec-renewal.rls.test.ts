import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";
import { serverCapture } from "./helpers/server-capture";

/**
 * DEC-02 renewal follow-up against the real migrations: official renewal timings held for
 * licensed review, the expiry recorded from an approval with its internal reminder (official
 * timing or the firm's choice, never a default), the client's renewal reminder gated by their own
 * contact choices and creating a lead (never an invoice), and the renewal fee shown to the client
 * only from the approved IRCC fee list. Synthetic records only: no IRCC value appears here.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const PAGE = "https://www.canada.ca/en/synthetic-renewal-page.html#synthetic-section";
const FEE_LIST = "https://ircc.canada.ca/english/information/fees/fees.asp";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${randomUUID().slice(0, 8)}@example.test`,
  ]);
  return id;
}

async function activeMembership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

const fresh = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
const stale = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 3600 });

async function moveStage(matterId: string, stage: string) {
  await asMaintenance(db);
  await db.query(
    `do $$ begin
       insert into app.matter_stage_transition_nonce (matter_id, txid) values ('${matterId}', txid_current())
         on conflict (matter_id) do update set txid = excluded.txid;
       update public.matters set stage = '${stage}' where id = '${matterId}';
       delete from app.matter_stage_transition_nonce where matter_id = '${matterId}';
     end $$`,
  );
}

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  const assistant = await createUser("assistant");
  const client = await createUser("client");
  await fresh(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  await activeMembership(orgId, assistant, "assistant", owner);

  await fresh(consultant, orgId);
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await fresh(owner, orgId);
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);

  await fresh(consultant, orgId);
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, $2, null, null, $3, null, null) as result`, [
    "Synthetic Applicant",
    `applicant-${randomUUID().slice(0, 8)}@example.test`,
    consultantMembership,
  ]);
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  const party = await db.query<{ person_id: string }>(
    `select person_id from public.matter_participants where matter_id = $1 and role = 'applicant' limit 1`,
    [matterId],
  );
  const personId = party.rows[0].person_id;
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role, created_by) values ($1, $2, $3, 'case_manager', $4)`,
    [orgId, matterId, managerMembership, owner],
  );
  await db.query(`update public.persons set user_id = $1 where id = $2`, [client, personId]);
  await activeMembership(orgId, client, "client", owner);
  return { owner, consultant, manager, assistant, client, orgId, matterId, personId, consultantMembership, managerMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

/** A consultant-confirmed decision with the given outcome. */
async function decision(ctx: Firm, outcome = "approved") {
  await moveStage(ctx.matterId, "decision_review");
  await stale(ctx.manager, ctx.orgId);
  const letter = await db.query<{ id: string }>(
    `select public.record_government_correspondence($1, 'decision'::public.correspondence_kind, 'Synthetic authority', 'portal_message',
       '2026-10-08', $2::date, null, null, null, null, 'Synthetic letter, page 1', null) as id`,
    [ctx.matterId, firmDay()],
  );
  await fresh(ctx.manager, ctx.orgId);
  await db.query(`select public.verify_government_correspondence($1, 1)`, [letter.rows[0].id]);
  const recorded = await db.query<{ id: string }>(`select public.record_decision($1, $2::public.matter_outcome, null, null, null) as id`, [
    letter.rows[0].id,
    outcome,
  ]);
  return recorded.rows[0].id;
}

async function confirm(ctx: Firm, decisionId: string) {
  await fresh(ctx.consultant, ctx.orgId);
  await db.query(`select public.confirm_decision($1, 1, null, 'Synthetic next steps reviewed')`, [decisionId]);
}

async function versionOf(table: string, id: string) {
  await asMaintenance(db);
  const row = await db.query<{ version: number }>(`select version from public.${table} where id = $1`, [id]);
  return row.rows[0].version;
}

async function clientChoices(ctx: Firm, reminders: boolean) {
  await stale(ctx.client, ctx.orgId);
  await db.query(`select public.save_my_contact_preferences(false, false, $1, 'en-CA')`, [reminders]);
}

async function expiry(ctx: Firm, decisionId: string, remindOn: string | null = firmDay(30), timingId: string | null = null) {
  await stale(ctx.manager, ctx.orgId);
  const row = await db.query<{ id: string }>(
    `select public.record_issued_expiry($1, 'Synthetic permit', $2::date, null, $3::date, $4, null) as id`,
    [decisionId, firmDay(120), remindOn, timingId],
  );
  return row.rows[0].id;
}

describe("DEC-02 official renewal timing", () => {
  it("takes only federal official pages, needs a snapshot to be approved, and is approved only by a licensed member with step-up", async () => {
    const ctx = await firm();
    await stale(ctx.assistant, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.propose_renewal_timing($1, null, 'Synthetic permit', 'Synthetic timing words', 30, $2, null, null, null, $3::date, null, null)`, [ctx.orgId, PAGE, firmDay()]),
      /staff access denied|denied/,
    );
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.propose_renewal_timing($1, null, 'Synthetic permit', 'Synthetic timing words', 30, 'https://example.com/x#a', null, null, null, $2::date, null, null)`, [ctx.orgId, firmDay()]),
      /official Government of Canada page/,
    );
    await expectDbError(
      () => db.query(`select public.propose_renewal_timing($1, null, 'Synthetic permit', 'Synthetic timing words', 30, 'https://www.canada.ca/en/synthetic.html', null, null, null, $2::date, null, null)`, [ctx.orgId, firmDay()]),
      /section/,
    );
    await expectDbError(
      () => db.query(`select public.propose_renewal_timing($1, null, 'Synthetic permit', 'Synthetic timing words', 30, $2, null, null, null, $3::date, null, null)`, [ctx.orgId, PAGE, firmDay(1)]),
      /date checked/,
    );
    // Without a snapshot it is kept, but it can't be approved.
    const bare = await db.query<{ id: string }>(
      `select public.propose_renewal_timing($1, null, 'Synthetic permit', 'Synthetic timing words', 30, $2, null, null, null, $3::date, null, null) as id`,
      [ctx.orgId, PAGE, firmDay()],
    );
    const snapshot = await serverCapture(db, { orgId: ctx.orgId, url: PAGE, snapshot: { sha256: sha("synthetic page") } });
    const captured = await db.query<{ id: string }>(
      `select public.propose_renewal_timing($1, null, 'Synthetic permit', 'Synthetic timing words', 30, $2, null, 'IMM 0000', $3::date, $3::date, null, $4::jsonb) as id`,
      [ctx.orgId, PAGE, firmDay(), JSON.stringify(snapshot)],
    );
    // The same page captured again reuses its snapshot.
    await db.query(
      `select public.propose_renewal_timing($1, null, 'Synthetic card', 'Other synthetic words', null, $2, null, null, null, $3::date, null, $4::jsonb)`,
      [ctx.orgId, PAGE, firmDay(), JSON.stringify(snapshot)],
    );
    await asMaintenance(db);
    const snaps = await db.query<{ n: number }>(`select count(*)::int as n from public.source_snapshots where organization_id = $1`, [ctx.orgId]);
    expect(snaps.rows[0].n).toBe(1);
    const row = await db.query<{ form_number: string; status: string }>(`select form_number, status from public.renewal_timings where id = $1`, [captured.rows[0].id]);
    expect(row.rows[0]).toEqual({ form_number: "IMM 0000", status: "pending_review" });

    // A case manager can't approve; a licensed consultant needs a fresh step-up and the snapshot.
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_renewal_timing($1, 1, 'approved', null)`, [captured.rows[0].id]), /denied|licen/);
    await stale(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_renewal_timing($1, 1, 'approved', null)`, [captured.rows[0].id]), /step-up/);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_renewal_timing($1, 1, 'approved', null)`, [bare.rows[0].id]), /attestation/); // DEC review rules (2026-10-24): approved only with the reviewer's attestation
    await expectDbError(() => db.query(`select public.review_renewal_timing($1, 1, 'rejected', null)`, [bare.rows[0].id]), /why/);
    await db.query(`select public.review_renewal_timing($1, 1, 'approved', null)`, [captured.rows[0].id]);
    await expectDbError(() => db.query(`select public.review_renewal_timing($1, 2, 'approved', null)`, [captured.rows[0].id]), /nothing is waiting/);

    // What was read is never edited, and nothing is written directly.
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.renewal_timings set timing_text = 'changed' where id = $1`, [captured.rows[0].id]), /change only through|not edited/);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`update public.renewal_timings set status = 'approved' where id = $1`, [bare.rows[0].id]), /permission denied/);

    // Another firm sees none of it; clients see none of it.
    const other = await firm();
    await stale(other.manager, other.orgId);
    expect((await db.query(`select id from public.renewal_timings where id = $1`, [captured.rows[0].id])).rows).toHaveLength(0);
    await stale(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.renewal_timings`)).rows).toHaveLength(0);
    await fresh(other.consultant, other.orgId);
    await expectDbError(() => db.query(`select public.review_renewal_timing($1, 2, 'rejected', 'Synthetic reason')`, [captured.rows[0].id]), /denied/);

    // Retire needs a reason and a fresh step-up.
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.retire_renewal_timing($1, 2, '')`, [captured.rows[0].id]), /why/);
    await db.query(`select public.retire_renewal_timing($1, 2, 'Synthetic: the page changed')`, [captured.rows[0].id]);
  });
});

describe("DEC-02 expiry reminders", () => {
  it("records the issued document's expiry from a confirmed approval, with an internal reminder on a date staff choose", async () => {
    const ctx = await firm();
    const decisionId = await decision(ctx);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.record_issued_expiry($1, 'Synthetic permit', $2::date, null, $3::date, null, null)`, [decisionId, firmDay(120), firmDay(30)]),
      /approval the consultant confirmed/,
    );
    await confirm(ctx, decisionId);
    await stale(ctx.manager, ctx.orgId);
    // No default date: without an official timing, staff choose it.
    await expectDbError(
      () => db.query(`select public.record_issued_expiry($1, 'Synthetic permit', $2::date, null, null, null, null)`, [decisionId, firmDay(120)]),
      /choose the reminder date/,
    );
    await expectDbError(
      () => db.query(`select public.record_issued_expiry($1, 'Synthetic permit', $2::date, null, $3::date, null, null)`, [decisionId, firmDay(120), firmDay(121)]),
      /on or before the expiry/,
    );
    await expectDbError(
      () => db.query(`select public.record_issued_expiry($1, 'Synthetic permit', $2::date, null, $3::date, null, null)`, [decisionId, firmDay(120), firmDay(-1)]),
      /has passed/,
    );
    const id = await expiry(ctx, decisionId);
    await asMaintenance(db);
    const row = await db.query<{ remind_on: string; timing_id: string | null; title: string; due_on: string; audience: string; owner: string }>(
      `select renewal.remind_on::text, renewal.timing_id, task.title, task.due_on::text, task.audience::text as audience, task.owner_membership_id as owner
       from public.decision_renewals renewal join public.tasks task on task.id = renewal.task_id where renewal.id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({
      remind_on: firmDay(30),
      timing_id: null,
      title: `Renewal review: Synthetic permit expires ${firmDay(120)}`,
      due_on: firmDay(30),
      audience: "internal",
      owner: ctx.consultantMembership,
    });
    const audit = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where organization_id = $1 and action = 'decision.expiry_recorded'`, [ctx.orgId]);
    expect(audit.rows[0].n).toBe(1);

    // A refusal is not an approval; an assistant, another firm and direct writes are refused.
    await stale(ctx.assistant, ctx.orgId);
    await expectDbError(() => db.query(`select public.record_issued_expiry($1, 'Synthetic permit', $2::date, null, $3::date, null, null)`, [decisionId, firmDay(120), firmDay(30)]), /denied/);
    const other = await firm();
    await stale(other.manager, other.orgId);
    await expectDbError(() => db.query(`select public.record_issued_expiry($1, 'Synthetic permit', $2::date, null, $3::date, null, null)`, [decisionId, firmDay(120), firmDay(30)]), /denied/);
    expect((await db.query(`select id from public.decision_renewals where id = $1`, [id])).rows).toHaveLength(0);
    await expectDbError(
      () => db.query(`insert into public.decision_renewals (organization_id, matter_id, decision_id, document_label, expires_on, remind_on, task_id, owner_membership_id, recorded_by_membership_id)
        select organization_id, matter_id, decision_id, 'forged', expires_on, remind_on, task_id, owner_membership_id, recorded_by_membership_id from public.decision_renewals`),
      /permission denied/,
    );
    const refusedFirm = await firm();
    const refused = await decision(refusedFirm, "refused");
    await confirm(refusedFirm, refused);
    await stale(refusedFirm.manager, refusedFirm.orgId);
    await expectDbError(
      () => db.query(`select public.record_issued_expiry($1, 'Synthetic permit', $2::date, null, $3::date, null, null)`, [refused, firmDay(120), firmDay(30)]),
      /approval/,
    );

    // Cancel: needs a reason, cancels the open task, and the row then stays as it is.
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.cancel_decision_renewal($1, 1, '')`, [id]), /why/);
    await db.query(`select public.cancel_decision_renewal($1, 1, 'Synthetic: wrong date typed')`, [id]);
    await asMaintenance(db);
    const task = await db.query<{ status: string }>(`select task.status::text from public.decision_renewals renewal join public.tasks task on task.id = renewal.task_id where renewal.id = $1`, [id]);
    expect(task.rows[0].status).toBe("cancelled");
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.cancel_decision_renewal($1, 2, 'Synthetic again')`, [id]), /cancelled/);
  });

  it("follows an approved official timing's days, and refuses a pending or numberless timing", async () => {
    const ctx = await firm();
    const decisionId = await decision(ctx);
    await confirm(ctx, decisionId);
    await stale(ctx.manager, ctx.orgId);
    const snapshot = await serverCapture(db, { orgId: ctx.orgId, url: PAGE, snapshot: { sha256: sha("synthetic timing page") } });
    const timed = await db.query<{ id: string }>(
      `select public.propose_renewal_timing($1, null, 'Synthetic permit', 'Synthetic timing words', 45, $2, null, null, null, $3::date, null, $4::jsonb) as id`,
      [ctx.orgId, PAGE, firmDay(), JSON.stringify(snapshot)],
    );
    const numberless = await db.query<{ id: string }>(
      `select public.propose_renewal_timing($1, null, 'Synthetic permit', 'Synthetic words without a number', null, $2, null, null, null, $3::date, null, $4::jsonb) as id`,
      [ctx.orgId, PAGE, firmDay(), JSON.stringify(snapshot)],
    );
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.record_issued_expiry($1, 'Synthetic permit', $2::date, null, null, $3, null)`, [decisionId, firmDay(120), timed.rows[0].id]),
      /only an approved official timing/,
    );
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.review_renewal_timing($1, 1, 'approved', null)`, [timed.rows[0].id]);
    await db.query(`select public.review_renewal_timing($1, 1, 'approved', null)`, [numberless.rows[0].id]);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.record_issued_expiry($1, 'Synthetic permit', $2::date, null, null, $3, null)`, [decisionId, firmDay(120), numberless.rows[0].id]),
      /states no number of days/,
    );
    await expectDbError(
      () => db.query(`select public.record_issued_expiry($1, 'Synthetic permit', $2::date, null, $3::date, $4, null)`, [decisionId, firmDay(120), firmDay(10), timed.rows[0].id]),
      /official timing sets the reminder/,
    );
    const id = await expiry(ctx, decisionId, null, timed.rows[0].id);
    await asMaintenance(db);
    const row = await db.query<{ remind_on: string; timing_id: string }>(`select remind_on::text, timing_id from public.decision_renewals where id = $1`, [id]);
    expect(row.rows[0]).toEqual({ remind_on: firmDay(75), timing_id: timed.rows[0].id });
  });
});

describe("DEC-02 renewal reminder and successor lead", () => {
  it("is refused with the reason when the client hasn't opted in, and creates a lead (never an invoice) when they have", async () => {
    const ctx = await firm();
    const decisionId = await decision(ctx);
    await confirm(ctx, decisionId);
    const id = await expiry(ctx, decisionId);

    // No contact choices saved yet.
    await stale(ctx.manager, ctx.orgId);
    const none = await db.query<{ state: { allowed: boolean; reason: string } }>(`select public.renewal_contact_state($1) as state`, [ctx.matterId]);
    expect(none.rows[0].state.allowed).toBe(false);
    expect(none.rows[0].state.reason).toMatch(/hasn't saved contact choices/);
    await expectDbError(
      () => db.query(`select public.set_renewal_reminder($1, 1, 'Synthetic renewal application, preparation and submission', null)`, [id]),
      /renewal reminder refused: .*contact choices/,
    );
    // Opted out.
    await clientChoices(ctx, false);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.set_renewal_reminder($1, 1, 'Synthetic renewal application, preparation and submission', null)`, [id]),
      /Remind me before a deadline.* turned off/,
    );
    // Opted in: scope is required, the fee must be approved.
    await clientChoices(ctx, true);
    await stale(ctx.manager, ctx.orgId);
    const allowed = await db.query<{ state: { allowed: boolean; consent_record_id: string } }>(`select public.renewal_contact_state($1) as state`, [ctx.matterId]);
    expect(allowed.rows[0].state.allowed).toBe(true);
    await expectDbError(() => db.query(`select public.set_renewal_reminder($1, 1, 'short', null)`, [id]), /scope of the new service/);

    // A fee list snapshot, pending then approved by the licensed consultant.
    const rows = [
      { section: "Synthetic section", group: "Synthetic group", name: "Synthetic renewal fee", amount_cents: 12_345, anchor: "synthetic" },
      { section: "Synthetic section", group: null, name: "Synthetic other fee", amount_cents: 500, anchor: "other" },
    ];
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.record_government_fee_snapshot($1, $2, statement_timestamp(), $3, $4::jsonb)`, [ctx.orgId, FEE_LIST, sha("synthetic list"), JSON.stringify(rows)]);
    const pending = await db.query<{ id: string }>(`select id from public.government_fee_references where organization_id = $1 and name = 'Synthetic renewal fee'`, [ctx.orgId]);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.set_renewal_reminder($1, 1, 'Synthetic renewal application, preparation and submission', $2)`, [id, pending.rows[0].id]),
      /approved IRCC fee list/,
    );
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.review_government_fee_snapshot($1, $2, 'approved', null)`, [ctx.orgId, sha("synthetic list")]);

    // The assistant can't; the case manager on the matter can.
    await stale(ctx.assistant, ctx.orgId);
    await expectDbError(() => db.query(`select public.set_renewal_reminder($1, 1, 'Synthetic renewal application, preparation and submission', $2)`, [id, pending.rows[0].id]), /denied/);
    await stale(ctx.manager, ctx.orgId);
    await db.query(`select public.set_renewal_reminder($1, 1, 'Synthetic renewal application, preparation and submission', $2)`, [id, pending.rows[0].id]);
    await expectDbError(
      () => db.query(`select public.set_renewal_reminder($1, 2, 'Synthetic renewal application, preparation and submission', null)`, [id]),
      /already set/,
    );

    await asMaintenance(db);
    const renewal = await db.query<{ lead_id: string; client_person_id: string; consent_record_id: string; fee_name: string }>(
      `select lead_id, client_person_id, consent_record_id, fee_name from public.decision_renewals where id = $1`,
      [id],
    );
    expect(renewal.rows[0]).toMatchObject({ client_person_id: ctx.personId, consent_record_id: allowed.rows[0].state.consent_record_id, fee_name: "Synthetic renewal fee" });
    const lead = await db.query<{ source: string; service_interest: string; tags: string[]; consents: number }>(
      `select lead.source::text as source, lead.service_interest, lead.tags,
         (select count(*)::int from public.lead_consents consent where consent.lead_id = lead.id) as consents
       from public.leads lead where lead.id = $1`,
      [renewal.rows[0].lead_id],
    );
    expect(lead.rows[0]).toEqual({ source: "other", service_interest: "Synthetic renewal application, preparation and submission", tags: ["renewal"], consents: 0 });
    // Nothing billed.
    const invoices = await db.query<{ n: number }>(`select count(*)::int as n from public.invoices where organization_id = $1`, [ctx.orgId]);
    expect(invoices.rows[0].n).toBe(0);
    const audit = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where organization_id = $1 and action = 'decision.renewal_reminder_set'`, [ctx.orgId]);
    expect(audit.rows[0].n).toBe(1);

    // The client sees it in the portal with the approved fee; they can't read the table itself.
    await stale(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.decision_renewals`)).rows).toHaveLength(0);
    const seen = await db.query<{ r: { document_label: string; expires_on: string; timing: unknown; fee: { name: string; amount_cents: number; source_url: string } | null }[] }>(
      `select public.portal_renewal_reminders($1) as r`,
      [ctx.orgId],
    );
    expect(seen.rows[0].r).toHaveLength(1);
    expect(seen.rows[0].r[0]).toMatchObject({
      document_label: "Synthetic permit",
      expires_on: firmDay(120),
      timing: null,
      fee: { name: "Synthetic renewal fee", amount_cents: 12_345, source_url: `${FEE_LIST}#synthetic` },
    });

    // A newer approved snapshot without that fee: the client sees no fee.
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.record_government_fee_snapshot($1, $2, statement_timestamp(), $3, $4::jsonb)`, [ctx.orgId, FEE_LIST, sha("synthetic list 2"), JSON.stringify([rows[1]])]);
    await db.query(`select public.review_government_fee_snapshot($1, $2, 'approved', null)`, [ctx.orgId, sha("synthetic list 2")]);
    await stale(ctx.client, ctx.orgId);
    const later = await db.query<{ r: { fee: unknown }[] }>(`select public.portal_renewal_reminders($1) as r`, [ctx.orgId]);
    expect(later.rows[0].r[0].fee).toBeNull();

    // Opting out later hides it from the portal.
    await clientChoices(ctx, false);
    await stale(ctx.client, ctx.orgId);
    expect((await db.query<{ r: unknown[] }>(`select public.portal_renewal_reminders($1) as r`, [ctx.orgId])).rows[0].r).toEqual([]);

    // Another firm's staff and clients see nothing.
    const other = await firm();
    await stale(other.manager, other.orgId);
    expect((await db.query<{ s: unknown }>(`select public.renewal_contact_state($1) as s`, [ctx.matterId])).rows[0].s).toBeNull();
    await expectDbError(() => db.query(`select public.set_renewal_reminder($1, 2, 'Synthetic renewal application, preparation and submission', null)`, [id]), /denied/);
    await stale(other.client, other.orgId);
    expect((await db.query<{ r: unknown[] }>(`select public.portal_renewal_reminders($1) as r`, [other.orgId])).rows[0].r).toEqual([]);
    expect(await versionOf("decision_renewals", id)).toBe(2);
  });

  it("refuses a client who doesn't use the portal", async () => {
    const ctx = await firm();
    const decisionId = await decision(ctx);
    await confirm(ctx, decisionId);
    const id = await expiry(ctx, decisionId);
    await asMaintenance(db);
    await db.query(`update public.persons set user_id = null where id = $1`, [ctx.personId]);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.set_renewal_reminder($1, 1, 'Synthetic renewal application, preparation and submission', null)`, [id]),
      /doesn't use the portal/,
    );
  });
});

describe("DEC-02 renewal timings follow the GOV review rules (2026-10-24)", () => {
  async function proposeTiming(ctx: Firm, as: string, captured: boolean) {
    await stale(as, ctx.orgId);
    const snapshot = captured ? JSON.stringify(await serverCapture(db, { orgId: ctx.orgId, url: PAGE, snapshot: { sha256: sha(`page ${randomUUID()}`) } })) : null;
    const row = await db.query<{ id: string }>(
      `select public.propose_renewal_timing($1, null, 'Synthetic permit', 'Synthetic timing words', 30, $2, null, null, null, $3::date, null, $4::jsonb) as id`,
      [ctx.orgId, PAGE, firmDay(), snapshot],
    );
    return row.rows[0].id;
  }

  it("approves a timing without a page capture only with the reviewer's attestation, and the client's reminder carries it", async () => {
    const ctx = await firm();
    const id = await proposeTiming(ctx, ctx.manager, false);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_renewal_timing($1, 1, 'approved', null, null)`, [id]), /attestation/);
    await expectDbError(() => db.query(`select public.review_renewal_timing($1, 1, 'approved', null, $2::date)`, [id, firmDay(1)]), /between the day the entry was made and today/);
    await db.query(`select public.review_renewal_timing($1, 1, 'approved', null, $2::date)`, [id, firmDay()]);
    await asMaintenance(db);
    const stored = await db.query<{ by: string; on: string; at: string | null }>(
      `select page_attested_by_membership_id::text as by, page_attested_on::text as on, page_attested_at::text as at from public.renewal_timings where id = $1`,
      [id],
    );
    expect(stored.rows[0]).toMatchObject({ by: ctx.consultantMembership, on: firmDay() });
    expect(stored.rows[0].at).not.toBeNull();

    // A reminder that follows the timing: the client's portal gets the attestation with it.
    const decisionId = await decision(ctx);
    await confirm(ctx, decisionId);
    const renewal = await expiry(ctx, decisionId, null, id);
    await clientChoices(ctx, true);
    await stale(ctx.manager, ctx.orgId);
    await db.query(`select public.set_renewal_reminder($1, 1, 'Synthetic renewal application, preparation and submission', null)`, [renewal]);
    await stale(ctx.client, ctx.orgId);
    const seen = await db.query<{ r: { timing: { snapshot_sha256: string | null; page_attested_on: string | null; page_attested_by: string | null } }[] }>(
      `select public.portal_renewal_reminders($1) as r`,
      [ctx.orgId],
    );
    expect(seen.rows[0].r[0].timing).toMatchObject({ snapshot_sha256: null, page_attested_on: firmDay() });
    expect(typeof seen.rows[0].r[0].timing.page_attested_by).toBe("string");
  });

  it("refuses approving your own timing while another licensed member exists; the sole licensed member may, audited as self", async () => {
    const ctx = await firm();
    const own = await proposeTiming(ctx, ctx.consultant, true);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_renewal_timing($1, 1, 'approved', null, null)`, [own]), /another licensed member/);
    await fresh(ctx.owner, ctx.orgId);
    await db.query(`select public.review_renewal_timing($1, 1, 'approved', null, null)`, [own]);

    // With the owner suspended, the consultant is the firm's only active licensed member.
    await asMaintenance(db);
    // The last-owner guard is a trigger; set it aside only to stage this firm state.
    await db.exec(`alter table public.memberships disable trigger user`);
    await db.query(`update public.memberships set status = 'suspended' where organization_id = $1 and user_id = $2`, [ctx.orgId, ctx.owner]);
    await db.exec(`alter table public.memberships enable trigger user`);
    const solo = await proposeTiming(ctx, ctx.consultant, true);
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.review_renewal_timing($1, 1, 'approved', null, null)`, [solo]);
    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log where organization_id = $1 and action like 'decision.renewal_timing_approved%' order by occurred_at`,
      [ctx.orgId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(["decision.renewal_timing_approved", "decision.renewal_timing_approved_self"]);
  });
});

describe("DES-04 the client's renewal reminder carries its official timing's freshness (20261025451000)", () => {
  type Seen = { timing: { status: string; source_review: string; source_change: string; source_attempt: string | null; source_next_review: string | null } };

  it("returns the timing's status and its official page's review and check state, and shows a retired timing as retired", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const snapshot = JSON.stringify(await serverCapture(db, { orgId: ctx.orgId, url: PAGE, snapshot: { sha256: sha(`page ${randomUUID()}`) } }));
    const proposed = await db.query<{ id: string }>(
      `select public.propose_renewal_timing($1, null, 'Synthetic permit', 'Synthetic timing words', 30, $2, null, null, null, $3::date, null, $4::jsonb) as id`,
      [ctx.orgId, PAGE, firmDay(), snapshot],
    );
    const timingId = proposed.rows[0].id;
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.review_renewal_timing($1, 1, 'approved', null, null)`, [timingId]);

    const decisionId = await decision(ctx);
    await confirm(ctx, decisionId);
    const renewal = await expiry(ctx, decisionId, null, timingId);
    await clientChoices(ctx, true);
    await stale(ctx.manager, ctx.orgId);
    await db.query(`select public.set_renewal_reminder($1, 1, 'Synthetic renewal application', null)`, [renewal]);

    await asMaintenance(db);
    const source = await db.query<{ review_status: string; change_state: string; last_attempt_result: string | null }>(
      `select review_status::text, change_state::text, last_attempt_result::text from public.official_sources
       where id = (select source_id from public.renewal_timings where id = $1)`,
      [timingId],
    );
    await stale(ctx.client, ctx.orgId);
    const seen = await db.query<{ r: Seen[] }>(`select public.portal_renewal_reminders($1) as r`, [ctx.orgId]);
    expect(seen.rows[0].r[0].timing).toMatchObject({
      status: "approved",
      source_review: source.rows[0].review_status,
      source_change: source.rows[0].change_state,
      source_attempt: source.rows[0].last_attempt_result,
    });

    // A licensed member retires the timing after the reminder was set: the client's reminder says so.
    const version = await versionOf("renewal_timings", timingId);
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.retire_renewal_timing($1, $2, 'Synthetic: superseded by a newer page')`, [timingId, version]);
    await stale(ctx.client, ctx.orgId);
    const after = await db.query<{ r: Seen[] }>(`select public.portal_renewal_reminders($1) as r`, [ctx.orgId]);
    expect(after.rows[0].r[0].timing.status).toBe("retired");

    // Still only the client's own: another firm's client sees none of it.
    const other = await firm();
    await stale(other.client, other.orgId);
    expect((await db.query<{ r: unknown[] }>(`select public.portal_renewal_reminders($1) as r`, [other.orgId])).rows[0].r).toEqual([]);
    // And the client can't read the timing or its source table directly.
    await stale(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.renewal_timings where id = $1`, [timingId])).rows).toEqual([]);
  });
});
