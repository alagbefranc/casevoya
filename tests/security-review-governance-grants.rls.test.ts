/**
 * 20261030235000 (part A): source governance tables are no longer written directly by firm staff.
 * Firm rows (rule versions, packs, sources, snapshots, evidence, reviews, impacts) change only
 * through the definer functions; a matter's pack pin is set at creation (first pin of the matter
 * being created, to its validated pack) or moved by app.select_matter_program. The platform
 * global-catalogue path and service-role captures are unchanged. Every rule, page and pack here is
 * a FICTIONAL fixture. Synthetic users only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

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

function token() {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${token()}@example.test`,
  ]);
  return id;
}

async function membership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return row.rows[0].id;
}

type Who = "owner" | "consultant" | "manager";

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${token()}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant", owner);
  await membership(orgId, manager, "case_manager", owner);
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${token().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  const ownerRow = await db.query<{ id: string }>(
    `select id from public.memberships where organization_id = $1 and user_id = $2 and role = 'firm_owner'`,
    [orgId, owner],
  );
  return { owner, consultant, manager, orgId, ownerMembership: ownerRow.rows[0].id, consultantMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const as = (ctx: Firm, who: Who) => asUser(db, { userId: ctx[who], aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });

/** A published firm rule version (sourced, approved) in a published pack, seeded from a maintenance session. */
async function publishedPack(ctx: Firm) {
  await asMaintenance(db);
  const url = `https://www.canada.ca/en/fictional-governance-${token()}.html`;
  const source = await db.query<{ id: string }>(
    `insert into public.official_sources (organization_id, publisher, canonical_url, jurisdiction, content_kind)
     values ($1, 'Immigration, Refugees and Citizenship Canada', $2, 'CA', 'form_instruction') returning id`,
    [ctx.orgId, url],
  );
  const snapshot = await db.query<{ id: string }>(
    `insert into public.source_snapshots (source_id, final_url, publisher, retrieved_at, modified_on, content_hash, retrieval_result)
     values ($1, $2, 'Immigration, Refugees and Citizenship Canada', '2026-10-20T12:00:00Z', '2025-01-15', $3, 'success') returning id`,
    [source.rows[0].id, url, "d".repeat(64)],
  );
  const definition = await db.query<{ id: string }>(
    `insert into public.rule_definitions (organization_id, stable_key, category, jurisdiction)
     values ($1, $2, 'immigration_requirement', 'CA') returning id`,
    [ctx.orgId, `CA.FICTIONAL.G${token().toUpperCase().replace(/[^A-Z0-9]/g, "X")}`],
  );
  const version = await db.query<{ id: string }>(
    `insert into public.rule_versions (definition_id, version_number, claim, output_value, effective_from, next_review_at, test_case_ids)
     values ($1, 1, 'FICTIONAL fixture. Not an immigration requirement.', jsonb_build_object('kind', 'checklist_item'),
       '2020-01-01T00:00:00Z', '2027-11-01T00:00:00Z', array['fictional-case']) returning id`,
    [definition.rows[0].id],
  );
  const versionId = version.rows[0].id;
  await db.query(`insert into public.rule_evidence (rule_version_id, snapshot_id, source_section) values ($1, $2, 'fictional-section')`, [
    versionId,
    snapshot.rows[0].id,
  ]);
  await db.query(
    `insert into public.professional_reviews (organization_id, rule_version_id, reviewer_membership_id, decision, decided_at, rule_content_revision)
     values ($1, $2, $3, 'approved', '2026-10-16T15:00:00Z', 1)`,
    [ctx.orgId, versionId, ctx.ownerMembership],
  );
  await db.query(`update public.rule_versions set status = 'published' where id = $1`, [versionId]);
  const pack = await db.query<{ id: string }>(
    `insert into public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version, next_review_at, form_mappings)
     values ($1, 'CA', $2, 1, '2027-11-01T00:00:00Z', '[]'::jsonb) returning id`,
    [ctx.orgId, `fictional_${token()}`],
  );
  const packId = pack.rows[0].id;
  await db.query(`insert into public.rule_pack_items (pack_id, rule_version_id) values ($1, $2)`, [packId, versionId]);
  await db.query(`update public.rule_pack_versions set status = 'published' where id = $1`, [packId]);
  return { packId, versionId, sourceId: source.rows[0].id, snapshotId: snapshot.rows[0].id, definitionId: definition.rows[0].id };
}

async function newMatter(ctx: Firm, who: Who, packId: string | null) {
  await as(ctx, who);
  const made = await db.query<{ result: { ok: boolean; id: string } }>(
    `select public.create_engaged_matter($1, true, $2, $3, null) as result`,
    ["Synthetic matter", ctx.consultantMembership, packId],
  );
  expect(made.rows[0].result.ok).toBe(true);
  return made.rows[0].result.id;
}

async function bindings(matterId: string) {
  await asMaintenance(db);
  const rows = await db.query<{ rule_pack_version_id: string; superseded: boolean }>(
    `select rule_pack_version_id, superseded_at is not null as superseded from public.matter_rule_bindings
     where matter_id = $1 order by created_at, superseded_at nulls last`,
    [matterId],
  );
  return rows.rows;
}

describe("governance tables: firm rows only through the definer functions", () => {
  it("refuses staff direct status moves on a published rule version and pack; suspend_rule_version still works", async () => {
    const ctx = await firm();
    const fixture = await publishedPack(ctx);

    for (const who of ["manager", "consultant", "owner"] as const) {
      await as(ctx, who);
      const moved = await db.query(`update public.rule_versions set status = 'suspended', status_reason = 'Direct move' where id = $1`, [
        fixture.versionId,
      ]);
      expect(moved.affectedRows ?? 0).toBe(0);
      const superseded = await db.query(`update public.rule_versions set status = 'superseded' where id = $1`, [fixture.versionId]);
      expect(superseded.affectedRows ?? 0).toBe(0);
      const pack = await db.query(`update public.rule_pack_versions set status = 'suspended' where id = $1`, [fixture.packId]);
      expect(pack.affectedRows ?? 0).toBe(0);
    }
    await asMaintenance(db);
    const state = await db.query<{ rule: string; pack: string; version: number }>(
      `select v.status::text as rule, p.status::text as pack, v.version
       from public.rule_versions v, public.rule_pack_versions p where v.id = $1 and p.id = $2`,
      [fixture.versionId, fixture.packId],
    );
    expect(state.rows[0]).toMatchObject({ rule: "published", pack: "published" });

    // The reviewed path: a licensed consultant suspends through the function.
    await as(ctx, "consultant");
    await db.query(`select public.suspend_rule_version($1, $2, 'Synthetic suspension for the test')`, [fixture.versionId, state.rows[0].version]);
    await asMaintenance(db);
    const after = await db.query<{ status: string }>(`select status::text from public.rule_versions where id = $1`, [fixture.versionId]);
    expect(after.rows[0].status).toBe("suspended");
  });

  it("refuses staff direct inserts and updates of firm sources, snapshots, rules, evidence, reviews, packs and impacts", async () => {
    const ctx = await firm();
    const fixture = await publishedPack(ctx);
    const url = `https://www.canada.ca/en/fictional-direct-${token()}.html`;

    await as(ctx, "manager");
    await expectDbError(
      () =>
        db.query(
          `insert into public.official_sources (organization_id, publisher, canonical_url, jurisdiction, content_kind)
           values ($1, 'Immigration, Refugees and Citizenship Canada', $2, 'CA', 'program_guidance')`,
          [ctx.orgId, url],
        ),
      /row-level security/,
    );
    await expectDbError(
      () =>
        db.query(
          `insert into public.source_snapshots (source_id, final_url, publisher, retrieved_at, content_hash, retrieval_result)
           values ($1, $2, 'Immigration, Refugees and Citizenship Canada', now(), $3, 'success')`,
          [fixture.sourceId, url, "e".repeat(64)],
        ),
      /permission denied/,
    );
    await expectDbError(
      () =>
        db.query(`insert into public.rule_definitions (organization_id, stable_key, category, jurisdiction) values ($1, $2, 'immigration_requirement', 'CA')`, [
          ctx.orgId,
          `CA.FICTIONAL.D${token().toUpperCase().replace(/[^A-Z0-9]/g, "X")}`,
        ]),
      /row-level security/,
    );
    await expectDbError(
      () => db.query(`insert into public.rule_versions (definition_id, version_number, claim) values ($1, 2, 'Direct draft')`, [fixture.definitionId]),
      /row-level security/,
    );
    await expectDbError(
      () =>
        db.query(`insert into public.rule_evidence (rule_version_id, snapshot_id, source_section) values ($1, $2, 'direct')`, [
          fixture.versionId,
          fixture.snapshotId,
        ]),
      /permission denied/,
    );

    await as(ctx, "owner");
    await expectDbError(
      () =>
        db.query(
          `insert into public.professional_reviews (organization_id, rule_version_id, reviewer_membership_id, decision, decided_at, rule_content_revision)
           values ($1, $2, $3, 'approved', now(), 1)`,
          [ctx.orgId, fixture.versionId, ctx.ownerMembership],
        ),
      /permission denied/,
    );
    await expectDbError(
      () =>
        db.query(
          `insert into public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version, next_review_at)
           values ($1, 'CA', $2, 1, '2027-11-01T00:00:00Z')`,
          [ctx.orgId, `fictional_${token()}`],
        ),
      /row-level security/,
    );
    await asMaintenance(db);
    const draft = await db.query<{ id: string }>(
      `insert into public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version, next_review_at)
       values ($1, 'CA', $2, 1, '2027-11-01T00:00:00Z') returning id`,
      [ctx.orgId, `fictional_${token()}`],
    );
    await as(ctx, "owner");
    await expectDbError(
      () => db.query(`insert into public.rule_pack_items (pack_id, rule_version_id) values ($1, $2)`, [draft.rows[0].id, fixture.versionId]),
      /row-level security/,
    );
    await expectDbError(
      () => db.query(`update public.rule_impacts set disposition = disposition where organization_id = $1`, [ctx.orgId]),
      /permission denied/,
    );
    await expectDbError(
      () => db.query(`update public.source_snapshots set review_status = review_status where id = $1`, [fixture.snapshotId]),
      /permission denied/,
    );
    const renamed = await db.query(`update public.official_sources set title = 'Direct rename' where id = $1`, [fixture.sourceId]);
    expect(renamed.affectedRows ?? 0).toBe(0);
  });

  it("pins a pack only at matter creation; a direct re-pin or new pin is refused and select_matter_program still moves it", async () => {
    const ctx = await firm();
    const first = await publishedPack(ctx);
    const second = await publishedPack(ctx);

    // Creation (case manager, as New matter does) pins the validated pack.
    const pinned = await newMatter(ctx, "manager", first.packId);
    expect(await bindings(pinned)).toEqual([{ rule_pack_version_id: first.packId, superseded: false }]);

    // A matter opened without a pack cannot be pinned directly afterwards, by anyone.
    const unpinned = await newMatter(ctx, "manager", null);
    for (const who of ["manager", "consultant", "owner"] as const) {
      await as(ctx, who);
      await expectDbError(
        () =>
          db.query(`insert into public.matter_rule_bindings (organization_id, matter_id, rule_pack_version_id) values ($1, $2, $3)`, [
            ctx.orgId,
            unpinned,
            second.packId,
          ]),
        /row-level security/,
      );
      // An existing pin cannot be superseded directly.
      await expectDbError(
        () => db.query(`update public.matter_rule_bindings set superseded_at = now() where matter_id = $1`, [pinned]),
        /permission denied/,
      );
    }
    expect(await bindings(unpinned)).toEqual([]);
    expect(await bindings(pinned)).toEqual([{ rule_pack_version_id: first.packId, superseded: false }]);

    // The governed path: a licensed consultant at a fresh step-up re-pins.
    await asMaintenance(db);
    const version = await db.query<{ version: number }>(`select version from public.matters where id = $1`, [pinned]);
    await as(ctx, "consultant");
    await db.query(`select public.select_matter_program($1, $2, $3, 'Synthetic program change')`, [pinned, second.packId, version.rows[0].version]);
    const moved = await bindings(pinned);
    expect(moved).toHaveLength(2);
    expect(moved.find((row) => !row.superseded)?.rule_pack_version_id).toBe(second.packId);
  });

  it("keeps the platform global-catalogue path and the server capture", async () => {
    const ctx = await firm();
    const operator = await createUser("operator");
    await asMaintenance(db);
    await db.query(`insert into public.platform_admins (user_id, note, role) values ($1, 'Synthetic operator', 'operator')`, [operator]);
    await asUser(db, { userId: operator, aal: "aal2", totpAgeSeconds: 0 });
    const global = await db.query<{ organization_id: string | null }>(
      `insert into public.official_sources (publisher, canonical_url, jurisdiction, content_kind)
       values ('Government of British Columbia', $1, 'CA-BC', 'program_guidance') returning organization_id`,
      [`https://www.welcomebc.ca/fictional-operator-${token()}`],
    );
    expect(global.rows[0].organization_id).toBeNull();

    await asServiceRole(db);
    const captured = await db.query<{ id: string }>(
      `select public.service_store_page_capture($1, $2, $3, 'Fictional page', $4::jsonb) as id`,
      [
        ctx.orgId,
        ctx.manager,
        `https://www.canada.ca/en/fictional-capture-${token()}.html`,
        JSON.stringify({ sha256: "f".repeat(64), retrieved_at: new Date().toISOString(), http_status: 200 }),
      ],
    );
    await asMaintenance(db);
    const row = await db.query<{ server_captured: boolean }>(`select server_captured from public.source_snapshots where id = $1`, [
      captured.rows[0].id,
    ]);
    expect(row.rows[0].server_captured).toBe(true);
  });
});
