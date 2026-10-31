import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261102110000: recovery codes limited in app.auth_attempts inside consume_recovery_code, and the
 * Supabase Auth MFA verification attempt hook. Synthetic users and codes only.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const GOOD = "AAAA-BBBB-CCCC-DDDD-EEEE";
const WRONG = "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ";

async function userWithCode(): Promise<string> {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `r-${id.slice(0, 8)}@example.test`]);
  await db.query(
    `insert into public.mfa_recovery_codes (user_id, code_hash, batch_id) values ($1, app.hash_recovery_code($2), gen_random_uuid())`,
    [id, GOOD],
  );
  return id;
}

async function consume(userId: string, code: string, sessionId = randomUUID()): Promise<boolean> {
  await asUser(db, { userId, aal: "aal1", sessionId });
  return (await db.query<{ ok: boolean }>(`select public.consume_recovery_code($1) as ok`, [code])).rows[0].ok;
}

async function attempts(kind: string, subject: string) {
  await asMaintenance(db);
  return (await db.query<{ failed: boolean | null; scope_hash: string | null }>(
    `select failed, scope_hash from app.auth_attempts where kind = $1 and key_hash = $2`,
    [kind, sha(`${kind}:${subject}`)],
  )).rows;
}

/** Clears the older per-user lockout row, leaving only the windowed limit. */
async function resetLegacyLockout(userId: string) {
  await asMaintenance(db);
  await db.query(`update public.mfa_recovery_attempts set failures = 0, locked_until = null where user_id = $1`, [userId]);
}

describe("recovery code attempt limit", () => {
  it("a correct code still works after a few failures", async () => {
    const user = await userWithCode();
    expect(await consume(user, WRONG)).toBe(false);
    expect(await consume(user, WRONG)).toBe(false);
    expect(await consume(user, GOOD)).toBe(true);
    expect((await attempts("recovery", user)).map((row) => row.failed)).toEqual([true, true]);
  });

  it("5 failures in 15 minutes refuse even a correct code, keyed on the user, whatever the session", async () => {
    const user = await userWithCode();
    for (let n = 0; n < 5; n += 1) expect(await consume(user, WRONG, randomUUID())).toBe(false);
    await resetLegacyLockout(user);
    expect(await consume(user, GOOD, randomUUID())).toBe(false);
    // The refusal stores nothing more and leaves the code unused.
    expect(await attempts("recovery", user)).toHaveLength(5);
    await asMaintenance(db);
    const unused = await db.query<{ n: number }>(
      `select count(*)::int as n from public.mfa_recovery_codes where user_id = $1 and used_at is null`,
      [user],
    );
    expect(Number(unused.rows[0].n)).toBe(1);

    // Another user is unaffected.
    const other = await userWithCode();
    expect(await consume(other, GOOD)).toBe(true);

    // Once the failures leave the window the code works again.
    await asMaintenance(db);
    await db.query(
      `update app.auth_attempts set created_at = now() - interval '16 minutes' where kind = 'recovery' and key_hash = $1`,
      [sha(`recovery:${user}`)],
    );
    await resetLegacyLockout(user);
    expect(await consume(user, GOOD)).toBe(true);
  });

  it("app.auth_attempts stays unreadable to API roles", async () => {
    const user = await userWithCode();
    await asUser(db, { userId: user, aal: "aal1", sessionId: randomUUID() });
    await expectDbError(() => db.query(`select * from app.auth_attempts`), /permission denied/);
  });
});

describe("MFA verification attempt hook", () => {
  async function hook(event: Record<string, unknown>): Promise<{ decision: string; message?: string }> {
    await asMaintenance(db);
    return (await db.query<{ r: { decision: string; message?: string } }>(
      `select public.hook_mfa_verification_attempt($1::jsonb) as r`,
      [JSON.stringify(event)],
    )).rows[0].r;
  }

  it("counts failures per user and rejects verifications, correct ones too, after 5 in 15 minutes", async () => {
    const user = randomUUID();
    const factor = randomUUID();
    expect(await hook({ user_id: user, factor_id: factor, valid: true })).toEqual({ decision: "continue" });
    for (let n = 0; n < 5; n += 1) {
      expect(await hook({ user_id: user, factor_id: factor, factor_type: "totp", valid: false })).toEqual({ decision: "continue" });
    }
    const rejected = await hook({ user_id: user, factor_id: factor, valid: true });
    expect(rejected.decision).toBe("reject");
    expect(rejected.message).toMatch(/too many attempts/i);
    expect((await hook({ user_id: user, factor_id: factor, valid: false })).decision).toBe("reject");
    const rows = await attempts("mfa_verify", user);
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.failed === true && row.scope_hash === null)).toBe(true);

    // Another user is unaffected; old failures leave the window.
    expect(await hook({ user_id: randomUUID(), factor_id: factor, valid: true })).toEqual({ decision: "continue" });
    await asMaintenance(db);
    await db.query(
      `update app.auth_attempts set created_at = now() - interval '16 minutes' where kind = 'mfa_verify' and key_hash = $1`,
      [sha(`mfa_verify:${user}`)],
    );
    expect(await hook({ user_id: user, factor_id: factor, valid: true })).toEqual({ decision: "continue" });
  });

  it("ignores an event without a usable user id", async () => {
    expect(await hook({ valid: false })).toEqual({ decision: "continue" });
    expect(await hook({ user_id: "not-a-uuid", valid: false })).toEqual({ decision: "continue" });
  });

  it("is not executable by API roles", async () => {
    await asMaintenance(db);
    const grants = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(
      `select has_function_privilege('anon', 'public.hook_mfa_verification_attempt(jsonb)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.hook_mfa_verification_attempt(jsonb)', 'execute') as authenticated,
              has_function_privilege('service_role', 'public.hook_mfa_verification_attempt(jsonb)', 'execute') as service`,
    );
    expect(grants.rows[0]).toEqual({ anon: false, authenticated: false, service: false });
    await asAnon(db);
    await expectDbError(
      () => db.query(`select public.hook_mfa_verification_attempt($1::jsonb)`, [JSON.stringify({ user_id: randomUUID(), valid: false })]),
      /permission denied/,
    );
  });
});
