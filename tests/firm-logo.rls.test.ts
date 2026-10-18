import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmLogoKey, firmLogoLocator } from "@/modules/firm-onboarding/firm-logo";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

async function createUser() {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, now(), '{}'::jsonb)`,
    [id, `owner-${id.slice(0, 8)}@example.test`],
  );
  return id;
}

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(
    `select (public.create_organization($1, $2, $3)).id as id`,
    ["Synthetic Legal Name", "Synthetic Firm", `f${randomUUID().replaceAll("-", "").slice(0, 12)}`],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new Error("organization was not created");
  return id;
}

async function saveBranding(owner: string, orgId: string, logoLocator: string) {
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.save_firm_setup('branding', $1::jsonb)`, [
    JSON.stringify({ acknowledged: "true", logo_locator: logoLocator, accent: "#0a4b93" }),
  ]);
}

async function branding(orgId: string) {
  await asMaintenance(db);
  const row = await db.query<{ branding: Record<string, string> }>(`select branding from public.organizations where id = $1`, [orgId]);
  return row.rows[0]?.branding;
}

describe("firm logos", () => {
  it("keeps logo files in a private bucket", async () => {
    const bucket = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'firm-logos'`);
    expect(bucket.rows).toEqual([{ public: false }]);
  });

  it("saves the firm's own stored logo with the branding step", async () => {
    const owner = await createUser();
    const orgId = await createOrg(owner);
    const locator = firmLogoLocator(firmLogoKey(orgId, randomUUID(), "image/png"));
    await saveBranding(owner, orgId, locator);
    expect(await branding(orgId)).toEqual({ logo_locator: locator, accent: "#0a4b93" });

    await saveBranding(owner, orgId, "");
    expect(await branding(orgId)).toEqual({ accent: "#0a4b93" });
  });

  it("refuses a logo locator that is not this firm's own file", async () => {
    const owner = await createUser();
    const orgId = await createOrg(owner);
    const otherOrg = await createOrg(await createUser());
    for (const locator of [
      firmLogoLocator(firmLogoKey(otherOrg, randomUUID(), "image/png")),
      `licence-proofs/${orgId}/${randomUUID()}/${randomUUID()}.png`,
      `firm-logos/${orgId}/${randomUUID()}.svg`,
      `firm-logos/${orgId}/../x.png`,
      "https://example.test/logo.png",
    ]) {
      await expectDbError(() => saveBranding(owner, orgId, locator), /organizations_branding_logo_ck/);
    }
    expect(await branding(orgId)).toEqual({});
  });
});
