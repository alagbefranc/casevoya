import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";
import { serverCapture } from "./helpers/server-capture";

/**
 * DEC-02 approval follow-up against the real migrations: the follow-up checklist (closure tasks
 * and official steps under licensed review), the conditions summary (drafted, approved by a
 * licensed consultant, versioned, only the approved one reaches the client) and the delivery
 * record with acknowledgement. Synthetic records only: the "official" URL is a test string on an
 * allowlisted host, not IRCC content.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const PAGE = "https://www.canada.ca/en/synthetic-test-page.html#synthetic-section";
const HASH = "d".repeat(64);

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
const client = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal1", orgId });

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

async function publishPack(orgId: string, programKey: string) {
  await asMaintenance(db);
  await db.exec(`alter table public.rule_pack_versions disable trigger rule_pack_versions_guard`);
  const pack = await db.query<{ id: string }>(
    `insert into public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version, status, content_frozen)
     values ($1, 'CA', $2, 1, 'published', true) returning id`,
    [orgId, programKey],
  );
  await db.exec(`alter table public.rule_pack_versions enable trigger rule_pack_versions_guard`);
  return pack.rows[0].id;
}

async function firm(programKey = `prog_${randomUUID().replaceAll("-", "").slice(0, 10)}`) {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  const assistant = await createUser("assistant");
  const clientUser = await createUser("client");
  await fresh(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  const assistantMembership = await activeMembership(orgId, assistant, "assistant", owner);

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
  const packId = await publishPack(orgId, programKey);
  await asMaintenance(db);
  await db.exec(`alter table public.matters disable trigger user`);
  await db.query(`update public.matters set program_pack_id = $1 where id = $2`, [packId, matterId]);
  await db.exec(`alter table public.matters enable trigger user`);
  const party = await db.query<{ person_id: string }>(`select person_id from public.matter_participants where matter_id = $1 and person_id is not null limit 1`, [matterId]);
  const personId = party.rows[0].person_id;
  for (const [membership, role] of [
    [managerMembership, "case_manager"],
    [assistantMembership, "assistant"],
  ]) {
    await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role, created_by) values ($1, $2, $3, $4, $5)`, [
      orgId,
      matterId,
      membership,
      role,
      owner,
    ]);
  }
  await db.query(`update public.persons set user_id = $1 where id = $2`, [clientUser, personId]);
  await activeMembership(orgId, clientUser, "client", owner);
  return { owner, consultant, manager, assistant, client: clientUser, orgId, matterId, personId, programKey, consultantMembership, managerMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

/** A stored, clean file on the matter. Returns the version id. */
async function storedFile(ctx: Firm, name: string) {
  await asMaintenance(db);
  const doc = await db.query<{ id: string }>(
    `insert into public.documents (organization_id, person_id, purpose, audience, created_by) values ($1, $2, $3, 'matter', $4) returning id`,
    [ctx.orgId, ctx.personId, `Synthetic ${name}`, ctx.owner],
  );
  const documentId = doc.rows[0].id;
  await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by) values ($1, $2, $3, $4)`, [
    ctx.orgId,
    documentId,
    ctx.matterId,
    ctx.owner,
  ]);
  const checksum = createHash("sha256").update(`${name}-${randomUUID()}`).digest("hex");
  const version = await db.query<{ id: string }>(
    `insert into public.document_versions (organization_id, document_id, version_number, storage_key, original_filename, declared_media_type,
       declared_byte_size, checksum_sha256, upload_state, review_state, intent_expires_at, created_by)
     values ($1, $2, 1, $3, $4, 'application/pdf', 2048, $5, 'clean', 'accepted', now() + interval '15 minutes', $6) returning id`,
    [ctx.orgId, documentId, `${ctx.orgId}/files/${randomUUID()}`, name, checksum, ctx.owner],
  );
  return version.rows[0].id;
}

/** A verified decision letter and an approval recorded from it; confirmed unless asked not to. */
async function approval(ctx: Firm, confirm = true) {
  await moveStage(ctx.matterId, "decision_review");
  await stale(ctx.manager, ctx.orgId);
  const letter = await db.query<{ id: string }>(
    `select public.record_government_correspondence($1, 'decision', 'Synthetic authority', 'portal_message',
       '2026-10-08', '2026-10-12', null, null, null, null, 'Synthetic letter, page 1', null) as id`,
    [ctx.matterId],
  );
  await fresh(ctx.manager, ctx.orgId);
  await db.query(`select public.verify_government_correspondence($1, 1)`, [letter.rows[0].id]);
  await stale(ctx.manager, ctx.orgId);
  const decision = await db.query<{ id: string }>(`select public.record_decision($1, 'approved', 'final_approval', '2026-10-10', null) as id`, [letter.rows[0].id]);
  const decisionId = decision.rows[0].id;
  if (confirm) {
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.confirm_decision($1, 1, null, 'Synthetic next steps reviewed')`, [decisionId]);
  }
  return decisionId;
}

async function rowVersion(table: string, id: string) {
  await asMaintenance(db);
  const row = await db.query<{ version: number }>(`select version from public.${table} where id = $1`, [id]);
  return row.rows[0].version;
}

async function followUpTask(decisionId: string, kind: string) {
  await asMaintenance(db);
  const row = await db.query<{ status: string }>(
    `select task.status::text as status from public.decision_follow_ups follow join public.tasks task on task.id = follow.task_id
     where follow.decision_id = $1 and follow.kind = $2::public.decision_follow_up_kind`,
    [decisionId, kind],
  );
  return row.rows[0]?.status ?? null;
}

async function propose(ctx: Firm, as: string, options: { url?: string; program?: string; snapshot?: boolean; timing?: string | null } = {}) {
  await stale(as, ctx.orgId);
  const snapshot = options.snapshot === false ? null : JSON.stringify(await serverCapture(db, { orgId: ctx.orgId, url: options.url ?? PAGE, snapshot: { sha256: HASH } }));
  const row = await db.query<{ id: string }>(
    `select public.propose_approval_follow_up_step($1, $2, 'Synthetic step after approval', $3, $4, null, null, null, $5::date, null, $6::jsonb) as id`,
    [ctx.orgId, options.program ?? ctx.programKey, options.timing ?? null, options.url ?? PAGE, firmDay(), snapshot],
  );
  return row.rows[0].id;
}

type Portal = {
  summaries: { matter_id: string; number: number; body: string }[];
  deliveries: { id: string; label: string; method: string; acknowledgement: string | null }[];
};
async function portal(ctx: Firm, user = ctx.client) {
  await client(user, ctx.orgId);
  const row = await db.query<{ v: Portal }>(`select public.portal_decision_follow_up($1) as v`, [ctx.orgId]);
  return row.rows[0].v;
}

describe("DEC-02 follow-up checklist: official steps under licensed review", () => {
  it("refuses follow-up work until the approval is confirmed, then ticks only approved steps for the matter's program", async () => {
    const ctx = await firm();
    const decisionId = await approval(ctx, false);

    // An approval is recorded but not confirmed: nothing is ticked, drafted or delivered yet.
    const stepId = await propose(ctx, ctx.manager);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.tick_approval_follow_up_step($1, $2, true)`, [ctx.matterId, stepId]), /after the consultant confirms/);
    await expectDbError(() => db.query(`select public.draft_conditions_summary($1, 'Synthetic summary of the approval conditions.')`, [ctx.matterId]), /after the consultant confirms/);

    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.confirm_decision($1, 1, null, 'Synthetic next steps reviewed')`, [decisionId]);

    // A pending step does not apply until a licensed member approves it.
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.tick_approval_follow_up_step($1, $2, true)`, [ctx.matterId, stepId]), /does not apply/);

    // Review: licensed, fresh step-up; a case manager can't.
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null)`, [stepId]), /denied|licen|staff access/);
    await stale(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null)`, [stepId]), /step-up/);
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null)`, [stepId]);

    // Ticking keeps who and when; the latest event is the state.
    await stale(ctx.assistant, ctx.orgId);
    await db.query(`select public.tick_approval_follow_up_step($1, $2, true)`, [ctx.matterId, stepId]);
    await expectDbError(() => db.query(`select public.tick_approval_follow_up_step($1, $2, true)`, [ctx.matterId, stepId]), /already marked/);
    await db.query(`select public.tick_approval_follow_up_step($1, $2, false)`, [ctx.matterId, stepId]);
    await asMaintenance(db);
    const events = await db.query<{ ticked: boolean; membership_id: string; decision_id: string }>(
      `select ticked, membership_id, decision_id from public.approval_follow_up_events where matter_id = $1 order by created_at`,
      [ctx.matterId],
    );
    expect(events.rows.map((row) => row.ticked)).toEqual([true, false]);
    expect(events.rows[0].decision_id).toBe(decisionId);
    await expectDbError(() => db.query(`update public.approval_follow_up_events set ticked = true where matter_id = $1`, [ctx.matterId]), /append-only/);

    // A step for another program never applies to this matter.
    const other = await propose(ctx, ctx.manager, { program: "other_program" });
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null)`, [other]);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.tick_approval_follow_up_step($1, $2, true)`, [ctx.matterId, other]), /does not apply/);

    // A client reads no firm steps or ticks.
    await client(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.approval_follow_up_steps`)).rows).toHaveLength(0);
    expect((await db.query(`select id from public.approval_follow_up_events`)).rows).toHaveLength(0);
  });

  it("enters a step only from an official federal page with its section, and approves it only with a page snapshot", async () => {
    const ctx = await firm();
    await expectDbError(() => propose(ctx, ctx.manager, { url: "https://www.example.com/page#a" }), /official Government of Canada page|allowlist|not allowed/);
    await expectDbError(() => propose(ctx, ctx.manager, { url: "https://www.canada.ca/en/synthetic-test-page.html" }), /section/);
    await expectDbError(() => propose(ctx, ctx.assistant), /denied|staff access/);
    await expectDbError(() => propose(ctx, ctx.manager, { timing: "x" }), /timing/);

    const noSnapshot = await propose(ctx, ctx.manager, { snapshot: false });
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null)`, [noSnapshot]), /attestation/); // DEC review rules (2026-10-24): approved only with the reviewer's attestation
    await expectDbError(() => db.query(`select public.review_approval_follow_up_step($1, 1, 'rejected', null)`, [noSnapshot]), /why/);
    await db.query(`select public.review_approval_follow_up_step($1, 1, 'rejected', 'No page snapshot')`, [noSnapshot]);

    const stepId = await propose(ctx, ctx.manager, { timing: "As the page words it" });
    await asMaintenance(db);
    const row = await db.query<{ snapshot_sha256: string; source_id: string; snapshot_id: string; timing_text: string; status: string }>(
      `select snapshot_sha256, source_id, snapshot_id, timing_text, status from public.approval_follow_up_steps where id = $1`,
      [stepId],
    );
    expect(row.rows[0]).toMatchObject({ snapshot_sha256: HASH, timing_text: "As the page words it", status: "pending_review" });
    expect(row.rows[0].snapshot_id).toBeTruthy();
    const source = await db.query<{ canonical_url: string }>(`select canonical_url from public.official_sources where id = $1`, [row.rows[0].source_id]);
    expect(source.rows[0].canonical_url).toBe(PAGE.split("#")[0]);
    // The source facts never change once entered.
    await expectDbError(() => db.query(`update public.approval_follow_up_steps set label = 'Changed' where id = $1`, [stepId]), /through their functions|not edited/);

    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null)`, [stepId]);
    const version = await rowVersion("approval_follow_up_steps", stepId);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.retire_approval_follow_up_step($1, $2, '')`, [stepId, version]), /why/);
    await db.query(`select public.retire_approval_follow_up_step($1, $2, 'The official page changed')`, [stepId, version]);
    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 and action like 'decision.follow_up_step_%' order by occurred_at`, [stepId]);
    expect(audit.rows.map((item) => item.action)).toEqual(["decision.follow_up_step_entered", "decision.follow_up_step_approved", "decision.follow_up_step_retired"]);
  });
});

describe("DEC-02 conditions summary", () => {
  it("is drafted by staff, approved by a licensed consultant with step-up, versioned, and only the approved one reaches the client", async () => {
    const ctx = await firm();
    const decisionId = await approval(ctx);
    expect(await followUpTask(decisionId, "conditions_summary")).toBe("open");

    await stale(ctx.assistant, ctx.orgId);
    await expectDbError(() => db.query(`select public.draft_conditions_summary($1, 'Synthetic summary of the approval conditions.')`, [ctx.matterId]), /denied|staff access/);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.draft_conditions_summary($1, 'Too short')`, [ctx.matterId]), /at least 20/);
    const draft = await db.query<{ id: string }>(`select public.draft_conditions_summary($1, 'Synthetic summary of the approval conditions.') as id`, [ctx.matterId]);
    const first = draft.rows[0].id;
    await expectDbError(() => db.query(`select public.draft_conditions_summary($1, 'Another synthetic summary text here.')`, [ctx.matterId]), /already open/);
    await db.query(`select public.revise_conditions_summary($1, 1, 'Synthetic summary of the approval conditions, revised.')`, [first]);

    // The client sees nothing while it is a draft.
    expect((await portal(ctx)).summaries).toEqual([]);
    await client(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.conditions_summaries`)).rows).toHaveLength(0);

    // Approval: licensed, fresh step-up, current version.
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.approve_conditions_summary($1, 2)`, [first]), /denied|licen|staff access/);
    await stale(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.approve_conditions_summary($1, 2)`, [first]), /step-up/);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.approve_conditions_summary($1, 1)`, [first]), /version conflict/);
    await db.query(`select public.approve_conditions_summary($1, 2)`, [first]);

    await asMaintenance(db);
    const approved = await db.query<{ number: number; status: string; body_sha256: string; body: string }>(
      `select number, status, body_sha256, body from public.conditions_summaries where id = $1`,
      [first],
    );
    expect(approved.rows[0]).toMatchObject({ number: 1, status: "approved" });
    expect(approved.rows[0].body_sha256).toBe(createHash("sha256").update(approved.rows[0].body).digest("hex"));
    expect(await followUpTask(decisionId, "conditions_summary")).toBe("done");
    let seen = await portal(ctx);
    expect(seen.summaries).toMatchObject([{ matter_id: ctx.matterId, number: 1, body: "Synthetic summary of the approval conditions, revised." }]);

    // An approved version is never edited; a new draft supersedes it once approved.
    await stale(ctx.manager, ctx.orgId);
    const version = await rowVersion("conditions_summaries", first);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.revise_conditions_summary($1, $2, 'Changing an approved summary text.')`, [first, version]), /not edited/);
    const second = await db.query<{ id: string }>(`select public.draft_conditions_summary($1, 'Second synthetic summary of the conditions.') as id`, [ctx.matterId]);
    seen = await portal(ctx);
    expect(seen.summaries.map((row) => row.number)).toEqual([1]);
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.approve_conditions_summary($1, 1)`, [second.rows[0].id]);
    seen = await portal(ctx);
    expect(seen.summaries).toMatchObject([{ number: 2, body: "Second synthetic summary of the conditions." }]);
    await asMaintenance(db);
    const statuses = await db.query<{ number: number; status: string }>(`select number, status from public.conditions_summaries where matter_id = $1 order by number`, [ctx.matterId]);
    expect(statuses.rows).toEqual([
      { number: 1, status: "superseded" },
      { number: 2, status: "approved" },
    ]);
    const audit = await db.query(`select 1 from public.audit_log where action = 'decision.conditions_summary_approved' and organization_id = $1`, [ctx.orgId]);
    expect(audit.rows).toHaveLength(2);
    await expectDbError(() => db.query(`update public.conditions_summaries set body = 'Changed' where id = $1`, [first]), /through their functions|not edited/);

    // Another firm's client, and another firm's staff, see nothing.
    const other = await firm();
    expect((await portal(other)).summaries).toEqual([]);
    await stale(other.manager, other.orgId);
    expect((await db.query(`select id from public.conditions_summaries where matter_id = $1`, [ctx.matterId])).rows).toHaveLength(0);
    await asUser(db, { userId: other.client, aal: "aal1", orgId: ctx.orgId });
    const forged = await db.query<{ v: Portal }>(`select public.portal_decision_follow_up($1) as v`, [ctx.orgId]);
    expect(forged.rows[0].v.summaries).toEqual([]);
  });
});

describe("DEC-02 delivery record", () => {
  it("records which decision document went to the client, how and when; the client or staff (with evidence) acknowledge it once", async () => {
    const ctx = await firm();
    const decisionId = await approval(ctx);
    const letterFile = await storedFile(ctx, "decision-letter.pdf");
    const other = await firm();
    const foreignFile = await storedFile(other, "foreign.pdf");

    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.record_decision_delivery($1, $2, 'portal', statement_timestamp(), null)`, [ctx.matterId, foreignFile]), /stored file on this matter/);
    await expectDbError(() => db.query(`select public.record_decision_delivery($1, $2, 'fax', statement_timestamp(), null)`, [ctx.matterId, letterFile]), /how it was delivered/);
    await expectDbError(
      () => db.query(`select public.record_decision_delivery($1, $2, 'email', statement_timestamp() + interval '1 day', null)`, [ctx.matterId, letterFile]),
      /future/,
    );
    await stale(ctx.assistant, ctx.orgId);
    await expectDbError(() => db.query(`select public.record_decision_delivery($1, $2, 'portal', statement_timestamp(), null)`, [ctx.matterId, letterFile]), /denied|staff access/);

    await stale(ctx.manager, ctx.orgId);
    const portalDelivery = await db.query<{ id: string }>(`select public.record_decision_delivery($1, $2, 'portal', statement_timestamp(), null) as id`, [
      ctx.matterId,
      letterFile,
    ]);
    const emailDelivery = await db.query<{ id: string }>(
      `select public.record_decision_delivery($1, $2, 'email', statement_timestamp(), 'Sent to the address on file') as id`,
      [ctx.matterId, letterFile],
    );
    expect(await followUpTask(decisionId, "document_delivery")).toBe("done");
    await stale(ctx.assistant, ctx.orgId);
    const read = await db.query<{ document_label: string; method: string }>(`select document_label, method from public.decision_deliveries where matter_id = $1 order by method`, [ctx.matterId]);
    expect(read.rows).toEqual([
      { document_label: "Synthetic decision-letter.pdf", method: "email" },
      { document_label: "Synthetic decision-letter.pdf", method: "portal" },
    ]);

    // The client sees both and acknowledges one in the portal.
    let seen = await portal(ctx);
    expect(seen.deliveries).toHaveLength(2);
    await client(ctx.client, ctx.orgId);
    await db.query(`select public.acknowledge_decision_delivery($1)`, [portalDelivery.rows[0].id]);
    await expectDbError(() => db.query(`select public.acknowledge_decision_delivery($1)`, [portalDelivery.rows[0].id]), /already acknowledged/);
    seen = await portal(ctx);
    expect(seen.deliveries.find((row) => row.id === portalDelivery.rows[0].id)?.acknowledgement).toBe("client_portal");

    // Another firm's client can't acknowledge it.
    await asUser(db, { userId: other.client, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.acknowledge_decision_delivery($1)`, [emailDelivery.rows[0].id]), /denied/);

    // Staff record an acknowledgement only with evidence.
    const version = await rowVersion("decision_deliveries", emailDelivery.rows[0].id);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.record_delivery_acknowledgement($1, $2, $3::date, null, null)`, [emailDelivery.rows[0].id, version, firmDay()]), /evidence/);
    await expectDbError(() => db.query(`select public.record_delivery_acknowledgement($1, $2, $3::date, null, 'short')`, [emailDelivery.rows[0].id, version, firmDay()]), /10 characters/);
    await expectDbError(
      () => db.query(`select public.record_delivery_acknowledgement($1, $2, $3::date, null, 'Client replied to confirm receipt')`, [emailDelivery.rows[0].id, version, firmDay(2)]),
      /acknowledgement date/,
    );
    await db.query(`select public.record_delivery_acknowledgement($1, $2, $3::date, null, 'Client replied to confirm receipt')`, [
      emailDelivery.rows[0].id,
      version,
      firmDay(),
    ]);
    await asMaintenance(db);
    const acked = await db.query<{ acknowledgement: string; ack_recorded_by_membership_id: string; ack_evidence_note: string }>(
      `select acknowledgement, ack_recorded_by_membership_id, ack_evidence_note from public.decision_deliveries where id = $1`,
      [emailDelivery.rows[0].id],
    );
    expect(acked.rows[0]).toEqual({ acknowledgement: "staff_recorded", ack_recorded_by_membership_id: ctx.managerMembership, ack_evidence_note: "Client replied to confirm receipt" });
    await expectDbError(() => db.query(`update public.decision_deliveries set method = 'mail' where id = $1`, [emailDelivery.rows[0].id]), /through their functions|not edited/);

    // Tenant isolation: the other firm's staff read none of it.
    await stale(other.manager, other.orgId);
    expect((await db.query(`select id from public.decision_deliveries where matter_id = $1`, [ctx.matterId])).rows).toHaveLength(0);
    await client(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.decision_deliveries`)).rows).toHaveLength(0);
  });
});

describe("DEC-02 follows the GOV review rules (2026-10-24)", () => {
  async function auditActions(orgId: string, like: string) {
    await asMaintenance(db);
    const rows = await db.query<{ action: string }>(`select action from public.audit_log where organization_id = $1 and action like $2 order by occurred_at`, [orgId, like]);
    return rows.rows.map((row) => row.action);
  }

  it("approves a follow-up step without a page capture only with the reviewer's attestation, stored with who and when", async () => {
    const ctx = await firm();
    const id = await propose(ctx, ctx.manager, { snapshot: false });
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null, null)`, [id]), /attestation/);
    await expectDbError(() => db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null, $2::date)`, [id, firmDay(1)]), /between the day the entry was made and today/);
    await db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null, $2::date)`, [id, firmDay()]);
    await asMaintenance(db);
    const row = await db.query<{ status: string; by: string; on: string; at: string | null }>(
      `select status, page_attested_by_membership_id::text as by, page_attested_on::text as on, page_attested_at::text as at from public.approval_follow_up_steps where id = $1`,
      [id],
    );
    expect(row.rows[0]).toMatchObject({ status: "approved", by: ctx.consultantMembership, on: firmDay() });
    expect(row.rows[0].at).not.toBeNull();
    // With a snapshot nothing is kept.
    const captured = await propose(ctx, ctx.manager);
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null, $2::date)`, [captured, firmDay()]);
    await asMaintenance(db);
    expect((await db.query(`select page_attested_on from public.approval_follow_up_steps where id = $1`, [captured])).rows[0]).toEqual({ page_attested_on: null });
  });

  it("refuses approving your own follow-up step while another licensed member exists", async () => {
    const ctx = await firm();
    const own = await propose(ctx, ctx.consultant);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null, null)`, [own]), /another licensed member/);
    await fresh(ctx.owner, ctx.orgId);
    await db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null, null)`, [own]);
    expect(await auditActions(ctx.orgId, "decision.follow_up_step_approved%")).toEqual(["decision.follow_up_step_approved"]);
  });

  it("conditions summary: whoever drafted or last revised it approves it only when no other licensed member can", async () => {
    const ctx = await firm();
    await approval(ctx);
    // The consultant drafts it: they can't approve it; the owner can.
    await stale(ctx.consultant, ctx.orgId);
    const draft = await db.query<{ id: string }>(`select public.draft_conditions_summary($1, 'Synthetic summary of the approval conditions.') as id`, [ctx.matterId]);
    const first = draft.rows[0].id;
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.approve_conditions_summary($1, 1)`, [first]), /another licensed member/);
    await fresh(ctx.owner, ctx.orgId);
    await db.query(`select public.approve_conditions_summary($1, 1)`, [first]);

    // The case manager drafts, the owner revises: the owner can't approve, the consultant can.
    await stale(ctx.manager, ctx.orgId);
    const second = (await db.query<{ id: string }>(`select public.draft_conditions_summary($1, 'Synthetic second summary of the conditions.') as id`, [ctx.matterId])).rows[0].id;
    await stale(ctx.owner, ctx.orgId);
    await db.query(`select public.revise_conditions_summary($1, 1, 'Synthetic second summary of the conditions, revised.')`, [second]);
    await fresh(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.approve_conditions_summary($1, 2)`, [second]), /another licensed member/);
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.approve_conditions_summary($1, 2)`, [second]);

    // The sole active licensed member may approve their own draft, after a step-up, audited as self.
    await asMaintenance(db);
    // The last-owner guard is a trigger; set it aside only to stage this firm state.
    await db.exec(`alter table public.memberships disable trigger user`);
    await db.query(`update public.memberships set status = 'suspended' where organization_id = $1 and user_id = $2`, [ctx.orgId, ctx.owner]);
    await db.exec(`alter table public.memberships enable trigger user`);
    await stale(ctx.consultant, ctx.orgId);
    const third = (await db.query<{ id: string }>(`select public.draft_conditions_summary($1, 'Synthetic third summary of the conditions.') as id`, [ctx.matterId])).rows[0].id;
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 30 });
    await expectDbError(() => db.query(`select public.approve_conditions_summary($1, 1)`, [third]), /step-up/);
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.approve_conditions_summary($1, 1)`, [third]);
    expect(await auditActions(ctx.orgId, "decision.conditions_summary_approved%")).toEqual([
      "decision.conditions_summary_approved",
      "decision.conditions_summary_approved",
      "decision.conditions_summary_approved_self",
    ]);
  });
});
