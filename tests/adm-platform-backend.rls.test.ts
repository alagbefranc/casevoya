import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Admin portal backend (20261029210000): first-admin bootstrap, roles, invites, removal,
 * portal audit entries, metadata-only reads, and dead-letter replay. Uses synthetic users only.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
  await asMaintenance(db);
  // Production auth.users has this column; the harness table does not.
  await db.query(`alter table auth.users add column if not exists last_sign_in_at timestamptz`);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

async function createUser(label: string, mfa = false) {
  await asMaintenance(db);
  const id = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@example.test`;
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, email]);
  if (mfa) {
    await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', 'verified')`, [randomUUID(), id]);
  }
  return { id, email };
}

async function rpc<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

const fresh = (userId: string) => asUser(db, { userId, aal: "aal2", totpAgeSeconds: 30 });

describe("admin portal backend", () => {
  it("bootstraps one owner, manages admins by invite, and keeps an owner", async () => {
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.platform_admins`)).rows).toHaveLength(0);
    const owner = await createUser("owner", true);
    const noMfa = await createUser("nomfa");
    const ops = await createUser("ops");
    const viewer = await createUser("viewer");
    const stranger = await createUser("stranger");

    await fresh(owner.id);
    await expectDbError(() => rpc(`public.bootstrap_first_platform_admin($1)`, [owner.id]), /permission denied/);
    await asServiceRole(db);
    await expectDbError(() => rpc(`public.bootstrap_first_platform_admin($1)`, [noMfa.id]), /no verified MFA factor/);
    expect(await rpc(`public.bootstrap_first_platform_admin($1, $2)`, [owner.id, "Synthetic owner"])).toBe(owner.id);
    await expectDbError(() => rpc(`public.bootstrap_first_platform_admin($1)`, [ops.id]), /already exists/);

    await asUser(db, { userId: owner.id, aal: "aal2", totpAgeSeconds: 3600 });
    await expectDbError(() => rpc(`public.platform_admin_invite($1, 'operator')`, [ops.email]), /step-up is required/);
    await fresh(owner.id);
    await expectDbError(() => rpc(`public.platform_admin_invite('nope', 'operator')`), /email is invalid/);
    await expectDbError(() => rpc(`public.platform_admin_invite($1, 'root')`, [ops.email]), /role is owner/);
    await rpc(`public.platform_admin_invite($1, 'operator', true, 'Synthetic ops')`, [ops.email.toUpperCase()]);
    await rpc(`public.platform_admin_invite($1, 'viewer')`, [viewer.email]);
    await expectDbError(() => rpc(`public.platform_admin_invite($1, 'viewer')`, [ops.email]), /already open/);

    await asUser(db, { userId: ops.id, aal: "aal1" });
    await expectDbError(() => rpc(`public.accept_platform_admin_invite()`), /sign in with MFA/);
    await fresh(stranger.id);
    await expectDbError(() => rpc(`public.accept_platform_admin_invite()`), /no open invite/);
    await fresh(ops.id);
    expect(await rpc(`public.accept_platform_admin_invite()`)).toMatchObject({ role: "operator", template_reviewer: true });
    await fresh(viewer.id);
    await rpc(`public.accept_platform_admin_invite()`);

    await fresh(ops.id);
    await expectDbError(() => rpc(`public.platform_admin_invite($1, 'viewer')`, [stranger.email]), /does not allow/);

    await fresh(owner.id);
    await expectDbError(() => rpc(`public.platform_admin_set_role($1, 'operator')`, [owner.id]), /keep at least one owner/);
    await expectDbError(() => rpc(`public.platform_admin_remove($1, 'Leaving the team')`, [owner.id]), /keep at least one owner/);
    await rpc(`public.platform_admin_set_reviewer($1, false)`, [ops.id]);
    await rpc(`public.platform_admin_remove($1, 'No longer on the team')`, [viewer.id]);

    await asMaintenance(db);
    await expectDbError(() => db.query(`delete from public.platform_admins where user_id = $1`, [ops.id]), /removed only through/);
    const rows = await db.query<{ user_id: string; role: string; template_reviewer: boolean }>(
      `select user_id, role, template_reviewer from public.platform_admins order by role`,
    );
    expect(rows.rows).toEqual([
      { user_id: ops.id, role: "operator", template_reviewer: false },
      { user_id: owner.id, role: "owner", template_reviewer: false },
    ]);
    const removed = await db.query(`select role from public.platform_admin_removals where user_id = $1`, [viewer.id]);
    expect(removed.rows).toEqual([{ role: "viewer" }]);
    const audit = await db.query<{ action: string }>(`select distinct action from public.audit_log where action like 'platform_admin.%' order by 1`);
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["platform_admin.bootstrapped", "platform_admin.invited", "platform_admin.invite_accepted", "platform_admin.removed"]),
    );

    await asServiceRole(db);
    const list = await rpc<{ admins: unknown[]; invites: unknown[]; removals: unknown[] }>(`public.platform_admin_list()`);
    expect(list.admins).toHaveLength(2);
    expect(list.removals).toHaveLength(1);
    await rpc(`public.platform_admin_record_audit($1, 'admin_portal.notices.create', null, null, null, 'success', '{"request_id":"req-1"}'::jsonb)`, [
      owner.id,
    ]);
    await expectDbError(() => rpc(`public.platform_admin_record_audit($1, 'notices.create')`, [owner.id]), /admin_portal/);
    await asMaintenance(db);
    const portal = await db.query(`select actor_user_id, actor_type, request_id from public.audit_log where action = 'admin_portal.notices.create'`);
    expect(portal.rows).toEqual([{ actor_user_id: owner.id, actor_type: "service", request_id: "req-1" }]);

    // Reads are service-role only and never expose outbox payload values.
    await fresh(stranger.id);
    const org = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
      "Synthetic Legal",
      "Synthetic Firm",
      `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    ]);
    const orgId = org.rows[0].id;
    await asMaintenance(db);
    const eventId = randomUUID();
    await db.query(
      `insert into public.outbox_events (id, organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, status, attempts, last_error)
       values ($1, $2, 'test', $3, 'test.event', '{"secret":"synthetic client text"}', $4, 'dead_lettered', 8, 'boom')`,
      [eventId, orgId, randomUUID(), `dead-${eventId}`],
    );
    await fresh(stranger.id);
    await expectDbError(() => rpc(`public.platform_overview()`), /permission denied/);
    await asServiceRole(db);
    const overview = await rpc<{ queues: { level: string } }>(`public.platform_overview()`);
    expect(overview.queues.level).toBe("unhealthy");
    const event = await rpc<Record<string, unknown>>(`public.platform_outbox_event($1)`, [eventId]);
    expect(event.payload_keys).toEqual(["secret"]);
    expect(JSON.stringify(event)).not.toContain("synthetic client text");
    for (const call of [
      `public.platform_firm_list()`,
      `public.platform_firm_detail('${orgId}')`,
      `public.platform_subscription_exceptions()`,
      `public.platform_licence_queue('all')`,
      `public.platform_dead_letters()`,
      `public.platform_support_requests()`,
      `public.platform_complaints_overview()`,
      `public.platform_support_sla()`,
      `public.platform_cicc_imports()`,
      `public.platform_audit_log()`,
      `public.platform_template_queue()`,
    ]) {
      expect(await rpc(call)).toBeTruthy();
    }
    await expectDbError(() => rpc(`public.platform_replay_outbox_event($1, 'Synthetic retry reason')`, [eventId]), /permission denied/);

    await asUser(db, { userId: ops.id, aal: "aal2", totpAgeSeconds: 3600 });
    await expectDbError(() => rpc(`public.platform_replay_outbox_event($1, 'Synthetic retry reason')`, [eventId]), /step-up/);
    await fresh(ops.id);
    await expectDbError(() => rpc(`public.platform_replay_outbox_event($1, 'short')`, [eventId]), /reason of 8/);
    expect(await rpc(`public.platform_replay_outbox_event($1, 'Synthetic retry reason')`, [eventId])).toMatchObject({ status: "pending" });
    await expectDbError(() => rpc(`public.platform_replay_outbox_event($1, 'Synthetic retry reason')`, [eventId]), /only a dead-lettered/);
  });
});
