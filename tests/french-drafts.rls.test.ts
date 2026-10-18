/**
 * 20261019200000_french_drafts.sql: recipient locale for the mail worker, French review reasons
 * (machine-drafted and human-reviewed), and the "Draft in French" quota.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const SHA = "a".repeat(64);
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

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
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, address]);
  return id;
}

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  return created.rows[0].id;
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

async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const clientEmail = email("client");
  const client = await createUser(clientEmail);
  const sponsor = await createUser(email("sponsor"));
  const finance = await createUser(email("finance"));
  const outsider = await createUser(email("outsider"));
  const orgId = await createOrg(owner);
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  await activeMembership(orgId, finance, "finance_user", owner);
  await activeMembership(orgId, client, "client", owner);
  await activeMembership(orgId, sponsor, "sponsor", owner);
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
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { id: string } }>(
    `select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`,
    [consultantMembership],
  );
  const matterId = matter.rows[0].result.id;
  await db.query(
    `insert into public.persons (organization_id, display_name, is_sample, user_id, email)
     values ($1, 'Synthetic applicant', true, $2, $4), ($1, 'Synthetic sponsor', true, $3, null)`,
    [orgId, client, sponsor, clientEmail],
  );
  const people = await db.query<{ id: string; display_name: string }>(`select id, display_name from public.persons where organization_id = $1`, [orgId]);
  const applicant = people.rows.find((row) => row.display_name === "Synthetic applicant")!.id;
  const sponsorPerson = people.rows.find((row) => row.display_name === "Synthetic sponsor")!.id;
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role)
     values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`,
    [orgId, matterId, applicant, sponsorPerson],
  );
  const otherOrg = await createOrg(outsider);
  return { owner, consultant, client, clientEmail, sponsor, finance, outsider, orgId, otherOrg, matterId, applicant };
}

/** A clean uploaded version from the applicant, ready for review. */
async function uploadedVersion(ctx: Awaited<ReturnType<typeof firm>>) {
  await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
  const intent = await db.query<{ result: { version_id: string; storage_key: string } }>(
    `select public.create_upload_intent($1, $2, 'passport.pdf', 40, 'Passport bio page', 'ordinary', 'subject', null, null, null) as result`,
    [ctx.matterId, ctx.applicant],
  );
  const { version_id: versionId, storage_key: key } = intent.rows[0].result;
  await asMaintenance(db);
  await db.query(`insert into storage.objects (id, bucket_id, name, metadata) values ($1, 'documents', $2, jsonb_build_object('size', 40))`, [randomUUID(), key]);
  await asServiceRole(db);
  await db.query(`select public.finish_verified_document_upload($1, $2, $3, 40, 'application/pdf')`, [versionId, ctx.client, SHA]);
  await asMaintenance(db);
  const row = await db.query<{ version: number }>(`select version from public.document_versions where id = $1`, [versionId]);
  return { versionId, expected: row.rows[0].version };
}

describe("Draft in French quota", () => {
  it("lets staff with MFA draft, refuses everyone else, and rate-limits per staff member", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId });
    const first = await db.query<{ result: { ok: boolean } }>(`select public.consume_translation_draft($1, 120) as result`, [ctx.orgId]);
    expect(first.rows[0].result.ok).toBe(true);

    await asUser(db, { userId: ctx.consultant, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.consume_translation_draft($1, 120)`, [ctx.orgId]), /staff access denied/);
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.consume_translation_draft($1, 120)`, [ctx.orgId]), /staff access denied/);
    await asUser(db, { userId: ctx.finance, aal: "aal2", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.consume_translation_draft($1, 120)`, [ctx.orgId]), /staff access denied/);
    await asUser(db, { userId: ctx.outsider, aal: "aal2", orgId: ctx.otherOrg });
    await expectDbError(() => db.query(`select public.consume_translation_draft($1, 120)`, [ctx.orgId]), /staff access denied/);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.consume_translation_draft($1, 4001)`, [ctx.orgId]), /1 to 4000/);
    for (let i = 1; i < 20; i += 1) await db.query(`select public.consume_translation_draft($1, 10)`, [ctx.orgId]);
    const limited = await db.query<{ result: { ok: boolean; error: string } }>(`select public.consume_translation_draft($1, 10) as result`, [ctx.orgId]);
    expect(limited.rows[0].result).toEqual({ ok: false, error: "rate_limited" });

    // The owner has their own allowance.
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId });
    const owner = await db.query<{ result: { ok: boolean } }>(`select public.consume_translation_draft($1, 10) as result`, [ctx.orgId]);
    expect(owner.rows[0].result.ok).toBe(true);

    // Staff cannot read or forge the counter; it never holds text.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select * from public.translation_draft_requests`), /permission denied/);
    await asMaintenance(db);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'translation_draft_requests'`,
    );
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual(["char_count", "created_at", "id", "organization_id", "user_id"]);
    const audit = await db.query<{ count: string }>(
      `select count(*) from public.audit_log where organization_id = $1 and action = 'i18n.draft_requested'`,
      [ctx.orgId],
    );
    expect(Number(audit.rows[0].count)).toBe(21);
  });
});

describe("French review reasons", () => {
  it("saves a reviewed French reason with the review, shows it to the client, and audits who reviewed it", async () => {
    const ctx = await firm();
    const { versionId, expected } = await uploadedVersion(ctx);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.review_document_version_fr($1, $2, 'changes_requested', 'The photo is blurry.', null, 'La photo est floue.', true, null)`, [versionId, expected]),
      /machine-drafted/,
    );
    await expectDbError(
      () => db.query(`select public.review_document_version_fr($1, $2, 'changes_requested', 'The photo is blurry.', null, ' ', false, null)`, [versionId, expected]),
      /French reason is required/,
    );
    // No step-up: refused like an English-only review, and nothing is written.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId });
    await expectDbError(
      () => db.query(`select public.review_document_version_fr($1, $2, 'changes_requested', 'The photo is blurry.', null, 'La photo est floue.', true, $3)`, [versionId, expected, MODEL]),
      /step-up/,
    );
    // A client cannot review.
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(
      () => db.query(`select public.review_document_version_fr($1, $2, 'changes_requested', 'The photo is blurry.', null, 'La photo est floue.', false, null)`, [versionId, expected]),
      /denied/,
    );

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(
      `select public.review_document_version_fr($1, $2, 'changes_requested', 'The photo is blurry.', null, 'La photo est floue.', true, $3)`,
      [versionId, expected, MODEL],
    );

    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const seen = await db.query<{ reason: string; machine_drafted: boolean; model: string; created_by: string }>(
      `select reason, machine_drafted, model, created_by from public.document_review_translations where version_id = $1`,
      [versionId],
    );
    expect(seen.rows).toEqual([{ reason: "La photo est floue.", machine_drafted: true, model: MODEL, created_by: ctx.consultant }]);

    await asUser(db, { userId: ctx.sponsor, aal: "aal1", orgId: ctx.orgId });
    expect((await db.query(`select id from public.document_review_translations`)).rows).toHaveLength(0);
    await asUser(db, { userId: ctx.outsider, aal: "aal2", orgId: ctx.otherOrg, totpAgeSeconds: 0 });
    expect((await db.query(`select id from public.document_review_translations`)).rows).toHaveLength(0);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`update public.document_review_translations set reason = 'x'`), /permission denied|cannot be deleted/);
    await expectDbError(
      () => db.query(`insert into public.document_review_translations (organization_id, review_id, version_id, language, reason, machine_drafted, created_by) values ($1, $2, $3, 'fr-CA', 'xyz', false, $4)`, [ctx.orgId, randomUUID(), versionId, ctx.consultant]),
      /permission denied/,
    );

    await asMaintenance(db);
    const audit = await db.query<{ context: Record<string, unknown> }>(
      `select context from public.audit_log where organization_id = $1 and action = 'document.review_translated'`,
      [ctx.orgId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].context).toMatchObject({ languages: ["en-CA", "fr-CA"], machine_drafted: true, model: MODEL, reviewed_by: ctx.consultant });
    expect(JSON.stringify(audit.rows[0].context)).not.toContain("floue");
  });
});

describe("email_delivery_locales", () => {
  it("gives the worker each recipient's stored language, English by default", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    const event = await db.query<{ id: string }>(
      `insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
       values ($1, 'document', $2, 'document.request_created', '{}'::jsonb, $3) returning id`,
      [ctx.orgId, randomUUID(), `locale-${randomUUID()}`],
    );
    const insert = async (to: string) =>
      (
        await db.query<{ id: string }>(
          `insert into public.email_deliveries (organization_id, outbox_event_id, recipient_email, template, context)
           values ($1, $2, $3, 'document_request', '{}'::jsonb) returning id`,
          [ctx.orgId, event.rows[0].id, to],
        )
      ).rows[0].id;
    const client = await insert(ctx.clientEmail);
    const stranger = await insert("nobody@example.test");

    await asServiceRole(db);
    const before = await db.query<{ result: Record<string, string> }>(`select public.email_delivery_locales($1::uuid[]) as result`, [[client, stranger]]);
    expect(before.rows[0].result).toEqual({ [client]: "en-CA", [stranger]: "en-CA" });

    await asMaintenance(db);
    await db.query(
      `insert into public.person_contact_preferences (person_id, organization_id, email_notices, sms_notices, deadline_reminders, locale)
       values ($1, $2, true, false, true, 'fr-CA')`,
      [ctx.applicant, ctx.orgId],
    );
    await asServiceRole(db);
    const after = await db.query<{ result: Record<string, string> }>(`select public.email_delivery_locales($1::uuid[]) as result`, [[client, stranger]]);
    expect(after.rows[0].result).toEqual({ [client]: "fr-CA", [stranger]: "en-CA" });

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.email_delivery_locales($1::uuid[])`, [[client]]), /permission denied|worker role required/);
  });
});
