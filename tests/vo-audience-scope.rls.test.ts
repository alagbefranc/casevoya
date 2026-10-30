import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { VO_VENDOR_TERMS } from "@/modules/vo/vendor-terms";

/**
 * 20261031015000_vo_audience_scope_and_draft_guard.sql against the real migrations: a reply or
 * document-request draft cites only records its conversation's audience may see (VO-1), a cited
 * request needs the firm's category switch (VO-2), and a stored draft body passes the output
 * guard's key rules again with needs_rule derived from it (VO-5, VO-6). Synthetic records only.
 */
let db: TestDb;

const MODEL = "claude-opus-5-5";

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 12);

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [id, `${label}-${tag()}@example.test`]);
  return id;
}

async function membership(orgId: string, userId: string, role: string) {
  await asMaintenance(db);
  return (
    await db.query<{ id: string }>(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at) values ($1, $2, $3::public.org_role, 'active', now()) returning id`,
      [orgId, userId, role],
    )
  ).rows[0].id;
}

/** A firm with a consultant on a matter whose applicant and sponsor each write in their own conversation. */
async function firm() {
  const owner = await createUser("owner");
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const slug = `f${tag()}`;
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal Name", "Synthetic Firm", slug])).rows[0].id;
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  const matterId = (await db.query<{ id: string }>(`insert into public.matters (organization_id, title) values ($1, 'Synthetic matter') returning id`, [orgId])).rows[0].id;
  const consultant = await createUser("consultant");
  const consultantMembership = await membership(orgId, consultant, "licensed_consultant");
  await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'consultant')`, [orgId, matterId, consultantMembership]);
  const person = async (label: string, role: string) => {
    const userId = await createUser(label);
    await membership(orgId, userId, "client");
    await asMaintenance(db);
    const personId = (await db.query<{ id: string }>(`insert into public.persons (organization_id, user_id, display_name) values ($1, $2, $3) returning id`, [orgId, userId, `Synthetic ${label}`])).rows[0].id;
    await db.query(`insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, $4)`, [orgId, matterId, personId, role]);
    await asUser(db, { userId, aal: "aal1", orgId });
    const sent = (await db.query<{ r: { message_id: string; thread_id: string } }>(`select public.send_matter_message($1, $2, null, null, $3, false, null, null) as r`, [orgId, matterId, `Synthetic: a question from the ${label}.`])).rows[0].r;
    return { personId, threadId: sent.thread_id, messageId: sent.message_id };
  };
  const applicant = await person("applicant", "applicant");
  const sponsor = await person("sponsor", "sponsor");

  await asMaintenance(db);
  const request = async (personId: string, audience: string, sensitivity: string, purpose: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.document_requests (organization_id, matter_id, person_id, purpose, explanation, acceptable_formats, source, audience, sensitivity)
         values ($1, $2, $3, $4, 'Synthetic explanation.', array['pdf'], 'staff', $5::public.document_audience, $6::public.document_sensitivity) returning id`,
        [orgId, matterId, personId, purpose, audience, sensitivity],
      )
    ).rows[0].id;
  const requests = {
    applicant: await request(applicant.personId, "subject", "ordinary", "Applicant passport copy"),
    sponsor: await request(sponsor.personId, "subject", "ordinary", "Sponsor income proof"),
    sponsorMedical: await request(sponsor.personId, "subject", "medical", "Sponsor form"),
    sponsorStaff: await request(sponsor.personId, "staff", "ordinary", "Internal copy"),
  };
  const task = async (audience: "internal" | "client", ownerPersonId: string | null) =>
    (
      await db.query<{ id: string }>(
        `insert into public.tasks (organization_id, matter_id, person_id, title, audience, status, priority, owner_membership_id, owner_person_id)
         values ($1, $2, $3, 'Synthetic task', $4::public.task_audience, 'open', 'normal', $5, $6) returning id`,
        [orgId, matterId, ownerPersonId, audience, audience === "internal" ? consultantMembership : null, ownerPersonId],
      )
    ).rows[0].id;
  const tasks = { internal: await task("internal", null), applicant: await task("client", applicant.personId), sponsor: await task("client", sponsor.personId) };
  const deadline = async (kind: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.deadlines (organization_id, matter_id, kind, label, due_on, timezone) values ($1, $2, $3::public.deadline_kind, 'Synthetic deadline', '2026-12-01', 'America/Toronto') returning id`,
        [orgId, matterId, kind],
      )
    ).rows[0].id;
  const deadlines = { internal: await deadline("internal"), legal: await deadline("legal") };

  // The owner turns Vo on (vendor terms first).
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(`select public.acknowledge_vo_vendor_terms($1, $2)`, [orgId, VO_VENDOR_TERMS.version]);
  await db.query(`select public.set_vo_settings($1, $2::jsonb)`, [orgId, JSON.stringify({ enabled: true, reply_drafts: true, staff_answers: true, read_client_messages: true })]);
  return { orgId, slug, matterId, consultant, applicant, sponsor, requests, tasks, deadlines };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const staff = (f: Firm) => asUser(db, { userId: f.consultant, aal: "aal2", orgId: f.orgId, totpAgeSeconds: 60 });

async function begin(f: Firm, kind: "message_reply" | "document_request" | "ask", threadId: string | null) {
  await staff(f);
  const r = (await db.query<{ r: { ok: boolean; run_id?: string; error?: string } }>(`select public.begin_vo_run($1, $2::public.vo_run_kind, $3, $4) as r`, [f.orgId, kind, threadId, threadId ? null : f.matterId])).rows[0].r;
  expect(r).toMatchObject({ ok: true });
  return r.run_id!;
}

async function drafted(runId: string, body: string, sources: object[]) {
  return (
    await db.query<{ id: string }>(`select public.finish_vo_run($1, 'drafted', 'Explain document requests', $2, $3::jsonb, $4, 'docreq-2', false, 420, null) as id`, [
      runId,
      body,
      JSON.stringify(sources),
      MODEL,
    ])
  ).rows[0].id;
}

describe("VO-1: a conversation's draft cites only what its audience may see", () => {
  it("refuses the applicant's records and staff-only or internal ones in the sponsor's conversation, and saves the sponsor's own", async () => {
    const f = await firm();
    const run = await begin(f, "document_request", f.sponsor.threadId);
    const message = { kind: "message", id: f.sponsor.messageId, label: "Client message" };
    for (const source of [
      { kind: "document_request", id: f.requests.applicant, label: "Request: Applicant passport copy" },
      { kind: "document_request", id: f.requests.sponsorStaff, label: "Request: Internal copy" },
      { kind: "task", id: f.tasks.applicant, label: "Task" },
      { kind: "task", id: f.tasks.internal, label: "Task" },
      { kind: "deadline", id: f.deadlines.internal, label: "Deadline" },
    ]) {
      await expectDbError(() => drafted(run, "Please upload your documents in the portal.", [message, source]), /outside this conversation's audience/);
    }
    // VO-2: a medical request needs the firm's medical switch.
    await expectDbError(
      () => drafted(run, "Please upload your documents in the portal.", [message, { kind: "document_request", id: f.requests.sponsorMedical, label: "Request: Sponsor form" }]),
      /hasn't let Vo use this kind of record/,
    );
    const draftId = await drafted(run, "Please upload your income proof in the portal.", [
      message,
      { kind: "document_request", id: f.requests.sponsor, label: "Request: Sponsor income proof" },
      { kind: "task", id: f.tasks.sponsor, label: "Task" },
      { kind: "deadline", id: f.deadlines.legal, label: "Deadline" },
    ]);
    expect(draftId).toBeTruthy();

    // The applicant's own conversation may cite the applicant's request.
    const own = await begin(f, "message_reply", f.applicant.threadId);
    expect(
      await drafted(own, "Thanks, please upload your passport copy in the portal.", [
        { kind: "message", id: f.applicant.messageId, label: "Client message" },
        { kind: "document_request", id: f.requests.applicant, label: "Request: Applicant passport copy" },
      ]),
    ).toBeTruthy();
  });

  it("still lets staff-only Ask Vo cite any record of the matter", async () => {
    const f = await firm();
    const run = await begin(f, "ask", null);
    await db.query(`select public.finish_vo_run($1, 'answered', null, null, $2::jsonb, $3, 'ask-3', false, 300, null)`, [
      run,
      JSON.stringify([
        { kind: "document_request", id: f.requests.applicant, label: "Request" },
        { kind: "task", id: f.tasks.internal, label: "Task" },
        { kind: "deadline", id: f.deadlines.internal, label: "Deadline" },
      ]),
      MODEL,
    ]);
    await asMaintenance(db);
    expect((await db.query<{ result: string }>(`select result from public.vo_runs where id = $1`, [run])).rows[0].result).toBe("answered");
  });
});

describe("VO-5 / VO-6: a stored draft passes the output guard again", () => {
  it("refuses foreign links, contact details, amounts and durations, keeps the portal and the firm's booking page, and derives needs_rule", async () => {
    const f = await firm();
    const run = await begin(f, "message_reply", f.sponsor.threadId);
    const sources = [{ kind: "message", id: f.sponsor.messageId, label: "Client message" }];
    for (const body of [
      "Book at https://app.casevoya.ca/book/another-firm/consult.",
      "See https://app.casevoya.ca/embed/enquiry/another-firm",
      "Pay at https://evil.example/pay",
      "Write to someone@example.com.",
      "The fee is $1,085.",
      "It takes 12 months.",
    ]) {
      await expectDbError(() => drafted(run, body, sources), /must pass the output guard/);
    }
    const draftId = await drafted(run, `Upload in https://app.casevoya.ca/portal or book https://app.casevoya.ca/book/${f.slug}/consult. The fee is [needs a sourced rule].`, sources);
    await asMaintenance(db);
    const row = (await db.query<{ needs_rule: boolean }>(`select needs_rule from public.vo_drafts where id = $1`, [draftId])).rows[0];
    expect(row.needs_rule).toBe(true);
  });
});
