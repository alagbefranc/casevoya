import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Go live (20261101100200): a firm is in test mode until its owner switches it to live. The
 * server re-checks the owner's licence, a Stripe subscription with a card, the published portal
 * policies and a live Stripe account with card payments; it audits each attempt. Synthetic firms
 * and made-up Stripe ids only.
 */
let db: TestDb;
const PROOF = "proof/synthetic-register-capture";
type Item = { key: string; done: boolean };
type Status = { live: boolean; live_at: string | null; sample_mode: boolean; items: Item[]; ready: boolean; owner: boolean };

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await asMaintenance(db);
});

async function user(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `${label}-${id.slice(0, 8)}@example.test`]);
  return id;
}

async function as(userId: string, orgId: string, fresh = true) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: fresh ? 0 : 60 * 60 });
}

/** A firm in sample mode with its owner's licence on file and an assistant. */
async function firm() {
  const owner = await user("owner");
  const assistant = await user("assistant");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const orgId = (
    await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `g${randomUUID().replaceAll("-", "").slice(0, 12)}`])
  ).rows[0].id;
  await asMaintenance(db);
  await db.query(`insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, 'assistant', 'active', now(), $3)`, [orgId, assistant, owner]);
  const membership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner])).rows[0].id;
  await as(owner, orgId);
  await db.query(`select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3)`, [membership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF]);
  return { owner, assistant, orgId };
}

async function status(userId: string, orgId: string) {
  await as(userId, orgId);
  return (await db.query<{ s: Status }>(`select public.firm_go_live_status() as s`)).rows[0].s;
}

const done = (s: Status) => Object.fromEntries(s.items.map((item) => [item.key, item.done]));

async function cardSubscription(orgId: string) {
  await asMaintenance(db);
  await db.query(`update public.organization_subscriptions set status = 'trial', stripe_subscription_id = $2, stripe_customer_id = $3 where organization_id = $1`, [
    orgId,
    `sub_SynLive${orgId.slice(0, 8)}`,
    `cus_SynLive${orgId.slice(0, 8)}`,
  ]);
}

async function policies(orgId: string) {
  await asMaintenance(db);
  for (const kind of ["portal_terms", "privacy_notice"]) {
    const body = `Synthetic ${kind}`;
    await db.query(
      `insert into public.portal_policy_documents (organization_id, kind, version_label, title, body, body_sha256) values ($1, $2, 'v1', $2, $3, $4)`,
      [orgId, kind, body, createHash("sha256").update(body).digest("hex")],
    );
  }
}

async function stripeAccount(orgId: string, livemode: boolean, cardPayments = "active") {
  await asMaintenance(db);
  await db.query(
    `insert into public.firm_payment_accounts (organization_id, account_id, livemode, card_payments_status) values ($1, $2, $3, $4)
     on conflict (organization_id) do update set livemode = excluded.livemode, card_payments_status = excluded.card_payments_status`,
    [
    orgId,
    `acct_Syn${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    livemode,
    cardPayments,
    ],
  );
}

async function audits(orgId: string) {
  await asMaintenance(db);
  return (
    await db.query<{ action: string; result: string; context: Record<string, unknown> }>(
      `select action, result, context from public.audit_log where organization_id = $1 and action like 'firm.%' and action <> 'firm.sample_mode_changed' order by occurred_at, id`,
      [orgId],
    )
  ).rows.filter((row) => row.action === "firm.went_live" || row.action === "firm.returned_to_test_mode");
}

describe("go live", () => {
  it("starts in test mode and lists what is missing, for any staff member", async () => {
    const f = await firm();
    const seen = await status(f.assistant, f.orgId);
    expect(seen).toMatchObject({ live: false, live_at: null, ready: false, owner: false });
    expect(done(seen)).toEqual({ licence: true, subscription: false, policies: false, card_payments: false });
    expect((await status(f.owner, f.orgId)).owner).toBe(true);
    await asUser(db, { userId: await user("stranger"), aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.firm_go_live_status()`), /firm staff only/);
  });

  it("refuses to switch while anything is missing, and audits the refusal", async () => {
    const f = await firm();
    await cardSubscription(f.orgId);
    await as(f.owner, f.orgId);
    const refused = (await db.query<{ r: Record<string, unknown> }>(`select public.switch_firm_to_live() as r`)).rows[0].r;
    expect(refused).toEqual({ live: false, live_at: null, missing: ["policies", "card_payments"] });
    const rows = await audits(f.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "firm.went_live", result: "denied", context: { missing: ["policies", "card_payments"] } });
    expect((await status(f.owner, f.orgId)).live).toBe(false);
  });

  it("does not count a test-mode Stripe account or one without card payments", async () => {
    const f = await firm();
    await stripeAccount(f.orgId, false);
    expect(done(await status(f.owner, f.orgId)).card_payments).toBe(false);
    await stripeAccount(f.orgId, true, "restricted");
    expect(done(await status(f.owner, f.orgId)).card_payments).toBe(false);
    await stripeAccount(f.orgId, true);
    expect(done(await status(f.owner, f.orgId)).card_payments).toBe(true);
  });

  it("needs a Stripe subscription with a card, not the old no-card trial", async () => {
    const f = await firm();
    expect(done(await status(f.owner, f.orgId)).subscription).toBe(false);
    await cardSubscription(f.orgId);
    expect(done(await status(f.owner, f.orgId)).subscription).toBe(true);
    await asMaintenance(db);
    await db.query(`update public.organization_subscriptions set status = 'trial_ended' where organization_id = $1`, [f.orgId]);
    expect(done(await status(f.owner, f.orgId)).subscription).toBe(false);
  });

  it("switches a ready firm to live: owner with a fresh step-up only, sample mode off, audited", async () => {
    const f = await firm();
    await cardSubscription(f.orgId);
    await policies(f.orgId);
    await stripeAccount(f.orgId, true);
    expect((await status(f.owner, f.orgId)).ready).toBe(true);

    await as(f.assistant, f.orgId);
    await expectDbError(() => db.query(`select public.switch_firm_to_live()`), /firm owner step-up is required/);
    await as(f.owner, f.orgId, false);
    await expectDbError(() => db.query(`select public.switch_firm_to_live()`), /firm owner step-up is required/);
    // No direct write: the table has no UPDATE grant and the guard names live_at.
    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(`update public.organizations set live_at = now() where id = $1`, [f.orgId]), /permission denied|firm setup functions/);

    await as(f.owner, f.orgId);
    const went = (await db.query<{ r: { live: boolean; live_at: string | null } }>(`select public.switch_firm_to_live() as r`)).rows[0].r;
    expect(went.live).toBe(true);
    expect(went.live_at).toBeTruthy();
    const after = await status(f.owner, f.orgId);
    expect(after).toMatchObject({ live: true, sample_mode: false });
    // A second press keeps the first time and writes nothing more.
    await as(f.owner, f.orgId);
    await db.query(`select public.switch_firm_to_live()`);
    const rows = await audits(f.orgId);
    expect(rows.map((row) => `${row.action}:${row.result}`)).toEqual(["firm.went_live:success"]);
    expect(rows[0].context).toMatchObject({ sample_mode_was: true });
  });

  it("switches back to test mode only with the owner's confirm, and keeps every record", async () => {
    const f = await firm();
    await cardSubscription(f.orgId);
    await policies(f.orgId);
    await stripeAccount(f.orgId, true);
    await as(f.owner, f.orgId);
    await db.query(`select public.switch_firm_to_live()`);

    await as(f.assistant, f.orgId);
    await expectDbError(() => db.query(`select public.switch_firm_to_test('switch to test mode')`), /firm owner step-up is required/);
    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(`select public.switch_firm_to_test('yes')`), /confirm switching back/);
    await as(f.owner, f.orgId);
    await db.query(`select public.switch_firm_to_test('switch to test mode')`);
    const back = await status(f.owner, f.orgId);
    expect(back).toMatchObject({ live: false, live_at: null, sample_mode: false, ready: true });
    const rows = await audits(f.orgId);
    expect(rows.map((row) => `${row.action}:${row.result}`)).toEqual(["firm.went_live:success", "firm.returned_to_test_mode:success"]);
    await asMaintenance(db);
    const kept = await db.query(`select 1 from public.portal_policy_documents where organization_id = $1`, [f.orgId]);
    expect(kept.rowCount).toBe(2);
  });
});
