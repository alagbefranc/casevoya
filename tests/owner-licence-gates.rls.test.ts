import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isLicensedMembership } from "@/lib/tenant/roles";
import { asMaintenance, asUser, asUserInternal, countOf, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

// A firm owner passes every licence-gated rule a licensed consultant passes. Since
// 20261019219000_owner_full_access.sql (decision 2026-10-19: owners are regulated consultants) that
// holds with or without a credential on file, exactly as for a licensed consultant; a blocked
// owner credential is still refused by the licence locks. Assistants are still refused.

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";

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

function collegeId() {
  return `R${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
}

async function as(userId: string, orgId: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
}

/** The user's claims without the authenticated role: for definer-only evidence and transitions. */
async function asInternal(userId: string, orgId: string) {
  await asUserInternal(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
}

async function createUser(label: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, email(label)],
  );
  return id;
}

async function activeMembership(orgId: string, userId: string, role: string, createdBy: string) {
  await asMaintenance(db);
  const inserted = await db.query<{ id: string }>(
    `insert into public.memberships (organization_id, user_id, role, status, accepted_at, created_by)
     values ($1, $2, $3::public.org_role, 'active', now(), $4)
     returning id`,
    [orgId, userId, role, createdBy],
  );
  return inserted.rows[0].id;
}

async function declareLicence(userId: string, orgId: string, membershipId: string) {
  await as(userId, orgId);
  const row = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membershipId, collegeId(), PROOF],
  );
  return row.rows[0].id;
}

async function recordCheck(
  ownerId: string,
  orgId: string,
  credentialId: string,
  fields: { suspended?: boolean; revoked?: boolean } = {},
) {
  await as(ownerId, orgId);
  await db.query(
    `select public.record_licence_check(
       $1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       true, $3, $4, false, null, $5, 'Synthetic reviewer note'
     )`,
    [credentialId, REGISTER, fields.suspended ?? false, fields.revoked ?? false, PROOF],
  );
}

type Firm = {
  orgId: string;
  owner: string;
  ownerMembership: string;
  ownerCredential: string | null;
  consultant: string;
  consultantMembership: string;
  consultantCredential: string;
  assistant: string;
  assistantMembership: string;
};

/** licence: declared (owner declared their own licence), none, or a blocked owner licence. */
async function firm(licence: "declared" | "verified" | "none" | "suspended" | "revoked"): Promise<Firm> {
  const owner = await createUser("owner");
  const consultant = await createUser("consultant");
  const assistant = await createUser("assistant");
  await as(owner, "");
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    slug(),
  ]);
  const orgId = created.rows[0].id;
  await asMaintenance(db);
  const ownerMembership = (
    await db.query<{ id: string }>(`select id from public.memberships where organization_id = $1 and user_id = $2`, [
      orgId,
      owner,
    ])
  ).rows[0].id;
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const assistantMembership = await activeMembership(orgId, assistant, "assistant", owner);
  const consultantCredential = await declareLicence(consultant, orgId, consultantMembership);
  await recordCheck(owner, orgId, consultantCredential);
  const ownerCredential = licence === "none" ? null : await declareLicence(owner, orgId, ownerMembership);
  if (ownerCredential && licence === "verified") await recordCheck(owner, orgId, ownerCredential);
  if (ownerCredential && licence === "suspended") await recordCheck(owner, orgId, ownerCredential, { suspended: true });
  if (ownerCredential && licence === "revoked") await recordCheck(owner, orgId, ownerCredential, { revoked: true });
  return {
    orgId,
    owner,
    ownerMembership,
    ownerCredential,
    consultant,
    consultantMembership,
    consultantCredential,
    assistant,
    assistantMembership,
  };
}

type Created = { ok: boolean; id?: string; blocked?: string };

/** create_engaged_matter as userId; a refusal comes back as ok false (raised or returned). */
async function openMatter(userId: string, orgId: string, consultantMembership: string): Promise<Created> {
  await as(userId, orgId);
  try {
    const created = await db.query<{ result: Created }>(
      `select public.create_engaged_matter('Synthetic matter', true, $1, null, null) as result`,
      [consultantMembership],
    );
    return created.rows[0].result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/licensed consultant|denied|licence blocks/.test(message)) throw error;
    return { ok: false };
  }
}

async function matterVersion(matterId: string) {
  await asMaintenance(db);
  const row = await db.query<{ version: number; stage: string }>(
    `select version, stage::text as stage from public.matters where id = $1`,
    [matterId],
  );
  return row.rows[0];
}

/** Walks a matter to ready_to_submit with stage evidence, as a staff member who may. */
async function walkToReady(userId: string, orgId: string, matterId: string) {
  const steps: Array<[string, string]> = [
    ["intake", "service_agreement"],
    ["evidence_collection", "questionnaire_assigned"],
    ["preparation", "facts_reviewed"],
    ["consultant_review", "draft_package"],
    ["client_confirmation", "client_review_package"],
    ["ready_to_submit", "submission_approvals"],
  ];
  for (const [to, kind] of steps) {
    const current = await matterVersion(matterId);
    await asInternal(userId, orgId);
    await db.query(
      `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
       values ($1, $2, $3::public.matter_stage_evidence_kind, 'Synthetic evidence')`,
      [orgId, matterId, kind],
    );
    await db.query(`select public.transition_matter_stage($1, $2::public.matter_stage, $3, 'Synthetic step')`, [
      matterId,
      to,
      current.version,
    ]);
  }
  return matterVersion(matterId);
}

/** Puts the assistant on the matter so its refusals come from the role gate, not from visibility. */
async function assignAssistant(ctx: Firm, matterId: string) {
  await asMaintenance(db);
  await db.query(
    `insert into public.matter_participants (organization_id, matter_id, membership_id, role)
     values ($1, $2, $3, 'assistant')`,
    [ctx.orgId, matterId, ctx.assistantMembership],
  );
}

async function isLicensed(membershipId: string) {
  await asMaintenance(db);
  const row = await db.query<{ licensed: boolean }>(`select app.membership_is_licensed($1) as licensed`, [membershipId]);
  return row.rows[0].licensed;
}

describe("app.membership_is_licensed", () => {
  it("counts every active licensed consultant and firm owner, nobody else", async () => {
    const declared = await firm("declared");
    expect(await isLicensed(declared.ownerMembership)).toBe(true);
    expect(await isLicensed(declared.consultantMembership)).toBe(true);
    expect(await isLicensed(declared.assistantMembership)).toBe(false);

    const verified = await firm("verified");
    expect(await isLicensed(verified.ownerMembership)).toBe(true);

    const none = await firm("none");
    expect(await isLicensed(none.ownerMembership)).toBe(true);

    // Like a licensed consultant, an owner stays licensed by role; a blocked credential is caught
    // by the existing licence locks (see the blocked-owner cases below).
    const suspended = await firm("suspended");
    expect(await isLicensed(suspended.ownerMembership)).toBe(true);
    const revoked = await firm("revoked");
    expect(await isLicensed(revoked.ownerMembership)).toBe(true);

    await asMaintenance(db);
    await db.query(`update public.memberships set status = 'suspended' where id = $1`, [declared.consultantMembership]);
    expect(await isLicensed(declared.consultantMembership)).toBe(false);
  });
});

describe("new matter and responsible consultant", () => {
  it("lets a solo owner with a declared licence be the responsible consultant", async () => {
    const ctx = await firm("declared");
    const created = await openMatter(ctx.owner, ctx.orgId, ctx.ownerMembership);
    expect(created.ok).toBe(true);
    await asMaintenance(db);
    const party = await db.query<{ n: number }>(
      `select count(*)::int as n from public.matter_participants
       where matter_id = $1 and membership_id = $2 and role = 'consultant'`,
      [created.id, ctx.ownerMembership],
    );
    expect(countOf(party.rows[0].n)).toBe(1);

    // A licensed consultant still works, and an assistant is still refused as the consultant.
    expect((await openMatter(ctx.owner, ctx.orgId, ctx.consultantMembership)).ok).toBe(true);
    expect((await openMatter(ctx.owner, ctx.orgId, ctx.assistantMembership)).ok).toBe(false);
    expect((await openMatter(ctx.assistant, ctx.orgId, ctx.ownerMembership)).ok).toBe(false);

    // Reassigning the responsible consultant to the licensed owner.
    const other = await openMatter(ctx.consultant, ctx.orgId, ctx.consultantMembership);
    await as(ctx.owner, ctx.orgId);
    const assigned = await db.query<{ version: number }>(
      `select public.assign_responsible_consultant($1, $2, 1) as version`,
      [other.id, ctx.ownerMembership],
    );
    expect(countOf(assigned.rows[0].version)).toBeGreaterThan(1);
    const current = await matterVersion(other.id as string);
    await as(ctx.owner, ctx.orgId);
    await expectDbError(
      () =>
        db.query(`select public.assign_responsible_consultant($1, $2, $3)`, [
          other.id,
          ctx.assistantMembership,
          current.version,
        ]),
      /active licensed consultant/,
    );
  });

  it("lets an owner without a credential be the consultant; refuses an owner whose licence is suspended or revoked", async () => {
    const none = await firm("none");
    expect((await openMatter(none.owner, none.orgId, none.ownerMembership)).ok).toBe(true);
    expect((await openMatter(none.owner, none.orgId, none.consultantMembership)).ok).toBe(true);

    for (const status of ["suspended", "revoked"] as const) {
      const blocked = await firm(status);
      expect((await openMatter(blocked.owner, blocked.orgId, blocked.ownerMembership)).ok).toBe(false);
      // The consultant can still open a matter, but not name the blocked owner.
      expect((await openMatter(blocked.consultant, blocked.orgId, blocked.ownerMembership)).ok).toBe(false);
      expect((await openMatter(blocked.consultant, blocked.orgId, blocked.consultantMembership)).ok).toBe(true);
    }
  });

  it("keeps a blocked consultant locked", async () => {
    const ctx = await firm("declared");
    await recordCheck(ctx.owner, ctx.orgId, ctx.consultantCredential, { suspended: true });
    const created = await openMatter(ctx.owner, ctx.orgId, ctx.consultantMembership);
    expect(created).toMatchObject({ ok: false, blocked: "licence" });
  });
});

describe("regulated matter actions", () => {
  it("lets an owner file and record an outcome with or without a credential; refuses blocked owners and assistants", async () => {
    const ctx = await firm("declared");
    const created = await openMatter(ctx.owner, ctx.orgId, ctx.ownerMembership);
    const matterId = created.id as string;
    const ready = await walkToReady(ctx.owner, ctx.orgId, matterId);
    expect(ready.stage).toBe("ready_to_submit");
    await assignAssistant(ctx, matterId);

    await as(ctx.assistant, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.override_matter_stage($1, 'submitted', $2, 'Assistant cannot file')`, [matterId, ready.version]),
      /denied|42501/,
    );
    await expectDbError(
      () => db.query(`select public.transition_matter_stage($1, 'submitted', $2, 'Assistant cannot file')`, [matterId, ready.version]),
      /permission denied/,
    );
    await asInternal(ctx.assistant, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.transition_matter_stage($1, 'submitted', $2, 'Assistant cannot file')`, [matterId, ready.version]),
      /licensed consultant/,
    );

    await as(ctx.owner, ctx.orgId);
    const filed = await db.query<{ result: { ok: boolean; permitted_role: string } }>(
      `select public.override_matter_stage($1, 'submitted', $2, 'Receipt not on file') as result`,
      [matterId, ready.version],
    );
    expect(filed.rows[0].result).toMatchObject({ ok: true, permitted_role: "licensed_consultant" });
    expect((await matterVersion(matterId)).stage).toBe("submitted");

    // Outcome: decision evidence, government status, then the licensed outcome.
    await asInternal(ctx.owner, ctx.orgId);
    await db.query(
      `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
       values ($1, $2, 'official_decision', 'Synthetic decision letter')`,
      [ctx.orgId, matterId],
    );
    let current = await matterVersion(matterId);
    await as(ctx.owner, ctx.orgId);
    await db.query(`select public.record_government_status($1, 'decision_evidence_on_file', $2, 'Letter on file')`, [
      matterId,
      current.version,
    ]);
    current = await matterVersion(matterId);
    await as(ctx.assistant, ctx.orgId);
    await expectDbError(
      () => db.query(`select public.record_matter_outcome($1, 'approved', $2, 'Assistant')`, [matterId, current.version]),
      /staff access denied/,
    );
    await as(ctx.owner, ctx.orgId);
    await db.query(`select public.record_matter_outcome($1, 'approved', $2, 'Letter says approved')`, [
      matterId,
      current.version,
    ]);
    await asMaintenance(db);
    const outcome = await db.query<{ outcome: string }>(`select outcome::text as outcome from public.matters where id = $1`, [
      matterId,
    ]);
    expect(outcome.rows[0].outcome).toBe("approved");

    // An owner without a credential files and records the outcome, as a licensed consultant would.
    const none = await firm("none");
    const noneMatter = (await openMatter(none.consultant, none.orgId, none.consultantMembership)).id as string;
    const noneReady = await walkToReady(none.consultant, none.orgId, noneMatter);
    await as(none.owner, none.orgId);
    const ownerFiled = await db.query<{ result: { ok: boolean; permitted_role: string } }>(
      `select public.override_matter_stage($1, 'submitted', $2, 'Receipt not on file') as result`,
      [noneMatter, noneReady.version],
    );
    expect(ownerFiled.rows[0].result).toMatchObject({ ok: true, permitted_role: "licensed_consultant" });
    await asInternal(none.owner, none.orgId);
    await db.query(
      `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
       values ($1, $2, 'official_decision', 'Synthetic decision letter')`,
      [none.orgId, noneMatter],
    );
    current = await matterVersion(noneMatter);
    await as(none.owner, none.orgId);
    await db.query(`select public.record_government_status($1, 'decision_evidence_on_file', $2, 'Letter on file')`, [
      noneMatter,
      current.version,
    ]);
    current = await matterVersion(noneMatter);
    await as(none.owner, none.orgId);
    await db.query(`select public.record_matter_outcome($1, 'approved', $2, 'Owner')`, [noneMatter, current.version]);

    // A suspended owner licence: the licence lock refuses, as for a suspended consultant. The
    // override reports (and audits) it as a licence block.
    const blocked = await firm("suspended");
    const blockedMatter = (await openMatter(blocked.consultant, blocked.orgId, blocked.consultantMembership)).id as string;
    const blockedReady = await walkToReady(blocked.consultant, blocked.orgId, blockedMatter);
    await as(blocked.owner, blocked.orgId);
    const blockedOverride = await db.query<{ result: { ok: boolean; blocked?: string } }>(
      `select public.override_matter_stage($1, 'submitted', $2, 'Suspended owner') as result`,
      [blockedMatter, blockedReady.version],
    );
    expect(blockedOverride.rows[0].result).toMatchObject({ ok: false, blocked: "licence" });
    await asInternal(blocked.owner, blocked.orgId);
    await expectDbError(
      () =>
        db.query(`select public.transition_matter_stage($1, 'submitted', $2, 'Suspended owner')`, [blockedMatter, blockedReady.version]),
      /licence blocks/,
    );
  });

  it("lets an owner confirm a legal date with or without a credential; refuses a revoked owner and an assistant", async () => {
    for (const licence of ["declared", "none", "revoked"] as const) {
      const ctx = await firm(licence);
      const matterId = (await openMatter(ctx.consultant, ctx.orgId, ctx.consultantMembership)).id as string;
      await as(ctx.consultant, ctx.orgId);
      const deadline = await db.query<{ id: string }>(
        `select public.record_deadline(
           $1, null, 'legal', 'Synthetic legal date', null, null, '2026-12-01', null,
           'America/Toronto', null, null, null, null, null
         ) as id`,
        [matterId],
      );
      const deadlineId = deadline.rows[0].id;
      await assignAssistant(ctx, matterId);
      // Past the licence gate, a legal date with no official source stays tentative.
      const pastGate = /stays tentative/;
      await as(ctx.owner, ctx.orgId);
      await expectDbError(
        () => db.query(`select public.confirm_deadline($1, 1)`, [deadlineId]),
        licence === "revoked" ? /licence blocks/ : pastGate,
      );
      await as(ctx.consultant, ctx.orgId);
      await expectDbError(() => db.query(`select public.confirm_deadline($1, 1)`, [deadlineId]), pastGate);
      await as(ctx.assistant, ctx.orgId);
      await expectDbError(() => db.query(`select public.confirm_deadline($1, 1)`, [deadlineId]), /staff access denied/);
    }
  });
});

describe("licensed publishing and approvals", () => {
  it("lets an owner publish intake, approve an agreement template, and approve a rule review with or without a credential", async () => {
    for (const licence of ["declared", "none"] as const) {
      const ctx = await firm(licence);

      // Intake publishing records the licensed reviewer membership.
      const publish = (userId: string) =>
        (async () => {
          await as(userId, ctx.orgId);
          return db.query<{ id: string }>(
            `select public.save_intake_template(
               $1, 'Synthetic intake', 'en-CA', 'unspecified', $2::jsonb, true, '2026-10-01', null
             ) as id`,
            [
              `intake_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
              JSON.stringify({ fields: [{ key: "arrived", type: "date", labels: { "en-CA": "Arrived" } }] }),
            ],
          );
        })();
      const template = await publish(ctx.owner);
      await asMaintenance(db);
      const row = await db.query<{ reviewer: string; status: string }>(
        `select reviewer_membership_id as reviewer, status::text as status from public.intake_templates where id = $1`,
        [template.rows[0].id],
      );
      expect(row.rows[0]).toEqual({ reviewer: ctx.ownerMembership, status: "published" });
      await expectDbError(() => publish(ctx.assistant), /staff access denied/);
      expect((await publish(ctx.consultant)).rows[0].id).toBeTruthy();

      // Agreement template approval records the licensed membership.
      await as(ctx.owner, ctx.orgId);
      const agreement = await db.query<{ id: string }>(
        `select public.create_agreement_template('service', 'Synthetic template', 'Synthetic body') as id`,
      );
      const templateId = agreement.rows[0].id;
      await as(ctx.assistant, ctx.orgId);
      await expectDbError(() => db.query(`select public.approve_agreement_template($1)`, [templateId]), /denied/);
      await as(ctx.owner, ctx.orgId);
      await db.query(`select public.approve_agreement_template($1)`, [templateId]);
      await asMaintenance(db);
      const approved = await db.query<{ status: string; approved_by: string }>(
        `select status::text as status, approved_by from public.agreement_templates where id = $1`,
        [templateId],
      );
      expect(approved.rows[0]).toEqual({ status: "approved", approved_by: ctx.ownerMembership });

      // An approved professional review needs a licensed reviewer membership; an owner is one.
      await as(ctx.owner, ctx.orgId);
      const definition = await db.query<{ id: string }>(
        `insert into public.rule_definitions (organization_id, stable_key, category, jurisdiction)
         values ($1, $2, 'immigration_requirement', 'CA') returning id`,
        [ctx.orgId, `CA.FICTIONAL.M${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`],
      );
      const version = await db.query<{ id: string }>(
        `insert into public.rule_versions (definition_id, version_number, claim)
         values ($1, 1, 'FICTIONAL fixture. Not an immigration requirement.') returning id`,
        [definition.rows[0].id],
      );
      const review = (membershipId: string) =>
        db.query(
          `insert into public.professional_reviews (
             organization_id, rule_version_id, reviewer_membership_id, decision, decided_at, rationale, rule_content_revision
           ) values ($1, $2, $3, 'approved', '2026-10-16T15:00:00Z', 'FICTIONAL review.', 1)`,
          [ctx.orgId, version.rows[0].id, membershipId],
        );
      // SRC-03: approvals are recorded only through Source review; a direct insert is refused. The
      // licence rule on the reviewer membership still applies (checked from a maintenance session).
      await as(ctx.owner, ctx.orgId);
      await expectDbError(() => review(ctx.ownerMembership), /only in Source review/);
      await asMaintenance(db);
      await review(ctx.ownerMembership);
      await review(ctx.consultantMembership);
    }
  });
});

describe("reassigning consultant matters", () => {
  it("moves matters to a verified licensed owner, and away from an owner whose licence is suspended", async () => {
    const ctx = await firm("verified");
    const created = await openMatter(ctx.consultant, ctx.orgId, ctx.consultantMembership);
    expect(created.ok).toBe(true);
    await as(ctx.owner, ctx.orgId);
    const moved = await db.query<{ moved: number }>(
      `select public.reassign_consultant_matters($1, $2, 'Owner takes over the practice') as moved`,
      [ctx.consultantMembership, ctx.ownerMembership],
    );
    expect(countOf(moved.rows[0].moved)).toBe(1);

    // A declared (unverified) owner licence is not a verified receiver.
    const declared = await firm("declared");
    await openMatter(declared.consultant, declared.orgId, declared.consultantMembership);
    await as(declared.owner, declared.orgId);
    await expectDbError(
      () =>
        db.query(`select public.reassign_consultant_matters($1, $2, 'Owner takes over the practice')`, [
          declared.consultantMembership,
          declared.ownerMembership,
        ]),
      /verified licence/,
    );
    // Client-facing authority moves only to a register-verified licence, for an owner as for a
    // consultant; an owner with no credential is not a receiver, nor a source.
    const none = await firm("none");
    await as(none.owner, none.orgId);
    await expectDbError(
      () =>
        db.query(`select public.reassign_consultant_matters($1, $2, 'Owner takes over the practice')`, [
          none.consultantMembership,
          none.ownerMembership,
        ]),
      /verified licence/,
    );
    await expectDbError(
      () =>
        db.query(`select public.reassign_consultant_matters($1, $2, 'Owner hands over the practice')`, [
          none.ownerMembership,
          none.consultantMembership,
        ]),
      /reassignment denied/,
    );

    // The owner opens a matter as consultant, then the licence is suspended: move it away.
    const solo = await firm("declared");
    const soloMatter = await openMatter(solo.owner, solo.orgId, solo.ownerMembership);
    expect(soloMatter.ok).toBe(true);
    await recordCheck(solo.owner, solo.orgId, solo.ownerCredential as string, { suspended: true });
    expect(await isLicensed(solo.ownerMembership)).toBe(true);
    await as(solo.owner, solo.orgId);
    const handed = await db.query<{ moved: number }>(
      `select public.reassign_consultant_matters($1, $2, 'Owner licence is suspended') as moved`,
      [solo.ownerMembership, solo.consultantMembership],
    );
    expect(countOf(handed.rows[0].moved)).toBe(1);
  });
});

describe("isLicensedMembership (app side)", () => {
  const clean = {
    status: "declared",
    discipline_revoked: false,
    discipline_suspended: false,
    register_status: null,
    entitlement_to_practise: null,
  };

  it("mirrors app.membership_is_licensed for an active membership: licensed consultants and owners by role", () => {
    expect(isLicensedMembership("licensed_consultant", null)).toBe(true);
    expect(isLicensedMembership("firm_owner", clean)).toBe(true);
    expect(isLicensedMembership("firm_owner", null)).toBe(true);
    // A blocked credential is refused by the database's licence locks, not by this check.
    expect(isLicensedMembership("firm_owner", { ...clean, status: "suspended" })).toBe(true);
    expect(isLicensedMembership("assistant", clean)).toBe(false);
    expect(isLicensedMembership("case_manager", clean)).toBe(false);
  });
});
