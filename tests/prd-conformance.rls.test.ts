import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asMaintenance,
  asUser,
  countOf,
  createTestDb,
  expectDbError,
  type TestDb,
} from "./helpers/postgres";

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

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, now(), '{}'::jsonb)`,
    [id, address],
  );
  return id;
}

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(
    `select (public.create_organization($1, $2, $3)).id as id`,
    ["Synthetic Legal Name", "Synthetic Firm", slug()],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new Error("organization was not created");
  return id;
}

async function activeMembership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4)
     returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

async function insertPerson(orgId: string, displayName: string, dob: string | null, precision: string | null) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into public.persons (id, organization_id, display_name, email, date_of_birth, birth_date_precision)
     values ($1, $2, $3, $4, $5::date, $6::public.date_precision)`,
    [id, orgId, displayName, `${id.slice(0, 8)}@client.example.test`, dob, precision],
  );
  return id;
}

function codesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  throw new Error(`expected a text array, received ${JSON.stringify(value)}`);
}

describe("finance billing projection", () => {
  it("shows assigned matters to finance and the firm to the owner, without person rows", async () => {
    const owner = await createUser(email("owner"));
    const finance = await createUser(email("finance"));
    const otherFinance = await createUser(email("finance-b"));
    const assistant = await createUser(email("assistant"));
    const orgId = await createOrg(owner);
    const otherOwner = await createUser(email("other-owner"));
    const otherOrg = await createOrg(otherOwner);
    const financeMembership = await activeMembership(orgId, finance, "finance_user", owner);
    const assistantMembership = await activeMembership(orgId, assistant, "assistant", owner);
    await activeMembership(orgId, otherFinance, "finance_user", owner);

    const client = await insertPerson(orgId, "Synthetic Client", "1990-01-01", "day");
    await asMaintenance(db);
    const emailRow = await db.query<{ email: string }>(`select email from public.persons where id = $1`, [client]);
    const privateEmail = emailRow.rows[0].email;
    const matter = randomUUID();
    const otherMatter = randomUUID();
    await db.query(
      `insert into public.matters (id, organization_id, title) values ($1, $2, 'Synthetic billing matter'), ($3, $2, 'Synthetic other matter')`,
      [matter, orgId, otherMatter],
    );
    await db.query(
      `insert into public.matter_participants (organization_id, matter_id, person_id, role)
       values ($1, $2, $3, 'applicant')`,
      [orgId, matter, client],
    );
    await db.query(
      `insert into public.matter_participants (organization_id, matter_id, membership_id, role)
       values ($1, $2, $3, 'assistant'), ($1, $2, $4, 'assistant')`,
      [orgId, matter, financeMembership, assistantMembership],
    );

    await asUser(db, { userId: finance, aal: "aal1", orgId });
    expect((await db.query(`select * from public.list_matter_billing()`)).rows).toHaveLength(0);

    await asUser(db, { userId: otherFinance, aal: "aal2", orgId, totpAgeSeconds: 0 });
    expect((await db.query(`select * from public.list_matter_billing()`)).rows).toHaveLength(0);
    expect((await db.query(`select id from public.persons`)).rows).toHaveLength(0);
    expect((await db.query(`select id from public.matters`)).rows).toHaveLength(0);

    await asUser(db, { userId: finance, aal: "aal2", orgId, totpAgeSeconds: 20 * 60 });
    const billing = await db.query<{
      matter_id: string;
      title: string;
      stage: string;
      client_display_name: string;
    }>(
      `select matter_id, title, stage::text as stage, client_display_name from public.list_matter_billing()`,
    );
    expect(billing.rows).toEqual([
      {
        matter_id: matter,
        title: "Synthetic billing matter",
        stage: "engagement_pending",
        client_display_name: "Synthetic Client",
      },
    ]);
    expect(JSON.stringify(billing.rows)).not.toContain(privateEmail);
    expect((await db.query(`select id from public.persons`)).rows).toHaveLength(0);
    expect((await db.query(`select id from public.matters`)).rows).toHaveLength(0);

    const invoice = await db.query<{ id: string }>(
      `select public.perform_billing_action($1, 'issue_invoice') as id`,
      [matter],
    );
    expect(invoice.rows[0].id).toMatch(/^[0-9a-f-]{36}$/);
    await expectDbError(
      () => db.query(`select public.perform_billing_action($1, 'approve_earned_fee_transfer')`, [matter]),
      /billing access denied/,
    );

    await asUser(db, { userId: finance, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(`select public.perform_billing_action($1, 'approve_earned_fee_transfer')`, [matter]);
    await expectDbError(
      () => db.query(`select public.perform_billing_action($1, 'refund')`, [matter]),
      /unknown billing action/,
    );

    await asUser(db, { userId: assistant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    expect((await db.query(`select * from public.list_matter_billing()`)).rows).toHaveLength(0);
    await expectDbError(
      () => db.query(`select public.perform_billing_action($1, 'issue_invoice')`, [matter]),
      /billing access denied/,
    );

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const ownerBilling = await db.query<{ matter_id: string }>(`select matter_id from public.list_matter_billing()`);
    expect(ownerBilling.rows.map((row) => row.matter_id).sort()).toEqual([matter, otherMatter].sort());
    expect((await db.query(`select id from public.persons`)).rows).toHaveLength(0);
    await db.query(`select public.perform_billing_action($1, 'issue_invoice')`, [otherMatter]);

    await asUser(db, { userId: finance, aal: "aal2", orgId: otherOrg, totpAgeSeconds: 0 });
    expect((await db.query(`select * from public.list_matter_billing()`)).rows).toHaveLength(0);

    await asMaintenance(db);
    const audited = await db.query<{ action: string; n: number }>(
      `select action, count(*)::int as n from public.audit_log
       where object_id = $1 and action like 'billing.%'
       group by action`,
      [matter],
    );
    const actions = Object.fromEntries(audited.rows.map((row) => [row.action, countOf(row.n)]));
    expect(actions["billing.issue_invoice"]).toBe(1);
    expect(actions["billing.approve_earned_fee_transfer"]).toBe(1);
  });
});

describe("webhook account dedupe", () => {
  it("treats a null and an empty account as one event and keeps accounts distinct", async () => {
    await asMaintenance(db);
    const first = await db.query<{ id: string }>(
      `select app.ingest_webhook_event('stripe', 'evt_null_account', null, 'charge.succeeded', '{"n":1}'::jsonb) as id`,
    );
    const blank = await db.query<{ id: string }>(
      `select app.ingest_webhook_event('stripe', 'evt_null_account', '', 'charge.succeeded', '{"n":2}'::jsonb) as id`,
    );
    expect(blank.rows[0].id).toBe(first.rows[0].id);
    const stored = await db.query<{ connected_account_id: string | null; payload: { n: number } }>(
      `select connected_account_id, payload from public.webhook_inbox where id = $1`,
      [first.rows[0].id],
    );
    expect(stored.rows[0].connected_account_id).toBeNull();
    expect(stored.rows[0].payload).toEqual({ n: 1 });

    const other = await db.query<{ id: string }>(
      `select app.ingest_webhook_event('stripe', 'evt_null_account', 'acct_b', null, '{"n":3}'::jsonb) as id`,
    );
    expect(other.rows[0].id).not.toBe(first.rows[0].id);
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from public.webhook_inbox where event_id = 'evt_null_account'`,
    );
    expect(countOf(count.rows[0].n)).toBe(2);
  });
});

describe("firm owner person access", () => {
  it("is assignment-based, with an audited read-only break-glass window", async () => {
    const owner = await createUser(email("owner"));
    const consultant = await createUser(email("consultant"));
    const orgId = await createOrg(owner);
    const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
    const person = await insertPerson(orgId, "Synthetic Private", "1980-04-04", "day");
    await asMaintenance(db);
    const matter = randomUUID();
    await db.query(`insert into public.matters (id, organization_id, title) values ($1, $2, 'Assigned matter')`, [
      matter,
      orgId,
    ]);
    await db.query(
      `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`,
      [orgId, matter, person],
    );
    await db.query(
      `insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`,
      [orgId, matter, consultantMembership],
    );

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    expect((await db.query(`select id from public.persons`)).rows).toHaveLength(0);
    await expectDbError(
      () => db.query(`select public.open_person_break_glass($1, 'short')`, [person]),
      /reason/,
    );
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 20 * 60 });
    await expectDbError(
      () => db.query(`select public.open_person_break_glass($1, 'Emergency file review')`, [person]),
      /step-up/,
    );

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const opened = await db.query<{ id: string }>(
      `select public.open_person_break_glass($1, 'Emergency file review') as id`,
      [person],
    );
    expect((await db.query<{ id: string }>(`select id from public.persons`)).rows.map((row) => row.id)).toEqual([
      person,
    ]);
    const renamed = await db.query(
      `update public.persons set display_name = 'Should not stick' where id = $1 returning id`,
      [person],
    );
    expect(renamed.rows).toHaveLength(0);

    const otherOwner = await createUser(email("other"));
    const otherOrg = await createOrg(otherOwner);
    await asUser(db, { userId: otherOwner, aal: "aal2", orgId: otherOrg, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.open_person_break_glass($1, 'Cross tenant attempt')`, [person]),
      /denied/,
    );
    expect((await db.query(`select id from public.person_break_glass`)).rows).toHaveLength(0);

    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    expect((await db.query<{ id: string }>(`select id from public.persons`)).rows.map((row) => row.id)).toEqual([
      person,
    ]);
    await expectDbError(
      () => db.query(`select public.open_person_break_glass($1, 'Consultant cannot open this')`, [person]),
      /firm owner/,
    );

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(`select public.close_person_break_glass($1)`, [opened.rows[0].id]);
    expect((await db.query(`select id from public.persons`)).rows).toHaveLength(0);

    await asMaintenance(db);
    const reopened = await db.query<{ id: string }>(
      `select id from public.person_break_glass where id = $1`,
      [opened.rows[0].id],
    );
    expect(reopened.rows).toHaveLength(1);
    await db.exec(`alter table public.person_break_glass disable trigger person_break_glass_touch`);
    await db.query(
      `update public.person_break_glass
       set created_at = statement_timestamp() - interval '2 minutes',
           expires_at = statement_timestamp() - interval '1 minute',
           revoked_at = null
       where id = $1`,
      [opened.rows[0].id],
    );
    await db.exec(`alter table public.person_break_glass enable trigger person_break_glass_touch`);
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    expect((await db.query(`select id from public.persons`)).rows).toHaveLength(0);

    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log where action like 'person.break_glass_%' and object_id = $1`,
      [person],
    );
    expect(audit.rows.map((row) => row.action)).toContain("person.break_glass_opened");
  });
});

describe("matter stage transitions", () => {
  it("rejects a direct stage write and requires evidence plus an allowed edge", async () => {
    const owner = await createUser(email("owner"));
    const consultant = await createUser(email("consultant"));
    const assistant = await createUser(email("assistant"));
    const orgId = await createOrg(owner);
    const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
    const assistantMembership = await activeMembership(orgId, assistant, "assistant", owner);

    await asMaintenance(db);
    await expectDbError(
      () =>
        db.query(`insert into public.matters (organization_id, title, stage) values ($1, 'Bad start', 'intake')`, [
          orgId,
        ]),
      /engagement pending/,
    );
    const matter = randomUUID();
    await db.query(`insert into public.matters (id, organization_id, title) values ($1, $2, 'Synthetic stage matter')`, [
      matter,
      orgId,
    ]);
    await db.query(
      `insert into public.matter_participants (organization_id, matter_id, membership_id, role)
       values ($1, $2, $3, 'consultant'), ($1, $2, $4, 'assistant')`,
      [orgId, matter, consultantMembership, assistantMembership],
    );

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`update public.matters set stage = 'intake' where id = $1`, [matter]),
      /transition_matter_stage/,
    );
    const renamed = await db.query<{ version: number }>(
      `update public.matters set title = 'Renamed synthetic matter' where id = $1 returning version`,
      [matter],
    );
    expect(countOf(renamed.rows[0].version)).toBe(2);

    await expectDbError(
      () => db.query(`select public.transition_matter_stage($1, 'preparation', 2, 'Skip ahead')`, [matter]),
      /not allowed/,
    );
    await expectDbError(
      () => db.query(`select public.transition_matter_stage($1, 'intake', 1, 'Stale version')`, [matter]),
      /40001|version conflict/,
    );
    await expectDbError(
      () => db.query(`select public.transition_matter_stage($1, 'intake', 2, 'No agreement yet')`, [matter]),
      /evidence is missing/,
    );

    await db.query(
      `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
       values ($1, $2, 'service_agreement', 'Synthetic agreement on file')`,
      [orgId, matter],
    );
    const moved = await db.query<{ version: number }>(
      `select public.transition_matter_stage($1, 'intake', 2, 'Agreement recorded') as version`,
      [matter],
    );
    expect(countOf(moved.rows[0].version)).toBeGreaterThan(2);
    const history = await db.query<{ to_stage: string }>(
      `select to_stage::text as to_stage from public.matter_stage_transitions where matter_id = $1`,
      [matter],
    );
    expect(history.rows.map((row) => row.to_stage)).toEqual(["intake"]);

    await asUser(db, { userId: assistant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(
          `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
           values ($1, $2, 'submission_confirmation', 'Missing the receipt fields')`,
          [orgId, matter],
        ),
      /check|submission/,
    );

    const steps: Array<[string, string, string]> = [
      ["evidence_collection", "questionnaire_assigned", "Questionnaire assigned"],
      ["preparation", "facts_reviewed", "Facts reviewed"],
      ["consultant_review", "draft_package", "Draft package"],
      ["client_confirmation", "client_review_package", "Client review package"],
      ["ready_to_submit", "submission_approvals", "Submission approvals"],
    ];
    let version = countOf(moved.rows[0].version);
    for (const [stage, kind, summary] of steps) {
      await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
      await db.query(
        `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
         values ($1, $2, $3::public.matter_stage_evidence_kind, $4)`,
        [orgId, matter, kind, summary],
      );
      const next = await db.query<{ version: number }>(
        `select public.transition_matter_stage($1, $2::public.matter_stage, $3, $4) as version`,
        [matter, stage, version, summary],
      );
      version = countOf(next.rows[0].version);
    }

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.transition_matter_stage($1, 'submitted', $2, 'Owner cannot file')`, [matter, version]),
      /licensed consultant/,
    );

    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(
      `insert into public.matter_stage_evidence (
         organization_id, matter_id, kind, summary, external_reference, submission_at, receipt_locator
       ) values ($1, $2, 'submission_confirmation', 'Filed', 'SYN-100', statement_timestamp(), 'receipt-synthetic')`,
      [orgId, matter],
    );
    const submitted = await db.query<{ version: number }>(
      `select public.transition_matter_stage($1, 'submitted', $2, 'Submission confirmed') as version`,
      [matter, version],
    );
    version = countOf(submitted.rows[0].version);

    const later: Array<[string, string]> = [
      ["government_processing", "verified_submission"],
      ["decision_review", "official_decision"],
      ["post_decision", "outcome_and_follow_up"],
      ["closed", "closure"],
    ];
    for (const [stage, kind] of later) {
      await db.query(
        `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
         values ($1, $2, $3::public.matter_stage_evidence_kind, $4)`,
        [orgId, matter, kind, `Synthetic ${kind}`],
      );
      const next = await db.query<{ version: number }>(
        `select public.transition_matter_stage($1, $2::public.matter_stage, $3, $4) as version`,
        [matter, stage, version, `Move to ${stage}`],
      );
      version = countOf(next.rows[0].version);
    }
    await db.query(
      `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
       values ($1, $2, 'engagement_prerequisites', 'Reopen prerequisites')`,
      [orgId, matter],
    );
    await db.query(`select public.transition_matter_stage($1, 'engagement_pending', $2, 'Controlled reopen')`, [
      matter,
      version,
    ]);

    await asMaintenance(db);
    const stage = await db.query<{ stage: string }>(`select stage::text as stage from public.matters where id = $1`, [
      matter,
    ]);
    expect(stage.rows[0].stage).toBe("engagement_pending");
    const audited = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log
       where object_id = $1 and action in ('matter.stage_transition', 'matter.reopened')`,
      [matter],
    );
    expect(countOf(audited.rows[0].n)).toBeGreaterThan(0);
    const reopened = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log where object_id = $1 and action = 'matter.reopened'`,
      [matter],
    );
    expect(countOf(reopened.rows[0].n)).toBe(1);
  });
});

describe("date of birth and minor status", () => {
  it("derives minority from the date and follows that result for guardian grants", async () => {
    await asMaintenance(db);
    const on = "2026-10-17";
    const cases: Array<[string, string, number, boolean]> = [
      ["2007-10-17", "day", 19, false],
      ["2007-10-18", "day", 19, true],
      ["2007-10-01", "month", 19, false],
      ["2008-01-01", "year", 19, true],
      ["2007-01-01", "year", 19, false],
    ];
    for (const [dob, precision, years, minor] of cases) {
      const row = await db.query<{ minor: boolean }>(
        `select app.derive_is_minor($1::date, $2::public.date_precision, $3, $4::date) as minor`,
        [dob, precision, years, on],
      );
      expect(row.rows[0].minor, `${dob} ${precision}`).toBe(minor);
    }
    const missing = await db.query<{ minor: boolean }>(
      `select app.derive_is_minor(null, null, 19, current_date) as minor`,
    );
    expect(missing.rows[0].minor).toBe(false);

    const owner = await createUser(email("owner"));
    const guardianUser = await createUser(email("guardian"));
    const orgId = await createOrg(owner);
    await activeMembership(orgId, guardianUser, "guardian", owner);
    const guardian = await insertPerson(orgId, "Synthetic Guardian", "1985-02-02", "day");
    await asMaintenance(db);
    await db.query(`update public.persons set user_id = $2 where id = $1`, [guardian, guardianUser]);
    const child = await insertPerson(orgId, "Synthetic Child", "2016-06-15", "day");
    const mirrored = await db.query<{ is_minor: boolean; birth_date: string }>(
      `select is_minor, birth_date::text as birth_date from public.persons where id = $1`,
      [child],
    );
    expect(mirrored.rows[0].is_minor).toBe(true);
    expect(mirrored.rows[0].birth_date).toBe("2016-06-15");

    await expectDbError(
      () =>
        db.query(
          `insert into public.persons (organization_id, display_name, date_of_birth, birth_date_precision)
           values ($1, 'Bad partial', date '2010-06-15', 'month')`,
          [orgId],
        ),
      /check|birth/,
    );
    await expectDbError(
      () =>
        db.query(
          `insert into public.persons (organization_id, display_name, date_of_birth, birth_date_precision)
           values ($1, 'Future', current_date + 1, 'day')`,
          [orgId],
        ),
      /future/,
    );

    await db.query(
      `insert into public.access_grants (organization_id, grantee_person_id, subject_person_id, kind, purpose)
       values ($1, $2, $3, 'guardian', 'Synthetic guardian authority')`,
      [orgId, guardian, child],
    );
    await asUser(db, { userId: guardianUser, aal: "aal1", orgId });
    const visible = await db.query<{ id: string }>(`select id from public.persons`);
    expect(visible.rows.map((row) => row.id)).toContain(child);

    await asMaintenance(db);
    await db.query(`update public.organizations set age_of_majority_years = 18 where id = $1`, [orgId]);
    const stillFlag = await db.query<{ is_minor: boolean }>(
      `select is_minor from public.persons where id = $1`,
      [child],
    );
    expect(stillFlag.rows[0].is_minor).toBe(true);
    await db.query(
      `update public.persons set date_of_birth = (app.firm_today(organization_id) - interval '18 years')::date, birth_date_precision = 'day' where id = $1`,
      [child],
    );
    const after = await db.query<{ is_minor: boolean; live: boolean }>(
      `select is_minor, app.person_is_minor(id) as live from public.persons where id = $1`,
      [child],
    );
    expect(after.rows[0].is_minor).toBe(false);
    expect(after.rows[0].live).toBe(false);
    await expectDbError(
      () =>
        db.query(
          `insert into public.access_grants (organization_id, grantee_person_id, subject_person_id, kind, purpose)
           values ($1, $2, $3, 'guardian', 'Too old')`,
          [orgId, guardian, child],
        ),
      /minor/,
    );
    await asUser(db, { userId: guardianUser, aal: "aal1", orgId });
    const afterMajority = await db.query<{ id: string }>(`select id from public.persons`);
    expect(afterMajority.rows.map((row) => row.id)).not.toContain(child);

    await asMaintenance(db);
    const outbox = await db.query<{ n: number }>(
      `select count(*)::int as n from public.outbox_events
       where aggregate_id = $1 and event_type = 'person.majority_review_due'`,
      [child],
    );
    expect(countOf(outbox.rows[0].n)).toBe(1);

    const def = await db.query<{ def: string }>(
      `select pg_get_functiondef('app.can_read_person(uuid)'::regprocedure) as def`,
    );
    expect(def.rows[0].def).not.toMatch(/actor_is_firm_owner/);
    expect(def.rows[0].def).not.toMatch(/household/);
    const grants = await db.query<{ def: string }>(
      `select pg_get_functiondef('app.grant_allows(uuid, uuid, uuid)'::regprocedure) as def`,
    );
    expect(grants.rows[0].def).toMatch(/person_is_minor/);
    expect(grants.rows[0].def).not.toMatch(/household/);
    const assigned = await db.query<{ def: string }>(
      `select pg_get_functiondef('app.actor_staff_assigned_to_matter(uuid, uuid)'::regprocedure) as def`,
    );
    expect(assigned.rows[0].def).not.toMatch(/finance_user/);
  });
});

describe("recovery codes, sessions, and passkeys", () => {
  it("hashes single-use codes, revokes sessions, and accepts passkey or webauthn assurance", async () => {
    const owner = await createUser(email("owner"));
    const staff = await createUser(email("staff"));
    const orgId = await createOrg(owner);
    await activeMembership(orgId, staff, "case_manager", owner);
    const ownerSession = randomUUID();
    const otherSession = randomUUID();

    await asUser(db, {
      userId: owner,
      aal: "aal2",
      orgId,
      totpAgeSeconds: 20 * 60,
      sessionId: ownerSession,
    });
    await expectDbError(() => db.query(`select public.generate_recovery_codes()`), /step-up/);

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0, sessionId: ownerSession });
    const generated = await db.query<{ codes: string[] }>(`select public.generate_recovery_codes() as codes`);
    const codes = codesOf(generated.rows[0].codes);
    expect(codes).toHaveLength(10);
    expect(codes[0]).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){4}$/);

    await asMaintenance(db);
    const stored = await db.query<{ code_hash: string }>(
      `select code_hash from public.mfa_recovery_codes where user_id = $1 and retired_at is null`,
      [owner],
    );
    expect(stored.rows).toHaveLength(10);
    const hashed = await db.query<{ hash: string }>(`select app.hash_recovery_code($1) as hash`, [
      codes[0].toLowerCase().replaceAll("-", " "),
    ]);
    expect(stored.rows.map((row) => row.code_hash)).toContain(hashed.rows[0].hash);
    expect(stored.rows.map((row) => row.code_hash)).not.toContain(codes[0]);
    const leaked = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log where diff::text like $1 or context::text like $1`,
      [`%${codes[0]}%`],
    );
    expect(countOf(leaked.rows[0].n)).toBe(0);

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0, sessionId: ownerSession });
    const regenerated = await db.query<{ codes: string[] }>(`select public.generate_recovery_codes() as codes`);
    const fresh = codesOf(regenerated.rows[0].codes);
    expect(fresh).not.toContain(codes[0]);
    await asUser(db, { userId: owner, aal: "aal1", orgId, sessionId: ownerSession });
    const retired = await db.query<{ ok: boolean }>(
      `select public.consume_recovery_code($1) as ok`,
      [codes[0]],
    );
    expect(retired.rows[0].ok).toBe(false);
    const consumed = await db.query<{ ok: boolean }>(
      `select public.consume_recovery_code($1) as ok`,
      [fresh[0]],
    );
    expect(consumed.rows[0].ok).toBe(true);
    const assured = await db.query<{ staff: boolean; step: boolean }>(
      `select app.staff_mfa_satisfied() as staff, app.mfa_step_up_satisfied() as step`,
    );
    expect(assured.rows[0].staff).toBe(true);
    expect(assured.rows[0].step).toBe(true);
    const reused = await db.query<{ ok: boolean }>(
      `select public.consume_recovery_code($1) as ok`,
      [fresh[0]],
    );
    expect(reused.rows[0].ok).toBe(false);
    await asUser(db, { userId: owner, aal: "aal1", orgId, sessionId: randomUUID() });
    const otherProof = await db.query<{ staff: boolean; step: boolean }>(
      `select app.staff_mfa_satisfied() as staff, app.mfa_step_up_satisfied() as step`,
    );
    expect(otherProof.rows[0].staff).toBe(false);
    expect(otherProof.rows[0].step).toBe(false);

    const lockUser = await createUser(email("lock"));
    await asMaintenance(db);
    await db.query(
      `insert into public.mfa_recovery_codes (user_id, code_hash, batch_id)
       values ($1, app.hash_recovery_code('AAAA-BBBB-CCCC-DDDD-EEEE'), gen_random_uuid())`,
      [lockUser],
    );
    await asUser(db, { userId: lockUser, aal: "aal1", sessionId: randomUUID() });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejected = await db.query<{ ok: boolean }>(
        `select public.consume_recovery_code($1) as ok`,
        ["ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ"],
      );
      expect(rejected.rows[0].ok).toBe(false);
    }
    const locked = await db.query<{ ok: boolean }>(
      `select public.consume_recovery_code($1) as ok`,
      ["AAAA-BBBB-CCCC-DDDD-EEEE"],
    );
    expect(locked.rows[0].ok).toBe(false);
    await asMaintenance(db);
    const unused = await db.query<{ n: number }>(
      `select count(*)::int as n from public.mfa_recovery_codes
       where user_id = $1 and used_at is null and retired_at is null`,
      [lockUser],
    );
    expect(countOf(unused.rows[0].n)).toBe(1);

    await asMaintenance(db);
    await db.query(
      `insert into auth.sessions (id, user_id, aal, user_agent) values ($1, $2, 'aal2', 'synthetic-current'), ($3, $2, 'aal2', 'synthetic-other')`,
      [ownerSession, owner, otherSession],
    );
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0, sessionId: ownerSession });
    const listed = await db.query<{ session_id: string }>(`select session_id from public.list_my_sessions()`);
    expect(listed.rows.map((row) => row.session_id).sort()).toEqual([ownerSession, otherSession].sort());
    const removed = await db.query<{ n: number }>(`select public.revoke_other_sessions() as n`);
    expect(countOf(removed.rows[0].n)).toBe(1);
    await db.query(`select public.revoke_my_session($1)`, [ownerSession]);
    const revoked = await db.query<{ staff: boolean }>(`select app.staff_mfa_satisfied() as staff`);
    expect(revoked.rows[0].staff).toBe(false);

    await asMaintenance(db);
    const factor = randomUUID();
    const staffSession = randomUUID();
    await db.query(
      `insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', 'verified')`,
      [factor, staff],
    );
    await db.query(`insert into auth.sessions (id, user_id, aal) values ($1, $2, 'aal2')`, [staffSession, staff]);
    await db.query(`insert into auth.webauthn_credentials (id, user_id) values ($1, $2)`, [randomUUID(), staff]);

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0, sessionId: randomUUID() });
    await expectDbError(
      () => db.query(`select public.reset_staff_mfa($1, $2, 'Lost device')`, [orgId, owner]),
      /own authenticator/,
    );
    await db.query(`select public.reset_staff_mfa($1, $2, 'Lost authenticator device')`, [orgId, staff]);

    await asMaintenance(db);
    expect((await db.query(`select id from auth.mfa_factors where user_id = $1`, [staff])).rows).toHaveLength(0);
    expect((await db.query(`select id from auth.sessions where user_id = $1`, [staff])).rows).toHaveLength(0);
    expect((await db.query(`select id from auth.webauthn_credentials where user_id = $1`, [staff])).rows).toHaveLength(0);
    const resetAudit = await db.query<{ context: { reason_length?: number } }>(
      `select context from public.audit_log where action = 'mfa.staff_reset' and object_id = $1`,
      [staff],
    );
    expect(resetAudit.rows[0].context.reason_length).toBe("Lost authenticator device".length);
    expect(JSON.stringify(resetAudit.rows)).not.toContain("Lost authenticator");

    const oldIssued = 1_600_000_000;
    await asUser(db, {
      userId: staff,
      aal: "aal2",
      orgId,
      totpAgeSeconds: 0,
      sessionId: staffSession,
      issuedAtSeconds: oldIssued,
    });
    expect((await db.query<{ staff: boolean }>(`select app.staff_mfa_satisfied() as staff`)).rows[0].staff).toBe(false);

    await asUser(db, {
      userId: owner,
      aal: "aal1",
      orgId,
      amrMethod: "passkey",
      totpAgeSeconds: 0,
      sessionId: randomUUID(),
    });
    const passkey = await db.query<{ staff: boolean; step: boolean }>(
      `select app.staff_mfa_satisfied() as staff, app.mfa_step_up_satisfied() as step`,
    );
    expect(passkey.rows[0].staff).toBe(true);
    expect(passkey.rows[0].step).toBe(true);

    await asUser(db, {
      userId: owner,
      aal: "aal1",
      orgId,
      amrMethod: "passkey",
      totpAgeSeconds: 20 * 60,
      sessionId: randomUUID(),
    });
    const stalePasskey = await db.query<{ staff: boolean; step: boolean }>(
      `select app.staff_mfa_satisfied() as staff, app.mfa_step_up_satisfied() as step`,
    );
    expect(stalePasskey.rows[0].staff).toBe(true);
    expect(stalePasskey.rows[0].step).toBe(false);

    await asUser(db, { userId: owner, aal: "aal1", orgId, amrMethod: "totp", totpAgeSeconds: 0, sessionId: randomUUID() });
    const totpOnly = await db.query<{ staff: boolean; step: boolean }>(
      `select app.staff_mfa_satisfied() as staff, app.mfa_step_up_satisfied() as step`,
    );
    expect(totpOnly.rows[0].staff).toBe(false);
    expect(totpOnly.rows[0].step).toBe(false);

    await asUser(db, {
      userId: owner,
      aal: "aal2",
      orgId,
      amrMethod: "mfa/webauthn",
      totpAgeSeconds: 0,
      sessionId: randomUUID(),
    });
    const webauthn = await db.query<{ staff: boolean; step: boolean }>(
      `select app.staff_mfa_satisfied() as staff, app.mfa_step_up_satisfied() as step`,
    );
    expect(webauthn.rows[0].staff).toBe(true);
    expect(webauthn.rows[0].step).toBe(true);
  });
});
