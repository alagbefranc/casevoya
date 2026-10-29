import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Admin portal pages (20261029220000): Usage, Privacy, Sample mode, Migration and Releases reads.
 * Service role only, metadata only. Seeded behaviour is covered by supabase/tests/adm_platform_admin_pages.test.sql.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const CALLS = [
  "public.platform_usage()",
  "public.platform_privacy_requests()",
  "public.platform_sample_overview()",
  "public.platform_migration_jobs()",
  "public.platform_template_releases()",
];

describe("admin page reads", () => {
  it.each(CALLS)("%s is refused to a signed-in non-admin", async (call) => {
    await asMaintenance(db);
    const id = randomUUID();
    await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `u-${id.slice(0, 8)}@example.test`]);
    await asUser(db, { userId: id, aal: "aal2", totpAgeSeconds: 30 });
    await expectDbError(() => db.query(`select ${call}`), /permission denied/);
  });

  it.each(CALLS)("%s returns a page shape to the service role", async (call) => {
    await asServiceRole(db);
    const result = await db.query<{ r: { items: unknown[]; total: number; limit: number; offset: number } }>(`select ${call} as r`);
    expect(Array.isArray(result.rows[0].r.items)).toBe(true);
    expect(typeof Number(result.rows[0].r.total)).toBe("number");
    expect(result.rows[0].r.limit).toBeGreaterThan(0);
  });

  it("validates its filters", async () => {
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.platform_usage(null, false, 'bogus')`), /sort is/);
    await expectDbError(() => db.query(`select public.platform_privacy_requests('bogus')`), /state is/);
    await expectDbError(() => db.query(`select public.platform_migration_jobs('bogus')`), /status is/);
  });
});
