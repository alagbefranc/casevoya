import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * ADM-03: a shared template approval publishes exactly what was reviewed. A draft submitted for
 * review cannot be edited (content or sources) until it is withdrawn; the hash-bound approve
 * overload refuses content that changed; opening a draft does not change the live title.
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
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await member(orgId, consultant, "licensed_consultant", owner);
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
  return { owner, consultant, orgId };
}

async function rpc<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

const items = (lines: string[]) => JSON.stringify(lines);

const officialSources = JSON.stringify([
  { url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html", title: "Study permit", retrieved_on: "2026-10-29" },
]);
const otherSources = JSON.stringify([
  { url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit.html", title: "Work permit", retrieved_on: "2026-10-29" },
]);

const DRAFT = `public.draft_shared_template_version($1, $2, $3, $4::jsonb, $5, $6, $7, $8::date, $9)`;
const REVISE = `public.revise_shared_template_draft($1, $2, $3, $4::jsonb, $5, $6::date, $7)`;

let ctx: Awaited<ReturnType<typeof firm>>;
let author: string;

async function asReviewer() {
  await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
}

async function draft(key: string, title: string, lines: string[]) {
  await asServiceRole(db);
  const id = await rpc<string>(DRAFT, [
    key,
    title,
    "A fictional checklist for tests.",
    items(lines),
    "Synthetic Author",
    author,
    "Synthetic test evidence for this version.",
    "2026-11-01",
    "A fictional version.",
  ]);
  await rpc(`public.set_shared_template_version_sources($1, $2::jsonb, $3)`, [id, officialSources, author]);
  return id;
}

async function body(versionId: string) {
  await asMaintenance(db);
  return (await db.query<{ body: { title: string; items: string[] } }>(`select body from public.shared_template_versions where id = $1`, [versionId])).rows[0]
    .body;
}

async function liveTitle(key: string) {
  await asMaintenance(db);
  return (await db.query<{ title: string }>(`select title from public.shared_templates where stable_key = $1`, [key])).rows[0].title;
}

describe("shared template approval is bound to the reviewed content", () => {
  beforeAll(async () => {
    ctx = await firm();
    author = await createUser("author");
    await asMaintenance(db);
    await db.query(
      `insert into public.platform_admins (user_id, note, template_reviewer) values ($1, 'Synthetic author', false), ($2, 'Synthetic reviewer', true)`,
      [author, ctx.consultant],
    );
  }, 180_000);

  it("refuses content and source edits while a draft is in review, and publishes exactly what was submitted", async () => {
    const versionId = await draft("review_lock_template", "Review lock template", ["Original item"]);

    await asServiceRole(db);
    const submitted = await rpc<{ review_hash: string }>(`public.submit_shared_template_version($1, $2)`, [versionId, author]);
    expect(submitted.review_hash).toMatch(/^[0-9a-f]{64}$/);
    await expectDbError(() => rpc(`public.submit_shared_template_version($1, $2)`, [versionId, author]), /already in review/);

    await expectDbError(
      () => rpc(REVISE, [versionId, "Review lock template", "Changed.", items(["Swapped item"]), "Synthetic test evidence changed.", "2026-11-01", "Changed."]),
      /in review/,
    );
    await expectDbError(() => rpc(`public.set_shared_template_version_sources($1, $2::jsonb, $3)`, [versionId, otherSources, author]), /frozen/);

    // A direct write path (write flag on) is refused by the trigger too.
    await asMaintenance(db);
    await db.query(`select set_config('app.shared_template_write', 'on', false)`);
    try {
      await expectDbError(
        () => db.query(`update public.shared_template_versions set body = jsonb_set(body, '{items}', '["Swapped item"]') where id = $1`, [versionId]),
        /in review/,
      );
      await expectDbError(() => db.query(`delete from public.shared_template_version_sources where version_id = $1`, [versionId]), /frozen/);
    } finally {
      await db.query(`select set_config('app.shared_template_write', '', false)`);
    }

    await asReviewer();
    const published = await rpc<{ status: string; review_hash: string }>(`public.approve_shared_template_version($1)`, [versionId]);
    expect(published.status).toBe("published");
    expect(published.review_hash).toBe(submitted.review_hash);
    expect((await body(versionId)).items).toEqual(["Original item"]);
  });

  it("lets the author withdraw from review, edit, and requires the reviewer's hash to match", async () => {
    const versionId = await draft("review_hash_template", "Review hash template", ["Original item"]);

    await asReviewer();
    const seen = await rpc<string>(`public.shared_template_review_hash($1)`, [versionId]);
    expect(seen).toMatch(/^[0-9a-f]{64}$/);

    await asServiceRole(db);
    await rpc(`public.submit_shared_template_version($1, $2)`, [versionId, author]);
    await rpc(`public.withdraw_shared_template_version($1, $2)`, [versionId, author]);
    await rpc(REVISE, [versionId, "Review hash template", "Changed.", items(["Swapped item"]), "Synthetic test evidence changed.", "2026-11-01", "Changed."]);

    await asReviewer();
    await expectDbError(() => rpc(`public.approve_shared_template_version($1, $2)`, [versionId, seen]), /changed since it was reviewed/);
    await expectDbError(() => rpc(`public.approve_shared_template_version($1, $2)`, [versionId, "not-a-hash"]), /review hash is required/);
    await asMaintenance(db);
    expect((await db.query<{ status: string }>(`select status from public.shared_template_versions where id = $1`, [versionId])).rows[0].status).toBe("draft");

    await asReviewer();
    const current = await rpc<string>(`public.shared_template_review_hash($1)`, [versionId]);
    const published = await rpc<{ status: string }>(`public.approve_shared_template_version($1, $2)`, [versionId, current]);
    expect(published.status).toBe("published");
    expect((await body(versionId)).items).toEqual(["Swapped item"]);
  });

  it("keeps the admin portal flow: a draft not in review is revised and approved with only the id", async () => {
    const versionId = await draft("portal_flow_template", "Portal flow template", ["Original item"]);
    await asServiceRole(db);
    await rpc(REVISE, [versionId, "Portal flow template", "Revised.", items(["Revised item"]), "Synthetic test evidence revised.", "2026-11-01", "Revised."]);
    await rpc(`public.set_shared_template_version_sources($1, $2::jsonb, $3)`, [versionId, otherSources, author]);

    await asReviewer();
    const published = await rpc<{ status: string }>(`public.approve_shared_template_version($1)`, [versionId]);
    expect(published.status).toBe("published");

    // Published content stays frozen.
    await asServiceRole(db);
    await expectDbError(
      () => rpc(REVISE, [versionId, "Portal flow template", "Again.", items(["Again"]), "Synthetic test evidence again.", "2026-11-01", "Again."]),
      /not open/,
    );
    await expectDbError(() => rpc(`public.submit_shared_template_version($1, $2)`, [versionId, author]), /not open/);
  });

  it("does not change the live template title when a new draft is opened", async () => {
    const first = await draft("title_template", "Live title", ["Item"]);
    await asReviewer();
    await rpc(`public.approve_shared_template_version($1)`, [first]);
    expect(await liveTitle("title_template")).toBe("Live title");

    const second = await draft("title_template", "Draft title", ["Item", "Second item"]);
    expect(await liveTitle("title_template")).toBe("Live title");

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const catalogue = await rpc<{ versions: { stable_key: string; template_title: string }[] }>(`public.firm_shared_templates()`);
    expect(catalogue.versions.filter((v) => v.stable_key === "title_template").every((v) => v.template_title === "Live title")).toBe(true);

    await asReviewer();
    await rpc(`public.approve_shared_template_version($1)`, [second]);
    expect(await liveTitle("title_template")).toBe("Draft title");

    await asReviewer();
    await rpc(`public.rollback_shared_template_version($1, $2)`, [second, "Synthetic rollback reason."]);
    expect(await liveTitle("title_template")).toBe("Live title");
  });

  it("refuses submit and withdraw outside the admin portal role", async () => {
    const versionId = await draft("role_template", "Role template", ["Item"]);
    await asReviewer();
    await expectDbError(() => rpc(`public.submit_shared_template_version($1, $2)`, [versionId, author]), /permission denied|template draft denied/);
    await asServiceRole(db);
    await rpc(`public.submit_shared_template_version($1, $2)`, [versionId, author]);
    await asReviewer();
    await expectDbError(() => rpc(`public.withdraw_shared_template_version($1, $2)`, [versionId, author]), /permission denied|template draft denied/);
  });
});
