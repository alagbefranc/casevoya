import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * WhatsApp through Zernio (20261019230100_whatsapp_zernio.sql) against the real migrations:
 * tenant isolation, consent before any WhatsApp, owner-only connect and disconnect with step-up,
 * clients changing only their own choice, the outbound queue and worker, inbound filing and
 * triage, delivery status, and the 24-hour reply window.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().slice(0, 8);
const WORKER = "casevoya-whatsapp-test";

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  const email = `${label}-${tag()}@example.test`;
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, email]);
  return { id, email };
}

async function membership(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
    [orgId, userId, role],
  );
  return row.rows[0].id;
}

async function client(orgId: string, matterId: string, name: string, phone: string | null) {
  const user = await createUser("client");
  await membership(orgId, user.id, "client");
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, user_id, display_name, email, contact_phone) values ($1, $2, $3, $4, $5) returning id`,
    [orgId, user.id, name, user.email, phone],
  );
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, person.rows[0].id]);
  return { userId: user.id, email: user.email, personId: person.rows[0].id };
}

async function firm() {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner.id, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  const matter = await db.query<{ id: string }>(`insert into public.matters (organization_id, title) values ($1, 'Synthetic matter') returning id`, [orgId]);
  const matterId = matter.rows[0].id;
  const consultant = await createUser("consultant");
  const consultantMembership = await membership(orgId, consultant.id, "licensed_consultant");
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [
    orgId,
    matterId,
    consultantMembership,
  ]);
  const outsider = await createUser("outsider");
  await membership(orgId, outsider.id, "case_manager");
  const applicant = await client(orgId, matterId, "Synthetic Applicant", "+14315550100");
  const sponsor = await client(orgId, matterId, "Synthetic Sponsor", "+12045550199");
  return { orgId, matterId, owner: owner.id, consultant: consultant.id, outsider: outsider.id, applicant, sponsor };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const staff = (f: Firm, userId: string, totpAgeSeconds = 60) => asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds });
const asClient = (f: Firm, userId: string) => asUser(db, { userId, aal: "aal1", orgId: f.orgId });

let accountSeq = 0;
async function connect(f: Firm) {
  const account = `acct${++accountSeq}${tag()}`;
  // As the server action does: the owner's session passes step-up, then the service role writes.
  await staff(f, f.owner);
  await db.query(`select public.assert_firm_owner_step_up($1)`, [f.orgId]);
  await asServiceRole(db);
  await db.query(`select public.save_firm_zernio_profile($1, $2, $3)`, [f.orgId, `prof${tag()}`, f.owner]);
  await db.query(`select public.connect_firm_whatsapp($1, $2, '+1 431 555 0000', false, $3)`, [f.orgId, account, f.owner]);
  return account;
}

/** A client notice email as the mail worker queues it (one email_deliveries row). */
async function queueEmail(f: Firm, email: string, template: string, opts: { status?: string; critical?: boolean; context?: object } = {}) {
  await asMaintenance(db);
  const event = await db.query<{ id: string }>(
    `insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload) values ($1, 'test', gen_random_uuid(), 'document.request_created', '{}'::jsonb) returning id`,
    [f.orgId],
  );
  const row = await db.query<{ id: string }>(
    `insert into public.email_deliveries (organization_id, outbox_event_id, recipient_email, template, status, matter_id, critical, context)
     values ($1, $2, lower($3), $4::public.email_template, $5::public.email_delivery_status, $6, $7, $8::jsonb) returning id`,
    [f.orgId, event.rows[0].id, email, template, opts.status ?? "sending", f.matterId, opts.critical ?? false, JSON.stringify(opts.context ?? { firm: "Synthetic Firm" })],
  );
  return row.rows[0].id;
}

async function waEvents(f: Firm) {
  await asMaintenance(db);
  const rows = await db.query<{ event_type: string; payload: { person_id: string } }>(
    `select event_type, payload from public.outbox_events where organization_id = $1 and event_type like 'whatsapp.%' order by occurred_at`,
    [f.orgId],
  );
  return rows.rows;
}

/** Claims every due WhatsApp event (other tests' too) and returns what this firm's prepare. */
async function drain(f: Firm) {
  await asServiceRole(db);
  const claimed = await db.query<{ events: { id: string; organization_id: string }[] }>(`select public.claim_whatsapp_events($1, 50) as events`, [WORKER]);
  const out: Record<string, unknown>[] = [];
  for (const event of claimed.rows[0].events) {
    const prepared = await db.query<{ p: Record<string, unknown> }>(`select public.prepare_whatsapp_delivery($1, $2) as p`, [event.id, WORKER]);
    if (event.organization_id === f.orgId) out.push(prepared.rows[0].p);
  }
  return out;
}

describe("firm connection", () => {
  it("lets only the firm owner, with a recent step-up, connect and disconnect", async () => {
    const f = await firm();
    const profile = `prof${tag()}`;
    const acct = `acct${tag()}`;
    await staff(f, f.consultant);
    await expectDbError(() => db.query(`select public.assert_firm_owner_step_up($1)`, [f.orgId]), /step-up is required/);
    await expectDbError(() => db.query(`select public.save_firm_zernio_profile($1, 'prof1')`, [f.orgId]), /permission denied/);
    await expectDbError(() => db.query(`select public.connect_firm_whatsapp($1, 'acct1')`, [f.orgId]), /permission denied/);
    // The owner without a recent second factor is refused too.
    await staff(f, f.owner, 3600);
    await expectDbError(() => db.query(`select public.assert_firm_owner_step_up($1)`, [f.orgId]), /step-up is required/);
    await staff(f, f.owner);
    expect((await db.query<{ ok: boolean }>(`select public.assert_firm_owner_step_up($1) as ok`, [f.orgId])).rows[0].ok).toBe(true);
    // The server writes with the service role, naming the owner.
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.save_firm_zernio_profile($1, $2, $3)`, [f.orgId, profile, f.consultant]), /step-up is required/);
    await expectDbError(() => db.query(`select public.connect_firm_whatsapp($1, $2, null, false, $3)`, [f.orgId, acct, f.owner]), /start the WhatsApp connection/);
    await db.query(`select public.save_firm_zernio_profile($1, $2, $3)`, [f.orgId, profile, f.owner]);
    // The shared sandbox number is linked by the operator, never from the app.
    await expectDbError(() => db.query(`select public.connect_firm_whatsapp($1, $2, null, true, $3)`, [f.orgId, acct, f.owner]), /operator only/);
    await db.query(`select public.connect_firm_whatsapp($1, $2, '+1 431 555 0000', false, $3)`, [f.orgId, acct, f.owner]);
    await staff(f, f.consultant);
    const seen = await db.query<{ status: string }>(`select status from public.firm_whatsapp_accounts`);
    expect(seen.rows).toEqual([{ status: "connected" }]);
    await expectDbError(() => db.query(`select public.disconnect_firm_whatsapp($1)`, [f.orgId]), /step-up is required/);
    await expectDbError(() => db.query(`update public.firm_whatsapp_accounts set status = 'disconnected'`), /permission denied/);
    await staff(f, f.owner);
    const off = await db.query<{ r: { account_id: string; sandbox: boolean } }>(`select public.disconnect_firm_whatsapp($1) as r`, [f.orgId]);
    expect(off.rows[0].r).toEqual({ account_id: acct, sandbox: false });
    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log where organization_id = $1 and action like 'whatsapp.%' order by occurred_at`,
      [f.orgId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(["whatsapp.profile_saved", "whatsapp.connected", "whatsapp.disconnected"]);
  });

  it("keeps each firm's number, contacts and deliveries to itself", async () => {
    const a = await firm();
    const b = await firm();
    const account = await connect(a);
    await asClient(a, a.applicant.userId);
    await db.query(`select public.set_my_whatsapp_notices($1, 'both')`, [a.orgId]);
    await queueEmail(a, a.applicant.email, "document_request");
    // The same number cannot be connected to a second firm.
    await asServiceRole(db);
    await db.query(`select public.save_firm_zernio_profile($1, $2, $3)`, [b.orgId, `profB${tag()}`, b.owner]);
    await expectDbError(() => db.query(`select public.connect_firm_whatsapp($1, $2, null, false, $3)`, [b.orgId, account, b.owner]), /another firm/);
    await staff(b, b.owner);
    for (const table of ["firm_whatsapp_accounts", "person_whatsapp_contacts", "whatsapp_consent_events", "whatsapp_deliveries", "whatsapp_inbound_messages"]) {
      const rows = await db.query(`select 1 from public.${table} where organization_id = $1`, [a.orgId]);
      expect(rows.rows, table).toHaveLength(0);
    }
    // Firm B's owner cannot act on firm A either.
    await expectDbError(() => db.query(`select public.disconnect_firm_whatsapp($1)`, [a.orgId]), /step-up is required/);
    await expectDbError(() => db.query(`select public.set_person_whatsapp($1, $2, '+14315550100', 'both')`, [a.orgId, a.applicant.personId]), /staff access denied/);
    // Staff of firm A who are not on the matter don't see the client's contact.
    await staff(a, a.outsider);
    expect((await db.query(`select 1 from public.person_whatsapp_contacts`)).rows).toHaveLength(0);
    await staff(a, a.consultant);
    expect((await db.query(`select 1 from public.person_whatsapp_contacts`)).rows).toHaveLength(1);
  });
});

describe("consent", () => {
  it("lets a client change only their own choice, with the mobile number on their record", async () => {
    const f = await firm();
    await asClient(f, f.applicant.userId);
    const result = await db.query<{ r: { channel: string; consent: boolean } }>(`select public.set_my_whatsapp_notices($1, 'whatsapp') as r`, [f.orgId]);
    expect(result.rows[0].r).toEqual({ channel: "whatsapp", consent: true });
    const mine = await db.query<{ phone_e164: string; channel: string; consent_source: string; recorded: boolean }>(
      `select phone_e164, channel, consent_source, consent_recorded_by = $1 as recorded from public.person_whatsapp_contacts`,
      [f.applicant.userId],
    );
    expect(mine.rows).toEqual([{ phone_e164: "+14315550100", channel: "whatsapp", consent_source: "portal", recorded: true }]);
    // WhatsApp only turns routine email notices off.
    const pref = await db.query<{ email_notices: boolean }>(`select email_notices from public.person_contact_preferences where person_id = $1`, [f.applicant.personId]);
    expect(pref.rows).toEqual([{ email_notices: false }]);
    // Not someone else's record, not staff's function, and never a direct write.
    await expectDbError(() => db.query(`select public.set_person_whatsapp($1, $2, '+14315550100', 'both')`, [f.orgId, f.sponsor.personId]), /staff access denied/);
    await expectDbError(
      () => db.query(`update public.person_whatsapp_contacts set channel = 'both' where person_id = $1`, [f.applicant.personId]),
      /permission denied/,
    );
    await expectDbError(
      () => db.query(`insert into public.person_whatsapp_contacts (person_id, organization_id, phone_e164) values ($1, $2, '+14315550199')`, [f.sponsor.personId, f.orgId]),
      /permission denied/,
    );
    expect((await db.query(`select 1 from public.person_whatsapp_contacts where person_id = $1`, [f.sponsor.personId])).rows).toHaveLength(0);
    // Withdrawing keeps the history.
    await db.query(`select public.set_my_whatsapp_notices($1, 'email')`, [f.orgId]);
    const history = await db.query<{ action: string; source: string }>(`select action, source from public.whatsapp_consent_events order by recorded_at`);
    expect(history.rows).toEqual([
      { action: "given", source: "portal" },
      { action: "withdrawn", source: "portal" },
    ]);
    await expectDbError(() => db.query(`delete from public.whatsapp_consent_events`), /permission denied/);
  });

  it("refuses WhatsApp without a mobile number, and lets assigned staff record the client's choice", async () => {
    const f = await firm();
    const noPhone = await client(f.orgId, f.matterId, "Synthetic No Phone", null);
    await asClient(f, noPhone.userId);
    await expectDbError(() => db.query(`select public.set_my_whatsapp_notices($1, 'both')`, [f.orgId]), /mobile number/);
    await staff(f, f.outsider);
    await expectDbError(() => db.query(`select public.set_person_whatsapp($1, $2, '+14315550123', 'both')`, [f.orgId, noPhone.personId]), /preference denied/);
    await staff(f, f.consultant);
    await expectDbError(() => db.query(`select public.set_person_whatsapp($1, $2, '12', 'both')`, [f.orgId, noPhone.personId]), /mobile number/);
    await db.query(`select public.set_person_whatsapp($1, $2, '0044 20 7946 0958', 'both')`, [f.orgId, noPhone.personId]);
    const row = await db.query<{ phone_e164: string; consent_source: string }>(`select phone_e164, consent_source from public.person_whatsapp_contacts where person_id = $1`, [noPhone.personId]);
    expect(row.rows).toEqual([{ phone_e164: "+442079460958", consent_source: "staff" }]);
  });

  it("sends nothing on WhatsApp without live consent", async () => {
    const f = await firm();
    await connect(f);
    // A number on file but email chosen: no WhatsApp.
    await asClient(f, f.applicant.userId);
    await db.query(`select public.set_my_whatsapp_notices($1, 'email')`, [f.orgId]);
    await queueEmail(f, f.applicant.email, "document_request");
    expect(await waEvents(f)).toHaveLength(0);
    // Opted in: the notice is queued and prepared as the firm-name-only template.
    await asClient(f, f.applicant.userId);
    await db.query(`select public.set_my_whatsapp_notices($1, 'both')`, [f.orgId]);
    await queueEmail(f, f.applicant.email, "document_request", { context: { firm: "Synthetic Firm", due_on: "2030-01-01" } });
    expect((await waEvents(f)).map((row) => row.event_type)).toEqual(["whatsapp.notice_requested"]);
    // Withdrawn before the worker runs: prepared as skipped, nothing to send.
    await asClient(f, f.applicant.userId);
    await db.query(`select public.set_my_whatsapp_notices($1, 'email')`, [f.orgId]);
    const prepared = await drain(f);
    expect(prepared).toEqual([expect.objectContaining({ action: "done", reason: "no_consent" })]);
    await asMaintenance(db);
    const skipped = await db.query<{ status: string }>(`select status from public.whatsapp_deliveries where organization_id = $1`, [f.orgId]);
    expect(skipped.rows).toEqual([{ status: "skipped" }]);
  });

  it("does not queue staff copies, sample matters or a firm without a connected number", async () => {
    const f = await firm();
    await asClient(f, f.applicant.userId);
    await db.query(`select public.set_my_whatsapp_notices($1, 'both')`, [f.orgId]);
    await queueEmail(f, f.applicant.email, "invoice");
    expect(await waEvents(f)).toHaveLength(0);
    await connect(f);
    await queueEmail(f, f.applicant.email, "agreement", { context: { audience: "staff" } });
    await queueEmail(f, f.applicant.email, "invite");
    expect(await waEvents(f)).toHaveLength(0);
    await queueEmail(f, f.applicant.email, "invoice");
    expect(await waEvents(f)).toHaveLength(1);
  });
});

describe("outbound worker", () => {
  it("prepares a template carrying only the firm name, and records the outcome and delivery status", async () => {
    const f = await firm();
    const account = await connect(f);
    await asClient(f, f.applicant.userId);
    await db.query(`select public.set_my_whatsapp_notices($1, 'both')`, [f.orgId]);
    await queueEmail(f, f.applicant.email, "reminder", { context: { firm: "Synthetic Firm", reminder_kind: "immediate", due_on: "2030-01-01" } });
    const [prepared] = await drain(f);
    expect(prepared).toMatchObject({
      action: "send",
      account_id: account,
      to: "14315550100",
      kind: "template",
      template_name: "casevoya_portal_reminder",
      template_language: "en",
      firm_name: "Synthetic Firm",
      body: null,
    });
    // Nothing from the email's context reaches the WhatsApp send.
    expect(JSON.stringify(prepared)).not.toContain("2030-01-01");
    const deliveryId = prepared.delivery_id as string;
    await expectDbError(() => db.query(`select public.finish_whatsapp_delivery($1, 'someone-else', 'sent', 'wamid.X')`, [deliveryId]), /not claimed/);
    await db.query(`select public.finish_whatsapp_delivery($1, $2, 'sent', 'wamid.SYNTH1', 'conv1')`, [deliveryId, WORKER]);
    // Status only moves forward, and only for this firm's account.
    expect((await db.query<{ ok: boolean }>(`select public.record_whatsapp_status('other', 'wamid.SYNTH1', 'read') as ok`)).rows[0].ok).toBe(false);
    await db.query(`select public.record_whatsapp_status($1, 'wamid.SYNTH1', 'read')`, [account]);
    await db.query(`select public.record_whatsapp_status($1, 'wamid.SYNTH1', 'delivered')`, [account]);
    await db.query(`select public.record_whatsapp_status($1, 'wamid.SYNTH1', 'failed', null, 'late')`, [account]);
    await asMaintenance(db);
    const row = await db.query<{ status: string; delivered: boolean; read: boolean; event: string }>(
      `select d.status, d.delivered_at is not null as delivered, d.read_at is not null as read, e.status as event
       from public.whatsapp_deliveries d join public.outbox_events e on e.id = d.outbox_event_id where d.id = $1`,
      [deliveryId],
    );
    expect(row.rows).toEqual([{ status: "read", delivered: true, read: true, event: "published" }]);
    // Staff on the matter see the status; a client does not.
    await staff(f, f.consultant);
    expect((await db.query(`select status from public.whatsapp_deliveries`)).rows).toHaveLength(1);
    await asClient(f, f.applicant.userId);
    expect((await db.query(`select status from public.whatsapp_deliveries`)).rows).toHaveLength(0);
  });

  it("retries with the outbox backoff, and is closed to everyone but the worker", async () => {
    const f = await firm();
    await connect(f);
    await asClient(f, f.applicant.userId);
    await db.query(`select public.set_my_whatsapp_notices($1, 'both')`, [f.orgId]);
    await queueEmail(f, f.applicant.email, "invoice");
    const [prepared] = await drain(f);
    await db.query(`select public.finish_whatsapp_delivery($1, $2, 'retry', null, null, 'zernio 503')`, [prepared.delivery_id, WORKER]);
    await asMaintenance(db);
    const event = await db.query<{ status: string; later: boolean }>(
      `select e.status, e.available_at > clock_timestamp() as later from public.whatsapp_deliveries d join public.outbox_events e on e.id = d.outbox_event_id where d.id = $1`,
      [prepared.delivery_id],
    );
    expect(event.rows).toEqual([{ status: "failed", later: true }]);
    await staff(f, f.owner);
    await expectDbError(() => db.query(`select public.claim_whatsapp_events('x', 5)`), /permission denied|worker role/);
    await expectDbError(() => db.query(`select public.record_whatsapp_status('a', 'b', 'read')`), /permission denied|worker role/);
    await expectDbError(
      () => db.query(`select public.receive_whatsapp_message('a', 'e', 'm', 'c', '+14315550100', null, null, 'hi', false, null)`),
      /permission denied|worker role/,
    );
  });
});

describe("inbound", () => {
  it("files an opted-in client's message into their matter conversation, and opens the reply window", async () => {
    const f = await firm();
    const account = await connect(f);
    await asClient(f, f.applicant.userId);
    await db.query(`select public.set_my_whatsapp_notices($1, 'both')`, [f.orgId]);
    await asServiceRole(db);
    const receive = (event: string, message: string, phone: string, text: string) =>
      db.query<{ r: { action: string; reason?: string; thread_id?: string } }>(
        `select public.receive_whatsapp_message($1, $2, $3, 'conv-synth', $4, null, 'Synthetic', $5, false, now()) as r`,
        [account, event, message, phone, text],
      );
    const filed = (await receive("evt1", "wamid.IN1", "+14315550100", "Synthetic: is my file moving?")).rows[0].r;
    expect(filed.action).toBe("filed");
    expect((await receive("evt1", "wamid.IN1", "+14315550100", "again")).rows[0].r.action).toBe("duplicate");
    // An unknown number waits for triage with its text; a number not on WhatsApp consent too.
    expect((await receive("evt2", "wamid.IN2", "+15145550111", "Synthetic: who is this")).rows[0].r).toEqual({ action: "triage", reason: "no_match" });
    expect((await receive("evt3", "wamid.IN3", "+12045550199", "Synthetic: sponsor here")).rows[0].r).toEqual({ action: "triage", reason: "no_match" });
    // An account that is not a connected firm's is ignored.
    expect((await receive("evt4", "wamid.IN4", "+14315550100", "x")).rows[0].r.action).toBe("filed");
    const ignored = await db.query<{ r: { action: string } }>(
      `select public.receive_whatsapp_message('not-ours', 'evt5', 'wamid.IN5', null, '+14315550100', null, null, 'x', false, null) as r`,
    );
    expect(ignored.rows[0].r.action).toBe("ignored");

    // The client sees their own WhatsApp message in the portal; staff on the matter see it marked WhatsApp.
    await asClient(f, f.applicant.userId);
    const portal = await db.query<{ body: string; channel: string; mine: boolean }>(
      `select body, channel, author_user_id = $1 as mine from public.matter_messages order by created_at`,
      [f.applicant.userId],
    );
    expect(portal.rows[0]).toEqual({ body: "Synthetic: is my file moving?", channel: "whatsapp", mine: true });
    await staff(f, f.consultant);
    const triage = await db.query<{ body: string; triage_state: string }>(`select body, triage_state from public.whatsapp_inbound_messages order by received_at`);
    expect(triage.rows.map((row) => row.triage_state)).toEqual(["filed", "open", "open", "filed"]);
    expect(triage.rows[0].body).toBeNull();
    await staff(f, f.outsider);
    expect((await db.query(`select 1 from public.whatsapp_inbound_messages where triage_state = 'filed'`)).rows).toHaveLength(0);

    // Inside the window, a staff reply goes back as the staff member's text in that conversation.
    await staff(f, f.consultant);
    await db.query(`select public.send_matter_message($1, $2, $3, null, 'Synthetic: yes, all on track', false, null, null)`, [
      f.orgId,
      f.matterId,
      filed.thread_id,
    ]);
    expect((await waEvents(f)).map((row) => row.event_type)).toEqual(["whatsapp.reply_requested"]);
    const [reply] = await drain(f);
    expect(reply).toMatchObject({ action: "send", kind: "text", body: "Synthetic: yes, all on track", conversation_id: "conv-synth", template_name: null });

    // Outside the window, the reply is not sent as text: only the template notice (and the email) go.
    await asMaintenance(db);
    await db.query(`update public.whatsapp_inbound_messages set sent_at = now() - interval '2 days', received_at = now() - interval '2 days' where organization_id = $1`, [
      f.orgId,
    ]);
    await staff(f, f.consultant);
    await db.query(`select public.send_matter_message($1, $2, $3, null, 'Synthetic: a later note', false, null, null)`, [f.orgId, f.matterId, filed.thread_id]);
    expect(await waEvents(f)).toHaveLength(1);
    await queueEmail(f, f.applicant.email, "message");
    const kinds = (await waEvents(f)).map((row) => row.event_type);
    expect(kinds).toEqual(["whatsapp.reply_requested", "whatsapp.notice_requested"]);
  });
});
