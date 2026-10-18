import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asMaintenance,
  asUser,
  countOf,
  createTestDb,
  expectDbError,
  type TestDb,
} from "./helpers/postgres";

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const RCIC_SEARCH = "https://register.college-ic.ca/Public-Register-EN/RCIC_Search.aspx";
const PROOF = "proof/synthetic-register-capture";

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

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

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(
    `select (public.create_organization($1, $2, $3)).id as id`,
    ["Synthetic Legal Name", "Synthetic Firm", slug()],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new Error("organization was not created");
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

async function declareLicence(userId: string, orgId: string, membershipId: string, collegeId: string, licenceType = "RCIC") {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const row = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, $2::public.licence_type, $3, 'Synthetic scope', $4) as id`,
    [membershipId, licenceType, collegeId, PROOF],
  );
  return row.rows[0].id;
}

async function recordCheck(
  userId: string,
  orgId: string,
  credentialId: string,
  fields: {
    url?: string;
    registerStatus?: "active" | "inactive";
    entitlement?: boolean;
    suspended?: boolean;
    revoked?: boolean;
    restricted?: boolean;
    restrictionDetail?: string;
  } = {},
) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const restricted = fields.restricted ?? false;
  const row = await db.query<{ id: string }>(
    `select public.record_licence_check(
       $1, $2, statement_timestamp(), $3::public.register_licence_status,
       $4, $5, $6, $7, $8, $9, 'Synthetic reviewer note'
     ) as id`,
    [
      credentialId,
      fields.url ?? REGISTER,
      fields.registerStatus ?? "active",
      fields.entitlement ?? true,
      fields.suspended ?? false,
      fields.revoked ?? false,
      restricted,
      restricted ? (fields.restrictionDetail ?? "Synthetic restriction copied from the register profile") : null,
      PROOF,
    ],
  );
  return row.rows[0].id;
}

describe("practice foreign-key indexes", () => {
  it("covers the unindexed foreign keys without a partial actor index", async () => {
    const names = [
      "matter_stage_evidence_org_fk_idx",
      "matter_stage_evidence_matter_org_fk_idx",
      "matter_stage_transitions_org_fk_idx",
      "matter_stage_transitions_matter_org_fk_idx",
      "matter_stage_transitions_evidence_org_fk_idx",
      "person_break_glass_org_fk_idx",
      "person_break_glass_person_org_fk_idx",
      "person_break_glass_actor_user_fk_idx",
      "session_revocations_revoked_by_fk_idx",
      "session_revocations_org_fk_idx",
    ];
    const found = await db.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where indexname = any($1::text[])`,
      [names],
    );
    expect(found.rows.map((row) => row.indexname).sort()).toEqual([...names].sort());
    const actor = found.rows.find((row) => row.indexname === "person_break_glass_actor_user_fk_idx");
    expect(actor?.indexdef.toLowerCase()).not.toContain("where");
  });
});

describe("CICC register catalog", () => {
  it("allowlists the register host and stores the 2026-10-17 entry pages", async () => {
    const allowed = await db.query<{ ok: boolean }>(
      `select app.host_is_allowlisted('register.college-ic.ca') as ok`,
    );
    expect(allowed.rows[0].ok).toBe(true);
    const host = await db.query<{ host: string | null }>(
      `select app.cicc_register_host($1) as host`,
      [REGISTER],
    );
    expect(host.rows[0].host).toBe("register.college-ic.ca");
    const other = await db.query<{ host: string | null }>(
      `select app.cicc_register_host('https://www.college-ic.ca/') as host`,
    );
    expect(other.rows[0].host).toBeNull();

    const pages = await db.query<{ canonical_url: string; checked: string; content_hash: string }>(
      `select source.canonical_url,
              source.last_checked_at::text as checked,
              snap.content_hash
       from public.official_sources source
       join public.source_snapshots snap on snap.source_id = source.id
       where source.organization_id is null
         and source.canonical_url like 'https://register.college-ic.ca/%'
       order by source.canonical_url`,
    );
    expect(pages.rows.map((row) => row.canonical_url)).toEqual([RCIC_SEARCH, REGISTER].sort());
    expect(pages.rows.every((row) => row.checked.startsWith("2026-10-17"))).toBe(true);
    expect(pages.rows.map((row) => row.content_hash).sort()).toEqual(
      [
        "6f67a66ec8943dc1b19a508f0ab64eff0b97958e9639850b005d11e29d4314b7",
        "ba9f947c589eefb8ba1baf9f50cc3e4640e79d8d0d4450b93c11920c5de2781c",
      ].sort(),
    );
  });
});

describe("sample mode", () => {
  it("keeps sample rows out of billing and export and refuses to mix them with real rows", async () => {
    const owner = await createUser(email("owner"));
    const consultant = await createUser(email("consultant"));
    const orgId = await createOrg(owner);
    await activeMembership(orgId, consultant, "licensed_consultant", owner);

    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`insert into public.persons (organization_id, display_name) values ($1, 'Real person')`, [orgId]),
      /sample mode/,
    );
    await db.query(
      `insert into public.persons (organization_id, display_name, is_sample) values ($1, 'Sample person', true)`,
      [orgId],
    );

    await asMaintenance(db);
    const realPerson = randomUUID();
    const realMatter = randomUUID();
    const sampleMatter = randomUUID();
    await db.query(
      `insert into public.persons (id, organization_id, display_name) values ($1, $2, 'Maintenance person')`,
      [realPerson, orgId],
    );
    await db.query(
      `insert into public.matters (id, organization_id, title) values ($1, $2, 'Real matter')`,
      [realMatter, orgId],
    );
    await db.query(
      `insert into public.matters (id, organization_id, title, is_sample) values ($1, $2, 'Sample matter', true)`,
      [sampleMatter, orgId],
    );
    const samplePerson = await db.query<{ id: string }>(
      `select id from public.persons where organization_id = $1 and is_sample`,
      [orgId],
    );
    await expectDbError(
      () =>
        db.query(
          `insert into public.matter_participants (organization_id, matter_id, person_id, role)
           values ($1, $2, $3, 'applicant')`,
          [orgId, realMatter, samplePerson.rows[0].id],
        ),
      /cannot be linked/,
    );
    await expectDbError(
      () => db.query(`update public.persons set is_sample = false where id = $1`, [samplePerson.rows[0].id]),
      /immutable/,
    );

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const billing = await db.query<{ matter_id: string }>(`select matter_id from public.list_matter_billing()`);
    expect(billing.rows.map((row) => row.matter_id)).toContain(realMatter);
    expect(billing.rows.map((row) => row.matter_id)).not.toContain(sampleMatter);
    const exported = await db.query<{ matter_id: string }>(`select matter_id from public.list_exportable_matter_ids()`);
    expect(exported.rows.map((row) => row.matter_id)).toContain(realMatter);
    expect(exported.rows.map((row) => row.matter_id)).not.toContain(sampleMatter);
    await expectDbError(
      () => db.query(`select public.perform_billing_action($1, 'issue_invoice')`, [sampleMatter]),
      /sample data is excluded/,
    );
  });
});

describe("manual register checks", () => {
  it("locks revoked, suspended, and inactive licences and schedules a re-check from the setting", async () => {
    const owner = await createUser(email("owner"));
    const consultant = await createUser(email("consultant"));
    const receiver = await createUser(email("receiver"));
    const manager = await createUser(email("manager"));
    const outsider = await createUser(email("outsider"));
    const admin = await createUser(email("admin"));
    const orgId = await createOrg(owner);
    const otherOrg = await createOrg(outsider);
    const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
    const receiverMembership = await activeMembership(orgId, receiver, "licensed_consultant", owner);
    await activeMembership(orgId, manager, "case_manager", owner);
    await asMaintenance(db);
    await db.query(`insert into public.platform_admins (user_id) values ($1)`, [admin]);

    const credentialId = await declareLicence(consultant, orgId, consultantMembership, "synth-rcic-1");
    const stored = await db.query<{ college_id: string; status: string }>(
      `select college_id, status::text as status from public.consultant_credentials where id = $1`,
      [credentialId],
    );
    expect(stored.rows[0]).toEqual({ college_id: "SYNTH-RCIC-1", status: "declared" });

    await asUser(db, { userId: manager, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(
          `select public.record_licence_check(
             $1, $2, statement_timestamp(), 'active', true, false, false, false, null, $3, null
           )`,
          [credentialId, REGISTER, PROOF],
        ),
      /licence check denied/,
    );
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(
          `select public.record_licence_check(
             $1, 'https://www.college-ic.ca/', statement_timestamp(), 'active', true, false, false, false, null, $2, null
           )`,
          [credentialId, PROOF],
        ),
      /register\.college-ic\.ca/,
    );
    await expectDbError(
      () =>
        db.query(
          `select public.record_licence_check(
             $1, 'https://canada.ca/', statement_timestamp(), 'active', true, false, false, false, null, $2, null
           )`,
          [credentialId, PROOF],
        ),
      /register\.college-ic\.ca/,
    );

    const goodCheck = await recordCheck(owner, orgId, credentialId, { url: RCIC_SEARCH, restricted: true });
    await asMaintenance(db);
    const verified = await db.query<{
      status: string;
      method: string;
      entitlement: boolean;
      restricted: boolean;
      detail: string;
      firm: string;
    }>(
      `select credential.status::text as status,
              credential.verification_method as method,
              credential.entitlement_to_practise as entitlement,
              credential.discipline_restricted as restricted,
              credential.discipline_restriction_detail as detail,
              org.verification_status::text as firm
       from public.consultant_credentials credential
       join public.organizations org on org.id = credential.organization_id
       where credential.id = $1`,
      [credentialId],
    );
    expect(verified.rows[0]).toEqual({
      status: "verified",
      method: "manual_public_register",
      entitlement: true,
      restricted: true,
      detail: "Synthetic restriction copied from the register profile",
      firm: "verified",
    });
    const delay = await db.query<{ matches: boolean; configured: boolean }>(
      `select event.available_at = checks.retrieved_at + app.product_setting_interval('licence.recheck_interval') as matches,
              (event.payload ->> 'interval_configured')::boolean as configured
       from public.outbox_events event
       join public.credential_checks checks
         on event.idempotency_key = 'licence.recheck_due:' || checks.id::text
       where checks.id = $1`,
      [goodCheck],
    );
    expect(delay.rows[0]).toEqual({ matches: true, configured: true });
    const firstAvailable = await db.query<{ available_at: string }>(
      `select available_at::text as available_at from public.outbox_events
       where idempotency_key = 'licence.recheck_due:' || $1::text`,
      [goodCheck],
    );

    await asUser(db, { userId: admin, aal: "aal2", totpAgeSeconds: 0 });
    await db.query(
      `select public.set_product_setting('licence.recheck_interval', '{"unit":"days","count":10}'::jsonb)`,
    );
    const secondCheck = await recordCheck(admin, orgId, credentialId, { restricted: true });
    await asMaintenance(db);
    const unchanged = await db.query<{ available_at: string }>(
      `select available_at::text as available_at from public.outbox_events
       where idempotency_key = 'licence.recheck_due:' || $1::text`,
      [goodCheck],
    );
    expect(unchanged.rows[0].available_at).toBe(firstAvailable.rows[0].available_at);
    const secondDelay = await db.query<{ matches: boolean }>(
      `select event.available_at = checks.retrieved_at + interval '10 days' as matches
       from public.outbox_events event
       join public.credential_checks checks
         on event.idempotency_key = 'licence.recheck_due:' || checks.id::text
       where checks.id = $1`,
      [secondCheck],
    );
    expect(secondDelay.rows[0].matches).toBe(true);
    await asUser(db, { userId: admin, aal: "aal2", totpAgeSeconds: 0 });
    await db.query(
      `select public.set_product_setting('licence.recheck_interval', '{"unit":"months","count":1}'::jsonb)`,
    );

    await asMaintenance(db);
    const matter = randomUUID();
    await db.query(`insert into public.matters (id, organization_id, title) values ($1, $2, 'Synthetic stage matter')`, [
      matter,
      orgId,
    ]);
    await db.query(
      `insert into public.matter_participants (organization_id, matter_id, membership_id, role)
       values ($1, $2, $3, 'consultant')`,
      [orgId, matter, consultantMembership],
    );
    const steps: Array<[string, string, string]> = [
      ["intake", "service_agreement", "Synthetic agreement"],
      ["evidence_collection", "questionnaire_assigned", "Questionnaire assigned"],
      ["preparation", "facts_reviewed", "Facts reviewed"],
      ["consultant_review", "draft_package", "Draft package"],
      ["client_confirmation", "client_review_package", "Client review package"],
      ["ready_to_submit", "submission_approvals", "Submission approvals"],
    ];
    let version = 1;
    for (const [stage, kind, summary] of steps) {
      await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
      await db.query(
        `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
         values ($1, $2, $3::public.matter_stage_evidence_kind, $4)`,
        [orgId, matter, kind, summary],
      );
      const next = await db.query<{ version: number }>(
        `select public.transition_matter_stage($1, $2::public.matter_stage, $3, $4) as version`,
        [matter, stage, version, summary],
      );
      version = countOf(next.rows[0].version);
    }
    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(
      `insert into public.matter_stage_evidence (
         organization_id, matter_id, kind, summary, external_reference, submission_at, receipt_locator
       ) values ($1, $2, 'submission_confirmation', 'Filed', 'SYN-100', statement_timestamp(), 'receipt-synthetic')`,
      [orgId, matter],
    );

    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const readable = await db.query(`select id from public.matters where id = $1`, [matter]);
    expect(readable.rows).toHaveLength(1);

    for (const fields of [
      { revoked: true, registerStatus: "inactive" as const },
      { suspended: true },
      { registerStatus: "inactive" as const },
    ]) {
      await recordCheck(owner, orgId, credentialId, fields);
      await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
      const blocked = await db.query<{ result: { ok: boolean; blocked: string } }>(
        `select public.attempt_matter_stage_transition($1, 'submitted', $2, 'Submission confirmed') as result`,
        [matter, version],
      );
      expect(blocked.rows[0].result.ok).toBe(false);
      expect(blocked.rows[0].result.blocked).toBe("licence");
      await expectDbError(
        () =>
          db.query(`select public.transition_matter_stage($1, 'submitted', $2, 'Submission confirmed')`, [
            matter,
            version,
          ]),
        /licence blocks/,
      );
      const created = await db.query<{ result: { ok: boolean; blocked: string } }>(
        `select public.create_practice_matter('Blocked sample', true) as result`,
      );
      expect(created.rows[0].result).toMatchObject({ ok: false, blocked: "licence" });
    }

    await asMaintenance(db);
    const stage = await db.query<{ stage: string }>(`select stage::text as stage from public.matters where id = $1`, [
      matter,
    ]);
    expect(stage.rows[0].stage).toBe("ready_to_submit");
    const evidence = await db.query<{ n: number }>(
      `select count(*)::int as n from public.matter_stage_evidence
       where matter_id = $1 and kind = 'submission_confirmation'`,
      [matter],
    );
    expect(countOf(evidence.rows[0].n)).toBe(1);
    const denied = await db.query<{ n: number }>(
      `select count(*)::int as n from public.audit_log
       where organization_id = $1 and action = 'licence.regulated_action_blocked' and result = 'denied'`,
      [orgId],
    );
    expect(countOf(denied.rows[0].n)).toBeGreaterThanOrEqual(3);

    await asUser(db, { userId: manager, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const managerMatter = await db.query<{ result: { ok: boolean } }>(
      `select public.create_practice_matter('Manager sample', true) as result`,
    );
    expect(managerMatter.rows[0].result.ok).toBe(true);
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const ownerMatter = await db.query<{ result: { ok: boolean } }>(
      `select public.create_practice_matter('Owner sample', true) as result`,
    );
    expect(ownerMatter.rows[0].result.ok).toBe(true);

    const receiverCredential = await declareLicence(receiver, orgId, receiverMembership, "SYNTH-RCIC-2");
    await recordCheck(owner, orgId, receiverCredential);
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const moved = await db.query<{ moved: number }>(
      `select public.reassign_consultant_matters($1, $2, 'Receiving consultant holds a verified licence') as moved`,
      [consultantMembership, receiverMembership],
    );
    expect(countOf(moved.rows[0].moved)).toBe(1);

    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const stillBlocked = await db.query<{ result: { ok: boolean; blocked: string } }>(
      `select public.create_practice_matter('Still blocked sample', true) as result`,
    );
    expect(stillBlocked.rows[0].result).toMatchObject({ ok: false, blocked: "licence" });

    await recordCheck(owner, orgId, credentialId, { entitlement: false });
    await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const notEntitled = await db.query<{ result: { ok: boolean }; status: string }>(
      `select public.create_practice_matter('Not entitled sample', true) as result,
              app.actor_licence_block_status($1)::text as status`,
      [orgId],
    );
    expect(notEntitled.rows[0].status).toBe("not_entitled");
    expect(notEntitled.rows[0].result).toMatchObject({ ok: false, blocked: "licence" });
    await asMaintenance(db);
    const firm = await db.query<{ status: string }>(
      `select verification_status::text as status from public.organizations where id = $1`,
      [orgId],
    );
    expect(firm.rows[0].status).toBe("verified");

    await asUser(db, { userId: receiver, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const filed = await db.query<{ result: { ok: boolean; version: number } }>(
      `select public.attempt_matter_stage_transition($1, 'submitted', $2, 'Submission confirmed') as result`,
      [matter, version],
    );
    expect(filed.rows[0].result.ok).toBe(true);

    await asUser(db, { userId: outsider, aal: "aal2", orgId: otherOrg, totpAgeSeconds: 0 });
    const hidden = await db.query(`select id from public.consultant_credentials`);
    expect(hidden.rows).toHaveLength(0);

    await asMaintenance(db);
    const adverse = await db.query<{ n: number }>(
      `select count(*)::int as n from public.outbox_events
       where organization_id = $1 and event_type = 'licence.adverse_status'`,
      [orgId],
    );
    expect(countOf(adverse.rows[0].n)).toBeGreaterThanOrEqual(3);
  });
});

describe("real client invites and trial", () => {
  it("unlocks only after verification, a good-standing check, and six sample proofs", async () => {
    const owner = await createUser(email("owner"));
    const consultant = await createUser(email("consultant"));
    const admin = await createUser(email("admin"));
    const orgId = await createOrg(owner);
    const membershipId = await activeMembership(orgId, consultant, "licensed_consultant", owner);
    await asMaintenance(db);
    await db.query(`insert into public.platform_admins (user_id) values ($1)`, [admin]);

    const before = await db.query<{ trial_ends_at: string; snapshot: { count: number } }>(
      `select trial_ends_at::text as trial_ends_at, duration_snapshot as snapshot
       from public.organization_subscriptions where organization_id = $1`,
      [orgId],
    );
    expect(before.rows[0].snapshot).toEqual({ unit: "days", count: 14 });
    const aligned = await db.query<{ ok: boolean }>(
      `select trial_ends_at = trial_started_at + app.product_setting_interval('trial.duration') as ok
       from public.organization_subscriptions where organization_id = $1`,
      [orgId],
    );
    expect(aligned.rows[0].ok).toBe(true);

    await asUser(db, { userId: admin, aal: "aal2", totpAgeSeconds: 0 });
    await db.query(`select public.set_product_setting('trial.duration', '{"unit":"days","count":21}'::jsonb)`);
    await asMaintenance(db);
    const snapshot = await db.query<{ snapshot: { count: number }; pending: boolean }>(
      `select sub.duration_snapshot as snapshot, setting.pending_confirmation as pending
       from public.organization_subscriptions sub
       join public.product_settings setting on setting.key = 'trial.duration'
       where sub.organization_id = $1`,
      [orgId],
    );
    expect(snapshot.rows[0].snapshot).toEqual({ unit: "days", count: 14 });
    expect(snapshot.rows[0].pending).toBe(false);
    expect(before.rows[0].trial_ends_at).toBe(
      (
        await db.query<{ trial_ends_at: string }>(
          `select trial_ends_at::text as trial_ends_at from public.organization_subscriptions where organization_id = $1`,
          [orgId],
        )
      ).rows[0].trial_ends_at,
    );

    const laterOwner = await createUser(email("later"));
    const laterOrg = await createOrg(laterOwner);
    await asMaintenance(db);
    const later = await db.query<{ snapshot: { count: number } }>(
      `select duration_snapshot as snapshot from public.organization_subscriptions where organization_id = $1`,
      [laterOrg],
    );
    expect(later.rows[0].snapshot).toEqual({ unit: "days", count: 21 });
    await asUser(db, { userId: admin, aal: "aal2", totpAgeSeconds: 0 });
    await db.query(`select public.set_product_setting('trial.duration', '{"unit":"days","count":14}'::jsonb)`);

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const locked = await db.query<{ result: { unlocked: boolean; blockers: string[] } }>(
      `select public.evaluate_real_client_invites($1) as result`,
      [orgId],
    );
    expect(locked.rows[0].result.unlocked).toBe(false);
    expect(locked.rows[0].result.blockers).toEqual(
      expect.arrayContaining(["firm_unverified", "licence_not_verified", "sample_step_missing:export"]),
    );

    const credentialId = await declareLicence(consultant, orgId, membershipId, "SYNTH-RISIA-1", "RISIA");
    await recordCheck(owner, orgId, credentialId);
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const sample = await db.query<{ result: { id: string } }>(
      `select public.create_practice_matter('Sample activation matter', true) as result`,
    );
    const matterId = sample.rows[0].result.id;
    for (const step of ["intake", "agreement", "upload", "reminder", "invoice"]) {
      await db.query(`select public.complete_sample_proof($1::public.sample_proof_step, $2)`, [step, matterId]);
    }
    const missingExport = await db.query<{ result: { unlocked: boolean; blockers: string[] } }>(
      `select public.evaluate_real_client_invites($1) as result`,
      [orgId],
    );
    expect(missingExport.rows[0].result.unlocked).toBe(false);
    expect(missingExport.rows[0].result.blockers).toEqual(["sample_step_missing:export"]);
    await expectDbError(
      () => db.query(`select public.set_sample_mode(false)`),
      /sample mode stays on/,
    );
    await db.query(`select public.complete_sample_proof('export', $1)`, [matterId]);
    const open = await db.query<{ result: { unlocked: boolean; blockers: string[] } }>(
      `select public.evaluate_real_client_invites($1) as result`,
      [orgId],
    );
    expect(open.rows[0].result).toEqual({ unlocked: true, blockers: [] });
    await asMaintenance(db);
    await db.query(
      `update public.organization_subscriptions set status = 'trial_ended' where organization_id = $1`,
      [orgId],
    );
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const trialEnded = await db.query<{ result: { unlocked: boolean; blockers: string[] } }>(
      `select public.evaluate_real_client_invites($1) as result`,
      [orgId],
    );
    expect(trialEnded.rows[0].result).toEqual({ unlocked: false, blockers: ["trial_ended"] });
    await asMaintenance(db);
    await db.query(
      `update public.organization_subscriptions set status = 'trial' where organization_id = $1`,
      [orgId],
    );
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(`select public.set_sample_mode(false)`);
    await asMaintenance(db);
    const mode = await db.query<{ sample_mode: boolean }>(
      `select sample_mode from public.organizations where id = $1`,
      [orgId],
    );
    expect(mode.rows[0].sample_mode).toBe(false);
  });

  it("lets a firm owner declare their own licence but not one on another owner's membership", async () => {
    const owner = await createUser(`owner-${randomUUID().slice(0, 8)}@example.test`);
    const orgId = await createOrg(owner);
    await asMaintenance(db);
    const own = await db.query<{ id: string }>(
      `select id from public.memberships where organization_id = $1 and user_id = $2 and role = 'firm_owner'`,
      [orgId, owner],
    );
    const ownerMembership = own.rows[0].id;
    const credentialId = await declareLicence(owner, orgId, ownerMembership, "R700001");
    expect(credentialId).toBeTruthy();

    // Declared, not yet checked against the register: not the firm's verified licence yet.
    await asMaintenance(db);
    const verified = await db.query<{ ok: boolean }>(`select app.firm_has_verified_licence($1) as ok`, [orgId]);
    expect(verified.rows[0].ok).toBe(false);

    const coOwner = await createUser(`coowner-${randomUUID().slice(0, 8)}@example.test`);
    const coOwnerMembership = await activeMembership(orgId, coOwner, "firm_owner", owner);
    await expectDbError(() => declareLicence(owner, orgId, coOwnerMembership, "R700002"), /licence declaration denied/);
  });

  it("creates one real sample case of sample rows, and only for staff", async () => {
    const owner = await createUser(`owner-${randomUUID().slice(0, 8)}@example.test`);
    const orgId = await createOrg(owner);
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const first = await db.query<{ id: string }>(`select public.ensure_sample_case() as id`);
    const again = await db.query<{ id: string }>(`select public.ensure_sample_case() as id`);
    expect(again.rows[0].id).toBe(first.rows[0].id);

    await asMaintenance(db);
    const rows = await db.query<{ matters: number; people: number; parties: number; real: number }>(
      `select
         (select count(*)::int from public.matters where organization_id = $1) as matters,
         (select count(*)::int from public.persons where organization_id = $1) as people,
         (select count(*)::int from public.matter_participants where organization_id = $1 and person_id is not null) as parties,
         (select count(*)::int from public.persons where organization_id = $1 and not is_sample)
           + (select count(*)::int from public.matters where organization_id = $1 and not is_sample) as real`,
      [orgId],
    );
    expect(rows.rows[0]).toEqual({ matters: 1, people: 2, parties: 2, real: 0 });

    // The owner who made it can read its sample people (they are assigned to the sample matter).
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const visible = await db.query<{ display_name: string }>(
      `select display_name from public.persons where organization_id = $1 order by display_name`,
      [orgId],
    );
    expect(visible.rows.map((row) => row.display_name)).toEqual(["Priya Sharma", "Rafael Sharma"]);

    const assistant = await createUser(`assistant-${randomUUID().slice(0, 8)}@example.test`);
    await activeMembership(orgId, assistant, "assistant", owner);
    await asUser(db, { userId: assistant, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(() => db.query(`select public.ensure_sample_case()`), /sample case denied/);
  });

  it("makes a licensed owner the sample matter's responsible consultant, and not an unlicensed one", async () => {
    const owner = await createUser(`owner-${randomUUID().slice(0, 8)}@example.test`);
    const orgId = await createOrg(owner);
    await asMaintenance(db);
    const ownerMembership = (
      await db.query<{ id: string }>(
        `select id from public.memberships where organization_id = $1 and user_id = $2 and role = 'firm_owner'`,
        [orgId, owner],
      )
    ).rows[0].id;

    // Without a licence on file the owner is not licensed: the sample matter keeps no consultant.
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    const matterId = (await db.query<{ id: string }>(`select public.ensure_sample_case() as id`)).rows[0].id;
    await asMaintenance(db);
    const before = await db.query<{ consultant: string | null }>(
      `select responsible_consultant_membership_id as consultant from public.matters where id = $1`,
      [matterId],
    );
    expect(before.rows[0].consultant).toBeNull();

    // Once the owner declares a licence, opening the sample case again assigns them.
    await declareLicence(owner, orgId, ownerMembership, "R700101");
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(`select public.ensure_sample_case()`);
    await asMaintenance(db);
    const after = await db.query<{ consultant: string | null; parties: number }>(
      `select responsible_consultant_membership_id as consultant,
              (select count(*)::int from public.matter_participants
                where matter_id = $1 and membership_id = $2 and role = 'consultant') as parties
         from public.matters where id = $1`,
      [matterId, ownerMembership],
    );
    expect(after.rows[0]).toEqual({ consultant: ownerMembership, parties: 1 });
  });

  it("completes the terms step without a data processing agreement and records one only when accepted", async () => {
    const owner = await createUser(`owner-${randomUUID().slice(0, 8)}@example.test`);
    const orgId = await createOrg(owner);
    const terms = (extra: Record<string, unknown>) =>
      JSON.stringify({
        subscription_terms_accepted: true,
        privacy_contact_name: "Synthetic Privacy Lead",
        privacy_contact_email: "privacy@example.test",
        subscription_terms_version: "2026-10",
        ...extra,
      });
    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await db.query(`select public.save_firm_setup('terms_and_privacy'::public.firm_setup_step, $1::jsonb)`, [terms({})]);
    await asMaintenance(db);
    const without = await db.query<{ dpa: boolean; terms: boolean; done: boolean }>(
      `select o.dpa_accepted_at is not null as dpa, o.subscription_terms_accepted_at is not null as terms,
              exists (select 1 from public.organization_setup_steps s where s.organization_id = o.id and s.step = 'terms_and_privacy') as done
       from public.organizations o where o.id = $1`,
      [orgId],
    );
    expect(without.rows[0]).toEqual({ dpa: false, terms: true, done: true });

    await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.save_firm_setup('terms_and_privacy'::public.firm_setup_step, $1::jsonb)`, [terms({ dpa_accepted: false })]),
      /only be recorded as accepted/,
    );
    await db.query(`select public.save_firm_setup('terms_and_privacy'::public.firm_setup_step, $1::jsonb)`, [
      terms({ dpa_accepted: true, dpa_version: "2026-11" }),
    ]);
    await asMaintenance(db);
    const withDpa = await db.query<{ version: string }>(`select dpa_version as version from public.organizations where id = $1`, [orgId]);
    expect(withDpa.rows[0].version).toBe("2026-11");
  });
});
