import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261031016000: admin-portal support and platform-admin follow-ups. The step-up check for the
 * admin portal, no platform check or CICC list import on the admin's own licence, no reviewer
 * flag for a viewer, and template rejection only after submission. Synthetic users only.
 */

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const SHA = "d".repeat(64);
const officialSources = JSON.stringify([
  { url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html", title: "Study permit", retrieved_on: "2026-10-29" },
]);

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 8);
const licenceNumber = () => `R${tag().toUpperCase()}`;

async function createUser(label: string, displayName?: string) {
  await asMaintenance(db);
  const id = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@example.test`;
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, email]);
  if (displayName) await db.query(`update public.profiles set display_name = $2 where id = $1`, [id, displayName]);
  return { id, email };
}

async function platformAdmin(userId: string, role: "owner" | "operator" | "viewer", reviewer = false) {
  await asMaintenance(db);
  await db.query(`insert into public.platform_admins (user_id, note, role, template_reviewer) values ($1, $2, $3, $4)`, [
    userId,
    `Synthetic ${role}`,
    role,
    reviewer,
  ]);
  return userId;
}

async function rpc<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

const fresh = (userId: string, orgId: string | null = null) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });

const recordCheck = (credentialId: string) =>
  rpc(
    `public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, $3, 'Synthetic note')`,
    [credentialId, REGISTER, PROOF],
  );

/** A firm with a licensed consultant holding a declared credential; optionally verified by the owner. */
async function firm(consultantName: string, verify: boolean) {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant", consultantName);
  await fresh(owner.id);
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const membership = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
    [orgId, consultant.id, owner.id],
  );
  const number = licenceNumber();
  await fresh(consultant.id, orgId);
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membership.rows[0].id, number, PROOF],
  );
  const credentialId = credential.rows[0].id;
  if (verify) {
    await fresh(owner.id, orgId);
    await recordCheck(credentialId);
  }
  return { owner: owner.id, consultant: consultant.id, orgId, credentialId, number };
}

async function credentialState(id: string) {
  await asMaintenance(db);
  const row = await db.query<{ status: string; verification_method: string | null }>(
    `select status::text, verification_method from public.consultant_credentials where id = $1`,
    [id],
  );
  return row.rows[0];
}

async function importList(adminId: string, rows: { licence_number: string; full_name: string; status: string }[]) {
  await asServiceRole(db);
  const importId = await rpc<string>(`public.start_cicc_register_import('Synthetic CICC list', null, $1, $2)`, [SHA, adminId]);
  await rpc(`public.import_cicc_register($1, $2::jsonb)`, [importId, JSON.stringify(rows)]);
  const summary = await rpc<Record<string, number | string>>(`public.finish_cicc_register_import($1)`, [importId]);
  await asMaintenance(db);
  return { importId, summary };
}

describe("platform_step_up_check", () => {
  it("passes only for an owner or operator with a fresh step-up", async () => {
    const operator = (await createUser("op-stepup")).id;
    const owner = (await createUser("owner-stepup")).id;
    const viewer = (await createUser("viewer-stepup")).id;
    const stranger = (await createUser("stranger-stepup")).id;
    await platformAdmin(operator, "operator");
    await platformAdmin(owner, "owner");
    await platformAdmin(viewer, "viewer");

    await fresh(operator);
    expect(await rpc(`public.platform_step_up_check()`)).toEqual({ ok: true, user_id: operator });
    await fresh(owner);
    expect(await rpc(`public.platform_step_up_check()`)).toEqual({ ok: true, user_id: owner });

    await asUser(db, { userId: operator, aal: "aal2", totpAgeSeconds: 3600 });
    await expectDbError(() => rpc(`public.platform_step_up_check()`), /step-up is required/);
    await asUser(db, { userId: operator, aal: "aal1" });
    await expectDbError(() => rpc(`public.platform_step_up_check()`), /step-up is required/);
    await fresh(viewer);
    await expectDbError(() => rpc(`public.platform_step_up_check()`), /step-up is required/);
    await fresh(stranger);
    await expectDbError(() => rpc(`public.platform_step_up_check()`), /step-up is required/);
    await asServiceRole(db);
    await expectDbError(() => rpc(`public.platform_step_up_check()`), /permission denied/);
    await asAnon(db);
    await expectDbError(() => rpc(`public.platform_step_up_check()`), /permission denied/);
  });
});

describe("platform licence checks", () => {
  it("an operator cannot record a check on their own licence but can on another's; a firm owner still can", async () => {
    const mine = await firm("Olu Operator", false);
    const other = await firm("Ada Other", false);
    await platformAdmin(mine.consultant, "operator");

    await fresh(mine.consultant, mine.orgId);
    await expectDbError(() => recordCheck(mine.credentialId), /cannot record a check on your own licence/);
    expect((await credentialState(mine.credentialId)).status).toBe("declared");

    await fresh(mine.consultant, mine.orgId);
    expect(await recordCheck(other.credentialId)).toBeTruthy();
    expect(await credentialState(other.credentialId)).toEqual({ status: "verified", verification_method: "manual_public_register" });

    // Firm-owner branch unchanged: the owner of the operator's firm checks the operator's licence.
    await fresh(mine.owner, mine.orgId);
    expect(await recordCheck(mine.credentialId)).toBeTruthy();
    expect((await credentialState(mine.credentialId)).status).toBe("verified");
  });
});

describe("platform admin reviewer flag", () => {
  it("is never on for a viewer: set_reviewer and invite refuse, set_role to viewer clears it, an older invite does not grant it", async () => {
    const owner = (await createUser("owner-flag")).id;
    const operator = (await createUser("operator-flag")).id;
    const viewer = (await createUser("viewer-flag")).id;
    const invitee = await createUser("invitee-flag");
    const legacy = await createUser("legacy-flag");
    await platformAdmin(owner, "owner");
    await platformAdmin(operator, "operator");
    await platformAdmin(viewer, "viewer");

    await fresh(owner);
    await expectDbError(() => rpc(`public.platform_admin_set_reviewer($1, true)`, [viewer]), /viewer cannot be a template reviewer/);
    await rpc(`public.platform_admin_set_reviewer($1, false)`, [viewer]);
    await rpc(`public.platform_admin_set_reviewer($1, true)`, [operator]);
    await expectDbError(() => rpc(`public.platform_admin_invite($1, 'viewer', true)`, [invitee.email]), /viewer cannot be a template reviewer/);
    await rpc(`public.platform_admin_invite($1, 'viewer', false)`, [invitee.email]);

    await rpc(`public.platform_admin_set_role($1, 'viewer')`, [operator]);
    await asMaintenance(db);
    const row = await db.query<{ role: string; template_reviewer: boolean }>(`select role, template_reviewer from public.platform_admins where user_id = $1`, [operator]);
    expect(row.rows[0]).toEqual({ role: "viewer", template_reviewer: false });
    const audit = await db.query<{ action: string; context: Record<string, unknown> }>(
      `select action, context from public.audit_log where object_id = $1 and action in ('platform_admin.role_changed', 'platform_admin.reviewer_changed') order by occurred_at, action`,
      [operator],
    );
    const actions = audit.rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["platform_admin.role_changed", "platform_admin.reviewer_changed"]));
    expect(audit.rows.find((r) => r.action === "platform_admin.role_changed")?.context).toMatchObject({ to: "viewer", template_reviewer_cleared: true });
    expect(audit.rows.some((r) => r.action === "platform_admin.reviewer_changed" && r.context.reason === "role_viewer")).toBe(true);

    // Back to operator: the flag stays off until an owner turns it on again.
    await fresh(owner);
    await rpc(`public.platform_admin_set_role($1, 'operator')`, [operator]);
    await asMaintenance(db);
    expect((await db.query<{ template_reviewer: boolean }>(`select template_reviewer from public.platform_admins where user_id = $1`, [operator])).rows[0].template_reviewer).toBe(false);

    // An invite written before this rule (viewer + reviewer) is accepted without the flag.
    await db.query(`select set_config('app.platform_admin_write', 'on', false)`);
    await db.query(
      `insert into public.platform_admin_invites (email, role, template_reviewer, invited_by, expires_at) values ($1, 'viewer', true, $2, now() + interval '1 day')`,
      [legacy.email, owner],
    );
    await db.query(`select set_config('app.platform_admin_write', '', false)`);
    await fresh(legacy.id);
    expect(await rpc(`public.accept_platform_admin_invite()`)).toMatchObject({ role: "viewer", template_reviewer: false });
    await asMaintenance(db);
    expect((await db.query<{ template_reviewer: boolean }>(`select template_reviewer from public.platform_admins where user_id = $1`, [legacy.id])).rows[0].template_reviewer).toBe(false);
  });
});

describe("shared template rejection", () => {
  it("refuses a draft that has not been submitted, and rejects a submitted one", async () => {
    const licensed = await firm("Rae Reviewer", true);
    const author = (await createUser("author-reject")).id;
    await platformAdmin(author, "operator");
    await platformAdmin(licensed.consultant, "operator", true);

    await asServiceRole(db);
    const versionId = await rpc<string>(`public.draft_shared_template_version($1, $2, $3, $4::jsonb, $5, $6, $7, $8::date, $9)`, [
      `synthetic_reject_${tag()}`,
      "Synthetic template",
      "A fictional checklist for tests.",
      JSON.stringify(["Ask for the synthetic file"]),
      "Synthetic Author",
      author,
      "Synthetic test evidence for this version.",
      "2026-11-01",
      "First fictional version.",
    ]);

    await fresh(licensed.consultant, licensed.orgId);
    await expectDbError(() => rpc(`public.reject_shared_template_version($1, 'Not ready yet')`, [versionId]), /not been submitted for review/);
    await asMaintenance(db);
    expect((await db.query<{ status: string }>(`select status from public.shared_template_versions where id = $1`, [versionId])).rows[0].status).toBe("draft");

    await asServiceRole(db);
    await rpc(`public.set_shared_template_version_sources($1, $2::jsonb, $3)`, [versionId, officialSources, author]);
    await rpc(`public.submit_shared_template_version($1, $2)`, [versionId, author]);
    await fresh(licensed.consultant, licensed.orgId);
    expect(await rpc(`public.reject_shared_template_version($1, 'Wording needs changes')`, [versionId])).toMatchObject({ status: "rejected" });
  });
});

describe("CICC list import and the importer's own licence", () => {
  it("skips the importing admin's credentials and still checks everyone else", async () => {
    const importer = await firm("Ivo Importer", false);
    const other = await firm("Mina Other", false);
    const second = (await createUser("second-op")).id;
    await platformAdmin(importer.consultant, "operator");
    await platformAdmin(second, "operator");

    const first = await importList(importer.consultant, [
      { licence_number: importer.number, full_name: "Ivo Importer", status: "Active" },
      { licence_number: other.number, full_name: "Mina Other", status: "Active" },
    ]);
    expect(Number(first.summary.skipped)).toBeGreaterThanOrEqual(1);
    expect(await credentialState(importer.credentialId)).toEqual({ status: "declared", verification_method: null });
    expect(await credentialState(other.credentialId)).toEqual({ status: "verified", verification_method: "cicc_list" });
    await asMaintenance(db);
    const ownChecks = await db.query(`select 1 from public.credential_checks where credential_id = $1 and cicc_import_id = $2`, [
      importer.credentialId,
      first.importId,
    ]);
    expect(ownChecks.rows).toHaveLength(0);

    // A re-check of that credential against the importer's own list is refused, from any admin.
    await fresh(second);
    await expectDbError(() => rpc(`public.check_licence_against_cicc_list($1)`, [importer.credentialId]), /imported by this licence holder/);
    expect(await rpc(`public.check_licence_against_cicc_list($1)`, [other.credentialId])).toBeTruthy();

    // A list imported by another admin checks the first admin's licence as usual.
    const next = await importList(second, [{ licence_number: importer.number, full_name: "Ivo Importer", status: "Active" }]);
    expect(Number(next.summary.checked)).toBeGreaterThanOrEqual(1);
    expect(await credentialState(importer.credentialId)).toEqual({ status: "verified", verification_method: "cicc_list" });

    // A licence the importer declares after their own import is not checked against it.
    await importList(importer.consultant, [{ licence_number: "R0000009", full_name: "Somebody Synthetic", status: "Active" }]);
    await asMaintenance(db);
    const membership = await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
       values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
      [other.orgId, importer.consultant, other.owner],
    );
    await fresh(importer.consultant, other.orgId);
    const declared = await rpc<string>(`public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3)`, [
      membership.rows[0].id,
      licenceNumber(),
      PROOF,
    ]);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.credential_checks where credential_id = $1`, [declared])).rows).toHaveLength(0);
  });
});
