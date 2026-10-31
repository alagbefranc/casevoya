import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261019207200_staff_connections.sql: per-staff Composio connections (owner or self only, never
 * tokens), the owner's firm-wide switch with its disclosure, and the calendar busy-time writer that
 * the existing slot engine reads.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function user(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `${label}-${randomUUID().slice(0, 8)}@example.test`]);
  return id;
}

async function member(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
    [orgId, userId, role],
  );
  return row.rows[0].id;
}

async function firm() {
  const owner = await user("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  const consultant = await user("consultant");
  const consultantMembership = await member(orgId, consultant, "licensed_consultant");
  const colleague = await user("colleague");
  await member(orgId, colleague, "case_manager");
  const finance = await user("finance");
  await member(orgId, finance, "finance_user");
  return { orgId, owner, consultant, consultantMembership, colleague, finance };
}

type Firm = Awaited<ReturnType<typeof firm>>;
const as = (f: Firm, userId: string) => asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 60 });

describe("connected accounts", () => {
  it("needs the owner to turn Composio on, with the disclosure accepted", async () => {
    const f = await firm();
    await as(f, f.consultant);
    await expectDbError(() => db.query(`select public.save_staff_connection($1, 'gmail', 'pending')`, [f.orgId]), /not turned on/);
    await expectDbError(() => db.query(`select public.set_composio_enabled($1, true, true)`, [f.orgId]), /staff access denied/);
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.set_composio_enabled($1, true, false)`, [f.orgId]), /disclosure/);
    await db.query(`select public.set_composio_enabled($1, true, true)`, [f.orgId]);
    const row = await db.query<{ composio_enabled: boolean; accepted: boolean; enabled: boolean }>(
      `select composio_enabled, composio_accepted_by = $2 as accepted, enabled from public.vo_settings where organization_id = $1`,
      [f.orgId, f.owner],
    );
    // Turning connected accounts on doesn't turn Vo itself on for a real firm.
    expect(row.rows[0]).toEqual({ composio_enabled: true, accepted: true, enabled: false });
  });

  it("keeps each member's connection to themselves and the owner, and stores no token", async () => {
    const f = await firm();
    const other = await firm();
    await as(f, f.owner);
    await db.query(`select public.set_composio_enabled($1, true, true)`, [f.orgId]);
    await as(f, f.consultant);
    const id = (await db.query<{ id: string }>(`select public.save_staff_connection($1, 'gmail', 'active', 'ca_synthetic123', 'Casevoya clients') as id`, [f.orgId])).rows[0].id;
    await expectDbError(() => db.query(`select public.save_staff_connection($1, 'gmail', 'active', 'ya29.not-an-id with spaces')`, [f.orgId]), /check constraint|violates/);
    await expectDbError(() => db.query(`select public.save_staff_connection($1, 'slack', 'active', 'ca_x123')`, [f.orgId]), /check constraint|violates/);
    const read = async () => (await db.query(`select id from public.staff_connections where id = $1`, [id])).rows.length;
    expect(await read()).toBe(1);
    await as(f, f.owner);
    expect(await read()).toBe(1);
    await as(f, f.colleague);
    expect(await read()).toBe(0);
    await expectDbError(() => db.query(`select public.disconnect_staff_connection($1)`, [id]), /connection denied/);
    await as(f, f.finance);
    expect(await read()).toBe(0);
    await as(other, other.owner);
    expect(await read()).toBe(0);
    await as(f, f.consultant);
    await expectDbError(() => db.query(`insert into public.staff_connections (organization_id, membership_id, toolkit, status) values ($1, $2, 'outlook', 'pending')`, [f.orgId, f.consultantMembership]), /permission denied/);
    const columns = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'staff_connections'`);
    expect(columns.rows.map((c) => c.column_name).some((name) => /token|secret|password/.test(name))).toBe(false);
    await as(f, f.owner);
    await db.query(`select public.disconnect_staff_connection($1)`, [id]);
  });
});

describe("calendar busy times", () => {
  it("replaces only the caller's own busy times from a connected calendar, which the slot engine reads", async () => {
    const f = await firm();
    await as(f, f.owner);
    await db.query(`select public.set_composio_enabled($1, true, true)`, [f.orgId]);
    await as(f, f.consultant);
    const blocks = JSON.stringify([
      { start: "2030-03-04T15:00:00Z", end: "2030-03-04T16:00:00Z" },
      { start: "2030-03-05T15:00:00Z", end: "2030-03-05T14:00:00Z" },
      { start: "2031-01-01T15:00:00Z", end: "2031-01-01T16:00:00Z" },
    ]);
    const args = [f.orgId, "2030-03-01T00:00:00Z", "2030-03-20T00:00:00Z", blocks];
    await expectDbError(() => db.query(`select public.replace_external_busy_blocks($1, 'google', $2, $3, $4::jsonb)`, args), /connect that calendar first/);
    await db.query(`select public.save_staff_connection($1, 'googlecalendar', 'active', 'ca_cal123')`, [f.orgId]);
    const added = await db.query<{ n: number }>(`select public.replace_external_busy_blocks($1, 'google', $2, $3, $4::jsonb) as n`, args);
    expect(added.rows[0].n).toBe(1);
    // Running it again replaces rather than duplicates.
    await db.query(`select public.replace_external_busy_blocks($1, 'google', $2, $3, $4::jsonb)`, args);
    await asMaintenance(db);
    const rows = await db.query<{ membership_id: string; source: string }>(`select membership_id, source from public.external_busy_blocks where organization_id = $1`, [f.orgId]);
    expect(rows.rows).toEqual([{ membership_id: f.consultantMembership, source: "google" }]);
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.replace_external_busy_blocks($1, 'google', $2, $3, $4::jsonb)`, args), /staff access denied/);
    // Disconnecting removes that calendar's busy times.
    await as(f, f.consultant);
    const conn = (await db.query<{ id: string }>(`select id from public.staff_connections where toolkit = 'googlecalendar'`)).rows[0].id;
    await db.query(`select public.disconnect_staff_connection($1)`, [conn]);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.external_busy_blocks where organization_id = $1`, [f.orgId])).rows).toHaveLength(0);
  });
});

describe("turning connected accounts off (#299)", () => {
  it("ends every connection of the firm, removes their busy times, and refuses further syncs", async () => {
    const f = await firm();
    const other = await firm();
    for (const firmRow of [f, other]) {
      await as(firmRow, firmRow.owner);
      await db.query(`select public.set_composio_enabled($1, true, true)`, [firmRow.orgId]);
      await as(firmRow, firmRow.consultant);
      await db.query(`select public.save_staff_connection($1, 'googlecalendar', 'active', 'ca_cal123')`, [firmRow.orgId]);
      await db.query(`select public.save_staff_connection($1, 'gmail', 'active', 'ca_mail123', 'Casevoya clients')`, [firmRow.orgId]);
    }
    const blocks = JSON.stringify([{ start: "2030-03-04T15:00:00Z", end: "2030-03-04T16:00:00Z" }]);
    const args = [f.orgId, "2030-03-01T00:00:00Z", "2030-03-20T00:00:00Z", blocks];
    await as(f, f.consultant);
    await db.query(`select public.replace_external_busy_blocks($1, 'google', $2, $3, $4::jsonb)`, args);
    const ready = await db.query<{ r: { mail_label: string } }>(`select public.composio_connection_ready($1, 'gmail') as r`, [f.orgId]);
    expect(ready.rows[0].r.mail_label).toBe("Casevoya clients");
    await expectDbError(() => db.query(`select public.composio_connection_ready($1, 'outlook')`, [f.orgId]), /connect that account first/);
    await as(f, f.finance);
    await expectDbError(() => db.query(`select public.composio_connection_ready($1, 'gmail')`, [f.orgId]), /staff access denied/);

    await as(f, f.owner);
    await db.query(`select public.set_composio_enabled($1, false, false)`, [f.orgId]);
    await asMaintenance(db);
    const statuses = await db.query<{ organization_id: string; status: string }>(
      `select organization_id, status from public.staff_connections where organization_id = any ($1::uuid[])`,
      [[f.orgId, other.orgId]],
    );
    expect(statuses.rows.filter((row) => row.organization_id === f.orgId).every((row) => row.status === "disconnected")).toBe(true);
    expect(statuses.rows.filter((row) => row.organization_id === other.orgId).every((row) => row.status === "active")).toBe(true);
    expect((await db.query(`select 1 from public.external_busy_blocks where organization_id = $1`, [f.orgId])).rows).toHaveLength(0);

    await as(f, f.consultant);
    await expectDbError(() => db.query(`select public.composio_connection_ready($1, 'gmail')`, [f.orgId]), /not turned on/);
    await expectDbError(() => db.query(`select public.composio_connection_ready($1)`, [f.orgId]), /not turned on/);
    await expectDbError(() => db.query(`select public.replace_external_busy_blocks($1, 'google', $2, $3, $4::jsonb)`, args), /not turned on/);

    // The other firm is unaffected.
    await as(other, other.consultant);
    const otherReady = await db.query<{ r: { mail_label: string } }>(`select public.composio_connection_ready($1, 'gmail') as r`, [other.orgId]);
    expect(otherReady.rows[0].r.mail_label).toBe("Casevoya clients");
  });
});
