import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, type TestDb } from "./helpers/postgres";

/**
 * The Designer Clients page reads persons, their matter participants and matters as the
 * signed-in staff member and lets RLS (app.can_read_person) decide who is listed. These are
 * the same reads, run as a firm owner, a case manager on one matter, and a case manager on none.
 * "Add a client" goes through create_client_matter, which attaches the creator to the matter.
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

async function verifiedLicence(owner: string, consultant: string, orgId: string, membershipId: string) {
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membershipId, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       $3, $4, false, false, null, $5, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, true, false, PROOF],
  );
}

type Created = { ok: boolean; id: string; applicant_id: string; sponsor_id: string | null };

async function addClient(userId: string, orgId: string, applicant: string, sponsor: string | null, consultant: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const result = await db.query<{ result: Created }>(`select public.create_client_matter($1, $2, $3, $4, $5, $6, $7) as result`, [
    applicant,
    null,
    sponsor,
    null,
    consultant,
    null,
    null,
  ]);
  return result.rows[0].result;
}

/** The Clients page's People tab reads, as `userId`. */
async function clientsPage(userId: string, orgId: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const people = await db.query<{ display_name: string }>(
    `select display_name from public.persons where organization_id = $1 order by display_name`,
    [orgId],
  );
  const parties = await db.query<{ person_id: string; role: string; matter_id: string }>(
    `select person_id, role::text as role, matter_id from public.matter_participants where organization_id = $1 and person_id is not null`,
    [orgId],
  );
  const matters = await db.query<{ id: string }>(`select id from public.matters where organization_id = $1`, [orgId]);
  return { names: people.rows.map((row) => row.display_name), parties: parties.rows, matterIds: matters.rows.map((row) => row.id) };
}

describe("Clients page visibility", () => {
  it("lists only the clients on matters the viewer is assigned to, with those matters", async () => {
    const owner = await createUser(email("owner"));
    const consultant = await createUser(email("consultant"));
    const manager = await createUser(email("manager"));
    const colleague = await createUser(email("colleague"));
    const orgId = await createOrg(owner);
    const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
    await activeMembership(orgId, manager, "case_manager", owner);
    await activeMembership(orgId, colleague, "case_manager", owner);
    await verifiedLicence(owner, consultant, orgId, consultantMembership);
    await asMaintenance(db);
    await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);

    // "Add a client" as the case manager: the client is recorded with a matter the manager is on.
    const mine = await addClient(manager, orgId, "Ana Pereira", "Luis Pereira", consultantMembership);
    // Another client added by the owner, on a matter the case manager is not on.
    const theirs = await addClient(owner, orgId, "Kofi Mensah", null, consultantMembership);
    expect(mine.ok && theirs.ok).toBe(true);
    // The owner who added Kofi is on Kofi's matter (20261018170000), so Kofi stays visible to them.
    await asMaintenance(db);
    const ownerParticipant = await db.query<{ role: string }>(
      `select participant.role::text as role from public.matter_participants participant
       join public.memberships membership on membership.id = participant.membership_id
       where participant.matter_id = $1 and membership.user_id = $2`,
      [theirs.id, owner],
    );
    expect(ownerParticipant.rows).toEqual([{ role: "case_manager" }]);

    // Person access is assignment-based for the owner too (DEC-006): the owner reads every
    // matter but only the people on matters they are assigned to.
    const ownerView = await clientsPage(owner, orgId);
    expect(ownerView.names).toEqual(["Kofi Mensah"]);
    expect(ownerView.matterIds.sort()).toEqual([mine.id, theirs.id].sort());

    const managerView = await clientsPage(manager, orgId);
    expect(managerView.names).toEqual(["Ana Pereira", "Luis Pereira"]);
    expect(managerView.matterIds).toEqual([mine.id]);
    expect(managerView.parties.map((row) => row.role).sort()).toEqual(["applicant", "sponsor"]);
    expect(managerView.parties.every((row) => row.matter_id === mine.id)).toBe(true);

    const colleagueView = await clientsPage(colleague, orgId);
    expect(colleagueView).toEqual({ names: [], parties: [], matterIds: [] });

    // The household grid shows other people's cells only to someone who can read grants.
    await asMaintenance(db);
    await db.query(
      `insert into public.access_grants (organization_id, grantee_person_id, subject_person_id, kind, purpose, created_by)
       values ($1, $2, $3, 'explicit', 'Synthetic: sponsor sees the application', $4)`,
      [orgId, mine.sponsor_id, mine.applicant_id, owner],
    );
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const ownerGrants = await db.query(`select id from public.access_grants where organization_id = $1`, [orgId]);
    expect(ownerGrants.rows).toHaveLength(1);
    await asUser(db, { userId: manager, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const managerGrants = await db.query(`select id from public.access_grants where organization_id = $1`, [orgId]);
    expect(managerGrants.rows).toHaveLength(0);
  });
});
