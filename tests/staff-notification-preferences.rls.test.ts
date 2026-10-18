import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261019214000_staff_notification_preferences.sql: each staff member's own email choices
 * (Settings > Notifications), locked kinds refused, own-row only, and the executed-agreement staff
 * copy recorded as skipped (never sent) for someone who turned it off. Nothing else changes.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function user(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, email]);
  return { id, email };
}

async function member(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
    [orgId, userId, role],
  );
  return row.rows[0].id;
}

async function firm() {
  const owner = await user("owner");
  await asUser(db, { userId: owner.id, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultant = await user("consultant");
  const consultantMembership = await member(orgId, consultant.id, "licensed_consultant");
  const finance = await user("finance");
  await member(orgId, finance.id, "finance_user");
  const client = await user("client");
  await member(orgId, client.id, "client");
  return { orgId, owner, consultant, consultantMembership, finance, client };
}

type Firm = Awaited<ReturnType<typeof firm>>;
const as = (f: Firm, userId: string, aal: "aal1" | "aal2" = "aal2") => asUser(db, { userId, aal, orgId: f.orgId, totpAgeSeconds: 60 });

async function queueSignatureCopy(f: Firm, email: string, audience: "staff" | null) {
  await asMaintenance(db);
  const event = await db.query<{ id: string }>(
    `insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
     values ($1, 'signature_envelope', $2, 'agreement.executed', '{}'::jsonb, $3) returning id`,
    [f.orgId, randomUUID(), `pref-${randomUUID()}`],
  );
  const context = audience ? { firm: "Synthetic Firm", template: "signature", audience } : { firm: "Synthetic Firm", template: "signature" };
  await db.query(`select app.queue_email_delivery($1, $2, $3, 'signature', null, true, $4::jsonb, true)`, [event.rows[0].id, f.orgId, email, JSON.stringify(context)]);
  const row = await db.query<{ status: string; attempt_count: number }>(
    `select status, attempt_count from public.email_deliveries where outbox_event_id = $1`,
    [event.rows[0].id],
  );
  return row.rows[0];
}

describe("staff notification preferences", () => {
  it("saves the caller's own choice only, for a switchable kind, and keeps it private", async () => {
    const f = await firm();
    const other = await firm();
    await as(f, f.consultant.id);
    await db.query(`select public.set_staff_notification_preference($1, 'agreement_executed', false)`, [f.orgId]);
    // Saving again updates the same row.
    await db.query(`select public.set_staff_notification_preference($1, 'agreement_executed', false)`, [f.orgId]);
    const mine = await db.query<{ membership_id: string; email: boolean }>(`select membership_id, email from public.staff_notification_preferences`);
    expect(mine.rows).toEqual([{ membership_id: f.consultantMembership, email: false }]);
    // Not the owner's to read, nor another firm's.
    await as(f, f.owner.id);
    expect((await db.query(`select 1 from public.staff_notification_preferences`)).rows).toHaveLength(0);
    await as(other, other.owner.id);
    expect((await db.query(`select 1 from public.staff_notification_preferences`)).rows).toHaveLength(0);
    // No direct writes, even to one's own row.
    await as(f, f.consultant.id);
    await expectDbError(
      () => db.query(`insert into public.staff_notification_preferences (organization_id, membership_id, kind, email) values ($1, $2, 'agreement_executed', true)`, [f.orgId, f.consultantMembership]),
      /permission denied/,
    );
    await expectDbError(() => db.query(`update public.staff_notification_preferences set email = true`), /permission denied/);
    await asMaintenance(db);
    const audit = await db.query(`select 1 from public.audit_log where organization_id = $1 and action = 'notifications.preference_changed'`, [f.orgId]);
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("refuses locked and unknown kinds, other firms, clients and sessions without staff MFA", async () => {
    const f = await firm();
    const other = await firm();
    await as(f, f.consultant.id);
    for (const kind of ["agreement_signer_turn", "sign_in", "mfa", "critical_instruction", "nonsense"]) {
      await expectDbError(() => db.query(`select public.set_staff_notification_preference($1, $2, false)`, [f.orgId, kind]), /can't be turned off/);
    }
    await expectDbError(() => db.query(`select public.set_staff_notification_preference($1, 'agreement_executed', null)`, [f.orgId]), /on or off/);
    // Forged organization: the caller is not staff there.
    await expectDbError(() => db.query(`select public.set_staff_notification_preference($1, 'agreement_executed', false)`, [other.orgId]), /staff access denied/);
    await as(f, f.client.id);
    await expectDbError(() => db.query(`select public.set_staff_notification_preference($1, 'agreement_executed', false)`, [f.orgId]), /staff access denied/);
    await as(f, f.consultant.id, "aal1");
    await expectDbError(() => db.query(`select public.set_staff_notification_preference($1, 'agreement_executed', false)`, [f.orgId]), /staff access denied/);
    // A finance user is staff and may choose too.
    await as(f, f.finance.id);
    await db.query(`select public.set_staff_notification_preference($1, 'agreement_executed', true)`, [f.orgId]);
  });

  it("skips the executed-agreement staff copy for someone who turned it off, and nothing else", async () => {
    const f = await firm();
    await as(f, f.consultant.id);
    await db.query(`select public.set_staff_notification_preference($1, 'agreement_executed', false)`, [f.orgId]);
    expect(await queueSignatureCopy(f, f.consultant.email, "staff")).toEqual({ status: "skipped", attempt_count: 0 });
    // The owner kept it on (no row): sent.
    expect((await queueSignatureCopy(f, f.owner.email, "staff")).status).toBe("sending");
    // A client copy to the same address is a client notice: never affected.
    expect((await queueSignatureCopy(f, f.consultant.email, null)).status).toBe("sending");
    // Turned back on: sent again.
    await as(f, f.consultant.id);
    await db.query(`select public.set_staff_notification_preference($1, 'agreement_executed', true)`, [f.orgId]);
    expect((await queueSignatureCopy(f, f.consultant.email, "staff")).status).toBe("sending");
    // Another firm's preference never reaches this firm's mail.
    const other = await firm();
    await as(other, other.owner.id);
    await db.query(`select public.set_staff_notification_preference($1, 'agreement_executed', false)`, [other.orgId]);
    expect((await queueSignatureCopy(f, other.owner.email, "staff")).status).toBe("sending");
  });
});
