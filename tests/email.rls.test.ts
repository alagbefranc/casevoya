import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RESERVED_FIRM_SLUGS } from "@/lib/auth/slug";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

let db: TestDb;
const PDF = "255044462d312e340d0a25e2e3cfd3";
const SHA = "ab".repeat(32);

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

async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const client = await createUser(email("client"));
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(
    `select (public.create_organization($1, $2, $3)).id as id`,
    ["Synthetic Legal Name", "Synthetic Firm", slug()],
  );
  const orgId = created.rows[0].id;
  const orgSlug = (
    await db.query<{ slug: string }>(`select slug from public.organizations where id = $1`, [orgId])
  ).rows[0].slug;
  await asMaintenance(db);
  const consultantMembership = (
    await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
       values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
      [orgId, consultant, owner],
    )
  ).rows[0].id;
  await db.query(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, 'client', 'active', now(), $3)`,
    [orgId, client, owner],
  );
  const ownerMembership = (
    await db.query<{ id: string }>(
      `select id from public.memberships where organization_id = $1 and user_id = $2 and role = 'firm_owner'`,
      [orgId, owner],
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
  const matter = await db.query<{ result: { id: string } }>(
    `select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`,
    [consultantMembership],
  );
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, display_name, is_sample, user_id, email)
     values ($1, 'Synthetic applicant', true, $2, $3) returning id`,
    [orgId, client, "client@example.test"],
  );
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role)
     values ($1, $2, $3, 'applicant')`,
    [orgId, matterId, person.rows[0].id],
  );
  return { owner, consultant, client, orgId, orgSlug, matterId, personId: person.rows[0].id, ownerMembership, consultantMembership };
}

async function storeObject(key: string, size: number) {
  await asMaintenance(db);
  await db.query(
    `insert into storage.objects (id, bucket_id, name, metadata)
     values ($1, 'documents', $2, jsonb_build_object('size', $3::int))`,
    [randomUUID(), key, size],
  );
}

describe("outbound and inbound email", () => {
  it("covers the agreements current-version foreign key", async () => {
    const index = await db.query(
      `select 1 from pg_indexes where indexname = 'agreements_current_version_org_fk_idx'`,
    );
    expect(index.rows).toHaveLength(1);
  });

  it("reserves platform slugs and still allows a longer slug", async () => {
    const reserved = await db.query<{ slugs: string[] }>(`select app.reserved_firm_slugs() as slugs`);
    expect(reserved.rows[0].slugs).toEqual([...RESERVED_FIRM_SLUGS]);
    const pinned = await db.query<{ proconfig: string[] | null }>(
      `select p.proconfig
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'reserved_firm_slugs'`,
    );
    expect(pinned.rows[0].proconfig?.join(" ") ?? "").toMatch(/search_path=/);
    await db.query(`select set_config('search_path', 'pg_temp', true)`);
    const still = await db.query<{ slugs: string[] }>(`select app.reserved_firm_slugs() as slugs`);
    expect(still.rows[0].slugs).toEqual([...RESERVED_FIRM_SLUGS]);
    const owner = await createUser(email("owner"));
    await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.create_organization('Legal Name', 'Support', 'support')`),
      /reserved/,
    );
    const created = await db.query<{ id: string }>(
      `select (public.create_organization('Legal Name', 'Support North', 'support-north')).id as id`,
    );
    await expectDbError(
      () => db.query(`update public.organizations set slug = 'admin' where id = $1`, [created.rows[0].id]),
      /reserved/,
    );
    await db.query(`update public.organizations set display_name = 'Support North Legal' where id = $1`, [
      created.rows[0].id,
    ]);
  });

  it("sends a claimed event once, suppresses a repeat, and opens one bounce task", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    const event = await db.query<{ id: string }>(
      `insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
       values ($1, 'invitation', $2, 'portal_invitation.email_requested', $3::jsonb, $4)
       returning id`,
      [
        ctx.orgId,
        randomUUID(),
        JSON.stringify({
          recipient_email: "client@example.test",
          role: "client",
          matter_id: ctx.matterId,
          invitation_id: randomUUID(),
        }),
        `portal-mail-${randomUUID()}`,
      ],
    );
    await asServiceRole(db);
    const claimed = await db.query<{ events: { id: string }[] }>(
      `select public.claim_mail_events('mail-test', 10) as events`,
    );
    expect(claimed.rows[0].events.some((row) => row.id === event.rows[0].id)).toBe(true);
    const prepared = await db.query<{ result: { action: string; messages: { from_address: string; from_name: string; reply_to_address: string; to: string; delivery_id: string }[] } }>(
      `select public.prepare_email_delivery($1, 'mail-test', 'docs.casevoya.ca', 'notices@casevoya.ca') as result`,
      [event.rows[0].id],
    );
    expect(prepared.rows[0].result.action).toBe("send");
    const message = prepared.rows[0].result.messages[0];
    expect(message.from_address).toBe("notices@casevoya.ca");
    expect(message.from_name).toBe("Synthetic Firm");
    expect(message.reply_to_address).toMatch(new RegExp(`^${ctx.orgSlug}\\+[a-f0-9]{32}@docs\\.casevoya\\.ca$`));
    expect(message.to).toBe("client@example.test");
    await db.query(`select public.finish_email_delivery($1, 'mail-test', 'sent', 'provider-msg', null)`, [
      message.delivery_id,
    ]);
    const again = await db.query<{ result: { action: string } }>(
      `select public.prepare_email_delivery($1, 'mail-test', null, null) as result`,
      [event.rows[0].id],
    );
    expect(again.rows[0].result.action).toBe("done");

    await asMaintenance(db);
    await db.query(
      `insert into public.email_suppressions (organization_id, recipient_email, reason)
       values ($1, 'client@example.test', 'manual')`,
      [ctx.orgId],
    );
    const suppressedEvent = await db.query<{ id: string }>(
      `insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
       values ($1, 'invitation', $2, 'staff_invitation.email_requested', $3::jsonb, $4)
       returning id`,
      [ctx.orgId, randomUUID(), JSON.stringify({ recipient_email: "client@example.test", role: "assistant" }), `staff-${randomUUID()}`],
    );
    await asServiceRole(db);
    await db.query(`select public.claim_mail_events('mail-test', 10)`);
    const skipped = await db.query<{ result: { action: string } }>(
      `select public.prepare_email_delivery($1, 'mail-test', null, null) as result`,
      [suppressedEvent.rows[0].id],
    );
    expect(skipped.rows[0].result.action).toBe("done");

    await asMaintenance(db);
    const bounceEvent = await db.query<{ id: string }>(
      `insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
       values ($1, 'agreement', $2, 'agreement.sent', $3::jsonb, $4)
       returning id`,
      [
        ctx.orgId,
        randomUUID(),
        JSON.stringify({ matter_id: ctx.matterId, envelope_id: randomUUID(), agreement_id: randomUUID() }),
        `agreement-${randomUUID()}`,
      ],
    );
    await asServiceRole(db);
    await db.query(`select public.claim_mail_events('mail-test', 10)`);
    const bouncePrepared = await db.query<{ result: { messages: { delivery_id: string }[] } }>(
      `select public.prepare_email_delivery($1, 'mail-test', 'docs.casevoya.ca', null) as result`,
      [bounceEvent.rows[0].id],
    );
    expect(bouncePrepared.rows[0].result.messages.length).toBe(0);
  });

  it("records a hard bounce follow-up once for a known recipient", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    const eventId = (
      await db.query<{ id: string }>(
        `insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
         values ($1, 'invitation', $2, 'portal_invitation.email_requested', $3::jsonb, $4)
         returning id`,
        [
          ctx.orgId,
          randomUUID(),
          JSON.stringify({ recipient_email: "other@example.test", role: "client", matter_id: ctx.matterId }),
          `bounce-${randomUUID()}`,
        ],
      )
    ).rows[0].id;
    await asServiceRole(db);
    await db.query(`select public.claim_mail_events('bounce-test', 5)`);
    const prepared = await db.query<{ result: { messages: { delivery_id: string }[] } }>(
      `select public.prepare_email_delivery($1, 'bounce-test', null, null) as result`,
      [eventId],
    );
    const deliveryId = prepared.rows[0].result.messages[0].delivery_id;
    await db.query(`select public.finish_email_delivery($1, 'bounce-test', 'bounced', 'bounce-msg', 'hard')`, [deliveryId]);
    await db.query(`select public.finish_email_delivery($1, 'bounce-test', 'bounced', 'bounce-msg', 'hard')`, [deliveryId]);
    await asMaintenance(db);
    const tasks = await db.query(
      `select id from public.tasks where organization_id = $1 and task_key = 'email_delivery_failure'`,
      [ctx.orgId],
    );
    expect(tasks.rows).toHaveLength(1);
    const suppressed = await db.query<{ reason: string }>(
      `select reason from public.email_suppressions where organization_id = $1 and recipient_email = 'other@example.test'`,
      [ctx.orgId],
    );
    expect(suppressed.rows[0].reason).toBe("hard_bounce");
  });

  it("rejects unknown and reserved firms, drops duplicate message ids, and rate limits", async () => {
    const ctx = await firm();
    await asServiceRole(db);
    const unknown = await db.query<{ result: { status: string } }>(
      `select public.begin_inbound_message('nobody@docs.casevoya.ca', 'a@example.test', $1, 'Hi', 'text', null, 'docs.casevoya.ca') as result`,
      [`<unknown-${randomUUID()}@example.test>`],
    );
    expect(unknown.rows[0].result.status).toBe("unknown_firm");
    const reserved = await db.query<{ result: { status: string } }>(
      `select public.begin_inbound_message('support@docs.casevoya.ca', 'a@example.test', $1, 'Hi', 'text', null, null) as result`,
      [`<reserved-${randomUUID()}@example.test>`],
    );
    expect(reserved.rows[0].result.status).toBe("reserved");

    const first = await db.query<{ result: { status: string; person_id: string; inbound_email_id: string } }>(
      `select public.begin_verified_inbound_message($1, 'client@example.test', '<same-message@example.test>', 'Hello', 'Body text', '<p>Body</p>', 'docs.casevoya.ca', true) as result`,
      [`${ctx.orgSlug}@docs.casevoya.ca`],
    );
    expect(first.rows[0].result.status).toBe("accepted");
    expect(first.rows[0].result.person_id).toBe(ctx.personId);
    const duplicate = await db.query<{ result: { status: string } }>(
      `select public.begin_inbound_message($1, 'client@example.test', '<same-message@example.test>', 'Hello', 'Body text', null, null) as result`,
      [`${ctx.orgSlug}@docs.casevoya.ca`],
    );
    expect(duplicate.rows[0].result.status).toBe("resume");
    await db.query(`select public.finish_inbound_attachments($1)`, [first.rows[0].result.inbound_email_id]);
    const dropped = await db.query<{ result: { status: string } }>(
      `select public.begin_inbound_message($1, 'client@example.test', '<same-message@example.test>', 'Hello', 'Body', null, null) as result`,
      [`${ctx.orgSlug}@docs.casevoya.ca`],
    );
    expect(dropped.rows[0].result.status).toBe("duplicate");

    await asMaintenance(db);
    await db.query(
      `update public.product_settings set value = '{"messages":1}'::jsonb where key = 'email.inbound_hourly_limit'`,
    );
    try {
      await asServiceRole(db);
      const limited = await db.query<{ result: { status: string } }>(
        `select public.begin_inbound_message($1, 'stranger@example.test', $2, 'Hi', 'text', null, null) as result`,
        [`${ctx.orgSlug}@docs.casevoya.ca`, `<limit-${randomUUID()}@example.test>`],
      );
      expect(limited.rows[0].result.status).toBe("rate_limited");
    } finally {
      await asMaintenance(db);
      await db.query(
        `update public.product_settings set value = '{"messages":30}'::jsonb where key = 'email.inbound_hourly_limit'`,
      );
    }
  });

  it("does not credit a client for mail whose sender was not authenticated", async () => {
    const ctx = await firm();
    await asServiceRole(db);
    const forged = await db.query<{ result: { status: string; person_id: string | null; matter_id: string | null; inbound_email_id: string } }>(
      `select public.begin_verified_inbound_message($1, 'client@example.test', $2, 'Passport', 'attached', null, null, false) as result`,
      [`${ctx.orgSlug}@docs.casevoya.ca`, `<forged-${randomUUID()}@example.test>`],
    );
    expect(forged.rows[0].result.status).toBe("accepted");
    expect(forged.rows[0].result.person_id).toBeNull();
    expect(forged.rows[0].result.matter_id).toBeNull();
    const legacy = await db.query<{ result: { person_id: string | null } }>(
      `select public.begin_inbound_message($1, 'client@example.test', $2, 'Passport', 'attached', null, null) as result`,
      [`${ctx.orgSlug}@docs.casevoya.ca`, `<legacy-${randomUUID()}@example.test>`],
    );
    expect(legacy.rows[0].result.person_id).toBeNull();
    await asMaintenance(db);
    const stored = await db.query<{ sender_verified: boolean; person_id: string | null }>(
      `select sender_verified, person_id from public.inbound_emails where id = $1`,
      [forged.rows[0].result.inbound_email_id],
    );
    expect(stored.rows[0]).toEqual({ sender_verified: false, person_id: null });
  });

  it("keeps the verification wrapper away from signed-in users", async () => {
    const ctx = await firm();
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(
          `select public.begin_verified_inbound_message($1, 'client@example.test', $2, 'x', 'x', null, null, true)`,
          [`${ctx.orgSlug}@docs.casevoya.ca`, `<user-${randomUUID()}@example.test>`],
        ),
      /permission denied|42501/,
    );
  });

  it("links a known sender through document intake and files everyone else in the inbox", async () => {
    const ctx = await firm();
    await asServiceRole(db);
    const known = await db.query<{ result: { inbound_email_id: string; person_id: string } }>(
      `select public.begin_verified_inbound_message($1, 'client@example.test', $2, 'Scan', 'see attached', null, 'docs.casevoya.ca', true) as result`,
      [`${ctx.orgSlug}@docs.casevoya.ca`, `<known-${randomUUID()}@example.test>`],
    );
    const intent = await db.query<{ result: { storage_key: string; version_id: string } }>(
      `select public.create_email_upload_intent($1, 0, 'scan.pdf', 16) as result`,
      [known.rows[0].result.inbound_email_id],
    );
    await storeObject(intent.rows[0].result.storage_key, 16);
    await asServiceRole(db);
    const completed = await db.query<{ result: { upload_state: string; scan_result: string } }>(
      `select public.complete_email_upload($1, 0, $2, $3) as result`,
      [known.rows[0].result.inbound_email_id, SHA, PDF],
    );
    expect(completed.rows[0].result.upload_state).toBe("clean");
    expect(completed.rows[0].result.scan_result).toBe("structural_only");

    const stranger = await db.query<{ result: { inbound_email_id: string; person_id: string | null } }>(
      `select public.begin_inbound_message($1, 'stranger@example.test', $2, 'Scan', 'see attached', null, null) as result`,
      [`${ctx.orgSlug}@docs.casevoya.ca`, `<unsorted-${randomUUID()}@example.test>`],
    );
    expect(stranger.rows[0].result.person_id).toBeNull();
    const opened = await db.query<{ result: { storage_key: string; inbox_item_id: string } }>(
      `select public.open_unsorted_email_file($1, 0, 'scan.pdf', 16) as result`,
      [stranger.rows[0].result.inbound_email_id],
    );
    await storeObject(opened.rows[0].result.storage_key, 16);
    await asServiceRole(db);
    const filed = await db.query<{ result: { upload_state: string } }>(
      `select public.finish_unsorted_email_file($1, 0, $2, $3) as result`,
      [stranger.rows[0].result.inbound_email_id, SHA, PDF],
    );
    expect(filed.rows[0].result.upload_state).toBe("clean");

    await asUser(db, { userId: ctx.client, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const hidden = await db.query(`select id from public.inbound_emails where organization_id = $1`, [ctx.orgId]);
    expect(hidden.rows).toHaveLength(0);
    await asUser(db, { userId: ctx.consultant, aal: "aal1", orgId: ctx.orgId });
    const noMfa = await db.query(`select id from public.inbound_inbox_items where organization_id = $1`, [ctx.orgId]);
    expect(noMfa.rows).toHaveLength(0);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const visible = await db.query(`select id from public.inbound_inbox_items where organization_id = $1`, [ctx.orgId]);
    expect(visible.rows.length).toBeGreaterThan(0);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 3600 });
    await expectDbError(
      () =>
        db.query(`select public.assign_unsorted_email_file($1, $2, $3)`, [
          opened.rows[0].result.inbox_item_id,
          ctx.matterId,
          ctx.personId,
        ]),
      /step-up|42501|denied/,
    );
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const assigned = await db.query<{ result: { storage_key: string } }>(
      `select public.assign_unsorted_email_file($1, $2, $3) as result`,
      [opened.rows[0].result.inbox_item_id, ctx.matterId, ctx.personId],
    );
    expect(assigned.rows[0].result.storage_key.length).toBeGreaterThan(16);
  });

  it("stores a matter body on messages when that table exists", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    await db.query(
      `create table public.messages (
         id uuid primary key default gen_random_uuid(),
         organization_id uuid,
         matter_id uuid,
         body text,
         internal_note boolean,
         audience text
       )`,
    );
    try {
      await asServiceRole(db);
      const result = await db.query<{ result: { status: string; inbound_email_id: string } }>(
        `select public.begin_verified_inbound_message($1, 'client@example.test', $2, 'Note', 'Hello from mail', '<p>Hello</p>', null, true) as result`,
        [`${ctx.orgSlug}@docs.casevoya.ca`, `<thread-${randomUUID()}@example.test>`],
      );
      expect(result.rows[0].result.status).toBe("accepted");
      await asMaintenance(db);
      const message = await db.query<{ body: string; internal_note: boolean; audience: string }>(
        `select body, internal_note, audience from public.messages where matter_id = $1`,
        [ctx.matterId],
      );
      expect(message.rows[0].body).toContain("Hello from mail");
      expect(message.rows[0].internal_note).toBe(false);
      expect(message.rows[0].audience).toBe("external");
      const stored = await db.query<{ text_body: string | null; body_location: string }>(
        `select text_body, body_location from public.inbound_emails where id = $1`,
        [result.rows[0].result.inbound_email_id],
      );
      expect(stored.rows[0].body_location).toBe("messages");
      expect(stored.rows[0].text_body).toBeNull();
    } finally {
      await asMaintenance(db);
      await db.query(`drop table public.messages`);
    }
  });
});
