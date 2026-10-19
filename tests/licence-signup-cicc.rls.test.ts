import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261019221100_licence_at_signup_cicc_list.sql: the licence at sign-up, firms that start live,
// the CICC register list (platform admins only) and the matcher. Synthetic people and synthetic
// list rows only; nothing calls the register.

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const SHA = "a".repeat(64);

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
/** A synthetic number that cannot collide with another test's. */
const licenceNumber = () => `R${tag().slice(0, 8).toUpperCase()}`;

async function as(userId: string, orgId: string, stepUp = true) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: stepUp ? 0 : 3600 });
}

async function createUser(name: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `u-${tag()}@example.test`]);
  await db.query(`update public.profiles set display_name = $2 where id = $1`, [id, name]);
  return id;
}

async function platformAdmin() {
  const id = await createUser("Pat Reviewer");
  await asMaintenance(db);
  await db.query(`insert into public.platform_admins (user_id) values ($1)`, [id]);
  return id;
}

async function signUp(name: string, number: string, klass = "RCIC") {
  const owner = await createUser(name);
  await as(owner, "");
  const created = await db.query<{ id: string; sample_mode: boolean }>(
    `select id, sample_mode from public.create_firm_with_licence($1, $2, $3, 'RCIC'::public.licence_type, $4, $5)`,
    ["Synthetic Legal", "Synthetic Firm", `f${tag()}`, number, klass],
  );
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const credential = await db.query<{ id: string; membership_id: string }>(`select id, membership_id from public.consultant_credentials where organization_id = $1`, [orgId]);
  return { owner, orgId, sampleMode: created.rows[0].sample_mode, credentialId: credential.rows[0]?.id, membershipId: credential.rows[0]?.membership_id };
}

async function blockers(userId: string, orgId: string) {
  await as(userId, orgId);
  const row = await db.query<{ result: { unlocked: boolean; blockers: string[] } }>(`select public.evaluate_real_client_invites($1) as result`, [orgId]);
  return row.rows[0].result;
}

type ListRow = { licence_number: string; full_name?: string; first_name?: string; last_name?: string; status: string; entitlement?: string; licence_class?: string; fields?: Record<string, string> };

/** Imports a list as the service role, naming the platform admin, and returns the finish summary. */
async function importList(adminId: string, rows: ListRow[]) {
  await asServiceRole(db);
  const started = await db.query<{ id: string }>(`select public.start_cicc_register_import($1, null, $2, $3) as id`, ["Synthetic CICC list", SHA, adminId]);
  const importId = started.rows[0].id;
  await db.query(`select public.import_cicc_register($1, $2::jsonb)`, [importId, JSON.stringify(rows)]);
  const finished = await db.query<{ result: Record<string, number | string> }>(`select public.finish_cicc_register_import($1) as result`, [importId]);
  await asMaintenance(db);
  return { importId, summary: finished.rows[0].result };
}

async function credential(id: string) {
  await asMaintenance(db);
  const row = await db.query<{ status: string; verification_method: string | null; verification_status: string }>(
    `select c.status::text, c.verification_method, o.verification_status::text
     from public.consultant_credentials c join public.organizations o on o.id = c.organization_id where c.id = $1`,
    [id],
  );
  return row.rows[0];
}

async function latestCheck(credentialId: string) {
  await asMaintenance(db);
  const row = await db.query<{ method: string; result: string; cicc_import_id: string | null; notes: string | null; source_url: string | null }>(
    `select method, result::text, cicc_import_id, notes, source_url from public.credential_checks where credential_id = $1 order by created_at desc limit 1`,
    [credentialId],
  );
  return row.rows[0];
}

describe("licence at sign-up", () => {
  it("creates the firm live with the owner's declared licence, and real client invitations need no practice steps", async () => {
    const f = await signUp("Amara Osei", licenceNumber(), "RCIC-IRB");
    expect(f.sampleMode).toBe(false);
    const row = await credential(f.credentialId);
    expect(row).toEqual({ status: "declared", verification_method: null, verification_status: "pending_review" });
    await asMaintenance(db);
    const scope = await db.query<{ scope_note: string | null; role: string }>(
      `select c.scope_note, m.role::text from public.consultant_credentials c join public.memberships m on m.id = c.membership_id where c.id = $1`,
      [f.credentialId],
    );
    expect(scope.rows[0]).toEqual({ scope_note: "RCIC-IRB", role: "firm_owner" });
    expect(await blockers(f.owner, f.orgId)).toEqual({ unlocked: true, blockers: [] });
    const proofs = await db.query(`select 1 from public.sample_proof_steps where organization_id = $1`, [f.orgId]);
    expect(proofs.rows).toHaveLength(0);
    await asMaintenance(db);
    const audit = await db.query(`select action from public.audit_log where organization_id = $1 and action in ('licence.declared', 'firm.created')`, [f.orgId]);
    expect(audit.rows).toHaveLength(2);
  });

  it("refuses a missing or unusable licence number, a mismatched class, and a session without two-step sign-in", async () => {
    const owner = await createUser("Lee Park");
    await as(owner, "");
    await expectDbError(() => db.query(`select public.create_firm_with_licence('L', 'D', $1, 'RCIC', '', 'RCIC')`, [`f${tag()}`]), /college id is not usable/);
    await expectDbError(() => db.query(`select public.create_firm_with_licence('L', 'D', $1, 'RCIC', 'R12 34', 'RCIC')`, [`f${tag()}`]), /college id is not usable/);
    await expectDbError(() => db.query(`select public.create_firm_with_licence('L', 'D', $1, 'RISIA', $2, 'RCIC-IRB')`, [`f${tag()}`, licenceNumber()]), /licence class/);
    await asUser(db, { userId: owner, aal: "aal1", orgId: "" });
    await expectDbError(() => db.query(`select public.create_firm_with_licence('L', 'D', $1, 'RCIC', $2, 'RCIC')`, [`f${tag()}`, licenceNumber()]), /two-step|aal2/);
    await asAnon(db);
    await expectDbError(() => db.query(`select public.create_firm_with_licence('L', 'D', $1, 'RCIC', $2, 'RCIC')`, [`f${tag()}`, licenceNumber()]), /permission denied/);
  });

  it("keeps a firm made without a licence locked, and lets an old sample-mode firm switch to live once its licence is declared", async () => {
    const owner = await createUser("Curry Owner");
    await as(owner, "");
    const created = await db.query<{ id: string; sample_mode: boolean }>(`select id, sample_mode from public.create_organization('Curry Legal', 'Curry immigration', $1)`, [`f${tag()}`]);
    const orgId = created.rows[0].id;
    expect(created.rows[0].sample_mode).toBe(true);
    expect(await blockers(owner, orgId)).toEqual({ unlocked: false, blockers: ["owner_licence_missing"] });
    await as(owner, orgId);
    await expectDbError(() => db.query(`select public.set_sample_mode(false)`), /sample mode stays on/);
    await asMaintenance(db);
    const membership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner])).rows[0].id;
    await as(owner, orgId);
    await db.query(`select public.add_consultant_licence($1, 'RCIC', $2)`, [membership, licenceNumber()]);
    expect(await blockers(owner, orgId)).toEqual({ unlocked: true, blockers: [] });
    await as(owner, orgId);
    await db.query(`select public.set_sample_mode(false)`);
    await asMaintenance(db);
    const mode = await db.query<{ sample_mode: boolean }>(`select sample_mode from public.organizations where id = $1`, [orgId]);
    expect(mode.rows[0].sample_mode).toBe(false);
  });

  it("still blocks a revoked licence and an ended trial", async () => {
    const f = await signUp("Noor Haddad", licenceNumber());
    await as(f.owner, f.orgId);
    await db.query(
      `select public.record_licence_check($1, $2, statement_timestamp(), 'active', true, false, true, false, null, $3, null)`,
      [f.credentialId, REGISTER, PROOF],
    );
    expect(await blockers(f.owner, f.orgId)).toEqual({ unlocked: false, blockers: ["owner_licence_blocked"] });

    const g = await signUp("Ines Moreau", licenceNumber());
    await asMaintenance(db);
    await db.query(`update public.organization_subscriptions set status = 'trial_ended' where organization_id = $1`, [g.orgId]);
    expect(await blockers(g.owner, g.orgId)).toEqual({ unlocked: false, blockers: ["trial_ended"] });
  });

  it("attaches an optional proof file afterwards (holder, with a step-up)", async () => {
    const f = await signUp("Dana Proof", licenceNumber());
    await as(f.owner, f.orgId, false);
    await expectDbError(() => db.query(`select public.set_credential_proof($1, 'x/y.pdf')`, [f.credentialId]), /step-up/);
    await as(f.owner, f.orgId);
    await db.query(`select public.set_credential_proof($1, $2)`, [f.credentialId, `${f.orgId}/${f.membershipId}/proof.pdf`]);
    await asMaintenance(db);
    const row = await db.query<{ proof_locator: string }>(`select proof_locator from public.consultant_credentials where id = $1`, [f.credentialId]);
    expect(row.rows[0].proof_locator).toBe(`${f.orgId}/${f.membershipId}/proof.pdf`);
    const other = await signUp("Other Firm", licenceNumber());
    await as(other.owner, other.orgId);
    await expectDbError(() => db.query(`select public.set_credential_proof($1, 'x/y.pdf')`, [f.credentialId]), /denied/);
  });
});

describe("the CICC register list", () => {
  it("is readable by platform admins only: no firm staff, no anonymous caller", async () => {
    const admin = await platformAdmin();
    const f = await signUp("Kim Reader", licenceNumber());
    await importList(admin, [{ licence_number: "R0000001", full_name: "Someone Synthetic", status: "Active" }]);

    await as(f.owner, f.orgId);
    expect((await db.query(`select * from public.cicc_register_entries`)).rows).toHaveLength(0);
    expect((await db.query(`select * from public.cicc_register_imports`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select * from public.cicc_needs_review_credentials()`), /denied/);
    await expectDbError(() => db.query(`select public.start_cicc_register_import('x', null, $1, null)`, [SHA]), /denied/);
    await expectDbError(() => db.query(`select public.check_licence_against_cicc_list($1)`, [f.credentialId]), /denied/);
    await asAnon(db);
    await expectDbError(() => db.query(`select * from public.cicc_register_entries`), /permission denied/);

    await asUser(db, { userId: admin, aal: "aal2", totpAgeSeconds: 0 });
    expect((await db.query(`select * from public.cicc_register_entries where licence_number = 'R0000001'`)).rows.length).toBeGreaterThan(0);
    // Without two-step sign-in a platform admin is not one.
    await asUser(db, { userId: admin, aal: "aal1" });
    expect((await db.query(`select * from public.cicc_register_entries`)).rows).toHaveLength(0);
  });

  it("refuses an import without a platform admin named, and a closed import", async () => {
    const admin = await platformAdmin();
    const stranger = await createUser("Not Admin");
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.start_cicc_register_import('x', null, $1, $2)`, [SHA, stranger]), /platform admin/);
    await expectDbError(() => db.query(`select public.start_cicc_register_import('x', null, null, $1)`, [admin]), /locator or its sha256/);
    const { importId } = await importList(admin, [{ licence_number: "R0000002", full_name: "Closed Import", status: "Active" }]);
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.import_cicc_register($1, '[{"licence_number":"R1","full_name":"A B","status":"Active"}]'::jsonb)`, [importId]), /not open/);
    const open = await db.query<{ id: string }>(`select public.start_cicc_register_import('x', null, $1, $2) as id`, [SHA, admin]);
    await expectDbError(() => db.query(`select public.import_cicc_register($1, '[{"licence_number":"","full_name":"A B","status":"Active"}]'::jsonb)`, [open.rows[0].id]), /row 1 has no usable licence number/);
    await expectDbError(() => db.query(`select public.finish_cicc_register_import($1)`, [open.rows[0].id]), /no rows/);
  });

  it("verifies a matching licence (number normalized, name loose on case and accents) and makes the firm verified", async () => {
    const admin = await platformAdmin();
    const number = licenceNumber();
    const f = await signUp("Hélène Lévesque-Côté", number);
    const spaced = `${number.slice(0, 1).toLowerCase()} ${number.slice(1, 4)}-${number.slice(4)}`;
    const { importId } = await importList(admin, [
      { licence_number: spaced, last_name: "LEVESQUE-COTE", first_name: "Helene M.", status: "ACTIVE", licence_class: "RCIC", fields: { Company: "Synthetic Co" } },
    ]);
    expect(await credential(f.credentialId)).toEqual({ status: "verified", verification_method: "cicc_list", verification_status: "verified" });
    const check = await latestCheck(f.credentialId);
    expect(check).toMatchObject({ method: "cicc_list", result: "verified", cicc_import_id: importId, source_url: null });
    expect(await blockers(f.owner, f.orgId)).toEqual({ unlocked: true, blockers: [] });
    await asMaintenance(db);
    const audit = await db.query(`select 1 from public.audit_log where organization_id = $1 and action = 'licence.check_recorded' and context ->> 'method' = 'cicc_list'`, [f.orgId]);
    expect(audit.rows.length).toBeGreaterThan(0);
  });

  it("flags a number that is not on the list, or a different name, as needs_review without blocking the firm", async () => {
    const admin = await platformAdmin();
    const missing = await signUp("Omar Missing", licenceNumber());
    const renamed = await signUp("Sara Kim", licenceNumber());
    await asMaintenance(db);
    const renamedNumber = (await db.query<{ college_id: string }>(`select college_id from public.consultant_credentials where id = $1`, [renamed.credentialId])).rows[0].college_id;
    await importList(admin, [{ licence_number: renamedNumber, full_name: "Tom Lee", status: "Active" }]);

    for (const f of [missing, renamed]) {
      expect((await credential(f.credentialId)).status).toBe("declared");
      expect((await latestCheck(f.credentialId)).result).toBe("needs_review");
      expect(await blockers(f.owner, f.orgId)).toEqual({ unlocked: true, blockers: [] });
    }
    expect((await latestCheck(missing.credentialId)).notes).toMatch(/not on the CICC list/);
    expect((await latestCheck(renamed.credentialId)).notes).toMatch(/Name does not match/);

    await asUser(db, { userId: admin, aal: "aal2", totpAgeSeconds: 0 });
    const review = await db.query<{ credential_id: string; reason: string }>(`select credential_id, reason from public.cicc_needs_review_credentials()`);
    const ids = review.rows.map((row) => row.credential_id);
    expect(ids).toEqual(expect.arrayContaining([missing.credentialId, renamed.credentialId]));

    // A platform admin's manual register check through the RPC clears it from the list.
    await db.query(
      `select public.record_licence_check($1, $2, statement_timestamp(), 'active', true, false, false, false, null, $3, 'checked by hand')`,
      [missing.credentialId, REGISTER, PROOF],
    );
    expect(await credential(missing.credentialId)).toMatchObject({ status: "verified", verification_method: "manual_public_register" });
    await asUser(db, { userId: admin, aal: "aal2", totpAgeSeconds: 0 });
    const after = await db.query<{ credential_id: string }>(`select credential_id from public.cicc_needs_review_credentials()`);
    expect(after.rows.map((row) => row.credential_id)).not.toContain(missing.credentialId);
  });

  it("checks a licence declared after an import, and blocks a revoked or suspended status on the list", async () => {
    const admin = await platformAdmin();
    const number = licenceNumber();
    await importList(admin, [{ licence_number: number, full_name: "Ravi Kumar", status: "Suspended" }]);
    const f = await signUp("Ravi Kumar", number);
    expect((await credential(f.credentialId)).status).toBe("suspended");
    expect((await latestCheck(f.credentialId)).result).toBe("suspended");
    expect(await blockers(f.owner, f.orgId)).toEqual({ unlocked: false, blockers: ["owner_licence_blocked"] });
  });

  it("re-checks every credential when an import finishes", async () => {
    const admin = await platformAdmin();
    const number = licenceNumber();
    const f = await signUp("Mei Chen", number);
    // The latest import does not list this number yet: needs review, still live.
    await importList(admin, [{ licence_number: "R0000003", full_name: "Somebody Else", status: "Active" }]);
    expect((await credential(f.credentialId)).status).toBe("declared");

    const first = await importList(admin, [{ licence_number: number, full_name: "CHEN, Mei", status: "Active" }]);
    expect(Number(first.summary.checked)).toBeGreaterThanOrEqual(1);
    expect(await credential(f.credentialId)).toMatchObject({ status: "verified", verification_method: "cicc_list" });

    const second = await importList(admin, [{ licence_number: number, full_name: "Mei Chen", status: "Revoked" }]);
    expect(Number(second.summary.adverse)).toBeGreaterThanOrEqual(1);
    expect((await credential(f.credentialId)).status).toBe("revoked");
    expect((await latestCheck(f.credentialId)).cicc_import_id).toBe(second.importId);
    expect(await blockers(f.owner, f.orgId)).toEqual({ unlocked: false, blockers: ["firm_restricted", "owner_licence_blocked"] });
  });

  it("never lifts an adverse manual register check, and reads an explicit 'not entitled' as a lock", async () => {
    const admin = await platformAdmin();
    const revokedNumber = licenceNumber();
    const f = await signUp("Ana Silva", revokedNumber);
    await as(f.owner, f.orgId);
    await db.query(
      `select public.record_licence_check($1, $2, statement_timestamp(), 'active', true, false, true, false, null, $3, null)`,
      [f.credentialId, REGISTER, PROOF],
    );
    const entitledNumber = licenceNumber();
    const g = await signUp("Ben Ode", entitledNumber);
    await importList(admin, [
      { licence_number: revokedNumber, full_name: "Ana Silva", status: "Active" },
      { licence_number: entitledNumber, full_name: "Ben Ode", status: "Active", entitlement: "No" },
    ]);
    expect((await credential(f.credentialId)).status).toBe("revoked");
    expect((await latestCheck(f.credentialId)).notes).toMatch(/adverse manual register check is kept/);
    expect((await credential(g.credentialId)).status).toBe("not_entitled");
    expect(await blockers(g.owner, g.orgId)).toEqual({ unlocked: false, blockers: ["owner_licence_blocked"] });
  });

  it("lets a platform admin re-run the check for one credential through the RPC", async () => {
    const admin = await platformAdmin();
    const number = licenceNumber();
    const f = await signUp("Zoe Martin", number);
    await importList(admin, [{ licence_number: number, full_name: "Zoe Martin", status: "Active" }]);
    await asUser(db, { userId: admin, aal: "aal2", totpAgeSeconds: 0 });
    const rerun = await db.query<{ id: string }>(`select public.check_licence_against_cicc_list($1) as id`, [f.credentialId]);
    expect(rerun.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await latestCheck(f.credentialId)).result).toBe("verified");
  });
});
