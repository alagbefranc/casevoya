import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadOfficialClaims, preparedClaims } from "../scripts/ops/load-official-claims.mjs";
import { asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";
import { serverCapture } from "./helpers/server-capture";

/**
 * Live official claims with firm-only licensed edits (#188, 20261025600100_src_live_claims.sql;
 * Francis's decisions 2026-10-25): the loader loads captured claims as live platform claims, only
 * in a database maintenance session; a licensed member's edit is an override for that firm only,
 * with a fresh step-up every time; a changed re-capture goes live and flags the firm's edit; Vo
 * cites the firm's wording with its stamp, refuses an overdue fee, and gets fee claims whatever
 * pack the matter has. Synthetic claims, URLs and hashes only.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await asMaintenance(db);
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);
const KEY = () => `CA.SYNTH.${tag().toUpperCase().replace(/^[0-9]/, "S")}`;
const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const query = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;

type Synthetic = {
  key?: string;
  category?: string;
  program?: string | null;
  claim?: string;
  value?: string | null;
  url?: string;
  section?: string;
  sha256?: string;
  retrievedAt?: string;
};

/** One synthetic capture file (the shape of captured-claims.json) with one claim per entry. */
function captureFile(entries: Synthetic[]) {
  const pages: Record<string, unknown>[] = [];
  const claims = entries.map((entry) => {
    const url = entry.url ?? `https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic-${tag()}/page.html#s1`;
    const page = url.split("#")[0];
    pages.push({
      url: page,
      publisher: "Immigration, Refugees and Citizenship Canada",
      title: "Synthetic page",
      finalUrl: page,
      httpStatus: 200,
      retrievedAt: entry.retrievedAt ?? new Date().toISOString(),
      sha256: entry.sha256 ?? "a".repeat(64),
      modifiedOn: null,
      lastAmendedOn: null,
      currentTo: null,
    });
    return {
      key: entry.key ?? KEY(),
      category: entry.category ?? "program",
      program: entry.program ?? null,
      jurisdiction: "CA",
      claim: entry.claim ?? "Synthetic claim as the page states it.",
      value: entry.value ?? null,
      page,
      sourceUrl: url,
      section: entry.section ?? "Synthetic section",
      excerpt: "Synthetic excerpt.",
    };
  });
  return [{ name: "captured-claims.json", data: { pages, claims } }];
}

async function load(entries: Synthetic[], dryRun = false) {
  await asMaintenance(db);
  return loadOfficialClaims({ query, files: captureFile(entries), dryRun });
}

async function definition(key: string) {
  await asMaintenance(db);
  return (await db.query<{ id: string }>(`select id from public.rule_definitions where organization_id is null and stable_key = $1`, [key])).rows[0]?.id;
}

async function versions(key: string) {
  await asMaintenance(db);
  return (
    await db.query<{ id: string; version_number: number; status: string; claim: string; origin: string }>(
      `select v.id, v.version_number, v.status::text as status, v.claim, v.origin::text as origin
       from public.rule_versions v join public.rule_definitions d on d.id = v.definition_id
       where d.organization_id is null and d.stable_key = $1 order by v.version_number`,
      [key],
    )
  ).rows;
}

async function user(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3::jsonb)`, [
    id,
    `${label}-${tag()}@example.test`,
    "{}",
  ]);
  return id;
}

/** Signed in with MFA; `stepUpAge` seconds since the step-up (null: none fresh). */
const as = (userId: string, orgId: string, stepUpAge: number | null = null) =>
  asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: stepUpAge ?? 3600 });

async function firm() {
  const owner = await user("owner");
  const consultant = await user("consultant");
  const manager = await user("manager");
  await as(owner, "", 0);
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  await asMaintenance(db);
  const add = async (userId: string, role: string) =>
    (
      await db.query<{ id: string }>(
        `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, $3::public.org_role, 'active', now(), $4) returning id`,
        [orgId, userId, role, owner],
      )
    ).rows[0].id;
  const consultantMembership = await add(consultant, "licensed_consultant");
  const managerMembership = await add(manager, "case_manager");
  await db.query(`update public.profiles set display_name = 'Synthetic Consultant' where id = $1`, [consultant]);
  const college = `R${tag().slice(0, 6).toUpperCase()}`;
  await as(consultant, orgId, 0);
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, college, PROOF],
  );
  await as(owner, orgId, 0);
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asMaintenance(db);
  return { orgId, owner, consultant, manager, consultantMembership, managerMembership, college };
}

type Firm = Awaited<ReturnType<typeof firm>>;

async function edit(f: Firm, defId: string, base: string, text: string, age = 0, action = "edit", value: string | null = null) {
  await as(f.consultant, f.orgId, age);
  return (await db.query<{ id: string }>(`select public.edit_rule_claim($1, $2, $3, $4, 'Synthetic reason for the firm', $5) as id`, [defId, base, text, value, action])).rows[0].id;
}

async function claimFor(userId: string, orgId: string, defId: string) {
  await as(userId, orgId);
  return (await db.query<{ claim: Record<string, unknown> }>(`select public.official_claim($1) as claim`, [defId])).rows[0].claim;
}

describe("the loader", () => {
  it("refuses to run outside a database maintenance session", async () => {
    await asServiceRole(db);
    await expect(loadOfficialClaims({ query, files: captureFile([{}]), dryRun: true })).rejects.toThrow(/maintenance session/);
    await expectDbError(() => db.query(`select app.load_official_claims('[]'::jsonb, true)`), /permission denied/);
    const f = await firm();
    await as(f.consultant, f.orgId, 0);
    await expect(loadOfficialClaims({ query, files: captureFile([{}]), dryRun: true })).rejects.toThrow(/maintenance session|permission denied/);
    await expectDbError(() => db.query(`select app.load_official_claim('{}'::jsonb, true)`), /permission denied/);
  });

  it("refuses the fee placeholder and homepage URLs, and counts them", async () => {
    const files = captureFile([
      { claim: "Fees: Error loading fee" },
      { url: "https://www.canada.ca/en.html#top" },
      { url: "https://www.canada.ca/en/immigration-refugees-citizenship.html#x" },
      { url: "https://example.com/en/synthetic/page.html#s1" },
      {},
    ]);
    const prepared = preparedClaims(files);
    expect(prepared.claims).toHaveLength(1);
    expect(prepared.refused.map((item) => item.reason)).toEqual([
      "the page's fee placeholder (“Error loading fee”) is not a claim",
      "A homepage is not evidence: give the exact page the claim is on.",
      "A homepage is not evidence: give the exact page the claim is on.",
      "The source must be an official Government of Canada page (canada.ca or a gc.ca site).",
    ]);
    // The database refuses them too, whoever builds the payload.
    await asMaintenance(db);
    const page = { url: "https://www.canada.ca/en.html", sha256: "b".repeat(64), retrieved_at: new Date().toISOString() };
    const homepage = (await db.query<{ r: string }>(`select app.load_official_claim($1::jsonb, false) as r`, [
      JSON.stringify({ key: KEY(), category: "program", claim: "Synthetic.", source_url: "https://www.canada.ca/en.html#top", section: "Top", page }),
    ])).rows[0].r;
    expect(homepage).toBe("refused: a homepage is not evidence");
    const placeholder = (await db.query<{ r: string }>(`select app.load_official_claim($1::jsonb, false) as r`, [
      JSON.stringify({ key: KEY(), category: "guide", claim: "Pay the fee: Error loading fee", source_url: "https://www.canada.ca/en/synthetic/a/b.html#c", page: { ...page, url: "https://www.canada.ca/en/synthetic/a/b.html" } }),
    ])).rows[0].r;
    expect(placeholder).toMatch(/^refused: the page's fee placeholder/);
  });

  it("dry run writes nothing; a load is live at once, idempotent, and a change supersedes", async () => {
    const key = KEY();
    const url = `https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic-${tag()}/fees.html#fee`;
    const first = await load([{ key, url, category: "fee", value: "$1.00 CAD", claim: "Synthetic fee: $1.00 CAD." }], true);
    expect(first.counts.fee).toMatchObject({ new: 1 });
    expect(await definition(key)).toBeUndefined();

    const loaded = await load([{ key, url, category: "fee", value: "$1.00 CAD", claim: "Synthetic fee: $1.00 CAD.", retrievedAt: new Date(Date.now() - 60_000).toISOString() }]);
    expect(loaded.counts.fee).toMatchObject({ new: 1 });
    let rows = await versions(key);
    expect(rows).toMatchObject([{ version_number: 1, status: "published", origin: "official_capture" }]);
    const live = (await db.query<{ live: boolean }>(`select app.rule_version_is_live($1) as live`, [rows[0].id])).rows[0].live;
    expect(live).toBe(true);
    // No review was recorded: an official capture goes live on load.
    expect(Number((await db.query<{ n: string }>(`select count(*) as n from public.professional_reviews where rule_version_id = $1`, [rows[0].id])).rows[0].n)).toBe(0);

    // Unchanged: a successful check, nothing else.
    const before = (await db.query<{ at: string }>(`select src.last_checked_at as at from public.official_sources src where src.organization_id is null and src.canonical_url = $1`, [url.split("#")[0]])).rows[0].at;
    const again = await load([{ key, url, category: "fee", value: "$1.00 CAD", claim: "Synthetic fee: $1.00 CAD." }]);
    expect(again.counts.fee).toMatchObject({ unchanged: 1, new: 0, changed: 0 });
    expect(await versions(key)).toHaveLength(1);
    const after = (await db.query<{ at: string; attempts: string }>(
      `select src.last_checked_at as at, (select count(*) from public.source_check_attempts a where a.source_id = src.id and a.result = 'unchanged') as attempts
       from public.official_sources src where src.organization_id is null and src.canonical_url = $1`,
      [url.split("#")[0]],
    )).rows[0];
    expect(new Date(after.at).getTime()).toBeGreaterThan(new Date(before).getTime());
    expect(Number(after.attempts)).toBe(1);

    // Changed page hash: a new version goes live and the old one is superseded, its text unchanged.
    const changed = await load([{ key, url, category: "fee", value: "$2.00 CAD", claim: "Synthetic fee: $2.00 CAD.", sha256: "c".repeat(64) }]);
    expect(changed.counts.fee).toMatchObject({ changed: 1 });
    rows = await versions(key);
    expect(rows).toMatchObject([
      { version_number: 1, status: "superseded", claim: "Synthetic fee: $1.00 CAD." },
      { version_number: 2, status: "published", claim: "Synthetic fee: $2.00 CAD." },
    ]);
  });

  it("leaves a suspended claim suspended", async () => {
    const key = KEY();
    await load([{ key }]);
    const [row] = await versions(key);
    await asMaintenance(db);
    await db.query(`update public.rule_versions set status = 'suspended', status_reason = 'Synthetic suspension' where id = $1`, [row.id]);
    const reload = await load([{ key, claim: "Synthetic: the page now says something else.", sha256: "d".repeat(64) }]);
    expect(reload.counts.program).toMatchObject({ suspended: 1, changed: 0 });
    expect(await versions(key)).toMatchObject([{ status: "suspended" }]);
  });

  it("an official capture can't be created or published by the app, the service role or a member", async () => {
    const key = KEY();
    await load([{ key }]);
    const [row] = await versions(key);
    const defId = (await definition(key)) as string;
    await asServiceRole(db);
    await expectDbError(
      () => db.query(`insert into public.rule_versions (definition_id, version_number, claim, status, origin) values ($1, 9, 'Forged', 'draft', 'official_capture')`, [defId]),
      /maintenance session|row-level security|permission denied/,
    );
    await expectDbError(() => db.query(`update public.rule_versions set status = 'suspended' where id = $1`, [row.id]), /loader runs|row-level security|permission denied/);
  });
});

describe("firm edits", () => {
  async function liveClaim(claim = "Synthetic: applicants give the listed document.") {
    const key = KEY();
    await load([{ key, claim, category: "checklist", program: "synthetic_program" }]);
    const defId = (await definition(key)) as string;
    const [row] = await versions(key);
    return { key, defId, base: row.id };
  }

  it("refuses a case manager, a licensed member without a fresh step-up, and the service role", async () => {
    const f = await firm();
    const c = await liveClaim();
    await as(f.manager, f.orgId, 0);
    await expectDbError(() => db.query(`select public.edit_rule_claim($1, $2, 'Firm wording.', null, 'Synthetic reason', 'edit')`, [c.defId, c.base]), /staff access denied/);
    await as(f.consultant, f.orgId, null);
    await expectDbError(() => db.query(`select public.edit_rule_claim($1, $2, 'Firm wording.', null, 'Synthetic reason', 'edit')`, [c.defId, c.base]), /step-up is required/);
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.edit_rule_claim($1, $2, 'Firm wording.', null, 'Synthetic reason', 'edit')`, [c.defId, c.base]), /permission denied/);
    // Direct writes to the table: no grants, and the guard refuses even the owner.
    await expectDbError(
      () =>
        db.query(
          `insert into public.rule_claim_overrides (organization_id, definition_id, base_version_id, action, claim_text, reason, editor_membership_id, editor_name, editor_licence_id, editor_licence_number, step_up_at)
           values ($1, $2, $3, 'edit', 'Forged', 'Forged reason', $4, 'X', $4, 'R1', now())`,
          [f.orgId, c.defId, c.base, f.consultantMembership],
        ),
      /permission denied/,
    );
    await as(f.consultant, f.orgId, 0);
    await expectDbError(
      () =>
        db.query(
          `insert into public.rule_claim_overrides (organization_id, definition_id, base_version_id, action, claim_text, reason, editor_membership_id, editor_name, editor_licence_id, editor_licence_number, step_up_at)
           values ($1, $2, $3, 'edit', 'Forged', 'Forged reason', $4, 'X', $4, 'R1', now())`,
          [f.orgId, c.defId, c.base, f.consultantMembership],
        ),
      /permission denied/,
    );
    await asMaintenance(db);
    await expectDbError(
      () =>
        db.query(
          `insert into public.rule_claim_overrides (organization_id, definition_id, base_version_id, action, claim_text, reason, editor_membership_id, editor_name, editor_licence_id, editor_licence_number, step_up_at)
           values ($1, $2, $3, 'edit', 'Forged', 'Forged reason', $4, 'X', $4, 'R1', now())`,
          [f.orgId, c.defId, c.base, f.consultantMembership],
        ),
      /edited only through Edit/,
    );
  });

  it("refuses an edit from a member whose licence isn't on file, so the stamp always has a number", async () => {
    const f = await firm();
    const c = await liveClaim();
    // The firm owner has no licence record (only the consultant declared one).
    await as(f.owner, f.orgId, 0);
    await expectDbError(
      () => db.query(`select public.edit_rule_claim($1, $2, 'Firm wording.', null, 'Synthetic reason', 'edit')`, [c.defId, c.base]),
      /licence isn't recorded/,
    );
    await asMaintenance(db);
    const rows = await db.query(`select 1 from public.rule_claim_overrides where organization_id = $1`, [f.orgId]);
    expect(rows.rows).toHaveLength(0);
  });

  it("a licensed edit with a step-up is that firm's only; every change needs a fresh step-up; history keeps everything", async () => {
    const f = await firm();
    const other = await firm();
    const c = await liveClaim("Synthetic: the official wording.");
    const id = await edit(f, c.defId, c.base, "Synthetic: the firm's wording.", 0);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const mine = await claimFor(f.manager, f.orgId, c.defId);
    expect(mine).toMatchObject({ claim: "Synthetic: the firm's wording.", official_claim: "Synthetic: the official wording.", source_changed: false });
    expect(mine.edit).toMatchObject({ editor: "Synthetic Consultant", licence_number: f.college, reason: "Synthetic reason for the firm" });
    const theirs = await claimFor(other.manager, other.orgId, c.defId);
    expect(theirs).toMatchObject({ claim: "Synthetic: the official wording.", edit: null });

    // The same step-up can't be used twice: sign in again carrying the very step-up the edit used
    // (its amr timestamp, read back from the edit), not "a step-up now", which is a new one as
    // soon as the clock passes a second.
    await asMaintenance(db);
    const used = (await db.query<{ at: string }>(`select extract(epoch from step_up_at)::bigint as at from public.rule_claim_overrides where id = $1`, [id])).rows[0].at;
    await as(f.consultant, f.orgId, 0);
    await db.query(
      `select set_config('request.jwt.claims',
         jsonb_set(current_setting('request.jwt.claims')::jsonb, '{amr}', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', $1::bigint)))::text,
         false)`,
      [used],
    );
    await expectDbError(
      () => db.query(`select public.edit_rule_claim($1, $2, 'Synthetic: again.', null, 'Synthetic reason', 'edit')`, [c.defId, c.base]),
      /fresh step-up/,
    );
    // A fresh one works; a revert is a stamped step-up edit too.
    await edit(f, c.defId, c.base, "", 5, "revert");
    expect(await claimFor(f.manager, f.orgId, c.defId)).toMatchObject({ claim: "Synthetic: the official wording.", edit: null });

    // The captured version is unchanged; history lists the capture and the edits in order.
    const [row] = await versions(c.key);
    expect(row.claim).toBe("Synthetic: the official wording.");
    await as(f.manager, f.orgId);
    const history = (await db.query<{ h: { kind: string; editor?: string; licence_number?: string }[] }>(`select public.rule_claim_history($1) as h`, [c.defId])).rows[0].h;
    expect(history.map((entry) => entry.kind)).toEqual(["capture", "edit", "revert"]);
    expect(history[1]).toMatchObject({ editor: "Synthetic Consultant", licence_number: f.college });
    // Another firm's history shows none of it.
    await as(other.manager, other.orgId);
    const theirsHistory = (await db.query<{ h: { kind: string }[] }>(`select public.rule_claim_history($1) as h`, [c.defId])).rows[0].h;
    expect(theirsHistory.map((entry) => entry.kind)).toEqual(["capture"]);

    await asMaintenance(db);
    const audit = (await db.query<{ action: string }>(`select action from public.audit_log where organization_id = $1 and action like 'rule.claim_%' order by occurred_at`, [f.orgId])).rows;
    expect(audit.map((row) => row.action)).toEqual(["rule.claim_edited", "rule.claim_reverted"]);
    // Nothing updates or deletes an edit.
    await expectDbError(() => db.query(`update public.rule_claim_overrides set reason = 'Changed later' where id = $1`, [id]), /kept as they were made/);
    await expectDbError(() => db.query(`delete from public.rule_claim_overrides where id = $1`, [id]), /kept as they were made/);
  });

  it("refuses a stale base version and a claim that isn't live", async () => {
    const f = await firm();
    const c = await liveClaim();
    await load([{ key: c.key, claim: "Synthetic: re-captured wording.", category: "checklist", program: "synthetic_program", sha256: "e".repeat(64) }]);
    await as(f.consultant, f.orgId, 0);
    await expectDbError(() => db.query(`select public.edit_rule_claim($1, $2, 'Firm wording.', null, 'Synthetic reason', 'edit')`, [c.defId, c.base]), /version conflict/);
  });

  it("a changed re-capture goes live, keeps the firm's edit and flags it", async () => {
    const f = await firm();
    const c = await liveClaim("Synthetic: first official wording.");
    await edit(f, c.defId, c.base, "Synthetic: the firm's wording.", 0);
    await load([{ key: c.key, claim: "Synthetic: second official wording.", category: "checklist", program: "synthetic_program", sha256: "f".repeat(64) }]);
    const seen = await claimFor(f.manager, f.orgId, c.defId);
    expect(seen).toMatchObject({ claim: "Synthetic: the firm's wording.", official_claim: "Synthetic: second official wording.", source_changed: true });
    // Keeping the edit (saved again on the new version) clears the flag.
    const live = seen.version_id as string;
    await edit(f, c.defId, live, "Synthetic: the firm's wording.", 7);
    expect(await claimFor(f.manager, f.orgId, c.defId)).toMatchObject({ source_changed: false });
    await as(f.manager, f.orgId);
    const history = (await db.query<{ h: { kind: string }[] }>(`select public.rule_claim_history($1) as h`, [c.defId])).rows[0].h;
    expect(history.map((entry) => entry.kind)).toEqual(["capture", "edit", "recapture", "edit"]);
  });
});

describe("unsuspend", () => {
  it("a suspended firm claim stays suspended until a licensed member unsuspends it with a fresh step-up", async () => {
    const f = await firm();
    await as(f.manager, f.orgId);
    const page = "https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic/page.html#s1";
    const captured = await serverCapture(db, { orgId: f.orgId, url: page, snapshot: { sha256: "1".repeat(64) } });
    const id = (await db.query<{ id: string }>(
      `select public.add_rule_claim($1, null, 'CA', 'synthetic_program', 'Synthetic claim.', null, $2, null, 'Synthetic excerpt.', null, null, null, null, null, null, null, null, null, (now() at time zone 'America/Toronto')::date, $3::jsonb) as id`,
      [f.orgId, page, JSON.stringify(captured)],
    )).rows[0].id;
    const v = async () => {
      await asMaintenance(db);
      return (await db.query<{ version: number; status: string }>(`select version, status::text as status from public.rule_versions where id = $1`, [id])).rows[0];
    };
    const waiting = await v();
    await as(f.consultant, f.orgId);
    await db.query(`select public.resolve_rule_applicability($1, $2, 'applies', 'Synthetic: applies to everyone in the program.')`, [id, waiting.version]);
    await as(f.consultant, f.orgId, 0);
    await db.query(`select public.review_rule_version($1, (select version from public.rule_versions where id = $1), 'approved', null, (now() + interval '30 days')::date, null)`, [id]);
    await as(f.consultant, f.orgId);
    await db.query(`select public.suspend_rule_version($1, (select version from public.rule_versions where id = $1), 'Synthetic suspension')`, [id]);
    expect((await v()).status).toBe("suspended");
    await as(f.consultant, f.orgId, null);
    await expectDbError(() => db.query(`select public.unsuspend_rule_version($1, (select version from public.rule_versions where id = $1), 'Synthetic: checked again')`, [id]), /step-up is required/);
    await as(f.manager, f.orgId, 0);
    await expectDbError(() => db.query(`select public.unsuspend_rule_version($1, (select version from public.rule_versions where id = $1), 'Synthetic: checked again')`, [id]), /staff access denied/);
    await as(f.consultant, f.orgId, 3);
    await db.query(`select public.unsuspend_rule_version($1, (select version from public.rule_versions where id = $1), 'Synthetic: checked again')`, [id]);
    expect((await v()).status).toBe("published");
    await asMaintenance(db);
    const audit = (await db.query<{ context: Record<string, unknown> }>(`select context from public.audit_log where object_id = $1 and action = 'rule.version_unsuspended'`, [id])).rows;
    expect(audit[0].context).toMatchObject({ reason: "Synthetic: checked again" });
  });
});

describe("Vo", () => {
  async function voFirm() {
    const f = await firm();
    await asMaintenance(db);
    await db.query(`update public.organizations set sample_mode = true where id = $1`, [f.orgId]);
    await as(f.consultant, f.orgId);
    const matterId = (await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [f.consultantMembership])).rows[0].result.id;
    await asMaintenance(db);
    await db.query(`insert into public.matter_participants (organization_id, matter_id, membership_id, role) values ($1, $2, $3, 'case_manager')`, [f.orgId, matterId, f.managerMembership]);
    return { ...f, matterId };
  }
  async function ask(f: Awaited<ReturnType<typeof voFirm>>) {
    await as(f.manager, f.orgId);
    const r = (await db.query<{ r: { ok: boolean; run_id: string } }>(`select public.begin_vo_run($1, 'ask', null, $2) as r`, [f.orgId, f.matterId])).rows[0].r;
    expect(r.ok).toBe(true);
    return r.run_id;
  }
  const FEE_URL = () => `https://ircc.canada.ca/english/information/synthetic-${tag()}/fees.asp#temporary`;

  it("cites a CA.FEES.* claim without a pinned pack, labelled with its program, and a firm edit with its stamp", async () => {
    const f = await voFirm();
    const key = `CA.FEES.SYNTH_${tag().toUpperCase()}`;
    await load([{ key, url: FEE_URL(), category: "fee", program: "synthetic_program", claim: "Synthetic fee row: $9.00 CAD.", value: "$9.00 CAD" }]);
    const defId = (await definition(key)) as string;
    const [row] = await versions(key);
    let run = await ask(f);
    let content = (await db.query<{ c: Record<string, unknown>[] }>(`select public.vo_run_official_content($1) as c`, [run])).rows[0].c;
    const cited = content.find((item) => item.id === row.id);
    expect(cited).toMatchObject({ label: `${key} (synthetic_program)`, content: "Synthetic fee row: $9.00 CAD.", attested: false });
    expect(cited?.edited).toBeUndefined();

    await edit(f, defId, row.id, "Synthetic fee row as the firm words it: $9.00 CAD.", 0);
    run = await ask(f);
    content = (await db.query<{ c: Record<string, unknown>[] }>(`select public.vo_run_official_content($1) as c`, [run])).rows[0].c;
    expect(content.find((item) => item.id === row.id)).toMatchObject({
      content: "Synthetic fee row as the firm words it: $9.00 CAD.",
      edited: true,
      edited_by: "Synthetic Consultant",
      edited_licence: f.college,
    });
    await db.query(`select public.finish_vo_run($1, 'answered', null, null, $2::jsonb, 'vo-test-model', 'ask-2', false, 300, null)`, [
      run,
      JSON.stringify([{ kind: "official", id: row.id, label: "Synthetic fee", source_kind: "rule_version" }]),
    ]);
    await asMaintenance(db);
    const citations = (await db.query<{ c: Record<string, unknown>[] }>(`select citations as c from public.vo_runs where id = $1`, [run])).rows[0].c;
    expect(citations[0]).toMatchObject({ kind: "official", edited: true, edited_by: "Synthetic Consultant", edited_licence: f.college });
  });

  it("won't cite a fee whose source is overdue for a re-check, and says why", async () => {
    const f = await voFirm();
    const key = `CA.FEES.SYNTH_${tag().toUpperCase()}`;
    await load([{ key, url: FEE_URL(), category: "fee", claim: "Synthetic old fee row: $3.00 CAD.", value: "$3.00 CAD", retrievedAt: new Date(Date.now() - 10 * 86_400_000).toISOString() }]);
    const [row] = await versions(key);
    const run = await ask(f);
    const content = (await db.query<{ c: Record<string, unknown>[] }>(`select public.vo_run_official_content($1) as c`, [run])).rows[0].c;
    const item = content.find((entry) => entry.id === row.id);
    expect(item).toMatchObject({ stale: true, citable: false });
    expect(String(item?.stale_reason)).toMatch(/^The source for this was last checked \d{1,2} [A-Z][a-z]+ \d{4} and is due for a re-check$/);
    await expectDbError(
      () =>
        db.query(`select public.finish_vo_run($1, 'answered', null, null, $2::jsonb, 'vo-test-model', 'ask-2', false, 300, null)`, [
          run,
          JSON.stringify([{ kind: "official", id: row.id, label: "Synthetic fee", source_kind: "rule_version" }]),
        ]),
      /not approved official content/,
    );
  });
});

describe("the support catalogue", () => {
  it("counts a program with live official form or checklist claims, and flags an overdue source", async () => {
    const program = `synthetic_${tag()}`;
    await load([{ category: "form", program, retrievedAt: new Date(Date.now() - 20 * 86_400_000).toISOString() }]);
    await asMaintenance(db);
    const catalogue = (await db.query<{ c: { programs: Record<string, unknown>[] } }>(`select public.support_catalogue(null) as c`)).rows[0].c;
    expect(catalogue.programs.find((row) => row.key === program)).toMatchObject({ supported: true, official_claims: 1, stale: true });
  });

  // #272 item 6: such a program (no catalogue entry, no rule pack) was offered in New matter as
  // "v?" and then refused with "choose a program from the support catalogue".
  it("opens a matter for a program listed only through live official claims, with no rule pack", async () => {
    const program = `synthetic_${tag()}`;
    await load([{ category: "checklist", program }]);
    const f = await firm();
    await as(f.owner, f.orgId, 0);
    const created = (
      await db.query<{ r: Record<string, unknown> }>(
        `select public.create_client_matter_for_program('Synthetic Applicant', null, null, null, $1, $2) as r`,
        [f.consultantMembership, program],
      )
    ).rows[0].r;
    expect(created).toMatchObject({ ok: true, program_key: program, rule_pack_version_id: null });
    // A program the catalogue doesn't list at all is still refused.
    await expectDbError(
      () => db.query(`select public.create_client_matter_for_program('Synthetic Applicant', null, null, null, $1, $2)`, [f.consultantMembership, `synthetic_unknown_${tag()}`]),
      /choose a program from the support catalogue/,
    );
  });
});
