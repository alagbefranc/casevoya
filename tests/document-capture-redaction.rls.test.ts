import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const PDF = "application/pdf";
const SHA = "c".repeat(64);

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
  await db.query(
    `update public.product_settings set value = jsonb_build_object('enabled', true) where key = 'documents.accept_structural_inspection'`,
  );
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

async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const assistant = await createUser(email("assistant"));
  const client = await createUser(email("client"));
  const sponsor = await createUser(email("sponsor"));
  const finance = await createUser(email("finance"));
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", `f${randomUUID().replaceAll("-", "").slice(0, 12)}`])).rows[0].id;
  await asMaintenance(db);
  const consultantMembership = (await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
    [orgId, consultant, owner],
  )).rows[0].id;
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values
     ($1, $2, 'assistant', 'active', now(), $5),
     ($1, $3, 'client', 'active', now(), $5),
     ($1, $4, 'sponsor', 'active', now(), $5),
     ($1, $6, 'finance_user', 'active', now(), $5)`,
    [orgId, assistant, client, sponsor, owner, finance],
  );
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matterId = (await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership])).rows[0].result.id;
  await db.query(
    `insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2), ($1, 'Synthetic sponsor', true, $3)`,
    [orgId, client, sponsor],
  );
  const people = await db.query<{ id: string; display_name: string }>(`select id, display_name from public.persons where organization_id = $1`, [orgId]);
  const applicant = people.rows.find((row) => row.display_name === "Synthetic applicant")?.id;
  const sponsorPerson = people.rows.find((row) => row.display_name === "Synthetic sponsor")?.id;
  if (!applicant || !sponsorPerson) throw new Error("people were not created");
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`,
    [orgId, matterId, applicant, sponsorPerson],
  );
  return { owner, consultant, assistant, client, sponsor, finance, orgId, matterId, applicant, sponsorPerson };
}

async function store(key: string, size: number) {
  await asMaintenance(db);
  await db.query(`insert into storage.objects (id, bucket_id, name, metadata) values ($1, 'documents', $2, jsonb_build_object('size', $3::int))`, [randomUUID(), key, size]);
}

async function cleanUpload(userId: string, orgId: string, matterId: string, personId: string) {
  await asUser(db, { userId, aal: userId ? "aal1" : "aal1", orgId });
  const intent = (await db.query<{ result: { version_id: string; storage_key: string; document_id: string } }>(
    `select public.create_upload_intent($1, $2, 'passport.pdf', 40, 'Passport bio page', 'ordinary', 'subject', null, null, null) as result`,
    [matterId, personId],
  )).rows[0].result;
  await store(intent.storage_key, 40);
  await asServiceRole(db);
  await db.query(`select public.finish_verified_document_upload($1, $2, $3, 40, $4)`, [intent.version_id, userId, SHA, PDF]);
  return intent;
}

const regions = JSON.stringify([
  { page_index: 0, x: 0.1, y: 0.2, width: 0.3, height: 0.15 },
  { page_index: 1, x: 0, y: 0, width: 0.5, height: 0.25 },
]);

type Copy = { document_id: string; version_id: string; storage_key: string; source_version_id: string };

async function beginTicket(userId: string, orgId: string, sourceVersionId: string, matterId: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  return (await db.query<{ result: { ticket_id: string; storage_key: string; media_type: string } }>(
    `select public.begin_redacted_copy($1, $2) as result`,
    [sourceVersionId, matterId],
  )).rows[0].result;
}

/** The app's path: the consultant's session checks, then the server opens the copy for them. */
async function openRedactedCopy(ctx: { consultant: string; orgId: string; matterId: string }, sourceVersionId: string): Promise<Copy> {
  const ticket = await beginTicket(ctx.consultant, ctx.orgId, sourceVersionId, ctx.matterId);
  await asServiceRole(db);
  return (await db.query<{ result: Copy }>(
    `select public.service_create_redacted_copy_intent($1, $2, 'redacted.pdf', 50, $3::jsonb) as result`,
    [ticket.ticket_id, ctx.consultant, regions],
  )).rows[0].result;
}

describe("camera assembly and redacted copies", () => {
  it("records page turns for the uploader and refuses everyone else", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const intent = (await db.query<{ result: { version_id: string } }>(
      `select public.create_upload_intent($1, $2, 'pages.pdf', 80, 'Passport bio page', 'ordinary', 'subject', null, null, null) as result`,
      [ctx.matterId, ctx.applicant],
    )).rows[0].result;
    const pages = JSON.stringify([
      { rotation_degrees: 90, source: "camera" },
      { rotation_degrees: 0, source: "library" },
    ]);
    await expectDbError(
      () => db.query(`select public.record_camera_assembly($1, $2::jsonb)`, [intent.version_id, JSON.stringify([{ rotation_degrees: 45, source: "camera" }])]),
      /turned/,
    );
    await db.query(`select public.record_camera_assembly($1, $2::jsonb)`, [intent.version_id, pages]);
    const stored = await db.query<{ transformation: { kind: string; page_count: number } }>(
      `select transformation from public.document_versions where id = $1`,
      [intent.version_id],
    );
    expect(stored.rows[0].transformation).toMatchObject({ kind: "camera_assembly", page_count: 2 });

    await asUser(db, { userId: ctx.sponsor, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.record_camera_assembly($1, $2::jsonb)`, [intent.version_id, pages]), /assembly denied/);
  });

  it("keeps the original, links a staff-only copy, audits every area, and holds it for the virus scan", async () => {
    const ctx = await firm();
    const source = await cleanUpload(ctx.client, ctx.orgId, ctx.matterId, ctx.applicant);
    await asMaintenance(db);
    const before = (await db.query<{ storage_key: string; checksum_sha256: string; upload_state: string }>(
      `select storage_key, checksum_sha256, upload_state from public.document_versions where id = $1`,
      [source.version_id],
    )).rows[0];

    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.begin_redacted_copy($1, $2)`, [source.version_id, ctx.matterId]), /redaction denied|aal2/);
    await asUser(db, { userId: ctx.sponsor, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.begin_redacted_copy($1, $2)`, [source.version_id, ctx.matterId]), /redaction denied|aal2/);
    await asUser(db, { userId: ctx.finance, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.begin_redacted_copy($1, $2)`, [source.version_id, ctx.matterId]), /redaction denied/);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.begin_redacted_copy($1, $2)`, [source.version_id, ctx.matterId]), /step-up/);

    const copy = await openRedactedCopy(ctx, source.version_id);
    expect(copy.source_version_id).toBe(source.version_id);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });

    const version = (await db.query<{ parent_version_id: string; transformation: { kind: string; engine: string }; upload_state: string }>(
      `select parent_version_id, transformation, upload_state from public.document_versions where id = $1`,
      [copy.version_id],
    )).rows[0];
    expect(version.parent_version_id).toBe(source.version_id);
    expect(version.transformation).toMatchObject({ kind: "redaction", engine: "content-stream" });
    expect(version.upload_state).toBe("uploading");
    const audience = (await db.query<{ audience: string }>(`select audience::text as audience from public.documents where id = $1`, [copy.document_id])).rows[0].audience;
    expect(audience).toBe("staff");

    const marks = await db.query(`select page_index from public.document_redactions where copy_version_id = $1 order by page_index`, [copy.version_id]);
    expect(marks.rows).toEqual([{ page_index: 0 }, { page_index: 1 }]);
    await expectDbError(() => db.query(`delete from public.document_redactions where copy_version_id = $1`, [copy.version_id]), /permission denied/);
    await asMaintenance(db);
    await expectDbError(() => db.query(`delete from public.document_redactions where copy_version_id = $1`, [copy.version_id]), /kept/);

    const linked = await db.query<{ document_id: string }>(
      `select document_id from public.document_matter_refs where matter_id = $1 and removed_at is null`,
      [ctx.matterId],
    );
    expect(linked.rows.map((row) => row.document_id).sort()).toEqual([source.document_id, copy.document_id].sort());

    const original = (await db.query<{ storage_key: string; checksum_sha256: string; upload_state: string }>(
      `select storage_key, checksum_sha256, upload_state from public.document_versions where id = $1`,
      [source.version_id],
    )).rows[0];
    expect(original).toEqual(before);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const allowed = await db.query<{ ok: boolean }>(`select app.can_upload_storage_object($1) as ok`, [copy.storage_key]);
    expect(allowed.rows[0].ok).toBe(false);
    await asMaintenance(db);
    await db.exec(`alter table storage.objects enable row level security`);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`insert into storage.objects (id, bucket_id, name, metadata) values ($1, 'documents', $2, jsonb_build_object('size', 50))`, [randomUUID(), copy.storage_key]),
      /row-level security|permission denied|policy/i,
    );

    await asMaintenance(db);
    await db.query(
      `update public.product_settings set value = jsonb_build_object('enabled', false) where key = 'documents.accept_structural_inspection'`,
    );
    await store(copy.storage_key, 50);
    await asServiceRole(db);
    const finished = (await db.query<{ result: { upload_state: string; scan_result: string } }>(
      `select public.service_finish_redacted_copy($1, $2, $3, 50, $4) as result`,
      [copy.version_id, ctx.consultant, SHA, PDF],
    )).rows[0].result;
    expect(finished).toMatchObject({ upload_state: "scanning", scan_result: "awaiting_scanner" });

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.authorize_document_download($1)`, [copy.version_id]), /download denied/);
    const sourceDownload = await db.query(`select public.authorize_document_download($1)`, [source.version_id]);
    expect(sourceDownload.rows).toHaveLength(1);

    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const hidden = await db.query(`select id from public.documents where id = $1`, [copy.document_id]);
    expect(hidden.rows).toHaveLength(0);
    const hiddenMarks = await db.query(`select id from public.document_redactions where copy_version_id = $1`, [copy.version_id]);
    expect(hiddenMarks.rows).toHaveLength(0);
    const own = await db.query(`select id from public.documents where id = $1`, [source.document_id]);
    expect(own.rows).toHaveLength(1);

    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log where organization_id = $1 and action in ('document.redacted', 'document.redaction_started', 'document.camera_assembled')`,
      [ctx.orgId],
    );
    expect(audit.rows.filter((row) => row.action === "document.redacted")).toHaveLength(2);
    expect(audit.rows.some((row) => row.action === "document.redaction_started")).toBe(true);
  });

  it("opens a redacted copy only through the server path, with a single-use ticket bound to the staff member (#300, #301)", async () => {
    const ctx = await firm();
    const source = await cleanUpload(ctx.client, ctx.orgId, ctx.matterId, ctx.applicant);

    await asMaintenance(db);
    const grants = (await db.query<{ old_auth: boolean; svc_auth: boolean; svc_service: boolean; fin_auth: boolean; fin_service: boolean; begin_auth: boolean; begin_anon: boolean }>(
      `select has_function_privilege('authenticated', 'public.create_redacted_copy_intent(uuid,uuid,text,bigint,jsonb)', 'execute') as old_auth,
              has_function_privilege('authenticated', 'public.service_create_redacted_copy_intent(uuid,uuid,text,bigint,jsonb)', 'execute') as svc_auth,
              has_function_privilege('service_role', 'public.service_create_redacted_copy_intent(uuid,uuid,text,bigint,jsonb)', 'execute') as svc_service,
              has_function_privilege('authenticated', 'public.service_finish_redacted_copy(uuid,uuid,text,bigint,text)', 'execute') as fin_auth,
              has_function_privilege('service_role', 'public.service_finish_redacted_copy(uuid,uuid,text,bigint,text)', 'execute') as fin_service,
              has_function_privilege('authenticated', 'public.begin_redacted_copy(uuid,uuid)', 'execute') as begin_auth,
              has_function_privilege('anon', 'public.begin_redacted_copy(uuid,uuid)', 'execute') as begin_anon`,
    )).rows[0];
    expect(grants).toEqual({ old_auth: false, svc_auth: false, svc_service: true, fin_auth: false, fin_service: true, begin_auth: true, begin_anon: false });

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.create_redacted_copy_intent($1, $2, 'redacted.pdf', 50, $3::jsonb)`, [source.version_id, ctx.matterId, regions]),
      /permission denied/,
    );

    // The ticket is for the member who passed the checks, and is used once.
    const ticket = await beginTicket(ctx.consultant, ctx.orgId, source.version_id, ctx.matterId);
    expect(ticket.media_type).toBe(PDF);
    await expectDbError(
      () => db.query(`select public.service_create_redacted_copy_intent($1, $2, 'redacted.pdf', 50, $3::jsonb)`, [ticket.ticket_id, ctx.consultant, regions]),
      /permission denied/,
    );
    await asServiceRole(db);
    await expectDbError(
      () => db.query(`select public.service_create_redacted_copy_intent($1, $2, 'redacted.pdf', 50, $3::jsonb)`, [ticket.ticket_id, ctx.assistant, regions]),
      /redaction denied/,
    );
    const copy = (await db.query<{ result: Copy }>(
      `select public.service_create_redacted_copy_intent($1, $2, 'redacted.pdf', 50, $3::jsonb) as result`,
      [ticket.ticket_id, ctx.consultant, regions],
    )).rows[0].result;
    await expectDbError(
      () => db.query(`select public.service_create_redacted_copy_intent($1, $2, 'redacted.pdf', 50, $3::jsonb)`, [ticket.ticket_id, ctx.consultant, regions]),
      /redaction denied/,
    );
    await asMaintenance(db);
    const created = (await db.query<{ created_by: string; kind: string }>(
      `select created_by, transformation ->> 'kind' as kind from public.document_versions where id = $1`,
      [copy.version_id],
    )).rows[0];
    expect(created).toEqual({ created_by: ctx.consultant, kind: "redaction" });

    // An expired ticket is refused.
    const stale = await beginTicket(ctx.consultant, ctx.orgId, source.version_id, ctx.matterId);
    await asMaintenance(db);
    await db.query(`update app.document_redaction_tickets set expires_at = now() - interval '1 second' where id = $1`, [stale.ticket_id]);
    await asServiceRole(db);
    await expectDbError(
      () => db.query(`select public.service_create_redacted_copy_intent($1, $2, 'redacted.pdf', 50, $3::jsonb)`, [stale.ticket_id, ctx.consultant, regions]),
      /redaction denied/,
    );

    // The uploader can't replace the redaction record with a page order.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.record_camera_assembly($1, $2::jsonb)`, [copy.version_id, JSON.stringify([{ rotation_degrees: 0, source: "camera" }])]),
      /assembly denied/,
    );
    const allowed = await db.query<{ ok: boolean }>(`select app.can_upload_storage_object($1) as ok`, [copy.storage_key]);
    expect(allowed.rows[0].ok).toBe(false);

    // Even a definer write can't change or clear a redaction record, or make one.
    await asMaintenance(db);
    await expectDbError(
      () => db.exec(`
        begin;
        select app.open_document_write('${copy.version_id}');
        update public.document_versions set transformation = null where id = '${copy.version_id}';
        commit;
      `),
      /keeps its redaction record/,
    );
    await db.exec(`rollback`);
    await expectDbError(
      () => db.exec(`
        begin;
        select app.open_document_write('${source.version_id}');
        update public.document_versions set transformation = '{"kind":"redaction"}'::jsonb where id = '${source.version_id}';
        commit;
      `),
      /keeps its redaction record/,
    );
    await db.exec(`rollback`);

    // The ordinary completion refuses a redaction version; the redaction completion refuses anything else.
    await store(copy.storage_key, 50);
    await asServiceRole(db);
    await expectDbError(
      () => db.query(`select public.finish_verified_document_upload($1, $2, $3, 50, $4)`, [copy.version_id, ctx.consultant, SHA, PDF]),
      /upload denied/,
    );
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const ordinary = (await db.query<{ result: { version_id: string; storage_key: string } }>(
      `select public.create_upload_intent($1, $2, 'letter.pdf', 40, 'Letter', 'ordinary', 'subject', null, null, null) as result`,
      [ctx.matterId, ctx.applicant],
    )).rows[0].result;
    await store(ordinary.storage_key, 40);
    await asServiceRole(db);
    await expectDbError(
      () => db.query(`select public.service_finish_redacted_copy($1, $2, $3, 40, $4)`, [ordinary.version_id, ctx.client, SHA, PDF]),
      /upload denied/,
    );
    const done = (await db.query<{ result: { upload_state: string } }>(
      `select public.service_finish_redacted_copy($1, $2, $3, 50, $4) as result`,
      [copy.version_id, ctx.consultant, SHA, PDF],
    )).rows[0].result;
    expect(done.upload_state).toBe("clean");
    const plain = (await db.query<{ result: { upload_state: string } }>(
      `select public.finish_verified_document_upload($1, $2, $3, 40, $4) as result`,
      [ordinary.version_id, ctx.client, SHA, PDF],
    )).rows[0].result;
    expect(plain.upload_state).toBe("clean");
  });

  it("a redacted copy's document takes no ordinary new version; other documents still do (#300)", async () => {
    const ctx = await firm();
    const source = await cleanUpload(ctx.client, ctx.orgId, ctx.matterId, ctx.applicant);
    const copy = await openRedactedCopy(ctx, source.version_id);

    const newVersion = (documentId: string) =>
      db.query<{ result: { version_id: string; document_id: string } }>(
        `select public.create_upload_intent($1, $2, 'replacement.pdf', 40, 'Replacement', 'ordinary', 'staff', $3, null, null) as result`,
        [ctx.matterId, ctx.applicant, documentId],
      );
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => newVersion(copy.document_id), /takes no new version/);
    await asMaintenance(db);
    const copyVersions = await db.query(`select id from public.document_versions where document_id = $1`, [copy.document_id]);
    expect(copyVersions.rows).toHaveLength(1);
    const current = (await db.query<{ current_version_id: string }>(`select current_version_id from public.documents where id = $1`, [copy.document_id])).rows[0];
    expect(current.current_version_id).toBe(copy.version_id);

    // An ordinary document still takes a new version.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const next = (await newVersion(source.document_id)).rows[0].result;
    expect(next.document_id).toBe(source.document_id);
    await asMaintenance(db);
    const numbers = await db.query<{ version_number: number }>(
      `select version_number from public.document_versions where document_id = $1 order by version_number`,
      [source.document_id],
    );
    expect(numbers.rows.map((row) => row.version_number)).toEqual([1, 2]);
  });

  it("takes one page order per upload", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const intent = (await db.query<{ result: { version_id: string } }>(
      `select public.create_upload_intent($1, $2, 'pages.pdf', 80, 'Passport bio page', 'ordinary', 'subject', null, null, null) as result`,
      [ctx.matterId, ctx.applicant],
    )).rows[0].result;
    const pages = JSON.stringify([{ rotation_degrees: 90, source: "camera" }]);
    await db.query(`select public.record_camera_assembly($1, $2::jsonb)`, [intent.version_id, pages]);
    await expectDbError(() => db.query(`select public.record_camera_assembly($1, $2::jsonb)`, [intent.version_id, pages]), /assembly denied/);
  });
});
