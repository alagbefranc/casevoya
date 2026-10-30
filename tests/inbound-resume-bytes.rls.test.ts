import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;
const SHA = "cd".repeat(32);
const DIGEST = createHash("sha256").update("synthetic message").digest("hex");
const OTHER_DIGEST = createHash("sha256").update("another message").digest("hex");

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

afterEach(async () => {
  await asMaintenance(db);
  await db.query(
    `update public.product_settings set value = '{"bytes_per_hour":524288000}'::jsonb where key = 'email.inbound_attachment_bytes'`,
  );
});

function slug() {
  return `f${randomUUID().replaceAll("-", "").slice(0, 12)}`;
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

async function firm() {
  const owner = await createUser(`owner-${randomUUID().slice(0, 8)}@example.test`);
  const consultant = await createUser(`consultant-${randomUUID().slice(0, 8)}@example.test`);
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    slug(),
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const orgSlug = (await db.query<{ slug: string }>(`select slug from public.organizations where id = $1`, [orgId])).rows[0].slug;
  const consultantMembership = (
    await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
       values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
      [orgId, consultant, owner],
    )
  ).rows[0].id;
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', 'proof/synthetic') as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check(
       $1, 'https://register.college-ic.ca/Public-Register-EN', statement_timestamp(),
       'active'::public.register_licence_status, true, false, false, false, null, 'proof/synthetic', 'Synthetic note'
     )`,
    [credential.rows[0].id],
  );
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matter = await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [
    consultantMembership,
  ]);
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, display_name, is_sample, email) values ($1, 'Synthetic applicant', true, 'client@example.test') returning id`,
    [orgId],
  );
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [
    orgId,
    matterId,
    person.rows[0].id,
  ]);
  return { owner, consultant, orgId, to: `${orgSlug}@docs.casevoya.ca`, matterId, personId: person.rows[0].id };
}

type Begin = {
  status: string;
  reason?: string;
  inbound_email_id?: string;
  person_id?: string | null;
  matter_id?: string | null;
};

async function begin(to: string, from: string, messageId: string, verified: boolean, digest: string): Promise<Begin> {
  await asServiceRole(db);
  const result = await db.query<{ result: Begin }>(
    `select public.begin_inbound_message_with_digest($1, $2, $3, 'Subject', 'Body', null, null, $4, $5) as result`,
    [to, from, messageId, verified, digest],
  );
  return result.rows[0].result;
}

async function storeObject(key: string, size: number) {
  await asMaintenance(db);
  await db.query(`insert into storage.objects (id, bucket_id, name, metadata) values ($1, 'documents', $2, jsonb_build_object('size', $3::int))`, [
    randomUUID(),
    key,
    size,
  ]);
}

describe("inbound Message-ID resume binding", () => {
  it("resumes only for the same sender, verification result and content", async () => {
    const ctx = await firm();
    const messageId = `<resume-${randomUUID()}@example.test>`;
    const first = await begin(ctx.to, "client@example.test", messageId, true, DIGEST);
    expect(first.status).toBe("accepted");
    expect(first.person_id).toBe(ctx.personId);

    // Legitimate retry of the same delivery.
    const again = await begin(ctx.to, "Client@Example.test", messageId, true, DIGEST);
    expect(again).toMatchObject({ status: "resume", inbound_email_id: first.inbound_email_id, person_id: ctx.personId });

    // Another sender, an unverified copy, or different content: not attached to the stored person or matter.
    for (const attempt of [
      await begin(ctx.to, "stranger@elsewhere.example", messageId, false, DIGEST),
      await begin(ctx.to, "client@example.test", messageId, false, DIGEST),
      await begin(ctx.to, "client@example.test", messageId, true, OTHER_DIGEST),
    ]) {
      expect(attempt).toMatchObject({ status: "duplicate", person_id: null, matter_id: null, reason: "message_id_conflict" });
      expect(attempt.inbound_email_id).toBeUndefined();
    }

    // The older wrapper passes no digest, so it never resumes.
    await asServiceRole(db);
    const legacy = await db.query<{ result: Begin }>(
      `select public.begin_verified_inbound_message($1, 'client@example.test', $2, 'Subject', 'Body', null, null, true) as result`,
      [ctx.to, messageId],
    );
    expect(legacy.rows[0].result).toMatchObject({ status: "duplicate", person_id: null });

    await asMaintenance(db);
    const stored = await db.query<{ sender_verified: boolean; content_digest: string }>(
      `select sender_verified, content_digest from public.inbound_emails where id = $1`,
      [first.inbound_email_id],
    );
    expect(stored.rows[0]).toEqual({ sender_verified: true, content_digest: DIGEST });
    const audit = await db.query<{ context: Record<string, unknown> }>(
      `select context from public.audit_log where organization_id = $1 and action = 'email.rejected' and object_id = $2`,
      [ctx.orgId, first.inbound_email_id],
    );
    expect(audit.rows.length).toBe(4);
    for (const row of audit.rows) expect(row.context).toEqual({ reason: "message_id_conflict" });
  });

  it("refuses a malformed digest and keeps the wrapper away from signed-in users", async () => {
    const ctx = await firm();
    await asServiceRole(db);
    await expectDbError(
      () =>
        db.query(`select public.begin_inbound_message_with_digest($1, 'client@example.test', $2, 'S', 'B', null, null, true, 'abc')`, [
          ctx.to,
          `<bad-${randomUUID()}@example.test>`,
        ]),
      /digest|22023/,
    );
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    for (const sql of [
      `select public.begin_inbound_message_with_digest('${ctx.to}', 'client@example.test', '<u@example.test>', 'S', 'B', null, null, true, '${DIGEST}')`,
      `select public.abandon_inbound_attachments('${randomUUID()}', 'attachment_error')`,
      `select public.complete_verified_email_upload('${randomUUID()}', 0, '${SHA}', 16, 'application/pdf')`,
    ]) {
      await expectDbError(() => db.query(sql), /permission denied|42501/);
    }
  });
});

describe("inbound attachment close-out", () => {
  it("closes a message whose attachment step failed so it cannot be resumed", async () => {
    const ctx = await firm();
    const messageId = `<abandon-${randomUUID()}@example.test>`;
    const first = await begin(ctx.to, "client@example.test", messageId, true, DIGEST);
    await asServiceRole(db);
    await db.query(`select public.abandon_inbound_attachments($1, 'attachment_error')`, [first.inbound_email_id]);
    const retry = await begin(ctx.to, "client@example.test", messageId, true, DIGEST);
    expect(retry.status).toBe("duplicate");
    await asServiceRole(db);
    await expectDbError(
      () => db.query(`select public.create_email_upload_intent($1, 0, 'scan.pdf', 16)`, [first.inbound_email_id]),
      /closed|42501/,
    );
    await asMaintenance(db);
    const audit = await db.query<{ context: Record<string, unknown> }>(
      `select context from public.audit_log where organization_id = $1 and action = 'email.attachments_abandoned'`,
      [ctx.orgId],
    );
    expect(audit.rows.map((row) => row.context)).toEqual([{ reason: "attachment_error" }]);
  });
});

describe("inbound attachment byte cap", () => {
  it("refuses attachments past the firm's hourly byte cap on both intake paths", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    await db.query(`update public.product_settings set value = '{"bytes_per_hour":1048576}'::jsonb where key = 'email.inbound_attachment_bytes'`);
    const known = await begin(ctx.to, "client@example.test", `<bytes-${randomUUID()}@example.test>`, true, DIGEST);
    await asServiceRole(db);
    const intent = await db.query<{ result: { storage_key: string } }>(
      `select public.create_email_upload_intent($1, 0, 'scan.pdf', 600000) as result`,
      [known.inbound_email_id],
    );
    expect(intent.rows[0].result.storage_key.length).toBeGreaterThan(16);
    // Repeating the same ordinal is idempotent and not counted again.
    await db.query(`select public.create_email_upload_intent($1, 0, 'scan.pdf', 600000)`, [known.inbound_email_id]);
    await expectDbError(
      () => db.query(`select public.create_email_upload_intent($1, 1, 'second.pdf', 600000)`, [known.inbound_email_id]),
      /inbound attachment limit/,
    );

    const stranger = await begin(ctx.to, "stranger@example.test", `<bytes-${randomUUID()}@example.test>`, false, DIGEST);
    await asServiceRole(db);
    await expectDbError(
      () => db.query(`select public.open_unsorted_email_file($1, 0, 'scan.pdf', 600000)`, [stranger.inbound_email_id]),
      /inbound attachment limit/,
    );
    const small = await db.query<{ result: { storage_key: string } }>(
      `select public.open_unsorted_email_file($1, 0, 'scan.pdf', 400000) as result`,
      [stranger.inbound_email_id],
    );
    expect(small.rows[0].result.storage_key).toContain("/inbox/");

    await asMaintenance(db);
    const window = await db.query<{ bytes: string }>(
      `select sum(attachment_bytes)::text as bytes from public.email_inbound_windows where organization_id = $1`,
      [ctx.orgId],
    );
    expect(window.rows[0].bytes).toBe("1000000");
  });
});

describe("server-verified email attachment completion", () => {
  it("records server-measured values and refuses a ZIP that is not a Word document", async () => {
    const ctx = await firm();
    const known = await begin(ctx.to, "client@example.test", `<verified-${randomUUID()}@example.test>`, true, DIGEST);
    await asServiceRole(db);
    const pdf = await db.query<{ result: { storage_key: string } }>(`select public.create_email_upload_intent($1, 0, 'scan.pdf', 16) as result`, [
      known.inbound_email_id,
    ]);
    const docx = await db.query<{ result: { storage_key: string } }>(
      `select public.create_email_upload_intent($1, 1, 'letter.docx', 32) as result`,
      [known.inbound_email_id],
    );
    await storeObject(pdf.rows[0].result.storage_key, 16);
    await storeObject(docx.rows[0].result.storage_key, 32);
    await asServiceRole(db);
    const clean = await db.query<{ result: { upload_state: string; scan_result: string } }>(
      `select public.complete_verified_email_upload($1, 0, $2, 16, 'application/pdf') as result`,
      [known.inbound_email_id, SHA],
    );
    expect(clean.rows[0].result).toMatchObject({ upload_state: "clean", scan_result: "structural_only" });
    // The server found no Word document inside the ZIP, so it reports no media type.
    const zip = await db.query<{ result: { upload_state: string; scan_result: string } }>(
      `select public.complete_verified_email_upload($1, 1, $2, 32, null) as result`,
      [known.inbound_email_id, SHA],
    );
    expect(zip.rows[0].result).toMatchObject({ upload_state: "failed", scan_result: "unrecognized_type" });
    await expectDbError(
      () => db.query(`select public.complete_verified_email_upload($1, 5, $2, 16, 'application/pdf')`, [known.inbound_email_id, SHA]),
      /not started|42501/,
    );
  });
});
