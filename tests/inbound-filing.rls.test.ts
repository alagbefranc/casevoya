import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

/**
 * OPS-06: the matter inbound address, File to matter with per-file choices, no automatic replies,
 * forwarded mail never grants access, and a follow-up task for every critical bounce.
 */

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

/** A synthetic firm: owner, a consultant on the matter, a case manager off it, and the applicant. */
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
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [orgId, matterId, personId]);
  return { owner, consultant, outsider, client, orgId, orgSlug, matterId, personId };
}

type Ctx = Awaited<ReturnType<typeof firm>>;

/** An unverified message with `files` clean PDFs in the unsorted inbox. */
async function arrive(ctx: Ctx, to: string, from = "someone@example.test", files = 1) {
  await asServiceRole(db);
  const begun = await db.query<{ result: { inbound_email_id: string } }>(
    `select public.begin_verified_inbound_message($1, $2, $3, 'Files', 'see attached', null, null, false) as result`,
    [to, from, `<m-${randomUUID()}@example.test>`],
  );
  const emailId = begun.rows[0].result.inbound_email_id;
  const items: string[] = [];
  for (let ordinal = 0; ordinal < files; ordinal++) {
    await asServiceRole(db);
    const opened = await db.query<{ result: { storage_key: string; inbox_item_id: string } }>(`select public.open_unsorted_email_file($1, $2, 'scan.pdf', 16) as result`, [
      emailId,
      ordinal,
    ]);
    await asMaintenance(db);
    await db.query(`insert into storage.objects (id, bucket_id, name, metadata) values ($1, 'documents', $2, jsonb_build_object('size', 16))`, [
      randomUUID(),
      opened.rows[0].result.storage_key,
    ]);
    await asServiceRole(db);
    await db.query(`select public.finish_unsorted_email_file($1, $2, $3, $4)`, [emailId, ordinal, SHA, PDF]);
    items.push(opened.rows[0].result.inbox_item_id);
  }
  await asServiceRole(db);
  await db.query(`select public.finish_inbound_attachments($1)`, [emailId]);
  return { emailId, items };
}

const staff = (ctx: Ctx, userId: string, totpAgeSeconds = 0) => asUser(db, { userId, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds });

describe("Matter inbound address (OPS-06)", () => {
  it("gives staff who can read the matter one stable, unguessable address, and no one else", async () => {
    const ctx = await firm();
    await staff(ctx, ctx.consultant);
    const first = await db.query<{ result: { address: string; matter_tag: boolean } }>(`select public.matter_inbound_address($1, 'docs.casevoya.ca') as result`, [ctx.matterId]);
    const again = await db.query<{ result: { address: string } }>(`select public.matter_inbound_address($1, 'docs.casevoya.ca') as result`, [ctx.matterId]);
    expect(first.rows[0].result.address).toMatch(new RegExp(`^${ctx.orgSlug}\\+[a-f0-9]{32}@docs\\.casevoya\\.ca$`));
    expect(first.rows[0].result.matter_tag).toBe(true);
    expect(again.rows[0].result.address).toBe(first.rows[0].result.address);
    expect(first.rows[0].result.address).not.toContain(ctx.matterId.replaceAll("-", ""));

    // The address resolves to the matter for inbound mail.
    await asMaintenance(db);
    const resolved = await db.query<{ result: { matter_id: string } }>(`select app.resolve_inbound_address($1, 'docs.casevoya.ca') as result`, [
      first.rows[0].result.address,
    ]);
    expect(resolved.rows[0].result.matter_id).toBe(ctx.matterId);

    await staff(ctx, ctx.outsider);
    await expectDbError(() => db.query(`select public.matter_inbound_address($1, null)`, [ctx.matterId]), /denied|42501/);
    await asUser(db, { userId: ctx.client, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.matter_inbound_address($1, null)`, [ctx.matterId]), /denied|42501/);
    const other = await firm();
    await staff(other, other.owner);
    await expectDbError(() => db.query(`select public.matter_inbound_address($1, null)`, [ctx.matterId]), /denied|42501/);
  });
});

describe("File to matter with per-file choices (OPS-06)", () => {
  it("files the email, keeps a staff-only file private and never copies a file left out", async () => {
    const ctx = await firm();
    const mail = await arrive(ctx, `${ctx.orgSlug}@docs.casevoya.ca`, "someone@example.test", 3);
    const [privateItem, clientItem, leftOut] = mail.items;
    const files = JSON.stringify([
      { item_id: privateItem, save: true, audience: "staff" },
      { item_id: clientItem, save: true, audience: "subject" },
      { item_id: leftOut, save: false },
    ]);

    await staff(ctx, ctx.outsider);
    await expectDbError(() => db.query(`select public.file_inbound_email_to_matter($1, $2, $3, $4::jsonb)`, [mail.emailId, ctx.matterId, ctx.personId, files]), /denied|42501/);
    await staff(ctx, ctx.consultant, 3600);
    await expectDbError(() => db.query(`select public.file_inbound_email_to_matter($1, $2, $3, $4::jsonb)`, [mail.emailId, ctx.matterId, ctx.personId, files]), /step-up/);
    await staff(ctx, ctx.consultant);
    await expectDbError(
      () => db.query(`select public.file_inbound_email_to_matter($1, $2, $3, $4::jsonb)`, [mail.emailId, ctx.matterId, ctx.personId, JSON.stringify([{ item_id: privateItem, audience: "everyone" }])]),
      /who may see/,
    );
    await expectDbError(
      () => db.query(`select public.file_inbound_email_to_matter($1, $2, $3, $4::jsonb)`, [mail.emailId, ctx.matterId, ctx.personId, JSON.stringify([{ item_id: randomUUID() }])]),
      /not on this email/,
    );
    // The failed attempts rolled back: the email is still open.
    const open = await db.query<{ triage_state: string }>(`select triage_state from public.inbound_emails where id = $1`, [mail.emailId]);
    expect(open.rows[0].triage_state).toBe("open");

    const filed = await db.query<{ result: { items: string[]; matter_id: string } }>(`select public.file_inbound_email_to_matter($1, $2, $3, $4::jsonb) as result`, [
      mail.emailId,
      ctx.matterId,
      ctx.personId,
      files,
    ]);
    expect(filed.rows[0].result.matter_id).toBe(ctx.matterId);
    expect([...filed.rows[0].result.items].sort()).toEqual([privateItem, clientItem].sort());

    await expectDbError(() => db.query(`select public.assign_unsorted_email_file($1, $2, $3)`, [leftOut, ctx.matterId, ctx.personId]), /left out/);
    const assign = async (itemId: string) =>
      (await db.query<{ result: { version_id: string } }>(`select public.assign_unsorted_email_file($1, $2, $3) as result`, [itemId, ctx.matterId, ctx.personId])).rows[0].result.version_id;
    const privateVersion = await assign(privateItem);
    const clientVersion = await assign(clientItem);

    await asMaintenance(db);
    const audience = async (versionId: string) =>
      (
        await db.query<{ audience: string }>(
          `select doc.audience::text as audience from public.document_versions version join public.documents doc on doc.id = version.document_id where version.id = $1`,
          [versionId],
        )
      ).rows[0].audience;
    expect(await audience(privateVersion)).toBe("staff");
    expect(await audience(clientVersion)).toBe("subject");
    const audit = await db.query<{ context: { saved: number; left_out: number } }>(
      `select context from public.audit_log where organization_id = $1 and action = 'email.files_chosen'`,
      [ctx.orgId],
    );
    expect(audit.rows[0].context).toMatchObject({ saved: 2, left_out: 1 });
  });
});

describe("No automatic replies, and forwarding never grants access (OPS-06)", () => {
  it("queues no outbound mail for mail from an unknown sender", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    const before = await db.query<{ n: number }>(`select count(*)::int as n from public.outbox_events where organization_id = $1`, [ctx.orgId]);
    await arrive(ctx, `${ctx.orgSlug}@docs.casevoya.ca`, "stranger@unknown.example");
    await asServiceRole(db);
    await db.query(`select public.begin_verified_inbound_message($1, 'stranger@unknown.example', $2, 'Hello', 'Who handles my file?', null, null, true)`, [
      `${ctx.orgSlug}@docs.casevoya.ca`,
      `<v-${randomUUID()}@example.test>`,
    ]);
    await asMaintenance(db);
    const after = await db.query<{ n: number }>(`select count(*)::int as n from public.outbox_events where organization_id = $1`, [ctx.orgId]);
    const deliveries = await db.query<{ n: number }>(`select count(*)::int as n from public.email_deliveries where organization_id = $1 and recipient_email = 'stranger@unknown.example'`, [
      ctx.orgId,
    ]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(deliveries.rows[0].n).toBe(0);
  });

  it("filing a forwarded email gives its sender no membership, person, participant or matter access", async () => {
    const ctx = await firm();
    const forwarderAddress = email("forwarder");
    const forwarder = await createUser(forwarderAddress);
    const reply = (await db.query<{ address: string }>(`select app.firm_reply_address($1, $2, null) as address`, [ctx.orgId, ctx.matterId])).rows[0].address;
    const mail = await arrive(ctx, reply, forwarderAddress);
    await asMaintenance(db);
    const count = async () =>
      (
        await db.query<{ memberships: number; persons: number; participants: number }>(
          `select (select count(*)::int from public.memberships where organization_id = $1) as memberships,
                  (select count(*)::int from public.persons where organization_id = $1) as persons,
                  (select count(*)::int from public.matter_participants where organization_id = $1) as participants`,
          [ctx.orgId],
        )
      ).rows[0];
    const before = await count();
    await staff(ctx, ctx.consultant);
    await db.query(`select public.file_inbound_email_to_matter($1, $2, $3, $4::jsonb)`, [mail.emailId, ctx.matterId, ctx.personId, JSON.stringify([{ item_id: mail.items[0], save: true, audience: "subject" }])]);
    await asMaintenance(db);
    expect(await count()).toEqual(before);
    const linked = await db.query(`select id from public.persons where organization_id = $1 and (user_id = $2 or email = $3)`, [ctx.orgId, forwarder, forwarderAddress]);
    expect(linked.rows).toHaveLength(0);

    await asUser(db, { userId: forwarder, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    for (const table of ["matters", "inbound_emails", "inbound_inbox_items", "documents", "matter_reply_addresses"]) {
      const rows = await db.query(`select id from public.${table} where organization_id = $1`, [ctx.orgId]);
      expect(rows.rows, table).toHaveLength(0);
    }
  });
});

describe("Critical bounce follow-up (OPS-06)", () => {
  async function criticalBounce(ctx: Ctx, worker: string, matterId: string | null) {
    await asMaintenance(db);
    const payload: Record<string, unknown> = { recipient_email: email("bounce"), role: "client" };
    if (matterId) payload.matter_id = matterId;
    const eventId = (
      await db.query<{ id: string }>(
        `insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, occurred_at)
         values ($1, 'invitation', $2, 'portal_invitation.email_requested', $3::jsonb, $4, now() - interval '11 minutes')
         returning id`,
        [ctx.orgId, randomUUID(), JSON.stringify(payload), `bounce-${randomUUID()}`],
      )
    ).rows[0].id;
    await asServiceRole(db);
    await db.query(`select public.claim_mail_events($1, 5)`, [worker]);
    const prepared = await db.query<{ result: { messages: { delivery_id: string }[] } }>(`select public.prepare_email_delivery($1, $2, null, null) as result`, [eventId, worker]);
    const deliveryId = prepared.rows[0].result.messages[0].delivery_id;
    await db.query(`select public.finish_email_delivery($1, $2, 'bounced', 'bounce-msg', 'hard')`, [deliveryId, worker]);
    await asMaintenance(db);
    return (await db.query<{ critical: boolean; follow_up_task_id: string | null; status: string }>(`select critical, follow_up_task_id, status::text from public.email_deliveries where id = $1`, [deliveryId])).rows[0];
  }

  it("opens one follow-up task and records it on every critical bounce on a matter", async () => {
    const ctx = await firm();
    const first = await criticalBounce(ctx, `w-${randomUUID().slice(0, 6)}`, ctx.matterId);
    expect(first).toMatchObject({ status: "bounced", critical: true });
    expect(first.follow_up_task_id).toBeTruthy();
    // A second critical bounce while the task is open joins it (before, it was recorded nowhere).
    const second = await criticalBounce(ctx, `w-${randomUUID().slice(0, 6)}`, ctx.matterId);
    expect(second.follow_up_task_id).toBe(first.follow_up_task_id);
    // A task needs a matter (tasks_check), so a critical bounce with no matter has no task: Delivery
    // problems says so and staff follow it up themselves.
    const noMatter = await criticalBounce(ctx, `w-${randomUUID().slice(0, 6)}`, null);
    expect(noMatter.status).toBe("bounced");
    expect(noMatter.follow_up_task_id).toBeNull();
    const tasks = await db.query<{ id: string; status: string; matter_id: string }>(
      `select id, status::text, matter_id from public.tasks where organization_id = $1 and task_key = 'email_delivery_failure'`,
      [ctx.orgId],
    );
    expect(tasks.rows).toEqual([{ id: first.follow_up_task_id, status: "open", matter_id: ctx.matterId }]);

    // Staff read the link through RLS (Delivery problems); a client does not see deliveries.
    await staff(ctx, ctx.owner);
    const visible = await db.query<{ follow_up_task_id: string | null }>(`select follow_up_task_id from public.email_deliveries where organization_id = $1 and status = 'bounced'`, [ctx.orgId]);
    expect(visible.rows.map((row) => row.follow_up_task_id).sort()).toEqual([first.follow_up_task_id, first.follow_up_task_id, null].sort());
    const task = await db.query(`select id from public.tasks where id = $1`, [first.follow_up_task_id]);
    expect(task.rows).toHaveLength(1);
    await asUser(db, { userId: ctx.client, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const hidden = await db.query(`select id from public.email_deliveries where organization_id = $1`, [ctx.orgId]);
    expect(hidden.rows).toHaveLength(0);
  });
});
