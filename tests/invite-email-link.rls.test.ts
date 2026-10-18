import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/** Stands in for the server's AES-GCM output: the database never opens it. */
function sealed() {
  return randomBytes(96).toString("base64");
}

function hashOf(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, address],
  );
  return id;
}

async function member(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return row.rows[0].id;
}

async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const assistant = await createUser(email("assistant"));
  const client = await createUser(email("client"));
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal",
    "Synthetic Firm",
    slug(),
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await member(orgId, consultant, "licensed_consultant", owner);
  await member(orgId, assistant, "assistant", owner);
  await member(orgId, client, "client", owner);
  return { owner, consultant, assistant, client, orgId, consultantMembership };
}

async function staffInvite(ctx: { owner: string; orgId: string }) {
  const address = email("staff");
  await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  const created = await db.query<{ token: string }>(
    `select public.create_staff_invitation($1, $2, 'case_manager'::public.org_role) as token`,
    [ctx.orgId, address],
  );
  const token = created.rows[0].token;
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `select id from public.invitations where organization_id = $1 and email = $2 and revoked_at is null`,
    [ctx.orgId, address],
  );
  return { token, invitationId: row.rows[0].id };
}

async function portalInvite(ctx: { owner: string; consultant: string; orgId: string; consultantMembership: string }) {
  await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { id: string } }>(
    `select public.create_practice_matter('Fictional sample file', true) as result`,
  );
  const matterId = matter.rows[0].result.id;
  const personId = randomUUID();
  await db.query(
    `insert into public.persons (id, organization_id, display_name, is_sample) values ($1, $2, 'Sample Applicant', true)`,
    [personId, ctx.orgId],
  );
  await asMaintenance(db);
  await db.query(
    `update public.persons set date_of_birth = '1990-04-04', birth_date_precision = 'day'::public.date_precision where id = $1`,
    [personId],
  );
  await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`,
    [ctx.orgId, matterId, ctx.consultantMembership],
  );
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`,
    [ctx.orgId, matterId, personId],
  );
  await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  const issued = await db.query<{ result: { ok: boolean; token: string; invitation_id: string } }>(
    `select public.create_portal_invitation($1, $2, 'client'::public.org_role, $3, '{}'::uuid[]) as result`,
    [personId, matterId, email("applicant")],
  );
  expect(issued.rows[0].result.ok).toBe(true);
  return { token: issued.rows[0].result.token, invitationId: issued.rows[0].result.invitation_id };
}

async function attach(invitationId: string, token: string, link = sealed()) {
  const row = await db.query<{ ok: boolean }>(`select public.attach_invitation_email_link($1, $2, $3) as ok`, [
    invitationId,
    link,
    hashOf(token),
  ]);
  return row.rows[0].ok;
}

async function eventFor(invitationId: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string; payload: Record<string, unknown>; status: string }>(
    `select id, payload, status::text as status from public.outbox_events where payload ->> 'invitation_id' = $1`,
    [invitationId],
  );
  return row.rows[0];
}

async function claimedIds(worker: string) {
  await asServiceRole(db);
  const claimed = await db.query<{ events: { id: string }[] }>(`select public.claim_mail_events($1, 50) as events`, [worker]);
  return claimed.rows[0].events.map((event) => event.id);
}

describe("sealed invitation email links", () => {
  it("lets the firm owner attach a staff invitation link, once, and refuses everyone else", async () => {
    const ctx = await firm();
    const other = await firm();
    const { token, invitationId } = await staffInvite(ctx);

    await asAnon(db);
    await expectDbError(() => attach(invitationId, token), /permission denied/);
    for (const userId of [ctx.consultant, ctx.assistant, ctx.client]) {
      await asUser(db, { userId, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
      await expectDbError(() => attach(invitationId, token), /invitation link denied/);
    }
    await asUser(db, { userId: other.owner, aal: "aal2", orgId: other.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => attach(invitationId, token), /invitation link denied/);
    await asUser(db, { userId: ctx.owner, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => attach(invitationId, token), /invitation link denied/);

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => attach(invitationId, token, "not base64!"), /sealed link is invalid/);
    expect(await attach(invitationId, "f".repeat(64))).toBe(false);
    const link = sealed();
    expect(await attach(invitationId, token, link)).toBe(true);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    expect(await attach(invitationId, token)).toBe(false);

    const event = await eventFor(invitationId);
    expect(event.payload.sealed_link).toBe(link);
    expect(JSON.stringify(event.payload)).not.toContain(token);
  });

  it("lets the inviting consultant attach a portal invitation link and refuses an assistant or another firm", async () => {
    const ctx = await firm();
    const other = await firm();
    const { token, invitationId } = await portalInvite(ctx);

    await asUser(db, { userId: ctx.assistant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => attach(invitationId, token), /invitation link denied/);
    await asUser(db, { userId: ctx.client, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => attach(invitationId, token), /invitation link denied/);
    await asUser(db, { userId: other.owner, aal: "aal2", orgId: other.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => attach(invitationId, token), /invitation link denied/);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    expect(await attach(invitationId, token)).toBe(true);
    const event = await eventFor(invitationId);
    expect(typeof event.payload.sealed_link).toBe("string");
  });

  it("does not attach to an event that is no longer pending", async () => {
    const ctx = await firm();
    const { token, invitationId } = await staffInvite(ctx);
    const event = await eventFor(invitationId);
    await db.query(`update public.outbox_events set status = 'published' where id = $1`, [event.id]);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    expect(await attach(invitationId, token)).toBe(false);
    expect((await eventFor(invitationId)).payload.sealed_link).toBeUndefined();
  });

  it("holds an invitation email for its sealed link, then sends without it after 10 minutes", async () => {
    const ctx = await firm();
    const waiting = await staffInvite(ctx);
    const waitingEvent = await eventFor(waiting.invitationId);
    expect(await claimedIds("link-wait")).not.toContain(waitingEvent.id);

    const linked = await staffInvite(ctx);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    expect(await attach(linked.invitationId, linked.token)).toBe(true);
    const linkedEvent = await eventFor(linked.invitationId);
    expect(await claimedIds("link-wait")).toContain(linkedEvent.id);

    await asMaintenance(db);
    await db.query(`update public.outbox_events set occurred_at = now() - interval '11 minutes' where id = $1`, [
      waitingEvent.id,
    ]);
    expect(await claimedIds("link-wait")).toContain(waitingEvent.id);
  });

  it("hands the sealed link to the worker and scrubs it once the delivery is final", async () => {
    const ctx = await firm();
    for (const outcome of ["sent", "terminal_failure"] as const) {
      const { token, invitationId } = await staffInvite(ctx);
      await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
      const link = sealed();
      expect(await attach(invitationId, token, link)).toBe(true);
      const event = await eventFor(invitationId);
      const worker = `scrub-${outcome}`;
      expect(await claimedIds(worker)).toContain(event.id);
      const prepared = await db.query<{
        result: { action: string; messages: { delivery_id: string; context: Record<string, unknown> }[] };
      }>(`select public.prepare_email_delivery($1, $2, null, null) as result`, [event.id, worker]);
      expect(prepared.rows[0].result.action).toBe("send");
      const message = prepared.rows[0].result.messages[0];
      expect(message.context.sealed_link).toBe(link);
      expect(message.context.invitation_id).toBe(invitationId);
      expect(message.context.kind).toBe("staff");

      await db.query(`select public.finish_email_delivery($1, $2, $3, 'provider-msg', null)`, [
        message.delivery_id,
        worker,
        outcome,
      ]);
      await asMaintenance(db);
      const after = await db.query<{ payload: Record<string, unknown>; context: Record<string, unknown> }>(
        `select event.payload, delivery.context
         from public.outbox_events event
         join public.email_deliveries delivery on delivery.outbox_event_id = event.id
         where event.id = $1`,
        [event.id],
      );
      expect(after.rows[0].payload.sealed_link).toBeUndefined();
      expect(after.rows[0].payload.invitation_id).toBe(invitationId);
      expect(after.rows[0].context.sealed_link).toBeUndefined();
    }
  });

  it("scrubs the sealed link when the recipient is suppressed and nothing is sent", async () => {
    const ctx = await firm();
    const address = email("suppressed");
    await asMaintenance(db);
    await db.query(
      `insert into public.email_suppressions (organization_id, recipient_email, reason) values ($1, $2, 'manual')`,
      [ctx.orgId, address],
    );
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const created = await db.query<{ token: string }>(
      `select public.create_staff_invitation($1, $2, 'assistant'::public.org_role) as token`,
      [ctx.orgId, address],
    );
    const token = created.rows[0].token;
    await asMaintenance(db);
    const invitationId = (
      await db.query<{ id: string }>(`select id from public.invitations where organization_id = $1 and email = $2`, [
        ctx.orgId,
        address,
      ])
    ).rows[0].id;
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    expect(await attach(invitationId, token)).toBe(true);
    const event = await eventFor(invitationId);
    expect(await claimedIds("scrub-suppressed")).toContain(event.id);
    const prepared = await db.query<{ result: { action: string } }>(
      `select public.prepare_email_delivery($1, 'scrub-suppressed', null, null) as result`,
      [event.id],
    );
    expect(prepared.rows[0].result.action).toBe("done");
    const after = await eventFor(invitationId);
    expect(after.payload.sealed_link).toBeUndefined();
    const contexts = await db.query<{ context: Record<string, unknown> }>(
      `select context from public.email_deliveries where outbox_event_id = $1`,
      [event.id],
    );
    for (const row of contexts.rows) expect(row.context.sealed_link).toBeUndefined();
  });
});
