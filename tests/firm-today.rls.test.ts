import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * Date rules count "today" in the firm's timezone (DECISIONS 2026-10-19, "Some date rules count
 * today in UTC"; 20261019216000_firm_today.sql, 20261019216100_firm_today_rules.sql).
 * Synthetic people only.
 *
 * PGlite cannot move statement_timestamp(), so the rules are checked three ways:
 * - app.firm_local_date (what app.firm_today runs at statement_timestamp()) against fixed moments;
 * - the real clock, in a firm whose zone is on a different date than UTC at this hour;
 * - each rule, with app.firm_today pinned to 02:00 UTC today, which is 9 or 10 pm the evening
 *   before in Toronto: the firm's date is then a day behind the server's current_date, so a rule
 *   still counting in UTC would accept a date the firm hasn't reached yet.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

function plusDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

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

async function moveStage(matterId: string, stage: string) {
  await asMaintenance(db);
  await db.query(
    `do $$ begin
       insert into app.matter_stage_transition_nonce (matter_id, txid) values ('${matterId}', txid_current())
         on conflict (matter_id) do update set txid = excluded.txid;
       update public.matters set stage = '${stage}' where id = '${matterId}';
       delete from app.matter_stage_transition_nonce where matter_id = '${matterId}';
     end $$`,
  );
}

/** A real (not sample) firm in its default timezone, with a licensed consultant and one client matter. */
async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  await fresh(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  await fresh(consultant, orgId);
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  const credentialId = credential.rows[0].id;
  await fresh(owner, orgId);
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credentialId, REGISTER, PROOF],
  );
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  await fresh(consultant, orgId);
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, null, null, null, $2, null, null) as result`, [
    "Synthetic Applicant",
    consultantMembership,
  ]);
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role, created_by) values ($1, $2, $3, 'case_manager', $4)`,
    [orgId, matterId, managerMembership, owner],
  );
  return { owner, consultant, manager, orgId, matterId, consultantMembership, managerMembership, credentialId };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function insertPerson(orgId: string, dateOfBirth: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string; is_minor: boolean }>(
    `insert into public.persons (organization_id, display_name, date_of_birth, birth_date_precision)
     values ($1, 'Synthetic person', $2::date, 'day') returning id, is_minor`,
    [orgId, dateOfBirth],
  );
  return row.rows[0];
}

describe("app.firm_today", () => {
  it("counts the day in the firm's timezone, America/Toronto when unset or invalid", async () => {
    const f = await firm();
    await asMaintenance(db);
    const at = async (org: string | null, moment: string) =>
      (await db.query<{ d: string }>(`select app.firm_local_date($1, $2::timestamptz)::text as d`, [org, moment])).rows[0].d;
    // 1 am UTC on 19 October is 9 pm on 18 October in Toronto (EDT); in winter the gap is five hours (EST).
    expect(await at(f.orgId, "2026-10-19T01:00:00Z")).toBe("2026-10-18");
    expect(await at(f.orgId, "2026-10-19T03:59:59Z")).toBe("2026-10-18");
    expect(await at(f.orgId, "2026-10-19T04:00:00Z")).toBe("2026-10-19");
    expect(await at(f.orgId, "2026-12-02T04:30:00Z")).toBe("2026-12-01");
    expect(await at(f.orgId, "2026-12-02T05:00:00Z")).toBe("2026-12-02");
    expect(await at(null, "2026-10-19T01:00:00Z")).toBe("2026-10-18");
    await db.query(`update public.organizations set timezone = 'Not/AZone' where id = $1`, [f.orgId]);
    expect(await at(f.orgId, "2026-10-19T01:00:00Z")).toBe("2026-10-18");
    await db.query(`update public.organizations set timezone = 'America/Vancouver' where id = $1`, [f.orgId]);
    expect(await at(f.orgId, "2026-10-19T06:00:00Z")).toBe("2026-10-18");
    await db.query(`update public.organizations set timezone = 'UTC' where id = $1`, [f.orgId]);
    expect(await at(f.orgId, "2026-10-19T01:00:00Z")).toBe("2026-10-19");
  });

  it("reads the real clock in the firm's zone, not the server's date", async () => {
    const f = await firm();
    // A zone on a different calendar date from UTC at this hour: 12 hours behind before noon UTC, 14 ahead after.
    const zone = new Date().getUTCHours() < 12 ? "Etc/GMT+12" : "Pacific/Kiritimati";
    await asMaintenance(db);
    const toronto = await db.query<{ today: string; utc: string; same: boolean }>(
      `select app.firm_today($1)::text as today, current_date::text as utc,
              app.firm_today($1) = app.firm_local_date($1, statement_timestamp()) as same`,
      [f.orgId],
    );
    expect(toronto.rows[0].today).toBe(firmDay());
    expect(toronto.rows[0].same).toBe(true);
    await db.query(`update public.organizations set timezone = $2 where id = $1`, [f.orgId, zone]);
    const far = await db.query<{ today: string; utc: string }>(`select app.firm_today($1)::text as today, current_date::text as utc`, [f.orgId]);
    expect(far.rows[0].today).toBe(firmDay(0, zone));
    expect(far.rows[0].today).not.toBe(far.rows[0].utc);
    // A rule follows the firm's date on the real clock: tomorrow in the firm is refused, today accepted.
    await expectDbError(() => insertPerson(f.orgId, firmDay(1, zone)), /future/);
    await insertPerson(f.orgId, firmDay(0, zone));
  });

  it("is executable by signed-in staff (create_client_matter is security invoker) but not anon", async () => {
    await asMaintenance(db);
    const acl = await db.query<{ authenticated: boolean; anon: boolean }>(
      `select has_function_privilege('authenticated', 'app.firm_today(uuid)', 'execute') as authenticated,
              has_function_privilege('anon', 'app.firm_today(uuid)', 'execute') as anon`,
    );
    expect(acl.rows[0]).toEqual({ authenticated: true, anon: false });
  });

  it("is the only today in the firm's date rules: no function counts the day with the server's date", async () => {
    await asMaintenance(db);
    const utc = await db.query<{ fn: string }>(
      `select n.nspname || '.' || p.proname as fn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('app', 'public')
         and (p.prosrc ~* '\\mcurrent_date\\M'
           or p.prosrc ~* 'localtimestamp'
           or p.prosrc ~* '(now|statement_timestamp|transaction_timestamp|clock_timestamp)\\(\\)\\s*\\)?\\s*::\\s*date'
           or p.prosrc ~* 'at time zone ''utc''\\s*\\)\\s*::\\s*date')
       order by 1`,
    );
    expect(utc.rows.map((row) => row.fn)).toEqual([]);
    const rules = [
      "app.person_is_minor",
      "app.sync_person_birth",
      "app.open_intake_response",
      "app.request_version_satisfies",
      "app.accept_quote",
      "app.set_credential_valid_until",
      // public.create_client_matter's body (20261020130000_work_pages_fixes.sql).
      "app.create_client_matter_as",
      "app.update_task",
      "public.update_lead",
      "public.add_lead_follow_up",
      "app.sign_off_submission_handoff",
      "app.gov_finish_verification",
      "app.record_government_correspondence",
      "app.record_decision",
      // app.migration_evaluate dispatches by kind since MIG-01 (20261025385100): its clients body
      // moved unchanged to migration_evaluate_clients; the other kinds use migration_evaluate_kind.
      "app.migration_evaluate_clients",
      "app.migration_evaluate_kind",
    ];
    const uses = await db.query<{ fn: string }>(
      `select distinct n.nspname || '.' || p.proname as fn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname || '.' || p.proname = any($1::text[]) and p.prosrc like '%app.firm_today(%'
       order by 1`,
      [rules],
    );
    expect(uses.rows.map((row) => row.fn)).toEqual([...rules].sort());
  });
});

describe("date rules on a Toronto evening (app.firm_today pinned to 02:00 UTC today)", () => {
  // The server's date (current_date, UTC) and the firm's date (Toronto) a day behind it.
  const server = new Date().toISOString().slice(0, 10);
  const today = plusDays(server, -1);
  let original = "";

  beforeAll(async () => {
    await asMaintenance(db);
    original = (await db.query<{ def: string }>(`select pg_get_functiondef('app.firm_today(uuid)'::regprocedure) as def`)).rows[0].def;
    await db.exec(`
      create or replace function app.firm_today(p_org uuid)
      returns date
      language sql
      stable
      security definer
      set search_path = ''
      as $$
        select app.firm_local_date(p_org, timestamptz '${server}T02:00:00Z');
      $$;
    `);
    const check = await db.query<{ firm: string; utc: string }>(`select app.firm_today(null)::text as firm, current_date::text as utc`);
    expect(check.rows[0]).toEqual({ firm: today, utc: server });
  });

  afterAll(async () => {
    await asMaintenance(db);
    await db.exec(original);
  });

  it("refuses a date of birth that is still tomorrow for the firm, and derives minority on the firm's date", async () => {
    const f = await firm();
    await expectDbError(() => insertPerson(f.orgId, server), /date of birth cannot be in the future/);
    await insertPerson(f.orgId, today);
    // Turns 18 on the server's date, which the firm hasn't reached: still a minor.
    await db.query(`update public.organizations set age_of_majority_years = 18 where id = $1`, [f.orgId]);
    const eighteen = (await db.query<{ d: string }>(`select ($1::date - interval '18 years')::date::text as d`, [server])).rows[0].d;
    const person = await insertPerson(f.orgId, eighteen);
    expect(person.is_minor).toBe(true);
    const live = await db.query<{ minor: boolean }>(`select app.person_is_minor($1) as minor`, [person.id]);
    expect(live.rows[0].minor).toBe(true);
  });

  it("create_client_matter refuses a date of birth the firm hasn't reached", async () => {
    const f = await firm();
    await fresh(f.consultant, f.orgId);
    const open = (birth: string) =>
      db.query(`select public.create_client_matter('Synthetic Applicant', null, null, null, $1, null, null, $2::date, null)`, [
        f.consultantMembership,
        birth,
      ]);
    await expectDbError(() => open(server), /date of birth is not plausible/);
    await open(today);
  });

  it("set_credential_valid_until accepts the firm's today and refuses yesterday", async () => {
    const f = await firm();
    await fresh(f.owner, f.orgId);
    await db.query(`select public.set_credential_valid_until($1, $2::date)`, [f.credentialId, today]);
    await expectDbError(
      () => db.query(`select public.set_credential_valid_until($1, $2::date)`, [f.credentialId, plusDays(today, -1)]),
      /licence expiry date is in the past/,
    );
  });

  it("government correspondence and decisions refuse dates the firm hasn't reached; a refusal's review task is due on the firm's today", async () => {
    const f = await firm();
    await moveStage(f.matterId, "decision_review");
    await stale(f.manager, f.orgId);
    const letter = (received: string, documentDate: string | null) =>
      db.query<{ id: string }>(
        `select public.record_government_correspondence($1, 'decision'::public.correspondence_kind, 'Synthetic authority', 'portal_message',
           $3::date, $2::date, null, null, null, null, 'Synthetic letter, page 1', null) as id`,
        [f.matterId, received, documentDate],
      );
    await expectDbError(() => letter(server, null), /received date is required and cannot be in the future/);
    await expectDbError(() => letter(today, server), /date on the letter cannot be in the future/);
    const id = (await letter(today, today)).rows[0].id;
    await fresh(f.manager, f.orgId);
    await db.query(`select public.verify_government_correspondence($1, 1)`, [id]);
    await stale(f.manager, f.orgId);
    await expectDbError(
      () => db.query(`select public.record_decision($1, 'refused', null, $2::date, 'Synthetic quoted reasons')`, [id, server]),
      /decision date cannot be in the future/,
    );
    const decision = await db.query<{ id: string }>(`select public.record_decision($1, 'refused', null, $2::date, 'Synthetic quoted reasons') as id`, [
      id,
      today,
    ]);
    await asMaintenance(db);
    const task = await db.query<{ due_on: string }>(
      `select task.due_on::text as due_on from public.decision_follow_ups follow
       join public.tasks task on task.id = follow.task_id
       where follow.decision_id = $1 and follow.kind = 'refusal_review'`,
      [decision.rows[0].id],
    );
    expect(task.rows.map((row) => row.due_on)).toEqual([today]);
  });

  it("leads: a date of birth and a follow-up due date are checked against the firm's today", async () => {
    const f: Firm = await firm();
    await fresh(f.manager, f.orgId);
    const lead = await db.query<{ id: string }>(
      `select public.create_lead($1, 'Synthetic Lead', 'lead@example.test', null, 'email', 'Work permit', 'Canada', 'English',
         'phone'::public.lead_source, null, null, null, array[]::text[], null, true, false) as id`,
      [f.orgId],
    );
    const leadId = lead.rows[0].id;
    const update = (birth: string) =>
      db.query(
        `select public.update_lead($1, $2, 1, 'Synthetic Lead', 'lead@example.test', null, 'email', 'Work permit', 'Canada', 'English',
           $3::date, null, null, null, array[]::text[])`,
        [f.orgId, leadId, birth],
      );
    await expectDbError(() => update(server), /date of birth is not plausible/);
    await update(today);
    const followUp = (due: string) =>
      db.query(`select public.add_lead_follow_up($1, $2, 'Call back', null, $3::date)`, [f.orgId, leadId, due]);
    // From yesterday (one day's grace, as before) to two years ahead, counted from the firm's today.
    await followUp(plusDays(today, -1));
    await expectDbError(() => followUp(plusDays(today, -2)), /choose a due date from today to two years ahead/);
  });
});
