import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * The two review rules Francis delegated to engineering on 2026-10-24
 * (20261025220000_gov_review_attestation_self_approval.sql), against the real migrations:
 * 1. an entry whose official page Casevoya couldn't capture is approved only with the reviewer's
 *    attestation (who, the date they opened the page, when), for official steps and channel names,
 *    issuers and IRCC estimates; with a capture nothing changes;
 * 2. a licensed member approves their own entry only when the firm has no other active licensed
 *    member, after a step-up taken after the entry was made.
 * Synthetic records only: no IRCC content appears here.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const PAGE = "https://www.canada.ca/en/synthetic-review-page.html#synthetic-section";
const TIMES = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html";
const HASH = "d".repeat(64);

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

const fresh = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
const stale = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 3600 });
/** A step-up a few seconds old: fresh enough for a review, but taken before an entry made just now. */
const before = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 30 });

/** A firm with an owner and a case manager; with `consultant`, also a verified licensed consultant. */
async function firm(options: { consultant: boolean } = { consultant: true }) {
  const owner = await createUser("owner");
  const manager = await createUser("manager");
  await fresh(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const ownerMembership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner])).rows[0].id;
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  let consultant: string | null = null;
  let consultantMembership: string | null = null;
  if (options.consultant) {
    consultant = await createUser("consultant");
    consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
    await fresh(consultant, orgId);
    const credential = await db.query<{ id: string }>(
      `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
      [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
    );
    await fresh(owner, orgId);
    await db.query(
      `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
         true, false, false, false, null, $3, 'Synthetic reviewer note')`,
      [credential.rows[0].id, REGISTER, PROOF],
    );
  }
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  await fresh(consultant ?? owner, orgId);
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, null, null, null, $2, null, null) as result`, [
    "Synthetic Applicant",
    consultantMembership ?? ownerMembership,
  ]);
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role, created_by) values ($1, $2, $3, 'case_manager', $4)`, [
    orgId,
    matterId,
    managerMembership,
    owner,
  ]);
  return { owner, manager, consultant, orgId, matterId, ownerMembership, managerMembership, consultantMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function proposeRequirement(ctx: Firm, captured: boolean, label = `Synthetic step ${randomUUID().slice(0, 6)}`) {
  const snapshot = captured ? JSON.stringify({ sha256: HASH, retrieved_at: new Date().toISOString(), final_url: PAGE.split("#")[0], http_status: 200 }) : null;
  const row = await db.query<{ id: string }>(
    `select public.propose_submission_requirement($1, null, 'online_portal'::public.submission_channel, 'outside_step', $2, $3, null, null, null, $4::date, null, $5::jsonb) as id`,
    [ctx.orgId, label, PAGE, firmDay(), snapshot],
  );
  return row.rows[0].id;
}

async function proposeIssuer(ctx: Firm, read: boolean, name = `Synthetic Office ${randomUUID().slice(0, 6)}`) {
  const row = await db.query<{ id: string }>(
    `select public.propose_government_issuer($1, $2, $3, $4::date, $5::timestamptz, $6, null, $7) as id`,
    read ? [ctx.orgId, name, PAGE, firmDay(), new Date().toISOString(), HASH, true] : [ctx.orgId, name, PAGE, firmDay(), null, null, null],
  );
  return row.rows[0].id;
}

async function enterEstimate(ctx: Firm, captured: boolean) {
  const row = await db.query<{ id: string }>(
    `select public.record_processing_estimate($1, $2, 'Synthetic application type', 'Synthetic estimate', $3::date, $4::timestamptz, $5) as id`,
    captured ? [ctx.matterId, TIMES, firmDay(), new Date().toISOString(), HASH] : [ctx.matterId, TIMES, firmDay(), null, null],
  );
  return row.rows[0].id;
}

type Attested = { by: string | null; on: string | null; at: string | null; status: string };
async function attestation(table: string, id: string): Promise<Attested> {
  await asMaintenance(db);
  const row = await db.query<Attested>(
    `select page_attested_by_membership_id::text as by, page_attested_on::text as on, page_attested_at::text as at, status from public.${table} where id = $1`,
    [id],
  );
  return row.rows[0];
}

async function auditActions(orgId: string, like: string) {
  await asMaintenance(db);
  const rows = await db.query<{ action: string; metadata: Record<string, unknown> }>(
    `select action, context as metadata from public.audit_log where organization_id = $1 and action like $2 order by occurred_at`,
    [orgId, like],
  );
  return rows.rows;
}

describe("Approval without a page capture needs the reviewer's attestation", () => {
  it("official steps: refused without it, the date checked, stored with who and when; unchanged with a snapshot", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const unread = await proposeRequirement(ctx, false);
    const read = await proposeRequirement(ctx, true);
    await fresh(ctx.consultant as string, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_submission_requirement($1, 1, 'approved', null)`, [unread]), /attestation/);
    await expectDbError(() => db.query(`select public.review_submission_requirement($1, 1, 'approved', null, null)`, [unread]), /attestation/);
    await expectDbError(() => db.query(`select public.review_submission_requirement($1, 1, 'approved', null, $2::date)`, [unread, firmDay(1)]), /between the day the entry was made and today/);
    await expectDbError(() => db.query(`select public.review_submission_requirement($1, 1, 'approved', null, $2::date)`, [unread, firmDay(-1)]), /between the day the entry was made and today/);
    await db.query(`select public.review_submission_requirement($1, 1, 'approved', null, $2::date)`, [unread, firmDay()]);
    const stored = await attestation("submission_requirements", unread);
    expect(stored).toMatchObject({ status: "approved", by: ctx.consultantMembership, on: firmDay() });
    expect(stored.at).not.toBeNull();

    // With a snapshot: approved as before; a date passed anyway is not kept.
    await fresh(ctx.consultant as string, ctx.orgId);
    await db.query(`select public.review_submission_requirement($1, 1, 'approved', null, $2::date)`, [read, firmDay()]);
    expect(await attestation("submission_requirements", read)).toMatchObject({ status: "approved", by: null, on: null, at: null });

    const audit = await auditActions(ctx.orgId, "submission.requirement_approved%");
    expect(audit.map((row) => [row.action, row.metadata.page_attested_on ?? null])).toEqual([
      ["submission.requirement_approved", firmDay()],
      ["submission.requirement_approved", null],
    ]);

    // Rejecting needs no attestation.
    await stale(ctx.manager, ctx.orgId);
    const another = await proposeRequirement(ctx, false);
    await fresh(ctx.consultant as string, ctx.orgId);
    await db.query(`select public.review_submission_requirement($1, 1, 'rejected', 'Synthetic reason')`, [another]);
    expect(await attestation("submission_requirements", another)).toMatchObject({ status: "rejected", on: null });

    // The attestation can't be forged directly.
    await fresh(ctx.consultant as string, ctx.orgId);
    await expectDbError(() => db.query(`update public.submission_requirements set page_attested_on = $2::date where id = $1`, [another, firmDay()]), /permission denied/);
  });

  it("issuers: an unread page needs the attestation; a read page doesn't; retiring keeps it", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const unread = await proposeIssuer(ctx, false);
    const read = await proposeIssuer(ctx, true);
    await fresh(ctx.consultant as string, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_government_issuer($1, 1, 'approved', null)`, [unread]), /attestation/);
    await expectDbError(() => db.query(`select public.review_government_issuer($1, 1, 'approved', null, $2::date)`, [unread, firmDay(1)]), /between/);
    await db.query(`select public.review_government_issuer($1, 1, 'approved', null, $2::date)`, [unread, firmDay()]);
    expect(await attestation("government_issuers", unread)).toMatchObject({ status: "approved", by: ctx.consultantMembership, on: firmDay() });
    await fresh(ctx.consultant as string, ctx.orgId);
    await db.query(`select public.review_government_issuer($1, 1, 'approved', null)`, [read]);
    expect(await attestation("government_issuers", read)).toMatchObject({ status: "approved", on: null });

    await fresh(ctx.consultant as string, ctx.orgId);
    await db.query(`select public.review_government_issuer($1, 2, 'retired', 'Synthetic page changed')`, [unread]);
    expect(await attestation("government_issuers", unread)).toMatchObject({ status: "retired", by: ctx.consultantMembership, on: firmDay() });
  });

  it("IRCC estimates: an uncaptured page needs the attestation; a captured one doesn't", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const unread = await enterEstimate(ctx, false);
    await fresh(ctx.consultant as string, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_processing_estimate($1, 1, 'approved', null)`, [unread]), /attestation/);
    await db.query(`select public.review_processing_estimate($1, 1, 'approved', null, $2::date)`, [unread, firmDay()]);
    expect(await attestation("government_processing_estimates", unread)).toMatchObject({ status: "approved", by: ctx.consultantMembership, on: firmDay() });

    await stale(ctx.manager, ctx.orgId);
    const read = await enterEstimate(ctx, true);
    await fresh(ctx.consultant as string, ctx.orgId);
    await db.query(`select public.review_processing_estimate($1, 1, 'approved', null, $2::date)`, [read, firmDay()]);
    expect(await attestation("government_processing_estimates", read)).toMatchObject({ status: "approved", on: null });
    // The earlier one is superseded and keeps its attestation.
    expect(await attestation("government_processing_estimates", unread)).toMatchObject({ status: "superseded", on: firmDay() });
  });
});

describe("Approving your own entry", () => {
  it("is refused while another active licensed member can review it, for steps, issuers and estimates", async () => {
    const ctx = await firm();
    const consultant = ctx.consultant as string;
    await fresh(consultant, ctx.orgId);
    const step = await proposeRequirement(ctx, true);
    const issuer = await proposeIssuer(ctx, true);
    const estimate = await enterEstimate(ctx, true);
    await fresh(consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_submission_requirement($1, 1, 'approved', null, null)`, [step]), /another licensed member/);
    await expectDbError(() => db.query(`select public.review_government_issuer($1, 1, 'approved', null, null)`, [issuer]), /another licensed member/);
    await expectDbError(() => db.query(`select public.review_processing_estimate($1, 1, 'approved', null, null)`, [estimate]), /another licensed member/);
    // Rejecting your own entry publishes nothing, so it stays allowed.
    await db.query(`select public.review_government_issuer($1, 1, 'rejected', 'Synthetic typo in the name')`, [issuer]);

    // The other licensed member (the owner) approves them.
    await fresh(ctx.owner, ctx.orgId);
    await db.query(`select public.review_submission_requirement($1, 1, 'approved', null, null)`, [step]);
    await db.query(`select public.review_processing_estimate($1, 1, 'approved', null, null)`, [estimate]);
    const audit = await auditActions(ctx.orgId, "%approved%");
    expect(audit.map((row) => row.action)).toEqual(["submission.requirement_approved", "government.estimate_approved"]);
  });

  it("is allowed when the firm has no other active licensed member, after a step-up taken after the entry, and audited as self", async () => {
    const ctx = await firm({ consultant: false });
    await fresh(ctx.owner, ctx.orgId);
    const step = await proposeRequirement(ctx, false);
    const issuer = await proposeIssuer(ctx, true);
    const estimate = await enterEstimate(ctx, true);

    // A step-up taken before the entry was made isn't enough for your own entry.
    await before(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_government_issuer($1, 1, 'approved', null, null)`, [issuer]), /step-up/);

    await fresh(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_submission_requirement($1, 1, 'approved', null, null)`, [step]), /attestation/);
    await db.query(`select public.review_submission_requirement($1, 1, 'approved', null, $2::date)`, [step, firmDay()]);
    await db.query(`select public.review_government_issuer($1, 1, 'approved', null, null)`, [issuer]);
    await db.query(`select public.review_processing_estimate($1, 1, 'approved', null, null)`, [estimate]);
    expect(await attestation("submission_requirements", step)).toMatchObject({ status: "approved", by: ctx.ownerMembership, on: firmDay() });
    const audit = await auditActions(ctx.orgId, "%approved%");
    expect(audit.map((row) => [row.action, row.metadata.self_approved])).toEqual([
      ["submission.requirement_approved_self", true],
      ["government.issuer_approved_self", true],
      ["government.estimate_approved_self", true],
    ]);
  });

  it("counts only active licensed members: a suspended member or a case manager doesn't stop a self-approval", async () => {
    const ctx = await firm();
    await fresh(ctx.owner, ctx.orgId);
    const issuer = await proposeIssuer(ctx, true);
    await fresh(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_government_issuer($1, 1, 'approved', null, null)`, [issuer]), /another licensed member/);
    await asMaintenance(db);
    await db.query(`update public.memberships set status = 'suspended' where id = $1`, [ctx.consultantMembership]);
    await fresh(ctx.owner, ctx.orgId);
    await db.query(`select public.review_government_issuer($1, 1, 'approved', null, null)`, [issuer]);
    expect(await attestation("government_issuers", issuer)).toMatchObject({ status: "approved" });
  });
});
