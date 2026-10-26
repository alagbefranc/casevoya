import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const PDF = "application/pdf";
const JPEG = "image/jpeg";
const SHA = "a".repeat(64);

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
  const finance = await createUser(email("finance"));
  const outsider = await createUser(email("outsider"));
  const orgId = await createOrg(owner);
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const financeMembership = await activeMembership(orgId, finance, "finance_user", owner);
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
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { ok: boolean; id: string } }>(
    `select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`,
    [consultantMembership],
  );
  const matterId = matter.rows[0].result.id;
  await db.query(
    `insert into public.persons (organization_id, display_name, is_sample, user_id)
     values ($1, 'Synthetic applicant', true, $2), ($1, 'Synthetic sponsor', true, $3)`,
    [orgId, client, sponsor],
  );
  const people = await db.query<{ id: string; display_name: string }>(
    `select id, display_name from public.persons where organization_id = $1`,
    [orgId],
  );
  const applicant = people.rows.find((row) => row.display_name === "Synthetic applicant")?.id;
  const sponsorPerson = people.rows.find((row) => row.display_name === "Synthetic sponsor")?.id;
  if (!applicant || !sponsorPerson) throw new Error("people were not created");
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role)
     values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`,
    [orgId, matterId, applicant, sponsorPerson],
  );
  const otherOrg = await createOrg(outsider);
  return {
    owner,
    consultant,
    client,
    sponsor,
    finance,
    outsider,
    orgId,
    otherOrg,
    consultantMembership,
    financeMembership,
    ownerMembership,
    matterId,
    applicant,
    sponsorPerson,
  };
}

async function storeObject(key: string, size: number) {
  await asMaintenance(db);
  await db.query(
    `insert into storage.objects (id, bucket_id, name, metadata)
     values ($1, 'documents', $2, jsonb_build_object('size', $3::int))`,
    [randomUUID(), key, size],
  );
}

/** The server action verifies the stored bytes, then completes through the service-role function. */
async function completeVerified(versionId: string, actor: string, size: number, mediaType: string) {
  await asServiceRole(db);
  return db.query<{ result: { upload_state: string; scan_result: string } }>(
    `select public.finish_verified_document_upload($1, $2, $3, $4, $5) as result`,
    [versionId, actor, SHA, size, mediaType],
  );
}

describe("document storage and review", () => {
  it("keeps the bucket private and forces RLS", async () => {
    const bucket = await db.query<{ public: boolean }>(
      `select public from storage.buckets where id = 'documents'`,
    );
    expect(bucket.rows[0]?.public).toBe(false);
    const flags = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity
       from pg_class
       where relname in (
         'documents', 'document_versions', 'document_matter_refs', 'document_custody_events',
         'document_requests', 'document_reviews'
       )`,
    );
    expect(flags.rows).toHaveLength(6);
    expect(flags.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it("quarantines a misleading extension and accepts only a clean reviewed file", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const request = await db.query<{ id: string }>(
      `select public.create_document_request(
         $1, $2, 'Passport bio page', 'The page that shows the photograph and the name.',
         null, array['pdf']::text[], 'Name and photograph are readable.', null,
         'subject', 'ordinary', null, null
       ) as id`,
      [ctx.matterId, ctx.applicant],
    );
    const requestId = request.rows[0].id;

    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const bad = await db.query<{ result: { version_id: string; storage_key: string; document_id: string } }>(
      `select public.create_upload_intent(
         $1, $2, 'passport.pdf', 32, 'Passport bio page', 'ordinary', 'subject', null, null, null
       ) as result`,
      [ctx.matterId, ctx.applicant],
    );
    await db.query(`select public.attach_upload_to_request($1, $2)`, [bad.rows[0].result.version_id, requestId]);
    await storeObject(bad.rows[0].result.storage_key, 32);
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(
      () => db.query(`select public.complete_document_upload($1, $2, $3)`, [bad.rows[0].result.version_id, SHA, "25504446"]),
      /permission denied/,
    );
    const quarantined = await completeVerified(bad.rows[0].result.version_id, ctx.client, 32, JPEG);
    expect(quarantined.rows[0].result).toMatchObject({
      upload_state: "quarantined",
      scan_result: "extension_mismatch",
    });

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const quarantinedVersion = await db.query<{ version: number }>(
      `select version from public.document_versions where id = $1`,
      [bad.rows[0].result.version_id],
    );
    await expectDbError(
      () =>
        db.query(
          `select public.review_document_version($1, $2, 'accepted', 'Looks complete.', null)`,
          [bad.rows[0].result.version_id, quarantinedVersion.rows[0].version],
        ),
      /cannot be accepted/,
    );

    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const good = await db.query<{ result: { version_id: string; storage_key: string; document_id: string } }>(
      `select public.create_upload_intent(
         $1, $2, 'passport.pdf', 40, 'Passport bio page', 'ordinary', 'subject', $3, null, null
       ) as result`,
      [ctx.matterId, ctx.applicant, bad.rows[0].result.document_id],
    );
    await db.query(`select public.attach_upload_to_request($1, $2)`, [good.rows[0].result.version_id, requestId]);
    await storeObject(good.rows[0].result.storage_key, 40);
    const clean = await completeVerified(good.rows[0].result.version_id, ctx.client, 40, PDF);
    expect(clean.rows[0].result).toMatchObject({ upload_state: "clean", scan_result: "structural_only" });
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });

    const before = await db.query<{ progress: { accepted_count: number; uploaded_unaccepted_count: number; request_count: number } }>(
      `select public.document_request_progress($1) as progress`,
      [ctx.matterId],
    );
    expect(before.rows[0].progress.accepted_count).toBe(0);
    expect(before.rows[0].progress.request_count).toBe(1);
    expect(Number(before.rows[0].progress.uploaded_unaccepted_count)).toBeGreaterThan(0);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId });
    await expectDbError(
      () =>
        db.query(`select public.review_document_version($1, 2, 'accepted', 'Name is readable.', null)`, [
          good.rows[0].result.version_id,
        ]),
      /step-up/,
    );

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const version = await db.query<{ version: number }>(
      `select version from public.document_versions where id = $1`,
      [good.rows[0].result.version_id],
    );
    await expectDbError(
      () =>
        db.query(`select public.review_document_version($1, $2, 'accepted', 'Name is readable.', null)`, [
          good.rows[0].result.version_id,
          version.rows[0].version + 1,
        ]),
      /version conflict/,
    );
    await db.query(`select public.review_document_version($1, $2, 'accepted', 'Name is readable.', null)`, [
      good.rows[0].result.version_id,
      version.rows[0].version,
    ]);

    const after = await db.query<{ progress: { accepted_count: number; outstanding_count: number } }>(
      `select public.document_request_progress($1) as progress`,
      [ctx.matterId],
    );
    expect(after.rows[0].progress).toMatchObject({ accepted_count: 1, outstanding_count: 0 });

    const download = await db.query<{ result: { storage_key: string; seconds: number } }>(
      `select public.authorize_document_download($1) as result`,
      [good.rows[0].result.version_id],
    );
    expect(download.rows[0].result.storage_key).toBe(good.rows[0].result.storage_key);
    expect(download.rows[0].result.seconds).toBe(120);

    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(
      () => db.query(`select public.authorize_document_download($1)`, [bad.rows[0].result.version_id]),
      /download denied/,
    );

    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log
       where organization_id = $1 and action in ('document.download', 'document.reviewed', 'document.upload_completed')`,
      [ctx.orgId],
    );
    expect(audit.rows.map((row) => row.action).sort()).toEqual(
      expect.arrayContaining(["document.download", "document.reviewed", "document.upload_completed"]),
    );
    await expectDbError(
      () => db.query(`update public.document_reviews set reason = 'rewritten' where organization_id = $1`, [ctx.orgId]),
      /cannot be deleted|permission denied/,
    );
    await expectDbError(
      () => db.query(`delete from public.documents where organization_id = $1`, [ctx.orgId]),
      /cannot be deleted|permission denied/,
    );
  });

  it("hides another firm's files, finance, and a private document from the sponsor", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const uploaded = await db.query<{ result: { version_id: string; storage_key: string; document_id: string } }>(
      `select public.create_upload_intent(
         $1, $2, 'note.pdf', 20, 'Private narrative', 'narrative', 'subject', null, null, null
       ) as result`,
      [ctx.matterId, ctx.applicant],
    );
    await storeObject(uploaded.rows[0].result.storage_key, 20);
    await completeVerified(uploaded.rows[0].result.version_id, ctx.client, 20, PDF);

    await asUser(db, { userId: ctx.sponsor, aal: "aal1", orgId: ctx.orgId });
    const sponsorSees = await db.query(`select id from public.documents`);
    expect(sponsorSees.rows).toHaveLength(0);

    await asUser(db, { userId: ctx.finance, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const financeSees = await db.query(`select id from public.documents`);
    expect(financeSees.rows).toHaveLength(0);

    await asUser(db, { userId: ctx.outsider, aal: "aal2", orgId: ctx.otherOrg, totpAgeSeconds: 0 });
    const outsiderSees = await db.query(`select id from public.documents`);
    expect(outsiderSees.rows).toHaveLength(0);

    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const clientSees = await db.query(`select id from public.documents`);
    expect(clientSees.rows).toHaveLength(1);
  });

  it("refuses a document request without a fresh step-up, even one resumed after /mfa (bug 1, 2026-10-25)", async () => {
    const ctx = await firm();
    const request = () =>
      db.query<{ id: string }>(
        `select public.create_document_request(
           $1, $2, 'Passport bio page', 'The page that shows the photograph and the name.',
           null, array['pdf']::text[], null, null, 'subject', 'ordinary', null, null
         ) as id`,
        [ctx.matterId, ctx.applicant],
      );
    // The resumed press calls the same function: a stale check (an hour old) is still refused.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(request, /step-up is required/);
    await asUser(db, { userId: ctx.consultant, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(request, /denied|step-up/);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    expect((await request()).rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses an unpublished rule and a direct version update", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(
          `select public.create_document_request(
             $1, $2, 'Staff list', 'Chosen by the consultant for this file.',
             null, array['pdf','jpeg']::text[], null, null, 'subject', 'ordinary', $3, 'passport_bio'
           )`,
          [ctx.matterId, ctx.applicant, randomUUID()],
        ),
      /published rule/,
    );
    const created = await db.query<{ result: { version_id: string } }>(
      `select public.create_upload_intent(
         $1, $2, 'photo.jpg', 20, 'Photograph', 'ordinary', 'matter', null, null, null
       ) as result`,
      [ctx.matterId, ctx.applicant],
    );
    await expectDbError(
      () =>
        db.query(`update public.document_versions set upload_state = 'clean' where id = $1`, [
          created.rows[0].result.version_id,
        ]),
      /document function|permission denied/,
    );
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.set_document_upload_limit(104857600)`),
      /25 MB/,
    );
  });

  it("lets a worker quarantine a clean file so it no longer counts", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const uploaded = await db.query<{ result: { version_id: string; storage_key: string } }>(
      `select public.create_upload_intent(
         $1, $2, 'letter.pdf', 24, 'Letter', 'ordinary', 'subject', null, null, null
       ) as result`,
      [ctx.matterId, ctx.applicant],
    );
    await storeObject(uploaded.rows[0].result.storage_key, 24);
    await completeVerified(uploaded.rows[0].result.version_id, ctx.client, 24, PDF);
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(
      () => db.query(`select public.apply_document_scan($1, 'suspicious')`, [uploaded.rows[0].result.version_id]),
      /worker role|permission denied/,
    );
    await asServiceRole(db);
    const state = await db.query<{ apply_document_scan: string }>(
      `select public.apply_document_scan($1, 'suspicious')`,
      [uploaded.rows[0].result.version_id],
    );
    expect(state.rows[0].apply_document_scan).toBe("quarantined");
  });
});
