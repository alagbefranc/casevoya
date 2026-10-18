import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;
const PDF = "255044462d312e340d0a25e2e3cfd3";
const SHA = "cd".repeat(32);

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
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, address]);
  return id;
}

/** A synthetic firm: owner, a consultant on the matter, a consultant off it, and the applicant. */
async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const outsider = await createUser(email("outsider"));
  const client = await createUser(email("client"));
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const orgSlug = (await db.query<{ slug: string }>(`select slug from public.organizations where id = $1`, [orgId])).rows[0].slug;
  await asMaintenance(db);
  const member = async (userId: string, role: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
         values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
        [orgId, userId, role, owner],
      )
    ).rows[0].id;
  const consultantMembership = await member(consultant, "licensed_consultant");
  await member(outsider, "case_manager");
  await member(client, "client");
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
  const person = async (name: string, address: string, userId: string | null) =>
    (
      await db.query<{ id: string }>(
        `insert into public.persons (organization_id, display_name, is_sample, user_id, email) values ($1, $2, true, $3, $4) returning id`,
        [orgId, name, userId, address],
      )
    ).rows[0].id;
  const personId = await person("Synthetic applicant", "client@example.test", client);
  const sponsorId = await person("Synthetic sponsor", "sponsor@example.test", null);
  for (const [id, role] of [
    [personId, "applicant"],
    [sponsorId, "sponsor"],
  ]) {
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, $4)`, [orgId, matterId, id, role]);
  }
  const stranger = await person("Synthetic stranger", "stranger-person@example.test", null);
  const reply = (await db.query<{ address: string }>(`select app.firm_reply_address($1, $2, null) as address`, [orgId, matterId])).rows[0].address;
  return { owner, consultant, outsider, client, orgId, orgSlug, matterId, personId, sponsorId, stranger, reply };
}

type Ctx = Awaited<ReturnType<typeof firm>>;

/** An unverified message with one clean PDF in the unsorted inbox. */
async function arrive(ctx: Ctx, to: string, from = "someone@example.test") {
  await asServiceRole(db);
  const begun = await db.query<{ result: { inbound_email_id: string; person_id: string | null } }>(
    `select public.begin_verified_inbound_message($1, $2, $3, 'Files', 'see attached', null, null, false) as result`,
    [to, from, `<m-${randomUUID()}@example.test>`],
  );
  const emailId = begun.rows[0].result.inbound_email_id;
  const opened = await db.query<{ result: { storage_key: string; inbox_item_id: string } }>(`select public.open_unsorted_email_file($1, 0, 'scan.pdf', 16) as result`, [emailId]);
  await asMaintenance(db);
  await db.query(`insert into storage.objects (id, bucket_id, name, metadata) values ($1, 'documents', $2, jsonb_build_object('size', 16))`, [
    randomUUID(),
    opened.rows[0].result.storage_key,
  ]);
  await asServiceRole(db);
  await db.query(`select public.finish_unsorted_email_file($1, 0, $2, $3)`, [emailId, SHA, PDF]);
  await db.query(`select public.finish_inbound_attachments($1)`, [emailId]);
  return { emailId, itemId: opened.rows[0].result.inbox_item_id };
}

const staff = (ctx: Ctx, userId: string, totpAgeSeconds = 0) => asUser(db, { userId, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds });

describe("Email to triage (OPS-06)", () => {
  it("shows matter mail only to staff who can read the matter, and unfiled mail to all staff", async () => {
    const ctx = await firm();
    const loose = await arrive(ctx, `${ctx.orgSlug}@docs.casevoya.ca`);
    const matterMail = await arrive(ctx, ctx.reply);

    const visible = async (userId: string) => {
      await staff(ctx, userId);
      const emails = await db.query<{ id: string }>(`select id from public.inbound_emails where organization_id = $1`, [ctx.orgId]);
      const items = await db.query<{ id: string }>(`select id from public.inbound_inbox_items where organization_id = $1`, [ctx.orgId]);
      const files = await db.query<{ id: string }>(`select id from public.inbound_attachment_files where organization_id = $1`, [ctx.orgId]);
      const replies = await db.query<{ id: string }>(`select id from public.matter_reply_addresses where organization_id = $1`, [ctx.orgId]);
      return { emails: emails.rows.map((row) => row.id), items: items.rows.map((row) => row.id), files: files.rows.length, replies: replies.rows.length };
    };

    const owner = await visible(ctx.owner);
    expect(owner.emails).toEqual(expect.arrayContaining([loose.emailId, matterMail.emailId]));
    const onMatter = await visible(ctx.consultant);
    expect(onMatter.emails).toEqual(expect.arrayContaining([loose.emailId, matterMail.emailId]));
    expect(onMatter.items).toContain(matterMail.itemId);
    const offMatter = await visible(ctx.outsider);
    expect(offMatter.emails).toEqual([loose.emailId]);
    expect(offMatter.items).toEqual([loose.itemId]);
    expect(offMatter.files).toBe(1);
    expect(offMatter.replies).toBe(0);

    await asUser(db, { userId: ctx.client, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const client = await db.query(`select id from public.inbound_emails where organization_id = $1`, [ctx.orgId]);
    expect(client.rows).toHaveLength(0);
  });

  it("files an email to a person on a matter, with step-up, within the caller's scope", async () => {
    const ctx = await firm();
    const mail = await arrive(ctx, ctx.reply, "sponsor@example.test");

    await staff(ctx, ctx.outsider);
    await expectDbError(() => db.query(`select public.file_inbound_email($1, $2, $3)`, [mail.emailId, ctx.matterId, ctx.sponsorId]), /denied|42501/);
    await staff(ctx, ctx.consultant, 3600);
    await expectDbError(() => db.query(`select public.file_inbound_email($1, $2, $3)`, [mail.emailId, ctx.matterId, ctx.sponsorId]), /step-up/);
    await staff(ctx, ctx.consultant);
    await expectDbError(() => db.query(`select public.file_inbound_email($1, $2, $3)`, [mail.emailId, ctx.matterId, ctx.stranger]), /not on this matter/);
    const filed = await db.query<{ result: { items: string[]; person_id: string } }>(`select public.file_inbound_email($1, $2, $3) as result`, [
      mail.emailId,
      ctx.matterId,
      ctx.sponsorId,
    ]);
    expect(filed.rows[0].result.items).toEqual([mail.itemId]);
    const row = await db.query<{ triage_state: string; person_id: string; triaged_by: string }>(
      `select triage_state, person_id, triaged_by from public.inbound_emails where id = $1`,
      [mail.emailId],
    );
    expect(row.rows[0]).toEqual({ triage_state: "filed", person_id: ctx.sponsorId, triaged_by: ctx.consultant });
    await expectDbError(() => db.query(`select public.file_inbound_email($1, $2, $3)`, [mail.emailId, ctx.matterId, ctx.sponsorId]), /already triaged/);

    // A filed email's file goes only to the person it was filed to.
    await expectDbError(() => db.query(`select public.assign_unsorted_email_file($1, $2, $3)`, [mail.itemId, ctx.matterId, ctx.personId]), /filed matter/);
    const assigned = await db.query<{ result: { storage_key: string; source_storage_key: string } }>(
      `select public.assign_unsorted_email_file($1, $2, $3) as result`,
      [mail.itemId, ctx.matterId, ctx.sponsorId],
    );
    expect(assigned.rows[0].result.source_storage_key).not.toBe(assigned.rows[0].result.storage_key);

    await asMaintenance(db);
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log where organization_id = $1 and action in ('email.filed', 'email.attachment_assigned') order by action`,
      [ctx.orgId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["email.attachment_assigned", "email.filed"]);
  });

  it("dismisses mail that is not case mail, and then refuses its files", async () => {
    const ctx = await firm();
    const mail = await arrive(ctx, `${ctx.orgSlug}@docs.casevoya.ca`, "info@unknown.example");
    await asUser(db, { userId: ctx.client, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.dismiss_inbound_email($1, null)`, [mail.emailId]), /denied|42501/);
    await staff(ctx, ctx.outsider);
    await db.query(`select public.dismiss_inbound_email($1, 'Not case mail')`, [mail.emailId]);
    const row = await db.query<{ triage_state: string; triage_note: string }>(`select triage_state, triage_note from public.inbound_emails where id = $1`, [mail.emailId]);
    expect(row.rows[0]).toEqual({ triage_state: "dismissed", triage_note: "Not case mail" });
    await staff(ctx, ctx.consultant);
    await expectDbError(() => db.query(`select public.assign_unsorted_email_file($1, $2, $3)`, [mail.itemId, ctx.matterId, ctx.personId]), /dismissed/);
    await expectDbError(() => db.query(`select public.file_inbound_email($1, $2, $3)`, [mail.emailId, ctx.matterId, ctx.personId]), /already triaged/);
  });

  it("files mail from a verified sender on arrival", async () => {
    const ctx = await firm();
    await asServiceRole(db);
    const begun = await db.query<{ result: { inbound_email_id: string; person_id: string | null } }>(
      `select public.begin_verified_inbound_message($1, 'client@example.test', $2, 'Hi', 'text', null, null, true) as result`,
      [ctx.reply, `<v-${randomUUID()}@example.test>`],
    );
    expect(begun.rows[0].result.person_id).toBe(ctx.personId);
    await asMaintenance(db);
    const row = await db.query<{ triage_state: string }>(`select triage_state from public.inbound_emails where id = $1`, [begun.rows[0].result.inbound_email_id]);
    expect(row.rows[0].triage_state).toBe("filed");
  });
});
