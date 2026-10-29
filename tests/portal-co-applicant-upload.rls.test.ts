/**
 * #272 item 1 (20261029100000_portal_co_applicant_uploads.sql): a sponsor on the portal sees the
 * name of, and can upload for, another adult on their own matter (no portal login) when the firm
 * asked that person for a matter-visible, ordinary document. Persons RLS stays as it was; people
 * not on the sponsor's matter, another firm's people, and 'subject' (private) requests stay hidden
 * and refused. The upload goes through the same path as any other, scanning off or on (#271).
 */
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
  await scanning(false);
});

async function scanning(on: boolean) {
  await asMaintenance(db);
  await db.query(
    `update public.product_settings set value = jsonb_build_object('enabled', $1::boolean)
     where key = 'documents.accept_structural_inspection'`,
    [!on],
  );
}

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, address],
  );
  return id;
}

async function addPerson(orgId: string, matterId: string, name: string, role: string, userId: string | null = null) {
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, $2, true, $3) returning id`,
    [orgId, name, userId],
  );
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, $4::public.matter_party_role)`,
    [orgId, matterId, person.rows[0].id, role],
  );
  return person.rows[0].id;
}

/** A firm with a consultant, a matter (sponsor Ingrid with a login, Elias and Freya without one). */
async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const sponsor = await createUser(email("sponsor"));
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const membership = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
    [orgId, consultant, owner],
  );
  const consultantMembership = membership.rows[0].id;
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, 'sponsor', 'active', now(), $3)`,
    [orgId, sponsor, owner],
  );
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
  const newMatter = async (title: string) => {
    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const matter = await db.query<{ result: { id: string } }>(
      `select public.create_engaged_matter($1, true, $2, null, null) as result`,
      [title, consultantMembership],
    );
    return matter.rows[0].result.id;
  };
  const matterId = await newMatter("Synthetic spousal matter");
  const ingrid = await addPerson(orgId, matterId, "Ingrid Sample", "sponsor", sponsor);
  const elias = await addPerson(orgId, matterId, "Elias Lindqvist", "applicant");
  const freya = await addPerson(orgId, matterId, "Freya Lindqvist", "dependant");
  // Someone in the same firm on another matter the sponsor isn't on.
  const otherMatterId = await newMatter("Synthetic other matter");
  const olga = await addPerson(orgId, otherMatterId, "Olga Elsewhere", "applicant");
  return { owner, consultant, sponsor, orgId, matterId, otherMatterId, ingrid, elias, freya, olga };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function request(ctx: Firm, matterId: string, personId: string, audience = "matter", sensitivity = "ordinary") {
  await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  const row = await db.query<{ id: string }>(
    `select public.create_document_request(
       $1, $2, 'Passport bio page', 'The page with the photograph.', null, array['pdf']::text[],
       'Readable.', null, $3::public.document_audience, $4::public.document_sensitivity, null, null
     ) as id`,
    [matterId, personId, audience, sensitivity],
  );
  return row.rows[0].id;
}

async function asSponsor(ctx: Firm) {
  await asUser(db, { userId: ctx.sponsor, aal: "aal1", orgId: ctx.orgId });
}

/** The portal's upload calls (documents/actions.ts): intent, attach, the bytes, the server's check. */
async function sponsorUploads(ctx: Firm, personId: string, requestId: string, matterId = ctx.matterId) {
  await asSponsor(ctx);
  const intent = await db.query<{ result: { version_id: string; storage_key: string; document_id: string } }>(
    `select public.create_upload_intent($1, $2, 'passport.pdf', 40, 'Passport bio page', 'ordinary', 'matter', null, null, null) as result`,
    [matterId, personId],
  );
  const { version_id: versionId, storage_key: key, document_id: documentId } = intent.rows[0].result;
  await db.query(`select public.attach_upload_to_request($1, $2)`, [versionId, requestId]);
  const storable = await db.query<{ ok: boolean }>(`select app.can_upload_storage_object($1) as ok`, [key]);
  expect(storable.rows[0].ok).toBe(true);
  // completeDocumentUpload reads the version with the caller's own session first.
  const own = await db.query<{ created_by: string }>(`select created_by from public.document_versions where id = $1`, [versionId]);
  expect(own.rows[0]?.created_by).toBe(ctx.sponsor);
  await asMaintenance(db);
  await db.query(
    `insert into storage.objects (id, bucket_id, name, metadata) values ($1, 'documents', $2, jsonb_build_object('size', 40))`,
    [randomUUID(), key],
  );
  await asServiceRole(db);
  const done = await db.query<{ result: { upload_state: string; scan_result: string } }>(
    `select public.finish_verified_document_upload($1, $2, $3, 40, $4) as result`,
    [versionId, ctx.sponsor, SHA, PDF],
  );
  return { versionId, documentId, finished: done.rows[0].result };
}

async function names(ctx: Firm) {
  await asSponsor(ctx);
  const rows = await db.query<{ person_id: string; display_name: string }>(`select * from public.portal_request_person_names()`);
  return rows.rows;
}

async function denied(ctx: Firm, matterId: string, personId: string, audience = "matter", sensitivity = "ordinary") {
  await asSponsor(ctx);
  await expectDbError(
    () => db.query(
      `select public.create_upload_intent($1, $2, 'passport.pdf', 40, 'Passport bio page', $3::public.document_sensitivity, $4::public.document_audience, null, null, null)`,
      [matterId, personId, sensitivity, audience],
    ),
    /document upload denied/,
  );
}

describe("sponsor fulfils a co-applicant's request (#272)", () => {
  it("shows the co-applicant's name only, through the narrow read; persons RLS stays closed", async () => {
    const ctx = await firm();
    await request(ctx, ctx.matterId, ctx.elias);
    await request(ctx, ctx.matterId, ctx.freya, "subject");
    await request(ctx, ctx.otherMatterId, ctx.olga);

    await asSponsor(ctx);
    const visible = await db.query<{ id: string }>(`select id from public.persons where id = any($1::uuid[])`, [[ctx.elias, ctx.freya, ctx.olga]]);
    expect(visible.rows).toHaveLength(0);

    // Only Elias: Freya's request is private to her, Olga isn't on the sponsor's matter.
    expect(await names(ctx)).toEqual([{ person_id: ctx.elias, display_name: "Elias Lindqvist" }]);

    // The function returns names and ids only.
    await asMaintenance(db);
    const columns = await db.query<{ args: string }>(
      `select pg_get_function_result('public.portal_request_person_names()'::regprocedure) as args`,
    );
    expect(columns.rows[0].args).toBe("TABLE(person_id uuid, display_name text)");

    // Another firm's sponsor sees nothing of this firm.
    const other = await firm();
    expect(await names(other)).toEqual([]);
    await asUser(db, { userId: other.sponsor, aal: "aal1", orgId: ctx.orgId });
    const crossed = await db.query(`select * from public.portal_request_person_names()`);
    expect(crossed.rows).toHaveLength(0);
  });

  it("uploads for the co-applicant end to end with scanning off: clean, attached, visible on the matter", async () => {
    await scanning(false);
    const ctx = await firm();
    const requestId = await request(ctx, ctx.matterId, ctx.elias);
    const { versionId, documentId, finished } = await sponsorUploads(ctx, ctx.elias, requestId);
    expect(finished).toMatchObject({ upload_state: "clean", scan_result: "structural_only" });

    await asSponsor(ctx);
    const doc = await db.query<{ person_id: string; audience: string; sensitivity: string }>(
      `select person_id, audience::text, sensitivity::text from public.documents where id = $1`,
      [documentId],
    );
    expect(doc.rows[0]).toEqual({ person_id: ctx.elias, audience: "matter", sensitivity: "ordinary" });
    const attached = await db.query<{ request_id: string; upload_state: string }>(
      `select request_id, upload_state::text from public.document_versions where id = $1`,
      [versionId],
    );
    expect(attached.rows[0]).toEqual({ request_id: requestId, upload_state: "clean" });
    const req = await db.query<{ document_id: string }>(`select document_id from public.document_requests where id = $1`, [requestId]);
    expect(req.rows[0].document_id).toBe(documentId);

    // Staff see it to review, like any other upload.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const staff = await db.query(`select 1 from public.document_versions where id = $1`, [versionId]);
    expect(staff.rows).toHaveLength(1);

    // A fulfilled request keeps its name on the card.
    expect((await names(ctx)).map((row) => row.display_name)).toEqual(["Elias Lindqvist"]);
  });

  it("uploads for the co-applicant with scanning on: held as scanning until the scanner says clean", async () => {
    await scanning(true);
    const ctx = await firm();
    const requestId = await request(ctx, ctx.matterId, ctx.elias);
    const { versionId, finished } = await sponsorUploads(ctx, ctx.elias, requestId);
    expect(finished).toMatchObject({ upload_state: "scanning", scan_result: "awaiting_scanner" });

    // The sponsor sees "Checking for viruses…" (the row), not the file.
    await asSponsor(ctx);
    const held = await db.query<{ upload_state: string }>(`select upload_state::text from public.document_versions where id = $1`, [versionId]);
    expect(held.rows[0].upload_state).toBe("scanning");
    await expectDbError(() => db.query(`select public.authorize_document_download($1)`, [versionId]), /download denied/);

    await asServiceRole(db);
    const recorded = await db.query<{ result: { upload_state: string } }>(
      `select public.service_record_document_scan($1, 'clean', null, 'ClamAV 1.4.3/27800') as result`,
      [versionId],
    );
    expect(recorded.rows[0].result.upload_state).toBe("clean");
    await asSponsor(ctx);
    const clean = await db.query<{ upload_state: string }>(`select upload_state::text from public.document_versions where id = $1`, [versionId]);
    expect(clean.rows[0].upload_state).toBe("clean");
    await scanning(false);
  });

  it("refuses everyone and everything outside the co-applicant's matter-visible request", async () => {
    const ctx = await firm();
    const requestId = await request(ctx, ctx.matterId, ctx.elias);
    await request(ctx, ctx.matterId, ctx.freya, "subject");
    await request(ctx, ctx.otherMatterId, ctx.olga);

    // A private ('subject') or sensitive file for Elias, even though his request exists.
    await denied(ctx, ctx.matterId, ctx.elias, "subject");
    await denied(ctx, ctx.matterId, ctx.elias, "matter", "medical");
    // Freya's request is private to her: the sponsor can't see it, so can't fulfil it.
    await denied(ctx, ctx.matterId, ctx.freya);
    // Olga isn't on the sponsor's matter, on either matter id.
    await denied(ctx, ctx.matterId, ctx.olga);
    await denied(ctx, ctx.otherMatterId, ctx.olga);
    // Another firm's person, with an open matter request there.
    const other = await firm();
    await request(other, other.matterId, other.elias);
    await denied(ctx, other.matterId, other.elias);

    // No open request, no upload: once Elias's request is waived the sponsor can't upload for him.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const current = await db.query<{ version: number }>(`select version from public.document_requests where id = $1`, [requestId]);
    await db.query(`select public.waive_document_request($1, $2, 'Not needed for this application.')`, [requestId, current.rows[0].version]);
    await denied(ctx, ctx.matterId, ctx.elias);

    // Their own uploads keep working as before.
    await asSponsor(ctx);
    const own = await db.query<{ result: { version_id: string } }>(
      `select public.create_upload_intent($1, $2, 'id.pdf', 40, 'Sponsor ID', 'ordinary', 'subject', null, null, null) as result`,
      [ctx.matterId, ctx.ingrid],
    );
    expect(own.rows[0].result.version_id).toBeTruthy();
  });
});
