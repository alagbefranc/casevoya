import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asMaintenance, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { firmDay } from "./helpers/firm-day";

/**
 * GOV-04 against the real migrations: the firm's issuer list (official URL, date checked, licensed
 * review), and a letter recorded with its issuer, letter date and several tasks (staff and client).
 * Synthetic names only: no real issuer is named here.
 */
let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const OFFICIAL = "https://www.canada.ca/en/synthetic-page.html#synthetic-section";
const HASH = "b".repeat(64);

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${randomUUID().slice(0, 8)}@example.test`,
  ]);
  return id;
}

async function activeMembership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

const fresh = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
const stale = (userId: string, orgId: string) => asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 3600 });

async function firm() {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const manager = await createUser("manager");
  const client = await createUser("client");
  await fresh(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${randomUUID().replaceAll("-", "").slice(0, 12)}`,
  ]);
  const orgId = created.rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);

  await fresh(consultant, orgId);
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await fresh(owner, orgId);
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);

  await fresh(consultant, orgId);
  const matter = await db.query<{ result: { id: string } }>(`select public.create_client_matter($1, null, null, null, $2, null, null) as result`, [
    "Synthetic Applicant",
    consultantMembership,
  ]);
  const matterId = matter.rows[0].result.id;
  await asMaintenance(db);
  const party = await db.query<{ person_id: string }>(
    `select person_id from public.matter_participants where matter_id = $1 and person_id is not null limit 1`,
    [matterId],
  );
  const personId = party.rows[0].person_id;
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role, created_by) values ($1, $2, $3, 'case_manager', $4)`,
    [orgId, matterId, managerMembership, owner],
  );
  await db.query(`update public.persons set user_id = $1 where id = $2`, [client, personId]);
  await activeMembership(orgId, client, "client", owner);
  return { owner, consultant, manager, client, orgId, matterId, personId, consultantMembership, managerMembership };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function propose(ctx: Firm, name: string, read = true) {
  await stale(ctx.manager, ctx.orgId);
  const row = await db.query<{ id: string }>(
    `select public.propose_government_issuer($1, $2, $3, $4::date, $5::timestamptz, $6, $7::date, $8) as id`,
    read ? [ctx.orgId, name, OFFICIAL, firmDay(), new Date().toISOString(), HASH, "2026-09-01", true] : [ctx.orgId, name, OFFICIAL, firmDay(), null, null, null, null],
  );
  return row.rows[0].id;
}

async function approve(ctx: Firm, id: string) {
  await fresh(ctx.consultant, ctx.orgId);
  await db.query(`select public.review_government_issuer($1, 1, 'approved', null)`, [id]);
}

function record(ctx: Firm, issuerId: string | null, issuer: string | null, tasks: unknown) {
  return db.query<{ id: string }>(
    `select public.record_government_letter($1, 'request', $2, $3, 'portal_message', $4::date, $5::date,
       'Send two synthetic documents', null, null, $6::jsonb) as id`,
    [ctx.matterId, issuerId, issuer, firmDay(-4), firmDay(-2), JSON.stringify(tasks)],
  );
}

describe("GOV-04 issuer list", () => {
  it("takes an official URL and the date checked, and is offered only after a licensed review", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.propose_government_issuer($1, 'Synthetic Office', 'https://example.com/x', $2::date, null, null, null, null)`, [ctx.orgId, firmDay()]),
      /official Government of Canada page/,
    );
    await expectDbError(
      () => db.query(`select public.propose_government_issuer($1, 'Synthetic Office', $2, $3::date, null, null, null, null)`, [ctx.orgId, OFFICIAL, firmDay(1)]),
      /date checked/,
    );
    await expectDbError(
      () => db.query(`select public.propose_government_issuer($1, 'Synthetic Office', $2, $3::date, now(), null, null, null)`, [ctx.orgId, OFFICIAL, firmDay()]),
      /both its time and its hash/,
    );
    const id = await propose(ctx, "Synthetic Office");
    await expectDbError(() => propose(ctx, "synthetic office"), /already on the list/);

    // A page the server couldn't read keeps no hash, date modified or name check.
    const unread = await propose(ctx, "Synthetic Unread Office", false);
    await asMaintenance(db);
    const stored = await db.query<{ snapshot_sha256: string | null; page_modified_on: string | null; name_on_page: boolean | null; status: string }>(
      `select snapshot_sha256, page_modified_on::text, name_on_page, status from public.government_issuers where id = $1`,
      [unread],
    );
    expect(stored.rows[0]).toEqual({ snapshot_sha256: null, page_modified_on: null, name_on_page: null, status: "pending_review" });

    // A pending issuer can't name a letter.
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => record(ctx, id, null, []), /approved list/);

    // Review: a case manager can't; a licensed member needs a fresh step-up; rejecting needs a reason.
    await fresh(ctx.manager, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_government_issuer($1, 1, 'approved', null)`, [id]), /denied/);
    await stale(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_government_issuer($1, 1, 'approved', null)`, [id]), /step-up/);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_government_issuer($1, 1, 'rejected', null)`, [unread]), /say why/);
    await expectDbError(() => db.query(`select public.review_government_issuer($1, 7, 'approved', null)`, [id]), /version conflict/);
    await approve(ctx, id);
    await fresh(ctx.consultant, ctx.orgId);
    await expectDbError(() => db.query(`select public.review_government_issuer($1, 2, 'approved', null)`, [id]), /not waiting/);

    // Clients and other firms never read the list; staff of the firm do.
    await stale(ctx.client, ctx.orgId);
    expect((await db.query(`select id from public.government_issuers`)).rows).toHaveLength(0);
    const other = await firm();
    await stale(other.manager, other.orgId);
    expect((await db.query(`select id from public.government_issuers where id = $1`, [id])).rows).toHaveLength(0);
    await stale(ctx.manager, ctx.orgId);
    expect((await db.query(`select id from public.government_issuers`)).rows).toHaveLength(2);
    // No direct writes.
    await expectDbError(() => db.query(`update public.government_issuers set name = 'Changed' where id = $1`, [id]), /permission denied/);
  });
});

describe("GOV-04 a letter with its issuer, letter date and several tasks", () => {
  it("records the issuer with its source, both dates, and a staff and a client task linked to the letter", async () => {
    const ctx = await firm();
    const issuerId = await propose(ctx, "Synthetic Office");
    await approve(ctx, issuerId);

    await stale(ctx.manager, ctx.orgId);
    const tasks = [
      { title: "Synthetic staff follow-up", owner: "staff", owner_id: ctx.managerMembership, due_on: firmDay(5) },
      { title: "Synthetic client upload", owner: "client", owner_id: ctx.personId, due_on: firmDay(9) },
    ];
    const letterId = (await record(ctx, issuerId, "ignored when an issuer is chosen", tasks)).rows[0].id;

    await asMaintenance(db);
    const letter = await db.query<{ issuer: string; issuer_id: string; document_date: string; received_on: string }>(
      `select issuer, issuer_id, document_date::text, received_on::text from public.government_correspondence where id = $1`,
      [letterId],
    );
    expect(letter.rows[0]).toEqual({ issuer: "Synthetic Office", issuer_id: issuerId, document_date: firmDay(-4), received_on: firmDay(-2) });
    const linked = await db.query<{ title: string; audience: string; owner_membership_id: string | null; owner_person_id: string | null; due_on: string }>(
      `select task.title, task.audience::text, task.owner_membership_id, task.owner_person_id, task.due_on::text
       from public.correspondence_work_links link join public.tasks task on task.id = link.task_id
       where link.correspondence_id = $1 order by task.title`,
      [letterId],
    );
    // The request also opens the consultant's review task, as before.
    expect(linked.rows.map((row) => row.title)).toEqual(["Consultant review: government request received " + firmDay(-2), "Synthetic client upload", "Synthetic staff follow-up"]);
    expect(linked.rows[1]).toMatchObject({ audience: "client", owner_person_id: ctx.personId, owner_membership_id: null, due_on: firmDay(9) });
    expect(linked.rows[2]).toMatchObject({ audience: "internal", owner_membership_id: ctx.managerMembership, owner_person_id: null, due_on: firmDay(5) });

    // The client sees their task, not the staff one, and not the letter (it isn't shared).
    await stale(ctx.client, ctx.orgId);
    const mine = await db.query<{ title: string }>(`select title from public.tasks where matter_id = $1`, [ctx.matterId]);
    expect(mine.rows.map((row) => row.title)).toEqual(["Synthetic client upload"]);
    expect((await db.query(`select id from public.government_correspondence where id = $1`, [letterId])).rows).toHaveLength(0);

    // The issuer is pinned: it can't be swapped for another approved issuer afterwards.
    const second = await propose(ctx, "Synthetic Second Office");
    await approve(ctx, second);
    await asMaintenance(db);
    await expectDbError(
      () =>
        db.query(
          `do $$ begin
             perform app.gov_open_write('${letterId}');
             update public.government_correspondence set issuer_id = '${second}' where id = '${letterId}';
           end $$`,
        ),
      /not overwritten/,
    );
  });

  it("takes a typed issuer, and refuses a letter whose tasks are incomplete, in the past, or for someone off the matter", async () => {
    const ctx = await firm();
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => record(ctx, null, "  ", []), /who sent the letter/);
    const typed = (await record(ctx, null, "Synthetic typed issuer", [])).rows[0].id;
    await asMaintenance(db);
    expect((await db.query(`select issuer, issuer_id from public.government_correspondence where id = $1`, [typed])).rows[0]).toEqual({
      issuer: "Synthetic typed issuer",
      issuer_id: null,
    });

    const before = await db.query<{ n: number }>(`select count(*)::int as n from public.government_correspondence where matter_id = $1`, [ctx.matterId]);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => record(ctx, null, "Synthetic", [{ title: "No owner", owner: "staff", due_on: firmDay(2) }]), /needs an owner/);
    await expectDbError(() => record(ctx, null, "Synthetic", [{ title: "No date", owner: "staff", owner_id: ctx.managerMembership }]), /due date/);
    await expectDbError(
      () => record(ctx, null, "Synthetic", [{ title: "Past", owner: "staff", owner_id: ctx.managerMembership, due_on: firmDay(-1) }]),
      /in the past/,
    );
    const outsider = await firm();
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(
      () => record(ctx, null, "Synthetic", [{ title: "Wrong client", owner: "client", owner_id: outsider.personId, due_on: firmDay(2) }]),
      /client task needs a person on this matter/,
    );
    await expectDbError(
      () => record(ctx, null, "Synthetic", Array.from({ length: 11 }, () => ({ title: "Many", owner: "staff", owner_id: ctx.managerMembership, due_on: firmDay(2) }))),
      /at most 10/,
    );
    // Nothing was kept from a refused letter.
    await asMaintenance(db);
    const after = await db.query<{ n: number }>(`select count(*)::int as n from public.government_correspondence where matter_id = $1`, [ctx.matterId]);
    expect(after.rows[0].n).toBe(before.rows[0].n);

    // Another firm's approved issuer can't name this firm's letter.
    const theirs = await propose(outsider, "Synthetic Other Firm Office");
    await approve(outsider, theirs);
    await stale(ctx.manager, ctx.orgId);
    await expectDbError(() => record(ctx, theirs, null, []), /approved list/);
    // A client can't record letters.
    await stale(ctx.client, ctx.orgId);
    await expectDbError(() => record(ctx, null, "Synthetic", []), /denied/);
  });
});
