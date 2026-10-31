import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261031100000: app.auth_attempts and the service-role auth limit functions
 * (public.auth_attempt_reserve / auth_attempt_resolve). Synthetic keys only.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

type Gate = { allowed: boolean; attempt_id: string | null; retry_after_seconds: number };

const hash = () => createHash("sha256").update(`${randomUUID()}@example.test`).digest("hex");

async function reserve(kind: string, key: string, scope: string | null): Promise<Gate> {
  await asServiceRole(db);
  return (await db.query<{ r: Gate }>(`select public.auth_attempt_reserve($1, $2, $3) as r`, [kind, key, scope])).rows[0].r;
}

async function resolve(id: string | null, failed: boolean) {
  await asServiceRole(db);
  await db.query(`select public.auth_attempt_resolve($1, $2)`, [id, failed]);
}

async function rows(key: string) {
  await asMaintenance(db);
  return (await db.query<{ id: string; kind: string; scope_hash: string | null; failed: boolean | null }>(
    `select id, kind, scope_hash, failed from app.auth_attempts where key_hash = $1`,
    [key],
  )).rows;
}

/** Inserts counted rows directly (failed true), each with its own scope unless one is given. */
async function seed(kind: string, key: string, count: number, age: string, scope?: string | null) {
  await asMaintenance(db);
  await db.query(
    `insert into app.auth_attempts (kind, key_hash, scope_hash, failed, created_at)
     select $1, $2, case when $1 = 'totp' then null else coalesce($3, md5(random()::text) || md5(random()::text)) end, true, now() - $5::interval
     from generate_series(1, $4::integer)`,
    [kind, key, scope ?? null, count, age],
  );
}

describe("auth attempt reservations", () => {
  it("pending reservations count, so parallel attempts cannot pass the limit; a refusal stores nothing", async () => {
    const key = hash();
    const scope = hash();
    const ids: (string | null)[] = [];
    for (let n = 0; n < 10; n += 1) {
      const gate = await reserve("password", key, scope);
      expect(gate.allowed).toBe(true);
      expect(gate.attempt_id).toMatch(/^[0-9a-f-]{36}$/);
      ids.push(gate.attempt_id);
    }
    const refused = await reserve("password", key, scope);
    expect(refused).toMatchObject({ allowed: false, attempt_id: null });
    expect(refused.retry_after_seconds).toBeGreaterThan(800);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(900);
    expect(await rows(key)).toHaveLength(10);
    expect((await rows(key)).every((row) => row.failed === null)).toBe(true);
    // Successes free the slots again.
    await resolve(ids[0], false);
    await resolve(ids[1], false);
    expect((await reserve("password", key, scope)).allowed).toBe(true);
  });

  it("password: 10 failures lock one (email, address); past 50 for the email each address gets 3, never zero", async () => {
    const key = hash();
    const scopeA = hash();
    const scopeB = hash();
    for (let n = 0; n < 10; n += 1) {
      const gate = await reserve("password", key, scopeA);
      await resolve(gate.attempt_id, true);
    }
    expect((await reserve("password", key, scopeA)).allowed).toBe(false);
    const other = await reserve("password", key, scopeB);
    expect(other.allowed).toBe(true);
    await resolve(other.attempt_id, false);
    // 50 counted failures for the email across addresses: the email alone does not refuse.
    await seed("password", key, 40, "1 minute");
    const fresh = hash();
    const owner = await reserve("password", key, fresh);
    expect(owner.allowed).toBe(true);
    await resolve(owner.attempt_id, false);
    // ...but an address is refused after 3 failures instead of 10.
    await seed("password", key, 3, "1 minute", scopeB);
    expect((await reserve("password", key, scopeB)).allowed).toBe(false);
    expect((await reserve("password", key, scopeA)).allowed).toBe(false);
    expect((await reserve("password", key, hash())).allowed).toBe(true);
    // Kinds and other emails are separate.
    expect((await reserve("otp", key, scopeB)).allowed).toBe(true);
    expect((await reserve("password", hash(), scopeB)).allowed).toBe(true);
  });

  it("retry_after_seconds comes from the oldest counted row that must leave the window", async () => {
    const key = hash();
    const scope = hash();
    await seed("password", key, 2, "14 minutes", scope);
    await seed("password", key, 8, "1 minute", scope);
    const refused = await reserve("password", key, scope);
    expect(refused.allowed).toBe(false);
    // 10 counted from this address, limit 10: the oldest (14 minutes old) must leave, about 1 minute from now.
    expect(refused.retry_after_seconds).toBeGreaterThan(0);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(60);

    // Past the per-email limit the tighter per-address limit sets the wait.
    const busy = hash();
    const busyScope = hash();
    await seed("password", busy, 50, "1 minute");
    await seed("password", busy, 1, "14 minutes", busyScope);
    await seed("password", busy, 2, "1 minute", busyScope);
    const tight = await reserve("password", busy, busyScope);
    expect(tight.allowed).toBe(false);
    expect(tight.retry_after_seconds).toBeLessThanOrEqual(60);
  });

  it("otp: 5 per (email, address); past 20 per email each address gets 2; failures older than 15 minutes do not count", async () => {
    const key = hash();
    const scope = hash();
    await seed("otp", key, 5, "1 minute", scope);
    expect((await reserve("otp", key, scope)).allowed).toBe(false);
    expect((await reserve("otp", key, hash())).allowed).toBe(true);
    const busy = hash();
    const busyScope = hash();
    await seed("otp", busy, 20, "1 minute");
    expect((await reserve("otp", busy, hash())).allowed).toBe(true);
    await seed("otp", busy, 2, "1 minute", busyScope);
    expect((await reserve("otp", busy, busyScope)).allowed).toBe(false);
    const old = hash();
    await seed("otp", old, 30, "16 minutes");
    expect((await reserve("otp", old, hash())).allowed).toBe(true);
  });

  it("totp: 5 per user, no scope", async () => {
    const key = hash();
    for (let n = 0; n < 4; n += 1) await resolve((await reserve("totp", key, null)).attempt_id, true);
    const fifth = await reserve("totp", key, null);
    expect(fifth.allowed).toBe(true);
    expect((await reserve("totp", key, null)).allowed).toBe(false);
    expect((await rows(key)).every((row) => row.scope_hash === null)).toBe(true);
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.auth_attempt_reserve('totp', $1, $2)`, [hash(), hash()]), /no scope hash/);
  });

  it("email_send: 3 per (recipient, address) and 10 per recipient an hour; only sends kept by resolve count", async () => {
    const key = hash();
    const scope = hash();
    await asMaintenance(db);
    await db.query(
      `insert into app.auth_attempts (kind, key_hash, scope_hash, failed, created_at) values ('email_send', $1, $2, true, now() - interval '50 minutes')`,
      [key, scope],
    );
    // An attempt where nothing was sent is deleted and does not count.
    await resolve((await reserve("email_send", key, scope)).attempt_id, false);
    await resolve((await reserve("email_send", key, scope)).attempt_id, true);
    await resolve((await reserve("email_send", key, scope)).attempt_id, true);
    const refused = await reserve("email_send", key, scope);
    expect(refused.allowed).toBe(false);
    expect(refused.retry_after_seconds).toBeGreaterThan(500);
    expect(refused.retry_after_seconds).toBeLessThanOrEqual(600);
    expect(await rows(key)).toHaveLength(3);
    // Another address may still send, until 10 for the recipient.
    expect((await reserve("email_send", key, hash())).allowed).toBe(true);
    const busy = hash();
    await seed("email_send", busy, 10, "30 minutes");
    expect((await reserve("email_send", busy, hash())).allowed).toBe(false);
  });

  it("resolve: failed keeps the row counted, success deletes a fresh pending row; resolved and stale rows are final", async () => {
    const key = hash();
    const scope = hash();
    const failed = await reserve("otp", key, scope);
    await resolve(failed.attempt_id, true);
    await resolve(failed.attempt_id, false);
    expect((await rows(key)).map((row) => row.failed)).toEqual([true]);

    const ok = await reserve("otp", key, scope);
    await resolve(ok.attempt_id, false);
    expect(await rows(key)).toHaveLength(1);

    // An unresolved reservation older than 2 minutes counts as a failure and can no longer be removed.
    const stale = await reserve("otp", key, scope);
    await asMaintenance(db);
    await db.query(`update app.auth_attempts set created_at = now() - interval '3 minutes' where id = $1`, [stale.attempt_id]);
    await resolve(stale.attempt_id, false);
    expect(await rows(key)).toHaveLength(2);
    await seed("otp", key, 3, "1 minute", scope);
    expect((await reserve("otp", key, scope)).allowed).toBe(false);
  });

  it("prunes rows older than a day when reserving", async () => {
    const stale = hash();
    await seed("password", stale, 1, "2 days");
    await reserve("otp", hash(), hash());
    expect(await rows(stale)).toHaveLength(0);
  });

  it("rejects an unknown kind, hashes that are not sha-256 hex, and a missing outcome", async () => {
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.auth_attempt_reserve('sms', $1, $2)`, [hash(), hash()]), /kind is password/);
    await expectDbError(() => db.query(`select public.auth_attempt_reserve('otp', 'person@example.test', $1)`, [hash()]), /key hash is sha-256/);
    await expectDbError(() => db.query(`select public.auth_attempt_reserve('password', $1, null)`, [hash()]), /scope hash is sha-256/);
    await expectDbError(() => db.query(`select public.auth_attempt_resolve($1, null)`, [randomUUID()]), /outcome are required/);
  });

  it("is not callable by authenticated or anon, and the table is not readable by them", async () => {
    const key = hash();
    const gate = await reserve("password", key, hash());
    await asUser(db, { userId: randomUUID(), aal: "aal2", totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.auth_attempt_reserve('password', $1, $2)`, [key, hash()]), /permission denied/);
    await expectDbError(() => db.query(`select public.auth_attempt_resolve($1, false)`, [gate.attempt_id]), /permission denied/);
    await expectDbError(() => db.query(`select * from app.auth_attempts`), /permission denied/);
    await asAnon(db);
    await expectDbError(() => db.query(`select public.auth_attempt_reserve('password', $1, $2)`, [key, hash()]), /permission denied/);
    await expectDbError(() => db.query(`select public.auth_attempt_resolve($1, false)`, [gate.attempt_id]), /permission denied/);
    await expectDbError(() => db.query(`select * from app.auth_attempts`), /permission denied/);
    expect(await rows(key)).toHaveLength(1);
  });
});
