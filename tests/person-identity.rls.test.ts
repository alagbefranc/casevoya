import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261024190000_person_identity_history.sql (INT-05): a person's other names, passports and
// addresses as append-only history, and review flags resolved with a note. Synthetic records only.

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

async function staff(userId: string, orgId: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 3600 });
}

async function user() {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `u-${tag()}@example.test`]);
  return id;
}

async function firm() {
  const owner = await user();
  const consultant = await user();
  const manager = await user();
  const assistant = await user();
  const unassigned = await user();
  const applicant = await user();
  await asUser(db, { userId: owner, aal: "aal2", orgId: "", totpAgeSeconds: 0 });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  await asMaintenance(db);
  const add = async (userId: string, role: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
        [orgId, userId, role, owner],
      )
    ).rows[0].id;
  const consultantMembership = await add(consultant, "licensed_consultant");
  const managerMembership = await add(manager, "case_manager");
  const assistantMembership = await add(assistant, "assistant");
  await add(unassigned, "case_manager");
  await add(applicant, "client");
  await db.query(`update public.organizations set sample_mode = true where id = $1`, [orgId]);
  await staff(consultant, orgId);
  const matterId = (await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership])).rows[0].result.id;
  await asMaintenance(db);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [orgId, matterId, managerMembership]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [orgId, matterId, assistantMembership]);
  const personId = (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic Applicant', true, $2) returning id`, [orgId, applicant])).rows[0].id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, personId]);
  return { orgId, owner, consultant, manager, assistant, unassigned, applicant, matterId, personId };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function record(f: Firm, userId: string, kind: string, data: object, replaces: string | null = null, retire = false) {
  await staff(userId, f.orgId);
  return (await db.query<{ id: string }>(`select public.record_person_identity($1, $2, $3::jsonb, $4, $5) as id`, [f.personId, kind, JSON.stringify(data), replaces, retire])).rows[0].id;
}

async function rows(personId: string) {
  await asMaintenance(db);
  return (
    await db.query<{ id: string; kind: string; data: Record<string, unknown>; replaces_id: string | null; retired: boolean }>(
      `select id, kind::text, data, replaces_id, retired from public.person_identity_entries where person_id = $1 order by created_at, id`,
      [personId],
    )
  ).rows;
}

describe("Person identity history", () => {
  it("records names, passports and addresses with their fields checked, and keeps every change as a new row", async () => {
    const f = await firm();
    const alias = await record(f, f.assistant, "name", { name_kind: "alias", name: "  Syn Applicant " });
    await record(f, f.manager, "name", { name_kind: "transliteration", name: "Синтетик", script: "Cyrillic" });
    const passport = await record(f, f.manager, "passport", { country: "ng", number: "a12 345 678", expires_on: "2024-03-03", issued_on: "2019-03-04", current: false });
    await record(f, f.manager, "passport", { country: "CA", number: "GA123456", expires_on: "2033-01-01", current: true });
    await record(f, f.manager, "address", { address: "1 Synthetic Road", country: "CA", from_on: "2020-01-01", to_on: "2022-06-30" });

    const stored = await rows(f.personId);
    expect(stored.find((row) => row.id === alias)?.data).toEqual({ name_kind: "alias", name: "Syn Applicant" });
    expect(stored.find((row) => row.id === passport)?.data).toEqual({ country: "NG", number: "A12345678", issued_on: "2019-03-04", expires_on: "2024-03-03", current: false });

    await expectDbError(() => record(f, f.manager, "name", { name_kind: "transliteration", name: "X" }), /needs its script/);
    await expectDbError(() => record(f, f.manager, "passport", { country: "Nigeria", number: "A1234", expires_on: "2030-01-01" }), /two-letter/);
    await expectDbError(() => record(f, f.manager, "passport", { country: "NG", number: "A1234" }), /expiry date/);
    await expectDbError(() => record(f, f.manager, "address", { address: "2 Road", from_on: "2022-01-01", to_on: "2021-01-01" }), /before the start/);
    await expectDbError(() => record(f, f.manager, "address", { address: "2 Road", from_on: "soon" }), /full day/);

    // A change and a removal are new rows; the old rows stay as they were.
    const changed = await record(f, f.manager, "name", { name_kind: "alias", name: "Syn A. Applicant" }, alias);
    await expectDbError(() => record(f, f.manager, "name", { name_kind: "alias", name: "Again" }, alias), /already changed/);
    const removed = await record(f, f.manager, "name", {}, changed, true);
    const after = await rows(f.personId);
    expect(after.find((row) => row.id === alias)?.data).toEqual({ name_kind: "alias", name: "Syn Applicant" });
    expect(after.find((row) => row.id === removed)).toMatchObject({ retired: true, replaces_id: changed, data: { name: "Syn A. Applicant" } });
    await expectDbError(() => record(f, f.manager, "passport", { country: "NG", number: "A1234", expires_on: "2030-01-01" }, alias), /not on this person/);

    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.person_identity_entries set retired = true where id = $1`, [alias]), /append only/);
    await expectDbError(() => db.query(`delete from public.person_identity_entries where id = $1`, [alias]), /append only/);
    const audit = (await db.query<{ action: string; context: Record<string, unknown> }>(`select action, context from public.audit_log where object_id = $1`, [passport])).rows;
    expect(audit.map((row) => row.action)).toContain("person.identity_added");
    expect(JSON.stringify(audit)).not.toContain("A12345678");
  });

  it("is written and read only by staff who can write the person, never the client or staff off the matter", async () => {
    const f = await firm();
    await record(f, f.manager, "passport", { country: "NG", number: "A12345678", expires_on: "2024-03-03" });
    await staff(f.unassigned, f.orgId);
    await expectDbError(() => db.query(`select public.record_person_identity($1, 'name', '{"name_kind":"alias","name":"X"}'::jsonb)`, [f.personId]), /denied/);
    expect((await db.query(`select id from public.person_identity_entries where person_id = $1`, [f.personId])).rows).toHaveLength(0);
    await asUser(db, { userId: f.applicant, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.record_person_identity($1, 'name', '{"name_kind":"alias","name":"X"}'::jsonb)`, [f.personId]), /denied/);
    expect((await db.query(`select id from public.person_identity_entries where person_id = $1`, [f.personId])).rows).toHaveLength(0);
    await staff(f.assistant, f.orgId);
    expect((await db.query(`select id from public.person_identity_entries where person_id = $1`, [f.personId])).rows).toHaveLength(1);
    // Another firm's staff see nothing.
    const other = await firm();
    await staff(other.manager, other.orgId);
    expect((await db.query(`select id from public.person_identity_entries where person_id = $1`, [f.personId])).rows).toHaveLength(0);
  });

  it("resolves a flag once, with a note, by a reviewer role; the resolution is audited and kept", async () => {
    const f = await firm();
    const key = "overlap:a1:a2";
    await staff(f.assistant, f.orgId);
    await expectDbError(() => db.query(`select public.resolve_person_flag($1, $2, 'Addresses overlap', 'Moved twice')`, [f.personId, key]), /denied/);
    await staff(f.manager, f.orgId);
    await expectDbError(() => db.query(`select public.resolve_person_flag($1, $2, 'Addresses overlap', '  ')`, [f.personId, key]), /say why/);
    const id = (await db.query<{ id: string }>(`select public.resolve_person_flag($1, $2, 'Addresses overlap', ' Kept the old flat during the move ') as id`, [f.personId, key])).rows[0].id;
    await expectDbError(() => db.query(`select public.resolve_person_flag($1, $2, 'Addresses overlap', 'Again')`, [f.personId, key]), /already resolved/);
    await asMaintenance(db);
    const stored = (await db.query<{ note: string; created_by: string }>(`select note, created_by from public.person_flag_resolutions where id = $1`, [id])).rows[0];
    expect(stored).toEqual({ note: "Kept the old flat during the move", created_by: f.manager });
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'person.flag_resolved'`, [id])).rows).toHaveLength(1);
    await expectDbError(() => db.query(`delete from public.person_flag_resolutions where id = $1`, [id]), /append only/);
  });
});
