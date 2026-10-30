import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Matter team membership is assignment-based (20261030120000_matter_participants_assignment_lockdown.sql):
 * a staff participant row can only be added by the firm owner, staff already on the matter, or the
 * creator of a matter made in the same transaction; a non-owner attaches only people they can read;
 * participant rows are never re-pointed by a direct update;
 * and only the matter's staff may update public.matters directly. Synthetic people only.
 */
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

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${randomUUID().slice(0, 8)}@example.test`,
  ]);
  return id;
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

const as = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });

async function createMatter(orgId: string, consultantMembership: string, sponsor: string | null = null) {
  const created = await db.query<{ result: { id: string; applicant_id: string; sponsor_id: string | null } }>(
    `select public.create_client_matter('Synthetic Applicant', null, $1, null, $2, null, null) as result`,
    [sponsor, consultantMembership],
  );
  return created.rows[0].result;
}

/** A real firm: owner, verified licensed consultant, two case managers, a portal client on matter A. */
async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  const colleague = await createUser("colleague");
  const client = await createUser("client");
  await as(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const ownerMembership = (
    await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and role = 'firm_owner'`, [orgId])
  ).rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  const colleagueMembership = await activeMembership(orgId, colleague, "case_manager", owner);
  await activeMembership(orgId, client, "client", owner);
  await as(consultant, orgId);
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await as(owner, orgId);
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);

  // Matter A: opened by the consultant; neither case manager is on it.
  await as(consultant, orgId);
  const matterA = await createMatter(orgId, consultantMembership);

  await asMaintenance(db);
  const clientPerson = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, display_name, user_id) values ($1, 'Synthetic Client', $2) returning id`,
    [orgId, client],
  );
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'dependant')`, [
    orgId,
    matterA.id,
    clientPerson.rows[0].id,
  ]);
  return {
    owner,
    consultant,
    manager,
    colleague,
    client,
    orgId,
    ownerMembership,
    consultantMembership,
    managerMembership,
    colleagueMembership,
    matterA: matterA.id,
    applicantA: matterA.applicant_id,
  };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function canSeePerson(f: Firm, userId: string, personId: string) {
  await as(userId, f.orgId);
  const rows = await db.query(`select id from public.persons where id = $1`, [personId]);
  return rows.rows.length === 1;
}

async function matterTitle(matterId: string) {
  await asMaintenance(db);
  return (await db.query<{ title: string }>(`select title from public.matters where id = $1`, [matterId])).rows[0].title;
}

describe("matter_participants: no self-assignment", () => {
  it("a case manager cannot add their own membership to a matter they are not on", async () => {
    const f = await firm();
    expect(await canSeePerson(f, f.manager, f.applicantA)).toBe(false);

    await as(f.manager, f.orgId);
    await expectDbError(
      () =>
        db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [
          f.orgId,
          f.matterA,
          f.managerMembership,
        ]),
      /row-level security/,
    );
    // Nor a colleague, nor a person row (a person they created).
    await expectDbError(
      () =>
        db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [
          f.orgId,
          f.matterA,
          f.colleagueMembership,
        ]),
      /row-level security/,
    );
    const otherPerson = randomUUID();
    await db.query(`insert into public.persons (id, organization_id, display_name) values ($1, $2, 'Synthetic Other')`, [otherPerson, f.orgId]);
    await expectDbError(
      () =>
        db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'sponsor')`, [
          f.orgId,
          f.matterA,
          otherPerson,
        ]),
      /row-level security/,
    );

    expect(await canSeePerson(f, f.manager, f.applicantA)).toBe(false);
    await as(f.manager, f.orgId);
    expect((await db.query(`select id from public.matters where id = $1`, [f.matterA])).rows).toHaveLength(0);
  });

  it("the creator of a matter cannot re-add themselves once taken off it", async () => {
    const f = await firm();
    await as(f.manager, f.orgId);
    const matterB = await createMatter(f.orgId, f.consultantMembership);
    await asMaintenance(db);
    await db.query(`delete from public.matter_participants where matter_id = $1 and membership_id = $2`, [matterB.id, f.managerMembership]);

    await as(f.manager, f.orgId);
    await expectDbError(
      () =>
        db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [
          f.orgId,
          matterB.id,
          f.managerMembership,
        ]),
      /row-level security/,
    );
    await asMaintenance(db);
    const back = await db.query(`select 1 from public.matter_participants where matter_id = $1 and membership_id = $2`, [
      matterB.id,
      f.managerMembership,
    ]);
    expect(back.rows).toHaveLength(0);

    // The creator may still attach a person they created to their matter (no person access is gained).
    await as(f.manager, f.orgId);
    const own = randomUUID();
    await db.query(`insert into public.persons (id, organization_id, display_name) values ($1, $2, 'Synthetic Own')`, [own, f.orgId]);
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'dependant')`, [
      f.orgId,
      matterB.id,
      own,
    ]);
  });

  it("staff on a matter cannot attach a person they cannot already read", async () => {
    const f = await firm();
    await as(f.manager, f.orgId);
    const matterB = await createMatter(f.orgId, f.consultantMembership);
    expect(await canSeePerson(f, f.manager, f.applicantA)).toBe(false);

    await as(f.manager, f.orgId);
    await expectDbError(
      () =>
        db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'dependant')`, [
          f.orgId,
          matterB.id,
          f.applicantA,
        ]),
      /row-level security/,
    );
    expect(await canSeePerson(f, f.manager, f.applicantA)).toBe(false);

    // A person they can read (on a matter they are assigned to) may be attached.
    await as(f.manager, f.orgId);
    const matterC = await createMatter(f.orgId, f.consultantMembership);
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'dependant')`, [
      f.orgId,
      matterC.id,
      matterB.applicant_id,
    ]);
  });

  it("a participant row cannot be re-pointed by a direct update, by anyone", async () => {
    const f = await firm();
    await as(f.manager, f.orgId);
    const matterB = await createMatter(f.orgId, f.consultantMembership);

    // Their own row on matter B, moved to matter A.
    await expectDbError(
      () =>
        db.query(`update public.matter_participants set matter_id = $1 where matter_id = $2 and membership_id = $3`, [
          f.matterA,
          matterB.id,
          f.managerMembership,
        ]),
      /permission denied/,
    );
    // Another member's row on matter B, re-pointed to themselves.
    await expectDbError(
      () =>
        db.query(`update public.matter_participants set membership_id = $1 where matter_id = $2 and membership_id = $3`, [
          f.colleagueMembership,
          matterB.id,
          f.consultantMembership,
        ]),
      /permission denied/,
    );
    await as(f.owner, f.orgId);
    await expectDbError(
      () => db.query(`update public.matter_participants set person_id = person_id where matter_id = $1`, [f.matterA]),
      /permission denied/,
    );

    await asMaintenance(db);
    const onA = await db.query(`select 1 from public.matter_participants where matter_id = $1 and membership_id = $2`, [
      f.matterA,
      f.managerMembership,
    ]);
    expect(onA.rows).toHaveLength(0);
    expect(await canSeePerson(f, f.manager, f.applicantA)).toBe(false);
  });

  it("create_client_matter still puts the consultant, the people and the creator on the new matter", async () => {
    const f = await firm();
    await as(f.manager, f.orgId);
    const matterB = await createMatter(f.orgId, f.consultantMembership, "Synthetic Sponsor");

    await asMaintenance(db);
    const parties = await db.query<{ role: string; membership_id: string | null; person_id: string | null }>(
      `select role::text as role, membership_id, person_id from public.matter_participants where matter_id = $1 order by role`,
      [matterB.id],
    );
    expect(parties.rows).toEqual(
      expect.arrayContaining([
        { role: "consultant", membership_id: f.consultantMembership, person_id: null },
        { role: "case_manager", membership_id: f.managerMembership, person_id: null },
        { role: "applicant", membership_id: null, person_id: matterB.applicant_id },
        { role: "sponsor", membership_id: null, person_id: matterB.sponsor_id },
      ]),
    );
    expect(parties.rows).toHaveLength(4);
    expect(await canSeePerson(f, f.manager, matterB.applicant_id)).toBe(true);

    // Staff on the matter may add a colleague; the colleague then sees the matter's people.
    expect(await canSeePerson(f, f.colleague, matterB.applicant_id)).toBe(false);
    await as(f.manager, f.orgId);
    await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [
      f.orgId,
      matterB.id,
      f.colleagueMembership,
    ]);
    expect(await canSeePerson(f, f.colleague, matterB.applicant_id)).toBe(true);

    // The firm owner may join any matter's team (audited).
    await as(f.owner, f.orgId);
    await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [
      f.orgId,
      f.matterA,
      f.ownerMembership,
    ]);
    await asMaintenance(db);
    const audited = await db.query(
      `select 1 from public.audit_log where organization_id = $1 and object_table = 'public.matter_participants' and actor_user_id = $2`,
      [f.orgId, f.owner],
    );
    expect(audited.rows.length).toBeGreaterThan(0);
  });
});

describe("matters: direct updates are staff-only", () => {
  it("a portal client who can read the matter cannot update it", async () => {
    const f = await firm();
    await as(f.client, f.orgId);
    expect((await db.query(`select id from public.matters where id = $1`, [f.matterA])).rows).toHaveLength(1);
    const updated = await db.query(`update public.matters set title = 'Changed by client' where id = $1 returning id`, [f.matterA]);
    expect(updated.rows).toHaveLength(0);
    expect(await matterTitle(f.matterA)).toBe("Synthetic Applicant");
  });

  it("the matter's staff and the owner can still update it; unassigned staff cannot", async () => {
    const f = await firm();
    await as(f.consultant, f.orgId);
    const byConsultant = await db.query(`update public.matters set title = 'Renamed by consultant' where id = $1 returning id`, [f.matterA]);
    expect(byConsultant.rows).toHaveLength(1);
    expect(await matterTitle(f.matterA)).toBe("Renamed by consultant");

    await as(f.owner, f.orgId);
    const byOwner = await db.query(`update public.matters set title = 'Renamed by owner' where id = $1 returning id`, [f.matterA]);
    expect(byOwner.rows).toHaveLength(1);

    await as(f.manager, f.orgId);
    const byOutsider = await db.query(`update public.matters set title = 'Renamed by outsider' where id = $1 returning id`, [f.matterA]);
    expect(byOutsider.rows).toHaveLength(0);
    expect(await matterTitle(f.matterA)).toBe("Renamed by owner");
  });
});
