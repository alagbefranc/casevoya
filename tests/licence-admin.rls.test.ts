import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261019204000_licence_admin.sql: Add a licence, Report a change, the review log and
// reassigning chosen matters away from a consultant. Synthetic people only; no register is called.

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

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);
const collegeId = () => `R${tag().slice(0, 7).toUpperCase()}`;

async function as(userId: string, orgId: string, stepUp = true) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: stepUp ? 0 : 3600 });
}

async function createUser(label: string, name?: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${tag()}@example.test`,
  ]);
  if (name) await db.query(`update public.profiles set display_name = $2 where id = $1`, [id, name]);
  return id;
}

async function member(orgId: string, userId: string, role: string, by: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, by],
  );
  return row.rows[0].id;
}

async function firm() {
  const owner = await createUser("owner", "Dana Owner");
  const consultant = await createUser("consultant", "Sam Consultant");
  const other = await createUser("other", "Lee Other");
  const assistant = await createUser("assistant", "Kim Assistant");
  await as(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const ownerMembership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner])).rows[0].id;
  const consultantMembership = await member(orgId, consultant, "licensed_consultant", owner);
  const otherMembership = await member(orgId, other, "licensed_consultant", owner);
  const assistantMembership = await member(orgId, assistant, "assistant", owner);
  return { orgId, owner, ownerMembership, consultant, consultantMembership, other, otherMembership, assistant, assistantMembership };
}

async function addLicence(userId: string, orgId: string, membershipId: string, type = "RCIC") {
  await as(userId, orgId);
  const row = await db.query<{ id: string }>(`select public.add_consultant_licence($1, $2::public.licence_type, $3) as id`, [membershipId, type, collegeId()]);
  return row.rows[0].id;
}

async function check(ownerId: string, orgId: string, credentialId: string, suspended = false) {
  await as(ownerId, orgId);
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, $3, false, false, null, $4, null)`,
    [credentialId, REGISTER, suspended, PROOF],
  );
}

describe("Add a licence", () => {
  it("lets the owner add a consultant's licence without a proof file, waiting for a check, and audits it", async () => {
    const f = await firm();
    const id = await addLicence(f.owner, f.orgId, f.consultantMembership);
    await asMaintenance(db);
    const row = await db.query<{ status: string; proof_locator: string | null; verification_status: string }>(
      `select c.status::text, c.proof_locator, o.verification_status::text
       from public.consultant_credentials c join public.organizations o on o.id = c.organization_id where c.id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ status: "declared", proof_locator: null, verification_status: "pending_review" });
    const audit = await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'licence.declared'`, [id]);
    expect(audit.rows.length).toBe(1);
  });

  it("lets a consultant add their own, and refuses a second licence, an assistant, another owner's membership, and no step-up", async () => {
    const f = await firm();
    await addLicence(f.consultant, f.orgId, f.consultantMembership);
    await expectDbError(() => addLicence(f.owner, f.orgId, f.consultantMembership), /already has a licence/);
    await expectDbError(() => addLicence(f.assistant, f.orgId, f.otherMembership), /denied/);
    await expectDbError(() => addLicence(f.owner, f.orgId, f.assistantMembership), /denied/);
    await expectDbError(() => addLicence(f.consultant, f.orgId, f.ownerMembership), /denied/);
    await as(f.owner, f.orgId, false);
    await expectDbError(
      () => db.query(`select public.add_consultant_licence($1, 'RCIC'::public.licence_type, $2)`, [f.otherMembership, collegeId()]),
      /step-up/,
    );
  });

  it("refuses another firm's owner", async () => {
    const a = await firm();
    const b = await firm();
    await expectDbError(() => addLicence(b.owner, b.orgId, a.otherMembership), /denied/);
  });
});

describe("Report a change", () => {
  it("records the report, makes the review due now, queues the reviewer event and keeps the status", async () => {
    const f = await firm();
    const id = await addLicence(f.owner, f.orgId, f.consultantMembership);
    await check(f.owner, f.orgId, id);
    await as(f.consultant, f.orgId);
    await db.query(`select public.report_licence_change($1, 'New condition on my licence')`, [id]);
    await asMaintenance(db);
    const cred = await db.query<{ status: string; due: boolean }>(
      `select status::text, next_review_at <= now() as due from public.consultant_credentials where id = $1`,
      [id],
    );
    expect(cred.rows[0]).toEqual({ status: "verified", due: true });
    const event = await db.query(`select 1 from public.outbox_events where aggregate_id = $1 and event_type = 'licence.change_reported'`, [id]);
    expect(event.rows.length).toBe(1);
    const audit = await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where action = 'licence.change_reported' and organization_id = $1`, [f.orgId]);
    expect(JSON.stringify(audit.rows[0].context)).not.toContain("New condition");
  });

  it("refuses an assistant, a colleague who isn't the holder, another firm, and a direct insert", async () => {
    const f = await firm();
    const id = await addLicence(f.owner, f.orgId, f.consultantMembership);
    await as(f.assistant, f.orgId);
    await expectDbError(() => db.query(`select public.report_licence_change($1, 'Something changed')`, [id]), /denied/);
    await as(f.other, f.orgId);
    await expectDbError(() => db.query(`select public.report_licence_change($1, 'Something changed')`, [id]), /denied/);
    const b = await firm();
    await as(b.owner, b.orgId);
    await expectDbError(() => db.query(`select public.report_licence_change($1, 'Something changed')`, [id]), /denied/);
    await as(f.owner, f.orgId);
    await expectDbError(
      () =>
        db.query(`insert into public.credential_change_reports (organization_id, credential_id, detail, reported_by) values ($1, $2, 'Forged report', $3)`, [
          f.orgId,
          id,
          f.owner,
        ]),
      /permission denied/,
    );
  });
});

describe("Review log", () => {
  it("lists checks, declarations and change reports with names, to staff of the firm only", async () => {
    const f = await firm();
    const id = await addLicence(f.owner, f.orgId, f.consultantMembership);
    await check(f.owner, f.orgId, id);
    await as(f.owner, f.orgId);
    await db.query(`select public.report_licence_change($1, 'Licence class changed')`, [id]);
    await as(f.assistant, f.orgId, false);
    const log = await db.query<{ kind: string; result: string | null; holder_name: string; actor_name: string }>(
      `select kind, result, holder_name, actor_name from public.licence_review_log($1)`,
      [f.orgId],
    );
    expect(log.rows.map((row) => row.kind).sort()).toEqual(["change_reported", "check", "declared"]);
    expect(log.rows.every((row) => row.holder_name === "Sam Consultant" && row.actor_name === "Dana Owner")).toBe(true);
    const b = await firm();
    await as(b.owner, b.orgId);
    await expectDbError(() => db.query(`select * from public.licence_review_log($1)`, [f.orgId]), /denied/);
  });
});

describe("Reassign chosen matters", () => {
  async function matterFor(f: Awaited<ReturnType<typeof firm>>, consultantMembership: string) {
    await as(f.owner, f.orgId);
    const created = await db.query<{ result: { ok: boolean; id: string } }>(
      `select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`,
      [consultantMembership],
    );
    return created.rows[0].result.id;
  }

  it("lets a suspended consultant move chosen matters to a verified colleague, leaving the others", async () => {
    const f = await firm();
    const mine = await addLicence(f.owner, f.orgId, f.consultantMembership);
    const theirs = await addLicence(f.owner, f.orgId, f.otherMembership);
    await check(f.owner, f.orgId, mine);
    await check(f.owner, f.orgId, theirs);
    const first = await matterFor(f, f.consultantMembership);
    const second = await matterFor(f, f.consultantMembership);
    await check(f.owner, f.orgId, mine, true);
    await as(f.consultant, f.orgId);
    const moved = await db.query<{ n: number }>(`select public.reassign_consultant_matters_selected($1, $2, $3::uuid[], 'Temporary while my licence is reviewed') as n`, [
      f.consultantMembership,
      f.otherMembership,
      [first],
    ]);
    expect(moved.rows[0].n).toBe(1);
    await asMaintenance(db);
    const rows = await db.query<{ id: string; responsible: string }>(
      `select id, responsible_consultant_membership_id as responsible from public.matters where id = any($1::uuid[])`,
      [[first, second]],
    );
    const by = new Map(rows.rows.map((row) => [row.id, row.responsible]));
    expect(by.get(first)).toBe(f.otherMembership);
    expect(by.get(second)).toBe(f.consultantMembership);
    const parties = await db.query(`select 1 from public.matter_participants where matter_id = $1 and membership_id = $2 and role = 'consultant'`, [first, f.otherMembership]);
    expect(parties.rows.length).toBe(1);
  });

  it("refuses an unverified receiver, a colleague moving someone else's work, a short reason, and another firm's matter", async () => {
    const f = await firm();
    const mine = await addLicence(f.owner, f.orgId, f.consultantMembership);
    await check(f.owner, f.orgId, mine);
    const otherCred = await addLicence(f.owner, f.orgId, f.otherMembership);
    const matter = await matterFor(f, f.consultantMembership);
    const run = (user: string, to: string, ids: string[], reason = "Cover while away for review") => async () => {
      await as(user, f.orgId);
      await db.query(`select public.reassign_consultant_matters_selected($1, $2, $3::uuid[], $4)`, [f.consultantMembership, to, ids, reason]);
    };
    await expectDbError(run(f.owner, f.otherMembership, [matter]), /verified licence/);
    await expectDbError(run(f.other, f.ownerMembership, [matter]), /denied/);
    await expectDbError(run(f.consultant, f.otherMembership, [matter], "short"), /reason/);
    const b = await firm();
    const bCred = await addLicence(b.owner, b.orgId, b.consultantMembership);
    await check(b.owner, b.orgId, bCred);
    const foreign = await matterFor(b, b.consultantMembership);
    await check(f.owner, f.orgId, otherCred);
    await expectDbError(run(f.consultant, f.otherMembership, [foreign]), /cannot be reassigned/);
    await expectDbError(run(f.assistant, f.otherMembership, [matter]), /denied/);
  });
});
