import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * SEC-01 client two-step, part 5 (20261031025000): app.gov_client_on_matter (shared government
 * letters and decisions), public.request_intake_correction and public.my_consents. A portal person
 * with a verified second factor reaches them only from a session that completed it; a client
 * without a factor keeps working at aal1. Synthetic records only.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 12);

const SCHEMA = {
  fields: [{ key: "full_name", type: "text", labels: { "en-CA": "Full name" }, required: true }],
};

async function user(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${tag()}@example.test`,
  ]);
  return id;
}

/** A sample-mode firm with a published intake form and one matter: a guarded client (verified factor) and an open client. */
async function firm() {
  const owner = await user("owner");
  const consultant = await user("consultant");
  const manager = await user("manager");
  const guarded = await user("guarded");
  const open = await user("open");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0]
    .id;
  await asMaintenance(db);
  const add = async (userId: string, role: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
        [orgId, userId, role, owner],
      )
    ).rows[0].id;
  const consultantMembership = await add(consultant, "licensed_consultant");
  const managerMembership = await add(manager, "case_manager");
  await add(guarded, "client");
  await add(open, "client");
  await db.query(`update public.organizations set sample_mode = true where id = $1`, [orgId]);
  await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', 'verified')`, [randomUUID(), guarded]);

  await asUser(db, { userId: manager, aal: "aal2", orgId, totpAgeSeconds: 3600 });
  const draft = (
    await db.query<{ saved: { id: string; version: number } }>(`select public.save_intake_draft('background', 'Background questions', $1::jsonb, null, null) as saved`, [
      JSON.stringify(SCHEMA),
    ])
  ).rows[0].saved;
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.publish_intake_draft($1, $2)`, [draft.id, draft.version]);
  const matterId = (await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership]))
    .rows[0].result.id;

  await asMaintenance(db);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [
    orgId,
    matterId,
    managerMembership,
  ]);
  const person = async (name: string, userId: string) =>
    (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, $2, true, $3) returning id`, [orgId, name, userId]))
      .rows[0].id;
  const guardedPerson = await person("Synthetic Guarded", guarded);
  const openPerson = await person("Synthetic Open", open);
  for (const [personId, role] of [
    [guardedPerson, "applicant"],
    [openPerson, "sponsor"],
  ]) {
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, $4)`, [orgId, matterId, personId, role]);
  }
  return { orgId, manager, guarded, open, matterId, templateId: draft.id, guardedPerson, openPerson };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const asClient = (f: Firm, userId: string, aal: "aal1" | "aal2") =>
  asUser(db, { userId, aal, orgId: f.orgId, ...(aal === "aal2" ? { totpAgeSeconds: 30 } : {}) });

async function responseVersion(responseId: string) {
  await asMaintenance(db);
  return (await db.query<{ version: number }>(`select version from public.intake_responses where id = $1`, [responseId])).rows[0].version;
}

/** Sends the form to the person, who answers and submits it from a session that passes two-step. */
async function submitted(f: Firm, personId: string, userId: string) {
  await asUser(db, { userId: f.manager, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 3600 });
  const responseId = (
    await db.query<{ sent: { response_id: string } }>(`select public.send_intake_request($1, $2, $3, null, null) as sent`, [f.matterId, personId, f.templateId])
  ).rows[0].sent.response_id;
  let at = await responseVersion(responseId);
  await asClient(f, userId, "aal2");
  await db.query(`select public.save_intake_answer($1, $2, 'full_name', 'provided', $3::jsonb)`, [responseId, at, JSON.stringify({ text: "Synthetic Name" })]);
  at = await responseVersion(responseId);
  await asClient(f, userId, "aal2");
  await db.query(`select public.submit_intake_response($1, $2)`, [responseId, at]);
  return responseId;
}

const correct = (responseId: string, text: string) =>
  db.query<{ r: { reference: string } }>(`select public.request_intake_correction($1, 'full_name', 'provided', $2::jsonb, 'Typo', null, null) as r`, [
    responseId,
    JSON.stringify({ text }),
  ]);
const describeProblem = (responseId: string) =>
  db.query(`select public.request_intake_correction($1, null, null, null, null, 'My name is misspelled', null)`, [responseId]);

describe("client two-step: intake corrections", () => {
  it("refuses a correction at aal1 for a client with a verified factor; aal2 and a client without a factor work", async () => {
    const f = await firm();
    const guardedResponse = await submitted(f, f.guardedPerson, f.guarded);
    const openResponse = await submitted(f, f.openPerson, f.open);

    await asClient(f, f.guarded, "aal1");
    await expectDbError(() => describeProblem(guardedResponse), /intake correction denied/);
    await asClient(f, f.guarded, "aal1");
    await expectDbError(() => correct(guardedResponse, "Synthetic Fixed"), /intake correction denied/);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.intake_corrections where response_id = $1`, [guardedResponse])).rows).toHaveLength(0);

    await asClient(f, f.guarded, "aal2");
    expect((await correct(guardedResponse, "Synthetic Fixed")).rows[0].r.reference).toMatch(/^CR-/);
    await asClient(f, f.guarded, "aal2");
    await describeProblem(guardedResponse);

    await asClient(f, f.open, "aal1");
    await describeProblem(openResponse);
    await asClient(f, f.open, "aal1");
    expect((await correct(openResponse, "Synthetic Open Fixed")).rows[0].r.reference).toMatch(/^CR-/);
  });
});

describe("client two-step: my consents", () => {
  it("refuses at aal1 for a client with a verified factor; aal2 and a client without a factor read them", async () => {
    const f = await firm();
    await asClient(f, f.guarded, "aal1");
    await expectDbError(() => db.query(`select public.my_consents()`), /two-step sign-in is required/);

    await asClient(f, f.guarded, "aal2");
    const mine = (await db.query<{ r: Record<string, unknown> }>(`select public.my_consents() as r`)).rows[0].r;
    expect(Object.keys(mine).sort()).toEqual(["ai_drafting", "marketing", "marketing_since", "processing"]);

    await asClient(f, f.open, "aal1");
    const open = (await db.query<{ r: Record<string, unknown> }>(`select public.my_consents() as r`)).rows[0].r;
    expect(open).toHaveProperty("processing");
  });
});

describe("client two-step: government letters and decisions shared with the client", () => {
  it("app.gov_client_on_matter is false at aal1 for a client with a verified factor", async () => {
    const f = await firm();
    const onMatter = async () => (await db.query<{ ok: boolean }>(`select app.gov_client_on_matter($1, $2) as ok`, [f.matterId, f.orgId])).rows[0].ok;

    await asClient(f, f.guarded, "aal1");
    expect(await onMatter()).toBe(false);
    await asClient(f, f.guarded, "aal2");
    expect(await onMatter()).toBe(true);
    await asClient(f, f.open, "aal1");
    expect(await onMatter()).toBe(true);

    // Staff are not clients on the matter; their path (app.gov_staff_can_read) is unchanged.
    await asUser(db, { userId: f.manager, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 3600 });
    expect(await onMatter()).toBe(false);
    expect((await db.query<{ ok: boolean }>(`select app.gov_staff_can_read($1, $2) as ok`, [f.matterId, f.orgId])).rows[0].ok).toBe(true);
  });
});
