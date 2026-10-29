import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * ADM-03: the admin portal drafts a shared template (service role). A licensed platform
 * reviewer publishes it with a step-up. Firms are notified and can adopt. No platform_admins
 * row is seeded by the migration.
 */

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

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

async function member(orgId: string, userId: string, role: string, by: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, by],
  );
  return row.rows[0].id;
}

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await member(orgId, consultant, "licensed_consultant", owner);
  await member(orgId, manager, "case_manager", owner);
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       $3, $4, false, false, null, $5, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, true, false, PROOF],
  );
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  return { owner, consultant, manager, orgId, consultantMembership };
}

async function rpc<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

const items = (lines: string[]) => JSON.stringify(lines);

const officialSources = JSON.stringify([
  { url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html", title: "Study permit", retrieved_on: "2026-10-29" },
]);

describe("ADM-03 shared template publication", () => {
  it("publishes only after a licensed reviewer steps up, then a firm adopts without moving a pin", async () => {
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.platform_admins`)).rows).toHaveLength(0);
    const ctx = await firm();
    const other = await firm();
    const author = await createUser("author");
    await asMaintenance(db);
    await db.query(
      `insert into public.platform_admins (user_id, note, template_reviewer) values ($1, 'Synthetic author', true), ($2, 'Synthetic reviewer', false)`,
      [author, ctx.consultant],
    );

    const draftArgs = [
      "synthetic_template",
      "Synthetic template",
      "A fictional checklist for tests.",
      items(["Ask for the synthetic file"]),
      "Synthetic Author",
      author,
      "Synthetic test evidence for this version.",
      "2026-11-01",
      "First fictional version.",
    ];

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => rpc(`public.draft_shared_template_version($1, $2, $3, $4::jsonb, $5, $6, $7, $8::date, $9)`, draftArgs), /permission denied|template draft denied/);

    await asServiceRole(db);
    const versionId = await rpc<string>(`public.draft_shared_template_version($1, $2, $3, $4::jsonb, $5, $6, $7, $8::date, $9)`, draftArgs);
    await expectDbError(() => rpc(`public.approve_shared_template_version($1)`, [versionId]), /permission denied|service role cannot publish/);

    await asUser(db, { userId: author, aal: "aal2", totpAgeSeconds: 0 });
    await expectDbError(() => rpc(`public.approve_shared_template_version($1)`, [versionId]), /licensed reviewer is required/);

    // A licensed platform admin without the reviewer flag cannot publish.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => rpc(`public.approve_shared_template_version($1)`, [versionId]), /not a template reviewer/);
    await asMaintenance(db);
    await db.query(`update public.platform_admins set template_reviewer = true where user_id = $1`, [ctx.consultant]);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => rpc(`public.approve_shared_template_version($1)`, [versionId]), /step-up is required/);

    // Publishing needs at least one official source on the draft.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => rpc(`public.approve_shared_template_version($1)`, [versionId]), /official source/);
    await asServiceRole(db);
    await expectDbError(
      () => rpc(`public.set_shared_template_version_sources($1, $2::jsonb, $3)`, [versionId, JSON.stringify([{ url: "http://example.com", title: "x", retrieved_on: "2026-10-29" }]), author]),
      /https link/,
    );
    await rpc(`public.set_shared_template_version_sources($1, $2::jsonb, $3)`, [versionId, officialSources, author]);

    await asServiceRole(db);
    const own = await rpc<string>(`public.draft_shared_template_version($1, $2, $3, $4::jsonb, $5, $6, $7, $8::date, $9)`, [
      "synthetic_own",
      "Own draft",
      "Not used.",
      items(["Unused"]),
      "Synthetic Reviewer",
      ctx.consultant,
      "Synthetic test evidence for a self draft.",
      "2026-11-01",
      "The reviewer wrote this one.",
    ]);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => rpc(`public.approve_shared_template_version($1)`, [own]), /author cannot approve/);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const published = await rpc<{ status: string; version_number: number }>(`public.approve_shared_template_version($1)`, [versionId]);
    expect(published).toMatchObject({ status: "published", version_number: 1 });

    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log where object_id = $1 and action = 'template.version_published'`,
      [versionId],
    );
    expect(audit.rows).toHaveLength(1);
    const notices = await db.query<{ organization_id: string }>(`select organization_id from public.shared_template_notices where version_id = $1`, [versionId]);
    expect(notices.rows.map((row) => row.organization_id).sort()).toEqual([ctx.orgId, other.orgId].sort());

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const catalogue = await rpc<{ notices: { kind: string }[]; versions: { status: string }[]; can_adopt: boolean }>(`public.firm_shared_templates()`);
    expect(catalogue.can_adopt).toBe(true);
    expect(catalogue.notices.some((notice) => notice.kind === "published")).toBe(true);
    expect(catalogue.versions.every((version) => version.status !== "draft")).toBe(true);

    await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => rpc(`public.adopt_shared_template($1)`, [versionId]), /staff access denied/);

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    expect(await rpc(`public.adopt_shared_template($1)`, [versionId])).toMatchObject({ version_number: 1 });
    await asMaintenance(db);
    const matterId = randomUUID();
    await db.query(`insert into public.matters (id, organization_id, title, is_sample, stage) values ($1, $2, 'Synthetic matter', false, 'engagement_pending')`, [matterId, ctx.orgId]);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const templateId = (
      await db.query<{ template_id: string }>(`select template_id from public.shared_template_versions where id = $1`, [versionId])
    ).rows[0].template_id;
    await asMaintenance(db);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await rpc(`public.pin_matter_shared_template($1, $2)`, [matterId, templateId]);
    await expectDbError(() => rpc(`public.pin_matter_shared_template($1, $2)`, [matterId, templateId]), /already uses version 1/);

    await asServiceRole(db);
    const second = await rpc<string>(`public.draft_shared_template_version($1, $2, $3, $4::jsonb, $5, $6, $7, $8::date, $9)`, [
      "synthetic_template",
      "Synthetic template",
      "A fictional checklist for tests.",
      items(["Ask for the synthetic file", "Ask for the second file"]),
      "Synthetic Author",
      author,
      "Synthetic test evidence for version two.",
      "2026-12-01",
      "Added a second fictional item.",
    ]);
    const diff = await rpc<{ changes: { field: string; before: string; after: string }[] }>(`public.shared_template_diff($1)`, [second]);
    expect(diff.changes).toEqual([{ field: "items", before: "Ask for the synthetic file", after: "Ask for the synthetic file\nAsk for the second file" }]);

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => rpc(`public.shared_template_diff($1)`, [second]), /template review denied/);
    const history = await rpc<{ versions: { status: string }[] }>(`public.shared_template_history($1)`, ["synthetic_template"]);
    expect(history.versions.map((version) => version.status)).toEqual(["published"]);

    await asServiceRole(db);
    await rpc(`public.set_shared_template_version_sources($1, $2::jsonb, $3)`, [second, officialSources, author]);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await rpc(`public.approve_shared_template_version($1)`, [second]);
    await asMaintenance(db);
    const pin = await db.query<{ version_id: string }>(`select version_id from public.matter_shared_template_pins where matter_id = $1`, [matterId]);
    expect(pin.rows[0].version_id).toBe(versionId);

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await rpc(`public.save_firm_template_override($1, $2, $3, $4::jsonb, $5)`, [
      templateId,
      "Firm wording",
      "The firm rewrote the summary.",
      items(["Firm item"]),
      "Synthetic reason for the firm wording.",
    ]);
    const after = await rpc<{ versions: { body: { title: string } }[]; overrides: { kind: string; body: { title: string } }[] }>(`public.firm_shared_templates()`);
    const central = after.versions.find((version) => version.body.title === "Synthetic template");
    expect(central).toBeTruthy();
    expect(after.overrides.some((override) => override.kind === "edit" && override.body.title === "Firm wording")).toBe(true);

    await asUser(db, { userId: other.owner, aal: "aal2", orgId: other.orgId, totpAgeSeconds: 0 });
    const elsewhere = await rpc<{ adoptions: unknown[]; overrides: unknown[] }>(`public.firm_shared_templates()`);
    expect(elsewhere.adoptions).toEqual([]);
    expect(elsewhere.overrides).toEqual([]);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const rolled = await rpc<{ status: string; restored: string }>(`public.rollback_shared_template_version($1, $2)`, [second, "Synthetic rollback reason."]);
    expect(rolled.status).toBe("rolled_back");
    expect(rolled.restored).toBe(versionId);
    await asMaintenance(db);
    expect((await db.query<{ status: string }>(`select status from public.shared_template_versions where id = $1`, [versionId])).rows[0].status).toBe("published");
    expect((await db.query<{ version_id: string }>(`select version_id from public.matter_shared_template_pins where matter_id = $1`, [matterId])).rows[0].version_id).toBe(versionId);

    await asMaintenance(db);
    await expectDbError(
      () => db.query(`update public.shared_template_versions set changelog = 'rewritten' where id = $1`, [versionId]),
      /review functions/,
    );
  });
});
