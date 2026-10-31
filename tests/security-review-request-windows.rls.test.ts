import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261031100100: app.request_windows and the service-role fixed-window counter
 * public.request_window_hit. Synthetic keys only.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

type Hit = { allowed: boolean; retry_after_seconds: number };

const hash = () => createHash("sha256").update(`RL_TEST:${randomUUID()}`).digest("hex");

async function hit(bucket: string, key: string, limit: number, windowSeconds: number): Promise<Hit> {
  await asServiceRole(db);
  return (await db.query<{ r: Hit }>(`select public.request_window_hit($1, $2, $3, $4) as r`, [bucket, key, limit, windowSeconds])).rows[0].r;
}

async function windows(key: string) {
  await asMaintenance(db);
  return (await db.query<{ bucket: string; window_start: string; hits: number }>(
    `select bucket, window_start, hits from app.request_windows where key_hash = $1 order by window_start`,
    [key],
  )).rows;
}

describe("request windows", () => {
  it("allows exactly the limit in a window, then refuses with the time left in the window", async () => {
    const key = hash();
    for (let n = 0; n < 3; n += 1) expect((await hit("RL_AUTH", key, 3, 3600)).allowed).toBe(true);
    const refused = await hit("RL_AUTH", key, 3, 3600);
    expect(refused.allowed).toBe(false);
    expect(refused.retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(3600);
    expect((await hit("RL_AUTH", key, 3, 3600)).allowed).toBe(false);
    const rows = await windows(key);
    expect(rows).toHaveLength(1);
    expect(rows[0].hits).toBe(5);
    // Other buckets and keys are separate.
    expect((await hit("RL_VERIFY", key, 3, 3600)).allowed).toBe(true);
    expect((await hit("RL_AUTH", hash(), 3, 3600)).allowed).toBe(true);
  });

  it("window start is aligned to the window length, and a new window starts from zero", async () => {
    const key = hash();
    expect((await hit("RL_PUBLIC", key, 1, 3600)).allowed).toBe(true);
    expect((await hit("RL_PUBLIC", key, 1, 3600)).allowed).toBe(false);
    await asMaintenance(db);
    const aligned = (await db.query<{ ok: boolean }>(
      `select (extract(epoch from window_start)::bigint % 3600 = 0) as ok from app.request_windows where key_hash = $1`,
      [key],
    )).rows;
    expect(aligned).toEqual([{ ok: true }]);
    // Move the full window into the past: the current window is fresh.
    await db.query(`update app.request_windows set window_start = window_start - interval '1 hour' where key_hash = $1`, [key]);
    const fresh = await hit("RL_PUBLIC", key, 1, 3600);
    expect(fresh.allowed).toBe(true);
    expect(fresh.retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(fresh.retry_after_seconds).toBeLessThanOrEqual(3600);
    expect((await windows(key)).map((row) => row.hits)).toEqual([2, 1]);
  });

  it("occasionally prunes windows older than a day", async () => {
    const stale = hash();
    await asMaintenance(db);
    await db.query(
      `insert into app.request_windows (bucket, key_hash, window_start, hits) values ('RL_AUTH', $1, now() - interval '2 days', 4)`,
      [stale],
    );
    const recent = hash();
    await hit("RL_AUTH", recent, 10_000, 3600);
    let calls = 0;
    while ((await windows(stale)).length > 0 && calls < 2000) {
      await hit("RL_AUTH", recent, 10_000, 3600);
      calls += 1;
    }
    expect(await windows(stale)).toHaveLength(0);
    expect(await windows(recent)).toHaveLength(1);
  }, 120_000);

  it("validates bucket, key hash, limit and window", async () => {
    await asServiceRole(db);
    const q = (bucket: unknown, key: unknown, limit: unknown, windowSeconds: unknown) =>
      db.query(`select public.request_window_hit($1, $2, $3, $4)`, [bucket, key, limit, windowSeconds]);
    await expectDbError(() => q("rl_auth", hash(), 5, 60), /bucket is/);
    await expectDbError(() => q("RL-AUTH", hash(), 5, 60), /bucket is/);
    await expectDbError(() => q("R".repeat(33), hash(), 5, 60), /bucket is/);
    await expectDbError(() => q(null, hash(), 5, 60), /bucket is/);
    await expectDbError(() => q("RL_AUTH", "203.0.113.9", 5, 60), /key hash is sha-256/);
    await expectDbError(() => q("RL_AUTH", hash().toUpperCase(), 5, 60), /key hash is sha-256/);
    await expectDbError(() => q("RL_AUTH", hash(), 0, 60), /limit is between/);
    await expectDbError(() => q("RL_AUTH", hash(), 10_001, 60), /limit is between/);
    await expectDbError(() => q("RL_AUTH", hash(), null, 60), /limit is between/);
    await expectDbError(() => q("RL_AUTH", hash(), 5, 30), /window is/);
    await expectDbError(() => q("RL_AUTH", hash(), 5, null), /window is/);
  });

  it("is not callable by authenticated or anon, and the table is not readable by them", async () => {
    const key = hash();
    await hit("RL_AUTH", key, 5, 60);
    await asUser(db, { userId: randomUUID(), aal: "aal2", totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.request_window_hit('RL_AUTH', $1, 5, 60)`, [key]), /permission denied/);
    await expectDbError(() => db.query(`select * from app.request_windows`), /permission denied/);
    await asAnon(db);
    await expectDbError(() => db.query(`select public.request_window_hit('RL_AUTH', $1, 5, 60)`, [key]), /permission denied/);
    await expectDbError(() => db.query(`select * from app.request_windows`), /permission denied/);
    expect((await windows(key))[0].hits).toBe(1);
  });

  it("the service role cannot touch the table directly", async () => {
    await asServiceRole(db);
    await expectDbError(() => db.query(`select * from app.request_windows`), /permission denied/);
  });
});
