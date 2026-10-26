import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * SEC-10 (gap #184): cancel subscription, the contract-period clock, the export window, custodial
 * archive or verified transfer, the banner data and the full firm export index
 * (20261025290100). Stripe is never called: the server's Stripe step is replaced by the service
 * function it calls with Stripe's answer.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

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

async function activeMembership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

async function as(userId: string, orgId: string, fresh = true) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: fresh ? 0 : 3600 });
}

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const assistant = await createUser("assistant");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  await activeMembership(orgId, assistant, "assistant", owner);
  await as(consultant, orgId);
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await as(owner, orgId);
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  return { owner, consultant, assistant, orgId, consultantMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

/** A paid, active test-mode subscription (what Stripe's events leave behind). */
async function paid(ctx: Firm, periodEnd = "now() + interval '20 days'") {
  await asMaintenance(db);
  const tail = ctx.orgId.replaceAll("-", "").slice(0, 12);
  await db.query(
    `update public.organization_subscriptions
        set status = 'active', plan = 'practice', billing_interval = 'month', stripe_customer_id = $2, stripe_subscription_id = $3,
            current_period_end = ${periodEnd}
      where organization_id = $1`,
    [ctx.orgId, `cus_Syn${tail}`, `sub_Syn${tail}`],
  );
}

async function sub(orgId: string): Promise<Row> {
  await asMaintenance(db);
  const row = await db.query<Row>(
    `select status::text, cancel_at, cancelled_at, current_period_end, archived_at, cancel_requested_at, cancel_requested_by, end_arrangement, end_transfer_id
       from public.organization_subscriptions where organization_id = $1`,
    [orgId],
  );
  return row.rows[0];
}

async function setSub(orgId: string, sql: string) {
  await asMaintenance(db);
  await db.query(`update public.organization_subscriptions set ${sql} where organization_id = $1`, [orgId]);
}

async function audits(orgId: string, action: string) {
  await asMaintenance(db);
  const rows = await db.query<{ context: Row }>(`select context from public.audit_log where organization_id = $1 and action = $2 order by occurred_at`, [orgId, action]);
  return rows.rows.map((row) => row.context);
}

async function cancel(ctx: Firm, cancelAt = "now() + interval '20 days'") {
  await as(ctx.owner, ctx.orgId);
  const allowed = await db.query<{ r: { ok: boolean; stripe_subscription_id: string } }>(`select public.subscription_cancel_allowed($1) as r`, [ctx.orgId]);
  await asServiceRole(db);
  await db.query(`select public.service_record_subscription_cancel($1, $2, ${cancelAt}, ${cancelAt})`, [ctx.orgId, ctx.owner]);
  return allowed.rows[0].r;
}

async function continuity(userId: string, orgId: string): Promise<Row> {
  await as(userId, orgId, false);
  const row = await db.query<{ c: Row }>(`select public.subscription_continuity($1) as c`, [orgId]);
  return row.rows[0].c;
}

async function newRealMatter(ctx: Firm) {
  await as(ctx.consultant, ctx.orgId);
  const result = await db.query<{ result: { ok: boolean; id: string } }>(`select public.create_engaged_matter($1, false, $2) as result`, [
    `Matter ${randomUUID().slice(0, 6)}`,
    ctx.consultantMembership,
  ]);
  return result.rows[0].result;
}

describe("Cancel subscription (owner, step-up, Stripe test mode)", () => {
  it("only the firm owner with a fresh step-up cancels a paid subscription; the date is Stripe's and it is audited", async () => {
    const ctx = await firm();
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.subscription_cancel_allowed($1)`, [ctx.orgId]), /no paid subscription to cancel/);
    await paid(ctx);
    await as(ctx.owner, ctx.orgId, false);
    await expectDbError(() => db.query(`select public.subscription_cancel_allowed($1)`, [ctx.orgId]), /step-up/);
    await as(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.subscription_cancel_allowed($1)`, [ctx.orgId]), /step-up/);
    const other = await firm();
    await as(other.owner, other.orgId);
    await expectDbError(() => db.query(`select public.subscription_cancel_allowed($1)`, [ctx.orgId]), /step-up/);

    const allowed = await cancel(ctx);
    expect(allowed.ok).toBe(true);
    expect(allowed.stripe_subscription_id).toMatch(/^sub_Syn/);
    const row = await sub(ctx.orgId);
    expect(row.status).toBe("active");
    expect(row.cancel_at).not.toBeNull();
    expect(row.cancel_requested_by).toBe(ctx.owner);
    expect(await audits(ctx.orgId, "subscription.cancel_requested")).toHaveLength(1);
    expect(await audits(ctx.orgId, "subscription.cancel_scheduled")).toEqual([expect.objectContaining({ requested_by: ctx.owner, records_deleted: false })]);
    // Nothing stops before the period ends.
    expect((await newRealMatter(ctx)).ok).toBe(true);
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.subscription_cancel_allowed($1)`, [ctx.orgId]), /already ends at the period end/);

    // Only the server, with Stripe's answer, records the date; a browser cannot.
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.service_record_subscription_cancel($1, $2, now(), now())`, [ctx.orgId, ctx.owner]), /permission denied/);
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.service_record_subscription_cancel($1, $2, now() + interval '2 days', null)`, [ctx.orgId, ctx.consultant]), /only the firm owner/);
    await expectDbError(() => db.query(`select public.service_record_subscription_cancel($1, $2, now() + interval '3 years', null)`, [ctx.orgId, ctx.owner]), /not plausible/);
  });

  it("after the contracted period new matters and invitations stop; reads and exports go on; the banner shows it to all staff", async () => {
    const ctx = await firm();
    await paid(ctx);
    const existing = await newRealMatter(ctx);
    await cancel(ctx);
    const ending = await continuity(ctx.assistant, ctx.orgId);
    expect(ending).toMatchObject({ phase: "ending", window_days: 90 });

    // Simulated end of the contracted period, before Stripe's own event arrives.
    await setSub(ctx.orgId, `cancel_at = now() - interval '1 minute', current_period_end = now() - interval '1 minute'`);
    const ended = await continuity(ctx.assistant, ctx.orgId);
    expect(ended).toMatchObject({ phase: "window", status: "cancelled" });
    const row = await sub(ctx.orgId);
    expect(row).toMatchObject({ status: "cancelled", cancel_at: null });
    expect(await audits(ctx.orgId, "subscription.contract_period_ended")).toEqual([expect.objectContaining({ records_deleted: false })]);
    const windowEnd = new Date(String(ended.window_ends_at)).getTime();
    expect(windowEnd - new Date(String(row.cancelled_at)).getTime()).toBeGreaterThanOrEqual(90 * 86_400_000 - 120_000);

    await expectDbError(() => newRealMatter(ctx), /subscription paused/);
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.create_staff_invitation($1, $2, 'assistant'::public.org_role)`, [ctx.orgId, `late-${randomUUID().slice(0, 6)}@example.test`]), /subscription paused/);
    // Reads and exports go on.
    await as(ctx.owner, ctx.orgId);
    const started = await db.query<{ id: string }>(`select public.start_matter_export($1, $2) as id`, [existing.id, `exp-${randomUUID()}`]);
    expect(started.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    const read = await db.query(`select id from public.matters where id = $1`, [existing.id]);
    expect(read.rows).toHaveLength(1);

    await asAnon(db);
    await expectDbError(() => db.query(`select public.subscription_continuity($1)`, [ctx.orgId]), /permission denied|sign in is required/);
    const other = await firm();
    await as(other.assistant, other.orgId);
    await expectDbError(() => db.query(`select public.subscription_continuity($1)`, [ctx.orgId]), /continuity denied/);
  });

  it("the export window is never shorter than 90 days and counts from the later of the cancellation and the period end", async () => {
    const ctx = await firm();
    await paid(ctx);
    await asMaintenance(db);
    await db.query(`update public.product_settings set value = jsonb_set(value, '{export_window_days}', '30') where key = 'subscription.grace'`);
    try {
      await setSub(ctx.orgId, `status = 'cancelled', cancelled_at = now() - interval '60 days', current_period_end = now() - interval '45 days'`);
      const window = await continuity(ctx.owner, ctx.orgId);
      expect(window).toMatchObject({ phase: "window", window_days: 90 });
      await setSub(ctx.orgId, `cancelled_at = now() - interval '120 days', current_period_end = now() - interval '60 days'`);
      expect(await continuity(ctx.owner, ctx.orgId)).toMatchObject({ phase: "window" });
      await setSub(ctx.orgId, `current_period_end = now() - interval '91 days'`);
      expect(await continuity(ctx.owner, ctx.orgId)).toMatchObject({ phase: "archived", arrangement: "custodial_archive" });
      expect(await audits(ctx.orgId, "subscription.archived")).toEqual([expect.objectContaining({ end_arrangement: "custodial_archive", records_deleted: false })]);
    } finally {
      await asMaintenance(db);
      await db.query(`update public.product_settings set value = jsonb_set(value, '{export_window_days}', '90') where key = 'subscription.grace'`);
    }
  });
});

describe("After the export window: custodial archive or verified transfer", () => {
  async function transfer(ctx: Firm, status: "open" | "completed") {
    await asMaintenance(db);
    const row = await db.query<{ id: string }>(
      `insert into public.firm_transfers (organization_id, receiving_firm, status, closed_at, closed_by, created_by)
       values ($1, 'Receiving Synthetic Firm', $2, case when $2 = 'open' then null else now() end, case when $2 = 'open' then null else $3::uuid end, $3) returning id`,
      [ctx.orgId, status, ctx.owner],
    );
    return row.rows[0].id;
  }

  it("the owner chooses after cancelling, with a step-up; a transfer counts only once it is completed", async () => {
    const ctx = await firm();
    await paid(ctx);
    const open = await transfer(ctx, "open");
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.choose_subscription_end_arrangement($1, 'transfer', $2)`, [ctx.orgId, open]), /once the subscription is cancelled/);
    await cancel(ctx);
    await as(ctx.owner, ctx.orgId, false);
    await expectDbError(() => db.query(`select public.choose_subscription_end_arrangement($1, 'transfer', $2)`, [ctx.orgId, open]), /step-up/);
    const other = await firm();
    const foreign = await transfer(other, "completed");
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.choose_subscription_end_arrangement($1, 'transfer', $2)`, [ctx.orgId, foreign]), /open or completed firm transfer/);
    await expectDbError(() => db.query(`select public.choose_subscription_end_arrangement($1, 'delete', null)`, [ctx.orgId]), /custodial archive or a transfer/);
    await db.query(`select public.choose_subscription_end_arrangement($1, 'transfer', $2)`, [ctx.orgId, open]);
    expect(await audits(ctx.orgId, "subscription.end_arrangement_chosen")).toEqual([{ arrangement: "transfer", transfer_id: open }]);
    const chosen = await continuity(ctx.owner, ctx.orgId);
    expect(chosen.transfer).toMatchObject({ id: open, verified: false, receiving_firm: "Receiving Synthetic Firm" });

    // Window over while the transfer is still open: custodial archive.
    await setSub(ctx.orgId, `status = 'cancelled', cancel_at = null, cancelled_at = now() - interval '100 days', current_period_end = now() - interval '100 days'`);
    expect(await continuity(ctx.owner, ctx.orgId)).toMatchObject({ phase: "archived", arrangement: "custodial_archive" });
    expect((await sub(ctx.orgId)).end_transfer_id).toBeNull();
  });

  it("a completed transfer is recorded as the arrangement; nothing is deleted", async () => {
    const ctx = await firm();
    await paid(ctx);
    await newRealMatter(ctx);
    await cancel(ctx);
    const done = await transfer(ctx, "completed");
    await as(ctx.owner, ctx.orgId);
    await db.query(`select public.choose_subscription_end_arrangement($1, 'transfer', $2)`, [ctx.orgId, done]);
    await setSub(ctx.orgId, `status = 'cancelled', cancel_at = null, cancelled_at = now() - interval '100 days', current_period_end = now() - interval '100 days'`);
    expect(await continuity(ctx.assistant, ctx.orgId)).toMatchObject({ phase: "archived", arrangement: "transfer" });
    expect(await sub(ctx.orgId)).toMatchObject({ status: "archived", end_transfer_id: done });
    await asMaintenance(db);
    expect((await db.query(`select count(*)::int as n from public.matters where organization_id = $1`, [ctx.orgId])).rows[0]).toEqual({ n: 1 });
  });
});

describe("Full firm export (firm_subscription continuity and public.firm_export_index)", () => {
  it("counts real matters with a ready export since cancelling and gives the owner an audited index", async () => {
    const ctx = await firm();
    await paid(ctx);
    const one = await newRealMatter(ctx);
    const two = await newRealMatter(ctx);
    await cancel(ctx);
    await asMaintenance(db);
    const exportId = randomUUID();
    await db.query(
      `insert into public.matter_exports (id, organization_id, matter_id, idempotency_key, requested_by, status, stage, progress, sha256, manifest_sha256,
         storage_bucket, storage_key, ready_at, expires_at, file_count, byte_size)
       values ($1, $2, $3, $4, $5, 'ready', 'ready', 100, $6, $6, 'matter-exports', $7, now() + interval '1 second', now() + interval '1 day', 1, 100)`,
      [exportId, ctx.orgId, one.id, `key-${randomUUID()}`, ctx.owner, "b".repeat(64), `${ctx.orgId}/${exportId}/file.zip`],
    );
    await as(ctx.owner, ctx.orgId);
    const page = await db.query<{ page: { continuity: { coverage: Row } } }>(`select public.firm_subscription($1) as page`, [ctx.orgId]);
    expect(page.rows[0].page.continuity.coverage).toMatchObject({ matters: 2, covered: 1, next_matter_id: two.id });

    await as(ctx.owner, ctx.orgId, false);
    await expectDbError(() => db.query(`select public.firm_export_index($1)`, [ctx.orgId]), /step-up/);
    await as(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.firm_export_index($1)`, [ctx.orgId]), /step-up/);
    await as(ctx.owner, ctx.orgId);
    const index = await db.query<{ i: { matters: Row[]; without_export: number } }>(`select public.firm_export_index($1) as i`, [ctx.orgId]);
    expect(index.rows[0].i.without_export).toBe(1);
    expect(index.rows[0].i.matters).toEqual(
      expect.arrayContaining([expect.objectContaining({ matter_id: one.id, export_id: exportId, sha256: "b".repeat(64) }), expect.objectContaining({ matter_id: two.id, export_id: null })]),
    );
    expect(await audits(ctx.orgId, "firm_export.index_downloaded")).toEqual([{ matters: 2, without_export: 1 }]);
  });
});
