import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
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

create table if not exists auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  factor_id uuid,
  aal text,
  not_after timestamptz,
  refreshed_at timestamptz,
  user_agent text,
  ip inet,
  tag text
);

create table if not exists auth.mfa_factors (
  id uuid primary key,
  user_id uuid not null references auth.users (id),
  factor_type text not null,
  status text not null
);

create table if not exists auth.webauthn_credentials (
  id uuid primary key,
  user_id uuid not null references auth.users (id)
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

-- Minimal Storage catalog so document migrations can create the private bucket.
-- Hosted Supabase already has these tables; this stub is for the test database only.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
create table if not exists storage.objects (
  id uuid primary key,
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert on storage.objects to authenticated;
grant select, insert, update, delete on storage.objects to service_role;
`;

export type TestDb = PGlite;

// Hosted Supabase grants every new public table, function, and sequence to anon and
// authenticated by default. A migration that forgets to revoke keeps those privileges.
const supabaseDefaultPrivileges = `
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export type TestDbOptions = {
  /** Emulate Supabase's default privileges on the public schema. */
  supabaseDefaultPrivileges?: boolean;
  /**
   * Stop before the first migration whose file name starts with this version (for testing a
   * migration's backfill: seed rows, then `applyMigrationsFrom`).
   */
  stopBefore?: string;
};

function migrationFiles(): string[] {
  return readdirSync(path.join(root, "supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

async function applyMigrations(db: PGlite, files: string[]) {
  const dir = path.join(root, "supabase/migrations");
  for (const file of files) {
    try {
      await db.exec(readFileSync(path.join(dir, file), "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${file}: ${message}`);
    }
  }
}

/** Applies the remaining migrations, from the one whose file name starts with `version`. */
export async function applyMigrationsFrom(db: TestDb, version: string) {
  await asMaintenance(db);
  await applyMigrations(
    db,
    migrationFiles().filter((file) => file >= version),
  );
}

export async function createTestDb(options: TestDbOptions = {}): Promise<TestDb> {
  const db = new PGlite({ extensions: { pgcrypto, btree_gist } });
  await db.exec(harness);
  if (options.supabaseDefaultPrivileges) await db.exec(supabaseDefaultPrivileges);
  const stop = options.stopBefore;
  await applyMigrations(
    db,
    migrationFiles().filter((file) => !stop || file < stop),
  );
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
  /** Seconds since the amr timestamp. Omit for no second-factor method. */
  totpAgeSeconds?: number;
  /** Defaults to totp when totpAgeSeconds is set. */
  amrMethod?: "totp" | "passkey" | "mfa/webauthn" | "mfa/recovery_code";
  sessionId?: string | null;
  /** Absolute unix seconds. Defaults to the database clock. */
  issuedAtSeconds?: number;
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

export async function asAnon(db: TestDb) {
  await asMaintenance(db);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: "anon" })]);
  await db.exec("set role anon");
}

export async function asUser(db: TestDb, session: Session) {
  await db.exec("reset role");
  const now = await db.query<{ epoch: string | number }>(
    `select extract(epoch from statement_timestamp())::bigint as epoch`,
  );
  const epoch = Number(now.rows[0]?.epoch ?? 0);
  const method = session.amrMethod ?? (session.totpAgeSeconds == null ? null : "totp");
  const amr =
    method == null ? [] : [{ method, timestamp: epoch - (session.totpAgeSeconds ?? 0) }];
  const claims = JSON.stringify({
    aal: session.aal ?? "aal1",
    amr,
    sub: session.userId,
    role: "authenticated",
    iat: session.issuedAtSeconds ?? epoch,
    ...(session.sessionId ? { session_id: session.sessionId } : {}),
  });
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [session.userId]);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.query(`select set_config('app.organization_id', $1, false)`, [session.orgId ?? ""]);
  await db.exec("set role authenticated");
}

/**
 * The user's JWT claims under the maintenance role: drives internal functions that are not
 * granted to authenticated (they still run their own auth.uid() and role checks), and sets up
 * rows that only definer workflows write in the app.
 */
export async function asUserInternal(db: TestDb, session: Session) {
  await asUser(db, session);
  await db.exec("reset role");
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
