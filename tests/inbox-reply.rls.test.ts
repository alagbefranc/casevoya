import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Inbox replies and compose (PRD OPS-04, OPS-06) against the real migrations: staff email a
 * person on a matter they can read, at that person's stored address only; the email is recorded
 * (forced RLS, staff on the matter), audited without its text, queued through the outbox, and
 * prepared with the platform sender, the matter reply address and threading headers. A sample
 * matter's email is never sent.
 */
let db: TestDb;

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

/** A person on the matter (or not), with or without an email address and a portal login. */
async function person(orgId: string, args: { matterId?: string; role?: string; name: string; email?: string | null; login?: boolean; sample?: boolean }) {
  const user = args.login ? await createUser("client") : null;
  if (user) await membership(orgId, user.id, "client");
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, user_id, display_name, email, is_sample) values ($1, $2, $3, $4, $5) returning id`,
    [orgId, user?.id ?? null, args.name, args.email === undefined ? `${args.name.toLowerCase().replace(/\W+/g, "-")}-${tag()}@example.test` : args.email, args.sample ?? false],
  );
  if (args.matterId) {
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, $4::public.matter_party_role)`, [
      orgId,
      args.matterId,
      row.rows[0].id,
      args.role ?? "applicant",
    ]);
  }
  const email = (await db.query<{ email: string | null }>(`select email from public.persons where id = $1`, [row.rows[0].id])).rows[0].email;
  return { id: row.rows[0].id, userId: user?.id ?? null, email };
}

/** A firm out of sample mode with one real matter, staff on and off it, and its people. */
async function firm(options: { sample?: boolean } = {}) {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner.id, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const sample = options.sample ?? false;
  await db.query(`update public.organizations set sample_mode = $2 where id = $1`, [orgId, sample]);
  const matter = await db.query<{ id: string }>(
    `insert into public.matters (organization_id, title, is_sample, sample_label) values ($1, 'Synthetic matter', $2, $3) returning id`,
    [orgId, sample, sample ? "Fictional sample. Not a client record." : null],
  );
  const matterId = matter.rows[0].id;
  const consultant = await createUser("consultant");
  const consultantMembership = await membership(orgId, consultant.id, "licensed_consultant");
  await asMaintenance(db);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [
    orgId,
    matterId,
    consultantMembership,
  ]);
  await db.query(`update public.profiles set display_name = 'Sam Consultant' where id = $1`, [consultant.id]);
  const outsider = await createUser("other");
  await membership(orgId, outsider.id, "case_manager");
  const finance = await createUser("finance");
  await membership(orgId, finance.id, "finance_user");
  const applicant = await person(orgId, { matterId, role: "applicant", name: "Synthetic Applicant", login: true, sample });
  const sponsor = await person(orgId, { matterId, role: "sponsor", name: "Synthetic Sponsor", email: null, sample });
  const stranger = await person(orgId, { name: "Synthetic Stranger", sample });
  return { orgId, matterId, owner: owner.id, consultant: consultant.id, outsider: outsider.id, finance: finance.id, applicant, sponsor, stranger };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const staff = (f: Firm, userId: string) => asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 60 });

async function send(
  f: Firm,
  args: { org?: string; matter?: string; person: string; body?: string; reply?: string | null; key?: string | null },
) {
  const row = await db.query<{ result: { email_id: string; sample: boolean; replayed: boolean } }>(
    `select public.send_matter_email($1, $2, $3, $4, $5, $6) as result`,
    [args.org ?? f.orgId, args.matter ?? f.matterId, args.person, args.body ?? "Synthetic: please send the photos.", args.reply ?? null, args.key ?? null],
  );
  return row.rows[0].result;
}

/** A client email already filed to a person on the matter, with a well-formed Message-ID. */
async function filedEmail(f: Firm, personId: string, subject = "Re: Re: Photos for the file") {
  await asMaintenance(db);
  const messageId = `<m-${randomUUID()}@mail.example.test>`;
  const row = await db.query<{ id: string }>(
    `insert into public.inbound_emails (organization_id, message_id, from_email, to_email, subject, text_body, body_location, matter_id, person_id, attachments_done, triage_state)
     values ($1, $2, 'client@example.test', 'firm@docs.casevoya.ca', $3, 'Synthetic question', 'inbound_emails', $4, $5, true, 'filed') returning id`,
    [f.orgId, messageId, subject, f.matterId, personId],
  );
  return { id: row.rows[0].id, messageId };
}

type Prepared = {
  action: string;
  messages: {
    to: string;
    from_address: string;
    from_name: string;
    reply_to_address: string;
    template: string;
    context: Record<string, unknown>;
    body?: string;
    subject?: string | null;
    headers?: Record<string, string>;
  }[];
};

/** The mail worker's claim and prepare for one sent email, as the service role. */
async function prepare(emailId: string): Promise<Prepared> {
  await asMaintenance(db);
  const event = (await db.query<{ outbox_event_id: string }>(`select outbox_event_id from public.matter_outbound_emails where id = $1`, [emailId])).rows[0].outbox_event_id;
  await asServiceRole(db);
  const worker = `ib-${tag()}`;
  const claimed = await db.query<{ events: { id: string }[] }>(`select public.claim_mail_events($1, 50) as events`, [worker]);
  expect(claimed.rows[0].events.map((row) => row.id)).toContain(event);
  const prepared = await db.query<{ result: Prepared }>(`select public.prepare_email_delivery($1, $2, null, null) as result`, [event, worker]);
  return prepared.rows[0].result;
}

describe("Inbox replies: who may send, and to whom", () => {
  it("lets staff on the matter email a person on it, and shows the email only to staff on the matter", async () => {
    const f = await firm();
    await staff(f, f.consultant);
    const sent = await send(f, { person: f.applicant.id, body: "Synthetic: secret detail\n\nSecond paragraph." });
    expect(sent).toMatchObject({ sample: false, replayed: false });

    const visible = async () => (await db.query<{ id: string }>(`select id from public.matter_outbound_emails`)).rows.map((row) => row.id);
    expect(await visible()).toEqual([sent.email_id]);
    await staff(f, f.owner);
    expect(await visible()).toEqual([sent.email_id]);
    await staff(f, f.outsider);
    expect(await visible()).toEqual([]);
    await staff(f, f.finance);
    expect(await visible()).toEqual([]);
    await asUser(db, { userId: f.applicant.userId!, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 60 });
    expect(await visible()).toEqual([]);
    await asUser(db, { userId: f.consultant, aal: "aal1", orgId: f.orgId });
    expect(await visible()).toEqual([]);

    await asMaintenance(db);
    const row = await db.query<{ recipient_email: string; author_name: string; body: string; subject: string | null }>(
      `select recipient_email, author_name, body, subject from public.matter_outbound_emails where id = $1`,
      [sent.email_id],
    );
    expect(row.rows[0]).toEqual({ recipient_email: f.applicant.email, author_name: "Sam Consultant", body: "Synthetic: secret detail\n\nSecond paragraph.", subject: null });
    const audit = await db.query<{ action: string; diff: Record<string, unknown>; context: Record<string, unknown> }>(
      `select action, diff, context from public.audit_log where organization_id = $1 and action = 'email.staff_sent'`,
      [f.orgId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0])).not.toContain("secret");
    const event = await db.query<{ payload: Record<string, unknown> }>(`select payload from public.outbox_events where event_type = 'matter_email.sent' and aggregate_id = $1`, [
      sent.email_id,
    ]);
    expect(Object.keys(event.rows[0].payload).sort()).toEqual(["email_id", "matter_id"]);
  });

  it("refuses staff without access to the matter, finance users, clients, and other firms", async () => {
    const f = await firm();
    const other = await firm();
    await staff(f, f.outsider);
    await expectDbError(() => send(f, { person: f.applicant.id }), /email denied/);
    await staff(f, f.finance);
    await expectDbError(() => send(f, { person: f.applicant.id }), /email denied/);
    await asUser(db, { userId: f.applicant.userId!, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 60 });
    await expectDbError(() => send(f, { person: f.applicant.id }), /email denied/);
    await asUser(db, { userId: f.consultant, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => send(f, { person: f.applicant.id }), /email denied/);
    // Another firm's consultant: neither with this firm's ids nor its own firm id and this matter.
    await asUser(db, { userId: other.consultant, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 60 });
    await expectDbError(() => send(f, { person: f.applicant.id }), /email denied/);
    await staff(other, other.consultant);
    await expectDbError(() => send(other, { matter: f.matterId, person: f.applicant.id }), /email denied/);
    // And the database takes no direct writes.
    await staff(f, f.consultant);
    await expectDbError(
      () =>
        db.query(
          `insert into public.matter_outbound_emails (organization_id, matter_id, person_id, recipient_email, body, author_user_id, author_membership_id, author_name, outbox_event_id)
           values ($1, $2, $3, 'x@example.test', 'x', $4, $4, 'x', $4)`,
          [f.orgId, f.matterId, f.applicant.id, f.consultant],
        ),
      /permission denied/,
    );
    await asMaintenance(db);
    const rows = await db.query(`select id from public.matter_outbound_emails where organization_id in ($1, $2)`, [f.orgId, other.orgId]);
    expect(rows.rows).toHaveLength(0);
  });

  it("writes only to a person on the matter, at their stored address", async () => {
    const f = await firm();
    const other = await firm();
    await staff(f, f.consultant);
    await expectDbError(() => send(f, { person: f.stranger.id }), /not on this matter/);
    await expectDbError(() => send(f, { person: other.applicant.id }), /not on this matter/);
    await expectDbError(() => send(f, { person: f.sponsor.id }), /no email address/);
    await expectDbError(() => send(f, { person: f.applicant.id, body: "   \n " }), /1 to 5000/);
    await expectDbError(() => send(f, { person: f.applicant.id, body: "x".repeat(5001) }), /1 to 5000/);
    // A reply must name a filed email on this matter, filed to the same person.
    const mail = await filedEmail(f, f.applicant.id);
    await asMaintenance(db);
    await db.query(`update public.persons set email = 'sponsor-new@example.test' where id = $1`, [f.sponsor.id]);
    await staff(f, f.consultant);
    await expectDbError(() => send(f, { person: f.sponsor.id, reply: mail.id }), /not on this person/);
    const foreign = await filedEmail(other, other.applicant.id);
    await staff(f, f.consultant);
    await expectDbError(() => send(f, { person: f.applicant.id, reply: foreign.id }), /not on this person/);
    // The do-not-send list and the person's own email choice refuse up front.
    await asMaintenance(db);
    await db.query(`insert into public.email_suppressions (organization_id, recipient_email, reason) values ($1, 'sponsor-new@example.test', 'hard_bounce')`, [f.orgId]);
    await staff(f, f.consultant);
    await expectDbError(() => send(f, { person: f.sponsor.id }), /do-not-send/);
    await asMaintenance(db);
    await db.query(`insert into public.person_contact_preferences (organization_id, person_id, email_notices) values ($1, $2, false)`, [f.orgId, f.applicant.id]);
    await staff(f, f.consultant);
    await expectDbError(() => send(f, { person: f.applicant.id }), /turned off email/);
  });

  it("returns the same email for a retried send, and keeps every email append-only", async () => {
    const f = await firm();
    await staff(f, f.consultant);
    const first = await send(f, { person: f.applicant.id, key: "retry-key-0001" });
    const again = await send(f, { person: f.applicant.id, key: "retry-key-0001" });
    expect(again).toEqual({ email_id: first.email_id, sample: false, replayed: true });
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.matter_outbound_emails set body = 'changed' where id = $1`, [first.email_id]), /append-only/);
    const events = await db.query(`select id from public.outbox_events where event_type = 'matter_email.sent' and aggregate_id = $1`, [first.email_id]);
    expect(events.rows).toHaveLength(1);
  });
});

describe("Inbox replies: the mail the worker sends", () => {
  it("prepares a reply from the firm's notices sender, replying to the matter address, threaded", async () => {
    const f = await firm();
    const mail = await filedEmail(f, f.applicant.id);
    await staff(f, f.consultant);
    const sent = await send(f, { person: f.applicant.id, body: "Synthetic: the dates, please.", reply: mail.id });
    await asMaintenance(db);
    const stored = await db.query<{ subject: string }>(`select subject from public.matter_outbound_emails where id = $1`, [sent.email_id]);
    expect(stored.rows[0].subject).toBe("Re: Photos for the file");
    const replyAddress = (await db.query<{ address: string }>(`select app.firm_reply_address($1, $2, null) as address`, [f.orgId, f.matterId])).rows[0].address;
    const firmName = (await db.query<{ name: string }>(`select display_name as name from public.organizations where id = $1`, [f.orgId])).rows[0].name;

    const prepared = await prepare(sent.email_id);
    expect(prepared.action).toBe("send");
    expect(prepared.messages).toHaveLength(1);
    const [message] = prepared.messages;
    expect(message.to).toBe(f.applicant.email);
    expect(message.template).toBe("staff_message");
    expect(message.from_address).toBe("notices@casevoya.ca");
    expect(message.from_name).toBe(firmName);
    expect(message.reply_to_address).toBe(replyAddress);
    expect(replyAddress).toMatch(/\+[0-9a-f]{32}@docs\.casevoya\.ca$/);
    expect(message.body).toBe("Synthetic: the dates, please.");
    expect(message.subject).toBe("Re: Photos for the file");
    expect(message.headers).toEqual({ "In-Reply-To": mail.messageId, References: mail.messageId });
    // The delivery context holds names and flags only, never the text.
    expect(Object.keys(message.context).sort()).toEqual(["firm", "portal", "sender", "template"]);
    expect(message.context).toMatchObject({ sender: "Sam Consultant", portal: true });
    await asMaintenance(db);
    const delivery = await db.query<{ status: string; context: Record<string, unknown>; matter_id: string }>(
      `select status::text, context, matter_id from public.email_deliveries where outbox_event_id = (select outbox_event_id from public.matter_outbound_emails where id = $1)`,
      [sent.email_id],
    );
    expect(delivery.rows[0].status).toBe("sending");
    expect(delivery.rows[0].matter_id).toBe(f.matterId);
    expect(JSON.stringify(delivery.rows[0].context)).not.toContain("dates");
    // Staff on the matter see the delivery; staff off it do not.
    await staff(f, f.consultant);
    expect((await db.query(`select id from public.email_deliveries where template = 'staff_message'`)).rows).toHaveLength(1);
    await staff(f, f.outsider);
    expect((await db.query(`select id from public.email_deliveries where template = 'staff_message'`)).rows).toHaveLength(0);
  });

  it("sends a new email with no threading headers, and skips one whose person turned email off since", async () => {
    const f = await firm();
    await staff(f, f.consultant);
    const sent = await send(f, { person: f.applicant.id });
    const prepared = await prepare(sent.email_id);
    expect(prepared.messages[0].headers).toBeUndefined();
    expect(prepared.messages[0].subject).toBeNull();

    await staff(f, f.consultant);
    const later = await send(f, { person: f.applicant.id, body: "Synthetic: a second email." });
    await asMaintenance(db);
    await db.query(`insert into public.person_contact_preferences (organization_id, person_id, email_notices) values ($1, $2, false)`, [f.orgId, f.applicant.id]);
    const skipped = await prepare(later.email_id);
    expect(skipped.action).toBe("done");
    await asMaintenance(db);
    const status = await db.query<{ status: string }>(
      `select status::text from public.email_deliveries where outbox_event_id = (select outbox_event_id from public.matter_outbound_emails where id = $1)`,
      [later.email_id],
    );
    expect(status.rows.map((row) => row.status)).toEqual(["skipped"]);
  });
});

describe("Inbox replies: sample mode", () => {
  it("records a sample client's email and never sends it, and refuses real matters in a sample-mode firm", async () => {
    const f = await firm({ sample: true });
    await staff(f, f.consultant);
    const sent = await send(f, { person: f.applicant.id });
    expect(sent.sample).toBe(true);
    const prepared = await prepare(sent.email_id);
    expect(prepared.action).toBe("done");
    expect(prepared.messages).toEqual([]);
    await asMaintenance(db);
    const status = await db.query<{ status: string }>(
      `select status::text from public.email_deliveries where outbox_event_id = (select outbox_event_id from public.matter_outbound_emails where id = $1)`,
      [sent.email_id],
    );
    expect(status.rows.map((row) => row.status)).toEqual(["skipped"]);

    // A real matter in a sample-mode firm takes no email (sample and real people are never linked).
    const real = await db.query<{ id: string }>(`insert into public.matters (organization_id, title) values ($1, 'Real matter') returning id`, [f.orgId]);
    const realPerson = await person(f.orgId, { matterId: real.rows[0].id, name: "Real Person" });
    await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role)
      select organization_id, $2, membership_id, 'consultant' from public.matter_participants where matter_id = $1 and membership_id is not null`, [f.matterId, real.rows[0].id]);
    await staff(f, f.consultant);
    await expectDbError(() => send(f, { matter: real.rows[0].id, person: realPerson.id }), /email denied/);
    await expectDbError(() => send(f, { person: realPerson.id }), /not on this matter/);
  });
});
