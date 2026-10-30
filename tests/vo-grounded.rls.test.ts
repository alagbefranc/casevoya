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
      // SRC-01 homepage rule (app.official_claim_url): one page segment besides language and index is a landing page.
      ["https://www.canada.ca/en/services.html", false],
      ["https://www.canada.ca/fr/index.html", false],
      ["https://laws-lois.justice.gc.ca/eng/index.html", false],
      ["https://ircc.canada.ca/english/home.asp", false],
    ];
    for (const [url, expected] of cases) {
      const row = await db.query<{ ok: boolean; claim: boolean }>(
        `select app.vo_citable_official_url($1) as ok, app.official_claim_url($1) is not null as claim`,
        [url],
      );
      expect([url, row.rows[0].ok]).toEqual([url, expected]);
      expect([url, isCitableOfficialUrl(url)]).toEqual([url, expected]);
      // Never citable where the claims rule refuses the page.
      if (!row.rows[0].claim) expect([url, row.rows[0].ok]).toEqual([url, false]);
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

  it("cites a rule version only while it is live (app.rule_version_is_live, the SRC-03 definition)", async () => {
    const f = await firm();
    // A firm snapshot of a synthetic deep IRCC page, cited as evidence by each rule version.
    // Firm governance rows are written by definer functions only (20261030235000): seeded from maintenance.
    await asMaintenance(db);
    const page = `https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic-${tag()}.html`;
    const source = (
      await db.query<{ id: string }>(
        `insert into public.official_sources (organization_id, publisher, canonical_url, jurisdiction, content_kind)
         values ($1, 'Immigration, Refugees and Citizenship Canada', $2, 'CA', 'program_guidance') returning id`,
        [f.orgId, page],
      )
    ).rows[0].id;
    const snapshot = (
      await db.query<{ id: string }>(
        `insert into public.source_snapshots (source_id, final_url, publisher, retrieved_at, content_hash, retrieval_result)
         values ($1, $2, 'Immigration, Refugees and Citizenship Canada', '2026-10-20T12:00:00Z', $3, 'success') returning id`,
        [source, page, "b".repeat(64)],
      )
    ).rows[0].id;
    await asMaintenance(db);
    const ownerMembership = (
      await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2 and role = 'firm_owner'`, [f.orgId, f.owner])
    ).rows[0].id;

    /** A rule version of its own claim, approved and published from a maintenance session (the SRC-03 gate). */
    async function rule(label: string, effectiveFrom: string) {
      await asMaintenance(db);
      const definition = (
        await db.query<{ id: string }>(
          `insert into public.rule_definitions (organization_id, stable_key, category, jurisdiction) values ($1, $2, 'immigration_requirement', 'CA') returning id`,
          [f.orgId, `CA.SYNTHETIC.${label}${tag().toUpperCase().replace(/[^A-Z0-9]/g, "X")}`],
        )
      ).rows[0].id;
      const id = (
        await db.query<{ id: string }>(
          `insert into public.rule_versions (definition_id, version_number, claim, output_value, effective_from, next_review_at, test_case_ids)
           values ($1, 1, $2, '{"kind": "rule"}'::jsonb, $3, '2027-11-01T00:00:00Z', array['synthetic-case']) returning id`,
          [definition, `Synthetic claim ${label}. Not an immigration requirement.`, effectiveFrom],
        )
      ).rows[0].id;
      await db.query(`insert into public.rule_evidence (rule_version_id, snapshot_id, source_section) values ($1, $2, 'synthetic-section')`, [id, snapshot]);
      await asMaintenance(db);
      await db.query(
        `insert into public.professional_reviews (organization_id, rule_version_id, reviewer_membership_id, decision, decided_at, rule_content_revision)
         values ($1, $2, $3, 'approved', '2026-10-16T15:00:00Z', 1)`,
        [f.orgId, id, ownerMembership],
      );
      await db.query(`update public.rule_versions set status = 'published' where id = $1`, [id]);
      return id;
    }

    const live = await rule("LIVE", "2020-01-01T00:00:00Z");
    const suspended = await rule("SUSPENDED", "2020-01-01T00:00:00Z");
    const superseded = await rule("SUPERSEDED", "2020-01-01T00:00:00Z");
    const reviewDue = await rule("REVIEWDUE", "2020-01-01T00:00:00Z");
    const notYet = await rule("NOTYET", "2999-01-01T00:00:00Z");
    await db.query(`update public.rule_versions set status = 'suspended' where id = $1`, [suspended]);
    await db.query(`update public.rule_versions set status = 'superseded' where id = $1`, [superseded]);
    await db.query(`update public.rule_versions set status = 'review_due' where id = $1`, [reviewDue]);

    const run = await beginAsk(f);
    const official = (await db.query<{ r: { kind: string; id: string; source_url: string }[] }>(`select public.vo_run_official_content($1) as r`, [run])).rows[0].r;
    expect(official.filter((row) => row.kind === "rule_version").map((row) => row.id)).toEqual([live]);
    expect(official.find((row) => row.id === live)?.source_url).toBe(page);
    for (const id of [suspended, superseded, reviewDue, notYet]) {
      await expectDbError(
        () => answer(run, [{ kind: "official", source_kind: "rule_version", id, label: "Synthetic rule" }]),
        /not approved official content/,
      );
    }
    await answer(run, [{ kind: "official", source_kind: "rule_version", id: live, label: "Synthetic rule" }]);
  });
});

/**
 * 20261025450000_vo_attested_citations.sql (Francis's decision 2026-10-25): a live claim a licensed
 * reviewer approved by attestation, without a page capture, is citable, and every citation of it
 * carries the attestation (who, and the date they opened the page), rebuilt from the database.
 */
describe("attested claims (no page capture)", () => {
  const OPENED = "2026-10-24";

  /** A live claim whose only evidence is a page Casevoya didn't capture, attested by the firm owner who approved it. */
  async function attestedClaim(f: Firm, opts: { attest?: boolean; reviewerMatches?: boolean } = {}) {
    const attest = opts.attest ?? true;
    await asMaintenance(db);
    const ownerMembership = (
      await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2 and role = 'firm_owner'`, [f.orgId, f.owner])
    ).rows[0].id;
    const consultantMembership = (
      await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [f.orgId, f.consultant])
    ).rows[0].id;
    await db.query(`update public.profiles set display_name = 'Amara Osei' where id = $1`, [f.owner]);
    const page = `https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic-attested-${tag()}.html#s2`;
    // Seeded from maintenance: firm rule rows are written by definer functions only (20261030235000).
    const definition = (
      await db.query<{ id: string }>(
        `insert into public.rule_definitions (organization_id, stable_key, category, jurisdiction) values ($1, $2, 'immigration_requirement', 'CA') returning id`,
        [f.orgId, `CA.SYNTHETIC.ATTESTED${tag().toUpperCase().replace(/[^A-Z0-9]/g, "X")}`],
      )
    ).rows[0].id;
    const id = (
      await db.query<{ id: string }>(
        `insert into public.rule_versions (definition_id, version_number, claim, output_value, effective_from, next_review_at, test_case_ids)
         values ($1, 1, 'Synthetic attested claim. Not an immigration requirement.', '{"kind": "rule"}'::jsonb, '2020-01-01T00:00:00Z', '2027-11-01T00:00:00Z', array['synthetic-case']) returning id`,
        [definition],
      )
    ).rows[0].id;
    await db.query(`insert into public.rule_evidence (rule_version_id, snapshot_id, source_section, source_url, checked_on) values ($1, null, 'synthetic-section', $2, $3)`, [id, page, OPENED]);
    await asMaintenance(db);
    await db.query(
      `insert into public.professional_reviews (organization_id, rule_version_id, reviewer_membership_id, decision, decided_at, rule_content_revision)
       values ($1, $2, $3, 'approved', '2026-10-24T15:00:00Z', 1)`,
      [f.orgId, id, ownerMembership],
    );
    // What app.review_rule_version records when the reviewer attests (a maintenance session stands in for it).
    const attester = opts.reviewerMatches === false ? consultantMembership : ownerMembership;
    await db.query(`update public.rule_evidence set page_attested_by_membership_id = $2, page_attested_on = $3, page_attested_at = now() where rule_version_id = $1`, [id, attester, OPENED]);
    await db.query(`update public.rule_versions set status = 'published' where id = $1`, [id]);
    if (!attest) {
      // Published evidence can't change; with triggers off this stands in for a claim published without one.
      await db.query(`set session_replication_role = replica`);
      try {
        await db.query(`update public.rule_evidence set page_attested_by_membership_id = null, page_attested_on = null, page_attested_at = null where rule_version_id = $1`, [id]);
      } finally {
        await db.query(`set session_replication_role = origin`);
      }
    }
    return { id, page };
  }

  async function officialContent(run: string) {
    return (await db.query<{ r: Record<string, unknown>[] }>(`select public.vo_run_official_content($1) as r`, [run])).rows[0].r;
  }

  it("lists an attested live claim with its attestation, and every citation of it carries the attestation from the database", async () => {
    const f = await firm();
    const feeId = await fee(f, FEES);
    const claim = await attestedClaim(f);
    const run = await beginAsk(f);
    const official = await officialContent(run);
    expect(official.find((row) => row.id === claim.id)).toMatchObject({
      kind: "rule_version",
      source_url: claim.page,
      snapshot_sha256: null,
      checked_on: OPENED,
      attested: true,
      attested_by: "Amara Osei",
      attested_on: OPENED,
    });
    expect(official.find((row) => row.id === feeId)).toMatchObject({ attested: false });

    // The service's own say about the attestation is ignored: the run keeps the database's.
    await answer(run, [
      { kind: "official", source_kind: "rule_version", id: claim.id, label: "Program rule: synthetic", attested_by: "Forged Name", attested_on: "1999-01-01" },
      { kind: "official", source_kind: "fee", id: feeId, label: "IRCC fee: Synthetic test fee" },
    ]);
    await asMaintenance(db);
    const cites = (await db.query<{ citations: Record<string, unknown>[] }>(`select citations from public.vo_runs where id = $1`, [run])).rows[0].citations;
    expect(cites[0]).toMatchObject({ source_kind: "rule_version", url: claim.page, snapshot_sha256: null, attested: true, attested_by: "Amara Osei", attested_on: OPENED });
    expect(cites[1]).toMatchObject({ source_kind: "fee", attested: false });
    expect(JSON.stringify(cites)).not.toContain("Forged");

    // A draft's source list keeps it too.
    const reply = await beginReply(f);
    const draftId = await drafted(reply, "Thanks, we will be in touch.", [
      { kind: "message", id: f.messageId, label: "Client message" },
      { kind: "official", source_kind: "rule_version", id: claim.id, label: "Program rule: synthetic" },
    ]);
    await asMaintenance(db);
    const sources = (await db.query<{ sources: Record<string, unknown>[] }>(`select sources from public.vo_drafts where id = $1`, [draftId])).rows[0].sources;
    expect(sources[0]).not.toHaveProperty("attested");
    expect(sources[1]).toMatchObject({ kind: "official", url: claim.page, attested: true, attested_by: "Amara Osei", attested_on: OPENED });
  });

  it("doesn't cite a claim with no capture and no attestation, or one attested by someone who didn't approve it", async () => {
    const f = await firm();
    const bare = await attestedClaim(f, { attest: false });
    const stranger = await attestedClaim(f, { reviewerMatches: false });
    const run = await beginAsk(f);
    const ids = (await officialContent(run)).map((row) => row.id);
    expect(ids).not.toContain(bare.id);
    expect(ids).not.toContain(stranger.id);
    for (const claim of [bare, stranger]) {
      await expectDbError(() => answer(run, [{ kind: "official", source_kind: "rule_version", id: claim.id, label: "Program rule" }]), /not approved official content/);
    }
  });

  it("doesn't cite an attested claim whose page is a homepage or not a federal page", async () => {
    const f = await firm();
    const homepage = await attestedClaim(f);
    const provincial = await attestedClaim(f);
    // Evidence like this is refused on entry (and can't change once published); with triggers off,
    // the citation rule must refuse it on its own as well.
    await asMaintenance(db);
    await db.query(`set session_replication_role = replica`);
    try {
      await db.query(`update public.rule_evidence set source_url = 'https://www.canada.ca/en.html' where rule_version_id = $1`, [homepage.id]);
      await db.query(`update public.rule_evidence set source_url = 'https://www.welcomebc.ca/immigrate-to-b-c/about-the-bc-provincial-nominee-program' where rule_version_id = $1`, [provincial.id]);
    } finally {
      await db.query(`set session_replication_role = origin`);
    }
    const run = await beginAsk(f);
    const ids = (await officialContent(run)).map((row) => row.id);
    expect(ids).not.toContain(homepage.id);
    expect(ids).not.toContain(provincial.id);
    for (const claim of [homepage, provincial]) {
      await expectDbError(() => answer(run, [{ kind: "official", source_kind: "rule_version", id: claim.id, label: "Program rule" }]), /not approved official content/);
    }
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
