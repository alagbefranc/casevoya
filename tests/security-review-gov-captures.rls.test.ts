import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";
import { serverCapture } from "./helpers/server-capture";

/**
 * Security review (20261031010000_server_captures_issuers_estimates.sql): a government issuer or an
 * IRCC processing estimate counts as captured only when it names this firm's server capture of the
 * same page; a hash, time, date or name check sent by the caller is not stored. Whether the issuer's
 * name is on the page is recorded only by the capture service. Synthetic records only.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const PAGE = "https://www.canada.ca/en/synthetic-issuer-page.html#synthetic-office";
const OTHER_PAGE = "https://www.canada.ca/en/synthetic-other-page.html";
const TIMES = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html";
const HASH = "c".repeat(64);

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

/** A firm with an owner, a case manager on one matter, and a verified licensed consultant. */
async function firm() {
  const owner = await createUser("owner");
  const manager = await createUser("manager");
  const consultant = await createUser("consultant");
  await fresh(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
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
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  await fresh(consultant, orgId);
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, null, null, null, $2, null, null) as result`, [
    "Synthetic Applicant",
    consultantMembership,
  ]);
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role, created_by) values ($1, $2, $3, 'case_manager', $4)`, [
    orgId,
    matterId,
    managerMembership,
    owner,
  ]);
  return { owner, manager, consultant, orgId, matterId };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const name = () => `Synthetic Office ${randomUUID().slice(0, 6)}`;

async function issuerRow(id: string) {
  await asMaintenance(db);
  const row = await db.query<{ snapshot_sha256: string | null; retrieved_at: string | null; page_modified_on: string | null; name_on_page: boolean | null; version: number }>(
    `select snapshot_sha256, retrieved_at::text, page_modified_on::text, name_on_page, version from public.government_issuers where id = $1`,
    [id],
  );
  return row.rows[0];
}

async function estimateRow(id: string) {
  await asMaintenance(db);
  const row = await db.query<{ snapshot_sha256: string | null; page_retrieved_at: string | null }>(
    `select snapshot_sha256, page_retrieved_at::text from public.government_processing_estimates where id = $1`,
    [id],
  );
  return row.rows[0];
}

async function snapshotTime(id: string) {
  await asMaintenance(db);
  return (await db.query<{ at: string }>(`select retrieved_at::text as at from public.source_snapshots where id = $1`, [id])).rows[0].at;
}

async function proposeIssuer(ctx: Firm, issuer: string, snapshot: unknown) {
  await stale(ctx.manager, ctx.orgId);
  const row = await db.query<{ id: string }>(`select public.propose_government_issuer($1, $2, $3, $4::date, $5::jsonb) as id`, [
    ctx.orgId,
    issuer,
    PAGE,
    firmDay(),
    snapshot === null ? null : JSON.stringify(snapshot),
  ]);
  return row.rows[0].id;
}

async function recordNameCheck(orgId: string, actor: string, issuerId: string, value: boolean) {
  await asServiceRole(db);
  try {
    return (await db.query<{ v: boolean }>(`select public.service_record_issuer_name_on_page($1, $2, $3, $4) as v`, [orgId, actor, issuerId, value])).rows[0].v;
  } finally {
    await asMaintenance(db);
  }
}

describe("Government issuers: only a server capture counts", () => {
  it("does not store a hash, time, date or name check sent by the caller; approval then needs the attestation", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const legacy = await db.query<{ id: string }>(
      `select public.propose_government_issuer($1, $2, $3, $4::date, statement_timestamp(), $5, $6::date, true) as id`,
      [ctx.orgId, name(), PAGE, firmDay(), HASH, firmDay(-3)],
    );
    const legacyId = legacy.rows[0].id;
    expect(await issuerRow(legacyId)).toMatchObject({ snapshot_sha256: null, retrieved_at: null, page_modified_on: null, name_on_page: null });

    // A hash in the new payload is not a capture either.
    const typed = await proposeIssuer(ctx, name(), { sha256: HASH, retrieved_at: new Date().toISOString() });
    expect(await issuerRow(typed)).toMatchObject({ snapshot_sha256: null, retrieved_at: null });

    await asMaintenance(db);
    const audit = await db.query<{ context: Record<string, unknown> }>(
      `select context from public.audit_log where organization_id = $1 and action = 'government.issuer_proposed' order by occurred_at`,
      [ctx.orgId],
    );
    expect(audit.rows.map((row) => [row.context.page_read, row.context.unverified_capture])).toEqual([
      [false, true],
      [false, true],
    ]);

    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_government_issuer($1, 1, 'approved', null, null)`, [legacyId]), /attestation/);
  });

  it("takes the hash, time and date modified from this firm's server capture of the same page", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const capture = await serverCapture(db, { orgId: ctx.orgId, url: PAGE, snapshot: { sha256: HASH, modified_on: firmDay(-10) } });
    const id = await proposeIssuer(ctx, name(), capture);
    const row = await issuerRow(id);
    expect(row).toMatchObject({ snapshot_sha256: HASH, page_modified_on: firmDay(-10), name_on_page: null });
    expect(row.retrieved_at).toBe(await snapshotTime(capture.snapshot_id));

    // Approved without an attestation, by another licensed member.
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.review_government_issuer($1, 1, 'approved', null, null)`, [id]);

    // A capture of another page, or another firm's capture of this page, is refused.
    await stale(ctx.manager, ctx.orgId);
    const otherPage = await serverCapture(db, { orgId: ctx.orgId, url: OTHER_PAGE, snapshot: { sha256: HASH } });
    await expectDbError(() => proposeIssuer(ctx, name(), otherPage), /not stored by Casevoya/);
    const other = await firm();
    await stale(other.manager, other.orgId);
    const theirs = await serverCapture(db, { orgId: other.orgId, url: PAGE, snapshot: { sha256: HASH } });
    await expectDbError(() => proposeIssuer(ctx, name(), theirs), /not stored by Casevoya/);
  });

  it("records whether the name is on the page only through the capture service, once", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const capture = await serverCapture(db, { orgId: ctx.orgId, url: PAGE, snapshot: { sha256: HASH } });
    const id = await proposeIssuer(ctx, name(), capture);

    // A signed-in member can't call it.
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.service_record_issuer_name_on_page($1, $2, $3, true)`, [ctx.orgId, ctx.manager, id]), /permission denied/);

    // Someone other than the member who proposed it, or another firm, is refused.
    await expectDbError(() => recordNameCheck(ctx.orgId, ctx.consultant, id, true), /closed/);
    const other = await firm();
    await expectDbError(() => recordNameCheck(other.orgId, ctx.manager, id, true), /closed/);

    expect(await recordNameCheck(ctx.orgId, ctx.manager, id, false)).toBe(false);
    expect(await issuerRow(id)).toMatchObject({ name_on_page: false, version: 2 });
    // Once only.
    await expectDbError(() => recordNameCheck(ctx.orgId, ctx.manager, id, true), /closed/);

    // An issuer without a capture has no name check.
    const unread = await proposeIssuer(ctx, name(), null);
    await expectDbError(() => recordNameCheck(ctx.orgId, ctx.manager, unread, true), /closed/);
    expect(await issuerRow(unread)).toMatchObject({ name_on_page: null });
  });
});

describe("IRCC processing estimates: only a server capture counts", () => {
  it("ignores a caller's hash, uses this firm's capture of the same page, and refuses any other capture", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const legacy = await db.query<{ id: string }>(
      `select public.record_processing_estimate($1, $2, 'Synthetic type', 'Synthetic estimate', $3::date, statement_timestamp(), $4) as id`,
      [ctx.matterId, TIMES, firmDay(), HASH],
    );
    expect(await estimateRow(legacy.rows[0].id)).toEqual({ snapshot_sha256: null, page_retrieved_at: null });
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_processing_estimate($1, 1, 'approved', null, null)`, [legacy.rows[0].id]), /attestation/);

    const enter = async (snapshot: unknown) => {
      await stale(ctx.manager, ctx.orgId);
      const row = await db.query<{ id: string }>(
        `select public.record_processing_estimate($1, $2, 'Synthetic type', 'Synthetic estimate', $3::date, $4::jsonb) as id`,
        [ctx.matterId, TIMES, firmDay(), snapshot === null ? null : JSON.stringify(snapshot)],
      );
      return row.rows[0].id;
    };

    await stale(ctx.manager, ctx.orgId);
    const capture = await serverCapture(db, { orgId: ctx.orgId, url: TIMES, snapshot: { sha256: HASH } });
    const captured = await enter(capture);
    expect(await estimateRow(captured)).toEqual({ snapshot_sha256: HASH, page_retrieved_at: await snapshotTime(capture.snapshot_id) });
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.review_processing_estimate($1, 1, 'approved', null, null)`, [captured]);

    expect(await estimateRow(await enter({ sha256: HASH }))).toEqual({ snapshot_sha256: null, page_retrieved_at: null });

    await stale(ctx.manager, ctx.orgId);
    const otherPage = await serverCapture(db, { orgId: ctx.orgId, url: OTHER_PAGE, snapshot: { sha256: HASH } });
    await expectDbError(() => enter(otherPage), /not stored by Casevoya/);
    const other = await firm();
    await stale(other.manager, other.orgId);
    const theirs = await serverCapture(db, { orgId: other.orgId, url: TIMES, snapshot: { sha256: HASH } });
    await expectDbError(() => enter(theirs), /not stored by Casevoya/);
  });
});
