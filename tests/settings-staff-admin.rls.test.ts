import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { firmDay } from "./helpers/firm-day";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// 20261019217000_settings_staff_admin.sql: change role, suspend / reactivate, offboarding (preview
// and the one-transaction move) and the continuity contact. Synthetic people only.

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

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

async function createUser(label: string, name?: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${tag()}@example.test`]);
  if (name) await db.query(`update public.profiles set display_name = $2 where id = $1`, [id, name]);
  return id;
}

async function member(orgId: string, userId: string, role: string, status = "active") {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, suspended_at)
     values ($1, $2, $3::public.org_role, $4::public.membership_status, now(), case when $4 = 'suspended' then now() end) returning id`,
    [orgId, userId, role, status],
  );
  return row.rows[0].id;
}

async function session(userId: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.sessions (id, user_id) values ($1, $2)`, [id, userId]);
  return id;
}

async function firm() {
  const owner = await createUser("owner", "Dana Owner");
  const consultant = await createUser("consultant", "Sam Consultant");
  const other = await createUser("other", "Lee Other");
  const manager = await createUser("manager", "Kim Manager");
  await as(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const ownerMembership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner])).rows[0].id;
  const consultantMembership = await member(orgId, consultant, "licensed_consultant");
  const otherMembership = await member(orgId, other, "licensed_consultant");
  const managerMembership = await member(orgId, manager, "case_manager");
  return { orgId, owner, ownerMembership, consultant, consultantMembership, other, otherMembership, manager, managerMembership };
}
type Firm = Awaited<ReturnType<typeof firm>>;

async function verifiedLicence(f: Firm, membershipId: string) {
  await as(f.owner, f.orgId);
  const id = (
    await db.query<{ id: string }>(`select public.add_consultant_licence($1, 'RCIC'::public.licence_type, $2) as id`, [membershipId, `R${tag().slice(0, 7).toUpperCase()}`])
  ).rows[0].id;
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, $3, null)`,
    [id, REGISTER, PROOF],
  );
  return id;
}

async function matterFor(f: Firm, consultantMembership: string) {
  await as(f.owner, f.orgId);
  const created = await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership]);
  return created.rows[0].result.id;
}

async function taskFor(f: Firm, matterId: string, ownerMembership: string, title = "Synthetic task") {
  await as(f.owner, f.orgId);
  const row = await db.query<{ id: string }>(
    `select public.create_task($1, 'internal'::public.task_audience, $2, $3, null, 'normal'::public.task_priority, $4::date, null, 'America/Toronto', null, null, '[]'::jsonb) as id`,
    [matterId, title, ownerMembership, firmDay(7)],
  );
  return row.rows[0].id;
}

async function status(id: string) {
  await asMaintenance(db);
  return (await db.query<{ status: string; role: string }>(`select status::text, role::text from public.memberships where id = $1`, [id])).rows[0];
}

async function audits(orgId: string, action: string) {
  await asMaintenance(db);
  return (await db.query<{ context: Record<string, unknown>; object_id: string }>(`select context, object_id from public.audit_log where organization_id = $1 and action = $2`, [orgId, action])).rows;
}

describe("change_staff_role", () => {
  it("lets the owner change a role with a step-up, and audits from and to", async () => {
    const f = await firm();
    await as(f.owner, f.orgId);
    await db.query(`select public.change_staff_role($1, $2, 'assistant'::public.org_role)`, [f.orgId, f.managerMembership]);
    expect((await status(f.managerMembership)).role).toBe("assistant");
    const rows = await audits(f.orgId, "membership.role_changed");
    expect(rows[0].context).toMatchObject({ from: "case_manager", to: "assistant" });
  });

  it("refuses a non-owner, a stale step-up, another firm, yourself, the same role and a non-staff role", async () => {
    const f = await firm();
    const call = (role = "assistant", id = f.managerMembership, org = f.orgId) =>
      db.query(`select public.change_staff_role($1, $2, $3::public.org_role)`, [org, id, role]);
    await as(f.consultant, f.orgId);
    await expectDbError(() => call(), /firm owner step-up/);
    await as(f.owner, f.orgId, false);
    await expectDbError(() => call(), /firm owner step-up/);
    const b = await firm();
    await as(b.owner, b.orgId);
    await expectDbError(() => call("assistant", f.managerMembership, b.orgId), /not found/);
    await expectDbError(() => call("assistant", f.managerMembership, f.orgId), /firm owner step-up/);
    await as(f.owner, f.orgId);
    await expectDbError(() => call("case_manager", f.ownerMembership), /your own/);
    await expectDbError(() => call("case_manager"), /already have that role/);
    await expectDbError(() => call("client"), /staff role/);
    expect((await status(f.managerMembership)).role).toBe("case_manager");
  });

  it("protects the last firm owner, also at the table", async () => {
    const f = await firm();
    await asMaintenance(db);
    await expectDbError(
      () => db.query(`update public.memberships set role = 'case_manager' where id = $1`, [f.ownerMembership]),
      /last firm owner/,
    );
    // A second owner can be demoted by the first; the first can't demote themselves.
    const second = await createUser("second");
    const secondMembership = await member(f.orgId, second, "firm_owner");
    await as(f.owner, f.orgId);
    await db.query(`select public.change_staff_role($1, $2, 'case_manager'::public.org_role)`, [f.orgId, secondMembership]);
    expect((await status(secondMembership)).role).toBe("case_manager");
    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(`select public.change_staff_role($1, $2, 'case_manager'::public.org_role)`, [f.orgId, f.ownerMembership]), /your own/);
  });

  it("keeps a consultant of record licensed until their matters move", async () => {
    const f = await firm();
    await matterFor(f, f.consultantMembership);
    await as(f.owner, f.orgId);
    await expectDbError(
      () => db.query(`select public.change_staff_role($1, $2, 'case_manager'::public.org_role)`, [f.orgId, f.consultantMembership]),
      /move their matters/,
    );
    // Without matters, a consultant may become a case manager.
    await db.query(`select public.change_staff_role($1, $2, 'case_manager'::public.org_role)`, [f.orgId, f.otherMembership]);
    expect((await status(f.otherMembership)).role).toBe("case_manager");
  });

  it("refuses a direct table write", async () => {
    const f = await firm();
    await as(f.owner, f.orgId);
    await expectDbError(() => db.query(`update public.memberships set role = 'assistant' where id = $1`, [f.managerMembership]), /permission denied|membership changes/);
  });
});

describe("set_staff_suspended", () => {
  it("suspends with a step-up, ends every session with revocation rows and a cut-off, and reactivates", async () => {
    const f = await firm();
    const s1 = await session(f.manager);
    const s2 = await session(f.manager);
    const keep = await session(f.owner);
    await as(f.owner, f.orgId);
    const ended = await db.query<{ n: number }>(`select public.set_staff_suspended($1, $2, true) as n`, [f.orgId, f.managerMembership]);
    expect(ended.rows[0].n).toBe(2);
    expect((await status(f.managerMembership)).status).toBe("suspended");
    await asMaintenance(db);
    const revoked = await db.query<{ session_id: string; reason: string; revoked_by: string }>(
      `select session_id, reason, revoked_by from public.session_revocations where user_id = $1 order by session_id`,
      [f.manager],
    );
    expect(revoked.rows.map((row) => row.session_id).sort()).toEqual([s1, s2].sort());
    expect(revoked.rows.every((row) => row.reason === "suspended" && row.revoked_by === f.owner)).toBe(true);
    expect((await db.query(`select 1 from public.auth_session_cutoffs where user_id = $1`, [f.manager])).rows.length).toBe(1);
    expect((await db.query(`select 1 from auth.sessions where user_id = $1`, [f.manager])).rows.length).toBe(0);
    expect((await db.query(`select 1 from auth.sessions where id = $1`, [keep])).rows.length).toBe(1);
    const audit = await audits(f.orgId, "membership.suspended");
    expect(audit[0].context).toMatchObject({ sessions: 2 });

    // A token issued before the cut-off no longer passes staff MFA.
    await asUser(db, { userId: f.manager, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 0, issuedAtSeconds: Math.floor(Date.now() / 1000) - 3600 });
    const mfa = await db.query<{ ok: boolean }>(`select public.session_mfa_satisfied() as ok`);
    expect(mfa.rows[0].ok).toBe(false);

    await as(f.owner, f.orgId);
    await db.query(`select public.set_staff_suspended($1, $2, false)`, [f.orgId, f.managerMembership]);
    expect((await status(f.managerMembership)).status).toBe("active");
    expect((await audits(f.orgId, "membership.reactivated")).length).toBe(1);
  });

  it("refuses yourself, a non-owner, a stale step-up, another firm, and a wrong starting state", async () => {
    const f = await firm();
    const call = (suspend = true, id = f.managerMembership, org = f.orgId) => db.query(`select public.set_staff_suspended($1, $2, $3)`, [org, id, suspend]);
    await as(f.owner, f.orgId);
    await expectDbError(() => call(true, f.ownerMembership), /your own/);
    await expectDbError(() => call(false), /only a suspended/);
    await as(f.consultant, f.orgId);
    await expectDbError(() => call(), /firm owner step-up/);
    await as(f.owner, f.orgId, false);
    await expectDbError(() => call(), /firm owner step-up/);
    const b = await firm();
    await as(b.owner, b.orgId);
    await expectDbError(() => call(true, f.managerMembership, b.orgId), /not found/);
    expect((await status(f.managerMembership)).status).toBe("active");
  });

  it("never suspends the last active owner at the table", async () => {
    const f = await firm();
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.memberships set status = 'suspended' where id = $1`, [f.ownerMembership]), /last firm owner/);
  });
});

describe("offboarding", () => {
  async function seeded() {
    const f = await firm();
    await verifiedLicence(f, f.otherMembership);
    const recordMatter = await matterFor(f, f.consultantMembership);
    const otherMatter = await matterFor(f, f.otherMembership);
    const t1 = await taskFor(f, recordMatter, f.consultantMembership, "Review employment letter");
    const t2 = await taskFor(f, otherMatter, f.consultantMembership, "Call notes");
    const keep = await taskFor(f, otherMatter, f.managerMembership, "Not theirs");
    await asMaintenance(db);
    const deadline = (
      await db.query<{ id: string }>(
        `insert into public.deadlines (organization_id, matter_id, task_id, kind, label, due_on, timezone) values ($1, $2, $3, 'internal', 'Biometrics', $4::date, 'America/Toronto') returning id`,
        [f.orgId, recordMatter, t1, firmDay(14)],
      )
    ).rows[0].id;
    await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [
      f.orgId,
      otherMatter,
      f.consultantMembership,
    ]);
    await db.query(
      `insert into public.staff_connections (organization_id, membership_id, toolkit, connected_account_id, status) values ($1, $2, 'googlecalendar', 'ca_synthetic', 'active')`,
      [f.orgId, f.consultantMembership],
    );
    const s1 = await session(f.consultant);
    return { f, recordMatter, otherMatter, t1, t2, keep, deadline, s1 };
  }

  it("previews what moves, with matter labels and no client names", async () => {
    const { f } = await seeded();
    await as(f.owner, f.orgId, false);
    const preview = await db.query<{ p: Record<string, unknown> }>(`select public.staff_offboarding_preview($1, $2) as p`, [f.orgId, f.consultantMembership]);
    const p = preview.rows[0].p as { tasks: unknown[]; deadlines: { label: string }[]; authority: { authorities: number }[]; assignments: number; sessions: number; connections: number };
    expect(p.tasks.length).toBe(2);
    expect(p.deadlines.map((row) => row.label)).toEqual(["Biometrics"]);
    expect(p.authority.length).toBe(1);
    expect(p.assignments).toBe(1);
    expect(p.sessions).toBe(1);
    expect(p.connections).toBe(1);
    await as(f.consultant, f.orgId);
    await expectDbError(() => db.query(`select public.staff_offboarding_preview($1, $2)`, [f.orgId, f.managerMembership]), /denied/);
  });

  it("moves tasks, deadlines, assignments and authority to a verified consultant, then revokes access and sessions, in one go", async () => {
    const { f, recordMatter, otherMatter, t1, t2, keep, deadline, s1 } = await seeded();
    await as(f.owner, f.orgId);
    const out = await db.query<{ r: Record<string, number> }>(`select public.offboard_staff_member($1, $2, $3) as r`, [f.orgId, f.consultantMembership, f.otherMembership]);
    expect(out.rows[0].r).toMatchObject({ tasks: 2, deadlines: 1, assignments: 1, authority: 1, review_tasks: 1, connections: 1, memberships: 1, sessions: 1 });

    await asMaintenance(db);
    const tasks = await db.query<{ id: string; owner: string }>(`select id, owner_membership_id as owner from public.tasks where id = any($1::uuid[])`, [[t1, t2, keep]]);
    const owners = new Map(tasks.rows.map((row) => [row.id, row.owner]));
    expect(owners.get(t1)).toBe(f.otherMembership);
    expect(owners.get(t2)).toBe(f.otherMembership);
    expect(owners.get(keep)).toBe(f.managerMembership);
    const events = await db.query(`select 1 from public.task_events where task_id = any($1::uuid[]) and event_kind = 'reassigned'`, [[t1, t2]]);
    expect(events.rows.length).toBe(2);
    const dl = await db.query<{ task_id: string; label: string }>(`select task_id, label from public.deadlines where id = $1`, [deadline]);
    expect(dl.rows[0]).toEqual({ task_id: t1, label: "Biometrics" });

    const matter = await db.query<{ responsible: string }>(`select responsible_consultant_membership_id as responsible from public.matters where id = $1`, [recordMatter]);
    expect(matter.rows[0].responsible).toBe(f.otherMembership);
    const parties = await db.query<{ membership_id: string; role: string; matter_id: string }>(
      `select membership_id, role::text, matter_id from public.matter_participants where membership_id = any($1::uuid[]) and matter_id = any($2::uuid[])`,
      [[f.consultantMembership, f.otherMembership], [recordMatter, otherMatter]],
    );
    expect(parties.rows.some((row) => row.membership_id === f.consultantMembership)).toBe(false);
    expect(parties.rows.filter((row) => row.matter_id === recordMatter && row.role === "consultant").map((row) => row.membership_id)).toEqual([f.otherMembership]);
    expect(parties.rows.some((row) => row.matter_id === otherMatter && row.role === "case_manager" && row.membership_id === f.otherMembership)).toBe(true);
    const review = await db.query<{ title: string; priority: string; owner: string }>(
      `select title, priority::text, owner_membership_id as owner from public.tasks where matter_id = $1 and title like 'Review client authority%'`,
      [recordMatter],
    );
    expect(review.rows).toEqual([{ title: "Review client authority after consultant change", priority: "high", owner: f.otherMembership }]);

    expect((await status(f.consultantMembership)).status).toBe("revoked");
    const revoked = await db.query<{ reason: string }>(`select reason from public.session_revocations where user_id = $1 and session_id = $2`, [f.consultant, s1]);
    expect(revoked.rows[0].reason).toBe("offboarded");
    const connection = await db.query<{ status: string }>(`select status from public.staff_connections where membership_id = $1`, [f.consultantMembership]);
    expect(connection.rows[0].status).toBe("disconnected");
    const audit = await audits(f.orgId, "membership.offboarded");
    expect(audit[0].context).toMatchObject({ tasks: 2, authority: 1, sessions: 1 });
  });

  it("changes nothing when the receiver can't take client authority", async () => {
    const { f, t1 } = await seeded();
    await as(f.owner, f.orgId);
    await expectDbError(
      () => db.query(`select public.offboard_staff_member($1, $2, $3)`, [f.orgId, f.consultantMembership, f.managerMembership]),
      /verified licence/,
    );
    await asMaintenance(db);
    const task = await db.query<{ owner: string }>(`select owner_membership_id as owner from public.tasks where id = $1`, [t1]);
    expect(task.rows[0].owner).toBe(f.consultantMembership);
    expect((await status(f.consultantMembership)).status).toBe("active");
    expect((await db.query(`select 1 from auth.sessions where user_id = $1`, [f.consultant])).rows.length).toBe(1);
  });

  it("lets a non-consultant hand their work to a case manager", async () => {
    const f = await firm();
    const matter = await matterFor(f, f.otherMembership);
    const assistant = await createUser("assistant");
    const assistantMembership = await member(f.orgId, assistant, "assistant");
    const t = await taskFor(f, matter, assistantMembership);
    await as(f.owner, f.orgId);
    const out = await db.query<{ r: Record<string, number> }>(`select public.offboard_staff_member($1, $2, $3) as r`, [f.orgId, assistantMembership, f.managerMembership]);
    expect(out.rows[0].r).toMatchObject({ tasks: 1, authority: 0, review_tasks: 0 });
    await asMaintenance(db);
    expect((await db.query<{ owner: string }>(`select owner_membership_id as owner from public.tasks where id = $1`, [t])).rows[0].owner).toBe(f.managerMembership);
  });

  it("refuses a non-owner, a stale step-up, another firm, yourself, a receiver who is them or inactive", async () => {
    const f = await firm();
    const call = (id: string, to: string, org = f.orgId) => db.query(`select public.offboard_staff_member($1, $2, $3)`, [org, id, to]);
    await as(f.manager, f.orgId);
    await expectDbError(() => call(f.otherMembership, f.managerMembership), /firm owner step-up/);
    await as(f.owner, f.orgId, false);
    await expectDbError(() => call(f.managerMembership, f.ownerMembership), /firm owner step-up/);
    await as(f.owner, f.orgId);
    await expectDbError(() => call(f.ownerMembership, f.managerMembership), /your own/);
    await expectDbError(() => call(f.managerMembership, f.managerMembership), /active team member/);
    const suspendedUser = await createUser("suspended");
    const suspended = await member(f.orgId, suspendedUser, "case_manager", "suspended");
    await as(f.owner, f.orgId);
    await expectDbError(() => call(f.managerMembership, suspended), /active team member/);
    const b = await firm();
    await as(b.owner, b.orgId);
    await expectDbError(() => call(f.managerMembership, b.managerMembership, b.orgId), /not found/);
    await expectDbError(() => call(b.managerMembership, f.managerMembership, b.orgId), /active team member/);
    expect((await status(f.managerMembership)).status).toBe("active");
  });
});

describe("set_firm_continuity", () => {
  it("saves the contact and succession note with a step-up, audits field names only, and clears", async () => {
    const f = await firm();
    await as(f.owner, f.orgId);
    await db.query(`select public.set_firm_continuity($1, 'Pat Backup', 'Pat@Example.test', 'Pat takes over client files if I can''t practise.')`, [f.orgId]);
    await asMaintenance(db);
    const row = await db.query(`select continuity_contact_name, continuity_contact_email, succession_note from public.organizations where id = $1`, [f.orgId]);
    expect(row.rows[0]).toEqual({
      continuity_contact_name: "Pat Backup",
      continuity_contact_email: "pat@example.test",
      succession_note: "Pat takes over client files if I can't practise.",
    });
    const audit = await audits(f.orgId, "firm.continuity_changed");
    expect(audit[0].context).toEqual({ fields: ["continuity_contact_name", "continuity_contact_email", "succession_note"] });
    expect(JSON.stringify(audit[0].context)).not.toContain("Pat");
    await as(f.owner, f.orgId);
    await db.query(`select public.set_firm_continuity($1, '', '', '')`, [f.orgId]);
    await asMaintenance(db);
    const cleared = await db.query(`select continuity_contact_name, succession_note from public.organizations where id = $1`, [f.orgId]);
    expect(cleared.rows[0]).toEqual({ continuity_contact_name: null, succession_note: null });
  });

  it("refuses a non-owner, a stale step-up, another firm, a bad email and an email without a name", async () => {
    const f = await firm();
    const call = (name: string, email: string, org = f.orgId) => db.query(`select public.set_firm_continuity($1, $2, $3, null)`, [org, name, email]);
    await as(f.consultant, f.orgId);
    await expectDbError(() => call("Pat", ""), /firm owner step-up/);
    await as(f.owner, f.orgId, false);
    await expectDbError(() => call("Pat", ""), /firm owner step-up/);
    const b = await firm();
    await as(b.owner, b.orgId);
    await expectDbError(() => call("Pat", "", f.orgId), /firm owner step-up/);
    await as(f.owner, f.orgId);
    await expectDbError(() => call("Pat", "not-an-email"), /not usable/);
    await expectDbError(() => call("", "pat@example.test"), /needs a name/);
  });
});
