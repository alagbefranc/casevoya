import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;

const PROOF = "proof/synthetic-register-capture";

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function collegeId() {
  return `R${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, now(), '{}'::jsonb)`,
    [id, `${label}-${randomUUID().slice(0, 8)}@example.test`],
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

async function ownerMembership(orgId: string, userId: string) {
  await asMaintenance(db);
  const own = await db.query<{ id: string }>(
    `select id from public.memberships where organization_id = $1 and user_id = $2 and role = 'firm_owner'`,
    [orgId, userId],
  );
  return own.rows[0].id;
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
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const row = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membershipId, collegeId(), PROOF],
  );
  return row.rows[0].id;
}

async function setValidUntil(userId: string, orgId: string, credentialId: string, date: string | null, aal = "aal2") {
  await asUser(db, { userId, aal: aal as "aal1" | "aal2", orgId });
  const row = await db.query<{ id: string }>(
    `select public.set_credential_valid_until($1, $2::date) as id`,
    [credentialId, date],
  );
  return row.rows[0].id;
}

async function storedValidUntil(credentialId: string) {
  await asMaintenance(db);
  const row = await db.query<{ valid_until: string | null }>(
    `select valid_until::text as valid_until from public.consultant_credentials where id = $1`,
    [credentialId],
  );
  return row.rows[0]?.valid_until ?? null;
}

async function futureDate(days: number) {
  await asMaintenance(db);
  const row = await db.query<{ d: string }>(`select (current_date + $1::int)::text as d`, [days]);
  return row.rows[0].d;
}

async function firm() {
  const owner = await createUser("owner");
  const orgId = await createOrg(owner);
  const ownerMembershipId = await ownerMembership(orgId, owner);
  const consultant = await createUser("consultant");
  const consultantMembershipId = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  return { owner, orgId, ownerMembershipId, consultant, consultantMembershipId };
}

describe("licence valid-until date", () => {
  it("adds a nullable column without changing the declare signature", async () => {
    const { owner, orgId, ownerMembershipId } = await firm();
    const credentialId = await declareLicence(owner, orgId, ownerMembershipId);
    expect(await storedValidUntil(credentialId)).toBeNull();
  });

  it("lets the holder set their own licence's date, audited", async () => {
    const { orgId, consultant, consultantMembershipId } = await firm();
    const credentialId = await declareLicence(consultant, orgId, consultantMembershipId);
    const date = await futureDate(365);
    expect(await setValidUntil(consultant, orgId, credentialId, date)).toBe(credentialId);
    expect(await storedValidUntil(credentialId)).toBe(date);

    const audit = await db.query<{ action: string; actor_user_id: string; valid_until: string }>(
      `select action, actor_user_id, context ->> 'valid_until' as valid_until
         from public.audit_log
        where object_id = $1 and action = 'licence.valid_until_set'`,
      [credentialId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_user_id).toBe(consultant);
    expect(audit.rows[0].valid_until).toBe(date);
  });

  it("lets a firm owner set it on their own licence and on a consultant's in the same firm", async () => {
    const { owner, orgId, ownerMembershipId, consultant, consultantMembershipId } = await firm();
    const ownCredential = await declareLicence(owner, orgId, ownerMembershipId);
    const date = await futureDate(30);
    await setValidUntil(owner, orgId, ownCredential, date);
    expect(await storedValidUntil(ownCredential)).toBe(date);

    const consultantCredential = await declareLicence(consultant, orgId, consultantMembershipId);
    const later = await futureDate(400);
    await setValidUntil(owner, orgId, consultantCredential, later);
    expect(await storedValidUntil(consultantCredential)).toBe(later);

    // Updating an existing date works, and today is not "in the past".
    const today = await futureDate(0);
    await setValidUntil(owner, orgId, consultantCredential, today);
    expect(await storedValidUntil(consultantCredential)).toBe(today);
  });

  it("denies another consultant in the same firm", async () => {
    const { owner, orgId, ownerMembershipId } = await firm();
    const ownerCredential = await declareLicence(owner, orgId, ownerMembershipId);
    const other = await createUser("other-consultant");
    await activeMembership(orgId, other, "licensed_consultant", owner);
    await expectDbError(
      () => setValidUntil(other, orgId, ownerCredential, "2099-01-01"),
      /licence expiry update denied/,
    );
    expect(await storedValidUntil(ownerCredential)).toBeNull();
  });

  it("denies an owner of a different firm", async () => {
    const { owner, orgId, ownerMembershipId } = await firm();
    const credentialId = await declareLicence(owner, orgId, ownerMembershipId);
    const stranger = await createUser("stranger");
    const strangerOrg = await createOrg(stranger);
    await expectDbError(
      () => setValidUntil(stranger, strangerOrg, credentialId, "2099-01-01"),
      /licence expiry update denied/,
    );
    await expectDbError(
      () => setValidUntil(stranger, orgId, credentialId, "2099-01-01"),
      /licence expiry update denied/,
    );
    expect(await storedValidUntil(credentialId)).toBeNull();
  });

  it("requires two-step sign-in", async () => {
    const { owner, orgId, ownerMembershipId } = await firm();
    const credentialId = await declareLicence(owner, orgId, ownerMembershipId);
    await expectDbError(
      () => setValidUntil(owner, orgId, credentialId, "2099-01-01", "aal1"),
      /two-step sign-in/,
    );
    expect(await storedValidUntil(credentialId)).toBeNull();
  });

  it("rejects a date in the past", async () => {
    const { owner, orgId, ownerMembershipId } = await firm();
    const credentialId = await declareLicence(owner, orgId, ownerMembershipId);
    const yesterday = await futureDate(-1);
    await expectDbError(
      () => setValidUntil(owner, orgId, credentialId, yesterday),
      /licence expiry date is in the past/,
    );
    expect(await storedValidUntil(credentialId)).toBeNull();
  });

  it("is not callable by anon and keeps the column read-only to staff", async () => {
    const { owner, orgId, ownerMembershipId } = await firm();
    const credentialId = await declareLicence(owner, orgId, ownerMembershipId);
    await asAnon(db);
    await expectDbError(
      () => db.query(`select public.set_credential_valid_until($1, '2099-01-01'::date)`, [credentialId]),
      /permission denied/,
    );
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`update public.consultant_credentials set valid_until = '2099-01-01' where id = $1`, [credentialId]),
      /permission denied/,
    );
    expect(await storedValidUntil(credentialId)).toBeNull();
  });
});
