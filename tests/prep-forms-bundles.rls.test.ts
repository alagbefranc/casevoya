import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";
import { serverCapture } from "./helpers/server-capture";

/**
 * PREP-01, PREP-03 and PREP-04. Synthetic records only: the official URL is a test string on an
 * allowlisted host, and the form identifier, version and fields are made up for the test.
 * Nothing here is an IRCC form.
 */
let db: TestDb;

const PAGE = "https://www.canada.ca/en/synthetic-test-page.html#synthetic-section";
const HASH = "c".repeat(64);
const FIELDS = JSON.stringify([
  { field_key: "full_name", label: "Synthetic field", required: true, fact_field_key: "full_name" },
  { field_key: "blank_line", label: "Another synthetic field", required: false, fact_field_key: "missing_key" },
  { field_key: "signature", label: "Signature", required: true, fact_field_key: null },
]);

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

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

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  const assistant = await createUser("assistant");
  const client = await createUser("client");
  const outsider = await createUser("outsider");
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
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, "proof/synthetic-register-capture"],
  );
  await fresh(owner, orgId);
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, "https://register.college-ic.ca/Public-Register-EN", "proof/synthetic-register-capture"],
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
  const party = await db.query<{ person_id: string }>(`select person_id from public.matter_participants where matter_id = $1 and person_id is not null limit 1`, [matterId]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role, created_by) values ($1, $2, $3, 'case_manager', $4)`, [
    orgId,
    matterId,
    managerMembership,
    owner,
  ]);
  await fresh(outsider, "");
  const other = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Other Legal Name",
    "Other Firm",
    `o${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  return { owner, consultant, manager, assistant, client, outsider, orgId, otherId: other.rows[0].id, matterId, personId: party.rows[0].person_id, consultantMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function propose(ctx: Firm, formVersion: string, format = "field_review", fields = FIELDS) {
  await stale(ctx.manager, ctx.orgId);
  const snapshot = await serverCapture(db, { orgId: ctx.orgId, url: PAGE, snapshot: { sha256: HASH } });
  const row = await db.query<{ id: string }>(
    `select public.propose_form_template(
       $1::uuid, 'CA', null::text, 'SYN-1', $2::text, 'Synthetic section', $3::text, null::integer, null::date, $4::text, $5::jsonb, $6::date,
       $7::jsonb
     ) as id`,
    [ctx.orgId, PAGE, formVersion, format, fields, firmDay(), JSON.stringify(snapshot)],
  );
  return row.rows[0].id;
}

async function templateVersion(id: string) {
  await asMaintenance(db);
  return (await db.query<{ version: number }>(`select version from public.form_templates where id = $1`, [id])).rows[0].version;
}

async function approve(ctx: Firm, id: string) {
  const version = await templateVersion(id);
  await fresh(ctx.consultant, ctx.orgId);
  await db.query(`select public.review_form_template($1, $2, 'approved', null, null)`, [id, version]);
}

describe("PREP-01 form templates and field mapping", () => {
  it("starts empty, and only a licensed reviewer can approve a template transcribed from an official page", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.form_templates`)).rows[0].n).toBe(0);

    await expectDbError(() => db.query(`insert into public.form_templates (organization_id, jurisdiction, official_form_id, official_url, form_version, mapping_version, checked_on, retrieved_at, output_format, source_id) values ($1, 'CA', 'SYN-9', $2, 'v', 1, current_date, now(), 'field_review', gen_random_uuid())`, [ctx.orgId, PAGE]), /permission denied|row-level security/i);

    const id = await propose(ctx, "synthetic-v1");
    await stale(ctx.assistant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_form_template($1, 1, 'approved', null, null)`, [id]), /denied|staff access/);
    await stale(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_form_template($1, 1, 'approved', null, null)`, [id]), /step-up/);
    await approve(ctx, id);

    await stale(ctx.outsider, ctx.otherId);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.form_templates`)).rows[0].n).toBe(0);
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.form_mapping_review($1)`, [ctx.matterId]), /denied/);

    await stale(ctx.manager, ctx.orgId);
    await db.query(`select public.pin_form_template($1, $2)`, [ctx.matterId, id]);
    const review = await db.query<{ review: { pins: { stale_reason: string | null; fields: { field_key: string; status: string; facts: unknown[] }[] }[] } }>(
      `select public.form_mapping_review($1) as review`,
      [ctx.matterId],
    );
    const pin = review.rows[0].review.pins[0];
    expect(pin.stale_reason).toBeNull();
    expect(pin.fields.map((field) => [field.field_key, field.status])).toEqual([
      ["full_name", "missing"],
      ["blank_line", "missing"],
      ["signature", "manual"],
    ]);

    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.form_template_fields set label = 'changed' where template_id = $1`, [id]), /append-only/);
  });

  it("flags a superseded template as stale and blocks package release until the current one is pinned", async () => {
    const ctx = await firm();
    const first = await propose(ctx, "synthetic-v1");
    await approve(ctx, first);
    await stale(ctx.manager, ctx.orgId);
    await db.query(`select public.pin_form_template($1, $2)`, [ctx.matterId, first]);

    const second = await propose(ctx, "synthetic-v2");
    await approve(ctx, second);
    await stale(ctx.manager, ctx.orgId);
    const review = await db.query<{ review: { pins: { stale_reason: string | null }[] } }>(`select public.form_mapping_review($1) as review`, [ctx.matterId]);
    expect(review.rows[0].review.pins[0].stale_reason).toBe("not_current");

    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.record_representation_authority($1, $2, 'Synthetic representation scope', 'Synthetic signed form', $3::date, null)`, [
      ctx.matterId,
      ctx.personId,
      firmDay(),
    ]);
    await asMaintenance(db);
    await db.query(
      `do $$ begin
         insert into app.matter_stage_transition_nonce (matter_id, txid) values ('${ctx.matterId}', txid_current())
           on conflict (matter_id) do update set txid = excluded.txid;
         update public.matters set stage = 'ready_to_submit' where id = '${ctx.matterId}';
         delete from app.matter_stage_transition_nonce where matter_id = '${ctx.matterId}';
       end $$`,
    );
    await stale(ctx.manager, ctx.orgId);
    const handoff = await db.query<{ id: string }>(`select public.prepare_submission_handoff($1, 'Package v1', null, 'paper'::public.submission_channel) as id`, [ctx.matterId]);
    const handoffId = handoff.rows[0].id;
    await asMaintenance(db);
    const doc = await db.query<{ id: string }>(
      `insert into public.documents (organization_id, person_id, purpose, audience, created_by) values ($1, $2, 'Synthetic passport', 'matter', $3) returning id`,
      [ctx.orgId, ctx.personId, ctx.owner],
    );
    await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by) values ($1, $2, $3, $4)`, [
      ctx.orgId,
      doc.rows[0].id,
      ctx.matterId,
      ctx.owner,
    ]);
    const checksum = createHash("sha256").update(`file-${randomUUID()}`).digest("hex");
    const version = await db.query<{ id: string }>(
      `insert into public.document_versions (organization_id, document_id, version_number, storage_key, original_filename, declared_media_type,
         declared_byte_size, checksum_sha256, upload_state, review_state, intent_expires_at, created_by)
       values ($1, $2, 1, $3, 'passport.pdf', 'application/pdf', 2048, $4, 'clean', 'accepted', now() + interval '15 minutes', $5) returning id`,
      [ctx.orgId, doc.rows[0].id, `${ctx.orgId}/files/${randomUUID()}`, checksum, ctx.owner],
    );

    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.sign_off_submission_handoff($1, 1)`, [handoffId]), /no longer current/);

    await stale(ctx.manager, ctx.orgId);
    await db.query(`select public.pin_form_template($1, $2)`, [ctx.matterId, second]);
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.sign_off_submission_handoff($1, 1)`, [handoffId]);

    await asMaintenance(db);
    const pinned = await db.query<{ template_id: string; form_version: string; content_sha256: string; mapping_version: number }>(
      `select template_id, form_version, content_sha256, mapping_version from public.submission_manifest_forms where handoff_id = $1`,
      [handoffId],
    );
    expect(pinned.rows).toEqual([{ template_id: second, form_version: "synthetic-v2", content_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), mapping_version: 1 }]);
    const facts = await db.query<{ n: number }>(`select count(*)::int as n from public.submission_manifest_facts where handoff_id = $1`, [handoffId]);
    expect(facts.rows[0].n).toBe(0);
    const formHash = createHash("sha256").update(`${second}|SYN-1|synthetic-v2|1|${HASH}|-`).digest("hex");
    expect(pinned.rows[0].content_sha256).toBe(formHash);
    const fileLine = `${version.rows[0].id} ${checksum} passport.pdf`;
    const expected = createHash("sha256").update(`${fileLine}\nFORM ${formHash}`).digest("hex");
    const manifest = await db.query<{ manifest_sha256: string }>(`select manifest_sha256 from public.submission_handoffs where id = $1`, [handoffId]);
    expect(manifest.rows[0].manifest_sha256).toBe(expected);
    await expectDbError(() => db.query(`update public.submission_manifest_forms set form_version = 'x' where handoff_id = $1`, [handoffId]), /append-only/);
    await expectDbError(() => db.query(`delete from public.submission_manifest_forms where handoff_id = $1`, [handoffId]), /append-only/);
  });
});

describe("PREP-04 approved facts snapshot", () => {
  it("copies the approved facts into the manifest and turns the package gate red when they change", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    await db.query(`update public.persons set user_id = $1 where id = $2`, [ctx.client, ctx.personId]);
    await activeMembership(ctx.orgId, ctx.client, "client", ctx.owner);
    await stale(ctx.manager, ctx.orgId);
    const draft = (
      await db.query<{ saved: { id: string; version: number } }>(
        `select public.save_intake_draft('background', 'Synthetic questions', $1::jsonb, null, null) as saved`,
        [JSON.stringify({ fields: [{ key: "full_name", type: "text", labels: { "en-CA": "Full name" }, required: true }] })],
      )
    ).rows[0].saved;
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.publish_intake_draft($1, $2)`, [draft.id, draft.version]);
    await stale(ctx.manager, ctx.orgId);
    const sent = await db.query<{ sent: { response_id: string } }>(`select public.send_intake_request($1, $2, $3, null, null) as sent`, [
      ctx.matterId,
      ctx.personId,
      draft.id,
    ]);
    const responseId = sent.rows[0].sent.response_id;
    const at = async () => {
      await asMaintenance(db);
      return (await db.query<{ version: number }>(`select version from public.intake_responses where id = $1`, [responseId])).rows[0].version;
    };
    const draftVersion = await at();
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const answerId = (
      await db.query<{ id: string }>(`select public.save_intake_answer($1, $2, 'full_name', 'provided', $3::jsonb) as id`, [
        responseId,
        draftVersion,
        JSON.stringify({ text: "Synthetic Applicant" }),
      ])
    ).rows[0].id;
    const submitVersion = await at();
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await db.query(`select public.submit_intake_response($1, $2)`, [responseId, submitVersion]);
    await stale(ctx.manager, ctx.orgId);
    await db.query(`select public.review_intake_answer($1)`, [answerId]);

    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.record_representation_authority($1, $2, 'Synthetic representation scope', 'Synthetic signed form', $3::date, null)`, [
      ctx.matterId,
      ctx.personId,
      firmDay(),
    ]);
    await asMaintenance(db);
    await db.query(
      `do $$ begin
         insert into app.matter_stage_transition_nonce (matter_id, txid) values ('${ctx.matterId}', txid_current())
           on conflict (matter_id) do update set txid = excluded.txid;
         update public.matters set stage = 'ready_to_submit' where id = '${ctx.matterId}';
         delete from app.matter_stage_transition_nonce where matter_id = '${ctx.matterId}';
       end $$`,
    );
    const doc = await db.query<{ id: string }>(
      `insert into public.documents (organization_id, person_id, purpose, audience, created_by) values ($1, $2, 'Synthetic passport', 'matter', $3) returning id`,
      [ctx.orgId, ctx.personId, ctx.owner],
    );
    await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by) values ($1, $2, $3, $4)`, [ctx.orgId, doc.rows[0].id, ctx.matterId, ctx.owner]);
    await db.query(
      `insert into public.document_versions (organization_id, document_id, version_number, storage_key, original_filename, declared_media_type,
         declared_byte_size, checksum_sha256, upload_state, review_state, intent_expires_at, created_by)
       values ($1, $2, 1, $3, 'passport.pdf', 'application/pdf', 2048, $4, 'clean', 'accepted', now() + interval '15 minutes', $5)`,
      [ctx.orgId, doc.rows[0].id, `${ctx.orgId}/files/${randomUUID()}`, "b".repeat(64), ctx.owner],
    );
    await stale(ctx.manager, ctx.orgId);
    const handoffId = (await db.query<{ id: string }>(`select public.prepare_submission_handoff($1, 'Package v1', null, 'paper'::public.submission_channel) as id`, [ctx.matterId])).rows[0].id;
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.sign_off_submission_handoff($1, 1)`, [handoffId]);
    await asMaintenance(db);
    const facts = await db.query<{ answer_id: string; value_text: string; value_sha256: string }>(
      `select answer_id, value_text, value_sha256 from public.submission_manifest_facts where handoff_id = $1`,
      [handoffId],
    );
    expect(facts.rows).toHaveLength(1);
    expect(facts.rows[0].answer_id).toBe(answerId);
    expect(facts.rows[0].value_text).toBe("Synthetic Applicant");
    expect(facts.rows[0].value_sha256).toBe(createHash("sha256").update("Synthetic Applicant").digest("hex"));

    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const corrected = await db.query<{ result: { answer_id: string } }>(
      `select public.request_intake_correction($1, 'full_name', 'provided', $2::jsonb, 'Synthetic correction', null, null) as result`,
      [responseId, JSON.stringify({ text: "Synthetic Applicant Corrected" })],
    );
    await stale(ctx.manager, ctx.orgId);
    await db.query(`select public.review_intake_answer($1)`, [corrected.rows[0].result.answer_id]);
    const state = await db.query<{ c: { gates: { key: string; state: string; scope_changed?: number }[] } }>(`select public.submission_checklist($1) as c`, [ctx.matterId]);
    const packageGate = state.rows[0].c.gates.find((gate) => gate.key === "package");
    expect(packageGate).toMatchObject({ state: "blocked" });
    expect(packageGate?.scope_changed ?? 0).toBeGreaterThan(0);
  });
});

describe("PREP-03 bundle selection and channel rules", () => {
  it("saves an ordered selection of the matter’s files and keeps the product size default until the owner sets one", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const rule = await db.query<{ rule: { name_pattern: string; max_bytes: number; source: string } }>(
      `select public.channel_export_rule($1, 'paper'::public.submission_channel) as rule`,
      [ctx.orgId],
    );
    expect(rule.rows[0].rule).toEqual({ name_pattern: "{reference}-evidence-bundle.pdf", max_bytes: 26214400, source: "product_default" });

    await stale(ctx.assistant, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.set_channel_export_rule($1, 'paper'::public.submission_channel, '{reference}.pdf', 1048576)`, [ctx.orgId]),
      /denied|staff access|owner/,
    );
    await fresh(ctx.owner, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.set_channel_export_rule($1, 'paper'::public.submission_channel, '../x.pdf', 1048576)`, [ctx.orgId]),
      /file name/,
    );
    await db.query(`select public.set_channel_export_rule($1, 'paper'::public.submission_channel, '{reference}-bundle.pdf', 2097152)`, [ctx.orgId]);

    await asMaintenance(db);
    const doc = await db.query<{ id: string }>(
      `insert into public.documents (organization_id, person_id, purpose, audience, created_by) values ($1, $2, 'Synthetic passport', 'matter', $3) returning id`,
      [ctx.orgId, ctx.personId, ctx.owner],
    );
    await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by) values ($1, $2, $3, $4)`, [
      ctx.orgId,
      doc.rows[0].id,
      ctx.matterId,
      ctx.owner,
    ]);
    const version = await db.query<{ id: string }>(
      `insert into public.document_versions (organization_id, document_id, version_number, storage_key, original_filename, declared_media_type,
         declared_byte_size, checksum_sha256, upload_state, review_state, intent_expires_at, created_by)
       values ($1, $2, 1, $3, 'passport.pdf', 'application/pdf', 2048, $4, 'clean', 'accepted', now() + interval '15 minutes', $5) returning id`,
      [ctx.orgId, doc.rows[0].id, `${ctx.orgId}/files/${randomUUID()}`, "a".repeat(64), ctx.owner],
    );
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.save_bundle_selection($1, 'paper'::public.submission_channel, $2::jsonb)`, [ctx.matterId, JSON.stringify([{ document_version_id: randomUUID(), position: 1 }])]),
      /not a current document/,
    );
    await db.query(`select public.save_bundle_selection($1, 'paper'::public.submission_channel, $2::jsonb)`, [
      ctx.matterId,
      JSON.stringify([{ document_version_id: version.rows[0].id, position: 1 }]),
    ]);
    const index = await db.query<{ index: { channel: string; items: { file_name: string }[]; rule: { source: string; max_bytes: number } } }>(
      `select public.bundle_index($1) as index`,
      [ctx.matterId],
    );
    expect(index.rows[0].index.channel).toBe("paper");
    expect(index.rows[0].index.items.map((item) => item.file_name)).toEqual(["passport.pdf"]);
    expect(index.rows[0].index.rule).toMatchObject({ source: "firm", max_bytes: 2097152 });
    await asMaintenance(db);
    const audit = await db.query(`select 1 from public.audit_log where organization_id = $1 and action = 'prep.bundle_selection_saved'`, [ctx.orgId]);
    expect(audit.rows).toHaveLength(1);
  });
});
