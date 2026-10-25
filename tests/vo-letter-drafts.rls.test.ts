import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261025240000_vo_letter_enum.sql and 20261025240100_vo_letter_drafts.sql (AI-01, #183): Vo's
 * letter drafts use only approved facts (reviewed, latest, on this matter, in a category the firm
 * lets Vo use) and approved official content, each cited and rebuilt from the database; the
 * firm and letter switches; a letter written by hand with Vo off; versions; a licensed member's
 * approval with a step-up; release only after approval; tenant isolation. Synthetic records only.
 */
let db: TestDb;

const MODEL = "vo-test-model";

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
    { key: "arrival_city", type: "text", labels: { "en-CA": "City of arrival" } },
    { key: "date_of_birth", type: "date", labels: { "en-CA": "Date of birth" }, required: true },
    { key: "passport_number", type: "text", labels: { "en-CA": "Passport number" } },
    { key: "trips", type: "repeatable", labels: { "en-CA": "Trips" } },
  ],
};

/** A sample-mode firm (Vo on by default there) with a consultant, a case manager and a matter. */
async function firm() {
  const owner = await user();
  const consultant = await user();
  const manager = await user();
  const unassigned = await user();
  const finance = await user();
  const applicant = await user();
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
  await add(unassigned, "case_manager");
  await add(finance, "finance_user");
  await add(applicant, "client");
  await db.query(`update public.organizations set sample_mode = true where id = $1`, [orgId]);

  await staff(manager, orgId);
  const draft = (await db.query<{ saved: { id: string; version: number } }>(`select public.save_intake_draft('background', 'Background questions', $1::jsonb, null, null) as saved`, [JSON.stringify(SCHEMA)])).rows[0].saved;
  await staff(consultant, orgId, true);
  await db.query(`select public.publish_intake_draft($1, $2)`, [draft.id, draft.version]);

  await staff(consultant, orgId);
  const matterId = (await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership])).rows[0].result.id;
  await asMaintenance(db);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [orgId, matterId, managerMembership]);
  const personId = (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic Applicant', true, $2) returning id`, [orgId, applicant])).rows[0].id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, personId]);
  return { orgId, owner, consultant, manager, unassigned, finance, applicant, matterId, personId, templateId: draft.id };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function version(responseId: string) {
  await asMaintenance(db);
  return (await db.query<{ version: number }>(`select version from public.intake_responses where id = $1`, [responseId])).rows[0].version;
}

async function answer(f: Firm, responseId: string, key: string, value: object) {
  const at = await version(responseId);
  await portal(f.applicant, f.orgId);
  return (await db.query<{ id: string }>(`select public.save_intake_answer($1, $2, $3, 'provided', $4::jsonb) as id`, [responseId, at, key, JSON.stringify(value)])).rows[0].id;
}

/** The applicant's form: sent, answered, submitted; name, city, birth and passport reviewed, trips not. */
async function approvedForm(f: Firm) {
  await staff(f.manager, f.orgId);
  const responseId = (await db.query<{ sent: { response_id: string } }>(`select public.send_intake_request($1, $2, $3, null, null) as sent`, [f.matterId, f.personId, f.templateId])).rows[0].sent.response_id;
  const name = await answer(f, responseId, "full_name", { text: "Synthetic Applicant" });
  const city = await answer(f, responseId, "arrival_city", { text: "Synthetic City" });
  const birth = await answer(f, responseId, "date_of_birth", { date_kind: "year_month", year: 1984, month: 3 });
  const passport = await answer(f, responseId, "passport_number", { text: "ZZ0000000" });
  await answer(f, responseId, "trips", { entries: [{ country: "FR" }] });
  const at = await version(responseId);
  await portal(f.applicant, f.orgId);
  await db.query(`select public.submit_intake_response($1, $2)`, [responseId, at]);
  await staff(f.manager, f.orgId);
  for (const id of [name, city, birth, passport]) await db.query(`select public.review_intake_answer($1)`, [id]);
  return { responseId, name, city, birth, passport };
}

async function begin(f: Firm, userId = f.manager, letterType = "cover_letter") {
  await staff(userId, f.orgId);
  return (
    await db.query<{ r: { ok: boolean; error?: string; run_id?: string } }>(`select public.begin_vo_letter_draft($1, $2, $3) as r`, [f.orgId, f.matterId, letterType])
  ).rows[0].r;
}

async function save(runId: string, input: { body: string; facts: object[]; official?: object[]; leftOut?: string[] }) {
  return (
    await db.query<{ id: string | null }>(
      `select public.save_vo_letter_draft($1, 'cover_letter', 'Cover letter', $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, 'letter-1', 1200, array['read_approved_facts','save_letter_draft'], 900, 300, 0.02) as id`,
      [runId, input.body, JSON.stringify(input.facts), JSON.stringify(input.official ?? []), JSON.stringify(input.leftOut ?? []), MODEL],
    )
  ).rows[0].id;
}

async function approvedFee(f: Firm) {
  await asMaintenance(db);
  return (
    await db.query<{ id: string }>(
      `insert into public.government_fee_references (organization_id, position, section, name, amount_cents, source_url, retrieved_at, snapshot_sha256, status, reviewed_by, reviewed_at)
       values ($1, 1, 'Synthetic section', 'Synthetic test fee', 1234, 'https://ircc.canada.ca/english/information/fees/fees.asp', now(), $2, 'approved', $3, now()) returning id`,
      [f.orgId, "a".repeat(64), f.consultant],
    )
  ).rows[0].id;
}

describe("Vo letter drafts: who may ask, and the switches", () => {
  it("starts a run for staff on the matter in a Vo-on firm, and refuses finance users and staff off the matter", async () => {
    const f = await firm();
    await approvedForm(f);
    const run = await begin(f);
    expect(run.ok).toBe(true);
    await staff(f.finance, f.orgId);
    await expectDbError(() => db.query(`select public.begin_vo_letter_draft($1, $2, 'cover_letter')`, [f.orgId, f.matterId]), /staff access denied|vo denied/);
    await staff(f.unassigned, f.orgId);
    await expectDbError(() => db.query(`select public.begin_vo_letter_draft($1, $2, 'cover_letter')`, [f.orgId, f.matterId]), /vo denied/);
    await staff(f.manager, f.orgId);
    await expectDbError(() => db.query(`select public.begin_vo_letter_draft($1, $2, 'contract')`, [f.orgId, f.matterId]), /letter type/);
  });

  it("says there is nothing to draft from without an approved fact, before any run is counted", async () => {
    const f = await firm();
    expect((await begin(f)).error).toBe("no_facts");
    await asMaintenance(db);
    const runs = await db.query(`select 1 from public.vo_runs where organization_id = $1`, [f.orgId]);
    expect(runs.rows).toHaveLength(0);
  });

  it("respects the firm switch and the letter switch, which only the owner changes", async () => {
    const f = await firm();
    await approvedForm(f);
    await staff(f.manager, f.orgId);
    await expectDbError(() => db.query(`select public.set_vo_settings($1, '{"letter_drafts": false}'::jsonb)`, [f.orgId]), /staff access denied/);
    await staff(f.owner, f.orgId);
    const saved = (await db.query<{ s: Record<string, unknown> }>(`select public.set_vo_settings($1, '{"letter_drafts": false}'::jsonb) as s`, [f.orgId])).rows[0].s;
    expect(saved.letter_drafts).toBe(false);
    expect((await begin(f)).error).toBe("capability_off");
    await staff(f.owner, f.orgId);
    await db.query(`select public.set_vo_settings($1, '{"letter_drafts": true, "enabled": false}'::jsonb)`, [f.orgId]);
    expect((await begin(f)).error).toBe("off");
  });

  it("keeps DOC-05's read_on_upload switch working next to letter_drafts", async () => {
    const f = await firm();
    await staff(f.owner, f.orgId);
    const saved = (
      await db.query<{ s: Record<string, unknown> }>(`select public.set_vo_settings($1, '{"read_on_upload": true, "letter_drafts": false}'::jsonb) as s`, [f.orgId])
    ).rows[0].s;
    expect(saved.read_on_upload).toBe(true);
    expect(saved.letter_drafts).toBe(false);
  });
});

describe("Vo letter drafts: approved facts only", () => {
  it("shows Vo the reviewed latest answers of this matter, hiding a sensitive category until the owner allows it", async () => {
    const f = await firm();
    const form = await approvedForm(f);
    const run = await begin(f);
    await staff(f.manager, f.orgId);
    const read = (await db.query<{ r: { facts: { answer_id: string; label: string; value: string }[]; hidden: number } }>(`select public.vo_letter_facts($1) as r`, [run.run_id])).rows[0].r;
    expect(read.facts.map((fact) => fact.label).sort()).toEqual(["City of arrival", "Date of birth", "Full name"]);
    expect(read.facts.find((fact) => fact.label === "Date of birth")?.value).toBe("1984-03");
    // The passport number is an identity fact: hidden until the owner lets Vo read identity.
    expect(read.hidden).toBe(1);
    expect(read.facts.some((fact) => fact.answer_id === form.passport)).toBe(false);
    // Another staff member can't read this run's facts.
    await staff(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.vo_letter_facts($1)`, [run.run_id]), /vo denied/);
    // And an identity fact can't be cited while the switch is off.
    await staff(f.manager, f.orgId);
    await expectDbError(() => save(run.run_id!, { body: "Passport [F1].", facts: [{ ref: "F1", answer_id: form.passport }] }), /hasn't let Vo use/);
  });

  it("does not take an unreviewed or replaced answer, or one from another matter", async () => {
    const f = await firm();
    const form = await approvedForm(f);
    const other = await firm();
    const otherForm = await approvedForm(other);
    const run = await begin(f);
    await staff(f.manager, f.orgId);
    await expectDbError(() => save(run.run_id!, { body: "Name [F1].", facts: [{ ref: "F1", answer_id: otherForm.name }] }), /not an approved fact/);
    // A correction after review makes the reviewed answer no longer the latest one.
    await asMaintenance(db);
    await db.query(
      `insert into public.intake_answer_versions (organization_id, response_id, field_key, presence, raw_value, normalized_value) values ($1, $2, 'arrival_city', 'provided', '{"text":"Other City"}', '{"text":"Other City"}')`,
      [f.orgId, form.responseId],
    );
    await staff(f.manager, f.orgId);
    await expectDbError(() => save(run.run_id!, { body: "City [F1].", facts: [{ ref: "F1", answer_id: form.city }] }), /not an approved fact/);
  });

  it("saves the draft with each citation rebuilt from the database, and ends the run as drafted", async () => {
    const f = await firm();
    const form = await approvedForm(f);
    const run = await begin(f);
    await staff(f.manager, f.orgId);
    const letterId = await save(run.run_id!, {
      body: "Dear officer,\n\nThis letter is for Synthetic Applicant [F1], who will arrive in Synthetic City [F2].\n\nYours sincerely",
      facts: [
        { ref: "F1", answer_id: form.name, label: "forged label", value: "forged value" },
        { ref: "F2", answer_id: form.city },
      ],
      leftOut: ["A fee: no approved official source covers it."],
    });
    expect(letterId).toBeTruthy();
    await asMaintenance(db);
    const letter = (await db.query<{ status: string; origin: string; current_version: number }>(`select status, origin, current_version from public.matter_letters where id = $1`, [letterId])).rows[0];
    expect(letter).toEqual({ status: "draft", origin: "vo", current_version: 1 });
    const saved = (await db.query<{ facts: { ref: string; label: string; value: string; reviewer_membership_id: string; form: string }[]; left_out: string[] }>(`select facts, left_out from public.matter_letter_versions where letter_id = $1`, [letterId])).rows[0];
    expect(saved.facts[0]).toMatchObject({ ref: "F1", label: "Full name", value: "Synthetic Applicant", form: "Background questions" });
    expect(saved.facts[0].reviewer_membership_id).toBeTruthy();
    expect(saved.left_out).toEqual(["A fee: no approved official source covers it."]);
    const ran = (await db.query<{ result: string; source_count: number; model: string; prompt_version: string }>(`select result::text, source_count, model, prompt_version from public.vo_runs where id = $1`, [run.run_id])).rows[0];
    expect(ran).toEqual({ result: "drafted", source_count: 2, model: MODEL, prompt_version: "letter-1" });
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 order by occurred_at`, [run.run_id]);
    expect(audit.rows.map((row) => row.action)).toEqual(["vo.run_started", "vo.run_finished"]);
  });

  it("refuses a marker that isn't cited, a citation that isn't used, and a fee without an approved source", async () => {
    const f = await firm();
    const form = await approvedForm(f);
    const run = await begin(f);
    await staff(f.manager, f.orgId);
    await expectDbError(() => save(run.run_id!, { body: "Name [F1] and [F2].", facts: [{ ref: "F1", answer_id: form.name }] }), /must match a cited record/);
    await expectDbError(() => save(run.run_id!, { body: "Name [F1].", facts: [{ ref: "F1", answer_id: form.name }, { ref: "F2", answer_id: form.city }] }), /must match a cited record/);
    await expectDbError(() => save(run.run_id!, { body: "Name [F1]. The fee is $150.", facts: [{ ref: "F1", answer_id: form.name }] }), /fee needs an approved official source/);
    await expectDbError(() => save(run.run_id!, { body: "No facts here.", facts: [] }), /1 to 60 approved facts/);
  });
});

describe("Vo letter drafts: approved official content only", () => {
  it("cites an approved fee with its source, and refuses one still waiting for review", async () => {
    const f = await firm();
    const form = await approvedForm(f);
    const fee = await approvedFee(f);
    const run = await begin(f);
    await staff(f.manager, f.orgId);
    const content = (await db.query<{ c: { kind: string; id: string; content: string; source_url: string }[] }>(`select public.vo_letter_official_content($1) as c`, [run.run_id])).rows[0].c;
    expect(content).toEqual([expect.objectContaining({ kind: "fee", id: fee, content: "Synthetic test fee: CAD 12.34" })]);
    await asMaintenance(db);
    const pending = (
      await db.query<{ id: string }>(
        `insert into public.government_fee_references (organization_id, position, name, amount_cents, source_url, retrieved_at, snapshot_sha256) values ($1, 2, 'Synthetic pending fee', 999, 'https://ircc.canada.ca/english/information/fees/fees.asp', now(), $2) returning id`,
        [f.orgId, "b".repeat(64)],
      )
    ).rows[0].id;
    await staff(f.manager, f.orgId);
    await expectDbError(
      () => save(run.run_id!, { body: "Name [F1]. Fee CAD 9.99 [S1].", facts: [{ ref: "F1", answer_id: form.name }], official: [{ ref: "S1", kind: "fee", id: pending }] }),
      /not approved official content/,
    );
    const letterId = await save(run.run_id!, {
      body: "Name [F1]. The fee paid was CAD 12.34 [S1].",
      facts: [{ ref: "F1", answer_id: form.name }],
      official: [{ ref: "S1", kind: "fee", id: fee, source_url: "https://evil.example" }],
    });
    await asMaintenance(db);
    const official = (await db.query<{ official: Record<string, unknown>[] }>(`select official from public.matter_letter_versions where letter_id = $1`, [letterId])).rows[0].official;
    expect(official[0]).toMatchObject({ ref: "S1", kind: "fee", source_url: "https://ircc.canada.ca/english/information/fees/fees.asp", snapshot_sha256: "a".repeat(64), source_section: "Synthetic section" });
    expect(official[0].checked_on).toBeTruthy();
  });
});

describe("Letters by hand, review and release", () => {
  it("lets staff write a letter by hand with Vo off, version it, and keeps versions as written", async () => {
    const f = await firm();
    await staff(f.owner, f.orgId);
    await db.query(`select public.set_vo_settings($1, '{"enabled": false}'::jsonb)`, [f.orgId]);
    await staff(f.manager, f.orgId);
    const letterId = (await db.query<{ id: string }>(`select public.create_matter_letter($1, $2, 'explanation', 'Letter of explanation', 'Dear officer, ...') as id`, [f.orgId, f.matterId])).rows[0].id;
    const next = (await db.query<{ n: number }>(`select public.revise_matter_letter($1, 1, 'Letter of explanation', 'Dear officer, revised.') as n`, [letterId])).rows[0].n;
    expect(next).toBe(2);
    await expectDbError(() => db.query(`select public.revise_matter_letter($1, 1, 'x', 'stale')`, [letterId]), /changed since you opened it/);
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.matter_letter_versions set body = 'changed' where letter_id = $1`, [letterId]), /kept as written/);
    // Finance users and other firms see nothing.
    await staff(f.finance, f.orgId);
    expect((await db.query(`select 1 from public.matter_letters where id = $1`, [letterId])).rows).toHaveLength(0);
    const other = await firm();
    await staff(other.manager, other.orgId);
    expect((await db.query(`select 1 from public.matter_letters where id = $1`, [letterId])).rows).toHaveLength(0);
    await staff(f.manager, f.orgId);
    expect((await db.query(`select 1 from public.matter_letter_versions where letter_id = $1`, [letterId])).rows).toHaveLength(2);
  });

  it("can't be released until a licensed member approves it with a fresh step-up", async () => {
    const f = await firm();
    await staff(f.manager, f.orgId);
    const letterId = (await db.query<{ id: string }>(`select public.create_matter_letter($1, $2, 'cover_letter', 'Cover letter', 'Dear officer [F1] stays out.') as id`, [f.orgId, f.matterId])).rows[0].id;
    await expectDbError(() => db.query(`select public.release_matter_letter($1)`, [letterId]), /must approve this letter before it is released/);
    // A case manager can't approve; a licensed member needs a step-up.
    await expectDbError(() => db.query(`select public.approve_matter_letter($1, 1)`, [letterId]), /staff access denied/);
    await staff(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.approve_matter_letter($1, 1)`, [letterId]), /step-up is required/);
    await staff(f.consultant, f.orgId, true);
    const approved = (await db.query<{ r: { approved_version: number; self: boolean } }>(`select public.approve_matter_letter($1, 1) as r`, [letterId])).rows[0].r;
    expect(approved).toMatchObject({ approved_version: 1, self: false });
    await expectDbError(() => db.query(`select public.revise_matter_letter($1, 2, 'Cover letter', 'changed')`, [letterId]), /only a draft letter/);
    await staff(f.manager, f.orgId);
    const released = (await db.query<{ r: { body: string; version_number: number } }>(`select public.release_matter_letter($1) as r`, [letterId])).rows[0].r;
    expect(released).toMatchObject({ body: "Dear officer stays out.", version_number: 1 });
    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 order by occurred_at`, [letterId]);
    expect(audit.rows.map((row) => row.action)).toEqual(["letter.created", "letter.approved", "letter.released"]);
  });

  it("refuses a licensed member approving their own edit while another licensed member can, and a placeholder", async () => {
    const f = await firm();
    await staff(f.consultant, f.orgId);
    const letterId = (await db.query<{ id: string }>(`select public.create_matter_letter($1, $2, 'cover_letter', 'Cover letter', 'The fee is [needs a sourced rule].') as id`, [f.orgId, f.matterId])).rows[0].id;
    await staff(f.owner, f.orgId, true);
    await expectDbError(() => db.query(`select public.approve_matter_letter($1, 1)`, [letterId]), /placeholder/);
    await staff(f.consultant, f.orgId);
    await db.query(`select public.revise_matter_letter($1, 1, 'Cover letter', 'Dear officer.')`, [letterId]);
    await staff(f.consultant, f.orgId, true);
    await expectDbError(() => db.query(`select public.approve_matter_letter($1, 2)`, [letterId]), /another licensed member/);
    await staff(f.owner, f.orgId, true);
    expect((await db.query<{ r: { self: boolean } }>(`select public.approve_matter_letter($1, 2) as r`, [letterId])).rows[0].r.self).toBe(false);
  });

  it("discards a draft, audited, and keeps it out of release", async () => {
    const f = await firm();
    await staff(f.manager, f.orgId);
    const letterId = (await db.query<{ id: string }>(`select public.create_matter_letter($1, $2, 'other', 'Note', 'Text') as id`, [f.orgId, f.matterId])).rows[0].id;
    await db.query(`select public.discard_matter_letter($1, 1)`, [letterId]);
    await expectDbError(() => db.query(`select public.release_matter_letter($1)`, [letterId]), /must approve/);
    await staff(f.consultant, f.orgId, true);
    await expectDbError(() => db.query(`select public.approve_matter_letter($1, 2)`, [letterId]), /only a draft/);
  });
});
