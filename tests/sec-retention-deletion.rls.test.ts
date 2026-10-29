import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * SEC-07 (gap #184): deletion jobs and tombstones (20261025290000). PGlite only: storage is never
 * touched here (the runner's storage calls are covered with fakes in sec-retention-runner.test.ts).
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

async function as(userId: string, orgId: string, fresh = true) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: fresh ? 0 : 3600 });
}

async function newMatter(orgId: string, consultant: string, consultantMembership: string, name = "Synthetic Applicant") {
  await as(consultant, orgId);
  const matter = await db.query<{ result: { id: string; applicant_id: string } }>(
    `select public.create_client_matter($1, null, null, null, $2, null, null) as result`,
    [name, consultantMembership],
  );
  return matter.rows[0].result;
}

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
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
  await db.query(`update public.organizations set sample_mode = false, retention_policy = '{"unit":"years","count":7,"version":2}'::jsonb where id = $1`, [orgId]);
  await db.exec("set session_replication_role = origin");
  const matter = await newMatter(orgId, consultant, consultantMembership);
  return { owner, consultant, consultantMembership, orgId, matterId: matter.id, personId: matter.applicant_id };
}

type Firm = Awaited<ReturnType<typeof firm>>;

/** Closes the matter through public.close_matter, then (test data only) back-dates its retention end. */
async function closeMatter(ctx: Firm, matterId: string, backDate = true) {
  await asMaintenance(db);
  await db.exec("set session_replication_role = replica");
  await db.query(`update public.matters set stage = 'post_decision' where id = $1`, [matterId]);
  await db.exec("set session_replication_role = origin");
  const v = await db.query<{ version: number }>(`select version from public.matters where id = $1`, [matterId]);
  await as(ctx.consultant, ctx.orgId);
  await db.query(`select public.close_matter($1, $2, 'Outcome delivered to client', null)`, [matterId, v.rows[0].version]);
  if (backDate) {
    await asMaintenance(db);
    await db.exec("set session_replication_role = replica");
    await db.query(`update public.matter_closures set retention_on = date '2020-01-01', closed_on = date '2013-01-01' where matter_id = $1`, [matterId]);
    await db.query(`update public.matters set retention_on = date '2020-01-01' where id = $1`, [matterId]);
    await db.exec("set session_replication_role = origin");
  }
}

async function storedFile(ctx: Firm, matterIds: string[], name: string) {
  await asMaintenance(db);
  const doc = await db.query<{ id: string }>(
    `insert into public.documents (organization_id, person_id, purpose, audience, created_by) values ($1, $2, $3, 'matter', $4) returning id`,
    [ctx.orgId, ctx.personId, `Synthetic ${name}`, ctx.owner],
  );
  for (const matterId of matterIds) {
    await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by) values ($1, $2, $3, $4)`, [
      ctx.orgId,
      doc.rows[0].id,
      matterId,
      ctx.owner,
    ]);
  }
  const version = await db.query<{ id: string; storage_key: string }>(
    `insert into public.document_versions (organization_id, document_id, version_number, storage_key, original_filename, declared_media_type,
       declared_byte_size, checksum_sha256, upload_state, review_state, intent_expires_at, created_by)
     values ($1, $2, 1, $3, $4, 'application/pdf', 2048, $5, 'clean', 'accepted', now() + interval '15 minutes', $6) returning id, storage_key`,
    [ctx.orgId, doc.rows[0].id, `${ctx.orgId}/files/${randomUUID()}`, name, createHash("sha256").update(name + randomUUID()).digest("hex"), ctx.owner],
  );
  return { documentId: doc.rows[0].id, versionId: version.rows[0].id, key: version.rows[0].storage_key };
}

/** Vo's reading of a version: a run, a draft and one proposal holding a value read from the file. */
async function voReading(ctx: Firm, matterId: string, file: { documentId: string; versionId: string }) {
  await asMaintenance(db);
  const run = await db.query<{ id: string }>(
    `insert into public.vo_runs (organization_id, user_id, kind, matter_id, version_id) values ($1, $2, 'document_review', $3, $4) returning id`,
    [ctx.orgId, ctx.consultant, matterId, file.versionId],
  );
  const draft = await db.query<{ id: string }>(
    `insert into public.vo_doc_drafts (organization_id, run_id, matter_id, document_id, version_id, title, body, sources, model, prompt_version, created_by)
     values ($1, $2, $3, $4, $5, 'Passport', 'Passport for Synthetic Applicant, expires 2031', '[{"kind":"document"}]'::jsonb, 'test-model', 'v1', $6) returning id`,
    [ctx.orgId, run.rows[0].id, matterId, file.documentId, file.versionId, ctx.consultant],
  );
  await db.query(
    `insert into public.vo_doc_proposals (organization_id, draft_id, position, kind, label, value) values ($1, $2, 0, 'field', 'Passport number', 'SYN123456')`,
    [ctx.orgId, draft.rows[0].id],
  );
  return draft.rows[0].id;
}

async function readyExport(ctx: Firm, matterId: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into public.matter_exports (id, organization_id, matter_id, idempotency_key, requested_by, status, stage, progress, sha256, manifest_sha256,
       storage_bucket, storage_key, ready_at, expires_at, file_count, byte_size)
     values ($1, $2, $3, $4, $5, 'ready', 'ready', 100, $6, $6, 'matter-exports', $7, now(), now() + interval '1 day', 1, 100)`,
    [id, ctx.orgId, matterId, `key-${randomUUID()}`, ctx.owner, "a".repeat(64), `${ctx.orgId}/${id}/file.zip`],
  );
  return id;
}

type Overview = {
  eligible: { matter_id: string; policy_version: number | null; retention_years: number }[];
  held: number;
  jobs: { id: string; status: string; blocked_reason: string | null }[];
  tombstones: { matter_id: string; removed: Record<string, number>; kept: { kind: string; reason: string; count: number }[]; policy_version: number | null }[];
};

async function overview(ctx: Firm): Promise<Overview> {
  await as(ctx.owner, ctx.orgId, false);
  const row = await db.query<{ o: Overview }>(`select public.retention_deletion_overview($1) as o`, [ctx.orgId]);
  return row.rows[0].o;
}

async function approve(ctx: Firm, matterId: string, key = `del-${randomUUID()}`) {
  await as(ctx.owner, ctx.orgId);
  const row = await db.query<{ id: string }>(`select public.approve_deletion_job($1, 'Retention period ended; files no longer needed', $2) as id`, [
    matterId,
    key,
  ]);
  return row.rows[0].id;
}

type Claim = { job_id: string; items: { id: string; kind: string; bucket: string | null; storage_key: string | null }[] } | null;

async function claim(): Promise<Claim> {
  await asServiceRole(db);
  const row = await db.query<{ c: Claim }>(`select public.service_claim_deletion_job() as c`);
  return row.rows[0].c;
}

/** What the runner does, with storage faked: every object is "removed". */
async function runAll(): Promise<string | null> {
  const job = await claim();
  if (!job) return null;
  for (const item of job.items) {
    await asServiceRole(db);
    if (item.storage_key) {
      const ready = await db.query<{ ok: boolean }>(`select public.service_deletion_item_ready($1) as ok`, [item.id]);
      if (!ready.rows[0].ok) continue;
      await db.query(`select public.service_record_deletion_item($1, 'deleted')`, [item.id]);
    } else {
      await db.query(`select public.service_record_deletion_item($1, 'deleted')`, [item.id]);
    }
  }
  await asServiceRole(db);
  const done = await db.query<{ s: string }>(`select public.service_finish_deletion_job($1) as s`, [job.job_id]);
  return done.rows[0].s;
}

describe("Eligible for deletion (public.retention_deletion_overview)", () => {
  it("lists a closed matter only after its retention end, never one on hold, and only to the firm owner", async () => {
    const ctx = await firm();
    await closeMatter(ctx, ctx.matterId, false);
    expect((await overview(ctx)).eligible).toHaveLength(0);

    await closeMatter(ctx, (await newMatter(ctx.orgId, ctx.consultant, ctx.consultantMembership, "Second Applicant")).id);
    const listed = await overview(ctx);
    expect(listed.eligible).toHaveLength(1);
    expect(listed.eligible[0].retention_years).toBe(7);
    expect(listed.eligible[0].policy_version).toBe(2);

    const heldMatter = listed.eligible[0].matter_id;
    await as(ctx.owner, ctx.orgId);
    await db.query(`select public.place_legal_hold($1, 'Litigation notice received')`, [heldMatter]);
    const held = await overview(ctx);
    expect(held.eligible).toHaveLength(0);
    expect(held.held).toBe(1);

    await as(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.retention_deletion_overview($1)`, [ctx.orgId]), /retention deletion denied/);
    const other = await firm();
    await as(other.owner, other.orgId);
    await expectDbError(() => db.query(`select public.retention_deletion_overview($1)`, [ctx.orgId]), /retention deletion denied/);
  });

  it("a manual retention date can extend the end but never bring it forward", async () => {
    const ctx = await firm();
    await closeMatter(ctx, ctx.matterId, false);
    await asMaintenance(db);
    await db.exec("set session_replication_role = replica");
    await db.query(`update public.matters set retention_on = date '2020-01-01' where id = $1`, [ctx.matterId]);
    await db.exec("set session_replication_role = origin");
    expect((await overview(ctx)).eligible).toHaveLength(0);
  });
});

describe("Approve a deletion job (public.approve_deletion_job)", () => {
  it("needs the firm owner with a fresh step-up, a reason and an eligible matter; plans items and is idempotent", async () => {
    const ctx = await firm();
    const other = await newMatter(ctx.orgId, ctx.consultant, ctx.consultantMembership, "Other Applicant");
    const file = await storedFile(ctx, [ctx.matterId], "passport.pdf");
    const shared = await storedFile(ctx, [ctx.matterId, other.id], "shared.pdf");
    await voReading(ctx, ctx.matterId, file);
    await readyExport(ctx, ctx.matterId);

    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.approve_deletion_job($1, 'Retention period ended now', 'k-12345678')`, [ctx.matterId]), /not eligible for deletion: the matter is not closed/);
    await closeMatter(ctx, ctx.matterId);

    await as(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.approve_deletion_job($1, 'Retention period ended now', 'k-12345678')`, [ctx.matterId]), /only the firm owner/);
    await as(ctx.owner, ctx.orgId, false);
    await expectDbError(() => db.query(`select public.approve_deletion_job($1, 'Retention period ended now', 'k-12345678')`, [ctx.matterId]), /step-up is required/);
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.approve_deletion_job($1, 'short', 'k-12345678')`, [ctx.matterId]), /at least 10 characters/);

    const key = `del-${randomUUID()}`;
    const jobId = await approve(ctx, ctx.matterId, key);
    expect(await approve(ctx, ctx.matterId, key)).toBe(jobId);
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.approve_deletion_job($1, 'Retention period ended again', 'k-87654321')`, [ctx.matterId]), /already waiting/);

    await asMaintenance(db);
    const items = await db.query<{ kind: string; status: string; target_id: string }>(
      `select kind, status, target_id from public.deletion_job_items where job_id = $1 order by kind, status`,
      [jobId],
    );
    const byTarget = new Map(items.rows.map((row) => [`${row.kind}:${row.target_id}`, row.status]));
    expect(byTarget.get(`document_file:${file.versionId}`)).toBe("pending");
    expect(byTarget.get(`document_file:${shared.versionId}`)).toBe("kept");
    expect(items.rows.filter((row) => row.kind === "export_file")).toHaveLength(1);
    expect(items.rows.filter((row) => row.kind === "vo_reading")).toHaveLength(1);
    const audit = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where action = 'retention.deletion_approved' and object_id = $1`, [jobId]);
    expect(audit.rows[0].n).toBe(1);
    // Approval deletes nothing.
    const reading = await db.query<{ body: string }>(`select body from public.vo_doc_drafts where matter_id = $1`, [ctx.matterId]);
    expect(reading.rows[0].body).toContain("Passport");
  });
});

describe("The job runner (service role)", () => {
  // The runner takes the oldest waiting job in the whole database: stop jobs left by earlier tests.
  beforeEach(async () => {
    await asMaintenance(db);
    await db.query(
      `update public.deletion_jobs set status = 'failed', failure_reason = 'Test isolation', finished_at = now(), lease_until = null
        where status in ('approved', 'running')`,
    );
  });

  it("removes files and derived data, writes the tombstone, and the matter is no longer eligible", async () => {
    const ctx = await firm();
    const file = await storedFile(ctx, [ctx.matterId], "passport.pdf");
    const draftId = await voReading(ctx, ctx.matterId, file);
    const exportId = await readyExport(ctx, ctx.matterId);
    await closeMatter(ctx, ctx.matterId);
    const jobId = await approve(ctx, ctx.matterId);

    expect(await runAll()).toBe("completed");
    // #262: the export inside its 24-hour window reads as deleted, and its download is refused.
    await asMaintenance(db);
    const exported = await db.query<{ status: string; removed: boolean }>(`select status::text, removed_at is not null as removed from public.matter_exports where id = $1`, [exportId]);
    expect(exported.rows[0]).toEqual({ status: "ready", removed: true });
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.authorize_matter_export_download($1)`, [exportId]), /this export was deleted/);
    await asMaintenance(db);
    const reading = await db.query<{ title: string; body: string }>(`select title, body from public.vo_doc_drafts where id = $1`, [draftId]);
    expect(reading.rows[0]).toEqual({ title: "Deleted", body: "Removed under the firm's retention policy." });
    const proposal = await db.query<{ value: string | null; label: string }>(`select value, label from public.vo_doc_proposals where draft_id = $1`, [draftId]);
    expect(proposal.rows[0]).toEqual({ value: null, label: "Deleted" });
    const job = await db.query<{ status: string }>(`select status from public.deletion_jobs where id = $1`, [jobId]);
    expect(job.rows[0].status).toBe("completed");
    // The matter and its document rows stay as the record.
    const kept = await db.query<{ n: number }>(`select count(*)::int as n from public.document_versions where id = $1`, [file.versionId]);
    expect(kept.rows[0].n).toBe(1);

    const after = await overview(ctx);
    expect(after.eligible).toHaveLength(0);
    expect(after.tombstones).toHaveLength(1);
    expect(after.tombstones[0].removed).toMatchObject({ document_file: 1, export_file: 1, vo_reading: 1, embeddings: 0 });
    expect(after.tombstones[0].policy_version).toBe(2);
    await asMaintenance(db);
    const tomb = await db.query<{ objects: { bucket: string; key: string }[] }>(`select objects from public.deletion_tombstones where job_id = $1`, [jobId]);
    expect(tomb.rows[0].objects.map((o) => o.key)).toContain(file.key);
    await expectDbError(() => db.query(`update public.deletion_tombstones set reason = 'changed reason here' where job_id = $1`, [jobId]), /kept on record/);
    await expectDbError(() => db.query(`update public.deletion_jobs set reason = 'changed reason here' where id = $1`, [jobId]), /kept on record/);
    const audit = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where action = 'retention.deletion_completed' and organization_id = $1`, [ctx.orgId]);
    expect(audit.rows[0].n).toBe(1);

    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.approve_deletion_job($1, 'Retention period ended again', 'k-abcdefgh')`, [ctx.matterId]), /already deleted/);
  });

  // #272 (#266): stamping removed_at on a failed or cancelled export with a stored file raised
  // "this export is finished", so the job couldn't record the deleted file.
  it("records the deleted file of a failed or cancelled export, which otherwise stays as it was", async () => {
    const ctx = await firm();
    const failed = await readyExport(ctx, ctx.matterId);
    const cancelled = await readyExport(ctx, ctx.matterId);
    await asMaintenance(db);
    await db.exec("set session_replication_role = replica");
    await db.query(`update public.matter_exports set status = 'failed', failed_at = now(), failure_reason = 'Synthetic failure' where id = $1`, [failed]);
    await db.query(`update public.matter_exports set status = 'cancelled', cancelled_at = now(), cancelled_by = $2 where id = $1`, [cancelled, ctx.owner]);
    await db.exec("set session_replication_role = origin");
    await closeMatter(ctx, ctx.matterId);
    await approve(ctx, ctx.matterId);

    expect(await runAll()).toBe("completed");
    await asMaintenance(db);
    const rows = await db.query<{ status: string; removed: boolean }>(
      `select status::text, removed_at is not null as removed from public.matter_exports where id = any($1::uuid[]) order by status`,
      [[failed, cancelled]],
    );
    expect(rows.rows).toEqual([
      { status: "cancelled", removed: true },
      { status: "failed", removed: true },
    ]);
    // Anything else on a finished export is still refused.
    await expectDbError(() => db.query(`update public.matter_exports set byte_size = 5 where id = $1`, [failed]), /this export is finished/);
  });

  it("a legal hold placed after approval stops the job before anything is removed", async () => {
    const ctx = await firm();
    const file = await storedFile(ctx, [ctx.matterId], "passport.pdf");
    await closeMatter(ctx, ctx.matterId);
    const jobId = await approve(ctx, ctx.matterId);
    const job = await claim();
    expect(job?.job_id).toBe(jobId);

    await as(ctx.owner, ctx.orgId);
    await db.query(`select public.place_legal_hold($1, 'Litigation notice received')`, [ctx.matterId]);
    await asServiceRole(db);
    const item = job!.items.find((row) => row.kind === "document_file")!;
    const ready = await db.query<{ ok: boolean }>(`select public.service_deletion_item_ready($1) as ok`, [item.id]);
    expect(ready.rows[0].ok).toBe(false);
    expect(await db.query<{ ok: boolean }>(`select public.service_record_deletion_item($1, 'deleted') as ok`, [item.id]).then((r) => r.rows[0].ok)).toBe(false);

    await asMaintenance(db);
    const stopped = await db.query<{ status: string; blocked_reason: string }>(`select status, blocked_reason from public.deletion_jobs where id = $1`, [jobId]);
    expect(stopped.rows[0].status).toBe("blocked");
    expect(stopped.rows[0].blocked_reason).toMatch(/legal hold/);
    const pending = await db.query<{ status: string }>(`select status from public.deletion_job_items where target_id = $1`, [file.versionId]);
    expect(pending.rows[0].status).toBe("pending");
    expect(await claim()).toBeNull();
    const ov = await overview(ctx);
    expect(ov.jobs[0].status).toBe("blocked");
  });

  it("resumes from the pending items after a run is cut off, and a document linked elsewhere after approval is kept", async () => {
    const ctx = await firm();
    const first = await storedFile(ctx, [ctx.matterId], "one.pdf");
    const second = await storedFile(ctx, [ctx.matterId], "two.pdf");
    await closeMatter(ctx, ctx.matterId);
    await approve(ctx, ctx.matterId);
    const job = await claim();
    expect(job!.items).toHaveLength(2);
    const one = job!.items.find((row) => row.storage_key === first.key)!;
    await asServiceRole(db);
    await db.query(`select public.service_deletion_item_ready($1)`, [one.id]);
    await db.query(`select public.service_record_deletion_item($1, 'deleted')`, [one.id]);
    // Recording twice changes nothing.
    expect(await db.query<{ ok: boolean }>(`select public.service_record_deletion_item($1, 'deleted') as ok`, [one.id]).then((r) => r.rows[0].ok)).toBe(false);
    // The run is cut off: while the lease holds nobody else claims it; once it lapses the job comes back with what is left.
    expect(await claim()).toBeNull();
    await asMaintenance(db);
    await db.query(`update public.deletion_jobs set lease_until = now() - interval '1 minute' where id = $1`, [job!.job_id]);
    const other = await newMatter(ctx.orgId, ctx.consultant, ctx.consultantMembership, "Later Applicant");
    await asMaintenance(db);
    await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by) values ($1, $2, $3, $4)`, [
      ctx.orgId,
      second.documentId,
      other.id,
      ctx.owner,
    ]);
    const resumed = await claim();
    expect(resumed!.items.map((row) => row.storage_key)).toEqual([second.key]);
    await asServiceRole(db);
    const ready = await db.query<{ ok: boolean }>(`select public.service_deletion_item_ready($1) as ok`, [resumed!.items[0].id]);
    expect(ready.rows[0].ok).toBe(false);
    const finished = await db.query<{ s: string }>(`select public.service_finish_deletion_job($1) as s`, [job!.job_id]);
    expect(finished.rows[0].s).toBe("completed");
    const ov = await overview(ctx);
    expect(ov.tombstones[0].removed.document_file).toBe(1);
    expect(ov.tombstones[0].kept[0].reason).toMatch(/after approval/);
  });

  it("only the service role runs jobs; nobody reads the tables directly", async () => {
    const ctx = await firm();
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.service_claim_deletion_job()`), /permission denied/);
    await expectDbError(() => db.query(`select public.service_record_deletion_item($1, 'deleted')`, [randomUUID()]), /permission denied/);
    await expectDbError(() => db.query(`select public.service_finish_deletion_job($1)`, [randomUUID()]), /permission denied/);
    await expectDbError(() => db.query(`select * from public.deletion_jobs`), /permission denied/);
    await expectDbError(() => db.query(`select * from public.deletion_tombstones`), /permission denied/);
    await expectDbError(() => db.query(`select * from public.deletion_job_items`), /permission denied/);
  });
});
