import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * WhatsApp / Zernio binding (20261030210000_whatsapp_binding_server_only.sql): the profile and
 * account ids are written by the server only (service role, after the owner's step-up check),
 * a profile id belongs to one firm, and an account id held by another firm is refused.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().slice(0, 8);

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${tag()}@example.test`,
  ]);
  return id;
}

async function firm() {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultant = await createUser("consultant");
  await asMaintenance(db);
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, 'licensed_consultant', 'active', now())`,
    [orgId, consultant],
  );
  return { orgId, owner, consultant };
}

type Firm = Awaited<ReturnType<typeof firm>>;
const asOwner = (f: Firm) => asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 60 });

async function row(f: Firm) {
  await asMaintenance(db);
  const r = await db.query<{ zernio_profile_id: string | null; zernio_account_id: string | null; status: string; connected_by: string | null }>(
    `select zernio_profile_id, zernio_account_id, status, connected_by from public.firm_whatsapp_accounts where organization_id = $1`,
    [f.orgId],
  );
  return r.rows[0];
}

describe("WhatsApp binding is server-only", () => {
  it("refuses the binding RPCs to the firm owner's own session", async () => {
    const f = await firm();
    await asOwner(f);
    expect((await db.query<{ ok: boolean }>(`select public.assert_firm_owner_step_up($1) as ok`, [f.orgId])).rows[0].ok).toBe(true);
    await expectDbError(() => db.query(`select public.save_firm_zernio_profile($1, $2)`, [f.orgId, `p${tag()}`]), /permission denied/);
    await expectDbError(() => db.query(`select public.save_firm_zernio_profile($1, $2, $3)`, [f.orgId, `p${tag()}`, f.owner]), /permission denied/);
    await expectDbError(() => db.query(`select public.connect_firm_whatsapp($1, $2, null)`, [f.orgId, `a${tag()}`]), /permission denied/);
    await expectDbError(
      () => db.query(`select public.connect_firm_whatsapp($1, $2, null, false, $3)`, [f.orgId, `a${tag()}`, f.owner]),
      /permission denied/,
    );
    expect(await row(f)).toBeUndefined();
  });

  it("lets the service role bind for a named firm owner and records them", async () => {
    const f = await firm();
    const profile = `p${tag()}`;
    const account = `a${tag()}`;
    await asServiceRole(db);
    // The actor must be an active firm owner of that firm.
    await expectDbError(() => db.query(`select public.save_firm_zernio_profile($1, $2, $3)`, [f.orgId, profile, f.consultant]), /step-up is required/);
    await expectDbError(() => db.query(`select public.save_firm_zernio_profile($1, $2, $3)`, [f.orgId, profile, randomUUID()]), /step-up is required/);
    await db.query(`select public.save_firm_zernio_profile($1, $2, $3)`, [f.orgId, profile, f.owner]);
    await expectDbError(
      () => db.query(`select public.connect_firm_whatsapp($1, $2, null, false, $3)`, [f.orgId, account, f.consultant]),
      /step-up is required/,
    );
    await db.query(`select public.connect_firm_whatsapp($1, $2, '+1 431 555 0000', false, $3)`, [f.orgId, account, f.owner]);
    expect(await row(f)).toEqual({ zernio_profile_id: profile, zernio_account_id: account, status: "connected", connected_by: f.owner });
  });

  it("keeps a Zernio profile id to one firm", async () => {
    const a = await firm();
    const b = await firm();
    const profile = `p${tag()}`;
    await asServiceRole(db);
    await db.query(`select public.save_firm_zernio_profile($1, $2, $3)`, [a.orgId, profile, a.owner]);
    await expectDbError(() => db.query(`select public.save_firm_zernio_profile($1, $2, $3)`, [b.orgId, profile, b.owner]), /another firm/);
    // The unique index holds even for a direct write.
    await asMaintenance(db);
    await expectDbError(
      () => db.query(`insert into public.firm_whatsapp_accounts (organization_id, zernio_profile_id) values ($1, $2)`, [b.orgId, profile]),
      /duplicate key|unique/,
    );
    expect(await row(b)).toBeUndefined();
  });

  it("refuses an account id held by another firm unless that firm disconnected it", async () => {
    const a = await firm();
    const b = await firm();
    const account = `a${tag()}`;
    await asServiceRole(db);
    await db.query(`select public.save_firm_zernio_profile($1, $2, $3)`, [a.orgId, `p${tag()}`, a.owner]);
    await db.query(`select public.save_firm_zernio_profile($1, $2, $3)`, [b.orgId, `p${tag()}`, b.owner]);
    await db.query(`select public.connect_firm_whatsapp($1, $2, null, false, $3)`, [a.orgId, account, a.owner]);
    await expectDbError(() => db.query(`select public.connect_firm_whatsapp($1, $2, null, false, $3)`, [b.orgId, account, b.owner]), /another firm/);
    // A pending row still holding the id (not connected) keeps it too.
    await asMaintenance(db);
    await db.query(`update public.firm_whatsapp_accounts set status = 'pending' where organization_id = $1`, [a.orgId]);
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.connect_firm_whatsapp($1, $2, null, false, $3)`, [b.orgId, account, b.owner]), /another firm/);
    await asMaintenance(db);
    await expectDbError(
      () => db.query(`update public.firm_whatsapp_accounts set zernio_account_id = $2 where organization_id = $1`, [b.orgId, account]),
      /duplicate key|unique/,
    );
    await db.query(`update public.firm_whatsapp_accounts set status = 'connected' where organization_id = $1`, [a.orgId]);
    expect((await row(b)).zernio_account_id).toBeNull();
    // Once firm A's owner disconnects, the server may bind the verified account to firm B.
    await asOwner(a);
    await db.query(`select public.disconnect_firm_whatsapp($1)`, [a.orgId]);
    await asServiceRole(db);
    await db.query(`select public.connect_firm_whatsapp($1, $2, null, false, $3)`, [b.orgId, account, b.owner]);
    expect((await row(b)).zernio_account_id).toBe(account);
    expect((await row(a)).zernio_account_id).toBeNull();
  });

  it("grants the binding functions to the service role only", async () => {
    await asMaintenance(db);
    const grants = await db.query<{ fn: string; anon: boolean; authed: boolean; service: boolean }>(
      `select p.oid::regprocedure::text as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed,
              has_function_privilege('service_role', p.oid, 'execute') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname = 'public' and p.proname in ('save_firm_zernio_profile', 'connect_firm_whatsapp'))
          or (n.nspname = 'app' and p.proname in ('save_firm_zernio_profile_core', 'connect_firm_whatsapp_core', 'require_active_firm_owner'))`,
    );
    const publicFns = grants.rows.filter((r) => r.fn.startsWith("save_firm") || r.fn.startsWith("connect_firm") || r.fn.startsWith("public."));
    expect(publicFns).toHaveLength(4);
    expect(publicFns.every((r) => !r.anon && !r.authed && r.service)).toBe(true);
    expect(grants.rows.every((r) => !r.anon && !r.authed)).toBe(true);
    const assert = await db.query<{ anon: boolean; authed: boolean }>(
      `select has_function_privilege('anon', 'public.assert_firm_owner_step_up(uuid)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.assert_firm_owner_step_up(uuid)', 'execute') as authed`,
    );
    expect(assert.rows[0]).toEqual({ anon: false, authed: true });
  });

  it("keeps the operator's sandbox link working for the service role", async () => {
    const f = await firm();
    const sandbox = `sbx${tag()}`;
    await asOwner(f);
    await expectDbError(() => db.query(`select public.connect_firm_whatsapp($1, $2, '+1 555 0100', true)`, [f.orgId, sandbox]), /permission denied/);
    await asServiceRole(db);
    await db.query(`select public.connect_firm_whatsapp($1::uuid, $2, $3, true)`, [f.orgId, sandbox, "+1 555 0100"]);
    expect(await row(f)).toEqual({ zernio_profile_id: null, zernio_account_id: sandbox, status: "connected", connected_by: null });
  });
});
