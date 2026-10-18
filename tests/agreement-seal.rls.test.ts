import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { renderAgreementPdf, renderCertificatePdf, SEAL_RENDERER } from "@/modules/agreements/pdf-render";
import { agreementTerms, parseSealSource } from "@/modules/agreements/seal-source";

/**
 * The laid-out sealed PDF (20261019000000): the last signature completes the envelope, the app
 * server renders the PDF from the envelope's immutable rows, and the service role attaches it
 * once. It can never be replaced, and envelopes sealed before keep their bytes.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const IP = "203.0.113.10";
const AGENT = "SyntheticAgent/1.0";
const SCOPE = "Préparer une demande fictive de parrainage, et rien d'autre.";
const BODY = "# Services\nThe firm prepares a fictional application.\n\n- Le client fournit les documents demandés.\n- Les délais sont fixés par IRCC.";

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

async function createUser() {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, `user-${id.slice(0, 8)}@example.test`],
  );
  return id;
}

async function membership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

async function envelope() {
  const owner = await createUser();
  const consultant = await createUser();
  const client = await createUser();
  const sponsor = await createUser();
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const orgId = (
    await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
      "Cabinet Fictif Rivière Inc.",
      "Cabinet Fictif",
      `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    ])
  ).rows[0].id;
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant", owner);
  await membership(orgId, client, "client", owner);
  await membership(orgId, sponsor, "sponsor", owner);
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
  const matterId = (
    await db.query<{ result: { id: string } }>(
      `select public.create_engaged_matter('Synthetic matter', true, $1, null, $2) as result`,
      [consultantMembership, SCOPE],
    )
  ).rows[0].result.id;
  await db.query(
    `insert into public.persons (organization_id, display_name, is_sample, user_id)
     values ($1, 'Amélie Fictive', true, $2), ($1, 'Chinedu Fictif', true, $3)`,
    [orgId, client, sponsor],
  );
  const people = await db.query<{ id: string; display_name: string }>(
    `select id, display_name from public.persons where organization_id = $1`,
    [orgId],
  );
  const applicant = people.rows.find((row) => row.display_name === "Amélie Fictive")!.id;
  const sponsorPerson = people.rows.find((row) => row.display_name === "Chinedu Fictif")!.id;
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role)
     values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`,
    [orgId, matterId, applicant, sponsorPerson],
  );
  const agreementId = (
    await db.query<{ id: string }>(
      `select public.create_agreement(
         $1, 'service'::public.agreement_kind, 'Entente de service — parrainage', $2, $3,
         'Appels non inclus.', 'Remboursement des honoraires non gagnés.', 250000, 'CAD', 'Frais IRCC payés par le client.',
         null, null, null, null
       ) as id`,
      [matterId, BODY, SCOPE],
    )
  ).rows[0].id;
  const envelopeId = (
    await db.query<{ result: { envelope_id: string } }>(
      `select public.send_agreement($1, $2::jsonb, $3, null) as result`,
      [
        agreementId,
        JSON.stringify([
          { role: "client", person_id: applicant, display_name: "Amélie Fictive" },
          { role: "sponsor", person_id: sponsorPerson, display_name: "Chinedu Fictif" },
        ]),
        `send-${randomUUID()}`,
      ],
    )
  ).rows[0].result.envelope_id;
  const sign = async (userId: string) => {
    await asUser(db, { userId, aal: "aal1", orgId });
    return (
      await db.query<{ result: { status: string; seal_pending?: boolean } }>(
        `select public.sign_agreement($1, true, $2, $3::inet, $4) as result`,
        [envelopeId, `sign-${randomUUID()}`, IP, AGENT],
      )
    ).rows[0].result;
  };
  return { orgId, client, sponsor, consultant, envelopeId, sign };
}

async function render(envelopeId: string) {
  await asServiceRole(db);
  const raw = (await db.query<{ source: unknown }>(`select public.agreement_seal_source($1) as source`, [envelopeId])).rows[0].source;
  const source = parseSealSource(raw);
  const pdf = await renderAgreementPdf(source);
  const sha = createHash("sha256").update(pdf).digest("hex");
  const certificate = await renderCertificatePdf(source, sha);
  return { source, pdf, sha, certificate };
}

async function attach(envelopeId: string, pdf: Uint8Array, certificate: Uint8Array) {
  await asServiceRole(db);
  return (
    await db.query<{ result: { attached: boolean; sealed_sha256: string; certificate_sha256: string } }>(
      `select public.attach_sealed_agreement($1, $2, $3, $4) as result`,
      [envelopeId, pdf, certificate, SEAL_RENDERER],
    )
  ).rows[0].result;
}

async function stored(envelopeId: string) {
  await asMaintenance(db);
  return (
    await db.query<{ sealed_pdf: Uint8Array | null; sealed_sha256: string | null; certificate_sha256: string | null; sealed_renderer: string | null; status: string }>(
      `select sealed_pdf, sealed_sha256, certificate_sha256, sealed_renderer, status::text from public.signature_envelopes where id = $1`,
      [envelopeId],
    )
  ).rows[0];
}

describe("laid-out sealed agreement PDF", () => {
  it("is only readable and attachable by the service role", async () => {
    const ctx = await envelope();
    await ctx.sign(ctx.client);
    await ctx.sign(ctx.sponsor);
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(() => db.query(`select public.agreement_seal_source($1)`, [ctx.envelopeId]), /permission denied|service role/i);
    await expectDbError(
      () => db.query(`select public.attach_sealed_agreement($1, $2, $2, 'x')`, [ctx.envelopeId, Buffer.from("%PDF-1.7 forged")]),
      /permission denied|service role/i,
    );
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select app.attach_sealed_agreement($1, $2, $2, 'x')`, [ctx.envelopeId, Buffer.from("%PDF-1.7 forged")]), /permission denied|service role/i);
  });

  it("completes on the last signature, renders the exact signed text, and attaches once", async () => {
    const ctx = await envelope();
    expect((await ctx.sign(ctx.client)).status).toBe("partially_signed");
    // Not complete yet: nothing can be attached.
    const early = await render(ctx.envelopeId).catch(() => null);
    expect(early).not.toBeNull();
    await expectDbError(() => attach(ctx.envelopeId, early!.pdf, early!.certificate), /only a completed envelope/);

    const done = await ctx.sign(ctx.sponsor);
    expect(done).toMatchObject({ status: "completed", seal_pending: true });
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const before = await db.query<{ pdf: Uint8Array | null }>(`select public.agreement_executed_pdf($1) as pdf`, [ctx.envelopeId]);
    expect(before.rows[0].pdf).toBeNull();

    const { source, pdf, sha, certificate } = await render(ctx.envelopeId);
    expect(agreementTerms(source)).toEqual({ terms: BODY, exact: true });
    expect(source.signers.map((signer) => [signer.role, signer.ip])).toEqual([["client", IP], ["sponsor", IP]]);
    expect(source.events.map((event) => event.kind)).toEqual(["sent", "signed", "signed", "completed"]);

    await expectDbError(() => attach(ctx.envelopeId, Buffer.from("not a pdf"), certificate), /not a PDF/);
    const first = await attach(ctx.envelopeId, pdf, certificate);
    expect(first).toMatchObject({ attached: true, sealed_sha256: sha });
    const row = await stored(ctx.envelopeId);
    expect(row).toMatchObject({ sealed_sha256: sha, sealed_renderer: SEAL_RENDERER, status: "completed" });

    // A second attach (another request, a retry, different bytes) changes nothing.
    const other = await renderAgreementPdf({ ...source, organization: { ...source.organization, displayName: "Changed" } });
    const second = await attach(ctx.envelopeId, other, certificate);
    expect(second).toMatchObject({ attached: false, sealed_sha256: sha });
    expect(createHash("sha256").update((await stored(ctx.envelopeId)).sealed_pdf!).digest("hex")).toBe(sha);

    // Not even an agreement function can overwrite the bytes or the hashes.
    await asMaintenance(db);
    for (const change of [
      `update public.signature_envelopes set sealed_pdf = '\\x255044462d6f74686572'::bytea where id = $1`,
      `update public.signature_envelopes set sealed_sha256 = repeat('0', 64) where id = $1`,
      `update public.signature_envelopes set certificate_sha256 = repeat('0', 64) where id = $1`,
      `update public.signature_envelopes set sealed_renderer = 'other' where id = $1`,
      `update public.signature_envelopes set content_sha256 = repeat('0', 64) where id = $1`,
    ]) {
      await expectDbError(
        () =>
          db.transaction(async (tx) => {
            await tx.query(`select app.open_esign_write($1)`, [ctx.envelopeId]);
            await tx.query(change, [ctx.envelopeId]);
          }),
        /cannot change/,
      );
    }
    await expectDbError(
      () => db.query(`update public.signature_envelopes set sealed_pdf = null where id = $1`, [ctx.envelopeId]),
      /agreement function/,
    );

    // The party downloads exactly the stored bytes.
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const after = await db.query<{ pdf: Uint8Array }>(`select public.agreement_executed_pdf($1) as pdf`, [ctx.envelopeId]);
    expect(createHash("sha256").update(after.rows[0].pdf).digest("hex")).toBe(sha);
    const audit = await (async () => {
      await asMaintenance(db);
      return db.query<{ n: number }>(
        `select count(*)::int as n from public.audit_log where action = 'agreement.sealed' and object_id = $1`,
        [ctx.envelopeId],
      );
    })();
    expect(audit.rows[0].n).toBe(1);
  });

  it("leaves an envelope sealed before the laid-out renderer exactly as it was", async () => {
    const ctx = await envelope();
    await ctx.sign(ctx.client);
    await ctx.sign(ctx.sponsor);
    // Stand-in for a production envelope sealed by the old SQL renderer.
    await asMaintenance(db);
    const legacy = (await db.query<{ pdf: Uint8Array }>(`select app.build_text_pdf(array['Legacy sealed copy']) as pdf`)).rows[0].pdf;
    const legacySha = createHash("sha256").update(legacy).digest("hex");
    await db.transaction(async (tx) => {
      await tx.query(`select app.open_esign_write($1)`, [ctx.envelopeId]);
      await tx.query(
        `update public.signature_envelopes
            set sealed_pdf = $2, sealed_sha256 = $3, certificate_pdf = $2, certificate_sha256 = $3
          where id = $1`,
        [ctx.envelopeId, legacy, legacySha],
      );
    });
    const { pdf, certificate } = await render(ctx.envelopeId);
    const result = await attach(ctx.envelopeId, pdf, certificate);
    expect(result).toMatchObject({ attached: false, sealed_sha256: legacySha });
    const row = await stored(ctx.envelopeId);
    expect(row.sealed_renderer).toBeNull();
    expect(createHash("sha256").update(row.sealed_pdf!).digest("hex")).toBe(legacySha);
  });
});
