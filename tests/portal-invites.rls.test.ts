import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asMaintenance,
  asUser,
  countOf,
  createTestDb,
  expectDbError,
  type TestDb,
} from "./helpers/postgres";

let db: TestDb;

const TERMS = "Synthetic portal terms. Fictional firm. Not an immigration rule.";
const PRIVACY = "Synthetic privacy notice. Fictional firm. Not a legal finding.";

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

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

async function createUser(address: string, confirmed = true) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, case when $3 then now() else null end, '{}'::jsonb)`,
    [id, address, confirmed],
  );
  return id;
}

async function createOrg(ownerId: string, name = "Synthetic Firm") {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(
    `select (public.create_organization($1, $2, $3)).id as id`,
    [`${name} Legal`, name, slug()],
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

async function asAnon() {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  await db.query(`select set_config('app.organization_id', '', false)`);
  await db.exec("set role anon");
}

async function publishPolicies(userId: string, orgId: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const terms = await db.query<{ id: string }>(
    `select public.publish_portal_policy('portal_terms', '1', 'Portal terms', $1) as id`,
    [TERMS],
  );
  const privacy = await db.query<{ id: string }>(
    `select public.publish_portal_policy('privacy_notice', '1', 'Privacy information', $1) as id`,
    [PRIVACY],
  );
  return { termsId: terms.rows[0].id, privacyId: privacy.rows[0].id };
}

async function addPerson(
  userId: string,
  orgId: string,
  name: string,
  address: string | null,
  dob: string | null,
  sample: boolean,
) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const id = randomUUID();
  await db.query(
    `insert into public.persons (id, organization_id, display_name, is_sample)
     values ($1, $2, $3, $4)`,
    [id, orgId, name, sample],
  );
  if (address || dob) {
    await asMaintenance(db);
    await db.query(
      `update public.persons
       set email = $2,
           date_of_birth = $3::date,
           birth_date_precision = case when $3::date is null then null else 'day'::public.date_precision end
       where id = $1`,
      [id, address, dob],
    );
  }
  return id;
}

async function addMatter(userId: string, orgId: string, title: string, sample: boolean) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const row = await db.query<{ result: { id: string } }>(
    `select public.create_practice_matter($1, $2) as result`,
    [title, sample],
  );
  return row.rows[0].result.id;
}

async function addParty(userId: string, orgId: string, matterId: string, personId: string, role: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role)
     values ($1, $2, $3, $4::public.matter_party_role)`,
    [orgId, matterId, personId, role],
  );
}

async function addStaffParty(userId: string, orgId: string, matterId: string, membershipId: string, role: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role)
     values ($1, $2, $3, $4::public.matter_party_role)`,
    [orgId, matterId, membershipId, role],
  );
}

type Issued = {
  ok: boolean;
  token?: string;
  invitation_id?: string;
  error?: string;
  blockers?: string[];
  role?: string;
};

async function invite(
  userId: string,
  orgId: string,
  personId: string,
  matterId: string,
  role: string,
  address: string,
  subjects: string[] = [],
) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const row = await db.query<{ result: Issued }>(
    `select public.create_portal_invitation($1, $2, $3::public.org_role, $4, $5::uuid[]) as result`,
    [personId, matterId, role, address, subjects],
  );
  return row.rows[0].result;
}

function acceptPayload(termsId: string, privacyId: string, extra: Record<string, unknown> = {}) {
  return {
    portal_terms_id: termsId,
    privacy_notice_id: privacyId,
    locale: "en-CA",
    email_notices: true,
    sms_notices: false,
    deadline_reminders: true,
    processing_consent: true,
    ...extra,
  };
}

async function firmWithConsultant() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const orgId = await createOrg(owner);
  const membershipId = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  return { owner, consultant, orgId, membershipId };
}

describe("portal invitations", () => {
  it("keeps staff invites staff-only and hides the portal token hash", async () => {
    const { owner, consultant, orgId, membershipId } = await firmWithConsultant();
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.create_staff_invitation($1, $2, 'client'::public.org_role)`, [orgId, email("client")]),
      /staff roles only/,
    );

    const matterId = await addMatter(consultant, orgId, "Fictional sample file", true);
    await addStaffParty(owner, orgId, matterId, membershipId, "consultant");
    const personId = await addPerson(consultant, orgId, "Sample Applicant", null, "1990-04-04", true);
    await addParty(consultant, orgId, matterId, personId, "applicant");
    const issued = await invite(consultant, orgId, personId, matterId, "client", email("sample"));
    expect(issued.ok).toBe(true);

    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select token_hash from public.portal_invitations where id = $1`, [issued.invitation_id]),
      /permission denied/,
    );
    const visible = await db.query<{ id: string }>(
      `select id from public.portal_invitations where id = $1`,
      [issued.invitation_id],
    );
    expect(visible.rows).toHaveLength(1);

    await asMaintenance(db);
    const leaked = await db.query<{ payload: string }>(
      `select payload::text as payload from public.outbox_events
       where event_type = 'portal_invitation.email_requested' and aggregate_id = $1`,
      [issued.invitation_id],
    );
    expect(leaked.rows[0].payload).not.toContain(issued.token);
  });

  it("allows a sample invite while a real client invite stays locked", async () => {
    const { owner, consultant, orgId, membershipId } = await firmWithConsultant();
    const sampleMatter = await addMatter(consultant, orgId, "Fictional sample file", true);
    await addStaffParty(owner, orgId, sampleMatter, membershipId, "consultant");
    const samplePerson = await addPerson(consultant, orgId, "Sample Applicant", null, "1990-04-04", true);
    await addParty(consultant, orgId, sampleMatter, samplePerson, "applicant");

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const locked = await db.query<{ result: { unlocked: boolean } }>(
      `select public.evaluate_real_client_invites($1) as result`,
      [orgId],
    );
    expect(locked.rows[0].result.unlocked).toBe(false);

    const sampleInvite = await invite(consultant, orgId, samplePerson, sampleMatter, "client", email("sample"));
    expect(sampleInvite.ok).toBe(true);
    expect(sampleInvite.token).toMatch(/^[0-9a-f]{64}$/);

    await asMaintenance(db);
    const realMatter = randomUUID();
    const realPerson = randomUUID();
    await db.query(
      `insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Real matter', false)`,
      [realMatter, orgId],
    );
    await db.query(
      `insert into public.persons (id, organization_id, display_name, date_of_birth, birth_date_precision, is_sample)
       values ($1, $2, 'Real Applicant', '1988-01-02', 'day', false)`,
      [realPerson, orgId],
    );
    await addParty(consultant, orgId, realMatter, realPerson, "applicant");
    await addStaffParty(owner, orgId, realMatter, membershipId, "consultant");
    const realInvite = await invite(consultant, orgId, realPerson, realMatter, "client", email("real"));
    expect(realInvite.ok).toBe(false);
    expect(realInvite.error).toBe("real_client_invitations_locked");
    expect(realInvite.blockers).toEqual(
      expect.arrayContaining(["firm_unverified", "licence_not_verified", "sample_step_missing:export"]),
    );
  });

  it("refuses a minor login and records guardian authority only for a minor subject", async () => {
    const { owner, consultant, orgId, membershipId } = await firmWithConsultant();
    const policies = await publishPolicies(owner, orgId);
    const matterId = await addMatter(consultant, orgId, "Fictional family file", true);
    await addStaffParty(owner, orgId, matterId, membershipId, "consultant");
    const minor = await addPerson(consultant, orgId, "Sample Child", null, "2016-06-15", true);
    const guardian = await addPerson(consultant, orgId, "Sample Guardian", null, "1982-03-03", true);
    await addParty(consultant, orgId, matterId, minor, "dependant");
    await addParty(consultant, orgId, matterId, guardian, "guardian");

    const childInvite = await invite(consultant, orgId, minor, matterId, "adult_dependant", email("child"));
    expect(childInvite).toMatchObject({ ok: false, error: "minor_cannot_hold_login" });

    const guardianAddress = email("guardian");
    const issued = await invite(consultant, orgId, guardian, matterId, "guardian", guardianAddress, [minor]);
    expect(issued.ok).toBe(true);

    const guardianUser = await createUser(guardianAddress);
    await asUser(db, { userId: guardianUser, aal: "aal1", orgId });
    const accepted = await db.query<{ result: { ok: boolean; role: string } }>(
      `select public.accept_portal_invitation($1, $2::jsonb) as result`,
      [issued.token, JSON.stringify(acceptPayload(policies.termsId, policies.privacyId))],
    );
    expect(accepted.rows[0].result.ok).toBe(true);
    expect(accepted.rows[0].result.role).toBe("guardian");

    await asMaintenance(db);
    const grants = await db.query<{ kind: string }>(
      `select kind::text as kind from public.access_grants
       where grantee_person_id = $1 and subject_person_id = $2 and revoked_at is null`,
      [guardian, minor],
    );
    expect(grants.rows.map((row) => row.kind)).toEqual(["guardian"]);

    await asUser(db, { userId: guardianUser, aal: "aal1", orgId });
    const second = await db.query<{ result: { ok: boolean; error?: string } }>(
      `select public.accept_portal_invitation($1, $2::jsonb) as result`,
      [issued.token, JSON.stringify(acceptPayload(policies.termsId, policies.privacyId))],
    );
    expect(second.rows[0].result.ok).toBe(false);
  });

  it("expires, revokes, and rate-limits portal invitations", async () => {
    const { owner, consultant, orgId, membershipId } = await firmWithConsultant();
    const matterId = await addMatter(consultant, orgId, "Fictional sample file", true);
    await addStaffParty(owner, orgId, matterId, membershipId, "consultant");
    const personId = await addPerson(consultant, orgId, "Sample Applicant", null, "1991-05-05", true);
    await addParty(consultant, orgId, matterId, personId, "applicant");
    const issued = await invite(consultant, orgId, personId, matterId, "client", email("sample"));
    expect(issued.ok).toBe(true);

    await asMaintenance(db);
    await db.exec(`
      begin;
      set local session_replication_role = replica;
      update public.portal_invitations
         set created_at = statement_timestamp() - interval '8 days',
             expires_at = statement_timestamp() - interval '1 minute'
       where id = '${issued.invitation_id}';
      commit;
    `);
    await asAnon();
    const expired = await db.query<{ result: { status: string } }>(
      `select public.preview_portal_invitation($1) as result`,
      [issued.token],
    );
    expect(expired.rows[0].result.status).toBe("expired");

    const fresh = await invite(consultant, orgId, personId, matterId, "client", email("sample"));
    expect(fresh.ok).toBe(true);
    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const revoked = await db.query<{ result: { ok: boolean } }>(
      `select public.revoke_portal_invitation($1) as result`,
      [fresh.invitation_id],
    );
    expect(revoked.rows[0].result.ok).toBe(true);
    await asAnon();
    const closed = await db.query<{ result: { status: string } }>(
      `select public.preview_portal_invitation($1) as result`,
      [fresh.token],
    );
    expect(closed.rows[0].result.status).toBe("revoked");

    let limited: Issued = { ok: true };
    for (let n = 0; n < 6; n += 1) {
      limited = await invite(consultant, orgId, personId, matterId, "client", email("sample"));
    }
    expect(limited).toMatchObject({ ok: false, error: "rate_limited" });
  });

  it("shares a dependant section with the applicant and not with the sponsor", async () => {
    const { owner, consultant, orgId, membershipId } = await firmWithConsultant();
    const policies = await publishPolicies(owner, orgId);
    const matterId = await addMatter(consultant, orgId, "Fictional family file", true);
    await addStaffParty(owner, orgId, matterId, membershipId, "consultant");
    const applicant = await addPerson(consultant, orgId, "Sample Applicant", null, "1990-04-04", true);
    const dependantAddress = email("dependant");
    const dependant = await addPerson(consultant, orgId, "Sample Adult Dependant", null, "1994-08-08", true);
    const sponsor = await addPerson(consultant, orgId, "Sample Sponsor", null, "1985-02-02", true);
    await addParty(consultant, orgId, matterId, applicant, "applicant");
    await addParty(consultant, orgId, matterId, dependant, "dependant");
    await addParty(consultant, orgId, matterId, sponsor, "sponsor");

    const issued = await invite(consultant, orgId, dependant, matterId, "adult_dependant", dependantAddress);
    expect(issued.ok).toBe(true);
    await asAnon();
    const preview = await db.query<{ result: { status: string; role: string; accept_ready: boolean } }>(
      `select public.preview_portal_invitation($1) as result`,
      [issued.token],
    );
    expect(preview.rows[0].result).toMatchObject({ status: "open", role: "adult_dependant", accept_ready: true });

    const dependantUser = await createUser(dependantAddress);
    await asUser(db, { userId: dependantUser, aal: "aal1", orgId });
    const accepted = await db.query<{ result: { ok: boolean; error?: string } }>(
      `select public.accept_portal_invitation($1, $2::jsonb) as result`,
      [
        issued.token,
        JSON.stringify(acceptPayload(policies.termsId, policies.privacyId, { shares: ["passport_bio"] })),
      ],
    );
    expect(accepted.rows[0].result.ok).toBe(true);

    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(
      `select public.record_person_section($1, $2, 'passport_bio', 'Synthetic passport bio summary')`,
      [dependant, matterId],
    );

    const applicantAddress = email("applicant");
    const sponsorAddress = email("sponsor");
    const applicantIssued = await invite(consultant, orgId, applicant, matterId, "client", applicantAddress);
    const sponsorIssued = await invite(consultant, orgId, sponsor, matterId, "sponsor", sponsorAddress);
    expect(applicantIssued.ok).toBe(true);
    expect(sponsorIssued.ok).toBe(true);
    const applicantUser = await createUser(applicantAddress);
    const sponsorUser = await createUser(sponsorAddress);
    await asUser(db, { userId: applicantUser, aal: "aal1", orgId });
    const applicantAccepted = await db.query<{ result: { ok: boolean; error?: string } }>(
      `select public.accept_portal_invitation($1, $2::jsonb) as result`,
      [applicantIssued.token, JSON.stringify(acceptPayload(policies.termsId, policies.privacyId))],
    );
    expect(applicantAccepted.rows[0].result.ok).toBe(true);
    await asUser(db, { userId: sponsorUser, aal: "aal1", orgId });
    const sponsorAccepted = await db.query<{ result: { ok: boolean; error?: string } }>(
      `select public.accept_portal_invitation($1, $2::jsonb) as result`,
      [sponsorIssued.token, JSON.stringify(acceptPayload(policies.termsId, policies.privacyId))],
    );
    expect(sponsorAccepted.rows[0].result.ok).toBe(true);

    await asUser(db, { userId: applicantUser, aal: "aal1", orgId });
    const shared = await db.query<{ n: number }>(
      `select count(*)::int as n from public.person_section_records
       where person_id = $1 and section_key = 'passport_bio'`,
      [dependant],
    );
    expect(countOf(shared.rows[0].n)).toBe(1);

    await asUser(db, { userId: sponsorUser, aal: "aal1", orgId });
    const hidden = await db.query<{ n: number }>(
      `select count(*)::int as n from public.person_section_records where person_id = $1`,
      [dependant],
    );
    expect(countOf(hidden.rows[0].n)).toBe(0);

    const outsider = await createUser(email("outsider"));
    const otherOrg = await createOrg(outsider, "Other Firm");
    await asUser(db, { userId: outsider, aal: "aal2", orgId: otherOrg, totpAgeSeconds: 0 });
    const isolated = await db.query(`select id from public.portal_invitations`);
    expect(isolated.rows).toHaveLength(0);
  });

  it("requires and records processing consent from clients and sponsors", async () => {
    const { owner, consultant, orgId, membershipId } = await firmWithConsultant();
    const policies = await publishPolicies(owner, orgId);
    const matterId = await addMatter(consultant, orgId, "Fictional consent file", true);
    await addStaffParty(owner, orgId, matterId, membershipId, "consultant");
    const applicant = await addPerson(consultant, orgId, "Sample Applicant", null, "1990-04-04", true);
    const sponsor = await addPerson(consultant, orgId, "Sample Sponsor", null, "1985-02-02", true);
    await addParty(consultant, orgId, matterId, applicant, "applicant");
    await addParty(consultant, orgId, matterId, sponsor, "sponsor");

    for (const [personId, role] of [
      [applicant, "client"],
      [sponsor, "sponsor"],
    ] as const) {
      const address = email(role);
      const issued = await invite(consultant, orgId, personId, matterId, role, address);
      expect(issued.ok).toBe(true);
      const user = await createUser(address);
      await asUser(db, { userId: user, aal: "aal1", orgId });
      const refused = await db.query<{ result: { ok: boolean; error?: string } }>(
        `select public.accept_portal_invitation($1, $2::jsonb) as result`,
        [issued.token, JSON.stringify(acceptPayload(policies.termsId, policies.privacyId, { processing_consent: false }))],
      );
      expect(refused.rows[0].result).toMatchObject({ ok: false, error: "processing_consent_required" });
      const accepted = await db.query<{ result: { ok: boolean; error?: string } }>(
        `select public.accept_portal_invitation($1, $2::jsonb) as result`,
        [issued.token, JSON.stringify(acceptPayload(policies.termsId, policies.privacyId))],
      );
      expect(accepted.rows[0].result.ok).toBe(true);

      await asMaintenance(db);
      const recorded = await db.query<{ n: number }>(
        `select count(*)::int as n from public.consent_records
         where person_id = $1 and invitation_id = $2 and purpose = 'processing' and granted`,
        [personId, issued.invitation_id],
      );
      expect(countOf(recorded.rows[0].n)).toBe(1);
    }
  });
});
