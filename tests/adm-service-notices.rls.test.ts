import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * ADM-04 (gap #186): service notices (20261025350000). Platform admins post (step-up, or the
 * service role naming the admin); staff of a reached firm read published notices; other firms,
 * client users and anonymous callers read nothing; per-person dismissal hides the banner only.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

type Row = Record<string, unknown>;

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${randomUUID().slice(0, 8)}@example.test`,
  ]);
  return id;
}

async function membership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4)`,
    [orgId, userId, role, createdBy],
  );
}

async function firm(label: string) {
  const owner = await createUser(`${label}-owner`);
  const assistant = await createUser(`${label}-assistant`);
  const client = await createUser(`${label}-client`);
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string; slug: string }>(`select (o).id as id, (o).slug as slug from (select public.create_organization($1, $2, $3) as o) s`, [
    `${label} Legal Name`,
    `${label} Firm`,
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await membership(orgId, assistant, "assistant", owner);
  await membership(orgId, client, "client", owner);
  return { owner, assistant, client, orgId };
}

async function platformAdmin() {
  const id = await createUser("platform-admin");
  await asMaintenance(db);
  await db.query(`insert into public.platform_admins (user_id) values ($1)`, [id]);
  return id;
}

async function as(userId: string, orgId: string | null, fresh = true) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: fresh ? 0 : 3600 });
}

async function visible(userId: string, orgId: string | null, aal: "aal1" | "aal2" = "aal2"): Promise<string[]> {
  await asUser(db, { userId, aal, orgId, totpAgeSeconds: 0 });
  const rows = await db.query<{ id: string }>(`select id from public.service_notices order by created_at`);
  return rows.rows.map((row) => row.id);
}

async function post(admin: string, firms: string[] | null, overrides: Partial<{ kind: string; publish: boolean; ends: string | null }> = {}) {
  await as(admin, null);
  const result = await db.query<{ id: string }>(
    `select public.post_service_notice($1, 'major', 'Scheduled maintenance', 'Casevoya is read-only during this window.', now(), ${
      overrides.ends === null ? "null" : `now() + interval '2 hours'`
    }, $2::uuid[], $3) as id`,
    [overrides.kind ?? "maintenance", firms, overrides.publish ?? true],
  );
  return result.rows[0].id;
}

async function audits(action: string, objectId: string) {
  await asMaintenance(db);
  const rows = await db.query<{ organization_id: string | null; actor_user_id: string | null; actor_type: string; context: Row }>(
    `select organization_id, actor_user_id, actor_type, context from public.audit_log where action = $1 and object_id = $2 order by occurred_at`,
    [action, objectId],
  );
  return rows.rows;
}

describe("ADM-04 service notices", () => {
  it("a notice targeted to one firm is read by that firm's staff only; client users and anon read nothing", async () => {
    const admin = await platformAdmin();
    const a = await firm("Alpha");
    const b = await firm("Beta");
    const id = await post(admin, [a.orgId]);

    expect(await visible(a.owner, a.orgId)).toContain(id);
    expect(await visible(a.assistant, a.orgId)).toContain(id);
    expect(await visible(b.owner, b.orgId)).not.toContain(id);
    // A firm's own staff, with the other firm's id as the workspace: not a member there, nothing.
    expect(await visible(b.owner, a.orgId)).not.toContain(id);
    expect(await visible(a.client, a.orgId)).toEqual([]);
    // Staff without two-step (aal1) read nothing.
    expect(await visible(a.assistant, a.orgId, "aal1")).not.toContain(id);

    await as(a.owner, a.orgId);
    const targetsA = await db.query(`select organization_id from public.service_notice_targets where notice_id = $1`, [id]);
    expect(targetsA.rows).toHaveLength(1);
    await as(b.owner, b.orgId);
    const targetsB = await db.query(`select organization_id from public.service_notice_targets`);
    expect(targetsB.rows.filter((row) => (row as Row).organization_id === a.orgId)).toHaveLength(0);
    // Another firm's staff can't probe which firms a notice reaches.
    await expectDbError(() => db.query(`select app.service_notice_reaches($1, $2)`, [id, a.orgId]), /permission denied/);

    await asAnon(db);
    await expectDbError(() => db.query(`select id from public.service_notices`), /permission denied/);
  });

  it("an all-firms notice reaches every firm's staff, never client users", async () => {
    const admin = await platformAdmin();
    const a = await firm("Gamma");
    const b = await firm("Delta");
    const id = await post(admin, null, { kind: "incident", ends: null });
    expect(await visible(a.assistant, a.orgId)).toContain(id);
    expect(await visible(b.owner, b.orgId)).toContain(id);
    expect(await visible(b.client, b.orgId)).toEqual([]);
  });

  it("drafts stay with platform admins until published", async () => {
    const admin = await platformAdmin();
    const a = await firm("Epsilon");
    const id = await post(admin, [a.orgId], { publish: false });
    expect(await visible(a.owner, a.orgId)).not.toContain(id);
    expect(await visible(admin, null)).toContain(id);
    await as(admin, null);
    await db.query(`select public.update_service_notice($1, p_publish => true)`, [id]);
    expect(await visible(a.owner, a.orgId)).toContain(id);
    expect((await audits("service_notice.drafted", id))).toHaveLength(1);
    const published = await audits("service_notice.published", id);
    expect(published).toHaveLength(1);
    expect(published[0].actor_user_id).toBe(admin);
  });

  it("only a platform admin with a recent step-up posts, updates or resolves; firm staff can't", async () => {
    const admin = await platformAdmin();
    const a = await firm("Zeta");
    await as(a.owner, a.orgId);
    await expectDbError(
      () => db.query(`select public.post_service_notice('info', 'info', 'Hello firms', 'Text', null, null, null, true)`),
      /platform admin step-up/,
    );
    await as(admin, null, false);
    await expectDbError(
      () => db.query(`select public.post_service_notice('info', 'info', 'Hello firms', 'Text', null, null, null, true)`),
      /platform admin step-up/,
    );
    const id = await post(admin, [a.orgId]);
    await as(a.owner, a.orgId);
    await expectDbError(() => db.query(`select public.resolve_service_notice($1, 'Done here')`, [id]), /platform admin step-up/);
    await expectDbError(() => db.query(`select public.update_service_notice($1, p_title => 'Changed by a firm')`, [id]), /platform admin step-up/);
    // No direct writes at all.
    await expectDbError(() => db.query(`update public.service_notices set title = 'x' where id = $1`, [id]), /permission denied/);
    await expectDbError(
      () => db.query(`insert into public.service_notice_targets (notice_id, organization_id) values ($1, $2)`, [id, a.orgId]),
      /permission denied/,
    );
    await asAnon(db);
    await expectDbError(() => db.query(`select public.post_service_notice('info', 'info', 'Hello firms', 'Text')`), /permission denied/);
  });

  it("the service role posts only when it names a platform admin, and the audit records who", async () => {
    const admin = await platformAdmin();
    const a = await firm("Eta");
    const stranger = await createUser("not-admin");
    await asServiceRole(db);
    await expectDbError(
      () => db.query(`select public.post_service_notice('incident', 'major', 'Email delays', 'Some emails are late.', null, null, $1::uuid[], true, null)`, [[a.orgId]]),
      /name the platform admin/,
    );
    await expectDbError(
      () => db.query(`select public.post_service_notice('incident', 'major', 'Email delays', 'Some emails are late.', null, null, $1::uuid[], true, $2)`, [[a.orgId], stranger]),
      /name the platform admin/,
    );
    const posted = await db.query<{ id: string }>(
      `select public.post_service_notice('incident', 'major', 'Email delays', 'Some emails are late.', null, null, $1::uuid[], true, $2) as id`,
      [[a.orgId], admin],
    );
    const id = posted.rows[0].id;
    const rows = await audits("service_notice.published", id);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_type).toBe("service");
    expect(rows[0].context.acting_admin).toBe(admin);
    expect(rows[0].context.audience).toBe("listed_firms");
    await asServiceRole(db);
    await db.query(`select public.resolve_service_notice($1, 'Email delivery caught up.', $2)`,[id, admin]);
    await asMaintenance(db);
    const row = await db.query<{ status: string; resolved_by: string; resolution_note: string }>(`select status, resolved_by, resolution_note from public.service_notices where id = $1`, [id]);
    expect(row.rows[0]).toMatchObject({ status: "resolved", resolved_by: admin, resolution_note: "Email delivery caught up." });
    expect(await audits("service_notice.resolved", id)).toHaveLength(1);
    // Resolved: still in the firm's history.
    expect(await visible(a.owner, a.orgId)).toContain(id);
  });

  it("checks the notice's shape", async () => {
    const admin = await platformAdmin();
    const a = await firm("Theta");
    await as(admin, null);
    await expectDbError(() => db.query(`select public.post_service_notice('maintenance', 'minor', 'Maintenance', 'Text', null, null, null, true)`), /maintenance needs an end time/);
    await expectDbError(() => db.query(`select public.post_service_notice('outage', 'minor', 'Outage', 'Text')`), /kind must be/);
    await expectDbError(() => db.query(`select public.post_service_notice('info', 'minor', 'Hi', 'Text')`), /title is 3 to 120/);
    await expectDbError(() => db.query(`select public.post_service_notice('info', 'minor', 'Hello', $1)`, ["x".repeat(1001)]), /1 to 1000/);
    await expectDbError(
      () => db.query(`select public.post_service_notice('info', 'minor', 'Hello', 'Text', now(), now() - interval '1 hour')`),
      /end time is after the start/,
    );
    await expectDbError(() => db.query(`select public.post_service_notice('info', 'minor', 'Hello', 'Text', null, null, $1::uuid[])`, [[randomUUID()]]), /listed firm does not exist/);
    await expectDbError(() => db.query(`select public.post_service_notice('info', 'minor', 'Hello', 'Text', null, null, '{}'::uuid[])`), /at least one firm/);
    const id = await post(admin, [a.orgId]);
    await as(admin, null);
    await expectDbError(() => db.query(`select public.resolve_service_notice($1, '')`, [id]), /how it was resolved/);
    await db.query(`select public.resolve_service_notice($1, 'Maintenance finished early.')`, [id]);
    await expectDbError(() => db.query(`select public.update_service_notice($1, p_title => 'Reopened')`, [id]), /resolved notice cannot change/);
  });

  it("a staff member dismisses the banner for themselves only; client users and other firms can't", async () => {
    const admin = await platformAdmin();
    const a = await firm("Iota");
    const b = await firm("Kappa");
    const id = await post(admin, [a.orgId]);

    await as(a.assistant, a.orgId);
    await db.query(`select public.dismiss_service_notice($1)`, [id]);
    await db.query(`select public.dismiss_service_notice($1)`, [id]);
    const mine = await db.query(`select notice_id from public.service_notice_dismissals`);
    expect(mine.rows).toHaveLength(1);
    // The owner's view is unaffected, and the notice stays readable (history).
    await as(a.owner, a.orgId);
    expect((await db.query(`select notice_id from public.service_notice_dismissals`)).rows).toHaveLength(0);
    expect(await visible(a.assistant, a.orgId)).toContain(id);

    await as(b.owner, b.orgId);
    await expectDbError(() => db.query(`select public.dismiss_service_notice($1)`, [id]), /not found/);
    await as(a.client, a.orgId);
    await expectDbError(() => db.query(`select public.dismiss_service_notice($1)`, [id]), /denied/);
    await as(a.assistant, a.orgId);
    await expectDbError(() => db.query(`insert into public.service_notice_dismissals (notice_id, organization_id, user_id) values ($1, $2, $3)`, [id, a.orgId, a.owner]), /permission denied/);

    const rows = await audits("service_notice.dismissed", id);
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_id).toBe(a.orgId);
  });
});
