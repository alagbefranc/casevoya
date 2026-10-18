import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261019204200_intake_builder.sql: drafts are edited in place, published versions never change,
// publishing needs a licensed consultant with a step-up and supersedes the previous version, and
// a field's allow_unknown / allow_not_applicable flags are enforced. Synthetic records only.

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function as(userId: string, orgId: string, stepUp = true) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: stepUp ? 0 : 3600 });
}

async function user() {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `u-${tag()}@example.test`]);
  return id;
}

async function firm() {
  const owner = await user();
  const consultant = await user();
  const manager = await user();
  const assistant = await user();
  await as(owner, "");
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  await asMaintenance(db);
  const add = async (userId: string, role: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
        [orgId, userId, role, owner],
      )
    ).rows[0].id;
  const consultantMembership = await add(consultant, "licensed_consultant");
  await add(manager, "case_manager");
  await add(assistant, "assistant");
  return { orgId, owner, consultant, consultantMembership, manager, assistant };
}

const field = (key: string, extra: Record<string, unknown> = {}) => ({ key, type: "text", labels: { "en-CA": `Label ${key}` }, required: true, ...extra });
const schema = (...fields: object[]) => JSON.stringify({ fields });

type Saved = { id: string; version: number };

async function save(userId: string, orgId: string, key: string, body: string, id: string | null = null, version: number | null = null): Promise<Saved> {
  await as(userId, orgId, false);
  const row = await db.query<{ saved: Saved }>(`select public.save_intake_draft($1, 'Synthetic form', $2::jsonb, $3, $4) as saved`, [key, body, id, version]);
  return row.rows[0].saved;
}

async function rows(orgId: string, key: string) {
  await asMaintenance(db);
  return (
    await db.query<{ version_number: number; status: string; fields: number }>(
      `select version_number, status::text, jsonb_array_length(schema -> 'fields') as fields from public.intake_templates where organization_id = $1 and stable_key = $2 order by version_number`,
      [orgId, key],
    )
  ).rows;
}

describe("Intake form builder", () => {
  it("edits a draft in place, refuses a stale save or a second draft, and publishes it only for a licensed consultant with a step-up", async () => {
    const f = await firm();
    const first = await save(f.manager, f.orgId, "about_you", schema(field("full_name")));
    const second = await save(f.manager, f.orgId, "about_you", schema(field("full_name"), field("dob", { type: "date" })), first.id, first.version);
    expect(second.id).toBe(first.id);
    expect(await rows(f.orgId, "about_you")).toEqual([{ version_number: 1, status: "draft", fields: 2 }]);
    await expectDbError(() => save(f.manager, f.orgId, "about_you", schema(field("full_name")), first.id, first.version), /conflict/);
    await expectDbError(() => save(f.manager, f.orgId, "about_you", schema(field("full_name"))), /conflict/);
    await expectDbError(() => save(f.assistant, f.orgId, "about_you", schema(field("x")), first.id, second.version), /denied/);

    await as(f.manager, f.orgId);
    await expectDbError(() => db.query(`select public.publish_intake_draft($1, $2)`, [first.id, second.version]), /denied/);
    await as(f.consultant, f.orgId, false);
    await expectDbError(() => db.query(`select public.publish_intake_draft($1, $2)`, [first.id, second.version]), /step-up/);
    await as(f.consultant, f.orgId);
    await db.query(`select public.publish_intake_draft($1, $2)`, [first.id, second.version]);
    await asMaintenance(db);
    const published = await db.query<{ status: string; effective: boolean; reviewer: string }>(
      `select status::text, effective_on is not null as effective, reviewer_membership_id as reviewer from public.intake_templates where id = $1`,
      [first.id],
    );
    expect(published.rows[0]).toEqual({ status: "published", effective: true, reviewer: f.consultantMembership });
    const audit = await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'intake_template.published'`, [first.id]);
    expect(audit.rows.length).toBe(1);
  });

  it("never changes a published version: the next edit is a new draft, and publishing it supersedes the old one", async () => {
    const f = await firm();
    const v1 = await save(f.manager, f.orgId, "travel", schema(field("trips")));
    await as(f.consultant, f.orgId);
    await db.query(`select public.publish_intake_draft($1, $2)`, [v1.id, v1.version]);
    await expectDbError(() => save(f.manager, f.orgId, "travel", schema(field("trips"), field("more")), v1.id, v1.version + 1), /never changed/);
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.intake_templates set schema = $2::jsonb where id = $1`, [v1.id, schema(field("forged"))]), /versioned by inserting|status changes only/);
    const v2 = await save(f.manager, f.orgId, "travel", schema(field("trips"), field("more")));
    await as(f.consultant, f.orgId);
    await db.query(`select public.publish_intake_draft($1, $2)`, [v2.id, v2.version]);
    expect(await rows(f.orgId, "travel")).toEqual([
      { version_number: 1, status: "superseded", fields: 1 },
      { version_number: 2, status: "published", fields: 2 },
    ]);
    await as(f.manager, f.orgId, false);
    const usage = await db.query(`select * from public.intake_template_usage($1)`, [f.orgId]);
    expect(usage.rows).toEqual([]);
  });

  it("refuses an Unknown answer where the form says unknown isn't allowed, and keeps older forms as they were", async () => {
    const f = await firm();
    const draft = await save(f.manager, f.orgId, "strict", schema(field("name", { allow_unknown: false, allow_not_applicable: false }), field("nickname")));
    await as(f.consultant, f.orgId);
    await db.query(`select public.publish_intake_draft($1, $2)`, [draft.id, draft.version]);
    const matterId = (
      await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [f.consultantMembership])
    ).rows[0].result.id;
    await asMaintenance(db);
    const personId = (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample) values ($1, 'Synthetic applicant', true) returning id`, [f.orgId])).rows[0].id;
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [f.orgId, matterId, personId]);
    await as(f.consultant, f.orgId);
    const responseId = (await db.query<{ id: string }>(`select public.open_intake_response($1, $2, $3) as id`, [draft.id, matterId, personId])).rows[0].id;
    const version = async () => {
      await asMaintenance(db);
      const row = await db.query<{ version: number }>(`select version from public.intake_responses where id = $1`, [responseId]);
      await as(f.consultant, f.orgId);
      return row.rows[0].version;
    };
    await expectDbError(async () => db.query(`select public.save_intake_answer($1, $2, 'name', 'unknown', '{}'::jsonb)`, [responseId, await version()]), /unknown is not allowed/);
    await expectDbError(async () => db.query(`select public.save_intake_answer($1, $2, 'name', 'not_applicable', '{}'::jsonb)`, [responseId, await version()]), /not applicable is not allowed/);
    await db.query(`select public.save_intake_answer($1, $2, 'nickname', 'unknown', '{}'::jsonb)`, [responseId, await version()]);
  });
});
