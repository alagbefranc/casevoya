import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

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

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

const UNSAFE = [
  `<img/src=x/onerror=alert(1)>@example.test`,
  `a"b@example.test`,
  `a'b@example.test`,
  "a`b@example.test",
  "a(b)@example.test",
  "a;b@example.test",
  "a,b@example.test",
  "a\\b@example.test",
  "a\u0007b@example.test",
];

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, address],
  );
  return id;
}

async function member(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return row.rows[0].id;
}

async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
    "Synthetic Firm",
    slug(),
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await member(orgId, consultant, "licensed_consultant", owner);
  return { owner, consultant, orgId, consultantMembership };
}

async function samplePerson(ctx: Awaited<ReturnType<typeof firm>>) {
  await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { id: string } }>(`select public.create_practice_matter('Fictional sample file', true) as result`);
  const matterId = matter.rows[0].result.id;
  const personId = randomUUID();
  await db.query(
    `insert into public.persons (id, organization_id, display_name, is_sample) values ($1, $2, 'Sample Applicant', true)`,
    [personId, ctx.orgId],
  );
  await asMaintenance(db);
  await db.query(
    `update public.persons set date_of_birth = '1990-04-04', birth_date_precision = 'day'::public.date_precision where id = $1`,
    [personId],
  );
  await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`,
    [ctx.orgId, matterId, ctx.consultantMembership],
  );
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`,
    [ctx.orgId, matterId, personId],
  );
  return { matterId, personId };
}

describe("invitation emails refuse markup and quoting characters", () => {
  it("refuses a staff invitation to an unsafe address and still creates an ordinary one", async () => {
    const ctx = await firm();
    for (const address of UNSAFE) {
      await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
      await expectDbError(
        () => db.query(`select public.create_staff_invitation($1, $2, 'case_manager'::public.org_role)`, [ctx.orgId, address]),
        /email is invalid/,
      );
    }
    await asMaintenance(db);
    const stored = await db.query<{ n: number }>(`select count(*)::int as n from public.invitations where organization_id = $1`, [ctx.orgId]);
    expect(stored.rows[0].n).toBe(0);

    const address = email("staff");
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const created = await db.query<{ token: string }>(
      `select public.create_staff_invitation($1, $2, 'case_manager'::public.org_role) as token`,
      [ctx.orgId, address],
    );
    const token = created.rows[0].token;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    await asAnon(db);
    const preview = await db.query<{ status: string; email: string }>(`select status, email from public.preview_invitation($1)`, [token]);
    expect(preview.rows[0]).toEqual({ status: "valid", email: address });
  });

  it("answers invalid_email for a portal invitation to an unsafe address and still issues an ordinary one", async () => {
    const ctx = await firm();
    const { matterId, personId } = await samplePerson(ctx);
    for (const address of UNSAFE) {
      await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
      const refused = await db.query<{ result: { ok: boolean; error?: string } }>(
        `select public.create_portal_invitation($1, $2, 'client'::public.org_role, $3, '{}'::uuid[]) as result`,
        [personId, matterId, address],
      );
      expect(refused.rows[0].result).toEqual({ ok: false, error: "invalid_email" });
    }
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const issued = await db.query<{ result: { ok: boolean } }>(
      `select public.create_portal_invitation($1, $2, 'client'::public.org_role, $3, '{}'::uuid[]) as result`,
      [personId, matterId, email("applicant")],
    );
    expect(issued.rows[0].result.ok).toBe(true);
  });

  it("refuses an unsafe address written straight to either invitation table", async () => {
    const ctx = await firm();
    const { matterId, personId } = await samplePerson(ctx);
    await asMaintenance(db);
    const hash = () => createHash("sha256").update(randomUUID()).digest("hex");
    for (const address of UNSAFE) {
      const lower = address.toLowerCase();
      await expectDbError(
        () =>
          db.query(
            `insert into public.invitations (organization_id, email, role, token_hash, expires_at)
             values ($1, $2, 'assistant', $3, now() + interval '1 day')`,
            [ctx.orgId, lower, hash()],
          ),
        /invitations_email_safe_chars/,
      );
      await expectDbError(
        () =>
          db.query(
            `insert into public.portal_invitations (organization_id, matter_id, person_id, role, email, token_hash, expires_at)
             values ($1, $2, $3, 'client', $4, $5, now() + interval '1 day')`,
            [ctx.orgId, matterId, personId, lower, hash()],
          ),
        /portal_invitations_email_safe_chars/,
      );
    }
    await db.query(
      `insert into public.invitations (organization_id, email, role, token_hash, expires_at)
       values ($1, $2, 'assistant', $3, now() + interval '1 day')`,
      [ctx.orgId, email("direct"), hash()],
    );
  });

  it("keeps the constraints NOT VALID so earlier rows are not re-checked", async () => {
    await asMaintenance(db);
    const rows = await db.query<{ conname: string; convalidated: boolean }>(
      `select conname, convalidated from pg_constraint
        where conname in ('invitations_email_safe_chars', 'portal_invitations_email_safe_chars') order by conname`,
    );
    expect(rows.rows).toEqual([
      { conname: "invitations_email_safe_chars", convalidated: false },
      { conname: "portal_invitations_email_safe_chars", convalidated: false },
    ]);
  });
});
