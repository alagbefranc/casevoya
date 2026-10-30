import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadOfficialClaims } from "../scripts/ops/load-official-claims.mjs";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * SRC-04, SRC-08, SRC-10 and SRC-11. Every page, claim and program key here is synthetic.
 * Nothing in this file is an immigration rule.
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
const HASH2 = "d".repeat(64);

async function rows<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function firm() {
  await asMaintenance(db);
  const owner = randomUUID();
  const consultant = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()), ($3, $4, now())`, [
    owner, `o-${tag()}@example.test`, consultant, `c-${tag()}@example.test`,
  ]);
  await asUser(db, { userId: owner, aal: "aal2", orgId: "", totpAgeSeconds: 0 });
  const orgId = (await rows<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`]))[0].id;
  await asMaintenance(db);
  const consultantMembership = (await rows<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
    [orgId, consultant, owner],
  ))[0].id;
  await db.query(`update public.profiles set display_name = 'Synthetic Consultant' where id = $1`, [consultant]);
  const college = `R${tag().slice(0, 6).toUpperCase()}`;
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await rows<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', 'proof/synthetic') as id`,
    [consultantMembership, college],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, 'https://register.college-ic.ca/Public-Register-EN', statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, 'proof/synthetic', 'Synthetic reviewer note')`,
    [credential[0].id],
  );
  await asMaintenance(db);
  const ownerMembership = (await rows<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner]))[0].id;
  return { orgId, owner, consultant, consultantMembership, ownerMembership };
}

function capture(key: string) {
  const page = `https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic-${tag()}/page.html`;
  return {
    page,
    files: [{
      name: "captured-claims.json",
      data: {
        pages: [{ url: page, publisher: "Immigration, Refugees and Citizenship Canada", title: "Synthetic", finalUrl: page, httpStatus: 200, retrievedAt: new Date().toISOString(), sha256: HASH, modifiedOn: null, lastAmendedOn: null, currentTo: null }],
        claims: [{
          key, category: "program", program: "synthetic_program", jurisdiction: "CA",
          claim: "Synthetic claim as the page states it.", value: null, page,
          sourceUrl: `${page}#s1`, section: "Synthetic section",
          excerpt: "Synthetic excerpt that is long enough to compare.",
        }],
      },
    }],
  };
}

describe("scheduled re-check, conflicts and a named program pack", () => {
  it("re-checks a page, opens an impact task, and publishes a pack with a named reviewer", async () => {
    const key = `CA.SYNTH.${tag().toUpperCase()}`;
    const built = capture(key);
    await asMaintenance(db);
    await loadOfficialClaims({ query: async (sql: string) => rows(sql), files: built.files, dryRun: false });
    const promoted = await rows<{ result: { promoted: number } }>(`select app.promote_official_claim_drafts() as result`);
    expect(promoted[0].result.promoted).toBe(0);

    const loaded = (await rows<{ definition_id: string; source_id: string; version_id: string; evidence_id: string }>(
      `select d.id as definition_id, snap.source_id, v.id as version_id, e.id as evidence_id
       from public.rule_definitions d
       join public.rule_versions v on v.definition_id = d.id and v.status = 'published'
       join public.rule_evidence e on e.rule_version_id = v.id
       join public.source_snapshots snap on snap.id = e.snapshot_id
       where d.stable_key = $1`,
      [key],
    ))[0];
    const f = await firm();

    await asUser(db, { userId: f.consultant, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.service_record_official_recheck('{}'::jsonb)`), /permission denied/);

    await asServiceRole(db);
    const unchanged = await rows<{ result: { result: string } }>(
      `select public.service_record_official_recheck($1::jsonb) as result`,
      [JSON.stringify({ source_id: loaded.source_id, result: "unchanged", sha256: HASH, retrieved_at: new Date().toISOString(), http_status: 200, final_url: built.page })],
    );
    expect(unchanged[0].result.result).toBe("unchanged");

    const failed = await rows<{ result: { result: string; published: number } }>(
      `select public.service_record_official_recheck($1::jsonb) as result`,
      [JSON.stringify({ source_id: loaded.source_id, result: "failed", retrieved_at: new Date().toISOString(), http_status: 503, final_url: built.page, error_code: "http_503" })],
    );
    expect(failed[0].result).toMatchObject({ result: "failed", published: 0 });

    const changed = await rows<{ result: { result: string } }>(
      `select public.service_record_official_recheck($1::jsonb) as result`,
      [JSON.stringify({
        source_id: loaded.source_id,
        result: "changed",
        sha256: HASH2,
        retrieved_at: new Date().toISOString(),
        http_status: 200,
        final_url: built.page,
        claims: [{
          definition_id: loaded.definition_id,
          claim: "Synthetic claim as the page states it now, with different fixture wording.",
          value: null,
          section: "Synthetic section",
          excerpt: "Synthetic claim as the page states it now, with different fixture wording.",
          source_url: `${built.page}#s1`,
        }],
      })],
    );
    expect(changed[0].result.result).toBe("changed");

    await asMaintenance(db);
    const versions = await rows<{ status: string; n: string }>(
      `select status::text, count(*)::text as n from public.rule_versions v
       join public.rule_definitions d on d.id = v.definition_id
       where d.stable_key = $1 group by status`,
      [key],
    );
    expect(versions.find((item) => item.status === "published")?.n).toBe("1");
    expect(versions.find((item) => item.status === "superseded")?.n).toBe("1");
    const checkedAt = await rows<{ recent: boolean }>(
      `select last_checked_at > statement_timestamp() - interval '5 minutes' as recent from public.official_sources where id = $1`,
      [loaded.source_id],
    );
    expect(checkedAt[0].recent).toBe(true);

    const matterId = randomUUID();
    await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true)`, [matterId, f.orgId]);
    const pack = await rows<{ id: string }>(
      `insert into public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version, next_review_at)
       values ($1, 'CA', 'synthetic_program', 1, '2027-01-01T00:00:00Z') returning id`,
      [f.orgId],
    );
    const live = await rows<{ id: string }>(
      `select v.id from public.rule_versions v where v.definition_id = $1 and v.status = 'published'`,
      [loaded.definition_id],
    );
    await db.query(`insert into public.rule_pack_items (pack_id, rule_version_id) values ($1, $2)`, [pack[0].id, live[0].id]);
    await db.query(`update public.rule_pack_versions set status = 'published' where id = $1`, [pack[0].id]);
    await db.query(
      `insert into public.matter_rule_bindings (organization_id, matter_id, rule_pack_version_id) values ($1, $2, $3)`,
      [f.orgId, matterId, pack[0].id],
    );

    await asServiceRole(db);
    const moved = await rows<{ result: { tasks: number } }>(
      `select public.service_record_official_recheck($1::jsonb) as result`,
      [JSON.stringify({
        source_id: loaded.source_id,
        result: "changed",
        sha256: "e".repeat(64),
        retrieved_at: new Date().toISOString(),
        http_status: 200,
        final_url: built.page,
        claims: [{
          definition_id: loaded.definition_id,
          claim: "Synthetic claim as the page states it on a later fixture fetch.",
          value: null,
          section: "Synthetic section",
          excerpt: "Synthetic claim as the page states it on a later fixture fetch.",
          source_url: `${built.page}#s1`,
        }],
      })],
    );
    expect(moved[0].result.tasks).toBeGreaterThan(0);
    await asMaintenance(db);
    const tasks = await rows<{ n: number }>(
      `select count(*)::int as n from public.tasks where organization_id = $1 and matter_id = $2 and task_key like 'source_review:%' and status = 'open'`,
      [f.orgId, matterId],
    );
    expect(tasks[0].n).toBe(1);

    await asUser(db, { userId: f.consultant, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    const tests = await rows<{ id: string }>(
      `select public.save_rule_test_case($1, 'supported', 'Synthetic supported case', '{"ready": true}'::jsonb, 'applies') as id`,
      [loaded.definition_id],
    );
    expect(tests[0].id).toBeTruthy();
    const ran = await rows<{ result: { cases: { actual: string; pass: boolean }[] } }>(`select public.run_rule_tests($1) as result`, [loaded.definition_id]);
    expect(ran[0].result.cases[0]).toMatchObject({ actual: "no_executable_condition", pass: false });

    await asUser(db, { userId: f.consultant, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 1 });
    const published = await rows<{ id: string }>(
      `select public.publish_reviewed_program_pack(
         'synthetic_program', 'CA', $1::uuid[], $2, '2026-11-01T00:00:00Z', '2027-11-01T00:00:00Z',
         'The consultant reviews affected matters and templates when a source page changes.'
       ) as id`,
      [[live[0].id], f.consultantMembership],
    );
    await asMaintenance(db);
    const packRow = await rows<{ reviewer_name: string; source_owner_licence: string; status: string }>(
      `select reviewer_name, source_owner_licence, status::text from public.rule_pack_versions where id = $1`,
      [published[0].id],
    );
    expect(packRow[0].status).toBe("published");
    expect(packRow[0].reviewer_name).toBe("Synthetic Consultant");
    expect(packRow[0].source_owner_licence).toMatch(/^R/);

    // Staff write firm packs only through publish_reviewed_program_pack (20261030235000).
    const draftSql = `insert into public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version, next_review_at)
       values ($1, 'CA', 'synthetic_program', 9, '2027-06-01T00:00:00Z') returning id`;
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(draftSql, [f.orgId]), /row-level security/);
    await asMaintenance(db);
    const draft = await rows<{ id: string }>(draftSql, [f.orgId]);
    await db.query(`insert into public.rule_pack_items (pack_id, rule_version_id) values ($1, $2)`, [draft[0].id, live[0].id]);
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    const direct = await db.query(`update public.rule_pack_versions set status = 'published' where id = $1`, [draft[0].id]);
    expect(direct.affectedRows ?? 0).toBe(0);
    await asMaintenance(db);
    expect((await rows<{ status: string }>(`select status::text from public.rule_pack_versions where id = $1`, [draft[0].id]))[0].status).toBe("draft");
  });

  it("blocks a claim when two stored official pages disagree", async () => {
    const key = `CA.SYNTH.${tag().toUpperCase()}`;
    const otherKey = `CA.SYNTH.${tag().toUpperCase()}`;
    const built = capture(key);
    const otherBuilt = capture(otherKey);
    otherBuilt.files[0].data.pages[0].sha256 = "f".repeat(64);
    otherBuilt.files[0].data.claims[0].excerpt = "A completely different fixture sentence that is not the first excerpt.";
    otherBuilt.files[0].data.claims[0].claim = "A completely different fixture sentence that is not the first excerpt.";
    await asMaintenance(db);
    await loadOfficialClaims({ query: async (sql: string) => rows(sql), files: built.files, dryRun: false });
    await loadOfficialClaims({ query: async (sql: string) => rows(sql), files: otherBuilt.files, dryRun: false });
    const evidenceFor = async (stable: string) => (await rows<{ definition_id: string; evidence_id: string }>(
      `select d.id as definition_id, e.id as evidence_id
       from public.rule_definitions d
       join public.rule_versions v on v.definition_id = d.id and v.status = 'published'
       join public.rule_evidence e on e.rule_version_id = v.id
       where d.stable_key = $1`,
      [stable],
    ))[0];
    const loaded = await evidenceFor(key);
    const evidence = await evidenceFor(otherKey);
    const f = await firm();
    await asUser(db, { userId: f.consultant, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    const conflict = await rows<{ id: string }>(
      `select public.record_source_conflict($1, $2, $3, 'The stored excerpts disagree.') as id`,
      [loaded.definition_id, loaded.evidence_id, evidence.evidence_id],
    );
    expect(conflict[0].id).toBeTruthy();
    await asMaintenance(db);
    const blocked = await rows<{ open: boolean }>(`select app.claim_conflict_open_for($1, $2) as open`, [loaded.definition_id, f.orgId]);
    expect(blocked[0].open).toBe(true);
    await asUser(db, { userId: f.consultant, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 2 });
    await db.query(`select public.resolve_source_conflict($1, 'The second page does not apply to this fixture.')`, [conflict[0].id]);
    await asMaintenance(db);
    const closed = await rows<{ open: boolean }>(`select app.claim_conflict_open_for($1, $2) as open`, [loaded.definition_id, f.orgId]);
    expect(closed[0].open).toBe(false);
  });
});
