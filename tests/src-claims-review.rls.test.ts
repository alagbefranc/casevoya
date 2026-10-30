import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";
import { serverCapture } from "./helpers/server-capture";

/**
 * SRC-01, SRC-02, SRC-03 against the real migrations (20261025400000_src_claims_review.sql): adding
 * a claim with its exact official URL, section and capture; dates kept apart and left Unknown;
 * applicability resolved before approval; the review workbench (licensed reviewer + step-up,
 * attestation, no self-approval, reject and suspend with a reason); and the server-side gate that
 * keeps a non-approved version from going live through direct SQL, the service role or a forged
 * review. Synthetic values only: the URLs are deep official-looking addresses, the claims fictional.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const PAGE = "https://ircc.canada.ca/english/information/synthetic/fees.asp#synthetic";
const LAW = "https://laws-lois.justice.gc.ca/eng/regulations/SOR-0000-000/FullText.html#s-1";
const HASH = "e".repeat(64);

beforeAll(async () => {
  db = await createTestDb();
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
    `${label}-${randomUUID().slice(0, 8)}@example.test`,
  ]);
  return id;
}

async function activeMembership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

const fresh = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
const stale = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 3600 });

async function firm(options: { consultant: boolean } = { consultant: true }) {
  const owner = await createUser("owner");
  const manager = await createUser("manager");
  await fresh(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const ownerMembership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner])).rows[0].id;
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  let consultant: string | null = null;
  let consultantMembership: string | null = null;
  if (options.consultant) {
    consultant = await createUser("consultant");
    consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
    await fresh(consultant, orgId);
    const credential = await db.query<{ id: string }>(
      `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
      [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
    );
    await fresh(owner, orgId);
    await db.query(
      `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
         true, false, false, false, null, $3, 'Synthetic reviewer note')`,
      [credential.rows[0].id, REGISTER, PROOF],
    );
  }
  await asMaintenance(db);
  return { owner, manager, consultant, orgId, ownerMembership, managerMembership, consultantMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

type Claim = { url?: string; section?: string | null; captured?: boolean; key?: string | null; effectiveTo?: string | null; currentTo?: string | null; lastAmended?: string | null; modified?: string | null };

async function addClaim(ctx: Firm, claim: Claim = {}) {
  // A captured page is stored by the server (service role) first; the claim names that capture.
  const snapshot =
    claim.captured === false
      ? null
      : JSON.stringify(await serverCapture(db, { orgId: ctx.orgId, url: claim.url ?? PAGE, snapshot: { sha256: HASH, current_to: claim.currentTo ?? null } }));
  const row = await db.query<{ id: string }>(
    `select public.add_rule_claim($1, $2, 'CA', 'synthetic_program', 'Synthetic claim: a fictional fee per person.', '$0.00', $3, $4,
       'Synthetic excerpt.', null, null, null, null, $5::date, $6::date, $7::date, null, $8::date, $9::date, $10::jsonb) as id`,
    [ctx.orgId, claim.key ?? null, claim.url ?? PAGE, claim.section ?? null, claim.modified ?? null, claim.lastAmended ?? null, claim.currentTo ?? null, claim.effectiveTo ?? null, firmDay(), snapshot],
  );
  return row.rows[0].id;
}

async function version(id: string) {
  await asMaintenance(db);
  const row = await db.query<{ version: number; status: string; content_frozen: boolean; status_reason: string | null }>(
    `select version, status::text as status, content_frozen, status_reason from public.rule_versions where id = $1`,
    [id],
  );
  return row.rows[0];
}

async function resolve(ctx: Firm, id: string, resolution = "applies") {
  const current = await version(id);
  await stale(ctx.owner, ctx.orgId);
  await db.query(`select public.resolve_rule_applicability($1, $2, $3, 'Synthetic: applies to every applicant in this program.')`, [id, current.version, resolution]);
}

/** As whoever is signed in: the version is read in the same statement, so the session stays theirs. */
const approve = (id: string, opened: string | null = null) =>
  db.query(
    `select public.review_rule_version($1, (select version from public.rule_versions where id = $1), 'approved', 'Synthetic review', $2::date, $3::date)`,
    [id, firmDay(90), opened],
  );

async function audit(orgId: string, like: string) {
  await asMaintenance(db);
  const rows = await db.query<{ action: string }>(`select action from public.audit_log where organization_id = $1 and action like $2 order by occurred_at`, [orgId, like]);
  return rows.rows.map((row) => row.action);
}

describe("SRC-01 Add claim", () => {
  it("stores the exact URL, section, capture hash and the dates the page states; missing dates stay Unknown", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const id = await addClaim(ctx, { url: LAW, currentTo: firmDay(-20), lastAmended: firmDay(-90), modified: firmDay(-5) });
    await asMaintenance(db);
    const row = await db.query<Record<string, string | null>>(
      `select e.source_url, e.source_section, e.locator, e.published_on::text as published_on, e.modified_on::text as modified_on,
              e.last_amended_on::text as last_amended_on, e.current_to::text as current_to, e.checked_on::text as checked_on,
              s.content_hash, (s.retrieved_at is not null)::text as retrieved, s.current_to::text as snapshot_current_to,
              v.effective_from::text as effective_from, v.status::text as status, v.output_value ->> 'text' as value, d.program_key, d.jurisdiction
       from public.rule_evidence e
       join public.source_snapshots s on s.id = e.snapshot_id
       join public.rule_versions v on v.id = e.rule_version_id
       join public.rule_definitions d on d.id = v.definition_id
       where e.rule_version_id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({
      source_url: LAW,
      source_section: "#s-1",
      locator: "#s-1",
      published_on: null,
      modified_on: firmDay(-5),
      last_amended_on: firmDay(-90),
      current_to: firmDay(-20),
      checked_on: firmDay(),
      content_hash: HASH,
      retrieved: "true",
      snapshot_current_to: firmDay(-20),
      effective_from: null,
      status: "evidence_captured",
      value: "$0.00",
      program_key: "synthetic_program",
      jurisdiction: "CA",
    });
    expect(await audit(ctx.orgId, "rule.claim_entered")).toEqual(["rule.claim_entered"]);
  });

  it("refuses a homepage, a landing page, a non-official site and a page with neither anchor nor section", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    for (const url of ["https://www.canada.ca", "https://www.canada.ca/", "https://www.canada.ca/en.html", "https://www.canada.ca/en/immigration-refugees-citizenship.html", "https://laws-lois.justice.gc.ca/eng/"]) {
      await expectDbError(() => addClaim(ctx, { url }), /homepage/);
    }
    await expectDbError(() => addClaim(ctx, { url: "https://example.com/fees/list.html#a" }), /official Government of Canada page/);
    await expectDbError(() => addClaim(ctx, { url: "https://ircc.canada.ca/english/information/fees/fees.asp" }), /section/);
    // With a named section instead of an anchor it is accepted.
    expect(await addClaim(ctx, { url: "https://ircc.canada.ca/english/information/fees/fees.asp", section: "Synthetic section" })).toBeTruthy();
    // A direct evidence row with a homepage URL is refused too.
    await expectDbError(
      () => db.query(`insert into public.rule_evidence (rule_version_id, source_url, source_section) select id, 'https://www.canada.ca/en.html', 'x' from public.rule_versions limit 1`),
      /homepage|row-level security|permission denied/,
    );
  });

  it("keeps claims private to the firm's staff; an assistant or another firm sees nothing", async () => {
    const ctx = await firm();
    const other = await firm({ consultant: false });
    await stale(ctx.manager, ctx.orgId);
    const id = await addClaim(ctx);
    await stale(other.owner, other.orgId);
    expect((await db.query(`select id from public.rule_versions where id = $1`, [id])).rows).toHaveLength(0);
    expect((await db.query(`select id from public.rule_evidence where rule_version_id = $1`, [id])).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.resolve_rule_applicability($1, 1, 'applies', 'Synthetic note')`, [id]), /denied/);
    const assistant = await createUser("assistant");
    await activeMembership(ctx.orgId, assistant, "assistant", ctx.owner);
    await stale(assistant, ctx.orgId);
    await expectDbError(() => addClaim(ctx), /staff access denied/);
  });

  it("adds the next version of an existing claim, once at a time", async () => {
    const ctx = await firm({ consultant: false });
    await stale(ctx.owner, ctx.orgId);
    const key = `CA.FEES.SYNTHETIC_${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;
    const first = await addClaim(ctx, { key });
    await expectDbError(() => addClaim(ctx, { key }), /already waiting for review/);
    await resolve(ctx, first);
    await fresh(ctx.owner, ctx.orgId);
    await approve(first);
    await stale(ctx.owner, ctx.orgId);
    const second = await addClaim(ctx, { key });
    await asMaintenance(db);
    const numbers = await db.query<{ version_number: number; supersedes: boolean }>(
      `select version_number, supersedes_version_id = $2 as supersedes from public.rule_versions where id = $1`,
      [second, first],
    );
    expect(numbers.rows[0]).toEqual({ version_number: 2, supersedes: true });
    await resolve(ctx, second);
    await fresh(ctx.owner, ctx.orgId);
    await approve(second);
    expect((await version(first)).status).toBe("superseded");
    expect((await version(second)).status).toBe("published");
  });
});

describe("SRC-02 Applicability before publication", () => {
  it("is resolved by a licensed member with a note; a case manager can't; approval waits for it", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const id = await addClaim(ctx);
    await expectDbError(() => db.query(`select public.resolve_rule_applicability($1, 1, 'applies', 'Synthetic note')`, [id]), /staff access denied/);
    await fresh(ctx.consultant as string, ctx.orgId);
    await expectDbError(() => approve(id), /resolve applicability before approving/);
    await expectDbError(() => db.query(`select public.resolve_rule_applicability($1, 1, 'maybe', 'Synthetic note')`, [id]), /choose applies/);
    await expectDbError(() => db.query(`select public.resolve_rule_applicability($1, 1, 'applies', ' ')`, [id]), /say who/);
    await resolve(ctx, id, "does_not_apply");
    await fresh(ctx.consultant as string, ctx.orgId);
    await expectDbError(() => approve(id), /resolved as not applying/);
    await resolve(ctx, id, "partly");
    await asMaintenance(db);
    const row = await db.query<{ resolution: string; established: boolean; status: string }>(
      `select applicability ->> 'resolution' as resolution, applicability_established as established, status::text as status from public.rule_versions where id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ resolution: "partly", established: true, status: "professional_review" });
    await fresh(ctx.consultant as string, ctx.orgId);
    await approve(id);
    expect((await version(id)).status).toBe("published");
  });
});

describe("SRC-03 Review workbench and publication gate", () => {
  it("approves only as a licensed reviewer with a step-up; the version is then live, immutable and audited", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const id = await addClaim(ctx);
    await resolve(ctx, id);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => approve(id), /staff access denied/);
    await stale(ctx.consultant as string, ctx.orgId);
    await expectDbError(() => approve(id), /step-up/);
    await fresh(ctx.consultant as string, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.review_rule_version($1, $2, 'approved', null, $3::date, null)`, [id, 99, firmDay(90)]),
      /conflict/,
    );
    await expectDbError(
      () => db.query(`select public.review_rule_version($1, (select version from public.rule_versions where id = $1), 'approved', null, null, null)`, [id]),
      /next review date/,
    );
    await approve(id);
    expect(await version(id)).toMatchObject({ status: "published", content_frozen: true });
    await asMaintenance(db);
    const live = await db.query<{ live: boolean; reviewer: string; decided: boolean }>(
      `select app.rule_version_is_live($1) as live, r.reviewer_membership_id as reviewer, r.decided_at is not null as decided
       from public.professional_reviews r where r.rule_version_id = $1 and r.decision = 'approved'`,
      [id],
    );
    expect(live.rows[0]).toEqual({ live: true, reviewer: ctx.consultantMembership, decided: true });
    expect(await audit(ctx.orgId, "rule.version_approved%")).toEqual(["rule.version_approved"]);

    // Immutable: the claim, its value and its evidence can't change now. Staff have no direct
    // write on firm rule rows (20261030235000); the triggers refuse any other writer.
    await fresh(ctx.consultant as string, ctx.orgId);
    expect((await db.query(`update public.rule_versions set claim = 'Rewritten' where id = $1`, [id])).affectedRows ?? 0).toBe(0);
    await expectDbError(() => db.query(`update public.rule_evidence set evidence_excerpt = 'Rewritten' where rule_version_id = $1`, [id]), /permission denied/);
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.rule_versions set claim = 'Rewritten' where id = $1`, [id]), /immutable/);
    await expectDbError(() => db.query(`update public.rule_evidence set evidence_excerpt = 'Rewritten' where rule_version_id = $1`, [id]), /published rule version/);
    await fresh(ctx.consultant as string, ctx.orgId);

    // Suspend with a reason: no longer live.
    await expectDbError(() => db.query(`select public.suspend_rule_version($1, (select version from public.rule_versions where id = $1), '')`, [id]), /say why/);
    await db.query(`select public.suspend_rule_version($1, (select version from public.rule_versions where id = $1), 'Synthetic: the page changed')`, [id]);
    expect(await version(id)).toMatchObject({ status: "suspended", status_reason: "Synthetic: the page changed" });
    await asMaintenance(db);
    expect((await db.query<{ live: boolean }>(`select app.rule_version_is_live($1) as live`, [id])).rows[0].live).toBe(false);
    // A suspended version can't be made live again by SQL.
    await fresh(ctx.consultant as string, ctx.orgId);
    expect((await db.query(`update public.rule_versions set status = 'published' where id = $1`, [id])).affectedRows ?? 0).toBe(0);
    expect(await version(id)).toMatchObject({ status: "suspended" });
    await asServiceRole(db);
    await expectDbError(() => db.query(`update public.rule_versions set status = 'published' where id = $1`, [id]), /approval_required/);
  });

  it("keeps a non-approved version from going live through direct SQL, the service role or a forged review", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const id = await addClaim(ctx);
    await resolve(ctx, id);
    await asMaintenance(db);
    await db.query(`update public.rule_versions set next_review_at = now() + interval '30 days' where id = $1`, [id]);

    // A licensed reviewer at a fresh step-up still can't write the approval or the status directly.
    await fresh(ctx.consultant as string, ctx.orgId);
    await expectDbError(
      () =>
        db.query(
          `insert into public.professional_reviews (organization_id, rule_version_id, reviewer_membership_id, decision, decided_at, rule_content_revision)
           values ($1, $2, $3, 'approved', now(), 1)`,
          [ctx.orgId, id, ctx.consultantMembership],
        ),
      /permission denied/,
    );
    // Firm rule rows have no direct staff write (20261030235000): the updates match no row.
    expect((await db.query(`update public.rule_versions set status = 'published' where id = $1`, [id])).affectedRows ?? 0).toBe(0);
    expect((await db.query(`update public.rule_versions set status = 'approved' where id = $1`, [id])).affectedRows ?? 0).toBe(0);
    await expectDbError(() => db.query(`insert into public.rule_versions (definition_id, version_number, claim, status) select definition_id, 50, 'x', 'published' from public.rule_versions where id = $1`, [id]), /status_requires_prior_review|row-level security/);
    // An attestation can't be forged either.
    await expectDbError(
      () => db.query(`update public.rule_evidence set page_attested_on = current_date, page_attested_at = now(), page_attested_by_membership_id = $2 where rule_version_id = $1`, [id, ctx.consultantMembership]),
      /permission denied/,
    );

    // A rejected review on file plus a direct publish: still refused.
    await expectDbError(
      () =>
        db.query(
          `update public.professional_reviews set decision = 'approved' where rule_version_id = $1`,
          [id],
        ).then(() => db.query(`update public.rule_versions set status = 'published' where id = $1`, [id])),
      /permission denied/,
    );

    // Jobs and imports run as the service role: refused too.
    await asServiceRole(db);
    await expectDbError(
      () =>
        db.query(
          `insert into public.professional_reviews (organization_id, rule_version_id, reviewer_membership_id, decision, decided_at, rule_content_revision)
           values ($1, $2, $3, 'approved', now(), 1)`,
          [ctx.orgId, id, ctx.consultantMembership],
        ),
      /only in Source review/,
    );
    await expectDbError(() => db.query(`update public.rule_versions set status = 'published' where id = $1`, [id]), /publication blocked/);
    expect(await version(id)).toMatchObject({ status: "professional_review", content_frozen: false });
    await asMaintenance(db);
    expect((await db.query<{ live: boolean }>(`select app.rule_version_is_live($1) as live`, [id])).rows[0].live).toBe(false);
  });

  it("rejects with a reason (terminal) and refuses an expired version", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const id = await addClaim(ctx);
    await stale(ctx.consultant as string, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_rule_version($1, 1, 'rejected', '', null, null)`, [id]), /say why/);
    await db.query(`select public.review_rule_version($1, 1, 'rejected', 'Synthetic: wrong section', null, null)`, [id]);
    expect(await version(id)).toMatchObject({ status: "rejected", status_reason: "Synthetic: wrong section" });
    await fresh(ctx.consultant as string, ctx.orgId);
    await expectDbError(() => approve(id), /nothing is waiting for review/);

    await stale(ctx.manager, ctx.orgId);
    const expired = await addClaim(ctx, { effectiveTo: firmDay(-1) });
    await resolve(ctx, expired);
    await fresh(ctx.consultant as string, ctx.orgId);
    await expectDbError(() => approve(expired), /expired/);
  });

  it("needs the reviewer's attestation when Casevoya couldn't capture the page", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    const id = await addClaim(ctx, { captured: false });
    expect((await version(id)).status).toBe("draft");
    await resolve(ctx, id);
    await fresh(ctx.consultant as string, ctx.orgId);
    await expectDbError(() => approve(id), /attestation/);
    await expectDbError(() => approve(id, firmDay(1)), /between the day the entry was made and today/);
    await approve(id, firmDay());
    await asMaintenance(db);
    const row = await db.query<{ by: string; on: string; at: boolean }>(
      `select page_attested_by_membership_id as by, page_attested_on::text as on, page_attested_at is not null as at from public.rule_evidence where rule_version_id = $1`,
      [id],
    );
    expect(row.rows[0]).toEqual({ by: ctx.consultantMembership, on: firmDay(), at: true });
    expect((await version(id)).status).toBe("published");
  });

  it("refuses self-approval while another licensed member exists; a sole licensed member approves after a later step-up, audited as self", async () => {
    const ctx = await firm();
    await fresh(ctx.consultant as string, ctx.orgId);
    const own = await addClaim(ctx);
    await resolve(ctx, own);
    await fresh(ctx.consultant as string, ctx.orgId);
    await expectDbError(() => approve(own), /another licensed member/);
    await fresh(ctx.owner, ctx.orgId);
    await approve(own);

    const solo = await firm({ consultant: false });
    await fresh(solo.owner, solo.orgId);
    const mine = await addClaim(solo);
    await resolve(solo, mine);
    await asUser(db, { userId: solo.owner, aal: "aal2", orgId: solo.orgId, totpAgeSeconds: 30 });
    await expectDbError(() => approve(mine), /step-up/);
    await fresh(solo.owner, solo.orgId);
    await approve(mine);
    expect(await audit(solo.orgId, "rule.version_approved%")).toEqual(["rule.version_approved_self"]);
  });
});
