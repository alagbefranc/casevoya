import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VO_VENDOR_TERMS } from "@/modules/vo/vendor-terms";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261025260000_vo_vendor_terms_ack.sql (PRD AI-06): the firm owner acknowledges the AI vendor
 * terms (who, when, which version, audited) before Vo is turned on; turning Vo on without it is
 * refused on every path; other switches, turning Vo off and a sample-mode firm's default are not
 * affected; acknowledgements stay inside the firm and can't be written directly.
 */
let db: TestDb;
const VERSION = VO_VENDOR_TERMS.version;

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
  await db.query(`insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now())`, [orgId, userId, role]);
}

async function firm(sample = false) {
  const owner = await user("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = $2 where id = $1`, [orgId, sample]);
  const consultant = await user("consultant");
  await member(orgId, consultant, "licensed_consultant");
  const finance = await user("finance");
  await member(orgId, finance, "finance_user");
  return { orgId, owner, consultant, finance };
}

type Firm = Awaited<ReturnType<typeof firm>>;
const as = (f: Firm, userId: string) => asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 60 });

const setVo = (f: Firm, changes: Record<string, boolean>) => db.query(`select public.set_vo_settings($1, $2::jsonb)`, [f.orgId, JSON.stringify(changes)]);
const acknowledge = (f: Firm, version = VERSION) => db.query<{ r: { terms_version: string; already: boolean } }>(`select public.acknowledge_vo_vendor_terms($1, $2) as r`, [f.orgId, version]);

async function enabled(f: Firm) {
  await asMaintenance(db);
  const row = await db.query<{ enabled: boolean | null }>(`select (select enabled from public.vo_settings where organization_id = $1) as enabled`, [f.orgId]);
  return row.rows[0].enabled;
}

describe("AI vendor terms version", () => {
  it("is the same in the database and in the reviewed configuration", async () => {
    await asMaintenance(db);
    const row = await db.query<{ v: string }>(`select app.vo_vendor_terms_version() as v`);
    expect(row.rows[0].v).toBe(VERSION);
  });
});

describe("acknowledging the AI vendor terms", () => {
  it("is the firm owner's, for the current version only, recorded with who, when and which version, and audited once", async () => {
    const f = await firm();
    await as(f, f.consultant);
    await expectDbError(() => acknowledge(f), /staff access denied/);
    await as(f, f.finance);
    await expectDbError(() => acknowledge(f), /staff access denied/);
    // Without a fresh second factor the owner isn't staff-assured.
    await asUser(db, { userId: f.owner, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => acknowledge(f), /staff access denied/);
    await as(f, f.owner);
    await expectDbError(() => acknowledge(f, "2020-01-01.1"), /terms changed/);
    const first = await acknowledge(f);
    expect(first.rows[0].r).toMatchObject({ terms_version: VERSION, already: false });
    const again = await acknowledge(f);
    expect(again.rows[0].r).toMatchObject({ terms_version: VERSION, already: true });
    await asMaintenance(db);
    const rows = await db.query<{ terms_version: string; by_owner: boolean; at: boolean }>(
      `select terms_version, acknowledged_by = $2 as by_owner, acknowledged_at is not null as at from public.vo_vendor_terms_acknowledgements where organization_id = $1`,
      [f.orgId, f.owner],
    );
    expect(rows.rows).toEqual([{ terms_version: VERSION, by_owner: true, at: true }]);
    const audit = await db.query<{ n: number; version: string }>(
      `select count(*)::int as n, max(context ->> 'terms_version') as version from public.audit_log where organization_id = $1 and action = 'vo.vendor_terms_acknowledged'`,
      [f.orgId],
    );
    expect(audit.rows[0]).toEqual({ n: 1, version: VERSION });
  });

  it("is readable by the firm's staff with two-step sign-in only, never across firms, and never written directly", async () => {
    const f = await firm();
    const other = await firm();
    await as(f, f.owner);
    await acknowledge(f);
    const count = () => db.query<{ n: number }>(`select count(*)::int as n from public.vo_vendor_terms_acknowledgements`).then((r) => r.rows[0].n);
    await as(f, f.consultant);
    expect(await count()).toBe(1);
    // The same readers as the Vo switches themselves (vo_settings): the firm's staff, with two-step sign-in.
    await as(f, f.finance);
    expect(await count()).toBe(1);
    await asUser(db, { userId: f.consultant, aal: "aal1", orgId: f.orgId });
    expect(await count()).toBe(0);
    await as(other, other.owner);
    expect(await count()).toBe(0);
    await as(f, f.owner);
    await expectDbError(
      () => db.query(`insert into public.vo_vendor_terms_acknowledgements (organization_id, terms_version, acknowledged_by) values ($1, $2, $3)`, [other.orgId, VERSION, f.owner]),
      /permission denied/,
    );
    await expectDbError(() => db.query(`update public.vo_vendor_terms_acknowledgements set acknowledged_at = now() where organization_id = $1`, [f.orgId]), /permission denied/);
    await expectDbError(() => db.query(`delete from public.vo_vendor_terms_acknowledgements where organization_id = $1`, [f.orgId]), /permission denied/);
    // Acknowledging for another firm is refused.
    await expectDbError(() => acknowledge(other), /staff access denied/);
  });
});

describe("turning Vo on", () => {
  it("is refused until the owner acknowledged the current terms, then works; off and the other switches never need it", async () => {
    const f = await firm();
    await as(f, f.owner);
    await expectDbError(() => setVo(f, { enabled: true }), /acknowledge the AI vendor terms/);
    expect(await enabled(f)).toBeNull();
    // Other switches and turning Vo off work without it.
    await as(f, f.owner);
    await setVo(f, { reply_drafts: false, read_identity: true });
    await setVo(f, { enabled: false });
    expect(await enabled(f)).toBe(false);
    await as(f, f.owner);
    await expectDbError(() => setVo(f, { enabled: true, reply_drafts: true }), /acknowledge the AI vendor terms/);
    await acknowledge(f);
    await setVo(f, { enabled: true });
    expect(await enabled(f)).toBe(true);
    // Off and on again: the acknowledgement of this version still stands.
    await as(f, f.owner);
    await setVo(f, { enabled: false });
    await setVo(f, { enabled: true });
    expect(await enabled(f)).toBe(true);
  });

  it("asks again when the terms version changes", async () => {
    const f = await firm();
    await asMaintenance(db);
    // An acknowledgement of an earlier version only.
    await db.query(`insert into public.vo_vendor_terms_acknowledgements (organization_id, terms_version, acknowledged_by) values ($1, '2000-01-01.1', $2)`, [f.orgId, f.owner]);
    await as(f, f.owner);
    await expectDbError(() => setVo(f, { enabled: true }), /acknowledge the AI vendor terms/);
    await acknowledge(f);
    await setVo(f, { enabled: true });
    expect(await enabled(f)).toBe(true);
  });

  it("is refused on every path, including a direct write by the service role", async () => {
    const f = await firm();
    await asServiceRole(db);
    await expectDbError(() => db.query(`insert into public.vo_settings (organization_id, enabled, updated_by) values ($1, true, $2)`, [f.orgId, f.owner]), /acknowledge the AI vendor terms/);
    await db.query(`insert into public.vo_settings (organization_id, enabled, updated_by) values ($1, false, $2)`, [f.orgId, f.owner]);
    await expectDbError(() => db.query(`update public.vo_settings set enabled = true where organization_id = $1`, [f.orgId]), /acknowledge the AI vendor terms/);
    // Connected accounts (the other writer of vo_settings) don't turn Vo on and aren't blocked.
    await as(f, f.owner);
    await db.query(`select public.set_composio_enabled($1, true, true)`, [f.orgId]);
    expect(await enabled(f)).toBe(false);
  });

  it("leaves a sample-mode firm's default alone: its other switches save without an acknowledgement", async () => {
    const f = await firm(true);
    await as(f, f.owner);
    // No row yet: Vo is on by the sample-mode default, so saving another switch isn't turning it on.
    await setVo(f, { reply_drafts: false });
    expect(await enabled(f)).toBe(true);
    // Once off, turning it back on needs the acknowledgement like any firm.
    await as(f, f.owner);
    await setVo(f, { enabled: false });
    await expectDbError(() => setVo(f, { enabled: true }), /acknowledge the AI vendor terms/);
  });
});
