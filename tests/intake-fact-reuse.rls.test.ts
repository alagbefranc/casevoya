import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261024180000_intake_fact_reuse.sql (INT-04): reusing approved facts on a later matter's form,
// the client's reconfirmation, the send guard, and who may do what. Synthetic records only.

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function staff(userId: string, orgId: string, stepUp = false) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: stepUp ? 0 : 3600 });
}

async function portal(userId: string, orgId: string) {
  await asUser(db, { userId, aal: "aal1", orgId });
}

async function user() {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `u-${tag()}@example.test`]);
  return id;
}

const SCHEMA = {
  fields: [
    { key: "full_name", type: "text", labels: { "en-CA": "Full name" }, required: true },
    { key: "date_of_birth", type: "date", labels: { "en-CA": "Date of birth" }, required: true },
    { key: "trips", type: "repeatable", labels: { "en-CA": "Trips" } },
    { key: "confirm", type: "declaration", labels: { "en-CA": "My answers are true" }, required: true },
  ],
};

async function firm() {
  const owner = await user();
  const consultant = await user();
  const manager = await user();
  const assistant = await user();
  const unassigned = await user();
  const applicant = await user();
  const sponsor = await user();
  await staff(owner, "", true);
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
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
  const assistantMembership = await add(assistant, "assistant");
  await add(unassigned, "case_manager");
  await add(applicant, "client");
  await add(sponsor, "sponsor");
  await db.query(`update public.organizations set sample_mode = true where id = $1`, [orgId]);

  await staff(manager, orgId);
  const draft = (await db.query<{ saved: { id: string; version: number } }>(`select public.save_intake_draft('background', 'Background questions', $1::jsonb, null, null) as saved`, [JSON.stringify(SCHEMA)])).rows[0].saved;
  await staff(consultant, orgId, true);
  await db.query(`select public.publish_intake_draft($1, $2)`, [draft.id, draft.version]);

  const matter = async () => {
    await staff(consultant, orgId);
    const id = (await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership])).rows[0].result.id;
    await asMaintenance(db);
    await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [orgId, id, managerMembership]);
    await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [orgId, id, assistantMembership]);
    return id;
  };
  const first = await matter();
  const second = await matter();
  await asMaintenance(db);
  const person = async (name: string, userId: string) =>
    (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, $2, true, $3) returning id`, [orgId, name, userId])).rows[0].id;
  const applicantPerson = await person("Synthetic Applicant", applicant);
  const sponsorPerson = await person("Synthetic Sponsor", sponsor);
  for (const matterId of [first, second]) {
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, applicantPerson]);
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'sponsor')`, [orgId, matterId, sponsorPerson]);
  }
  return { orgId, owner, consultant, manager, assistant, unassigned, applicant, sponsor, first, second, templateId: draft.id, applicantPerson, sponsorPerson };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function send(f: Firm, matterId: string, personId: string) {
  await staff(f.manager, f.orgId);
  return (await db.query<{ sent: { response_id: string } }>(`select public.send_intake_request($1, $2, $3, null, null) as sent`, [matterId, personId, f.templateId])).rows[0].sent.response_id;
}

async function version(responseId: string) {
  await asMaintenance(db);
  return (await db.query<{ version: number }>(`select version from public.intake_responses where id = $1`, [responseId])).rows[0].version;
}

async function answer(userId: string, orgId: string, responseId: string, key: string, value: object) {
  const at = await version(responseId);
  await portal(userId, orgId);
  return (await db.query<{ id: string }>(`select public.save_intake_answer($1, $2, $3, 'provided', $4::jsonb) as id`, [responseId, at, key, JSON.stringify(value)])).rows[0].id;
}

async function submit(userId: string, orgId: string, responseId: string) {
  const at = await version(responseId);
  await portal(userId, orgId);
  await db.query(`select public.submit_intake_response($1, $2)`, [responseId, at]);
}

/** The applicant's first matter: answered, sent, and two answers reviewed (the trips are not). */
async function approvedFirstForm(f: Firm) {
  const response = await send(f, f.first, f.applicantPerson);
  const name = await answer(f.applicant, f.orgId, response, "full_name", { text: "Synthetic Applicant" });
  const birth = await answer(f.applicant, f.orgId, response, "date_of_birth", { date_kind: "year_month", year: 1984, month: 3 });
  await answer(f.applicant, f.orgId, response, "trips", { entries: [{ country: "FR" }] });
  await answer(f.applicant, f.orgId, response, "confirm", { declaration: true });
  await submit(f.applicant, f.orgId, response);
  await staff(f.manager, f.orgId);
  await db.query(`select public.review_intake_answer($1)`, [name]);
  await db.query(`select public.review_intake_answer($1)`, [birth]);
  return { response, name, birth };
}

async function reuses(responseId: string) {
  await asMaintenance(db);
  return (
    await db.query<{ id: string; field_key: string; status: string; answer_id: string; origin_answer_id: string; origin_matter_id: string; confirmed_by: string | null }>(
      `select id, field_key, status::text, answer_id, origin_answer_id, origin_matter_id, confirmed_by from public.intake_fact_reuses where response_id = $1 order by field_key`,
      [responseId],
    )
  ).rows;
}

describe("Reuse approved facts", () => {
  it("copies only reviewed answers of the same person, as new versions that need the client's reconfirmation", async () => {
    const f = await firm();
    const origin = await approvedFirstForm(f);
    const target = await send(f, f.second, f.applicantPerson);

    await staff(f.manager, f.orgId);
    const copied = (await db.query<{ n: number }>(`select public.reuse_approved_facts($1) as n`, [target])).rows[0].n;
    expect(copied).toBe(2);

    const rows = await reuses(target);
    expect(rows.map((row) => [row.field_key, row.status, row.origin_matter_id])).toEqual([
      ["date_of_birth", "needs_reconfirmation", f.first],
      ["full_name", "needs_reconfirmation", f.first],
    ]);
    expect(rows.find((row) => row.field_key === "full_name")?.origin_answer_id).toBe(origin.name);

    await asMaintenance(db);
    const answers = (
      await db.query<{ field_key: string; normalized_value: Record<string, unknown>; created_by: string }>(
        `select field_key, normalized_value, created_by from public.intake_answer_versions where response_id = $1 order by field_key`,
        [target],
      )
    ).rows;
    // The unreviewed trips and the declaration are never copied.
    expect(answers.map((row) => row.field_key)).toEqual(["date_of_birth", "full_name"]);
    expect(answers[0].normalized_value).toEqual({ year: 1984, month: 3 });
    expect(answers[1].created_by).toBe(f.manager);

    const audit = (await db.query<{ n: string }>(`select count(*)::text as n from public.audit_log where action = 'intake.facts_reused' and object_id = $1`, [target])).rows[0].n;
    expect(audit).toBe("1");

    // A second run finds every question answered already.
    await staff(f.consultant, f.orgId);
    expect((await db.query<{ n: number }>(`select public.reuse_approved_facts($1) as n`, [target])).rows[0].n).toBe(0);
  });

  it("refuses an assistant, a case manager not on the matter, the client, and a form already sent; another person gets none of these facts", async () => {
    const f = await firm();
    await approvedFirstForm(f);
    const target = await send(f, f.second, f.applicantPerson);
    await staff(f.assistant, f.orgId);
    await expectDbError(() => db.query(`select public.reuse_approved_facts($1)`, [target]), /denied/);
    await staff(f.unassigned, f.orgId);
    await expectDbError(() => db.query(`select public.reuse_approved_facts($1)`, [target]), /denied/);
    await portal(f.applicant, f.orgId);
    await expectDbError(() => db.query(`select public.reuse_approved_facts($1)`, [target]), /denied/);

    const sponsorForm = await send(f, f.second, f.sponsorPerson);
    await staff(f.manager, f.orgId);
    expect((await db.query<{ n: number }>(`select public.reuse_approved_facts($1) as n`, [sponsorForm])).rows[0].n).toBe(0);

    // A different firm's form for a person of its own: nothing crosses firms.
    const other = await firm();
    const otherTarget = await send(other, other.second, other.applicantPerson);
    await staff(other.manager, other.orgId);
    expect((await db.query<{ n: number }>(`select public.reuse_approved_facts($1) as n`, [otherTarget])).rows[0].n).toBe(0);
    await staff(other.manager, other.orgId);
    await expectDbError(() => db.query(`select public.reuse_approved_facts($1)`, [target]), /denied/);

    const sent = await send(f, f.second, f.sponsorPerson);
    await answer(f.sponsor, f.orgId, sent, "full_name", { text: "Synthetic Sponsor" });
    await answer(f.sponsor, f.orgId, sent, "date_of_birth", { date_kind: "year", year: 1960 });
    await answer(f.sponsor, f.orgId, sent, "confirm", { declaration: true });
    await submit(f.sponsor, f.orgId, sent);
    await staff(f.manager, f.orgId);
    await expectDbError(() => db.query(`select public.reuse_approved_facts($1)`, [sent]), /before the client sends/);
  });

  it("lets only the client confirm, marks a changed answer replaced, and holds the form until every copied answer is settled", async () => {
    const f = await firm();
    await approvedFirstForm(f);
    const target = await send(f, f.second, f.applicantPerson);
    await staff(f.manager, f.orgId);
    await db.query(`select public.reuse_approved_facts($1)`, [target]);
    const [birth, name] = await reuses(target);

    // Staff and another person can't confirm for the client.
    await staff(f.manager, f.orgId);
    await expectDbError(() => db.query(`select public.confirm_reused_fact($1)`, [name.id]), /denied/);
    await portal(f.sponsor, f.orgId);
    await expectDbError(() => db.query(`select public.confirm_reused_fact($1)`, [name.id]), /denied/);

    // The client reads the reuse rows of their own form; the sponsor reads none.
    await portal(f.sponsor, f.orgId);
    expect((await db.query(`select id from public.intake_fact_reuses where response_id = $1`, [target])).rows).toHaveLength(0);
    await portal(f.applicant, f.orgId);
    expect((await db.query(`select id from public.intake_fact_reuses where response_id = $1`, [target])).rows).toHaveLength(2);

    await db.query(`select public.confirm_reused_fact($1)`, [name.id]);
    await db.query(`select public.confirm_reused_fact($1)`, [name.id]);
    await answer(f.applicant, f.orgId, target, "confirm", { declaration: true });
    await expectDbError(() => submit(f.applicant, f.orgId, target), /confirm the answers from your earlier matter first/);

    // Changing the copied date of birth replaces it; confirming the old copy is then refused.
    await answer(f.applicant, f.orgId, target, "date_of_birth", { date_kind: "exact", calendar_date: "1984-03-12" });
    await portal(f.applicant, f.orgId);
    await expectDbError(() => db.query(`select public.confirm_reused_fact($1)`, [birth.id]), /was changed/);
    const settled = await reuses(target);
    expect(settled.map((row) => [row.field_key, row.status])).toEqual([
      ["date_of_birth", "replaced"],
      ["full_name", "confirmed"],
    ]);
    expect(settled[1].confirmed_by).toBe(f.applicant);

    await submit(f.applicant, f.orgId, target);
    await portal(f.applicant, f.orgId);
    await expectDbError(() => db.query(`select public.confirm_reused_fact($1)`, [name.id]), /already sent/);

    // After the client sends it, staff review the reused answer as any other.
    await staff(f.manager, f.orgId);
    await db.query(`select public.review_intake_answer($1)`, [name.answer_id]);
    await asMaintenance(db);
    const audit = (await db.query<{ n: string }>(`select count(*)::text as n from public.audit_log where action = 'intake.reused_fact_confirmed' and object_id = $1`, [name.id])).rows[0].n;
    expect(audit).toBe("1");
  });
});
