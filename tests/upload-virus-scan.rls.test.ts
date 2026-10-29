/**
 * #263-B virus scanning for uploads (20261028130000, 20261028130100): with scanning on, a new
 * upload waits in 'scanning' and nobody can open it (download, preview, Vo and storage reads all
 * go through authorize_document_download or the storage policy, which need 'clean') until the
 * scanner path says it is clean. Infected files are quarantined and audited with the signature;
 * scanner errors retry with backoff, then 'scan_failed'. Only the service role may record a scan.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const PDF = "application/pdf";
const SHA = "b".repeat(64);
const EICAR = "Eicar-Signature";

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
  await setRetry({ max_attempts: 6, base_seconds: 60, lease_seconds: 300, failed_retry_seconds: 21600 });
  await scanning(false);
});

async function scanning(on: boolean) {
  await asMaintenance(db);
  await db.query(
    `update public.product_settings set value = jsonb_build_object('enabled', $1::boolean)
     where key = 'documents.accept_structural_inspection'`,
    [!on],
  );
}

async function setRetry(value: Record<string, number>) {
  await asMaintenance(db);
  await db.query(`update public.product_settings set value = $1::jsonb where key = 'documents.virus_scan_retry'`, [JSON.stringify(value)]);
}

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, address],
  );
  return id;
}

async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const client = await createUser(email("client"));
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const membership = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
    [orgId, consultant, owner],
  );
  const consultantMembership = membership.rows[0].id;
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, 'client', 'active', now(), $3)`,
    [orgId, client, owner],
  );
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check(
       $1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note'
     )`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { id: string } }>(
    `select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`,
    [consultantMembership],
  );
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, display_name, is_sample, user_id)
     values ($1, 'Synthetic applicant', true, $2) returning id`,
    [orgId, client],
  );
  const applicant = person.rows[0].id;
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`,
    [orgId, matterId, applicant],
  );
  return { owner, consultant, client, orgId, matterId, applicant };
}

type Firm = Awaited<ReturnType<typeof firm>>;

/** A client upload, stored and verified by the server like completeDocumentUpload does. */
async function upload(ctx: Firm, name = "passport.pdf") {
  await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
  const intent = await db.query<{ result: { version_id: string; storage_key: string } }>(
    `select public.create_upload_intent($1, $2, $3, 40, 'Passport bio page', 'ordinary', 'subject', null, null, null) as result`,
    [ctx.matterId, ctx.applicant, name],
  );
  const { version_id: versionId, storage_key: key } = intent.rows[0].result;
  await asMaintenance(db);
  await db.query(
    `insert into storage.objects (id, bucket_id, name, metadata) values ($1, 'documents', $2, jsonb_build_object('size', 40))`,
    [randomUUID(), key],
  );
  await asServiceRole(db);
  const done = await db.query<{ result: { upload_state: string; scan_result: string } }>(
    `select public.finish_verified_document_upload($1, $2, $3, 40, $4) as result`,
    [versionId, ctx.client, SHA, PDF],
  );
  return { versionId, key, finished: done.rows[0].result };
}

async function claim(options: { versionId?: string; backfill?: boolean } = {}) {
  await asServiceRole(db);
  const result = await db.query<{ claimed: { version_id: string; attempt: number; backfill: boolean; storage_key: string }[] }>(
    `select public.service_claim_document_scans(20, $1, $2) as claimed`,
    [options.versionId ?? null, options.backfill ?? false],
  );
  return result.rows[0].claimed;
}

async function record(versionId: string, outcome: string, signature: string | null = null) {
  await asServiceRole(db);
  const result = await db.query<{ result: { upload_state: string; changed: boolean; retry_in_seconds?: number } }>(
    `select public.service_record_document_scan($1, $2, $3, 'ClamAV 1.4.3/27800') as result`,
    [versionId, outcome, signature],
  );
  return result.rows[0].result;
}

async function state(versionId: string) {
  await asMaintenance(db);
  const row = await db.query<{ upload_state: string; scan_engine: string | null; scan_result: string | null; scan_signature: string | null; scan_attempts: number }>(
    `select upload_state::text, scan_engine, scan_result, scan_signature, scan_attempts from public.document_versions where id = $1`,
    [versionId],
  );
  return row.rows[0];
}

async function clientCanDownload(ctx: Firm, versionId: string) {
  await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
  try {
    await db.query(`select public.authorize_document_download($1)`, [versionId]);
    return true;
  } catch (error) {
    if (/download denied/.test(String(error))) return false;
    throw error;
  }
}

async function staffCanDownload(ctx: Firm, versionId: string) {
  await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  try {
    await db.query(`select public.authorize_document_download($1)`, [versionId]);
    return true;
  } catch (error) {
    if (/download denied/.test(String(error))) return false;
    throw error;
  }
}

async function canReadObject(ctx: Firm, key: string) {
  await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
  const row = await db.query<{ ok: boolean }>(`select app.can_read_storage_object($1) as ok`, [key]);
  return row.rows[0].ok;
}

async function audits(ctx: Firm, action: string) {
  await asMaintenance(db);
  const rows = await db.query<{ object_id: string; result: string; context: Record<string, unknown> }>(
    `select object_id, result, context from public.audit_log where organization_id = $1 and action = $2`,
    [ctx.orgId, action],
  );
  return rows.rows;
}

describe("upload virus scanning (#263-B)", () => {
  it("behaves as today while scanning is off: type checked and clean", async () => {
    await scanning(false);
    const ctx = await firm();
    const { versionId, finished } = await upload(ctx);
    expect(finished).toMatchObject({ upload_state: "clean", scan_result: "structural_only" });
    expect(await clientCanDownload(ctx, versionId)).toBe(true);
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const flag = await db.query<{ on: boolean }>(`select public.document_virus_scan_enabled() as on`);
    expect(flag.rows[0].on).toBe(false);
  });

  it("holds a new upload as scanning: nobody can open it until the scanner says clean", async () => {
    await scanning(true);
    const ctx = await firm();
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    expect((await db.query<{ on: boolean }>(`select public.document_virus_scan_enabled() as on`)).rows[0].on).toBe(true);
    const { versionId, key, finished } = await upload(ctx);
    expect(finished).toMatchObject({ upload_state: "scanning", scan_result: "awaiting_scanner" });

    // The row stays visible (the page says "Checking for viruses…"); the file does not.
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const seen = await db.query<{ upload_state: string }>(`select upload_state::text from public.document_versions where id = $1`, [versionId]);
    expect(seen.rows[0].upload_state).toBe("scanning");
    expect(await clientCanDownload(ctx, versionId)).toBe(false);
    expect(await staffCanDownload(ctx, versionId)).toBe(false);
    expect(await canReadObject(ctx, key)).toBe(false);

    // No document.uploaded (receipt, staff notification, Vo reading) before it is clean.
    await asMaintenance(db);
    const early = await db.query(`select 1 from public.outbox_events where event_type = 'document.uploaded' and payload ->> 'version_id' = $1`, [versionId]);
    expect(early.rows).toHaveLength(0);

    const claimed = await claim({ versionId });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ version_id: versionId, attempt: 1, backfill: false, storage_key: key });
    // Leased: a second runner doesn't scan it at the same time.
    expect(await claim({ versionId })).toHaveLength(0);

    expect(await record(versionId, "clean")).toMatchObject({ upload_state: "clean", changed: true });
    expect(await state(versionId)).toMatchObject({ upload_state: "clean", scan_engine: "worker", scan_result: "clean", scan_signature: null });
    expect(await clientCanDownload(ctx, versionId)).toBe(true);
    expect(await staffCanDownload(ctx, versionId)).toBe(true);
    await asMaintenance(db);
    const uploaded = await db.query(`select 1 from public.outbox_events where event_type = 'document.uploaded' and payload ->> 'version_id' = $1`, [versionId]);
    expect(uploaded.rows).toHaveLength(1);
    expect((await audits(ctx, "document.scan_clean")).map((row) => row.object_id)).toEqual([versionId]);
  });

  it("only the scanner path changes the state: clients and staff can't claim, record or write", async () => {
    await scanning(true);
    const ctx = await firm();
    const { versionId } = await upload(ctx);
    for (const session of [
      { userId: ctx.client, aal: "aal1" as const, orgId: ctx.orgId },
      { userId: ctx.consultant, aal: "aal2" as const, orgId: ctx.orgId, totpAgeSeconds: 0 },
      { userId: ctx.owner, aal: "aal2" as const, orgId: ctx.orgId, totpAgeSeconds: 0 },
    ]) {
      await asUser(db, session);
      await expectDbError(() => db.query(`select public.service_record_document_scan($1, 'clean', null, null)`, [versionId]), /permission denied/);
      await expectDbError(() => db.query(`select public.service_claim_document_scans(5, null, false)`), /permission denied/);
      await expectDbError(() => db.query(`select app.service_record_document_scan($1, 'clean', null, null)`, [versionId]), /permission denied/);
      await expectDbError(() => db.query(`select public.apply_document_scan($1, 'clean')`, [versionId]), /permission denied/);
      await expectDbError(() => db.query(`update public.document_versions set upload_state = 'clean' where id = $1`, [versionId]), /permission denied|document function/);
    }
    // Even the table owner can't skip the document functions.
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.document_versions set upload_state = 'clean' where id = $1`, [versionId]), /document function/);
    expect((await state(versionId)).upload_state).toBe("scanning");
    // The service role must name the signature to call a file infected.
    await expectDbError(() => record(versionId, "infected", null), /signature name/);
    await expectDbError(() => record(versionId, "maybe"), /clean, infected, or error/);
  });

  it("quarantines an infected file, audits the signature, tells staff and never turns it clean again", async () => {
    await scanning(true);
    const ctx = await firm();
    const { versionId, key } = await upload(ctx, "eicar.pdf");
    await claim({ versionId });
    expect(await record(versionId, "infected", EICAR)).toMatchObject({ upload_state: "quarantined", changed: true });
    expect(await state(versionId)).toMatchObject({ upload_state: "quarantined", scan_result: "infected", scan_signature: EICAR, scan_engine: "worker" });
    expect(await clientCanDownload(ctx, versionId)).toBe(false);
    expect(await staffCanDownload(ctx, versionId)).toBe(false);
    expect(await canReadObject(ctx, key)).toBe(false);

    const infected = await audits(ctx, "document.scan_infected");
    expect(infected).toHaveLength(1);
    expect(infected[0]).toMatchObject({ object_id: versionId, result: "denied" });
    expect(infected[0].context).toMatchObject({ signature: EICAR, matter_id: ctx.matterId, engine: "ClamAV 1.4.3/27800" });

    // A later "clean" (a retry, or the older worker function) can't reopen it.
    expect(await record(versionId, "clean")).toMatchObject({ upload_state: "quarantined", changed: false });
    await asServiceRole(db);
    const older = await db.query<{ state: string }>(`select public.apply_document_scan($1, 'clean')::text as state`, [versionId]);
    expect(older.rows[0].state).toBe("quarantined");
    expect(await clientCanDownload(ctx, versionId)).toBe(false);

    // Staff who can open the matter are told.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const notices = await db.query<{ items: { kind: string; detail: string; subject: string; href: string }[] }>(
      `select public.staff_notifications($1, 50) as items`,
      [ctx.orgId],
    );
    const blocked = notices.rows[0].items.filter((item) => item.kind === "document_blocked");
    expect(blocked).toEqual([expect.objectContaining({ detail: "infected", subject: "Passport bio page", href: `/sheet/matters/${ctx.matterId}?tab=documents` })]);
  });

  it("fails closed when the scanner is down: backoff, then scan_failed and staff are told", async () => {
    await scanning(true);
    const ctx = await firm();
    const { versionId } = await upload(ctx);

    // Backoff doubles from base_seconds.
    await claim({ versionId });
    expect(await record(versionId, "error")).toMatchObject({ upload_state: "scanning", retry_in_seconds: 60 });
    expect(await claim({ versionId })).toHaveLength(0);

    await setRetry({ max_attempts: 3, base_seconds: 0, lease_seconds: 0, failed_retry_seconds: 0 });
    await asMaintenance(db);
    await db.exec(`
      begin;
      select app.open_document_write('${versionId}');
      update public.document_versions set scan_next_attempt_at = now() - interval '1 minute' where id = '${versionId}';
      select app.close_document_write('${versionId}');
      commit;
    `);
    await claim({ versionId });
    expect(await record(versionId, "error")).toMatchObject({ upload_state: "scanning" });
    expect((await state(versionId)).scan_attempts).toBe(2);
    expect(await clientCanDownload(ctx, versionId)).toBe(false);
    await claim({ versionId });
    expect(await record(versionId, "error")).toMatchObject({ upload_state: "scan_failed", changed: true });
    expect(await state(versionId)).toMatchObject({ upload_state: "scan_failed", scan_result: "scanner_unavailable" });
    expect(await clientCanDownload(ctx, versionId)).toBe(false);
    expect(await staffCanDownload(ctx, versionId)).toBe(false);
    expect(await audits(ctx, "document.scan_failed")).toHaveLength(1);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const notices = await db.query<{ items: { kind: string; detail: string }[] }>(`select public.staff_notifications($1, 50) as items`, [ctx.orgId]);
    expect(notices.rows[0].items.filter((item) => item.kind === "document_blocked").map((item) => item.detail)).toEqual(["scan_failed"]);

    // Still tried (slowly); a later clean scan makes it available. Never clean without one.
    const again = await claim({ versionId });
    expect(again).toHaveLength(1);
    expect(await record(versionId, "error")).toMatchObject({ upload_state: "scan_failed", changed: false });
    expect(await audits(ctx, "document.scan_failed")).toHaveLength(1);
    await claim({ versionId });
    expect(await record(versionId, "clean")).toMatchObject({ upload_state: "clean" });
    expect(await clientCanDownload(ctx, versionId)).toBe(true);
  });

  it("gives up on a scan a runner never finished once the attempts run out", async () => {
    await scanning(true);
    await setRetry({ max_attempts: 1, base_seconds: 0, lease_seconds: 0, failed_retry_seconds: 3600 });
    const ctx = await firm();
    const { versionId } = await upload(ctx);
    expect(await claim({ versionId })).toHaveLength(1);
    // The runner died: nothing recorded. The next claim marks it scan_failed instead of scanning a seventh time.
    expect(await claim({ versionId })).toHaveLength(0);
    expect((await state(versionId)).upload_state).toBe("scan_failed");
    expect(await audits(ctx, "document.scan_failed")).toHaveLength(1);
  });

  it("rescans files stored before scanning without closing them, and quarantines an infected one", async () => {
    await scanning(false);
    const ctx = await firm();
    const kept = await upload(ctx, "kept.pdf");
    const bad = await upload(ctx, "bad.pdf");
    expect(kept.finished.upload_state).toBe("clean");
    await scanning(true);

    // Only the backfill run claims them; the ordinary run leaves them be.
    expect((await claim()).map((row) => row.version_id)).not.toContain(kept.versionId);
    const claimed = await claim({ backfill: true });
    const ids = claimed.map((row) => row.version_id);
    expect(ids).toEqual(expect.arrayContaining([kept.versionId, bad.versionId]));
    expect(claimed.every((row) => row.backfill)).toBe(true);
    // Still open while it is being rescanned.
    expect(await clientCanDownload(ctx, kept.versionId)).toBe(true);

    expect(await record(kept.versionId, "error")).toMatchObject({ upload_state: "clean", changed: false });
    expect(await clientCanDownload(ctx, kept.versionId)).toBe(true);
    expect(await record(kept.versionId, "clean")).toMatchObject({ upload_state: "clean", changed: true });
    expect(await state(kept.versionId)).toMatchObject({ scan_engine: "worker", scan_result: "clean" });
    expect(await record(bad.versionId, "infected", EICAR)).toMatchObject({ upload_state: "quarantined" });
    expect(await clientCanDownload(ctx, bad.versionId)).toBe(false);
    expect((await audits(ctx, "document.scan_infected"))[0].context).toMatchObject({ backfill: true, signature: EICAR });
    // A rescanned clean file sends no second "uploaded" receipt.
    await asMaintenance(db);
    const receipts = await db.query(`select 1 from public.outbox_events where event_type = 'document.uploaded' and payload ->> 'version_id' = $1`, [kept.versionId]);
    expect(receipts.rows).toHaveLength(1);
  });

  it("keeps the scan functions away from anon and authenticated", async () => {
    await asMaintenance(db);
    const grants = await db.query<{ fn: string; anon: boolean; authed: boolean; service: boolean }>(
      `select p.oid::regprocedure::text as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed,
              has_function_privilege('service_role', p.oid, 'execute') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'app')
         and p.proname in ('service_claim_document_scans', 'service_record_document_scan', 'kick_document_scans', 'document_scan_give_up')`,
    );
    expect(grants.rows.length).toBe(6);
    expect(grants.rows.every((row) => !row.anon && !row.authed)).toBe(true);
    expect(grants.rows.filter((row) => row.fn.includes("service_")).every((row) => row.service)).toBe(true);
  });

  it("the ops step for a held file only makes it due: the next claim scans it, nothing makes it clean (2026-10-29)", async () => {
    await scanning(true);
    const ctx = await firm();
    const { versionId } = await upload(ctx);
    await setRetry({ max_attempts: 1, base_seconds: 60, lease_seconds: 300, failed_retry_seconds: 21600 });
    await claim({ versionId });
    expect(await record(versionId, "error")).toMatchObject({ upload_state: "scan_failed" });
    // Due again only in 6 hours.
    expect(await claim({ versionId })).toHaveLength(0);
    // docs/integrations/av-scanner.md, "A held file now", as the project owner.
    await asMaintenance(db);
    await db.exec(`
      begin;
      select app.open_document_write(id) from public.document_versions where id = '${versionId}' and upload_state = 'scan_failed';
      update public.document_versions set scan_next_attempt_at = now() where id = '${versionId}' and upload_state = 'scan_failed';
      select app.close_document_write(id) from public.document_versions where id = '${versionId}';
      commit;
    `);
    expect(await state(versionId)).toMatchObject({ upload_state: "scan_failed" });
    expect(await clientCanDownload(ctx, versionId)).toBe(false);
    expect(await claim({ versionId })).toHaveLength(1);
    expect(await record(versionId, "clean")).toMatchObject({ upload_state: "clean" });
  });

  it("waits long enough for the runner's warm-up, but never past the claim lease (bug report 2026-10-29)", async () => {
    await asMaintenance(db);
    const kick = await db.query<{ src: string }>(
      `select p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app' and p.proname = 'kick_document_scans'`,
    );
    const timeout = Number(/timeout_milliseconds\s*:=\s*(\d+)/.exec(kick.rows[0].src)?.[1]);
    const lease = await db.query<{ seconds: number }>(
      `select (value ->> 'lease_seconds')::integer as seconds from public.product_settings where key = 'documents.virus_scan_retry'`,
    );
    // The runner's request is warm-up (90 s) + scan (50 s): RUNNER_SCAN_BUDGET.
    expect(timeout).toBeGreaterThanOrEqual(140_000 + 30_000);
    expect(timeout).toBeLessThan(lease.rows[0].seconds * 1000);
  });
});
