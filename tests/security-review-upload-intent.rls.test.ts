/**
 * 20261030180000_upload_intent_existing_document_scope.sql: a new version of an existing document
 * (create_upload_intent with p_document_id) needs the document to be readable by the caller and
 * already linked to the matter named in the call. A normal new version on the same matter works.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

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

async function membership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return row.rows[0].id;
}

/**
 * One firm: a consultant on matters A and B, a case manager assigned to matter A only, and an
 * applicant (with a portal login) on both matters.
 */
async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const caseManager = await createUser(email("case-manager"));
  const client = await createUser(email("client"));
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant", owner);
  const caseManagerMembership = await membership(orgId, caseManager, "case_manager", owner);
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
  const newMatter = async (title: string) => {
    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const matter = await db.query<{ result: { id: string } }>(
      `select public.create_engaged_matter($1, true, $2, null, null) as result`,
      [title, consultantMembership],
    );
    return matter.rows[0].result.id;
  };
  const matterA = await newMatter("Synthetic matter A");
  const matterB = await newMatter("Synthetic matter B");
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, display_name, is_sample, user_id)
     values ($1, 'Synthetic applicant', true, $2) returning id`,
    [orgId, client],
  );
  const applicant = person.rows[0].id;
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role)
     values ($1, $2, $4, 'applicant'), ($1, $3, $4, 'applicant')`,
    [orgId, matterA, matterB, applicant],
  );
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role)
     values ($1, $2, $3, 'case_manager')`,
    [orgId, matterA, caseManagerMembership],
  );
  return { owner, consultant, caseManager, client, orgId, matterA, matterB, applicant };
}

type Firm = Awaited<ReturnType<typeof firm>>;
type Intent = { version_id: string; storage_key: string; document_id: string };

async function asStaff(ctx: Firm, userId: string) {
  await asUser(db, { userId, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
}

async function asClient(ctx: Firm) {
  await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
}

function intent(matterId: string, personId: string, audience: string, documentId: string | null) {
  return db.query<{ result: Intent }>(
    `select public.create_upload_intent(
       $1, $2, 'passport.pdf', 40, 'Passport bio page', 'ordinary', $3::public.document_audience, $4, null, null
     ) as result`,
    [matterId, personId, audience, documentId],
  );
}

async function documentState(documentId: string) {
  await asMaintenance(db);
  const doc = await db.query<{ current_version_id: string }>(
    `select current_version_id from public.documents where id = $1`,
    [documentId],
  );
  const refs = await db.query<{ matter_id: string }>(
    `select matter_id from public.document_matter_refs where document_id = $1 and removed_at is null order by matter_id`,
    [documentId],
  );
  const versions = await db.query<{ n: number }>(
    `select count(*)::int as n from public.document_versions where document_id = $1`,
    [documentId],
  );
  return {
    current: doc.rows[0].current_version_id,
    matters: refs.rows.map((row) => row.matter_id),
    versions: versions.rows[0].n,
  };
}

describe("create_upload_intent: new versions of an existing document", () => {
  it("refuses staff a version of a document on a matter they cannot read, and adds no link", async () => {
    const ctx = await firm();
    await asClient(ctx);
    const original = (await intent(ctx.matterB, ctx.applicant, "subject", null)).rows[0].result;
    const before = await documentState(original.document_id);
    expect(before.matters).toEqual([ctx.matterB]);

    // The case manager can read matter A only, and so cannot read this document.
    await asStaff(ctx, ctx.caseManager);
    const readable = await db.query<{ ok: boolean }>(`select app.can_read_document($1) as ok`, [original.document_id]);
    expect(readable.rows[0].ok).toBe(false);
    // The case manager can still upload for this person on matter A (so the refusal below is the document rule).
    const fresh = (await intent(ctx.matterA, ctx.applicant, "subject", null)).rows[0].result;
    expect(fresh.document_id).not.toBe(original.document_id);
    await expectDbError(() => intent(ctx.matterA, ctx.applicant, "subject", original.document_id), /document upload denied/);
    await expectDbError(() => intent(ctx.matterA, ctx.applicant, "staff", original.document_id), /document upload denied/);

    expect(await documentState(original.document_id)).toEqual(before);
  });

  it("refuses staff who can read the document a version that would link it to another matter", async () => {
    const ctx = await firm();
    await asClient(ctx);
    const original = (await intent(ctx.matterB, ctx.applicant, "subject", null)).rows[0].result;
    const before = await documentState(original.document_id);

    // The consultant reads both matters, but the document is only on matter B.
    await asStaff(ctx, ctx.consultant);
    const readable = await db.query<{ ok: boolean }>(`select app.can_read_document($1) as ok`, [original.document_id]);
    expect(readable.rows[0].ok).toBe(true);
    await expectDbError(() => intent(ctx.matterA, ctx.applicant, "subject", original.document_id), /document upload denied/);
    expect(await documentState(original.document_id)).toEqual(before);

    // On its own matter the same version is accepted.
    await asStaff(ctx, ctx.consultant);
    const next = (await intent(ctx.matterB, ctx.applicant, "subject", original.document_id)).rows[0].result;
    expect(next.document_id).toBe(original.document_id);
    const after = await documentState(original.document_id);
    expect(after).toEqual({ current: next.version_id, matters: [ctx.matterB], versions: 2 });
  });

  it("refuses the client a version of their own staff-only document or one on another matter", async () => {
    const ctx = await firm();
    await asStaff(ctx, ctx.consultant);
    const staffOnly = (await intent(ctx.matterA, ctx.applicant, "staff", null)).rows[0].result;
    const staffBefore = await documentState(staffOnly.document_id);

    await asClient(ctx);
    const hidden = await db.query<{ ok: boolean }>(`select app.can_read_document($1) as ok`, [staffOnly.document_id]);
    expect(hidden.rows[0].ok).toBe(false);
    await expectDbError(() => intent(ctx.matterA, ctx.applicant, "subject", staffOnly.document_id), /document upload denied/);
    await expectDbError(() => intent(ctx.matterB, ctx.applicant, "subject", staffOnly.document_id), /document upload denied/);
    expect(await documentState(staffOnly.document_id)).toEqual(staffBefore);

    await asClient(ctx);
    const own = (await intent(ctx.matterB, ctx.applicant, "subject", null)).rows[0].result;
    const ownBefore = await documentState(own.document_id);
    await asClient(ctx);
    await expectDbError(() => intent(ctx.matterA, ctx.applicant, "subject", own.document_id), /document upload denied/);
    expect(await documentState(own.document_id)).toEqual(ownBefore);
  });

  it("still lets staff and the client add a new version to a readable document on the same matter", async () => {
    const ctx = await firm();
    await asClient(ctx);
    const original = (await intent(ctx.matterA, ctx.applicant, "subject", null)).rows[0].result;

    await asStaff(ctx, ctx.caseManager);
    const byStaff = (await intent(ctx.matterA, ctx.applicant, "subject", original.document_id)).rows[0].result;
    expect(byStaff.document_id).toBe(original.document_id);

    await asClient(ctx);
    const byClient = (await intent(ctx.matterA, ctx.applicant, "subject", original.document_id)).rows[0].result;
    expect(byClient.document_id).toBe(original.document_id);

    expect(await documentState(original.document_id)).toEqual({
      current: byClient.version_id,
      matters: [ctx.matterA],
      versions: 3,
    });
    await asMaintenance(db);
    const chain = await db.query<{ version_number: number; parent_version_id: string | null }>(
      `select version_number, parent_version_id from public.document_versions where document_id = $1 order by version_number`,
      [original.document_id],
    );
    expect(chain.rows).toEqual([
      { version_number: 1, parent_version_id: null },
      { version_number: 2, parent_version_id: original.version_id },
      { version_number: 3, parent_version_id: byStaff.version_id },
    ]);
  });
});
