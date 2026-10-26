import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261024230000_checklist_templates.sql (DOC-01): firm checklist templates, their approval, and
// Apply checklist with proposals staff confirm. Synthetic records only.

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

async function user() {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `u-${tag()}@example.test`]);
  return id;
}

const INTAKE = { fields: [{ key: "marital_status", type: "choice", labels: { "en-CA": "Marital status" }, options: ["married", "single"] }] };

const ITEMS = [
  { item_key: "passport", purpose: "Passport bio page", explanation: "Every page with stamps, and the bio page.", acceptable_formats: ["pdf", "jpeg"], party_role: "applicant", due_offset_days: 14, records_expiry: true },
  { item_key: "marriage", purpose: "Marriage certificate", explanation: "The certificate issued by the civil registry.", acceptable_formats: ["pdf"], party_role: "applicant", condition_field: "marital_status", condition_equals: "married" },
  { item_key: "income", purpose: "Proof of income", explanation: "Your latest notice of assessment.", acceptable_formats: ["pdf"], party_role: "sponsor", owner: "client" },
];

async function firm() {
  const owner = await user();
  const consultant = await user();
  const manager = await user();
  const assistant = await user();
  const applicant = await user();
  const sponsor = await user();
  await asUser(db, { userId: owner, aal: "aal2", orgId: "", totpAgeSeconds: 0 });
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
  await add(assistant, "assistant");
  await add(applicant, "client");
  await add(sponsor, "sponsor");
  await db.query(`update public.organizations set sample_mode = true where id = $1`, [orgId]);
  await staff(manager, orgId);
  const draft = (await db.query<{ saved: { id: string; version: number } }>(`select public.save_intake_draft('background', 'Background', $1::jsonb, null, null) as saved`, [JSON.stringify(INTAKE)])).rows[0].saved;
  await staff(consultant, orgId, true);
  await db.query(`select public.publish_intake_draft($1, $2)`, [draft.id, draft.version]);
  const matterId = (await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership])).rows[0].result.id;
  await asMaintenance(db);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [orgId, matterId, managerMembership]);
  const person = async (name: string, userId: string, role: string) => {
    const id = (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, $2, true, $3) returning id`, [orgId, name, userId])).rows[0].id;
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, $4::public.matter_party_role)`, [orgId, matterId, id, role]);
    return id;
  };
  const applicantPerson = await person("Synthetic Applicant", applicant, "applicant");
  const sponsorPerson = await person("Synthetic Sponsor", sponsor, "sponsor");
  return { orgId, owner, consultant, manager, assistant, applicant, sponsor, matterId, intakeId: draft.id, applicantPerson, sponsorPerson };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function save(f: Firm, userId: string, items: object[], templateId: string | null = null, key = "spousal") {
  await staff(userId, f.orgId);
  return (await db.query<{ id: string }>(`select public.save_checklist_template($1, $2, 'Spousal sponsorship', $3::jsonb) as id`, [templateId, key, JSON.stringify(items)])).rows[0].id;
}

async function approve(f: Firm, templateId: string) {
  await asMaintenance(db);
  const version = (await db.query<{ version: number }>(`select version from public.checklist_templates where id = $1`, [templateId])).rows[0].version;
  await staff(f.consultant, f.orgId, true);
  await db.query(`select public.approve_checklist_template($1, $2)`, [templateId, version]);
}

type Proposals = { add: { item_id: string; purpose: string; person_id: string }[]; remove: { request_id: string; purpose: string; reason: string }[]; waiting: { purpose: string; field: string }[] };

async function preview(f: Firm, templateId: string): Promise<Proposals> {
  await staff(f.manager, f.orgId);
  return (await db.query<{ p: Proposals }>(`select public.checklist_apply_preview($1, $2) as p`, [f.matterId, templateId])).rows[0].p;
}

async function apply(f: Firm, templateId: string, adds: Proposals["add"], removes: string[] = []) {
  await staff(f.manager, f.orgId, true);
  return (
    await db.query<{ r: { created: number; cancelled: number } }>(`select public.apply_checklist($1, $2, $3::jsonb, $4::uuid[]) as r`, [
      f.matterId,
      templateId,
      JSON.stringify(adds.map((add) => ({ item_id: add.item_id, person_id: add.person_id }))),
      removes,
    ])
  ).rows[0].r;
}

async function answer(f: Firm, value: string) {
  await asMaintenance(db);
  let response = (await db.query<{ id: string; version: number }>(`select id, version from public.intake_responses where matter_id = $1 and person_id = $2`, [f.matterId, f.applicantPerson])).rows[0];
  if (!response) {
    await staff(f.manager, f.orgId);
    await db.query(`select public.send_intake_request($1, $2, $3, null, null)`, [f.matterId, f.applicantPerson, f.intakeId]);
    await asMaintenance(db);
    response = (await db.query<{ id: string; version: number }>(`select id, version from public.intake_responses where matter_id = $1 and person_id = $2`, [f.matterId, f.applicantPerson])).rows[0];
  }
  await asUser(db, { userId: f.applicant, aal: "aal1", orgId: f.orgId });
  await db.query(`select public.save_intake_answer($1, $2, 'marital_status', 'provided', $3::jsonb)`, [response.id, response.version, JSON.stringify({ text: value })]);
}

async function requests(f: Firm) {
  await asMaintenance(db);
  return (
    await db.query<{ purpose: string; person_id: string; status: string; due_on: string | null; audience: string; review_criteria: string | null; item: string | null }>(
      `select request.purpose, request.person_id, request.status::text, request.due_on::text, request.audience::text, request.review_criteria, item.item_key as item
       from public.document_requests request left join public.checklist_template_items item on item.id = request.checklist_item_id
       where request.matter_id = $1 order by request.purpose`,
      [f.matterId],
    )
  ).rows;
}

describe("Checklist templates", () => {
  it("are drafted by staff, approved only by a licensed consultant with a step-up, and versioned", async () => {
    const f = await firm();
    await staff(f.assistant, f.orgId);
    await expectDbError(() => db.query(`select public.save_checklist_template(null, 'x', 'X', $1::jsonb)`, [JSON.stringify(ITEMS)]), /denied/);
    await expectDbError(() => save(f, f.manager, [{ purpose: "Passport", explanation: "x", acceptable_formats: ["pdf"] }]), /item 1 needs/);
    await expectDbError(() => save(f, f.manager, [{ ...ITEMS[1], condition_equals: "" }]), /both the question and the answer/);
    const v1 = await save(f, f.manager, ITEMS);
    // Saving the same key again replaces the draft, not a second draft.
    expect(await save(f, f.manager, ITEMS)).toBe(v1);

    await asMaintenance(db);
    const version = (await db.query<{ version: number }>(`select version from public.checklist_templates where id = $1`, [v1])).rows[0].version;
    await staff(f.manager, f.orgId, true);
    await expectDbError(() => db.query(`select public.approve_checklist_template($1, $2)`, [v1, version]), /denied/);
    await staff(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.approve_checklist_template($1, $2)`, [v1, version]), /step-up|denied/);
    await approve(f, v1);
    await expectDbError(() => save(f, f.manager, ITEMS, v1), /save a new version/);

    const v2 = await save(f, f.manager, ITEMS.slice(0, 2));
    expect(v2).not.toBe(v1);
    await approve(f, v2);
    await asMaintenance(db);
    expect((await db.query<{ version_number: number; status: string }>(`select version_number, status::text from public.checklist_templates where organization_id = $1 order by version_number`, [f.orgId])).rows).toEqual([
      { version_number: 1, status: "retired" },
      { version_number: 2, status: "approved" },
    ]);
  });

  it("applies to the people it is for, waits for an answer it depends on, and proposes changes after answers change", async () => {
    const f = await firm();
    const draft = await save(f, f.manager, ITEMS);
    await staff(f.manager, f.orgId);
    await expectDbError(() => db.query(`select public.checklist_apply_preview($1, $2)`, [f.matterId, draft]), /only an approved checklist/);
    await approve(f, draft);

    let proposals = await preview(f, draft);
    expect(proposals.add.map((row) => row.purpose).sort()).toEqual(["Passport bio page", "Proof of income"]);
    expect(proposals.waiting).toEqual([expect.objectContaining({ purpose: "Marriage certificate", field: "marital_status" })]);
    expect(await apply(f, draft, proposals.add)).toEqual({ created: 2, cancelled: 0 });
    const made = await requests(f);
    expect(made.map((row) => [row.purpose, row.item, row.status, row.audience])).toEqual([
      ["Passport bio page", "passport", "open", "subject"],
      ["Proof of income", "income", "open", "subject"],
    ]);
    expect(made[0].person_id).toBe(f.applicantPerson);
    expect(made[1].person_id).toBe(f.sponsorPerson);
    expect(made[0].review_criteria).toBe("Record the expiry date printed on it.");
    expect(made[0].due_on).not.toBeNull();
    // Applying the same proposal twice is refused: it is no longer proposed.
    await expectDbError(() => apply(f, draft, proposals.add), /look at the proposals again/);

    await answer(f, "married");
    proposals = await preview(f, draft);
    expect(proposals.add.map((row) => row.purpose)).toEqual(["Marriage certificate"]);
    expect(await apply(f, draft, proposals.add)).toEqual({ created: 1, cancelled: 0 });

    await answer(f, "single");
    proposals = await preview(f, draft);
    expect(proposals.add).toEqual([]);
    expect(proposals.remove).toEqual([expect.objectContaining({ purpose: "Marriage certificate", reason: "the intake answer changed" })]);
    expect(await apply(f, draft, [], proposals.remove.map((row) => row.request_id))).toEqual({ created: 0, cancelled: 1 });
    expect((await requests(f)).find((row) => row.purpose === "Marriage certificate")?.status).toBe("cancelled");
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'checklist.applied'`, [draft])).rows).toHaveLength(3);
  });

  it("is not readable by the client", async () => {
    const f = await firm();
    await save(f, f.manager, ITEMS);
    await asUser(db, { userId: f.applicant, aal: "aal1", orgId: f.orgId });
    expect((await db.query(`select id from public.checklist_templates where organization_id = $1`, [f.orgId])).rows).toHaveLength(0);
    expect((await db.query(`select id from public.checklist_template_items where organization_id = $1`, [f.orgId])).rows).toHaveLength(0);
  });
});
