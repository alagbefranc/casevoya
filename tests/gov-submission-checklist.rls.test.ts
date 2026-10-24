import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * GOV-01 (submission checklist, outside steps, official requirements under review) and GOV-03
 * (manifest pinned at release, receipt file and acknowledgement date) against the real
 * migrations. Synthetic records only: the "official" URLs here are test strings on an allowlisted
 * host, not IRCC content.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const PAGE = "https://www.canada.ca/en/synthetic-test-page.html#synthetic-section";
const HASH = "c".repeat(64);

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
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, null, null, null, $2, null, null) as result`, [
    "Synthetic Applicant",
    consultantMembership,
  ]);
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  const party = await db.query<{ person_id: string }>(`select person_id from public.matter_participants where matter_id = $1 and person_id is not null limit 1`, [matterId]);
  const personId = party.rows[0].person_id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role, created_by) values ($1, $2, $3, 'case_manager', $4)`, [
    orgId,
    matterId,
    managerMembership,
    owner,
  ]);
  // The assistant is assigned too, so consultant scope lets them read the matter.
  const assistantMembership = await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and role = 'assistant'`, [orgId]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role, created_by) values ($1, $2, $3, 'assistant', $4)`, [
    orgId,
    matterId,
    assistantMembership.rows[0].id,
    owner,
  ]);
  await db.query(`update public.persons set user_id = $1 where id = $2`, [client, personId]);
  await activeMembership(orgId, client, "client", owner);
  return { owner, consultant, manager, assistant, client, orgId, matterId, personId, consultantMembership, managerMembership };
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

async function handoff(ctx: Firm, channel = "online_portal") {
  await moveStage(ctx.matterId, "ready_to_submit");
  await stale(ctx.manager, ctx.orgId);
  const prepared = await db.query<{ id: string }>(`select public.prepare_submission_handoff($1, 'Package v3', null, $2::public.submission_channel) as id`, [
    ctx.matterId,
    channel,
  ]);
  return prepared.rows[0].id;
}

/** A stored, clean file on the matter. Returns the version id. */
async function storedFile(ctx: Firm, name: string, options: { review?: string; documentId?: string; versionNumber?: number } = {}) {
  await asMaintenance(db);
  let documentId = options.documentId;
  if (!documentId) {
    const doc = await db.query<{ id: string }>(
      `insert into public.documents (organization_id, person_id, purpose, audience, created_by) values ($1, $2, $3, 'matter', $4) returning id`,
      [ctx.orgId, ctx.personId, `Synthetic ${name}`, ctx.owner],
    );
    documentId = doc.rows[0].id;
    await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by) values ($1, $2, $3, $4)`, [
      ctx.orgId,
      documentId,
      ctx.matterId,
      ctx.owner,
    ]);
  }
  const checksum = createHash("sha256").update(`${name}-${randomUUID()}`).digest("hex");
  const version = await db.query<{ id: string }>(
    `insert into public.document_versions (organization_id, document_id, version_number, storage_key, original_filename, declared_media_type,
       declared_byte_size, checksum_sha256, upload_state, review_state, intent_expires_at, created_by)
     values ($1, $2, $3, $4, $5, 'application/pdf', 2048, $6, 'clean', $7::public.document_review_state, now() + interval '15 minutes', $8) returning id`,
    [ctx.orgId, documentId, options.versionNumber ?? 1, `${ctx.orgId}/files/${randomUUID()}`, name, checksum, options.review ?? "accepted", ctx.owner],
  );
  return { versionId: version.rows[0].id, documentId, checksum };
}

async function versionOf(id: string) {
  await asMaintenance(db);
  const row = await db.query<{ version: number }>(`select version from public.submission_handoffs where id = $1`, [id]);
  return row.rows[0].version;
}

type Gate = { key: string; state: string; [extra: string]: unknown };
async function checklist(ctx: Firm, as = ctx.manager) {
  await stale(as, ctx.orgId);
  const row = await db.query<{ c: { handoff_id: string | null; gates: Gate[]; blocked: string[] } }>(`select public.submission_checklist($1) as c`, [ctx.matterId]);
  return row.rows[0].c;
}
const gateOf = (state: { gates: Gate[] }, key: string) => state.gates.find((gate) => gate.key === key) as Gate;

async function release(ctx: Firm, id: string) {
  const version = await versionOf(id);
  await fresh(ctx.consultant, ctx.orgId);
  await db.query(`select public.sign_off_submission_handoff($1, $2)`, [id, version]);
}

async function signedServiceAgreement(ctx: Firm) {
  await asMaintenance(db);
  await db.query(`insert into public.agreements (organization_id, matter_id, kind, title, status, created_by) values ($1, $2, 'service', 'Synthetic service agreement', 'completed', $3)`, [
    ctx.orgId,
    ctx.matterId,
    ctx.owner,
  ]);
}

describe("GOV-01 submission checklist gates and GOV-03 manifest pinned at release", () => {
  it("shows each gate live; the package gate opens only on release, which pins every stored file with its hash", async () => {
    const ctx = await firm();
    // Before any handoff: every gate is visible; representation and package are blocked.
    let state = await checklist(ctx);
    expect(state.handoff_id).toBeNull();
    expect(state.gates.map((gate) => gate.key)).toEqual(["representation", "package", "deadlines", "signatures", "fees", "outside_steps"]);
    expect(gateOf(state, "representation").state).toBe("blocked");
    expect(gateOf(state, "package").state).toBe("blocked");
    expect(gateOf(state, "deadlines").state).toBe("ok");
    expect(gateOf(state, "outside_steps").state).toBe("none");

    const id = await handoff(ctx);
    await representation(ctx);
    state = await checklist(ctx);
    expect(gateOf(state, "representation").state).toBe("ok");
    expect(gateOf(state, "package")).toMatchObject({ state: "blocked", released: false, candidates: 0 });

    // A release needs stored files on the matter.
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.sign_off_submission_handoff($1, $2)`, [id, 1]), /no stored files/);

    const first = await storedFile(ctx, "imm-form.pdf");
    const second = await storedFile(ctx, "passport.pdf", { review: "pending" });
    await storedFile(ctx, "rejected.pdf", { review: "rejected" });
    state = await checklist(ctx);
    expect(gateOf(state, "package").candidates).toBe(2);

    await release(ctx, id);
    state = await checklist(ctx);
    expect(gateOf(state, "package")).toMatchObject({ state: "ok", released: true, pinned: true, files: 2, changed: 0 });

    await asMaintenance(db);
    const pinned = await db.query<{ file_name: string; file_sha256: string; document_version_id: string; position: number }>(
      `select file_name, file_sha256, document_version_id, position from public.submission_manifest_files where handoff_id = $1 order by position`,
      [id],
    );
    expect(pinned.rows.map((row) => row.file_name)).toEqual(["imm-form.pdf", "passport.pdf"]);
    expect(pinned.rows.map((row) => row.file_sha256)).toEqual([first.checksum, second.checksum]);
    const expected = createHash("sha256")
      .update(pinned.rows.map((row) => `${row.document_version_id} ${row.file_sha256} ${row.file_name}`).join("\n"))
      .digest("hex");
    const row = await db.query<{ manifest_sha256: string; manifest_file_count: number }>(`select manifest_sha256, manifest_file_count from public.submission_handoffs where id = $1`, [id]);
    expect(row.rows[0]).toEqual({ manifest_sha256: expected, manifest_file_count: 2 });
    const audit = await db.query<{ details: { manifest_sha256: string; manifest_files: number } }>(
      `select context as details from public.audit_log where object_id = $1 and action = 'submission.signed_off'`,
      [id],
    );
    expect(audit.rows[0].details).toMatchObject({ manifest_sha256: expected, manifest_files: 2 });
    // Pinned rows are append-only.
    await expectDbError(() => db.query(`update public.submission_manifest_files set file_name = 'x.pdf' where handoff_id = $1`, [id]), /append-only/);

    // Replacing a pinned file after release turns the package gate red again.
    await asMaintenance(db);
    await db.exec(`do $$ begin
      perform app.open_document_write('${first.versionId}'::uuid);
      update public.document_versions set superseded_at = now() where id = '${first.versionId}';
      perform app.close_document_write('${first.versionId}'::uuid);
    end $$`);
    await storedFile(ctx, "imm-form-v2.pdf", { documentId: first.documentId, versionNumber: 2 });
    state = await checklist(ctx);
    expect(gateOf(state, "package")).toMatchObject({ state: "blocked", changed: 1 });
    expect(state.blocked).toContain("package");
  });

  it("refuses to record while a gate blocks; the firm owner overrides with a reason after step-up; the manifest goes into the audit", async () => {
    const ctx = await firm();
    const id = await handoff(ctx);
    await representation(ctx);
    await storedFile(ctx, "imm-form.pdf");
    await release(ctx, id);

    // A tentative legal deadline blocks until a person confirms it.
    await asMaintenance(db);
    const deadline = await db.query<{ id: string }>(
      `insert into public.deadlines (organization_id, matter_id, kind, label, due_on, timezone, created_by)
       values ($1, $2, 'legal', 'Synthetic deadline', $3::date, 'America/Toronto', $4) returning id`,
      [ctx.orgId, ctx.matterId, firmDay(20), ctx.owner],
    );
    let state = await checklist(ctx);
    expect(state.blocked).toEqual(["deadlines", "signatures", "fees"]);

    let version = await versionOf(id);
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.record_submission($1, $2, 'SYN-REF-1', statement_timestamp(), $3, null, null, null)`, [id, version, ctx.consultantMembership]),
      /checklist is not complete: deadlines, signatures, fees/,
    );

    await asMaintenance(db);
    await db.query(`update public.deadlines set verification = 'confirmed', verifying_membership_id = $2 where id = $1`, [deadline.rows[0].id, ctx.consultantMembership]);
    await signedServiceAgreement(ctx);
    await asMaintenance(db);
    await db.query(`insert into public.agreements (organization_id, matter_id, kind, title, status, created_by) values ($1, $2, 'consent', 'Synthetic consent', 'sent', $3)`, [
      ctx.orgId,
      ctx.matterId,
      ctx.owner,
    ]);
    state = await checklist(ctx);
    expect(gateOf(state, "deadlines").state).toBe("ok");
    expect(gateOf(state, "signatures")).toMatchObject({ state: "blocked", waiting: 1, signed: true });

    // Fee handling: confirmed by an owner, consultant or case manager with a note; not an assistant.
    await stale(ctx.assistant, ctx.orgId);
    await expectDbError(() => db.query(`select public.confirm_submission_fees($1, true, 'Paid in the portal')`, [id]), /denied|staff access/);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.confirm_submission_fees($1, true, null)`, [id]), /how the government fee was handled/);
    await db.query(`select public.confirm_submission_fees($1, true, 'Client paid the fee in the portal; receipt saved')`, [id]);
    state = await checklist(ctx);
    expect(gateOf(state, "fees").state).toBe("ok");

    // Override: firm owner only, fresh step-up, a real reason, never the package gate.
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.override_submission_gate($1, 'signatures', 'Client signs on paper at the office')`, [id]), /denied|staff access|step-up/);
    await stale(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.override_submission_gate($1, 'signatures', 'Client signs on paper at the office')`, [id]), /step-up/);
    await fresh(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.override_submission_gate($1, 'signatures', 'short')`, [id]), /reason/);
    await expectDbError(() => db.query(`select public.override_submission_gate($1, 'package', 'The package is fine, trust me')`, [id]), /cannot be overridden/);
    await expectDbError(() => db.query(`select public.override_submission_gate($1, 'fees', 'Already confirmed by the manager')`, [id]), /not blocking/);
    await db.query(`select public.override_submission_gate($1, 'signatures', 'Consent form signed on paper; scan on file')`, [id]);
    state = await checklist(ctx);
    expect(gateOf(state, "signatures")).toMatchObject({ state: "overridden", override_reason: "Consent form signed on paper; scan on file" });
    expect(state.blocked).toEqual([]);
    await asMaintenance(db);
    const overrideAudit = await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'submission.gate_overridden'`, [id]);
    expect(overrideAudit.rows).toHaveLength(1);

    version = await versionOf(id);
    await fresh(ctx.manager, ctx.orgId);
    await db.query(`select public.record_submission($1, $2, 'SYN-REF-1', statement_timestamp(), $3, null, null, null)`, [id, version, ctx.consultantMembership]);
    await asMaintenance(db);
    const recorded = await db.query<{ details: { manifest: { file: string; sha256: string }[]; manifest_sha256: string; overridden: string[] } }>(
      `select context as details from public.audit_log where object_id = $1 and action = 'submission.recorded'`,
      [id],
    );
    expect(recorded.rows[0].details.manifest.map((file) => file.file)).toEqual(["imm-form.pdf"]);
    expect(recorded.rows[0].details.manifest[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(recorded.rows[0].details.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(recorded.rows[0].details.overridden).toEqual(["signatures"]);
    const status = await db.query<{ status: string }>(`select status::text as status from public.submission_handoffs where id = $1`, [id]);
    expect(status.rows[0].status).toBe("submission_unverified");

    // GOV-03: only the government confirmation as a file plus the acknowledgement date verify it.
    version = await versionOf(id);
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.verify_submission_receipt($1, $2, null, 'Synthetic confirmation page', $3::date)`, [id, version, firmDay()]),
      /upload the government confirmation/,
    );
    const receipt = await storedFile(ctx, "confirmation.pdf");
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.verify_submission_receipt($1, $2, $3, null, null)`, [id, version, receipt.versionId]), /acknowledgement date is required/);
    await expectDbError(
      () => db.query(`select public.verify_submission_receipt($1, $2, $3, null, $4::date)`, [id, version, receipt.versionId, firmDay(1)]),
      /future/,
    );
    await db.query(`select public.verify_submission_receipt($1, $2, $3, null, $4::date)`, [id, version, receipt.versionId, firmDay()]);
    await asMaintenance(db);
    const verified = await db.query<{ status: string; acknowledged_on: string }>(
      `select status::text as status, acknowledged_on::text from public.submission_handoffs where id = $1`,
      [id],
    );
    expect(verified.rows[0]).toEqual({ status: "submission_verified", acknowledged_on: firmDay() });
    // The checklist belongs to the open handoff; once recorded it no longer takes ticks.
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.confirm_submission_fees($1, false, null)`, [id]), /not submitted yet/);
  });

  it("keeps the checklist, manifest and events to the firm's staff on the matter", async () => {
    const ctx = await firm();
    const id = await handoff(ctx);
    await stale(ctx.manager, ctx.orgId);
    await db.query(`select public.confirm_submission_fees($1, true, 'Firm pays from client funds')`, [id]);
    await fresh(ctx.client, ctx.orgId);
    await expectDbError(() => db.query(`select public.submission_checklist($1)`, [ctx.matterId]), /denied/);
    const events = await db.query(`select id from public.submission_checklist_events where handoff_id = $1`, [id]);
    expect(events.rows).toHaveLength(0);
    const other = await firm();
    await fresh(other.owner, other.orgId);
    await expectDbError(() => db.query(`select public.submission_checklist($1)`, [ctx.matterId]), /denied/);
    await expectDbError(() => db.query(`select public.confirm_submission_fees($1, true, 'Forged from another firm')`, [id]), /denied/);
    expect((await db.query(`select id from public.submission_checklist_events where handoff_id = $1`, [id])).rows).toHaveLength(0);
    // No direct writes.
    await fresh(ctx.owner, ctx.orgId);
    await expectDbError(
      () =>
        db.query(
          `insert into public.submission_checklist_events (organization_id, handoff_id, matter_id, kind, item_key, ticked, note, membership_id)
           select organization_id, id, matter_id, 'fee_confirmation', 'fees', true, 'Forged', signoff_membership_id from public.submission_handoffs where id = $1`,
          [id],
        ),
      /permission denied/,
    );
  });
});

describe("GOV-01 official outside steps and GOV-03 channel names: entered from an official page, live only after licensed review", () => {
  async function propose(ctx: Firm, overrides: Partial<{ kind: string; label: string; url: string; section: string | null; checked: string; snapshot: object | null; channel: string; form: string | null; formDate: string | null }> = {}) {
    const input = {
      kind: "outside_step",
      label: "Synthetic step as worded on the page",
      url: PAGE,
      section: null,
      checked: firmDay(),
      snapshot: { sha256: HASH, retrieved_at: new Date().toISOString(), final_url: PAGE.split("#")[0], http_status: 200 },
      channel: "online_portal",
      form: null,
      formDate: null,
      ...overrides,
    };
    const row = await db.query<{ id: string }>(
      `select public.propose_submission_requirement($1, null, $2::public.submission_channel, $3, $4, $5, $6, $7, $8::date, $9::date, null, $10::jsonb) as id`,
      [ctx.orgId, input.channel, input.kind, input.label, input.url, input.section, input.form, input.formDate, input.checked, input.snapshot ? JSON.stringify(input.snapshot) : null],
    );
    return row.rows[0].id;
  }

  async function requirementVersion(id: string) {
    await asMaintenance(db);
    return (await db.query<{ version: number }>(`select version from public.submission_requirements where id = $1`, [id])).rows[0].version;
  }

  it("needs an official federal URL with its section and a date checked; records the source and snapshot; holds it for review", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => propose(ctx, { url: "https://example.com/steps#a" }), /official Government of Canada page/);
    await expectDbError(() => propose(ctx, { url: "https://www.ontario.ca/page/synthetic#a" }), /official Government of Canada page/);
    await expectDbError(() => propose(ctx, { url: "https://www.canada.ca/en/synthetic-test-page.html" }), /section/);
    await expectDbError(() => propose(ctx, { checked: firmDay(1) }), /date checked/);
    await expectDbError(() => propose(ctx, { formDate: firmDay(-3) }), /form number/);
    await stale(ctx.assistant, ctx.orgId);
    await expectDbError(() => propose(ctx), /denied|staff access/);

    await stale(ctx.manager, ctx.orgId);
    const id = await propose(ctx, { form: "imm 5476", formDate: firmDay(-30), section: "Synthetic section" });
    await asMaintenance(db);
    const row = await db.query<{ status: string; form_number: string; snapshot_sha256: string; source_url: string; canonical_url: string; content_hash: string; current_to: string | null }>(
      `select r.status, r.form_number, r.snapshot_sha256, r.source_url, s.canonical_url, snap.content_hash, r.current_to
       from public.submission_requirements r
       join public.official_sources s on s.id = r.source_id
       join public.source_snapshots snap on snap.id = r.snapshot_id
       where r.id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({
      status: "pending_review",
      form_number: "IMM 5476",
      snapshot_sha256: HASH,
      source_url: PAGE,
      canonical_url: PAGE.split("#")[0],
      content_hash: HASH,
      current_to: null,
    });
    // Entered without a fetched page: kept, but it can't go live.
    await stale(ctx.manager, ctx.orgId);
    const unfetched = await propose(ctx, { snapshot: null, label: "Synthetic step without a snapshot" });
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_submission_requirement($1, 1, 'approved', null)`, [unfetched]), /snapshot/);

    // Review: licensed member, fresh step-up; a case manager cannot approve.
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_submission_requirement($1, 1, 'approved', null)`, [id]), /denied|licen|staff access/);
    await stale(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_submission_requirement($1, 1, 'approved', null)`, [id]), /step-up/);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_submission_requirement($1, 1, 'rejected', null)`, [unfetched]), /why/);
    await db.query(`select public.review_submission_requirement($1, 1, 'approved', null)`, [id]);
    // Entered values never change; direct writes are refused.
    await expectDbError(() => db.query(`update public.submission_requirements set label = 'Edited' where id = $1`, [id]), /permission denied/);

    // Other firms and clients can't read the firm's requirements.
    const other = await firm();
    await fresh(other.owner, other.orgId);
    expect((await db.query(`select id from public.submission_requirements where id = $1`, [id])).rows).toHaveLength(0);
    await fresh(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.submission_requirements where id = $1`, [id])).rows).toHaveLength(0);
  });

  it("blocks recording until each approved outside step for the channel is ticked; a newer channel name retires the older one", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const step = await propose(ctx);
    const paperStep = await propose(ctx, { channel: "paper", label: "Synthetic paper-only step" });
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.review_submission_requirement($1, 1, 'approved', null)`, [step]);
    await db.query(`select public.review_submission_requirement($1, 1, 'approved', null)`, [paperStep]);

    const id = await handoff(ctx, "online_portal");
    let state = await checklist(ctx);
    expect(gateOf(state, "outside_steps")).toMatchObject({ state: "blocked", total: 1, done: 0 });

    // Anyone on the matter's staff ticks it (state stored); a step for another channel is refused.
    await stale(ctx.assistant, ctx.orgId);
    await expectDbError(() => db.query(`select public.tick_submission_step($1, $2, true)`, [id, paperStep]), /does not apply/);
    await db.query(`select public.tick_submission_step($1, $2, true)`, [id, step]);
    await expectDbError(() => db.query(`select public.tick_submission_step($1, $2, true)`, [id, step]), /already/);
    state = await checklist(ctx);
    expect(gateOf(state, "outside_steps")).toMatchObject({ state: "ok", total: 1, done: 1 });
    await db.query(`select public.tick_submission_step($1, $2, false)`, [id, step]);
    state = await checklist(ctx);
    expect(gateOf(state, "outside_steps").state).toBe("blocked");

    // Retiring the step takes it off the checklist.
    const stepVersion = await requirementVersion(step);
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.retire_submission_requirement($1, $2, 'The page no longer lists this step')`, [step, stepVersion]);
    state = await checklist(ctx);
    expect(gateOf(state, "outside_steps")).toMatchObject({ state: "none", total: 0 });

    // Channel names: one approved per program and channel.
    await stale(ctx.manager, ctx.orgId);
    const firstName = await propose(ctx, { kind: "channel_name", label: "Synthetic portal name" });
    const secondName = await propose(ctx, { kind: "channel_name", label: "Synthetic portal name, renamed" });
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.review_submission_requirement($1, 1, 'approved', null)`, [firstName]);
    await db.query(`select public.review_submission_requirement($1, 1, 'approved', null)`, [secondName]);
    await asMaintenance(db);
    const names = await db.query<{ id: string; status: string }>(`select id, status from public.submission_requirements where id = any($1::uuid[]) order by created_at`, [[firstName, secondName]]);
    expect(names.rows.map((row) => row.status)).toEqual(["retired", "approved"]);
  });
});
