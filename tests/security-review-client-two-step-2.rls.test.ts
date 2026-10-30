import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { publishTestPrivacyNotice } from "./helpers/privacy-notice";

/**
 * SEC-01 client two-step, second part (20261030223000): e-sign, portal bookings and document
 * requests. A portal client with a verified second factor reaches them only from a session that
 * completed it; a client without a factor keeps working at aal1; visitors without a session
 * still book on the public page.
 */
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

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const IP = "203.0.113.10";
const AGENT = "SyntheticAgent/1.0";
const TZ = "America/Toronto";
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "09:00", end: "17:00" }));

type Factor = "verified" | null;

const slug = () => `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@example.test`;
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, email]);
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

async function addFactor(userId: string, factor: Factor) {
  if (!factor) return;
  await asMaintenance(db);
  await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', $3)`, [randomUUID(), userId, factor]);
}

async function createOrg(ownerId: string, firmSlug = slug()) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    firmSlug,
  ]);
  return created.rows[0].id;
}

const asStaff = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
const asClient = (userId: string, orgId: string | null, aal: "aal1" | "aal2") =>
  asUser(db, { userId, aal, orgId, ...(aal === "aal2" ? { totpAgeSeconds: 30 } : {}) });

/** A firm with a licensed consultant on an engaged matter and an applicant with a portal login. */
async function practice(factor: Factor) {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const client = await createUser("client");
  const orgId = await createOrg(owner.id);
  const consultantMembership = await membership(orgId, consultant.id, "licensed_consultant");
  await membership(orgId, client.id, "client");
  await addFactor(client.id, factor);
  await asStaff(consultant.id, orgId);
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asStaff(owner.id, orgId);
  await db.query(
    `select public.record_licence_check(
       $1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note'
     )`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asStaff(consultant.id, orgId);
  const matter = await db.query<{ result: { id: string } }>(
    `select public.create_engaged_matter('Synthetic matter', true, $1, null, 'Prepare a fictional application and nothing else.') as result`,
    [consultantMembership],
  );
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, 'Synthetic applicant', true, $2) returning id`,
    [orgId, client.id],
  );
  const applicant = person.rows[0].id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [
    orgId,
    matterId,
    applicant,
  ]);
  return { owner: owner.id, consultant: consultant.id, client: client.id, orgId, consultantMembership, matterId, applicant };
}

type Practice = Awaited<ReturnType<typeof practice>>;

async function sentAgreement(ctx: Practice) {
  await asStaff(ctx.consultant, ctx.orgId);
  const created = await db.query<{ id: string }>(
    `select public.create_agreement(
       $1, 'service'::public.agreement_kind, 'Synthetic service agreement', $2, $3,
       'Appeals are not included.', 'See the agreement text.', 10000, 'CAD', $4, null, null, null, null
     ) as id`,
    [
      ctx.matterId,
      "Synthetic service text. Government fees are paid by the client to the authority. No fee amount is stated.",
      "Prepare a fictional application and nothing else.",
      "Paid by the client to the authority. No amount is stored.",
    ],
  );
  const agreementId = created.rows[0].id;
  const signers = JSON.stringify([
    { role: "client", person_id: ctx.applicant, display_name: "Synthetic applicant" },
    { role: "consultant", membership_id: ctx.consultantMembership, display_name: "Synthetic consultant" },
  ]);
  const sent = await db.query<{ result: { envelope_id: string } }>(`select public.send_agreement($1, $2::jsonb, $3, null) as result`, [
    agreementId,
    signers,
    `send-${randomUUID()}`,
  ]);
  return { agreementId, envelopeId: sent.rows[0].result.envelope_id };
}

async function agreementView(agreementId: string, envelopeId: string) {
  const agreements = await db.query(`select id from public.agreements where id = $1`, [agreementId]);
  const envelopes = await db.query(`select id from public.signature_envelopes where id = $1`, [envelopeId]);
  const signers = await db.query(`select id from public.envelope_signers where envelope_id = $1`, [envelopeId]);
  return { agreements: agreements.rows.length, envelopes: envelopes.rows.length, signers: signers.rows.length };
}

const sign = (envelopeId: string) =>
  db.query<{ result: { status: string } }>(`select app.sign_agreement($1, true, $2, $3::inet, $4) as result`, [
    envelopeId,
    `sign-${randomUUID()}`,
    IP,
    AGENT,
  ]);

describe("e-sign: the client signer needs their second step", () => {
  it("hides the agreement and refuses signing and declining at aal1, and allows it at aal2", async () => {
    const ctx = await practice("verified");
    const { agreementId, envelopeId } = await sentAgreement(ctx);

    await asClient(ctx.client, ctx.orgId, "aal1");
    expect(await agreementView(agreementId, envelopeId)).toEqual({ agreements: 0, envelopes: 0, signers: 0 });
    const gate = await db.query<{ ok: boolean }>(`select app.can_read_agreement($1) as ok`, [agreementId]);
    expect(gate.rows[0].ok).toBe(false);
    await expectDbError(() => sign(envelopeId), /two-step/);
    await expectDbError(
      () => db.query(`select app.decline_agreement($1, $2, $3::inet, $4)`, [envelopeId, `decline-${randomUUID()}`, IP, AGENT]),
      /two-step/,
    );
    await asMaintenance(db);
    const untouched = await db.query<{ status: string }>(`select status::text from public.envelope_signers where envelope_id = $1 and person_id is not null`, [envelopeId]);
    expect(untouched.rows[0].status).toBe("current");

    await asClient(ctx.client, ctx.orgId, "aal2");
    expect(await agreementView(agreementId, envelopeId)).toEqual({ agreements: 1, envelopes: 1, signers: 2 });
    expect((await sign(envelopeId)).rows[0].result.status).toBe("partially_signed");
  });

  it("keeps a client without a factor signing at aal1", async () => {
    const ctx = await practice(null);
    const { agreementId, envelopeId } = await sentAgreement(ctx);
    await asClient(ctx.client, ctx.orgId, "aal1");
    expect(await agreementView(agreementId, envelopeId)).toEqual({ agreements: 1, envelopes: 1, signers: 2 });
    expect((await sign(envelopeId)).rows[0].result.status).toBe("partially_signed");
  });

  it("leaves the staff view unchanged", async () => {
    const ctx = await practice("verified");
    const { agreementId, envelopeId } = await sentAgreement(ctx);
    await asStaff(ctx.consultant, ctx.orgId);
    expect(await agreementView(agreementId, envelopeId)).toEqual({ agreements: 1, envelopes: 1, signers: 2 });
  });
});

async function documentRequest(ctx: Practice) {
  await asStaff(ctx.consultant, ctx.orgId);
  const row = await db.query<{ id: string }>(
    `select public.create_document_request(
       $1, $2, 'Passport bio page', 'The page with the photograph.', null, array['pdf']::text[],
       'Readable.', null, 'subject'::public.document_audience, 'ordinary'::public.document_sensitivity, null, null
     ) as id`,
    [ctx.matterId, ctx.applicant],
  );
  return row.rows[0].id;
}

const uploadIntent = (ctx: Practice) =>
  db.query<{ result: { version_id: string; document_id: string } }>(
    `select public.create_upload_intent($1, $2, 'passport.pdf', 40, 'Passport bio page', 'ordinary', 'subject', null, null, null) as result`,
    [ctx.matterId, ctx.applicant],
  );

async function documentView(requestId: string, documentId: string) {
  const requests = await db.query(`select id from public.document_requests where id = $1`, [requestId]);
  const documents = await db.query(`select id from public.documents where id = $1`, [documentId]);
  return { requests: requests.rows.length, documents: documents.rows.length };
}

describe("document requests: the client needs their second step", () => {
  it("hides requests and documents and refuses an upload at aal1, and allows them at aal2", async () => {
    const ctx = await practice("verified");
    const requestId = await documentRequest(ctx);
    await asStaff(ctx.consultant, ctx.orgId);
    const staffDoc = (await uploadIntent(ctx)).rows[0].result.document_id;

    await asClient(ctx.client, ctx.orgId, "aal1");
    expect(await documentView(requestId, staffDoc)).toEqual({ requests: 0, documents: 0 });
    const gate = await db.query<{ read: boolean }>(`select app.can_read_document($1) as read`, [staffDoc]);
    expect(gate.rows[0].read).toBe(false);
    await expectDbError(() => uploadIntent(ctx), /document upload denied/);

    await asClient(ctx.client, ctx.orgId, "aal2");
    expect(await documentView(requestId, staffDoc)).toEqual({ requests: 1, documents: 1 });
    const intent = (await uploadIntent(ctx)).rows[0].result;
    expect(intent.version_id).toBeTruthy();
    await db.query(`select public.attach_upload_to_request($1, $2)`, [intent.version_id, requestId]);
  });

  it("keeps a client without a factor uploading at aal1", async () => {
    const ctx = await practice(null);
    const requestId = await documentRequest(ctx);
    await asClient(ctx.client, ctx.orgId, "aal1");
    const intent = (await uploadIntent(ctx)).rows[0].result;
    expect(await documentView(requestId, intent.document_id)).toEqual({ requests: 1, documents: 1 });
    await db.query(`select public.attach_upload_to_request($1, $2)`, [intent.version_id, requestId]);
  });
});

/** A firm with a public booking page and a client (with a portal login and person). */
async function bookingFirm(factor: Factor) {
  const owner = await createUser("owner");
  const firmSlug = slug();
  const orgId = await createOrg(owner.id, firmSlug);
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false, timezone = $2 where id = $1`, [orgId, TZ]);
  await publishTestPrivacyNotice(db, orgId);
  const host = await createUser("host");
  const hostMembership = await membership(orgId, host.id, "licensed_consultant");
  await asStaff(host.id, orgId);
  await db.query(`select public.save_availability($1, $2, $3, $4::jsonb, '[]'::jsonb)`, [orgId, hostMembership, TZ, JSON.stringify(EVERY_DAY)]);
  await asStaff(owner.id, orgId);
  await db.query(
    `select public.save_booking_event_type($1, null, null, 'Package review call', 'review', null, 30, null, 0, 0, 60, 14, null,
       'meeting_link'::public.booking_location_kind, 'https://meet.example.test/room', $2::uuid[], true)`,
    [orgId, [hostMembership]],
  );
  const client = await createUser("client");
  await membership(orgId, client.id, "client");
  await addFactor(client.id, factor);
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, user_id, display_name, email) values ($1, $2, 'Synthetic Client', $3) returning id`,
    [orgId, client.id, client.email],
  );
  return { orgId, firmSlug, client, personId: person.rows[0].id };
}

type BookingFirm = Awaited<ReturnType<typeof bookingFirm>>;

async function localStart(days: number, time: string) {
  await asMaintenance(db);
  const row = await db.query<{ at: string }>(
    `select to_char(app.local_instant((now() at time zone $1)::date + $2::integer, $3::time, $1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at`,
    [TZ, days, time],
  );
  return row.rows[0].at;
}

/**
 * Books on the public page as the app server does (service role, 20261030231500), naming the signed-in
 * visitor and the assurance level of their verified session (null when signed out); returns the booking row.
 */
async function hold(ctx: BookingFirm, start: string, viewer: { aal: "aal1" | "aal2" } | null) {
  await asServiceRole(db);
  const row = await db.query<{ r: { public_ref: string; error?: string } }>(
    `select public.booking_public_hold($1, 'review', $2::timestamptz, 'Synthetic Client', $3, null, 'America/Vancouver', $4, null, $5::uuid, $6) as r`,
    [ctx.firmSlug, start, ctx.client.email, randomUUID(), viewer ? ctx.client.id : null, viewer?.aal ?? null],
  );
  if (row.rows[0].r.error) throw new Error(row.rows[0].r.error);
  await asMaintenance(db);
  return (
    await db.query<{ id: string; version: number; person_id: string | null }>(`select id, version, person_id from public.bookings where public_ref = $1`, [
      row.rows[0].r.public_ref,
    ])
  ).rows[0];
}

const cancel = (ctx: BookingFirm, bookingId: string) =>
  db.query<{ r: { late: boolean } }>(`select public.portal_cancel_booking($1, $2, null, null) as r`, [ctx.orgId, bookingId]);

describe("portal bookings: the client needs their second step", () => {
  it("hides the client's bookings and refuses cancelling at aal1, and allows it at aal2", async () => {
    const ctx = await bookingFirm("verified");
    const first = await localStart(5, "10:00");
    const second = await localStart(6, "11:00");
    const booking = await hold(ctx, first, { aal: "aal2" });
    expect(booking.person_id).toBe(ctx.personId);

    await asClient(ctx.client.id, ctx.orgId, "aal1");
    expect((await db.query(`select id from public.bookings where id = $1`, [booking.id])).rows).toHaveLength(0);
    const rules = await db.query<{ r: Record<string, unknown> }>(`select public.portal_booking_rules($1) as r`, [ctx.orgId]);
    expect(rules.rows[0].r).toEqual({});
    await expectDbError(() => cancel(ctx, booking.id), /booking access denied/);

    // At aal1 a public booking is made as for a visitor: not linked to the client's person.
    const unlinked = await hold(ctx, second, { aal: "aal1" });
    expect(unlinked.person_id).toBeNull();

    await asClient(ctx.client.id, ctx.orgId, "aal2");
    expect((await db.query(`select id from public.bookings where id = $1`, [booking.id])).rows).toHaveLength(1);
    expect((await cancel(ctx, booking.id)).rows[0].r).toEqual({ late: false });
  });

  it("keeps a client without a factor booking and cancelling at aal1, and visitors booking", async () => {
    const ctx = await bookingFirm(null);
    const first = await localStart(5, "10:00");
    const second = await localStart(6, "11:00");
    const booking = await hold(ctx, first, { aal: "aal1" });
    expect(booking.person_id).toBe(ctx.personId);
    await asClient(ctx.client.id, ctx.orgId, "aal1");
    expect((await db.query(`select id from public.bookings where id = $1`, [booking.id])).rows).toHaveLength(1);
    expect((await cancel(ctx, booking.id)).rows[0].r).toEqual({ late: false });

    const visitor = await hold(ctx, second, null);
    expect(visitor.id).toBeTruthy();
    expect(visitor.person_id).toBeNull();
  });
});
