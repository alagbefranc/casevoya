import { createHash, randomUUID } from "node:crypto";
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
     values ($1, $2, case when $3::boolean then now() else null end, '{}'::jsonb)`,
    [id, address, confirmed],
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

async function insertPerson(
  orgId: string,
  displayName: string,
  options: { userId?: string | null; minor?: boolean } = {},
) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into public.persons (id, organization_id, display_name, date_of_birth, birth_date_precision, user_id)
     values ($1, $2, $3, case when $4::boolean then date '2016-06-15' else null end,
             case when $4::boolean then 'day'::public.date_precision else null end, $5)`,
    [id, orgId, displayName, options.minor ?? false, options.userId ?? null],
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

async function visiblePersonIds() {
  const rows = await db.query<{ id: string }>(`select id from public.persons`);
  return rows.rows.map((row) => row.id);
}

describe("invitations", () => {
  it("stores only a hash, accepts once into an active membership, and rejects reuse, expiry, and the wrong email", async () => {
    const owner = await createUser(email("owner"));
    const orgId = await createOrg(owner);
    const invitedAddress = email("invitee");

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const created = await db.query<{ token: string }>(
      `select public.create_staff_invitation($1, $2, 'assistant'::public.org_role) as token`,
      [orgId, invitedAddress.toUpperCase()],
    );
    const token = created.rows[0].token;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    await asMaintenance(db);
    const stored = await db.query<{ token_hash: string; email: string }>(
      `select token_hash, email from public.invitations where organization_id = $1`,
      [orgId],
    );
    expect(stored.rows[0].email).toBe(invitedAddress);
    expect(stored.rows[0].token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(stored.rows[0].token_hash).not.toBe(token);
    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'invitations' and column_name = 'token'`,
    );
    expect(columns.rows).toHaveLength(0);
    const leaked = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log where diff::text like $1 or context::text like $1`,
      [`%${token}%`],
    );
    expect(countOf(leaked.rows[0].n)).toBe(0);

    await asUser(db, { userId: owner, aal: "aal2", orgId });
    await expectDbError(
      () => db.query(`select token_hash from public.invitations`),
      /permission denied|token_hash/i,
    );

    const invitee = await createUser(invitedAddress);
    await asUser(db, { userId: invitee, aal: "aal1", orgId });
    await expectDbError(() => db.query(`select public.accept_invitation($1)`, [token]), /aal2/);

    await asMaintenance(db);
    const pending = await db.query<{ status: string | null }>(
      `select status::text as status from public.memberships where user_id = $1 and organization_id = $2`,
      [invitee, orgId],
    );
    expect(pending.rows).toHaveLength(0);

    await asUser(db, { userId: invitee, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const accepted = await db.query<{ membership_id: string }>(
      `select public.accept_invitation($1) as membership_id`,
      [token],
    );
    const membershipId = accepted.rows[0].membership_id;

    await asMaintenance(db);
    const membership = await db.query<{ status: string }>(
      `select status::text as status from public.memberships where id = $1`,
      [membershipId],
    );
    expect(membership.rows[0].status).toBe("active");
    const audit = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log
       where organization_id = $1 and action = 'invitation.accepted' and object_id = $2`,
      [orgId, membershipId],
    );
    expect(countOf(audit.rows[0].n)).toBe(1);

    await asUser(db, { userId: invitee, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.accept_invitation($1)`, [token]), /cannot be accepted/);

    const otherAddress = email("other");
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const second = await db.query<{ token: string }>(
      `select public.create_staff_invitation($1, $2, 'case_manager'::public.org_role) as token`,
      [orgId, otherAddress],
    );
    const wrongUser = await createUser(email("wrong"));
    await asUser(db, { userId: wrongUser, aal: "aal2", totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.accept_invitation($1)`, [second.rows[0].token]),
      /cannot be accepted/,
    );
    await asMaintenance(db);
    const unconsumed = await db.query<{ consumed_at: string | null }>(
      `select consumed_at from public.invitations where token_hash = $1`,
      [createHash("sha256").update(second.rows[0].token).digest("hex")],
    );
    expect(unconsumed.rows[0].consumed_at).toBeNull();

    const staleAddress = email("stale");
    const staleToken = "cd".repeat(32);
    await asMaintenance(db);
    await db.query(
      `insert into public.invitations (organization_id, email, role, token_hash, expires_at, created_at, created_by)
       values ($1, $2, 'assistant', $3, now() - interval '1 minute', now() - interval '2 days', $4)`,
      [orgId, staleAddress, createHash("sha256").update(staleToken).digest("hex"), owner],
    );
    const staleUser = await createUser(staleAddress);
    await asUser(db, { userId: staleUser, aal: "aal2", totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.accept_invitation($1)`, [staleToken]), /cannot be accepted/);
    await asMaintenance(db);
    const staleMembership = await db.query(
      `select id from public.memberships where user_id = $1 and organization_id = $2`,
      [staleUser, orgId],
    );
    expect(staleMembership.rows).toHaveLength(0);
  });

  it("requires a recent step-up to invite, and a newer invite revokes the unused one", async () => {
    const owner = await createUser(email("owner"));
    const orgId = await createOrg(owner);
    const address = email("pending");
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 20 * 60 });
    await expectDbError(
      () => db.query(`select public.create_staff_invitation($1, $2, 'assistant'::public.org_role)`, [orgId, address]),
      /step-up/,
    );

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const first = await db.query<{ token: string }>(
      `select public.create_staff_invitation($1, $2, 'assistant'::public.org_role) as token`,
      [orgId, address],
    );
    const second = await db.query<{ token: string }>(
      `select public.create_staff_invitation($1, $2, 'assistant'::public.org_role) as token`,
      [orgId, address],
    );
    const invitee = await createUser(address);
    await asUser(db, { userId: invitee, aal: "aal2", totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.accept_invitation($1)`, [first.rows[0].token]),
      /cannot be accepted/,
    );
    const accepted = await db.query(`select public.accept_invitation($1)`, [second.rows[0].token]);
    expect(accepted.rows).toHaveLength(1);
  });
});

describe("last firm owner and staff MFA", () => {
  it("refuses to remove or demote the only firm owner, including as the table owner", async () => {
    const owner = await createUser(email("owner"));
    const orgId = await createOrg(owner);
    await asMaintenance(db);
    const membership = await db.query<{ id: string }>(
      `select id from public.memberships where organization_id = $1 and role = 'firm_owner'`,
      [orgId],
    );
    const ownerMembership = membership.rows[0].id;
    await expectDbError(
      () => db.query(`update public.memberships set status = 'revoked' where id = $1`, [ownerMembership]),
      /last firm owner/,
    );
    await expectDbError(
      () => db.query(`update public.memberships set role = 'assistant' where id = $1`, [ownerMembership]),
      /last firm owner/,
    );

    const successor = await createUser(email("successor"));
    await activeMembership(orgId, successor, "firm_owner", owner);
    await asMaintenance(db);
    await db.query(`update public.memberships set status = 'suspended' where id = $1`, [ownerMembership]);
    const status = await db.query<{ status: string }>(
      `select status::text as status from public.memberships where id = $1`,
      [ownerMembership],
    );
    expect(status.rows[0].status).toBe("suspended");

    const remaining = await db.query<{ id: string }>(
      `select id from public.memberships where organization_id = $1 and role = 'firm_owner' and status = 'active'`,
      [orgId],
    );
    await expectDbError(
      () => db.query(`update public.memberships set status = 'revoked' where id = $1`, [remaining.rows[0].id]),
      /last firm owner/,
    );
  });

  it("lets an aal1 staff member see only their own row, and blocks organization creation without aal2", async () => {
    const owner = await createUser(email("owner"));
    const colleague = await createUser(email("colleague"));
    const orgId = await createOrg(owner);
    await activeMembership(orgId, colleague, "case_manager", owner);

    await asUser(db, { userId: owner, aal: "aal1", orgId });
    const own = await db.query<{ user_id: string }>(`select user_id from public.memberships`);
    expect(own.rows.map((row) => row.user_id)).toEqual([owner]);
    const profiles = await db.query<{ id: string }>(`select id from public.profiles where id = $1`, [colleague]);
    expect(profiles.rows).toHaveLength(0);
    const updated = await db.query(
      `update public.organizations set display_name = 'Changed' where id = $1`,
      [orgId],
    );
    expect(updated.affectedRows ?? 0).toBe(0);

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const both = await db.query<{ user_id: string }>(`select user_id from public.memberships`);
    expect(both.rows).toHaveLength(2);
    await db.query(`update public.organizations set display_name = 'Synthetic Firm Renamed' where id = $1`, [orgId]);

    const plain = await createUser(email("plain"));
    await asUser(db, { userId: plain, aal: "aal1" });
    await expectDbError(
      () => db.query(`select public.create_organization($1, $2, $3)`, ["Synthetic Legal Name", "Synthetic Firm", slug()]),
      /aal2/,
    );
  });
});

describe("person, matter and household permissions", () => {
  it("denies cross-tenant, household, payer, and unassigned access, and allows an explicit or guardian grant", async () => {
    const ownerA = await createUser(email("owner-a"));
    const ownerB = await createUser(email("owner-b"));
    const orgA = await createOrg(ownerA);
    const orgB = await createOrg(ownerB);
    const adultAUser = await createUser(email("adult-a"));
    const adultBUser = await createUser(email("adult-b"));
    const guardianUser = await createUser(email("guardian"));
    const sponsorUser = await createUser(email("sponsor"));
    const consultant = await createUser(email("consultant"));
    const assistant = await createUser(email("assistant"));
    const finance = await createUser(email("finance"));

    await activeMembership(orgA, adultAUser, "client", ownerA);
    await activeMembership(orgA, adultBUser, "adult_dependant", ownerA);
    await activeMembership(orgA, guardianUser, "guardian", ownerA);
    await activeMembership(orgA, sponsorUser, "sponsor", ownerA);
    await activeMembership(orgA, consultant, "licensed_consultant", ownerA);
    const assistantMembership = await activeMembership(orgA, assistant, "assistant", ownerA);
    const financeMembership = await activeMembership(orgA, finance, "finance_user", ownerA);

    const adultA = await insertPerson(orgA, "Synthetic Adult A", { userId: adultAUser });
    const adultB = await insertPerson(orgA, "Synthetic Adult B", { userId: adultBUser });
    const minor = await insertPerson(orgA, "Synthetic Minor", { minor: true });
    const guardian = await insertPerson(orgA, "Synthetic Guardian", { userId: guardianUser });
    const sponsor = await insertPerson(orgA, "Synthetic Sponsor", { userId: sponsorUser });
    const otherFirmPerson = await insertPerson(orgB, "Synthetic Other Firm");

    await asMaintenance(db);
    const household = randomUUID();
    await db.query(`insert into public.households (id, organization_id, name) values ($1, $2, 'Synthetic household')`, [
      household,
      orgA,
    ]);
    for (const personId of [adultA, adultB, minor, guardian]) {
      await db.query(
        `insert into public.household_members (organization_id, household_id, person_id) values ($1, $2, $3)`,
        [orgA, household, personId],
      );
    }
    await db.query(
      `insert into public.person_relationships (organization_id, from_person_id, to_person_id, relationship_type)
       values ($1, $2, $3, 'payer')`,
      [orgA, sponsor, adultB],
    );
    const matter = randomUUID();
    const unrelatedMatter = randomUUID();
    await db.query(`insert into public.matters (id, organization_id, title) values ($1, $2, 'Synthetic matter')`, [
      matter,
      orgA,
    ]);
    await db.query(
      `insert into public.matters (id, organization_id, title) values ($1, $2, 'Synthetic unrelated matter')`,
      [unrelatedMatter, orgA],
    );
    await db.query(
      `insert into public.matter_participants (organization_id, matter_id, person_id, role)
       values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor'), ($1, $2, $5, 'guardian')`,
      [orgA, matter, adultB, sponsor, guardian],
    );
    await db.query(
      `insert into public.matter_participants (organization_id, matter_id, membership_id, role)
       values ($1, $2, $3, 'assistant'), ($1, $2, $4, 'assistant')`,
      [orgA, matter, assistantMembership, financeMembership],
    );

    await expectDbError(
      () =>
        db.query(
          `insert into public.household_members (organization_id, household_id, person_id) values ($1, $2, $3)`,
          [orgB, household, otherFirmPerson],
        ),
      /foreign key|violates/,
    );

    await asUser(db, { userId: ownerB, aal: "aal2", orgId: orgA, totpAgeSeconds: 0 });
    expect(await visiblePersonIds()).toEqual([]);
    await asUser(db, { userId: ownerB, aal: "aal2", orgId: orgB, totpAgeSeconds: 0 });
    expect(await visiblePersonIds()).toEqual([]);

    await asUser(db, { userId: adultAUser, aal: "aal1", orgId: orgA });
    expect(await visiblePersonIds()).toEqual([adultA]);
    const householdRows = await db.query(`select id from public.household_members`);
    expect(householdRows.rows).toHaveLength(0);
    const mattersForAdult = await db.query(`select id from public.matters`);
    expect(mattersForAdult.rows).toHaveLength(0);

    await asUser(db, { userId: sponsorUser, aal: "aal1", orgId: orgA });
    expect(await visiblePersonIds()).toEqual([sponsor]);
    const sponsorMatters = await db.query<{ id: string }>(`select id from public.matters`);
    expect(sponsorMatters.rows.map((row) => row.id)).toEqual([matter]);
    const applicantParties = await db.query(`select id from public.matter_participants where person_id = $1`, [adultB]);
    expect(applicantParties.rows).toHaveLength(0);

    await asUser(db, { userId: guardianUser, aal: "aal1", orgId: orgA });
    expect(await visiblePersonIds()).not.toContain(minor);
    expect(await visiblePersonIds()).toEqual([guardian]);

    await asMaintenance(db);
    await expectDbError(
      () =>
        db.query(
          `insert into public.access_grants (organization_id, grantee_person_id, subject_person_id, kind, purpose)
           values ($1, $2, $3, 'guardian', 'Synthetic guardian authority')`,
          [orgA, guardian, adultB],
        ),
      /minor/,
    );
    await db.query(
      `insert into public.access_grants (organization_id, grantee_person_id, subject_person_id, kind, purpose)
       values ($1, $2, $3, 'guardian', 'Synthetic guardian authority')`,
      [orgA, guardian, minor],
    );

    await asUser(db, { userId: guardianUser, aal: "aal1", orgId: orgA });
    const guardianVisible = await visiblePersonIds();
    expect(guardianVisible).toContain(minor);
    expect(guardianVisible).toContain(guardian);
    expect(guardianVisible).not.toContain(adultA);
    expect(guardianVisible).not.toContain(adultB);
    // The guardian is a party on one matter, so that matter is visible. The grant
    // covers a minor who is not a party, so it does not reveal the other matter.
    const guardianMatters = await db.query<{ id: string }>(`select id from public.matters`);
    expect(guardianMatters.rows.map((row) => row.id)).toEqual([matter]);
    expect(guardianMatters.rows.map((row) => row.id)).not.toContain(unrelatedMatter);

    await asMaintenance(db);
    const minorMatter = randomUUID();
    await db.query(
      `insert into public.matters (id, organization_id, title) values ($1, $2, 'Synthetic minor matter')`,
      [minorMatter, orgA],
    );
    await db.query(
      `insert into public.matter_participants (organization_id, matter_id, person_id, role)
       values ($1, $2, $3, 'applicant')`,
      [orgA, minorMatter, minor],
    );
    await asUser(db, { userId: guardianUser, aal: "aal1", orgId: orgA });
    const grantedMatters = await db.query<{ id: string }>(`select id from public.matters`);
    const grantedMatterIds = grantedMatters.rows.map((row) => row.id);
    expect(grantedMatterIds).toEqual(expect.arrayContaining([matter, minorMatter]));
    expect(grantedMatterIds).not.toContain(unrelatedMatter);

    await asMaintenance(db);
    await db.query(
      `update public.persons
       set date_of_birth = (current_date - interval '30 years')::date,
           birth_date_precision = 'day'
       where id = $1`,
      [minor],
    );
    await asUser(db, { userId: guardianUser, aal: "aal1", orgId: orgA });
    expect(await visiblePersonIds()).not.toContain(minor);
    const afterMajority = await db.query<{ id: string }>(`select id from public.matters`);
    const afterMajorityIds = afterMajority.rows.map((row) => row.id);
    expect(afterMajorityIds).toContain(matter);
    expect(afterMajorityIds).not.toContain(minorMatter);

    await asMaintenance(db);
    await db.query(
      `update public.persons
       set date_of_birth = date '2016-06-15',
           birth_date_precision = 'day'
       where id = $1`,
      [minor],
    );
    await db.query(
      `insert into public.access_grants (organization_id, grantee_person_id, subject_person_id, kind, purpose)
       values ($1, $2, $3, 'explicit', 'Synthetic shared record')`,
      [orgA, adultA, adultB],
    );
    await asUser(db, { userId: adultAUser, aal: "aal1", orgId: orgA });
    expect(await visiblePersonIds()).toEqual(expect.arrayContaining([adultA, adultB]));

    await asUser(db, { userId: consultant, aal: "aal2", orgId: orgA, totpAgeSeconds: 0 });
    expect(await visiblePersonIds()).toEqual([]);
    await db.query(
      `insert into public.persons (organization_id, display_name, is_sample) values ($1, 'Synthetic created', true)`,
      [orgA],
    );
    const created = await visiblePersonIds();
    expect(created).toHaveLength(1);

    await asUser(db, { userId: assistant, aal: "aal1", orgId: orgA });
    expect(await visiblePersonIds()).toEqual([]);
    await asUser(db, { userId: assistant, aal: "aal2", orgId: orgA, totpAgeSeconds: 0 });
    expect(await visiblePersonIds()).toContain(adultB);
    expect(await visiblePersonIds()).not.toContain(adultA);

    await asUser(db, { userId: finance, aal: "aal2", orgId: orgA, totpAgeSeconds: 0 });
    expect(await visiblePersonIds()).toEqual([]);

    await asUser(db, { userId: ownerA, aal: "aal2", orgId: orgA, totpAgeSeconds: 0 });
    const ownerVisible = await visiblePersonIds();
    expect(ownerVisible).not.toContain(adultA);
    expect(ownerVisible).not.toContain(adultB);
    expect(ownerVisible).not.toContain(otherFirmPerson);
    const ownerHouseholds = await db.query(`select id from public.households`);
    expect(ownerHouseholds.rows).toHaveLength(1);
  });
});

describe("webhook inbox", () => {
  it("records one row per provider event id and hides it from aal1 staff and other firms", async () => {
    const owner = await createUser(email("owner"));
    const other = await createUser(email("other"));
    const orgId = await createOrg(owner);
    const otherOrg = await createOrg(other);

    await asMaintenance(db);
    const first = await db.query<{ id: string }>(
      `select app.ingest_webhook_event('stripe', 'evt_synthetic_1', 'acct_synthetic', 'payment_intent.succeeded', '{"synthetic":true}'::jsonb, true, $1) as id`,
      [orgId],
    );
    const second = await db.query<{ id: string }>(
      `select app.ingest_webhook_event('stripe', 'evt_synthetic_1', 'acct_synthetic', 'other.event', '{"synthetic":false}'::jsonb, false, $1) as id`,
      [orgId],
    );
    expect(second.rows[0].id).toBe(first.rows[0].id);
    const rows = await db.query<{ n: number; payload: { synthetic: boolean } }>(
      `select count(*)::int as n, (array_agg(payload))[1] as payload
       from public.webhook_inbox where provider = 'stripe' and event_id = 'evt_synthetic_1'`,
    );
    expect(countOf(rows.rows[0].n)).toBe(1);
    expect(rows.rows[0].payload).toEqual({ synthetic: true });
    const otherAccount = await db.query<{ id: string }>(
      `select app.ingest_webhook_event('stripe', 'evt_synthetic_1', 'acct_other', null, '{}'::jsonb, true, $1) as id`,
      [orgId],
    );
    expect(otherAccount.rows[0].id).not.toBe(first.rows[0].id);
    const distinctAccounts = await db.query<{ n: number }>(
      `select count(*)::int as n from public.webhook_inbox where provider = 'stripe' and event_id = 'evt_synthetic_1'`,
    );
    expect(countOf(distinctAccounts.rows[0].n)).toBe(2);

    await asUser(db, { userId: owner, aal: "aal1", orgId });
    const hidden = await db.query(`select id from public.webhook_inbox`);
    expect(hidden.rows).toHaveLength(0);
    await expectDbError(
      () =>
        db.query(
          `insert into public.webhook_inbox (provider, event_id) values ('stripe', 'evt_synthetic_direct')`,
        ),
      /permission denied|row-level security/i,
    );

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const visible = await db.query<{ id: string }>(`select id from public.webhook_inbox`);
    expect(visible.rows.map((row) => row.id).sort()).toEqual(
      [first.rows[0].id, otherAccount.rows[0].id].sort(),
    );

    await asUser(db, { userId: other, aal: "aal2", orgId: otherOrg, totpAgeSeconds: 0 });
    const foreign = await db.query(`select id from public.webhook_inbox`);
    expect(foreign.rows).toHaveLength(0);
  });
});
