import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asMaintenance,
  asServiceRole,
  asUser,
  countOf,
  createTestDb,
  expectDbError,
  type TestDb,
} from "./helpers/postgres";

let db: TestDb;

const REGISTER = "https://register.college-ic.ca/Public-Register-EN";
const PROOF = "proof/synthetic-register-capture";
const CANADA = "https://www.canada.ca/en/immigration-refugees-citizenship.html";

const intakeSchema = {
  fields: [
    {
      key: "has_dependant",
      type: "declaration",
      labels: { "en-CA": "Has a dependant" },
      required: true,
    },
    {
      key: "dependant_name",
      type: "text",
      labels: { "en-CA": "Dependant name" },
      required: true,
      show_when: { field: "has_dependant", equals: true },
    },
    {
      key: "arrived",
      type: "date",
      labels: { "en-CA": "Arrived" },
      required: true,
    },
    {
      key: "passport_note",
      type: "text",
      labels: { "en-CA": "Passport note" },
      section_key: "passport_bio",
    },
  ],
};

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

async function declareLicence(userId: string, orgId: string, membershipId: string, collegeId: string) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const row = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membershipId, collegeId, PROOF],
  );
  return row.rows[0].id;
}

async function recordCheck(
  userId: string,
  orgId: string,
  credentialId: string,
  fields: { suspended?: boolean; entitlement?: boolean } = {},
) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check(
       $1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       $3, $4, false, false, null, $5, 'Synthetic reviewer note'
     )`,
    [credentialId, REGISTER, fields.entitlement ?? true, fields.suspended ?? false, PROOF],
  );
}

async function firm() {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const manager = await createUser(email("manager"));
  const outsider = await createUser(email("outsider"));
  const client = await createUser(email("client"));
  const orgId = await createOrg(owner);
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  await asMaintenance(db);
  const ownerMembership = (
    await db.query<{ id: string }>(
      `select id from public.memberships where organization_id = $1 and user_id = $2`,
      [orgId, owner],
    )
  ).rows[0].id;
  const credential = await declareLicence(consultant, orgId, consultantMembership, `R${randomUUID().slice(0, 6).toUpperCase()}`);
  await recordCheck(owner, orgId, credential);
  const otherOwner = outsider;
  const otherOrg = await createOrg(otherOwner);
  return {
    owner,
    consultant,
    manager,
    client,
    orgId,
    consultantMembership,
    managerMembership,
    ownerMembership,
    otherOwner,
    otherOrg,
  };
}

async function publishPack(orgId: string, jurisdiction = "CA") {
  await asMaintenance(db);
  await db.exec(`alter table public.rule_pack_versions disable trigger rule_pack_versions_guard`);
  const pack = await db.query<{ id: string }>(
    `insert into public.rule_pack_versions (
       organization_id, jurisdiction, program_key, pack_version, status, content_frozen
     ) values ($1, $2, $3, 1, 'published', true)
     returning id`,
    [orgId, jurisdiction, `pack_${randomUUID().replaceAll("-", "").slice(0, 12)}`],
  );
  await db.exec(`alter table public.rule_pack_versions enable trigger rule_pack_versions_guard`);
  return pack.rows[0].id;
}

async function createSampleMatter(
  userId: string,
  orgId: string,
  consultantMembership: string,
  options: { packId?: string | null; scope?: string | null; sample?: boolean } = {},
) {
  await asUser(db, { userId, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const created = await db.query<{ result: { ok: boolean; id?: string; reference?: string; blocked?: string } }>(
    `select public.create_engaged_matter($1, $2, $3, $4, $5) as result`,
    [
      "Synthetic matter",
      options.sample ?? true,
      consultantMembership,
      options.packId ?? null,
      options.scope ?? null,
    ],
  );
  return created.rows[0].result;
}

describe("portal organization foreign-key indexes", () => {
  it("covers organization_id on consent, section records, and section shares", async () => {
    const names = [
      "consent_records_organization_id_idx",
      "person_section_records_organization_id_idx",
      "section_shares_organization_id_idx",
    ];
    const found = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where indexname = any($1::text[])`,
      [names],
    );
    expect(found.rows.map((row) => row.indexname).sort()).toEqual([...names].sort());
  });
});

describe("matter lifecycle", () => {
  it("assigns a firm reference, blocks real rows in sample mode, and isolates firms", async () => {
    const ctx = await firm();
    const packId = await publishPack(ctx.orgId);
    const created = await createSampleMatter(ctx.consultant, ctx.orgId, ctx.consultantMembership, {
      packId,
      scope: "Synthetic proposed scope",
    });
    expect(created.ok).toBe(true);
    expect(created.reference).toMatch(/^CA-2026-\d{4}$/);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(`select public.create_engaged_matter('Real file', false, $1, null, null)`, [
          ctx.consultantMembership,
        ]),
      /sample mode/,
    );

    const engagement = await db.query<{ status: string; agreement_locator: string | null; stage: string }>(
      `select engagement.status, engagement.agreement_locator, matter.stage
       from public.matter_engagements engagement
       join public.matters matter on matter.id = engagement.matter_id
       where engagement.matter_id = $1`,
      [created.id],
    );
    expect(engagement.rows[0]).toMatchObject({
      status: "pending",
      agreement_locator: null,
      stage: "engagement_pending",
    });

    const binding = await db.query<{ n: string }>(
      `select count(*)::text as n from public.matter_rule_bindings
       where matter_id = $1 and superseded_at is null`,
      [created.id],
    );
    expect(binding.rows[0].n).toBe("1");

    await asUser(db, { userId: ctx.otherOwner, aal: "aal2", orgId: ctx.otherOrg, totpAgeSeconds: 0 });
    const hidden = await db.query(`select id from public.matters where id = $1`, [created.id]);
    expect(hidden.rows).toHaveLength(0);
    await expectDbError(
      () => db.query(`select public.transition_matter_stage($1, 'intake', 1, 'Other firm')`, [created.id]),
      /denied|42501/,
    );
  });

  it("rejects a blocked licence and a draft pack, and records an audited stage override", async () => {
    const ctx = await firm();
    const blockedUser = await createUser(email("blocked"));
    const blockedMembership = await activeMembership(ctx.orgId, blockedUser, "licensed_consultant", ctx.owner);
    const blockedCredential = await declareLicence(
      blockedUser,
      ctx.orgId,
      blockedMembership,
      `R${randomUUID().slice(0, 6).toUpperCase()}`,
    );
    await recordCheck(ctx.owner, ctx.orgId, blockedCredential, { suspended: true, entitlement: false });

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const blocked = await db.query<{ result: { ok: boolean; blocked?: string } }>(
      `select public.create_engaged_matter('Blocked consultant', true, $1, null, null) as result`,
      [blockedMembership],
    );
    expect(blocked.rows[0].result.ok).toBe(false);
    expect(blocked.rows[0].result.blocked).toBe("licence");

    const created = await createSampleMatter(ctx.consultant, ctx.orgId, ctx.consultantMembership);
    expect(created.ok).toBe(true);

    await asMaintenance(db);
    await db.exec(`alter table public.rule_pack_versions disable trigger rule_pack_versions_guard`);
    const draft = await db.query<{ id: string }>(
      `insert into public.rule_pack_versions (
         organization_id, jurisdiction, program_key, pack_version, status
       ) values ($1, 'CA', $2, 1, 'draft')
       returning id`,
      [ctx.orgId, `draft_${randomUUID().replaceAll("-", "").slice(0, 10)}`],
    );
    await db.exec(`alter table public.rule_pack_versions enable trigger rule_pack_versions_guard`);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.select_matter_program($1, $2, 1, 'Draft pack')`, [created.id, draft.rows[0].id]),
      /published pack/,
    );

    const matter = await db.query<{ version: number }>(`select version from public.matters where id = $1`, [created.id]);
    await asUser(db, { userId: ctx.manager, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(`select public.override_matter_stage($1, 'intake', $2, 'Manager skip')`, [
          created.id,
          matter.rows[0].version,
        ]),
      /denied|42501/,
    );

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`update public.matters set stage = 'intake' where id = $1`, [created.id]),
      /transition_matter_stage/,
    );
    const overridden = await db.query<{
      result: { ok: boolean; permitted_role: string; version: number };
    }>(
      `select public.override_matter_stage($1, 'intake', $2, 'Agreement not on file yet') as result`,
      [created.id, matter.rows[0].version],
    );
    expect(overridden.rows[0].result.ok).toBe(true);
    expect(overridden.rows[0].result.permitted_role).toBe("firm_owner");

    const stage = await db.query<{ stage: string }>(`select stage from public.matters where id = $1`, [created.id]);
    expect(stage.rows[0].stage).toBe("intake");
    await asMaintenance(db);
    const audit = await db.query<{ n: string }>(
      `select count(*)::text as n from public.audit_log
       where object_id = $1 and action = 'matter.stage_override'`,
      [created.id],
    );
    expect(Number(audit.rows[0].n)).toBeGreaterThan(0);

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () =>
        db.query(`select public.override_matter_stage($1, 'preparation', $2, 'Skip an edge')`, [
          created.id,
          overridden.rows[0].result.version,
        ]),
      /not allowed/,
    );
  });

  it("keeps the licence lock on a regulated edge and does not treat a locator as a stage change", async () => {
    const ctx = await firm();
    const created = await createSampleMatter(ctx.consultant, ctx.orgId, ctx.consultantMembership);
    const matterId = created.id as string;

    async function version() {
      await asMaintenance(db);
      const row = await db.query<{ version: number; stage: string }>(
        `select version, stage from public.matters where id = $1`,
        [matterId],
      );
      return row.rows[0];
    }

    const steps: Array<[string, string]> = [
      ["intake", "service_agreement"],
      ["evidence_collection", "questionnaire_assigned"],
      ["preparation", "facts_reviewed"],
      ["consultant_review", "draft_package"],
      ["client_confirmation", "client_review_package"],
      ["ready_to_submit", "submission_approvals"],
    ];
    for (const [to, kind] of steps) {
      const current = await version();
      await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
      if (to !== "intake") {
        await db.query(
          `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
           values ($1, $2, $3::public.matter_stage_evidence_kind, 'Synthetic evidence')`,
          [ctx.orgId, matterId, kind],
        );
      } else {
        await db.query(
          `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
           values ($1, $2, 'service_agreement', 'Synthetic agreement locator only')`,
          [ctx.orgId, matterId],
        );
      }
      await db.query(`select public.transition_matter_stage($1, $2::public.matter_stage, $3, 'Synthetic step')`, [
        matterId,
        to,
        current.version,
      ]);
    }

    const ready = await version();
    expect(ready.stage).toBe("ready_to_submit");
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.override_matter_stage($1, 'submitted', $2, 'Owner cannot file')`, [matterId, ready.version]),
      /denied|42501/,
    );

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const filed = await db.query<{ result: { ok: boolean; permitted_role: string } }>(
      `select public.override_matter_stage($1, 'submitted', $2, 'Receipt not on file') as result`,
      [matterId, ready.version],
    );
    expect(filed.rows[0].result).toMatchObject({ ok: true, permitted_role: "licensed_consultant" });
    const after = await version();
    expect(after.stage).toBe("submitted");

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(
      `select public.record_matter_engagement($1, 'Signed scope summary', false, null, 'locator/synthetic')`,
      [matterId],
    );
    const held = await version();
    expect(held.stage).toBe("submitted");
    const engagement = await db.query<{ engagement_status: string }>(
      `select engagement_status from public.matters where id = $1`,
      [matterId],
    );
    expect(engagement.rows[0].engagement_status).toBe("engaged");
  });

  it("records hold, government status, and outcome without moving the stage", async () => {
    const ctx = await firm();
    const created = await createSampleMatter(ctx.owner, ctx.orgId, ctx.consultantMembership);
    const matterId = created.id as string;
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const held = await db.query<{ version: number }>(
      `select public.set_matter_on_hold($1, 1, 'Waiting on a document', $2, '2026-11-01') as version`,
      [matterId, ctx.consultantMembership],
    );
    expect(countOf(held.rows[0].version)).toBeGreaterThan(1);
    const row = await db.query<{ on_hold: boolean; stage: string; government_status: string; outcome: string | null }>(
      `select on_hold, stage, government_status, outcome from public.matters where id = $1`,
      [matterId],
    );
    expect(row.rows[0]).toMatchObject({
      on_hold: true,
      stage: "engagement_pending",
      government_status: "not_recorded",
      outcome: null,
    });

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(
      `insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
       values ($1, $2, 'official_decision', 'Synthetic decision letter')`,
      [ctx.orgId, matterId],
    );
    const current = await db.query<{ version: number }>(`select version from public.matters where id = $1`, [matterId]);
    await db.query(
      `select public.record_government_status($1, 'decision_evidence_on_file', $2, 'Letter on file')`,
      [matterId, current.rows[0].version],
    );
    const afterStatus = await db.query<{ version: number; stage: string }>(
      `select version, stage from public.matters where id = $1`,
      [matterId],
    );
    await db.query(`select public.record_matter_outcome($1, 'approved', $2, 'Letter says approved')`, [
      matterId,
      afterStatus.rows[0].version,
    ]);
    const done = await db.query<{ stage: string; outcome: string; government_status: string }>(
      `select stage, outcome, government_status from public.matters where id = $1`,
      [matterId],
    );
    expect(done.rows[0]).toEqual({
      stage: "engagement_pending",
      outcome: "approved",
      government_status: "decision_evidence_on_file",
    });
  });
});

describe("versioned intake", () => {
  it("snapshots answers, keeps partial dates, and hides restricted sections", async () => {
    const ctx = await firm();
    const created = await createSampleMatter(ctx.consultant, ctx.orgId, ctx.consultantMembership);
    const matterId = created.id as string;

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(
      `insert into public.persons (organization_id, display_name, is_sample)
       values ($1, 'Sample applicant', true)`,
      [ctx.orgId],
    );
    const person = await db.query<{ id: string }>(
      `select id from public.persons where organization_id = $1 and display_name = 'Sample applicant'`,
      [ctx.orgId],
    );
    const personId = person.rows[0].id;
    await db.query(
      `insert into public.matter_participants (organization_id, matter_id, person_id, role)
       values ($1, $2, $3, 'applicant')`,
      [ctx.orgId, matterId, personId],
    );
    await asMaintenance(db);
    await db.query(`update public.persons set user_id = $2 where id = $1`, [personId, ctx.client]);
    await activeMembership(ctx.orgId, ctx.client, "client", ctx.owner);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const template = await db.query<{ id: string }>(
      `select public.save_intake_template(
         $1, 'Synthetic intake', 'en-CA', 'unspecified', $2::jsonb, true, '2026-10-01', null
       ) as id`,
      [`intake_${randomUUID().replaceAll("-", "").slice(0, 12)}`, JSON.stringify(intakeSchema)],
    );
    const response = await db.query<{ id: string }>(
      `select public.open_intake_response($1, $2, $3) as id`,
      [template.rows[0].id, matterId, personId],
    );
    const responseId = response.rows[0].id;

    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    let version = 1;
    await db.query(
      `select public.save_intake_answer($1, $2, 'has_dependant', 'provided', '{"declaration":false}'::jsonb)`,
      [responseId, version],
    );
    version = (await db.query<{ version: number }>(`select version from public.intake_responses where id = $1`, [responseId]))
      .rows[0].version;
    await db.query(
      `select public.save_intake_answer($1, $2, 'arrived', 'approximate', $3::jsonb)`,
      [responseId, version, JSON.stringify({ year: 2019, approximate_note: "Around that year" })],
    );
    version = (await db.query<{ version: number }>(`select version from public.intake_responses where id = $1`, [responseId]))
      .rows[0].version;
    await db.query(
      `select public.save_intake_answer($1, $2, 'passport_note', 'provided', '{"text":"Synthetic bio page"}'::jsonb)`,
      [responseId, version],
    );
    version = (await db.query<{ version: number }>(`select version from public.intake_responses where id = $1`, [responseId]))
      .rows[0].version;
    await db.query(`select public.submit_intake_response($1, $2)`, [responseId, version]);

    const snap = await db.query<{ field_key: string; calendar_date: string | null; year_value: number | null }>(
      `select field_key, calendar_date::text, year_value
       from public.intake_snapshot_answers
       where snapshot_id in (select id from public.intake_snapshots where response_id = $1)
       order by field_key`,
      [responseId],
    );
    expect(snap.rows.map((row) => row.field_key)).toEqual(["arrived", "has_dependant", "passport_note"]);
    expect(snap.rows.find((row) => row.field_key === "arrived")).toMatchObject({
      calendar_date: null,
      year_value: 2019,
    });

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const task = await db.query<{ id: string }>(
      `select public.create_task(
         $1, 'internal', 'Check the passport note', $2, null, 'normal', null, null,
         'America/Toronto', null, 'passport_note', '[]'::jsonb
       ) as id`,
      [matterId, ctx.consultantMembership],
    );

    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const submitted = await db.query<{ version: number }>(
      `select version from public.intake_responses where id = $1`,
      [responseId],
    );
    await db.query(
      `select public.save_intake_answer($1, $2, 'passport_note', 'provided', '{"text":"Corrected bio page"}'::jsonb)`,
      [responseId, submitted.rows[0].version],
    );
    await asMaintenance(db);
    const events = await db.query<{ n: string }>(
      `select count(*)::text as n from public.outbox_events
       where event_type = 'intake.answer_corrected' and aggregate_id = $1`,
      [responseId],
    );
    expect(events.rows[0].n).toBe("1");
    const stale = await db.query<{ intake_stale: boolean }>(`select intake_stale from public.tasks where id = $1`, [
      task.rows[0].id,
    ]);
    expect(stale.rows[0].intake_stale).toBe(true);
    const frozenSnap = await db.query<{ normalized_value: { text?: string } }>(
      `select normalized_value from public.intake_snapshot_answers
       where field_key = 'passport_note'
         and snapshot_id in (select id from public.intake_snapshots where response_id = $1)`,
      [responseId],
    );
    expect(frozenSnap.rows[0].normalized_value.text).toBe("Synthetic bio page");

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const ownerSees = await db.query(
      `select id from public.intake_answer_versions where response_id = $1 and field_key = 'passport_note'`,
      [responseId],
    );
    expect(ownerSees.rows).toHaveLength(0);
    const ownerSeesOpen = await db.query(
      `select id from public.intake_answer_versions where response_id = $1 and field_key = 'has_dependant'`,
      [responseId],
    );
    expect(ownerSeesOpen.rows).toHaveLength(0);

    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const clientSees = await db.query<{ n: string }>(
      `select count(*)::text as n from public.intake_answer_versions where response_id = $1`,
      [responseId],
    );
    expect(Number(clientSees.rows[0].n)).toBeGreaterThan(0);

    await asUser(db, { userId: ctx.otherOwner, aal: "aal2", orgId: ctx.otherOrg, totpAgeSeconds: 0 });
    const otherSees = await db.query(`select id from public.intake_responses where id = $1`, [responseId]);
    expect(otherSees.rows).toHaveLength(0);

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.freeze_intake_response($1)`, [responseId]);
    await asUser(db, { userId: ctx.client, aal: "aal1", orgId: ctx.orgId });
    const frozenVersion = await db.query<{ version: number }>(
      `select version from public.intake_responses where id = $1`,
      [responseId],
    );
    await expectDbError(
      () =>
        db.query(
          `select public.save_intake_answer($1, $2, 'arrived', 'unknown', '{}'::jsonb)`,
          [responseId, frozenVersion.rows[0].version],
        ),
      /frozen/,
    );
  });
});

describe("tasks and deadlines", () => {
  it("blocks completion on an open dependency and escalates critical work while a matter is on hold", async () => {
    const ctx = await firm();
    const created = await createSampleMatter(ctx.consultant, ctx.orgId, ctx.consultantMembership);
    const matterId = created.id as string;
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const earlier = await db.query<{ id: string }>(
      `select public.create_task(
         $1, 'internal', 'Collect facts', $2, null, 'normal', null, null,
         'America/Toronto', null, null, '[]'::jsonb
       ) as id`,
      [matterId, ctx.managerMembership],
    );
    const later = await db.query<{ id: string }>(
      `select public.create_task(
         $1, 'internal', 'File the package', $2, null, 'critical', '2020-01-01', null,
         'America/Toronto', null, null, '[]'::jsonb
       ) as id`,
      [matterId, ctx.consultantMembership],
    );
    await db.query(`select public.add_task_dependency($1, $2)`, [later.rows[0].id, earlier.rows[0].id]);
    await expectDbError(
      () => db.query(`select public.add_task_dependency($1, $2)`, [earlier.rows[0].id, later.rows[0].id]),
      /cycle/,
    );
    await expectDbError(
      () => db.query(`select public.set_task_status($1, 1, 'done', null)`, [later.rows[0].id]),
      /open dependency/,
    );

    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const matterVersion = await db.query<{ version: number }>(`select version from public.matters where id = $1`, [
      matterId,
    ]);
    await db.query(`select public.set_matter_on_hold($1, $2, 'Paused for a document', $3, '2026-12-01')`, [
      matterId,
      matterVersion.rows[0].version,
      ctx.ownerMembership,
    ]);

    await db.query(`select public.record_deadline(
      $1, null, 'legal', 'Synthetic response window', null, null, '2020-01-02', null,
      'America/Toronto', $2, '2026-10-17', null, null, 'locator/synthetic'
    )`, [matterId, CANADA]);

    const escalated = await db.query<{ n: number }>(
      `select public.escalate_overdue_work(statement_timestamp()) as n`,
    );
    expect(countOf(escalated.rows[0].n)).toBeGreaterThanOrEqual(2);
    const task = await db.query<{ escalated_at: string | null; status: string }>(
      `select escalated_at::text, status from public.tasks where id = $1`,
      [later.rows[0].id],
    );
    expect(task.rows[0].status).toBe("open");
    expect(task.rows[0].escalated_at).not.toBeNull();

    await asUser(db, { userId: ctx.otherOwner, aal: "aal2", orgId: ctx.otherOrg, totpAgeSeconds: 0 });
    const hidden = await db.query(`select id from public.tasks where id = $1`, [later.rows[0].id]);
    expect(hidden.rows).toHaveLength(0);
  });

  it("ends a date-only deadline at the next local midnight and claims a reminder once", async () => {
    await asMaintenance(db);
    const end = await db.query<{ at: string }>(
      `select public.deadline_local_end('2026-10-17', 'America/Toronto') as at`,
    );
    expect(new Date(end.rows[0].at).toISOString()).toBe("2026-10-18T04:00:00.000Z");
    const shifted = await db.query<{ at: string }>(
      `select app.shift_quiet_hours('2026-10-17T02:00:00Z', 'America/Toronto', '21:00', '08:00') as at`,
    );
    expect(new Date(shifted.rows[0].at).toISOString()).toBe("2026-10-17T12:00:00.000Z");

    const ctx = await firm();
    const created = await createSampleMatter(ctx.consultant, ctx.orgId, ctx.consultantMembership);
    await asUser(db, { userId: ctx.owner, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await db.query(`select public.set_quiet_hours('21:00', '08:00')`);
    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    const deadline = await db.query<{ id: string }>(
      `select public.record_deadline(
         $1, null, 'internal', 'Internal follow-up', null, null, '2026-10-17', null,
         'America/Toronto', null, null, null, null, null
       ) as id`,
      [created.id],
    );
    await db.query(`select public.schedule_deadline_reminders($1, '2026-10-17T12:00:00Z')`, [deadline.rows[0].id]);
    const reminders = await db.query<{ reminder_kind: string; scheduled_for: string }>(
      `select reminder_kind, scheduled_for::text
       from public.reminder_schedules where deadline_id = $1`,
      [deadline.rows[0].id],
    );
    expect(reminders.rows).toHaveLength(1);
    expect(reminders.rows[0].reminder_kind).toBe("immediate");

    await asUser(db, { userId: ctx.consultant, aal: "aal2", orgId: ctx.orgId, totpAgeSeconds: 0 });
    await expectDbError(
      () => db.query(`select public.claim_due_reminders(10, statement_timestamp())`),
      /denied|42501|permission/,
    );
    await asServiceRole(db);
    const claimed = await db.query<{ ids: string[] }>(
      `select public.claim_due_reminders(10, statement_timestamp()) as ids`,
    );
    expect(claimed.rows[0].ids.length).toBeGreaterThan(0);
    const again = await db.query<{ ids: string[] }>(
      `select public.claim_due_reminders(10, statement_timestamp()) as ids`,
    );
    expect(again.rows[0].ids ?? []).toHaveLength(0);
  });

  it("opens one majority review task when a minor becomes an adult", async () => {
    const ctx = await firm();
    await asMaintenance(db);
    const person = await db.query<{ id: string }>(
      `insert into public.persons (organization_id, display_name, is_sample, date_of_birth, birth_date_precision)
       values ($1, 'Sample minor', true, '2010-01-01', 'day')
       returning id`,
      [ctx.orgId],
    );
    await db.query(
      `update public.persons
       set date_of_birth = '1990-01-01', birth_date_precision = 'day'
       where id = $1`,
      [person.rows[0].id],
    );
    const tasks = await db.query<{ title: string; audience: string; n: string }>(
      `select title, audience, count(*)::text as n
       from public.tasks
       where person_id = $1 and task_key = 'majority_review'
       group by title, audience`,
      [person.rows[0].id],
    );
    expect(tasks.rows).toEqual([{ title: "Majority review", audience: "internal", n: "1" }]);
    const copied = await db.query<{ title: string }>(
      `select title from public.tasks where person_id = $1 and title like '%1990%'`,
      [person.rows[0].id],
    );
    expect(copied.rows).toHaveLength(0);
  });
});
