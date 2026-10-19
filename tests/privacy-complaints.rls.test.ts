import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/** Privacy requests (SEC-05, SEC-06) and the complaints register (ADM-05). Synthetic data only. */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

const key = (prefix = "k") => `${prefix}-${randomUUID()}`;
// Days in the firm's timezone (America/Toronto, the default), as the database counts them.
const day = (offset: number) => firmDay(offset);

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${id.slice(0, 8)}@example.test`]);
  return id;
}

async function member(orgId: string, userId: string, role: string, by: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, by],
  );
  return row.rows[0].id;
}

type Firm = Awaited<ReturnType<typeof firm>>;

/**
 * A firm with an owner, a case manager assigned to the client's matter, an unassigned case manager,
 * an assistant, and a client person with a granted marketing-style consent.
 */
async function firm() {
  const owner = await createUser("owner");
  const assigned = await createUser("cm-assigned");
  const unassigned = await createUser("cm-other");
  const assistant = await createUser("assistant");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${randomUUID().slice(0, 12).replaceAll("-", "")}`]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const ownerMembership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner])).rows[0].id;
  const assignedMembership = await member(orgId, assigned, "case_manager", owner);
  const unassignedMembership = await member(orgId, unassigned, "case_manager", owner);
  const assistantMembership = await member(orgId, assistant, "assistant", owner);
  await asMaintenance(db);
  const matterId = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Synthetic matter', true)`, [matterId, orgId]);
  const person = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample) values ($1, 'Synthetic client', true) returning id`, [orgId]);
  const other = await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample) values ($1, 'Other client', true) returning id`, [orgId]);
  const personId = person.rows[0].id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, personId]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [orgId, matterId, assignedMembership]);
  const consent = await db.query<{ id: string }>(
    `insert into public.consent_records (organization_id, person_id, purpose, statement_text, statement_sha256, granted)
     values ($1, $2, 'contact_sms', 'Text me reminders', repeat('a', 64), true) returning id`,
    [orgId, personId],
  );
  const otherConsent = await db.query<{ id: string }>(
    `insert into public.consent_records (organization_id, person_id, purpose, statement_text, statement_sha256, granted)
     values ($1, $2, 'contact_sms', 'Text me reminders', repeat('b', 64), true) returning id`,
    [orgId, other.rows[0].id],
  );
  return {
    owner, assigned, unassigned, assistant, orgId, matterId, personId, otherPersonId: other.rows[0].id,
    ownerMembership, assignedMembership, unassignedMembership, assistantMembership,
    consentId: consent.rows[0].id, otherConsentId: otherConsent.rows[0].id,
  };
}

async function as(f: Firm, userId: string, stepUp = true) {
  await asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: stepUp ? 0 : 20 * 60 });
}

async function recordRequest(f: Firm, userId: string, kind: string, options: { assignee?: string; personId?: string | null; matterId?: string | null } = {}) {
  await as(f, userId, false);
  const row = await db.query<{ id: string }>(
    `select public.record_privacy_request($1, $2, 'Synthetic requester', $3, $4, 'Wants a copy of their file', 'email', $5::date, $6, $7) as id`,
    [f.orgId, kind, options.personId === undefined ? f.personId : options.personId, options.matterId ?? null, day(-2), options.assignee ?? f.assignedMembership, key("pr")],
  );
  return row.rows[0].id;
}

async function request(id: string) {
  await asMaintenance(db);
  return (await db.query<Record<string, unknown>>(`select * from public.privacy_requests where id = $1`, [id])).rows[0];
}

async function visible(f: Firm, userId: string, table: string) {
  await as(f, userId, false);
  return (await db.query<{ id: string }>(`select id from public.${table}`)).rows.map((row) => row.id);
}

async function step(f: Firm, userId: string, id: string, name: string, note = "Checked by video call") {
  await as(f, userId, false);
  await db.query(`select public.record_privacy_step($1, $2, $3)`, [id, name, note]);
}

async function close(f: Firm, userId: string, id: string, outcome: string, extra: { refusal?: string; evidence?: string; consent?: string; stepUp?: boolean } = {}) {
  await as(f, userId, extra.stepUp ?? true);
  await db.query(`select public.close_privacy_request($1, $2, null, $3, $4, $5, $6)`, [id, outcome, extra.refusal ?? null, "Portal download", extra.evidence ?? null, extra.consent ?? null]);
}

describe("privacy requests", () => {
  it("numbers requests per firm and sets the due date only from the firm's own target", async () => {
    const f = await firm();
    const first = await recordRequest(f, f.owner, "access");
    expect(await request(first)).toMatchObject({ reference: "PR-001", target_days: null, due_on: null, is_sample: true, kind: "access" });

    await as(f, f.assigned);
    await expectDbError(() => db.query(`select public.set_compliance_settings($1, 21, null, null, null)`, [f.orgId]), /firm owner step-up/);
    await as(f, f.owner, false);
    await expectDbError(() => db.query(`select public.set_compliance_settings($1, 21, null, null, null)`, [f.orgId]), /firm owner step-up/);
    await as(f, f.owner);
    await db.query(`select public.set_compliance_settings($1, 21, null, null, null)`, [f.orgId]);

    const second = await recordRequest(f, f.assigned, "correction");
    const row = await request(second);
    expect(row).toMatchObject({ reference: "PR-002", target_days: 21 });
    expect(String(row.due_on instanceof Date ? row.due_on.toISOString().slice(0, 10) : row.due_on)).toBe(day(19));
  });

  it("shows a request to the owner, its assignee and staff who can read the person, never to other staff or firms", async () => {
    const f = await firm();
    const other = await firm();
    const id = await recordRequest(f, f.owner, "access");
    expect(await visible(f, f.owner, "privacy_requests")).toEqual([id]);
    expect(await visible(f, f.assigned, "privacy_requests")).toEqual([id]);
    expect(await visible(f, f.unassigned, "privacy_requests")).toEqual([]);
    expect(await visible(f, f.assistant, "privacy_requests")).toEqual([]);
    expect(await visible(other, other.owner, "privacy_requests")).toEqual([]);

    // Assigned to the unassigned case manager, who can't read the person: they still see it as its handler.
    const theirs = await recordRequest(f, f.owner, "correction", { assignee: f.unassignedMembership });
    expect(await visible(f, f.unassigned, "privacy_requests")).toEqual([theirs]);
    // Without aal2, nothing.
    await asUser(db, { userId: f.owner, aal: "aal1", orgId: f.orgId });
    expect((await db.query(`select id from public.privacy_requests`)).rows).toEqual([]);
  });

  it("refuses an assistant, a person the caller can't read, a forged firm and direct writes", async () => {
    const f = await firm();
    const other = await firm();
    await expectDbError(() => recordRequest(f, f.assistant, "access"), /access denied/);
    await expectDbError(() => recordRequest(f, f.unassigned, "access"), /access denied/);
    // Another firm's person, or this firm's request recorded while signed into the other firm.
    await expectDbError(() => recordRequest(f, f.owner, "access", { personId: other.personId }), /access denied/);
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: other.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.record_privacy_request($1, 'access', 'X', null, null, 'Wants a copy', 'email', $2::date, $3, $4)`, [f.orgId, day(0), f.ownerMembership, key()]),
      /access denied/,
    );
    const id = await recordRequest(f, f.owner, "access");
    await as(f, f.owner);
    await expectDbError(() => db.query(`update public.privacy_requests set outcome = 'fulfilled' where id = $1`, [id]), /permission denied/);
    await expectDbError(() => db.query(`delete from public.privacy_requests where id = $1`, [id]), /permission denied/);
    await expectDbError(
      () => db.query(`insert into public.privacy_requests (organization_id, number, reference, kind, requester_name, details, channel, received_on, assignee_membership_id, idempotency_key) values ($1, 99, 'PR-099', 'access', 'X', 'xxx', 'email', now()::date, $2, 'forged-key')`, [f.orgId, f.ownerMembership]),
      /permission denied/,
    );
    // The unassigned case manager can't work a request they can't read.
    await expectDbError(() => step(f, f.unassigned, id, "identity"), /access denied/);
  });

  it("records the steps in order and keeps the redaction worklist until every line is done", async () => {
    const f = await firm();
    const id = await recordRequest(f, f.owner, "access");
    await expectDbError(() => step(f, f.assigned, id, "scope", "41 records"), /verify identity first/);
    await step(f, f.assigned, id, "identity", "Two-step sign-in plus a video call");
    await expectDbError(() => step(f, f.assigned, id, "identity"), /already recorded/);
    await expectDbError(() => step(f, f.assigned, id, "review", "Looks right"), /scope search first/);
    await step(f, f.assigned, id, "scope", "41 records about the client");
    await as(f, f.assigned, false);
    const line = (await db.query<{ id: string }>(`select public.save_privacy_redaction($1, null, 'Intake p.4', 'Spouse', 'Address history', 'to_do') as id`, [id])).rows[0].id;
    await expectDbError(() => step(f, f.assigned, id, "review", "Looks right"), /redaction step first/);
    await expectDbError(() => step(f, f.assigned, id, "redaction", "All third-party details removed"), /finish every line/);
    await as(f, f.assigned, false);
    await db.query(`select public.save_privacy_redaction($1, $2, null, null, null, 'redacted')`, [id, line]);
    await step(f, f.assigned, id, "redaction", "All third-party details removed");
    await as(f, f.assigned, false);
    await expectDbError(() => db.query(`select public.save_privacy_redaction($1, null, 'More', 'Spouse', 'Phone', 'to_do')`, [id]), /worklist is closed/);
    expect(await visible(f, f.assigned, "privacy_request_redactions")).toEqual([line]);
    expect(await visible(f, f.unassigned, "privacy_request_redactions")).toEqual([]);

    await expectDbError(() => close(f, f.assigned, id, "fulfilled", { evidence: "Delivered" }), /verify identity and record the review first/);
    await step(f, f.assigned, id, "review", "Reviewed by the consultant");
    await expectDbError(() => close(f, f.assigned, id, "fulfilled", { evidence: "Delivered", stepUp: false }), /step-up is required/);
    await expectDbError(() => close(f, f.assigned, id, "fulfilled"), /record the evidence/);
    await close(f, f.assigned, id, "fulfilled", { evidence: "Portal download recorded 14:02" });
    expect(await request(id)).toMatchObject({ outcome: "fulfilled", closed_by: f.assigned, evidence_note: "Portal download recorded 14:02", delivery_method: "Portal download" });
    await expectDbError(() => step(f, f.assigned, id, "review"), /closed/);

    await asMaintenance(db);
    const audit = await db.query<{ action: string; context: Record<string, unknown> }>(`select action, context from public.audit_log where object_id = $1 order by occurred_at, id`, [id]);
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toContain("privacy.request_recorded");
    expect(actions).toContain("privacy.request_closed");
    expect(JSON.stringify(audit.rows)).not.toContain("Wants a copy of their file");
  });

  it("never deletes: a deletion request is refused with a reason by the owner, with the records kept noted", async () => {
    const f = await firm();
    const id = await recordRequest(f, f.owner, "deletion");
    await step(f, f.assigned, id, "identity");
    await expectDbError(() => close(f, f.assigned, id, "refused", { refusal: "Open matter" }), /firm owner step-up/);
    await expectDbError(() => close(f, f.owner, id, "fulfilled", { evidence: "Deleted" }), /never deleted here/);
    await expectDbError(() => close(f, f.owner, id, "refused"), /needs a reason/);
    await as(f, f.assigned, false);
    const kept = (await db.query<{ k: { reason: string; matter_id: string }[] }>(`select public.privacy_request_kept_records($1) as k`, [id])).rows[0].k;
    expect(kept).toEqual([expect.objectContaining({ matter_id: f.matterId, reason: "open" })]);
    await close(f, f.owner, id, "refused", { refusal: "The file is kept for the retention period after the matter closes." });
    const row = await request(id);
    expect(row).toMatchObject({ outcome: "refused", refusal_reason: "The file is kept for the retention period after the matter closes." });
    expect(row.kept_records).toEqual([expect.objectContaining({ matter_id: f.matterId, reason: "open" })]);
    await asMaintenance(db);
    expect((await db.query(`select id from public.persons where id = $1`, [f.personId])).rows).toHaveLength(1);
  });

  it("withdraws the chosen consent of the same person when a withdrawal is fulfilled", async () => {
    const f = await firm();
    const id = await recordRequest(f, f.owner, "consent_withdrawal");
    await step(f, f.owner, id, "identity");
    await step(f, f.owner, id, "scope", "Impact review: service messages continue");
    await step(f, f.owner, id, "review", "Reviewed");
    await expectDbError(() => close(f, f.owner, id, "fulfilled", { evidence: "Text reminders off", consent: f.otherConsentId }), /isn't this person's/);
    await close(f, f.owner, id, "fulfilled", { evidence: "Text reminders off", consent: f.consentId });
    await asMaintenance(db);
    const consent = await db.query<{ withdrawn_at: string | null }>(`select withdrawn_at from public.consent_records where id = $1`, [f.consentId]);
    expect(consent.rows[0].withdrawn_at).not.toBeNull();
    const untouched = await db.query<{ withdrawn_at: string | null }>(`select withdrawn_at from public.consent_records where id = $1`, [f.otherConsentId]);
    expect(untouched.rows[0].withdrawn_at).toBeNull();
    // Only a withdrawal request can withdraw a consent.
    const access = await recordRequest(f, f.owner, "access");
    await expectDbError(() => close(f, f.owner, access, "withdrawn", { consent: f.otherConsentId }), /only by a fulfilled withdrawal/);
  });
});

describe("complaints register", () => {
  async function recordComplaint(f: Firm, userId: string, assignee: string, options: { org?: string } = {}) {
    await as(f, userId, false);
    const row = await db.query<{ id: string }>(
      `select public.record_complaint($1, 'Synthetic complainant', $2, $3, 'fees_billing', 'email', 'Fees explained late', $4::date, $5, $6) as id`,
      [options.org ?? f.orgId, f.personId, f.matterId, day(-3), assignee, key("cp")],
    );
    return row.rows[0].id;
  }

  async function complaintStep(f: Firm, userId: string, id: string, name: string, on: string | null, note: string, stepUp = false) {
    await as(f, userId, stepUp);
    await db.query(`select public.record_complaint_step($1, $2, $3::date, $4)`, [id, name, on, note]);
  }

  it("is visible only to the owner and designated handlers, and only handlers can be assigned", async () => {
    const f = await firm();
    const other = await firm();
    await expectDbError(() => recordComplaint(f, f.assigned, f.assignedMembership), /complaints access denied/);
    await expectDbError(() => recordComplaint(f, f.owner, f.assignedMembership), /choose a complaint handler/);
    await as(f, f.owner, false);
    await expectDbError(() => db.query(`select public.set_complaint_handlers($1, $2::uuid[])`, [f.orgId, [f.assignedMembership]]), /firm owner step-up/);
    await as(f, f.owner);
    await expectDbError(() => db.query(`select public.set_complaint_handlers($1, $2::uuid[])`, [f.orgId, [other.assignedMembership]]), /active staff of this firm/);
    await db.query(`select public.set_complaint_handlers($1, $2::uuid[])`, [f.orgId, [f.assignedMembership]]);

    const id = await recordComplaint(f, f.assigned, f.assignedMembership);
    await asMaintenance(db);
    expect((await db.query(`select reference, ack_due_on, response_due_on, is_sample from public.complaints where id = $1`, [id])).rows[0]).toMatchObject({ reference: "CP-001", ack_due_on: null, response_due_on: null, is_sample: true });
    expect(await visible(f, f.owner, "complaints")).toEqual([id]);
    expect(await visible(f, f.assigned, "complaints")).toEqual([id]);
    expect(await visible(f, f.unassigned, "complaints")).toEqual([]);
    expect(await visible(f, f.assistant, "complaints")).toEqual([]);
    expect(await visible(other, other.owner, "complaints")).toEqual([]);
    // A forged firm: the handler of this firm signed into the other.
    await asUser(db, { userId: f.assigned, aal: "aal2", orgId: other.orgId, totpAgeSeconds: 0 });
    expect((await db.query(`select id from public.complaints`)).rows).toEqual([]);

    // Removing a handler takes their access away; the row is kept.
    await as(f, f.owner);
    await db.query(`select public.set_complaint_handlers($1, $2::uuid[])`, [f.orgId, []]);
    expect(await visible(f, f.assigned, "complaints")).toEqual([]);
    await asMaintenance(db);
    expect((await db.query<{ removed_at: string | null }>(`select removed_at from public.complaint_handlers where membership_id = $1`, [f.assignedMembership])).rows[0].removed_at).not.toBeNull();
  });

  it("copies the firm's targets and records the milestones in order, resolving after a step-up", async () => {
    const f = await firm();
    await as(f, f.owner);
    await db.query(`select public.set_compliance_settings($1, null, 2, 14, 'If you are not satisfied, write to the firm owner.')`, [f.orgId]);
    const id = await recordComplaint(f, f.owner, f.ownerMembership);
    await asMaintenance(db);
    const due = (await db.query<{ a: string; r: string }>(`select ack_due_on::text as a, response_due_on::text as r from public.complaints where id = $1`, [id])).rows[0];
    expect(due).toEqual({ a: day(-1), r: day(11) });

    await expectDbError(() => complaintStep(f, f.owner, id, "review", null, "Quote and emails"), /acknowledgement first/);
    await expectDbError(() => complaintStep(f, f.owner, id, "acknowledge", day(1), ""), /between the received date and today/);
    await complaintStep(f, f.owner, id, "acknowledge", day(-2), "");
    await complaintStep(f, f.owner, id, "review", null, "Quote Q-1, two emails, call note");
    await expectDbError(() => complaintStep(f, f.owner, id, "resolve", day(0), "Refunded", true), /response first/);
    await complaintStep(f, f.owner, id, "respond", day(0), "Letter explaining the fee schedule");
    await expectDbError(() => complaintStep(f, f.owner, id, "resolve", day(0), "Partial refund agreed"), /step-up is required/);
    await complaintStep(f, f.owner, id, "resolve", day(0), "Partial refund agreed", true);
    await asMaintenance(db);
    expect((await db.query(`select resolution, evidence_note from public.complaints where id = $1`, [id])).rows[0]).toEqual({ resolution: "Partial refund agreed", evidence_note: "Quote Q-1, two emails, call note" });
    await expectDbError(() => complaintStep(f, f.owner, id, "acknowledge", day(0), ""), /resolved/);
    await as(f, f.owner);
    await expectDbError(() => db.query(`delete from public.complaints where id = $1`, [id]), /permission denied/);
    // Settings: any staff member reads them; only the owner changes them.
    await as(f, f.assistant, false);
    expect((await db.query(`select complaint_escalation_text from public.compliance_settings`)).rows).toEqual([{ complaint_escalation_text: "If you are not satisfied, write to the firm owner." }]);
  });
});
