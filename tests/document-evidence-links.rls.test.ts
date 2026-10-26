import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261026100000_document_evidence_links.sql (DOC-06): one verified document on several matters,
// translations, and classification. Synthetic records only.

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function user() {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `u-${tag()}@example.test`]);
  return id;
}

async function staff(userId: string, orgId: string, stepUp = false) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: stepUp ? 0 : 3600 });
}

async function firm() {
  const owner = await user();
  const consultant = await user();
  const assistant = await user();
  const client = await user();
  await asUser(db, { userId: owner, aal: "aal2", orgId: "", totpAgeSeconds: 0 });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  await asMaintenance(db);
  const add = async (userId: string, role: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
        [orgId, userId, role, owner],
      )
    ).rows[0].id;
  const consultantMembership = await add(consultant, "licensed_consultant");
  const assistantMembership = await add(assistant, "assistant");
  await add(client, "client");
  await db.query(`update public.organizations set sample_mode = true where id = $1`, [orgId]);
  const matter = async () => {
    await staff(consultant, orgId);
    const id = (await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership])).rows[0].result.id;
    await asMaintenance(db);
    await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [orgId, id, assistantMembership]);
    return id;
  };
  const first = await matter();
  const second = await matter();
  const unrelated = await matter();
  await asMaintenance(db);
  const personId = (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic Applicant', true, $2) returning id`, [orgId, client])).rows[0].id;
  for (const matterId of [first, second]) {
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, personId]);
  }
  return { orgId, owner, consultant, assistant, client, first, second, unrelated, personId };
}

type Firm = Awaited<ReturnType<typeof firm>>;

/** A document of the person on `matterId`, with one version in the given upload state as its current version. */
async function document(f: Firm, matterId: string, purpose: string, state = "clean") {
  await asMaintenance(db);
  const documentId = (
    await db.query<{ id: string }>(`insert into public.documents (organization_id, person_id, purpose, sensitivity, audience, created_by) values ($1, $2, $3, 'ordinary', 'subject', $4) returning id`, [
      f.orgId,
      f.personId,
      purpose,
      f.client,
    ])
  ).rows[0].id;
  const versionId = (
    await db.query<{ id: string }>(
      `insert into public.document_versions (organization_id, document_id, version_number, storage_key, original_filename, declared_media_type, declared_byte_size, upload_state, intent_expires_at, created_by)
       values ($1, $2, 1, $3, 'file.pdf', 'application/pdf', 1000, $4::public.document_upload_state, now() + interval '1 hour', $5) returning id`,
      [f.orgId, documentId, `${f.orgId}/${randomUUID()}/file.pdf`, state, f.client],
    )
  ).rows[0].id;
  await db.query("begin");
  await db.query(`select app.open_document_write($1)`, [documentId]);
  await db.query(`update public.documents set current_version_id = $2 where id = $1`, [documentId, versionId]);
  await db.query("commit");
  await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by) values ($1, $2, $3, $4)`, [f.orgId, documentId, matterId, f.client]);
  return { documentId, versionId };
}

async function refs(documentId: string) {
  await asMaintenance(db);
  return (await db.query<{ matter_id: string; removed: boolean }>(`select matter_id, removed_at is not null as removed from public.document_matter_refs where document_id = $1 order by created_at`, [documentId])).rows;
}

describe("Evidence on several matters", () => {
  it("uses a checked document on another matter of the same person, once, and removing it there keeps it on the first", async () => {
    const f = await firm();
    const bank = await document(f, f.first, "Bank statement");
    await staff(f.consultant, f.orgId);
    const link = (await db.query<{ id: string }>(`select public.link_document_matter($1, $2) as id`, [bank.documentId, f.second])).rows[0].id;
    expect((await db.query<{ id: string }>(`select public.link_document_matter($1, $2) as id`, [bank.documentId, f.second])).rows[0].id).toBe(link);
    expect(await refs(bank.documentId)).toEqual([
      { matter_id: f.first, removed: false },
      { matter_id: f.second, removed: false },
    ]);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'document.linked'`, [link])).rows).toHaveLength(1);

    // The person isn't on this matter; a file that didn't pass its check can't be reused.
    await staff(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.link_document_matter($1, $2)`, [bank.documentId, f.unrelated]), /not on that matter/);
    const quarantined = await document(f, f.first, "Payslip", "quarantined");
    await staff(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.link_document_matter($1, $2)`, [quarantined.documentId, f.second]), /passed its check/);

    // Removing it from the second matter (step-up) leaves the first link and the file.
    await staff(f.consultant, f.orgId, true);
    await db.query(`select public.unlink_document_matter($1, 'Not needed on this file')`, [link]);
    expect(await refs(bank.documentId)).toEqual([
      { matter_id: f.first, removed: false },
      { matter_id: f.second, removed: true },
    ]);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.documents where id = $1`, [bank.documentId])).rows).toHaveLength(1);
  });

  it("refuses an assistant and the client", async () => {
    const f = await firm();
    const bank = await document(f, f.first, "Bank statement");
    await staff(f.assistant, f.orgId);
    await expectDbError(() => db.query(`select public.link_document_matter($1, $2)`, [bank.documentId, f.second]), /denied/);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.link_document_matter($1, $2)`, [bank.documentId, f.second]), /denied/);
  });
});

describe("Translations and classification", () => {
  it("marks a translation of the same person's original with its language, and clears it", async () => {
    const f = await firm();
    const passport = await document(f, f.first, "Passport bio page");
    const translation = await document(f, f.first, "Passport bio page (English)");
    await staff(f.consultant, f.orgId);
    const at = async (id: string) => (await db.query<{ version: number }>(`select version from public.document_versions where id = $1`, [id])).rows[0].version;
    await expectDbError(() => db.query(`select public.set_document_translation($1, $2, $3, null)`, [translation.versionId, 1, passport.versionId]), /language/);
    await expectDbError(() => db.query(`select public.set_document_translation($1, $2, $3, 'en')`, [translation.versionId, 1, translation.versionId]), /another document/);
    await db.query(`select public.set_document_translation($1, $2, $3, 'en')`, [translation.versionId, await at(translation.versionId), passport.versionId]);
    await asMaintenance(db);
    expect((await db.query(`select translation_of_version_id, language_tag from public.document_versions where id = $1`, [translation.versionId])).rows[0]).toEqual({
      translation_of_version_id: passport.versionId,
      language_tag: "en",
    });
    await staff(f.consultant, f.orgId);
    // The original can't then be marked a translation of its own translation.
    const passportAt = await at(passport.versionId);
    await expectDbError(() => db.query(`select public.set_document_translation($1, $2, $3, 'fr')`, [passport.versionId, passportAt, translation.versionId]), /already a translation/);
    await expectDbError(() => db.query(`select public.set_document_translation($1, 1, null, null)`, [translation.versionId]), /conflict/);
    await db.query(`select public.set_document_translation($1, $2, null, null)`, [translation.versionId, await at(translation.versionId)]);
    await asMaintenance(db);
    expect((await db.query(`select translation_of_version_id, language_tag from public.document_versions where id = $1`, [translation.versionId])).rows[0]).toEqual({ translation_of_version_id: null, language_tag: null });
  });

  it("changes the type freely and the sensitivity only after a step-up, both audited", async () => {
    const f = await firm();
    const doc = await document(f, f.first, "Medical letter");
    const at = async () => {
      await asMaintenance(db);
      return (await db.query<{ version: number }>(`select version from public.documents where id = $1`, [doc.documentId])).rows[0].version;
    };
    let version = await at();
    await staff(f.consultant, f.orgId);
    await db.query(`select public.set_document_classification($1, $2, ' Medical exam letter ', 'ordinary')`, [doc.documentId, version]);
    version = await at();
    await staff(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.set_document_classification($1, $2, 'Medical exam letter', 'medical')`, [doc.documentId, version]), /step-up|denied/);
    await staff(f.consultant, f.orgId, true);
    await db.query(`select public.set_document_classification($1, $2, 'Medical exam letter', 'medical')`, [doc.documentId, version]);
    await asMaintenance(db);
    expect((await db.query(`select purpose, sensitivity::text from public.documents where id = $1`, [doc.documentId])).rows[0]).toEqual({ purpose: "Medical exam letter", sensitivity: "medical" });
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'document.classified'`, [doc.documentId])).rows).toHaveLength(2);
  });
});
