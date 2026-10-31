import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, type TestDb } from "./helpers/postgres";

/**
 * Outbox reads (20261102130000): staff read outbox_events only in the active workspace, with
 * staff assurance, and either as firm owner or for a matter message they can already read.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
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

async function membership(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
    [orgId, userId, role],
  );
  return row.rows[0].id;
}

async function firm() {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const matterId = (await db.query<{ id: string }>(`insert into public.matters (organization_id, title) values ($1, 'Synthetic matter') returning id`, [orgId])).rows[0].id;
  const consultant = await createUser("consultant");
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant");
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [
    orgId,
    matterId,
    consultantMembership,
  ]);
  const outsider = await createUser("other");
  await membership(orgId, outsider, "case_manager");
  const applicant = await createUser("applicant");
  await membership(orgId, applicant, "client");
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Synthetic Applicant', 'applicant@example.test') returning id`,
    [orgId, applicant],
  );
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [
    orgId,
    matterId,
    person.rows[0].id,
  ]);
  // A non-message event in the firm (job history only the owner sees).
  await db.query(
    `insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, last_error) values ($1, 'deadline', gen_random_uuid(), 'reminder.due', '{}'::jsonb, 'Synthetic worker error')`,
    [orgId],
  );
  return { orgId, matterId, owner, consultant, outsider, applicant, personId: person.rows[0].id };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const staff = (f: Firm, userId: string, orgId: string | null = f.orgId) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 60 });

async function visibleTypes(orgId: string) {
  const rows = await db.query<{ event_type: string }>(`select event_type from public.outbox_events where organization_id = $1 order by event_type`, [orgId]);
  return rows.rows.map((row) => row.event_type);
}

async function sendMessage(f: Firm) {
  await staff(f, f.consultant);
  const row = await db.query<{ result: { message_id: string } }>(
    `select public.send_matter_message($1, $2, null, $3::uuid[], 'Synthetic body', false, null, null) as result`,
    [f.orgId, f.matterId, [f.personId]],
  );
  return row.rows[0].result.message_id;
}

describe("outbox_events reads", () => {
  it("lets the assigned consultant read the message.sent event of a message they can read", async () => {
    const f = await firm();
    const messageId = await sendMessage(f);
    await staff(f, f.consultant);
    const rows = await db.query<{ aggregate_id: string; status: string }>(
      `select aggregate_id, status::text as status from public.outbox_events where organization_id = $1 and aggregate_type = 'message' and event_type = 'message.sent'`,
      [f.orgId],
    );
    expect(rows.rows.map((row) => row.aggregate_id)).toEqual([messageId]);
    // Other firm events stay hidden from non-owner staff.
    expect(await visibleTypes(f.orgId)).toEqual(["message.sent"]);
  });

  it("hides events from staff who cannot read the message, without assurance, or outside the active workspace", async () => {
    const f = await firm();
    await sendMessage(f);
    await staff(f, f.outsider);
    expect(await visibleTypes(f.orgId)).toEqual([]);
    await asUser(db, { userId: f.consultant, aal: "aal1", orgId: f.orgId });
    expect(await visibleTypes(f.orgId)).toEqual([]);
    await staff(f, f.consultant, null);
    expect(await visibleTypes(f.orgId)).toEqual([]);
    await asUser(db, { userId: f.applicant, aal: "aal1", orgId: f.orgId });
    expect(await visibleTypes(f.orgId)).toEqual([]);
  });

  it("lets the firm owner read the firm's job history in the active workspace only", async () => {
    const f = await firm();
    await sendMessage(f);
    await staff(f, f.owner);
    const types = await visibleTypes(f.orgId);
    expect(types).toContain("message.sent");
    expect(types).toContain("reminder.due");
    await staff(f, f.owner, null);
    expect(await visibleTypes(f.orgId)).toEqual([]);
    // Another firm's owner sees none of it, even with their own workspace active.
    const other = await firm();
    await staff(other, other.owner);
    expect(await visibleTypes(f.orgId)).toEqual([]);
  });
});
