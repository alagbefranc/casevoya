import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rowsDigest, sha256Hex } from "@/modules/migration/csv";
import { ISO_COUNTRY_CODES } from "@/lib/iso-country";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261020011000_practice_settings_fixes.sql: offices refuse a non-ISO country and a duplicate new
 * office; migration import joins a second name column, skips an exact copy of an earlier row
 * instead of adding a person, and reads an ISO date with a time. Synthetic data only.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
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

async function createOrg(owner: string) {
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  return created.rows[0].id;
}

const as = (userId: string, orgId: string, stepUp = true) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: stepUp ? 0 : 3600 });

async function rpc<T = unknown>(sql: string, params: unknown[]): Promise<T> {
  const result = await db.query<{ r: T }>(`select ${sql} as r`, params);
  return result.rows[0].r;
}

const saveOffice = (orgId: string, label: string, country: string, street = "1 Synthetic St") =>
  db.query(`select public.save_firm_office($1, null, $2, $3, 'Toronto', 'ON', 'M5V 1A1', $4, null, false)`, [orgId, label, street, country]);

describe("app.is_iso_country", () => {
  it("matches the app's list of 249 ISO 3166-1 alpha-2 codes exactly", async () => {
    await asMaintenance(db);
    const all = await db.query<{ code: string; ok: boolean }>(
      `select code, app.is_iso_country(code) as ok from unnest($1::text[]) code`,
      [[...ISO_COUNTRY_CODES]],
    );
    expect(all.rows.every((row) => row.ok)).toBe(true);
    const bad = await db.query<{ ok: boolean }>(`select bool_or(app.is_iso_country(code)) as ok from unnest(array['XX','ZZ','EU','UK','ca','']) code`);
    expect(bad.rows[0].ok).toBe(false);
  });
});

describe("offices", () => {
  it("refuses a country that isn't an ISO code, and a second save of the same new office", async () => {
    const owner = await createUser("owner");
    const orgId = await createOrg(owner);
    await as(owner, orgId);
    await expectDbError(() => saveOffice(orgId, "Vancouver", "XX"), /ISO 3166/);
    await as(owner, orgId);
    await saveOffice(orgId, "Vancouver", "ca");
    await as(owner, orgId);
    // Same name, street and city, any case or spacing: refused.
    await expectDbError(() => saveOffice(orgId, "  vancouver ", "CA", "1  synthetic st"), /already saved/);
    await as(owner, orgId);
    await saveOffice(orgId, "Vancouver", "CA", "2 Other St");
    await asMaintenance(db);
    const count = await db.query<{ n: number }>(`select count(*)::int as n from public.organization_offices where organization_id = $1 and label ilike 'vancouver'`, [orgId]);
    expect(count.rows[0].n).toBe(2);
  });

  it("still needs the firm owner with a step-up", async () => {
    const owner = await createUser("owner");
    const orgId = await createOrg(owner);
    await as(owner, orgId, false);
    await expectDbError(() => saveOffice(orgId, "Ottawa", "CA"), /step-up/);
  });
});

describe("migration import fixes", () => {
  const HEADERS = ["First name", "Last name", "DOB", "Email", "File #", "Role"];

  async function stagedFirm(rows: string[][]) {
    const owner = await createUser("owner");
    const orgId = await createOrg(owner);
    await as(owner, orgId);
    const batch = await rpc<string>(`public.stage_migration_batch($1, $2, $3, $4, $5, $6, $7)`, [
      orgId,
      "clients.csv",
      await sha256Hex("synthetic file bytes"),
      2048,
      rows.length,
      await rowsDigest(rows),
      HEADERS,
    ]);
    await rpc(`public.append_migration_rows($1, $2, 2, $3)`, [orgId, batch, JSON.stringify(rows)]);
    await rpc(`public.seal_migration_batch($1, $2)`, [orgId, batch]);
    return { owner, orgId, batch };
  }

  async function planOf(orgId: string, batch: string) {
    await asMaintenance(db);
    const rows = await db.query<{ row_number: number; plan: string; name: string | null; dob: string | null; problems: { problem: string }[] }>(
      `select row_number, plan::text as plan, normalized ->> 'name' as name, normalized ->> 'date_of_birth' as dob, problems
         from public.migration_rows where batch_id = $1 order by row_number`,
      [batch],
    );
    return rows.rows;
  }

  it("joins first and last name, skips an exact copy of an earlier row, and reads ISO dates with a time", async () => {
    const rows = [
      ["Priya", "Sharma", "1990-05-14 00:00:00", "priya@example.test", "OLD-1", "applicant"],
      ["Priya", "Sharma", "1990-05-14 00:00:00", "priya@example.test", "OLD-1", "applicant"],
      ["Rafael", "Sharma", "1988-03-02T00:00:00Z", "", "OLD-1", "sponsor"],
    ];
    const { owner, orgId, batch } = await stagedFirm(rows);
    await as(owner, orgId);
    await rpc(`public.save_migration_mapping($1, $2, $3)`, [
      orgId,
      batch,
      JSON.stringify({ columns: { name: 0, name_extra: 1, date_of_birth: 2, email: 3, reference: 4, role: 5 }, date_order: "ymd", default_consultant: null, values: {} }),
    ]);
    await as(owner, orgId);
    await rpc(`public.run_migration_dry_run($1, $2)`, [orgId, batch]);
    const plan = await planOf(orgId, batch);
    expect(plan[0]).toMatchObject({ name: "Priya Sharma", dob: "1990-05-14" });
    expect(plan[1].plan).toBe("skip");
    expect(plan[1].problems.map((item) => item.problem)).toEqual(["An exact copy of row 2"]);
    expect(plan[2]).toMatchObject({ name: "Rafael Sharma", dob: "1988-03-02" });
    // The copy isn't a second applicant on the matter.
    expect(JSON.stringify(plan)).not.toContain("A second applicant");
  });

  it("refuses an unknown column key still, and a column used twice", async () => {
    const { owner, orgId, batch } = await stagedFirm([["Ana", "Diaz", "", "", "", ""]]);
    await as(owner, orgId);
    await expectDbError(
      () => rpc(`public.save_migration_mapping($1, $2, $3)`, [orgId, batch, JSON.stringify({ columns: { name: 0, nickname: 1 }, date_order: "dmy", default_consultant: null, values: {} })]),
      /mapping is not valid/,
    );
    await as(owner, orgId);
    await expectDbError(
      () => rpc(`public.save_migration_mapping($1, $2, $3)`, [orgId, batch, JSON.stringify({ columns: { name: 0, name_extra: 0 }, date_order: "dmy", default_consultant: null, values: {} })]),
      /one field/,
    );
  });

  it("keeps the mapping to the firm owner: another firm's owner can't map this import", async () => {
    const { orgId, batch } = await stagedFirm([["Ana", "Diaz", "", "", "", ""]]);
    const other = await createUser("other");
    const otherOrg = await createOrg(other);
    await as(other, otherOrg);
    await expectDbError(
      () => rpc(`public.save_migration_mapping($1, $2, $3)`, [orgId, batch, JSON.stringify({ columns: { name: 0, name_extra: 1 }, date_order: "dmy", default_consultant: null, values: {} })]),
      /denied|not found|staff access/,
    );
  });
});
