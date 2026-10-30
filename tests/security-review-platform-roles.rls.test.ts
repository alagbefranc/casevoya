import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Platform admin roles are enforced in the database (20261030130000). A viewer is read-only:
 * no service notices, no global catalogue writes, no template review, no product settings, no
 * support responses, no CICC import, whether from their own session or named by the service
 * role. An operator keeps every one of those writes. Synthetic users only.
 */

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const officialSources = JSON.stringify([
  { url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html", title: "Study permit", retrieved_on: "2026-10-29" },
]);

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
  ]);
  return id;
}

async function platformAdmin(label: string, role: "owner" | "operator" | "viewer", reviewer = false, userId?: string) {
  const id = userId ?? (await createUser(label));
  await asMaintenance(db);
  await db.query(`insert into public.platform_admins (user_id, note, role, template_reviewer) values ($1, $2, $3, $4)`, [
    id,
    `Synthetic ${role}`,
    role,
    reviewer,
  ]);
  return id;
}

async function rpc<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

const fresh = (userId: string, orgId: string | null = null) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });

/** A firm whose licensed consultant has a verified licence (needed to review shared templates). */
async function licensedFirm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  await fresh(owner);
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
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
  await fresh(consultant, orgId);
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membership.rows[0].id, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await fresh(owner, orgId);
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  return { owner, consultant, orgId, credentialId: credential.rows[0].id };
}

const postNotice = `public.post_service_notice('info', 'minor', 'Synthetic notice', 'Synthetic text.', null, null, null, true)`;

describe("platform admin roles in the database", () => {
  it("a viewer cannot post a service notice; an operator can; the service role must name an operator or owner", async () => {
    const viewer = await platformAdmin("viewer", "viewer");
    const operator = await platformAdmin("operator", "operator");

    await fresh(viewer);
    await expectDbError(() => rpc(postNotice), /role does not allow/);
    // Reads stay open to a viewer.
    await db.query(`select id from public.service_notices`);

    await fresh(operator);
    const id = await rpc<string>(postNotice);
    expect(id).toBeTruthy();

    await fresh(viewer);
    await expectDbError(() => rpc(`public.update_service_notice($1, p_title => 'Viewer change')`, [id]), /role does not allow/);
    await expectDbError(() => rpc(`public.resolve_service_notice($1, 'Viewer resolved it')`, [id]), /role does not allow/);
    expect((await db.query(`select id from public.service_notices where id = $1`, [id])).rows).toHaveLength(1);

    await asServiceRole(db);
    await expectDbError(
      () => rpc(`public.post_service_notice('info', 'minor', 'Synthetic notice', 'Synthetic text.', null, null, null, true, $1)`, [viewer]),
      /role does not allow/,
    );
    await expectDbError(() => rpc(`public.resolve_service_notice($1, 'Viewer resolved it', $2)`, [id, viewer]), /role does not allow/);
    expect(await rpc(`public.resolve_service_notice($1, 'Operator resolved it', $2)`, [id, operator])).toBe(id);
  });

  it("a viewer cannot write the global source catalogue; an operator can; both read it", async () => {
    const viewer = await platformAdmin("viewer-src", "viewer");
    const operator = await platformAdmin("operator-src", "operator");
    const suffix = randomUUID().slice(0, 8);

    await fresh(viewer);
    await expectDbError(
      () =>
        db.query(
          `insert into public.official_source_domains (host, match_kind, authority, jurisdiction_code, notes)
           values ($1, 'exact', 'Platform fixture', 'CA', 'Test row.')`,
          [`viewer-fixture-${suffix}.gc.ca`],
        ),
      /row-level security/,
    );
    await expectDbError(
      () =>
        db.query(
          `insert into public.official_sources (publisher, canonical_url, jurisdiction, content_kind)
           values ('Government of British Columbia', $1, 'CA-BC', 'program_guidance')`,
          [`https://www.welcomebc.ca/fictional-viewer-${suffix}`],
        ),
      /row-level security/,
    );
    const before = await db.query(`select host from public.official_source_domains`);
    expect(before.rows.length).toBeGreaterThan(0);

    await fresh(operator);
    const inserted = await db.query<{ host: string }>(
      `insert into public.official_source_domains (host, match_kind, authority, jurisdiction_code, notes)
       values ($1, 'exact', 'Platform fixture', 'CA', 'Test row.') returning host`,
      [`operator-fixture-${suffix}.gc.ca`],
    );
    expect(inserted.rows[0].host).toBe(`operator-fixture-${suffix}.gc.ca`);

    // A viewer's update matches no row.
    await fresh(viewer);
    const updated = await db.query(`update public.official_source_domains set notes = 'Viewer edit' where host = $1`, [
      `operator-fixture-${suffix}.gc.ca`,
    ]);
    expect(updated.affectedRows ?? 0).toBe(0);
    await asMaintenance(db);
    const row = await db.query<{ notes: string }>(`select notes from public.official_source_domains where host = $1`, [`operator-fixture-${suffix}.gc.ca`]);
    expect(row.rows[0].notes).toBe("Test row.");
  });

  it("a licensed template reviewer who is a viewer cannot approve; as an operator they can", async () => {
    const firm = await licensedFirm();
    const author = await platformAdmin("author", "operator");
    const viewerAuthor = await platformAdmin("viewer-author", "viewer");
    const reviewer = await platformAdmin("reviewer", "viewer", true, firm.consultant);

    await asServiceRole(db);
    const versionId = await rpc<string>(`public.draft_shared_template_version($1, $2, $3, $4::jsonb, $5, $6, $7, $8::date, $9)`, [
      `synthetic_roles_${randomUUID().slice(0, 6).replaceAll("-", "")}`,
      "Synthetic template",
      "A fictional checklist for tests.",
      JSON.stringify(["Ask for the synthetic file"]),
      "Synthetic Author",
      author,
      "Synthetic test evidence for this version.",
      "2026-11-01",
      "First fictional version.",
    ]);
    await expectDbError(
      () => rpc(`public.set_shared_template_version_sources($1, $2::jsonb, $3)`, [versionId, officialSources, viewerAuthor]),
      /role does not allow/,
    );
    await rpc(`public.set_shared_template_version_sources($1, $2::jsonb, $3)`, [versionId, officialSources, author]);
    const submitted = await rpc<{ review_hash: string }>(`public.submit_shared_template_version($1, $2)`, [versionId, author]);

    await fresh(reviewer, firm.orgId);
    await expectDbError(() => rpc(`public.approve_shared_template_version($1, $2)`, [versionId, submitted.review_hash]), /role does not allow/);
    await expectDbError(() => rpc(`public.reject_shared_template_version($1, 'Viewer reason')`, [versionId]), /role does not allow/);
    await asMaintenance(db);
    expect((await db.query<{ status: string }>(`select status from public.shared_template_versions where id = $1`, [versionId])).rows[0].status).toBe(
      "draft",
    );

    await db.query(`update public.platform_admins set role = 'operator' where user_id = $1`, [reviewer]);
    await fresh(reviewer, firm.orgId);
    expect(await rpc(`public.approve_shared_template_version($1, $2)`, [versionId, submitted.review_hash])).toMatchObject({ status: "published" });
  });

  it("a viewer cannot change product settings, record support responses or import the CICC list; an operator can", async () => {
    const firm = await licensedFirm();
    const viewer = await platformAdmin("viewer-ops", "viewer");
    const operator = await platformAdmin("operator-ops", "operator");

    await fresh(viewer);
    await expectDbError(() => rpc(`public.set_product_setting('trial.duration', '{"unit":"days","count":14}'::jsonb)`), /role does not allow/);
    await expectDbError(
      () => rpc(`public.record_support_response($1, 'T-viewer', now() - interval '1 hour', null)`, [firm.orgId]),
      /role does not allow/,
    );
    await expectDbError(() => rpc(`public.start_cicc_register_import('Synthetic list', null, $1, null)`, ["a".repeat(64)]), /CICC list import denied/);
    await expectDbError(
      () =>
        rpc(`public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, $3, 'Viewer note')`, [
          firm.credentialId,
          REGISTER,
          PROOF,
        ]),
      /licence check denied/,
    );
    // The needs-review list is a read: still open to a viewer.
    await db.query(`select * from public.cicc_needs_review_credentials()`);

    await asServiceRole(db);
    await expectDbError(
      () => rpc(`public.record_support_response($1, 'T-viewer', now() - interval '1 hour', null, $2)`, [firm.orgId, viewer]),
      /role does not allow/,
    );
    await expectDbError(
      () => rpc(`public.start_cicc_register_import('Synthetic list', null, $1, $2)`, ["b".repeat(64), viewer]),
      /role does not allow/,
    );

    await fresh(operator);
    await rpc(`public.set_product_setting('trial.duration', '{"unit":"days","count":14}'::jsonb)`);
    expect(await rpc(`public.record_support_response($1, 'T-operator', now() - interval '1 hour', null)`, [firm.orgId])).toBeTruthy();
    expect(await rpc(`public.start_cicc_register_import('Synthetic list', null, $1, null)`, ["c".repeat(64)])).toBeTruthy();
    expect(
      await rpc(
        `public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, $3, 'Operator note')`,
        [firm.credentialId, REGISTER, PROOF],
      ),
    ).toBeTruthy();
  });
});
