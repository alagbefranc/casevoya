import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadOfficialClaims } from "../scripts/ops/load-official-claims.mjs";
import { asMaintenance, asServiceRole, asUser, asUserInternal, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { serverCapture } from "./helpers/server-capture";

/**
 * Source governance hardening (20261030170000_source_conflict_owner_server_captures.sql):
 *  - a conflict on a platform-wide official claim is resolved only by the firm that opened it or a
 *    platform owner/operator at a fresh step-up;
 *  - a claim or official requirement counts as captured only when it names a snapshot the server
 *    stored; a hash the caller sends is not a capture and the approval needs the page attestation.
 * Synthetic pages, claims and hashes only.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);
const HASH = "c".repeat(64);
const PAGE = "https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic-review/page.html#s1";
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

function capture(key: string, sha256: string, sentence: string) {
  const page = `https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic-${tag()}/page.html`;
  return [{
    name: "captured-claims.json",
    data: {
      pages: [{ url: page, publisher: "Immigration, Refugees and Citizenship Canada", title: "Synthetic", finalUrl: page, httpStatus: 200, retrievedAt: new Date().toISOString(), sha256, modifiedOn: null, lastAmendedOn: null, currentTo: null }],
      claims: [{
        key, category: "program", program: "synthetic_program", jurisdiction: "CA",
        claim: sentence, value: null, page, sourceUrl: `${page}#s1`, section: "Synthetic section", excerpt: sentence,
      }],
    },
  }];
}

/** Two loaded official claims on different pages whose excerpts disagree. */
async function disagreeingClaims() {
  const key = `CA.SYNTH.${tag().toUpperCase()}`;
  const otherKey = `CA.SYNTH.${tag().toUpperCase()}`;
  await asMaintenance(db);
  await loadOfficialClaims({ query: async (sql: string) => rows(sql), files: capture(key, "a".repeat(64), "Synthetic claim as the first page states it."), dryRun: false });
  await loadOfficialClaims({ query: async (sql: string) => rows(sql), files: capture(otherKey, "b".repeat(64), "A different fixture sentence on the second page."), dryRun: false });
  const evidenceFor = async (stable: string) => (await rows<{ definition_id: string; evidence_id: string }>(
    `select d.id as definition_id, e.id as evidence_id
     from public.rule_definitions d
     join public.rule_versions v on v.definition_id = d.id and v.status = 'published'
     join public.rule_evidence e on e.rule_version_id = v.id
     where d.stable_key = $1`,
    [stable],
  ))[0];
  return { left: await evidenceFor(key), right: await evidenceFor(otherKey) };
}

/** Whether the claim is blocked for orgId (null: platform-wide conflicts only). */
async function conflictOpen(definitionId: string, orgId: string | null = null) {
  await asMaintenance(db);
  return (await rows<{ open: boolean }>(`select app.claim_conflict_open_for($1, $2) as open`, [definitionId, orgId]))[0].open;
}

async function platformAdmin(role: "owner" | "operator" | "viewer") {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `p-${tag()}@example.test`]);
  await db.query(`insert into public.platform_admins (user_id, note, role) values ($1, 'Synthetic admin', $2)`, [id, role]);
  return id;
}

describe("source conflicts on official claims", () => {
  it("another firm's licensed member cannot resolve a conflict it did not open; the opening firm can", async () => {
    const claims = await disagreeingClaims();
    const a = await firm();
    const b = await firm();
    await as(a.consultant, a.orgId, 0);
    const conflict = (await rows<{ id: string }>(
      `select public.record_source_conflict($1, $2, $3, 'The stored excerpts disagree.') as id`,
      [claims.left.definition_id, claims.left.evidence_id, claims.right.evidence_id],
    ))[0].id;
    await asMaintenance(db);
    expect((await rows<{ org: string }>(`select opened_organization_id as org from public.source_conflicts where id = $1`, [conflict]))[0].org).toBe(a.orgId);
    expect(await conflictOpen(claims.left.definition_id, a.orgId)).toBe(true);

    // Firm B: licensed, fresh step-up, but it did not open this review.
    await as(b.consultant, b.orgId, 0);
    await expectDbError(
      () => db.query(`select public.resolve_source_conflict($1, 'Synthetic: closing another firm''s review.')`, [conflict]),
      /only the firm that opened this review/,
    );
    await as(b.owner, b.orgId, 1);
    await expectDbError(
      () => db.query(`select public.resolve_source_conflict($1, 'Synthetic: closing another firm''s review.')`, [conflict]),
      /only the firm that opened this review/,
    );
    expect(await conflictOpen(claims.left.definition_id, a.orgId)).toBe(true);

    // Firm A, the opener: still needs a fresh step-up, then resolves it.
    await as(a.consultant, a.orgId);
    await expectDbError(() => db.query(`select public.resolve_source_conflict($1, 'Synthetic: resolved.')`, [conflict]), /step-up/);
    await as(a.consultant, a.orgId, 2);
    await db.query(`select public.resolve_source_conflict($1, 'Synthetic: the second page does not apply.')`, [conflict]);
    expect(await conflictOpen(claims.left.definition_id, a.orgId)).toBe(false);
  });

  it("a conflict the re-check opened is resolved only by a platform owner/operator at a fresh step-up", async () => {
    const claims = await disagreeingClaims();
    const a = await firm();
    await asMaintenance(db);
    const snaps = await rows<{ left_snap: string; right_snap: string; left_url: string; right_url: string }>(
      `select l.snapshot_id as left_snap, r.snapshot_id as right_snap, ls.final_url as left_url, rs.final_url as right_url
       from public.rule_evidence l, public.rule_evidence r, public.source_snapshots ls, public.source_snapshots rs
       where l.id = $1 and r.id = $2 and ls.id = l.snapshot_id and rs.id = r.snapshot_id`,
      [claims.left.evidence_id, claims.right.evidence_id],
    );
    // As the re-check does: no opening firm.
    const conflict = (await rows<{ id: string }>(
      `insert into public.source_conflicts (definition_id, left_snapshot_id, right_snapshot_id, left_url, right_url, opened_reason)
       values ($1, $2, $3, $4, $5, 'A re-check read different text on two official pages') returning id`,
      [claims.left.definition_id, snaps[0].left_snap, snaps[0].right_snap, snaps[0].left_url, snaps[0].right_url],
    ))[0].id;

    await as(a.consultant, a.orgId, 0);
    await expectDbError(() => db.query(`select public.resolve_source_conflict($1, 'Synthetic: firm closes it.')`, [conflict]), /only the firm that opened this review/);

    const viewer = await platformAdmin("viewer");
    await asUser(db, { userId: viewer, aal: "aal2", orgId: "", totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.resolve_source_conflict($1, 'Synthetic: viewer closes it.')`, [conflict]), /denied|sign in/);

    const operator = await platformAdmin("operator");
    await asUser(db, { userId: operator, aal: "aal2", orgId: "", totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.resolve_source_conflict($1, 'Synthetic: operator closes it.')`, [conflict]), /step-up/);
    expect(await conflictOpen(claims.left.definition_id)).toBe(true);

    await asUser(db, { userId: operator, aal: "aal2", orgId: "", totpAgeSeconds: 0 });
    await db.query(`select public.resolve_source_conflict($1, 'Synthetic: checked both pages; the second does not apply.')`, [conflict]);
    expect(await conflictOpen(claims.left.definition_id)).toBe(false);
    await asMaintenance(db);
    const audit = await rows<{ actor: string; org: string | null }>(
      `select actor_user_id as actor, organization_id as org from public.audit_log where object_id = $1 and action = 'source.conflict_resolved'`,
      [conflict],
    );
    expect(audit).toEqual([{ actor: operator, org: null }]);
  });
});

describe("page captures on claims and official requirements", () => {
  async function addClaim(orgId: string, snapshot: unknown, key: string | null = null) {
    return (await rows<{ id: string }>(
      `select public.add_rule_claim($1, $2, 'CA', 'synthetic_program', 'Synthetic claim: a fictional fee.', null, $3, null, 'Synthetic excerpt.',
         null, null, null, null, null, null, null, null, null, $4::date, $5::jsonb) as id`,
      [orgId, key, PAGE, today(), snapshot == null ? null : JSON.stringify(snapshot)],
    ))[0].id;
  }

  async function evidence(versionId: string) {
    await asMaintenance(db);
    return (await rows<{ snapshot_id: string | null; status: string; content_hash: string | null; server_captured: boolean | null }>(
      `select e.snapshot_id, v.status::text as status, s.content_hash, s.server_captured
       from public.rule_evidence e join public.rule_versions v on v.id = e.rule_version_id
       left join public.source_snapshots s on s.id = e.snapshot_id
       where e.rule_version_id = $1`,
      [versionId],
    ))[0];
  }

  it("a hash the caller sends is not a capture: the claim is kept without one and approval needs the attestation", async () => {
    const f = await firm();
    await as(f.owner, f.orgId);
    const forged = await addClaim(f.orgId, { sha256: HASH, retrieved_at: new Date().toISOString(), final_url: PAGE.split("#")[0], http_status: 200 });
    expect(await evidence(forged)).toMatchObject({ snapshot_id: null, status: "draft" });

    await as(f.owner, f.orgId);
    await db.query(`select public.resolve_rule_applicability($1, (select version from public.rule_versions where id = $1), 'applies', 'Synthetic: applies to everyone.')`, [forged]);
    await as(f.consultant, f.orgId, 0);
    await expectDbError(
      () => db.query(`select public.review_rule_version($1, (select version from public.rule_versions where id = $1), 'approved', null, (now() + interval '60 days')::date, null)`, [forged]),
      /attestation/,
    );
  });

  it("a snapshot a signed-in user wrote, or another firm's capture, is refused; the server's capture is accepted", async () => {
    const f = await firm();
    const other = await firm();

    // A signed-in user writes no source or snapshot directly (20261030235000).
    const sourceSql = `insert into public.official_sources (organization_id, publisher, canonical_url, allowed_host, jurisdiction, content_kind)
       values ($1, 'Synthetic publisher', $2, 'www.canada.ca', 'CA', 'program_guidance') returning id`;
    await as(f.owner, f.orgId);
    await expectDbError(() => rows(sourceSql, [f.orgId, PAGE.split("#")[0]]), /row-level security/);
    // A row stored with a user's request claims (not the capture service) is never marked as a
    // server capture, and the mark can't be set later.
    await asUserInternal(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 3600 });
    const source = (await rows<{ id: string }>(sourceSql, [f.orgId, PAGE.split("#")[0]]))[0].id;
    const written = (await rows<{ id: string; server_captured: boolean }>(
      `insert into public.source_snapshots (organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, content_hash, retrieval_result, server_captured)
       values ($1, $2, 1, $3, 'Synthetic publisher', now(), $4, 'success', true) returning id, server_captured`,
      [f.orgId, source, PAGE.split("#")[0], HASH],
    ))[0];
    expect(written.server_captured).toBe(false);
    await db.query(`update public.source_snapshots set server_captured = true where id = $1`, [written.id]);
    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(`update public.source_snapshots set server_captured = true where id = $1`, [written.id]), /permission denied/);
    await asMaintenance(db);
    expect((await rows<{ s: boolean }>(`select server_captured as s from public.source_snapshots where id = $1`, [written.id]))[0].s).toBe(false);

    await as(f.owner, f.orgId);
    await expectDbError(() => addClaim(f.orgId, { snapshot_id: written.id }), /not stored by Casevoya/);

    // Only the service role stores a capture, and only for a staff member of that firm.
    await expectDbError(
      () => db.query(`select public.service_store_page_capture($1, $2, $3, null, $4::jsonb)`, [f.orgId, f.owner, PAGE, JSON.stringify({ sha256: HASH, retrieved_at: new Date().toISOString() })]),
      /permission denied/,
    );
    await expectDbError(() => serverCapture(db, { orgId: f.orgId, actor: other.owner, url: PAGE, snapshot: { sha256: HASH } }), /staff access denied/);

    // Another firm's server capture of the same page can't be named.
    await as(other.owner, other.orgId);
    const theirs = await serverCapture(db, { orgId: other.orgId, url: PAGE, snapshot: { sha256: HASH } });
    await as(f.owner, f.orgId);
    await expectDbError(() => addClaim(f.orgId, theirs), /not stored by Casevoya/);

    // The firm's own server capture: captured, with the stored hash.
    const ours = await serverCapture(db, { orgId: f.orgId, url: PAGE, snapshot: { sha256: HASH } });
    const id = await addClaim(f.orgId, ours);
    expect(await evidence(id)).toEqual({ snapshot_id: ours.snapshot_id, status: "evidence_captured", content_hash: HASH, server_captured: true });
  });

  it("an official requirement with a caller-sent hash has no snapshot; with the server's capture it does", async () => {
    const f = await firm();
    await as(f.owner, f.orgId);
    const propose = async (label: string, snapshot: unknown) =>
      (await rows<{ id: string }>(
        `select public.propose_submission_requirement($1, null, 'online_portal'::public.submission_channel, 'outside_step', $2, $3, null, null, null, $4::date, null, $5::jsonb) as id`,
        [f.orgId, label, PAGE, today(), JSON.stringify(snapshot)],
      ))[0].id;
    const forged = await propose("Synthetic step with a caller hash", { sha256: HASH, retrieved_at: new Date().toISOString(), final_url: PAGE.split("#")[0], http_status: 200 });
    const captured = await propose("Synthetic step with a server capture", await serverCapture(db, { orgId: f.orgId, url: PAGE, snapshot: { sha256: HASH } }));
    await asMaintenance(db);
    const read = async (id: string) =>
      (await rows<{ snapshot_id: string | null; snapshot_sha256: string | null }>(`select snapshot_id, snapshot_sha256 from public.submission_requirements where id = $1`, [id]))[0];
    expect(await read(forged)).toEqual({ snapshot_id: null, snapshot_sha256: null });
    expect((await read(captured)).snapshot_sha256).toBe(HASH);

    // The approval of the caller-hash entry needs the reviewer's attestation.
    await as(f.consultant, f.orgId, 0);
    await expectDbError(() => db.query(`select public.review_submission_requirement($1, 1, 'approved', null)`, [forged]), /attestation/);
  });

  it("the loader and the re-check (service role) still store captures marked as the server's", async () => {
    const claims = await disagreeingClaims();
    await asMaintenance(db);
    const loaded = (await rows<{ source_id: string; server_captured: boolean; final_url: string }>(
      `select s.source_id, s.server_captured, s.final_url from public.rule_evidence e join public.source_snapshots s on s.id = e.snapshot_id where e.id = $1`,
      [claims.left.evidence_id],
    ))[0];
    expect(loaded.server_captured).toBe(true);

    await asServiceRole(db);
    await db.query(`select public.service_record_official_recheck($1::jsonb)`, [
      JSON.stringify({
        source_id: loaded.source_id,
        result: "changed",
        sha256: "9".repeat(64),
        retrieved_at: new Date().toISOString(),
        http_status: 200,
        final_url: loaded.final_url,
        claims: [{
          definition_id: claims.left.definition_id,
          claim: "Synthetic claim as the first page states it after a re-check.",
          value: null,
          section: "Synthetic section",
          excerpt: "Synthetic claim as the first page states it after a re-check.",
          source_url: `${loaded.final_url}#s1`,
        }],
      }),
    ]);
    await asMaintenance(db);
    const latest = await rows<{ server_captured: boolean }>(
      `select server_captured from public.source_snapshots where source_id = $1 and content_hash = $2`,
      [loaded.source_id, "9".repeat(64)],
    );
    expect(latest).toEqual([{ server_captured: true }]);
  });
});
