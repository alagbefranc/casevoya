import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261024200000_document_upload_limit_read.sql (DOC-02): every member of the firm reads the upload
// limit in force; only the owner, with a step-up, changes it. Synthetic records only.

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
const MB = 1024 * 1024;

async function user() {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `u-${tag()}@example.test`]);
  return id;
}

async function firm() {
  const owner = await user();
  const manager = await user();
  const client = await user();
  await asUser(db, { userId: owner, aal: "aal2", orgId: "", totpAgeSeconds: 0 });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  await asMaintenance(db);
  for (const [userId, role] of [
    [manager, "case_manager"],
    [client, "client"],
  ]) {
    await db.query(`insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, $3::public.org_role, 'active', now(), $4)`, [orgId, userId, role, owner]);
  }
  return { orgId, owner, manager, client };
}

async function limit(userId: string, orgId: string, aal: "aal1" | "aal2" = "aal1") {
  await asUser(db, { userId, aal, orgId });
  return Number((await db.query<{ n: string }>(`select public.document_upload_limit($1)::text as n`, [orgId])).rows[0].n);
}

describe("document upload limit", () => {
  it("reads 25 MB by default for staff and portal users, and the owner's limit once set", async () => {
    const f = await firm();
    expect(await limit(f.client, f.orgId)).toBe(25 * MB);
    expect(await limit(f.manager, f.orgId, "aal2")).toBe(25 * MB);

    await asUser(db, { userId: f.manager, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.set_document_upload_limit($1)`, [10 * MB]), /denied/);
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.set_document_upload_limit($1)`, [10 * MB]);
    expect(await limit(f.client, f.orgId)).toBe(10 * MB);
    // Above 25 MB stays off until larger uploads are validated for the product.
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.set_document_upload_limit($1)`, [30 * MB]), /above 25 MB/);
  });

  it("refuses someone outside the firm", async () => {
    const f = await firm();
    const other = await firm();
    await asUser(db, { userId: other.client, aal: "aal1", orgId: other.orgId });
    await expectDbError(() => db.query(`select public.document_upload_limit($1)`, [f.orgId]), /denied/);
  });
});
