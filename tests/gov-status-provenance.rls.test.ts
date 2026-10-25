import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * GOV-05 against the real migrations: Mark checked per status, sharing a status with the client,
 * and IRCC processing-time estimates held for licensed review. Synthetic records only: no IRCC
 * value appears here (estimates are "Synthetic estimate" text on an allowlisted URL).
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const TIMES = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html";

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

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  const assistant = await createUser("assistant");
  const client = await createUser("client");
  await fresh(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  await activeMembership(orgId, assistant, "assistant", owner);

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
  const party = await db.query<{ person_id: string }>(
    `select person_id from public.matter_participants where matter_id = $1 and person_id is not null limit 1`,
    [matterId],
  );
  const personId = party.rows[0].person_id;
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role, created_by) values ($1, $2, $3, 'case_manager', $4)`,
    [orgId, matterId, managerMembership, owner],
  );
  await db.query(`update public.persons set user_id = $1 where id = $2`, [client, personId]);
  await activeMembership(orgId, client, "client", owner);
  return { owner, consultant, manager, assistant, client, orgId, matterId, consultantMembership, managerMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function letter(ctx: Firm, kind = "status_update") {
  await stale(ctx.manager, ctx.orgId);
  const row = await db.query<{ id: string }>(
    `select public.record_government_correspondence($1, $2::public.correspondence_kind, null, 'portal_message',
       null, $3::date, null, null, null, null, 'Synthetic screenshot, saved on the matter', null) as id`,
    [ctx.matterId, kind, firmDay()],
  );
  return row.rows[0].id;
}

async function estimate(ctx: Firm, url = TIMES, capture: { at: string | null; hash: string | null } = { at: null, hash: null }) {
  await stale(ctx.manager, ctx.orgId);
  const row = await db.query<{ id: string }>(
    `select public.record_processing_estimate($1, $2, 'Synthetic application type', 'Synthetic estimate', $3::date, $4::timestamptz, $5) as id`,
    [ctx.matterId, url, firmDay(), capture.at, capture.hash],
  );
  return row.rows[0].id;
}

describe("GOV-05 Mark checked", () => {
  it("records a check of one status or of the whole matter, append-only and audited", async () => {
    const ctx = await firm();
    const id = await letter(ctx);
    // An assistant not on the matter is outside consultant scope; the assigned case manager checks.
    await stale(ctx.assistant, ctx.orgId);
    await expectDbError(() => db.query(`select public.mark_government_checked($1, $2)`, [ctx.matterId, id]), /denied/);
    await stale(ctx.manager, ctx.orgId);
    await db.query(`select public.mark_government_checked($1, $2)`, [ctx.matterId, id]);
    await db.query(`select public.mark_government_checked($1, null)`, [ctx.matterId]);

    await stale(ctx.manager, ctx.orgId);
    const rows = await db.query<{ correspondence_id: string | null; note: string }>(
      `select correspondence_id, note from public.government_status_checks where matter_id = $1 order by checked_at, correspondence_id nulls last`,
      [ctx.matterId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.find((row) => row.correspondence_id === id)?.note).toMatch(/this status/);
    expect(rows.rows.some((row) => row.correspondence_id === null)).toBe(true);

    await asMaintenance(db);
    const audit = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log where organization_id = $1 and action = 'government.status_checked'`,
      [ctx.orgId],
    );
    expect(audit.rows[0].n).toBe(2);
    await expectDbError(() => db.query(`update public.government_status_checks set note = 'changed' where matter_id = $1`, [ctx.matterId]), /append-only/);

    // Clients, other firms and direct writes are refused.
    await stale(ctx.client, ctx.orgId);
    await expectDbError(() => db.query(`select public.mark_government_checked($1, null)`, [ctx.matterId]), /denied|staff/);
    expect((await db.query(`select id from public.government_status_checks where matter_id = $1`, [ctx.matterId])).rows).toHaveLength(0);
    const other = await firm();
    await stale(other.owner, other.orgId);
    await expectDbError(() => db.query(`select public.mark_government_checked($1, null)`, [ctx.matterId]), /denied/);
    // A status from another matter is refused.
    await expectDbError(() => db.query(`select public.mark_government_checked($1, $2)`, [other.matterId, id]), /not on this matter/);
    await expectDbError(
      () => db.query(`insert into public.government_status_checks (organization_id, matter_id, note, checked_by_membership_id) values ($1, $2, 'forged', $3)`, [
        other.orgId,
        other.matterId,
        other.managerMembership,
      ]),
      /permission denied/,
    );
  });
});

describe("GOV-05 Share with client", () => {
  it("shows a status to the client only once the firm shares it", async () => {
    const ctx = await firm();
    const id = await letter(ctx);
    await fresh(ctx.manager, ctx.orgId);
    await db.query(`select public.verify_government_correspondence($1, 1)`, [id]);
    await fresh(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.government_correspondence where id = $1`, [id])).rows).toHaveLength(0);
    // A case manager cannot share; the consultant needs a fresh step-up.
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.share_government_record('correspondence', $1)`, [id]), /denied|staff/);
    await stale(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.share_government_record('correspondence', $1)`, [id]), /step-up/);
    await fresh(ctx.consultant, ctx.orgId);
    await db.query(`select public.share_government_record('correspondence', $1)`, [id]);
    await fresh(ctx.client, ctx.orgId);
    const seen = await db.query<{ kind: string; shared: boolean }>(
      `select kind::text as kind, shared_with_client_at is not null as shared from public.government_correspondence where id = $1`,
      [id],
    );
    expect(seen.rows).toEqual([{ kind: "status_update", shared: true }]);
  });
});

describe("GOV-05 IRCC processing-time estimates", () => {
  it("takes only canada.ca URLs, holds the estimate for licensed review, and supersedes the earlier one", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () =>
        db.query(`select public.record_processing_estimate($1, 'https://example.com/times', 'Synthetic type', 'Synthetic estimate', $2::date, null, null)`, [
          ctx.matterId,
          firmDay(),
        ]),
      /official processing-times page/,
    );
    // An allowlisted host that is not canada.ca (Justice Laws) is still refused.
    await expectDbError(
      () =>
        db.query(
          `select public.record_processing_estimate($1, 'https://laws-lois.justice.gc.ca/eng/acts/I-2.5/', 'Synthetic type', 'Synthetic estimate', $2::date, null, null)`,
          [ctx.matterId, firmDay()],
        ),
      /official processing-times page/,
    );
    await expectDbError(
      () => db.query(`select public.record_processing_estimate($1, $2, 'Synthetic type', 'Synthetic estimate', $3::date, null, null)`, [ctx.matterId, TIMES, firmDay(1)]),
      /future/,
    );
    await expectDbError(
      () =>
        db.query(`select public.record_processing_estimate($1, $2, 'Synthetic type', 'Synthetic estimate', $3::date, statement_timestamp(), null)`, [
          ctx.matterId,
          TIMES,
          firmDay(),
        ]),
      /both its time and its hash/,
    );

    const first = await estimate(ctx, TIMES, { at: new Date().toISOString(), hash: "b".repeat(64) });
    await asMaintenance(db);
    const pending = await db.query<{ status: string; snapshot_sha256: string; entered: string }>(
      `select status, snapshot_sha256, entered_by_membership_id::text as entered from public.government_processing_estimates where id = $1`,
      [first],
    );
    expect(pending.rows[0]).toEqual({ status: "pending_review", snapshot_sha256: "b".repeat(64), entered: ctx.managerMembership });

    // Only a licensed member with a fresh step-up reviews it.
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_processing_estimate($1, 1, 'approved', null)`, [first]), /licen|denied|staff/);
    await stale(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_processing_estimate($1, 1, 'approved', null)`, [first]), /step-up/);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_processing_estimate($1, 1, 'rejected', null)`, [first]), /why/);
    await expectDbError(() => db.query(`select public.review_processing_estimate($1, 7, 'approved', null)`, [first]), /version conflict/);
    await db.query(`select public.review_processing_estimate($1, 1, 'approved', null)`, [first]);
    await expectDbError(() => db.query(`select public.review_processing_estimate($1, 2, 'approved', null)`, [first]), /already reviewed/);

    const second = await estimate(ctx);
    await fresh(ctx.consultant, ctx.orgId);
    // No page capture: approved only with the reviewer's attestation (GOV follow-up, 2026-10-24).
    await expectDbError(() => db.query(`select public.review_processing_estimate($1, 1, 'approved', null)`, [second]), /attestation/);
    await db.query(`select public.review_processing_estimate($1, 1, 'approved', null, $2::date)`, [second, firmDay()]);
    await asMaintenance(db);
    const statuses = await db.query<{ id: string; status: string }>(
      `select id, status from public.government_processing_estimates where matter_id = $1`,
      [ctx.matterId],
    );
    expect(Object.fromEntries(statuses.rows.map((row) => [row.id, row.status]))).toEqual({ [first]: "superseded", [second]: "approved" });
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log where organization_id = $1 and action like 'government.estimate_%' order by occurred_at`,
      [ctx.orgId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "government.estimate_entered",
      "government.estimate_approved",
      "government.estimate_entered",
      "government.estimate_approved",
    ]);
  });

  it("keeps estimates to the firm's staff on the matter and refuses direct writes", async () => {
    const ctx = await firm();
    const id = await estimate(ctx);
    await fresh(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.government_processing_estimates where id = $1`, [id])).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.record_processing_estimate($1, $2, 'Synthetic type', 'Synthetic estimate', $3::date, null, null)`, [ctx.matterId, TIMES, firmDay()]), /denied|staff/);
    const other = await firm();
    await fresh(other.owner, other.orgId);
    expect((await db.query(`select id from public.government_processing_estimates where id = $1`, [id])).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.review_processing_estimate($1, 1, 'approved', null)`, [id]), /denied/);
    await fresh(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`update public.government_processing_estimates set estimate_text = 'forged' where id = $1`, [id]), /permission denied/);
    await asMaintenance(db);
    await expectDbError(
      () =>
        db.query(
          `do $$ begin
             insert into app.gov_write_nonce values ('${id}', txid_current());
             update public.government_processing_estimates set estimate_text = 'forged' where id = '${id}';
           end $$`,
        ),
      /not overwritten/,
    );
    await expectDbError(() => db.query(`update public.government_processing_estimates set status = 'approved' where id = $1`, [id]), /only through their functions/);
  });
});
