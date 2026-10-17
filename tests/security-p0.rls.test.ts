import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asAnon,
  asMaintenance,
  asServiceRole,
  asUser,
  countOf,
  createTestDb,
  expectDbError,
  type TestDb,
} from "./helpers/postgres";

// Runs every migration with Supabase's hosted default privileges emulated, so a
// table or function that never revoked them keeps anon/authenticated ALL here too.
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const PDF_TYPE = "application/pdf";
const SHA = "b".repeat(64);
const EMAIL_TABLES = [
  "email_deliveries",
  "email_suppressions",
  "matter_reply_addresses",
  "inbound_emails",
  "inbound_inbox_items",
  "inbound_attachment_files",
  "email_inbound_windows",
] as const;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
  // Hosted storage.objects has row level security; the harness stub does not.
  // Enabling it here (test database only) exercises the documents bucket policies.
  await db.exec(`alter table storage.objects enable row level security`);
}, 180_000);

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
  const orgId = await createOrg(owner);
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const clientMembership = await activeMembership(orgId, client, "client", owner);
  await activeMembership(orgId, sponsor, "sponsor", owner);
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
  const matter = await db.query<{ result: { id: string } }>(
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
  return {
    owner,
    consultant,
    client,
    sponsor,
    orgId,
    consultantMembership,
    clientMembership,
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

type Firm = Awaited<ReturnType<typeof firm>>;

async function uploadIntent(ctx: Firm, filename: string, size: number) {
  await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
  const intent = await db.query<{ result: { version_id: string; storage_key: string; document_id: string } }>(
    `select public.create_upload_intent(
       $1, $2, $3, $4, 'Passport bio page', 'ordinary', 'subject', null, null, null
     ) as result`,
    [ctx.matterId, ctx.applicant, filename, size],
  );
  return intent.rows[0].result;
}

/** Marks a version clean through the document write guard, as the table owner. */
async function forceClean(versionId: string) {
  await asMaintenance(db);
  await db.exec(`
    begin;
    select app.open_document_write('${versionId}'::uuid);
    update public.document_versions
      set upload_state = 'clean', scan_result = 'structural_only', detected_media_type = declared_media_type,
          byte_size = declared_byte_size, checksum_sha256 = '${SHA}', completed_at = now()
      where id = '${versionId}'::uuid;
    select app.close_document_write('${versionId}'::uuid);
    commit;
  `);
}

async function visibleObjects(key: string) {
  const rows = await db.query<{ n: number }>(
    `select count(*)::int as n from storage.objects where bucket_id = 'documents' and name = $1`,
    [key],
  );
  return countOf(rows.rows[0].n);
}

describe("H1 organizations are not writable by a plain table UPDATE", () => {
  it("H1: firm owner cannot self-verify, leave sample mode, or forge acceptance by a direct UPDATE", async () => {
    const owner = await createUser(email("owner"));
    const orgId = await createOrg(owner);
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(`update public.organizations set verification_status = 'verified', sample_mode = false where id = $1`, [
          orgId,
        ]),
      /permission denied/,
    );
    await expectDbError(
      () =>
        db.query(
          `update public.organizations set dpa_accepted_at = now(), subscription_terms_accepted_at = now() where id = $1`,
          [orgId],
        ),
      /permission denied/,
    );
    await asMaintenance(db);
    const row = await db.query<{ verification_status: string; sample_mode: boolean; dpa_accepted_at: string | null }>(
      `select verification_status::text as verification_status, sample_mode, dpa_accepted_at
       from public.organizations where id = $1`,
      [orgId],
    );
    expect(row.rows[0]).toMatchObject({ verification_status: "unverified", sample_mode: true, dpa_accepted_at: null });

    // The gated RPC still refuses to leave sample mode for an unverified firm.
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.set_sample_mode(false)`), /./);

    // The definer setup function still records acceptance and other settings.
    await db.query(`select public.save_firm_setup('terms_and_privacy'::public.firm_setup_step, $1::jsonb)`, [
      JSON.stringify({
        subscription_terms_accepted: true,
        dpa_accepted: true,
        privacy_contact_name: "Synthetic Privacy Lead",
        privacy_contact_email: "privacy@example.test",
        dpa_version: "2026-10",
        subscription_terms_version: "2026-10",
      }),
    ]);
    await db.query(`select public.save_firm_setup('jurisdictions'::public.firm_setup_step, '{"codes":["CA"]}'::jsonb)`);
    await db.query(`select public.set_document_upload_limit(1048576)`);
    await asMaintenance(db);
    const accepted = await db.query<{ dpa: boolean; terms: string; limit: number }>(
      `select dpa_accepted_at is not null as dpa, subscription_terms_version as terms, document_max_bytes as limit
       from public.organizations where id = $1`,
      [orgId],
    );
    expect(accepted.rows[0]).toEqual({ dpa: true, terms: "2026-10", limit: 1048576 });

    // Even if UPDATE were re-granted, the trigger rejects protected columns for API roles.
    await asMaintenance(db);
    await db.exec(`grant update on public.organizations to authenticated`);
    try {
      await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
      await expectDbError(
        () => db.query(`update public.organizations set verification_status = 'verified' where id = $1`, [orgId]),
        /organization (status|settings)|go through/,
      );
      await expectDbError(
        () => db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]),
        /organization (status|settings)|go through/,
      );
      await expectDbError(
        () => db.query(`update public.organizations set subscription_terms_version = 'forged' where id = $1`, [orgId]),
        /organization (status|settings)|go through/,
      );
    } finally {
      await asMaintenance(db);
      await db.exec(`revoke update on public.organizations from authenticated`);
    }
  });
});

describe("M4 memberships change only through definer functions", () => {
  it("M4: owner cannot insert, activate, or promote memberships directly; invitations and the last-owner rule still work", async () => {
    const ctx = await firm();
    const stranger = await createUser(email("stranger"));
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(
          `insert into public.memberships (organization_id, user_id, role, status, invited_by, created_by)
           values ($1, $2, 'assistant', 'invited', $3, $3)`,
          [ctx.orgId, stranger, ctx.owner],
        ),
      /permission denied/,
    );
    await expectDbError(
      () => db.query(`update public.memberships set role = 'firm_owner' where id = $1`, [ctx.clientMembership]),
      /permission denied/,
    );

    await asMaintenance(db);
    const invited = await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, invited_by, created_by)
       values ($1, $2, 'assistant', 'invited', $3, $3) returning id`,
      [ctx.orgId, stranger, ctx.owner],
    );
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(`update public.memberships set status = 'active', accepted_at = now() where id = $1`, [
          invited.rows[0].id,
        ]),
      /permission denied/,
    );
    await asMaintenance(db);
    const roles = await db.query<{ role: string; status: string }>(
      `select role::text as role, status::text as status from public.memberships where id in ($1, $2) order by role`,
      [ctx.clientMembership, invited.rows[0].id],
    );
    expect(roles.rows).toEqual([
      { role: "assistant", status: "invited" },
      { role: "client", status: "active" },
    ]);

    // Defence in depth: a re-granted UPDATE still cannot change role or status.
    const other = await createUser(email("other"));
    await db.exec(`grant insert, update on public.memberships to authenticated`);
    try {
      await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
      await expectDbError(
        () => db.query(`update public.memberships set role = 'firm_owner' where id = $1`, [ctx.clientMembership]),
        /membership changes go through/,
      );
      await expectDbError(
        () =>
          db.query(
            `insert into public.memberships (organization_id, user_id, role, status, invited_by, created_by)
             values ($1, $2, 'case_manager', 'invited', $3, $3)`,
            [ctx.orgId, other, ctx.owner],
          ),
        /membership changes go through|permission denied/,
      );
    } finally {
      await asMaintenance(db);
      await db.exec(`revoke insert, update on public.memberships from authenticated`);
    }

    // Staff invitation acceptance (definer) still activates a membership.
    const address = email("invitee");
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const token = await db.query<{ token: string }>(
      `select public.create_staff_invitation($1, $2, 'assistant'::public.org_role) as token`,
      [ctx.orgId, address],
    );
    const invitee = await createUser(address);
    await asUser(db, { userId: invitee, aal: "aal2", totpAgeSeconds: 0 });
    const accepted = await db.query<{ id: string }>(`select public.accept_invitation($1) as id`, [
      token.rows[0].token,
    ]);
    await asMaintenance(db);
    const status = await db.query<{ status: string }>(
      `select status::text as status from public.memberships where id = $1`,
      [accepted.rows[0].id],
    );
    expect(status.rows[0].status).toBe("active");

    // Last-owner rule still holds for the table owner.
    const ownerRow = await db.query<{ id: string }>(
      `select id from public.memberships where organization_id = $1 and role = 'firm_owner'`,
      [ctx.orgId],
    );
    await expectDbError(
      () => db.query(`update public.memberships set status = 'revoked' where id = $1`, [ownerRow.rows[0].id]),
      /last firm owner/,
    );
  });
});

describe("M1 email tables keep only the SELECT their policies intend", () => {
  it("M1: anon and authenticated cannot TRUNCATE or write the seven email tables", async () => {
    for (const table of EMAIL_TABLES) {
      await asMaintenance(db);
      const privileges = await db.query<{ anon_any: boolean; auth_select: boolean; auth_write: boolean }>(
        `select
           has_table_privilege('anon', $1, 'select,insert,update,delete,truncate,references,trigger') as anon_any,
           has_table_privilege('authenticated', $1, 'select') as auth_select,
           has_table_privilege('authenticated', $1, 'insert,update,delete,truncate,references,trigger') as auth_write`,
        [`public.${table}`],
      );
      expect({ table, ...privileges.rows[0] }).toEqual({
        table,
        anon_any: false,
        auth_select: true,
        auth_write: false,
      });
      await asAnon(db);
      await expectDbError(() => db.query(`truncate public.${table} cascade`), /permission denied/);
      const user = await createUser(email("mailer"));
      await asUser(db, { userId: user, aal: "aal2", totpAgeSeconds: 0 });
      await expectDbError(() => db.query(`truncate public.${table} cascade`), /permission denied/);
    }
  });
});

describe("staff-only matter notes and section-less intake answers", () => {
  it("client exposure: participants cannot read engagement, override, or program-change reasons", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    await db.query(
      `insert into public.matter_engagements
         (organization_id, matter_id, scope_summary, status, use_exception, exception_reason, permitted_role,
          consultant_membership_id)
       values ($1, $2, 'Synthetic scope', 'exception', true, 'Staff-only exception reason', 'licensed_consultant', $3)`,
      [ctx.orgId, ctx.matterId, ctx.consultantMembership],
    );
    await db.query(
      `insert into public.matter_stage_overrides (organization_id, matter_id, from_stage, to_stage, reason, permitted_role)
       values ($1, $2, 'engagement_pending', 'intake', 'Staff-only override reason', 'licensed_consultant')`,
      [ctx.orgId, ctx.matterId],
    );

    for (const user of [ctx.client, ctx.sponsor]) {
      await asUser(db, { userId: user, aal: "aal1", orgId: ctx.orgId });
      const matter = await db.query(`select id from public.matters where id = $1`, [ctx.matterId]);
      expect(matter.rows).toHaveLength(1);
      for (const table of ["matter_engagements", "matter_stage_overrides", "matter_program_changes"]) {
        const rows = await db.query(`select id from public.${table} where matter_id = $1`, [ctx.matterId]);
        expect({ table, n: rows.rows.length }).toEqual({ table, n: 0 });
      }
    }

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const engagements = await db.query(`select id from public.matter_engagements where matter_id = $1`, [ctx.matterId]);
    expect(engagements.rows.length).toBeGreaterThan(0);
    const overrides = await db.query(`select id from public.matter_stage_overrides where matter_id = $1`, [ctx.matterId]);
    expect(overrides.rows).toHaveLength(1);

    await asMaintenance(db);
    const restrictive = await db.query<{ tablename: string }>(
      `select tablename from pg_policies
       where schemaname = 'public' and permissive = 'RESTRICTIVE' and cmd = 'SELECT'
         and tablename in ('matter_engagements', 'matter_stage_overrides', 'matter_program_changes')
       order by tablename`,
    );
    expect(restrictive.rows.map((row) => row.tablename)).toEqual([
      "matter_engagements",
      "matter_program_changes",
      "matter_stage_overrides",
    ]);
  });

  it("client exposure: an intake answer without a section is private to the applicant and staff", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    const template = await db.query<{ id: string }>(
      `insert into public.intake_templates (organization_id, stable_key, version_number, locale, title, schema)
       values ($1, 'synthetic_intake', 1, 'en-CA', 'Synthetic intake',
         '{"fields":[{"key":"family_name","type":"text","labels":{"en-CA":"Family name"}},
                     {"key":"household","type":"text","labels":{"en-CA":"Household"},"section_key":"shared_family_record"}]}'::jsonb)
       returning id`,
      [ctx.orgId],
    );
    const response = await db.query<{ id: string }>(
      `insert into public.intake_responses (organization_id, template_id, matter_id, person_id)
       values ($1, $2, $3, $4) returning id`,
      [ctx.orgId, template.rows[0].id, ctx.matterId, ctx.applicant],
    );
    await db.query(
      `insert into public.intake_answer_versions
         (organization_id, response_id, field_key, section_key, presence, raw_value, normalized_value)
       values ($1, $2, 'family_name', null, 'provided', '{"text":"Private"}', '{"text":"Private"}'),
              ($1, $2, 'household', 'shared_family_record', 'provided', '{"text":"Shared"}', '{"text":"Shared"}')`,
      [ctx.orgId, response.rows[0].id],
    );

    const fieldsFor = async (userId: string) => {
      await asUser(db, { userId, aal: "aal1", orgId: ctx.orgId });
      const rows = await db.query<{ field_key: string }>(
        `select field_key from public.intake_answer_versions where response_id = $1 order by field_key`,
        [response.rows[0].id],
      );
      return rows.rows.map((row) => row.field_key);
    };
    expect(await fieldsFor(ctx.sponsor)).toEqual(["household"]);
    expect(await fieldsFor(ctx.client)).toEqual(["family_name", "household"]);
  });
});

describe("documents bucket reads need a fresh download authorization", () => {
  it("storage: a reader cannot read a documents object without authorize_document_download, and the grant expires", async () => {
    const ctx = await firm();
    const intent = await uploadIntent(ctx, "passport.pdf", 40);

    // Upload path: the uploader may insert (and read back) its own object while the intent is open.
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const inserted = await db.query<{ id: string }>(
      `insert into storage.objects (id, bucket_id, name, owner, metadata)
       values ($1, 'documents', $2, $3, '{"size":40}'::jsonb) returning id`,
      [randomUUID(), intent.storage_key, ctx.client],
    );
    expect(inserted.rows).toHaveLength(1);
    await forceClean(intent.version_id);

    // Direct Storage API read without the audited authorization is refused.
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    expect(await visibleObjects(intent.storage_key)).toBe(0);

    const grant = await db.query<{ result: { storage_key: string; seconds: number } }>(
      `select public.authorize_document_download($1) as result`,
      [intent.version_id],
    );
    expect(grant.rows[0].result.seconds).toBe(120);
    expect(await visibleObjects(intent.storage_key)).toBe(1);

    // Another participant without document access gets nothing, even after trying to authorize.
    await asUser(db, { userId: ctx.sponsor, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(
      () => db.query(`select public.authorize_document_download($1)`, [intent.version_id]),
      /download denied/,
    );
    expect(await visibleObjects(intent.storage_key)).toBe(0);

    // The authorization lives as long as the signed URL, then the object is unreadable again.
    await asMaintenance(db);
    await db.query(
      `update app.document_download_grants set expires_at = statement_timestamp() - interval '1 second'
       where version_id = $1`,
      [intent.version_id],
    );
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    expect(await visibleObjects(intent.storage_key)).toBe(0);

    await asMaintenance(db);
    const audits = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log where action = 'document.download' and object_id = $1`,
      [intent.version_id],
    );
    expect(countOf(audits.rows[0].n)).toBe(1);
  });
});

describe("upload completion trusts only server-verified bytes", () => {
  it("upload trust: authenticated callers cannot complete an upload with self-reported header and hash", async () => {
    const ctx = await firm();
    const intent = await uploadIntent(ctx, "passport.pdf", 32);
    await storeObject(intent.storage_key, 32);
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(
      () =>
        db.query(`select public.complete_document_upload($1, $2, $3)`, [
          intent.version_id,
          SHA,
          "255044462d312e340d0a25e2",
        ]),
      /permission denied/,
    );
    await expectDbError(
      () =>
        db.query(`select public.finish_verified_document_upload($1, $2, $3, $4, $5)`, [
          intent.version_id,
          ctx.client,
          SHA,
          32,
          PDF_TYPE,
        ]),
      /permission denied|does not exist/,
    );
    await asMaintenance(db);
    const anonCan = await db.query<{ anon: boolean; auth: boolean; service: boolean }>(
      `select has_function_privilege('anon', 'public.finish_verified_document_upload(uuid,uuid,text,bigint,text)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.finish_verified_document_upload(uuid,uuid,text,bigint,text)', 'execute') as auth,
              has_function_privilege('service_role', 'public.finish_verified_document_upload(uuid,uuid,text,bigint,text)', 'execute') as service`,
    );
    expect(anonCan.rows[0]).toEqual({ anon: false, auth: false, service: true });
  });

  it("upload trust: the service-role completion checks the uploader, size, and verified type", async () => {
    const ctx = await firm();
    const finish = async (versionId: string, actor: string, size: number, type: string | null, sha = SHA) => {
      await asServiceRole(db);
      const result = await db.query<{ result: { upload_state: string; scan_result: string } }>(
        `select public.finish_verified_document_upload($1, $2, $3, $4, $5) as result`,
        [versionId, actor, sha, size, type],
      );
      return result.rows[0].result;
    };

    const wrongActor = await uploadIntent(ctx, "passport.pdf", 32);
    await storeObject(wrongActor.storage_key, 32);
    await asServiceRole(db);
    await expectDbError(
      () =>
        db.query(`select public.finish_verified_document_upload($1, $2, $3, $4, $5)`, [
          wrongActor.version_id,
          ctx.sponsor,
          SHA,
          32,
          PDF_TYPE,
        ]),
      /upload denied/,
    );
    expect(await finish(wrongActor.version_id, ctx.client, 32, PDF_TYPE)).toMatchObject({
      upload_state: "clean",
      scan_result: "structural_only",
    });
    // A second call is idempotent and does not rewrite the stored checksum.
    expect(await finish(wrongActor.version_id, ctx.client, 32, PDF_TYPE, "c".repeat(64))).toMatchObject({
      upload_state: "clean",
    });
    await asMaintenance(db);
    const stored = await db.query<{ checksum_sha256: string; byte_size: string }>(
      `select checksum_sha256, byte_size::text as byte_size from public.document_versions where id = $1`,
      [wrongActor.version_id],
    );
    expect(stored.rows[0]).toEqual({ checksum_sha256: SHA, byte_size: "32" });

    const shortObject = await uploadIntent(ctx, "passport.pdf", 32);
    await storeObject(shortObject.storage_key, 32);
    expect(await finish(shortObject.version_id, ctx.client, 31, PDF_TYPE)).toMatchObject({
      upload_state: "failed",
      scan_result: "size_mismatch",
    });

    const zip = await uploadIntent(ctx, "letter.docx", 32);
    await storeObject(zip.storage_key, 32);
    expect(await finish(zip.version_id, ctx.client, 32, null)).toMatchObject({
      upload_state: "failed",
      scan_result: "unrecognized_type",
    });

    const disguised = await uploadIntent(ctx, "photo.pdf", 32);
    await storeObject(disguised.storage_key, 32);
    expect(await finish(disguised.version_id, ctx.client, 32, "image/jpeg")).toMatchObject({
      upload_state: "quarantined",
      scan_result: "extension_mismatch",
    });

    await asMaintenance(db);
    const audit = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log
       where action = 'document.upload_completed' and object_id = $1 and context ->> 'actor_user_id' = $2`,
      [wrongActor.version_id, ctx.client],
    );
    expect(countOf(audit.rows[0].n)).toBe(1);
    expect(createHash("sha256").update("x").digest("hex")).toHaveLength(64);
  });
});

describe("anon has no usage on the app schema", () => {
  it("app schema: anon cannot use app, and the anon invitation previews still answer", async () => {
    await asMaintenance(db);
    const usage = await db.query<{ usage: boolean }>(`select has_schema_privilege('anon', 'app', 'usage') as usage`);
    expect(usage.rows[0].usage).toBe(false);
    await asAnon(db);
    const token = "ab".repeat(32);
    await db.query(`select public.preview_portal_invitation($1)`, [token]);
    await db.query(`select public.preview_invitation($1)`, [token]);
  });
});
