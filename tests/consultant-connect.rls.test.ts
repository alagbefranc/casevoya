import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asServiceRole, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// Public introduction requests (20261107160000). Synthetic rows only. Not a firm lead.

let db: TestDb;
const statement =
  "I agree that Casevoya may read my request and share it with one licensed consultant who can help. Nothing is sent until I press Send.";
const hash = "ab".repeat(32);

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

async function submit(ip = hash, consent = true) {
  await asServiceRole(db);
  const row = await db.query<{ id: string | null }>(
    `select public.submit_consultant_connect(
       'Study in Canada', 'Nigeria', 'ng', 'Africa/Lagos', 'English', 'Rohan', 'rohan@example.com',
       $1, $2, 'find-consent-2026-11-07', $3, 'vitest'
     ) as id`,
    [consent, statement, ip],
  );
  return row.rows[0].id;
}

describe("submit_consultant_connect", () => {
  it("stores status New and refuses anonymous reads", async () => {
    const id = await submit();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await asServiceRole(db);
    const stored = await db.query<{ status: string; code: string; consent: boolean }>(
      `select status, code, consent from public.consultant_connect_requests where id = $1`,
      [id],
    );
    expect(stored.rows[0]).toEqual({ status: "New", code: "NG", consent: true });
    await expectDbError(async () => {
      await asAnon(db);
      await db.query(`select id from public.consultant_connect_requests`);
    }, /permission denied|42501/i);
  });

  it("returns null on the sixth request from one address in the window", async () => {
    const ip = "cd".repeat(32);
    for (let n = 0; n < 5; n += 1) expect(await submit(ip)).toBeTruthy();
    expect(await submit(ip)).toBeNull();
  });

  it("refuses consent that is not true", async () => {
    await expectDbError(() => submit("ef".repeat(32), false), /consent_required/);
  });
});
