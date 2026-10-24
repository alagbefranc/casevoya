import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// ORG-06 (20261024130000_firm_transfers.sql): the firm owner records a transfer to a receiving
// firm, reviews each client's authority, and sees each matter's export. Nothing moves. Synthetic.

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${tag()}@example.test`]);
  return id;
}

async function setup() {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  const manager = await createUser("manager");
  await asMaintenance(db);
  await db.query(`insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, 'case_manager', 'active', now())`, [orgId, manager]);
  const a = randomUUID();
  const b = randomUUID();
  const sample = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $4, 'Work permit', false), ($2, $4, 'Visitor visa', false), ($3, $4, 'Sample', true)`, [
    a,
    b,
    sample,
    orgId,
  ]);
  const other = await createUser("other-owner");
  await asUser(db, { userId: other, aal: "aal2", totpAgeSeconds: 0 });
  const otherOrg = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Other Legal", "Other Firm", `o${tag()}`])).rows[0].id;
  return { owner, manager, orgId, a, b, sample, otherOrg, other };
}

const as = (userId: string, orgId: string, fresh = true) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: fresh ? 0 : 3600 });

async function record(ctx: Awaited<ReturnType<typeof setup>>, matters: string[]) {
  await as(ctx.owner, ctx.orgId);
  return (
    await db.query<{ id: string }>(`select public.record_firm_transfer($1, 'Receiving Immigration Inc.', 'Pat Receiver', 'PAT@receiving.test', 'Retiring; clients asked to move.', $2::uuid[]) as id`, [
      ctx.orgId,
      matters,
    ])
  ).rows[0].id;
}

async function overview(ctx: Awaited<ReturnType<typeof setup>>) {
  await as(ctx.owner, ctx.orgId, false);
  return (await db.query<{ o: { id: string; status: string; contact_email: string; items: { id: string; matter_id: string; matter: string; authority: string; export: unknown }[] }[] }>(
    `select public.firm_transfers_overview($1) as o`,
    [ctx.orgId],
  )).rows[0].o;
}

describe("firm transfers", () => {
  it("records the receiving firm and the matters in scope, moves nothing, and audits it", async () => {
    const ctx = await setup();
    const id = await record(ctx, [ctx.a, ctx.b]);
    const [transfer] = await overview(ctx);
    expect(transfer).toMatchObject({ id, status: "open", contact_email: "pat@receiving.test" });
    expect(transfer.items.map((item) => item.matter_id).sort()).toEqual([ctx.a, ctx.b].sort());
    expect(transfer.items.every((item) => item.authority === "pending" && item.export === null && Boolean(item.matter))).toBe(true);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.matters where organization_id = $1`, [ctx.orgId])).rows.length).toBe(3);
    const audit = await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where action = 'firm_transfer.recorded' and object_id = $1`, [id]);
    expect(audit.rows[0].context).toEqual({ matters: 2, contact_email: true });
  });

  it("refuses sample matters, another firm's matters, a non-owner, a stale step-up and direct reads", async () => {
    const ctx = await setup();
    await as(ctx.owner, ctx.orgId);
    const call = (matters: string[]) => db.query(`select public.record_firm_transfer($1, 'Receiving Inc.', null, null, null, $2::uuid[])`, [ctx.orgId, matters]);
    await expectDbError(() => call([ctx.sample]), /own matters/);
    await expectDbError(() => call([]), /matters in scope/);
    await as(ctx.owner, ctx.orgId, false);
    await expectDbError(() => call([ctx.a]), /step|recent|confirm|two-step/i);
    await as(ctx.manager, ctx.orgId);
    await expectDbError(() => call([ctx.a]), /denied|owner/i);
    await expectDbError(() => db.query(`select public.firm_transfers_overview($1)`, [ctx.orgId]), /denied/);
    await expectDbError(() => db.query(`select * from public.firm_transfers`), /permission denied/);
    await as(ctx.other, ctx.otherOrg);
    await expectDbError(() => db.query(`select public.record_firm_transfer($1, 'Receiving Inc.', null, null, null, $2::uuid[])`, [ctx.otherOrg, [ctx.a]]), /own matters/);
  });

  it("reviews each client's authority with a note, and only completes once all are reviewed", async () => {
    const ctx = await setup();
    const id = await record(ctx, [ctx.a, ctx.b]);
    const listed = (await overview(ctx))[0].items;
    const items = [listed.find((item) => item.matter_id === ctx.a)!, listed.find((item) => item.matter_id === ctx.b)!];
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_firm_transfer_authority($1, true, 'ok')`, [items[0].id]), /note/);
    await db.query(`select public.review_firm_transfer_authority($1, true, 'Client signed the authority to transfer on 20 Oct.')`, [items[0].id]);
    await expectDbError(() => db.query(`select public.close_firm_transfer($1, 'completed', null)`, [id]), /every matter/);
    await db.query(`select public.review_firm_transfer_authority($1, false, 'Client wants to stay with the firm.')`, [items[1].id]);
    await db.query(`select public.close_firm_transfer($1, 'completed', 'Files handed over in person.')`, [id]);
    const [transfer] = await overview(ctx);
    expect(transfer.status).toBe("completed");
    expect(Object.fromEntries(transfer.items.map((item) => [item.matter_id, item.authority]))).toEqual({ [ctx.a]: "authorised", [ctx.b]: "not_authorised" });
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_firm_transfer_authority($1, true, 'Changed my mind.')`, [items[1].id]), /closed/);
    await asMaintenance(db);
    const audit = await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where action = 'firm_transfer.authority_reviewed' and object_id = $1`, [items[0].id]);
    expect(audit.rows[0].context).toMatchObject({ authorised: true });
    expect(JSON.stringify(audit.rows[0].context)).not.toContain("signed the authority");
  });

  it("shows each matter's newest ready export made since the transfer", async () => {
    const ctx = await setup();
    await record(ctx, [ctx.a]);
    await asMaintenance(db);
    const exportId = (
      await db.query<{ id: string }>(
        `insert into public.matter_exports (organization_id, matter_id, status, stage, progress, idempotency_key, requested_by, file_count, record_count, byte_size, sha256, manifest_sha256, storage_bucket, storage_key, ready_at, expires_at)
         values ($1, $2, 'ready', 'ready', 100, $3, $4, 1, 1, 10, repeat('a', 64), repeat('b', 64), 'matter-exports', $5, now(), now() + interval '1 day') returning id`,
        [ctx.orgId, ctx.a, `k${tag()}`, ctx.owner, `${ctx.orgId}/${randomUUID()}.zip`],
      )
    ).rows[0].id;
    const [transfer] = await overview(ctx);
    expect(transfer.items[0].export).toMatchObject({ id: exportId });
  });
});
