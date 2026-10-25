import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { outcomeSegments, programEstimates, type OutcomeRecord } from "@/modules/sheet/reports-outcomes";
import type { EstimateRow } from "@/modules/government/status-provenance";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * REP-02 against the real migrations, with seeded decided matters (test data only): the
 * Processing and outcomes reads the loader makes, as each staff member (RLS decides the rows),
 * fed to the same segmenting the page uses: counts with n, durations, pending excluded, IRCC's
 * approved estimate apart. REP-03: the export audit records its segment.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const TZ = "America/Toronto";

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

async function licensed(orgId: string, owner: string, consultant: string, membership: string) {
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
}

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const other = await createUser("other");
  const finance = await createUser("finance");
  const assistant = await createUser("assistant");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const otherMembership = await activeMembership(orgId, other, "licensed_consultant", owner);
  await activeMembership(orgId, finance, "finance_user", owner);
  await activeMembership(orgId, assistant, "assistant", owner);
  await licensed(orgId, owner, consultant, consultantMembership);
  await licensed(orgId, owner, other, otherMembership);
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  await db.exec(`alter table public.rule_pack_versions disable trigger rule_pack_versions_guard`);
  const pack = await db.query<{ id: string }>(
    `insert into public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version, status, content_frozen)
     values ($1, 'CA', 'synthetic_program', 1, 'published', true) returning id`,
    [orgId],
  );
  await db.exec(`alter table public.rule_pack_versions enable trigger rule_pack_versions_guard`);
  return { owner, consultant, other, finance, assistant, orgId, consultantMembership, otherMembership, packId: pack.rows[0].id };
}

type Firm = Awaited<ReturnType<typeof firm>>;

/**
 * Test setup only: a matter the given consultant is responsible for, moved to Submitted at
 * `submittedAt` and (when decided) to Decision review `days` later with a recorded outcome.
 */
async function seedMatter(ctx: Firm, as: "consultant" | "other", seed: { submittedAt: string; days?: number; outcome?: string; program?: boolean }) {
  const user = as === "consultant" ? ctx.consultant : ctx.other;
  const membership = as === "consultant" ? ctx.consultantMembership : ctx.otherMembership;
  await asUser(db, { userId: user, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, null, null, null, $2, null, null) as result`, [
    "Synthetic Applicant",
    membership,
  ]);
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  await db.exec("set session_replication_role = replica");
  const submitted = new Date(seed.submittedAt);
  await db.query(
    `update public.matters set program_pack_id = $2, created_at = $3, outcome = $4::public.matter_outcome,
       stage = $5::public.matter_stage where id = $1`,
    [matterId, seed.program === false ? null : ctx.packId, new Date(submitted.getTime() - 20 * 86_400_000).toISOString(), seed.outcome ?? null, seed.outcome ? "decision_review" : "submitted"],
  );
  await db.query(
    `insert into public.matter_stage_transitions (organization_id, matter_id, from_stage, to_stage, from_version, reason, created_at)
     values ($1, $2, 'consultant_review', 'submitted', 1, 'Synthetic test move', $3)`,
    [ctx.orgId, matterId, submitted.toISOString()],
  );
  if (seed.days !== undefined) {
    await db.query(
      `insert into public.matter_stage_transitions (organization_id, matter_id, from_stage, to_stage, from_version, reason, created_at)
       values ($1, $2, 'submitted', 'decision_review', 2, 'Synthetic test move', $3)`,
      [ctx.orgId, matterId, new Date(submitted.getTime() + seed.days * 86_400_000).toISOString()],
    );
  }
  await db.exec("set session_replication_role = origin");
  return matterId;
}

/** The reads loadOutcomeSegments makes, in SQL, as the current session. */
async function readOutcomes(orgId: string) {
  const transitions = await db.query<{ matter_id: string; to_stage: string; created_at: Date }>(
    `select matter_id, to_stage, created_at from public.matter_stage_transitions
      where organization_id = $1 and to_stage in ('submitted', 'decision_review') order by created_at asc limit 1000`,
    [orgId],
  );
  const submitted = new Map<string, string>();
  const decided = new Map<string, string>();
  for (const row of transitions.rows) {
    const at = new Date(row.created_at).toISOString();
    if (row.to_stage === "submitted" && !submitted.has(row.matter_id)) submitted.set(row.matter_id, at);
    if (row.to_stage === "decision_review" && !decided.has(row.matter_id)) decided.set(row.matter_id, at);
  }
  const ids = [...submitted.keys()];
  const matters = ids.length
    ? await db.query<{ id: string; created_at: Date; outcome: string | null; program_key: string | null }>(
        `select m.id, m.created_at, m.outcome::text as outcome, p.program_key
           from public.matters m left join public.rule_pack_versions p on p.id = m.program_pack_id
          where m.organization_id = $1 and m.id = any($2::uuid[]) and m.is_sample = false`,
        [orgId, ids],
      )
    : { rows: [] };
  const records: OutcomeRecord[] = matters.rows.map((row) => ({
    matterId: row.id,
    program: row.program_key,
    createdAt: new Date(row.created_at).toISOString(),
    submittedAt: submitted.get(row.id) ?? null,
    decidedAt: decided.get(row.id) ?? null,
    outcome: row.outcome,
  }));
  const estimates = records.length
    ? await db.query<EstimateRow & { matter_id: string }>(
        `select id, matter_id, source_url, application_type, estimate_text, checked_on::text as checked_on, null::text as page_retrieved_at,
                snapshot_sha256, status, entered_by_membership_id, reviewed_by_membership_id, reviewed_at::text as reviewed_at,
                created_at::text as created_at, version, page_attested_by_membership_id, page_attested_on::text as page_attested_on
           from public.government_processing_estimates
          where organization_id = $1 and status = 'approved' and matter_id = any($2::uuid[])`,
        [orgId, records.map((record) => record.matterId)],
      )
    : { rows: [] };
  return { records, estimates: estimates.rows };
}

describe("REP-02 processing and outcomes with seeded decided matters", () => {
  it("counts decided files with n, times them, keeps pending out, and scopes rows by RLS", async () => {
    const ctx = await firm();
    // Five decided files submitted in Feb 2026 (Toronto): 30, 40, 50, 60, 90 days.
    const decidedIds: string[] = [];
    for (const [index, days] of [30, 40, 50, 60, 90].entries()) {
      decidedIds.push(await seedMatter(ctx, "consultant", { submittedAt: `2026-02-1${index}T15:00:00Z`, days, outcome: index % 2 ? "refused" : "approved" }));
    }
    // Pending: submitted, no outcome yet (one even reached Decision review).
    await seedMatter(ctx, "consultant", { submittedAt: "2026-02-20T15:00:00Z" });
    await seedMatter(ctx, "consultant", { submittedAt: "2026-02-21T15:00:00Z", days: 10 });
    // Next quarter, no program: a separate, small segment.
    await seedMatter(ctx, "consultant", { submittedAt: "2026-04-02T15:00:00Z", days: 25, outcome: "withdrawn", program: false });
    // Another consultant's decided file.
    await seedMatter(ctx, "other", { submittedAt: "2026-02-15T15:00:00Z", days: 100, outcome: "approved" });

    // An IRCC estimate on one matter: approved (shown) and, on another, still pending (not shown).
    await asMaintenance(db);
    await db.exec("set session_replication_role = replica");
    for (const [matterId, status, text] of [
      [decidedIds[0], "approved", "Synthetic approved estimate"],
      [decidedIds[1], "pending_review", "Synthetic pending estimate"],
    ]) {
      await db.query(
        `insert into public.government_processing_estimates (organization_id, matter_id, source_url, application_type, estimate_text, checked_on, status,
            entered_by_membership_id, reviewed_by_membership_id, reviewed_at, created_by,
            page_attested_by_membership_id, page_attested_on, page_attested_at)
         values ($1, $2, 'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html',
            'Synthetic application type', $3, '2026-10-20', $4, $5, $6, $7, $8, $6, $9::date, $7)`,
        [
          ctx.orgId,
          matterId,
          text,
          status,
          ctx.consultantMembership,
          status === "approved" ? ctx.otherMembership : null,
          status === "approved" ? "2026-10-21T12:00:00Z" : null,
          ctx.consultant,
          status === "approved" ? "2026-10-21" : null,
        ],
      );
    }
    await db.exec("set session_replication_role = origin");

    // The responsible consultant reads their own matters only.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    const mine = await readOutcomes(ctx.orgId);
    expect(mine.records).toHaveLength(8);
    const map = programEstimates(mine.estimates, new Map(mine.records.map((record) => [record.matterId, record.program])));
    const result = outcomeSegments(mine.records, { timeZone: TZ, estimates: map });
    expect(result.rows.map((row) => [row.program, row.cohort, row.decided, row.median, row.pending, row.range, row.outcomes])).toEqual([
      ["No program selected", "Submitted Apr–Jun 2026", 1, "—", 0, "— (1 timed)", "—"],
      ["Synthetic program", "Submitted Jan–Mar 2026", 5, "50", 2, "30–90 (5 timed)", "3 approved, 2 refused"],
    ]);
    expect(result.rows[1].estimate?.text).toBe("Synthetic approved estimate for Synthetic application type. IRCC’s estimate, checked 20 Oct 2026; not a maximum or a guarantee.");
    expect(result.rows[0].estimate).toBeNull();
    // Firm work time is its own figure: 20 days opened → submitted for each of the seven files.
    expect(result.firm.find((row) => row.program === "Synthetic program")).toEqual({ program: "Synthetic program", cohort: "Submitted Jan–Mar 2026", files: 7, median: "20" });

    // The firm owner reads every matter: the other consultant's file joins the segment.
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    const all = await readOutcomes(ctx.orgId);
    expect(all.records).toHaveLength(9);
    const firmWide = outcomeSegments(all.records, { timeZone: TZ });
    expect(firmWide.rows.find((row) => row.program === "Synthetic program")).toMatchObject({ decided: 6, median: "50", pending: 2, range: "30–100 (6 timed)", outcomes: "4 approved, 2 refused" });

    // Another firm sees none of it.
    const outsider = await firm();
    await asUser(db, { userId: outsider.owner, aal: "aal2", orgId: outsider.orgId, totpAgeSeconds: 3600 });
    expect((await readOutcomes(ctx.orgId)).records).toHaveLength(0);
  });
});

describe("REP-03 export audit with a segment (public.record_report_export, five arguments)", () => {
  it("records the segment, refuses a segment outside Processing and outcomes, a malformed one, and a role that can't see the tab", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    const ok = await db.query<{ id: string }>(`select public.record_report_export($1, 'outcomes', '90d', 'pdf', 'synthetic_program') as id`, [ctx.orgId]);
    expect(ok.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    await db.query(`select public.record_report_export($1, 'ops', 'month', 'csv', null)`, [ctx.orgId]);
    await expectDbError(() => db.query(`select public.record_report_export($1, 'ops', '90d', 'csv', 'synthetic_program')`, [ctx.orgId]), /choose a program/);
    await expectDbError(() => db.query(`select public.record_report_export($1, 'outcomes', '90d', 'csv', 'Bad Segment')`, [ctx.orgId]), /choose a program/);
    await expectDbError(() => db.query(`select public.record_report_export($1, 'money', '90d', 'csv', null)`, [ctx.orgId]), /report export denied/);

    await asUser(db, { userId: ctx.assistant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.record_report_export($1, 'outcomes', '90d', 'csv', null)`, [ctx.orgId]), /report export denied/);
    await asUser(db, { userId: ctx.consultant, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.record_report_export($1, 'outcomes', '90d', 'csv', null)`, [ctx.orgId]), /report export denied/);
    const outsider = await firm();
    await asUser(db, { userId: outsider.owner, aal: "aal2", orgId: outsider.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.record_report_export($1, 'outcomes', '90d', 'csv', null)`, [ctx.orgId]), /report export denied/);

    await asMaintenance(db);
    const audit = await db.query<{ context: Record<string, unknown> }>(
      `select context from public.audit_log where organization_id = $1 and action = 'report.exported' order by occurred_at, id`,
      [ctx.orgId],
    );
    expect(audit.rows.map((row) => row.context)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tab: "outcomes", range: "90d", format: "pdf", segment: "synthetic_program" }),
        expect.objectContaining({ tab: "ops", range: "month", format: "csv", segment: null }),
      ]),
    );
    expect(audit.rows).toHaveLength(2);

    await asAnon(db);
    await expectDbError(() => db.query(`select public.record_report_export($1, 'outcomes', '90d', 'csv', null)`, [ctx.orgId]), /permission denied|sign in/);
    await asMaintenance(db);
    const grants = await db.query<{ anon: boolean; pub: boolean }>(
      `select has_function_privilege('anon', 'public.record_report_export(uuid, text, text, text, text)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.record_report_export(uuid, text, text, text, text)', 'execute') as pub`,
    );
    expect(grants.rows[0]).toEqual({ anon: false, pub: true });
  });
});
