import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// OPS-04 (20261025110100_ops_messaging.sql): firm message templates, announcements (audience,
// count, send, rate limit, sample mode, portal notice, EX19 mail) and external participants in a
// conversation only with portal access. Everything here is synthetic.

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function createUser(label: string, name: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${tag()}@example.test`]);
  await db.query(`insert into public.profiles (id, display_name) values ($1, $2) on conflict (id) do update set display_name = excluded.display_name`, [id, name]);
  return id;
}

async function membership(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  return (
    await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
      [orgId, userId, role],
    )
  ).rows[0].id;
}

async function person(orgId: string, name: string, userId: string | null, email: string | null, sample = false) {
  await asMaintenance(db);
  return (
    await db.query<{ id: string }>(`insert into public.persons (organization_id, user_id, display_name, email, is_sample) values ($1, $2, $3, $4, $5) returning id`, [orgId, userId, name, email, sample])
  ).rows[0].id;
}

async function pack(orgId: string, programKey: string) {
  await asMaintenance(db);
  await db.exec(`alter table public.rule_pack_versions disable trigger rule_pack_versions_guard`);
  const row = await db.query<{ id: string }>(
    `insert into public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version, status, content_frozen)
     values ($1, 'CA', $2, 1, 'published', true) returning id`,
    [orgId, programKey],
  );
  await db.exec(`alter table public.rule_pack_versions enable trigger rule_pack_versions_guard`);
  return row.rows[0].id;
}

async function setup({ sampleMode = false }: { sampleMode?: boolean } = {}) {
  const owner = await createUser("owner", "Synthetic Owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  const caseManager = await createUser("cm", "Casey Manager");
  await membership(orgId, caseManager, "case_manager");
  const clientUser = await createUser("client", "Pat Client");
  await membership(orgId, clientUser, "client");
  const sponsorUser = await createUser("sponsor", "Sam Sponsor");
  await membership(orgId, sponsorUser, "client");
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = $2 where id = $1`, [orgId, sampleMode]);
  const client = await person(orgId, "Pat Client", clientUser, "pat@example.test");
  const sponsor = await person(orgId, "Sam Sponsor", sponsorUser, null);
  const employer = await person(orgId, "Erin Employer", null, "erin@example.test");
  const study = await pack(orgId, "study_permit");
  const matter = randomUUID();
  const closed = randomUUID();
  const sample = randomUUID();
  await asMaintenance(db);
  await db.query(`insert into public.matters (id, organization_id, title, program_pack_id) values ($1, $2, 'Study permit', $3)`, [matter, orgId, study]);
  await db.query(`insert into public.matters (id, organization_id, title) values ($1, $2, 'Old file')`, [closed, orgId]);
  await db.exec(`set session_replication_role = replica`);
  await db.query(`update public.matters set stage = 'closed' where id = $1`, [closed]);
  await db.exec(`set session_replication_role = origin`);
  await db.query(`insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Sample file', true)`, [sample, orgId]);
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor'), ($1, $2, $5, 'employer')`,
    [orgId, matter, client, sponsor, employer],
  );
  const closedPerson = await person(orgId, "Chris Closed", await createUser("closed", "Chris Closed"), "chris@example.test");
  const samplePerson = await person(orgId, "Sky Sample", await createUser("samplep", "Sky Sample"), "sky@example.test", true);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $4, $5, 'applicant')`, [
    orgId,
    closed,
    closedPerson,
    sample,
    samplePerson,
  ]);
  return { owner, orgId, caseManager, clientUser, sponsorUser, client, sponsor, employer, matter, samplePerson };
}

const staff = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });

async function saveTemplate(orgId: string, useFor: string, name: string, title: string | null, body: string) {
  return (
    await db.query<{ r: { id: string; version: number } }>(`select public.save_message_template($1, null, $2, $3, $4, $5) as r`, [orgId, useFor, name, title, body])
  ).rows[0].r;
}

async function approvedAnnouncement(ctx: Awaited<ReturnType<typeof setup>>) {
  await staff(ctx.owner, ctx.orgId);
  const tpl = await saveTemplate(ctx.orgId, "announcement", "Holiday closure", "Office closed 11 Nov", "{firm_name} is closed on 11 November.");
  await db.query(`select public.approve_message_template($1, $2, $3)`, [ctx.orgId, tpl.id, tpl.version]);
  return tpl;
}

describe("message templates", () => {
  it("staff save drafts; only an owner or licensed consultant approves; an edit makes it a draft again", async () => {
    const ctx = await setup();
    await staff(ctx.caseManager, ctx.orgId);
    const tpl = await saveTemplate(ctx.orgId, "message", "Document reminder", null, "Hi {client_first_name}, please upload the passport for {matter_reference}.");
    expect(tpl.version).toBe(1);
    await expectDbError(() => db.query(`select public.approve_message_template($1, $2, 1)`, [ctx.orgId, tpl.id]), /denied/);
    await staff(ctx.owner, ctx.orgId);
    await db.query(`select public.approve_message_template($1, $2, 1)`, [ctx.orgId, tpl.id]);
    const approved = (await db.query<{ status: string }>(`select status from public.message_templates where id = $1`, [tpl.id])).rows[0];
    expect(approved.status).toBe("approved");
    const again = (await db.query<{ r: { version: number; status: string } }>(`select public.save_message_template($1, $2, 'message', 'Document reminder', null, 'Hello {client_first_name}', 1) as r`, [ctx.orgId, tpl.id])).rows[0].r;
    expect(again).toMatchObject({ version: 2, status: "draft" });
    await expectDbError(() => db.query(`select public.approve_message_template($1, $2, 1)`, [ctx.orgId, tpl.id]), /changed/);
    const audit = await db.query<{ action: string; context: Record<string, unknown> }>(`select action, context from public.audit_log where object_id = $1 order by occurred_at`, [tpl.id]);
    expect(audit.rows.map((row) => row.action)).toEqual(["message_template.saved", "message_template.approved", "message_template.saved"]);
    expect(JSON.stringify(audit.rows)).not.toMatch(/passport/);
  });

  it("refuses unknown merge fields, and an announcement may merge the firm name only", async () => {
    const ctx = await setup();
    await staff(ctx.owner, ctx.orgId);
    await expectDbError(() => saveTemplate(ctx.orgId, "message", "Bad", null, "Your fee is {fee_amount}"), /merge field/);
    await expectDbError(() => saveTemplate(ctx.orgId, "announcement", "Bad", "Hello", "Dear {client_first_name}"), /merge field/);
    await expectDbError(() => saveTemplate(ctx.orgId, "announcement", "No title", null, "Closed"), /title/);
  });

  it("clients, other firms and anonymous callers can't read or write templates", async () => {
    const ctx = await setup();
    await staff(ctx.owner, ctx.orgId);
    await saveTemplate(ctx.orgId, "message", "Hello", null, "Hello {client_first_name}");
    await asUser(db, { userId: ctx.clientUser, aal: "aal1", orgId: ctx.orgId });
    expect((await db.query(`select id from public.message_templates`)).rows).toEqual([]);
    await expectDbError(() => saveTemplate(ctx.orgId, "message", "Mine", null, "Hi"), /denied/);
    const other = await setup();
    await staff(other.owner, other.orgId);
    expect((await db.query(`select id from public.message_templates where organization_id = $1`, [ctx.orgId])).rows).toEqual([]);
    await expectDbError(() => saveTemplate(ctx.orgId, "message", "Forged", null, "Hi"), /denied/);
    await asAnon(db);
    await expectDbError(() => db.query(`select * from public.message_templates`), /permission denied/);
  });
});

describe("announcements", () => {
  it("previews the audience: open, non-sample matters, portal accounts only; by program", async () => {
    const ctx = await setup();
    await staff(ctx.caseManager, ctx.orgId);
    const audiences = (await db.query<{ a: { all: Record<string, number>; programs: Record<string, unknown>[] } }>(`select public.announcement_audiences($1) as a`, [ctx.orgId])).rows[0].a;
    // Pat (email) and Sam (no email) have portal accounts; Erin has none; closed and sample matters are out.
    expect(audiences.all).toEqual({ recipients: 2, emailed: 1, without_portal: 1 });
    expect(audiences.programs).toEqual([{ program_key: "study_permit", recipients: 2, emailed: 1, without_portal: 1 }]);
    await asUser(db, { userId: ctx.clientUser, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.announcement_audiences($1)`, [ctx.orgId]), /denied/);
  });

  it("an owner sends: portal notice for each client, one EX19 event, audited; a case manager can't", async () => {
    const ctx = await setup();
    const tpl = await approvedAnnouncement(ctx);
    await staff(ctx.caseManager, ctx.orgId);
    await expectDbError(() => db.query(`select public.send_announcement($1, $2, $3, null)`, [ctx.orgId, tpl.id, tpl.version]), /denied/);
    await staff(ctx.owner, ctx.orgId);
    const sent = (await db.query<{ r: Record<string, unknown> }>(`select public.send_announcement($1, $2, $3, null) as r`, [ctx.orgId, tpl.id, tpl.version])).rows[0].r;
    expect(sent).toMatchObject({ recipients: 2, emailed: 1 });
    const card = (await db.query<{ title: string; body: string }>(`select title, body from public.announcements where id = $1`, [sent.announcement_id])).rows[0];
    expect(card).toEqual({ title: "Office closed 11 Nov", body: "Synthetic Firm is closed on 11 November." });
    await asMaintenance(db);
    const events = await db.query(`select id from public.outbox_events where event_type = 'announcement.sent' and aggregate_id = $1`, [sent.announcement_id]);
    expect(events.rows).toHaveLength(1);
    const audit = await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where action = 'announcement.sent' and object_id = $1`, [sent.announcement_id]);
    expect(audit.rows[0].context).toMatchObject({ recipients: 2, emailed: 1, audience: "all" });
    await expectDbError(() => db.query(`update public.announcements set title = 'x' where id = $1`, [sent.announcement_id]), /append-only/);

    // The client sees it on Home with their other notices, and can dismiss it.
    await asUser(db, { userId: ctx.clientUser, aal: "aal1", orgId: ctx.orgId });
    expect((await db.query(`select id from public.announcement_deliveries`)).rows).toEqual([]);
    expect((await db.query(`select id from public.announcements`)).rows).toEqual([]);
    const notices = (await db.query<{ n: { id: string; kind: string; title: string; body: string }[] }>(`select public.portal_notices_for_me($1) as n`, [ctx.orgId])).rows[0].n;
    expect(notices).toEqual([expect.objectContaining({ kind: "announcement", title: "Office closed 11 Nov", body: "Synthetic Firm is closed on 11 November." })]);
    expect((await db.query<{ n: number }>(`select public.mark_portal_announcements_seen($1) as n`, [ctx.orgId])).rows[0].n).toBe(1);
    await db.query(`select public.dismiss_portal_notice($1)`, [notices[0].id]);
    expect((await db.query<{ n: unknown[] }>(`select public.portal_notices_for_me($1) as n`, [ctx.orgId])).rows[0].n).toEqual([]);
    // Someone else's delivery can't be dismissed.
    await asUser(db, { userId: ctx.sponsorUser, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.dismiss_portal_notice($1)`, [notices[0].id]), /not found/);

    // Staff see who read it.
    await staff(ctx.caseManager, ctx.orgId);
    const seen = await db.query<{ seen: number }>(`select count(*)::int as seen from public.announcement_deliveries where announcement_id = $1 and seen_at is not null`, [sent.announcement_id]);
    expect(seen.rows[0].seen).toBe(1);
  });

  it("the mail worker sends EX19 to emailed clients with nothing but the firm name", async () => {
    const ctx = await setup();
    const tpl = await approvedAnnouncement(ctx);
    await staff(ctx.owner, ctx.orgId);
    const sent = (await db.query<{ r: { announcement_id: string } }>(`select public.send_announcement($1, $2, $3, null) as r`, [ctx.orgId, tpl.id, tpl.version])).rows[0].r;
    await asServiceRole(db);
    const claimed = (await db.query<{ c: { id: string; event_type: string; payload: Record<string, unknown> }[] }>(`select public.claim_mail_events('test-worker', 50) as c`)).rows[0].c.filter(
      (row) => row.event_type === "announcement.sent" && row.payload.announcement_id === sent.announcement_id,
    );
    expect(claimed).toHaveLength(1);
    const prepared = (await db.query<{ p: { action: string; messages: { to: string; template: string; context: Record<string, unknown> }[] } }>(`select public.prepare_email_delivery($1, 'test-worker') as p`, [claimed[0].id])).rows[0].p;
    expect(prepared.action).toBe("send");
    expect(prepared.messages.map((message) => [message.to, message.template])).toEqual([["pat@example.test", "announcement"]]);
    expect(JSON.stringify(prepared.messages[0].context)).not.toMatch(/closed|November/i);
  });

  it("is rate-limited to one send per firm every 10 minutes, and the refusal is audited", async () => {
    const ctx = await setup();
    const tpl = await approvedAnnouncement(ctx);
    await staff(ctx.owner, ctx.orgId);
    await db.query(`select public.send_announcement($1, $2, $3, 'study_permit')`, [ctx.orgId, tpl.id, tpl.version]);
    const second = (await db.query<{ r: Record<string, unknown> }>(`select public.send_announcement($1, $2, $3, null) as r`, [ctx.orgId, tpl.id, tpl.version])).rows[0].r;
    expect(second.rate_limited).toBe(true);
    await asMaintenance(db);
    expect((await db.query(`select id from public.announcements where organization_id = $1`, [ctx.orgId])).rows).toHaveLength(1);
    expect((await db.query(`select id from public.audit_log where action = 'announcement.rate_limited' and organization_id = $1`, [ctx.orgId])).rows).toHaveLength(1);
  });

  it("refuses drafts, message templates, unknown programs and other firms' templates", async () => {
    const ctx = await setup();
    await staff(ctx.owner, ctx.orgId);
    const draft = await saveTemplate(ctx.orgId, "announcement", "Draft", "Draft", "Not approved");
    await expectDbError(() => db.query(`select public.send_announcement($1, $2, 1, null)`, [ctx.orgId, draft.id]), /approved announcement/);
    const tpl = await approvedAnnouncement(ctx);
    await staff(ctx.owner, ctx.orgId);
    await expectDbError(() => db.query(`select public.send_announcement($1, $2, $3, 'no_such_program')`, [ctx.orgId, tpl.id, tpl.version]), /portal account/);
    const other = await setup();
    await staff(other.owner, other.orgId);
    await expectDbError(() => db.query(`select public.send_announcement($1, $2, $3, null)`, [other.orgId, tpl.id, tpl.version]), /approved announcement/);
  });

  it("a sample-mode firm reaches sample clients only and emails no one", async () => {
    const ctx = await setup({ sampleMode: true });
    const tpl = await approvedAnnouncement(ctx);
    await staff(ctx.owner, ctx.orgId);
    const sent = (await db.query<{ r: { announcement_id: string; recipients: number; emailed: number } }>(`select public.send_announcement($1, $2, $3, null) as r`, [ctx.orgId, tpl.id, tpl.version])).rows[0].r;
    expect(sent).toMatchObject({ recipients: 1, emailed: 0 });
    await asMaintenance(db);
    const people = await db.query<{ person_id: string }>(`select person_id from public.announcement_deliveries where announcement_id = $1`, [sent.announcement_id]);
    expect(people.rows.map((row) => row.person_id)).toEqual([ctx.samplePerson]);
    expect((await db.query(`select id from public.outbox_events where aggregate_id = $1`, [sent.announcement_id])).rows).toEqual([]);
  });
});

describe("external participants", () => {
  async function send(ctx: Awaited<ReturnType<typeof setup>>, people: string[]) {
    return (
      await db.query<{ result: { thread_id: string } }>(`select public.send_matter_message($1, $2, null, $3::uuid[], 'Synthetic message', false, null, null) as result`, [
        ctx.orgId,
        ctx.matter,
        people,
      ])
    ).rows[0].result;
  }

  it("an employer without portal access can't be added; a sponsor with portal access can", async () => {
    const ctx = await setup();
    await staff(ctx.owner, ctx.orgId);
    await expectDbError(() => send(ctx, [ctx.client, ctx.employer]), /portal access/);
    const thread = await send(ctx, [ctx.sponsor]);
    expect(thread.thread_id).toBeTruthy();
  });

  it("an external participant reads only their own conversations, never staff notes", async () => {
    const ctx = await setup();
    await staff(ctx.owner, ctx.orgId);
    const theirs = await send(ctx, [ctx.sponsor]);
    const applicantOnly = await send(ctx, [ctx.client]);
    await db.query(`select public.add_matter_staff_note($1, $2, 'Staff-only synthetic note')`, [ctx.orgId, ctx.matter]);
    await asUser(db, { userId: ctx.sponsorUser, aal: "aal1", orgId: ctx.orgId });
    const threads = await db.query<{ id: string }>(`select id from public.message_threads`);
    expect(threads.rows.map((row) => row.id)).toEqual([theirs.thread_id]);
    expect((await db.query(`select id from public.matter_messages where thread_id = $1`, [applicantOnly.thread_id])).rows).toEqual([]);
    expect((await db.query(`select id from public.matter_staff_notes`)).rows).toEqual([]);
  });
});
