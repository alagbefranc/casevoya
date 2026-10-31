import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadOfficialClaims } from "../scripts/ops/load-official-claims.mjs";
import { asMaintenance, asUser, createTestDb, type TestDb } from "./helpers/postgres";

/**
 * Client two-step on public.portal_claim_sources and the access-grant branch of
 * app.can_read_document (20261102120003). A portal person with a verified second factor reaches
 * them only from a session that completed it; a person without a factor keeps working at aal1.
 * Synthetic records only; nothing here is an immigration rule.
 */
let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

const tag = () => randomUUID().replaceAll("-", "").slice(0, 10);
const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

async function user(label: string, verifiedFactor = false) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`, [
    id,
    `${label}-${tag()}@example.test`,
  ]);
  if (verifiedFactor) {
    await db.query(`insert into auth.mfa_factors (id, user_id, factor_type, status) values ($1, $2, 'totp', 'verified')`, [randomUUID(), id]);
  }
  return id;
}

/** A firm with a matter, an applicant without a factor (open), an applicant with one (guarded) and a grantee with one. */
async function firm() {
  const owner = await user("owner");
  const consultant = await user("consultant");
  const open = await user("open");
  const guarded = await user("guarded", true);
  const grantee = await user("grantee", true);
  await asUser(db, { userId: owner, aal: "aal2", totpAgeSeconds: 0 });
  const orgId = (await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, ["Synthetic Legal", "Synthetic Firm", `f${tag()}`])).rows[0].id;
  await asMaintenance(db);
  const consultantMembership = (await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, 'licensed_consultant', 'active', now(), $3) returning id`,
    [orgId, consultant, owner],
  )).rows[0].id;
  for (const client of [open, guarded, grantee]) {
    await db.query(
      `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by) values ($1, $2, 'client', 'active', now(), $3)`,
      [orgId, client, owner],
    );
  }
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [consultantMembership, `R${tag().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status, true, false, false, false, null, $3, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, PROOF],
  );
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const matterId = (await db.query<{ result: { id: string } }>(`select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`, [consultantMembership])).rows[0].result.id;
  await asMaintenance(db);
  const person = async (name: string, userId: string) =>
    (await db.query<{ id: string }>(`insert into public.persons (organization_id, display_name, is_sample, user_id) values ($1, $2, true, $3) returning id`, [orgId, name, userId])).rows[0].id;
  const openPerson = await person("Synthetic Open", open);
  const guardedPerson = await person("Synthetic Guarded", guarded);
  const granteePerson = await person("Synthetic Grantee", grantee);
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, person_id, role) values ($1, $2, $3, 'applicant'), ($1, $2, $4, 'sponsor')`,
    [orgId, matterId, openPerson, guardedPerson],
  );
  return { orgId, matterId, open, guarded, grantee, openPerson, guardedPerson, granteePerson };
}

type Firm = Awaited<ReturnType<typeof firm>>;

const asClient = (f: Firm, userId: string, aal: "aal1" | "aal2") =>
  asUser(db, { userId, aal, orgId: f.orgId, ...(aal === "aal2" ? { totpAgeSeconds: 30 } : {}) });

/** A live official claim with a captured page. */
async function officialClaim() {
  const key = `CA.SYNTH.${tag().toUpperCase()}`;
  const page = `https://www.canada.ca/en/immigration-refugees-citizenship/services/synthetic-${tag()}/page.html`;
  await asMaintenance(db);
  await loadOfficialClaims({
    query: async (sql: string) => (await db.query(sql)).rows,
    dryRun: false,
    files: [{
      name: "captured-claims.json",
      data: {
        pages: [{ url: page, publisher: "Immigration, Refugees and Citizenship Canada", title: "Synthetic", finalUrl: page, httpStatus: 200, retrievedAt: new Date().toISOString(), sha256: "c".repeat(64), modifiedOn: null, lastAmendedOn: null, currentTo: null }],
        claims: [{
          key, category: "program", program: "synthetic_program", jurisdiction: "CA",
          claim: "Synthetic claim as the page states it.", value: null, page,
          sourceUrl: `${page}#s1`, section: "Synthetic section",
          excerpt: "Synthetic excerpt that is long enough to compare.",
        }],
      },
    }],
  });
  const version = (await db.query<{ id: string }>(
    `select v.id from public.rule_definitions d join public.rule_versions v on v.definition_id = d.id and v.status = 'published' where d.stable_key = $1`,
    [key],
  )).rows[0].id;
  return { version, page };
}

describe("client two-step: portal claim sources", () => {
  it("returns a guarded client's open requests only at aal2; a client without a factor sees them at aal1", async () => {
    const f = await firm();
    const claim = await officialClaim();
    await asMaintenance(db);
    // Fixture shortcut: the matter has no pinned pack in this file.
    await db.exec(`alter table public.document_requests disable trigger document_requests_src_pinned_rule`);
    try {
      for (const personId of [f.guardedPerson, f.openPerson]) {
        await db.query(
          `insert into public.document_requests (organization_id, matter_id, person_id, purpose, explanation, acceptable_formats, source, rule_version_id, rule_item_key)
           values ($1, $2, $3, 'Synthetic item', 'Synthetic explanation', array['pdf'], 'rule', $4, 'synthetic_item')`,
          [f.orgId, f.matterId, personId, claim.version],
        );
      }
    } finally {
      await db.exec(`alter table public.document_requests enable trigger document_requests_src_pinned_rule`);
    }
    const sources = async () => (await db.query<{ r: { url: string }[] }>(`select public.portal_claim_sources() as r`)).rows[0].r;

    await asClient(f, f.guarded, "aal1");
    expect(await sources()).toEqual([]);
    await asClient(f, f.guarded, "aal2");
    expect((await sources()).map((row) => row.url)).toEqual([claim.page]);
    await asClient(f, f.open, "aal1");
    expect((await sources()).map((row) => row.url)).toEqual([claim.page]);
  });
});

describe("client two-step: documents read through an access grant", () => {
  it("a grantee with a verified factor reads the subject's document only at aal2", async () => {
    const f = await firm();
    await asClient(f, f.open, "aal1");
    const documentId = (await db.query<{ result: { document_id: string } }>(
      `select public.create_upload_intent($1, $2, 'letter.pdf', 40, 'Synthetic letter', 'ordinary', 'subject', null, null, null) as result`,
      [f.matterId, f.openPerson],
    )).rows[0].result.document_id;
    await asMaintenance(db);
    await db.query(
      `insert into public.access_grants (organization_id, grantee_person_id, subject_person_id, kind, purpose) values ($1, $2, $3, 'explicit', 'Synthetic explicit')`,
      [f.orgId, f.granteePerson, f.openPerson],
    );
    const canRead = async () => (await db.query<{ ok: boolean }>(`select app.can_read_document($1) as ok`, [documentId])).rows[0].ok;

    await asClient(f, f.grantee, "aal1");
    expect(await canRead()).toBe(false);
    await asClient(f, f.grantee, "aal2");
    expect(await canRead()).toBe(true);
    // The subject (no factor) still reads their own document at aal1.
    await asClient(f, f.open, "aal1");
    expect(await canRead()).toBe(true);
  });
});
