import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261031025000: the admin-portal attempt lockout (service-role RPCs), a firm owner's checks on
 * their own licence (first check only), and anon execute revoked on signed-in functions.
 * Synthetic users only.
 */

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 8);

async function rpc<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${tag()}@example.test`,
  ]);
  return id;
}

type Reservation = { allowed: boolean; attempt_id: string | null; retry_after_seconds: number };

const reserve = async (userId: string, kind = "password") => {
  await asServiceRole(db);
  return rpc<Reservation>(`public.platform_admin_reserve_attempt($1, $2)`, [userId, kind]);
};
const resolve = async (attemptId: string, succeeded: boolean) => {
  await asServiceRole(db);
  await db.query(`select public.platform_admin_resolve_attempt($1, $2)`, [attemptId, succeeded]);
};

describe("admin-portal attempt lockout", () => {
  it("allows under 5 failed-or-pending attempts in 15 minutes and refuses at 5 without a row", async () => {
    const userId = randomUUID();
    const ids: string[] = [];
    for (let n = 0; n < 5; n += 1) {
      const r = await reserve(userId, n % 2 === 0 ? "password" : "mfa");
      expect(r.allowed).toBe(true);
      expect(r.attempt_id).toBeTruthy();
      expect(r.retry_after_seconds).toBe(0);
      ids.push(r.attempt_id as string);
    }
    // Pending attempts count as failures.
    const refused = await reserve(userId, "mfa");
    expect(refused.allowed).toBe(false);
    expect(refused.attempt_id).toBeNull();
    expect(refused.retry_after_seconds).toBeGreaterThan(0);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(900);
    await asMaintenance(db);
    expect((await db.query(`select 1 from app.platform_admin_attempts where user_id = $1`, [userId])).rows).toHaveLength(5);

    // A failed outcome keeps counting; another user is unaffected.
    await resolve(ids[0], false);
    expect((await reserve(userId)).allowed).toBe(false);
    expect((await reserve(randomUUID())).allowed).toBe(true);
  });

  it("stops counting an attempt resolved as succeeded; a resolved attempt is not changed again", async () => {
    const userId = randomUUID();
    const ids: string[] = [];
    for (let n = 0; n < 5; n += 1) ids.push((await reserve(userId)).attempt_id as string);
    expect((await reserve(userId)).allowed).toBe(false);

    await resolve(ids[1], true);
    const again = await reserve(userId, "mfa");
    expect(again.allowed).toBe(true);
    expect((await reserve(userId)).allowed).toBe(false);

    // No-op on an already resolved attempt.
    await resolve(ids[1], false);
    await resolve(ids[2], false);
    await resolve(ids[2], true);
    await asMaintenance(db);
    const rows = await db.query<{ id: string; succeeded: boolean | null }>(
      `select id, succeeded from app.platform_admin_attempts where id = any($1::uuid[])`,
      [[ids[1], ids[2]]],
    );
    expect(Object.fromEntries(rows.rows.map((row) => [row.id, row.succeeded]))).toEqual({ [ids[1]]: true, [ids[2]]: false });
  });

  it("ignores attempts older than 15 minutes and rejects an unknown kind", async () => {
    const userId = randomUUID();
    await asMaintenance(db);
    await db.query(
      `insert into app.platform_admin_attempts (user_id, kind, created_at) select $1, 'password', now() - interval '16 minutes' from generate_series(1, 6)`,
      [userId],
    );
    expect((await reserve(userId)).allowed).toBe(true);
    await asServiceRole(db);
    await expectDbError(() => rpc(`public.platform_admin_reserve_attempt($1, 'sms')`, [userId]), /password or mfa/);
  });

  it("is not callable by authenticated or anon, and the table is not readable by them", async () => {
    const someone = await createUser("attempts-caller");
    const attemptId = (await reserve(someone)).attempt_id as string;

    await asUser(db, { userId: someone, aal: "aal2", totpAgeSeconds: 0 });
    await expectDbError(() => rpc(`public.platform_admin_reserve_attempt($1, 'password')`, [someone]), /permission denied/);
    await expectDbError(() => rpc(`public.platform_admin_resolve_attempt($1, true)`, [attemptId]), /permission denied/);
    await expectDbError(() => db.query(`select * from app.platform_admin_attempts`), /permission denied/);

    await asAnon(db);
    await expectDbError(() => rpc(`public.platform_admin_reserve_attempt($1, 'password')`, [someone]), /permission denied/);
    await expectDbError(() => rpc(`public.platform_admin_resolve_attempt($1, true)`, [attemptId]), /permission denied/);
    await expectDbError(() => db.query(`select * from app.platform_admin_attempts`), /permission denied/);

    await asMaintenance(db);
    expect((await db.query<{ succeeded: boolean | null }>(`select succeeded from app.platform_admin_attempts where id = $1`, [attemptId])).rows[0].succeeded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Firm owner's own licence
// ---------------------------------------------------------------------------

const fresh = (userId: string, orgId: string | null = null) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });

const recordCheck = (credentialId: string, flags: { suspended?: boolean } = {}) =>
  rpc(
    `public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, $4, false, false, null, $3, 'Synthetic note')`,
    [credentialId, REGISTER, PROOF, flags.suspended ?? false],
  );

async function credentialStatus(id: string) {
  await asMaintenance(db);
  return (await db.query<{ status: string }>(`select status::text from public.consultant_credentials where id = $1`, [id])).rows[0].status;
}

/** A firm whose owner and one consultant have each declared a licence. */
async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  await fresh(owner);
  const orgId = (
    await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}${tag()}`])
  ).rows[0].id;
  await asMaintenance(db);
  const ownerMembership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner])).rows[0].id;
  const consultantMembership = (
    await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
      [orgId, consultant, owner],
    )
  ).rows[0].id;
  const declare = async (userId: string, membershipId: string) => {
    await fresh(userId, orgId);
    return rpc<string>(`public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3)`, [
      membershipId,
      `R${tag().toUpperCase()}`,
      PROOF,
    ]);
  };
  const ownerCredential = await declare(owner, ownerMembership);
  const consultantCredential = await declare(consultant, consultantMembership);
  return { owner, consultant, orgId, ownerCredential, consultantCredential };
}

describe("firm owner checks on their own licence", () => {
  it("allows the first check during onboarding and refuses later ones; other members are unchanged", async () => {
    const f = await firm();
    await fresh(f.owner, f.orgId);
    expect(await recordCheck(f.ownerCredential)).toBeTruthy();
    expect(await credentialStatus(f.ownerCredential)).toBe("verified");

    await fresh(f.owner, f.orgId);
    await expectDbError(() => recordCheck(f.ownerCredential), /cannot record a check on your own licence/);
    await expectDbError(() => recordCheck(f.ownerCredential, { suspended: true }), /cannot record a check on your own licence/);

    // The owner still checks a consultant's licence, more than once.
    await fresh(f.owner, f.orgId);
    await recordCheck(f.consultantCredential, { suspended: true });
    await fresh(f.owner, f.orgId);
    await recordCheck(f.consultantCredential);
    expect(await credentialStatus(f.consultantCredential)).toBe("verified");
  });

  it("cannot lift an adverse status a platform admin recorded on the owner's licence", async () => {
    const f = await firm();
    const operator = await createUser("operator");
    await asMaintenance(db);
    await db.query(`insert into public.platform_admins (user_id, note, role) values ($1, 'Synthetic operator', 'operator')`, [operator]);

    await fresh(operator);
    await recordCheck(f.ownerCredential, { suspended: true });
    expect(await credentialStatus(f.ownerCredential)).toBe("suspended");

    await fresh(f.owner, f.orgId);
    await expectDbError(() => recordCheck(f.ownerCredential), /cannot record a check on your own licence/);
    expect(await credentialStatus(f.ownerCredential)).toBe("suspended");

    // A platform admin can still clear it.
    await fresh(operator);
    await recordCheck(f.ownerCredential);
    expect(await credentialStatus(f.ownerCredential)).toBe("verified");
  });

  // Last: a completed CICC list import changes declare_consultant_credential for the rest of this file.
  it("allows the first self check when only CICC list checks exist, but never lifts an adverse list status", async () => {
    const importer = await createUser("importer");
    await asMaintenance(db);
    await db.query(`insert into public.platform_admins (user_id, note, role) values ($1, 'Synthetic importer', 'operator')`, [importer]);
    await asServiceRole(db);
    const importId = await rpc<string>(`public.start_cicc_register_import('Synthetic CICC list', null, $1, $2)`, ["e".repeat(64), importer]);
    await rpc(`public.import_cicc_register($1, $2::jsonb)`, [importId, JSON.stringify([{ licence_number: "R0000001", full_name: "Somebody Synthetic", status: "Active" }])]);
    await rpc(`public.finish_cicc_register_import($1)`, [importId]);

    const f = await firm();
    await asMaintenance(db);
    const listChecks = await db.query(`select 1 from public.credential_checks where credential_id = $1 and method = 'cicc_list'`, [f.ownerCredential]);
    expect(listChecks.rows.length).toBeGreaterThan(0);
    expect(await credentialStatus(f.ownerCredential)).toBe("declared");

    // The automatic list check does not use up the owner's first check.
    await fresh(f.owner, f.orgId);
    expect(await recordCheck(f.ownerCredential)).toBeTruthy();
    expect(await credentialStatus(f.ownerCredential)).toBe("verified");
    // A second manual self check is still refused.
    await fresh(f.owner, f.orgId);
    await expectDbError(() => recordCheck(f.ownerCredential), /cannot record a check on your own licence/);
    await fresh(f.owner, f.orgId);
    expect(await recordCheck(f.consultantCredential)).toBeTruthy();

    // An adverse status set by the CICC list cannot be lifted by the owner's own check.
    const g = await firm();
    await asMaintenance(db);
    await db.query(
      `update public.consultant_credentials
          set status = 'suspended', verification_method = 'cicc_list', discipline_suspended = true
        where id = $1`,
      [g.ownerCredential],
    );
    await fresh(g.owner, g.orgId);
    await expectDbError(() => recordCheck(g.ownerCredential), /cannot record a check on your own licence/);
    expect(await credentialStatus(g.ownerCredential)).toBe("suspended");
    // Confirming it (not better) is allowed.
    await fresh(g.owner, g.orgId);
    expect(await recordCheck(g.ownerCredential, { suspended: true })).toBeTruthy();
    expect(await credentialStatus(g.ownerCredential)).toBe("suspended");
  });
});

describe("anon execute revoked on signed-in functions", () => {
  it("anon cannot execute them; authenticated still can", async () => {
    const signatures = [
      "public.document_upload_limit(uuid)",
      "public.save_checklist_template(uuid, text, text, jsonb)",
      "public.approve_checklist_template(uuid, integer)",
      "public.checklist_apply_preview(uuid, uuid)",
      "public.apply_checklist(uuid, uuid, jsonb, uuid[])",
      "public.record_custody_step(uuid, text, date, text, text, text)",
      "public.record_person_identity(uuid, text, jsonb, uuid, boolean)",
      "public.resolve_person_flag(uuid, text, text, text)",
      "public.link_document_matter(uuid, uuid)",
      "public.set_document_translation(uuid, integer, uuid, text)",
      "public.set_document_classification(uuid, integer, text, public.document_sensitivity)",
      "public.reuse_approved_facts(uuid)",
      "public.confirm_reused_fact(uuid)",
    ];
    await asMaintenance(db);
    for (const signature of signatures) {
      const row = await db.query<{ anon: boolean; authed: boolean }>(
        `select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as authed`,
        [signature],
      );
      expect({ signature, ...row.rows[0] }).toEqual({ signature, anon: false, authed: true });
    }
    await asAnon(db);
    await expectDbError(() => db.query(`select public.document_upload_limit($1)`, [randomUUID()]), /permission denied/);
  });
});
