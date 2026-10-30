/**
 * 20261030235000 (part B): a portal user uploading for another adult on their matter (the #272
 * co-applicant path of create_upload_intent) must answer an open request for that person they can
 * see, with the request's purpose, and for the request's document (none yet, or the one it holds).
 * The person's own uploads and staff uploads are unchanged. Synthetic users only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

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

/** A matter with a sponsor (portal login) and two adults without one. */
async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const sponsor = await createUser("sponsor");
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
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, 'sponsor', 'active', now(), $3)`,
    [orgId, sponsor, owner],
  );
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membership.rows[0].id, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [
    membership.rows[0].id,
  ]);
  const matterId = matter.rows[0].result.id;
  const ingrid = await addPerson(orgId, matterId, "Ingrid Sample", "sponsor", sponsor);
  const elias = await addPerson(orgId, matterId, "Elias Sample", "applicant");
  const freya = await addPerson(orgId, matterId, "Freya Sample", "dependant");
  return { consultant, sponsor, orgId, matterId, ingrid, elias, freya };
}

type Firm = Awaited<ReturnType<typeof firm>>;
type Intent = { version_id: string; document_id: string };

async function request(ctx: Firm, personId: string, purpose = PURPOSE) {
  await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  const row = await db.query<{ id: string }>(
    `select public.create_document_request(
       $1, $2, $3, 'Synthetic explanation.', null, array['pdf']::text[], 'Readable.', null,
       'matter'::public.document_audience, 'ordinary'::public.document_sensitivity, null, null
     ) as id`,
    [ctx.matterId, personId, purpose],
  );
  return row.rows[0].id;
}

function intent(ctx: Firm, personId: string, purpose: string, documentId: string | null = null, audience = "matter") {
  return db.query<{ result: Intent }>(
    `select public.create_upload_intent($1, $2, 'file.pdf', 40, $3, 'ordinary', $4::public.document_audience, $5, null, null) as result`,
    [ctx.matterId, personId, purpose, audience, documentId],
  );
}

async function asSponsor(ctx: Firm) {
  await asUser(db, { userId: ctx.sponsor, aal: "aal1", orgId: ctx.orgId });
}

describe("co-applicant uploads are bound to the request", () => {
  it("refuses a co-applicant document with another purpose, or for an adult without a request", async () => {
    const ctx = await firm();
    const requestId = await request(ctx, ctx.elias);

    await asSponsor(ctx);
    await expectDbError(() => intent(ctx, ctx.elias, "Bank statement"), /document upload denied/);
    await expectDbError(() => intent(ctx, ctx.elias, "Passport bio page and more"), /document upload denied/);
    // Freya has no request: Elias's request does not open uploads for her.
    await expectDbError(() => intent(ctx, ctx.freya, PURPOSE), /document upload denied/);

    // The request's own purpose is accepted, and attaches to the request.
    await asSponsor(ctx);
    const ok = (await intent(ctx, ctx.elias, PURPOSE)).rows[0].result;
    await db.query(`select public.attach_upload_to_request($1, $2)`, [ok.version_id, requestId]);
    await asMaintenance(db);
    const doc = await db.query<{ person_id: string; purpose: string; audience: string }>(
      `select person_id, purpose, audience::text from public.documents where id = $1`,
      [ok.document_id],
    );
    expect(doc.rows[0]).toEqual({ person_id: ctx.elias, purpose: PURPOSE, audience: "matter" });
  });

  it("binds to the request's document once it holds one", async () => {
    const ctx = await firm();
    const requestId = await request(ctx, ctx.elias);
    await asSponsor(ctx);
    const first = (await intent(ctx, ctx.elias, PURPOSE)).rows[0].result;
    await db.query(`select public.attach_upload_to_request($1, $2)`, [first.version_id, requestId]);

    // The request now holds that document: a second, unrelated document is refused...
    await asSponsor(ctx);
    await expectDbError(() => intent(ctx, ctx.elias, PURPOSE), /document upload denied/);
    // ...while a new version of the request's document (the portal passes request.document_id) works.
    const next = (await intent(ctx, ctx.elias, PURPOSE, first.document_id)).rows[0].result;
    expect(next.document_id).toBe(first.document_id);

    // A second open request with another purpose does not open a version of that document.
    await request(ctx, ctx.elias, "Birth certificate");
    await asSponsor(ctx);
    await expectDbError(() => intent(ctx, ctx.elias, "Birth certificate", first.document_id), /document upload denied/);
    const other = (await intent(ctx, ctx.elias, "Birth certificate")).rows[0].result;
    expect(other.document_id).not.toBe(first.document_id);
  });

  // 20261031017000 (R2-01): the attach step checks the target request itself.
  it("refuses attaching a co-applicant file to another request of the same person", async () => {
    const ctx = await firm();
    const requestA = await request(ctx, ctx.elias);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const others: string[] = [];
    for (const [audience, sensitivity, purpose] of [
      ["subject", "ordinary", PURPOSE],
      ["staff", "ordinary", PURPOSE],
      ["matter", "medical", PURPOSE],
      ["matter", "ordinary", "Birth certificate"],
    ]) {
      const row = await db.query<{ id: string }>(
        `select public.create_document_request(
           $1, $2, $3, 'Synthetic explanation.', null, array['pdf']::text[], 'Readable.', null,
           $4::public.document_audience, $5::public.document_sensitivity, null, null
         ) as id`,
        [ctx.matterId, ctx.elias, purpose, audience, sensitivity],
      );
      others.push(row.rows[0].id);
    }

    await asSponsor(ctx);
    const file = (await intent(ctx, ctx.elias, PURPOSE)).rows[0].result;
    for (const other of others) {
      await expectDbError(() => db.query(`select public.attach_upload_to_request($1, $2)`, [file.version_id, other]), /document upload denied/);
    }
    await asMaintenance(db);
    const untouched = await db.query<{ n: string }>(`select count(*) as n from public.document_requests where id = any($1::uuid[]) and document_id is not null`, [others]);
    expect(Number(untouched.rows[0].n)).toBe(0);

    // The request the file was made for still takes it.
    await asSponsor(ctx);
    await db.query(`select public.attach_upload_to_request($1, $2)`, [file.version_id, requestA]);
    await asMaintenance(db);
    const doc = await db.query<{ purpose: string; audience: string; sensitivity: string }>(
      `select purpose, audience::text, sensitivity::text from public.documents where id = $1`,
      [file.document_id],
    );
    expect(doc.rows[0]).toEqual({ purpose: PURPOSE, audience: "matter", sensitivity: "ordinary" });
  });

  it("leaves staff attaching to any request of the matter unchanged", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const staffOnly = (
      await db.query<{ id: string }>(
        `select public.create_document_request(
           $1, $2, 'Police certificate', 'Synthetic explanation.', null, array['pdf']::text[], 'Readable.', null,
           'staff'::public.document_audience, 'criminal'::public.document_sensitivity, null, null
         ) as id`,
        [ctx.matterId, ctx.freya],
      )
    ).rows[0].id;
    const file = (await intent(ctx, ctx.freya, "Police certificate", null, "staff")).rows[0].result;
    await db.query(`select public.attach_upload_to_request($1, $2)`, [file.version_id, staffOnly]);
    await asMaintenance(db);
    const row = await db.query<{ document_id: string }>(`select document_id from public.document_requests where id = $1`, [staffOnly]);
    expect(row.rows[0].document_id).toBe(file.document_id);
  });

  it("leaves the person's own uploads and staff uploads unchanged", async () => {
    const ctx = await firm();
    await request(ctx, ctx.elias);

    await asSponsor(ctx);
    const own = (await intent(ctx, ctx.ingrid, "Sponsor ID", null, "subject")).rows[0].result;
    expect(own.version_id).toBeTruthy();

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const staff = (await intent(ctx, ctx.elias, "Anything staff file", null, "staff")).rows[0].result;
    expect(staff.version_id).toBeTruthy();
    const forFreya = (await intent(ctx, ctx.freya, "Bank statement")).rows[0].result;
    expect(forFreya.version_id).toBeTruthy();
  });
});
