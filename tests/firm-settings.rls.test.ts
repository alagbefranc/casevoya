import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/** Settings > Firm, Offices and Language and time (20261019211000_firm_settings.sql). */
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
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, `user-${id.slice(0, 8)}@example.test`],
  );
  return id;
}

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const id = created.rows[0]?.id;
  if (!id) throw new Error("organization was not created");
  return id;
}

async function addStaff(orgId: string, owner: string, role: string) {
  const user = await createUser();
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, $3, 'active', now(), $4)`,
    [orgId, user, role, owner],
  );
  return user;
}

/** Signed in with two-step; `fresh` is a step-up inside the window. */
async function as(userId: string, orgId: string, fresh = true) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: fresh ? 0 : 60 * 60 });
}

async function firm(orgId: string) {
  await asMaintenance(db);
  const row = await db.query<Record<string, string | null>>(
    `select legal_name, display_name, billing_contact_name, billing_contact_email, privacy_contact_name, privacy_contact_email,
            continuity_contact_name, continuity_contact_email, timezone
       from public.organizations where id = $1`,
    [orgId],
  );
  return row.rows[0];
}

async function audits(orgId: string, action: string) {
  await asMaintenance(db);
  const rows = await db.query<{ context: Record<string, unknown> }>(
    `select context from public.audit_log where organization_id = $1 and action = $2 order by occurred_at`,
    [orgId, action],
  );
  return rows.rows.map((row) => row.context);
}

const saveOffice = (orgId: string, officeId: string | null, label: string, primary: boolean, zone: string | null = null) =>
  db.query<{ id: string }>(`select public.save_firm_office($1, $2, $3, '1 Synthetic St', 'Toronto', 'ON', 'M5V 1A1', 'ca', $4, $5) as id`, [
    orgId,
    officeId,
    label,
    zone,
    primary,
  ]);

describe("firm settings", () => {
  it("lets the firm owner change only the firm details given, and audits the field names", async () => {
    const owner = await createUser();
    const orgId = await createOrg(owner);
    await as(owner, orgId);
    await db.query(`select public.update_firm_profile($1, $2::jsonb)`, [
      orgId,
      JSON.stringify({
        legal_name: "  Synthetic Legal Inc.  ",
        billing_contact_name: "Billing Person",
        billing_contact_email: "Billing@Example.TEST",
        continuity_contact_name: "Continuity Person",
        continuity_contact_email: "continuity@example.test",
        timezone: "America/Vancouver",
      }),
    ]);
    expect(await firm(orgId)).toMatchObject({
      legal_name: "Synthetic Legal Inc.",
      display_name: "Synthetic Firm",
      billing_contact_name: "Billing Person",
      billing_contact_email: "billing@example.test",
      continuity_contact_name: "Continuity Person",
      continuity_contact_email: "continuity@example.test",
      timezone: "America/Vancouver",
    });
    const logged = await audits(orgId, "firm.profile_updated");
    expect(logged.at(-1)).toEqual({
      fields: ["billing_contact_email", "billing_contact_name", "continuity_contact_email", "continuity_contact_name", "legal_name", "timezone"],
    });
    expect(JSON.stringify(logged)).not.toContain("Billing Person");

    // The continuity contact can be cleared; the required names cannot.
    await as(owner, orgId);
    await db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, JSON.stringify({ continuity_contact_name: "", continuity_contact_email: "" })]);
    expect(await firm(orgId)).toMatchObject({ continuity_contact_name: null, continuity_contact_email: null });
    await as(owner, orgId);
    await expectDbError(() => db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, JSON.stringify({ display_name: "  " })]), /display name is required/);
    await as(owner, orgId);
    await expectDbError(() => db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, JSON.stringify({ privacy_contact_email: "not an email" })]), /privacy contact email/);
    await as(owner, orgId);
    await expectDbError(() => db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, JSON.stringify({ timezone: "Mars/Olympus" })]), /timezone is not usable/);
    await as(owner, orgId);
    await expectDbError(() => db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, JSON.stringify({ sample_mode: "false" })]), /unknown firm detail/);
    await as(owner, orgId);
    await expectDbError(() => db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, JSON.stringify({ verification_status: "verified" })]), /unknown firm detail/);
  });

  it("saves the firm's default language for new clients (ORG-01), English or French only", async () => {
    const owner = await createUser();
    const orgId = await createOrg(owner);
    await as(owner, orgId);
    await db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, JSON.stringify({ default_locale: "fr-CA" })]);
    await asMaintenance(db);
    const saved = await db.query<{ default_locale: string }>(`select default_locale from public.organizations where id = $1`, [orgId]);
    expect(saved.rows[0].default_locale).toBe("fr-CA");
    expect((await audits(orgId, "firm.profile_updated")).at(-1)).toEqual({ fields: ["default_locale"] });
    await as(owner, orgId);
    await expectDbError(() => db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, JSON.stringify({ default_locale: "es-MX" })]), /language is not usable/);
    await as(owner, orgId, false);
    await expectDbError(() => db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, JSON.stringify({ default_locale: "en-CA" })]), /step|two-step|confirm/i);
  });

  it("refuses firm details without a fresh step-up, from other roles, and across firms", async () => {
    const owner = await createUser();
    const orgId = await createOrg(owner);
    const consultant = await addStaff(orgId, owner, "licensed_consultant");
    const otherOwner = await createUser();
    const otherOrg = await createOrg(otherOwner);
    const change = JSON.stringify({ display_name: "Forged" });

    await as(owner, orgId, false);
    await expectDbError(() => db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, change]), /step-up/);
    await as(consultant, orgId);
    await expectDbError(() => db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, change]), /step-up/);
    // Another firm's owner, naming this firm while signed in to their own.
    await as(otherOwner, otherOrg);
    await expectDbError(() => db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, change]), /step-up/);
    await as(otherOwner, orgId);
    await expectDbError(() => db.query(`select public.update_firm_profile($1, $2::jsonb)`, [orgId, change]), /step-up/);
    expect((await firm(orgId))?.display_name).toBe("Synthetic Firm");
  });

  it("adds, edits and removes offices with their own timezone; the main office stays", async () => {
    const owner = await createUser();
    const orgId = await createOrg(owner);
    await as(owner, orgId);
    const main = (await saveOffice(orgId, null, "Toronto", true)).rows[0].id;
    await as(owner, orgId);
    const second = (await saveOffice(orgId, null, "Vancouver", false, "America/Vancouver")).rows[0].id;
    await as(owner, orgId);
    await saveOffice(orgId, second, "Vancouver (remote)", false, "America/Vancouver");

    await asMaintenance(db);
    const rows = await db.query<{ id: string; label: string; timezone: string | null; is_primary: boolean; country_code: string }>(
      `select id, label, timezone, is_primary, country_code from public.organization_offices where organization_id = $1 order by label`,
      [orgId],
    );
    expect(rows.rows).toEqual([
      { id: main, label: "Toronto", timezone: null, is_primary: true, country_code: "CA" },
      { id: second, label: "Vancouver (remote)", timezone: "America/Vancouver", is_primary: false, country_code: "CA" },
    ]);

    // The main office can't stop being main by itself, and can't be removed.
    await as(owner, orgId);
    await expectDbError(() => saveOffice(orgId, main, "Toronto", false), /another main office/);
    await as(owner, orgId);
    await expectDbError(() => db.query(`select public.remove_firm_office($1, $2)`, [orgId, main]), /main office cannot be removed/);
    await as(owner, orgId);
    await expectDbError(() => saveOffice(orgId, null, "Nowhere", false, "Not/A_Zone"), /timezone is not usable/);

    // Making another office main moves the flag.
    await as(owner, orgId);
    await saveOffice(orgId, second, "Vancouver (remote)", true, "America/Vancouver");
    await as(owner, orgId);
    await db.query(`select public.remove_firm_office($1, $2)`, [orgId, main]);
    await asMaintenance(db);
    const left = await db.query<{ id: string; is_primary: boolean }>(`select id, is_primary from public.organization_offices where organization_id = $1`, [orgId]);
    expect(left.rows).toEqual([{ id: second, is_primary: true }]);
    expect((await audits(orgId, "firm.office_saved")).length).toBe(4);
    expect((await audits(orgId, "firm.office_removed")).length).toBe(1);
  });

  it("refuses office changes without step-up, from other roles, and to another firm's office", async () => {
    const owner = await createUser();
    const orgId = await createOrg(owner);
    const assistant = await addStaff(orgId, owner, "assistant");
    const otherOwner = await createUser();
    const otherOrg = await createOrg(otherOwner);
    await as(otherOwner, otherOrg);
    const foreign = (await saveOffice(otherOrg, null, "Foreign", true)).rows[0].id;

    await as(owner, orgId, false);
    await expectDbError(() => saveOffice(orgId, null, "Toronto", true), /step-up/);
    await as(assistant, orgId);
    await expectDbError(() => saveOffice(orgId, null, "Toronto", true), /step-up/);
    // Naming another firm's office from this firm.
    await as(owner, orgId);
    await expectDbError(() => saveOffice(orgId, foreign, "Hijacked", true), /office not found/);
    await as(owner, orgId);
    await expectDbError(() => db.query(`select public.remove_firm_office($1, $2)`, [orgId, foreign]), /office not found/);
    await asMaintenance(db);
    const untouched = await db.query<{ label: string }>(`select label from public.organization_offices where id = $1`, [foreign]);
    expect(untouched.rows).toEqual([{ label: "Foreign" }]);
    // Writes only through the functions.
    await as(owner, orgId);
    await expectDbError(
      () => db.query(`insert into public.organization_offices (organization_id, label, address_line, locality) values ($1, 'Direct', '1 St', 'Toronto')`, [orgId]),
      /permission denied/,
    );
  });

  it("lets each staff member set only their own timezone", async () => {
    const owner = await createUser();
    const orgId = await createOrg(owner);
    const manager = await addStaff(orgId, owner, "case_manager");
    await as(manager, orgId, false);
    await db.query(`select public.set_my_timezone($1, 'Asia/Kolkata')`, [orgId]);
    await asMaintenance(db);
    const zones = await db.query<{ id: string; timezone: string }>(`select id, timezone from public.profiles where id = any($1::uuid[]) order by id`, [[owner, manager]]);
    expect(Object.fromEntries(zones.rows.map((row) => [row.id, row.timezone]))).toEqual({ [owner]: "America/Toronto", [manager]: "Asia/Kolkata" });
    expect(await audits(orgId, "profile.timezone_changed")).toEqual([{ timezone: "Asia/Kolkata" }]);

    await as(manager, orgId);
    await expectDbError(() => db.query(`select public.set_my_timezone($1, 'Nowhere/Land')`, [orgId]), /timezone is not usable/);
    // A client of the firm is not staff.
    const client = await addStaff(orgId, owner, "client");
    await as(client, orgId);
    await expectDbError(() => db.query(`select public.set_my_timezone($1, 'Asia/Kolkata')`, [orgId]), /staff access denied/);
    // Without two-step sign-in.
    await asUser(db, { userId: manager, aal: "aal1", orgId });
    await expectDbError(() => db.query(`select public.set_my_timezone($1, 'Asia/Kolkata')`, [orgId]), /staff access denied/);
  });
});
