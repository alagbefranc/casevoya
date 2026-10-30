import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { serverCapture } from "./helpers/server-capture";

/**
 * Server-held page captures for DEC follow-up steps, renewal timings, privacy time limits and PREP
 * form templates (20261030233000_server_captures_decisions_renewals_privacy_prep.sql): an entry is
 * captured only when it names this firm's server capture of the same page, and its hash comes
 * from that row. A hash the caller sends is not a capture: the entry is kept without one and its
 * approval needs the reviewer's page attestation. Synthetic pages and hashes only.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);
const HASH = "d".repeat(64);
const FORGED = "e".repeat(64);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

async function rows<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

const as = (userId: string, orgId: string, totpAgeSeconds: number | undefined = 3600) =>
  asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds });

async function firm() {
  await asMaintenance(db);
  const owner = randomUUID();
  const consultant = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()), ($3, $4, now())`, [
    owner, `o-${tag()}@example.test`, consultant, `c-${tag()}@example.test`,
  ]);
  await as(owner, "", 0);
  const orgId = (await rows<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`]))[0].id;
  await asMaintenance(db);
  const consultantMembership = (await rows<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
    [orgId, consultant, owner],
  ))[0].id;
  await as(consultant, orgId, 0);
  const credential = await rows<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', 'proof/synthetic') as id`,
    [consultantMembership, `R${tag().slice(0, 6).toUpperCase()}`],
  );
  await as(owner, orgId, 0);
  await db.query(
    `select public.record_licence_check($1, 'https://register.college-ic.ca/Public-Register-EN', statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, 'proof/synthetic', 'Synthetic reviewer note')`,
    [credential[0].id],
  );
  await asMaintenance(db);
  return { orgId, owner, consultant };
}

type Path = {
  name: string;
  table: string;
  url: () => string;
  propose: (orgId: string, url: string, snapshot: unknown) => Promise<string>;
  approve: (id: string) => Promise<unknown>;
};

const json = (snapshot: unknown) => (snapshot == null ? null : JSON.stringify(snapshot));
const one = async (sql: string, params: unknown[]) => (await rows<{ id: string }>(sql, params))[0].id;

const PATHS: Path[] = [
  {
    name: "DEC follow-up step (propose_approval_follow_up_step)",
    table: "approval_follow_up_steps",
    url: () => `https://www.canada.ca/en/synthetic-${tag()}/after-approval.html#s1`,
    propose: (orgId, url, snapshot) =>
      one(
        `select public.propose_approval_follow_up_step($1, 'synthetic_program', 'Synthetic step after approval', null, $2, null, null, null, $3::date, null, $4::jsonb) as id`,
        [orgId, url, today(), json(snapshot)],
      ),
    approve: (id) => db.query(`select public.review_approval_follow_up_step($1, 1, 'approved', null, null)`, [id]),
  },
  {
    name: "renewal timing (propose_renewal_timing)",
    table: "renewal_timings",
    url: () => `https://www.canada.ca/en/synthetic-${tag()}/renewal.html#s1`,
    propose: (orgId, url, snapshot) =>
      one(
        `select public.propose_renewal_timing($1, null, 'Synthetic permit', 'Synthetic timing words', 30, $2, null, null, null, $3::date, null, $4::jsonb) as id`,
        [orgId, url, today(), json(snapshot)],
      ),
    approve: (id) => db.query(`select public.review_renewal_timing($1, 1, 'approved', null, null)`, [id]),
  },
  {
    name: "privacy time limit (propose_privacy_time_limit)",
    table: "privacy_time_limits",
    url: () => `https://laws-lois.justice.gc.ca/eng/acts/S-${tag()}/FullText.html#s-1`,
    propose: (orgId, url, snapshot) =>
      one(
        `select public.propose_privacy_time_limit($1, 'response', 'Synthetic Privacy Act', 'Synthetic provision text, word for word.', 30, $2, 's. 1(1)', $3::date, null, $4::jsonb) as id`,
        [orgId, url, today(), json(snapshot)],
      ),
    approve: (id) => db.query(`select public.review_privacy_time_limit($1, 1, 'approved', null, null)`, [id]),
  },
  {
    name: "PREP form template (propose_form_template)",
    table: "form_templates",
    url: () => `https://www.canada.ca/en/synthetic-${tag()}/form.html#s1`,
    propose: (orgId, url, snapshot) =>
      one(
        `select public.propose_form_template($1::uuid, 'CA', null::text, $5::text, $2::text, 'Synthetic section', 'Synthetic 01-2026', null::integer, null::date,
           'manual_completion', '[]'::jsonb, $3::date, $4::jsonb) as id`,
        [orgId, url, today(), json(snapshot), `SYN-${tag().slice(0, 6)}`],
      ),
    approve: (id) => db.query(`select public.review_form_template($1, 1, 'approved', null, null)`, [id]),
  },
];

async function entry(table: string, id: string) {
  await asMaintenance(db);
  return (await rows<{ snapshot_id: string | null; snapshot_sha256: string | null; status: string }>(
    `select snapshot_id, snapshot_sha256, status from public.${table} where id = $1`,
    [id],
  ))[0];
}

describe.each(PATHS)("$name", (path) => {
  it("a hash the caller sends is not a capture: kept without one, and approval needs the attestation", async () => {
    const f = await firm();
    const url = path.url();
    await as(f.owner, f.orgId);
    const forged = await path.propose(f.orgId, url, { sha256: FORGED, retrieved_at: new Date().toISOString(), final_url: url.split("#")[0], http_status: 200 });
    expect(await entry(path.table, forged)).toMatchObject({ snapshot_id: null, snapshot_sha256: null, status: "pending_review" });
    await asMaintenance(db);
    expect((await rows<{ n: number }>(`select count(*)::int as n from public.source_snapshots where organization_id = $1 and content_hash = $2`, [f.orgId, FORGED]))[0].n).toBe(0);

    await as(f.consultant, f.orgId, 0);
    await expectDbError(() => path.approve(forged), /attestation/);
  });

  it("a snapshot a signed-in user wrote, or another firm's capture, is refused", async () => {
    const f = await firm();
    const other = await firm();
    const url = path.url();
    // Staff can no longer write governance rows directly (20261030235000); a row written outside the
    // capture service is not possible; a capture reference must name this firm's own server capture.
    await as(f.owner, f.orgId);
    await expectDbError(
      () =>
        rows(
          `insert into public.official_sources (organization_id, publisher, canonical_url, allowed_host, jurisdiction, content_kind)
           values ($1, 'Synthetic publisher', $2, $3, 'CA', 'program_guidance')`,
          [f.orgId, url.split("#")[0], new URL(url).hostname],
        ),
      /row-level security|permission denied/,
    );
    await expectDbError(
      () =>
        rows(
          `insert into public.source_snapshots (organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, content_hash, retrieval_result)
           values ($1, $2, 1, $3, 'Synthetic publisher', now(), $4, 'success')`,
          [f.orgId, randomUUID(), url.split("#")[0], FORGED],
        ),
      /permission denied|row-level security/,
    );
    // A reference to a snapshot that does not exist is refused.
    await expectDbError(() => path.propose(f.orgId, url, { snapshot_id: randomUUID() }), /not stored by Casevoya/);

    await as(other.owner, other.orgId);
    const theirs = await serverCapture(db, { orgId: other.orgId, url, snapshot: { sha256: HASH } });
    await as(f.owner, f.orgId);
    await expectDbError(() => path.propose(f.orgId, url, theirs), /not stored by Casevoya/);
  });

  it("the firm's server capture is used: its stored hash is recorded and approval needs no attestation", async () => {
    const f = await firm();
    const url = path.url();
    await as(f.owner, f.orgId);
    const capture = await serverCapture(db, { orgId: f.orgId, url, snapshot: { sha256: HASH } });
    // Extra keys sent with the reference are ignored; the hash comes from the stored row.
    const id = await path.propose(f.orgId, url, { ...capture, sha256: FORGED });
    expect(await entry(path.table, id)).toMatchObject({ snapshot_id: capture.snapshot_id, snapshot_sha256: HASH, status: "pending_review" });

    await as(f.consultant, f.orgId, 0);
    await path.approve(id);
    expect((await entry(path.table, id)).status).toBe("approved");
  });

  it("an entry without any snapshot still works as before", async () => {
    const f = await firm();
    await as(f.owner, f.orgId);
    const id = await path.propose(f.orgId, path.url(), null);
    expect(await entry(path.table, id)).toMatchObject({ snapshot_id: null, snapshot_sha256: null, status: "pending_review" });
  });
});
