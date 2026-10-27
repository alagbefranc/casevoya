import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// Issue #259 fix 5: firm setup step 1 saved a new "Main office" on every Continue.
// 20261026120000 saves the primary office in place; 20261026120100 (destructive, review before
// applying) removes the identical duplicates the old function left.

const FIX = "20261026120000";
const CLEANUP = "20261026120100";

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function owner(db: TestDb) {
  await asMaintenance(db);
  const userId = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    userId,
    `owner-${userId.slice(0, 8)}@example.test`,
  ]);
  await asUser(db, { userId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", slug()]);
  const orgId = created.rows[0].id;
  return { userId, orgId };
}

async function saveOffice(db: TestDb, who: { userId: string; orgId: string }, address: string, locality: string, primary = true, label = "Main office") {
  await asUser(db, { userId: who.userId, aal: "aal2", orgId: who.orgId, totpAgeSeconds: 0 });
  const saved = await db.query<{ id: string }>(`select public.save_organization_office($1, $2, $3, 'ON', 'M5X 1A9', 'CA', $4) as id`, [
    label,
    address,
    locality,
    primary,
  ]);
  return saved.rows[0].id;
}

async function offices(db: TestDb, orgId: string) {
  await asMaintenance(db);
  const rows = await db.query<{ id: string; label: string; address_line: string; is_primary: boolean }>(
    `select id, label, address_line, is_primary from public.organization_offices where organization_id = $1 order by created_at, id`,
    [orgId],
  );
  return rows.rows;
}

describe("save_organization_office keeps one main office", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);
  afterAll(async () => {
    await db?.close();
  });

  it("Back then Continue updates the main office instead of adding another", async () => {
    const firm = await owner(db);
    const first = await saveOffice(db, firm, "100 King St W", "Toronto");
    const again = await saveOffice(db, firm, "100 King St W", "Toronto");
    const moved = await saveOffice(db, firm, "200 Bay St", "Toronto");
    expect(again).toBe(first);
    expect(moved).toBe(first);
    const rows = await offices(db, firm.orgId);
    expect(rows).toEqual([{ id: first, label: "Main office", address_line: "200 Bay St", is_primary: true }]);
  });

  it("still adds a second, non-primary office, and leaves other firms alone", async () => {
    const firm = await owner(db);
    const other = await owner(db);
    const main = await saveOffice(db, firm, "100 King St W", "Toronto");
    const otherMain = await saveOffice(db, other, "1 Main St", "Ottawa");
    await saveOffice(db, firm, "5 Elm St", "Hamilton", false, "Hamilton office");
    expect((await offices(db, firm.orgId)).map((row) => [row.id === main, row.is_primary])).toEqual([
      [true, true],
      [false, false],
    ]);
    expect(await offices(db, other.orgId)).toEqual([{ id: otherMain, label: "Main office", address_line: "1 Main St", is_primary: true }]);
  });

  it("is still the firm owner's, with two-step", async () => {
    const firm = await owner(db);
    await asUser(db, { userId: firm.userId, aal: "aal1", orgId: firm.orgId });
    await expectDbError(
      () => db.query(`select public.save_organization_office('Main office', '1 A St', 'Toronto', null, null, 'CA', true)`),
      /aal2|step-up|two-step|mfa|permission|denied/i,
    );
  });
});

describe("the duplicate-office cleanup (destructive, applied by Francis)", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb({ stopBefore: FIX });
  }, 120_000);
  afterAll(async () => {
    await db?.close();
  });

  it("removes only demoted Main office rows identical to the primary one, and keeps everything else", async () => {
    // The old function: every primary save demotes the main office and inserts a new one.
    const firm = await owner(db);
    await saveOffice(db, firm, "100 King St W", "Toronto");
    await saveOffice(db, firm, "100 King St W", "Toronto");
    await saveOffice(db, firm, "200 Bay St", "Toronto");
    const identical = await saveOffice(db, firm, "200 Bay St", "Toronto");
    const kept = await saveOffice(db, firm, "200 Bay St", "Toronto", false, "Bay St annex");
    const primary = await saveOffice(db, firm, "200 Bay St", "Toronto");
    const clean = await owner(db);
    const cleanMain = await saveOffice(db, clean, "1 Main St", "Ottawa");
    const before = await offices(db, firm.orgId);
    expect(before).toHaveLength(6);
    expect(before.filter((row) => row.is_primary).map((row) => row.id)).toEqual([primary]);

    await applyMigrationsFrom(db, FIX);

    const after = await offices(db, firm.orgId);
    // Kept: the primary, the two 100 King St W rows (they differ from it), the annex (another label).
    expect(after.map((row) => [row.address_line, row.label, row.is_primary])).toEqual([
      ["100 King St W", "Main office", false],
      ["100 King St W", "Main office", false],
      ["200 Bay St", "Bay St annex", false],
      ["200 Bay St", "Main office", true],
    ]);
    expect(after.map((row) => row.id)).not.toContain(identical);
    expect(after.map((row) => row.id)).toContain(kept);
    expect(after.find((row) => row.is_primary)?.id).toBe(primary);
    expect(await offices(db, clean.orgId)).toEqual([{ id: cleanMain, label: "Main office", address_line: "1 Main St", is_primary: true }]);

    // Each removal is in the audit log.
    const audit = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log where object_table = 'public.organization_offices' and action = 'organization_offices.delete' and object_id = $1`,
      [identical],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("is in its own file, after the function fix", () => {
    expect(CLEANUP > FIX).toBe(true);
  });
});
