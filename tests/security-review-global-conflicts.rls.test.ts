import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadOfficialClaims } from "../scripts/ops/load-official-claims.mjs";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Conflicts on platform-wide official claims (20261030220000_source_conflict_firm_scope.sql):
 *  - a conflict a firm opens blocks the claim, and opens review tasks, only in that firm;
 *  - a platform owner/operator at a fresh step-up opens one that blocks the claim for every firm;
 *  - conflicts on firm-owned claims behave as before.
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
  const evidenceFor = async (stable: string) => (await rows<{ definition_id: string; evidence_id: string; version_id: string; snapshot_id: string; final_url: string }>(
    `select d.id as definition_id, e.id as evidence_id, v.id as version_id, s.id as snapshot_id, s.final_url
     from public.rule_definitions d
     join public.rule_versions v on v.definition_id = d.id and v.status = 'published'
     join public.rule_evidence e on e.rule_version_id = v.id
     join public.source_snapshots s on s.id = e.snapshot_id
     where d.stable_key = $1`,
    [stable],
  ))[0];
  return { left: await evidenceFor(key), right: await evidenceFor(otherKey) };
}

/** A matter in orgId bound to a published pack that contains the claim version. */
async function matterUsing(orgId: string, versionId: string) {
  await asMaintenance(db);
  const matterId = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true)`, [matterId, orgId]);
  const pack = (await rows<{ id: string }>(
    `insert into public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version, next_review_at)
     values ($1, 'CA', 'synthetic_program', 1, '2027-01-01T00:00:00Z') returning id`,
    [orgId],
  ))[0].id;
  await db.query(`insert into public.rule_pack_items (pack_id, rule_version_id) values ($1, $2)`, [pack, versionId]);
  await db.query(`update public.rule_pack_versions set status = 'published' where id = $1`, [pack]);
  await db.query(`insert into public.matter_rule_bindings (organization_id, matter_id, rule_pack_version_id) values ($1, $2, $3)`, [orgId, matterId, pack]);
  return { matterId, pack };
}

async function blockedFor(definitionId: string, orgId: string | null) {
  await asMaintenance(db);
  return (await rows<{ open: boolean }>(`select app.claim_conflict_open_for($1, $2) as open`, [definitionId, orgId]))[0].open;
}

async function packLive(pack: string) {
  await asMaintenance(db);
  return (await rows<{ live: boolean }>(`select app.rule_pack_is_live($1) as live`, [pack]))[0].live;
}

async function reviewTasks(orgId: string, definitionId: string) {
  await asMaintenance(db);
  const tasks = (await rows<{ n: number }>(
    `select count(*)::int as n from public.tasks where organization_id = $1 and task_key = 'source_review:' || $2::text`,
    [orgId, definitionId],
  ))[0].n;
  const impacts = (await rows<{ n: number }>(
    `select count(*)::int as n from public.rule_impacts i join public.rule_versions v on v.id = i.rule_version_id
     where i.organization_id = $1 and v.definition_id = $2`,
    [orgId, definitionId],
  ))[0].n;
  return { tasks, impacts };
}

async function platformAdmin(role: "owner" | "operator" | "viewer") {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `p-${tag()}@example.test`]);
  await db.query(`insert into public.platform_admins (user_id, note, role) values ($1, 'Synthetic admin', $2)`, [id, role]);
  return id;
}

const record = (claims: Awaited<ReturnType<typeof disagreeingClaims>>) =>
  db.query<{ id: string }>(
    `select public.record_source_conflict($1, $2, $3, 'The stored excerpts disagree.') as id`,
    [claims.left.definition_id, claims.left.evidence_id, claims.right.evidence_id],
  );

describe("conflicts on platform-wide official claims", () => {
  it("a firm's conflict blocks the claim and opens tasks only in that firm", async () => {
    const claims = await disagreeingClaims();
    const def = claims.left.definition_id;
    const a = await firm();
    const b = await firm();
    const usesA = await matterUsing(a.orgId, claims.left.version_id);
    const usesB = await matterUsing(b.orgId, claims.left.version_id);
    expect(await packLive(usesA.pack)).toBe(true);
    expect(await packLive(usesB.pack)).toBe(true);

    await as(a.consultant, a.orgId, 0);
    const conflict = (await record(claims)).rows[0].id;
    await asMaintenance(db);
    expect((await rows<{ status: string; org: string | null }>(
      `select status, opened_organization_id as org from public.source_conflicts where id = $1`, [conflict],
    ))[0]).toEqual({ status: "firm_open", org: a.orgId });

    // Firm A: blocked, with its own review task.
    expect(await blockedFor(def, a.orgId)).toBe(true);
    expect(await packLive(usesA.pack)).toBe(false);
    expect((await reviewTasks(a.orgId, def)).tasks).toBe(1);
    await as(a.consultant, a.orgId);
    expect((await rows<{ open: boolean }>(`select app.claim_conflict_open($1) as open`, [def]))[0].open).toBe(true);
    expect((await rows<{ c: { id: string; status: string } | null }>(`select public.source_conflict_for($1) as c`, [def]))[0].c)
      .toMatchObject({ id: conflict, status: "open" });
    expect(await rows(`select id from public.source_conflicts where id = $1`, [conflict])).toHaveLength(1);
    const editorA = (await rows<{ e: { claims: { definition_id: string }[] } }>(`select public.program_pack_editor() as e`))[0].e;
    expect(editorA.claims.some((claim) => claim.definition_id === def)).toBe(false);

    // Firm B and the platform-wide state: not blocked, nothing created, nothing visible.
    expect(await blockedFor(def, null)).toBe(false);
    expect(await blockedFor(def, b.orgId)).toBe(false);
    expect(await packLive(usesB.pack)).toBe(true);
    expect(await reviewTasks(b.orgId, def)).toEqual({ tasks: 0, impacts: 0 });
    await as(b.consultant, b.orgId);
    expect((await rows<{ open: boolean }>(`select app.claim_conflict_open($1) as open`, [def]))[0].open).toBe(false);
    expect((await rows<{ c: unknown }>(`select public.source_conflict_for($1) as c`, [def]))[0].c).toBeNull();
    expect(await rows(`select id from public.source_conflicts where id = $1`, [conflict])).toHaveLength(0);
    const editorB = (await rows<{ e: { claims: { definition_id: string }[] } }>(`select public.program_pack_editor() as e`))[0].e;
    expect(editorB.claims.some((claim) => claim.definition_id === def)).toBe(true);

    // Firm B can open its own review of the same claim; it stays separate from A's.
    await as(b.consultant, b.orgId, 0);
    const own = (await record(claims)).rows[0].id;
    expect(own).not.toBe(conflict);
    expect((await reviewTasks(b.orgId, def)).tasks).toBe(1);
    expect((await reviewTasks(a.orgId, def)).tasks).toBe(1);

    // Platform owner/operator admins see every firm's review.
    const operator = await platformAdmin("operator");
    await asUser(db, { userId: operator, aal: "aal2", orgId: "", totpAgeSeconds: 3600 });
    expect((await rows<{ id: string }>(`select id from public.source_conflicts where definition_id = $1 order by created_at`, [def])).map((r) => r.id))
      .toEqual([conflict, own]);
  });

  it("only a platform owner/operator at a fresh step-up opens a conflict that blocks the claim for every firm", async () => {
    const claims = await disagreeingClaims();
    const def = claims.left.definition_id;
    const a = await firm();
    const b = await firm();
    const usesA = await matterUsing(a.orgId, claims.left.version_id);
    const usesB = await matterUsing(b.orgId, claims.left.version_id);

    const viewer = await platformAdmin("viewer");
    await asUser(db, { userId: viewer, aal: "aal2", orgId: "", totpAgeSeconds: 0 });
    await expectDbError(() => record(claims), /denied|sign in/);
    const operator = await platformAdmin("operator");
    await asUser(db, { userId: operator, aal: "aal2", orgId: "", totpAgeSeconds: 3600 });
    await expectDbError(() => record(claims), /step-up/);
    expect(await blockedFor(def, a.orgId)).toBe(false);

    await asUser(db, { userId: operator, aal: "aal2", orgId: "", totpAgeSeconds: 0 });
    const conflict = (await record(claims)).rows[0].id;
    await asMaintenance(db);
    expect((await rows<{ status: string; org: string | null }>(
      `select status, opened_organization_id as org from public.source_conflicts where id = $1`, [conflict],
    ))[0]).toEqual({ status: "open", org: null });
    expect(await blockedFor(def, null)).toBe(true);
    expect(await blockedFor(def, a.orgId)).toBe(true);
    expect(await blockedFor(def, b.orgId)).toBe(true);
    expect(await packLive(usesA.pack)).toBe(false);
    expect(await packLive(usesB.pack)).toBe(false);
    expect((await reviewTasks(a.orgId, def)).tasks).toBe(1);
    expect((await reviewTasks(b.orgId, def)).tasks).toBe(1);
    const audit = await rows<{ org: string | null }>(
      `select organization_id as org from public.audit_log where object_id = $1 and action = 'source.conflict_opened'`, [conflict],
    );
    expect(audit).toEqual([{ org: null }]);

    await as(b.consultant, b.orgId);
    expect((await rows<{ c: { id: string; status: string } }>(`select public.source_conflict_for($1) as c`, [def]))[0].c)
      .toMatchObject({ id: conflict, status: "open" });
    await as(a.consultant, a.orgId, 0);
    await expectDbError(() => record(claims), /already open/);

    // Closed by the operator: every firm is unblocked.
    await asUser(db, { userId: operator, aal: "aal2", orgId: "", totpAgeSeconds: 0 });
    await db.query(`select public.resolve_source_conflict($1, 'Synthetic: checked both pages.')`, [conflict]);
    expect(await blockedFor(def, a.orgId)).toBe(false);
    expect(await blockedFor(def, b.orgId)).toBe(false);
  });

  it("firm-owned claims behave as before", async () => {
    const claims = await disagreeingClaims();
    const f = await firm();
    await asMaintenance(db);
    const own = (await rows<{ id: string }>(
      `insert into public.rule_definitions (organization_id, stable_key, category, jurisdiction, program_key)
       values ($1, $2, 'immigration_requirement', 'CA', 'synthetic_program') returning id`,
      [f.orgId, `CA.CLAIM.SYNTHETIC.C${tag().toUpperCase()}`],
    ))[0].id;

    // A firm still records conflicts only on official captures.
    await as(f.consultant, f.orgId, 0);
    await expectDbError(
      () => db.query(`select public.record_source_conflict($1, $2, $3, 'The stored excerpts disagree.')`, [own, claims.left.evidence_id, claims.right.evidence_id]),
      /not an official capture/,
    );

    // An open conflict on the firm's own claim blocks it for that firm.
    await asMaintenance(db);
    await db.query(
      `insert into public.source_conflicts (definition_id, left_snapshot_id, right_snapshot_id, left_url, right_url, opened_reason)
       values ($1, $2, $3, $4, $5, 'A re-check read different text on two official pages')`,
      [own, claims.left.snapshot_id, claims.right.snapshot_id, claims.left.final_url, claims.right.final_url],
    );
    expect(await blockedFor(own, f.orgId)).toBe(true);
    await as(f.consultant, f.orgId);
    expect((await rows<{ open: boolean }>(`select app.claim_conflict_open($1) as open`, [own]))[0].open).toBe(true);

    // A platform-wide row never names an opening firm.
    await asMaintenance(db);
    await expectDbError(
      () => db.query(
        `insert into public.source_conflicts (definition_id, left_snapshot_id, right_snapshot_id, left_url, right_url, opened_reason, opened_organization_id)
         values ($1, $2, $3, $4, $5, 'Synthetic', $6)`,
        [claims.right.definition_id, claims.left.snapshot_id, claims.right.snapshot_id, claims.left.final_url, claims.right.final_url, f.orgId],
      ),
      /source_conflicts_scope_check/,
    );
  });
});
