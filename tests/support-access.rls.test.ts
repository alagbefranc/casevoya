import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261020170000–20261020170200: support access grants (SEC-04, SEC-09, ADM-04). The admin portal
// asks with the service role; the firm owner approves (step-up), declines, ends or extends
// (step-up); support reads only through support_read_* and every read is logged; grants end on
// their own; the owners are mailed (EX11, EM17). Synthetic people only.

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

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function as(userId: string, orgId: string, stepUp = true) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: stepUp ? 0 : 3600 });
}

async function user(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `${label}-${tag()}@example.test`]);
  return id;
}

async function platformAdmin() {
  const id = await user("admin");
  await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'Synthetic support')`, [id]);
  return id;
}

async function firm() {
  const owner = await user("owner");
  const consultant = await user("consultant");
  const applicantLogin = await user("applicant");
  await as(owner, "");
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.profiles set display_name = 'Dana Owner' where id = $1`, [owner]);
  const consultantMembership = (
    await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
      [orgId, consultant, owner],
    )
  ).rows[0].id;
  await as(owner, orgId);
  const matterId = (
    await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership])
  ).rows[0].result.id;
  await asMaintenance(db);
  const applicant = (
    await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`, [orgId, applicantLogin])
  ).rows[0].id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, applicant]);
  const ownerEmail = (await db.query<{ email: string }>(`select email from auth.users where id = $1`, [owner])).rows[0].email;
  return { orgId, owner, ownerEmail, consultant, matterId, applicant };
}

type Request = { orgId: string; matterId?: string | null; scope?: string; minutes?: number; reason?: string; admin?: string | null; ticket?: string | null };

async function request(input: Request) {
  await asServiceRole(db);
  const row = await db.query<{ id: string }>(
    `select public.create_support_access_request($1, 'Jordan Support', 'jordan@example.test', $2, $3::public.support_access_scope, $4, 'Document contents, messages, finance', $5, $6, $7) as id`,
    [input.orgId, input.ticket === undefined ? "CS-1001" : input.ticket, input.scope ?? "matter_documents", input.matterId ?? null, input.reason ?? "Uploads time out over 20 MB", input.minutes ?? 60, input.admin ?? null],
  );
  return row.rows[0].id;
}

async function status(id: string) {
  await asMaintenance(db);
  return (await db.query<{ status: string; ends_at: string | null; extension_count: number }>(`select status::text, ends_at, extension_count from public.support_access_requests where id = $1`, [id])).rows[0];
}

async function audit(id: string, action: string) {
  await asMaintenance(db);
  return (await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where object_id = $1 and action = $2`, [id, action])).rows;
}

type Page = {
  alert: { id: string; ends_at: string; approved_by_name: string | null; uses: number } | null;
  request: { id: string; requested_minutes: number; ticket_ref: string | null } | null;
  pending: number;
  history: { id: string; status: string; uses: number; approved_by_name: string | null }[];
};

async function page(f: Awaited<ReturnType<typeof firm>>): Promise<Page> {
  await as(f.owner, f.orgId, false);
  return (await db.query<{ page: Page }>(`select public.firm_support_access($1) as page`, [f.orgId])).rows[0].page;
}

/** The mail worker's claim and prepare for one event type, as the service role. */
async function prepared(orgId: string, eventType: string) {
  await asMaintenance(db);
  const event = (await db.query<{ id: string }>(`select id from public.outbox_events where organization_id = $1 and event_type = $2`, [orgId, eventType])).rows[0]?.id;
  expect(event, eventType).toBeDefined();
  await asServiceRole(db);
  const worker = `sa-${tag()}`;
  const claimed = await db.query<{ events: { id: string }[] }>(`select public.claim_mail_events($1, 50) as events`, [worker]);
  expect(claimed.rows[0].events.map((row) => row.id)).toContain(event);
  const result = await db.query<{ result: { action: string; messages: { to: string; template: string; context: Record<string, unknown> }[] } }>(
    `select public.prepare_email_delivery($1, $2, null, null) as result`,
    [event, worker],
  );
  return result.rows[0].result;
}

describe("Support access: the admin portal asks", () => {
  it("creates one pending request per firm with the service role, audits it and mails the owners (EX11)", async () => {
    const f = await firm();
    const id = await request({ orgId: f.orgId, matterId: f.matterId });
    expect((await status(id)).status).toBe("pending");
    expect(await audit(id, "support_access.requested")).toHaveLength(1);
    expect(JSON.stringify((await audit(id, "support_access.requested"))[0].context)).not.toContain("Uploads time out");
    await expectDbError(() => request({ orgId: f.orgId, matterId: f.matterId }), /already waiting/);
    const mail = await prepared(f.orgId, "support_access.requested");
    expect(mail.action).toBe("send");
    expect(mail.messages.map((message) => message.to)).toEqual([f.ownerEmail]);
    expect(mail.messages[0].template).toBe("support_requested");
    expect(mail.messages[0].context).toMatchObject({ minutes: 60, template: "support_requested" });
    expect(JSON.stringify(mail.messages[0].context)).not.toMatch(/Uploads time out|Synthetic matter/);
    const listed = await page(f);
    expect(listed.alert).toBeNull();
    expect(listed.request).toMatchObject({ id, requested_minutes: 60, ticket_ref: "CS-1001" });
    expect(listed.pending).toBe(1);
  });

  it("refuses anyone but the service role, bad input, a matter from another firm and an unknown admin", async () => {
    const f = await firm();
    const other = await firm();
    await as(f.owner, f.orgId);
    await expectDbError(
      () => db.query(`select public.create_support_access_request($1, 'Jordan', null, null, 'firm_settings', null, null, 'Settings check please', 60)`, [f.orgId]),
      /denied|permission denied/,
    );
    await expectDbError(() => request({ orgId: f.orgId, matterId: f.matterId, reason: "short" }), /reason/);
    await expectDbError(() => request({ orgId: f.orgId, matterId: f.matterId, minutes: 500 }), /15 to 240/);
    await expectDbError(() => request({ orgId: f.orgId, matterId: f.matterId, minutes: 5 }), /15 to 240/);
    await expectDbError(() => request({ orgId: f.orgId, matterId: f.matterId, scope: "firm_settings" }), /names no matter/);
    await expectDbError(() => request({ orgId: f.orgId, matterId: null }), /not in the firm/);
    await expectDbError(() => request({ orgId: f.orgId, matterId: other.matterId }), /not in the firm/);
    await expectDbError(() => request({ orgId: f.orgId, matterId: f.matterId, admin: f.owner }), /not a platform admin/);
    await expectDbError(() => request({ orgId: randomUUID(), matterId: null, scope: "firm_settings" }), /denied/);
  });

  it("lets the portal withdraw a pending request, or give an open grant back early", async () => {
    const f = await firm();
    const id = await request({ orgId: f.orgId, matterId: f.matterId });
    await asServiceRole(db);
    await db.query(`select public.cancel_support_access_request($1, 'Resolved another way')`, [id]);
    expect((await status(id)).status).toBe("cancelled");
    expect(await audit(id, "support_access.cancelled")).toHaveLength(1);
    const again = await request({ orgId: f.orgId, matterId: f.matterId });
    await as(f.owner, f.orgId);
    await db.query(`select public.approve_support_access_request($1)`, [again]);
    await asServiceRole(db);
    await db.query(`select public.cancel_support_access_request($1, null)`, [again]);
    expect((await status(again)).status).toBe("ended");
    expect((await audit(again, "support_access.ended"))[0].context).toMatchObject({ by: "support" });
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.cancel_support_access_request($1, null)`, [again]), /already closed/);
    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(`select public.cancel_support_access_request($1, null)`, [again]), /denied|permission denied/);
  });
});

describe("Support access: the firm owner decides", () => {
  it("approves with a step-up: starts now, ends after the requested minutes, audited, EM17 to the owners", async () => {
    const f = await firm();
    const id = await request({ orgId: f.orgId, matterId: f.matterId, minutes: 45 });
    await as(f.owner, f.orgId, false);
    await expectDbError(() => db.query(`select public.approve_support_access_request($1)`, [id]), /step-up/);
    await as(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.approve_support_access_request($1)`, [id]), /step-up|denied/);
    const other = await firm();
    await as(other.owner, other.orgId);
    await expectDbError(() => db.query(`select public.approve_support_access_request($1)`, [id]), /step-up|denied/);
    await as(f.owner, f.orgId);
    const ends = (await db.query<{ ends: string }>(`select public.approve_support_access_request($1) as ends`, [id])).rows[0].ends;
    const minutes = (new Date(ends).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(44);
    expect(minutes).toBeLessThanOrEqual(45.1);
    expect((await status(id)).status).toBe("approved");
    expect((await audit(id, "support_access.approved"))[0].context).toMatchObject({ minutes: 45, scope: "matter_documents" });
    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(`select public.approve_support_access_request($1)`, [id]), /no longer waiting/);
    const mail = await prepared(f.orgId, "support_access.approved");
    expect(mail.messages.map((message) => message.to)).toEqual([f.ownerEmail]);
    expect(mail.messages[0].template).toBe("support_granted");
    expect(mail.messages[0].context).toMatchObject({ minutes: 45, approver: "Dana Owner", time_zone: "America/Toronto" });
    expect(typeof mail.messages[0].context.ends_at).toBe("string");
    const listed = await page(f);
    expect(listed.alert).toMatchObject({ id, approved_by_name: "Dana Owner", uses: 0 });
    expect(listed.request).toBeNull();
    expect(listed.history).toEqual([]);
  });

  it("declines with a reason (owner at aal2, no step-up), and refuses others and a second decision", async () => {
    const f = await firm();
    const id = await request({ orgId: f.orgId, matterId: f.matterId });
    await as(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.decline_support_access_request($1, 'Not now')`, [id]), /denied/);
    await as(f.owner, f.orgId, false);
    await expectDbError(() => db.query(`select public.decline_support_access_request($1, 'x')`, [id]), /reason/);
    await db.query(`select public.decline_support_access_request($1, 'Not needed, the upload works now')`, [id]);
    expect((await status(id)).status).toBe("declined");
    const [event] = await audit(id, "support_access.declined");
    expect(event.context).toMatchObject({ reason_length: 32 });
    expect(JSON.stringify(event.context)).not.toContain("upload works");
    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(`select public.approve_support_access_request($1)`, [id]), /no longer waiting/);
    const listed = await page(f);
    expect(listed.request).toBeNull();
    expect(listed.history).toMatchObject([{ id, status: "declined", uses: 0, approved_by_name: null }]);
  });

  it("extends by 30 minutes with a step-up up to 240 minutes in all, and ends now without one", async () => {
    const f = await firm();
    const id = await request({ orgId: f.orgId, matterId: f.matterId, minutes: 60 });
    await as(f.owner, f.orgId);
    await db.query(`select public.approve_support_access_request($1)`, [id]);
    const before = (await status(id)).ends_at!;
    await as(f.owner, f.orgId, false);
    await expectDbError(() => db.query(`select public.extend_support_access($1)`, [id]), /step-up/);
    await as(f.owner, f.orgId);
    const ends = (await db.query<{ ends: string }>(`select public.extend_support_access($1) as ends`, [id])).rows[0].ends;
    expect(new Date(ends).getTime() - new Date(before).getTime()).toBe(30 * 60_000);
    expect((await status(id)).extension_count).toBe(1);
    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(`select public.extend_support_access($1, 200)`, [id]), /240 minutes in all/);
    await expectDbError(() => db.query(`select public.extend_support_access($1, 2)`, [id]), /5 to 240/);
    await db.query(`select public.extend_support_access($1, 150)`, [id]);
    expect((await audit(id, "support_access.extended")).map((row) => row.context.total_minutes)).toEqual([90, 240]);
    await as(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.end_support_access($1)`, [id]), /denied/);
    await as(f.owner, f.orgId, false);
    await db.query(`select public.end_support_access($1)`, [id]);
    expect((await status(id)).status).toBe("ended");
    expect((await audit(id, "support_access.ended"))[0].context).toMatchObject({ by: "firm" });
    await as(f.owner, f.orgId, false);
    await expectDbError(() => db.query(`select public.end_support_access($1)`, [id]), /already ended/);
    const listed = await page(f);
    expect(listed.alert).toBeNull();
    expect(listed.history).toMatchObject([{ id, status: "ended", approved_by_name: "Dana Owner" }]);
  });

  it("reads: the owner sees the firm's rows, a platform admin only the requests they made, other staff nothing", async () => {
    const f = await firm();
    const admin = await platformAdmin();
    const stranger = await platformAdmin();
    const id = await request({ orgId: f.orgId, matterId: f.matterId, admin });
    const rows = async () => (await db.query<{ id: string }>(`select id from public.support_access_requests`)).rows.map((row) => row.id);
    await as(f.owner, f.orgId, false);
    expect(await rows()).toEqual([id]);
    await as(f.consultant, f.orgId);
    expect(await rows()).toEqual([]);
    await asUser(db, { userId: admin, aal: "aal2", orgId: null, totpAgeSeconds: 0 });
    expect(await rows()).toEqual([id]);
    await asUser(db, { userId: admin, aal: "aal1", orgId: null });
    expect(await rows()).toEqual([]);
    await asUser(db, { userId: stranger, aal: "aal2", orgId: null, totpAgeSeconds: 0 });
    expect(await rows()).toEqual([]);
    await expectDbError(() => db.query(`select public.firm_support_access($1)`, [f.orgId]), /denied/);
    await as(f.owner, f.orgId, false);
    await expectDbError(() => db.query(`update public.support_access_requests set status = 'approved' where id = $1`, [id]), /permission denied|violates/);
  });
});

describe("Support access: what support opens, and only how", () => {
  it("reads a covered matter through support_read_matter, logs each use for the firm, and refuses the rest", async () => {
    const f = await firm();
    const other = await firm();
    const admin = await platformAdmin();
    const stranger = await platformAdmin();
    const id = await request({ orgId: f.orgId, matterId: f.matterId, scope: "matter_documents", admin });
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.support_read_matter($1, $2)`, [id, f.matterId]), /not open/);
    await as(f.owner, f.orgId);
    await db.query(`select public.approve_support_access_request($1)`, [id]);

    await asServiceRole(db);
    const summary = (await db.query<{ s: Record<string, unknown> }>(`select public.support_read_matter($1, $2) as s`, [id, f.matterId])).rows[0].s;
    expect(summary).toMatchObject({ request_id: id, scope: "matter_documents", matter: { id: f.matterId, title: "Synthetic matter" }, documents: [] });
    expect(summary).not.toHaveProperty("participants");
    await expectDbError(() => db.query(`select public.support_read_matter($1, $2)`, [id, other.matterId]), /denied/);
    await expectDbError(() => db.query(`select public.support_read_firm_settings($1)`, [id]), /does not cover/);

    // The named platform admin at aal2 may read too; a stranger and the firm's own staff may not.
    await asUser(db, { userId: admin, aal: "aal2", orgId: null, totpAgeSeconds: 0 });
    await db.query(`select public.support_read_matter($1, $2)`, [id, f.matterId]);
    await asUser(db, { userId: stranger, aal: "aal2", orgId: null, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.support_read_matter($1, $2)`, [id, f.matterId]), /denied/);
    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(`select public.support_read_matter($1, $2)`, [id, f.matterId]), /denied/);
    // Nor may the admin read the matter directly: no policy opens it.
    await asUser(db, { userId: admin, aal: "aal2", orgId: null, totpAgeSeconds: 0 });
    expect((await db.query(`select id from public.matters where id = $1`, [f.matterId])).rows).toEqual([]);
    expect((await db.query(`select id from public.matter_participants where matter_id = $1`, [f.matterId])).rows).toEqual([]);

    await asMaintenance(db);
    const uses = await db.query<{ actor_user_id: string | null; action: string; object_id: string }>(`select actor_user_id, action, object_id from public.support_access_uses where request_id = $1 order by occurred_at`, [id]);
    expect(uses.rows).toMatchObject([{ actor_user_id: null, action: "support_read_matter", object_id: f.matterId }, { actor_user_id: admin, action: "support_read_matter" }]);
    expect(await db.query(`select 1 from public.audit_log where organization_id = $1 and action = 'support_access.used'`, [f.orgId])).toMatchObject({ rows: [{}, {}] });
    await expectDbError(() => db.query(`delete from public.support_access_uses where request_id = $1`, [id]), /retained/);
    await expectDbError(() => db.query(`update public.support_access_uses set action = 'x' where request_id = $1`, [id]), /append only/);
    // The firm sees the uses: on the alert while open, in the history once ended.
    expect((await page(f)).alert).toMatchObject({ id, uses: 2 });
    await as(f.owner, f.orgId, false);
    await db.query(`select public.end_support_access($1)`, [id]);
    expect((await page(f)).history).toMatchObject([{ id, status: "ended", uses: 2 }]);
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.support_read_matter($1, $2)`, [id, f.matterId]), /not open/);
  });

  it("maps scopes: records, all, firm settings; and app.support_access_active answers for a future policy", async () => {
    const f = await firm();
    const id = await request({ orgId: f.orgId, matterId: f.matterId, scope: "matter_all" });
    await as(f.owner, f.orgId);
    await db.query(`select public.approve_support_access_request($1)`, [id]);
    await asServiceRole(db);
    const summary = (await db.query<{ s: Record<string, unknown> }>(`select public.support_read_matter($1, $2) as s`, [id, f.matterId])).rows[0].s;
    expect(summary).toMatchObject({ documents: [], tasks: expect.any(Array), deadlines: [] });
    expect(summary.participants).toEqual(expect.arrayContaining([{ role: "applicant", kind: "person", name: "Synthetic applicant" }, { role: "consultant", kind: "staff", name: null }]));
    const active = async (scope: string, matter: string | null) =>
      (await db.query<{ ok: boolean }>(`select app.support_access_active($1, $2, $3::public.support_access_scope) as ok`, [f.orgId, matter, scope])).rows[0].ok;
    expect(await active("matter_documents", f.matterId)).toBe(true);
    expect(await active("matter_records", f.matterId)).toBe(true);
    expect(await active("matter_all", f.matterId)).toBe(true);
    expect(await active("firm_settings", null)).toBe(false);
    expect(await active("matter_all", randomUUID())).toBe(false);
    await db.query(`select public.cancel_support_access_request($1, null)`, [id]);
    expect(await active("matter_all", f.matterId)).toBe(false);

    const settings = await request({ orgId: f.orgId, matterId: null, scope: "firm_settings" });
    await as(f.owner, f.orgId);
    await db.query(`select public.approve_support_access_request($1)`, [settings]);
    await asServiceRole(db);
    const firmSummary = (await db.query<{ s: Record<string, unknown> }>(`select public.support_read_firm_settings($1) as s`, [settings])).rows[0].s;
    expect(firmSummary).toMatchObject({ firm: { id: f.orgId, display_name: "Synthetic Firm", timezone: "America/Toronto" }, seats: { firm_owner: 1, licensed_consultant: 1 } });
    await expectDbError(() => db.query(`select public.support_read_matter($1, $2)`, [settings, f.matterId]), /does not cover/);
    expect(await active("firm_settings", null)).toBe(true);
  });
});

describe("Support access: it ends on its own", () => {
  it("treats a grant past its end as expired everywhere, and the job marks and audits it", async () => {
    const f = await firm();
    const id = await request({ orgId: f.orgId, matterId: f.matterId, minutes: 15 });
    await as(f.owner, f.orgId);
    await db.query(`select public.approve_support_access_request($1)`, [id]);
    await asMaintenance(db);
    await db.query(`update public.support_access_requests set starts_at = now() - interval '40 minutes', ends_at = now() - interval '25 minutes' where id = $1`, [id]);
    expect((await page(f)).alert).toBeNull();
    expect((await page(f)).history).toMatchObject([{ id, status: "expired" }]);
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.support_read_matter($1, $2)`, [id, f.matterId]), /not open/);
    expect((await db.query<{ ok: boolean }>(`select app.support_access_active($1, $2, 'matter_documents') as ok`, [f.orgId, f.matterId])).rows[0].ok).toBe(false);
    expect((await db.query<{ n: number }>(`select app.expire_support_access() as n`)).rows[0].n).toBe(1);
    expect((await status(id)).status).toBe("expired");
    expect(await audit(id, "support_access.expired")).toHaveLength(1);
    expect((await db.query<{ n: number }>(`select app.expire_support_access() as n`)).rows[0].n).toBe(0);
    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(`select public.extend_support_access($1)`, [id]), /already ended/);
    await expectDbError(() => db.query(`select public.end_support_access($1)`, [id]), /already ended/);
    // A new request may follow once the old one is decided.
    await request({ orgId: f.orgId, matterId: f.matterId });
  });

  it("shows a waiting request to the firm's owners in Sheet > Notifications, read once decided", async () => {
    const f = await firm();
    const id = await request({ orgId: f.orgId, matterId: f.matterId });
    const items = async () => (await db.query<{ items: { id: string; kind: string; subject: string; detail: string; href: string; read: boolean }[] }>(`select public.staff_notifications($1, 50) as items`, [f.orgId])).rows[0].items;
    await as(f.owner, f.orgId, false);
    const [item] = (await items()).filter((row) => row.kind === "support");
    expect(item).toMatchObject({ id, subject: expect.stringMatching(/^[A-Z]{2}-\d{4}-\d{4}$/), detail: "60", href: "/sheet/grants?tab=support", read: false });
    await as(f.consultant, f.orgId);
    expect((await items()).filter((row) => row.kind === "support")).toEqual([]);
    await as(f.owner, f.orgId, false);
    await db.query(`select public.decline_support_access_request($1, 'Not now, thanks')`, [id]);
    expect((await items()).filter((row) => row.kind === "support")[0]).toMatchObject({ id, read: true });
  });
});
