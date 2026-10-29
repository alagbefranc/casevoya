import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// Leads (20261019201000_lead_enums, 20261019201100_leads_core, 20261019201200_lead_functions):
// RLS and tenant isolation, role checks, stage moves with versions, lost reason, conflict screen,
// duplicates, consent kept separate, conversion through create_client_matter, bookings, CSV import
// and the public enquiry. Everything here is synthetic.

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const TZ = "America/Toronto";
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
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

async function firm(options: { sample?: boolean; privacy?: boolean } = {}) {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const slug = `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", slug]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = $2 where id = $1`, [orgId, options.sample ?? false]);
  if (options.privacy) {
    await db.query(
      `insert into public.portal_policy_documents (organization_id, kind, version_label, title, body, body_sha256)
       values ($1, 'privacy_notice', 'v1', 'Privacy notice', 'Synthetic notice', $2)`,
      [orgId, createHash("sha256").update("Synthetic notice").digest("hex")],
    );
  }
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  const finance = await createUser("finance");
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant");
  const managerMembership = await membership(orgId, manager, "case_manager");
  await membership(orgId, finance, "finance_user");
  // A verified licence, so create_client_matter accepts the consultant.
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       $3, $4, false, false, null, $5, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, true, false, PROOF],
  );
  return { orgId, slug, owner, consultant, manager, finance, consultantMembership, managerMembership };
}

type Ctx = Awaited<ReturnType<typeof firm>>;

const as = (ctx: Ctx, userId: string, aal: "aal1" | "aal2" = "aal2") =>
  asUser(db, { userId, aal, orgId: ctx.orgId, totpAgeSeconds: aal === "aal2" ? 0 : undefined });

async function createLead(ctx: Ctx, fields: { name?: string; email?: string | null; phone?: string | null; marketing?: boolean; source?: string } = {}) {
  await as(ctx, ctx.manager);
  const row = await db.query<{ id: string }>(
    `select public.create_lead($1, $2, $3, $4, 'phone', 'Work permit', 'Canada', 'English', $5::public.lead_source, null, null, 290000,
       array['Work permit', ' renewal '], 'Called about a renewal.', true, $6) as id`,
    [ctx.orgId, fields.name ?? "Sam Example", fields.email === undefined ? "sam@example.test" : fields.email, fields.phone ?? null, fields.source ?? "phone", fields.marketing ?? false],
  );
  return row.rows[0].id;
}

async function stage(ctx: Ctx, key: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(`select id from public.lead_stages where organization_id = $1 and key = $2`, [ctx.orgId, key]);
  return row.rows[0].id;
}

async function lead(id: string) {
  await asMaintenance(db);
  const row = await db.query<Record<string, unknown>>(`select * from public.leads where id = $1`, [id]);
  return row.rows[0];
}

describe("leads: stages, reads and tenant isolation", () => {
  it("gives every firm the PRD lifecycle as configurable stages", async () => {
    const ctx = await firm();
    await as(ctx, ctx.manager);
    const rows = await db.query<{ key: string; label: string; kind: string; position: number }>(
      `select key, label, kind, position from public.lead_stages order by position`,
    );
    expect(rows.rows.map((row) => row.label)).toEqual([
      "New",
      "Contacted",
      "Consultation scheduled",
      "Consultation completed",
      "Qualified",
      "Proposal sent",
      "Converted",
      "Lost",
      "Archived",
    ]);
    expect(rows.rows.filter((row) => row.kind === "open")).toHaveLength(6);

    // A firm owner renames and adds a stage; a case manager cannot.
    await as(ctx, ctx.owner);
    const contacted = await stage(ctx, "contacted");
    await as(ctx, ctx.owner);
    await db.query(`select public.save_lead_stage($1, $2, 'First reply sent', 2)`, [ctx.orgId, contacted]);
    const added = await db.query<{ id: string }>(`select public.save_lead_stage($1, null, 'Waiting on documents', 5) as id`, [ctx.orgId]);
    await asMaintenance(db);
    const saved = await db.query<{ label: string; kind: string }>(`select label, kind from public.lead_stages where id = any($1::uuid[]) order by label`, [
      [contacted, added.rows[0].id],
    ]);
    expect(saved.rows).toEqual([
      { label: "First reply sent", kind: "open" },
      { label: "Waiting on documents", kind: "open" },
    ]);
    await as(ctx, ctx.owner);
    await db.query(`select public.archive_lead_stage($1, $2)`, [ctx.orgId, added.rows[0].id]);
    await expectDbError(() => db.query(`select public.archive_lead_stage($1, $2)`, [ctx.orgId, ctx.orgId]), /stage not found/);
    const lost = await stage(ctx, "lost");
    await as(ctx, ctx.owner);
    await expectDbError(() => db.query(`select public.archive_lead_stage($1, $2)`, [ctx.orgId, lost]), /always kept/);
    await as(ctx, ctx.manager);
    await expectDbError(() => db.query(`select public.save_lead_stage($1, null, 'Mine', 3)`, [ctx.orgId]), /staff access denied/);
  });

  it("lets operational staff with MFA read the firm's leads, and nobody else", async () => {
    const ctx = await firm();
    const other = await firm();
    const id = await createLead(ctx);

    await as(ctx, ctx.consultant);
    expect((await db.query(`select id from public.leads where id = $1`, [id])).rows).toHaveLength(1);
    expect((await db.query(`select id from public.lead_notes where lead_id = $1`, [id])).rows).toHaveLength(1);
    expect((await db.query(`select id from public.lead_events where lead_id = $1`, [id])).rows).toHaveLength(1);

    // Finance users, staff without MFA and another firm's staff see nothing.
    await as(ctx, ctx.finance);
    expect((await db.query(`select id from public.leads where id = $1`, [id])).rows).toHaveLength(0);
    await as(ctx, ctx.manager, "aal1");
    expect((await db.query(`select id from public.leads where id = $1`, [id])).rows).toHaveLength(0);
    await asUser(db, { userId: other.manager, aal: "aal2", orgId: other.orgId, totpAgeSeconds: 0 });
    expect((await db.query(`select id from public.leads where id = $1`, [id])).rows).toHaveLength(0);
    // Pointing the session at the other firm does not help someone who is not a member.
    await asUser(db, { userId: other.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    expect((await db.query(`select id from public.leads where id = $1`, [id])).rows).toHaveLength(0);
    await asAnon(db);
    await expectDbError(() => db.query(`select id from public.leads`), /permission denied/);
  });

  it("has no direct write path: every change goes through the functions", async () => {
    const ctx = await firm();
    const id = await createLead(ctx);
    await as(ctx, ctx.manager);
    await expectDbError(() => db.query(`update public.leads set display_name = 'X' where id = $1`, [id]), /permission denied/);
    await expectDbError(() => db.query(`insert into public.lead_notes (organization_id, lead_id, body) values ($1, $2, 'x')`, [ctx.orgId, id]), /permission denied/);
    await expectDbError(() => db.query(`delete from public.leads where id = $1`, [id]), /permission denied/);
    await asMaintenance(db);
    await expectDbError(() => db.query(`update public.lead_events set reason = 'x' where lead_id = $1`, [id]), /append-only/);
    await expectDbError(() => db.query(`delete from public.lead_consents where lead_id = $1`, [id]), /append-only/);
  });

  it("refuses another firm's staff and the finance role on every write", async () => {
    const ctx = await firm();
    const other = await firm();
    const id = await createLead(ctx);
    const contacted = await stage(ctx, "contacted");
    await asUser(db, { userId: other.manager, aal: "aal2", orgId: other.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.move_lead_stage($1, $2, $3, 1, null)`, [ctx.orgId, id, contacted]), /staff access denied/);
    // Their own firm id with a lead of another firm: not found.
    await expectDbError(() => db.query(`select public.add_lead_note($1, $2, 'x')`, [other.orgId, id]), /lead not found/);
    await as(ctx, ctx.finance);
    await expectDbError(() => db.query(`select public.add_lead_note($1, $2, 'x')`, [ctx.orgId, id]), /staff access denied/);
    await as(ctx, ctx.manager, "aal1");
    await expectDbError(() => db.query(`select public.add_lead_note($1, $2, 'x')`, [ctx.orgId, id]), /staff access denied/);
  });
});

describe("leads: pipeline moves, lost reason and history", () => {
  it("moves a lead through open stages at the version the person saw, and records the history", async () => {
    const ctx = await firm();
    const id = await createLead(ctx);
    const contacted = await stage(ctx, "contacted");
    const qualified = await stage(ctx, "qualified");
    await as(ctx, ctx.manager);
    const v2 = await db.query<{ v: number }>(`select public.move_lead_stage($1, $2, $3, 1, null) as v`, [ctx.orgId, id, contacted]);
    expect(v2.rows[0].v).toBe(2);
    // A stale move is a conflict, not an overwrite.
    await expectDbError(() => db.query(`select public.move_lead_stage($1, $2, $3, 1, null)`, [ctx.orgId, id, qualified]), /changed by someone else/);
    await db.query(`select public.move_lead_stage($1, $2, $3, 2, null)`, [ctx.orgId, id, qualified]);
    expect((await lead(id)).stage_id).toBe(qualified);

    // Converted and Lost need their own actions.
    await as(ctx, ctx.manager);
    await expectDbError(() => db.query(`select public.move_lead_stage($1, $2, $3, 3, null)`, [ctx.orgId, id, ctx.orgId]), /stage not found/);
    const converted = await stage(ctx, "converted");
    const lost = await stage(ctx, "lost");
    await as(ctx, ctx.manager);
    await expectDbError(() => db.query(`select public.move_lead_stage($1, $2, $3, 3, null)`, [ctx.orgId, id, converted]), /convert to matter/);
    await expectDbError(() => db.query(`select public.move_lead_stage($1, $2, $3, 3, null)`, [ctx.orgId, id, lost]), /with a reason/);

    await as(ctx, ctx.manager);
    const events = await db.query<{ kind: string }>(`select kind from public.lead_events where lead_id = $1 order by created_at`, [id]);
    expect(events.rows.map((row) => row.kind)).toEqual(["created", "stage_changed", "stage_changed"]);
    await asMaintenance(db);
    const audit = await db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where object_id = $1 and action = 'lead.stage_changed'`, [id]);
    expect(audit.rows[0].n).toBe(2);
  });

  it("closes a lead as lost with its reason stored separately, and reopens it keeping that reason in history", async () => {
    const ctx = await firm();
    const id = await createLead(ctx);
    await as(ctx, ctx.manager);
    await expectDbError(() => db.query(`select public.close_lead_lost($1, $2, 1, ' ')`, [ctx.orgId, id]), /give a reason/);
    await db.query(`select public.close_lead_lost($1, $2, 1, 'Chose another firm')`, [ctx.orgId, id]);
    const closed = await lead(id);
    expect(closed.lost_reason).toBe("Chose another firm");
    expect(closed.stage_id).toBe(await stage(ctx, "lost"));

    const contacted = await stage(ctx, "contacted");
    await as(ctx, ctx.manager);
    await db.query(`select public.move_lead_stage($1, $2, $3, 2, 'They called back')`, [ctx.orgId, id, contacted]);
    const reopened = await lead(id);
    expect(reopened.lost_reason).toBeNull();
    await asMaintenance(db);
    const history = await db.query<{ kind: string; payload: { lost_reason?: string }; reason: string | null }>(
      `select kind, payload, reason from public.lead_events where lead_id = $1 order by created_at`,
      [id],
    );
    expect(history.rows.map((row) => row.kind)).toEqual(["created", "lost", "reopened"]);
    expect(history.rows[2].payload.lost_reason).toBe("Chose another firm");
    expect(history.rows[2].reason).toBe("They called back");
  });
});

describe("leads: consent, conflicts and duplicates", () => {
  it("keeps reply consent and marketing consent as separate, append-only answers", async () => {
    const ctx = await firm();
    const id = await createLead(ctx, { marketing: false });
    await as(ctx, ctx.manager);
    const first = await db.query<{ purpose: string; granted: boolean }>(`select purpose, granted from public.lead_consents where lead_id = $1`, [id]);
    expect(first.rows).toEqual([{ purpose: "enquiry_reply", granted: true }]);
    await db.query(`select public.record_lead_consent($1, $2, 'marketing', true)`, [ctx.orgId, id]);
    await db.query(`select public.record_lead_consent($1, $2, 'marketing', false)`, [ctx.orgId, id]);
    const latest = await db.query<{ granted: boolean }>(
      `select granted from public.lead_consents where lead_id = $1 and purpose = 'marketing' order by recorded_at desc limit 1`,
      [id],
    );
    expect(latest.rows[0].granted).toBe(false);
    const reply = await db.query<{ granted: boolean }>(
      `select granted from public.lead_consents where lead_id = $1 and purpose = 'enquiry_reply' order by recorded_at desc limit 1`,
      [id],
    );
    expect(reply.rows[0].granted).toBe(true);
  });

  it("lists possible conflicts without showing a client the staff member cannot read, and records the check", async () => {
    const ctx = await firm();
    // A client on a matter the manager is not on, with the same name.
    await as(ctx, ctx.consultant);
    const created = await db.query<{ r: { id: string; applicant_id: string } }>(
      `select public.create_client_matter('Sam Example', 'other@example.test', null, null, $1, null, null, null, null) as r`,
      [ctx.consultantMembership],
    );
    const id = await createLead(ctx);
    const twin = await createLead(ctx, { name: "Sam  EXAMPLE", email: "family@example.test" });
    await as(ctx, ctx.manager);
    const matches = await db.query<{ m: { leads: { id: string; matched: string[] }[]; clients: { id: string | null; name: string | null; matters: { reference: string }[] }[] } }>(
      `select public.lead_conflict_matches($1, $2) as m`,
      [ctx.orgId, id],
    );
    expect(matches.rows[0].m.leads.map((row) => row.id)).toEqual([twin]);
    expect(matches.rows[0].m.leads[0].matched).toEqual(["name"]);
    expect(matches.rows[0].m.clients).toHaveLength(1);
    expect(matches.rows[0].m.clients[0].name).toBeNull();
    expect(matches.rows[0].m.clients[0].id).toBeNull();
    expect(matches.rows[0].m.clients[0].matters[0].reference).toMatch(/-\d{4}-/);
    // The consultant on that matter sees the client's name.
    await as(ctx, ctx.consultant);
    const named = await db.query<{ m: { clients: { id: string; name: string }[] } }>(`select public.lead_conflict_matches($1, $2) as m`, [ctx.orgId, id]);
    expect(named.rows[0].m.clients[0]).toMatchObject({ id: created.rows[0].r.applicant_id, name: "Sam Example" });

    await as(ctx, ctx.manager);
    await expectDbError(() => db.query(`select public.record_lead_conflict_check($1, $2, 1, 'conflict', null)`, [ctx.orgId, id]), /short note/);
    await db.query(`select public.record_lead_conflict_check($1, $2, 1, 'clear', null)`, [ctx.orgId, id]);
    expect((await lead(id)).conflict_result).toBe("clear");
  });

  it("links duplicates under one person only when a person says so, and never merges", async () => {
    const ctx = await firm();
    const older = await createLead(ctx, { name: "Hamid Rahimi", email: "h.rahimi@example.test" });
    const newer = await createLead(ctx, { name: "Hamid Rahimi", email: "hamid.r@example.test" });
    await as(ctx, ctx.manager);
    await db.query(`select public.decide_lead_duplicate($1, $2, $3, true)`, [ctx.orgId, newer, older]);
    expect((await lead(newer)).same_person_lead_id).toBe(older);
    expect((await lead(older)).display_name).toBe("Hamid Rahimi");
    await as(ctx, ctx.manager);
    await expectDbError(() => db.query(`select public.decide_lead_duplicate($1, $2, $3, false)`, [ctx.orgId, older, newer]), /already answered/);
    await asMaintenance(db);
    const both = await db.query<{ n: number }>(`select count(*)::int as n from public.leads where id = any($1::uuid[])`, [[older, newer]]);
    expect(both.rows[0].n).toBe(2);
  });
});

describe("leads: conversion through create_client_matter", () => {
  it("needs a clear conflict check, then opens a matter exactly as New matter does and marks the lead converted", async () => {
    const ctx = await firm();
    const id = await createLead(ctx, { name: "Ana Pereira", email: "ana@example.test" });
    await as(ctx, ctx.manager);
    await expectDbError(
      () => db.query(`select public.convert_lead_to_matter($1, $2, 1, $3, null)`, [ctx.orgId, id, ctx.consultantMembership]),
      /clear conflict check/,
    );
    await db.query(`select public.record_lead_conflict_check($1, $2, 1, 'clear', null)`, [ctx.orgId, id]);
    const converted = await db.query<{ r: { ok: boolean; id: string; applicant_id: string; reference: string; lead_version: number } }>(
      `select public.convert_lead_to_matter($1, $2, 2, $3, null) as r`,
      [ctx.orgId, id, ctx.consultantMembership],
    );
    const result = converted.rows[0].r;
    expect(result.ok).toBe(true);
    expect(result.reference).toMatch(/^[A-Z]{2}-\d{4}-\d{4}$/);
    expect(result.lead_version).toBe(3);

    const after = await lead(id);
    expect(after).toMatchObject({ converted_matter_id: result.id, converted_person_id: result.applicant_id, stage_id: await stage(ctx, "converted") });
    // The applicant, the consultant and the creator, as create_client_matter makes them.
    await as(ctx, ctx.manager);
    const participants = await db.query<{ role: string }>(`select role::text from public.matter_participants where matter_id = $1 order by role::text`, [result.id]);
    expect(participants.rows.map((row) => row.role)).toEqual(["applicant", "case_manager", "consultant"]);
    const person = await db.query<{ display_name: string; email: string }>(`select display_name, email from public.persons where id = $1`, [result.applicant_id]);
    expect(person.rows[0]).toEqual({ display_name: "Ana Pereira", email: "ana@example.test" });

    // Converted is final for the lead.
    const contacted = await stage(ctx, "contacted");
    await as(ctx, ctx.manager);
    await expectDbError(() => db.query(`select public.move_lead_stage($1, $2, $3, 3, null)`, [ctx.orgId, id, contacted]), /stays converted/);
    await expectDbError(() => db.query(`select public.convert_lead_to_matter($1, $2, 3, $3, null)`, [ctx.orgId, id, ctx.consultantMembership]), /already converted/);
  });

  it("refuses a forged finish for a matter that was not made for the lead; a sample lead becomes a sample matter", async () => {
    const ctx = await firm();
    const id = await createLead(ctx);
    await as(ctx, ctx.consultant);
    const unrelated = await db.query<{ r: { id: string } }>(`select public.create_client_matter('Someone Else', null, null, null, $1, null, null, null, null) as r`, [
      ctx.consultantMembership,
    ]);
    const applicant = await db.query<{ id: string }>(`select person_id as id from public.matter_participants where matter_id = $1 and role = 'applicant'`, [
      unrelated.rows[0].r.id,
    ]);
    // Neither another matter's real applicant nor a made-up person is accepted.
    for (const person of [applicant.rows[0].id, randomUUID()]) {
      await expectDbError(
        () => db.query(`select app.finish_lead_conversion($1, $2, 1, $3, $4)`, [ctx.orgId, id, unrelated.rows[0].r.id, person]),
        /not created for this lead/,
      );
    }

    const sample = await firm({ sample: true });
    const sampleLead = await createLead(sample);
    expect((await lead(sampleLead)).is_sample).toBe(true);
    await as(sample, sample.manager);
    await db.query(`select public.record_lead_conflict_check($1, $2, 1, 'clear', null)`, [sample.orgId, sampleLead]);
    const converted = await db.query<{ r: { ok: boolean; id: string; is_sample: boolean; applicant_id: string } }>(
      `select public.convert_lead_to_matter($1, $2, 2, $3, null) as r`,
      [sample.orgId, sampleLead, sample.consultantMembership],
    );
    expect(converted.rows[0].r).toMatchObject({ ok: true, is_sample: true });
    expect((await lead(sampleLead)).converted_at).not.toBeNull();
    await asMaintenance(db);
    const made = await db.query<{ matter: boolean; person: boolean }>(
      `select m.is_sample as matter, p.is_sample as person from public.matters m, public.persons p where m.id = $1 and p.id = $2`,
      [converted.rows[0].r.id, converted.rows[0].r.applicant_id],
    );
    expect(made.rows[0]).toEqual({ matter: true, person: true });

    // A sample lead still becomes a sample matter after the firm goes live.
    const leftover = await createLead(sample);
    await asMaintenance(db);
    await db.query(`update public.organizations set sample_mode = false where id = $1`, [sample.orgId]);
    await as(sample, sample.manager);
    await db.query(`select public.record_lead_conflict_check($1, $2, 1, 'clear', null)`, [sample.orgId, leftover]);
    const later = await db.query<{ r: { ok: boolean; is_sample: boolean } }>(
      `select public.convert_lead_to_matter($1, $2, 2, $3, null) as r`,
      [sample.orgId, leftover, sample.consultantMembership],
    );
    expect(later.rows[0].r).toMatchObject({ ok: true, is_sample: true });
  });
});

describe("leads: bookings, CSV import and the public enquiry", () => {
  async function publicBooking(ctx: Ctx) {
    await as(ctx, ctx.consultant);
    await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [ctx.orgId, ctx.consultantMembership, TZ, JSON.stringify(EVERY_DAY)]);
    await as(ctx, ctx.owner);
    await db.query(
      `select public.save_booking_event_type($1, null, null, 'Initial consultation', 'initial', null, 30, null, 0, 0, 60, 60, null,
         'video'::public.booking_location_kind, null, $2::uuid[], true)`,
      [ctx.orgId, [ctx.consultantMembership]],
    );
    await asMaintenance(db);
    const start = await db.query<{ at: string }>(
      `select to_char(app.local_instant((now() at time zone $1)::date + 3, '10:00'::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
      [TZ],
    );
    await asAnon(db);
    const held = await db.query<{ r: { error?: string } }>(
      `select public.booking_public_hold($1, 'initial', $2::timestamptz, 'Ana Ferreira', 'ana.f@example.test', '+1 416 555 0100', 'America/Toronto', $3, null) as r`,
      [ctx.slug, start.rows[0].at, randomUUID()],
    );
    expect(held.rows[0].r.error).toBeUndefined();
    await asMaintenance(db);
    const booking = await db.query<{ id: string }>(`select id from public.bookings where organization_id = $1`, [ctx.orgId]);
    return booking.rows[0].id;
  }

  it("turns a public booking into a lead at Consultation scheduled, once", async () => {
    // #263-A: a booking page needs the firm's published privacy notice.
    const ctx = await firm({ privacy: true });
    const booking = await publicBooking(ctx);
    await as(ctx, ctx.manager);
    const created = await db.query<{ id: string }>(`select public.create_lead_from_booking($1, $2) as id`, [ctx.orgId, booking]);
    const row = await lead(created.rows[0].id);
    expect(row).toMatchObject({ display_name: "Ana Ferreira", email: "ana.f@example.test", source: "booking_page", stage_id: await stage(ctx, "consultation_scheduled") });
    await as(ctx, ctx.manager);
    const consents = await db.query(`select id from public.lead_consents where lead_id = $1`, [created.rows[0].id]);
    expect(consents.rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.create_lead_from_booking($1, $2)`, [ctx.orgId, booking]), /already belongs/);
  });

  it("links a booking to an existing lead and moves it forward, never back", async () => {
    // #263-A: a booking page needs the firm's published privacy notice.
    const ctx = await firm({ privacy: true });
    const booking = await publicBooking(ctx);
    const id = await createLead(ctx);
    await as(ctx, ctx.manager);
    await db.query(`select public.link_booking_to_lead($1, $2, $3)`, [ctx.orgId, booking, id]);
    expect((await lead(id)).stage_id).toBe(await stage(ctx, "consultation_scheduled"));
    await as(ctx, ctx.manager);
    const links = await db.query(`select id from public.lead_booking_links where lead_id = $1`, [id]);
    expect(links.rows).toHaveLength(1);
  });

  it("imports CSV rows, skipping the ones that fail a check, with no consent recorded", async () => {
    const ctx = await firm();
    await as(ctx, ctx.manager);
    const rows = [
      { name: "Mina Tehrani", email: "mina.t@example.test", phone: "+1 416 555 0182", service_interest: "Study permit", source: "Instagram", note: "wants Jan intake" },
      { name: "", email: "nobody@example.test" },
      { name: "No Contact" },
      { name: "Bad Email", email: "not-an-email" },
    ];
    const result = await db.query<{ r: { imported: number; skipped: { row: number; reason: string }[] } }>(`select public.import_leads($1, 'leads-oct.csv', $2::jsonb) as r`, [
      ctx.orgId,
      JSON.stringify(rows),
    ]);
    expect(result.rows[0].r.imported).toBe(1);
    expect(result.rows[0].r.skipped.map((row) => row.row)).toEqual([2, 3, 4]);
    const imported = await db.query<{ source: string; source_detail: string; id: string }>(`select id, source::text, source_detail from public.leads`);
    expect(imported.rows[0]).toMatchObject({ source: "csv_import", source_detail: "Instagram" });
    expect((await db.query(`select id from public.lead_consents where lead_id = $1`, [imported.rows[0].id])).rows).toHaveLength(0);
    await expectDbError(() => db.query(`select public.import_leads($1, 'x.csv', '[]'::jsonb)`, [ctx.orgId]), /no rows/);
  });

  it("takes a public enquiry only for a live firm with a privacy notice, records both consents separately, and rate-limits", async () => {
    const live = await firm({ privacy: true });
    const noNotice = await firm();
    const sample = await firm({ sample: true, privacy: true });
    const submit = async (slug: string, overrides: Partial<{ contact: string; reply: boolean; marketing: boolean; key: string; hash: string | null }> = {}) => {
      await asAnon(db);
      const row = await db.query<{ r: { ok?: boolean; error?: string } }>(
        `select public.submit_enquiry($1, 'Wei Zhang', $2, 'email', 'Study', 'China', 'Mandarin', $3,
           'Synthetic Firm may use these details to reply to my enquiry', $4, 'Send me Synthetic Firm news', 'enquiry-v1',
           'hosted_page', $5, $6) as r`,
        [slug, overrides.contact ?? "Wei@Example.test", overrides.reply ?? true, overrides.marketing ?? false, overrides.key ?? randomUUID(), overrides.hash ?? null],
      );
      return row.rows[0].r;
    };
    expect(await submit(noNotice.slug)).toEqual({ error: "form_unavailable" });
    expect(await submit(sample.slug)).toEqual({ error: "form_unavailable" });
    expect(await submit("no-such-firm")).toEqual({ error: "form_unavailable" });
    expect(await submit(live.slug, { reply: false })).toEqual({ error: "consent_required" });
    expect(await submit(live.slug, { contact: "x@" })).toEqual({ error: "email_invalid" });

    const key = randomUUID();
    expect(await submit(live.slug, { key, marketing: true })).toEqual({ ok: true });
    expect(await submit(live.slug, { key, marketing: true })).toEqual({ ok: true });
    await asMaintenance(db);
    const leads = await db.query<{ id: string; email: string; source: string; stage: string }>(
      `select l.id, l.email, l.source::text, s.key as stage from public.leads l join public.lead_stages s on s.id = l.stage_id where l.organization_id = $1`,
      [live.orgId],
    );
    expect(leads.rows).toHaveLength(1);
    expect(leads.rows[0]).toMatchObject({ email: "wei@example.test", source: "hosted_page", stage: "new" });
    const consents = await db.query<{ purpose: string; granted: boolean; captured_via: string; policy_version: string }>(
      `select purpose::text, granted, captured_via, policy_version from public.lead_consents where lead_id = $1 order by purpose`,
      [leads.rows[0].id],
    );
    expect(consents.rows).toEqual([
      { purpose: "enquiry_reply", granted: true, captured_via: "hosted_page", policy_version: "enquiry-v1" },
      { purpose: "marketing", granted: true, captured_via: "hosted_page", policy_version: "enquiry-v1" },
    ]);

    const hash = createHash("sha256").update("203.0.113.9").digest("hex");
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await submit(live.slug, { hash }));
    expect(results.slice(0, 5).every((result) => result.ok)).toBe(true);
    expect(results[6]).toEqual({ error: "enquiry_rate_limited" });

    // Anonymous visitors still cannot read leads or call staff functions.
    await asAnon(db);
    await expectDbError(() => db.query(`select public.add_lead_note($1, $2, 'x')`, [live.orgId, leads.rows[0].id]), /permission denied/);
  });
});
