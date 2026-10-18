import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

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

type Issued = { ok: boolean; token?: string; error?: string };

async function invite(userId: string, orgId: string, personId: string, matterId: string, role: string, address: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const row = await db.query<{ result: Issued }>(
    `select public.create_portal_invitation($1, $2, $3::public.org_role, $4, $5::uuid[]) as result`,
    [personId, matterId, role, address, []],
  );
  return row.rows[0].result;
}

/** A sample matter with one sample applicant who has no date of birth, and a consultant on it. */
async function sampleMatterWithoutBirthDate() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const outsider = await createUser(email("outsider"));
  const orgId = await createOrg(owner);
  const membershipId = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  await activeMembership(orgId, outsider, "case_manager", owner);

  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { id: string } }>(`select public.create_practice_matter($1, $2) as result`, ["Fictional sample file", true]);
  const matterId = matter.rows[0].result.id;
  const personId = randomUUID();
  await db.query(`insert into public.persons (id, organization_id, display_name, is_sample) values ($1, $2, 'Sample Applicant', true)`, [personId, orgId]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, personId]);
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [
    orgId,
    matterId,
    membershipId,
  ]);
  return { owner, consultant, outsider, orgId, matterId, personId };
}

describe("recording a missing date of birth before a portal invitation", () => {
  it("refuses the invitation without one, lets assigned staff record it, then invites", async () => {
    const ctx = await sampleMatterWithoutBirthDate();
    const refused = await invite(ctx.consultant, ctx.orgId, ctx.personId, ctx.matterId, "client", email("client"));
    expect(refused).toMatchObject({ ok: false, error: "date_of_birth_required" });

    // What invitePortalPerson does: an update as the signed-in staff member, only when none is on file.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const saved = await db.query<{ id: string }>(
      `update public.persons set date_of_birth = $2::date, birth_date_precision = 'day'
       where organization_id = $1 and id = $3 and date_of_birth is null returning id`,
      [ctx.orgId, "1990-04-04", ctx.personId],
    );
    expect(saved.rows).toHaveLength(1);

    await asMaintenance(db);
    const person = await db.query<{ date_of_birth: string; birth_date: string; birth_date_precision: string; is_minor: boolean }>(
      `select date_of_birth::text as date_of_birth, birth_date::text as birth_date, birth_date_precision::text as birth_date_precision, is_minor
       from public.persons where id = $1`,
      [ctx.personId],
    );
    // app.sync_person_birth keeps the mirror columns in step.
    expect(person.rows[0]).toEqual({ date_of_birth: "1990-04-04", birth_date: "1990-04-04", birth_date_precision: "day", is_minor: false });

    const issued = await invite(ctx.consultant, ctx.orgId, ctx.personId, ctx.matterId, "client", email("client"));
    expect(issued.ok).toBe(true);
  });

  it("does not let staff off the matter record it, and refuses a future date", async () => {
    const ctx = await sampleMatterWithoutBirthDate();
    await asUser(db, { userId: ctx.outsider, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const hidden = await db.query(
      `update public.persons set date_of_birth = '1990-04-04', birth_date_precision = 'day' where id = $1 returning id`,
      [ctx.personId],
    );
    expect(hidden.rows).toHaveLength(0);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`update public.persons set date_of_birth = current_date + 1, birth_date_precision = 'day' where id = $1`, [ctx.personId]),
      /future/,
    );
    await asMaintenance(db);
    const still = await db.query<{ date_of_birth: string | null }>(`select date_of_birth from public.persons where id = $1`, [ctx.personId]);
    expect(still.rows[0].date_of_birth).toBeNull();
  });

  it("refuses a minor once the date shows one", async () => {
    const ctx = await sampleMatterWithoutBirthDate();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`update public.persons set date_of_birth = current_date - interval '10 years', birth_date_precision = 'day' where id = $1`, [ctx.personId]);
    const refused = await invite(ctx.consultant, ctx.orgId, ctx.personId, ctx.matterId, "client", email("client"));
    expect(refused).toMatchObject({ ok: false, error: "minor_cannot_hold_login" });
  });
});

describe("sample case dates of birth", () => {
  it("creates Priya and Rafael Sharma as fictional adults the sample invitation step can use", async () => {
    const owner = await createUser(email("owner"));
    const orgId = await createOrg(owner);
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const created = await db.query<{ id: string }>(`select public.ensure_sample_case() as id`);
    const matterId = created.rows[0].id;
    const people = await db.query<{ id: string; display_name: string; date_of_birth: string; birth_date_precision: string; is_minor: boolean }>(
      `select id, display_name, date_of_birth::text as date_of_birth, birth_date_precision::text as birth_date_precision, is_minor
       from public.persons where organization_id = $1 order by display_name`,
      [orgId],
    );
    expect(people.rows.map((row) => ({ display_name: row.display_name, date_of_birth: row.date_of_birth, birth_date_precision: row.birth_date_precision, is_minor: row.is_minor }))).toEqual([
      { display_name: "Priya Sharma", date_of_birth: "1984-03-09", birth_date_precision: "day", is_minor: false },
      { display_name: "Rafael Sharma", date_of_birth: "1982-07-21", birth_date_precision: "day", is_minor: false },
    ]);

    const priya = people.rows[0].id;
    const issued = await invite(owner, orgId, priya, matterId, "client", email("priya"));
    expect(issued.ok).toBe(true);
  });

  it("backfills only sample Priya and Rafael Sharma rows that have no date of birth", async () => {
    const owner = await createUser(email("owner"));
    const orgId = await createOrg(owner);
    await asMaintenance(db);
    const ids = {
      samplePriya: randomUUID(),
      sampleRafael: randomUUID(),
      sampleOther: randomUUID(),
      realPriya: randomUUID(),
      datedPriya: randomUUID(),
    };
    await db.query(
      `insert into public.persons (id, organization_id, display_name, is_sample, date_of_birth, birth_date_precision) values
         ($1, $6, 'Priya Sharma', true, null, null),
         ($2, $6, 'Rafael Sharma', true, null, null),
         ($3, $6, 'Someone Else', true, null, null),
         ($4, $6, 'Priya Sharma', false, null, null),
         ($5, $6, 'Priya Sharma', true, '1991-01-01', 'day')`,
      [ids.samplePriya, ids.sampleRafael, ids.sampleOther, ids.realPriya, ids.datedPriya, orgId],
    );

    // Run the migration's own backfill statement again.
    const migration = readFileSync(path.resolve(import.meta.dirname, "../supabase/migrations/20261018180100_sample_case_date_of_birth.sql"), "utf8");
    const backfill = migration.slice(migration.lastIndexOf("update public.persons"));
    expect(backfill).toMatch(/where is_sample/);
    await db.exec(backfill);

    const rows = await db.query<{ id: string; date_of_birth: string | null }>(
      `select id, date_of_birth::text as date_of_birth from public.persons where id = any($1::uuid[])`,
      [Object.values(ids)],
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row.date_of_birth]));
    expect(byId.get(ids.samplePriya)).toBe("1984-03-09");
    expect(byId.get(ids.sampleRafael)).toBe("1982-07-21");
    expect(byId.get(ids.sampleOther)).toBeNull();
    expect(byId.get(ids.realPriya)).toBeNull();
    expect(byId.get(ids.datedPriya)).toBe("1991-01-01");
  });
});
