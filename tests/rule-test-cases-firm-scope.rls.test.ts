import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadOfficialClaims } from "../scripts/ops/load-official-claims.mjs";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Rule test cases on a platform rule stay with the firm that wrote them (#303). Every page, claim
 * and program key here is synthetic. Nothing in this file is an immigration rule.
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
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await rows<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', 'proof/synthetic') as id`,
    [consultantMembership, `R${tag().slice(0, 6).toUpperCase()}`],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, 'https://register.college-ic.ca/Public-Register-EN', statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, 'proof/synthetic', 'Synthetic reviewer note')`,
    [credential[0].id],
  );
  await asMaintenance(db);
  return { orgId, owner, consultant };
}

async function platformRule() {
  const key = `CA.SYNTH.${tag().toUpperCase()}`;
  const page = `https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic-${tag()}/page.html`;
  await asMaintenance(db);
  await loadOfficialClaims({
    query: async (sql: string) => rows(sql),
    dryRun: false,
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
  });
  return (await rows<{ definition_id: string; version_id: string }>(
    `select d.id as definition_id, v.id as version_id
     from public.rule_definitions d
     join public.rule_versions v on v.definition_id = d.id and v.status = 'published'
     where d.stable_key = $1`,
    [key],
  ))[0];
}

async function save(f: { consultant: string; orgId: string }, definitionId: string, inputs = '{"ready": true}', stepUpAgeSeconds = 0) {
  await asUser(db, { userId: f.consultant, aal: "aal2", orgId: f.orgId, totpAgeSeconds: stepUpAgeSeconds });
  return (await rows<{ id: string }>(
    `select public.save_rule_test_case($1, 'supported', 'Synthetic supported case', $2::jsonb, 'applies') as id`,
    [definitionId, inputs],
  ))[0].id;
}

describe("rule test cases on a platform rule", () => {
  it("are stored with the caller's firm and are not shown to or run for another firm", async () => {
    const rule = await platformRule();
    const a = await firm();
    const b = await firm();

    const own = await save(a, rule.definition_id);
    await asMaintenance(db);
    const stored = (await rows<{ organization_id: string | null }>(`select organization_id from public.rule_test_cases where id = $1`, [own]))[0];
    expect(stored.organization_id).toBe(a.orgId);
    const listed = (await rows<{ ids: string[] }>(`select test_case_ids as ids from public.rule_versions where id = $1`, [rule.version_id]))[0];
    expect(listed.ids).not.toContain(own);

    // A null-firm case a firm user wrote before this change, and one from a maintenance session.
    const legacy = (await rows<{ id: string }>(
      `insert into public.rule_test_cases (organization_id, definition_id, kind, title, inputs, expected, created_by)
       values (null, $1, 'supported', 'Synthetic legacy firm case', '{}'::jsonb, 'applies', $2) returning id`,
      [rule.definition_id, a.consultant],
    ))[0].id;
    const platform = (await rows<{ id: string }>(
      `insert into public.rule_test_cases (organization_id, definition_id, kind, title, inputs, expected, created_by)
       values (null, $1, 'supported', 'Synthetic platform case', '{}'::jsonb, 'applies', null) returning id`,
      [rule.definition_id],
    ))[0].id;

    await asUser(db, { userId: b.consultant, aal: "aal2", orgId: b.orgId, totpAgeSeconds: 0 });
    const seen = (await rows<{ id: string }>(`select id from public.rule_test_cases where definition_id = $1`, [rule.definition_id])).map((row) => row.id);
    expect(seen).toEqual([platform]);
    const ranB = (await rows<{ result: { cases: { case_id?: string; title: string }[] } }>(`select public.run_rule_tests($1) as result`, [rule.definition_id]))[0].result;
    expect(ranB.cases.map((row) => row.title)).toEqual(["Synthetic platform case"]);

    await asUser(db, { userId: a.consultant, aal: "aal2", orgId: a.orgId, totpAgeSeconds: 0 });
    const ranA = (await rows<{ result: { cases: { title: string }[] } }>(`select public.run_rule_tests($1) as result`, [rule.definition_id]))[0].result;
    expect(ranA.cases.map((row) => row.title).sort()).toEqual(["Synthetic platform case", "Synthetic supported case"]);
    expect(legacy).toBeTruthy();

    await expectDbError(() => save(a, rule.definition_id, JSON.stringify({ note: "x".repeat(5000) })), /too long/);
  });

  it("the pack gate counts only the pack firm's cases and trusted platform cases", async () => {
    const rule = await platformRule();
    const a = await firm();
    const b = await firm();
    await asMaintenance(db);
    // Make the loaded version executable, and list a null-firm case firm A wrote, as before this change.
    const legacy = (await rows<{ id: string }>(
      `insert into public.rule_test_cases (organization_id, definition_id, kind, title, inputs, expected, created_by)
       values (null, $1, 'supported', 'Synthetic legacy firm case', '{}'::jsonb, 'applies', $2) returning id`,
      [rule.definition_id, a.consultant],
    ))[0].id;
    await db.exec(`alter table public.rule_versions disable trigger rule_versions_guard`);
    try {
      await db.query(
        `update public.rule_versions set structured_condition = '{"fact": "ready", "equals": true}'::jsonb, test_case_ids = array[$2::text] where id = $1`,
        [rule.version_id, legacy],
      );
    } finally {
      await db.exec(`alter table public.rule_versions enable trigger rule_versions_guard`);
    }
    await save(a, rule.definition_id);

    await asMaintenance(db);
    const pack = (await rows<{ id: string }>(
      `insert into public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version, next_review_at)
       values ($1, 'CA', 'synthetic_program', 1, '2027-01-01T00:00:00Z') returning id`,
      [b.orgId],
    ))[0].id;
    await db.query(`insert into public.rule_pack_items (pack_id, rule_version_id) values ($1, $2)`, [pack, rule.version_id]);
    await expectDbError(() => db.query(`update public.rule_pack_versions set status = 'published' where id = $1`, [pack]), /no test cases/);

    await save(b, rule.definition_id);
    await asMaintenance(db);
    await db.query(`update public.rule_pack_versions set status = 'published' where id = $1`, [pack]);
    const status = (await rows<{ status: string }>(`select status::text from public.rule_pack_versions where id = $1`, [pack]))[0].status;
    expect(status).toBe("published");
  });

  it("the rule version blocker counts only the version firm's cases of that rule", async () => {
    const a = await firm();
    const b = await firm();
    const other = await platformRule();
    await asMaintenance(db);
    const definition = (await rows<{ id: string }>(
      `insert into public.rule_definitions (organization_id, stable_key, category, jurisdiction)
       values ($1, $2, 'immigration_requirement', 'CA') returning id`,
      [a.orgId, `CA.SYNTH.F${tag().toUpperCase()}`],
    ))[0].id;
    const version = (await rows<{ id: string }>(
      `insert into public.rule_versions (organization_id, definition_id, version_number, claim, structured_condition, effective_from, next_review_at)
       values ($1, $2, 1, 'Synthetic claim.', '{"fact": "ready", "equals": true}'::jsonb, '2020-01-01T00:00:00Z', '2027-11-01T00:00:00Z') returning id`,
      [a.orgId, definition],
    ))[0].id;
    // Listed but not counted: another firm's case, an untrusted null-firm case, A's case of another
    // rule, and an id that is no case.
    const foreign = (await rows<{ id: string }>(
      `insert into public.rule_test_cases (organization_id, definition_id, kind, title, inputs, expected, created_by)
       values ($1, $2, 'supported', 'Synthetic other firm case', '{}'::jsonb, 'applies', $3) returning id`,
      [b.orgId, definition, b.consultant],
    ))[0].id;
    const untrusted = (await rows<{ id: string }>(
      `insert into public.rule_test_cases (organization_id, definition_id, kind, title, inputs, expected, created_by)
       values (null, $1, 'supported', 'Synthetic untrusted case', '{}'::jsonb, 'applies', $2) returning id`,
      [definition, b.consultant],
    ))[0].id;
    const elsewhere = await save(a, other.definition_id);
    await asMaintenance(db);
    await db.query(`update public.rule_versions set test_case_ids = array[$2::text, $3::text, $4::text, 'not-a-case'] where id = $1`, [
      version, foreign, untrusted, elsewhere,
    ]);
    const blockers = async () =>
      (await rows<{ b: string[] }>(`select app.rule_publication_blockers($1, 1) as b`, [version]))[0].b;
    expect(await blockers()).toContain("missing_test_cases");

    // A's own case of this rule counts.
    const own = await save(a, definition, '{"ready": true}', 5);
    await asMaintenance(db);
    const listed = (await rows<{ ids: string[] }>(`select test_case_ids as ids from public.rule_versions where id = $1`, [version]))[0];
    expect(listed.ids).toContain(own);
    expect(await blockers()).not.toContain("missing_test_cases");

    // The helper answers only for a named case.
    const grants = (await rows<{ old: boolean; current: boolean }>(
      `select to_regprocedure('app.rule_test_case_trusted(uuid,uuid,uuid)') is not null as old,
              has_function_privilege('authenticated', 'app.rule_test_case_trusted(uuid,uuid)', 'execute') as current`,
    ))[0];
    expect(grants).toEqual({ old: false, current: true });
    await asUser(db, { userId: b.consultant, aal: "aal2", orgId: b.orgId, totpAgeSeconds: 0 });
    // For firm B: its own case counts, firm A's does not, and a non-case id (a user id) is false.
    const answers = (await rows<{ b_case: boolean; a_case: boolean; not_a_case: boolean }>(
      `select app.rule_test_case_trusted($1, $2) as b_case, app.rule_test_case_trusted($1, $3) as a_case, app.rule_test_case_trusted($1, $4) as not_a_case`,
      [b.orgId, foreign, own, b.consultant],
    ))[0];
    expect(answers).toEqual({ b_case: true, a_case: false, not_a_case: false });
  });
});
