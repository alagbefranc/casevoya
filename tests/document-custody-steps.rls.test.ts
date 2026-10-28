import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261024220000_document_custody_steps.sql (DOC-07): an original's custody as steps (received,
// moved, returned, acknowledged), each a new row. Synthetic records only.

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

async function step(f: Firm, userId: string, versionId: string, kind: string, on: string | null, location: string | null, purpose: string | null, recipient: string | null) {
  await staff(userId, f.orgId);
  return (await db.query<{ id: string }>(`select public.record_custody_step($1, $2, $3::date, $4, $5, $6) as id`, [versionId, kind, on, location, purpose, recipient])).rows[0].id;
}

async function events(versionId: string) {
  await asMaintenance(db);
  return (
    await db.query<{ kind: string; received_on: string | null; location: string | null; recipient: string | null; return_on: string | null; acknowledged: boolean }>(
      `select kind, received_on::text, location, recipient, return_on::text, acknowledged_at is not null as acknowledged from public.document_custody_events where version_id = $1 order by created_at, id`,
      [versionId],
    )
  ).rows;
}

describe("Originals we hold", () => {
  it("records an original received, moved, returned and acknowledged, each as its own row", async () => {
    const f = await firm();
    const passport = await document(f, f.first, "Passport");
    await expectDbError(() => step(f, f.consultant, passport.versionId, "moved", null, "Safe B", null, null), /received first/);
    const received = await step(f, f.consultant, passport.versionId, "received", "2026-10-20", "Safe A, drawer 2", "Certified copy for the application", null);
    await expectDbError(() => step(f, f.consultant, passport.versionId, "received", "2026-10-21", "Safe A", "Again", null), /already holds/);
    await expectDbError(() => step(f, f.consultant, passport.versionId, "acknowledged", null, null, null, "Francis"), /return first/);
    await step(f, f.consultant, passport.versionId, "moved", null, "Safe B", null, null);
    await expectDbError(() => step(f, f.consultant, passport.versionId, "returned", "2026-10-24", null, null, null), /who it went back/);
    await step(f, f.consultant, passport.versionId, "returned", "2026-10-24", null, null, "Francis Alagbe");
    await expectDbError(() => step(f, f.consultant, passport.versionId, "moved", null, "Safe C", null, null), /was returned/);
    await step(f, f.consultant, passport.versionId, "acknowledged", null, null, null, "Francis Alagbe");
    await expectDbError(() => step(f, f.consultant, passport.versionId, "acknowledged", null, null, null, "Francis Alagbe"), /already acknowledged/);
    expect(await events(passport.versionId)).toEqual([
      { kind: "received", received_on: "2026-10-20", location: "Safe A, drawer 2", recipient: null, return_on: null, acknowledged: false },
      { kind: "moved", received_on: null, location: "Safe B", recipient: null, return_on: null, acknowledged: false },
      { kind: "returned", received_on: null, location: null, recipient: "Francis Alagbe", return_on: "2026-10-24", acknowledged: false },
      { kind: "acknowledged", received_on: null, location: null, recipient: "Francis Alagbe", return_on: null, acknowledged: true },
    ]);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'document.custody_received'`, [received])).rows).toHaveLength(1);
    // Once returned, the same original can be received again.
    await step(f, f.consultant, passport.versionId, "received", "2026-10-24", "Safe A", "Back for the interview", null);
  });

  it("refuses an assistant, the client, and a step that isn't one", async () => {
    const f = await firm();
    const passport = await document(f, f.first, "Passport");
    await expectDbError(() => step(f, f.assistant, passport.versionId, "received", "2026-10-20", "Safe A", "Held for the file", null), /denied/);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.record_custody_step($1, 'received', '2026-10-20', 'Safe', 'Held for the file', null)`, [passport.versionId]), /denied/);
    await expectDbError(() => step(f, f.consultant, passport.versionId, "lost", null, null, null, null), /custody step/);
  });
});
