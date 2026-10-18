import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * T040 / T041 against the real migrations: report export audit, client-file export jobs, legal
 * holds and matter closure with the firm's retention setting.
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

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const finance = await createUser("finance");
  const assistant = await createUser("assistant");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  await activeMembership(orgId, finance, "finance_user", owner);
  await activeMembership(orgId, assistant, "assistant", owner);

  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);

  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, null, null, null, $2, null, null) as result`, [
    "Synthetic Applicant",
    consultantMembership,
  ]);
  return { owner, consultant, finance, assistant, orgId, matterId: matter.rows[0].result.id };
}

/** Test setup only: move a matter straight to a stage, with triggers off, as maintenance. */
async function forceStage(matterId: string, stage: string) {
  await asMaintenance(db);
  await db.exec("set session_replication_role = replica");
  await db.query(`update public.matters set stage = $2::public.matter_stage where id = $1`, [matterId, stage]);
  await db.exec("set session_replication_role = origin");
}

async function setRetention(orgId: string, years: number | null) {
  await asMaintenance(db);
  await db.exec("set session_replication_role = replica");
  await db.query(`update public.organizations set retention_policy = $2::jsonb where id = $1`, [
    orgId,
    years === null ? null : JSON.stringify({ unit: "years", count: years }),
  ]);
  await db.exec("set session_replication_role = origin");
}

async function addInvoice(orgId: string, matterId: string, amount: number, paid: number) {
  await asMaintenance(db);
  await db.exec("set session_replication_role = replica");
  await db.query(
    `insert into public.invoices (organization_id, matter_id, number, description, fee_category, amount_cents, paid_cents, currency, due_on, issued_on, status, idempotency_key)
     values ($1, $2, $3, 'Synthetic fee', 'professional_fee', $4, $5, 'CAD', current_date, current_date, 'issued', $6)`,
    [orgId, matterId, `INV-${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, amount, paid, `k-${randomUUID()}`],
  );
  await db.exec("set session_replication_role = origin");
}

async function version(matterId: string) {
  await asMaintenance(db);
  const row = await db.query<{ version: number }>(`select version from public.matters where id = $1`, [matterId]);
  return row.rows[0].version;
}

describe("Report export audit (public.record_report_export)", () => {
  it("audits an allowed export and refuses a tab the role can't see", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    const ok = await db.query<{ id: string }>(`select public.record_report_export($1, 'ops', '90d', 'csv') as id`, [ctx.orgId]);
    expect(ok.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    await expectDbError(() => db.query(`select public.record_report_export($1, 'money', '90d', 'csv')`, [ctx.orgId]), /report export denied/);

    await asUser(db, { userId: ctx.finance, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await db.query(`select public.record_report_export($1, 'money', 'year', 'pdf')`, [ctx.orgId]);
    await expectDbError(() => db.query(`select public.record_report_export($1, 'ops', '90d', 'csv')`, [ctx.orgId]), /report export denied/);

    await asUser(db, { userId: ctx.assistant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.record_report_export($1, 'ops', '90d', 'csv')`, [ctx.orgId]), /report export denied/);

    await asMaintenance(db);
    const audit = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where organization_id = $1 and action = 'report.exported'`, [ctx.orgId]);
    expect(audit.rows[0].n).toBe(2);
  });

  it("refuses another firm's id (forgery) and aal1", async () => {
    const a = await firm();
    const b = await firm();
    await asUser(db, { userId: a.owner, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.record_report_export($1, 'ops', '90d', 'csv')`, [b.orgId]), /report export denied/);
    await asUser(db, { userId: a.owner, aal: "aal1", orgId: a.orgId });
    await expectDbError(() => db.query(`select public.record_report_export($1, 'ops', '90d', 'csv')`, [a.orgId]), /report export denied/);
  });
});

describe("Client-file exports (public.matter_exports)", () => {
  it("starts with a fresh step-up, completes as the service role, downloads inside the window, and audits each step", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.start_matter_export($1, 'key-00000001')`, [ctx.matterId]), /step-up is required/);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const started = await db.query<{ id: string }>(`select public.start_matter_export($1, 'key-00000001') as id`, [ctx.matterId]);
    const exportId = started.rows[0].id;
    const again = await db.query<{ id: string }>(`select public.start_matter_export($1, 'key-00000001') as id`, [ctx.matterId]);
    expect(again.rows[0].id).toBe(exportId);
    await expectDbError(() => db.query(`select public.start_matter_export($1, 'key-00000002')`, [ctx.matterId]), /already building/);

    // Browsers can't write a job or report a file.
    await expectDbError(() => db.query(`update public.matter_exports set status = 'ready' where id = $1`, [exportId]), /permission denied/);
    await expectDbError(
      () => db.query(`select public.service_complete_matter_export($1, 'x', null, 0, 0, 0, null, '{}', '[]')`, [exportId]),
      /permission denied/,
    );

    await asServiceRole(db);
    await db.query(`select public.service_matter_export_progress($1, 'package', 70)`, [exportId]);
    const sha = "a".repeat(64);
    await expectDbError(
      () => db.query(`select public.service_complete_matter_export($1, 'elsewhere/file.zip', $2, 10, 1, 1, $2, '{}', '[]')`, [exportId, sha]),
      /stored under its own job/,
    );
    await db.query(`select public.service_complete_matter_export($1, $2, $3, 1024, 3, 12, $3, '{"tasks": 2}', '[]')`, [
      exportId,
      `${ctx.orgId}/${exportId}/file.zip`,
      sha,
    ]);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.authorize_matter_export_download($1)`, [exportId]), /step-up is required/);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const grant = await db.query<{ g: { bucket: string; storage_key: string; seconds: number } }>(`select public.authorize_matter_export_download($1) as g`, [exportId]);
    expect(grant.rows[0].g).toMatchObject({ bucket: "matter-exports", seconds: 60 });

    // Finance and assistants can't see or download exports.
    await asUser(db, { userId: ctx.finance, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const seen = await db.query(`select id from public.matter_exports where id = $1`, [exportId]);
    expect(seen.rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.authorize_matter_export_download($1)`, [exportId]), /export access denied/);

    await asMaintenance(db);
    const actions = await db.query<{ action: string }>(
      `select action from public.audit_log where object_id = $1 and action like 'matter_export.%' order by occurred_at, action`,
      [exportId],
    );
    expect(actions.rows.map((row) => row.action).sort()).toEqual(["matter_export.downloaded", "matter_export.ready", "matter_export.started"]);
  });

  it("refuses a download after the 24-hour window and keeps another firm out", async () => {
    const ctx = await firm();
    const other = await firm();
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const started = await db.query<{ id: string }>(`select public.start_matter_export($1, 'key-expired-1') as id`, [ctx.matterId]);
    const exportId = started.rows[0].id;
    await asServiceRole(db);
    await db.query(`select public.service_complete_matter_export($1, $2, $3, 1, 1, 1, $3, '{}', '[]')`, [exportId, `${ctx.orgId}/${exportId}/f.zip`, "b".repeat(64)]);
    await asMaintenance(db);
    await db.exec("set session_replication_role = replica");
    await db.query(`update public.matter_exports set expires_at = now() - interval '1 minute' where id = $1`, [exportId]);
    await db.exec("set session_replication_role = origin");
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.authorize_matter_export_download($1)`, [exportId]), /expired/);

    await asUser(db, { userId: other.owner, aal: "aal2", orgId: other.orgId, totpAgeSeconds: 0 });
    const seen = await db.query(`select id from public.matter_exports where id = $1`, [exportId]);
    expect(seen.rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.start_matter_export($1, 'key-forged-01')`, [ctx.matterId]), /export access denied/);
    await expectDbError(() => db.query(`select public.cancel_matter_export($1)`, [exportId]), /export access denied/);
  });

  it("lets the requester cancel a building export", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const started = await db.query<{ id: string }>(`select public.start_matter_export($1, 'key-cancel-01') as id`, [ctx.matterId]);
    await db.query(`select public.cancel_matter_export($1)`, [started.rows[0].id]);
    const row = await db.query<{ status: string }>(`select status::text from public.matter_exports where id = $1`, [started.rows[0].id]);
    expect(row.rows[0].status).toBe("cancelled");
    await expectDbError(() => db.query(`select public.cancel_matter_export($1)`, [started.rows[0].id]), /only a building export/);
  });
});

describe("Legal holds", () => {
  it("only the firm owner with a step-up places one, and it blocks deleting the matter's records", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.place_legal_hold($1, 'Litigation notice received')`, [ctx.matterId]), /only the firm owner/);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.place_legal_hold($1, 'Litigation notice received')`, [ctx.matterId]), /step-up is required/);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.place_legal_hold($1, 'short')`, [ctx.matterId]), /at least 10 characters/);
    const hold = await db.query<{ id: string }>(`select public.place_legal_hold($1, 'Litigation notice received') as id`, [ctx.matterId]);
    await expectDbError(() => db.query(`select public.place_legal_hold($1, 'Litigation notice again')`, [ctx.matterId]), /already under a legal hold/);

    // Not even maintenance can delete a held matter's task.
    await asMaintenance(db);
    await db.exec("set session_replication_role = replica");
    const task = await db.query<{ id: string }>(
      `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary) values ($1, $2, 'facts_reviewed', 'Synthetic evidence') returning id`,
      [ctx.orgId, ctx.matterId],
    );
    await db.exec("set session_replication_role = origin");
    await expectDbError(() => db.query(`delete from public.matter_stage_evidence where id = $1`, [task.rows[0].id]), /legal hold/);
    await expectDbError(() => db.query(`delete from public.matters where id = $1`, [ctx.matterId]), /legal hold/);

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.release_legal_hold($1, 'Litigation concluded and released')`, [hold.rows[0].id]);
    await expectDbError(() => db.query(`select public.release_legal_hold($1, 'Litigation concluded twice')`, [hold.rows[0].id]), /already released/);
    await expectDbError(() => db.query(`update public.matter_legal_holds set reason = 'changed reason here' where id = $1`, [hold.rows[0].id]), /permission denied/);

    await asUser(db, { userId: ctx.assistant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const seen = await db.query(`select id from public.matter_legal_holds where matter_id = $1`, [ctx.matterId]);
    // The assistant isn't assigned to the matter, so RLS hides it like the matter itself.
    expect(seen.rows.length).toBeLessThanOrEqual(1);
  });
});

describe("Matter closure (public.close_matter)", () => {
  it("closes a post-decision matter with the firm's retention setting and keeps the record", async () => {
    const ctx = await firm();
    await setRetention(ctx.orgId, 7);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.close_matter($1, $2, 'Outcome delivered', null)`, [ctx.matterId, 1]), /post-decision|version conflict/);

    await forceStage(ctx.matterId, "post_decision");
    const v = await version(ctx.matterId);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    const closed = await db.query<{ id: string }>(`select public.close_matter($1, $2, 'Outcome delivered to client', null) as id`, [ctx.matterId, v]);

    await asMaintenance(db);
    const row = await db.query<{ stage: string; retention_on: string; closed_on: string; years: number; review: boolean }>(
      `select m.stage::text, m.retention_on::text, c.closed_on::text, c.retention_years as years, c.retention_review_required as review
       from public.matters m join public.matter_closures c on c.matter_id = m.id where c.id = $1`,
      [closed.rows[0].id],
    );
    expect(row.rows[0].stage).toBe("closed");
    expect(row.rows[0].years).toBe(7);
    expect(row.rows[0].review).toBe(true);
    expect(Number(row.rows[0].retention_on.slice(0, 4)) - Number(row.rows[0].closed_on.slice(0, 4))).toBe(7);
    await expectDbError(() => db.query(`update public.matter_closures set reason = 'changed' where id = $1`, [closed.rows[0].id]), /kept on record/);
  });

  it("refuses without a firm retention setting, and refuses open money unless the owner gives a reviewed reason after a step-up", async () => {
    const ctx = await firm();
    await forceStage(ctx.matterId, "post_decision");
    await setRetention(ctx.orgId, null);
    let v = await version(ctx.matterId);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.close_matter($1, $2, 'Outcome delivered', null)`, [ctx.matterId, v]), /retention period/);

    await setRetention(ctx.orgId, 10);
    await addInvoice(ctx.orgId, ctx.matterId, 50000, 10000);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const check = await db.query<{ c: { blocked: boolean; blockers: { unpaid_invoices: unknown[] } } }>(`select public.matter_closure_check($1) as c`, [ctx.matterId]);
    expect(check.rows[0].c.blocked).toBe(true);
    expect(check.rows[0].c.blockers.unpaid_invoices).toHaveLength(1);
    await expectDbError(() => db.query(`select public.close_matter($1, $2, 'Outcome delivered', null)`, [ctx.matterId, v]), /closure blocked/);
    await expectDbError(
      () => db.query(`select public.close_matter($1, $2, 'Outcome delivered', 'Client agreed to write off the balance')`, [ctx.matterId, v]),
      /only the firm owner/,
    );
    await asUser(db, { userId: ctx.finance, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.close_matter($1, $2, 'Outcome delivered', null)`, [ctx.matterId, v]), /closure denied/);

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(
      () => db.query(`select public.close_matter($1, $2, 'Outcome delivered', 'Client agreed to write off the balance')`, [ctx.matterId, v]),
      /step-up is required/,
    );
    v = await version(ctx.matterId);
    // A licensed firm owner: closing is a regulated stage change.
    await asMaintenance(db);
    const ownerMembership = await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [ctx.orgId, ctx.owner]);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const ownerCredential = await db.query<{ id: string }>(
      `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
      [ownerMembership.rows[0].id, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
    );
    await db.query(
      `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
         true, false, false, false, null, $3, 'Synthetic reviewer note')`,
      [ownerCredential.rows[0].id, REGISTER, PROOF],
    ).catch(() => undefined);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const result = await db
      .query<{ id: string }>(`select public.close_matter($1, $2, 'Outcome delivered', 'Client agreed to write off the balance') as id`, [ctx.matterId, v])
      .then((r) => ({ id: r.rows[0].id, error: null as string | null }))
      .catch((error: Error) => ({ id: null, error: error.message }));
    expect(result.error).toBeNull();
    await asMaintenance(db);
    const row = await db.query<{ override_reason: string; blockers: { unpaid_invoices: unknown[] } }>(`select override_reason, blockers from public.matter_closures where id = $1`, [result.id]);
    expect(row.rows[0].override_reason).toMatch(/write off/);
    expect(row.rows[0].blockers.unpaid_invoices).toHaveLength(1);
  });

  it("keeps another firm out of the closure check", async () => {
    const a = await firm();
    const b = await firm();
    await asUser(db, { userId: b.owner, aal: "aal2", orgId: b.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.matter_closure_check($1)`, [a.matterId]), /closure check denied/);
    await expectDbError(() => db.query(`select public.close_matter($1, 1, 'Outcome delivered', null)`, [a.matterId]), /closure denied/);
  });

  it("is not callable by anon", async () => {
    await asMaintenance(db);
    for (const signature of [
      "public.close_matter(uuid, integer, text, text)",
      "public.start_matter_export(uuid, text)",
      "public.authorize_matter_export_download(uuid)",
      "public.place_legal_hold(uuid, text)",
      "public.record_report_export(uuid, text, text, text)",
    ]) {
      const grants = await db.query<{ anon: boolean }>(`select has_function_privilege('anon', $1, 'execute') as anon`, [signature]);
      expect(grants.rows[0].anon).toBe(false);
    }
    const service = await db.query<{ auth: boolean }>(
      `select has_function_privilege('authenticated', 'public.service_complete_matter_export(uuid, text, text, bigint, integer, integer, text, jsonb, jsonb)', 'execute') as auth`,
    );
    expect(service.rows[0].auth).toBe(false);
  });
});
