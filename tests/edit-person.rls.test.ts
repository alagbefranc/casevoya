import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Edit details (savePersonDetails) and the invitation's email (invitePortalPerson) both update
 * public.persons as the signed-in user, so persons_update (app.can_write_person) decides.
 * These run the same statements the server actions send.
 */
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

/**
 * A sample matter with a consultant on it, an applicant (no email, no date of birth), and a
 * sponsor who holds their own portal login. A case manager in the firm is not on the matter.
 */
async function sampleMatter() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const outsider = await createUser(email("outsider"));
  const client = await createUser(email("client"));
  const orgId = await createOrg(owner);
  const membershipId = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  await activeMembership(orgId, outsider, "case_manager", owner);
  await activeMembership(orgId, client, "client", owner);

  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { id: string } }>(`select public.create_practice_matter($1, $2) as result`, ["Fictional sample file", true]);
  const matterId = matter.rows[0].result.id;
  const applicant = randomUUID();
  const sponsor = randomUUID();
  await db.query(`insert into public.persons (id, organization_id, display_name, is_sample) values ($1, $2, 'Sample Applicant', true)`, [applicant, orgId]);
  await db.query(`insert into public.persons (id, organization_id, display_name, is_sample, date_of_birth, birth_date_precision) values ($1, $2, 'Sample Sponsor', true, '1980-05-05', 'day')`, [
    sponsor,
    orgId,
  ]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`, [
    orgId,
    matterId,
    applicant,
    sponsor,
  ]);
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [orgId, matterId, membershipId]);
  await asMaintenance(db);
  await db.query(`update public.persons set user_id = $2 where id = $1`, [sponsor, client]);
  return { owner, consultant, outsider, client, orgId, matterId, applicant, sponsor };
}

type Ctx = Awaited<ReturnType<typeof sampleMatter>>;

async function versionOf(personId: string) {
  await asMaintenance(db);
  const row = await db.query<{ version: number }>(`select version from public.persons where id = $1`, [personId]);
  return row.rows[0].version;
}

/** savePersonDetails' update: name, email, phone, optionally a full date of birth, at the version read. */
async function saveDetails(
  userId: string,
  ctx: Ctx,
  personId: string,
  version: number,
  fields: { name: string; email: string | null; phone: string | null; dateOfBirth?: string },
) {
  await asUser(db, { userId, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  const result = await db.query<{ id: string; is_minor: boolean }>(
    `update public.persons
        set display_name = $4, email = $5, contact_phone = $6,
            date_of_birth = coalesce($7::date, date_of_birth),
            birth_date_precision = case when $7::date is null then birth_date_precision else 'day'::public.date_precision end
      where organization_id = $1 and id = $2 and version = $3
      returning id, is_minor`,
    [ctx.orgId, personId, version, fields.name, fields.email, fields.phone, fields.dateOfBirth ?? null],
  );
  return result.rows;
}

describe("Edit details through row-level security", () => {
  it("lets staff on the matter correct a person, keeps them sample, and records the change in the audit log", async () => {
    const ctx = await sampleMatter();
    const before = await versionOf(ctx.applicant);
    const saved = await saveDetails(ctx.consultant, ctx, ctx.applicant, before, {
      name: "Sample Applicant Corrected",
      email: "applicant@example.test",
      phone: "+14165550100",
      dateOfBirth: "1990-04-04",
    });
    expect(saved).toEqual([{ id: ctx.applicant, is_minor: false }]);

    await asMaintenance(db);
    const person = await db.query(
      `select display_name, email, contact_phone, date_of_birth::text as date_of_birth, birth_date::text as birth_date,
              birth_date_precision::text as birth_date_precision, is_sample, sample_label, version
         from public.persons where id = $1`,
      [ctx.applicant],
    );
    expect(person.rows[0]).toEqual({
      display_name: "Sample Applicant Corrected",
      email: "applicant@example.test",
      contact_phone: "+14165550100",
      date_of_birth: "1990-04-04",
      birth_date: "1990-04-04",
      birth_date_precision: "day",
      is_sample: true,
      sample_label: "Fictional sample. Not a client record.",
      version: before + 1,
    });

    const audit = await db.query<{ actor_user_id: string; diff: Record<string, { old: unknown; new: unknown }> }>(
      `select actor_user_id, diff from public.audit_log where object_id = $1 and action = 'persons.update' order by occurred_at desc limit 1`,
      [ctx.applicant],
    );
    expect(audit.rows[0].actor_user_id).toBe(ctx.consultant);
    expect(audit.rows[0].diff.display_name).toEqual({ old: "Sample Applicant", new: "Sample Applicant Corrected" });
    expect(audit.rows[0].diff.date_of_birth).toEqual({ old: null, new: "1990-04-04" });
  });

  it("refuses a save made against an older version", async () => {
    const ctx = await sampleMatter();
    const before = await versionOf(ctx.applicant);
    expect(await saveDetails(ctx.consultant, ctx, ctx.applicant, before, { name: "First", email: null, phone: null })).toHaveLength(1);
    expect(await saveDetails(ctx.consultant, ctx, ctx.applicant, before, { name: "Second", email: null, phone: null })).toHaveLength(0);
  });

  it("does not let staff who are not on the matter edit the person", async () => {
    const ctx = await sampleMatter();
    const before = await versionOf(ctx.applicant);
    expect(await saveDetails(ctx.outsider, ctx, ctx.applicant, before, { name: "Outsider edit", email: null, phone: null })).toHaveLength(0);
    await asMaintenance(db);
    const row = await db.query<{ display_name: string }>(`select display_name from public.persons where id = $1`, [ctx.applicant]);
    expect(row.rows[0].display_name).toBe("Sample Applicant");
  });

  it("does not let a client edit someone else, nor their own record", async () => {
    const ctx = await sampleMatter();
    const applicant = await versionOf(ctx.applicant);
    expect(await saveDetails(ctx.client, ctx, ctx.applicant, applicant, { name: "Client edit", email: null, phone: null })).toHaveLength(0);
    const own = await versionOf(ctx.sponsor);
    expect(await saveDetails(ctx.client, ctx, ctx.sponsor, own, { name: "Own edit", email: null, phone: null })).toHaveLength(0);
    await asMaintenance(db);
    const rows = await db.query<{ display_name: string }>(`select display_name from public.persons where id = any($1::uuid[]) order by display_name`, [[ctx.applicant, ctx.sponsor]]);
    expect(rows.rows.map((row) => row.display_name)).toEqual(["Sample Applicant", "Sample Sponsor"]);
  });

  it("refuses a future date of birth, a malformed phone, and an email that is not lower case", async () => {
    const ctx = await sampleMatter();
    const before = await versionOf(ctx.applicant);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`update public.persons set date_of_birth = current_date + 1, birth_date_precision = 'day' where id = $1 and version = $2`, [ctx.applicant, before]),
      /future/,
    );
    await expectDbError(() => db.query(`update public.persons set contact_phone = '416 555 0100' where id = $1`, [ctx.applicant]), /persons_contact_phone_ck/);
    await expectDbError(() => db.query(`update public.persons set email = 'Ana@Example.test' where id = $1`, [ctx.applicant]), /check constraint/);
  });

  it("does not let an edit change the sample flag", async () => {
    const ctx = await sampleMatter();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`update public.persons set is_sample = false where id = $1`, [ctx.applicant]), /sample flag is immutable/);
  });

  it("opens a majority review task when a corrected date shows a former minor is an adult", async () => {
    const ctx = await sampleMatter();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`update public.persons set date_of_birth = current_date - interval '10 years', birth_date_precision = 'day' where id = $1`, [ctx.applicant]);
    const version = await versionOf(ctx.applicant);
    const saved = await saveDetails(ctx.consultant, ctx, ctx.applicant, version, { name: "Sample Applicant", email: null, phone: null, dateOfBirth: "1990-04-04" });
    expect(saved).toEqual([{ id: ctx.applicant, is_minor: false }]);
    await asMaintenance(db);
    const tasks = await db.query(`select task_key, status from public.tasks where person_id = $1`, [ctx.applicant]);
    expect(tasks.rows).toEqual([{ task_key: "majority_review", status: "open" }]);
  });
});

describe("the invitation's email on the person", () => {
  async function invite(ctx: Ctx, personId: string, role: string, address: string) {
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const row = await db.query<{ result: { ok: boolean; error?: string } }>(
      `select public.create_portal_invitation($1, $2, $3::public.org_role, $4, $5::uuid[]) as result`,
      [personId, ctx.matterId, role, address, []],
    );
    return row.rows[0].result;
  }

  /** invitePortalPerson's follow-up: save it only when none is on file. */
  async function recordMissingEmail(ctx: Ctx, personId: string, address: string) {
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const rows = await db.query(`update public.persons set email = $3 where organization_id = $1 and id = $2 and email is null returning id`, [ctx.orgId, personId, address]);
    return rows.rows.length;
  }

  it("saves the invited email on a person who had none", async () => {
    const ctx = await sampleMatter();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`update public.persons set date_of_birth = '1990-04-04', birth_date_precision = 'day' where id = $1`, [ctx.applicant]);
    const address = email("applicant");
    expect((await invite(ctx, ctx.applicant, "client", address)).ok).toBe(true);
    expect(await recordMissingEmail(ctx, ctx.applicant, address)).toBe(1);
    await asMaintenance(db);
    const row = await db.query<{ email: string }>(`select email from public.persons where id = $1`, [ctx.applicant]);
    expect(row.rows[0].email).toBe(address);
  });

  it("never overwrites a different email already on file; the database refuses that invitation", async () => {
    const ctx = await sampleMatter();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`update public.persons set date_of_birth = '1990-04-04', birth_date_precision = 'day', email = 'on-file@example.test' where id = $1`, [ctx.applicant]);
    expect(await invite(ctx, ctx.applicant, "client", email("other"))).toMatchObject({ ok: false, error: "email_does_not_match_person" });
    expect(await recordMissingEmail(ctx, ctx.applicant, "other@example.test")).toBe(0);
    await asMaintenance(db);
    const row = await db.query<{ email: string }>(`select email from public.persons where id = $1`, [ctx.applicant]);
    expect(row.rows[0].email).toBe("on-file@example.test");
  });
});
