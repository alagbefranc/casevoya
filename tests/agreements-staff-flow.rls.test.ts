import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { pdfText } from "./helpers/pdf-text";
import { renderAgreementPdf } from "@/modules/agreements/pdf-render";
import { agreementTerms, parseSealSource } from "@/modules/agreements/seal-source";
import { DEFAULT_GOVERNMENT_FEE_NOTE, readNewAgreement, sameTerms } from "@/modules/sheet/agreements-present";

/**
 * The Sheet's Agreements flow, exactly as staff-actions.ts calls it: a template is created and
 * approved, an agreement is created from it with no body of its own, and it is sent to the
 * applicant then the sponsor (roles client and sponsor). The database decides who may do each.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const IP = "203.0.113.10";
const AGENT = "SyntheticAgent/1.0";
const BODY = "Synthetic service text. No fee amount is stated.";
const SCOPE = "Prepare a fictional application and nothing else.";

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

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, address],
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

async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const manager = await createUser(email("manager"));
  const client = await createUser(email("client"));
  const sponsor = await createUser(email("sponsor"));
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await membership(orgId, manager, "case_manager", owner);
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
  const matter = async (sample: boolean) => {
    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const made = await db.query<{ result: { id: string } }>(
      `select public.create_engaged_matter($1, $2, $3, null, $4) as result`,
      [sample ? "Synthetic sample matter" : "Synthetic real matter", sample, consultantMembership, SCOPE],
    );
    return made.rows[0].result.id;
  };
  const matterId = await matter(true);
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `insert into public.persons (organization_id, display_name, is_sample, user_id)
     values ($1, 'Synthetic applicant', true, $2), ($1, 'Synthetic sponsor', true, $3)`,
    [orgId, client, sponsor],
  );
  const people = await db.query<{ id: string; display_name: string }>(
    `select id, display_name from public.persons where organization_id = $1`,
    [orgId],
  );
  const applicant = people.rows.find((row) => row.display_name === "Synthetic applicant")!.id;
  const sponsorPerson = people.rows.find((row) => row.display_name === "Synthetic sponsor")!.id;
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role)
     values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`,
    [orgId, matterId, applicant, sponsorPerson],
  );
  // A case manager works the matters they are assigned to.
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`,
    [orgId, matterId, managerMembership],
  );
  return { orgId, owner, consultant, manager, client, sponsor, matterId, applicant, sponsorPerson, matter };
}

describe("the Sheet's agreement flow", () => {
  it("lets a case manager draft a template that only a licensed consultant approves, then sends it to the applicant and sponsor", async () => {
    const ctx = await firm();

    // A case manager drafts the template, with a recent step-up.
    await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 60 * 30 });
    await expectDbError(
      () => db.query(`select public.create_agreement_template('service'::public.agreement_kind, 'Synthetic', $1)`, [BODY]),
      /step-up/i,
    );
    await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const template = await db.query<{ id: string }>(
      `select public.create_agreement_template('service'::public.agreement_kind, 'Synthetic service', $1) as id`,
      [BODY],
    );
    const templateId = template.rows[0].id;

    // Not approved yet: an agreement cannot start from it.
    await expectDbError(
      () =>
        db.query(
          `select public.create_agreement($1, 'service'::public.agreement_kind, 'Synthetic service', null, $2,
             null, null, null, 'CAD', null, $3, null, null, null)`,
          [ctx.matterId, SCOPE, templateId],
        ),
      /approved template/i,
    );
    // A case manager cannot approve; a licensed consultant can.
    await expectDbError(() => db.query(`select public.approve_agreement_template($1)`, [templateId]), /denied/i);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.approve_agreement_template($1)`, [templateId]);

    // The case manager creates from the template (no body of its own) and sends it.
    await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const created = await db.query<{ id: string }>(
      `select public.create_agreement($1, 'service'::public.agreement_kind, 'Synthetic service', null, $2,
         null, null, null, 'CAD', null, $3, null, null, null) as id`,
      [ctx.matterId, SCOPE, templateId],
    );
    const agreementId = created.rows[0].id;
    const body = await db.query<{ canonical_body: string }>(
      `select canonical_body from public.agreement_versions where agreement_id = $1`,
      [agreementId],
    );
    expect(body.rows[0].canonical_body).toContain(BODY);
    const signers = JSON.stringify([
      { role: "client", person_id: ctx.applicant, display_name: "Synthetic applicant" },
      { role: "sponsor", person_id: ctx.sponsorPerson, display_name: "Synthetic sponsor" },
    ]);
    const sent = await db.query<{ result: { envelope_id: string; status: string } }>(
      `select public.send_agreement($1, $2::jsonb, $3, null) as result`,
      [agreementId, signers, `sheet-send-${agreementId}`],
    );
    expect(sent.rows[0].result.status).toBe("sent");
    const envelopeId = sent.rows[0].result.envelope_id;

    // The staff list reads it back with its signers; the outbox has the agreement.sent email event.
    const listed = await db.query<{ status: string; signers: number }>(
      `select agreement.status::text,
              (select count(*)::int from public.envelope_signers signer where signer.envelope_id = $2) as signers
       from public.agreements agreement where agreement.id = $1`,
      [agreementId, envelopeId],
    );
    expect(listed.rows[0]).toEqual({ status: "sent", signers: 2 });
    await asMaintenance(db);
    const outbox = await db.query<{ n: number }>(
      `select count(*)::int as n from public.outbox_events where event_type = 'agreement.sent' and payload ->> 'envelope_id' = $1`,
      [envelopeId],
    );
    expect(outbox.rows[0].n).toBe(1);

    // The applicant signs first in the portal, then the sponsor; the envelope completes.
    await asUser(db, { userId: ctx.sponsor, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(
      () => db.query(`select public.sign_agreement($1, true, $2, $3::inet, $4)`, [envelopeId, `early-${randomUUID()}`, IP, AGENT]),
      /identity/i,
    );
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const first = await db.query<{ result: { status: string } }>(
      `select public.sign_agreement($1, true, $2, $3::inet, $4) as result`,
      [envelopeId, `sign-${randomUUID()}`, IP, AGENT],
    );
    expect(first.rows[0].result.status).toBe("partially_signed");
    await asUser(db, { userId: ctx.sponsor, aal: "aal1", orgId: ctx.orgId });
    const second = await db.query<{ result: { status: string } }>(
      `select public.sign_agreement($1, true, $2, $3::inet, $4) as result`,
      [envelopeId, `sign-${randomUUID()}`, IP, AGENT],
    );
    expect(second.rows[0].result.status).toBe("completed");
  });

  it("stores the dialog's terms on the version and seals them into the laid-out PDF", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const templateId = (
      await db.query<{ id: string }>(`select public.create_agreement_template('service'::public.agreement_kind, 'Synthetic service', $1) as id`, [BODY])
    ).rows[0].id;
    await db.query(`select public.approve_agreement_template($1)`, [templateId]);

    // What the New agreement dialog sends, read exactly as the server action reads it.
    const read = readNewAgreement({
      matter: ctx.matterId,
      template: templateId,
      scope: SCOPE,
      fee: "1,500.50",
      currency: "CAD",
      exclusions: "Appeals and judicial review.\nTranslations beyond 10 pages.",
      refund: "Unearned advances are refunded within 10 business days of a written request.",
      government: DEFAULT_GOVERNMENT_FEE_NOTE,
    });
    if ("error" in read) throw new Error(read.error);
    const terms = read.input;
    expect(terms.feeCents).toBe(150050);
    const create = (feeCents: number | null) =>
      db.query<{ id: string }>(
        `select public.create_agreement($1, 'service'::public.agreement_kind, 'Synthetic service', null, $2,
           $3, $4, $5, $6, $7, $8, null, null, null) as id`,
        [ctx.matterId, terms.scope, terms.exclusions, terms.refundPolicy, feeCents, terms.currency, terms.governmentFeeNote, templateId],
      );
    const agreementId = (await create(terms.feeCents)).rows[0].id;
    const version = (
      await db.query<{
        scope_summary: string;
        exclusions: string | null;
        refund_policy: string | null;
        fee_cents: number | string | null;
        currency: string;
        government_fee_note: string | null;
        canonical_body: string;
      }>(
        `select scope_summary, exclusions, refund_policy, fee_cents, currency, government_fee_note, canonical_body
         from public.agreement_versions where agreement_id = $1`,
        [agreementId],
      )
    ).rows[0];
    expect(version).toMatchObject({
      scope_summary: SCOPE,
      exclusions: "Appeals and judicial review.\nTranslations beyond 10 pages.",
      refund_policy: "Unearned advances are refunded within 10 business days of a written request.",
      currency: "CAD",
      government_fee_note: DEFAULT_GOVERNMENT_FEE_NOTE,
    });
    expect(Number(version.fee_cents)).toBe(150050);
    // The unsent draft is reused only for the same terms; a different fee is a new draft.
    expect(sameTerms(version, terms)).toBe(true);
    expect(sameTerms(version, { ...terms, feeCents: 160000 })).toBe(false);
    // The database still refuses a negative fee, whatever the dialog sends.
    await expectDbError(() => create(-1), /negative/i);

    const sent = await db.query<{ result: { envelope_id: string } }>(
      `select public.send_agreement($1, $2::jsonb, $3, null) as result`,
      [
        agreementId,
        JSON.stringify([
          { role: "client", person_id: ctx.applicant, display_name: "Synthetic applicant" },
          { role: "sponsor", person_id: ctx.sponsorPerson, display_name: "Synthetic sponsor" },
        ]),
        `sheet-send-${agreementId}`,
      ],
    );
    const envelopeId = sent.rows[0].result.envelope_id;
    for (const userId of [ctx.client, ctx.sponsor]) {
      await asUser(db, { userId, aal: "aal1", orgId: ctx.orgId });
      await db.query(`select public.sign_agreement($1, true, $2, $3::inet, $4)`, [envelopeId, `sign-${randomUUID()}`, IP, AGENT]);
    }

    // The sealed-PDF renderer's input carries every term, and the PDF prints them.
    await asServiceRole(db);
    const raw = (await db.query<{ source: unknown }>(`select public.agreement_seal_source($1) as source`, [envelopeId])).rows[0].source;
    const source = parseSealSource(raw);
    expect(source.version).toMatchObject({
      scopeSummary: SCOPE,
      exclusions: "Appeals and judicial review.\nTranslations beyond 10 pages.",
      refundPolicy: "Unearned advances are refunded within 10 business days of a written request.",
      currency: "CAD",
      governmentFeeNote: DEFAULT_GOVERNMENT_FEE_NOTE,
    });
    expect(Number(source.version.feeCents)).toBe(150050);
    expect(agreementTerms(source)).toEqual({ terms: BODY, exact: true });
    const text = pdfText(await renderAgreementPdf(source)).replace(/\s+/g, " ");
    for (const expected of ["CAD 1,500.50", "Appeals and judicial review.", "Translations beyond 10 pages.", "Unearned advances are refunded"]) {
      expect(text).toContain(expected);
    }
    expect(text).toContain("Government fees are paid by the client directly to IRCC");
    expect(text).not.toContain("No professional fee is stated");
  });

  it("refuses an agreement on a real matter while the firm is in sample mode", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    await db.query(`update public.organizations set sample_mode = false where id = $1`, [ctx.orgId]);
    const realMatter = await ctx.matter(false);
    await asMaintenance(db);
    await db.query(`update public.organizations set sample_mode = true where id = $1`, [ctx.orgId]);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(
          `select public.create_agreement($1, 'service'::public.agreement_kind, 'Synthetic service', $2, $3,
             null, null, null, 'CAD', null, null, null, null, null)`,
          [realMatter, BODY, SCOPE],
        ),
      /sample mode/i,
    );
  });
});
