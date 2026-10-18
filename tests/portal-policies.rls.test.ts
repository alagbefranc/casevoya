import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { defaultPortalTerms, defaultPrivacyNotice, POLICY_BODY_MAX } from "@/modules/portal-policies/defaults";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * What Settings > Client portal relies on, against the real migrations: who may publish the
 * firm's portal terms and privacy notice, that a version label is used once and published text
 * never changes, that staff read the current versions (the Sheet's loaders do), and that the
 * starting drafts fit the database's limits.
 */
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

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, `${label}-${id.slice(0, 8)}@example.test`],
  );
  return id;
}

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Firm Legal",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  return created.rows[0].id;
}

async function member(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4)`,
    [orgId, userId, role, createdBy],
  );
}

/** The starting drafts with the blanks a firm fills before publishing. */
function reviewed(body: string) {
  return body.replace(/\[Add [^\]]*\]/g, "Client data is stored in Canada.");
}

const FIRM = { firmName: "Synthetic Firm", privacyContactName: "Synthetic Officer", privacyContactEmail: "privacy@example.test" };

async function publish(userId: string, orgId: string, kind: string, label: string, title: string, body: string, totpAgeSeconds = 0) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds });
  const result = await db.query<{ id: string }>(`select public.publish_portal_policy($1, $2, $3, $4) as id`, [kind, label, title, body]);
  return result.rows[0].id;
}

describe("portal policy publishing", () => {
  it("lets a firm owner publish the reviewed starting drafts, and staff read the current versions", async () => {
    const owner = await createUser("owner");
    const caseManager = await createUser("case-manager");
    const org = await createOrg(owner);
    await member(org, caseManager, "case_manager", owner);

    const terms = defaultPortalTerms(FIRM);
    const notice = defaultPrivacyNotice(FIRM);
    for (const draft of [terms, notice]) expect(reviewed(draft.body).length).toBeLessThanOrEqual(POLICY_BODY_MAX);
    await publish(owner, org, "portal_terms", "1", terms.title, reviewed(terms.body));
    const second = await publish(owner, org, "portal_terms", "2", terms.title, reviewed(terms.body));
    await publish(owner, org, "privacy_notice", "1", notice.title, reviewed(notice.body));

    // What loadCurrentPolicies reads, as a case manager: the newest version of each kind.
    await asUser(db, { userId: caseManager, aal: "aal2", orgId: org, totpAgeSeconds: 0 });
    const rows = await db.query<{ id: string; version_label: string }>(
      `select id, version_label from public.portal_policy_documents
       where organization_id = $1 and kind = 'portal_terms' order by published_at desc, id desc limit 1`,
      [org],
    );
    expect(rows.rows[0]).toEqual({ id: second, version_label: "2" });
    const kinds = await db.query<{ kind: string }>(`select distinct kind from public.portal_policy_documents where organization_id = $1 order by kind`, [org]);
    expect(kinds.rows.map((row) => row.kind)).toEqual(["portal_terms", "privacy_notice"]);
  });

  it("lets a licensed consultant publish, and refuses a case manager and a stale step-up", async () => {
    const owner = await createUser("owner");
    const consultant = await createUser("consultant");
    const caseManager = await createUser("case-manager");
    const org = await createOrg(owner);
    await member(org, consultant, "licensed_consultant", owner);
    await member(org, caseManager, "case_manager", owner);

    expect(await publish(consultant, org, "portal_terms", "1", "Terms", "Synthetic terms.")).toMatch(/^[0-9a-f-]{36}$/);
    await expectDbError(() => publish(caseManager, org, "portal_terms", "2", "Terms", "Synthetic terms."), /step-up/);
    await expectDbError(() => publish(consultant, org, "portal_terms", "3", "Terms", "Synthetic terms.", 60 * 60), /step-up/);
  });

  it("uses each version label once and never changes published text", async () => {
    const owner = await createUser("owner");
    const org = await createOrg(owner);
    const id = await publish(owner, org, "privacy_notice", "1", "Privacy notice", "Synthetic notice.");
    await expectDbError(() => publish(owner, org, "privacy_notice", "1", "Privacy notice", "Changed."), /duplicate key|unique/);
    await expectDbError(() => publish(owner, org, "privacy_notice", "v 2", "Privacy notice", "Changed."), /incomplete/);
    await expectDbError(() => publish(owner, org, "privacy_notice", "2", "Privacy notice", "x".repeat(POLICY_BODY_MAX + 1)), /incomplete/);
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.portal_policy_documents set body = 'Changed.' where id = $1`, [id]), /immutable/);
  });

  it("does not show one firm's policies to another firm", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other-owner");
    const org = await createOrg(owner);
    const otherOrg = await createOrg(other);
    await publish(owner, org, "portal_terms", "1", "Terms", "Synthetic terms.");
    await asUser(db, { userId: other, aal: "aal2", orgId: otherOrg, totpAgeSeconds: 0 });
    const seen = await db.query(`select id from public.portal_policy_documents where organization_id = $1`, [org]);
    expect(seen.rows).toHaveLength(0);
  });
});
