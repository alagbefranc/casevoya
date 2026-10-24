import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// ORG-06 (20261024120100_consultant_change_notice.sql): changing a matter's responsible consultant
// tells the people on it with a portal account (portal notice + EX17 mail event), and staff see who
// first. Everything here is synthetic.

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

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

async function setup() {
  const owner = await createUser("owner", "Synthetic Owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  const first = await membership(orgId, await createUser("first", "Sam First"), "licensed_consultant");
  const second = await membership(orgId, await createUser("second", "Dana Second"), "licensed_consultant");
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  for (const member of [first, second]) {
    const licence = (
      await db.query<{ id: string }>(`select public.add_consultant_licence($1, 'RCIC'::public.licence_type, $2) as id`, [member, `R${tag().slice(0, 7).toUpperCase()}`])
    ).rows[0].id;
    await db.query(
      `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, $3, null)`,
      [licence, REGISTER, PROOF],
    );
  }
  const clientUser = await createUser("client", "Casey Client");
  await membership(orgId, clientUser, "client");
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  const client = (
    await db.query<{ id: string }>(`insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Casey Client', 'casey@example.test') returning id`, [
      orgId,
      clientUser,
    ])
  ).rows[0].id;
  const noPortal = (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, email) values ($1, 'Jordan NoPortal', 'jordan@example.test') returning id`, [orgId])).rows[0]
    .id;
  const matter = randomUUID();
  await db.query(`insert into public.matters (id, organization_id, title, responsible_consultant_membership_id) values ($1, $2, 'Spousal sponsorship', $3)`, [matter, orgId, first]);
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`, [
    orgId,
    matter,
    client,
    noPortal,
  ]);
  const version = (await db.query<{ version: number }>(`select version from public.matters where id = $1`, [matter])).rows[0].version;
  return { owner, orgId, first, second, clientUser, client, matter, version };
}

describe("consultant change notice", () => {
  it("shows staff who would be told: only people with a portal account", async () => {
    const ctx = await setup();
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const audience = (await db.query<{ a: unknown }>(`select public.consultant_change_audience($1) as a`, [ctx.matter])).rows[0].a;
    expect(audience).toEqual([{ person_id: ctx.client, name: "Casey Client", role: "applicant", emailed: true }]);
    await asUser(db, { userId: ctx.clientUser, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.consultant_change_audience($1)`, [ctx.matter]), /denied/);
  });

  it("changes the consultant, leaves a portal notice and queues one EX17 mail event", async () => {
    const ctx = await setup();
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const out = (await db.query<{ r: Record<string, number> }>(`select public.change_responsible_consultant($1, $2, $3) as r`, [ctx.matter, ctx.second, ctx.version])).rows[0].r;
    expect(out).toMatchObject({ told: 1, emailed: 1 });
    await asMaintenance(db);
    expect((await db.query<{ c: string }>(`select responsible_consultant_membership_id as c from public.matters where id = $1`, [ctx.matter])).rows[0].c).toBe(ctx.second);
    const events = await db.query<{ payload: Record<string, unknown> }>(`select payload from public.outbox_events where event_type = 'matter.consultant_changed' and aggregate_id = $1`, [ctx.matter]);
    expect(events.rows.map((row) => row.payload)).toEqual([{ matter_id: ctx.matter }]);
    const audit = await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where action = 'matter.consultant_change_notified' and object_id = $1`, [ctx.matter]);
    expect(audit.rows[0].context).toMatchObject({ to_membership_id: ctx.second, told: 1, emailed: 1 });

    // The client sees it, can dismiss it, and then it is gone.
    await asUser(db, { userId: ctx.clientUser, aal: "aal1", orgId: ctx.orgId });
    const notices = (await db.query<{ n: { id: string; consultant_name: string; matter_title: string }[] }>(`select public.portal_notices_for_me($1) as n`, [ctx.orgId])).rows[0].n;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: "consultant_changed", consultant_name: "Dana Second", matter_title: "Spousal sponsorship" });
    await expectDbError(() => db.query(`select * from public.portal_notices`), /permission denied/);
    await db.query(`select public.dismiss_portal_notice($1)`, [notices[0].id]);
    expect((await db.query<{ n: unknown[] }>(`select public.portal_notices_for_me($1) as n`, [ctx.orgId])).rows[0].n).toEqual([]);
  });

  it("the mail worker sends EX17 to the portal person only, with nothing about the matter", async () => {
    const ctx = await setup();
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.change_responsible_consultant($1, $2, $3)`, [ctx.matter, ctx.second, ctx.version]);
    await asServiceRole(db);
    const claimed = (
      await db.query<{ c: { id: string; event_type: string; payload: Record<string, unknown> }[] }>(`select public.claim_mail_events('test-worker', 50) as c`)
    ).rows[0].c.filter((row) => row.event_type === "matter.consultant_changed" && row.payload.matter_id === ctx.matter);
    expect(claimed).toHaveLength(1);
    const prepared = (await db.query<{ p: { action: string; messages: { to: string; template: string; context: Record<string, unknown> }[] } }>(
      `select public.prepare_email_delivery($1, 'test-worker') as p`,
      [claimed[0].id],
    )).rows[0].p;
    expect(prepared.action).toBe("send");
    expect(prepared.messages.map((message) => [message.to, message.template])).toEqual([["casey@example.test", "consultant_changed"]]);
    expect(JSON.stringify(prepared.messages[0].context)).not.toMatch(/Dana|Spousal/);
  });

  it("needs a fresh step-up to change, and tells nobody when nothing changes", async () => {
    const ctx = await setup();
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(() => db.query(`select public.change_responsible_consultant($1, $2, $3)`, [ctx.matter, ctx.second, ctx.version]), /step|recent|confirm|two-step/i);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const same = (await db.query<{ r: Record<string, number> }>(`select public.change_responsible_consultant($1, $2, $3) as r`, [ctx.matter, ctx.first, ctx.version])).rows[0].r;
    expect(same).toMatchObject({ told: 0 });
    await asAnon(db);
    await expectDbError(() => db.query(`select public.portal_notices_for_me($1)`, [ctx.orgId]), /permission denied/);
  });
});
