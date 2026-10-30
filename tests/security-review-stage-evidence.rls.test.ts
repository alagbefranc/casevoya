import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Stage-entry evidence is written only by definer workflows (20261030150000): staff cannot insert
 * evidence rows or call the transition function directly, and a matter is closed only through
 * public.close_matter (the stage override refuses 'closed').
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

const as = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });

async function newMatter(orgId: string, consultant: string, consultantMembership: string) {
  await as(consultant, orgId);
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, null, null, null, $2, null, null) as result`, [
    "Synthetic Applicant",
    consultantMembership,
  ]);
  return matter.rows[0].result.id;
}

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  const assistant = await createUser("assistant");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  const assistantMembership = await activeMembership(orgId, assistant, "assistant", owner);

  await as(consultant, orgId);
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await as(owner, orgId);
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  await db.exec("set session_replication_role = replica");
  await db.query(`update public.organizations set sample_mode = false, retention_policy = '{"unit":"years","count":7}'::jsonb where id = $1`, [orgId]);
  await db.exec("set session_replication_role = origin");

  const matterId = await newMatter(orgId, consultant, consultantMembership);
  // Staff on the matter, so refusals come from the privilege rules rather than visibility.
  await asMaintenance(db);
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role)
     values ($1, $2, $3, 'case_manager'), ($1, $2, $4, 'assistant')`,
    [orgId, matterId, managerMembership, assistantMembership],
  );
  return { owner, consultant, manager, assistant, orgId, matterId, consultantMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

/** Test setup only: move a matter straight to a stage, with triggers off, as maintenance. */
async function forceStage(matterId: string, stage: string) {
  await asMaintenance(db);
  await db.exec("set session_replication_role = replica");
  await db.query(`update public.matters set stage = $2::public.matter_stage where id = $1`, [matterId, stage]);
  await db.exec("set session_replication_role = origin");
}

async function addUnpaidInvoice(orgId: string, matterId: string) {
  await asMaintenance(db);
  await db.exec("set session_replication_role = replica");
  await db.query(
    `insert into public.invoices (organization_id, matter_id, number, description, fee_category, amount_cents, paid_cents, currency, due_on, issued_on, status, idempotency_key)
     values ($1, $2, $3, 'Synthetic fee', 'professional_fee', 50000, 0, 'CAD', current_date, current_date, 'issued', $4)`,
    [orgId, matterId, `INV-${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, `k-${randomUUID()}`],
  );
  await db.exec("set session_replication_role = origin");
}

async function matterRow(matterId: string) {
  await asMaintenance(db);
  const row = await db.query<{ version: number; stage: string }>(`select version, stage::text as stage from public.matters where id = $1`, [matterId]);
  return row.rows[0];
}

async function countWhere(sql: string, params: unknown[]) {
  await asMaintenance(db);
  const row = await db.query<{ n: number }>(sql, params);
  return Number(row.rows[0].n);
}

const EVIDENCE_KINDS = ["closure", "submission_approvals", "verified_submission", "official_decision", "service_agreement", "outcome_and_follow_up"];

describe("stage-entry evidence is definer-only", () => {
  it("refuses a direct evidence insert from every staff role, for any kind", async () => {
    const ctx = await firm();
    for (const userId of [ctx.owner, ctx.consultant, ctx.manager, ctx.assistant]) {
      for (const kind of EVIDENCE_KINDS) {
        await as(userId, ctx.orgId);
        await expectDbError(
          () =>
            db.query(
              `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
               values ($1, $2, $3::public.matter_stage_evidence_kind, 'Synthetic evidence')`,
              [ctx.orgId, ctx.matterId, kind],
            ),
          /permission denied/,
        );
      }
    }
    await as(ctx.consultant, ctx.orgId);
    await expectDbError(
      () =>
        db.query(
          `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary, external_reference, submission_at, receipt_locator)
           values ($1, $2, 'submission_confirmation', 'Filed', 'SYN-1', statement_timestamp(), 'receipt-synthetic')`,
          [ctx.orgId, ctx.matterId],
        ),
      /permission denied/,
    );
    expect(await countWhere(`select count(*)::int as n from public.matter_stage_evidence where matter_id = $1`, [ctx.matterId])).toBe(0);

    // Matter readers still read the evidence the workflows write.
    await asMaintenance(db);
    await db.query(
      `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary) values ($1, $2, 'facts_reviewed', 'Synthetic evidence')`,
      [ctx.orgId, ctx.matterId],
    );
    await as(ctx.consultant, ctx.orgId);
    const seen = await db.query(`select id from public.matter_stage_evidence where matter_id = $1`, [ctx.matterId]);
    expect(seen.rows).toHaveLength(1);
  });

  it("refuses direct calls to the transition functions from staff", async () => {
    const ctx = await firm();
    const before = await matterRow(ctx.matterId);
    for (const userId of [ctx.owner, ctx.consultant, ctx.manager, ctx.assistant]) {
      await as(userId, ctx.orgId);
      for (const fn of ["public.transition_matter_stage", "app.transition_matter_stage", "public.attempt_matter_stage_transition"]) {
        await expectDbError(
          () => db.query(`select ${fn}($1, 'intake', $2, 'Direct call')`, [ctx.matterId, before.version]),
          /permission denied/,
        );
      }
    }
    expect((await matterRow(ctx.matterId)).stage).toBe("engagement_pending");
  });
});

describe("closing a matter", () => {
  async function postDecision(ctx: Firm) {
    await forceStage(ctx.matterId, "post_decision");
    return matterRow(ctx.matterId);
  }

  it("refuses a stage override to closed, so open money still blocks closure", async () => {
    const ctx = await firm();
    await addUnpaidInvoice(ctx.orgId, ctx.matterId);
    const current = await postDecision(ctx);

    for (const userId of [ctx.consultant, ctx.owner]) {
      await as(userId, ctx.orgId);
      await expectDbError(
        () => db.query(`select public.override_matter_stage($1, 'closed', $2, 'Skip the closure checks')`, [ctx.matterId, current.version]),
        /close_matter/,
      );
    }
    expect(await matterRow(ctx.matterId)).toEqual(current);
    expect(
      await countWhere(`select count(*)::int as n from public.matter_stage_overrides where matter_id = $1 and to_stage = 'closed'`, [ctx.matterId]),
    ).toBe(0);

    // The closing workflow still sees the unpaid invoice.
    await as(ctx.consultant, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.close_matter($1, $2, 'Outcome delivered', null)`, [ctx.matterId, current.version]),
      /closure blocked/,
    );
    expect((await matterRow(ctx.matterId)).stage).toBe("post_decision");
  });

  it("keeps other overrides and the close_matter path working", async () => {
    const ctx = await firm();
    const start = await postDecision(ctx);

    // A non-closing override still works (a documented return), and back again.
    await as(ctx.consultant, ctx.orgId);
    const back = await db.query<{ result: { ok: boolean; version: number } }>(
      `select public.override_matter_stage($1, 'decision_review', $2, 'Decision letter needs review') as result`,
      [ctx.matterId, start.version],
    );
    expect(back.rows[0].result.ok).toBe(true);
    await as(ctx.consultant, ctx.orgId);
    const forward = await db.query<{ result: { ok: boolean; version: number } }>(
      `select public.override_matter_stage($1, 'post_decision', $2, 'Review finished') as result`,
      [ctx.matterId, back.rows[0].result.version],
    );
    expect(forward.rows[0].result.ok).toBe(true);

    const current = await matterRow(ctx.matterId);
    expect(current.stage).toBe("post_decision");
    await as(ctx.consultant, ctx.orgId);
    const closed = await db.query<{ id: string }>(`select public.close_matter($1, $2, 'Outcome delivered to client', null) as id`, [
      ctx.matterId,
      current.version,
    ]);
    expect(closed.rows[0].id).toBeTruthy();

    expect((await matterRow(ctx.matterId)).stage).toBe("closed");
    expect(
      await countWhere(
        `select count(*)::int as n from public.matter_closures c
         join public.matter_stage_evidence e on e.id = c.evidence_id and e.kind = 'closure'
         where c.id = $1`,
        [closed.rows[0].id],
      ),
    ).toBe(1);
    expect(
      await countWhere(
        `select count(*)::int as n from public.matter_stage_transitions where matter_id = $1 and to_stage = 'closed' and evidence_id is not null`,
        [ctx.matterId],
      ),
    ).toBe(1);
  });
});
