import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";
import { serverCapture } from "./helpers/server-capture";

/**
 * SEC-06 against the real migrations: legal time limits held for licensed review, the due-date
 * extension (official limit or the firm's own date) with its portal notice, the scope search with
 * third-party redaction decisions, the response package (service role completes it), delivery
 * through the portal with every download recorded, requests kept per firm, and a closed login that
 * never erases the firm's record. Synthetic records only; the law page values are synthetic.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const LAW = "https://laws-lois.justice.gc.ca/eng/acts/X-0.0/FullText.html#s-1";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const key = (prefix = "k") => `${prefix}-${randomUUID()}`;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
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

const fresh = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
const stale = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 3600 });

/** The client turns on two-step sign-in (a verified authenticator), as /portal/account does. */
async function twoStepOn(userId: string) {
  await asMaintenance(db);
  await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', 'verified')`, [randomUUID(), userId]);
}

/** A firm with a credentialed licensed consultant, a case manager, an assistant, and a client with a portal login. */
async function firm(client?: string) {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  const assistant = await createUser("assistant");
  const clientUser = client ?? (await createUser("client"));
  await fresh(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  await activeMembership(orgId, assistant, "assistant", owner);

  await fresh(consultant, orgId);
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await fresh(owner, orgId);
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);

  await fresh(consultant, orgId);
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, $2, null, null, $3, null, null) as result`, [
    "Synthetic Applicant",
    `applicant-${randomUUID().slice(0, 8)}@example.test`,
    consultantMembership,
  ]);
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  const party = await db.query<{ person_id: string }>(`select person_id from public.matter_participants where matter_id = $1 and role = 'applicant' limit 1`, [matterId]);
  const personId = party.rows[0].person_id;
  await db.query(`update public.persons set user_id = $1 where id = $2`, [clientUser, personId]);
  const clientMembership = await activeMembership(orgId, clientUser, "client", owner);
  // A consent record and a person with no portal login.
  await db.query(
    `insert into public.consent_records (organization_id, person_id, purpose, statement_text, statement_sha256, granted)
     values ($1, $2, 'contact_sms', 'Text me reminders', repeat('a', 64), true)`,
    [orgId, personId],
  );
  const offline = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name) values ($1, 'Synthetic offline person') returning id`, [orgId]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'sponsor')`, [orgId, matterId, offline.rows[0].id]);
  return {
    owner, consultant, manager, assistant, client: clientUser, orgId, matterId, personId, offlinePersonId: offline.rows[0].id,
    consultantMembership, managerMembership, clientMembership,
  };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function recordRequest(f: Firm, kind = "access", personId: string | null = f.personId) {
  await stale(f.consultant, f.orgId);
  const row = await db.query<{ id: string }>(
    `select public.record_privacy_request($1, $2, 'Synthetic requester', $3, null, 'Wants a copy of their file', 'email', $4::date, $5, $6) as id`,
    [f.orgId, kind, personId, firmDay(-2), f.consultantMembership, key("pr")],
  );
  return row.rows[0].id;
}

async function request(id: string) {
  await asMaintenance(db);
  return (await db.query<Record<string, unknown>>(`select * from public.privacy_requests where id = $1`, [id])).rows[0];
}

async function proposeLimit(f: Firm, kind: string, days: number | null, withSnapshot = true) {
  await stale(f.manager, f.orgId);
  const snapshot = withSnapshot ? JSON.stringify(await serverCapture(db, { orgId: f.orgId, url: LAW, snapshot: { sha256: sha(`page-${kind}`) } })) : null;
  const row = await db.query<{ id: string }>(
    `select public.propose_privacy_time_limit($1, $2, 'Synthetic Privacy Act', 'Synthetic provision text, word for word.', $3, $4, 's. 1(1)', $5::date, $6::date, $7::jsonb) as id`,
    [f.orgId, kind, days, LAW, firmDay(), firmDay(-20), snapshot],
  );
  return row.rows[0].id;
}

async function approveLimit(f: Firm, id: string) {
  await fresh(f.consultant, f.orgId);
  await db.query(`select public.review_privacy_time_limit($1, 1, 'approved', null, null)`, [id]);
}

/** Identity verified and the scope searched, as the consultant (the assignee). */
async function searched(f: Firm, id: string) {
  await stale(f.consultant, f.orgId);
  await db.query(`select public.record_privacy_step($1, 'identity', 'Two-step sign-in and a video call')`, [id]);
  const result = await db.query<{ r: { total: number; counts: Record<string, number> } }>(`select public.privacy_scope_search($1) as r`, [id]);
  return result.rows[0].r;
}

async function items(f: Firm, id: string) {
  await stale(f.consultant, f.orgId);
  return (await db.query<{ id: string; source: string; fields: string[]; decision: string }>(`select id, source, fields, decision from public.privacy_request_items where request_id = $1 order by source`, [id])).rows;
}

/** Scope searched, one field withheld, redaction step and review recorded, package built and ready. */
async function readyPackage(f: Firm, id: string) {
  await searched(f, id);
  const person = (await items(f, id)).find((item) => item.source === "person");
  await stale(f.consultant, f.orgId);
  await db.query(`select public.decide_privacy_item($1, 'redact', $2, 'Synthetic third party', 'Their contact details')`, [person!.id, ["email"]]);
  await db.query(`select public.record_privacy_step($1, 'redaction', 'Third-party contact details removed')`, [id]);
  await fresh(f.consultant, f.orgId);
  const started = await db.query<{ id: string }>(`select public.start_privacy_response($1, $2) as id`, [id, key("resp")]);
  const responseId = started.rows[0].id;
  await asServiceRole(db);
  const done = await db.query<{ ok: boolean }>(
    `select public.service_complete_privacy_response($1, $2, $3, 2048, 5, 7, $4, 1, '{"documents":0}'::jsonb, '[]'::jsonb) as ok`,
    [responseId, `${f.orgId}/privacy/${id}/${responseId}.zip`, sha(`zip-${responseId}`), sha(`manifest-${responseId}`)],
  );
  expect(done.rows[0].ok).toBe(true);
  await stale(f.consultant, f.orgId);
  await db.query(`select public.record_privacy_step($1, 'review', 'Package checked against the worklist')`, [id]);
  return responseId;
}

describe("legal time limits", () => {
  it("are entered from an official page and wait for a licensed member's approval", async () => {
    const f = await firm();
    await stale(f.manager, f.orgId);
    await expectDbError(
      () => db.query(`select public.propose_privacy_time_limit($1, 'response', 'Synthetic Act', 'Synthetic text', 30, 'https://example.com/law#s-1', 's. 1', $2::date, null, null)`, [f.orgId, firmDay()]),
      /official Government of Canada page/,
    );
    await expectDbError(
      () => db.query(`select public.propose_privacy_time_limit($1, 'response', 'Synthetic Act', 'Synthetic text', 30, $2, '', $3::date, null, null)`, [f.orgId, LAW, firmDay()]),
      /name the section/,
    );
    await stale(f.assistant, f.orgId);
    await expectDbError(
      () => db.query(`select public.propose_privacy_time_limit($1, 'response', 'Synthetic Act', 'Synthetic text', 30, $2, 's. 1', $3::date, null, null)`, [f.orgId, LAW, firmDay()]),
      /staff access denied/,
    );

    const id = await proposeLimit(f, "response", 30);
    await asMaintenance(db);
    const row = (await db.query<Record<string, unknown>>(`select status, snapshot_sha256, source_id, snapshot_id from public.privacy_time_limits where id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ status: "pending_review", snapshot_sha256: sha("page-response") });
    const snapshot = (await db.query<{ content_hash: string }>(`select content_hash from public.source_snapshots where id = $1`, [row.snapshot_id])).rows[0];
    expect(snapshot.content_hash).toBe(sha("page-response"));

    // Not a licensed member; then a licensed member without a fresh step-up.
    await fresh(f.manager, f.orgId);
    await expectDbError(() => db.query(`select public.review_privacy_time_limit($1, 1, 'approved', null, null)`, [id]), /staff access denied/);
    await stale(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.review_privacy_time_limit($1, 1, 'approved', null, null)`, [id]), /step-up is required/);
    await approveLimit(f, id);
    await asMaintenance(db);
    expect((await db.query<{ status: string }>(`select status from public.privacy_time_limits where id = $1`, [id])).rows[0].status).toBe("approved");
    // What was read never changes, and nothing is deleted.
    await expectDbError(() => db.query(`update public.privacy_time_limits set days = 45 where id = $1`, [id]), /change only through their functions|not edited/);

    // Without a page capture, approval needs the reviewer's attestation.
    const unread = await proposeLimit(f, "extension", 30, false);
    await fresh(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.review_privacy_time_limit($1, 1, 'approved', null, null)`, [unread]), /attestation/);
    await db.query(`select public.review_privacy_time_limit($1, 1, 'approved', null, $2::date)`, [unread, firmDay()]);
  });
});

describe("extension", () => {
  it("is the firm's own date without an approved legal limit, and told through the portal", async () => {
    const f = await firm();
    const id = await recordRequest(f);
    await stale(f.manager, f.orgId);
    await expectDbError(() => db.query(`select public.extend_privacy_request($1, $2::date, 'Large file', null, null, null)`, [id, firmDay(40)]), /privacy request access denied/);
    await stale(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.extend_privacy_request($1, $2::date, '', null, null, null)`, [id, firmDay(40)]), /reason for the extension/);
    await expectDbError(() => db.query(`select public.extend_privacy_request($1, $2::date, 'Large file', null, null, null)`, [id, firmDay(0)]), /after today/);
    await db.query(`select public.extend_privacy_request($1, $2::date, 'The file is large and needs consultations', null, 'Contact our privacy officer', null)`, [id, firmDay(40)]);
    expect(await request(id)).toMatchObject({ extension_basis: "firm", extension_notice_channel: "portal", extension_time_limit_id: null, extension_notice_seen_at: null });
    await stale(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.extend_privacy_request($1, $2::date, 'Again', null, null, null)`, [id, firmDay(50)]), /already extended/);

    // The client sees it in the portal; seeing it is recorded.
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    const mine = (await db.query<{ r: { reference: string; extension_basis: string; extension_reason: string }[] }>(`select public.privacy_requests_for_me($1) as r`, [f.orgId])).rows[0].r;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ reference: "PR-001", extension_basis: "firm", extension_reason: "The file is large and needs consultations" });
    expect((await db.query<{ n: number }>(`select public.mark_privacy_notices_seen($1) as n`, [f.orgId])).rows[0].n).toBe(1);
    expect((await request(id)).extension_notice_seen_at).not.toBeNull();

    // A person with no portal login: staff say how they told them.
    const offline = await recordRequest(f, "correction", f.offlinePersonId);
    await stale(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.extend_privacy_request($1, $2::date, 'Needs consultations', null, null, null)`, [offline, firmDay(30)]), /no portal login/);
    await db.query(`select public.extend_privacy_request($1, $2::date, 'Needs consultations', null, null, 'Letter posted to their address')`, [offline, firmDay(30)]);
    expect(await request(offline)).toMatchObject({ extension_notice_channel: "other", extension_notice_method: "Letter posted to their address" });
  });

  it("stays within an approved official limit", async () => {
    const f = await firm();
    const extension = await proposeLimit(f, "extension", 30);
    await approveLimit(f, extension);
    const id = await recordRequest(f);
    await stale(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.extend_privacy_request($1, $2::date, 'Consultations', $3, null, null)`, [id, firmDay(40), extension]), /official time to respond/);
    const response = await proposeLimit(f, "response", 30);
    await approveLimit(f, response);
    await stale(f.consultant, f.orgId);
    // Received two days ago: the limit is received + 30 + 30.
    await expectDbError(() => db.query(`select public.extend_privacy_request($1, $2::date, 'Consultations', $3, null, null)`, [id, firmDay(59), extension]), /later than the official extension/);
    const pending = await proposeLimit(f, "extension", 30);
    await stale(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.extend_privacy_request($1, $2::date, 'Consultations', $3, null, null)`, [id, firmDay(40), pending]), /approved official extension/);
    await db.query(`select public.extend_privacy_request($1, $2::date, 'Consultations with another office', $3, null, null)`, [id, firmDay(58), extension]);
    expect(await request(id)).toMatchObject({ extension_basis: "official", extension_time_limit_id: extension, extension_notice_late: false });
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    const mine = (await db.query<{ r: Record<string, unknown>[] }>(`select public.privacy_requests_for_me($1) as r`, [f.orgId])).rows[0].r;
    expect(mine[0]).toMatchObject({ extension_basis: "official", law_name: "Synthetic Privacy Act", source_section: "s. 1(1)", source_url: LAW });
  });
});

describe("scope search and redaction", () => {
  it("lists the person's records in this firm and records the redaction decisions on the worklist", async () => {
    const f = await firm();
    const id = await recordRequest(f);
    await stale(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.privacy_scope_search($1)`, [id]), /verify identity first/);
    await stale(f.assistant, f.orgId);
    await expectDbError(() => db.query(`select public.privacy_scope_search($1)`, [id]), /privacy request access denied/);
    const found = await searched(f, id);
    expect(found.counts).toMatchObject({ person: 1, matter: 1, consent: 1, audit: 1 });
    const row = await request(id);
    expect(row.scope_at).not.toBeNull();
    expect(String(row.scope_note)).toMatch(/Searched this firm's records in Casevoya/);
    // Re-running adds nothing new.
    await stale(f.consultant, f.orgId);
    const again = await db.query<{ r: { added: number } }>(`select public.privacy_scope_search($1) as r`, [id]);
    expect(again.rows[0].r.added).toBe(0);

    const list = await items(f, id);
    const person = list.find((item) => item.source === "person")!;
    const matter = list.find((item) => item.source === "matter")!;
    expect(person.fields).toContain("email");
    expect(person.fields).not.toContain("organization_id");
    await stale(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.decide_privacy_item($1, 'redact', $2, 'Someone', 'Their details')`, [person.id, ["not_a_field"]]), /choose the fields/);
    await expectDbError(() => db.query(`select public.decide_privacy_item($1, 'withhold', null, null, 'Their details')`, [matter.id]), /whose information/);
    await db.query(`select public.decide_privacy_item($1, 'withhold', null, 'Synthetic sponsor', 'About the sponsor only')`, [matter.id]);
    await db.query(`select public.decide_privacy_item($1, 'redact', $2, 'Synthetic spouse', 'Spouse contact details')`, [person.id, ["email"]]);
    await asMaintenance(db);
    const lines = (await db.query<{ item_id: string; state: string; removed: string }>(`select item_id, state::text, removed from public.privacy_request_redactions where request_id = $1 order by removed`, [id])).rows;
    expect(lines).toEqual([
      { item_id: person.id, state: "redacted", removed: "Fields withheld: email" },
      { item_id: matter.id, state: "redacted", removed: "Whole record withheld" },
    ]);
    // Back to include: the line stays, marked kept.
    await stale(f.consultant, f.orgId);
    await db.query(`select public.decide_privacy_item($1, 'include', null, null, null)`, [matter.id]);
    await asMaintenance(db);
    expect((await db.query<{ state: string }>(`select state::text from public.privacy_request_redactions where item_id = $1`, [matter.id])).rows[0].state).toBe("kept");
    await expectDbError(() => db.query(`delete from public.privacy_request_items where id = $1`, [matter.id]), /./);

    await stale(f.consultant, f.orgId);
    await db.query(`select public.record_privacy_step($1, 'redaction', 'Third-party details removed')`, [id]);
    await expectDbError(() => db.query(`select public.decide_privacy_item($1, 'withhold', null, 'X', 'Too late')`, [matter.id]), /worklist is closed/);
  });

  // 20261031020000 (DOC-3): other people's and staff-only documents start withheld, awaiting a decision.
  it("withholds other people's non-shared documents and staff-only documents until a reviewer decides", async () => {
    const f = await firm();
    await asMaintenance(db);
    const doc = async (personId: string, purpose: string, audience: string, sensitivity: string) => {
      const row = await db.query<{ id: string }>(
        `insert into public.documents (organization_id, person_id, purpose, audience, sensitivity)
         values ($1, $2, $3, $4::public.document_audience, $5::public.document_sensitivity) returning id`,
        [f.orgId, personId, purpose, audience, sensitivity],
      );
      await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id) values ($1, $2, $3)`, [f.orgId, row.rows[0].id, f.matterId]);
      return row.rows[0].id;
    };
    const ownMedical = await doc(f.personId, "Own medical exam", "subject", "medical");
    const ownStaff = await doc(f.personId, "Staff file note", "staff", "ordinary");
    const otherPrivate = await doc(f.offlinePersonId, "Sponsor tax return", "subject", "ordinary");
    const otherShared = await doc(f.offlinePersonId, "Sponsor letter", "matter", "ordinary");
    const otherSensitive = await doc(f.offlinePersonId, "Sponsor police certificate", "matter", "criminal");

    const id = await recordRequest(f);
    await searched(f, id);
    await asMaintenance(db);
    const rows = (
      await db.query<{ source_id: string; decision: string; third_party: string | null; decided_at: string | null }>(
        `select source_id, decision, third_party, decided_at from public.privacy_request_items where request_id = $1 and source = 'document'`,
        [id],
      )
    ).rows;
    const decision = (docId: string) => rows.find((row) => row.source_id === docId)?.decision;
    expect(decision(ownMedical)).toBe("include");
    expect(decision(otherShared)).toBe("include");
    expect(decision(ownStaff)).toBe("withhold");
    expect(decision(otherPrivate)).toBe("withhold");
    expect(decision(otherSensitive)).toBe("withhold");
    expect(rows.find((row) => row.source_id === otherPrivate)?.third_party).toBe("Synthetic offline person");
    expect(rows.every((row) => row.decided_at === null)).toBe(true);

    // Each default-withheld document is an open worklist line: the redaction step waits for a decision.
    const lines = await db.query<{ n: number }>(`select count(*)::int as n from public.privacy_request_redactions where request_id = $1 and state = 'to_do'`, [id]);
    expect(lines.rows[0].n).toBe(3);
    await stale(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.record_privacy_step($1, 'redaction', 'Done')`, [id]), /finish every line/);
    // Re-running the search adds no duplicate lines.
    await db.query(`select public.privacy_scope_search($1)`, [id]);
    await asMaintenance(db);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from public.privacy_request_redactions where request_id = $1`, [id])).rows[0].n).toBe(3);

    // A reviewer includes the staff note on purpose and confirms the other two stay withheld.
    await stale(f.consultant, f.orgId);
    const itemId = async (docId: string) =>
      (await db.query<{ id: string }>(`select id from public.privacy_request_items where request_id = $1 and source_id = $2`, [id, docId])).rows[0].id;
    await db.query(`select public.decide_privacy_item($1, 'include', null, null, null)`, [await itemId(ownStaff)]);
    await db.query(`select public.decide_privacy_item($1, 'withhold', null, 'Synthetic sponsor', 'About the sponsor only')`, [await itemId(otherPrivate)]);
    await db.query(`select public.decide_privacy_item($1, 'withhold', null, 'Synthetic sponsor', 'About the sponsor only')`, [await itemId(otherSensitive)]);
    await db.query(`select public.record_privacy_step($1, 'redaction', 'Third-party documents withheld')`, [id]);
  });
});

describe("response package and delivery", () => {
  it("builds after the redaction step, delivers after the review, and records every download", async () => {
    const f = await firm();
    const id = await recordRequest(f);
    await fresh(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.start_privacy_response($1, $2)`, [id, key()]), /verify identity first/);
    await searched(f, id);
    await fresh(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.start_privacy_response($1, $2)`, [id, key()]), /finish the redaction step first/);
    await stale(f.consultant, f.orgId);
    await db.query(`select public.record_privacy_step($1, 'redaction', 'Nothing to remove')`, [id]);
    await expectDbError(() => db.query(`select public.start_privacy_response($1, $2)`, [id, key()]), /step-up is required/);
    await fresh(f.consultant, f.orgId);
    const first = (await db.query<{ id: string }>(`select public.start_privacy_response($1, $2) as id`, [id, key()])).rows[0].id;
    await expectDbError(() => db.query(`select public.start_privacy_response($1, $2)`, [id, key()]), /already being built/);
    // Only the service role completes a package.
    await expectDbError(
      () => db.query(`select public.service_complete_privacy_response($1, 'x/privacy/y.zip', $2, 10, 1, 1, $2, 0, null, null)`, [first, sha("x")]),
      /permission denied/,
    );
    await asServiceRole(db);
    await db.query(`select public.service_fail_privacy_response($1, 'Synthetic failure')`, [first]);

    // Deliver needs the review and a ready package.
    const responseId = await readyPackageAfterRedaction(f, id);
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.privacy_request_responses set sha256 = $2 where id = $1`, [responseId, sha("other")]), /does not change/);

    await stale(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.deliver_privacy_response($1, $2, 'fulfilled', null)`, [id, responseId]), /step-up is required/);
    await fresh(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.deliver_privacy_response($1, $2, 'withdrawn', null)`, [id, responseId]), /choose an outcome/);
    const delivery = (await db.query<{ id: string }>(`select public.deliver_privacy_response($1, $2, 'partly_fulfilled', 'One record withheld for a third party') as id`, [id, responseId])).rows[0].id;
    const closed = await request(id);
    expect(closed).toMatchObject({ outcome: "partly_fulfilled", delivery_method: "Client portal download" });
    expect(String(closed.evidence_note)).toContain(sha(`zip-${responseId}`));

    // Someone else in the firm can't download it; the person can, and each download is recorded.
    await asUser(db, { userId: f.manager, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.authorize_privacy_response_download($1)`, [delivery]), /privacy response access denied/);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    const mine = (await db.query<{ r: Record<string, unknown>[] }>(`select public.privacy_requests_for_me($1) as r`, [f.orgId])).rows[0].r;
    expect(mine[0]).toMatchObject({ delivery_id: delivery, file_count: 5, download_count: 0 });
    // SEC-01: a high-risk download needs two-step on, then a check in the last 15 minutes.
    await expectDbError(() => db.query(`select public.authorize_privacy_response_download($1)`, [delivery]), /two-step sign-in is required/);
    await twoStepOn(f.client);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.authorize_privacy_response_download($1)`, [delivery]), /client step-up required/);
    await stale(f.client, f.orgId);
    await expectDbError(() => db.query(`select public.authorize_privacy_response_download($1)`, [delivery]), /client step-up required/);
    await fresh(f.client, f.orgId);
    const grant = (await db.query<{ g: Record<string, unknown> }>(`select public.authorize_privacy_response_download($1) as g`, [delivery])).rows[0].g;
    expect(grant).toMatchObject({ bucket: "matter-exports", seconds: 60, sha256: sha(`zip-${responseId}`) });
    await db.query(`select public.authorize_privacy_response_download($1)`, [delivery]);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    expect((await db.query(`select id from public.privacy_response_downloads`)).rows).toHaveLength(0);

    await stale(f.consultant, f.orgId);
    const proof = (await db.query<{ download_count: number; first_downloaded_at: string | null }>(`select download_count, first_downloaded_at from public.privacy_request_deliveries where id = $1`, [delivery])).rows[0];
    expect(proof.download_count).toBe(2);
    expect(proof.first_downloaded_at).not.toBeNull();
    const downloads = (await db.query<{ user_id: string; sha256: string }>(`select user_id, sha256 from public.privacy_response_downloads`)).rows;
    expect(downloads).toHaveLength(2);
    expect(downloads.every((row) => row.user_id === f.client && row.sha256 === sha(`zip-${responseId}`))).toBe(true);
    await asMaintenance(db);
    await expectDbError(() => db.query(`delete from public.privacy_response_downloads`), /append-only/);
    const audit = (await db.query<{ action: string }>(`select action from public.audit_log where organization_id = $1 and action like 'privacy.response_%' order by occurred_at`, [f.orgId])).rows.map((row) => row.action);
    expect(audit).toEqual(expect.arrayContaining(["privacy.response_started", "privacy.response_failed", "privacy.response_ready", "privacy.response_delivered", "privacy.response_downloaded"]));
  });
});

/** The redaction step is already recorded: build, complete and review. */
async function readyPackageAfterRedaction(f: Firm, id: string) {
  await fresh(f.consultant, f.orgId);
  const started = (await db.query<{ id: string }>(`select public.start_privacy_response($1, $2) as id`, [id, key("resp")])).rows[0].id;
  await asServiceRole(db);
  await db.query(`select public.service_complete_privacy_response($1, $2, $3, 2048, 5, 7, $4, 1, '{}'::jsonb, '[]'::jsonb)`, [
    started,
    `${f.orgId}/privacy/${id}/${started}.zip`,
    sha(`zip-${started}`),
    sha(`manifest-${started}`),
  ]);
  await fresh(f.consultant, f.orgId);
  await expectDbError(() => db.query(`select public.deliver_privacy_response($1, $2, 'fulfilled', null)`, [id, started]), /record the review first/);
  await stale(f.consultant, f.orgId);
  await db.query(`select public.record_privacy_step($1, 'review', 'Package checked')`, [id]);
  return started;
}

describe("firms and logins", () => {
  it("keeps requests across firms separate", async () => {
    const a = await firm();
    const b = await firm(a.client);
    const inA = await recordRequest(a);
    const inB = await recordRequest(b);
    const foundA = await searched(a, inA);
    const foundB = await searched(b, inB);
    expect(foundA.counts.matter).toBe(1);
    expect(foundB.counts.matter).toBe(1);

    // Firm B's staff never see firm A's request or what it found, and can't work it.
    await stale(b.consultant, b.orgId);
    expect((await db.query(`select id from public.privacy_requests where id = $1`, [inA])).rows).toHaveLength(0);
    expect((await db.query(`select id from public.privacy_request_items where request_id = $1`, [inA])).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.privacy_scope_search($1)`, [inA]), /privacy request access denied/);
    await expectDbError(() => db.query(`select public.extend_privacy_request($1, $2::date, 'Reason here', null, null, null)`, [inA, firmDay(40)]), /privacy request access denied/);
    // B's items are B's records only.
    const matterItems = (await db.query<{ source_id: string }>(`select source_id from public.privacy_request_items where request_id = $1 and source = 'matter'`, [inB])).rows;
    expect(matterItems.map((row) => row.source_id)).toEqual([b.matterId]);
    // An approved limit in firm A does nothing for firm B.
    const limit = await proposeLimit(a, "extension", 30);
    await approveLimit(a, limit);
    await stale(b.consultant, b.orgId);
    await expectDbError(() => db.query(`select public.extend_privacy_request($1, $2::date, 'Reason here', $3, null, null)`, [inB, firmDay(40), limit]), /approved official extension/);

    // The same person sees each firm's requests only in that firm.
    await stale(a.consultant, a.orgId);
    await db.query(`select public.extend_privacy_request($1, $2::date, 'Reason here', null, null, null)`, [inA, firmDay(40)]);
    await asUser(db, { userId: a.client, aal: "aal1", orgId: b.orgId });
    expect((await db.query<{ r: unknown[] }>(`select public.privacy_requests_for_me($1) as r`, [b.orgId])).rows[0].r).toEqual([]);
    await asUser(db, { userId: a.client, aal: "aal1", orgId: a.orgId });
    expect((await db.query<{ r: unknown[] }>(`select public.privacy_requests_for_me($1) as r`, [a.orgId])).rows[0].r).toHaveLength(1);
  });

  it("never erases the firm's record when the person's login is closed", async () => {
    const f = await firm();
    const id = await recordRequest(f);
    const responseId = await readyPackage(f, id);
    await fresh(f.consultant, f.orgId);
    const delivery = (await db.query<{ id: string }>(`select public.deliver_privacy_response($1, $2, 'fulfilled', null) as id`, [id, responseId])).rows[0].id;
    await twoStepOn(f.client);
    await fresh(f.client, f.orgId);
    await db.query(`select public.authorize_privacy_response_download($1)`, [delivery]);

    // The firm closes the login (membership revoked).
    await asMaintenance(db);
    await db.query(`update public.memberships set status = 'revoked', revoked_at = now() where id = $1`, [f.clientMembership]);
    await asUser(db, { userId: f.client, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.authorize_privacy_response_download($1)`, [delivery]), /privacy response access denied/);
    expect((await db.query<{ r: unknown[] }>(`select public.privacy_requests_for_me($1) as r`, [f.orgId])).rows[0].r).toEqual([]);

    // Everything the firm recorded is still there, readable by its staff.
    await stale(f.consultant, f.orgId);
    expect((await db.query(`select id from public.privacy_requests where id = $1 and closed_at is not null`, [id])).rows).toHaveLength(1);
    expect((await db.query(`select id from public.privacy_request_items where request_id = $1`, [id])).rows.length).toBeGreaterThan(0);
    expect((await db.query(`select id from public.privacy_request_responses where id = $1`, [responseId])).rows).toHaveLength(1);
    expect((await db.query(`select id from public.privacy_request_deliveries where id = $1 and download_count = 1`, [delivery])).rows).toHaveLength(1);
    expect((await db.query(`select id from public.privacy_response_downloads`)).rows).toHaveLength(1);
    expect((await db.query(`select id from public.persons where id = $1`, [f.personId])).rows).toHaveLength(1);
    expect((await db.query(`select id from public.matters where id = $1`, [f.matterId])).rows).toHaveLength(1);
    // And none of it can be deleted.
    await asMaintenance(db);
    await expectDbError(() => db.query(`delete from public.privacy_request_deliveries where id = $1`, [delivery]), /./);
    await expectDbError(() => db.query(`delete from public.privacy_requests where id = $1`, [id]), /./);
  });
});
