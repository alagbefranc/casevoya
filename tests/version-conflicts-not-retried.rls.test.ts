import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, createTestDb, type TestDb } from "./helpers/postgres";

const MIGRATION = "20261023090000";

/** Every function in app and public: its body, settings, security and privileges. */
const SNAPSHOT = `
  select p.oid::regprocedure::text as signature, p.prosrc as body, p.prosecdef as definer,
         coalesce(p.proconfig::text, '') as config, coalesce(p.proacl::text, '') as acl,
         pg_get_function_result(p.oid) as result
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public')
   order by 1`;

type Row = { signature: string; body: string; definer: boolean; config: string; acl: string; result: string };

describe("version conflicts are not retried by the API (40001 → PT409)", () => {
  let db: TestDb;
  let before: Row[];
  let after: Row[];

  beforeAll(async () => {
    db = await createTestDb({ stopBefore: MIGRATION });
    before = (await db.query<Row>(SNAPSHOT)).rows;
    // This migration alone, so later migrations' own changes don't count against it.
    const dir = path.resolve(import.meta.dirname, "../supabase/migrations");
    const file = readdirSync(dir).find((name) => name.startsWith(MIGRATION)) as string;
    await asMaintenance(db);
    await db.exec(readFileSync(path.join(dir, file), "utf8"));
    after = (await db.query<Row>(SNAPSHOT)).rows;
  }, 180_000);

  afterAll(async () => {
    await db?.close();
  });

  it("no function raises SQLSTATE 40001: PostgREST retries that code, so a stale save would stall", () => {
    expect(after.filter((row) => row.body.includes("'40001'")).map((row) => row.signature)).toEqual([]);
  });

  it("changes nothing else: the same functions, with the same bodies but for the code, security, settings and grants", () => {
    expect(after.map((row) => row.signature)).toEqual(before.map((row) => row.signature));
    const changed = after.filter((row, index) => row.body !== before[index].body);
    expect(changed.length).toBeGreaterThanOrEqual(37);
    after.forEach((row, index) => {
      const was = before[index];
      expect({ ...row, body: row.body }).toEqual({ ...was, body: was.body.replaceAll("errcode = '40001'", "errcode = 'PT409'") });
    });
  });
});
