import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asMaintenance,
  asServiceRole,
  asUser,
  countOf,
  createTestDb,
  expectDbError,
  type TestDb,
} from "./helpers/postgres";

let db: TestDb;

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function token() {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, now(), '{}'::jsonb)`,
    [id, address],
  );
  return id;
}

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(
    `select (public.create_organization($1, $2, $3)).id as id`,
    ["Synthetic Legal Name", "Synthetic Firm", slug()],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new Error("organization was not created");
  return id;
}

async function activeMembership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4)
     returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

async function insertGlobalSource(url: string) {
  await asServiceRole(db);
  const inserted = await db.query<{
    id: string;
    organization_id: string | null;
    allowed_host: string;
    review_status: string;
    change_state: string;
    last_checked_at: string | null;
  }>(
    `insert into public.official_sources (
       publisher, canonical_url, jurisdiction, content_kind, title
     ) values (
       'Immigration, Refugees and Citizenship Canada',
       $1,
       'CA',
       'program_guidance',
       'Fictional catalog page'
     )
     returning id, organization_id, allowed_host, review_status, change_state, last_checked_at`,
    [url],
  );
  return inserted.rows[0];
}

describe("official source allowlist", () => {
  it("allows cic.gc.ca and canada.ca IRCC hosts and rejects lookalikes", async () => {
    await asServiceRole(db);
    const hosts = await db.query<{
      cic: boolean;
      www_cic: boolean;
      services_cic: boolean;
      canada: boolean;
      ircc: boolean;
      lookalike: boolean;
      canada_lookalike: boolean;
      not_canada: boolean;
    }>(
      `select
         app.host_is_allowlisted('cic.gc.ca') as cic,
         app.host_is_allowlisted('www.cic.gc.ca') as www_cic,
         app.host_is_allowlisted('services.cic.gc.ca') as services_cic,
         app.host_is_allowlisted('www.canada.ca') as canada,
         app.host_is_allowlisted('ircc.canada.ca') as ircc,
         app.host_is_allowlisted('cic.gc.ca.evil.com') as lookalike,
         app.host_is_allowlisted('www.canada.ca.evil.com') as canada_lookalike,
         app.host_is_allowlisted('notcanada.ca') as not_canada`,
    );
    expect(hosts.rows[0]).toEqual({
      cic: true,
      www_cic: true,
      services_cic: true,
      canada: true,
      ircc: true,
      lookalike: false,
      canada_lookalike: false,
      not_canada: false,
    });

    const suffix = token();
    const cic = await insertGlobalSource(`https://cic.gc.ca/fictional-casevoya-${suffix}`);
    const wwwCic = await insertGlobalSource(`https://www.cic.gc.ca/fictional-casevoya-${suffix}`);
    const canada = await insertGlobalSource(
      `https://www.canada.ca/en/immigration-refugees-citizenship/fictional-casevoya-${suffix}`,
    );
    const ircc = await insertGlobalSource(`https://ircc.canada.ca/fictional-casevoya-${suffix}`);

    for (const row of [cic, wwwCic, canada, ircc]) {
      expect(row.organization_id).toBeNull();
      expect(row.review_status).toBe("unverified");
      expect(row.change_state).toBe("unknown");
      expect(row.last_checked_at).toBeNull();
    }
    expect(cic.allowed_host).toBe("cic.gc.ca");
    expect(wwwCic.allowed_host).toBe("www.cic.gc.ca");
    expect(canada.allowed_host).toBe("www.canada.ca");
    expect(ircc.allowed_host).toBe("ircc.canada.ca");

    await expectDbError(
      () => insertGlobalSource(`https://cic.gc.ca.evil.com/fictional-${suffix}`),
      /allowlist/,
    );
    await expectDbError(
      () => insertGlobalSource(`https://www.canada.ca.evil.com/fictional-${suffix}`),
      /allowlist/,
    );
    await expectDbError(
      () => insertGlobalSource(`http://www.canada.ca/fictional-${suffix}`),
      /allowlist/,
    );
    await expectDbError(
      () => insertGlobalSource(`https://example.com/fictional-${suffix}`),
      /allowlist/,
    );
  });

  it("ignores a caller-supplied last_checked_at and rejects a future retrieval", async () => {
    const suffix = token();
    await asServiceRole(db);
    const inserted = await db.query<{ last_checked_at: string | null }>(
      `insert into public.official_sources (
         publisher, canonical_url, jurisdiction, content_kind, last_checked_at
       ) values (
         'Immigration, Refugees and Citizenship Canada',
         $1, 'CA', 'program_guidance', now()
       )
       returning last_checked_at`,
      [`https://cic.gc.ca/fictional-freshness-${suffix}`],
    );
    expect(inserted.rows[0].last_checked_at).toBeNull();

    const source = await insertGlobalSource(`https://www.cic.gc.ca/fictional-future-${suffix}`);
    await asServiceRole(db);
    await expectDbError(
      () =>
        db.query(
          `insert into public.source_snapshots (
             source_id, final_url, publisher, retrieved_at, content_hash, retrieval_result
           ) values ($1, $2, 'Immigration, Refugees and Citizenship Canada',
             '2099-01-01T00:00:00Z', $3, 'success')`,
          [source.id, `https://www.cic.gc.ca/fictional-future-${suffix}`, HASH_A],
        ),
      /future/,
    );
  });

  it("allows verified provincial nominee hosts and rejects lookalikes", async () => {
    await asServiceRole(db);
    const hosts = await db.query<{
      welcome_bc: boolean;
      manitoba: boolean;
      welcome_nb: boolean;
      ns_legacy: boolean;
      ns_live: boolean;
      pei: boolean;
      nwt: boolean;
      college: boolean;
      bc_lookalike: boolean;
      mb_lookalike: boolean;
      nb_lookalike: boolean;
      ns_lookalike: boolean;
      live_lookalike: boolean;
      pei_lookalike: boolean;
      nwt_lookalike: boolean;
      college_lookalike: boolean;
      not_bc: boolean;
    }>(
      `select
         app.host_is_allowlisted('www.welcomebc.ca') as welcome_bc,
         app.host_is_allowlisted('immigratemanitoba.com') as manitoba,
         app.host_is_allowlisted('www.welcomenb.ca') as welcome_nb,
         app.host_is_allowlisted('novascotiaimmigration.com') as ns_legacy,
         app.host_is_allowlisted('www.liveinnovascotia.com') as ns_live,
         app.host_is_allowlisted('www.princeedwardisland.ca') as pei,
         app.host_is_allowlisted('www.immigratenwt.ca') as nwt,
         app.host_is_allowlisted('www.college-ic.ca') as college,
         app.host_is_allowlisted('welcomebc.ca.evil.com') as bc_lookalike,
         app.host_is_allowlisted('immigratemanitoba.com.evil.com') as mb_lookalike,
         app.host_is_allowlisted('welcomenb.ca.evil.com') as nb_lookalike,
         app.host_is_allowlisted('novascotiaimmigration.com.evil.com') as ns_lookalike,
         app.host_is_allowlisted('liveinnovascotia.com.evil.com') as live_lookalike,
         app.host_is_allowlisted('princeedwardisland.ca.evil.com') as pei_lookalike,
         app.host_is_allowlisted('immigratenwt.ca.evil.com') as nwt_lookalike,
         app.host_is_allowlisted('college-ic.ca.evil.com') as college_lookalike,
         app.host_is_allowlisted('notwelcomebc.ca') as not_bc`,
    );
    expect(hosts.rows[0]).toEqual({
      welcome_bc: true,
      manitoba: true,
      welcome_nb: true,
      ns_legacy: true,
      ns_live: true,
      pei: true,
      nwt: true,
      college: true,
      bc_lookalike: false,
      mb_lookalike: false,
      nb_lookalike: false,
      ns_lookalike: false,
      live_lookalike: false,
      pei_lookalike: false,
      nwt_lookalike: false,
      college_lookalike: false,
      not_bc: false,
    });

    const suffix = token();
    const bc = await insertGlobalSource(`https://www.welcomebc.ca/fictional-casevoya-${suffix}`);
    expect(bc.allowed_host).toBe("www.welcomebc.ca");
    await expectDbError(
      () => insertGlobalSource(`https://welcomebc.ca.evil.com/fictional-${suffix}`),
      /allowlist/,
    );
    await expectDbError(
      () => insertGlobalSource(`https://immigratemanitoba.com.evil.com/fictional-${suffix}`),
      /allowlist/,
    );
  });
});

describe("source governance access and versions", () => {
  it("keeps the global catalog service-role only and firm rows inside the firm", async () => {
    const suffix = token();
    const ownerA = await createUser(email("owner-a"));
    const ownerB = await createUser(email("owner-b"));
    const portalUser = await createUser(email("portal"));
    const orgA = await createOrg(ownerA);
    const orgB = await createOrg(ownerB);
    await activeMembership(orgA, portalUser, "client", ownerA);

    const global = await insertGlobalSource(`https://cic.gc.ca/fictional-global-${suffix}`);

    await asUser(db, { userId: ownerA, aal: "aal2", orgId: orgA, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(
          `insert into public.official_sources (
             organization_id, publisher, canonical_url, jurisdiction, content_kind
           ) values (null, 'Immigration, Refugees and Citizenship Canada', $1, 'CA', 'program_guidance')`,
          [`https://www.cic.gc.ca/fictional-null-org-${suffix}`],
        ),
      /row-level security/,
    );
    await expectDbError(
      () =>
        db.query(
          `insert into public.official_source_domains (host, match_kind, authority, jurisdiction_code)
           values ('example.test', 'exact', 'Not an authority', 'CA')`,
        ),
      /row-level security/,
    );

    const renamed = await db.query(
      `update public.official_sources set title = 'tenant rewrite' where id = $1`,
      [global.id],
    );
    expect(renamed.affectedRows ?? 0).toBe(0);
    await asMaintenance(db);
    const unchanged = await db.query<{ title: string }>(
      `select title from public.official_sources where id = $1`,
      [global.id],
    );
    expect(unchanged.rows[0].title).toBe("Fictional catalog page");

    await asUser(db, { userId: ownerA, aal: "aal2", orgId: orgA, totpAgeSeconds: 0 });
    const firm = await db.query<{ id: string; allowed_host: string }>(
      `insert into public.official_sources (
         organization_id, publisher, canonical_url, jurisdiction, content_kind
       ) values ($1, 'Immigration, Refugees and Citizenship Canada', $2, 'CA', 'program_guidance')
       returning id, allowed_host`,
      [orgA, `https://www.cic.gc.ca/fictional-firm-${suffix}`],
    );
    expect(firm.rows[0].allowed_host).toBe("www.cic.gc.ca");

    await asUser(db, { userId: ownerB, aal: "aal2", orgId: orgB, totpAgeSeconds: 0 });
    const hiddenFromB = await db.query<{ id: string }>(
      `select id from public.official_sources where id = $1`,
      [firm.rows[0].id],
    );
    expect(hiddenFromB.rows).toHaveLength(0);

    await asUser(db, { userId: portalUser, aal: "aal1", orgId: orgA });
    const portalFirm = await db.query<{ id: string }>(
      `select id from public.official_sources where id = $1`,
      [firm.rows[0].id],
    );
    expect(portalFirm.rows).toHaveLength(0);
    const portalGlobal = await db.query<{ id: string }>(
      `select id from public.official_sources where id = $1`,
      [global.id],
    );
    expect(portalGlobal.rows).toHaveLength(1);
    const portalRules = await db.query<{ n: number }>(
      `select count(*)::int as n from public.rule_versions`,
    );
    expect(countOf(portalRules.rows[0].n)).toBe(0);
  });

  it("pins a pack version, detects a hash change, and leaves the pin in place", async () => {
    const suffix = token();
    const stableKey = `CA.FICTIONAL.M${suffix.toUpperCase()}`;
    const programKey = `fictional_${suffix}`;
    const page = `https://www.cic.gc.ca/fictional-version-${suffix}`;
    const owner = await createUser(email("owner"));
    const consultant = await createUser(email("consultant"));
    const other = await createUser(email("other"));
    const orgId = await createOrg(owner);
    const otherOrg = await createOrg(other);
    const consultantMembership = await activeMembership(
      orgId,
      consultant,
      "licensed_consultant",
      owner,
    );

    await asMaintenance(db);
    const ownerRow = await db.query<{ id: string }>(
      `select id from public.memberships
       where organization_id = $1 and user_id = $2 and role = 'firm_owner'`,
      [orgId, owner],
    );
    const ownerMembership = ownerRow.rows[0].id;
    const staff = { userId: owner, aal: "aal2" as const, orgId, totpAgeSeconds: 0 };
    await asUser(db, staff);
    const source = await db.query<{ id: string }>(
      `insert into public.official_sources (
         organization_id, publisher, canonical_url, jurisdiction, content_kind
       ) values ($1, 'Immigration, Refugees and Citizenship Canada', $2, 'CA', 'program_guidance')
       returning id`,
      [orgId, page],
    );
    const sourceId = source.rows[0].id;

    const first = await db.query<{
      id: string;
      snapshot_number: number;
      published_at: string | null;
      published_on: string | null;
      current_to: string | null;
    }>(
      `insert into public.source_snapshots (
         source_id, final_url, publisher, retrieved_at, content_hash, retrieval_result
       ) values ($1, $2, 'Immigration, Refugees and Citizenship Canada',
         '2026-10-01T12:00:00Z', $3, 'success')
       returning id, snapshot_number, published_at, published_on, current_to`,
      [sourceId, page, HASH_A],
    );
    expect(first.rows[0].snapshot_number).toBe(1);
    expect(first.rows[0].published_at).toBeNull();
    expect(first.rows[0].published_on).toBeNull();
    expect(first.rows[0].current_to).toBeNull();
    const snapshotId = first.rows[0].id;

    const definition = await db.query<{ id: string }>(
      `insert into public.rule_definitions (
         organization_id, stable_key, category, jurisdiction
       ) values ($1, $2, 'immigration_requirement', 'CA')
       returning id`,
      [orgId, stableKey],
    );
    const version = await db.query<{ id: string }>(
      `insert into public.rule_versions (
         definition_id, version_number, claim, effective_from, next_review_at, test_case_ids
       ) values (
         $1, 1, 'FICTIONAL fixture. Not an immigration requirement.',
         '2020-01-01T00:00:00Z', '2026-11-01T00:00:00Z', array['fictional-case']
       )
       returning id`,
      [definition.rows[0].id],
    );
    const versionId = version.rows[0].id;

    const incomplete = await db.query<{ id: string }>(
      `insert into public.rule_versions (definition_id, version_number)
       values ($1, 2) returning id`,
      [definition.rows[0].id],
    );
    await expectDbError(
      () =>
        db.query(`update public.rule_versions set status = 'published' where id = $1`, [
          incomplete.rows[0].id,
        ]),
      /publication blocked:.*missing_claim/,
    );

    await db.query(
      `insert into public.rule_evidence (rule_version_id, snapshot_id, source_section)
       values ($1, $2, 'fictional-section')`,
      [versionId, snapshotId],
    );

    await expectDbError(
      () =>
        db.query(
          `insert into public.professional_reviews (
             organization_id, rule_version_id, reviewer_membership_id, decision,
             decided_at, rule_content_revision
           ) values ($1, $2, $3, 'approved', '2026-10-16T15:00:00Z', 1)`,
          [orgId, versionId, ownerMembership],
        ),
      /licensed_consultant/,
    );

    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(
      `insert into public.professional_reviews (
         organization_id, rule_version_id, reviewer_membership_id, decision,
         decided_at, rationale, rule_content_revision
       ) values ($1, $2, $3, 'approved', '2026-10-16T15:00:00Z',
         'FICTIONAL metadata review. Not a licence approval.', 1)`,
      [orgId, versionId, consultantMembership],
    );
    const published = await db.query<{ status: string; content_frozen: boolean }>(
      `update public.rule_versions set status = 'published' where id = $1
       returning status, content_frozen`,
      [versionId],
    );
    expect(published.rows[0]).toEqual({ status: "published", content_frozen: true });

    const pack = await db.query<{ id: string }>(
      `insert into public.rule_pack_versions (
         organization_id, jurisdiction, program_key, pack_version, next_review_at
       ) values ($1, 'CA', $2, 1, '2026-11-01T00:00:00Z')
       returning id`,
      [orgId, programKey],
    );
    const packId = pack.rows[0].id;
    await db.query(
      `insert into public.rule_pack_items (pack_id, rule_version_id) values ($1, $2)`,
      [packId, versionId],
    );
    await db.query(`update public.rule_pack_versions set status = 'published' where id = $1`, [
      packId,
    ]);

    await asUser(db, staff);
    const matterId = randomUUID();
    await db.query(
      `insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Fictional matter', true)`,
      [matterId, orgId],
    );
    const binding = await db.query<{ id: string; recheck_required: boolean }>(
      `insert into public.matter_rule_bindings (organization_id, matter_id, rule_pack_version_id)
       values ($1, $2, $3)
       returning id, recheck_required`,
      [orgId, matterId, packId],
    );
    expect(binding.rows[0].recheck_required).toBe(false);

    const second = await db.query<{ id: string }>(
      `insert into public.source_snapshots (
         source_id, final_url, publisher, retrieved_at, content_hash, retrieval_result
       ) values ($1, $2, 'Immigration, Refugees and Citizenship Canada',
         '2026-10-02T12:00:00Z', $3, 'changed')
       returning id`,
      [sourceId, page, HASH_B],
    );

    const afterChange = await db.query<{
      first_hash: string;
      change_state: string;
      checked_moved: boolean;
      pinned_pack: string;
      recheck_required: boolean;
    }>(
      `select
         (select content_hash from public.source_snapshots where id = $2) as first_hash,
         s.change_state,
         s.last_checked_at = '2026-10-02T12:00:00Z'::timestamptz as checked_moved,
         b.rule_pack_version_id as pinned_pack,
         b.recheck_required
       from public.official_sources s
       join public.matter_rule_bindings b on b.id = $3
       where s.id = $1`,
      [sourceId, snapshotId, binding.rows[0].id],
    );
    expect(afterChange.rows[0]).toEqual({
      first_hash: HASH_A,
      change_state: "change_detected",
      checked_moved: true,
      pinned_pack: packId,
      recheck_required: true,
    });

    const impacts = await db.query<{ n: number }>(
      `select count(*)::int as n from public.rule_impacts
       where matter_id = $1 and snapshot_id = $2 and reason = 'source_content_hash_changed'`,
      [matterId, second.rows[0].id],
    );
    expect(countOf(impacts.rows[0].n)).toBe(1);

    await asUser(db, { userId: other, aal: "aal2", orgId: otherOrg, totpAgeSeconds: 0 });
    const foreignImpacts = await db.query<{ n: number }>(
      `select count(*)::int as n from public.rule_impacts where matter_id = $1`,
      [matterId],
    );
    expect(countOf(foreignImpacts.rows[0].n)).toBe(0);

    await asUser(db, staff);
    await db.query(
      `insert into public.source_check_attempts (source_id, attempted_at, result, error_code)
       values ($1, '2026-10-03T12:00:00Z', 'failed', 'timeout')`,
      [sourceId],
    );
    const afterFailure = await db.query<{ change_state: string; still_checked: boolean }>(
      `select change_state,
              last_checked_at = '2026-10-02T12:00:00Z'::timestamptz as still_checked
       from public.official_sources where id = $1`,
      [sourceId],
    );
    expect(afterFailure.rows[0]).toEqual({
      change_state: "change_detected",
      still_checked: true,
    });

    await db.query(
      `insert into public.source_snapshots (
         source_id, final_url, publisher, retrieved_at, content_hash, retrieval_result
       ) values ($1, $2, 'Immigration, Refugees and Citizenship Canada',
         '2026-10-04T12:00:00Z', $3, 'unchanged')`,
      [sourceId, page, HASH_B],
    );
    const afterSameHash = await db.query<{ change_state: string; checked_forward: boolean }>(
      `select change_state,
              last_checked_at = '2026-10-04T12:00:00Z'::timestamptz as checked_forward
       from public.official_sources where id = $1`,
      [sourceId],
    );
    expect(afterSameHash.rows[0]).toEqual({
      change_state: "change_detected",
      checked_forward: true,
    });

    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const packTwo = await db.query<{ id: string }>(
      `insert into public.rule_pack_versions (
         organization_id, jurisdiction, program_key, pack_version, next_review_at
       ) values ($1, 'CA', $2, 2, '2026-12-01T00:00:00Z')
       returning id`,
      [orgId, programKey],
    );
    await db.query(
      `insert into public.rule_pack_items (pack_id, rule_version_id) values ($1, $2)`,
      [packTwo.rows[0].id, versionId],
    );
    await db.query(`update public.rule_pack_versions set status = 'published' where id = $1`, [
      packTwo.rows[0].id,
    ]);
    const pin = await db.query<{ rule_pack_version_id: string }>(
      `select rule_pack_version_id from public.matter_rule_bindings where id = $1`,
      [binding.rows[0].id],
    );
    expect(pin.rows[0].rule_pack_version_id).toBe(packId);

    await expectDbError(
      () =>
        db.query(`update public.rule_versions set claim = 'rewritten fictional claim' where id = $1`, [
          versionId,
        ]),
      /immutable/,
    );
    await expectDbError(
      () =>
        db.query(`update public.source_snapshots set content_hash = $2 where id = $1`, [
          snapshotId,
          HASH_C,
        ]),
      /provenance is immutable/,
    );
    await expectDbError(
      () =>
        db.query(
          `update public.matter_rule_bindings set recheck_required = false where id = $1`,
          [binding.rows[0].id],
        ),
      /recheck/,
    );
    await expectDbError(
      () =>
        db.query(
          `update public.official_sources set change_state = 'unchanged' where id = $1`,
          [sourceId],
        ),
      /freshness/,
    );
  });
});

describe("platform admins", () => {
  it("lets an aal2 platform admin write the global catalog and not another firm's rows", async () => {
    const suffix = token();
    const admin = await createUser(email("platform-admin"));
    const owner = await createUser(email("firm-owner"));
    const staff = await createUser(email("firm-staff"));
    const orgId = await createOrg(owner);
    await activeMembership(orgId, staff, "case_manager", owner);
    await asMaintenance(db);
    await db.query(`insert into public.platform_admins (user_id) values ($1)`, [admin]);

    await asUser(db, { userId: admin, aal: "aal1" });
    await expectDbError(
      () =>
        db.query(
          `insert into public.official_sources (
             publisher, canonical_url, jurisdiction, content_kind
           ) values ('Government of British Columbia', $1, 'CA-BC', 'program_guidance')`,
          [`https://www.welcomebc.ca/fictional-aal1-${suffix}`],
        ),
      /row-level security/,
    );

    await asUser(db, { userId: staff, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(
          `insert into public.official_sources (
             publisher, canonical_url, jurisdiction, content_kind
           ) values ('Government of British Columbia', $1, 'CA-BC', 'program_guidance')`,
          [`https://www.welcomebc.ca/fictional-staff-global-${suffix}`],
        ),
      /row-level security/,
    );

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const matterId = randomUUID();
    await db.query(
      `insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Firm matter', true)`,
      [matterId, orgId],
    );
    await db.query(
      `insert into public.official_sources (
         organization_id, publisher, canonical_url, jurisdiction, content_kind
       ) values ($1, 'Government of British Columbia', $2, 'CA-BC', 'program_guidance')`,
      [orgId, `https://www.welcomebc.ca/fictional-firm-hidden-${suffix}`],
    );

    await asUser(db, { userId: admin, aal: "aal2", totpAgeSeconds: 0 });
    const domain = await db.query<{ host: string }>(
      `insert into public.official_source_domains (host, match_kind, authority, jurisdiction_code, notes)
       values ($1, 'exact', 'Platform fixture', 'CA', 'Test row. Not a program.')
       returning host`,
      [`platform-fixture-${suffix}.gc.ca`],
    );
    expect(domain.rows[0].host).toBe(`platform-fixture-${suffix}.gc.ca`);

    const source = await db.query<{ id: string; organization_id: string | null; allowed_host: string }>(
      `insert into public.official_sources (
         publisher, canonical_url, jurisdiction, content_kind, title
       ) values ('Government of British Columbia', $1, 'CA-BC', 'program_guidance', 'Fictional global page')
       returning id, organization_id, allowed_host`,
      [`https://welcomebc.ca/fictional-platform-${suffix}`],
    );
    expect(source.rows[0].organization_id).toBeNull();
    expect(source.rows[0].allowed_host).toBe("welcomebc.ca");
    const renamed = await db.query<{ title: string }>(
      `update public.official_sources set title = 'Fictional global page revised' where id = $1
       returning title`,
      [source.rows[0].id],
    );
    expect(renamed.rows[0].title).toBe("Fictional global page revised");

    const definition = await db.query<{ id: string; organization_id: string | null }>(
      `insert into public.rule_definitions (stable_key, category, jurisdiction)
       values ($1, 'product_control', 'CA')
       returning id, organization_id`,
      [`CA.FICTIONAL.P${suffix.toUpperCase()}`],
    );
    expect(definition.rows[0].organization_id).toBeNull();
    const version = await db.query<{ id: string; organization_id: string | null }>(
      `insert into public.rule_versions (definition_id, version_number, claim)
       values ($1, 1, 'FICTIONAL platform draft. Not an immigration requirement.')
       returning id, organization_id`,
      [definition.rows[0].id],
    );
    expect(version.rows[0].organization_id).toBeNull();
    const pack = await db.query<{ id: string; organization_id: string | null }>(
      `insert into public.rule_pack_versions (jurisdiction, program_key, pack_version)
       values ('CA', $1, 1)
       returning id, organization_id`,
      [`fictional_${suffix}`],
    );
    expect(pack.rows[0].organization_id).toBeNull();
    await db.query(
      `insert into public.rule_pack_items (pack_id, rule_version_id) values ($1, $2)`,
      [pack.rows[0].id, version.rows[0].id],
    );

    const hiddenSources = await db.query<{ n: number }>(
      `select count(*)::int as n from public.official_sources where organization_id = $1`,
      [orgId],
    );
    expect(countOf(hiddenSources.rows[0].n)).toBe(0);
    const hiddenMatters = await db.query<{ n: number }>(
      `select count(*)::int as n from public.matters where organization_id = $1`,
      [orgId],
    );
    expect(countOf(hiddenMatters.rows[0].n)).toBe(0);
    const hiddenRules = await db.query<{ n: number }>(
      `select count(*)::int as n from public.rule_versions where organization_id = $1`,
      [orgId],
    );
    expect(countOf(hiddenRules.rows[0].n)).toBe(0);
  });
});
