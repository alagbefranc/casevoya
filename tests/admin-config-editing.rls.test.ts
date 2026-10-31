import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261101130000_admin_config_editing: owner-only Config editing from the admin portal. Rules per
 * setting kind, typed confirmation for critical switches, version checks, change history with a
 * one-step revert, audit rows, and feature flags with per-firm overrides. Synthetic users only.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 8);

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `${label}-${tag()}@example.test`]);
  return id;
}

async function platformAdmin(role: "owner" | "operator" | "viewer") {
  const id = await createUser(role);
  await asMaintenance(db);
  await db.query(`insert into public.platform_admins (user_id, note, role) values ($1, $2, $3)`, [id, `Synthetic ${role}`, role]);
  return id;
}

const fresh = (userId: string, orgId: string | null = null) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
const stale = (userId: string) => asUser(db, { userId, aal: "aal2", totpAgeSeconds: 3600 });

async function one<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, params)).rows[0].r;
}

async function version(key: string) {
  await asMaintenance(db);
  return Number((await db.query<{ version: number }>(`select version from public.product_settings where key = $1`, [key])).rows[0].version);
}

async function value(key: string) {
  await asMaintenance(db);
  return (await db.query<{ value: Record<string, unknown> }>(`select value from public.product_settings where key = $1`, [key])).rows[0].value;
}

type Change = { change_id: string; before: unknown; after: unknown; version?: number };
const setSetting = (key: string, v: unknown, ver: number, confirm: string | null = null, reason = "Synthetic test") =>
  one<Change>(`public.admin_config_set_setting($1, $2::jsonb, $3, $4, $5)`, [key, JSON.stringify(v), ver, reason, confirm]);

async function firm() {
  const owner = await createUser("firm-owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  return { owner, orgId };
}

describe("admin config editing", () => {
  it("seeds rules only for safe settings and leaves legal text, plans and prices read-only", async () => {
    await asMaintenance(db);
    const keys = (await db.query<{ key: string }>(`select key from public.product_setting_rules`)).rows.map((r) => r.key);
    expect(keys).toContain("platform.config_probe");
    expect(keys).toContain("trial.duration");
    for (const k of ["agreements.esign_consent", "subscription.plans", "subscription.stripe_prices", "email.from_address", "email.inbound_domain"]) expect(keys).not.toContain(k);
    const critical = (await db.query<{ key: string }>(`select key from public.product_setting_rules where danger = 'critical' order by key`)).rows.map((r) => r.key);
    expect(critical).toEqual(["documents.accept_structural_inspection", "documents.large_uploads_enabled"]);
  });

  it("lets only a stepped-up platform owner change a setting", async () => {
    const operator = await platformAdmin("operator");
    const viewer = await platformAdmin("viewer");
    const owner = await platformAdmin("owner");
    const outsider = await createUser("outsider");
    const ver = await version("platform.config_probe");
    for (const who of [operator, viewer, outsider]) {
      await fresh(who);
      await expectDbError(() => setSetting("platform.config_probe", true, ver), /owners|step-up/);
    }
    await stale(owner);
    await expectDbError(() => setSetting("platform.config_probe", true, ver), /step-up/);
    await asAnon(db);
    await expectDbError(() => setSetting("platform.config_probe", true, ver), /permission denied/);
    await fresh(owner);
    const out = await setSetting("platform.config_probe", true, ver);
    expect(out).toMatchObject({ before: { enabled: false }, after: { enabled: true }, version: ver + 1 });
    expect(await value("platform.config_probe")).toEqual({ enabled: true });

    await asMaintenance(db);
    const audit = (await db.query<{ action: string; actor_user_id: string; context: Record<string, unknown> }>(
      `select action, actor_user_id, context from public.audit_log where object_id = $1`, [out.change_id])).rows;
    expect(audit[0]).toMatchObject({ action: "product.setting_changed", actor_user_id: owner, context: { key: "platform.config_probe", before: { enabled: false }, after: { enabled: true } } });

    // One-step revert puts the old value back and is itself recorded.
    await fresh(owner);
    const back = await one<Change>(`public.admin_config_revert($1, $2)`, [out.change_id, "Revert synthetic"]);
    expect(back).toMatchObject({ before: { enabled: true }, after: { enabled: false } });
    expect(await value("platform.config_probe")).toEqual({ enabled: false });
    await fresh(owner);
    await expectDbError(() => one(`public.admin_config_revert($1, $2)`, [out.change_id, "Twice"]), /latest change/);
  });

  it("validates each kind and refuses stale versions and migration-only keys", async () => {
    const owner = await platformAdmin("owner");
    await fresh(owner);
    let ver = await version("email.inbound_hourly_limit");
    await fresh(owner);
    await expectDbError(() => setSetting("email.inbound_hourly_limit", 0, ver), /whole number from 1 to 1000/);
    await expectDbError(() => setSetting("email.inbound_hourly_limit", 12.5, ver), /whole number/);
    await expectDbError(() => setSetting("email.inbound_hourly_limit", "40", ver), /is a number/);
    await expectDbError(() => setSetting("email.inbound_hourly_limit", 40, ver - 1), /stale version/);
    const before = await value("email.inbound_hourly_limit");
    await fresh(owner);
    await expectDbError(() => setSetting("email.inbound_hourly_limit", before.messages, ver), /already the value/);
    await setSetting("email.inbound_hourly_limit", 40, ver);
    expect(await value("email.inbound_hourly_limit")).toEqual({ messages: 40 });

    ver = await version("licence.manual_check_target");
    await fresh(owner);
    await expectDbError(() => setSetting("licence.manual_check_target", { unit: "days", count: 2 }, ver), /business_days/);
    await expectDbError(() => setSetting("licence.manual_check_target", { unit: "business_days", count: 0 }, ver), /1 to 3650/);
    await setSetting("licence.manual_check_target", { unit: "business_days", count: 2 }, ver);

    ver = await version("documents.max_upload_bytes");
    await fresh(owner);
    await setSetting("documents.max_upload_bytes", 52428800, ver);
    expect(await value("documents.max_upload_bytes")).toMatchObject({ bytes: 52428800, ceiling_bytes: 104857600 });

    const planVersion = await version("subscription.plans");
    await fresh(owner);
    await expectDbError(() => setSetting("subscription.plans", { x: 1 }, planVersion), /reviewed migration/);
    await fresh(owner);
    await expectDbError(() => setSetting("agreements.esign_consent", "x", 1), /reviewed migration/);
    await fresh(owner);
    await expectDbError(() => setSetting("nope.key", true, 1), /unknown product setting/);
  });

  it("supports enum and text rules", async () => {
    await asMaintenance(db);
    await db.query(`insert into public.product_settings (key, value, description) values ('test.mode', '{"mode":"a","label":"x"}', 'Synthetic')`);
    await db.query(`insert into public.product_setting_rules (key, kind, field, choices) values ('test.mode', 'enum', 'mode', array['a','b'])`);
    await db.query(`insert into public.product_settings (key, value, description) values ('test.label', '{"label":"x"}', 'Synthetic')`);
    await db.query(`insert into public.product_setting_rules (key, kind, field, max_length, pattern) values ('test.label', 'text', 'label', 10, '^[a-z ]+$')`);
    const owner = await platformAdmin("owner");
    await fresh(owner);
    await expectDbError(() => setSetting("test.mode", "c", 1), /one of a, b/);
    await setSetting("test.mode", "b", 1);
    await fresh(owner);
    await expectDbError(() => setSetting("test.label", "much too long text", 1), /1 to 10/);
    await expectDbError(() => setSetting("test.label", "Bad1", 1), /expected format/);
    await setSetting("test.label", "  ok now ", 1);
    expect(await value("test.label")).toEqual({ label: "ok now" });
  });

  it("requires the typed key for a critical switch but reverts it in one step", async () => {
    const owner = await platformAdmin("owner");
    const key = "documents.large_uploads_enabled";
    const ver = await version(key);
    await fresh(owner);
    await expectDbError(() => setSetting(key, true, ver), /type the setting key/);
    await expectDbError(() => setSetting(key, true, ver, "documents.large_uploads"), /type the setting key/);
    const out = await setSetting(key, true, ver, key);
    await fresh(owner);
    await one(`public.admin_config_revert($1, $2)`, [out.change_id, "Back off"]);
    expect(await value(key)).toEqual({ enabled: false });
  });

  it("runs feature flags with per-firm overrides that the app reads", async () => {
    const owner = await platformAdmin("owner");
    const { owner: firmOwner, orgId } = await firm();
    const { orgId: otherOrg } = await firm();
    const read = async (org: string) => {
      await asUser(db, { userId: firmOwner, orgId: org });
      return one<boolean>(`public.feature_flag_enabled('platform.config_probe')`);
    };
    expect(await read(orgId)).toBe(false);

    await fresh(owner);
    const flag = await one<Change>(`public.admin_config_set_flag('platform.config_probe', true, 1, 'Synthetic flip', null)`);
    expect(await read(orgId)).toBe(true);

    await fresh(owner);
    const override = await one<Change>(`public.admin_config_set_flag_override('platform.config_probe', $1, false, 'Opt this firm out', null)`, [orgId]);
    expect(await read(orgId)).toBe(false);
    expect(await read(otherOrg)).toBe(true); // not a member of otherOrg, so no firm: global default

    // The firm sees its own override row and nobody else's.
    await asUser(db, { userId: firmOwner, orgId });
    expect((await db.query(`select * from public.feature_flag_overrides`)).rows).toHaveLength(1);
    await expectDbError(() => db.query(`update public.feature_flags set enabled = false`), /permission denied/);

    await fresh(owner);
    await one(`public.admin_config_revert($1, 'Clear override')`, [override.change_id]);
    expect(await read(orgId)).toBe(true);
    await fresh(owner);
    await one(`public.admin_config_revert($1, 'Flag back off')`, [flag.change_id]);
    expect(await read(orgId)).toBe(false);

    const operator = await platformAdmin("operator");
    await fresh(operator);
    await expectDbError(() => one(`public.admin_config_set_flag('platform.config_probe', true, 3, 'Nope', null)`), /owners/);

    await asMaintenance(db);
    const actions = (await db.query<{ action: string }>(`select action from public.audit_log where action in ('product.flag_changed','product.flag_override_changed','product.config_reverted') and actor_user_id = $1 order by occurred_at`, [owner])).rows.map((r) => r.action);
    expect(actions).toEqual(["product.flag_changed", "product.flag_override_changed", "product.config_reverted", "product.config_reverted"]);
  });

  it("keeps history and rules out of reach of non-admins", async () => {
    const outsider = await createUser("plain");
    await asUser(db, { userId: outsider });
    expect((await db.query(`select * from public.platform_config_changes`)).rows).toHaveLength(0);
    expect((await db.query(`select * from public.product_setting_rules`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`insert into public.platform_config_changes (target, config_key, reason) values ('flag','x','xyz')`), /permission denied/);
  });
});
