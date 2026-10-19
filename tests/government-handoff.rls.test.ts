import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * T036 to T039 against the real migrations: manual submission handoff, government
 * correspondence, decisions, and post-decision follow-ups. Synthetic records only.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

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
  const outsider = await createUser("outsider");
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
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, null, null, null, $2, null, null) as result`, [
    "Synthetic Applicant",
    consultantMembership,
  ]);
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  const party = await db.query<{ person_id: string }>(
    `select person_id from public.matter_participants where matter_id = $1 and person_id is not null limit 1`,
    [matterId],
  );
  const personId = party.rows[0].person_id;
  // The manager is assigned to the matter, so consultant scope lets them read it.
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role, created_by) values ($1, $2, $3, 'case_manager', $4)`,
    [orgId, matterId, managerMembership, owner],
  );
  await db.query(`update public.persons set user_id = $1 where id = $2`, [client, personId]);
  await activeMembership(orgId, client, "client", owner);
  return { owner, consultant, manager, assistant, outsider, client, orgId, matterId, personId, consultantMembership, managerMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function representation(ctx: Firm) {
  await fresh(ctx.consultant, ctx.orgId);
  await db.query(`select public.record_representation_authority($1, $2, 'Synthetic representation scope', 'Synthetic signed form', $3::date, null)`, [
    ctx.matterId,
    ctx.personId,
    firmDay(),
  ]);
}

async function handoff(ctx: Firm) {
  await moveStage(ctx.matterId, "ready_to_submit");
  await stale(ctx.manager, ctx.orgId);
  const prepared = await db.query<{ id: string }>(
    `select public.prepare_submission_handoff($1, 'Package v3', $2, 'online_portal') as id`,
    [ctx.matterId, "a".repeat(64)],
  );
  return prepared.rows[0].id;
}

async function versionOf(table: string, id: string) {
  await asMaintenance(db);
  const row = await db.query<{ version: number }>(`select version from public.${table} where id = $1`, [id]);
  return row.rows[0].version;
}

async function stageEvidence(matterId: string, kind: string) {
  await asMaintenance(db);
  const row = await db.query<{ n: number }>(
    `select count(*)::int as n from public.matter_stage_evidence where matter_id = $1 and kind = $2::public.matter_stage_evidence_kind`,
    [matterId, kind],
  );
  return row.rows[0].n;
}

async function letter(ctx: Firm, kind: string, received = "2026-10-12") {
  await stale(ctx.manager, ctx.orgId);
  const row = await db.query<{ id: string }>(
    `select public.record_government_correspondence($1, $2::public.correspondence_kind, 'Synthetic authority', 'portal_message',
       '2026-10-08', $3::date, 'Send two synthetic documents', 'Within 30 days of this letter', null, null, 'Synthetic letter, page 1', null) as id`,
    [ctx.matterId, kind, received],
  );
  return row.rows[0].id;
}

describe("T036 manual submission handoff", () => {
  it("needs consultant sign-off with representation on file, and stays unverified without a receipt", async () => {
    const ctx = await firm();
    const id = await handoff(ctx);

    // Only one open handoff per matter.
    await expectDbError(
      () => db.query(`select public.prepare_submission_handoff($1, 'Package v4', null, 'paper')`, [ctx.matterId]),
      /open submission handoff/,
    );
    // A case manager cannot sign off; a consultant needs representation on file and a fresh step-up.
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.sign_off_submission_handoff($1, 1)`, [id]), /denied/);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.sign_off_submission_handoff($1, 1)`, [id]), /representation authority/);
    await representation(ctx);
    await stale(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.sign_off_submission_handoff($1, 1)`, [id]), /step-up/);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.sign_off_submission_handoff($1, 9)`, [id]), /version conflict/);
    await db.query(`select public.sign_off_submission_handoff($1, 1)`, [id]);

    // The submitting representative must be licensed; no receipt means "submission unverified".
    await fresh(ctx.manager, ctx.orgId);
    const version = await versionOf("submission_handoffs", id);
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(
      () =>
        db.query(`select public.record_submission($1, $2, 'SYN-REF-1', statement_timestamp(), $3, null, null, null)`, [
          id,
          version,
          ctx.managerMembership,
        ]),
      /licensed member/,
    );
    await db.query(`select public.record_submission($1, $2, 'SYN-REF-1', statement_timestamp(), $3, null, null, null)`, [
      id,
      version,
      ctx.consultantMembership,
    ]);
    await asMaintenance(db);
    const row = await db.query<{ status: string }>(`select status::text as status from public.submission_handoffs where id = $1`, [id]);
    expect(row.rows[0].status).toBe("submission_unverified");
    expect(await stageEvidence(ctx.matterId, "submission_confirmation")).toBe(0);

    // The Submitted stage still refuses: no verified evidence yet.
    await fresh(ctx.consultant, ctx.orgId);
    const matterVersion = await db.query<{ version: number }>(`select version from public.matters where id = $1`, [ctx.matterId]);
    await expectDbError(
      () => db.query(`select public.transition_matter_stage($1, 'submitted', $2, 'Submitted')`, [ctx.matterId, matterVersion.rows[0].version]),
      /evidence is missing/,
    );

    // A receipt verifies it and writes the stage-entry evidence; the matter can then move.
    const unverified = await versionOf("submission_handoffs", id);
    await fresh(ctx.manager, ctx.orgId);
    await db.query(`select public.verify_submission_receipt($1, $2, null, 'Synthetic confirmation page', $3::date)`, [id, unverified, firmDay()]);
    expect(await stageEvidence(ctx.matterId, "submission_confirmation")).toBe(1);
    await fresh(ctx.consultant, ctx.orgId);
    const latest = await db.query<{ version: number; government_status: string }>(
      `select version, government_status::text as government_status from public.matters where id = $1`,
      [ctx.matterId],
    );
    expect(latest.rows[0].government_status).toBe("receipt_on_file");
    await db.query(`select public.transition_matter_stage($1, 'submitted', $2, 'Submission verified')`, [ctx.matterId, latest.rows[0].version]);

    // Direct writes are refused; a recorded submission is not cancelled.
    await fresh(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`update public.submission_handoffs set status = 'cancelled' where id = $1`, [id]), /permission denied/);
    await expectDbError(
      () => db.query(`select public.cancel_submission_handoff($1, $2, 'Synthetic reason')`, [id, 99]),
      /version conflict|not cancelled/,
    );
  });

  it("keeps submission records to the firm's own staff on the matter", async () => {
    const ctx = await firm();
    const id = await handoff(ctx);
    await fresh(ctx.client, ctx.orgId);
    const client = await db.query(`select id from public.submission_handoffs where id = $1`, [id]);
    expect(client.rows).toHaveLength(0);
    const other = await firm();
    await fresh(other.owner, other.orgId);
    const foreign = await db.query(`select id from public.submission_handoffs where id = $1`, [id]);
    expect(foreign.rows).toHaveLength(0);
    // Another firm's staff cannot prepare a handoff on this matter.
    await expectDbError(() => db.query(`select public.prepare_submission_handoff($1, 'Package x', null, 'paper')`, [ctx.matterId]), /denied/);
  });
});

describe("T037 government correspondence", () => {
  it("keeps every letter as received, separates its dates, and opens a review task for a request", async () => {
    const ctx = await firm();
    await moveStage(ctx.matterId, "government_processing");
    const first = await letter(ctx, "request", "2026-10-12");
    const second = await letter(ctx, "request", "2026-10-15");
    await asMaintenance(db);
    const rows = await db.query<{ id: string; received_on: string; document_date: string; created_today: boolean }>(
      `select id, received_on::text, document_date::text, created_at::date = current_date as created_today
       from public.government_correspondence where matter_id = $1 order by received_on`,
      [ctx.matterId],
    );
    expect(rows.rows.map((row) => row.received_on)).toEqual(["2026-10-12", "2026-10-15"]);
    expect(rows.rows[0]).toMatchObject({ id: first, document_date: "2026-10-08", created_today: true });
    const tasks = await db.query<{ n: number }>(
      `select count(*)::int as n from public.correspondence_work_links where correspondence_id in ($1, $2) and task_id is not null`,
      [first, second],
    );
    expect(tasks.rows[0].n).toBe(2);

    // Nothing overwrites the original: not even through the verification path.
    await fresh(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`update public.government_correspondence set received_on = '2026-10-01' where id = $1`, [first]), /permission denied/);
    await asMaintenance(db);
    await expectDbError(
      () =>
        db.query(
          `do $$ begin
             insert into app.gov_write_nonce values ('${first}', txid_current());
             update public.government_correspondence set received_on = '2026-10-01' where id = '${first}';
           end $$`,
        ),
      /not overwritten/,
    );
    // A correction is a new row pointing at the original.
    await stale(ctx.manager, ctx.orgId);
    await db.query(
      `select public.record_government_correspondence($1, 'request', null, 'mail', null, '2026-10-13', null, null, null, null, 'Synthetic corrected copy', $2)`,
      [ctx.matterId, first],
    );
    await expectDbError(
      () =>
        db.query(
          `select public.record_government_correspondence($1, 'request', null, 'mail', null, $2::date, null, null, null, null, null, null)`,
          [ctx.matterId, firmDay(1)],
        ),
      /future/,
    );

    // Verification needs a fresh step-up and a role above assistant; then the status follows.
    await stale(ctx.assistant, ctx.orgId);
    await expectDbError(() => db.query(`select public.verify_government_correspondence($1, 1)`, [first]), /denied/);
    await fresh(ctx.manager, ctx.orgId);
    await db.query(`select public.verify_government_correspondence($1, 1)`, [first]);
    await asMaintenance(db);
    const status = await db.query<{ government_status: string }>(`select government_status::text as government_status from public.matters where id = $1`, [
      ctx.matterId,
    ]);
    expect(status.rows[0].government_status).toBe("additional_request_open");
  });

  it("links a deadline from the deadlines table and shows clients only what the firm shared", async () => {
    const ctx = await firm();
    const id = await letter(ctx, "acknowledgement");
    await stale(ctx.manager, ctx.orgId);
    const deadline = await db.query<{ id: string }>(
      `select public.record_deadline($1, null, 'correspondence', 'Respond to the synthetic request', null, '2026-10-12', '2026-11-12', null,
         'America/Toronto', null, null, null, null, 'Synthetic letter, page 1') as id`,
      [ctx.matterId],
    );
    await db.query(`select public.link_correspondence_work($1, $2, null)`, [id, deadline.rows[0].id]);
    await expectDbError(() => db.query(`select public.link_correspondence_work($1, null, null)`, [id]), /one deadline or one task/);

    await fresh(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.government_correspondence where id = $1`, [id])).rows).toHaveLength(0);
    await fresh(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.share_government_record('correspondence', $1)`, [id]), /verified letter/);
    await db.query(`select public.verify_government_correspondence($1, 1)`, [id]);
    await db.query(`select public.share_government_record('correspondence', $1)`, [id]);
    await fresh(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.government_correspondence where id = $1`, [id])).rows).toHaveLength(1);
    // Links and checks stay staff-only.
    expect((await db.query(`select id from public.correspondence_work_links where correspondence_id = $1`, [id])).rows).toHaveLength(0);

    const other = await firm();
    await fresh(other.owner, other.orgId);
    expect((await db.query(`select id from public.government_correspondence where id = $1`, [id])).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.record_government_check($1, 'Synthetic check')`, [ctx.matterId]), /denied/);
  });
});

describe("T038 and T039 decisions", () => {
  async function decisionLetter(ctx: Firm) {
    await moveStage(ctx.matterId, "decision_review");
    const id = await letter(ctx, "decision");
    return id;
  }

  it("records a decision only from a verified decision letter, and counts it only after consultant confirmation", async () => {
    const ctx = await firm();
    const id = await decisionLetter(ctx);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.record_decision($1, 'approved', 'final_approval', null, null)`, [id]), /verified decision letter/);
    await fresh(ctx.manager, ctx.orgId);
    await db.query(`select public.verify_government_correspondence($1, 1)`, [id]);
    expect(await stageEvidence(ctx.matterId, "official_decision")).toBe(1);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.record_decision($1, 'refused', 'final_approval', null, null)`, [id]), /milestones/);
    const decision = await db.query<{ id: string }>(`select public.record_decision($1, 'approved', 'final_approval', '2026-10-10', null) as id`, [id]);
    const decisionId = decision.rows[0].id;

    await asMaintenance(db);
    const before = await db.query<{ outcome: string | null }>(`select outcome::text as outcome from public.matters where id = $1`, [ctx.matterId]);
    expect(before.rows[0].outcome).toBeNull();

    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.confirm_decision($1, 1, null, 'Synthetic next steps')`, [decisionId]), /denied/);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.confirm_decision($1, 1, null, '')`, [decisionId]), /next steps/);
    await db.query(`select public.confirm_decision($1, 1, 'Synthetic reading', 'Synthetic next steps reviewed')`, [decisionId]);
    await asMaintenance(db);
    const after = await db.query<{ outcome: string }>(`select outcome::text as outcome from public.matters where id = $1`, [ctx.matterId]);
    expect(after.rows[0].outcome).toBe("approved");
    expect(await stageEvidence(ctx.matterId, "outcome_and_follow_up")).toBe(1);
    const follow = await db.query<{ kind: string }>(`select kind::text as kind from public.decision_follow_ups where decision_id = $1 order by kind`, [decisionId]);
    expect(follow.rows.map((row) => row.kind)).toEqual(["conditions_summary", "document_delivery", "closure_checklist"].sort());
    // Nothing in the decision path touched an invoice or a payment.
    const money = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log where organization_id = $1 and (action like 'invoice.%' or action like 'payment.%' or action like 'client_funds.%')`,
      [ctx.orgId],
    );
    expect(money.rows[0].n).toBe(0);

    // A client sees the decision only once it is shared.
    await fresh(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.decision_records where id = $1`, [decisionId])).rows).toHaveLength(0);
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.share_government_record('decision', $1)`, [decisionId]);
    await fresh(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.decision_records where id = $1`, [decisionId])).rows).toHaveLength(1);
    expect((await db.query(`select id from public.decision_follow_ups where decision_id = $1`, [decisionId])).rows).toHaveLength(0);
  });

  it("opens an urgent consultant review on a refusal with no calculated deadline, and records withdrawal steps", async () => {
    const ctx = await firm();
    const id = await decisionLetter(ctx);
    await fresh(ctx.manager, ctx.orgId);
    await db.query(`select public.verify_government_correspondence($1, 1)`, [id]);
    const refused = await db.query<{ id: string }>(`select public.record_decision($1, 'refused', null, null, 'Synthetic quoted reasons') as id`, [id]);
    await asMaintenance(db);
    const urgent = await db.query<{ priority: string; title: string; due_on: string }>(
      `select task.priority::text as priority, task.title, task.due_on::text
       from public.decision_follow_ups follow join public.tasks task on task.id = follow.task_id
       where follow.decision_id = $1 and follow.kind = 'refusal_review'`,
      [refused.rows[0].id],
    );
    expect(urgent.rows[0]).toMatchObject({ priority: "critical", title: "Urgent: consultant review of refusal" });
    const deadlines = await db.query<{ n: number }>(`select count(*)::int as n from public.deadlines where matter_id = $1`, [ctx.matterId]);
    expect(deadlines.rows[0].n).toBe(0);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.record_decision_step($1, 'withdrawal_instructions', null)`, [refused.rows[0].id]), /withdrawal/);

    const second = await firm();
    const letterId = await decisionLetter(second);
    await fresh(second.manager, second.orgId);
    await db.query(`select public.verify_government_correspondence($1, 1)`, [letterId]);
    const withdrawn = await db.query<{ id: string }>(`select public.record_decision($1, 'withdrawn', null, null, null) as id`, [letterId]);
    await stale(second.manager, second.orgId);
    await db.query(`select public.record_decision_step($1, 'withdrawal_instructions', 'Synthetic written instructions')`, [withdrawn.rows[0].id]);
    await expectDbError(() => db.query(`select public.record_decision_step($1, 'consultant_review', null)`, [withdrawn.rows[0].id]), /denied/);
    await expectDbError(() => db.query(`select public.record_decision_step($1, 'withdrawal_instructions', null)`, [withdrawn.rows[0].id]), /duplicate|unique/);
  });

  it("adds an expiry reminder only after confirmation, due on or before the recorded expiry", async () => {
    const ctx = await firm();
    const id = await decisionLetter(ctx);
    await fresh(ctx.manager, ctx.orgId);
    await db.query(`select public.verify_government_correspondence($1, 1)`, [id]);
    const decision = await db.query<{ id: string }>(`select public.record_decision($1, 'approved', 'documents_issued', null, null) as id`, [id]);
    const decisionId = decision.rows[0].id;

    // A stored, clean document version on the matter, with an expiry.
    await asMaintenance(db);
    const doc = await db.query<{ id: string }>(
      `insert into public.documents (organization_id, person_id, purpose, audience) values ($1, $2, 'Synthetic permit', 'staff') returning id`,
      [ctx.orgId, ctx.personId],
    );
    const version = await db.query<{ id: string }>(
      `insert into public.document_versions (organization_id, document_id, version_number, storage_key, original_filename, declared_media_type,
         declared_byte_size, upload_state, expires_on, intent_expires_at)
       values ($1, $2, 1, $3, 'permit.pdf', 'application/pdf', 100, 'clean', '2028-03-12', now() + interval '1 hour') returning id`,
      [ctx.orgId, doc.rows[0].id, `${ctx.orgId}/synthetic/${randomUUID()}`],
    );
    await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id) values ($1, $2, $3)`, [
      ctx.orgId,
      doc.rows[0].id,
      ctx.matterId,
    ]);

    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.add_expiry_reminder($1, $2, '2028-01-12', null)`, [decisionId, version.rows[0].id]),
      /after the consultant confirms/,
    );
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.confirm_decision($1, 1, null, 'Synthetic next steps')`, [decisionId]);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.add_expiry_reminder($1, $2, '2028-04-01', null)`, [decisionId, version.rows[0].id]),
      /on or before the expiry/,
    );
    const task = await db.query<{ id: string }>(`select public.add_expiry_reminder($1, $2, '2028-01-12', null) as id`, [decisionId, version.rows[0].id]);
    await asMaintenance(db);
    const row = await db.query<{ title: string; due_on: string }>(`select title, due_on::text from public.tasks where id = $1`, [task.rows[0].id]);
    expect(row.rows[0]).toEqual({ title: "Renewal review: Synthetic permit expires 2028-03-12", due_on: "2028-01-12" });
  });
});

describe("attach evidence to a letter recorded without it (public.attach_correspondence_evidence)", () => {
  it("lets staff on the matter attach it once, then verify; refuses outsiders, a second attach and an empty one", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const created = await db.query<{ id: string }>(
      `select public.record_government_correspondence($1, 'status_update', null, 'other', null, $2::date, null, null, null, null, null, null) as id`,
      [ctx.matterId, firmDay()],
    );
    const id = created.rows[0].id;
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.verify_government_correspondence($1, 1)`, [id]), /attach it first/);

    await stale(ctx.outsider, ctx.orgId);
    await expectDbError(() => db.query(`select public.attach_correspondence_evidence($1, 1, null, 'Synthetic portal screenshot')`, [id]), /denied/);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.attach_correspondence_evidence($1, 1, null, '  ')`, [id]), /attach the letter file/);
    await expectDbError(() => db.query(`select public.attach_correspondence_evidence($1, 1, $2, null)`, [id, randomUUID()]), /stored file on this matter/);

    const attached = await db.query<{ v: number }>(`select public.attach_correspondence_evidence($1, 1, null, 'Synthetic portal screenshot') as v`, [id]);
    expect(attached.rows[0].v).toBe(2);
    await expectDbError(() => db.query(`select public.attach_correspondence_evidence($1, 2, null, 'Another')`, [id]), /already has its evidence/);
    await asMaintenance(db);
    const audit = await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'government.correspondence_evidence_attached'`, [id]);
    expect(audit.rows).toHaveLength(1);

    await fresh(ctx.manager, ctx.orgId);
    await db.query(`select public.verify_government_correspondence($1, 2)`, [id]);
    await asMaintenance(db);
    const row = await db.query<{ evidence_locator: string; verified: boolean }>(
      `select evidence_locator, verified_at is not null as verified from public.government_correspondence where id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ evidence_locator: "Synthetic portal screenshot", verified: true });
  });
});
