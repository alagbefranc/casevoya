import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261102100000–20261102100100: lost two-step device. A staff member (aal1) asks; the firm's other
// owners are mailed (EX21) and notified; an owner (assured, not the person) approves or denies within
// 24 hours; the only owner's request goes to the Casevoya admin queue; the person gets the outcome
// (EX22). Synthetic people only.

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

async function user(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `${label}-${tag()}@example.test`]);
  return id;
}

async function email(id: string) {
  await asMaintenance(db);
  return (await db.query<{ email: string }>(`select email from auth.users where id = $1`, [id])).rows[0].email;
}

async function member(orgId: string, userId: string, role: string, by: string) {
  await asMaintenance(db);
  await db.query(`insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, $3, 'active', now(), $4)`, [orgId, userId, role, by]);
}

async function firm(opts: { secondOwner?: boolean } = {}) {
  const owner = await user("owner");
  const staff = await user("staff");
  await asUser(db, { userId: owner, aal: "aal2", orgId: "" });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.profiles set display_name = 'Dana Owner' where id = $1`, [owner]);
  await db.query(`update public.profiles set display_name = 'Sam Staff' where id = $1`, [staff]);
  await member(orgId, staff, "licensed_consultant", owner);
  let owner2: string | null = null;
  if (opts.secondOwner) {
    owner2 = await user("owner2");
    await member(orgId, owner2, "firm_owner", owner);
  }
  return { orgId, owner, owner2, staff };
}

async function ask(userId: string, orgId: string, reason = "Phone fell in the lake") {
  await asUser(db, { userId, aal: "aal1", orgId });
  return (await db.query<{ id: string }>(`select public.request_mfa_reset($1) as id`, [reason])).rows[0].id;
}

async function decide(userId: string, orgId: string, id: string, approve: boolean, aal: "aal1" | "aal2" = "aal2") {
  await asUser(db, { userId, aal, orgId });
  return (await db.query<{ r: { status: string } }>(`select public.decide_mfa_reset($1, $2, null) as r`, [id, approve])).rows[0].r;
}

async function row(id: string) {
  await asMaintenance(db);
  return (await db.query<{ status: string; route: string; reason: string; expires_at: Date; created_at: Date; decided_by: string | null; factors_cleared_at: Date | null; organization_id: string }>(
    `select status, route, reason, expires_at, created_at, decided_by, factors_cleared_at, organization_id from public.mfa_reset_requests where id = $1`, [id],
  )).rows[0];
}

async function prepared(orgId: string, eventType: string) {
  await asMaintenance(db);
  const event = (await db.query<{ id: string }>(`select id from public.outbox_events where organization_id = $1 and event_type = $2 order by occurred_at desc limit 1`, [orgId, eventType])).rows[0]?.id;
  expect(event, eventType).toBeDefined();
  await asServiceRole(db);
  const worker = `mr-${tag()}`;
  const claimed = await db.query<{ events: { id: string }[] }>(`select public.claim_mail_events($1, 50) as events`, [worker]);
  expect(claimed.rows[0].events.map((e) => e.id)).toContain(event);
  const result = await db.query<{ result: { action: string; messages: { to: string; template: string; from_name: string; context: Record<string, unknown> }[] } }>(
    `select public.prepare_email_delivery($1, $2, null, null) as result`, [event, worker],
  );
  return result.rows[0].result;
}

describe("Lost two-step device: the request", () => {
  it("stores the message, firm, person, 24h expiry and route firm; mails the other owners only (EX21)", async () => {
    const f = await firm({ secondOwner: true });
    const id = await ask(f.staff, f.orgId);
    const r = await row(id);
    expect(r).toMatchObject({ status: "pending", route: "firm", reason: "Phone fell in the lake", organization_id: f.orgId });
    expect(r.expires_at.getTime() - r.created_at.getTime()).toBe(24 * 3600 * 1000);
    const mail = await prepared(f.orgId, "mfa_reset.requested");
    expect(mail.action).toBe("send");
    expect(mail.messages.map((m) => m.to).sort()).toEqual([await email(f.owner), await email(f.owner2!)].sort());
    expect(mail.messages[0]).toMatchObject({ template: "mfa_reset_requested", from_name: "Casevoya" });
    expect(mail.messages[0].context).toMatchObject({ requester: "Sam Staff", status: "pending" });
    expect(JSON.stringify(mail.messages[0].context)).not.toContain("lake");
  });

  it("keeps one open request per person, rate limits new ones, and refuses signed-out and non-staff", async () => {
    const f = await firm();
    const id = await ask(f.staff, f.orgId);
    expect(await ask(f.staff, f.orgId, "again")).toBe(id);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.mfa_reset_requests where requester_user_id = $1`, [f.staff])).rows).toHaveLength(1);
    // Three new requests an hour: deny twice, the fourth new one is refused.
    await decide(f.owner, f.orgId, id, false);
    await decide(f.owner, f.orgId, await ask(f.staff, f.orgId), false);
    await decide(f.owner, f.orgId, await ask(f.staff, f.orgId), false);
    await expectDbError(() => ask(f.staff, f.orgId), /too many reset requests/);
    await asUser(db, { userId: "", aal: "aal1", orgId: "" });
    await expectDbError(() => db.query(`select public.request_mfa_reset('x')`), /sign in required/);
    const outsider = await user("outsider");
    await expectDbError(() => ask(outsider, f.orgId), /for firm staff/);
    await expectDbError(() => ask(f.owner, f.orgId, "x".repeat(2001)), /too long/);
  });

  it("routes the only owner's request to the platform queue, with no firm email", async () => {
    const f = await firm();
    const id = await ask(f.owner, f.orgId);
    expect((await row(id)).route).toBe("platform");
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.outbox_events where aggregate_id = $1 and event_type = 'mfa_reset.requested'`, [id])).rows).toHaveLength(0);
    // The owner cannot see or decide it in the firm (route platform), even with an assured session.
    await expectDbError(() => decide(f.owner, f.orgId, id, true), /not found|own reset/);
  });
});

describe("Lost two-step device: deciding", () => {
  it("lets another owner approve: retires codes, ends sessions, audits, mails the person (EX22)", async () => {
    const f = await firm();
    const id = await ask(f.staff, f.orgId);
    await asMaintenance(db);
    await db.query(`insert into public.mfa_recovery_codes (user_id, code_hash, batch_id) values ($1, repeat('a', 64), gen_random_uuid())`, [f.staff]).catch(() => undefined);
    await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values (gen_random_uuid(), $1, 'totp', 'verified')`, [f.staff]);
    expect((await decide(f.owner, f.orgId, id, true)).status).toBe("approved");
    const r = await row(id);
    expect(r).toMatchObject({ status: "approved", decided_by: f.owner });
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.mfa_recovery_codes where user_id = $1 and retired_at is null`, [f.staff])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.auth_session_cutoffs where user_id = $1`, [f.staff])).rows).toHaveLength(1);
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'mfa.reset_approved'`, [id])).rows).toHaveLength(1);
    const mail = await prepared(f.orgId, "mfa_reset.decided");
    expect(mail.messages.map((m) => m.to)).toEqual([await email(f.staff)]);
    expect(mail.messages[0]).toMatchObject({ template: "mfa_reset_decided", from_name: "Casevoya" });
    expect(mail.messages[0].context).toMatchObject({ status: "approved" });
    // The server then removes the factors (Auth admin API) and completes; only the service role may.
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId });
    await expectDbError(() => db.query(`select public.complete_mfa_reset($1, 1)`, [id]), /permission denied|service role/);
    await asServiceRole(db);
    await db.query(`select public.complete_mfa_reset($1, 1)`, [id]);
    expect((await row(id)).factors_cleared_at).not.toBeNull();
    await asMaintenance(db);
    expect((await db.query(`select 1 from auth.mfa_factors where user_id = $1`, [f.staff])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'mfa.reset_factors_removed'`, [id])).rows).toHaveLength(1);
    // A decided request cannot be decided again.
    await expectDbError(() => decide(f.owner, f.orgId, id, false), /already approved/);
  });

  it("blocks self-approval, staff who are not owners, and an unassured owner session", async () => {
    const f = await firm({ secondOwner: true });
    const id = await ask(f.owner2!, f.orgId);
    expect((await row(id)).route).toBe("firm");
    await expectDbError(() => decide(f.owner2!, f.orgId, id, true), /own reset request/);
    await expectDbError(() => decide(f.staff, f.orgId, id, true), /not found/);
    await expectDbError(() => decide(f.owner, f.orgId, id, true, "aal1"), /assured session/);
    expect((await row(id)).status).toBe("pending");
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.mfa_reset_requests set decided_by = requester_user_id, status = 'approved', decided_at = now() where id = $1`, [id]), /check/);
  });

  it("refuses an expired request and marks it expired", async () => {
    const f = await firm();
    const id = await ask(f.staff, f.orgId);
    await asMaintenance(db);
    await db.query(`update public.mfa_reset_requests set created_at = created_at - interval '25 hours', expires_at = expires_at - interval '25 hours' where id = $1`, [id]);
    expect(await decide(f.owner, f.orgId, id, true)).toMatchObject({ status: "expired", refused: "expired" });
    expect((await row(id)).status).toBe("expired");
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.outbox_events where aggregate_id = $1 and event_type = 'mfa_reset.decided'`, [id])).rows).toHaveLength(0);
    // A new request can be made once the old one expired.
    expect(await ask(f.staff, f.orgId)).not.toBe(id);
  });

  it("RLS: the person and the firm's owners read firm requests; other staff and other firms do not; nobody writes", async () => {
    const f = await firm();
    const g = await firm();
    const id = await ask(f.staff, f.orgId);
    const read = async (userId: string, orgId: string, aal: "aal1" | "aal2" = "aal2") => {
      await asUser(db, { userId, aal, orgId });
      return (await db.query(`select id from public.mfa_reset_requests where id = $1`, [id])).rows.length;
    };
    expect(await read(f.staff, f.orgId, "aal1")).toBe(1);
    expect(await read(f.owner, f.orgId)).toBe(1);
    expect(await read(f.owner, f.orgId, "aal1")).toBe(0);
    expect(await read(g.owner, g.orgId)).toBe(0);
    expect(await read(g.staff, g.orgId)).toBe(0);
    await asUser(db, { userId: f.owner, aal: "aal2", orgId: f.orgId });
    await expectDbError(() => db.query(`update public.mfa_reset_requests set status = 'approved' where id = $1`, [id]), /permission denied/);
    await expectDbError(() => db.query(`insert into public.mfa_reset_requests (organization_id, requester_user_id, requester_role, route) values ($1, $2, 'firm_owner', 'firm')`, [f.orgId, f.owner]), /permission denied/);
    const list = (await db.query<{ id: string; requester_email: string; requester_name: string }>(`select * from public.firm_mfa_resets($1)`, [f.orgId])).rows;
    expect(list.map((x) => x.id)).toEqual([id]);
    expect(list[0].requester_name).toBe("Sam Staff");
    await asUser(db, { userId: g.owner, aal: "aal2", orgId: g.orgId });
    await expectDbError(() => db.query(`select * from public.firm_mfa_resets($1)`, [f.orgId]), /denied/);
    await expectDbError(() => db.query(`select public.decide_mfa_reset($1, true, null)`, [id]), /not found/);
  });

  it("shows a pending request in the other owners' notifications, not the person's", async () => {
    const f = await firm({ secondOwner: true });
    const id = await ask(f.owner2!, f.orgId);
    const kinds = async (userId: string) => {
      await asUser(db, { userId, aal: "aal2", orgId: f.orgId });
      return (await db.query<{ source_id: string; kind: string; href: string; is_read: boolean }>(`select * from app.staff_notification_items($1, 50)`, [f.orgId])).rows.filter((r) => r.kind === "mfa_reset");
    };
    expect(await kinds(f.owner)).toMatchObject([{ source_id: id, href: "/app/two-step-resets", is_read: false }]);
    expect(await kinds(f.owner2!)).toEqual([]);
    expect(await kinds(f.staff)).toEqual([]);
  });
});

describe("Lost two-step device: the Casevoya admin queue", () => {
  it("lists platform requests and lets a platform admin (not the person) decide, service role only", async () => {
    const f = await firm();
    const id = await ask(f.owner, f.orgId);
    const admin = await user("admin");
    await asMaintenance(db);
    await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'Synthetic support')`, [admin]);
    await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'Owner who is also admin')`, [f.owner]);
    await asUser(db, { userId: admin, aal: "aal2", orgId: "" });
    await expectDbError(() => db.query(`select public.platform_mfa_resets('pending', 50, 0)`), /permission denied|service role/);
    await asServiceRole(db);
    const q = (await db.query<{ q: { items: { id: string; firm_name: string }[]; counts: { pending: number } } }>(`select public.platform_mfa_resets('pending', 50, 0) as q`)).rows[0].q;
    expect(q.items.map((i) => i.id)).toContain(id);
    await expectDbError(() => db.query(`select public.platform_decide_mfa_reset($1, true, null, $2)`, [id, f.owner]), /own reset request/);
    await expectDbError(() => db.query(`select public.platform_decide_mfa_reset($1, true, null, $2)`, [id, f.staff]), /platform admin required/);
    const r = (await db.query<{ r: { status: string } }>(`select public.platform_decide_mfa_reset($1, true, 'Confirmed on a video call', $2) as r`, [id, admin])).rows[0].r;
    expect(r.status).toBe("approved");
    expect((await row(id)).decided_by).toBe(admin);
    const mail = await prepared(f.orgId, "mfa_reset.decided");
    expect(mail.messages.map((m) => m.to)).toEqual([await email(f.owner)]);
  });

  it("refuses an expired platform request", async () => {
    const f = await firm();
    const id = await ask(f.owner, f.orgId);
    const admin = await user("admin");
    await asMaintenance(db);
    await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'Synthetic support')`, [admin]);
    await db.query(`update public.mfa_reset_requests set created_at = created_at - interval '25 hours', expires_at = expires_at - interval '25 hours' where id = $1`, [id]);
    await asServiceRole(db);
    const r = (await db.query<{ r: { status: string } }>(`select public.platform_decide_mfa_reset($1, true, null, $2) as r`, [id, admin])).rows[0].r;
    expect(r).toMatchObject({ status: "expired", refused: "expired" });
    expect((await row(id)).status).toBe("expired");
  });
});
