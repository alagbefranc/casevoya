import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, type TestDb } from "./helpers/postgres";

// CRM-01 (20261024150100_enquiry_staff_email.sql): a web enquiry emails the firm's owners EX18,
// with no enquiry details; practice enquiries don't. Everything here is synthetic.

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

async function setup() {
  await asMaintenance(db);
  const owner = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [owner, `owner-${owner.slice(0, 8)}@example.test`]);
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const slug = `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", slug])).rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  await db.query(
    `insert into public.portal_policy_documents (organization_id, kind, version_label, title, body, body_sha256) values ($1, 'privacy_notice', 'v1', 'Privacy notice', 'Synthetic notice', $2)`,
    [orgId, createHash("sha256").update("Synthetic notice").digest("hex")],
  );
  return { orgId, slug, ownerEmail: `owner-${owner.slice(0, 8)}@example.test` };
}

describe("new enquiry staff email", () => {
  it("queues one lead.enquiry_received, and the worker sends EX18 to the owner with no details", async () => {
    const ctx = await setup();
    await asAnon(db);
    const sent = await db.query<{ r: { ok?: boolean } }>(
      `select public.submit_enquiry($1, 'Wei Zhang', 'wei@example.test', 'email', 'Study', 'China', 'Mandarin', true,
         'Synthetic Firm may use these details to reply to my enquiry', false, null, 'enquiry-v2', 'hosted_page', $2, null) as r`,
      [ctx.slug, randomUUID()],
    );
    expect(sent.rows[0].r).toEqual({ ok: true });
    await asServiceRole(db);
    const claimed = (await db.query<{ c: { id: string; event_type: string; organization_id: string }[] }>(`select public.claim_mail_events('test-worker', 50) as c`)).rows[0].c.filter(
      (row) => row.event_type === "lead.enquiry_received" && row.organization_id === ctx.orgId,
    );
    expect(claimed).toHaveLength(1);
    const prepared = (await db.query<{ p: { action: string; messages: { to: string; template: string; context: Record<string, unknown> }[] } }>(
      `select public.prepare_email_delivery($1, 'test-worker') as p`,
      [claimed[0].id],
    )).rows[0].p;
    expect(prepared.messages.map((message) => [message.to, message.template, message.context.audience])).toEqual([[ctx.ownerEmail, "enquiry_received", "staff"]]);
    expect(JSON.stringify(prepared.messages[0].context)).not.toMatch(/Wei|Study|China|Mandarin|wei@example/);
  });

  it("sends nothing for a staff-entered lead or a practice enquiry", async () => {
    const ctx = await setup();
    await asMaintenance(db);
    const stage = (await db.query<{ id: string }>(`select id from public.lead_stages where organization_id = $1 and kind = 'open' limit 1`, [ctx.orgId])).rows[0].id;
    await db.query(`insert into public.leads (organization_id, display_name, phone, source, stage_id) values ($1, 'Walk In', '555-0100', 'walk_in', $2)`, [ctx.orgId, stage]);
    await db.query(`insert into public.leads (organization_id, display_name, email, source, stage_id, is_sample) values ($1, 'Practice', 'p@example.test', 'web_form', $2, true)`, [ctx.orgId, stage]);
    const events = await db.query(`select 1 from public.outbox_events where organization_id = $1 and event_type = 'lead.enquiry_received'`, [ctx.orgId]);
    expect(events.rows).toHaveLength(0);
  });
});
