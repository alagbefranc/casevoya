import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261031100000: app.auth_attempts and the service-role auth limit functions
 * (public.auth_attempt_check / auth_attempt_record). Synthetic keys only.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

type Gate = { allowed: boolean; retry_after_seconds: number };

const key = (kind: string) => createHash("sha256").update(`${kind}:${randomUUID()}@example.test`).digest("hex");

async function check(kind: string, hash: string): Promise<Gate> {
  await asServiceRole(db);
  return (await db.query<{ r: Gate }>(`select public.auth_attempt_check($1, $2) as r`, [kind, hash])).rows[0].r;
}

async function record(kind: string, hash: string, failed: boolean) {
  await asServiceRole(db);
  await db.query(`select public.auth_attempt_record($1, $2, $3)`, [kind, hash, failed]);
}

async function rows(hash: string) {
  await asMaintenance(db);
  return (await db.query<{ kind: string; failed: boolean }>(`select kind, failed from app.auth_attempts where key_hash = $1`, [hash])).rows;
}

describe("auth attempt limits", () => {
  it("password: refused at 10 failures in 15 minutes for 15 minutes; successes are not stored", async () => {
    const hash = key("password");
    for (let n = 0; n < 9; n += 1) await record("password", hash, true);
    await record("password", hash, false);
    expect(await check("password", hash)).toEqual({ allowed: true, retry_after_seconds: 0 });
    await record("password", hash, true);
    const refused = await check("password", hash);
    expect(refused.allowed).toBe(false);
    expect(refused.retry_after_seconds).toBeGreaterThan(800);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(900);
    expect(await rows(hash)).toHaveLength(10);
    // Another key is unaffected.
    expect((await check("password", key("password"))).allowed).toBe(true);
  });

  it("otp and totp: refused at 5 failures; failures older than 15 minutes do not count", async () => {
    for (const kind of ["otp", "totp"]) {
      const hash = key(kind);
      for (let n = 0; n < 4; n += 1) await record(kind, hash, true);
      expect((await check(kind, hash)).allowed).toBe(true);
      await record(kind, hash, true);
      expect((await check(kind, hash)).allowed).toBe(false);
      // Kinds are counted separately.
      expect((await check("password", hash)).allowed).toBe(true);
    }
    const old = key("otp");
    await asMaintenance(db);
    await db.query(
      `insert into app.auth_attempts (kind, key_hash, failed, created_at) select 'otp', $1, true, now() - interval '16 minutes' from generate_series(1, 6)`,
      [old],
    );
    expect((await check("otp", old)).allowed).toBe(true);
  });

  it("email_send: 3 sends an hour, then refused until the oldest of the last 3 is an hour old", async () => {
    const hash = key("email_send");
    await asMaintenance(db);
    await db.query(`insert into app.auth_attempts (kind, key_hash, created_at) values ('email_send', $1, now() - interval '50 minutes')`, [hash]);
    await record("email_send", hash, false);
    expect((await check("email_send", hash)).allowed).toBe(true);
    await record("email_send", hash, false);
    const refused = await check("email_send", hash);
    expect(refused.allowed).toBe(false);
    expect(refused.retry_after_seconds).toBeGreaterThan(500);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(600);
  });

  it("prunes rows older than a day when recording", async () => {
    const stale = key("password");
    await asMaintenance(db);
    await db.query(`insert into app.auth_attempts (kind, key_hash, failed, created_at) values ('password', $1, true, now() - interval '2 days')`, [stale]);
    await record("otp", key("otp"), true);
    expect(await rows(stale)).toHaveLength(0);
  });

  it("rejects an unknown kind or a key that is not sha-256 hex", async () => {
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.auth_attempt_check('sms', $1)`, [key("x")]), /kind is password/);
    await expectDbError(() => db.query(`select public.auth_attempt_record('otp', 'person@example.test', true)`), /sha-256/);
  });

  it("is not callable by authenticated or anon, and the table is not readable by them", async () => {
    const hash = key("password");
    await record("password", hash, true);
    await asUser(db, { userId: randomUUID(), aal: "aal2", totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.auth_attempt_check('password', $1)`, [hash]), /permission denied/);
    await expectDbError(() => db.query(`select public.auth_attempt_record('password', $1, false)`, [hash]), /permission denied/);
    await expectDbError(() => db.query(`select * from app.auth_attempts`), /permission denied/);
    await asAnon(db);
    await expectDbError(() => db.query(`select public.auth_attempt_check('password', $1)`, [hash]), /permission denied/);
    await expectDbError(() => db.query(`select public.auth_attempt_record('password', $1, true)`, [hash]), /permission denied/);
    await expectDbError(() => db.query(`select * from app.auth_attempts`), /permission denied/);
    expect(await rows(hash)).toHaveLength(1);
  });
});
