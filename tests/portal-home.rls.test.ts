import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// Client portal Home (20261024090000): "Who is working on it?" names the responsible consultant
// of the client's own matters, and nothing about other matters. Everything here is synthetic.

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

async function createUser(label: string, name: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3::jsonb)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
    JSON.stringify({ display_name: name }),
  ]);
  await db.query(`insert into public.profiles (id, display_name) values ($1, $2) on conflict (id) do update set display_name = excluded.display_name`, [id, name]);
  return id;
}

async function membership(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
    [orgId, userId, role],
  );
  return row.rows[0].id;
}

async function setup() {
  const owner = await createUser("owner", "Synthetic Owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const slug = `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", slug])).rows[0].id;
  const consultant = await createUser("consultant", "Synthetic Consultant");
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant");
  const clientUser = await createUser("client", "Synthetic Client");
  await membership(orgId, clientUser, "client");
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  const personId = (await db.query<{ id: string }>(`insert into public.persons (organization_id, user_id, display_name) values ($1, $2, 'Synthetic Client') returning id`, [orgId, clientUser])).rows[0].id;
  const other = (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name) values ($1, 'Other Client') returning id`, [orgId])).rows[0].id;
  const mine = randomUUID();
  const unassigned = randomUUID();
  const theirs = randomUUID();
  await db.query(
    `insert into public.matters (id, organization_id, title, responsible_consultant_membership_id) values ($1, $4, 'Mine', $5), ($2, $4, 'Unassigned', null), ($3, $4, 'Theirs', $5)`,
    [mine, unassigned, theirs, orgId, consultantMembership],
  );
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $4, 'applicant'), ($1, $3, $4, 'applicant'), ($1, $5, $6, 'applicant')`,
    [orgId, mine, unassigned, personId, theirs, other],
  );
  return { orgId, clientUser, consultantMembership, mine, unassigned, theirs };
}

describe("portal_matter_consultants", () => {
  it("names the consultant on the client's own matters only", async () => {
    const ctx = await setup();
    await asUser(db, { userId: ctx.clientUser, aal: "aal1", orgId: ctx.orgId });
    const rows = (await db.query<{ matter_id: string; consultant_name: string | null }>(`select * from public.portal_matter_consultants($1) order by matter_id`, [ctx.orgId])).rows;
    const byId = new Map(rows.map((row) => [row.matter_id, row.consultant_name]));
    expect(byId.get(ctx.mine)).toBe("Synthetic Consultant");
    expect(byId.has(ctx.unassigned)).toBe(true);
    expect(byId.get(ctx.unassigned)).toBeNull();
    expect(byId.has(ctx.theirs)).toBe(false);
  });

  it("drops the name once the consultant's membership is no longer active", async () => {
    const ctx = await setup();
    await asMaintenance(db);
    await db.query(`update public.memberships set status = 'revoked', revoked_at = now() where id = $1`, [ctx.consultantMembership]);
    await asUser(db, { userId: ctx.clientUser, aal: "aal1", orgId: ctx.orgId });
    const rows = (await db.query<{ matter_id: string; consultant_name: string | null }>(`select * from public.portal_matter_consultants($1)`, [ctx.orgId])).rows;
    expect(rows.find((row) => row.matter_id === ctx.mine)?.consultant_name).toBeNull();
  });

  it("is not callable without signing in", async () => {
    const ctx = await setup();
    await asAnon(db);
    await expectDbError(() => db.query(`select * from public.portal_matter_consultants($1)`, [ctx.orgId]), /permission denied/);
  });
});
