import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { firmDay } from "./helpers/firm-day";
import { asMaintenance, asUser, countOf, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// firm_owner has every staff ability, including regulated actions: owners are regulated
// consultants (decision 2026-10-19, 20261019219000_owner_full_access.sql).
//   * The owner joins the "rows I created" path that licensed consultants and case managers have
//     for people, section records and intake answers.
//   * Person reads stay assignment-based for every role (decision 2026-10-17), MFA still applies,
//     and another firm's owner sees nothing.
//   * An owner with no credential on file does every regulated action a licensed consultant does;
//     the staff directory still says whether a licence is on file.

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

function collegeId() {
  return `R${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
}

async function as(userId: string, orgId: string, aal: "aal1" | "aal2" = "aal2") {
  await asUser(db, aal === "aal2" ? { userId, aal, orgId, totpAgeSeconds: 0 } : { userId, aal, orgId });
}

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, email(label)],
  );
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

async function declareLicence(userId: string, orgId: string, membershipId: string) {
  await as(userId, orgId);
  const row = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membershipId, collegeId(), PROOF],
  );
  return row.rows[0].id;
}

/** A manual register check: active and entitled, so the credential becomes verified. */
async function recordCheck(ownerId: string, orgId: string, credentialId: string) {
  await as(ownerId, orgId);
  await db.query(
    `select public.record_licence_check(
       $1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note'
     )`,
    [credentialId, REGISTER, PROOF],
  );
}

type Firm = {
  orgId: string;
  owner: string;
  ownerMembership: string;
  consultant: string;
  consultantMembership: string;
  manager: string;
  managerMembership: string;
  /** A sample matter the consultant opened; the owner is not on its team. */
  matterId: string;
};

/** A firm whose owner has no licence, or a verified one. The consultant's licence is verified. */
async function firm(ownerLicence: "none" | "verified"): Promise<Firm> {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  await as(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const ownerMembership = (
    await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [
      orgId,
      owner,
    ])
  ).rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  await recordCheck(owner, orgId, await declareLicence(consultant, orgId, consultantMembership));
  if (ownerLicence === "verified") await recordCheck(owner, orgId, await declareLicence(owner, orgId, ownerMembership));

  await as(consultant, orgId);
  const matter = await db.query<{ result: { ok: boolean; id: string } }>(
    `select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`,
    [consultantMembership],
  );
  expect(matter.rows[0].result.ok).toBe(true);
  return {
    orgId,
    owner,
    ownerMembership,
    consultant,
    consultantMembership,
    manager,
    managerMembership,
    matterId: matter.rows[0].result.id,
  };
}

async function ownerOnTeam(ctx: Firm) {
  await asMaintenance(db);
  const row = await db.query<{ n: number }>(
    `select count(*)::int as n from public.matter_participants where matter_id = $1 and membership_id = $2`,
    [ctx.matterId, ctx.ownerMembership],
  );
  return countOf(row.rows[0].n) > 0;
}

/** Inserts a sample person as userId (persons_insert decides; the row is read back separately). */
async function addPerson(userId: string, orgId: string, name: string) {
  const id = randomUUID();
  await as(userId, orgId);
  await db.query(`insert into public.persons (id, organization_id, display_name, is_sample) values ($1, $2, $3, true)`, [
    id,
    orgId,
    name,
  ]);
  return id;
}

async function addApplicant(userId: string, ctx: Firm, personId: string) {
  await as(userId, ctx.orgId);
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`,
    [ctx.orgId, ctx.matterId, personId],
  );
}

async function visiblePeople(userId: string, orgId: string, ids: string[], aal: "aal1" | "aal2" = "aal2") {
  await as(userId, orgId, aal);
  const rows = await db.query<{ id: string }>(`select id from public.persons where id = any ($1::uuid[]) order by id`, [ids]);
  return rows.rows.map((row) => row.id);
}

async function matterVersion(matterId: string) {
  await asMaintenance(db);
  const row = await db.query<{ version: number }>(`select version from public.matters where id = $1`, [matterId]);
  return row.rows[0].version;
}

describe("the owner's own records (creator path)", () => {
  it("lets an owner who is not on the matter read and edit a person they created, and record their sections", async () => {
    const ctx = await firm("none");
    expect(await ownerOnTeam(ctx)).toBe(false);

    // Before 20261019219000 the owner could insert the person but not read or edit it afterwards.
    const mine = await addPerson(ctx.owner, ctx.orgId, "Synthetic Owner Contact");
    expect(await visiblePeople(ctx.owner, ctx.orgId, [mine])).toEqual([mine]);
    await as(ctx.owner, ctx.orgId);
    const edited = await db.query(`update public.persons set display_name = 'Synthetic Owner Contact 2' where id = $1 returning id`, [
      mine,
    ]);
    expect(edited.rows).toHaveLength(1);

    // The person joins the consultant's matter; the owner records a section for the person they created.
    await addApplicant(ctx.consultant, ctx, mine);
    await as(ctx.owner, ctx.orgId);
    const section = await db.query<{ id: string }>(
      `select public.record_person_section($1, $2, 'private_record', 'Synthetic summary') as id`,
      [mine, ctx.matterId],
    );
    const sectionId = section.rows[0].id;
    await as(ctx.owner, ctx.orgId);
    const sections = await db.query(`select id from public.person_section_records where id = $1`, [sectionId]);
    expect(sections.rows).toHaveLength(1);
    await asMaintenance(db);
    const audit = await db.query(
      `select 1 from public.audit_log where object_id = $1 and action = 'person_section.recorded'`,
      [sectionId],
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("lets the owner read back the intake answers they save, but not a colleague's on a matter they are not on", async () => {
    const ctx = await firm("none");
    const mine = await addPerson(ctx.owner, ctx.orgId, "Synthetic Intake Applicant");
    await addApplicant(ctx.consultant, ctx, mine);

    await as(ctx.consultant, ctx.orgId);
    const template = await db.query<{ id: string }>(
      `select public.save_intake_template(
         $1, 'Synthetic intake', 'en-CA', 'unspecified', $2::jsonb, true, $3, null
       ) as id`,
      [
        `intake_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        JSON.stringify({
          fields: [
            { key: "nickname", type: "text", labels: { "en-CA": "Nickname" } },
            { key: "city", type: "text", labels: { "en-CA": "City" } },
          ],
        }),
        firmDay(-1),
      ],
    );
    await as(ctx.consultant, ctx.orgId);
    const response = await db.query<{ id: string }>(`select public.open_intake_response($1, $2, $3) as id`, [
      template.rows[0].id,
      ctx.matterId,
      mine,
    ]);
    const responseId = response.rows[0].id;
    const version = async () => {
      await asMaintenance(db);
      const row = await db.query<{ version: number }>(`select version from public.intake_responses where id = $1`, [responseId]);
      return row.rows[0].version;
    };

    const current = await version();
    await as(ctx.consultant, ctx.orgId);
    await db.query(`select public.save_intake_answer($1, $2, 'city', 'provided', '{"text":"Synthetic City"}'::jsonb)`, [
      responseId,
      current,
    ]);
    const next = await version();
    await as(ctx.owner, ctx.orgId);
    await db.query(`select public.save_intake_answer($1, $2, 'nickname', 'provided', '{"text":"Synthetic"}'::jsonb)`, [
      responseId,
      next,
    ]);

    await as(ctx.owner, ctx.orgId);
    const seen = await db.query<{ field_key: string }>(
      `select field_key from public.intake_answer_versions where response_id = $1 order by field_key`,
      [responseId],
    );
    expect(seen.rows.map((row) => row.field_key)).toEqual(["nickname"]);
  });
});

describe("what stays restricted for the owner", () => {
  it("keeps person reads assignment-based, with MFA, until the owner joins the team (audited)", async () => {
    const ctx = await firm("none");
    const theirs = await addPerson(ctx.consultant, ctx.orgId, "Synthetic Consultant Client");
    await addApplicant(ctx.consultant, ctx, theirs);
    await as(ctx.consultant, ctx.orgId);
    const restricted = await db.query<{ id: string }>(
      `select public.record_person_section($1, $2, 'police_certificate', 'Synthetic restricted') as id`,
      [theirs, ctx.matterId],
    );
    const restrictedId = restricted.rows[0].id;

    // Not on the team: the person and their restricted section stay hidden; no section can be recorded.
    expect(await visiblePeople(ctx.owner, ctx.orgId, [theirs])).toEqual([]);
    await as(ctx.owner, ctx.orgId);
    expect((await db.query(`select id from public.person_section_records where id = $1`, [restrictedId])).rows).toHaveLength(0);
    await as(ctx.owner, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.record_person_section($1, $2, 'private_record', 'Owner')`, [theirs, ctx.matterId]),
      /section record denied/,
    );

    // The owner may join any matter's team; the insert is audited and then the owner reads as staff on it.
    const joinedId = randomUUID();
    await as(ctx.owner, ctx.orgId);
    await db.query(
      `insert into public.matter_participants (id, organization_id, matter_id, membership_id, role)
       values ($1, $2, $3, $4, 'case_manager')`,
      [joinedId, ctx.orgId, ctx.matterId, ctx.ownerMembership],
    );
    await asMaintenance(db);
    const audit = await db.query(`select 1 from public.audit_log where object_id = $1`, [joinedId]);
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(await visiblePeople(ctx.owner, ctx.orgId, [theirs])).toEqual([theirs]);
    await as(ctx.owner, ctx.orgId);
    expect((await db.query(`select id from public.person_section_records where id = $1`, [restrictedId])).rows).toHaveLength(1);

    // MFA still applies: at aal1 the owner sees nobody, not even the person they created.
    const mine = await addPerson(ctx.owner, ctx.orgId, "Synthetic Owner Contact");
    expect(await visiblePeople(ctx.owner, ctx.orgId, [mine, theirs], "aal1")).toEqual([]);
    await as(ctx.owner, ctx.orgId, "aal1");
    await expectDbError(
      () => db.query(`insert into public.persons (organization_id, display_name, is_sample) values ($1, 'Synthetic', true)`, [ctx.orgId]),
      /row-level security|denied|aal2/i,
    );
  });

  it("keeps tenant isolation: another firm's owner neither reads nor writes this firm's people", async () => {
    const ctx = await firm("verified");
    const other = await firm("verified");
    const mine = await addPerson(ctx.owner, ctx.orgId, "Synthetic Owner Contact");
    expect(await visiblePeople(other.owner, other.orgId, [mine])).toEqual([]);
    // Pointing the session at the first firm does not help a non-member.
    expect(await visiblePeople(other.owner, ctx.orgId, [mine])).toEqual([]);
    await as(other.owner, other.orgId);
    await expectDbError(
      () => db.query(`insert into public.persons (organization_id, display_name, is_sample) values ($1, 'Forged', true)`, [ctx.orgId]),
      /row-level security|denied/i,
    );
    await as(other.owner, other.orgId);
    const updated = await db.query(`update public.persons set display_name = 'Forged' where id = $1 returning id`, [mine]);
    expect(updated.rows).toHaveLength(0);
  });
});

describe("regulated actions: the owner acts as a licensed consultant", () => {
  it("lets an owner with or without a credential on file do what a licensed consultant does", async () => {
    for (const licence of ["none", "verified"] as const) {
      const ctx = await firm(licence);

      // Being the responsible consultant.
      const version = await matterVersion(ctx.matterId);
      await as(ctx.owner, ctx.orgId);
      const assigned = await db.query<{ version: number }>(`select public.assign_responsible_consultant($1, $2, $3) as version`, [
        ctx.matterId,
        ctx.ownerMembership,
        version,
      ]);
      expect(countOf(assigned.rows[0].version)).toBeGreaterThan(version);

      // Agreement template approval (legal sign-off of the firm's terms); a case manager is still refused.
      await as(ctx.manager, ctx.orgId);
      const template = await db.query<{ id: string }>(
        `select public.create_agreement_template('service', 'Synthetic template', 'Synthetic body') as id`,
      );
      const templateId = template.rows[0].id;
      await as(ctx.manager, ctx.orgId);
      await expectDbError(() => db.query(`select public.approve_agreement_template($1)`, [templateId]), /staff access denied/);
      await as(ctx.owner, ctx.orgId);
      await db.query(`select public.approve_agreement_template($1)`, [templateId]);
      await asMaintenance(db);
      const approved = await db.query<{ approved_by: string }>(`select approved_by from public.agreement_templates where id = $1`, [
        templateId,
      ]);
      expect(approved.rows[0].approved_by).toBe(ctx.ownerMembership);
      const audit = await db.query(`select 1 from public.audit_log where object_id = $1`, [templateId]);
      expect(audit.rows.length).toBeGreaterThan(0);

      // Confirming a legal date: past the licence gate, a date with no official source stays tentative.
      await as(ctx.consultant, ctx.orgId);
      const deadline = await db.query<{ id: string }>(
        `select public.record_deadline(
           $1, null, 'legal', 'Synthetic legal date', null, null, $2, null,
           'America/Toronto', null, null, null, null, null
         ) as id`,
        [ctx.matterId, firmDay(30)],
      );
      await as(ctx.owner, ctx.orgId);
      await expectDbError(() => db.query(`select public.confirm_deadline($1, 1)`, [deadline.rows[0].id]), /stays tentative/);
      // Step-up still applies.
      await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
      await expectDbError(() => db.query(`select public.confirm_deadline($1, 1)`, [deadline.rows[0].id]), /step-up/);

      // Professional review of a rule version.
      await as(ctx.owner, ctx.orgId);
      const definition = await db.query<{ id: string }>(
        `insert into public.rule_definitions (organization_id, stable_key, category, jurisdiction)
         values ($1, $2, 'immigration_requirement', 'CA') returning id`,
        [ctx.orgId, `CA.FICTIONAL.O${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`],
      );
      const ruleVersion = await db.query<{ id: string }>(
        `insert into public.rule_versions (definition_id, version_number, claim)
         values ($1, 1, 'FICTIONAL fixture. Not an immigration requirement.') returning id`,
        [definition.rows[0].id],
      );
      await as(ctx.owner, ctx.orgId);
      await db.query(
        `insert into public.professional_reviews (
           organization_id, rule_version_id, reviewer_membership_id, decision, decided_at, rationale, rule_content_revision
         ) values ($1, $2, $3, 'approved', '2026-10-16T15:00:00Z', 'FICTIONAL review.', 1)`,
        [ctx.orgId, ruleVersion.rows[0].id, ctx.ownerMembership],
      );

      // The staff directory still says whether a licence is on file.
      await as(ctx.owner, ctx.orgId);
      const directory = await db.query<{ is_licensed: boolean }>(
        `select is_licensed from public.firm_staff_directory($1) where membership_id = $2`,
        [ctx.orgId, ctx.ownerMembership],
      );
      expect(directory.rows[0].is_licensed).toBe(licence === "verified");
    }
  });

  it("keeps the owner inside their own firm", async () => {
    const ctx = await firm("none");
    const other = await firm("verified");
    await as(other.manager, other.orgId);
    const template = await db.query<{ id: string }>(
      `select public.create_agreement_template('service', 'Synthetic template', 'Synthetic body') as id`,
    );
    const templateId = template.rows[0].id;
    // Claiming the other firm as the active workspace without a membership there.
    await as(ctx.owner, other.orgId);
    await expectDbError(() => db.query(`select public.approve_agreement_template($1)`, [templateId]), /staff access denied/);
    // From their own firm, the other firm's template does not exist for them.
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.approve_agreement_template($1)`, [templateId]), /denied/);
    // Naming the other firm's matter or a membership from another firm is refused.
    const version = await matterVersion(other.matterId);
    await as(ctx.owner, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.assign_responsible_consultant($1, $2, $3)`, [other.matterId, ctx.ownerMembership, version]),
      /denied/,
    );
    await asMaintenance(db);
    const status = await db.query<{ status: string }>(`select status::text as status from public.agreement_templates where id = $1`, [
      templateId,
    ]);
    expect(status.rows[0].status).not.toBe("approved");
  });
});
