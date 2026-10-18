import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * Secure matter messaging (PRD OPS-04, OPS-05; T034) against the real migrations: audience and
 * household boundaries, staff-only notes, permissioned attachments, unread and acknowledgement,
 * client rate limits, the generic EX07 mail with no message text, and staff notifications.
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

/** A client with a login, on the matter in the given role. */
async function party(orgId: string, matterId: string, role: string, name: string, login = true) {
  const user = await createUser(role);
  if (login) await membership(orgId, user.id, role === "sponsor" ? "sponsor" : "client");
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, $3, $4) returning id`,
    [orgId, login ? user.id : null, name, user.email],
  );
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, $4::public.matter_party_role)`, [
    orgId,
    matterId,
    person.rows[0].id,
    role,
  ]);
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
  const matter = await db.query<{ id: string }>(`insert into public.matters (organization_id, title) values ($1, 'Synthetic matter') returning id`, [orgId]);
  const matterId = matter.rows[0].id;
  const consultant = await createUser("consultant");
  const consultantMembership = await membership(orgId, consultant.id, "licensed_consultant");
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [
    orgId,
    matterId,
    consultantMembership,
  ]);
  const outsiderStaff = await createUser("other");
  await membership(orgId, outsiderStaff.id, "case_manager");
  const finance = await createUser("finance");
  await membership(orgId, finance.id, "finance_user");
  const applicant = await party(orgId, matterId, "applicant", "Synthetic Applicant");
  const sponsor = await party(orgId, matterId, "sponsor", "Synthetic Sponsor");
  return { orgId, matterId, owner: owner.id, consultant: consultant.id, outsiderStaff: outsiderStaff.id, finance: finance.id, applicant, sponsor };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const staff = (f: Firm, userId: string) => asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 60 });
const client = (f: Firm, userId: string) => asUser(db, { userId, aal: "aal1", orgId: f.orgId });

async function send(
  f: Firm,
  args: { thread?: string | null; people?: string[] | null; body: string; ack?: boolean; docs?: string[] | null; key?: string | null },
) {
  const row = await db.query<{ result: { message_id: string; thread_id: string; replayed: boolean } }>(
    `select public.send_matter_message($1, $2, $3, $4::uuid[], $5, $6, $7::uuid[], $8) as result`,
    [f.orgId, f.matterId, args.thread ?? null, args.people ?? null, args.body, args.ack ?? false, args.docs ?? null, args.key ?? null],
  );
  return row.rows[0].result;
}

async function visibleBodies() {
  const rows = await db.query<{ body: string }>(`select body from public.matter_messages order by created_at`);
  return rows.rows.map((row) => row.body);
}

describe("matter messaging", () => {
  it("keeps a message to the applicant away from the sponsor, and shows staff every thread", async () => {
    const f = await firm();
    await staff(f, f.consultant);
    const toApplicant = await send(f, { people: [f.applicant.personId], body: "Synthetic: for the applicant only" });
    const toBoth = await send(f, { people: [f.sponsor.personId, f.applicant.personId], body: "Synthetic: for both" });
    expect(toBoth.thread_id).not.toBe(toApplicant.thread_id);
    // Same audience in another order reuses the thread.
    const again = await send(f, { people: [f.applicant.personId, f.sponsor.personId], body: "Synthetic: both again" });
    expect(again.thread_id).toBe(toBoth.thread_id);

    await client(f, f.applicant.userId);
    expect(await visibleBodies()).toEqual(["Synthetic: for the applicant only", "Synthetic: for both", "Synthetic: both again"]);
    await client(f, f.sponsor.userId);
    expect(await visibleBodies()).toEqual(["Synthetic: for both", "Synthetic: both again"]);
    const sponsorThreads = await db.query(`select id from public.message_threads`);
    expect(sponsorThreads.rows).toHaveLength(1);

    await staff(f, f.consultant);
    expect(await visibleBodies()).toHaveLength(3);
    // The firm owner reads every matter; staff not on the matter and finance users read nothing.
    await staff(f, f.owner);
    expect(await visibleBodies()).toHaveLength(3);
    await staff(f, f.outsiderStaff);
    expect(await visibleBodies()).toEqual([]);
    await staff(f, f.finance);
    expect(await visibleBodies()).toEqual([]);
    // Staff without staff assurance read nothing either.
    await asUser(db, { userId: f.consultant, aal: "aal1", orgId: f.orgId });
    expect(await visibleBodies()).toEqual([]);
  });

  it("lets a client write only to the firm, in their own thread or one they are in", async () => {
    const f = await firm();
    await client(f, f.applicant.userId);
    const own = await send(f, { body: "Synthetic: question from the applicant" });
    const author = await db.query<{ author_name: string; author_kind: string }>(`select author_name, author_kind from public.matter_messages where id = $1`, [own.message_id]);
    expect(author.rows[0]).toEqual({ author_name: "Synthetic Applicant", author_kind: "client" });
    await expectDbError(() => send(f, { people: [f.sponsor.personId], body: "Synthetic: try the sponsor" }), /clients write to the firm only/);
    await client(f, f.sponsor.userId);
    await expectDbError(() => send(f, { thread: own.thread_id, body: "Synthetic: forged reply" }), /message denied/);
    expect(await visibleBodies()).toEqual([]);
    await expectDbError(() => send(f, { body: "Synthetic", ack: true }), /only staff/);
    // Another firm's member cannot write here at all.
    const other = await firm();
    await client(other, other.applicant.userId);
    await expectDbError(
      () => db.query(`select public.send_matter_message($1, $2, null, null, 'Synthetic', false, null, null)`, [f.orgId, f.matterId]),
      /message denied/,
    );
    // Nobody writes the tables directly.
    await client(f, f.applicant.userId);
    await expectDbError(
      () =>
        db.query(
          `insert into public.matter_messages (organization_id, thread_id, matter_id, author_user_id, author_kind, author_person_id, body) values ($1, $2, $3, $4, 'client', $5, 'x')`,
          [f.orgId, own.thread_id, f.matterId, f.applicant.userId, f.applicant.personId],
        ),
      /permission denied/,
    );
  });

  it("refuses an audience that is not on the matter", async () => {
    const f = await firm();
    const other = await firm();
    await staff(f, f.consultant);
    await expectDbError(() => send(f, { people: [other.applicant.personId], body: "Synthetic" }), /must be on this matter/);
    await expectDbError(() => send(f, { people: [], body: "Synthetic" }), /choose who can read/);
  });

  it("tracks unread and acknowledgement of a critical instruction", async () => {
    const f = await firm();
    await staff(f, f.consultant);
    const sent = await send(f, { people: [f.applicant.personId], body: "Synthetic: bring the original passport", ack: true });
    await client(f, f.applicant.userId);
    const before = await db.query(`select * from public.matter_message_receipts where message_id = $1`, [sent.message_id]);
    expect(before.rows).toHaveLength(0);
    const marked = await db.query<{ n: number }>(`select public.mark_message_thread_read($1, $2) as n`, [f.orgId, sent.thread_id]);
    expect(marked.rows[0].n).toBe(1);
    await db.query(`select public.acknowledge_matter_message($1, $2)`, [f.orgId, sent.message_id]);
    // The sponsor is not addressed and cannot acknowledge.
    await client(f, f.sponsor.userId);
    await expectDbError(() => db.query(`select public.acknowledge_matter_message($1, $2)`, [f.orgId, sent.message_id]), /addressed/);
    await staff(f, f.consultant);
    const receipts = await db.query<{ person_id: string | null; acknowledged: boolean }>(
      `select person_id, acknowledged_at is not null as acknowledged from public.matter_message_receipts where message_id = $1 and user_id <> $2`,
      [sent.message_id, f.consultant],
    );
    expect(receipts.rows).toEqual([{ person_id: f.applicant.personId, acknowledged: true }]);
    await asMaintenance(db);
    const audit = await db.query<{ action: string; context: Record<string, unknown> }>(
      `select action, context from public.audit_log where object_id = $1 order by occurred_at`,
      [sent.message_id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(["message.sent", "message.acknowledged"]);
    expect(JSON.stringify(audit.rows)).not.toContain("passport");
  });

  it("rate-limits client sends and replays a retried send once", async () => {
    const f = await firm();
    await client(f, f.applicant.userId);
    const first = await send(f, { body: "Synthetic 0", key: "retry-key-0001" });
    const replay = await send(f, { body: "Synthetic 0", key: "retry-key-0001" });
    expect(replay).toEqual({ ...first, replayed: true });
    for (let i = 1; i < 10; i++) await send(f, { body: `Synthetic ${i}` });
    await expectDbError(() => send(f, { body: "Synthetic 11" }), /rate limit/);
    expect(await visibleBodies()).toHaveLength(10);
  });

  it("attaches only documents everyone in the audience may read, by link", async () => {
    const f = await firm();
    await asMaintenance(db);
    const doc = async (personId: string, audience: string, sensitivity = "ordinary") => {
      const row = await db.query<{ id: string }>(
        `insert into public.documents (organization_id, person_id, purpose, audience, sensitivity) values ($1, $2, 'Synthetic document', $3::public.document_audience, $4::public.document_sensitivity) returning id`,
        [f.orgId, personId, audience, sensitivity],
      );
      await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id) values ($1, $2, $3)`, [f.orgId, row.rows[0].id, f.matterId]);
      return row.rows[0].id;
    };
    const applicantOnly = await doc(f.applicant.personId, "subject");
    const shared = await doc(f.applicant.personId, "matter");
    const staffOnly = await doc(f.applicant.personId, "staff");
    const sensitive = await doc(f.applicant.personId, "matter", "medical");

    await staff(f, f.consultant);
    // A message to the sponsor (employer-style audience) cannot carry the applicant's own document.
    await expectDbError(() => send(f, { people: [f.sponsor.personId], body: "Synthetic", docs: [applicantOnly] }), /not shared with everyone/);
    await expectDbError(() => send(f, { people: [f.sponsor.personId, f.applicant.personId], body: "Synthetic", docs: [sensitive] }), /not shared/);
    await expectDbError(() => send(f, { people: [f.applicant.personId], body: "Synthetic", docs: [staffOnly] }), /not shared/);
    await expectDbError(() => send(f, { people: [f.applicant.personId], body: "Synthetic", docs: [randomUUID()] }), /not shared/);
    const ok = await send(f, { people: [f.applicant.personId], body: "Synthetic: your document", docs: [applicantOnly] });
    const both = await send(f, { people: [f.sponsor.personId, f.applicant.personId], body: "Synthetic: shared", docs: [shared] });
    await client(f, f.applicant.userId);
    const mine = await db.query(`select document_id from public.matter_message_attachments order by created_at`);
    expect(mine.rows.map((row) => (row as { document_id: string }).document_id)).toEqual([applicantOnly, shared]);
    await client(f, f.sponsor.userId);
    const theirs = await db.query<{ message_id: string }>(`select message_id from public.matter_message_attachments`);
    expect(theirs.rows.map((row) => row.message_id)).toEqual([both.message_id]);
    expect(ok.message_id).toBeTruthy();
    // No storage path was created for the attachment.
    await asMaintenance(db);
    const objects = await db.query(`select id from storage.objects`);
    expect(objects.rows).toHaveLength(0);
  });

  it("keeps staff-only notes away from every portal role", async () => {
    const f = await firm();
    await staff(f, f.consultant);
    await db.query(`select public.add_matter_staff_note($1, $2, 'Synthetic: staff only')`, [f.orgId, f.matterId]);
    const seen = await db.query(`select body from public.matter_staff_notes`);
    expect(seen.rows).toHaveLength(1);
    for (const userId of [f.applicant.userId, f.sponsor.userId]) {
      await client(f, userId);
      expect((await db.query(`select body from public.matter_staff_notes`)).rows).toEqual([]);
      expect(await visibleBodies()).toEqual([]);
      await expectDbError(() => db.query(`select public.add_matter_staff_note($1, $2, 'x')`, [f.orgId, f.matterId]), /staff access denied/);
    }
    await staff(f, f.finance);
    expect((await db.query(`select body from public.matter_staff_notes`)).rows).toEqual([]);
  });

  it("emails the addressed people the generic EX07 notice, with no message text", async () => {
    const f = await firm();
    await asMaintenance(db);
    await staff(f, f.consultant);
    const sent = await send(f, { people: [f.applicant.personId], body: "Synthetic: secret refusal detail", ack: true });
    await asMaintenance(db);
    const events = await db.query<{ id: string; payload: Record<string, unknown> }>(
      `select id, payload from public.outbox_events where event_type = 'message.sent' and payload ->> 'message_id' = $1`,
      [sent.message_id],
    );
    expect(events.rows).toHaveLength(1);
    expect(Object.keys(events.rows[0].payload).sort()).toEqual(["matter_id", "message_id", "thread_id"]);
    await asServiceRole(db);
    const worker = `msg-${tag()}`;
    const claimed = await db.query<{ events: { id: string }[] }>(`select public.claim_mail_events($1, 50) as events`, [worker]);
    expect(claimed.rows[0].events.map((row) => row.id)).toContain(events.rows[0].id);
    const prepared = await db.query<{ result: { action: string; messages: { to: string; template: string; context: Record<string, unknown> }[] } }>(
      `select public.prepare_email_delivery($1, $2, null, null) as result`,
      [events.rows[0].id, worker],
    );
    const result = prepared.rows[0].result;
    expect(result.action).toBe("send");
    expect(result.messages.map((message) => message.to)).toEqual([f.applicant.email]);
    expect(result.messages[0].template).toBe("message");
    expect(Object.keys(result.messages[0].context).sort()).toEqual(["firm", "template"]);
    expect(JSON.stringify(result)).not.toContain("secret");
    await asMaintenance(db);
    const delivery = await db.query<{ critical: boolean }>(`select critical from public.email_deliveries where outbox_event_id = $1`, [events.rows[0].id]);
    expect(delivery.rows[0].critical).toBe(true);
    // A person whose "Email notices" is off is recorded as skipped, not emailed.
    await db.query(`insert into public.person_contact_preferences (organization_id, person_id, email_notices) values ($1, $2, false)`, [f.orgId, f.sponsor.personId]);
    await staff(f, f.consultant);
    const quiet = await send(f, { people: [f.sponsor.personId], body: "Synthetic: to the sponsor" });
    await asMaintenance(db);
    const quietEvent = await db.query<{ id: string }>(`select id from public.outbox_events where payload ->> 'message_id' = $1`, [quiet.message_id]);
    await asServiceRole(db);
    await db.query(`select public.claim_mail_events($1, 50)`, [worker]);
    const skipped = await db.query<{ result: { action: string } }>(`select public.prepare_email_delivery($1, $2, null, null) as result`, [quietEvent.rows[0].id, worker]);
    expect(skipped.rows[0].result.action).toBe("done");
    await asMaintenance(db);
    const skippedRow = await db.query<{ status: string }>(`select status::text from public.email_deliveries where outbox_event_id = $1`, [quietEvent.rows[0].id]);
    expect(skippedRow.rows.map((row) => row.status)).toEqual(["skipped"]);
    // A client's own message is not mailed.
    await client(f, f.applicant.userId);
    const reply = await send(f, { body: "Synthetic reply" });
    await asMaintenance(db);
    const none = await db.query(`select id from public.outbox_events where payload ->> 'message_id' = $1`, [reply.message_id]);
    expect(none.rows).toHaveLength(0);
  });
});

describe("staff notifications", () => {
  type Item = { id: string; kind: string; actor_name: string | null; href: string; read: boolean };
  const list = async (f: Firm) =>
    (await db.query<{ items: Item[] }>(`select public.staff_notifications($1, 50) as items`, [f.orgId])).rows[0].items;

  it("lists a client's message for staff on the matter, unread until opened or marked", async () => {
    const f = await firm();
    await client(f, f.applicant.userId);
    const sent = await send(f, { body: "Synthetic question" });
    await staff(f, f.consultant);
    const items = await list(f);
    expect(items.map((item) => [item.kind, item.actor_name, item.read])).toEqual([["message", "Synthetic Applicant", false]]);
    expect(items[0].href).toBe(`/sheet/matters/${f.matterId}?tab=messages&thread=${sent.thread_id}`);
    await db.query(`select public.mark_message_thread_read($1, $2)`, [f.orgId, sent.thread_id]);
    expect((await list(f))[0].read).toBe(true);

    await staff(f, f.owner);
    expect((await list(f))[0].read).toBe(false);
    const marked = await db.query<{ n: number }>(`select public.mark_staff_notifications_read($1, null) as n`, [f.orgId]);
    expect(marked.rows[0].n).toBe(1);
    expect((await list(f))[0].read).toBe(true);

    // Staff not on the matter and finance users see nothing; clients are refused.
    await staff(f, f.outsiderStaff);
    expect(await list(f)).toEqual([]);
    await staff(f, f.finance);
    expect(await list(f)).toEqual([]);
    await client(f, f.applicant.userId);
    await expectDbError(() => list(f), /staff access denied/);
    // Another firm's staff cannot read this firm's list.
    const other = await firm();
    await staff(other, other.owner);
    await expectDbError(() => db.query(`select public.staff_notifications($1, 50)`, [f.orgId]), /staff access denied/);
  });

  it("lists a client's upload and a deadline reminder from the existing outbox events", async () => {
    const f = await firm();
    await asMaintenance(db);
    const doc = await db.query<{ id: string }>(
      `insert into public.documents (organization_id, person_id, purpose) values ($1, $2, 'Synthetic photos') returning id`,
      [f.orgId, f.applicant.personId],
    );
    await db.query(
      `insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, created_by)
       values ($1, 'document', $2::uuid, 'document.uploaded', jsonb_build_object('document_id', $2::text, 'matter_id', $3::text), $4)`,
      [f.orgId, doc.rows[0].id, f.matterId, f.applicant.userId],
    );
    const deadline = await db.query<{ id: string }>(
      `insert into public.deadlines (organization_id, matter_id, kind, label, due_on, timezone) values ($1, $2, 'internal', 'Synthetic deadline', '2026-10-30', 'America/Toronto') returning id`,
      [f.orgId, f.matterId],
    );
    await db.query(
      `insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload) values ($1, 'reminder', $2::uuid, 'reminder.due', jsonb_build_object('deadline_id', $2::text, 'matter_id', $3::text))`,
      [f.orgId, deadline.rows[0].id, f.matterId],
    );
    await staff(f, f.consultant);
    const kinds = (await list(f)).map((item) => item.kind).sort();
    expect(kinds).toEqual(["deadline", "document"]);
    // A staff member's own upload is not a notification.
    await asMaintenance(db);
    await db.query(
      `insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, created_by)
       values ($1, 'document', $2::uuid, 'document.uploaded', jsonb_build_object('document_id', $2::text, 'matter_id', $3::text), $4)`,
      [f.orgId, doc.rows[0].id, f.matterId, f.consultant],
    );
    await staff(f, f.consultant);
    expect((await list(f)).map((item) => item.kind).sort()).toEqual(["deadline", "document"]);
  });
});
