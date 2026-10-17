import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = path.resolve(import.meta.dirname, "../..");

const harness = `
create schema if not exists extensions;
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb;
$$;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$roles$;

-- Supabase grants these. auth.uid() / auth.jwt() are called from invoker triggers.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
`;

export type TestDb = PGlite;

export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(harness);
  const dir = path.join(root, "supabase/migrations");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(path.join(dir, file), "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${file}: ${message}`);
    }
  }
  const original = db.query.bind(db);
  db.query = (async (query: string, params?: unknown[]) => {
    try {
      return await original(query, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\nSQL: ${query.slice(0, 400)}`);
    }
  }) as typeof db.query;
  return db;
}

export type Session = {
  userId: string;
  aal?: "aal1" | "aal2";
  orgId?: string | null;
  /** Seconds since the TOTP amr timestamp. Omit for no TOTP method. */
  totpAgeSeconds?: number;
};

export async function asMaintenance(db: TestDb) {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  await db.query(`select set_config('app.organization_id', '', false)`);
}

export async function asServiceRole(db: TestDb) {
  await db.exec("reset role");
  const claims = JSON.stringify({ role: "service_role" });
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.query(`select set_config('app.organization_id', '', false)`);
  await db.exec("set role service_role");
}

export async function asUser(db: TestDb, session: Session) {
  await db.exec("reset role");
  const now = await db.query<{ epoch: string | number }>(
    `select extract(epoch from statement_timestamp())::bigint as epoch`,
  );
  const epoch = Number(now.rows[0]?.epoch ?? 0);
  const amr =
    session.totpAgeSeconds == null
      ? []
      : [{ method: "totp", timestamp: epoch - session.totpAgeSeconds }];
  const claims = JSON.stringify({
    aal: session.aal ?? "aal1",
    amr,
    sub: session.userId,
    role: "authenticated",
  });
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [session.userId]);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.query(`select set_config('app.organization_id', $1, false)`, [session.orgId ?? ""]);
  await db.exec("set role authenticated");
}

export async function expectDbError(run: () => Promise<unknown>, pattern: RegExp) {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!pattern.test(message)) {
      throw new Error(`expected ${pattern}, received: ${message}`);
    }
    return;
  }
  throw new Error(`expected database error matching ${pattern}`);
}

export function countOf(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}
