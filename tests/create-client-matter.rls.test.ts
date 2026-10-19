import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

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

type Created = { ok: boolean; id?: string; reference?: string; applicant_id?: string; sponsor_id?: string | null; blocked?: string };

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, address],
  );
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

async function verifiedLicence(owner: string, consultant: string, orgId: string, membershipId: string, block = false) {
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membershipId, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       $3, $4, false, false, null, $5, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, !block, block, PROOF],
  );
}

async function firm({ sampleMode }: { sampleMode: boolean }) {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const manager = await createUser(email("manager"));
  const colleague = await createUser(email("colleague"));
  const orgId = await createOrg(owner);
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  const colleagueMembership = await activeMembership(orgId, colleague, "case_manager", owner);
  await verifiedLicence(owner, consultant, orgId, consultantMembership);
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = $2 where id = $1`, [orgId, sampleMode]);
  return { owner, consultant, manager, colleague, orgId, consultantMembership, managerMembership, colleagueMembership };
}

async function create(userId: string, orgId: string, args: unknown[], aal: "aal1" | "aal2" = "aal2") {
  await asUser(db, { userId, aal, orgId, totpAgeSeconds: aal === "aal2" ? 0 : undefined });
  const result = await db.query<{ result: Created }>(
    `select public.create_client_matter($1, $2, $3, $4, $5, $6, $7) as result`,
    args,
  );
  return result.rows[0].result;
}

describe("create_client_matter", () => {
  it("opens a real matter with its applicant and sponsor, readable by the case manager who entered it", async () => {
    const ctx = await firm({ sampleMode: false });
    const created = await create(ctx.manager, ctx.orgId, [
      "Ana Pereira",
      " Ana@Example.Test ",
      "Luis Pereira",
      null,
      ctx.consultantMembership,
      null,
      null,
    ]);
    expect(created.ok).toBe(true);
    expect(created.reference).toMatch(/^[A-Z]{2}-\d{4}-\d{4}$/);

    // Still the signed-in case manager: RLS lets them read what they just entered.
    const matter = await db.query<{ title: string; is_sample: boolean; stage: string; responsible_consultant_membership_id: string }>(
      `select title, is_sample, stage, responsible_consultant_membership_id from public.matters where id = $1`,
      [created.id],
    );
    expect(matter.rows[0]).toEqual({
      title: "Ana Pereira",
      is_sample: false,
      stage: "engagement_pending",
      responsible_consultant_membership_id: ctx.consultantMembership,
    });
    const people = await db.query<{ display_name: string; email: string | null; role: string }>(
      `select person.display_name, person.email, participant.role
       from public.matter_participants participant
       join public.persons person on person.id = participant.person_id
       where participant.matter_id = $1
       order by participant.role`,
      [created.id],
    );
    expect(people.rows).toEqual([
      { display_name: "Ana Pereira", email: "ana@example.test", role: "applicant" },
      { display_name: "Luis Pereira", email: null, role: "sponsor" },
    ]);
    const staff = await db.query<{ membership_id: string; role: string }>(
      `select membership_id, role from public.matter_participants
       where matter_id = $1 and membership_id is not null order by role::text`,
      [created.id],
    );
    expect(staff.rows).toEqual([
      { membership_id: ctx.managerMembership, role: "case_manager" },
      { membership_id: ctx.consultantMembership, role: "consultant" },
    ]);

    // The responsible consultant reads the people through the consultant participant.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const consultantView = await db.query(`select id from public.persons where id = $1`, [created.applicant_id]);
    expect(consultantView.rows).toHaveLength(1);

    // A case manager who is not on the matter does not.
    await asUser(db, { userId: ctx.colleague, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const hidden = await db.query(`select id from public.persons where id = any($1::uuid[])`, [[created.applicant_id, created.sponsor_id]]);
    expect(hidden.rows).toHaveLength(0);
  });

  it("does not add the responsible consultant twice and leaves out the sponsor when none is named", async () => {
    const ctx = await firm({ sampleMode: false });
    const created = await create(ctx.consultant, ctx.orgId, ["Kofi Mensah", null, "", "", ctx.consultantMembership, null, "Work permit"]);
    expect(created.ok).toBe(true);
    expect(created.sponsor_id).toBeNull();
    const rows = await db.query<{ role: string; person_id: string | null; membership_id: string | null }>(
      `select role, person_id, membership_id from public.matter_participants where matter_id = $1 order by role`,
      [created.id],
    );
    expect(rows.rows).toEqual([
      { role: "applicant", person_id: created.applicant_id, membership_id: null },
      { role: "consultant", person_id: null, membership_id: ctx.consultantMembership },
    ]);
    const title = await db.query<{ title: string }>(`select title from public.matters where id = $1`, [created.id]);
    expect(title.rows[0].title).toBe("Work permit");
  });

  it("opens a sample matter with sample people in a sample-mode firm (decision 2026-10-19)", async () => {
    const ctx = await firm({ sampleMode: true });
    const created = await create(ctx.manager, ctx.orgId, ["Practice Client", null, "Practice Sponsor", null, ctx.consultantMembership, null, null]);
    expect(created).toMatchObject({ ok: true, is_sample: true });
    await asMaintenance(db);
    const matter = await db.query<{ is_sample: boolean }>(`select is_sample from public.matters where id = $1`, [created.id]);
    expect(matter.rows[0].is_sample).toBe(true);
    const people = await db.query<{ is_sample: boolean }>(`select is_sample from public.persons where id = any($1::uuid[])`, [[created.applicant_id, created.sponsor_id]]);
    expect(people.rows.map((row) => row.is_sample)).toEqual([true, true]);

    // A sample matter takes new work while the firm is in sample mode.
    await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const task = await db.query<{ id: string }>(
      `select public.create_task($1, 'internal', 'Practice task', $2, null, 'normal', null, null, 'America/Toronto', null, null, '[]'::jsonb) as id`,
      [created.id, ctx.managerMembership],
    );
    expect(task.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("opens a real matter once the firm is out of sample mode", async () => {
    const ctx = await firm({ sampleMode: false });
    const created = await create(ctx.manager, ctx.orgId, ["Real Client", null, null, null, ctx.consultantMembership, null, null]);
    expect(created).toMatchObject({ ok: true, is_sample: false });
  });

  it("does not let a caller forge the sample flag through the internal function in another firm", async () => {
    const ctx = await firm({ sampleMode: false });
    const other = await firm({ sampleMode: true });
    await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const sample = await db.query<{ v: boolean | null }>(`select app.firm_in_sample_mode($1) as v`, [other.orgId]);
    expect(sample.rows[0].v).toBeNull();
    const own = await db.query<{ v: boolean | null }>(`select app.firm_in_sample_mode($1) as v`, [ctx.orgId]);
    expect(own.rows[0].v).toBe(false);
  });

  it("returns the licence refusal, and checks the caller, the fields and the session", async () => {
    const ctx = await firm({ sampleMode: false });
    const blockedUser = await createUser(email("blocked"));
    const blockedMembership = await activeMembership(ctx.orgId, blockedUser, "licensed_consultant", ctx.owner);
    await verifiedLicence(ctx.owner, blockedUser, ctx.orgId, blockedMembership, true);

    const blocked = await create(ctx.owner, ctx.orgId, ["Blocked Client", null, null, null, blockedMembership, null, null]);
    expect(blocked).toMatchObject({ ok: false, blocked: "licence" });
    await asMaintenance(db);
    const persons = await db.query<{ n: number }>(`select count(*)::int as n from public.persons where organization_id = $1`, [ctx.orgId]);
    expect(persons.rows[0].n).toBe(0);

    await expectDbError(
      () => create(ctx.manager, ctx.orgId, ["", null, null, null, ctx.consultantMembership, null, null]),
      /applicant name is required/,
    );
    await expectDbError(
      () => create(ctx.manager, ctx.orgId, ["Someone", "not-an-email", null, null, ctx.consultantMembership, null, null]),
      /email is invalid/,
    );
    await expectDbError(
      () => create(ctx.manager, ctx.orgId, ["Someone", null, null, "sponsor@example.test", ctx.consultantMembership, null, null]),
      /sponsor name is required/,
    );
    await expectDbError(
      () => create(ctx.manager, ctx.orgId, ["Someone", null, null, null, ctx.managerMembership, null, null]),
      /active licensed consultant/,
    );
    await expectDbError(
      () => create(ctx.manager, ctx.orgId, ["Someone", null, null, null, ctx.consultantMembership, null, null], "aal1"),
      /aal2/,
    );

    const outsider = await createUser(email("outsider"));
    const otherOrg = await createOrg(outsider);
    await expectDbError(
      () => create(outsider, otherOrg, ["Someone", null, null, null, ctx.consultantMembership, null, null]),
      /licensed consultant|denied|sample mode/,
    );
  });

  it("is not callable by anon", async () => {
    await asMaintenance(db);
    const grants = await db.query<{ anon: boolean; authenticated: boolean }>(
      `select has_function_privilege('anon', 'public.create_client_matter(text, text, text, text, uuid, uuid, text, date, date)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.create_client_matter(text, text, text, text, uuid, uuid, text, date, date)', 'execute') as authenticated`,
    );
    expect(grants.rows[0]).toEqual({ anon: false, authenticated: true });
  });

  it("has one signature in the API, and the retired 7-argument one is not executable", async () => {
    await asMaintenance(db);
    const overloads = await db.query<{ args: string; definer: boolean; config: string[] | null }>(
      `select pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer, p.proconfig as config
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'create_client_matter'`,
    );
    expect(overloads.rows).toHaveLength(1);
    expect(overloads.rows[0].args).toMatch(/p_applicant_date_of_birth date, p_sponsor_date_of_birth date$/);
    expect(overloads.rows[0].definer).toBe(false);
    expect(overloads.rows[0].config).toEqual(["search_path=\"\""]);
    const retired = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(
      `select has_function_privilege('anon', 'app.create_client_matter_retired_20261018(text, text, text, text, uuid, uuid, text)', 'execute') as anon,
              has_function_privilege('authenticated', 'app.create_client_matter_retired_20261018(text, text, text, text, uuid, uuid, text)', 'execute') as authenticated,
              has_function_privilege('service_role', 'app.create_client_matter_retired_20261018(text, text, text, text, uuid, uuid, text)', 'execute') as service`,
    );
    expect(retired.rows[0]).toEqual({ anon: false, authenticated: false, service: false });
  });

  it("saves the applicant's and sponsor's dates of birth with day precision", async () => {
    const ctx = await firm({ sampleMode: false });
    await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const result = await db.query<{ result: Created }>(
      `select public.create_client_matter(
         p_applicant_name => 'Ana Pereira', p_applicant_email => null, p_sponsor_name => 'Luis Pereira', p_sponsor_email => null,
         p_consultant_membership_id => $1, p_applicant_date_of_birth => '1990-05-02', p_sponsor_date_of_birth => '1988-11-30') as result`,
      [ctx.consultantMembership],
    );
    const created = result.rows[0].result;
    expect(created.ok).toBe(true);
    const people = await db.query<{ display_name: string; date_of_birth: string; birth_date: string; birth_date_precision: string; is_minor: boolean }>(
      `select display_name, date_of_birth::text as date_of_birth, birth_date::text as birth_date,
              birth_date_precision::text as birth_date_precision, is_minor
       from public.persons where id = any($1::uuid[]) order by display_name`,
      [[created.applicant_id, created.sponsor_id]],
    );
    expect(people.rows).toEqual([
      { display_name: "Ana Pereira", date_of_birth: "1990-05-02", birth_date: "1990-05-02", birth_date_precision: "day", is_minor: false },
      { display_name: "Luis Pereira", date_of_birth: "1988-11-30", birth_date: "1988-11-30", birth_date_precision: "day", is_minor: false },
    ]);

    // Left out, the dates stay unknown.
    const plain = await create(ctx.manager, ctx.orgId, ["Kofi Mensah", null, null, null, ctx.consultantMembership, null, null]);
    await asMaintenance(db);
    const unknown = await db.query<{ date_of_birth: string | null; birth_date_precision: string | null }>(
      `select date_of_birth, birth_date_precision from public.persons where id = $1`,
      [plain.applicant_id],
    );
    expect(unknown.rows[0]).toEqual({ date_of_birth: null, birth_date_precision: null });
  });

  it("refuses a future or implausible date of birth, and a sponsor date without a sponsor", async () => {
    const ctx = await firm({ sampleMode: false });
    const args = (applicant: string | null, sponsorName: string | null, sponsor: string | null) => [
      "Someone",
      null,
      sponsorName,
      null,
      ctx.consultantMembership,
      null,
      null,
      applicant,
      sponsor,
    ];
    const call = async (values: unknown[]) => {
      await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
      return db.query(`select public.create_client_matter($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date)`, values);
    };
    await expectDbError(() => call(args("2999-01-01", null, null)), /date of birth is not plausible/);
    await expectDbError(() => call(args("1850-01-01", null, null)), /date of birth is not plausible/);
    await expectDbError(() => call(args(null, "Sponsor Person", "2999-01-01")), /date of birth is not plausible/);
    await expectDbError(() => call(args(null, null, "1980-01-01")), /sponsor name is required with a sponsor date of birth/);
    await asMaintenance(db);
    const persons = await db.query<{ n: number }>(`select count(*)::int as n from public.persons where organization_id = $1`, [ctx.orgId]);
    expect(persons.rows[0].n).toBe(0);
  });
});
