import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { VO_VENDOR_TERMS } from "@/modules/vo/vendor-terms";

/**
 * 20261019207100_vo_drafts.sql against the real migrations (PRD AI-01..AI-06, SRC-09, acceptance
 * scenario 17): the owner's switch (off for a real firm until turned on, on in sample mode for
 * sample records only), who may ask Vo, rate limits, grounded sources that must belong to the
 * run's own conversation, tenant isolation of drafts and runs, sending only through the messaging
 * checks with no placeholder left, and an audit trail without any text.
 */
let db: TestDb;

const MODEL = "claude-opus-5-5";

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().slice(0, 8);

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${tag()}@example.test`,
  ]);
  return id;
}

async function membership(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  const row = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
    [orgId, userId, role],
  );
  return row.rows[0].id;
}

/** A firm with a consultant on one matter, a client in a conversation, and staff who are not on it. */
async function firm(options: { sample?: boolean; sampleMatter?: boolean } = {}) {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = $2 where id = $1`, [orgId, options.sample ?? false]);
  const matter = await db.query<{ id: string }>(
    `insert into public.matters (organization_id, title, is_sample) values ($1, 'Synthetic matter', $2) returning id`,
    [orgId, options.sampleMatter ?? false],
  );
  const matterId = matter.rows[0].id;
  const consultant = await createUser("consultant");
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant");
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [
    orgId,
    matterId,
    consultantMembership,
  ]);
  const outsider = await createUser("other-staff");
  await membership(orgId, outsider, "case_manager");
  const finance = await createUser("finance");
  await membership(orgId, finance, "finance_user");
  const clientUser = await createUser("client");
  await membership(orgId, clientUser, "client");
  await asMaintenance(db);
  const person = await db.query<{ id: string }>(
    `insert into public.persons (organization_id, user_id, display_name, is_sample) values ($1, $2, 'Synthetic Applicant', $3) returning id`,
    [orgId, clientUser, options.sampleMatter ?? false],
  );
  const personId = person.rows[0].id;
  await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant')`, [
    orgId,
    matterId,
    personId,
  ]);
  const f = { orgId, matterId, owner, consultant, outsider, finance, clientUser, personId, threadId: "", clientMessageId: "" };
  // The client writes first: the question Vo drafts a reply to.
  await asUser(db, { userId: clientUser, aal: "aal1", orgId });
  const sent = await db.query<{ result: { message_id: string; thread_id: string } }>(
    `select public.send_matter_message($1, $2, null, null, $3, false, null, null) as result`,
    [orgId, matterId, "Synthetic: can we meet next week?"],
  );
  f.threadId = sent.rows[0].result.thread_id;
  f.clientMessageId = sent.rows[0].result.message_id;
  return f;
}

type Firm = Awaited<ReturnType<typeof firm>>;

const staff = (f: Firm, userId: string) => asUser(db, { userId, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 60 });

async function turnOn(f: Firm, enabled = true, reply = true, messages = true) {
  await staff(f, f.owner);
  // AI-06: the owner acknowledges the AI vendor terms before Vo can be turned on.
  if (enabled) await db.query(`select public.acknowledge_vo_vendor_terms($1, $2)`, [f.orgId, VO_VENDOR_TERMS.version]);
  await db.query(`select public.set_vo_settings($1, $2::jsonb)`, [
    f.orgId,
    JSON.stringify({ enabled, reply_drafts: reply, read_client_messages: messages }),
  ]);
}

async function begin(f: Firm, kind = "message_reply") {
  const row = await db.query<{ r: { ok: boolean; error?: string; run_id?: string; matter_id?: string } }>(
    `select public.begin_vo_run($1, $2::public.vo_run_kind, $3, $4) as r`,
    [f.orgId, kind, kind === "ask" ? null : f.threadId, kind === "ask" ? f.matterId : null],
  );
  return row.rows[0].r;
}

async function finish(runId: string, sources: unknown[], body = "Synthetic draft: I can meet Tuesday.") {
  const row = await db.query<{ id: string | null }>(
    `select public.finish_vo_run($1, 'drafted', 'Reply to Synthetic Applicant', $2, $3::jsonb, $4, 'reply-1', false, 420, null) as id`,
    [runId, body, JSON.stringify(sources), MODEL],
  );
  return row.rows[0].id;
}

function sourcesFor(f: Firm) {
  return [
    { kind: "message", id: f.clientMessageId, label: "Message 18 Oct" },
    { kind: "matter", id: f.matterId, label: "Synthetic matter" },
  ];
}

async function draftFor(f: Firm) {
  await turnOn(f);
  await staff(f, f.consultant);
  const run = await begin(f);
  expect(run.ok).toBe(true);
  const draftId = await finish(run.run_id!, sourcesFor(f));
  expect(draftId).toBeTruthy();
  return { runId: run.run_id!, draftId: draftId! };
}

describe("Vo switch and sample mode", () => {
  it("is off for a real firm until the owner turns it on, and only the owner can", async () => {
    const f = await firm();
    await staff(f, f.consultant);
    expect(await begin(f)).toEqual({ ok: false, error: "off" });
    await expectDbError(() => db.query(`select public.set_vo_settings($1, '{"enabled": true}'::jsonb)`, [f.orgId]), /staff access denied/);
    await staff(f, f.owner);
    await expectDbError(() => db.query(`select public.set_vo_settings($1, '{"send_email": true}'::jsonb)`, [f.orgId]), /unknown Vo switch/);
    await expectDbError(() => db.query(`select public.set_vo_settings($1, '{"enabled": "yes"}'::jsonb)`, [f.orgId]), /unknown Vo switch/);
    await staff(f, f.consultant);
    await turnOn(f);
    await staff(f, f.consultant);
    expect((await begin(f)).ok).toBe(true);
    // Off again: no new run.
    await turnOn(f, false);
    await staff(f, f.consultant);
    expect(await begin(f)).toEqual({ ok: false, error: "off" });
    // A capability switched off stops reply drafts too.
    await turnOn(f, true, false, true);
    await staff(f, f.consultant);
    expect(await begin(f)).toEqual({ ok: false, error: "capability_off" });
    await turnOn(f, true, true, false);
    await staff(f, f.consultant);
    expect(await begin(f)).toEqual({ ok: false, error: "capability_off" });
    await asMaintenance(db);
    const audit = await db.query<{ context: Record<string, unknown> }>(
      `select context from public.audit_log where organization_id = $1 and action = 'vo.settings_changed' order by occurred_at`,
      [f.orgId],
    );
    expect(audit.rows[0].context).toMatchObject({ enabled: true, was_enabled: false });
  });

  it("is on in sample mode with no switch, for sample records only", async () => {
    const sample = await firm({ sample: true, sampleMatter: true });
    await staff(sample, sample.consultant);
    const run = await begin(sample);
    expect(run.ok).toBe(true);
    await asMaintenance(db);
    const row = await db.query<{ is_sample: boolean }>(`select is_sample from public.vo_runs where id = $1`, [run.run_id]);
    expect(row.rows[0].is_sample).toBe(true);

    const mixed = await firm({ sample: true, sampleMatter: false });
    await staff(mixed, mixed.consultant);
    expect(await begin(mixed)).toEqual({ ok: false, error: "sample_only" });
  });
});

describe("who may ask Vo", () => {
  it("lets only staff who can read the conversation ask, at staff assurance", async () => {
    const f = await firm();
    await turnOn(f);
    const other = await firm();
    await staff(f, f.outsider);
    await expectDbError(() => begin(f), /vo denied/);
    await staff(f, f.finance);
    await expectDbError(() => begin(f), /staff access denied/);
    await asUser(db, { userId: f.clientUser, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => begin(f), /staff access denied/);
    await asUser(db, { userId: f.consultant, aal: "aal1", orgId: f.orgId });
    await expectDbError(() => begin(f), /staff access denied/);
    // Another firm's consultant, naming this firm's conversation.
    await staff(other, other.consultant);
    await expectDbError(() => begin({ ...other, threadId: f.threadId }), /vo denied/);
    await expectDbError(() => begin(f), /staff access denied/);
  });

  it("limits each person to 20 runs an hour and 100 a day, and the firm to 300 a day", async () => {
    const f = await firm();
    await turnOn(f);
    await asMaintenance(db);
    await db.query(
      `insert into public.vo_runs (organization_id, user_id, kind, matter_id, thread_id, result, finished_at)
       select $1, $2, 'message_reply', $3, $4, 'failed', now() from generate_series(1, 20)`,
      [f.orgId, f.consultant, f.matterId, f.threadId],
    );
    await staff(f, f.consultant);
    expect(await begin(f)).toEqual({ ok: false, error: "rate_limited" });
    // The owner still has their own allowance until the firm's is used.
    await staff(f, f.owner);
    expect((await begin(f)).ok).toBe(true);
    await asMaintenance(db);
    await db.query(
      `insert into public.vo_runs (organization_id, user_id, kind, matter_id, thread_id, result, finished_at, created_at)
       select $1, $2, 'message_reply', $3, $4, 'failed', now(), now() - interval '2 hours' from generate_series(1, 280)`,
      [f.orgId, f.consultant, f.matterId, f.threadId],
    );
    await staff(f, f.owner);
    expect(await begin(f)).toEqual({ ok: false, error: "firm_rate_limited" });
  });
});

describe("grounded drafts", () => {
  it("saves a draft citing records of its own conversation, and refuses forged sources", async () => {
    const f = await firm();
    const other = await firm();
    await turnOn(f);
    await staff(f, f.consultant);
    const run = await begin(f);
    // A message from another firm's conversation, another matter, an unknown kind: refused.
    await expectDbError(() => finish(run.run_id!, [{ kind: "message", id: other.clientMessageId, label: "Theirs" }]), /outside this conversation/);
    await expectDbError(() => finish(run.run_id!, [{ kind: "matter", id: other.matterId, label: "Theirs" }]), /outside this matter/);
    await expectDbError(() => finish(run.run_id!, [{ kind: "invoice", id: randomUUID(), label: "Invoice" }]), /unknown source kind/);
    await expectDbError(() => finish(run.run_id!, []), /cites 1 to 40/);
    // Another person cannot finish this person's run.
    await staff(f, f.owner);
    await expectDbError(() => finish(run.run_id!, sourcesFor(f)), /vo denied/);
    await staff(f, f.consultant);
    const draftId = await finish(run.run_id!, sourcesFor(f));
    expect(draftId).toBeTruthy();
    await expectDbError(() => finish(run.run_id!, sourcesFor(f)), /already finished/);
    // A malformed model id is refused.
    const second = await begin(f);
    await expectDbError(
      () =>
        db.query(`select public.finish_vo_run($1, 'drafted', 'T', 'Body', $2::jsonb, 'Not a model!', 'reply-1', false, 10, null)`, [
          second.run_id,
          JSON.stringify(sourcesFor(f)),
        ]),
      /unknown model/,
    );
  });

  it("shows drafts and runs only to staff who can read the matter, never across firms", async () => {
    const f = await firm();
    const { draftId } = await draftFor(f);
    const other = await firm();
    const read = async () => (await db.query(`select id from public.vo_drafts where id = $1`, [draftId])).rows.length;
    const runs = async () => (await db.query(`select id from public.vo_runs where organization_id = $1`, [f.orgId])).rows.length;
    await staff(f, f.consultant);
    expect(await read()).toBe(1);
    expect(await runs()).toBe(1);
    await staff(f, f.owner);
    expect(await read()).toBe(1);
    await staff(f, f.outsider);
    expect(await read()).toBe(0);
    expect(await runs()).toBe(0);
    await staff(f, f.finance);
    expect(await read()).toBe(0);
    await asUser(db, { userId: f.clientUser, aal: "aal1", orgId: f.orgId });
    expect(await read()).toBe(0);
    expect(await runs()).toBe(0);
    await staff(other, other.consultant);
    expect(await read()).toBe(0);
    // Nobody writes the tables directly.
    await staff(f, f.consultant);
    await expectDbError(() => db.query(`update public.vo_drafts set status = 'discarded' where id = $1`, [draftId]), /permission denied/);
    await expectDbError(
      () => db.query(`insert into public.vo_settings (organization_id, enabled, updated_by) values ($1, true, $2)`, [f.orgId, f.consultant]),
      /permission denied/,
    );
  });
});

describe("review", () => {
  it("sends only reviewed text through the messaging checks, with no placeholder left", async () => {
    const f = await firm();
    await turnOn(f);
    await staff(f, f.consultant);
    const run = await begin(f);
    const draftId = await finish(run.run_id!, sourcesFor(f), "Synthetic draft. The fee is [needs a sourced rule].");
    await expectDbError(
      () => db.query(`select public.send_vo_draft($1, $2, 'vokey-0001')`, [draftId, "The fee is [needs a sourced rule]."]),
      /placeholder/,
    );
    // Staff not on the matter cannot send it.
    await staff(f, f.outsider);
    await expectDbError(() => db.query(`select public.send_vo_draft($1, 'Synthetic', 'vokey-0002')`, [draftId]), /vo denied/);
    await staff(f, f.consultant);
    const sent = await db.query<{ r: { message_id: string; thread_id: string } }>(
      `select public.send_vo_draft($1, $2, 'vokey-0003') as r`,
      [draftId, "Synthetic reply: I will confirm the fee separately."],
    );
    expect(sent.rows[0].r.thread_id).toBe(f.threadId);
    const again = await db.query<{ r: { message_id: string } }>(`select public.send_vo_draft($1, 'Different', 'vokey-0004') as r`, [draftId]);
    expect(again.rows[0].r.message_id).toBe(sent.rows[0].r.message_id);
    const row = await db.query<{ status: string; edited: boolean; reviewed_by: string }>(
      `select status, edited, reviewed_by from public.vo_drafts where id = $1`,
      [draftId],
    );
    expect(row.rows[0]).toEqual({ status: "sent", edited: true, reviewed_by: f.consultant });
    await expectDbError(() => db.query(`select public.discard_vo_draft($1)`, [draftId]), /already reviewed/);
    // The client reads the message a person sent.
    await asUser(db, { userId: f.clientUser, aal: "aal1", orgId: f.orgId });
    const bodies = await db.query<{ body: string }>(`select body from public.matter_messages where id = $1`, [sent.rows[0].r.message_id]);
    expect(bodies.rows[0].body).toBe("Synthetic reply: I will confirm the fee separately.");

    // The audit trail names actions and ids, never the client's or the draft's text.
    await asMaintenance(db);
    const audit = await db.query<{ action: string; context: Record<string, unknown> }>(
      `select action, context from public.audit_log where organization_id = $1 and action like 'vo.%' order by occurred_at`,
      [f.orgId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["vo.vendor_terms_acknowledged", "vo.settings_changed", "vo.run_started", "vo.run_finished", "vo.draft_sent"]);
    const text = JSON.stringify(audit.rows);
    expect(text).not.toContain("Synthetic");
    expect(text).not.toContain("meet next week");
    expect(audit.rows[4].context).toMatchObject({ edited: true, kind: "message_reply" });
  });

  it("discards a draft once and rates a run", async () => {
    const f = await firm();
    const { runId, draftId } = await draftFor(f);
    await staff(f, f.owner);
    await db.query(`select public.discard_vo_draft($1)`, [draftId]);
    await expectDbError(() => db.query(`select public.discard_vo_draft($1)`, [draftId]), /already reviewed/);
    await db.query(`select public.rate_vo_run($1, true)`, [runId]);
    await staff(f, f.outsider);
    await expectDbError(() => db.query(`select public.rate_vo_run($1, false)`, [runId]), /vo denied/);
    await staff(f, f.owner);
    const row = await db.query<{ status: string; useful: boolean }>(
      `select d.status, r.useful from public.vo_drafts d join public.vo_runs r on r.id = d.run_id where d.id = $1`,
      [draftId],
    );
    expect(row.rows[0]).toEqual({ status: "discarded", useful: true });
  });

  it("records an abstention without a draft", async () => {
    const f = await firm();
    await turnOn(f);
    await staff(f, f.consultant);
    const run = await begin(f);
    const none = await db.query<{ id: string | null }>(
      `select public.finish_vo_run($1, 'abstained', null, null, null, $2, 'reply-1', false, 300, null) as id`,
      [run.run_id, MODEL],
    );
    expect(none.rows[0].id).toBeNull();
    const result = await db.query<{ result: string; drafts: number }>(
      `select r.result, (select count(*)::int from public.vo_drafts d where d.run_id = r.id) as drafts from public.vo_runs r where r.id = $1`,
      [run.run_id],
    );
    expect(result.rows[0]).toEqual({ result: "abstained", drafts: 0 });
  });
});

describe("Ask Vo", () => {
  it("answers about one matter the asker can read, keeps no answer text, and cites only that matter's records", async () => {
    const f = await firm();
    const other = await firm();
    await turnOn(f);
    await staff(f, f.consultant);
    const run = await begin(f, "ask");
    expect(run.ok).toBe(true);
    const answer = (sources: unknown[]) =>
      db.query<{ id: string | null }>(`select public.finish_vo_run($1, 'answered', null, null, $2::jsonb, $3, 'ask-1', false, 300, null) as id`, [
        run.run_id,
        JSON.stringify(sources),
        MODEL,
      ]);
    // A conversation message is not an Ask Vo source, nor is another firm's matter.
    await expectDbError(() => answer([{ kind: "message", id: f.clientMessageId, label: "Message" }]), /outside this conversation/);
    await expectDbError(() => answer([{ kind: "matter", id: other.matterId, label: "Theirs" }]), /outside this matter/);
    // An Ask Vo run can't produce a draft for a client.
    await expectDbError(() => finish(run.run_id!, sourcesFor(f)), /say how the run ended/);
    const done = await answer([{ kind: "matter", id: f.matterId, label: "Synthetic matter" }]);
    expect(done.rows[0].id).toBeNull();
    const row = await db.query<{ result: string; source_count: number; drafts: number }>(
      `select result, source_count, (select count(*)::int from public.vo_drafts where run_id = $1) as drafts from public.vo_runs where id = $1`,
      [run.run_id],
    );
    expect(row.rows[0]).toEqual({ result: "answered", source_count: 1, drafts: 0 });
    // Staff not on the matter can't ask about it; the capability switch stops it.
    await staff(f, f.outsider);
    await expectDbError(() => begin(f, "ask"), /vo denied/);
    await staff(f, f.owner);
    await db.query(`select public.set_vo_settings($1, '{"staff_answers": false}'::jsonb)`, [f.orgId]);
    await staff(f, f.consultant);
    expect(await begin(f, "ask")).toEqual({ ok: false, error: "capability_off" });
    // Reply drafts are unaffected by the Ask Vo switch.
    expect((await begin(f)).ok).toBe(true);
  });
});
