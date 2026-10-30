import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * SEC-01 client two-step in the database: a portal person with a verified second factor reaches
 * their person, matter and messages only from a session that completed it (aal2 or a passkey
 * sign-in). A client without a factor keeps working at aal1. Staff are unchanged.
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

async function client(orgId: string, matterId: string, name: string, factor: "verified" | "unverified" | null) {
  const userId = await createUser("client");
  await membership(orgId, userId, "client");
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, user_id, display_name) values ($1, $2, $3) returning id`,
    [orgId, userId, name],
  );
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [
    orgId,
    matterId,
    person.rows[0].id,
  ]);
  if (factor) {
    await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', $3)`, [randomUUID(), userId, factor]);
  }
  return { userId, personId: person.rows[0].id };
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
  const matter = await db.query<{ id: string }>(`insert into public.matters (organization_id, title) values ($1, 'Synthetic matter') returning id`, [orgId]);
  const matterId = matter.rows[0].id;
  const consultant = await createUser("consultant");
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant");
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [
    orgId,
    matterId,
    consultantMembership,
  ]);
  const guarded = await client(orgId, matterId, "Synthetic Guarded", "verified");
  const open = await client(orgId, matterId, "Synthetic Open", null);
  const pending = await client(orgId, matterId, "Synthetic Pending", "unverified");
  return { orgId, matterId, consultant, guarded, open, pending };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const asStaff = (f: Firm, userId: string) => asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 60 });
const asClient = (f: Firm, userId: string, aal: "aal1" | "aal2", extra: { amrMethod?: "passkey" } = {}) =>
  asUser(db, { userId, aal, orgId: f.orgId, ...(aal === "aal2" ? { totpAgeSeconds: 30 } : {}), ...(extra.amrMethod ? { amrMethod: extra.amrMethod, totpAgeSeconds: 30 } : {}) });

async function sendToClient(f: Firm, personId: string, body: string) {
  await asStaff(f, f.consultant);
  const row = await db.query<{ result: { thread_id: string } }>(
    `select public.send_matter_message($1, $2, null, $3::uuid[], $4, false, null, null) as result`,
    [f.orgId, f.matterId, [personId], body],
  );
  return row.rows[0].result.thread_id;
}

const clientSend = (f: Firm, threadId: string | null, body: string) =>
  db.query<{ result: { message_id: string } }>(`select public.send_matter_message($1, $2, $3, null, $4, false, null, null) as result`, [
    f.orgId,
    f.matterId,
    threadId,
    body,
  ]);

async function visible(f: Firm, personId: string) {
  const person = await db.query(`select id from public.persons where id = $1`, [personId]);
  const matter = await db.query(`select id from public.matters where id = $1`, [f.matterId]);
  const messages = await db.query<{ body: string }>(`select body from public.matter_messages order by created_at`);
  return { person: person.rows.length, matter: matter.rows.length, messages: messages.rows.map((row) => row.body) };
}

describe("client two-step enforced in the database", () => {
  it("refuses an aal1 session of a client with a verified factor, and allows it after the second step", async () => {
    const f = await firm();
    const threadId = await sendToClient(f, f.guarded.personId, "Synthetic: for the guarded client");

    await asClient(f, f.guarded.userId, "aal1");
    expect(await visible(f, f.guarded.personId)).toEqual({ person: 0, matter: 0, messages: [] });
    const gates = await db.query<{ person: boolean; matter: boolean; me: string | null; ok: boolean }>(
      `select app.can_read_person($1) as person, app.can_read_matter($2) as matter, app.message_thread_person_for_me($3) as me, app.session_assurance_ok() as ok`,
      [f.guarded.personId, f.matterId, threadId],
    );
    expect(gates.rows[0]).toEqual({ person: false, matter: false, me: null, ok: false });
    await expectDbError(() => clientSend(f, threadId, "Synthetic: reply at aal1"), /message denied|two-step/);
    await expectDbError(() => clientSend(f, null, "Synthetic: new at aal1"), /two-step/);

    await asClient(f, f.guarded.userId, "aal2");
    expect(await visible(f, f.guarded.personId)).toEqual({ person: 1, matter: 1, messages: ["Synthetic: for the guarded client"] });
    const reply = await clientSend(f, threadId, "Synthetic: reply at aal2");
    expect(reply.rows[0].result.message_id).toBeTruthy();

    // A passkey sign-in is accepted like the portal redirect accepts it.
    await asClient(f, f.guarded.userId, "aal1", { amrMethod: "passkey" });
    expect((await visible(f, f.guarded.personId)).person).toBe(1);
  });

  it("keeps a client with no verified factor working at aal1", async () => {
    const f = await firm();
    const threadId = await sendToClient(f, f.open.personId, "Synthetic: for the open client");
    for (const who of [f.open, f.pending]) {
      await asClient(f, who.userId, "aal1");
      const seen = await visible(f, who.personId);
      expect(seen.person).toBe(1);
      expect(seen.matter).toBe(1);
    }
    await asClient(f, f.open.userId, "aal1");
    expect((await visible(f, f.open.personId)).messages).toEqual(["Synthetic: for the open client"]);
    const reply = await clientSend(f, threadId, "Synthetic: open reply");
    expect(reply.rows[0].result.message_id).toBeTruthy();
  });

  it("leaves staff access unchanged", async () => {
    const f = await firm();
    await sendToClient(f, f.guarded.personId, "Synthetic: staff view");
    await asStaff(f, f.consultant);
    const seen = await visible(f, f.guarded.personId);
    expect(seen).toEqual({ person: 1, matter: 1, messages: ["Synthetic: staff view"] });
  });
});
