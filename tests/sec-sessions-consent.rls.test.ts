import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { VO_VENDOR_TERMS } from "@/modules/vo/vendor-terms";
import { idlePhase, readActivityState } from "@/modules/security/idle";

// The activity route's Supabase client, backed by the PGlite database below (#262 contract test).
const route = vi.hoisted(() => ({
  userId: "",
  signedOut: 0,
  rpc: (async () => ({ data: null, error: null })) as (name: string, args: { p_active: boolean }) => Promise<{ data: unknown; error: unknown }>,
}));
vi.mock("@/lib/env", async (original) => ({ ...(await original<typeof import("@/lib/env")>()), hasPublicSupabaseEnv: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: route.userId } } }),
      signOut: async () => {
        route.signedOut += 1;
        return { error: null };
      },
    },
    rpc: (name: string, args: { p_active: boolean }) => route.rpc(name, args),
  }),
}));
const { POST: postActivity } = await import("@/app/api/session/activity/route");

/** What the idle guard does: post to the route and read the JSON body. */
async function post(active: boolean): Promise<unknown> {
  const response = await postActivity(
    new Request("https://app.casevoya.ca/api/session/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://app.casevoya.ca" },
      body: JSON.stringify({ active }),
    }),
  );
  return response.json();
}

/**
 * 20261025270000 / 20261025270100 (SEC-01, SEC-05) against the real migrations: the firm's idle
 * sign-out time (owner with step-up, audited) and its server-side enforcement per session; client
 * two-step state, the high-risk check and the staff-assisted reset; consent withdrawal opening an
 * impact review and task, the staff review (history, mark done), tenant isolation, and Vo skipping
 * a client who hasn't said yes to AI drafting (20261028150000, decision #263-3: no record, a no or a
 * withdrawn yes). Synthetic data only.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb({ supabaseDefaultPrivileges: true });
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().slice(0, 8);

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [id, `${label}-${tag()}@example.test`]);
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

async function session(userId: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.sessions (id, user_id, aal) values ($1, $2, 'aal2')`, [id, userId]);
  return id;
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
  const ownerMembership = (await (async () => {
    await asMaintenance(db);
    return db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, owner]);
  })()).rows[0].id;
  const consultant = await createUser("consultant");
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant");
  const manager = await createUser("manager");
  await membership(orgId, manager, "case_manager");
  const assistant = await createUser("assistant");
  await membership(orgId, assistant, "assistant");
  const clientUser = await createUser("client");
  await membership(orgId, clientUser, "client");
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  const matter = await db.query<{ id: string }>(
    `insert into public.matters (organization_id, title, responsible_consultant_membership_id) values ($1, 'Synthetic matter', $2) returning id`,
    [orgId, consultantMembership],
  );
  const matterId = matter.rows[0].id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [
    orgId,
    matterId,
    consultantMembership,
  ]);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, user_id, display_name) values ($1, $2, 'Synthetic Applicant') returning id`,
    [orgId, clientUser],
  );
  const personId = person.rows[0].id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, personId]);
  return { orgId, owner, ownerMembership, consultant, consultantMembership, manager, assistant, clientUser, matterId, personId };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const staff = (f: Firm, userId: string, totpAgeSeconds = 60, sessionId?: string) =>
  asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds, sessionId });
const client = (f: Firm, sessionId?: string, aal: "aal1" | "aal2" = "aal1", totpAgeSeconds?: number) =>
  asUser(db, { userId: f.clientUser, aal, orgId: f.orgId, sessionId, totpAgeSeconds });

async function audit(orgId: string, action: string) {
  await asMaintenance(db);
  return (await db.query<{ context: Record<string, unknown>; object_id: string }>(`select context, object_id from public.audit_log where organization_id = $1 and action = $2 order by occurred_at`, [orgId, action])).rows;
}

describe("SEC-01 idle timeout", () => {
  it("is 30 minutes by default; only the firm owner with a fresh step-up changes it, audited", async () => {
    const f = await firm();
    await asMaintenance(db);
    expect((await db.query<{ m: number }>(`select staff_idle_timeout_minutes as m from public.organizations where id = $1`, [f.orgId])).rows[0].m).toBe(30);

    await staff(f, f.consultant, 0);
    await expectDbError(() => db.query(`select public.set_staff_idle_timeout($1, 5)`, [f.orgId]), /firm owner step-up/);
    await staff(f, f.owner, 20 * 60);
    await expectDbError(() => db.query(`select public.set_staff_idle_timeout($1, 5)`, [f.orgId]), /firm owner step-up/);
    await staff(f, f.owner, 0);
    await expectDbError(() => db.query(`select public.set_staff_idle_timeout($1, 4)`, [f.orgId]), /5 to 480/);
    await expectDbError(() => db.query(`select public.set_staff_idle_timeout($1, 481)`, [f.orgId]), /5 to 480/);
    expect((await db.query<{ m: number }>(`select public.set_staff_idle_timeout($1, 5) as m`, [f.orgId])).rows[0].m).toBe(5);
    const rows = await audit(f.orgId, "security.idle_timeout_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0].context).toMatchObject({ from_minutes: 30, to_minutes: 5 });

    // Another firm's owner can't change it.
    const other = await firm();
    await staff(other, other.owner, 0);
    await expectDbError(() => db.query(`select public.set_staff_idle_timeout($1, 60)`, [f.orgId]), /firm owner step-up/);
  });

  it("records activity per session and ends an idle session on the server", async () => {
    const f = await firm();
    const sid = await session(f.consultant);
    await staff(f, f.consultant, 60, sid);
    const first = (await db.query<{ r: Record<string, unknown> }>(`select public.record_staff_activity(true) as r`)).rows[0].r;
    expect(first).toMatchObject({ state: "active", timeout_minutes: 30 });

    // Nobody reads the activity table directly.
    await expectDbError(() => db.query(`select * from public.staff_session_activity`), /permission denied/);

    // 31 minutes without activity: the next check ends the session.
    await asMaintenance(db);
    await db.query(`update public.staff_session_activity set last_active_at = now() - interval '31 minutes' where session_id = $1`, [sid]);
    await staff(f, f.consultant, 60, sid);
    const ended = (await db.query<{ r: Record<string, unknown> }>(`select public.record_staff_activity(false) as r`)).rows[0].r;
    expect(ended).toMatchObject({ state: "expired", timeout_minutes: 30 });
    await asMaintenance(db);
    expect((await db.query(`select 1 from auth.sessions where id = $1`, [sid])).rows).toHaveLength(0);
    expect((await db.query<{ reason: string }>(`select reason from public.session_revocations where session_id = $1`, [sid])).rows[0].reason).toBe("idle");
    expect(await audit(f.orgId, "session.idle_signed_out")).toHaveLength(1);

    // The revoked token no longer satisfies staff MFA, so tenant reads stop.
    await staff(f, f.consultant, 60, sid);
    expect((await db.query<{ ok: boolean }>(`select app.staff_mfa_satisfied() as ok`)).rows[0].ok).toBe(false);
    expect((await db.query<{ r: Record<string, unknown> }>(`select public.record_staff_activity(true) as r`)).rows[0].r).toMatchObject({ state: "ended" });
  });

  it("uses the strictest firm's time, and does nothing for a portal-only person", async () => {
    const f = await firm();
    await staff(f, f.owner, 0);
    await db.query(`select public.set_staff_idle_timeout($1, 10)`, [f.orgId]);
    const sid = await session(f.consultant);
    await staff(f, f.consultant, 60, sid);
    expect((await db.query<{ r: Record<string, unknown> }>(`select public.record_staff_activity(true) as r`)).rows[0].r).toMatchObject({ timeout_minutes: 10 });
    // Active again within the time: still signed in.
    await asMaintenance(db);
    await db.query(`update public.staff_session_activity set last_active_at = now() - interval '9 minutes' where session_id = $1`, [sid]);
    await staff(f, f.consultant, 60, sid);
    expect((await db.query<{ r: Record<string, unknown> }>(`select public.record_staff_activity(true) as r`)).rows[0].r).toMatchObject({ state: "active" });

    const clientSid = await session(f.clientUser);
    await client(f, clientSid);
    expect((await db.query<{ r: Record<string, unknown> }>(`select public.record_staff_activity(true) as r`)).rows[0].r).toMatchObject({ state: "none" });
  });

  // #262: the browser's idle guard reads the activity route's JSON with readActivityState. The
  // route used to send the camelCase ActivityState, which read as "none", so no timer ever started.
  // This runs the real route against the real public.record_staff_activity and reads its answer
  // exactly as the idle guard does.
  it("the activity route's answer starts the browser's timer, warns before sign-out, and Stay signed in resets it", async () => {
    const f = await firm();
    await staff(f, f.owner, 0);
    await db.query(`select public.set_staff_idle_timeout($1, 5)`, [f.orgId]);
    const sid = await session(f.consultant);
    route.rpc = async (_name, args) => {
      await staff(f, f.consultant, 60, sid);
      const r = (await db.query<{ r: unknown }>(`select public.record_staff_activity($1) as r`, [args.p_active])).rows[0].r;
      return { data: r, error: null };
    };
    route.userId = f.consultant;

    const first = readActivityState(await post(false));
    expect(first).toEqual({ state: "active", timeoutMinutes: 5, idleSeconds: 0 });
    if (first.state !== "active") return;

    // The guard's clock: 3 minutes 30 seconds idle on a 5-minute time is inside the 2-minute warning.
    const start = Date.now() - first.idleSeconds * 1000;
    expect(idlePhase(start, start + 2 * 60_000, first.timeoutMinutes).phase).toBe("active");
    expect(idlePhase(start, start + 210_000, first.timeoutMinutes)).toEqual({ phase: "warn", secondsLeft: 90 });

    // Stay signed in: activity goes to the server, and the idle time starts again from zero.
    await asMaintenance(db);
    await db.query(`update public.staff_session_activity set last_active_at = now() - interval '210 seconds' where session_id = $1`, [sid]);
    const idle = readActivityState(await post(false));
    expect(idle).toMatchObject({ state: "active", timeoutMinutes: 5 });
    if (idle.state !== "active") return;
    expect(idle.idleSeconds).toBeGreaterThanOrEqual(210);
    expect(idlePhase(Date.now() - idle.idleSeconds * 1000, Date.now(), idle.timeoutMinutes).phase).toBe("warn");
    const stayed = readActivityState(await post(true));
    expect(stayed).toEqual({ state: "active", timeoutMinutes: 5, idleSeconds: 0 });

    // Past the time: the route answers expired and the guard leaves for sign-in.
    await asMaintenance(db);
    await db.query(`update public.staff_session_activity set last_active_at = now() - interval '6 minutes' where session_id = $1`, [sid]);
    expect(readActivityState(await post(false))).toEqual({ state: "expired", timeoutMinutes: 5 });
    expect(route.signedOut).toBe(1);
  });
});

describe("SEC-01 client two-step", () => {
  async function verifiedFactor(userId: string) {
    await asMaintenance(db);
    await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', 'verified')`, [randomUUID(), userId]);
  }

  it("reports the state, gates high-risk actions on a fresh check, and records only what Auth holds", async () => {
    const f = await firm();
    await client(f);
    expect((await db.query<{ s: string }>(`select public.my_two_step_state() as s`)).rows[0].s).toBe("off");
    expect((await db.query<{ ok: boolean }>(`select app.client_step_up_satisfied() as ok`)).rows[0].ok).toBe(false);
    await expectDbError(() => db.query(`select public.record_my_two_step(true)`), /does not match/);

    await verifiedFactor(f.clientUser);
    await client(f);
    expect((await db.query<{ s: string }>(`select public.my_two_step_state() as s`)).rows[0].s).toBe("needs_check");
    expect((await db.query<{ ok: boolean }>(`select app.client_step_up_satisfied() as ok`)).rows[0].ok).toBe(false);
    expect((await db.query<{ s: string }>(`select public.record_my_two_step(true) as s`)).rows[0].s).toBe("on");
    expect(await audit(f.orgId, "mfa.client_enabled")).toHaveLength(1);

    await client(f, undefined, "aal2", 30);
    expect((await db.query<{ s: string }>(`select public.my_two_step_state() as s`)).rows[0].s).toBe("ok");
    expect((await db.query<{ ok: boolean }>(`select app.client_step_up_satisfied() as ok`)).rows[0].ok).toBe(true);

    // Staff can't record a client's two-step change.
    await staff(f, f.consultant);
    await expectDbError(() => db.query(`select public.record_my_two_step(true)`), /two-step change denied/);
  });

  it("is reset only by staff who can read the person, with a step-up and how identity was verified", async () => {
    const f = await firm();
    await verifiedFactor(f.clientUser);
    const sid = await session(f.clientUser);

    await staff(f, f.assistant, 0);
    await expectDbError(() => db.query(`select public.reset_client_two_step($1, $2, 'Video call with photo ID')`, [f.orgId, f.personId]), /staff access denied/);
    await staff(f, f.manager, 0);
    // Not assigned to the matter, so can't read the person.
    await expectDbError(() => db.query(`select public.reset_client_two_step($1, $2, 'Video call with photo ID')`, [f.orgId, f.personId]), /reset denied/);
    await staff(f, f.consultant, 20 * 60);
    await expectDbError(() => db.query(`select public.reset_client_two_step($1, $2, 'Video call with photo ID')`, [f.orgId, f.personId]), /step-up/);
    await staff(f, f.consultant, 0);
    await expectDbError(() => db.query(`select public.reset_client_two_step($1, $2, 'ok')`, [f.orgId, f.personId]), /verified who the client is/);

    const id = (await db.query<{ id: string }>(`select public.reset_client_two_step($1, $2, 'Video call with photo ID', 'Lost phone') as id`, [f.orgId, f.personId])).rows[0].id;
    await asMaintenance(db);
    expect((await db.query(`select 1 from auth.mfa_factors where user_id = $1`, [f.clientUser])).rows).toHaveLength(0);
    expect((await db.query(`select 1 from auth.sessions where id = $1`, [sid])).rows).toHaveLength(0);
    const rows = await audit(f.orgId, "mfa.client_reset");
    expect(rows).toHaveLength(1);
    expect(rows[0].object_id).toBe(id);
    expect(JSON.stringify(rows[0].context)).not.toContain("Video call");

    // The reset is visible to the consultant, not to the other firm.
    await staff(f, f.consultant);
    expect((await db.query(`select id from public.client_mfa_resets`)).rows).toHaveLength(1);
    const other = await firm();
    await staff(other, other.owner);
    expect((await db.query(`select id from public.client_mfa_resets`)).rows).toHaveLength(0);
    await staff(other, other.owner, 0);
    await expectDbError(() => db.query(`select public.reset_client_two_step($1, $2, 'Video call with photo ID')`, [f.orgId, f.personId]), /staff access denied/);
  });

  it("never resets a staff member's two-step from a client record", async () => {
    const f = await firm();
    await asMaintenance(db);
    const staffPerson = await db.query<{ id: string }>(`insert into public.persons (organization_id, user_id, display_name) values ($1, $2, 'Staff as client') returning id`, [f.orgId, f.manager]);
    await staff(f, f.owner, 0);
    await expectDbError(
      () => db.query(`select public.reset_client_two_step($1, $2, 'Video call with photo ID')`, [f.orgId, staffPerson.rows[0].id]),
      /Team and seats/,
    );
  });
});

describe("SEC-05 consent withdrawal impact review", () => {
  it("saves the client's choice at once and opens a review with a task listing what is affected", async () => {
    const f = await firm();
    await client(f);
    expect((await db.query<{ r: Record<string, unknown> }>(`select public.set_my_consent('ai_drafting', true) as r`)).rows[0].r).toMatchObject({ granted: true, changed: true, review_id: null });
    expect((await db.query<{ r: Record<string, unknown> }>(`select public.my_consents() as r`)).rows[0].r).toMatchObject({ ai_drafting: true, marketing: null });
    const off = (await db.query<{ r: { review_id: string } }>(`select public.set_my_consent('ai_drafting', false) as r`)).rows[0].r;
    expect(off.review_id).toBeTruthy();
    // Unchanged: nothing new.
    expect((await db.query<{ r: Record<string, unknown> }>(`select public.set_my_consent('ai_drafting', false) as r`)).rows[0].r).toMatchObject({ changed: false });
    await expectDbError(() => db.query(`select public.set_my_consent('portal_terms', false)`), /not changed here/);

    await asMaintenance(db);
    const review = (await db.query<{ source: string; status: string; impacts: string[]; task_id: string; consent_purpose: string }>(
      `select source, status, impacts, task_id, consent_purpose from public.consent_impact_reviews where id = $1`,
      [off.review_id],
    )).rows[0];
    expect(review).toMatchObject({ source: "portal", status: "open", consent_purpose: "ai_drafting" });
    expect(review.impacts[0]).toMatch(/Vo no longer reads/);
    const task = (await db.query<{ title: string; priority: string; owner_membership_id: string; person_id: string; checklist: { text: string; done: boolean }[] }>(
      `select title, priority, owner_membership_id, person_id, checklist from public.tasks where id = $1`,
      [review.task_id],
    )).rows[0];
    expect(task).toMatchObject({ priority: "high", owner_membership_id: f.consultantMembership, person_id: f.personId });
    expect(task.title).toBe("Consent withdrawn (AI drafting): review the impact");
    expect(task.checklist.map((item) => item.text)).toEqual(review.impacts);
    expect(await audit(f.orgId, "consent.withdrawn")).toHaveLength(1);
    expect(await audit(f.orgId, "consent.impact_review_opened")).toHaveLength(1);
  });

  it("opens a review when the contact choices turn a channel off, and not when they stay the same", async () => {
    const f = await firm();
    await asMaintenance(db);
    await db.query(`update public.persons set contact_phone = '+15145550100' where id = $1`, [f.personId]);
    await client(f);
    await db.query(`select public.save_my_contact_preferences(true, true, true, 'en-CA')`);
    await db.query(`select public.save_my_contact_preferences(true, true, true, 'en-CA')`);
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.consent_impact_reviews where person_id = $1`, [f.personId])).rows).toHaveLength(0);
    await client(f);
    await db.query(`select public.save_my_contact_preferences(true, false, true, 'en-CA')`);
    await asMaintenance(db);
    const rows = (await db.query<{ consent_purpose: string }>(`select consent_purpose from public.consent_impact_reviews where person_id = $1`, [f.personId])).rows;
    expect(rows.map((row) => row.consent_purpose)).toEqual(["contact_sms"]);
  });

  it("explains retention when core processing is withdrawn, and deletes nothing", async () => {
    const f = await firm();
    await client(f);
    await db.query(`select public.set_my_consent('processing', true)`);
    const off = (await db.query<{ r: { review_id: string } }>(`select public.set_my_consent('processing', false) as r`)).rows[0].r;
    await asMaintenance(db);
    const impacts = (await db.query<{ impacts: string[] }>(`select impacts from public.consent_impact_reviews where id = $1`, [off.review_id])).rows[0].impacts;
    expect(impacts.join(" ")).toMatch(/retention period and under any legal hold; nothing is deleted/);
    expect((await db.query(`select 1 from public.persons where id = $1`, [f.personId])).rows).toHaveLength(1);
    expect((await db.query(`select 1 from public.matters where id = $1`, [f.matterId])).rows).toHaveLength(1);
    expect((await db.query(`select 1 from public.consent_records where person_id = $1 and purpose = 'processing'`, [f.personId])).rows).toHaveLength(2);
  });

  it("lets staff who can read the person see the history and mark the review done with a note", async () => {
    const f = await firm();
    await client(f);
    await db.query(`select public.set_my_consent('marketing', true)`);
    const off = (await db.query<{ r: { review_id: string } }>(`select public.set_my_consent('marketing', false) as r`)).rows[0].r;

    // The client can't read reviews or the staff overview.
    expect((await db.query(`select id from public.consent_impact_reviews`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.person_consent_overview($1, $2)`, [f.orgId, f.personId]), /consent review denied/);

    // A case manager not on the matter and an assistant can't either.
    await staff(f, f.manager);
    expect((await db.query(`select id from public.consent_impact_reviews`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.complete_consent_review($1, 1, 'Removed from list')`, [off.review_id]), /consent review denied/);
    await staff(f, f.assistant);
    await expectDbError(() => db.query(`select public.person_consent_overview($1, $2)`, [f.orgId, f.personId]), /consent review denied/);

    await staff(f, f.consultant);
    const overview = (await db.query<{ r: { history: { purpose: string; granted: boolean }[]; reviews: { id: string; status: string }[]; portal: boolean; two_step: boolean } }>(
      `select public.person_consent_overview($1, $2) as r`,
      [f.orgId, f.personId],
    )).rows[0].r;
    expect(overview.history.map((row) => [row.purpose, row.granted])).toEqual([
      ["marketing", false],
      ["marketing", true],
    ]);
    expect(overview.reviews).toHaveLength(1);
    expect(overview).toMatchObject({ portal: true, two_step: false });

    await expectDbError(() => db.query(`select public.complete_consent_review($1, 1, 'no')`, [off.review_id]), /3 to 2000/);
    await expectDbError(() => db.query(`select public.complete_consent_review($1, 7, 'Removed from list')`, [off.review_id]), /version conflict/);
    expect((await db.query<{ v: number }>(`select public.complete_consent_review($1, 1, 'Removed from the firm newsletter list') as v`, [off.review_id])).rows[0].v).toBe(2);
    await expectDbError(() => db.query(`select public.complete_consent_review($1, 2, 'Again')`, [off.review_id]), /already done/);

    await asMaintenance(db);
    const done = (await db.query<{ status: string; done_note: string; task_id: string }>(`select status, done_note, task_id from public.consent_impact_reviews where id = $1`, [off.review_id])).rows[0];
    expect(done).toMatchObject({ status: "done", done_note: "Removed from the firm newsletter list" });
    expect((await db.query<{ status: string }>(`select status from public.tasks where id = $1`, [done.task_id])).rows[0].status).toBe("done");
    const rows = await audit(f.orgId, "consent.impact_review_done");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].context)).not.toContain("newsletter");

    // Another firm sees nothing.
    const other = await firm();
    await staff(other, other.owner);
    expect((await db.query(`select id from public.consent_impact_reviews`)).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.person_consent_overview($1, $2)`, [f.orgId, f.personId]), /consent review denied/);
  });

  it("opens a review when a privacy request withdraws a consent (staff)", async () => {
    const f = await firm();
    await client(f);
    await db.query(`select public.set_my_consent('ai_drafting', true)`);
    await asMaintenance(db);
    const consent = (await db.query<{ id: string }>(`select id from public.consent_records where person_id = $1 and purpose = 'ai_drafting' and granted`, [f.personId])).rows[0].id;
    await db.query(`update public.consent_records set withdrawn_at = now() where id = $1`, [consent]);
    const review = (await db.query<{ source: string }>(`select source from public.consent_impact_reviews where consent_record_id = $1`, [consent])).rows[0];
    expect(review.source).toBe("staff");
  });
});

/** A clean document of the firm's client on the matter, with Vo turned on by the owner. */
async function voDocument(f: Firm) {
  await asMaintenance(db);
  const doc = await db.query<{ id: string }>(
    `insert into public.documents (organization_id, person_id, purpose, sensitivity, audience, created_by)
     values ($1, $2, 'Passport bio page', 'ordinary', 'subject', $3) returning id`,
    [f.orgId, f.personId, f.clientUser],
  );
  const version = await db.query<{ id: string }>(
    `insert into public.document_versions (
       organization_id, document_id, version_number, storage_key, original_filename, declared_media_type,
       declared_byte_size, upload_state, intent_expires_at, created_by
     ) values ($1, $2, 1, $3, 'passport.pdf', 'application/pdf', 1000, 'clean', now() + interval '1 hour', $4) returning id`,
    [f.orgId, doc.rows[0].id, `${f.orgId}/${randomUUID()}/passport.pdf`, f.clientUser],
  );
  await db.query(`insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by) values ($1, $2, $3, $4)`, [
    f.orgId,
    doc.rows[0].id,
    f.matterId,
    f.clientUser,
  ]);
  await staff(f, f.owner);
  // AI-06: the owner acknowledges the AI vendor terms before Vo can be turned on.
  await db.query(`select public.acknowledge_vo_vendor_terms($1, $2)`, [f.orgId, VO_VENDOR_TERMS.version]);
  await db.query(`select public.set_vo_settings($1, $2::jsonb)`, [f.orgId, JSON.stringify({ enabled: true, read_identity: true })]);
  return version.rows[0].id;
}

async function readWithVo(f: Firm, versionId: string) {
  await staff(f, f.consultant, 60);
  return (await db.query<{ r: { ok: boolean; error?: string; person_id?: string } }>(`select public.begin_vo_document_review($1, $2) as r`, [f.orgId, versionId])).rows[0].r;
}

describe("SEC-05 Vo skips a client who declines AI drafting", () => {
  it("returns client_ai_off for that client's document", async () => {
    const f = await firm();
    const versionId = await voDocument(f);

    await client(f);
    await db.query(`select public.set_my_consent('ai_drafting', false)`);
    expect(await readWithVo(f, versionId)).toEqual({ ok: false, error: "client_ai_off", person_id: f.personId });

    await client(f);
    await db.query(`select public.set_my_consent('ai_drafting', true)`);
    // Consent given again: the client's choice no longer stops Vo (the firm's own switches still apply).
    const next = await readWithVo(f, versionId);
    expect(next.error).not.toBe("client_ai_off");
  });
});

describe("Decision #263-3: Vo reads a client's documents only with their AI consent (opt-in)", () => {
  it("skips a client with no AI drafting record (an existing client, or one without a portal)", async () => {
    const f = await firm();
    const versionId = await voDocument(f);
    await asMaintenance(db);
    expect((await db.query(`select id from public.consent_records where person_id = $1 and purpose = 'ai_drafting'`, [f.personId])).rows).toHaveLength(0);
    expect(await readWithVo(f, versionId)).toEqual({ ok: false, error: "client_ai_off", person_id: f.personId });
    // Nothing was started or counted.
    await asMaintenance(db);
    expect((await db.query(`select id from public.vo_runs where organization_id = $1`, [f.orgId])).rows).toHaveLength(0);
  });

  it("reads once the client said yes", async () => {
    const f = await firm();
    const versionId = await voDocument(f);
    await client(f);
    await db.query(`select public.set_my_consent('ai_drafting', true)`);
    const read = await readWithVo(f, versionId);
    expect(read).toMatchObject({ ok: true });
  });

  it("skips a client whose yes was withdrawn (withdrawn_at set, e.g. by a privacy request)", async () => {
    const f = await firm();
    const versionId = await voDocument(f);
    await client(f);
    await db.query(`select public.set_my_consent('ai_drafting', true)`);
    await asMaintenance(db);
    await db.query(`update public.consent_records set withdrawn_at = now() where person_id = $1 and purpose = 'ai_drafting' and granted`, [f.personId]);
    expect(await readWithVo(f, versionId)).toEqual({ ok: false, error: "client_ai_off", person_id: f.personId });
  });

  it("keeps skipping a client who said no", async () => {
    const f = await firm();
    const versionId = await voDocument(f);
    await client(f);
    await db.query(`select public.set_my_consent('ai_drafting', false)`);
    expect(await readWithVo(f, versionId)).toEqual({ ok: false, error: "client_ai_off", person_id: f.personId });
  });

  // #272: "Read with Vo" asks first, so "Vo is reading" never shows before a consent refusal.
  it("public.vo_document_client_ai_off answers as the reading would, read only, for staff who may read it", async () => {
    const f = await firm();
    const versionId = await voDocument(f);
    const check = async () => (await db.query<{ r: Record<string, unknown> }>(`select public.vo_document_client_ai_off($1, $2) as r`, [f.orgId, versionId])).rows[0].r;
    // No AI drafting record: refused, without a fresh second factor and without starting a run.
    await staff(f, f.consultant, 3600);
    expect(await check()).toEqual({ client_ai_off: true, person_id: f.personId });
    await asMaintenance(db);
    expect((await db.query(`select id from public.vo_runs where organization_id = $1`, [f.orgId])).rows).toHaveLength(0);
    // The client and another firm's staff learn nothing.
    await client(f);
    expect(await check()).toEqual({ client_ai_off: false });
    const other = await firm();
    await staff(other, other.owner);
    expect((await db.query<{ r: unknown }>(`select public.vo_document_client_ai_off($1, $2) as r`, [other.orgId, versionId])).rows[0].r).toEqual({ client_ai_off: false });
    await client(f);
    await db.query(`select public.set_my_consent('ai_drafting', true)`);
    await staff(f, f.consultant);
    expect(await check()).toEqual({ client_ai_off: false });
  });

  it("app.person_declines_ai is true unless the latest record is a yes", async () => {
    const f = await firm();
    await asMaintenance(db);
    const declines = async () => (await db.query<{ d: boolean }>(`select app.person_declines_ai($1, $2) as d`, [f.orgId, f.personId])).rows[0].d;
    expect(await declines()).toBe(true);
    await db.query(
      `insert into public.consent_records (organization_id, person_id, purpose, statement_text, statement_sha256, granted)
       values ($1, $2, 'ai_drafting', 'The firm may use drafting help that a person at the firm reviews before it is used.', repeat('c', 64), true)`,
      [f.orgId, f.personId],
    );
    expect(await declines()).toBe(false);
  });
});
