import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { voDocumentCategory } from "@/modules/vo/vo-doc";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * 20261019218000_vo_doc_review_enums.sql and 20261019218100_vo_doc_review.sql against the real
 * migrations (PRD AI-01..AI-06, SRC-06, SRC-09): the capability and per-category switches (medical
 * and criminal off by default), step-up like Open file, who may ask, proposals that respect the
 * switches and deadlines grounded in a date printed on the document, tenant isolation of the new
 * draft kind, and accepting (classification through the document write guard, deadline through
 * app.record_deadline) or rejecting, audited, with nothing changed before a person accepts.
 */
let db: TestDb;

const MODEL = "claude-opus-5-5";

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().slice(0, 8);

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${tag()}@example.test`,
  ]);
  return id;
}

async function membership(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
    [orgId, userId, role],
  );
  return row.rows[0].id;
}

/** A firm with a consultant on one matter, a client with one clean document, and staff not on it. */
async function firm(options: { sample?: boolean; sampleMatter?: boolean; purpose?: string; sensitivity?: string } = {}) {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = $2 where id = $1`, [orgId, options.sample ?? false]);
  const matter = await db.query<{ id: string }>(
    `insert into public.matters (organization_id, title, is_sample) values ($1, 'Synthetic matter', $2) returning id`,
    [orgId, options.sampleMatter ?? false],
  );
  const matterId = matter.rows[0].id;
  const consultant = await createUser("consultant");
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant");
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [
    orgId,
    matterId,
    consultantMembership,
  ]);
  const outsider = await createUser("other-staff");
  await membership(orgId, outsider, "case_manager");
  const finance = await createUser("finance");
  await membership(orgId, finance, "finance_user");
  const clientUser = await createUser("client");
  await membership(orgId, clientUser, "client");
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, user_id, display_name, is_sample) values ($1, $2, 'Synthetic Applicant', $3) returning id`,
    [orgId, clientUser, options.sampleMatter ?? false],
  );
  const personId = person.rows[0].id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [
    orgId,
    matterId,
    personId,
  ]);
  const doc = await db.query<{ id: string }>(
    `insert into public.documents (organization_id, person_id, purpose, sensitivity, audience, created_by)
     values ($1, $2, $3, $4::public.document_sensitivity, 'subject', $5) returning id`,
    [orgId, personId, options.purpose ?? "Passport bio page", options.sensitivity ?? "ordinary", clientUser],
  );
  const documentId = doc.rows[0].id;
  const version = await db.query<{ id: string }>(
    `insert into public.document_versions (
       organization_id, document_id, version_number, storage_key, original_filename, declared_media_type,
       declared_byte_size, upload_state, intent_expires_at, created_by
     ) values ($1, $2, 1, $3, 'passport.pdf', 'application/pdf', 1000, 'clean', now() + interval '1 hour', $4) returning id`,
    [orgId, documentId, `${orgId}/${randomUUID()}/passport.pdf`, clientUser],
  );
  await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by) values ($1, $2, $3, $4)`, [
    orgId,
    documentId,
    matterId,
    clientUser,
  ]);
  return { orgId, matterId, owner, consultant, outsider, finance, clientUser, personId, documentId, versionId: version.rows[0].id };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const staff = (f: Firm, userId: string, totpAgeSeconds = 60) => asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds });

async function settings(f: Firm, changes: Record<string, boolean>) {
  await staff(f, f.owner);
  await db.query(`select public.set_vo_settings($1, $2::jsonb)`, [f.orgId, JSON.stringify(changes)]);
}

async function begin(f: Firm, versionId = f.versionId) {
  const row = await db.query<{ r: { ok: boolean; error?: string; run_id?: string; matter_id?: string; category?: string; draft_id?: string } }>(
    `select public.begin_vo_document_review($1, $2) as r`,
    [f.orgId, versionId],
  );
  return row.rows[0].r;
}

type Proposal = Record<string, unknown>;

const PROPOSALS: Proposal[] = [
  { kind: "classification", label: "Suggested purpose", value: "Passport bio page (applicant)", category: "identity", sensitivity: null, confidence: 90, page: 1 },
  { kind: "field", label: "Full name", value: "Synthetic Applicant", page: 1, confidence: 98 },
  { kind: "field", label: "Date of expiry", value: "2031-03-03", page: 1, confidence: 91 },
  { kind: "field", label: "Passport number", value: "[number removed]", page: 1, confidence: 80 },
  { kind: "missing_field", label: "Signature", detail: "The signature line looks empty.", page: 1 },
  { kind: "inconsistency", label: "Name spelling", detail: "The name differs from the matter's spelling. A person should check it." },
  { kind: "deadline", label: "Passport expires", value: "2031-03-03", due_on: "2031-03-03", page: 1 },
];

async function finish(runId: string, proposals: Proposal[] = PROPOSALS, result = "drafted") {
  const row = await db.query<{ id: string | null }>(
    `select public.finish_vo_document_review($1, $2::public.vo_run_result, $3, $4, $5::jsonb, $6, 'docread-1', false, 900, null, $7, 3000, 400, 0.02) as id`,
    [runId, result, "Vo read Passport bio page", "Vo read the passport page and found 7 things to check.", result === "drafted" ? JSON.stringify(proposals) : null, MODEL, ["read_document_version"]],
  );
  return row.rows[0].id;
}

async function readingFor(f: Firm) {
  await settings(f, { enabled: true, read_identity: true });
  await staff(f, f.consultant);
  const run = await begin(f);
  expect(run.ok).toBe(true);
  const draftId = await finish(run.run_id!);
  expect(draftId).toBeTruthy();
  return { runId: run.run_id!, draftId: draftId! };
}

async function proposals(draftId: string) {
  const rows = await db.query<{ id: string; kind: string; status: string; label: string; value: string | null }>(
    `select id, kind::text, status::text, label, value from public.vo_doc_proposals where draft_id = $1 order by position`,
    [draftId],
  );
  return rows.rows;
}

describe("Vo document reading: categories", () => {
  it("classifies a document exactly like the service does", async () => {
    await asMaintenance(db);
    const samples: [string, string][] = [
      ["Passport bio page", "ordinary"],
      ["Passport bio page", "medical"],
      ["Police certificate (India)", "ordinary"],
      ["Bank statement, March", "ordinary"],
      ["Sponsor proof of income (T4)", "ordinary"],
      ["Marriage certificate", "ordinary"],
      ["Wedding photos", "ordinary"],
      ["Letter of explanation", "ordinary"],
      ["Upfront medical exam", "ordinary"],
      ["Something else", "ordinary"],
      ["Something else", "criminal"],
      ["Personal statement", "narrative"],
    ];
    for (const [purpose, sensitivity] of samples) {
      const row = await db.query<{ c: string }>(`select app.vo_document_category($1, $2::public.document_sensitivity) as c`, [purpose, sensitivity]);
      expect(row.rows[0].c, `${purpose} / ${sensitivity}`).toBe(voDocumentCategory(purpose, sensitivity));
    }
  });
});

describe("Vo document reading: switches", () => {
  it("refuses until Vo is on, the category is allowed and a document capability is on", async () => {
    const f = await firm();
    await staff(f, f.consultant);
    expect(await begin(f)).toEqual({ ok: false, error: "off" });
    // Vo on, but every document category is off by default.
    await settings(f, { enabled: true });
    await staff(f, f.consultant);
    expect(await begin(f)).toEqual({ ok: false, error: "category_off", category: "identity" });
    await settings(f, { read_identity: true, doc_classification: false, ocr_normalisation: false, missing_fields: false, inconsistency_flags: false });
    await staff(f, f.consultant);
    expect(await begin(f)).toEqual({ ok: false, error: "capability_off" });
    await settings(f, { ocr_normalisation: true });
    await staff(f, f.consultant);
    const run = await begin(f);
    expect(run).toMatchObject({ ok: true, matter_id: f.matterId, category: "identity" });
    await asMaintenance(db);
    const row = await db.query<{ kind: string; version_id: string; thread_id: string | null }>(`select kind::text, version_id, thread_id from public.vo_runs where id = $1`, [run.run_id]);
    expect(row.rows[0]).toEqual({ kind: "document_review", version_id: f.versionId, thread_id: null });
  });

  it("keeps medical and criminal documents from Vo unless the owner turns them on", async () => {
    const medical = await firm({ purpose: "Immigration medical exam results", sensitivity: "medical" });
    await settings(medical, { enabled: true, read_identity: true, read_relationship: true, read_financial: true, read_narratives: true });
    await staff(medical, medical.consultant);
    expect(await begin(medical)).toEqual({ ok: false, error: "category_off", category: "medical" });
    const criminal = await firm({ purpose: "Police certificate (India)" });
    await settings(criminal, { enabled: true, read_identity: true });
    await staff(criminal, criminal.consultant);
    expect(await begin(criminal)).toEqual({ ok: false, error: "category_off", category: "criminal" });
    await settings(criminal, { read_criminal: true });
    await staff(criminal, criminal.consultant);
    expect((await begin(criminal)).ok).toBe(true);
  });

  it("works on sample records only in sample mode", async () => {
    const mixed = await firm({ sample: true, sampleMatter: false });
    await settings(mixed, { enabled: true, read_identity: true });
    await staff(mixed, mixed.consultant);
    expect(await begin(mixed)).toEqual({ ok: false, error: "sample_only" });
  });
});

describe("Vo document reading: who may ask", () => {
  it("needs staff on the matter with a fresh second factor, like Open file", async () => {
    const f = await firm();
    const other = await firm();
    await settings(f, { enabled: true, read_identity: true });
    await staff(f, f.consultant, 3600);
    await expectDbError(() => begin(f), /step-up is required/);
    await staff(f, f.outsider);
    await expectDbError(() => begin(f), /vo denied/);
    await staff(f, f.finance);
    await expectDbError(() => begin(f), /staff access denied/);
    await asUser(db, { userId: f.clientUser, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => begin(f), /staff access denied/);
    // Another firm's consultant, naming this firm's document version.
    await staff(other, other.consultant);
    await expectDbError(() => begin(other, f.versionId), /vo denied/);
  });

  it("doesn't read a version twice while its proposals wait", async () => {
    const f = await firm();
    const { draftId } = await readingFor(f);
    await staff(f, f.consultant);
    expect(await begin(f)).toEqual({ ok: false, error: "already_read", draft_id: draftId, matter_id: f.matterId });
  });
});

describe("Vo document reading: proposals", () => {
  it("saves proposals grounded in the document and within the switches, and refuses the rest", async () => {
    const f = await firm();
    await settings(f, { enabled: true, read_identity: true });
    await staff(f, f.consultant);
    const run = await begin(f);
    // A deadline that isn't one of the dates read from the page (e.g. calculated from a rule).
    await expectDbError(
      () => finish(run.run_id!, [...PROPOSALS.slice(0, 3), { kind: "deadline", label: "Apply to renew", due_on: "2030-12-03" }]),
      /printed on the document/,
    );
    // Reading something that looks like a kind the firm keeps from Vo: only the suggestion may stay.
    await expectDbError(
      () => finish(run.run_id!, [{ kind: "classification", label: "Suggested purpose", value: "Medical report", category: "medical" }, PROPOSALS[1]]),
      /outside the firm's Vo switches/,
    );
    await expectDbError(() => finish(run.run_id!, [{ kind: "fraud_finding", label: "Forged" }]), /unknown proposal kind/);
    await expectDbError(() => finish(run.run_id!, []), /1 to 60 proposals/);
    // Another person can't finish this person's run.
    await staff(f, f.owner);
    await expectDbError(() => finish(run.run_id!), /vo denied/);
    // A capability switched off after the run began.
    await settings(f, { missing_fields: false });
    await staff(f, f.consultant);
    await expectDbError(() => finish(run.run_id!), /outside the firm's Vo switches/);
    await settings(f, { missing_fields: true });
    await staff(f, f.consultant);
    const draftId = await finish(run.run_id!);
    expect(draftId).toBeTruthy();
    await expectDbError(() => finish(run.run_id!), /already finished/);
    const rows = await proposals(draftId!);
    expect(rows.map((row) => row.kind)).toEqual(["classification", "field", "field", "field", "missing_field", "inconsistency", "deadline"]);
    expect(rows.every((row) => row.status === "proposed")).toBe(true);
    const draft = await db.query<{ kind: string; sources: { kind: string; id: string }[]; status: string }>(
      `select kind::text, sources, status::text from public.vo_doc_drafts where id = $1`,
      [draftId],
    );
    expect(draft.rows[0]).toMatchObject({ kind: "document_review", status: "draft" });
    expect(draft.rows[0].sources).toEqual([{ kind: "document_version", id: f.versionId, label: "Passport bio page, version 1" }]);
    const log = await db.query<{ result: string; source_count: number; tools_called: string[]; model: string; cost_usd: string }>(
      `select result::text, source_count, tools_called, model, cost_usd::text from public.vo_runs where id = $1`,
      [run.run_id],
    );
    expect(log.rows[0]).toEqual({ result: "drafted", source_count: 1, tools_called: ["read_document_version"], model: MODEL, cost_usd: "0.0200" });
    // Nothing changed on the document or the matter yet.
    await asMaintenance(db);
    const doc = await db.query<{ purpose: string }>(`select purpose from public.documents where id = $1`, [f.documentId]);
    expect(doc.rows[0].purpose).toBe("Passport bio page");
    const deadlines = await db.query(`select id from public.deadlines where matter_id = $1`, [f.matterId]);
    expect(deadlines.rows).toHaveLength(0);
  });

  it("records refusals and unsupported files as failures without a draft", async () => {
    const f = await firm();
    await settings(f, { enabled: true, read_identity: true });
    await staff(f, f.consultant);
    const run = await begin(f);
    const none = await db.query<{ id: string | null }>(
      `select public.finish_vo_document_review($1, 'failed', null, null, null, null, 'docread-1', false, 10, 'unsupported_file') as id`,
      [run.run_id],
    );
    expect(none.rows[0].id).toBeNull();
    const row = await db.query<{ result: string; failure: string }>(`select result::text, failure from public.vo_runs where id = $1`, [run.run_id]);
    expect(row.rows[0]).toEqual({ result: "failed", failure: "unsupported_file" });
  });

  it("shows readings only to staff who can read the matter and the document, never across firms", async () => {
    const f = await firm();
    const { draftId } = await readingFor(f);
    const other = await firm();
    const read = async () => (await db.query(`select id from public.vo_doc_drafts where id = $1`, [draftId])).rows.length;
    const items = async () => (await db.query(`select id from public.vo_doc_proposals where draft_id = $1`, [draftId])).rows.length;
    await staff(f, f.consultant);
    expect(await read()).toBe(1);
    expect(await items()).toBe(7);
    await staff(f, f.owner);
    expect(await read()).toBe(1);
    await staff(f, f.outsider);
    expect(await read()).toBe(0);
    expect(await items()).toBe(0);
    await staff(f, f.finance);
    expect(await read()).toBe(0);
    await asUser(db, { userId: f.clientUser, aal: "aal1", orgId: f.orgId });
    expect(await read()).toBe(0);
    expect(await items()).toBe(0);
    await staff(other, other.consultant);
    expect(await read()).toBe(0);
    expect(await items()).toBe(0);
    // Nobody writes the tables directly.
    await staff(f, f.consultant);
    await expectDbError(() => db.query(`update public.vo_doc_proposals set status = 'accepted' where draft_id = $1`, [draftId]), /permission denied/);
    await expectDbError(() => db.query(`update public.vo_doc_drafts set status = 'reviewed' where id = $1`, [draftId]), /permission denied/);
  });
});

describe("Vo document reading: review", () => {
  it("applies an accepted classification and deadline through the existing functions, audited", async () => {
    const f = await firm();
    const { draftId } = await readingFor(f);
    const rows = await proposals(draftId);
    const byKind = (kind: string, index = 0) => rows.filter((row) => row.kind === kind)[index];
    // Staff not on the matter, and another firm's staff, can't decide.
    await staff(f, f.outsider);
    await expectDbError(() => db.query(`select public.accept_vo_doc_proposal($1)`, [byKind("classification").id]), /vo denied/);
    await staff(f, f.finance);
    await expectDbError(() => db.query(`select public.reject_vo_doc_proposal($1)`, [byKind("field").id]), /vo denied/);

    await staff(f, f.consultant);
    await db.query(`select public.accept_vo_doc_proposal($1, $2)`, [byKind("classification").id, "Passport bio page, applicant"]);
    const deadline = await db.query<{ r: { deadline_id: string; draft_status: string } }>(
      `select public.accept_vo_doc_proposal($1, $2, null) as r`,
      [byKind("deadline").id, "Applicant's passport expires"],
    );
    expect(deadline.rows[0].r.deadline_id).toBeTruthy();
    await db.query(`select public.accept_vo_doc_proposal($1)`, [byKind("field").id]);
    await expectDbError(() => db.query(`select public.accept_vo_doc_proposal($1)`, [byKind("field").id]), /already reviewed/);
    await db.query(`select public.reject_vo_doc_proposal($1)`, [byKind("inconsistency").id]);

    await asMaintenance(db);
    const doc = await db.query<{ purpose: string; sensitivity: string }>(`select purpose, sensitivity::text from public.documents where id = $1`, [f.documentId]);
    expect(doc.rows[0]).toEqual({ purpose: "Passport bio page, applicant", sensitivity: "ordinary" });
    const created = await db.query<{ kind: string; label: string; due_on: string; verification: string; source_url: string | null; calculation_note: string }>(
      `select kind::text, label, due_on::text, verification::text, source_url, calculation_note from public.deadlines where id = $1`,
      [deadline.rows[0].r.deadline_id],
    );
    expect(created.rows[0]).toMatchObject({ kind: "internal", label: "Applicant's passport expires", due_on: "2031-03-03", verification: "tentative", source_url: null });
    expect(created.rows[0].calculation_note).toMatch(/printed on the document/);
    const states = await db.query<{ kind: string; status: string; edited: boolean | null }>(
      `select kind::text, status::text, edited from public.vo_doc_proposals where draft_id = $1 order by position`,
      [draftId],
    );
    expect(states.rows.map((row) => row.status)).toEqual(["accepted", "accepted", "proposed", "proposed", "proposed", "rejected", "accepted"]);
    expect(states.rows[0].edited).toBe(true);

    // The rest decided: the reading is reviewed.
    await staff(f, f.consultant);
    for (const row of (await proposals(draftId)).filter((item) => item.status === "proposed")) {
      await db.query(`select public.reject_vo_doc_proposal($1)`, [row.id]);
    }
    const draft = await db.query<{ status: string; reviewed_by: string }>(`select status::text, reviewed_by from public.vo_doc_drafts where id = $1`, [draftId]);
    expect(draft.rows[0]).toEqual({ status: "reviewed", reviewed_by: f.consultant });

    await asMaintenance(db);
    const audit = await db.query<{ action: string; context: Record<string, unknown> }>(
      `select action, context from public.audit_log where organization_id = $1 and (action like 'vo.%' or action = 'document.reclassified') order by occurred_at`,
      [f.orgId],
    );
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toContain("document.reclassified");
    expect(actions.filter((action) => action === "vo.proposal_accepted")).toHaveLength(3);
    expect(actions.filter((action) => action === "vo.proposal_rejected")).toHaveLength(4);
    // The audit names kinds and ids, never what Vo read.
    expect(JSON.stringify(audit.rows)).not.toContain("Synthetic Applicant");
    expect(JSON.stringify(audit.rows)).not.toContain("2031-03-03");
  });

  it("only ever makes a document's sensitivity more protective, and refuses placeholders", async () => {
    const f = await firm({ purpose: "Personal statement", sensitivity: "narrative" });
    await settings(f, { enabled: true, read_narratives: true });
    await staff(f, f.consultant);
    const run = await begin(f);
    const draftId = await finish(run.run_id!, [
      { kind: "classification", label: "Suggested purpose", value: "Letter of explanation", category: "narrative", sensitivity: "ordinary" },
      { kind: "needs_rule", label: "Renewal timing", detail: "When to renew needs [needs a sourced rule]." },
    ]);
    const rows = await proposals(draftId!);
    await expectDbError(() => db.query(`select public.accept_vo_doc_proposal($1, 'Fee is [needs a sourced rule]')`, [rows[0].id]), /placeholder/);
    await db.query(`select public.accept_vo_doc_proposal($1)`, [rows[0].id]);
    await asMaintenance(db);
    const doc = await db.query<{ purpose: string; sensitivity: string }>(`select purpose, sensitivity::text from public.documents where id = $1`, [f.documentId]);
    expect(doc.rows[0]).toEqual({ purpose: "Letter of explanation", sensitivity: "narrative" });
  });

  it("discards a whole reading once, rejecting what was left", async () => {
    const f = await firm();
    const { draftId } = await readingFor(f);
    await staff(f, f.outsider);
    await expectDbError(() => db.query(`select public.discard_vo_doc_draft($1)`, [draftId]), /vo denied/);
    await staff(f, f.owner);
    await db.query(`select public.discard_vo_doc_draft($1)`, [draftId]);
    await expectDbError(() => db.query(`select public.discard_vo_doc_draft($1)`, [draftId]), /already reviewed/);
    const rows = await proposals(draftId);
    expect(rows.every((row) => row.status === "rejected")).toBe(true);
    await expectDbError(() => db.query(`select public.accept_vo_doc_proposal($1)`, [rows[0].id]), /already reviewed/);
    // A new reading may start once nothing waits.
    await staff(f, f.consultant);
    expect((await begin(f)).ok).toBe(true);
  });
});

describe("Vo document reading: read on upload (DOC-05)", () => {
  it("is off by default and only the owner turns it on, like every Vo switch", async () => {
    const f = await firm();
    await settings(f, { enabled: true });
    await asMaintenance(db);
    expect((await db.query<{ read_on_upload: boolean }>(`select read_on_upload from public.vo_settings where organization_id = $1`, [f.orgId])).rows[0].read_on_upload).toBe(false);
    await settings(f, { read_on_upload: true });
    await asMaintenance(db);
    expect((await db.query<{ read_on_upload: boolean }>(`select read_on_upload from public.vo_settings where organization_id = $1`, [f.orgId])).rows[0].read_on_upload).toBe(true);
    await staff(f, f.consultant);
    await expectDbError(() => db.query(`select public.set_vo_settings($1, '{"read_on_upload": false}'::jsonb)`, [f.orgId]), /staff access denied/);
  });
});
