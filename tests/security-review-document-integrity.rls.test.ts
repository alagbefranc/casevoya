/**
 * 20261031020000: document integrity.
 *  - DOC-1: the document's own person adds a new version only of a document they uploaded, or of
 *    one an open request names; never a staff-made or sealed document.
 *  - DOC-2: a request attach is bound to the upload intent's matter and does not lower an existing
 *    document's audience or sensitivity unless the caller may classify documents.
 *  - DOC-9: a translation source must be readable by the caller and on the same matter.
 *  - DOC-4: sealed agreement documents follow app.can_read_agreement for portal users.
 *  - DOC-6: the staff-signer branch of app.can_read_agreement needs staff MFA.
 * Synthetic users only.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, queryInternal, type TestDb } from "./helpers/postgres";

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const PURPOSE = "Passport bio page";

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
    `${label}-${id.slice(0, 8)}@example.test`,
  ]);
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
 * One firm: a consultant on matters A and B, a case manager on matter A, an applicant with a portal
 * login on both matters, a sponsor with a login on matter A, and an adult without a login on A.
 */
async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const caseManager = await createUser("case-manager");
  const client = await createUser("client");
  const sponsor = await createUser("sponsor");
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
  await membership(orgId, sponsor, "sponsor", owner);
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  const newMatter = async (title: string) => {
    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const matter = await db.query<{ result: { id: string } }>(`select public.create_engaged_matter($1, true, $2, null, null) as result`, [
      title,
      consultantMembership,
    ]);
    return matter.rows[0].result.id;
  };
  const matterA = await newMatter("Synthetic matter A");
  const matterB = await newMatter("Synthetic matter B");
  await asMaintenance(db);
  const person = async (name: string, userId: string | null) =>
    (
      await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, $2, true, $3) returning id`, [
        orgId,
        name,
        userId,
      ])
    ).rows[0].id;
  const applicant = await person("Synthetic applicant", client);
  const sponsorPerson = await person("Synthetic sponsor", sponsor);
  const elias = await person("Elias Sample", null);
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role)
     values ($1, $2, $4, 'applicant'), ($1, $3, $4, 'applicant'), ($1, $2, $5, 'sponsor'), ($1, $2, $6, 'dependant')`,
    [orgId, matterA, matterB, applicant, sponsorPerson, elias],
  );
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [
    orgId,
    matterA,
    caseManagerMembership,
  ]);
  return { owner, consultant, consultantMembership, caseManager, client, sponsor, orgId, matterA, matterB, applicant, sponsorPerson, elias };
}

type Firm = Awaited<ReturnType<typeof firm>>;
type Intent = { version_id: string; document_id: string };

const asStaff = (ctx: Firm, userId: string) => asUser(db, { userId, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
const asClient = (ctx: Firm) => asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });

async function intent(
  matterId: string,
  personId: string,
  options: { audience?: string; sensitivity?: string; documentId?: string | null; translationOf?: string | null } = {},
) {
  const row = await db.query<{ result: Intent }>(
    `select public.create_upload_intent(
       $1, $2, 'file.pdf', 40, $3, $4::public.document_sensitivity, $5::public.document_audience, $6, $7, $8
     ) as result`,
    [
      matterId,
      personId,
      PURPOSE,
      options.sensitivity ?? "ordinary",
      options.audience ?? "subject",
      options.documentId ?? null,
      options.translationOf ?? null,
      options.translationOf ? "fr" : null,
    ],
  );
  return row.rows[0].result;
}

async function request(ctx: Firm, matterId: string, personId: string, audience = "subject", sensitivity = "ordinary") {
  await asStaff(ctx, ctx.consultant);
  const row = await db.query<{ id: string }>(
    `select public.create_document_request(
       $1, $2, $3, 'Synthetic explanation.', null, array['pdf']::text[], 'Readable.', null,
       $4::public.document_audience, $5::public.document_sensitivity, null, null
     ) as id`,
    [matterId, personId, PURPOSE, audience, sensitivity],
  );
  return row.rows[0].id;
}

async function attach(versionId: string, requestId: string) {
  await db.query(`select public.attach_upload_to_request($1, $2)`, [versionId, requestId]);
}

async function classification(documentId: string) {
  await asMaintenance(db);
  const row = await db.query<{ audience: string; sensitivity: string; current_version_id: string; version: number }>(
    `select audience::text, sensitivity::text, current_version_id, version from public.documents where id = $1`,
    [documentId],
  );
  return row.rows[0];
}

/** A sealed agreement document (as app.attach_sealed_agreement files it), created in the given session. */
async function sealed(ctx: Firm) {
  const pdf = Buffer.from(`%PDF-1.7 synthetic sealed ${randomUUID()}`);
  const sha = createHash("sha256").update(pdf).digest("hex");
  const row = await queryInternal<{ id: string }>(
    db,
    `select app.store_sealed_pdf($1, $2, $3, 'Executed agreement', 'executed-agreement.pdf', $4, $5) as id`,
    [ctx.orgId, ctx.matterA, ctx.applicant, pdf, sha],
  );
  await asMaintenance(db);
  const doc = await db.query<{ document_id: string }>(`select document_id from public.document_versions where id = $1`, [row.rows[0].id]);
  return { versionId: row.rows[0].id, documentId: doc.rows[0].document_id };
}

async function canRead(documentId: string) {
  return (await db.query<{ ok: boolean }>(`select app.can_read_document($1) as ok`, [documentId])).rows[0].ok;
}

describe("DOC-1 client new versions of firm-issued documents", () => {
  it("refuses a new version of a staff-made document the client can read", async () => {
    const ctx = await firm();
    await asStaff(ctx, ctx.consultant);
    const staffDoc = await intent(ctx.matterA, ctx.applicant, { audience: "subject" });
    const before = await classification(staffDoc.document_id);

    await asClient(ctx);
    expect(await canRead(staffDoc.document_id)).toBe(true);
    await expectDbError(() => intent(ctx.matterA, ctx.applicant, { documentId: staffDoc.document_id }), /document upload denied/);
    expect((await classification(staffDoc.document_id)).current_version_id).toBe(before.current_version_id);

    // Staff may still add a version.
    await asStaff(ctx, ctx.consultant);
    const byStaff = await intent(ctx.matterA, ctx.applicant, { documentId: staffDoc.document_id });
    expect(byStaff.document_id).toBe(staffDoc.document_id);
  });

  it("refuses a new version of a sealed agreement, even one filed in the client's own session", async () => {
    const ctx = await firm();
    await asClient(ctx);
    const seal = await sealed(ctx);
    await asClient(ctx);
    expect(await canRead(seal.documentId)).toBe(true);
    await expectDbError(() => intent(ctx.matterA, ctx.applicant, { documentId: seal.documentId, audience: "matter" }), /document upload denied/);
    expect((await classification(seal.documentId)).current_version_id).toBe(seal.versionId);
  });

  it("allows a new version of the client's own upload, or of a staff document an open request names", async () => {
    const ctx = await firm();
    await asClient(ctx);
    const own = await intent(ctx.matterA, ctx.applicant);
    await asClient(ctx);
    expect((await intent(ctx.matterA, ctx.applicant, { documentId: own.document_id })).document_id).toBe(own.document_id);

    const requestId = await request(ctx, ctx.matterA, ctx.applicant);
    await asStaff(ctx, ctx.consultant);
    const staffDoc = await intent(ctx.matterA, ctx.applicant);
    await attach(staffDoc.version_id, requestId);
    await asClient(ctx);
    const replacement = await intent(ctx.matterA, ctx.applicant, { documentId: staffDoc.document_id });
    expect(replacement.document_id).toBe(staffDoc.document_id);
    await attach(replacement.version_id, requestId);
    expect((await classification(staffDoc.document_id)).current_version_id).toBe(replacement.version_id);
  });
});

describe("DOC-2 request attach", () => {
  it("refuses a request on another matter than the upload intent", async () => {
    const ctx = await firm();
    const onA = await request(ctx, ctx.matterA, ctx.applicant);
    const onB = await request(ctx, ctx.matterB, ctx.applicant);
    await asClient(ctx);
    const file = await intent(ctx.matterB, ctx.applicant);
    await expectDbError(() => attach(file.version_id, onA), /document upload denied/);
    await asMaintenance(db);
    expect((await db.query<{ document_id: string | null }>(`select document_id from public.document_requests where id = $1`, [onA])).rows[0].document_id).toBeNull();
    await asClient(ctx);
    await attach(file.version_id, onB);
  });

  it("keeps an existing document's stricter audience and sensitivity unless the caller may classify", async () => {
    const ctx = await firm();
    const first = await request(ctx, ctx.matterA, ctx.applicant);
    await asClient(ctx);
    const original = await intent(ctx.matterA, ctx.applicant);
    await attach(original.version_id, first);
    // Staff classify the document as medical.
    const doc = await classification(original.document_id);
    await asStaff(ctx, ctx.consultant);
    await db.query(`select public.set_document_classification($1, $2, $3, 'medical')`, [original.document_id, doc.version, PURPOSE]);

    // A matter-visible ordinary request does not downgrade it through the client's new version.
    const open = await request(ctx, ctx.matterA, ctx.applicant, "matter", "ordinary");
    await asClient(ctx);
    const next = await intent(ctx.matterA, ctx.applicant, { documentId: original.document_id });
    await attach(next.version_id, open);
    expect(await classification(original.document_id)).toMatchObject({ audience: "subject", sensitivity: "medical" });

    // A case manager with step-up may.
    await asStaff(ctx, ctx.caseManager);
    const byManager = await intent(ctx.matterA, ctx.applicant, { documentId: original.document_id });
    await attach(byManager.version_id, open);
    expect(await classification(original.document_id)).toMatchObject({ audience: "matter", sensitivity: "ordinary" });
  });

  it("still sets a new document's classification from the request", async () => {
    const ctx = await firm();
    const open = await request(ctx, ctx.matterA, ctx.applicant, "matter", "ordinary");
    await asClient(ctx);
    const file = await intent(ctx.matterA, ctx.applicant, { audience: "subject" });
    await attach(file.version_id, open);
    expect(await classification(file.document_id)).toMatchObject({ audience: "matter", sensitivity: "ordinary" });
  });
});

describe("DOC-9 translation source", () => {
  it("must be readable by the caller and on the same matter", async () => {
    const ctx = await firm();
    await asStaff(ctx, ctx.consultant);
    const hidden = await intent(ctx.matterA, ctx.elias, { audience: "subject" });
    await asClient(ctx);
    const ownOnB = await intent(ctx.matterB, ctx.applicant);
    const ownOnA = await intent(ctx.matterA, ctx.applicant);

    await asClient(ctx);
    expect(await canRead(hidden.document_id)).toBe(false);
    await expectDbError(() => intent(ctx.matterA, ctx.applicant, { translationOf: hidden.version_id }), /translation source was not found/);
    await expectDbError(() => intent(ctx.matterA, ctx.applicant, { translationOf: ownOnB.version_id }), /translation source was not found/);
    const translation = await intent(ctx.matterA, ctx.applicant, { translationOf: ownOnA.version_id });
    expect(translation.version_id).toBeTruthy();
  });
});

describe("DOC-4 / DOC-6 sealed agreements", () => {
  async function envelopeFor(ctx: Firm, sealedVersionId: string) {
    await asMaintenance(db);
    const agreement = await db.query<{ id: string }>(
      `insert into public.agreements (organization_id, matter_id, kind, title, status) values ($1, $2, 'service', 'Synthetic service agreement', 'sent') returning id`,
      [ctx.orgId, ctx.matterA],
    );
    const version = await db.query<{ id: string }>(
      `insert into public.agreement_versions (organization_id, agreement_id, version_number, canonical_body, scope_summary)
       values ($1, $2, 1, 'Synthetic body', 'Synthetic scope') returning id`,
      [ctx.orgId, agreement.rows[0].id],
    );
    const envelope = await db.query<{ id: string }>(
      `insert into public.signature_envelopes (organization_id, agreement_id, version_id, idempotency_key, expires_at, content_sha256, sealed_document_version_id)
       values ($1, $2, $3, $4, now() + interval '7 days', $5, $6) returning id`,
      [ctx.orgId, agreement.rows[0].id, version.rows[0].id, `env-${randomUUID()}`, "b".repeat(64), sealedVersionId],
    );
    await db.query(
      `insert into public.envelope_signers (organization_id, envelope_id, signing_order, role, person_id, display_name)
       values ($1, $2, 1, 'client', $3, 'Synthetic applicant')`,
      [ctx.orgId, envelope.rows[0].id, ctx.applicant],
    );
    await db.query(
      `insert into public.envelope_signers (organization_id, envelope_id, signing_order, role, membership_id, display_name)
       values ($1, $2, 2, 'consultant', $3, 'Synthetic consultant')`,
      [ctx.orgId, envelope.rows[0].id, ctx.consultantMembership],
    );
    return agreement.rows[0].id;
  }

  it("hides a sealed agreement document from a matter participant who cannot read the agreement", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    const seal = await sealed(ctx);
    await envelopeFor(ctx, seal.versionId);
    // An ordinary matter-visible document stays readable to the sponsor.
    await asStaff(ctx, ctx.consultant);
    const shared = await intent(ctx.matterA, ctx.applicant, { audience: "matter" });

    await asUser(db, { userId: ctx.sponsor, aal: "aal1", orgId: ctx.orgId });
    expect(await canRead(shared.document_id)).toBe(true);
    expect(await canRead(seal.documentId)).toBe(false);
    await asClient(ctx);
    expect(await canRead(seal.documentId)).toBe(true);
    await asStaff(ctx, ctx.consultant);
    expect(await canRead(seal.documentId)).toBe(true);
  });

  it("needs staff MFA on the staff-signer branch of can_read_agreement", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    const seal = await sealed(ctx);
    const agreementId = await envelopeFor(ctx, seal.versionId);
    const read = async () => (await db.query<{ ok: boolean }>(`select app.can_read_agreement($1) as ok`, [agreementId])).rows[0].ok;

    await asUser(db, { userId: ctx.consultant, aal: "aal1", orgId: ctx.orgId });
    expect(await read()).toBe(false);
    await asStaff(ctx, ctx.consultant);
    expect(await read()).toBe(true);
    await asClient(ctx);
    expect(await read()).toBe(true);
  });
});
