import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { pdfText } from "./helpers/pdf-text";
import { renderAgreementPdf } from "@/modules/agreements/pdf-render";
import { parseSealSource } from "@/modules/agreements/seal-source";
import { countersignTurn, signersFor } from "@/modules/sheet/agreements-present";

/**
 * The firm countersigns (20261019020000_firm_countersign.sql): the Sheet sends a service
 * agreement to the applicant, then the sponsor, then the matter's responsible licensed
 * consultant. The envelope completes only on the consultant's signature, which needs aal2, a
 * recent step-up, the right staff member and a licence. When it becomes the consultant's turn the
 * outbox has agreement.signer_turn, and the mail worker emails that consultant only.
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
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    address,
  ]);
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
  const consultantEmail = email("consultant");
  const owner = await createUser(email("owner"));
  const consultant = await createUser(consultantEmail);
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
  await asMaintenance(db);
  const ownerMembership = (
    await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2 and role = 'firm_owner'`, [
      orgId,
      owner,
    ])
  ).rows[0].id;
  // Sample firms countersign too: the firm is in sample mode and the matter is a sample matter.
  await db.query(`update public.organizations set sample_mode = true where id = $1`, [orgId]);
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const collegeId = `R${randomUUID().slice(0, 6).toUpperCase()}`;
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, collegeId, PROOF],
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
    await db.query<{ result: { id: string } }>(`select public.create_engaged_matter($1, $2, $3, null, $4) as result`, [
      "Synthetic sample matter",
      true,
      consultantMembership,
      SCOPE,
    ])
  ).rows[0].result.id;
  await db.query(
    `insert into public.persons (organization_id, display_name, is_sample, user_id)
     values ($1, 'Synthetic applicant', true, $2), ($1, 'Synthetic sponsor', true, $3)`,
    [orgId, client, sponsor],
  );
  const people = await db.query<{ id: string; display_name: string }>(`select id, display_name from public.persons where organization_id = $1`, [orgId]);
  const applicant = people.rows.find((row) => row.display_name === "Synthetic applicant")!.id;
  const sponsorPerson = people.rows.find((row) => row.display_name === "Synthetic sponsor")!.id;
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role)
     values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`,
    [orgId, matterId, applicant, sponsorPerson],
  );
  const templateId = (
    await db.query<{ id: string }>(`select public.create_agreement_template('service'::public.agreement_kind, 'Synthetic service', $1) as id`, [BODY])
  ).rows[0].id;
  await db.query(`select public.approve_agreement_template($1)`, [templateId]);
  const draft = async () => {
    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    return (
      await db.query<{ id: string }>(
        `select public.create_agreement($1, 'service'::public.agreement_kind, 'Synthetic service', null, $2,
           null, null, null, 'CAD', null, $3, null, null, null) as id`,
        [matterId, SCOPE, templateId],
      )
    ).rows[0].id;
  };
  return {
    orgId,
    owner,
    consultant,
    consultantEmail,
    manager,
    client,
    sponsor,
    matterId,
    applicant,
    sponsorPerson,
    consultantMembership,
    managerMembership,
    ownerMembership,
    collegeId,
    draft,
  };
}

type Ctx = Awaited<ReturnType<typeof firm>>;

/** Exactly what the Sheet sends: signersFor with the responsible consultant as countersigner. */
function sheetSigners(ctx: Ctx, consultant: { membershipId: string; name: string } = { membershipId: ctx.consultantMembership, name: "Synthetic consultant" }) {
  const names = new Map([
    [ctx.applicant, "Synthetic applicant"],
    [ctx.sponsorPerson, "Synthetic sponsor"],
  ]);
  return JSON.stringify(
    signersFor(
      [
        { person_id: ctx.applicant, role: "applicant" },
        { person_id: ctx.sponsorPerson, role: "sponsor" },
      ],
      names,
      consultant,
    ),
  );
}

async function send(ctx: Ctx, agreementId: string, signers: string) {
  await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
  const sent = await db.query<{ result: { envelope_id: string; status: string } }>(`select public.send_agreement($1, $2::jsonb, $3, null) as result`, [
    agreementId,
    signers,
    `sheet-send-${agreementId}`,
  ]);
  return sent.rows[0].result.envelope_id;
}

async function sign(userId: string, orgId: string, envelopeId: string, totpAgeSeconds?: number) {
  await asUser(db, { userId, aal: totpAgeSeconds == null ? "aal1" : "aal2", orgId, totpAgeSeconds });
  const signed = await db.query<{ result: { status: string } }>(`select public.sign_agreement($1, true, $2, $3::inet, $4) as result`, [
    envelopeId,
    `sign-${randomUUID()}`,
    IP,
    AGENT,
  ]);
  return signed.rows[0].result.status;
}

async function turnEvents(envelopeId: string) {
  await asMaintenance(db);
  return (
    await db.query<{ id: string; signer_id: string }>(
      `select id, payload ->> 'signer_id' as signer_id from public.outbox_events
       where event_type = 'agreement.signer_turn' and payload ->> 'envelope_id' = $1`,
      [envelopeId],
    )
  ).rows;
}

async function recipients(eventId: string) {
  await asServiceRole(db);
  await db.query(`select public.claim_mail_events('countersign-test', 50)`);
  const prepared = await db.query<{ result: { action: string; messages: { to: string; template: string; context: Record<string, unknown> }[] } }>(
    `select public.prepare_email_delivery($1, 'countersign-test', null, null) as result`,
    [eventId],
  );
  return prepared.rows[0].result;
}

describe("the firm countersigns", () => {
  it("completes a client, sponsor and consultant envelope only after the consultant countersigns, with step-up", async () => {
    const ctx = await firm();
    const agreementId = await ctx.draft();
    const envelopeId = await send(ctx, agreementId, sheetSigners(ctx));

    const order = await db.query<{ role: string; signing_order: number; membership_id: string | null; status: string }>(
      `select role::text, signing_order, membership_id, status::text from public.envelope_signers where envelope_id = $1 order by signing_order`,
      [envelopeId],
    );
    expect(order.rows.map((row) => row.role)).toEqual(["client", "sponsor", "consultant"]);
    expect(order.rows[2].membership_id).toBe(ctx.consultantMembership);
    // Nobody on staff is current yet, so nobody on staff is told it is their turn.
    expect(await turnEvents(envelopeId)).toEqual([]);

    // agreement.sent emails the clients only; the consultant hears at their turn.
    await asMaintenance(db);
    const sentEvent = (
      await db.query<{ id: string }>(`select id from public.outbox_events where event_type = 'agreement.sent' and payload ->> 'envelope_id' = $1`, [envelopeId])
    ).rows[0].id;
    await db.query(`update public.persons set email = 'applicant-' || id::text || '@example.test' where organization_id = $1`, [ctx.orgId]);
    const sentMail = await recipients(sentEvent);
    expect(sentMail.messages.length).toBe(2);
    expect(sentMail.messages.map((message) => message.to)).not.toContain(ctx.consultantEmail.toLowerCase());

    // The consultant cannot jump the queue.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.sign_agreement($1, true, $2, $3::inet, $4)`, [envelopeId, `early-${randomUUID()}`, IP, AGENT]),
      /identity/i,
    );

    expect(await sign(ctx.client, ctx.orgId, envelopeId)).toBe("partially_signed");
    expect(await sign(ctx.sponsor, ctx.orgId, envelopeId)).toBe("partially_signed");

    // Both clients signed: not executed until the firm countersigns.
    await asMaintenance(db);
    const waiting = await db.query<{ agreement: string; envelope: string; consultant: string }>(
      `select agreement.status::text as agreement, envelope.status::text as envelope,
              (select signer.status::text from public.envelope_signers signer where signer.envelope_id = envelope.id and signer.signing_order = 3) as consultant
       from public.signature_envelopes envelope join public.agreements agreement on agreement.id = envelope.agreement_id
       where envelope.id = $1`,
      [envelopeId],
    );
    expect(waiting.rows[0]).toEqual({ agreement: "partially_signed", envelope: "partially_signed", consultant: "current" });

    // The Sheet reads the consultant's turn from the same rows.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const visible = await db.query<{ envelope_id: string; membership_id: string | null; status: string }>(
      `select envelope_id, membership_id, status::text from public.envelope_signers where envelope_id = $1`,
      [envelopeId],
    );
    expect(countersignTurn(visible.rows, envelopeId, ctx.consultantMembership)).toBe(true);
    expect(countersignTurn(visible.rows, envelopeId, ctx.ownerMembership)).toBe(false);

    // It is the consultant's turn: one agreement.signer_turn event, emailed to the consultant only.
    const turns = await turnEvents(envelopeId);
    expect(turns).toHaveLength(1);
    expect(turns[0].signer_id).toBe((await db.query<{ id: string }>(`select id from public.envelope_signers where envelope_id = $1 and signing_order = 3`, [envelopeId])).rows[0].id);
    const turnMail = await recipients(turns[0].id);
    expect(turnMail.action).toBe("send");
    expect(turnMail.messages).toHaveLength(1);
    expect(turnMail.messages[0].to).toBe(ctx.consultantEmail.toLowerCase());
    expect(turnMail.messages[0].template).toBe("agreement");
    expect(turnMail.messages[0].context.audience).toBe("staff");

    // Another staff member cannot countersign for them.
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.sign_agreement($1, true, $2, $3::inet, $4)`, [envelopeId, `owner-${randomUUID()}`, IP, AGENT]),
      /identity/i,
    );
    // Not without a recent step-up, and not at aal1.
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 60 * 30 });
    await expectDbError(
      () => db.query(`select public.sign_agreement($1, true, $2, $3::inet, $4)`, [envelopeId, `stale-${randomUUID()}`, IP, AGENT]),
      /step-up/i,
    );
    await asUser(db, { userId: ctx.consultant, aal: "aal1", orgId: ctx.orgId });
    await expectDbError(
      () => db.query(`select public.sign_agreement($1, true, $2, $3::inet, $4)`, [envelopeId, `aal1-${randomUUID()}`, IP, AGENT]),
      /denied|step-up/i,
    );
    await asMaintenance(db);
    const still = await db.query<{ status: string }>(`select status::text from public.signature_envelopes where id = $1`, [envelopeId]);
    expect(still.rows[0].status).toBe("partially_signed");

    // The consultant countersigns with a fresh step-up: now it is executed.
    expect(await sign(ctx.consultant, ctx.orgId, envelopeId, 0)).toBe("completed");
    await asMaintenance(db);
    const done = await db.query<{ status: string; consent_version: string; signer_user_id: string }>(
      `select signer.status::text, signer.consent_version, signer.signer_user_id
       from public.envelope_signers signer where signer.envelope_id = $1 and signer.signing_order = 3`,
      [envelopeId],
    );
    expect(done.rows[0]).toMatchObject({ status: "signed", signer_user_id: ctx.consultant });
    expect(done.rows[0].consent_version).toBe("esign-consent-2026-10-17");
    const agreement = await db.query<{ status: string }>(`select status::text from public.agreements where id = $1`, [agreementId]);
    expect(agreement.rows[0].status).toBe("completed");

    // The sealed PDF prints the consultant's licence under their countersignature.
    await asServiceRole(db);
    const raw = (await db.query<{ source: unknown }>(`select public.agreement_seal_source($1) as source`, [envelopeId])).rows[0].source;
    const source = parseSealSource(raw);
    expect(source.signers.map((signer) => signer.role)).toEqual(["client", "sponsor", "consultant"]);
    expect(source.signers[2].licence).toBe(`RCIC ${ctx.collegeId}`);
    expect(source.signers[0].licence ?? null).toBeNull();
    const text = pdfText(await renderAgreementPdf(source)).replace(/\s+/g, " ");
    expect(text).toContain("Consultant (for the firm)");
    expect(text).toContain(`CICC licence RCIC ${ctx.collegeId}`);
  });

  it("refuses an unlicensed or lapsed consultant as the countersigner", async () => {
    const ctx = await firm();

    // A case manager cannot be the consultant signer. (A firm owner can, with or without a CICC
    // licence on file: owners are regulated consultants, decision 2026-10-19.)
    for (const membershipId of [ctx.managerMembership]) {
      const agreementId = await ctx.draft();
      await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
      await expectDbError(
        () =>
          db.query(`select public.send_agreement($1, $2::jsonb, $3, null)`, [
            agreementId,
            sheetSigners(ctx, { membershipId, name: "Not licensed" }),
            `sheet-send-${agreementId}`,
          ]),
        /must be licensed/i,
      );
    }

    // Licensed when sent, no longer licensed when it is their turn: the signature is refused.
    const agreementId = await ctx.draft();
    const envelopeId = await send(ctx, agreementId, sheetSigners(ctx));
    expect(await sign(ctx.client, ctx.orgId, envelopeId)).toBe("partially_signed");
    expect(await sign(ctx.sponsor, ctx.orgId, envelopeId)).toBe("partially_signed");
    await asMaintenance(db);
    await db.query(`update public.memberships set role = 'case_manager' where id = $1`, [ctx.consultantMembership]);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.sign_agreement($1, true, $2, $3::inet, $4)`, [envelopeId, `lapsed-${randomUUID()}`, IP, AGENT]),
      /must be licensed/i,
    );
    await asMaintenance(db);
    const still = await db.query<{ status: string }>(`select status::text from public.signature_envelopes where id = $1`, [envelopeId]);
    expect(still.rows[0].status).toBe("partially_signed");
  });

  it("tells a staff member who signs first that it is their turn at send", async () => {
    const ctx = await firm();
    const agreementId = await ctx.draft();
    const envelopeId = await send(
      ctx,
      agreementId,
      JSON.stringify([
        { role: "consultant", membership_id: ctx.consultantMembership, display_name: "Synthetic consultant" },
        { role: "client", person_id: ctx.applicant, display_name: "Synthetic applicant" },
      ]),
    );
    const turns = await turnEvents(envelopeId);
    expect(turns).toHaveLength(1);
    // The client is not told by a turn event; agreement.sent already told them.
    expect(await sign(ctx.consultant, ctx.orgId, envelopeId, 0)).toBe("partially_signed");
    expect(await turnEvents(envelopeId)).toHaveLength(1);
    // A turn email still waiting when the consultant has already signed is not sent.
    expect((await recipients(turns[0].id)).action).toBe("done");
  });
});
