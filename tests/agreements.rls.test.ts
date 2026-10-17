import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const IP = "203.0.113.10";
const AGENT = "SyntheticAgent/1.0";

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

function email(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, now(), '{}'::jsonb)`,
    [id, address],
  );
  return id;
}

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(
    `select (public.create_organization($1, $2, $3)).id as id`,
    ["Synthetic Legal Name", "Synthetic Firm", slug()],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new Error("organization was not created");
  return id;
}

async function activeMembership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4)
     returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const client = await createUser(email("client"));
  const sponsor = await createUser(email("sponsor"));
  const finance = await createUser(email("finance"));
  const outsider = await createUser(email("outsider"));
  const orgId = await createOrg(owner);
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const financeMembership = await activeMembership(orgId, finance, "finance_user", owner);
  await activeMembership(orgId, client, "client", owner);
  await activeMembership(orgId, sponsor, "sponsor", owner);
  await asMaintenance(db);
  const ownerMembership = (
    await db.query<{ id: string }>(
      `select id from public.memberships where organization_id = $1 and user_id = $2`,
      [orgId, owner],
    )
  ).rows[0].id;
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check(
       $1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note'
     )`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { ok: boolean; id: string } }>(
    `select public.create_engaged_matter(
       'Synthetic matter', true, $1, null, 'Prepare a fictional application and nothing else.'
     ) as result`,
    [consultantMembership],
  );
  const matterId = matter.rows[0].result.id;
  await db.query(
    `insert into public.persons (organization_id, display_name, is_sample, user_id)
     values ($1, 'Synthetic applicant', true, $2), ($1, 'Synthetic sponsor', true, $3)`,
    [orgId, client, sponsor],
  );
  const people = await db.query<{ id: string; display_name: string }>(
    `select id, display_name from public.persons where organization_id = $1`,
    [orgId],
  );
  const applicant = people.rows.find((row) => row.display_name === "Synthetic applicant")?.id;
  const sponsorPerson = people.rows.find((row) => row.display_name === "Synthetic sponsor")?.id;
  if (!applicant || !sponsorPerson) throw new Error("people were not created");
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role)
     values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`,
    [orgId, matterId, applicant, sponsorPerson],
  );
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role)
     values ($1, $2, $3, 'assistant')`,
    [orgId, matterId, financeMembership],
  );
  const otherOrg = await createOrg(outsider);
  return {
    owner,
    consultant,
    client,
    sponsor,
    finance,
    outsider,
    orgId,
    otherOrg,
    consultantMembership,
    financeMembership,
    ownerMembership,
    matterId,
    applicant,
    sponsorPerson,
  };
}

const SCOPE = "Prepare a fictional application and nothing else.";
const BODY = "Synthetic service text. Government fees are paid by the client to the authority. No fee amount is stated.";
const NOTE = "Paid by the client to the authority. No amount is stored.";

function signers(ctx: Awaited<ReturnType<typeof firm>>) {
  return JSON.stringify([
    { role: "client", person_id: ctx.applicant, display_name: "Synthetic applicant" },
    { role: "consultant", membership_id: ctx.consultantMembership, display_name: "Synthetic consultant" },
  ]);
}

async function draftService(ctx: Awaited<ReturnType<typeof firm>>, fee = 10000) {
  await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(
    `select public.create_agreement(
       $1, 'service'::public.agreement_kind, 'Synthetic service agreement', $2, $3,
       'Appeals are not included.', 'See the agreement text.', $4, 'CAD', $5,
       null, null, null, null
     ) as id`,
    [ctx.matterId, BODY, SCOPE, fee, NOTE],
  );
  return created.rows[0].id;
}

describe("in-house agreements and signatures", () => {
  it("forces RLS on every agreement table and keeps the documents bucket private", async () => {
    const flags = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity
       from pg_class
       where relname in (
         'agreement_templates', 'agreements', 'agreement_versions', 'signature_envelopes',
         'envelope_signers', 'signature_events', 'representation_authorities'
       )`,
    );
    expect(flags.rows).toHaveLength(7);
    expect(flags.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const bucket = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'documents'`);
    expect(bucket.rows[0]?.public).toBe(false);
  });

  it("refuses a send without step-up and a client cannot draft an agreement", async () => {
    const ctx = await firm();
    const agreementId = await draftService(ctx);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 60 * 30 });
    await expectDbError(
      () => db.query(`select public.send_agreement($1, $2::jsonb, $3, null)`, [agreementId, signers(ctx), `send-${randomUUID()}`]),
      /step-up/i,
    );
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(
      () =>
        db.query(
          `select public.create_agreement(
             $1, 'service'::public.agreement_kind, 'Client draft', $2, $3,
             null, null, null, 'CAD', null, null, null, null, null
           )`,
          [ctx.matterId, BODY, SCOPE],
        ),
      /denied|step-up|staff/i,
    );
  });

  it("locks the sent text, rejects an early signer, and keeps a duplicate signature from executing twice", async () => {
    const ctx = await firm();
    const agreementId = await draftService(ctx);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const key = `send-${randomUUID()}`;
    const sent = await db.query<{ result: { envelope_id: string; content_sha256: string; replayed: boolean } }>(
      `select public.send_agreement($1, $2::jsonb, $3, null) as result`,
      [agreementId, signers(ctx), key],
    );
    const again = await db.query<{ result: { envelope_id: string; replayed: boolean } }>(
      `select public.send_agreement($1, $2::jsonb, $3, null) as result`,
      [agreementId, signers(ctx), key],
    );
    const envelopeId = sent.rows[0].result.envelope_id;
    expect(again.rows[0].result.replayed).toBe(true);
    expect(again.rows[0].result.envelope_id).toBe(envelopeId);
    const locked = await db.query<{ content_sha256: string; locked_at: string }>(
      `select content_sha256, locked_at from public.agreement_versions where agreement_id = $1`,
      [agreementId],
    );
    expect(locked.rows[0].content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(locked.rows[0].locked_at).toBeTruthy();
    await asMaintenance(db);
    await expectDbError(
      () => db.query(`update public.agreement_versions set canonical_body = 'changed' where agreement_id = $1`, [agreementId]),
      /cannot change|agreement function/i,
    );

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(`select public.sign_agreement($1, true, $2, $3::inet, $4)`, [
          envelopeId,
          `early-${randomUUID()}`,
          IP,
          AGENT,
        ]),
      /not your turn|identity/i,
    );

    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(
      () => db.query(`select public.sign_agreement($1, false, $2, $3::inet, $4)`, [envelopeId, `noconsent-${randomUUID()}`, IP, AGENT]),
      /consent/i,
    );
    const signKey = `sign-${randomUUID()}`;
    const first = await db.query<{ result: { status: string; replayed: boolean } }>(
      `select public.sign_agreement($1, true, $2, $3::inet, $4) as result`,
      [envelopeId, signKey, IP, AGENT],
    );
    const replay = await db.query<{ result: { status: string; replayed: boolean } }>(
      `select public.sign_agreement($1, true, $2, $3::inet, $4) as result`,
      [envelopeId, signKey, IP, AGENT],
    );
    expect(first.rows[0].result.status).toBe("partially_signed");
    expect(replay.rows[0].result.replayed).toBe(true);
    expect(replay.rows[0].result.status).toBe("partially_signed");
    const events = await db.query<{ n: number }>(
      `select count(*)::int as n from public.signature_events where envelope_id = $1 and kind = 'signed'`,
      [envelopeId],
    );
    expect(events.rows[0].n).toBe(1);
    const evidence = await db.query<{ ip: string; user_agent: string; consent_accepted: boolean }>(
      `select ip::text, user_agent, consent_accepted
       from public.envelope_signers where envelope_id = $1 and status = 'signed'`,
      [envelopeId],
    );
    expect(evidence.rows[0]).toMatchObject({ ip: `${IP}/32`, user_agent: AGENT, consent_accepted: true });
    const engagement = await db.query<{ engagement_status: string }>(
      `select engagement_status::text from public.matters where id = $1`,
      [ctx.matterId],
    );
    expect(engagement.rows[0].engagement_status).toBe("pending");
  });

  it("supersedes a partial signature when the fee changes and seals the new version into the documents bucket", async () => {
    const ctx = await firm();
    const agreementId = await draftService(ctx, 10000);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const sent = await db.query<{ result: { envelope_id: string; content_sha256: string } }>(
      `select public.send_agreement($1, $2::jsonb, $3, null) as result`,
      [agreementId, signers(ctx), `send-${randomUUID()}`],
    );
    const oldHash = sent.rows[0].result.content_sha256;
    const oldEnvelope = sent.rows[0].result.envelope_id;
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await db.query(`select public.sign_agreement($1, true, $2, $3::inet, $4)`, [oldEnvelope, `sign-${randomUUID()}`, IP, AGENT]);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(
      `select public.revise_agreement($1, $2, $3, 12500, $4, 'Professional fee snapshot changed before everyone signed.')`,
      [agreementId, `${BODY} Revised.`, SCOPE, NOTE],
    );
    const versions = await db.query<{ content_sha256: string | null; fee_cents: string | null; locked_at: string | null }>(
      `select content_sha256, fee_cents::text, locked_at::text
       from public.agreement_versions where agreement_id = $1 order by version_number`,
      [agreementId],
    );
    expect(versions.rows[0].content_sha256).toBe(oldHash);
    expect(versions.rows[0].fee_cents).toBe("10000");
    expect(versions.rows[1].content_sha256).toBeNull();
    expect(versions.rows[1].fee_cents).toBe("12500");
    const oldStatus = await db.query<{ status: string }>(
      `select status::text from public.signature_envelopes where id = $1`,
      [oldEnvelope],
    );
    expect(oldStatus.rows[0].status).toBe("superseded");

    const resent = await db.query<{ result: { envelope_id: string; content_sha256: string } }>(
      `select public.send_agreement($1, $2::jsonb, $3, null) as result`,
      [agreementId, signers(ctx), `resend-${randomUUID()}`],
    );
    expect(resent.rows[0].result.content_sha256).not.toBe(oldHash);
    const envelopeId = resent.rows[0].result.envelope_id;
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await db.query(`select public.sign_agreement($1, true, $2, $3::inet, $4)`, [envelopeId, `sign2-${randomUUID()}`, IP, AGENT]);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const done = await db.query<{ result: { status: string; sealed_sha256: string; sealed_version_id: string } }>(
      `select public.sign_agreement($1, true, $2, $3::inet, $4) as result`,
      [envelopeId, `final-${randomUUID()}`, IP, AGENT],
    );
    expect(done.rows[0].result.status).toBe("completed");
    const sealed = done.rows[0].result.sealed_sha256;
    const versionId = done.rows[0].result.sealed_version_id;
    const stored = await db.query<{ checksum_sha256: string; upload_state: string; storage_key: string; bucket: string }>(
      `select version.checksum_sha256, version.upload_state::text, version.storage_key, version.storage_bucket as bucket
       from public.document_versions version where version.id = $1`,
      [versionId],
    );
    expect(stored.rows[0]).toMatchObject({ checksum_sha256: sealed, upload_state: "clean", bucket: "documents" });
    const object = await db.query<{ sha: string; size: string }>(
      `select metadata ->> 'sha256' as sha, metadata ->> 'size' as size
       from storage.objects where bucket_id = 'documents' and name = $1`,
      [stored.rows[0].storage_key],
    );
    expect(object.rows[0].sha).toBe(sealed);
    expect(Number(object.rows[0].size)).toBeGreaterThan(50);
    const pdf = await db.query<{ pdf: Uint8Array }>(
      `select public.agreement_executed_pdf($1) as pdf`,
      [envelopeId],
    );
    const bytes = pdf.rows[0].pdf;
    expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sealed);
    const engagement = await db.query<{ engagement_status: string; agreement_locator: string }>(
      `select matter.engagement_status::text, engagement.agreement_locator
       from public.matters matter
       join public.matter_engagements engagement on engagement.matter_id = matter.id
       where matter.id = $1 and engagement.status = 'engaged'`,
      [ctx.matterId],
    );
    expect(engagement.rows[0].engagement_status).toBe("engaged");
    expect(engagement.rows[0].agreement_locator).toBe(agreementId);
    const authority = await db.query<{ n: number }>(
      `select count(*)::int as n from public.representation_authorities where matter_id = $1`,
      [ctx.matterId],
    );
    expect(authority.rows[0].n).toBe(0);
    const consent = await db.query<{ n: number }>(
      `select count(*)::int as n from public.consent_records
       where matter_id = $1 and purpose = 'electronic_signature' and granted is true`,
      [ctx.matterId],
    );
    expect(consent.rows[0].n).toBe(2);
    await asMaintenance(db);
    await expectDbError(
      () => db.query(`update public.signature_events set summary = '{}'::jsonb where envelope_id = $1`, [envelopeId]),
      /cannot be changed/i,
    );

    await asUser(db, { userId: ctx.finance, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const financeSees = await db.query<{ id: string }>(`select id from public.agreements`);
    expect(financeSees.rows.map((row) => row.id)).toContain(agreementId);
    await asUser(db, { userId: ctx.outsider, aal: "aal2", orgId: ctx.otherOrg, totpAgeSeconds: 0 });
    const hidden = await db.query(`select id from public.agreements`);
    expect(hidden.rows).toHaveLength(0);
    await asUser(db, { userId: ctx.sponsor, aal: "aal1", orgId: ctx.orgId });
    const sponsorSees = await db.query(`select id from public.agreements`);
    expect(sponsorSees.rows).toHaveLength(0);
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const clientSees = await db.query<{ id: string }>(`select id from public.agreements`);
    expect(clientSees.rows.map((row) => row.id)).toContain(agreementId);
  });

  it("accepts a quote without engaging the matter", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const quoteId = (
      await db.query<{ id: string }>(
        `select public.create_agreement(
           $1, 'quote'::public.agreement_kind, 'Synthetic quote', $2, $3,
           null, null, 5000, 'CAD', $4, null, current_date + 7, null, null
         ) as id`,
        [ctx.matterId, BODY, SCOPE, NOTE],
      )
    ).rows[0].id;
    await db.query(`select public.send_agreement($1, '[]'::jsonb, $2, null)`, [quoteId, `quote-${randomUUID()}`]);
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await db.query(`select public.accept_quote($1)`, [quoteId]);
    const row = await db.query<{ status: string; engagement_status: string }>(
      `select agreement.status::text, matter.engagement_status::text
       from public.agreements agreement
       join public.matters matter on matter.id = agreement.matter_id
       where agreement.id = $1`,
      [quoteId],
    );
    expect(row.rows[0]).toMatchObject({ status: "accepted", engagement_status: "pending" });
    const envelopes = await db.query(`select id from public.signature_envelopes where agreement_id = $1`, [quoteId]);
    expect(envelopes.rows).toHaveLength(0);
  });
});
