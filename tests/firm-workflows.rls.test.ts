import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Firm workflows: a firm owner or licensed consultant creates and edits the firm's own
 * workflow, or copies a published shared template into one. Other staff only read; other firms
 * see nothing; table writes go only through the audited functions.
 */

let db: TestDb;

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
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4)`,
    [orgId, userId, role, by],
  );
}

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  const assistant = await createUser("assistant");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
    "Synthetic Firm",
    `w${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await member(orgId, consultant, "licensed_consultant", owner);
  await member(orgId, manager, "case_manager", owner);
  await member(orgId, assistant, "assistant", owner);
  return { owner, consultant, manager, assistant, orgId };
}

const as = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });

async function rpc<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

const SAVE = `public.save_firm_workflow($1, $2, $3, $4, $5, $6::jsonb)`;
const ARCHIVE = `public.set_firm_workflow_archived($1, $2, $3)`;

const stages = JSON.stringify([
  {
    name: "Synthetic intake",
    items: [
      { kind: "step", title: "Call the synthetic client", owner: "staff" },
      { kind: "document", title: "Synthetic passport copy", owner: "client", due_offset_days: 7 },
    ],
  },
  { name: "Synthetic review", items: [{ kind: "step", title: "Review the synthetic file" }] },
]);

describe("firm workflows", () => {
  it("lets an owner create, edit, reorder and archive; other staff read only; other firms see nothing", async () => {
    const ctx = await firm();
    const other = await firm();

    await as(ctx.owner, ctx.orgId);
    const created = await rpc<{ id: string; version: number }>(SAVE, [null, null, "Synthetic workflow", "synthetic_program", "Fictional.", stages]);
    expect(created.version).toBe(1);

    const read = await db.query<{ name: string; position: number }>(
      `select s.name, s.position from public.firm_workflow_stages s where s.workflow_id = $1 order by position`,
      [created.id],
    );
    expect(read.rows.map((r) => r.name)).toEqual(["Synthetic intake", "Synthetic review"]);

    // A consultant reorders the stages at the current version; a stale version is refused.
    await as(ctx.consultant, ctx.orgId);
    const reordered = JSON.stringify([...JSON.parse(stages)].reverse());
    const saved = await rpc<{ version: number }>(SAVE, [created.id, 1, "Synthetic workflow v2", null, null, reordered]);
    expect(saved.version).toBe(2);
    await expectDbError(() => rpc(SAVE, [created.id, 1, "Stale", null, null, stages]), /someone else changed/);
    const after = await db.query<{ name: string }>(`select name from public.firm_workflow_stages where workflow_id = $1 order by position`, [created.id]);
    expect(after.rows.map((r) => r.name)).toEqual(["Synthetic review", "Synthetic intake"]);
    const docs = await db.query<{ owner: string; due_offset_days: number }>(
      `select owner, due_offset_days from public.firm_workflow_items where workflow_id = $1 and kind = 'document'`,
      [created.id],
    );
    expect(docs.rows).toEqual([{ owner: "client", due_offset_days: 7 }]);

    // Bad content is refused.
    await expectDbError(() => rpc(SAVE, [null, null, " ", null, null, stages]), /name/);
    await expectDbError(() => rpc(SAVE, [null, null, "X", null, null, "[]"]), /1 to 30 stages/);
    await expectDbError(() => rpc(SAVE, [null, null, "X", null, null, JSON.stringify([{ name: "S", items: [{ kind: "form", title: "t" }] }])]), /step or a document/);

    // Case managers and assistants read but do not write.
    for (const userId of [ctx.manager, ctx.assistant]) {
      await as(userId, ctx.orgId);
      expect((await db.query(`select id from public.firm_workflows`)).rows).toHaveLength(1);
      await expectDbError(() => rpc(SAVE, [null, null, "Denied", null, null, stages]), /permission|denied|role/i);
      await expectDbError(() => rpc(ARCHIVE, [created.id, 2, true]), /permission|denied|role/i);
    }

    // Direct table writes are refused even for the owner.
    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`update public.firm_workflows set name = 'x' where id = $1`, [created.id]), /permission denied/);
    await expectDbError(() => db.query(`insert into public.firm_workflow_stages (organization_id, workflow_id, position, name) values ($1, $2, 9, 'x')`, [ctx.orgId, created.id]), /permission denied/);

    // Another firm sees nothing and cannot write this workflow.
    await as(other.owner, other.orgId);
    expect((await db.query(`select id from public.firm_workflows`)).rows).toHaveLength(0);
    expect((await db.query(`select id from public.firm_workflow_items`)).rows).toHaveLength(0);
    await expectDbError(() => rpc(SAVE, [created.id, 2, "Hijack", null, null, stages]), /workflow denied/);
    await expectDbError(() => rpc(ARCHIVE, [created.id, 2, true]), /workflow denied/);

    // Archive, editing is refused while archived, then restore.
    await as(ctx.owner, ctx.orgId);
    const archived = await rpc<{ version: number }>(ARCHIVE, [created.id, 2, true]);
    await expectDbError(() => rpc(SAVE, [created.id, archived.version, "X", null, null, stages]), /restore the workflow/);
    const restored = await rpc<{ version: number }>(ARCHIVE, [created.id, archived.version, false]);
    expect(restored.version).toBe(archived.version + 1);

    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log where organization_id = $1 and action like 'workflow.%' order by occurred_at, action`,
      [ctx.orgId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["workflow.created", "workflow.saved", "workflow.archived", "workflow.restored"]));
  });

  it("copies a published shared template into an editable firm workflow and leaves the template alone", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    // Publishing is covered by the ADM-03 tests; here a published version is seeded directly.
    await db.query(`set session_replication_role = replica`);
    const tpl = await db.query<{ id: string }>(`insert into public.shared_templates (stable_key, title) values ($1, 'Synthetic shared') returning id`, [
      `syn_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    ]);
    const body = { title: "Synthetic shared", summary: "A fictional template.", items: ["First synthetic item", "Second synthetic item"] };
    const insertVersion = (status: string, n: number) =>
      db.query<{ id: string }>(
        `insert into public.shared_template_versions (template_id, version_number, status, body, content_hash, author_name, test_evidence, effective_on, changelog, reviewed_at, published_at)
         values ($1, $2, $3, $4::jsonb, $5, 'Synthetic', 'Synthetic evidence', '2026-11-01', 'Synthetic', case when $3 = 'draft' then null else now() end, case when $3 = 'published' then now() else null end)
         returning id`,
        [tpl.rows[0].id, n, status, JSON.stringify(body), "a".repeat(64)],
      );
    const published = (await insertVersion("published", 1)).rows[0].id;
    const draft = (await insertVersion("draft", 2)).rows[0].id;
    await db.query(`set session_replication_role = origin`);

    await as(ctx.manager, ctx.orgId);
    await expectDbError(() => rpc(`public.copy_shared_template_to_workflow($1)`, [published]), /permission|denied|role/i);

    await as(ctx.owner, ctx.orgId);
    await expectDbError(() => rpc(`public.copy_shared_template_to_workflow($1)`, [draft]), /not published/);
    const copy = await rpc<{ id: string; version: number }>(`public.copy_shared_template_to_workflow($1)`, [published]);
    const row = await db.query<{ name: string; description: string; source_version_id: string }>(
      `select name, description, source_version_id from public.firm_workflows where id = $1`,
      [copy.id],
    );
    expect(row.rows[0]).toEqual({ name: "Synthetic shared", description: "A fictional template.", source_version_id: published });
    const items = await db.query<{ title: string }>(`select title from public.firm_workflow_items where workflow_id = $1 order by position`, [copy.id]);
    expect(items.rows.map((r) => r.title)).toEqual(body.items);

    // The copy is editable; the shared version is unchanged.
    await rpc(SAVE, [copy.id, copy.version, "Our synthetic copy", null, null, stages]);
    await asMaintenance(db);
    const shared = await db.query<{ body: typeof body }>(`select body from public.shared_template_versions where id = $1`, [published]);
    expect(shared.rows[0].body).toEqual(body);
    const audit = await db.query(`select 1 from public.audit_log where organization_id = $1 and action = 'workflow.copied'`, [ctx.orgId]);
    expect(audit.rows).toHaveLength(1);
  });
});
