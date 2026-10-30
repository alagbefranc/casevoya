import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * SEC-01 client two-step, part 4 (20261031012000): intake responses and answers, person sections,
 * section shares, access grants, consents, contact preferences, privacy request notices and renewal
 * reminders. A portal person with a verified second factor reaches them only from a session that
 * completed it; a client without a factor keeps working at aal1. Staff are unchanged. Also the
 * per-user upload-intent limit for clients. Synthetic records only.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 12);

const SCHEMA = {
  fields: [
    { key: "full_name", type: "text", labels: { "en-CA": "Full name" }, required: true },
    { key: "family_name", type: "text", labels: { "en-CA": "Family name" }, section_key: "shared_family_record" },
    { key: "passport_number", type: "text", labels: { "en-CA": "Passport number" }, section_key: "passport_bio" },
  ],
};

async function user(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${tag()}@example.test`,
  ]);
  return id;
}

async function replica(run: () => Promise<unknown>) {
  await asMaintenance(db);
  await db.exec("set session_replication_role = replica");
  try {
    await run();
  } finally {
    await db.exec("set session_replication_role = origin");
  }
}

/**
 * A sample-mode firm with a published intake form and one matter. On the matter: a guarded client
 * (verified factor), an open client (no factor) and a minor (no login) whose guardian is the
 * guarded client.
 */
async function firm() {
  const owner = await user("owner");
  const consultant = await user("consultant");
  const manager = await user("manager");
  const guarded = await user("guarded");
  const open = await user("open");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0]
    .id;
  await asMaintenance(db);
  const add = async (userId: string, role: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
        [orgId, userId, role, owner],
      )
    ).rows[0].id;
  const consultantMembership = await add(consultant, "licensed_consultant");
  const managerMembership = await add(manager, "case_manager");
  await add(guarded, "client");
  await add(open, "client");
  await db.query(`update public.organizations set sample_mode = true where id = $1`, [orgId]);
  await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', 'verified')`, [randomUUID(), guarded]);

  await asUser(db, { userId: manager, aal: "aal2", orgId, totpAgeSeconds: 3600 });
  const draft = (
    await db.query<{ saved: { id: string; version: number } }>(`select public.save_intake_draft('background', 'Background questions', $1::jsonb, null, null) as saved`, [
      JSON.stringify(SCHEMA),
    ])
  ).rows[0].saved;
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.publish_intake_draft($1, $2)`, [draft.id, draft.version]);
  const matterId = (await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership]))
    .rows[0].result.id;

  await asMaintenance(db);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [
    orgId,
    matterId,
    managerMembership,
  ]);
  const person = async (name: string, userId: string | null, minor = false) =>
    (
      await db.query<{ id: string }>(
        `insert into public.persons (organization_id, display_name, is_sample, user_id, date_of_birth, birth_date_precision)
         values ($1, $2, true, $3, case when $4::boolean then date '2016-06-15' end, case when $4::boolean then 'day'::public.date_precision end) returning id`,
        [orgId, name, userId, minor],
      )
    ).rows[0].id;
  const guardedPerson = await person("Synthetic Guarded", guarded);
  const openPerson = await person("Synthetic Open", open);
  const minorPerson = await person("Synthetic Minor", null, true);
  for (const [personId, role] of [
    [guardedPerson, "applicant"],
    [openPerson, "sponsor"],
    [minorPerson, "dependant"],
  ]) {
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, $4)`, [orgId, matterId, personId, role]);
  }
  return { orgId, owner, consultant, manager, guarded, open, matterId, templateId: draft.id, consultantMembership, guardedPerson, openPerson, minorPerson };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const asClient = (f: Firm, userId: string, aal: "aal1" | "aal2") =>
  asUser(db, { userId, aal, orgId: f.orgId, ...(aal === "aal2" ? { totpAgeSeconds: 30 } : {}) });
const asManager = (f: Firm) => asUser(db, { userId: f.manager, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 3600 });

async function send(f: Firm, personId: string) {
  await asManager(f);
  return (await db.query<{ sent: { response_id: string } }>(`select public.send_intake_request($1, $2, $3, null, null) as sent`, [f.matterId, personId, f.templateId])).rows[0].sent
    .response_id;
}

async function responseVersion(responseId: string) {
  await asMaintenance(db);
  return (await db.query<{ version: number }>(`select version from public.intake_responses where id = $1`, [responseId])).rows[0].version;
}

/** Saves one answer in the session already set by the caller (the version is read first). */
async function answerAs(setSession: () => Promise<void>, responseId: string, key: string, text: string) {
  const at = await responseVersion(responseId);
  await setSession();
  return (await db.query<{ id: string }>(`select public.save_intake_answer($1, $2, $3, 'provided', $4::jsonb) as id`, [responseId, at, key, JSON.stringify({ text })])).rows[0].id;
}

async function intakeVisible(responseId: string) {
  const count = async (sql: string) => (await db.query<{ n: number }>(sql, [responseId])).rows[0].n;
  return {
    responses: await count(`select count(*)::int as n from public.intake_responses where id = $1`),
    answers: await count(`select count(*)::int as n from public.intake_answer_versions where response_id = $1`),
    requests: await count(`select count(*)::int as n from public.intake_requests where response_id = $1`),
  };
}

const canReadAnswer = async (id: string) => (await db.query<{ ok: boolean }>(`select app.can_read_intake_answer($1) as ok`, [id])).rows[0].ok;

describe("client two-step: intake", () => {
  it("hides and refuses the client's own intake at aal1 for a client with a verified factor", async () => {
    const f = await firm();
    const guardedResponse = await send(f, f.guardedPerson);
    const openResponse = await send(f, f.openPerson);

    await expectDbError(() => answerAs(() => asClient(f, f.guarded, "aal1"), guardedResponse, "full_name", "Synthetic Guarded"), /intake answer denied/);
    await asClient(f, f.guarded, "aal1");
    expect(await intakeVisible(guardedResponse)).toEqual({ responses: 0, answers: 0, requests: 0 });
    await expectDbError(() => db.query(`select public.submit_intake_response($1, 1)`, [guardedResponse]), /intake submit denied/);

    const own = await answerAs(() => asClient(f, f.guarded, "aal2"), guardedResponse, "full_name", "Synthetic Guarded");
    expect(await intakeVisible(guardedResponse)).toEqual({ responses: 1, answers: 1, requests: 1 });
    expect(await canReadAnswer(own)).toBe(true);
    await asClient(f, f.guarded, "aal1");
    expect(await canReadAnswer(own)).toBe(false);

    await answerAs(() => asClient(f, f.open, "aal1"), openResponse, "full_name", "Synthetic Open");
    expect(await intakeVisible(openResponse)).toEqual({ responses: 1, answers: 1, requests: 1 });

    await asManager(f);
    expect(await intakeVisible(guardedResponse)).toEqual({ responses: 1, answers: 1, requests: 1 });
  });

  it("gates the shared-family, section-share and guardian answer paths on the second step", async () => {
    const f = await firm();
    const openResponse = await send(f, f.openPerson);
    const minorResponse = await send(f, f.minorPerson);
    const family = await answerAs(() => asClient(f, f.open, "aal1"), openResponse, "family_name", "Synthetic Family");
    const passport = await answerAs(() => asClient(f, f.open, "aal1"), openResponse, "passport_number", "X0000000");
    const minorAnswer = await answerAs(() => asManager(f), minorResponse, "full_name", "Synthetic Minor");

    await replica(async () => {
      const consent = await db.query<{ id: string }>(
        `insert into public.consent_records (organization_id, person_id, purpose, statement_text, statement_sha256, granted)
         values ($1, $2, 'share_section', 'Share my passport section', repeat('b', 64), true) returning id`,
        [f.orgId, f.openPerson],
      );
      await db.query(
        `insert into public.section_shares (organization_id, subject_person_id, grantee_person_id, matter_id, section_key, consent_record_id)
         values ($1, $2, $3, $4, 'passport_bio', $5)`,
        [f.orgId, f.openPerson, f.guardedPerson, f.matterId, consent.rows[0].id],
      );
      await db.query(
        `insert into public.access_grants (organization_id, grantee_person_id, subject_person_id, kind, purpose) values ($1, $2, $3, 'guardian', 'Synthetic guardian')`,
        [f.orgId, f.guardedPerson, f.minorPerson],
      );
    });

    await asClient(f, f.guarded, "aal1");
    expect([await canReadAnswer(family), await canReadAnswer(passport), await canReadAnswer(minorAnswer)]).toEqual([false, false, false]);

    await asClient(f, f.guarded, "aal2");
    expect([await canReadAnswer(family), await canReadAnswer(passport), await canReadAnswer(minorAnswer)]).toEqual([true, true, true]);

    // The open client (no factor) still reads their own answers at aal1.
    await asClient(f, f.open, "aal1");
    expect([await canReadAnswer(family), await canReadAnswer(passport)]).toEqual([true, true]);
  });
});

describe("client two-step: person sections, section shares and access grants", () => {
  it("hides them at aal1 for a client with a verified factor", async () => {
    const f = await firm();
    let grantId = "";
    let explicitGrantId = "";
    await replica(async () => {
      const consent = await db.query<{ id: string }>(
        `insert into public.consent_records (organization_id, person_id, purpose, statement_text, statement_sha256, granted)
         values ($1, $2, 'share_section', 'Share my passport section', repeat('b', 64), true) returning id`,
        [f.orgId, f.openPerson],
      );
      await db.query(
        `insert into public.section_shares (organization_id, subject_person_id, grantee_person_id, matter_id, section_key, consent_record_id)
         values ($1, $2, $3, $4, 'passport_bio', $5)`,
        [f.orgId, f.openPerson, f.guardedPerson, f.matterId, consent.rows[0].id],
      );
      const section = `insert into public.person_section_records (organization_id, person_id, matter_id, section_key, restricted, summary) values ($1, $2, $3, $4::public.person_section_key, $5, 'Synthetic section')`;
      await db.query(section, [f.orgId, f.guardedPerson, f.matterId, "private_record", true]);
      await db.query(section, [f.orgId, f.openPerson, f.matterId, "passport_bio", true]);
      await db.query(section, [f.orgId, f.openPerson, f.matterId, "shared_family_record", false]);
      await db.query(section, [f.orgId, f.minorPerson, f.matterId, "school_transcript", true]);
      grantId = (
        await db.query<{ id: string }>(
          `insert into public.access_grants (organization_id, grantee_person_id, subject_person_id, kind, purpose) values ($1, $2, $3, 'guardian', 'Synthetic guardian') returning id`,
          [f.orgId, f.guardedPerson, f.minorPerson],
        )
      ).rows[0].id;
      explicitGrantId = (
        await db.query<{ id: string }>(
          `insert into public.access_grants (organization_id, grantee_person_id, subject_person_id, kind, purpose) values ($1, $2, $3, 'explicit', 'Synthetic explicit') returning id`,
          [f.orgId, f.openPerson, f.guardedPerson],
        )
      ).rows[0].id;
    });
    const sections = async () =>
      (await db.query<{ section_key: string }>(`select section_key::text from public.person_section_records order by section_key`)).rows.map((row) => row.section_key);
    const shares = async () => (await db.query<{ n: number }>(`select count(*)::int as n from public.section_shares`)).rows[0].n;
    const grants = async () => (await db.query<{ id: string }>(`select id from public.access_grants order by kind`)).rows.map((row) => row.id);
    const canReadGrant = async (id: string) => (await db.query<{ ok: boolean }>(`select app.can_read_grant($1) as ok`, [id])).rows[0].ok;

    await asClient(f, f.guarded, "aal1");
    expect(await sections()).toEqual([]);
    expect(await shares()).toBe(0);
    expect(await grants()).toEqual([]);
    expect([await canReadGrant(grantId), await canReadGrant(explicitGrantId)]).toEqual([false, false]);

    await asClient(f, f.guarded, "aal2");
    expect(await sections()).toEqual(["passport_bio", "school_transcript", "shared_family_record", "private_record"].sort());
    expect(await shares()).toBe(1);
    expect([await canReadGrant(grantId), await canReadGrant(explicitGrantId)]).toEqual([true, true]);

    await asClient(f, f.open, "aal1");
    expect(await sections()).toEqual(["passport_bio", "shared_family_record"]);
    expect(await shares()).toBe(1);
    expect(await canReadGrant(explicitGrantId)).toBe(true);

    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    expect(await canReadGrant(grantId)).toBe(true);
  });
});

describe("client two-step: consents and contact preferences", () => {
  it("hides the client's consent and preference rows and refuses changing a consent at aal1", async () => {
    const f = await firm();
    await replica(async () => {
      for (const personId of [f.guardedPerson, f.openPerson]) {
        await db.query(
          `insert into public.consent_records (organization_id, person_id, purpose, statement_text, statement_sha256, granted)
           values ($1, $2, 'contact_email', 'Email me', repeat('a', 64), true)`,
          [f.orgId, personId],
        );
        await db.query(`insert into public.person_contact_preferences (person_id, organization_id, email_notices) values ($1, $2, true)`, [personId, f.orgId]);
      }
    });
    const consents = async (personId: string) =>
      (await db.query<{ n: number }>(`select count(*)::int as n from public.consent_records where person_id = $1`, [personId])).rows[0].n;
    const prefs = async (personId: string) =>
      (await db.query<{ n: number }>(`select count(*)::int as n from public.person_contact_preferences where person_id = $1`, [personId])).rows[0].n;

    await asClient(f, f.guarded, "aal1");
    expect(await consents(f.guardedPerson)).toBe(0);
    expect(await prefs(f.guardedPerson)).toBe(0);
    await expectDbError(() => db.query(`select public.set_my_consent('marketing', true)`), /two-step sign-in is required/);

    await asClient(f, f.guarded, "aal2");
    expect(await consents(f.guardedPerson)).toBe(1);
    expect(await prefs(f.guardedPerson)).toBe(1);
    const set = await db.query<{ r: { changed: boolean } }>(`select public.set_my_consent('marketing', true) as r`);
    expect(set.rows[0].r.changed).toBe(true);
    expect(await consents(f.guardedPerson)).toBe(2);

    await asClient(f, f.open, "aal1");
    expect(await consents(f.openPerson)).toBe(1);
    expect(await prefs(f.openPerson)).toBe(1);
    const openSet = await db.query<{ r: { changed: boolean } }>(`select public.set_my_consent('marketing', true) as r`);
    expect(openSet.rows[0].r.changed).toBe(true);
  });
});

describe("client two-step: privacy notices and renewal reminders", () => {
  it("returns nothing and records nothing at aal1 for a client with a verified factor", async () => {
    const f = await firm();
    await replica(async () => {
      const ownerMembership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [f.orgId, f.owner])).rows[0].id;
      let n = 0;
      for (const personId of [f.guardedPerson, f.openPerson]) {
        n += 1;
        await db.query(
          `insert into public.privacy_requests (organization_id, number, reference, kind, requester_name, person_id, details, channel, received_on,
             assignee_membership_id, idempotency_key, is_sample, extended_due_on, extension_basis, extension_reason, extended_at, extended_by, extension_notice_channel)
           values ($1, $2, $3, 'access', 'Synthetic requester', $4, 'Wants a copy of their file', 'email', current_date - 2,
             $5, $6, true, current_date + 30, 'firm', 'Synthetic extension reason', now(), $7, 'portal')`,
          [f.orgId, n, `PR-00${n}`, personId, ownerMembership, `pr-${randomUUID()}`, f.owner],
        );
        await db.query(`insert into public.person_contact_preferences (person_id, organization_id, deadline_reminders) values ($1, $2, true)`, [personId, f.orgId]);
        await db.query(
          `insert into public.decision_renewals (organization_id, matter_id, decision_id, document_label, expires_on, remind_on, task_id, owner_membership_id,
             recorded_by_membership_id, client_person_id, service_scope, lead_id, reminder_set_at, reminder_set_by_membership_id)
           values ($1, $2, gen_random_uuid(), 'Synthetic permit', current_date + 200, current_date + 100, gen_random_uuid(), $3,
             $3, $4, 'Synthetic renewal application', gen_random_uuid(), now(), $3)`,
          [f.orgId, f.matterId, f.consultantMembership, personId],
        );
      }
    });
    const privacy = async () => (await db.query<{ r: unknown[] }>(`select public.privacy_requests_for_me($1) as r`, [f.orgId])).rows[0].r.length;
    const seen = async () => (await db.query<{ n: number }>(`select public.mark_privacy_notices_seen($1) as n`, [f.orgId])).rows[0].n;
    const renewals = async () => (await db.query<{ r: unknown[] }>(`select public.portal_renewal_reminders($1) as r`, [f.orgId])).rows[0].r.length;
    const seenAt = async (personId: string) => {
      await asMaintenance(db);
      return (await db.query<{ at: string | null }>(`select extension_notice_seen_at as at from public.privacy_requests where person_id = $1`, [personId])).rows[0].at;
    };

    await asClient(f, f.guarded, "aal1");
    expect(await privacy()).toBe(0);
    expect(await seen()).toBe(0);
    expect(await renewals()).toBe(0);
    expect(await seenAt(f.guardedPerson)).toBeNull();

    await asClient(f, f.guarded, "aal2");
    expect(await privacy()).toBe(1);
    expect(await renewals()).toBe(1);
    expect(await seen()).toBe(1);
    expect(await seenAt(f.guardedPerson)).not.toBeNull();

    await asClient(f, f.open, "aal1");
    expect(await privacy()).toBe(1);
    expect(await renewals()).toBe(1);
    expect(await seen()).toBe(1);
  });
});

describe("upload intents: per-user limit for clients", () => {
  async function priorUploads(f: Firm, userId: string, recent: number, old: number) {
    await replica(async () => {
      const insert = `insert into public.document_versions (organization_id, document_id, version_number, storage_key, original_filename, declared_media_type,
           declared_byte_size, intent_expires_at, created_by, created_at)
         select $1::uuid, gen_random_uuid(), 1, 'synthetic/' || gen_random_uuid()::text, 'prior.pdf', 'application/pdf', 10, now() + interval '1 hour', $2::uuid,
           now() - make_interval(hours => $4::int)
         from generate_series(1, $3::int)`;
      await db.query(insert, [f.orgId, userId, recent, 0]);
      await db.query(insert, [f.orgId, userId, old, 2]);
    });
  }
  const intent = (f: Firm, personId: string) =>
    db.query(`select public.create_upload_intent($1, $2, 'passport.pdf', 40, 'Passport bio page', 'ordinary', 'subject', null, null, null)`, [f.matterId, personId]);

  it("refuses a client's 61st upload intent within an hour; older uploads and staff do not count", async () => {
    const f = await firm();
    await priorUploads(f, f.open, 59, 20);
    await asClient(f, f.open, "aal1");
    await intent(f, f.openPerson);
    await asClient(f, f.open, "aal1");
    await expectDbError(() => intent(f, f.openPerson), /upload rate limit reached/);

    await priorUploads(f, f.manager, 80, 0);
    await asUser(db, { userId: f.manager, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await intent(f, f.openPerson);
  });
});
