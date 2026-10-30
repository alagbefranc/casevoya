import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { publishTestPrivacyNotice } from "./helpers/privacy-notice";

// #263 item C (20261028140000_booking_possible_match.sql): a booking-page booking made with the
// email of an existing person of the firm is never linked to them by itself. The match is recorded
// for staff, who Link it (one confirmed click) or say Not this person; both are audited. Until it
// is linked the booking is not in that person's portal and its emails are the no-portal kind.
// Everything here is synthetic.

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

async function firm() {
  const ownerUser = await createUser("owner", "Synthetic Owner");
  await asUser(db, { userId: ownerUser.id, aal: "aal2", totpAgeSeconds: 0 });
  const firmSlug = slug();
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", firmSlug]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false, timezone = $2 where id = $1`, [orgId, TZ]);
  // #263-A: booking pages need the firm's published privacy notice.
  await publishTestPrivacyNotice(db, orgId);
  const host = await createUser("host", "Synthetic Host");
  const hostMembership = await membership(orgId, host.id, "licensed_consultant");
  await asUser(db, staff(host.id, orgId));
  await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [orgId, hostMembership, TZ, JSON.stringify(EVERY_DAY)]);
  await asUser(db, staff(ownerUser.id, orgId));
  await db.query(
    `select public.save_booking_event_type($1, null, null, 'Initial consultation', 'initial', null, 30, null, 0, 0, 60, 14, null,
       'video'::public.booking_location_kind, null, $2::uuid[], true)`,
    [orgId, [hostMembership]],
  );
  // The portal client: a login linked to their own person.
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
  // Their matter, with the owner and the host on its team (staff see people through their matters).
  const matterId = (await db.query<{ id: string }>(`insert into public.matters (organization_id, title) values ($1, 'Synthetic matter') returning id`, [orgId])).rows[0].id;
  const ownerMembership = (await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [orgId, ownerUser.id])).rows[0].id;
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, membership_id, role)
     values ($1, $2, $3, null, 'applicant'), ($1, $2, null, $4, 'consultant'), ($1, $2, null, $5, 'consultant')`,
    [orgId, matterId, personId, ownerMembership, hostMembership],
  );
  return { orgId, firmSlug, owner: ownerUser, host, client: clientUser, personId };
}

type Ctx = Awaited<ReturnType<typeof firm>>;

async function localStart(days: number, time = "10:00"): Promise<string> {
  await asMaintenance(db);
  const row = await db.query<{ at: string }>(
    `select to_char(app.local_instant((now() at time zone $1)::date + $2::integer, $3::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
    [TZ, days, time],
  );
  return row.rows[0].at;
}

/** Someone books on the public page, not signed in (or signed in as `as`), with `email`. */
async function book(ctx: Ctx, email: string, options: { days?: number; as?: string } = {}) {
  const start = await localStart(options.days ?? 5);
  // The hold is service role only; the server names the signed-in visitor (20261030231500).
  await asServiceRole(db);
  const row = await db.query<{ r: { public_ref: string; error?: string } }>(
    `select public.booking_public_hold($1, 'initial', $2::timestamptz, 'Somebody Typing', $3, null, 'America/Vancouver', $4, $5, $6::uuid) as r`,
    [ctx.firmSlug, start, email, randomUUID(), createHash("sha256").update(randomUUID()).digest("hex"), options.as ?? null],
  );
  if (row.rows[0].r.error) throw new Error(row.rows[0].r.error);
  await asMaintenance(db);
  return (
    await db.query<{ id: string; version: number; person_id: string | null }>(`select id, version, person_id from public.bookings where public_ref = $1`, [row.rows[0].r.public_ref])
  ).rows[0];
}

async function matches(bookingId: string) {
  await asMaintenance(db);
  return (await db.query<{ person_id: string; status: string; decided_by: string | null }>(`select person_id, status, decided_by from public.booking_person_matches where booking_id = $1 order by created_at, person_id`, [bookingId])).rows;
}

async function audit(action: string, bookingId: string) {
  await asMaintenance(db);
  return (await db.query<{ actor_user_id: string | null; context: Record<string, unknown> }>(`select actor_user_id, context from public.audit_log where action = $1 and object_id = $2`, [action, bookingId])).rows;
}

async function portalBookings(ctx: Ctx) {
  await asUser(db, client(ctx.client.id, ctx.orgId));
  return (await db.query<{ id: string }>(`select id from public.bookings where organization_id = $1`, [ctx.orgId])).rows.map((r) => r.id);
}

async function confirmedMail(ctx: Ctx, bookingId: string) {
  await asServiceRole(db);
  const claimed = (await db.query<{ c: { id: string; event_type: string; payload: Record<string, unknown> }[] }>(`select public.claim_mail_events('test-worker', 50) as c`)).rows[0].c;
  const event = claimed.find((row) => row.event_type === "booking.confirmed" && row.payload.booking_id === bookingId);
  if (!event) throw new Error("no booking.confirmed event");
  return (await db.query<{ p: { messages: { delivery_id: string; to: string; template: string; context: Record<string, unknown> }[] } }>(`select public.prepare_email_delivery($1, 'test-worker') as p`, [event.id])).rows[0].p;
}

const sha = (token: string) => createHash("sha256").update(token).digest("hex");

describe("possible match on a public booking (#263-C)", () => {
  it("a booking with a portal client's email is not linked: the match is recorded, the portal doesn't show it, the email is the no-portal kind", async () => {
    const ctx = await firm();
    // Typed in another case, as anyone can.
    const booking = await book(ctx, ctx.client.email.toUpperCase());
    expect(booking.person_id).toBeNull();
    await asMaintenance(db);
    expect((await db.query(`select person_id from public.booking_attendees where booking_id = $1`, [booking.id])).rows).toEqual([{ person_id: null }]);
    expect(await matches(booking.id)).toEqual([{ person_id: ctx.personId, status: "open", decided_by: null }]);
    expect(await audit("booking.possible_match_recorded", booking.id)).toEqual([{ actor_user_id: null, context: { matches: 1 } }]);

    // Not in the matching client's portal.
    expect(await portalBookings(ctx)).not.toContain(booking.id);

    // EM16a: no portal button; the Manage link is issued, as for any booker without a portal.
    const mail = await confirmedMail(ctx, booking.id);
    expect(mail.messages[0]).toMatchObject({ to: ctx.client.email, template: "consultation_booked" });
    expect(mail.messages[0].context.portal).toBe(false);
    await asServiceRole(db);
    const ref = (await db.query<{ r: string | null }>(`select public.issue_booking_manage_token($1, $2) as r`, [mail.messages[0].delivery_id, sha(randomUUID())])).rows[0].r;
    expect(ref).not.toBeNull();
  });

  it("a signed-in portal client booking for themselves is still linked to their own person, with no possible match", async () => {
    const ctx = await firm();
    const booking = await book(ctx, ctx.client.email, { as: ctx.client.id });
    expect(booking.person_id).toBe(ctx.personId);
    expect(await matches(booking.id)).toEqual([]);
  });

  it("lists every person with that email; none for another email, another firm's people or sample people", async () => {
    const ctx = await firm();
    const other = await firm();
    await asMaintenance(db);
    const shared = `shared-${randomUUID().slice(0, 8)}@example.test`;
    const ids: string[] = [];
    for (const name of ["Shared One", "Shared Two"]) {
      ids.push((await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, email) values ($1, $2, $3) returning id`, [ctx.orgId, name, shared])).rows[0].id);
    }
    await db.query(`insert into public.persons (organization_id, display_name, email) values ($1, 'Elsewhere', $2)`, [other.orgId, shared]);
    await db.query(
      `insert into public.persons (organization_id, display_name, email, is_sample, sample_label) values ($1, 'Sample', $2, true, 'Fictional sample. Not a client record.')`,
      [ctx.orgId, shared],
    );
    const booking = await book(ctx, shared);
    expect((await matches(booking.id)).map((m) => m.person_id).sort()).toEqual([...ids].sort());
    const unrelated = await book(ctx, `nobody-${randomUUID().slice(0, 8)}@example.test`, { days: 6 });
    expect(await matches(unrelated.id)).toEqual([]);
  });

  it("Link: scheduling staff only, version checked; the booking becomes the client's, audited, and later mail is the portal kind", async () => {
    const ctx = await firm();
    const booking = await book(ctx, ctx.client.email);
    const link = () => db.query<{ v: number }>(`select public.link_booking_to_person($1, $2, $3) as v`, [booking.id, ctx.personId, booking.version]);

    // The client themselves, anonymous visitors, another firm's owner and a stale version are refused.
    await asUser(db, client(ctx.client.id, ctx.orgId));
    await expectDbError(link, /staff access denied/);
    await asAnon(db);
    await expectDbError(link, /permission denied/);
    const other = await firm();
    await asUser(db, staff(other.owner.id, other.orgId));
    await expectDbError(link, /staff access denied/);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.link_booking_to_person($1, $2, $3)`, [booking.id, ctx.personId, booking.version + 1]), /changed by someone else/);
    // Only a recorded match can be linked.
    await asMaintenance(db);
    const stranger = (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, email) values ($1, 'Stranger', 'stranger@example.test') returning id`, [ctx.orgId])).rows[0].id;
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.link_booking_to_person($1, $2, $3)`, [booking.id, stranger, booking.version]), /no possible match/);
    // #272 (#269): PT404, which PostgREST answers as 404; P0002 was answered as HTTP 500.
    await expectDbError(
      () =>
        db.exec(`do $$ begin
          perform public.dismiss_booking_match('${booking.id}'::uuid, '${stranger}'::uuid, ${Number(booking.version)});
        exception when others then raise exception 'sqlstate %', sqlstate;
        end $$`),
      /sqlstate PT404/,
    );
    expect(await portalBookings(ctx)).not.toContain(booking.id);

    // The firm owner links it.
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    const version = (await link()).rows[0].v;
    expect(version).toBe(booking.version + 1);
    await asMaintenance(db);
    expect((await db.query(`select person_id from public.bookings where id = $1`, [booking.id])).rows[0]).toEqual({ person_id: ctx.personId });
    expect((await db.query(`select person_id from public.booking_attendees where booking_id = $1`, [booking.id])).rows[0]).toEqual({ person_id: ctx.personId });
    expect(await matches(booking.id)).toEqual([{ person_id: ctx.personId, status: "linked", decided_by: ctx.owner.id }]);
    expect(await audit("booking.linked_to_client", booking.id)).toEqual([{ actor_user_id: ctx.owner.id, context: { person_id: ctx.personId, portal: true } }]);
    expect(await portalBookings(ctx)).toContain(booking.id);

    // Once linked it can't be linked or dismissed again.
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.link_booking_to_person($1, $2, $3)`, [booking.id, ctx.personId, version]), /already linked/);
    await expectDbError(() => db.query(`select public.dismiss_booking_match($1, $2, $3)`, [booking.id, ctx.personId, version]), /already linked/);

    // The next booking email follows the linked rules: the portal button, no Manage link.
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    const later = await localStart(7);
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    await db.query(`select public.staff_reschedule_booking($1, $2, $3::timestamptz, $4)`, [ctx.orgId, booking.id, later, version]);
    await asServiceRole(db);
    const claimed = (await db.query<{ c: { id: string; event_type: string; payload: Record<string, unknown> }[] }>(`select public.claim_mail_events('test-worker', 50) as c`)).rows[0].c;
    const moved = claimed.find((row) => row.event_type === "booking.rescheduled" && row.payload.booking_id === booking.id);
    expect(moved).toBeTruthy();
    const mail = (await db.query<{ p: { messages: { delivery_id: string; context: Record<string, unknown> }[] } }>(`select public.prepare_email_delivery($1, 'test-worker') as p`, [moved!.id])).rows[0].p;
    expect(mail.messages[0].context.portal).toBe(true);
    expect((await db.query<{ r: string | null }>(`select public.issue_booking_manage_token($1, $2) as r`, [mail.messages[0].delivery_id, sha(randomUUID())])).rows[0].r).toBeNull();
  });

  it("Not this person: dismissed and audited; the booking stays unlinked and out of the portal", async () => {
    const ctx = await firm();
    const booking = await book(ctx, ctx.client.email);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.dismiss_booking_match($1, $2, null)`, [booking.id, ctx.personId]), /changed by someone else/);
    await db.query(`select public.dismiss_booking_match($1, $2, $3)`, [booking.id, ctx.personId, booking.version]);
    expect(await matches(booking.id)).toEqual([{ person_id: ctx.personId, status: "dismissed", decided_by: ctx.host.id }]);
    expect(await audit("booking.match_dismissed", booking.id)).toEqual([{ actor_user_id: ctx.host.id, context: { person_id: ctx.personId } }]);
    await asUser(db, staff(ctx.host.id, ctx.orgId));
    await expectDbError(() => db.query(`select public.link_booking_to_person($1, $2, $3)`, [booking.id, ctx.personId, booking.version]), /already decided/);
    await asMaintenance(db);
    expect((await db.query(`select person_id from public.bookings where id = $1`, [booking.id])).rows[0]).toEqual({ person_id: null });
    expect(await portalBookings(ctx)).not.toContain(booking.id);
  });

  it("staff see a match only for people they can see; nobody writes the table directly", async () => {
    const ctx = await firm();
    const booking = await book(ctx, ctx.client.email);
    // The owner sees it; a case manager who isn't on the person's matter neither sees nor links it.
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    expect((await db.query(`select person_id from public.booking_person_matches where booking_id = $1`, [booking.id])).rows).toEqual([{ person_id: ctx.personId }]);
    const manager = await createUser("manager");
    await membership(ctx.orgId, manager.id, "case_manager");
    await asUser(db, staff(manager.id, ctx.orgId));
    expect((await db.query(`select person_id from public.booking_person_matches where booking_id = $1`, [booking.id])).rows).toEqual([]);
    await expectDbError(() => db.query(`select public.link_booking_to_person($1, $2, $3)`, [booking.id, ctx.personId, booking.version]), /no possible match/);
    // The client and another firm see nothing.
    await asUser(db, client(ctx.client.id, ctx.orgId));
    expect((await db.query(`select 1 from public.booking_person_matches where booking_id = $1`, [booking.id])).rows).toEqual([]);
    const other = await firm();
    await asUser(db, staff(other.owner.id, other.orgId));
    expect((await db.query(`select 1 from public.booking_person_matches where booking_id = $1`, [booking.id])).rows).toEqual([]);
    // No direct writes.
    await asUser(db, staff(ctx.owner.id, ctx.orgId));
    await expectDbError(() => db.query(`update public.booking_person_matches set status = 'linked', decided_at = now() where booking_id = $1`, [booking.id]), /permission denied/);
    await expectDbError(
      () => db.query(`insert into public.booking_person_matches (organization_id, booking_id, person_id) values ($1, $2, $3)`, [ctx.orgId, booking.id, ctx.personId]),
      /permission denied/,
    );
    await asMaintenance(db);
    const rls = (await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.booking_person_matches'::regclass`)).rows[0];
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
