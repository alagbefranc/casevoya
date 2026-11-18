/**
 * Security review 2026-11-18 (20261118100000_persons_login_link_guard.sql): staff cannot add a
 * person that carries another user's sign-in id. Before the guard, that row let a firm run
 * reset_client_two_step against a user of another firm. People without a login are added as
 * before, and maintenance (and SECURITY DEFINER paths) can still link a login.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
  ]);
  return id;
}

async function firm(owner: string) {
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `synthetic-${randomUUID().slice(0, 8)}`,
  ]);
  return created.rows[0].id;
}

describe("persons.user_id is linked only by the database", () => {
  it("refuses a staff insert that carries a sign-in id, and still adds a person without one", async () => {
    const owner = await createUser("owner");
    const victim = await createUser("victim");
    const orgId = await firm(owner);

    await asUser(db, { userId: owner, orgId, aal: "aal2", totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Injected', true, $2)`, [orgId, victim]),
      /portal login is linked when the person accepts/,
    );
    await db.query(`insert into public.persons (organization_id, display_name, is_sample) values ($1, 'No login yet', true)`, [orgId]);

    await asMaintenance(db);
    const none = await db.query<{ n: number }>(`select count(*)::int as n from public.persons where user_id = $1`, [victim]);
    expect(none.rows[0].n).toBe(0);
    const added = await db.query<{ n: number }>(`select count(*)::int as n from public.persons where organization_id = $1 and display_name = 'No login yet' and user_id is null`, [orgId]);
    expect(added.rows[0].n).toBe(1);
    // Maintenance and definer paths (accept_portal_invitation) are not affected.
    const linked = await db.query<{ user_id: string }>(
      `insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Linked by the database', true, $2) returning user_id`,
      [orgId, victim],
    );
    expect(linked.rows[0].user_id).toBe(victim);
  });
});
