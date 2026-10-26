import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { VO_MODEL } from "../src/modules/vo/prompt";
import { VO_VENDOR_TERMS } from "../src/modules/vo/vendor-terms";

/**
 * 20261025250100_vo_lead_call_drafts.sql against the real migrations (PRD AI-01, AI-06): Vo lead
 * follow-up drafts and call-notes summaries go through the same run record, firm switch,
 * capability switches and limits as every Vo run; no consent to contact means no draft; sources
 * must belong to the run's own lead, consultation or matter; only a person marks a follow-up sent
 * or saves a summary as a note; tenant and role isolation. Everything here is synthetic.
 */
let db: TestDb;

const MODEL = VO_MODEL;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
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
    "Synthetic Legal",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  const consultant = await createUser("consultant");
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant");
  const manager = await createUser("manager");
  const managerMembership = await membership(orgId, manager, "case_manager");
  const finance = await createUser("finance");
  await membership(orgId, finance, "finance_user");
  await asMaintenance(db);
  const matter = await db.query<{ id: string }>(`insert into public.matters (organization_id, title) values ($1, 'Synthetic matter') returning id`, [orgId]);
  const matterId = matter.rows[0].id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [
    orgId,
    matterId,
    consultantMembership,
  ]);
  return { orgId, owner, consultant, consultantMembership, manager, managerMembership, finance, matterId };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const as = (f: Firm, userId: string) => asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 60 });

async function settings(f: Firm, changes: Record<string, boolean>) {
  await as(f, f.owner);
  // AI-06: the owner acknowledges the AI vendor terms before Vo can be turned on.
  if (changes.enabled) await db.query(`select public.acknowledge_vo_vendor_terms($1, $2)`, [f.orgId, VO_VENDOR_TERMS.version]);
  await db.query(`select public.set_vo_settings($1, $2::jsonb)`, [f.orgId, JSON.stringify(changes)]);
}

async function lead(f: Firm, options: { reply?: boolean; marketing?: boolean; email?: string | null } = {}) {
  await as(f, f.manager);
  const row = await db.query<{ id: string }>(
    `select public.create_lead($1, 'Sam Example', $2, null, 'email', 'Work permit', 'Canada', 'English', 'email'::public.lead_source, null, null, null,
       array[]::text[], 'Synthetic enquiry: asked about a work permit renewal.', $3, $4) as id`,
    [f.orgId, options.email === undefined ? "sam@example.test" : options.email, options.reply ?? true, options.marketing ?? false],
  );
  const leadId = row.rows[0].id;
  await asMaintenance(db);
  const note = await db.query<{ id: string }>(`select id from public.lead_notes where lead_id = $1 order by created_at limit 1`, [leadId]);
  return { leadId, noteId: note.rows[0].id };
}

let slot = 0;

/** A consultation booking, inserted directly (the scheduling rules have their own tests). */
async function booking(f: Firm, options: { kind?: string; status?: string; matterId?: string | null; leadId?: string | null; callStarted?: boolean } = {}) {
  await asMaintenance(db);
  await db.query(`set session_replication_role = replica`);
  const id = randomUUID();
  const ref = Array.from({ length: 26 }, (_, n) => "abcdefghijklmnopqrstuvwxyz234567"[(n * 7 + id.charCodeAt(n % 36)) % 32]).join("");
  const status = options.status ?? "completed";
  // Each booking in its own hour, so the host is never double-booked.
  const hours = 2 + 2 * slot++;
  try {
    await db.query(
      `insert into public.bookings (id, organization_id, public_ref, event_type_id, host_membership_id, host_user_id, title, starts_at, ends_at,
         blocked_from, blocked_until, host_time_zone, attendee_time_zone, location_kind, status, confirmed_at, matter_id, source, idempotency_key)
       values ($1, $2, $3, $4, $5, $6, 'Consultation', now() - make_interval(hours => $11), now() - make_interval(hours => $11) + interval '30 minutes',
         now() - make_interval(hours => $11), now() - make_interval(hours => $11) + interval '30 minutes', 'America/Toronto', 'America/Toronto', $7::public.booking_location_kind,
         $8::public.booking_status, now() - interval '1 day', $9, 'staff', $10)`,
      [id, f.orgId, ref, randomUUID(), f.consultantMembership, f.consultant, options.kind ?? "video", status, options.matterId ?? null, `k-${id}`, hours],
    );
    if (options.leadId) {
      await db.query(`insert into public.lead_booking_links (organization_id, lead_id, booking_id) values ($1, $2, $3)`, [f.orgId, options.leadId, id]);
    }
    if (options.callStarted) {
      await db.query(`insert into public.video_sessions (organization_id, booking_id, room_name, status, started_at) values ($1, $2, $3, 'ended', now() - interval '2 hours')`, [
        f.orgId,
        id,
        `cv-${id.replaceAll("-", "")}`,
      ]);
    }
  } finally {
    await db.query(`set session_replication_role = origin`);
  }
  return id;
}

type Begun = { ok: boolean; error?: string; run_id?: string; draft_id?: string; marketing?: boolean; lead_id?: string | null; matter_id?: string | null };

async function beginLead(f: Firm, leadId: string) {
  const row = await db.query<{ r: Begun }>(`select public.begin_vo_lead_follow_up($1, $2) as r`, [f.orgId, leadId]);
  return row.rows[0].r;
}

async function beginCall(f: Firm, bookingId: string) {
  const row = await db.query<{ r: Begun }>(`select public.begin_vo_call_summary($1, $2) as r`, [f.orgId, bookingId]);
  return row.rows[0].r;
}

async function finish(runId: string, sources: unknown[], body = "Hello Sam, thank you for your enquiry about your work permit.") {
  const row = await db.query<{ id: string | null }>(
    `select public.finish_vo_crm_run($1, 'drafted', 'Follow-up to Sam Example', $2, $3::jsonb, $4, 'leadfu-1', false, 0, 500, null) as id`,
    [runId, body, JSON.stringify(sources), MODEL],
  );
  return row.rows[0].id;
}

async function count(sql: string, params: unknown[]) {
  const row = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) q`, params);
  return row.rows[0].n;
}

describe("lead follow-up drafts", () => {
  it("follow the firm switch and the reply-draft switches", async () => {
    const f = await firm();
    const { leadId } = await lead(f);
    await as(f, f.manager);
    expect(await beginLead(f, leadId)).toEqual({ ok: false, error: "off" });
    await settings(f, { enabled: true, reply_drafts: false });
    await as(f, f.manager);
    expect(await beginLead(f, leadId)).toEqual({ ok: false, error: "capability_off" });
    await settings(f, { reply_drafts: true, read_client_messages: false });
    await as(f, f.manager);
    expect(await beginLead(f, leadId)).toEqual({ ok: false, error: "capability_off" });
    await settings(f, { read_client_messages: true });
    await as(f, f.manager);
    const run = await beginLead(f, leadId);
    expect(run.ok).toBe(true);
    expect(run.marketing).toBe(false);
  });

  it("makes no draft without consent to contact, and refuses finance users and other firms", async () => {
    const f = await firm();
    await settings(f, { enabled: true });
    const { leadId } = await lead(f, { reply: false });
    await as(f, f.manager);
    expect(await beginLead(f, leadId)).toEqual({ ok: false, error: "no_consent" });
    await db.query(`select public.record_lead_consent($1, $2, 'enquiry_reply', true)`, [f.orgId, leadId]);
    expect((await beginLead(f, leadId)).ok).toBe(true);
    await as(f, f.finance);
    await expectDbError(() => beginLead(f, leadId), /staff access denied/);
    const other = await firm();
    await as(other, other.manager);
    await expectDbError(() => db.query(`select public.begin_vo_lead_follow_up($1, $2)`, [other.orgId, leadId]), /vo denied/);
  });

  it("refuses a lead that already became a client", async () => {
    const f = await firm();
    await settings(f, { enabled: true });
    const { leadId } = await lead(f);
    await asMaintenance(db);
    await db.query(`set session_replication_role = replica`);
    await db.query(`update public.leads set converted_matter_id = $2, converted_at = now() where id = $1`, [leadId, f.matterId]);
    await db.query(`set session_replication_role = origin`);
    await as(f, f.manager);
    expect(await beginLead(f, leadId)).toMatchObject({ ok: false, error: "converted", matter_id: f.matterId });
  });

  it("keeps a grounded draft, read only by lead staff, and records what the person sent as a lead note", async () => {
    const f = await firm();
    await settings(f, { enabled: true });
    const { leadId, noteId } = await lead(f, { marketing: true });
    const other = await lead(f);
    await as(f, f.manager);
    const run = await beginLead(f, leadId);
    expect(run.marketing).toBe(true);
    // A source from another lead is refused.
    await expectDbError(() => finish(run.run_id!, [{ kind: "lead_note", id: other.noteId, label: "Enquiry" }]), /outside this lead/);
    await expectDbError(() => finish(run.run_id!, [{ kind: "message", id: noteId, label: "Enquiry" }]), /unknown source kind/);
    // Only the person who started the run finishes it.
    await as(f, f.consultant);
    await expectDbError(() => finish(run.run_id!, [{ kind: "lead", id: leadId, label: "Sam Example" }]), /vo denied/);
    await as(f, f.manager);
    const draftId = await finish(run.run_id!, [
      { kind: "lead", id: leadId, label: "Sam Example" },
      { kind: "lead_note", id: noteId, label: "Enquiry" },
    ]);
    expect(draftId).toBeTruthy();
    expect(await beginLead(f, leadId)).toEqual({ ok: false, error: "already_drafted", draft_id: draftId });

    await asMaintenance(db);
    const stored = await db.query<{ marketing_consent: boolean; status: string; source_count: number; result: string; matter_id: string | null }>(
      `select d.marketing_consent, d.status, r.source_count, r.result, r.matter_id from public.vo_crm_drafts d join public.vo_runs r on r.id = d.run_id where d.id = $1`,
      [draftId],
    );
    expect(stored.rows[0]).toMatchObject({ marketing_consent: true, status: "draft", source_count: 2, result: "drafted", matter_id: null });

    // Lead staff read the draft and the run; finance users and another firm don't.
    await as(f, f.consultant);
    expect(await count(`select 1 from public.vo_crm_drafts where id = $1`, [draftId])).toBe(1);
    expect(await count(`select 1 from public.vo_runs where id = $1`, [run.run_id])).toBe(1);
    await as(f, f.finance);
    expect(await count(`select 1 from public.vo_crm_drafts where id = $1`, [draftId])).toBe(0);
    expect(await count(`select 1 from public.vo_runs where id = $1`, [run.run_id])).toBe(0);
    const stranger = await firm();
    await as(stranger, stranger.owner);
    expect(await count(`select 1 from public.vo_crm_drafts where id = $1`, [draftId])).toBe(0);
    await expectDbError(() => db.query(`select public.mark_vo_lead_follow_up_sent($1, 'Hello')`, [draftId]), /staff access denied|vo denied/);

    // A placeholder must be replaced first.
    await as(f, f.manager);
    await expectDbError(() => db.query(`select public.mark_vo_lead_follow_up_sent($1, $2)`, [draftId, "Your fee is [needs a sourced rule]."]), /placeholder/);
    const noteRow = await db.query<{ id: string }>(`select public.mark_vo_lead_follow_up_sent($1, $2) as id`, [draftId, "Hello Sam, thank you. When suits you for a call?"]);
    const leadNoteId = noteRow.rows[0].id;
    // A retried click returns the same note.
    const again = await db.query<{ id: string }>(`select public.mark_vo_lead_follow_up_sent($1, $2) as id`, [draftId, "Hello"]);
    expect(again.rows[0].id).toBe(leadNoteId);
    await asMaintenance(db);
    const note = await db.query<{ body: string }>(`select body from public.lead_notes where id = $1`, [leadNoteId]);
    expect(note.rows[0].body).toBe("Follow-up sent (drafted with Vo, edited):\nHello Sam, thank you. When suits you for a call?");
    const draft = await db.query<{ status: string; edited: boolean; lead_note_id: string }>(`select status, edited, lead_note_id from public.vo_crm_drafts where id = $1`, [draftId]);
    expect(draft.rows[0]).toMatchObject({ status: "sent", edited: true, lead_note_id: leadNoteId });
    const audit = await db.query<{ action: string; context: Record<string, unknown> }>(
      `select action, context from public.audit_log where organization_id = $1 and action like 'vo.%' order by occurred_at`,
      [f.orgId],
    );
    const actions = audit.rows.map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["vo.run_started", "vo.run_finished", "vo.draft_sent"]));
    // The audit never carries the text.
    expect(JSON.stringify(audit.rows)).not.toContain("When suits you");
    // Nobody can change it any more.
    await as(f, f.manager);
    await expectDbError(() => db.query(`select public.discard_vo_crm_draft($1)`, [draftId]), /already reviewed/);
  });

  it("won't record a follow-up once the lead withdrew consent to be contacted", async () => {
    const f = await firm();
    await settings(f, { enabled: true });
    const { leadId } = await lead(f);
    await as(f, f.manager);
    const run = await beginLead(f, leadId);
    const draftId = await finish(run.run_id!, [{ kind: "lead", id: leadId, label: "Sam Example" }]);
    await db.query(`select public.record_lead_consent($1, $2, 'enquiry_reply', false)`, [f.orgId, leadId]);
    await expectDbError(() => db.query(`select public.mark_vo_lead_follow_up_sent($1, 'Hello Sam')`, [draftId]), /no consent to be contacted/);
    await db.query(`select public.discard_vo_crm_draft($1)`, [draftId]);
    await asMaintenance(db);
    const draft = await db.query<{ status: string }>(`select status from public.vo_crm_drafts where id = $1`, [draftId]);
    expect(draft.rows[0].status).toBe("discarded");
  });

  it("closes a run as failed or abstained without a draft, and refuses other run kinds", async () => {
    const f = await firm();
    await settings(f, { enabled: true });
    const { leadId } = await lead(f);
    await as(f, f.manager);
    const run = await beginLead(f, leadId);
    const none = await db.query<{ id: string | null }>(`select public.finish_vo_crm_run($1, 'failed', p_failure => 'refused') as id`, [run.run_id]);
    expect(none.rows[0].id).toBeNull();
    await expectDbError(() => db.query(`select public.finish_vo_crm_run($1, 'abstained')`, [run.run_id]), /already finished/);
    const next = await beginLead(f, leadId);
    await expectDbError(() => db.query(`select public.finish_vo_crm_run($1, 'answered')`, [next.run_id]), /say how the run ended/);
    // A message reply run has a conversation; these runs never do.
    await asMaintenance(db);
    await expectDbError(
      () => db.query(`insert into public.vo_runs (organization_id, user_id, kind, matter_id, thread_id, lead_id) values ($1, $2, 'lead_follow_up', $3, null, null)`, [f.orgId, f.manager, f.matterId]),
      /check constraint/,
    );
  });
});

describe("call-notes summaries", () => {
  it("need a Casevoya video call that took place, and the summaries switch", async () => {
    const f = await firm();
    await settings(f, { enabled: true });
    const { leadId } = await lead(f);
    const phone = await booking(f, { kind: "phone", leadId });
    const upcoming = await booking(f, { status: "confirmed", leadId: (await lead(f)).leadId });
    const happened = await booking(f, { status: "confirmed", leadId: (await lead(f)).leadId, callStarted: true });
    const orphan = await booking(f);
    await as(f, f.manager);
    expect(await beginCall(f, phone)).toEqual({ ok: false, error: "not_video" });
    expect(await beginCall(f, upcoming)).toEqual({ ok: false, error: "no_call" });
    expect(await beginCall(f, orphan)).toEqual({ ok: false, error: "no_target" });
    expect((await beginCall(f, happened)).ok).toBe(true);
    await settings(f, { staff_answers: false });
    await as(f, f.manager);
    const attended = await booking(f, { leadId: (await lead(f)).leadId });
    await as(f, f.manager);
    expect(await beginCall(f, attended)).toEqual({ ok: false, error: "capability_off" });
    await settings(f, { enabled: false });
    await as(f, f.manager);
    expect(await beginCall(f, attended)).toEqual({ ok: false, error: "off" });
  });

  it("saves the reviewed summary as a note on the consultation's lead", async () => {
    const f = await firm();
    await settings(f, { enabled: true });
    const { leadId } = await lead(f);
    const bookingId = await booking(f, { leadId });
    await as(f, f.consultant);
    const run = await beginCall(f, bookingId);
    expect(run).toMatchObject({ ok: true, lead_id: leadId, matter_id: null });
    const otherBooking = await booking(f, { leadId: (await lead(f)).leadId });
    await as(f, f.consultant);
    await expectDbError(() => finish(run.run_id!, [{ kind: "booking", id: otherBooking, label: "Video call" }], "Summary"), /outside this lead/);
    const draftId = await finish(run.run_id!, [{ kind: "booking", id: bookingId, label: "Video call" }], "Discussed a work permit renewal.");
    expect(await beginCall(f, bookingId)).toEqual({ ok: false, error: "already_drafted", draft_id: draftId });
    const saved = await db.query<{ id: string }>(`select public.save_vo_call_summary($1, $2) as id`, [draftId, "Discussed a work permit renewal."]);
    await asMaintenance(db);
    const note = await db.query<{ body: string; lead_id: string }>(`select body, lead_id from public.lead_notes where id = $1`, [saved.rows[0].id]);
    expect(note.rows[0]).toEqual({ body: "Video call summary (drafted with Vo):\nDiscussed a work permit renewal.", lead_id: leadId });
    const draft = await db.query<{ status: string; edited: boolean }>(`select status, edited from public.vo_crm_drafts where id = $1`, [draftId]);
    expect(draft.rows[0]).toEqual({ status: "reviewed", edited: false });
  });

  it("saves to the matter's staff notes when the consultation has no lead, for staff who read the matter only", async () => {
    const f = await firm();
    await settings(f, { enabled: true });
    const bookingId = await booking(f, { matterId: f.matterId });
    // The case manager isn't on the matter.
    await as(f, f.manager);
    await expectDbError(() => beginCall(f, bookingId), /vo denied/);
    await as(f, f.consultant);
    const run = await beginCall(f, bookingId);
    expect(run).toMatchObject({ ok: true, lead_id: null, matter_id: f.matterId });
    const draftId = await finish(
      run.run_id!,
      [
        { kind: "booking", id: bookingId, label: "Video call" },
        { kind: "matter", id: f.matterId, label: "Synthetic matter" },
      ],
      "Client confirmed the passport is ready.",
    );
    await as(f, f.manager);
    expect(await count(`select 1 from public.vo_crm_drafts where id = $1`, [draftId])).toBe(0);
    await expectDbError(() => db.query(`select public.save_vo_call_summary($1, 'x')`, [draftId]), /vo denied/);
    await as(f, f.consultant);
    await expectDbError(() => db.query(`select public.save_vo_call_summary($1, $2)`, [draftId, "Fee is [needs a sourced rule]"]), /placeholder/);
    const saved = await db.query<{ id: string }>(`select public.save_vo_call_summary($1, $2) as id`, [draftId, "Client confirmed the passport is ready. Next: book the review."]);
    await asMaintenance(db);
    const note = await db.query<{ body: string; matter_id: string }>(`select body, matter_id from public.matter_staff_notes where id = $1`, [saved.rows[0].id]);
    expect(note.rows[0].matter_id).toBe(f.matterId);
    expect(note.rows[0].body).toMatch(/^Video call summary \(drafted with Vo, edited\):\n/);
    const audit = await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where organization_id = $1 and action = 'vo.draft_saved'`, [f.orgId]);
    expect(audit.rows[0].context).toMatchObject({ kind: "call_summary", edited: true, on: "matter" });
  });
});
