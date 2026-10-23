import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// Consultation agreements on bookings (20261023170000): staff lock the firm's approved
// consultation template to an upcoming booking; the booker signs through the booking's private
// link without a login. Everything here is synthetic.

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

const TZ = "America/Toronto";
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function createUser(label: string, name?: string) {
  await asMaintenance(db);
  const id = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@example.test`;
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3::jsonb)`, [
    id,
    email,
    JSON.stringify(name ? { display_name: name } : {}),
  ]);
  return { id, email };
}

async function membership(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
    [orgId, userId, role],
  );
  return row.rows[0].id;
}

const staff = (userId: string, orgId: string) => ({ userId, aal: "aal2" as const, orgId, totpAgeSeconds: 0 });
const client = (userId: string, orgId: string | null) => ({ userId, aal: "aal1" as const, orgId });

async function firm(options: { notice?: number; capacity?: number | null } = {}) {
  const ownerUser = await createUser("owner", "Synthetic Owner");
  await asUser(db, { userId: ownerUser.id, aal: "aal2", totpAgeSeconds: 0 });
  const firmSlug = slug();
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", firmSlug]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false, timezone = $2 where id = $1`, [orgId, TZ]);
  const host = await createUser("host", "Synthetic Host");
  const hostMembership = await membership(orgId, host.id, "licensed_consultant");
  await asUser(db, staff(host.id, orgId));
  await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [orgId, hostMembership, TZ, JSON.stringify(EVERY_DAY)]);
  await asUser(db, staff(ownerUser.id, orgId));
  const typeId = (
    await db.query<{ id: string }>(
      `select public.save_booking_event_type($1, null, null, 'Package review call', 'review', null, 30, null, 0, 0, $2, 14, $3,
         'meeting_link'::public.booking_location_kind, 'https://meet.example.test/room', $4::uuid[], true) as id`,
      [orgId, options.notice ?? 60, options.capacity ?? null, [hostMembership]],
    )
  ).rows[0].id;
  // The client: a portal login linked to their own person.
  const clientUser = await createUser("client", "Synthetic Client");
  await membership(orgId, clientUser.id, "client");
  await asMaintenance(db);
  const personId = (
    await db.query<{ id: string }>(`insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Synthetic Client', $3) returning id`, [
      orgId,
      clientUser.id,
      clientUser.email,
    ])
  ).rows[0].id;
  return { orgId, firmSlug, owner: ownerUser, host, hostMembership, typeId, client: clientUser, personId };
}

type Ctx = Awaited<ReturnType<typeof firm>>;

/** A local time in the host's zone, `days` days from today, as an ISO instant. */
async function localStart(days: number, time = "10:00"): Promise<string> {
  await asMaintenance(db);
  const row = await db.query<{ at: string }>(
    `select to_char(app.local_instant((now() at time zone $1)::date + $2::integer, $3::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
    [TZ, days, time],
  );
  return row.rows[0].at;
}

/** The client books on the firm's public page, signed in, so the booking is their own. */
async function book(ctx: Ctx, start: string, options: { as?: { id: string; email: string } } = {}) {
  const who = options.as ?? ctx.client;
  await asUser(db, client(who.id, null));
  const row = await db.query<{ r: { public_ref: string; error?: string } }>(
    `select public.booking_public_hold($1, 'review', $2::timestamptz, 'Synthetic Client', $3, null, 'America/Vancouver', $4, null) as r`,
    [ctx.firmSlug, start, who.email, randomUUID()],
  );
  if (row.rows[0].r.error) throw new Error(row.rows[0].r.error);
  await asMaintenance(db);
  const booking = (
    await db.query<{ id: string; version: number; person_id: string | null }>(`select id, version, person_id from public.bookings where public_ref = $1`, [row.rows[0].r.public_ref])
  ).rows[0];
  return booking;
}


const BODY = "Consultation agreement. The consultation is advice only; no service starts until a service agreement is signed.";

async function template(orgId: string, status = "approved", kind = "consultation") {
  await asMaintenance(db);
  const owner = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and role = 'firm_owner' limit 1`, [orgId])).rows[0].id;
  return (
    await db.query<{ id: string }>(
      `insert into public.agreement_templates (organization_id, kind, name, body, status, approved_at, approved_by)
       values ($1, $2::public.agreement_kind, 'C-02', $3, $4, case when $4 = 'approved' then now() end, case when $4 = 'approved' then $5::uuid end) returning id`,
      [orgId, kind, BODY, status, owner],
    )
  ).rows[0].id;
}

async function refOf(bookingId: string) {
  await asMaintenance(db);
  return (await db.query<{ public_ref: string }>(`select public_ref from public.bookings where id = $1`, [bookingId])).rows[0].public_ref;
}

const forSigning = async (ref: string) => (await db.query<{ r: Record<string, unknown> }>(`select public.booking_agreement_for_signing($1) as r`, [ref])).rows[0].r;
const sign = (ref: string, name: string, consent: boolean, sha: string) =>
  db.query<{ r: Record<string, unknown> }>(`select public.sign_booking_agreement($1, $2, $3, $4, '203.0.113.7'::inet, 'Synthetic browser') as r`, [ref, name, consent, sha]);

type Mail = { action: string; messages: { to: string; template: string; context: Record<string, unknown> }[] };

/** Claims the mail events and prepares the one for this agreement (EM08, booking variant). */
async function prepareAgreementMail(agreementId: string): Promise<Mail> {
  await asServiceRole(db);
  const worker = `worker-${randomUUID().slice(0, 8)}`;
  const claimed = (await db.query<{ c: { id: string; event_type: string; payload: Record<string, unknown> }[] }>(`select public.claim_mail_events($1, 50) as c`, [worker])).rows[0].c;
  const event = claimed.find((row) => row.event_type === "booking_agreement.sent" && row.payload.booking_agreement_id === agreementId);
  expect(event, "booking_agreement.sent").toBeTruthy();
  return (await db.query<{ p: Mail }>(`select public.prepare_email_delivery($1, $2) as p`, [event!.id, worker])).rows[0].p;
}

describe("consultation agreements on bookings", () => {
  it("staff send the approved template; the booker signs once through the private link, without a login", async () => {
    const ctx = await firm();
    const tpl = await template(ctx.orgId);
    const booking = await book(ctx, await localStart(3));
    const ref = await refOf(booking.id);

    // Nothing to sign before staff send it.
    await asAnon(db);
    expect((await forSigning(ref)).state).toBe("unavailable");

    // A draft template, or a template of another kind, is refused.
    const draft = await template(ctx.orgId, "draft");
    const service = await template(ctx.orgId, "approved", "service");
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.send_booking_agreement($1, $2)`, [booking.id, draft]), /approved consultation/);
    await expectDbError(() => db.query(`select public.send_booking_agreement($1, $2)`, [booking.id, service]), /approved consultation/);
    await db.query(`select public.send_booking_agreement($1, $2)`, [booking.id, tpl]);
    await expectDbError(() => db.query(`select public.send_booking_agreement($1, $2)`, [booking.id, tpl]), /already has an agreement/);

    // The link shows the locked text, its hash and the consent; a wrong reference shows nothing.
    await asAnon(db);
    const shown = await forSigning(ref);
    expect(shown).toMatchObject({ state: "open", title: "C-02", body: BODY, attendee: "Synthetic Client" });
    expect(String(shown.sha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(shown.consent_text)).toContain("electronically");
    expect((await forSigning("aaaaaaaaaaaaaaaaaaaaaaaaaa")).state).toBe("unavailable");

    // Consent, a name and the hash shown are required; then it signs once.
    await expectDbError(() => sign(ref, "Synthetic Client", false, String(shown.sha256)), /consent is required/);
    await expectDbError(() => sign(ref, " ", true, String(shown.sha256)), /full name/);
    await expectDbError(() => sign(ref, "Synthetic Client", true, "0".repeat(64)), /changed/);
    expect((await sign(ref, "Synthetic Client", true, String(shown.sha256))).rows[0].r).toMatchObject({ ok: true, replayed: false });
    expect((await sign(ref, "Someone Else", true, String(shown.sha256))).rows[0].r).toMatchObject({ ok: true, replayed: true });
    expect((await forSigning(ref))).toMatchObject({ state: "signed", signed_name: "Synthetic Client" });

    // The record: who, when, what was shown; anon can't read the table; staff can; a signed one can't be voided.
    await expectDbError(() => db.query(`select * from public.booking_agreements`), /permission denied/);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    const row = (await db.query<{ status: string; signer_ip: string; consent_version: string; signed_name: string }>(`select status, host(signer_ip) as signer_ip, consent_version, signed_name from public.booking_agreements where booking_id = $1`, [booking.id])).rows[0];
    expect(row).toMatchObject({ status: "signed", signer_ip: "203.0.113.7", signed_name: "Synthetic Client" });
    expect(row.consent_version).toBeTruthy();
    await expectDbError(() => db.query(`select public.void_booking_agreement($1, 'Wrong template')`, [booking.id]), /no unsigned agreement/);
    await asMaintenance(db);
    const actions = (await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 and action like 'booking_agreement.%' order by occurred_at`, [booking.id])).rows.map((r) => r.action);
    expect(actions).toEqual(["booking_agreement.sent", "booking_agreement.signed"]);
  });

  it("a voided agreement can't be signed, and a new one can be sent", async () => {
    const ctx = await firm();
    const tpl = await template(ctx.orgId);
    const booking = await book(ctx, await localStart(4));
    const ref = await refOf(booking.id);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await db.query(`select public.send_booking_agreement($1, $2)`, [booking.id, tpl]);
    await expectDbError(() => db.query(`select public.void_booking_agreement($1, 'x')`, [booking.id]), /give a reason/);
    await db.query(`select public.void_booking_agreement($1, 'Wrong template sent')`, [booking.id]);
    await asAnon(db);
    // The old link says it was withdrawn (the firm's name only, nothing else).
    expect(await forSigning(ref)).toEqual({ state: "withdrawn", firm: "Synthetic Firm" });
    await expectDbError(() => sign(ref, "Synthetic Client", true, "a".repeat(64)), /not available/);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await db.query(`select public.send_booking_agreement($1, $2)`, [booking.id, tpl]);
    await asAnon(db);
    expect((await forSigning(ref)).state).toBe("open");
  });

  it("only scheduling staff of the firm send; another firm's staff and the client can't", async () => {
    const ctx = await firm();
    const other = await firm();
    const tpl = await template(ctx.orgId);
    const booking = await book(ctx, await localStart(5));
    await asUser(db, staff(other.host.id, other.orgId));
    await expectDbError(() => db.query(`select public.send_booking_agreement($1, $2)`, [booking.id, tpl]), /denied/);
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.send_booking_agreement($1, $2)`, [booking.id, tpl]), /denied/);
  });

  it("the attendee is emailed the private signing link (EM08), only while it is still unsigned", async () => {
    const ctx = await firm();
    const tpl = await template(ctx.orgId);
    const booking = await book(ctx, await localStart(6));
    const ref = await refOf(booking.id);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    const first = (await db.query<{ id: string }>(`select public.send_booking_agreement($1, $2) as id`, [booking.id, tpl])).rows[0].id;

    const mail = await prepareAgreementMail(first);
    expect(mail.action).toBe("send");
    expect(mail.messages).toHaveLength(1);
    expect(mail.messages[0]).toMatchObject({ to: ctx.client.email, template: "agreement" });
    expect(mail.messages[0].context).toMatchObject({ agreement_kind: "consultation", signing_ref: ref, firm: "Synthetic Firm" });

    // Voided before the mail went out: the new one is mailed; a signed one is not mailed again.
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await db.query(`select public.void_booking_agreement($1, 'Wrong template sent')`, [booking.id]);
    const second = (await db.query<{ id: string }>(`select public.send_booking_agreement($1, $2) as id`, [booking.id, tpl])).rows[0].id;
    await asAnon(db);
    const shown = await forSigning(ref);
    await sign(ref, "Synthetic Client", true, String(shown.sha256));
    const late = await prepareAgreementMail(second);
    expect(late.action).toBe("done");
    await asMaintenance(db);
    const skipped = (await db.query<{ status: string }>(`select status from public.email_deliveries where context ->> 'signing_ref' = $1 order by created_at`, [ref])).rows.map((r) => r.status);
    expect(skipped).toEqual(["sending", "skipped"]);
  });

  it("a booking type's agreement is sent with each booking from the booking page", async () => {
    const ctx = await firm();
    const tpl = await template(ctx.orgId);
    const draft = await template(ctx.orgId, "draft");

    // Only the firm owner sets it, and only to an approved consultation template.
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.set_booking_type_agreement($1, $2)`, [ctx.typeId, tpl]), /denied|owner|step-up/i);
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.set_booking_type_agreement($1, $2)`, [ctx.typeId, draft]), /approved consultation/);
    await db.query(`select public.set_booking_type_agreement($1, $2)`, [ctx.typeId, tpl]);

    const booking = await book(ctx, await localStart(7));
    const ref = await refOf(booking.id);
    await asAnon(db);
    expect(await forSigning(ref)).toMatchObject({ state: "open", title: "C-02" });
    await asMaintenance(db);
    const row = (await db.query<{ id: string; sent_by: string | null }>(`select id, sent_by from public.booking_agreements where booking_id = $1`, [booking.id])).rows[0];
    expect(row.sent_by).toBeNull();
    const mail = await prepareAgreementMail(row.id);
    expect(mail.messages[0]).toMatchObject({ to: ctx.client.email, template: "agreement" });
    expect(mail.messages[0].context).toMatchObject({ signing_ref: ref });

    // A template that is no longer approved is skipped: the booking still goes through.
    await asMaintenance(db);
    await db.query(`update public.agreement_templates set status = 'retired' where id = $1`, [tpl]);
    const later = await book(ctx, await localStart(8));
    await asMaintenance(db);
    expect((await db.query(`select 1 from public.booking_agreements where booking_id = $1`, [later.id])).rowCount).toBe(0);

    // None: the owner clears it.
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    await db.query(`select public.set_booking_type_agreement($1, null)`, [ctx.typeId]);
    await asMaintenance(db);
    expect((await db.query<{ a: string | null }>(`select agreement_template_id as a from public.booking_event_types where id = $1`, [ctx.typeId])).rows[0].a).toBeNull();
  });

  it("records the first open, and staff remind at most once an hour", async () => {
    const ctx = await firm();
    const tpl = await template(ctx.orgId);
    const booking = await book(ctx, await localStart(9));
    const ref = await refOf(booking.id);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    const id = (await db.query<{ id: string }>(`select public.send_booking_agreement($1, $2) as id`, [booking.id, tpl])).rows[0].id;

    await asAnon(db);
    await db.query(`select public.note_booking_agreement_opened($1)`, [ref]);
    await asMaintenance(db);
    const first = (await db.query<{ opened_at: string }>(`select opened_at from public.booking_agreements where id = $1`, [id])).rows[0].opened_at;
    expect(first).toBeTruthy();
    await asAnon(db);
    await db.query(`select public.note_booking_agreement_opened($1)`, [ref]);
    await asMaintenance(db);
    expect((await db.query<{ opened_at: string }>(`select opened_at from public.booking_agreements where id = $1`, [id])).rows[0].opened_at).toEqual(first);

    // Within the hour after sending: refused. An hour later: queued, once.
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.remind_booking_agreement($1)`, [booking.id]), /once an hour/);
    await asMaintenance(db);
    await db.query(`update public.booking_agreements set sent_at = now() - interval '2 hours' where id = $1`, [id]);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    expect((await db.query<{ n: number }>(`select public.remind_booking_agreement($1) as n`, [booking.id])).rows[0].n).toBe(1);
    await expectDbError(() => db.query(`select public.remind_booking_agreement($1)`, [booking.id]), /once an hour/);
    // A client can't remind.
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.remind_booking_agreement($1)`, [booking.id]), /denied|no unsigned/);

    await asMaintenance(db);
    const events = (await db.query<{ n: string }>(`select count(*) as n from public.outbox_events where event_type = 'booking_agreement.sent' and payload ->> 'booking_agreement_id' = $1`, [id])).rows[0].n;
    expect(Number(events)).toBe(2);
    const audit = (await db.query<{ action: string }>(`select action from public.audit_log where object_id = $1 and action = 'booking_agreement.reminded'`, [booking.id])).rows;
    expect(audit).toHaveLength(1);

    // Email notices off for this client: refused with a sentence, nothing queued.
    await asMaintenance(db);
    await db.query(`update public.booking_agreements set reminded_at = now() - interval '2 hours' where id = $1`, [id]);
    await db.query(`insert into public.person_contact_preferences (person_id, organization_id, email_notices) values ($1, $2, false)`, [ctx.personId, ctx.orgId]);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.remind_booking_agreement($1)`, [booking.id]), /email notices are off/);
  });
});
