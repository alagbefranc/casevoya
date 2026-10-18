import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deadlineError, readDeadline, type NewDeadlineInput } from "@/modules/sheet/new-deadline";
import { asMaintenance, asUser, createTestDb, type TestDb } from "./helpers/postgres";

/**
 * The matter page's "Record a deadline" dialog against the real migrations: what readDeadline
 * produces is exactly what public.record_deadline accepts, and every refusal the database gives
 * reads as the dialog's own copy (never the database message).
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const IRCC = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-status.html";

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

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const finance = await createUser("finance");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  await activeMembership(orgId, finance, "finance_user", owner);

  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);

  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, null, null, null, $2, null, null) as result`, [
    "Synthetic Applicant",
    consultantMembership,
  ]);
  return { owner, consultant, finance, orgId, matterId: matter.rows[0].result.id };
}

function parsed(fields: Parameters<typeof readDeadline>[0]): NewDeadlineInput {
  const read = readDeadline(fields);
  if ("error" in read) throw new Error(read.error);
  return read.input;
}

/**
 * The same call the server action makes, as a signed-in staff member (aal2) whose last
 * authenticator check was an hour ago: recording a deadline needs no fresh step-up.
 */
async function record(userId: string, orgId: string, matterId: string, input: NewDeadlineInput): Promise<{ id?: string; error?: string }> {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 3600 });
  try {
    const result = await db.query<{ id: string }>(
      `select public.record_deadline($1, null, $2::public.deadline_kind, $3, null, null, $4::date, $5::timestamptz, $6, $7, $8::date, null, null, $9) as id`,
      [matterId, input.kind, input.label, input.dueOn, input.dueAt, input.timezone, input.sourceUrl, input.sourceRetrievedOn, input.evidenceLocator],
    );
    return { id: result.rows[0].id };
  } catch (error) {
    return { error: deadlineError(error instanceof Error ? error.message : String(error)) };
  }
}

const LETTER = {
  kind: "correspondence",
  label: "Respond to IRCC request",
  dueOn: "2026-10-30",
  dueTime: "17:00",
  timezone: "America/Toronto",
  evidence: "IRCC request letter, page 2",
  sourceUrl: IRCC,
  retrievedOn: "2026-10-18",
};

describe("Record a deadline (public.record_deadline)", () => {
  it("records a tentative letter deadline with its official source, and proposes reminders", async () => {
    const ctx = await firm();
    const saved = await record(ctx.consultant, ctx.orgId, ctx.matterId, parsed(LETTER));
    expect(saved.error).toBeUndefined();
    const row = await db.query<{
      kind: string;
      label: string;
      due_on: string;
      due_at: string;
      timezone: string;
      source_url: string;
      verification: string;
      evidence_locator: string;
    }>(
      `select kind::text, label, due_on::text, to_char(due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as due_at, timezone, source_url,
              verification::text, evidence_locator
       from public.deadlines where id = $1`,
      [saved.id],
    );
    expect(row.rows[0]).toEqual({
      kind: "correspondence",
      label: "Respond to IRCC request",
      due_on: "2026-10-30",
      due_at: "2026-10-30T21:00",
      timezone: "America/Toronto",
      source_url: IRCC,
      verification: "tentative",
      evidence_locator: "IRCC request letter, page 2",
    });
    const reminders = await db.query<{ n: number }>(`select public.schedule_deadline_reminders($1, '2026-10-01T12:00:00Z') as n`, [saved.id]);
    expect(reminders.rows[0].n).toBeGreaterThan(0);
  });

  it("records an internal target without a source", async () => {
    const ctx = await firm();
    const saved = await record(ctx.consultant, ctx.orgId, ctx.matterId, parsed({ kind: "internal", label: "Draft cover letter", dueOn: "2026-10-25", timezone: "America/Toronto" }));
    expect(saved.error).toBeUndefined();
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a source that is not on the official allowlist, in the dialog's words", async () => {
    const ctx = await firm();
    const saved = await record(ctx.consultant, ctx.orgId, ctx.matterId, parsed({ ...LETTER, sourceUrl: "https://immigration-help.example.com/deadlines" }));
    expect(saved.error).toMatch(/official government allowlist/);
    await asMaintenance(db);
    const left = await db.query<{ n: number }>(`select count(*)::int as n from public.deadlines where matter_id = $1`, [ctx.matterId]);
    expect(left.rows[0].n).toBe(0);
  });

  it("refuses an unusable timezone and a finance user, in the dialog's words", async () => {
    const ctx = await firm();
    const zone = await record(ctx.consultant, ctx.orgId, ctx.matterId, { ...parsed(LETTER), dueAt: null, timezone: "Mars/Olympus" });
    expect(zone.error).toBe("Enter the official timezone, like America/Toronto.");
    const finance = await record(ctx.finance, ctx.orgId, ctx.matterId, parsed(LETTER));
    expect(finance.error).toMatch(/can’t record deadlines|could not be completed/);
  });

  it("refuses a real matter while the firm is in sample mode, and says so honestly", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    await db.query(`update public.organizations set sample_mode = true where id = $1`, [ctx.orgId]);
    const saved = await record(ctx.consultant, ctx.orgId, ctx.matterId, parsed(LETTER));
    expect(saved.error).toMatch(/sample mode/);
    expect(saved.error).not.toMatch(/only sample matters accept new work/);
  });

  it("is not callable by anon", async () => {
    await asMaintenance(db);
    const signature = "public.record_deadline(uuid, uuid, public.deadline_kind, text, date, date, date, timestamptz, text, text, date, uuid, text, text)";
    const grants = await db.query<{ anon: boolean; authenticated: boolean }>(
      `select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as authenticated`,
      [signature],
    );
    expect(grants.rows[0]).toEqual({ anon: false, authenticated: true });
  });
});
