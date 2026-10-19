import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261020180000_intake_delivery.sql and 20261020180100_intake_delivery_notifications.sql:
// sending a published form to a person on a matter, the client's own answers and submit, a
// correction after submitting, staff review, and the staff notifications. Synthetic records only.

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

async function firm(options: { sample?: boolean } = {}) {
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
  const sample = options.sample ?? true;
  await db.query(`update public.organizations set sample_mode = $2 where id = $1`, [orgId, sample]);

  // A published form: a draft, then published by the licensed consultant with a step-up.
  await staff(manager, orgId);
  const draft = (await db.query<{ saved: { id: string; version: number } }>(`select public.save_intake_draft('background', 'Background questions', $1::jsonb, null, null) as saved`, [JSON.stringify(SCHEMA)])).rows[0].saved;
  await staff(consultant, orgId, true);
  await db.query(`select public.publish_intake_draft($1, $2)`, [draft.id, draft.version]);
  const matterId = (
    await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', $2, $1, null, null) as result`, [consultantMembership, sample])
  ).rows[0].result.id;
  await asMaintenance(db);
  const person = async (name: string, userId: string, role: string) => {
    const id = (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, $2, $3, $4) returning id`, [orgId, name, sample, userId])).rows[0].id;
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, $4::public.matter_party_role)`, [orgId, matterId, id, role]);
    return id;
  };
  const applicantPerson = await person("Synthetic Applicant", applicant, "applicant");
  const sponsorPerson = await person("Synthetic Sponsor", sponsor, "sponsor");
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [orgId, matterId, managerMembership]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'assistant')`, [orgId, matterId, assistantMembership]);
  return { orgId, owner, consultant, manager, assistant, unassigned, applicant, sponsor, matterId, templateId: draft.id, applicantPerson, sponsorPerson };
}

type Sent = { request_id: string; response_id: string; task_id: string; created: boolean };

async function send(userId: string, orgId: string, matterId: string, personId: string, templateId: string, dueOn: string | null = null): Promise<Sent> {
  await staff(userId, orgId);
  return (await db.query<{ sent: Sent }>(`select public.send_intake_request($1, $2, $3, $4::date, 'Please fill this in') as sent`, [matterId, personId, templateId, dueOn])).rows[0].sent;
}

async function version(responseId: string) {
  await asMaintenance(db);
  return (await db.query<{ version: number }>(`select version from public.intake_responses where id = $1`, [responseId])).rows[0].version;
}

async function answer(userId: string, orgId: string, responseId: string, key: string, presence: string, value: object, expected?: number) {
  const at = expected ?? (await version(responseId));
  await portal(userId, orgId);
  return (await db.query<{ id: string }>(`select public.save_intake_answer($1, $2, $3, $4::public.answer_presence, $5::jsonb) as id`, [responseId, at, key, presence, JSON.stringify(value)])).rows[0].id;
}

async function fill(f: Awaited<ReturnType<typeof firm>>, responseId: string) {
  await answer(f.applicant, f.orgId, responseId, "full_name", "provided", { text: "Synthetic Applicant" });
  await answer(f.applicant, f.orgId, responseId, "date_of_birth", "provided", { date_kind: "year_month", year: 1984, month: 3 });
  await answer(f.applicant, f.orgId, responseId, "confirm", "provided", { declaration: true });
  const at = await version(responseId);
  await portal(f.applicant, f.orgId);
  await db.query(`select public.submit_intake_response($1, $2)`, [responseId, at]);
}

describe("Intake delivery: sending a form", () => {
  it("lets a consultant, case manager or owner on the matter send it, and refuses an assistant, an unassigned manager and the client", async () => {
    const f = await firm();
    await expectDbError(() => send(f.assistant, f.orgId, f.matterId, f.applicantPerson, f.templateId), /denied/);
    await expectDbError(() => send(f.unassigned, f.orgId, f.matterId, f.applicantPerson, f.templateId), /denied/);
    await portal(f.applicant, f.orgId);
    await expectDbError(() => db.query(`select public.send_intake_request($1, $2, $3, null, null)`, [f.matterId, f.applicantPerson, f.templateId]), /denied/);
    // Without aal2 a staff member is refused.
    await asUser(db, { userId: f.manager, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.send_intake_request($1, $2, $3, null, null)`, [f.matterId, f.applicantPerson, f.templateId]), /denied/);

    const first = await send(f.manager, f.orgId, f.matterId, f.applicantPerson, f.templateId, "2099-01-31");
    expect(first.created).toBe(true);
    const again = await send(f.consultant, f.orgId, f.matterId, f.applicantPerson, f.templateId);
    expect(again).toEqual({ ...first, created: false });
    // Person rows stay assignment-based for every staff role (20261019219000_owner_full_access.sql):
    // an owner who isn't on the matter can't open a response for its people; on it, they can.
    await expectDbError(() => send(f.owner, f.orgId, f.matterId, f.sponsorPerson, f.templateId), /denied/);
    await asMaintenance(db);
    const ownerMembership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [f.orgId, f.owner])).rows[0].id;
    await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [f.orgId, f.matterId, ownerMembership]);
    const owner = await send(f.owner, f.orgId, f.matterId, f.sponsorPerson, f.templateId);
    expect(owner.created).toBe(true);

    await asMaintenance(db);
    const task = await db.query<{ title: string; audience: string; owner_person_id: string; due_on: string | null; status: string }>(
      `select title, audience::text, owner_person_id, due_on::text, status::text from public.tasks where id = $1`,
      [first.task_id],
    );
    expect(task.rows[0]).toEqual({ title: "Complete Background questions", audience: "client", owner_person_id: f.applicantPerson, due_on: "2099-01-31", status: "open" });
    const request = await db.query<{ message: string; is_sample: boolean }>(`select message, is_sample from public.intake_requests where id = $1`, [first.request_id]);
    expect(request.rows[0]).toEqual({ message: "Please fill this in", is_sample: true });
    const audit = await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'intake.request_sent'`, [first.request_id]);
    expect(audit.rows.length).toBe(1);
    // No email: nothing is queued for the outbox mailer.
    const outbox = await db.query(`select 1 from public.outbox_events where organization_id = $1 and event_type like 'intake.request%'`, [f.orgId]);
    expect(outbox.rows.length).toBe(0);
  });

  it("refuses a person who isn't on the matter, a past due date, an unpublished form and another firm", async () => {
    const f = await firm();
    const other = await firm();
    await asMaintenance(db);
    const stranger = (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample) values ($1, 'Synthetic Stranger', true) returning id`, [f.orgId])).rows[0].id;
    await expectDbError(() => send(f.manager, f.orgId, f.matterId, stranger, f.templateId), /person on this matter/);
    await expectDbError(() => send(f.manager, f.orgId, f.matterId, f.applicantPerson, f.templateId, "2000-01-01"), /past/);
    await staff(f.manager, f.orgId);
    const draft = (await db.query<{ saved: { id: string } }>(`select public.save_intake_draft('unpublished', 'Unpublished', $1::jsonb, null, null) as saved`, [JSON.stringify(SCHEMA)])).rows[0].saved;
    await expectDbError(() => send(f.manager, f.orgId, f.matterId, f.applicantPerson, draft.id), /published intake form/);
    // Another firm's form, person or matter.
    await expectDbError(() => send(f.manager, f.orgId, f.matterId, f.applicantPerson, other.templateId), /published intake form/);
    await expectDbError(() => send(f.manager, f.orgId, other.matterId, other.applicantPerson, other.templateId), /denied/);
  });

  it("refuses a real matter while the firm is in sample mode, and sends on a real firm's real matter", async () => {
    const real = await firm({ sample: false });
    const sent = await send(real.manager, real.orgId, real.matterId, real.applicantPerson, real.templateId);
    expect(sent.created).toBe(true);
    await asMaintenance(db);
    await db.query(`update public.organizations set sample_mode = true where id = $1`, [real.orgId]);
    await expectDbError(() => send(real.manager, real.orgId, real.matterId, real.sponsorPerson, real.templateId), /sample mode/);
  });
});

describe("Intake delivery: the client's answers", () => {
  it("shows a client only the responses addressed to them; a sponsor sees only their own", async () => {
    const f = await firm();
    const mine = await send(f.manager, f.orgId, f.matterId, f.applicantPerson, f.templateId);
    const theirs = await send(f.manager, f.orgId, f.matterId, f.sponsorPerson, f.templateId);
    await portal(f.applicant, f.orgId);
    const seen = await db.query<{ id: string }>(`select id from public.intake_responses`);
    expect(seen.rows.map((row) => row.id)).toEqual([mine.response_id]);
    const requests = await db.query<{ id: string }>(`select id from public.intake_requests`);
    expect(requests.rows.map((row) => row.id)).toEqual([mine.request_id]);
    const forms = await db.query<{ response_id: string; title: string }>(`select response_id, title from public.intake_response_forms($1::uuid[])`, [[mine.response_id, theirs.response_id]]);
    expect(forms.rows).toEqual([{ response_id: mine.response_id, title: "Background questions" }]);
    await answer(f.applicant, f.orgId, mine.response_id, "full_name", "provided", { text: "Synthetic Applicant" });
    await portal(f.sponsor, f.orgId);
    expect((await db.query(`select 1 from public.intake_answer_versions`)).rows.length).toBe(0);
    await expectDbError(async () => answer(f.sponsor, f.orgId, mine.response_id, "full_name", "provided", { text: "Forged" }), /denied/);
    // Another firm's client sees nothing here.
    const other = await firm();
    await portal(other.applicant, f.orgId);
    expect((await db.query(`select 1 from public.intake_responses`)).rows.length).toBe(0);
    expect((await db.query(`select * from public.intake_response_forms($1::uuid[])`, [[mine.response_id]])).rows.length).toBe(0);
  });

  it("refuses a stale autosave as a version conflict and keeps both answers' history", async () => {
    const f = await firm();
    const sent = await send(f.manager, f.orgId, f.matterId, f.applicantPerson, f.templateId);
    const at = await version(sent.response_id);
    await answer(f.applicant, f.orgId, sent.response_id, "full_name", "provided", { text: "First window" }, at);
    await expectDbError(() => answer(f.applicant, f.orgId, sent.response_id, "full_name", "provided", { text: "Second window" }, at), /conflict/);
    await asMaintenance(db);
    const rows = await db.query<{ text: string }>(`select normalized_value ->> 'text' as text from public.intake_answer_versions where response_id = $1`, [sent.response_id]);
    expect(rows.rows).toEqual([{ text: "First window" }]);
  });

  it("completes the client task on submit, then refuses ordinary edits once frozen", async () => {
    const f = await firm();
    const sent = await send(f.manager, f.orgId, f.matterId, f.applicantPerson, f.templateId);
    await fill(f, sent.response_id);
    await asMaintenance(db);
    const task = await db.query<{ status: string }>(`select status::text from public.tasks where id = $1`, [sent.task_id]);
    expect(task.rows[0].status).toBe("done");
    const events = await db.query<{ to_status: string }>(`select to_status::text from public.task_events where task_id = $1 and event_kind = 'status'`, [sent.task_id]);
    expect(events.rows).toEqual([{ to_status: "done" }]);
    // Submitting twice is refused.
    const at = await version(sent.response_id);
    await portal(f.applicant, f.orgId);
    await expectDbError(() => db.query(`select public.submit_intake_response($1, $2)`, [sent.response_id, at]), /already submitted/);
    // A new send after submitting opens a fresh round.
    const next = await send(f.manager, f.orgId, f.matterId, f.applicantPerson, f.templateId);
    expect(next.created).toBe(true);
    expect(next.response_id).not.toBe(sent.response_id);

    await staff(f.consultant, f.orgId, true);
    await db.query(`select public.freeze_intake_response($1)`, [sent.response_id]);
    await expectDbError(async () => answer(f.applicant, f.orgId, sent.response_id, "full_name", "provided", { text: "Edited" }), /frozen/);
  });
});

describe("Intake delivery: corrections and review", () => {
  it("makes a correction a new version, keeps the snapshot, works on a frozen snapshot, and alerts staff", async () => {
    const f = await firm();
    const sent = await send(f.manager, f.orgId, f.matterId, f.applicantPerson, f.templateId);
    // Before submitting there is nothing to correct.
    await portal(f.applicant, f.orgId);
    await expectDbError(() => db.query(`select public.request_intake_correction($1, 'full_name', 'provided', '{"text":"x"}'::jsonb, null, null, null)`, [sent.response_id]), /already sent/);
    await fill(f, sent.response_id);
    await staff(f.consultant, f.orgId, true);
    await db.query(`select public.freeze_intake_response($1)`, [sent.response_id]);

    await portal(f.sponsor, f.orgId);
    await expectDbError(() => db.query(`select public.request_intake_correction($1, 'full_name', 'provided', '{"text":"Forged"}'::jsonb, null, null, null)`, [sent.response_id]), /denied/);
    await portal(f.applicant, f.orgId);
    const made = (
      await db.query<{ made: { correction_id: string; reference: string; answer_id: string } }>(
        `select public.request_intake_correction($1, 'full_name', 'provided', '{"text":"Synthetic Applicant-Corrected"}'::jsonb, 'Spelling', null, null) as made`,
        [sent.response_id],
      )
    ).rows[0].made;
    expect(made.reference).toBe("CR-0001");
    const other = (
      await db.query<{ made: { reference: string; answer_id: string | null } }>(`select public.request_intake_correction($1, null, null, null, null, 'My travel dates are wrong', null) as made`, [sent.response_id])
    ).rows[0].made;
    expect(other).toMatchObject({ reference: "CR-0002", answer_id: null });
    await expectDbError(() => db.query(`select public.request_intake_correction($1, null, null, null, null, '  ', null)`, [sent.response_id]), /describe/);
    // Proof must be the person's own document.
    await asMaintenance(db);
    const ownDoc = (await db.query<{ id: string }>(`insert into public.documents (organization_id, person_id, purpose) values ($1, $2, 'Proof') returning id`, [f.orgId, f.applicantPerson])).rows[0].id;
    const sponsorDoc = (await db.query<{ id: string }>(`insert into public.documents (organization_id, person_id, purpose) values ($1, $2, 'Proof') returning id`, [f.orgId, f.sponsorPerson])).rows[0].id;
    await portal(f.applicant, f.orgId);
    await expectDbError(() => db.query(`select public.request_intake_correction($1, null, null, null, null, 'See the lease', $2)`, [sent.response_id, sponsorDoc]), /not one of your documents/);
    const proved = (await db.query<{ made: { reference: string } }>(`select public.request_intake_correction($1, null, null, null, null, 'See the lease', $2) as made`, [sent.response_id, ownDoc])).rows[0].made;
    expect(proved.reference).toBe("CR-0003");
    await expectDbError(() => db.query(`select public.request_intake_correction($1, 'trips', 'provided', '{"entries":[]}'::jsonb, null, null, null)`, [sent.response_id]), /no answer to correct/);

    await asMaintenance(db);
    const versions = await db.query<{ text: string }>(`select normalized_value ->> 'text' as text from public.intake_answer_versions where response_id = $1 and field_key = 'full_name' order by created_at, id`, [sent.response_id]);
    expect(versions.rows.map((row) => row.text)).toEqual(["Synthetic Applicant", "Synthetic Applicant-Corrected"]);
    const snapshot = await db.query<{ text: string }>(
      `select sa.normalized_value ->> 'text' as text from public.intake_snapshot_answers sa join public.intake_snapshots s on s.id = sa.snapshot_id where s.response_id = $1 and sa.field_key = 'full_name'`,
      [sent.response_id],
    );
    expect(snapshot.rows).toEqual([{ text: "Synthetic Applicant" }]);
    await expectDbError(() => db.query(`update public.intake_corrections set description = 'x' where id = $1`, [made.correction_id]), /append-only/);

    // Staff on the matter see both alerts; the unassigned case manager does not.
    await staff(f.manager, f.orgId);
    const items = await db.query<{ kind: string; detail: string | null; href: string }>(
      `select kind, detail, href from app.staff_notification_items($1, 50) where kind like 'intake%' order by occurred_at, detail`,
      [f.orgId],
    );
    expect(items.rows.map((row) => row.kind).sort()).toEqual(["intake_correction", "intake_correction", "intake_correction", "intake_submitted"]);
    expect(items.rows.every((row) => row.href === `/sheet/matters/${f.matterId}?tab=intake`)).toBe(true);
    await staff(f.unassigned, f.orgId);
    const hidden = await db.query(`select 1 from app.staff_notification_items($1, 50) where kind like 'intake%'`, [f.orgId]);
    expect(hidden.rows.length).toBe(0);
  });

  it("lets staff on the matter review the latest version only, idempotently, and refuses an assistant and the client", async () => {
    const f = await firm();
    const sent = await send(f.manager, f.orgId, f.matterId, f.applicantPerson, f.templateId);
    const draftAnswer = await answer(f.applicant, f.orgId, sent.response_id, "full_name", "provided", { text: "Synthetic Applicant" });
    await staff(f.manager, f.orgId);
    await expectDbError(() => db.query(`select public.review_intake_answer($1)`, [draftAnswer]), /once the client sends/);
    await answer(f.applicant, f.orgId, sent.response_id, "date_of_birth", "unknown", {});
    await answer(f.applicant, f.orgId, sent.response_id, "confirm", "provided", { declaration: true });
    const at = await version(sent.response_id);
    await portal(f.applicant, f.orgId);
    await db.query(`select public.submit_intake_response($1, $2)`, [sent.response_id, at]);

    await staff(f.assistant, f.orgId);
    await expectDbError(() => db.query(`select public.review_intake_answer($1)`, [draftAnswer]), /denied/);
    await portal(f.applicant, f.orgId);
    await expectDbError(() => db.query(`select public.review_intake_answer($1)`, [draftAnswer]), /denied/);
    await staff(f.manager, f.orgId);
    const first = (await db.query<{ id: string }>(`select public.review_intake_answer($1) as id`, [draftAnswer])).rows[0].id;
    const again = (await db.query<{ id: string }>(`select public.review_intake_answer($1) as id`, [draftAnswer])).rows[0].id;
    expect(again).toBe(first);
    const reviews = await db.query(`select 1 from public.intake_answer_reviews where answer_id = $1`, [draftAnswer]);
    expect(reviews.rows.length).toBe(1);

    // A correction makes a new, unreviewed version; the old one can no longer be reviewed.
    await portal(f.applicant, f.orgId);
    const corrected = (
      await db.query<{ made: { answer_id: string } }>(`select public.request_intake_correction($1, 'date_of_birth', 'provided', '{"date_kind":"year","year":1984}'::jsonb, null, null, null) as made`, [sent.response_id])
    ).rows[0].made.answer_id;
    await asMaintenance(db);
    const oldDob = (await db.query<{ id: string }>(`select id from public.intake_answer_versions where response_id = $1 and field_key = 'date_of_birth' and id <> $2`, [sent.response_id, corrected])).rows[0].id;
    await staff(f.manager, f.orgId);
    await expectDbError(() => db.query(`select public.review_intake_answer($1)`, [oldDob]), /newer answer/);
    await db.query(`select public.review_intake_answer($1)`, [corrected]);
    // The client can read the review state of their own answers; the sponsor cannot.
    await portal(f.applicant, f.orgId);
    expect((await db.query(`select 1 from public.intake_answer_reviews`)).rows.length).toBe(2);
    await portal(f.sponsor, f.orgId);
    expect((await db.query(`select 1 from public.intake_answer_reviews`)).rows.length).toBe(0);
    // Another firm's staff see nothing.
    const other = await firm();
    await staff(other.manager, f.orgId);
    expect((await db.query(`select 1 from public.intake_answer_reviews`)).rows.length).toBe(0);
  });
});
