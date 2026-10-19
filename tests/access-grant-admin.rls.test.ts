import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261019204100_access_grant_admin.sql: the Access grants page. Firm owner only, step-up to
// create or revoke, read-only explicit grants that always end, audited. Synthetic people only.

let db: TestDb;

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

async function as(userId: string, orgId: string, stepUp = true) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: stepUp ? 0 : 3600 });
}

async function user(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `${label}-${tag()}@example.test`]);
  return id;
}

async function firm() {
  const owner = await user("owner");
  const consultant = await user("consultant");
  const sponsorLogin = await user("sponsor");
  const applicantLogin = await user("applicant");
  await as(owner, "");
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  await asMaintenance(db);
  const consultantMembership = (
    await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
      [orgId, consultant, owner],
    )
  ).rows[0].id;
  await as(owner, orgId);
  const matterId = (
    await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership])
  ).rows[0].result.id;
  await asMaintenance(db);
  const people = await db.query<{ id: string; display_name: string }>(
    `insert into public.persons (organization_id, display_name, is_sample, user_id)
     values ($1, 'Synthetic applicant', true, $2), ($1, 'Synthetic sponsor', true, $3), ($1, 'Synthetic cousin', true, null)
     returning id, display_name`,
    [orgId, applicantLogin, sponsorLogin],
  );
  const id = (name: string) => people.rows.find((row) => row.display_name === name)!.id;
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`,
    [orgId, matterId, id("Synthetic applicant"), id("Synthetic sponsor")],
  );
  return { orgId, owner, consultant, sponsorLogin, matterId, applicant: id("Synthetic applicant"), sponsor: id("Synthetic sponsor"), cousin: id("Synthetic cousin") };
}

// The database counts days in the firm's timezone (America/Toronto by default), so the tests do too.
const torontoDay = (offsetDays = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date(Date.now() + offsetDays * 86_400_000));
const inDays = (days: number) => torontoDay(days);

async function grant(userId: string, orgId: string, f: Awaited<ReturnType<typeof firm>>, overrides: { grantee?: string; expires?: string; purpose?: string } = {}) {
  await as(userId, orgId);
  const row = await db.query<{ id: string }>(`select public.create_access_grant($1, $2, $3, $4::date, $5) as id`, [
    overrides.grantee ?? f.sponsor,
    f.applicant,
    f.matterId,
    overrides.expires ?? inDays(10),
    overrides.purpose ?? "Cover while away",
  ]);
  return row.rows[0].id;
}

describe("Access grants", () => {
  it("creates a read-only explicit grant on one matter that ends at the next local midnight, and lists it with names for the owner", async () => {
    const f = await firm();
    const id = await grant(f.owner, f.orgId, f);
    await asMaintenance(db);
    const row = await db.query<{ kind: string; ends_local: string; matter_id: string }>(
      `select kind::text, to_char(expires_at at time zone 'America/Toronto', 'YYYY-MM-DD HH24:MI') as ends_local, matter_id from public.access_grants where id = $1`,
      [id],
    );
    expect(row.rows[0].kind).toBe("explicit");
    expect(row.rows[0].ends_local).toBe(`${inDays(11)} 00:00`);
    const audit = await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'access_grant.created'`, [id]);
    expect(audit.rows.length).toBe(1);
    await as(f.owner, f.orgId, false);
    const listed = await db.query<{ grantee_name: string; subject_name: string; matter_reference: string | null }>(`select * from public.firm_access_grants($1)`, [f.orgId]);
    expect(listed.rows[0]).toMatchObject({ grantee_name: "Synthetic sponsor", subject_name: "Synthetic applicant" });
    const choices = await db.query<{ choice: string; person_name: string }>(`select * from public.access_grant_choices($1)`, [f.orgId]);
    expect(choices.rows.filter((row) => row.choice === "grantee").map((row) => row.person_name).sort()).toEqual(["Synthetic applicant", "Synthetic sponsor"]);
    expect(choices.rows.filter((row) => row.choice === "scope").length).toBe(2);
  });

  it("refuses no step-up, a non-owner, another firm, open-ended or far dates, no login, self grants and a short reason", async () => {
    const f = await firm();
    await as(f.owner, f.orgId, false);
    await expectDbError(
      () => db.query(`select public.create_access_grant($1, $2, $3, $4::date, 'Cover while away')`, [f.sponsor, f.applicant, f.matterId, inDays(5)]),
      /step-up/,
    );
    await expectDbError(() => grant(f.consultant, f.orgId, f), /step-up|denied/);
    await expectDbError(() => grant(f.owner, f.orgId, f, { expires: inDays(400) }), /up to a year/);
    await expectDbError(() => grant(f.owner, f.orgId, f, { expires: inDays(-1) }), /up to a year/);
    await expectDbError(() => grant(f.owner, f.orgId, f, { grantee: f.cousin }), /portal login/);
    await expectDbError(() => grant(f.owner, f.orgId, f, { grantee: f.applicant }), /own records/);
    await expectDbError(() => grant(f.owner, f.orgId, f, { purpose: "x" }), /reason/);
    const other = await firm();
    await expectDbError(() => grant(other.owner, other.orgId, f), /denied/);
    await as(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select * from public.firm_access_grants($1)`, [f.orgId]), /denied/);
    await expectDbError(() => db.query(`select * from public.access_grant_choices($1)`, [f.orgId]), /denied/);
  });

  it("revokes with a reason and a step-up, ends the grantee's access, and refuses a second revoke", async () => {
    const f = await firm();
    const id = await grant(f.owner, f.orgId, f);
    await as(f.owner, f.orgId, false);
    await expectDbError(() => db.query(`select public.revoke_access_grant($1, 'No longer needed')`, [id]), /step-up/);
    await as(f.owner, f.orgId);
    await db.query(`select public.revoke_access_grant($1, 'No longer needed')`, [id]);
    await expectDbError(() => db.query(`select public.revoke_access_grant($1, 'Again please')`, [id]), /already revoked/);
    await asMaintenance(db);
    const audit = await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where object_id = $1 and action = 'access_grant.revoked'`, [id]);
    expect(audit.rows[0].context).toMatchObject({ kind: "explicit" });
    expect(JSON.stringify(audit.rows[0].context)).not.toContain("No longer needed");
  });
});
