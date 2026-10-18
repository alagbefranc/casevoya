import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, countOf, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// The Staff tab of the Designer's People and invitations page reads the team through
// public.firm_staff_directory (20261018160000_firm_staff_directory.sql) and invites through
// public.create_staff_invitation (latest: 20261017200100_outbound_email.sql).

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

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function createUser(label: string, name?: string) {
  await asMaintenance(db);
  const id = randomUUID();
  const address = `${label}-${id.slice(0, 8)}@example.test`;
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3::jsonb)`,
    [id, address, JSON.stringify(name ? { display_name: name } : {})],
  );
  return { id, email: address };
}

async function membership(orgId: string, userId: string, role: string, status = "active") {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, revoked_at)
     values ($1, $2, $3::public.org_role, $4::public.membership_status, now(), case when $4 = 'revoked' then now() end)
     returning id`,
    [orgId, userId, role, status],
  );
  return inserted.rows[0].id;
}

async function verifiedFactor(userId: string) {
  await asMaintenance(db);
  await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', 'verified')`, [
    randomUUID(),
    userId,
  ]);
}

type Row = {
  membership_id: string;
  display_name: string | null;
  email: string | null;
  role: string;
  status: string;
  is_licensed: boolean;
  two_step: boolean | null;
  is_self: boolean;
};

async function directory(userId: string, orgId: string, aal: "aal1" | "aal2" = "aal2") {
  await asUser(db, { userId, aal, orgId, totpAgeSeconds: aal === "aal2" ? 0 : undefined });
  const result = await db.query<Row>(`select * from public.firm_staff_directory($1)`, [orgId]);
  return result.rows;
}

async function firm() {
  const owner = await createUser("owner", "Synthetic Owner");
  const consultant = await createUser("consultant", "Synthetic Consultant");
  const assistant = await createUser("assistant", "Synthetic Assistant");
  const client = await createUser("client", "Synthetic Client");
  const former = await createUser("former", "Synthetic Former");
  await asUser(db, { userId: owner.id, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    slug(),
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await membership(orgId, consultant.id, "licensed_consultant");
  const assistantMembership = await membership(orgId, assistant.id, "assistant");
  const clientMembership = await membership(orgId, client.id, "client");
  const formerMembership = await membership(orgId, former.id, "case_manager", "revoked");
  await verifiedFactor(consultant.id);
  return { orgId, owner, consultant, assistant, client, consultantMembership, assistantMembership, clientMembership, formerMembership };
}

describe("firm_staff_directory", () => {
  it("lists the firm's staff with emails and two-step status for a firm owner", async () => {
    const ctx = await firm();
    const rows = await directory(ctx.owner.id, ctx.orgId);
    const ids = rows.map((row) => row.membership_id);
    expect(rows[0].role).toBe("firm_owner");
    expect(rows[0].is_self).toBe(true);
    expect(rows[0].email).toBe(ctx.owner.email);
    expect(ids).toContain(ctx.consultantMembership);
    expect(ids).toContain(ctx.assistantMembership);
    // Portal people and revoked staff are not on the team list.
    expect(ids).not.toContain(ctx.clientMembership);
    expect(ids).not.toContain(ctx.formerMembership);
    const consultant = rows.find((row) => row.membership_id === ctx.consultantMembership);
    expect(consultant).toMatchObject({
      display_name: "Synthetic Consultant",
      email: ctx.consultant.email,
      role: "licensed_consultant",
      is_licensed: true,
      two_step: true,
      is_self: false,
    });
    const assistant = rows.find((row) => row.membership_id === ctx.assistantMembership);
    expect(assistant).toMatchObject({ is_licensed: false, two_step: false });
  });

  it("gives other staff names and roles but no emails or two-step status", async () => {
    const ctx = await firm();
    const rows = await directory(ctx.assistant.id, ctx.orgId);
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.email).toBeNull();
      expect(row.two_step).toBeNull();
    }
    expect(rows.find((row) => row.is_self)?.membership_id).toBe(ctx.assistantMembership);
  });

  it("refuses a portal member, another firm's staff, and a session without aal2", async () => {
    const ctx = await firm();
    const other = await firm();
    await expectDbError(() => directory(ctx.client.id, ctx.orgId), /staff access denied/);
    await expectDbError(() => directory(other.owner.id, ctx.orgId), /staff access denied/);
    await expectDbError(() => directory(ctx.owner.id, ctx.orgId, "aal1"), /staff access denied/);
  });

  it("is not callable by anon", async () => {
    await asMaintenance(db);
    const grants = await db.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'public.firm_staff_directory(uuid)', 'execute') as ok`,
    );
    expect(grants.rows[0].ok).toBe(false);
  });
});

describe("create_staff_invitation from the Staff tab", () => {
  it("lets a firm owner with a fresh step-up invite each staff role, and queues the invitation email", async () => {
    const ctx = await firm();
    for (const role of ["licensed_consultant", "case_manager", "assistant", "finance_user"]) {
      await asUser(db, { userId: ctx.owner.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
      const address = `new-${role}-${randomUUID().slice(0, 6)}@example.test`;
      const token = await db.query<{ token: string }>(
        `select public.create_staff_invitation($1, $2, $3::public.org_role) as token`,
        [ctx.orgId, address, role],
      );
      expect(token.rows[0].token).toMatch(/^[0-9a-f]{64}$/);
      await asMaintenance(db);
      const invite = await db.query<{ id: string; expires_in_days: number }>(
        `select id, round(extract(epoch from (expires_at - created_at)) / 86400)::int as expires_in_days
         from public.invitations where organization_id = $1 and email = $2 and role = $3::public.org_role`,
        [ctx.orgId, address, role],
      );
      expect(invite.rows[0].expires_in_days).toBe(7);
      const outbox = await db.query<{ n: number; payload: Record<string, unknown> }>(
        `select count(*) over () as n, payload from public.outbox_events
         where organization_id = $1 and event_type = 'staff_invitation.email_requested' and aggregate_id = $2`,
        [ctx.orgId, invite.rows[0].id],
      );
      expect(countOf(outbox.rows[0].n)).toBe(1);
      // The raw token never goes into the outbox.
      expect(JSON.stringify(outbox.rows[0].payload)).not.toContain(token.rows[0].token);
    }
  });

  it("refuses staff who are not owners, an owner without a recent step-up, and portal roles", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.assistant.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.create_staff_invitation($1, 'x@example.test', 'assistant')`, [ctx.orgId]),
      /only a firm owner/,
    );
    await asUser(db, { userId: ctx.owner.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(
      () => db.query(`select public.create_staff_invitation($1, 'x@example.test', 'assistant')`, [ctx.orgId]),
      /step-up/,
    );
    await asUser(db, { userId: ctx.owner.id, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.create_staff_invitation($1, 'x@example.test', 'client')`, [ctx.orgId]),
      /staff roles only/,
    );
  });
});
