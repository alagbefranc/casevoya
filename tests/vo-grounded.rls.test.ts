import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adviceLike, isCitableOfficialUrl } from "@/modules/vo/grounding";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261025420000_vo_grounded_outputs.sql (SRC-09, #188): what a Vo output may cite is decided by
 * the database (the run's own matter and conversation, the matter's document versions and approved
 * facts, approved official content from a deep federal official page), the checked citations are
 * kept on the run, Ask Vo reads only its own run's facts and official content, and an advice-like
 * draft is sent only by a licensed member with a fresh step-up. Synthetic records only.
 */
let db: TestDb;

const MODEL = "vo-test-model";
const FEES = "https://ircc.canada.ca/english/information/fees/fees.asp";

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
  ],
};

/** A sample-mode firm (Vo on there) with a consultant, a case manager, a matter, an approved intake form and a client message. */
async function firm() {
  const owner = await user();
  const consultant = await user();
  const manager = await user();
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
  await add(applicant, "client");
  await db.query(`update public.organizations set sample_mode = true where id = $1`, [orgId]);

  await staff(manager, orgId);
  const draft = (await db.query<{ saved: { id: string; version: number } }>(`select public.save_intake_draft('background', 'Background questions', $1::jsonb, null, null) as saved`, [JSON.stringify(SCHEMA)])).rows[0].saved;
  await staff(consultant, orgId, true);
  await db.query(`select public.publish_intake_draft($1, $2)`, [draft.id, draft.version]);
  await staff(consultant, orgId);
  const matterId = (await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership])).rows[0].result.id;
  const otherMatterId = (await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic other matter', true, $1, null, null) as result`, [consultantMembership])).rows[0].result.id;
  await asMaintenance(db);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [orgId, matterId, managerMembership]);
  const personId = (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic Applicant', true, $2) returning id`, [orgId, applicant])).rows[0].id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, personId]);

  // The applicant's form: answered, submitted, and the name reviewed by staff (an approved fact).
  await staff(manager, orgId);
  const responseId = (await db.query<{ sent: { response_id: string } }>(`select public.send_intake_request($1, $2, $3, null, null) as sent`, [matterId, personId, draft.id])).rows[0].sent.response_id;
  const at = async () => {
    await asMaintenance(db);
    return (await db.query<{ version: number }>(`select version from public.intake_responses where id = $1`, [responseId])).rows[0].version;
  };
  let version = await at();
  await portal(applicant, orgId);
  const nameAnswer = (await db.query<{ id: string }>(`select public.save_intake_answer($1, $2, 'full_name', 'provided', $3::jsonb) as id`, [responseId, version, JSON.stringify({ text: "Synthetic Applicant" })])).rows[0].id;
  version = await at();
  await portal(applicant, orgId);
  const cityAnswer = (await db.query<{ id: string }>(`select public.save_intake_answer($1, $2, 'arrival_city', 'provided', $3::jsonb) as id`, [responseId, version, JSON.stringify({ text: "Synthetic City" })])).rows[0].id;
  version = await at();
  await portal(applicant, orgId);
  await db.query(`select public.submit_intake_response($1, $2)`, [responseId, version]);
  await staff(manager, orgId);
  await db.query(`select public.review_intake_answer($1)`, [nameAnswer]);

  // The client writes first: a conversation Vo can draft a reply in.
  await portal(applicant, orgId);
  const sent = (await db.query<{ r: { message_id: string; thread_id: string } }>(`select public.send_matter_message($1, $2, null, null, $3, false, null, null) as r`, [orgId, matterId, "Synthetic: what happens next?"])).rows[0].r;
  return { orgId, owner, consultant, manager, applicant, matterId, otherMatterId, personId, nameAnswer, cityAnswer, threadId: sent.thread_id, messageId: sent.message_id };
}

type Firm = Awaited<ReturnType<typeof firm>>;

/** Each fee row takes its own place on the (synthetic) fee list. */
let position = 0;

async function fee(f: Firm, url: string, name = "Synthetic test fee") {
  await asMaintenance(db);
  return (
    await db.query<{ id: string }>(
      `insert into public.government_fee_references (organization_id, position, section, name, amount_cents, source_url, retrieved_at, snapshot_sha256, status, reviewed_by, reviewed_at)
       values ($1, $6, 'Synthetic section', $2, 1234, $3, now(), $4, 'approved', $5, now()) returning id`,
      [f.orgId, name, url, "a".repeat(64), f.consultant, ++position],
    )
  ).rows[0].id;
}

async function documentVersion(f: Firm, matterId: string) {
  await asMaintenance(db);
  const doc = (await db.query<{ id: string }>(`insert into public.documents (organization_id, person_id, purpose, audience) values ($1, $2, 'Synthetic passport copy', 'staff') returning id`, [f.orgId, f.personId])).rows[0].id;
  const version = (
    await db.query<{ id: string }>(
      `insert into public.document_versions (organization_id, document_id, version_number, storage_key, original_filename, declared_media_type, declared_byte_size, upload_state, intent_expires_at)
       values ($1, $2, 1, $3, 'passport.pdf', 'application/pdf', 100, 'clean', now() + interval '1 hour') returning id`,
      [f.orgId, doc, `${f.orgId}/synthetic/${randomUUID()}`],
    )
  ).rows[0].id;
  await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id) values ($1, $2, $3)`, [f.orgId, doc, matterId]);
  return version;
}

async function beginAsk(f: Firm, userId = f.manager) {
  await staff(userId, f.orgId);
  const r = (await db.query<{ r: { ok: boolean; run_id?: string; error?: string } }>(`select public.begin_vo_run($1, 'ask', null, $2) as r`, [f.orgId, f.matterId])).rows[0].r;
  expect(r.ok).toBe(true);
  return r.run_id!;
}

async function beginReply(f: Firm, userId = f.manager) {
  await staff(userId, f.orgId);
  const r = (await db.query<{ r: { ok: boolean; run_id?: string } }>(`select public.begin_vo_run($1, 'message_reply', $2, null) as r`, [f.orgId, f.threadId])).rows[0].r;
  expect(r.ok).toBe(true);
  return r.run_id!;
}

async function answer(runId: string, sources: object[]) {
  return db.query(`select public.finish_vo_run($1, 'answered', null, null, $2::jsonb, $3, 'ask-2', false, 300, null) as id`, [runId, JSON.stringify(sources), MODEL]);
}

async function drafted(runId: string, body: string, sources: object[]) {
  return (
    await db.query<{ id: string }>(`select public.finish_vo_run($1, 'drafted', 'Reply to Synthetic Applicant', $2, $3::jsonb, $4, 'reply-1', false, 420, null) as id`, [
      runId,
      body,
      JSON.stringify(sources),
      MODEL,
    ])
  ).rows[0].id;
}

describe("what Vo may cite as official", () => {
  it("accepts only deep pages on federal official hosts, the same in the database and on the page", async () => {
    const cases: [string, boolean][] = [
      [FEES, true],
      ["https://laws-lois.justice.gc.ca/eng/regulations/SOR-2002-227/page-1.html#h-1", true],
      ["https://laws-lois.justice.gc.ca/eng/acts/I-2.5/", true],
      ["https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides.html", true],
      ["https://www.canada.ca", false],
      ["https://www.canada.ca/", false],
      ["https://www.canada.ca/en.html", false],
      ["https://www.canada.ca/en/immigration-refugees-citizenship.html", false],
      ["https://laws-lois.justice.gc.ca/eng/acts/", false],
      ["http://ircc.canada.ca/english/information/fees/fees.asp", false],
      ["https://example.com/fees.asp", false],
      ["https://canada.ca.example.com/en/fees.html", false],
      ["https://register.college-ic.ca/Public-Register-EN/Licensee/Profile.aspx", false],
      ["https://www.welcomebc.ca/immigrate-to-b-c/about-the-bc-provincial-nominee-program", false],
    ];
    for (const [url, expected] of cases) {
      const row = await db.query<{ ok: boolean }>(`select app.vo_citable_official_url($1) as ok`, [url]);
      expect([url, row.rows[0].ok]).toEqual([url, expected]);
      expect([url, isCitableOfficialUrl(url)]).toEqual([url, expected]);
    }
  });

  it("tells advice-like text apart the same way in the database and on the page", async () => {
    const cases: [string, boolean][] = [
      ["I can meet Tuesday at 11.", false],
      ["Please upload your passport copy to the portal.", false],
      ["The government fee is $150.", true],
      ["You should apply for a study permit now.", true],
      ["You may be eligible for this program.", true],
      ["This is not a guarantee of approval.", true],
      ["Les frais sont de 150 $.", true],
      ["Selon le règlement, vous devriez attendre.", true],
      ["Thanks for the feedback.", false],
    ];
    for (const [text, expected] of cases) {
      const row = await db.query<{ ok: boolean }>(`select app.vo_advice_like($1) as ok`, [text]);
      expect([text, row.rows[0].ok]).toEqual([text, expected]);
      expect([text, adviceLike(text)]).toEqual([text, expected]);
    }
  });
});

describe("Ask Vo's grounded reads", () => {
  it("lists the run's approved facts and approved official content from deep federal pages only, to the run's own person", async () => {
    const f = await firm();
    const good = await fee(f, FEES);
    await fee(f, "https://www.canada.ca/en.html", "Synthetic homepage fee");
    await fee(f, "https://example.com/fees", "Synthetic other-site fee");
    const run = await beginAsk(f);
    const facts = (await db.query<{ r: { facts: { answer_id: string }[] } }>(`select public.vo_run_facts($1) as r`, [run])).rows[0].r;
    expect(facts.facts.map((row) => row.answer_id)).toEqual([f.nameAnswer]);
    const official = (await db.query<{ r: { id: string; source_url: string; source_section: string; snapshot_sha256: string }[] }>(`select public.vo_run_official_content($1) as r`, [run])).rows[0].r;
    expect(official.map((row) => row.id)).toEqual([good]);
    expect(official[0]).toMatchObject({ source_url: FEES, source_section: "Synthetic section", snapshot_sha256: "a".repeat(64) });
    // Another staff member, a portal user or a finished run can't read them.
    await staff(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.vo_run_facts($1)`, [run]), /vo denied/);
    await portal(f.applicant, f.orgId);
    await expectDbError(() => db.query(`select public.vo_run_official_content($1)`, [run]), /vo denied/);
    // A reply run is not an Ask Vo run.
    const reply = await beginReply(f);
    await expectDbError(() => db.query(`select public.vo_run_facts($1)`, [reply]), /vo denied/);
  });
});

describe("finish_vo_run: citations in the run's allowed set", () => {
  it("keeps an answer's checked citations on the run, with the official source rebuilt from the database", async () => {
    const f = await firm();
    const feeId = await fee(f, FEES);
    const version = await documentVersion(f, f.matterId);
    const run = await beginAsk(f);
    await answer(run, [
      { kind: "matter", id: f.matterId, label: "Synthetic matter" },
      { kind: "document_version", id: version, label: "Document: Synthetic passport copy" },
      { kind: "fact", id: f.nameAnswer, label: "Intake: Full name" },
      { kind: "official", source_kind: "fee", id: feeId, label: "IRCC fee: Synthetic test fee", url: "https://evil.example/forged" },
    ]);
    await asMaintenance(db);
    const row = (await db.query<{ result: string; source_count: number; citations: Record<string, unknown>[] }>(`select result, source_count, citations from public.vo_runs where id = $1`, [run])).rows[0];
    expect(row.result).toBe("answered");
    expect(row.source_count).toBe(4);
    expect(row.citations.map((c) => c.kind)).toEqual(["matter", "document_version", "fact", "official"]);
    // The official page comes from the approved row, never from what the service said.
    expect(row.citations[3]).toMatchObject({ source_kind: "fee", url: FEES, section: "Synthetic section", snapshot_sha256: "a".repeat(64) });
    expect(JSON.stringify(row.citations)).not.toContain("evil.example");
    const audit = (await db.query<{ context: { official_sources: number } }>(`select context from public.audit_log where object_id = $1 and action = 'vo.run_finished'`, [run])).rows[0];
    expect(audit.context.official_sources).toBe(1);
  });

  it("refuses a citation outside the allowed set: another matter's document, an unreviewed or unknown fact, unapproved or non-official content", async () => {
    const f = await firm();
    const otherVersion = await documentVersion(f, f.otherMatterId);
    const homepage = await fee(f, "https://www.canada.ca/en.html", "Synthetic homepage fee");
    const g = await firm();
    const otherFirmFee = await fee(g, FEES);
    for (const [source, pattern] of [
      [{ kind: "document_version", id: otherVersion, label: "Other matter's file" }, /outside this matter/],
      [{ kind: "fact", id: f.cityAnswer, label: "Unreviewed answer" }, /not an approved fact/],
      [{ kind: "fact", id: randomUUID(), label: "Made-up fact" }, /not an approved fact/],
      [{ kind: "official", source_kind: "fee", id: homepage, label: "Homepage fee" }, /not approved official content/],
      [{ kind: "official", source_kind: "fee", id: otherFirmFee, label: "Another firm's fee" }, /not approved official content/],
      [{ kind: "official", source_kind: "rule_version", id: randomUUID(), label: "Made-up rule" }, /not approved official content/],
      [{ kind: "web_page", id: randomUUID(), label: "Some page" }, /unknown source kind/],
    ] as [object, RegExp][]) {
      const run = await beginAsk(f);
      await expectDbError(() => answer(run, [{ kind: "matter", id: f.matterId, label: "Synthetic matter" }, source]), pattern);
    }
  });
});

describe("advice-like drafts need a licensed member's review before sending", () => {
  it("flags a draft that reads as advice or cites official content, and lets only a licensed member with a fresh step-up send it", async () => {
    const f = await firm();
    const feeId = await fee(f, FEES);
    const run = await beginReply(f);
    const draftId = await drafted(run, "Thanks. You should apply soon; the fee is on the IRCC fee list.", [{ kind: "message", id: f.messageId, label: "Client message" }]);
    const cites = await beginReply(f);
    const officialDraft = await drafted(cites, "Thanks, we will be in touch.", [
      { kind: "message", id: f.messageId, label: "Client message" },
      { kind: "official", source_kind: "fee", id: feeId, label: "IRCC fee" },
    ]);
    await asMaintenance(db);
    const flags = (await db.query<{ id: string; licensed_review_required: boolean; sources: { kind: string; url?: string }[] }>(`select id, licensed_review_required, sources from public.vo_drafts where id = any($1)`, [[draftId, officialDraft]])).rows;
    expect(flags.every((row) => row.licensed_review_required)).toBe(true);
    expect(flags.find((row) => row.id === officialDraft)!.sources[1]).toMatchObject({ kind: "official", url: FEES });

    // The case manager who asked can't send it; the consultant needs a fresh step-up.
    await staff(f.manager, f.orgId, true);
    await expectDbError(() => db.query(`select public.send_vo_draft($1, $2, null)`, [draftId, "Thanks. You should apply soon; the fee is on the IRCC fee list."]), /licensed member's review/);
    await staff(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.send_vo_draft($1, $2, null)`, [draftId, "Thanks. You should apply soon; the fee is on the IRCC fee list."]), /step-up is required/);
    await staff(f.consultant, f.orgId, true);
    await db.query(`select public.send_vo_draft($1, $2, null)`, [draftId, "Thanks. You should apply soon; the fee is on the IRCC fee list."]);
    // Removing the advice by editing doesn't lift a flag set on the draft.
    await staff(f.manager, f.orgId, true);
    await expectDbError(() => db.query(`select public.send_vo_draft($1, 'Thanks, we will be in touch.', null)`, [officialDraft]), /licensed member's review/);
    await asMaintenance(db);
    const audit = (await db.query<{ context: { licensed_review: boolean } }>(`select context from public.audit_log where object_id = $1 and action = 'vo.draft_sent'`, [draftId])).rows[0];
    expect(audit.context.licensed_review).toBe(true);
  });

  it("lets staff send an administrative draft, unless they edit advice into it", async () => {
    const f = await firm();
    const run = await beginReply(f);
    const draftId = await drafted(run, "Thanks, I can meet Tuesday at 11.", [{ kind: "message", id: f.messageId, label: "Client message" }]);
    await asMaintenance(db);
    expect((await db.query<{ flag: boolean }>(`select licensed_review_required as flag from public.vo_drafts where id = $1`, [draftId])).rows[0].flag).toBe(false);
    await staff(f.manager, f.orgId);
    await expectDbError(() => db.query(`select public.send_vo_draft($1, 'Thanks. You are likely eligible, so you should apply.', null)`, [draftId]), /licensed member's review/);
    const sent = (await db.query<{ r: { message_id: string } }>(`select public.send_vo_draft($1, 'Thanks, I can meet Tuesday at 11.', null) as r`, [draftId])).rows[0].r;
    expect(sent.message_id).toBeTruthy();
    await asMaintenance(db);
    const audit = (await db.query<{ context: { licensed_review: boolean } }>(`select context from public.audit_log where object_id = $1 and action = 'vo.draft_sent'`, [draftId])).rows[0];
    expect(audit.context.licensed_review).toBe(false);
  });
});
