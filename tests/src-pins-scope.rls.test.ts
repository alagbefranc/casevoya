// SRC-05 (pinned rule pack and form versions, upgrade preview and audited decision, packages keep
// their versions) and SRC-12 (support catalogue, unsupported programs inherit nothing).
// Every rule, form number, date and URL here is a FICTIONAL fixture, not IRCC content.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAnon, asMaintenance, asServiceRole, asUser, createTestDb, expectDbError, type TestDb } from "./helpers/postgres";

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

function token() {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

function email(label: string) {
  return `${label}-${token()}@example.test`;
}

function hash(char: string) {
  return char.repeat(64);
}

async function createUser(address: string) {
  await asMaintenance(db);
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), '{}'::jsonb)`,
    [id, address],
  );
  return id;
}

async function createOrg(ownerId: string) {
  await asUser(db, { userId: ownerId, aal: "aal2", totpAgeSeconds: 0 });
  const created = await db.query<{ id: string }>(`select (public.create_organization($1, $2, $3)).id as id`, [
    "Synthetic Legal Name",
    "Synthetic Firm",
    `f${token()}`,
  ]);
  return created.rows[0].id;
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

async function verifiedLicence(owner: string, consultant: string, orgId: string, membershipId: string) {
  await asUser(db, { userId: consultant, aal: "aal2", orgId, totpAgeSeconds: 0 });
  const credential = await db.query<{ id: string }>(
    `select public.declare_consultant_credential($1, 'RCIC'::public.licence_type, $2, 'Synthetic scope', $3) as id`,
    [membershipId, `R${token().slice(0, 6).toUpperCase()}`, PROOF],
  );
  await asUser(db, { userId: owner, aal: "aal2", orgId, totpAgeSeconds: 0 });
  await db.query(
    `select public.record_licence_check($1, $2, statement_timestamp(), 'active'::public.register_licence_status,
       $3, $4, false, false, null, $5, 'Synthetic reviewer note')`,
    [credential.rows[0].id, REGISTER, true, false, PROOF],
  );
}

type Firm = {
  owner: string;
  consultant: string;
  manager: string;
  orgId: string;
  ownerMembership: string;
  consultantMembership: string;
  managerMembership: string;
};

async function firm(): Promise<Firm> {
  const owner = await createUser(email("owner"));
  const consultant = await createUser(email("consultant"));
  const manager = await createUser(email("manager"));
  const orgId = await createOrg(owner);
  const consultantMembership = await activeMembership(orgId, consultant, "licensed_consultant", owner);
  const managerMembership = await activeMembership(orgId, manager, "case_manager", owner);
  await verifiedLicence(owner, consultant, orgId, consultantMembership);
  await asMaintenance(db);
  await db.query(`update public.organizations set sample_mode = false where id = $1`, [orgId]);
  const ownerRow = await db.query<{ id: string }>(
    `select id from public.memberships where organization_id = $1 and user_id = $2 and role = 'firm_owner'`,
    [orgId, owner],
  );
  return { owner, consultant, manager, orgId, ownerMembership: ownerRow.rows[0].id, consultantMembership, managerMembership };
}

const staff = (ctx: Firm, who: "owner" | "consultant" | "manager", totpAgeSeconds = 0) => ({
  userId: ctx[who],
  aal: "aal2" as const,
  orgId: ctx.orgId,
  totpAgeSeconds,
});

/** A firm snapshot of a fictional official page, with the "date modified" the page would state. */
async function snapshot(ctx: Firm, modifiedOn: string | null) {
  await asUser(db, staff(ctx, "owner"));
  const url = `https://www.canada.ca/en/fictional-src-${token()}.html`;
  const source = await db.query<{ id: string }>(
    `insert into public.official_sources (organization_id, publisher, canonical_url, jurisdiction, content_kind)
     values ($1, 'Immigration, Refugees and Citizenship Canada', $2, 'CA', 'form_instruction') returning id`,
    [ctx.orgId, url],
  );
  const snap = await db.query<{ id: string }>(
    `insert into public.source_snapshots (source_id, final_url, publisher, retrieved_at, modified_on, content_hash, retrieval_result)
     values ($1, $2, 'Immigration, Refugees and Citizenship Canada', '2026-10-20T12:00:00Z', $3, $4, 'success') returning id`,
    [source.rows[0].id, url, modifiedOn, hash(token().slice(0, 1).replace(/[^0-9a-f]/, "a"))],
  );
  return snap.rows[0].id;
}

async function definition(ctx: Firm, suffix: string) {
  await asUser(db, staff(ctx, "owner"));
  const row = await db.query<{ id: string }>(
    `insert into public.rule_definitions (organization_id, stable_key, category, jurisdiction)
     values ($1, $2, 'immigration_requirement', 'CA') returning id`,
    [ctx.orgId, `CA.FICTIONAL.${suffix}${token().toUpperCase().replace(/[^A-Z0-9]/g, "X")}`],
  );
  return row.rows[0].id;
}

/** A published firm rule version citing the snapshot. kind goes in output_value. */
async function publishedRule(ctx: Firm, definitionId: string, versionNumber: number, kind: string, snapshotId: string) {
  await asUser(db, staff(ctx, "owner"));
  const version = await db.query<{ id: string }>(
    `insert into public.rule_versions (definition_id, version_number, claim, output_value, effective_from, next_review_at, test_case_ids)
     values ($1, $2, 'FICTIONAL fixture. Not an immigration requirement.', jsonb_build_object('kind', $3::text),
       '2020-01-01T00:00:00Z', '2027-11-01T00:00:00Z', array['fictional-case']) returning id`,
    [definitionId, versionNumber, kind],
  );
  const id = version.rows[0].id;
  await db.query(`insert into public.rule_evidence (rule_version_id, snapshot_id, source_section) values ($1, $2, 'fictional-section')`, [id, snapshotId]);
  // SRC-03 gate: signed-in staff approve and publish only through Source review
  // (app.review_rule_version); this fixture records the approval from a maintenance session.
  await asMaintenance(db);
  await db.query(
    `insert into public.professional_reviews (organization_id, rule_version_id, reviewer_membership_id, decision, decided_at, rule_content_revision)
     values ($1, $2, $3, 'approved', '2026-10-16T15:00:00Z', 1)`,
    [ctx.orgId, id, ctx.ownerMembership],
  );
  await db.query(`update public.rule_versions set status = 'published' where id = $1`, [id]);
  return id;
}

async function publishedPack(ctx: Firm, programKey: string, packVersion: number, ruleVersions: string[], forms: unknown[]) {
  await asUser(db, staff(ctx, "owner"));
  const pack = await db.query<{ id: string }>(
    `insert into public.rule_pack_versions (organization_id, jurisdiction, program_key, pack_version, next_review_at, form_mappings)
     values ($1, 'CA', $2, $3, '2027-11-01T00:00:00Z', $4::jsonb) returning id`,
    [ctx.orgId, programKey, packVersion, JSON.stringify(forms)],
  );
  const id = pack.rows[0].id;
  for (const rule of ruleVersions) await db.query(`insert into public.rule_pack_items (pack_id, rule_version_id) values ($1, $2)`, [id, rule]);
  await asMaintenance(db);
  await db.query(`update public.rule_pack_versions set status = 'published' where id = $1`, [id]);
  await asUser(db, staff(ctx, "owner"));
  return id;
}

type Created = { ok: boolean; id: string; supported: boolean; rule_pack_version_id: string | null };

async function openForProgram(ctx: Firm, programKey: string, who: "owner" | "consultant" | "manager" = "manager") {
  await asUser(db, staff(ctx, who));
  const result = await db.query<{ result: Created }>(
    `select public.create_client_matter_for_program('Fictional Applicant', null, null, null, $1, $2) as result`,
    [ctx.consultantMembership, programKey],
  );
  return result.rows[0].result;
}

type RuleState = {
  matter_version: number;
  scope: { program_key: string; supported: boolean } | null;
  binding: null | {
    id: string;
    pack_id: string;
    pack_version: number;
    pack_live: boolean;
    forms: { form_number: string; date_modified: string | null; source_url: string | null; content_hash: string | null }[];
  };
  newer: null | {
    pack_id: string;
    pack_version: number;
    impact: {
      rules: { kind: string; change: string; from_version: number | null; to_version: number | null }[];
      matter_checklist: { id: string; label: string }[];
      matter_deadlines: unknown[];
      forms: { form_number: string; change: string; from_modified: string | null; to_modified: string | null }[];
    };
    decision: null | { decision: string; reason: string };
  };
};

async function ruleState(ctx: Firm, matterId: string, who: "owner" | "consultant" | "manager" = "consultant") {
  await asUser(db, staff(ctx, who));
  const state = await db.query<{ state: RuleState }>(`select public.matter_rule_state($1) as state`, [matterId]);
  return state.rows[0].state;
}

/** A firm with an approved, sourced pack v1 (checklist item + deadline rule, two forms). */
async function world() {
  const ctx = await firm();
  const program = `fictional_${token()}`;
  const formPage = await snapshot(ctx, "2025-01-15");
  const uncitedPage = await snapshot(ctx, "2025-02-01");
  const checklistRule = await definition(ctx, "CHECK");
  const deadlineRule = await definition(ctx, "DEAD");
  const fieldRule = await definition(ctx, "FIELD");
  const checklistV1 = await publishedRule(ctx, checklistRule, 1, "checklist_item", formPage);
  const deadlineV1 = await publishedRule(ctx, deadlineRule, 1, "deadline", formPage);
  const packV1 = await publishedPack(ctx, program, 1, [checklistV1, deadlineV1], [
    { form_number: "imm 9001", snapshot_id: formPage },
    { form_number: "IMM 9002", snapshot_id: uncitedPage },
    { form_number: "not a form" },
  ]);
  return { ctx, program, formPage, checklistRule, deadlineRule, fieldRule, checklistV1, deadlineV1, packV1 };
}

describe("SRC-05: pinned rule pack and form versions", () => {
  it("pins the program's current approved pack and its form versions at creation, and keeps them", async () => {
    const w = await world();
    const created = await openForProgram(w.ctx, w.program);
    expect(created.ok).toBe(true);
    expect(created.supported).toBe(true);
    expect(created.rule_pack_version_id).toBe(w.packV1);

    const state = await ruleState(w.ctx, created.id, "manager");
    expect(state.scope).toEqual({ program_key: w.program, supported: true });
    expect(state.binding?.pack_version).toBe(1);
    expect(state.newer).toBeNull();
    // The cited page's "date modified"; the uncited one stays Unknown; a malformed entry is skipped.
    expect(state.binding?.forms.map((form) => [form.form_number, form.date_modified])).toEqual([
      ["IMM 9001", "2025-01-15"],
      ["IMM 9002", null],
    ]);
    expect(state.binding?.forms[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.binding?.forms[1].source_url).toBeNull();

    await asUser(db, staff(w.ctx, "owner"));
    await expectDbError(
      () => db.query(`update public.matter_rule_bindings set form_versions = '[]'::jsonb where matter_id = $1`, [created.id]),
      /pinned form versions are kept/,
    );
  });

  it("previews a newer approved version, and records an audited decline and accept", async () => {
    const w = await world();
    const created = await openForProgram(w.ctx, w.program);
    const matterId = created.id;

    // A rule-derived checklist item from the pinned pack is allowed; one from outside it is not.
    await asMaintenance(db);
    const person = await db.query<{ person_id: string }>(
      `select person_id from public.matter_participants where matter_id = $1 and person_id is not null limit 1`,
      [matterId],
    );
    const request = await db.query<{ id: string }>(
      `insert into public.document_requests (organization_id, matter_id, person_id, purpose, explanation, acceptable_formats, source, rule_version_id, rule_item_key)
       values ($1, $2, $3, 'Fictional checklist item', 'Fictional explanation', array['pdf'], 'rule', $4, 'fictional_item') returning id`,
      [w.ctx.orgId, matterId, person.rows[0].person_id, w.checklistV1],
    );

    const formPageV2 = await snapshot(w.ctx, "2025-06-01");
    const checklistV2 = await publishedRule(w.ctx, w.checklistRule, 2, "checklist_item", formPageV2);
    const fieldV1 = await publishedRule(w.ctx, w.fieldRule, 1, "field", formPageV2);
    await asMaintenance(db);
    await expectDbError(
      () =>
        db.query(
          `insert into public.document_requests (organization_id, matter_id, person_id, purpose, explanation, acceptable_formats, source, rule_version_id, rule_item_key)
           values ($1, $2, $3, 'Fictional item', 'Fictional explanation', array['pdf'], 'rule', $4, 'fictional_other')`,
          [w.ctx.orgId, matterId, person.rows[0].person_id, fieldV1],
        ),
      /only from the rule pack pinned on this matter/,
    );
    await expectDbError(
      () =>
        db.query(
          `insert into public.deadlines (organization_id, matter_id, kind, label, due_on, timezone, rule_version_id, calculation_note)
           values ($1, $2, 'internal', 'Fictional deadline', '2027-01-01', 'America/Toronto', $3, 'Fictional calculation')`,
          [w.ctx.orgId, matterId, fieldV1],
        ),
      /only from the rule pack pinned on this matter/,
    );

    // An export made now records pack v1 and its forms.
    await asMaintenance(db);
    const exported = await db.query<{ id: string; rule_pack_version_id: string; form_versions: { form_number: string; date_modified: string | null }[] }>(
      `insert into public.matter_exports (organization_id, matter_id, idempotency_key, requested_by, rule_pack_version_id, form_versions)
       values ($1, $2, $3, $4, null, '[]'::jsonb) returning id, rule_pack_version_id, form_versions`,
      [w.ctx.orgId, matterId, `export-${token()}`, w.ctx.owner],
    );
    expect(exported.rows[0].rule_pack_version_id).toBe(w.packV1);
    expect(exported.rows[0].form_versions[0]).toMatchObject({ form_number: "IMM 9001", date_modified: "2025-01-15" });

    const packV2 = await publishedPack(w.ctx, w.program, 2, [checklistV2, w.deadlineV1, fieldV1], [{ form_number: "IMM 9001", snapshot_id: formPageV2 }]);

    const state = await ruleState(w.ctx, matterId);
    expect(state.newer?.pack_id).toBe(packV2);
    expect(state.newer?.pack_version).toBe(2);
    const rules = [...(state.newer?.impact.rules ?? [])].sort((a, b) => a.kind.localeCompare(b.kind));
    expect(rules.map((rule) => [rule.kind, rule.change, rule.from_version, rule.to_version])).toEqual([
      ["checklist_item", "changed", 1, 2],
      ["field", "added", null, 1],
    ]);
    expect(state.newer?.impact.matter_checklist.map((item) => item.id)).toEqual([request.rows[0].id]);
    expect(state.newer?.impact.forms).toEqual([
      { form_number: "IMM 9001", change: "changed", from_modified: "2025-01-15", to_modified: "2025-06-01" },
      { form_number: "IMM 9002", change: "removed", from_modified: null, to_modified: null },
    ]);

    // A case manager can't decide; a licensed consultant declines (no step-up needed to keep things as they are).
    await asUser(db, staff(w.ctx, "manager"));
    await expectDbError(
      () => db.query(`select public.decide_matter_rule_upgrade($1, $2, $3, 'declined', 'Not now')`, [matterId, packV2, state.matter_version]),
      /staff access denied/,
    );
    await asUser(db, staff(w.ctx, "consultant", 3600));
    await db.query(`select public.decide_matter_rule_upgrade($1, $2, $3, 'declined', 'Client already filed on v1')`, [matterId, packV2, state.matter_version]);
    const declined = await ruleState(w.ctx, matterId);
    expect(declined.binding?.pack_version).toBe(1);
    expect(declined.newer?.decision).toMatchObject({ decision: "declined", reason: "Client already filed on v1" });

    // Accepting needs a fresh step-up.
    await asUser(db, staff(w.ctx, "consultant", 3600));
    await expectDbError(
      () => db.query(`select public.decide_matter_rule_upgrade($1, $2, $3, 'accepted', 'Move to the new version')`, [matterId, packV2, declined.matter_version]),
      /step-up is required/,
    );
    // Not a newer version of the same pack.
    await asUser(db, staff(w.ctx, "consultant"));
    await expectDbError(
      () => db.query(`select public.decide_matter_rule_upgrade($1, $2, $3, 'accepted', 'Move back')`, [matterId, w.packV1, declined.matter_version]),
      /not a newer version/,
    );
    const accepted = await db.query<{ result: { decision: string; matter_version: number } }>(
      `select public.decide_matter_rule_upgrade($1, $2, $3, 'accepted', 'Move to the new version') as result`,
      [matterId, packV2, declined.matter_version],
    );
    expect(accepted.rows[0].result.decision).toBe("accepted");

    const after = await ruleState(w.ctx, matterId);
    expect(after.binding?.pack_version).toBe(2);
    expect(after.binding?.forms.map((form) => [form.form_number, form.date_modified])).toEqual([["IMM 9001", "2025-06-01"]]);
    expect(after.newer).toBeNull();

    await asMaintenance(db);
    const bindings = await db.query<{ pack: string; superseded: boolean; first_form: string | null }>(
      `select rule_pack_version_id as pack, superseded_at is not null as superseded, form_versions -> 0 ->> 'date_modified' as first_form
       from public.matter_rule_bindings where matter_id = $1 order by created_at`,
      [matterId],
    );
    expect(bindings.rows).toEqual([
      { pack: w.packV1, superseded: true, first_form: "2025-01-15" },
      { pack: packV2, superseded: false, first_form: "2025-06-01" },
    ]);
    const decisions = await db.query<{ decision: string; has_new: boolean }>(
      `select decision, new_binding_id is not null as has_new from public.matter_rule_upgrade_decisions where matter_id = $1 order by decided_at, created_at`,
      [matterId],
    );
    expect(decisions.rows.map((row) => row.decision).sort()).toEqual(["accepted", "declined"]);
    const audit = await db.query<{ action: string }>(
      `select action from public.audit_log where object_id = $1 and action like 'matter.rule_upgrade_%' order by occurred_at`,
      [matterId],
    );
    expect(audit.rows.map((row) => row.action).sort()).toEqual(["matter.rule_upgrade_accepted", "matter.rule_upgrade_declined"]);
    await expectDbError(() => db.query(`update public.matter_rule_upgrade_decisions set reason = 'changed' where matter_id = $1`, [matterId]), /append-only/);

    // The earlier export still records v1 and its form dates; it can't be re-pointed.
    const kept = await db.query<{ rule_pack_version_id: string; form_versions: { date_modified: string | null }[] }>(
      `select rule_pack_version_id, form_versions from public.matter_exports where id = $1`,
      [exported.rows[0].id],
    );
    expect(kept.rows[0].rule_pack_version_id).toBe(w.packV1);
    expect(kept.rows[0].form_versions[0].date_modified).toBe("2025-01-15");
    await expectDbError(
      () => db.query(`update public.matter_exports set rule_pack_version_id = $2 where id = $1`, [exported.rows[0].id, packV2]),
      /package used are kept/,
    );
    // Other columns still change (the job finishes); the versions stay.
    await db.query(`update public.matter_exports set status = 'failed', failed_at = now(), failure_reason = 'Fictional failure' where id = $1`, [exported.rows[0].id]);
    const later = await db.query<{ rule_pack_version_id: string }>(
      `insert into public.matter_exports (organization_id, matter_id, idempotency_key, requested_by)
       values ($1, $2, $3, $4) returning rule_pack_version_id`,
      [w.ctx.orgId, matterId, `export-${token()}`, w.ctx.owner],
    );
    expect(later.rows[0].rule_pack_version_id).toBe(packV2);
  });

  it("stamps a submission package with the pinned versions and keeps them after release", async () => {
    const w = await world();
    const created = await openForProgram(w.ctx, w.program);
    await asMaintenance(db);
    const handoff = await db.query<{ id: string; rule_pack_version_id: string; form_versions: { form_number: string }[] }>(
      `insert into public.submission_handoffs (organization_id, matter_id, package_label, channel, rule_pack_version_id)
       values ($1, $2, 'Fictional package', 'online_portal', null) returning id, rule_pack_version_id, form_versions`,
      [w.ctx.orgId, created.id],
    );
    expect(handoff.rows[0].rule_pack_version_id).toBe(w.packV1);
    expect(handoff.rows[0].form_versions.map((form) => form.form_number)).toEqual(["IMM 9001", "IMM 9002"]);
    const id = handoff.rows[0].id;
    // Releasing the package (its manifest pinned through the GOV functions) takes the pin again.
    await db.exec(`
      begin;
      insert into app.gov_write_nonce (row_id, txid) values ('${id}', txid_current());
      update public.submission_handoffs set manifest_sha256 = '${"e".repeat(64)}', manifest_file_count = 1, manifest_pinned_at = now() where id = '${id}';
      commit;
    `);
    const released = await db.query<{ rule_pack_version_id: string }>(`select rule_pack_version_id from public.submission_handoffs where id = $1`, [id]);
    expect(released.rows[0].rule_pack_version_id).toBe(w.packV1);
    await expectDbError(
      () =>
        db.exec(`
          begin;
          delete from app.gov_write_nonce where row_id = '${id}';
          insert into app.gov_write_nonce (row_id, txid) values ('${id}', txid_current());
          update public.submission_handoffs set form_versions = '[]'::jsonb where id = '${id}';
          commit;
        `),
      /package used are kept/,
    );
    await db.exec("rollback");
  });

  it("hides the pin from another firm and from clients' sessions", async () => {
    const w = await world();
    const created = await openForProgram(w.ctx, w.program);
    const other = await firm();
    await asUser(db, staff(other, "owner"));
    await expectDbError(() => db.query(`select public.matter_rule_state($1)`, [created.id]), /rule pin read denied/);
    const scopes = await db.query(`select 1 from public.matter_program_scopes where matter_id = $1`, [created.id]);
    expect(scopes.rows).toHaveLength(0);
    await asUser(db, { userId: w.ctx.manager, aal: "aal1", orgId: w.ctx.orgId });
    await expectDbError(() => db.query(`select public.matter_rule_state($1)`, [created.id]), /rule pin read denied/);
  });
});

describe("SRC-12: support catalogue and unsupported programs", () => {
  async function platformAdmin() {
    const admin = await createUser(email("admin"));
    await asMaintenance(db);
    await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'Synthetic admin')`, [admin]);
    return admin;
  }

  async function catalogueProgram(admin: string, key: string, label: string) {
    await asServiceRole(db);
    await db.query(
      `select public.save_support_catalogue_entry('program', $1, $2, 'CA', 'ircc_application', null, null, null, null, 50, true, $3)`,
      [key, label, admin],
    );
  }

  it("opens a matter for an unsupported program with no pack, no checklist and no inherited rules", async () => {
    const w = await world();
    const admin = await platformAdmin();
    const unsupported = `fictional_unsupported_${token()}`;
    await catalogueProgram(admin, unsupported, "Fictional unsupported program");

    const created = await openForProgram(w.ctx, unsupported);
    expect(created.ok).toBe(true);
    expect(created.supported).toBe(false);
    expect(created.rule_pack_version_id).toBeNull();

    const state = await ruleState(w.ctx, created.id);
    expect(state.binding).toBeNull();
    expect(state.scope).toEqual({ program_key: unsupported, supported: false });

    await asMaintenance(db);
    const pins = await db.query(`select 1 from public.matter_rule_bindings where matter_id = $1`, [created.id]);
    expect(pins.rows).toHaveLength(0);
    const requests = await db.query(`select 1 from public.document_requests where matter_id = $1`, [created.id]);
    expect(requests.rows).toHaveLength(0);
    const audit = await db.query(`select 1 from public.audit_log where object_id = $1 and action = 'matter.program_scope_unsupported'`, [created.id]);
    expect(audit.rows).toHaveLength(1);

    // Another program's pack can't be pinned onto it, by program selection or directly.
    await asUser(db, staff(w.ctx, "consultant"));
    const version = await db.query<{ version: number }>(`select version from public.matters where id = $1`, [created.id]);
    await expectDbError(
      () => db.query(`select public.select_matter_program($1, $2, $3, 'Use the other program')`, [created.id, w.packV1, version.rows[0].version]),
      /cannot inherit another program/,
    );
    await asUser(db, staff(w.ctx, "owner"));
    await expectDbError(
      () => db.query(`insert into public.matter_rule_bindings (organization_id, matter_id, rule_pack_version_id) values ($1, $2, $3)`, [w.ctx.orgId, created.id, w.packV1]),
      /cannot inherit another program/,
    );
    // Nor a rule-derived checklist item from another pack.
    await asMaintenance(db);
    const person = await db.query<{ person_id: string }>(
      `select person_id from public.matter_participants where matter_id = $1 and person_id is not null limit 1`,
      [created.id],
    );
    await expectDbError(
      () =>
        db.query(
          `insert into public.document_requests (organization_id, matter_id, person_id, purpose, explanation, acceptable_formats, source, rule_version_id, rule_item_key)
           values ($1, $2, $3, 'Fictional item', 'Fictional explanation', array['pdf'], 'rule', $4, 'fictional_item')`,
          [w.ctx.orgId, created.id, person.rows[0].person_id, w.checklistV1],
        ),
      /only from the rule pack pinned on this matter/,
    );
    // A staff checklist item (not from a rule) is still fine.
    await db.query(
      `insert into public.document_requests (organization_id, matter_id, person_id, purpose, explanation, acceptable_formats, source)
       values ($1, $2, $3, 'Fictional staff item', 'Fictional explanation', array['pdf'], 'staff')`,
      [w.ctx.orgId, created.id, person.rows[0].person_id],
    );
  });

  it("refuses an unknown program and relabelling an existing matter", async () => {
    const w = await world();
    await asUser(db, staff(w.ctx, "manager"));
    await expectDbError(
      () =>
        db.query(`select public.create_client_matter_for_program('Fictional Applicant', null, null, null, $1, $2)`, [
          w.ctx.consultantMembership,
          `fictional_unknown_${token()}`,
        ]),
      /choose a program from the support catalogue/,
    );
    const created = await openForProgram(w.ctx, w.program);
    await asUser(db, staff(w.ctx, "owner"));
    await expectDbError(
      () => db.query(`select app.record_matter_program_scope($1, $2)`, [created.id, w.program]),
      /recorded only when the matter is opened/,
    );
  });

  it("derives support from approved, sourced packs: public view, firm view, and writes by platform admins only", async () => {
    const w = await world();
    const admin = await platformAdmin();
    const unsupported = `fictional_catalogue_${token()}`;
    await catalogueProgram(admin, unsupported, "Fictional catalogued program");

    type Catalogue = {
      programs: { key: string; supported: boolean; pack_scope: string | null; official: unknown; catalogued: boolean }[];
      jurisdictions: { key: string; supported: boolean; firm_practises: boolean }[];
      case_types: { key: string; supported: boolean }[];
      firm_jurisdictions: string[] | null;
    };

    await asAnon(db);
    const anon = (await db.query<{ c: Catalogue }>(`select public.support_catalogue() as c`)).rows[0].c;
    expect(anon.firm_jurisdictions).toBeNull();
    expect(anon.programs.find((row) => row.key === unsupported)).toMatchObject({ supported: false, catalogued: true, official: null });
    // The firm's own pack is not part of the public catalogue.
    expect(anon.programs.find((row) => row.key === w.program)).toBeUndefined();
    expect(anon.jurisdictions.map((row) => row.key)).toContain("CA-QC");
    expect(anon.case_types.map((row) => row.key)).toEqual(["ircc_application", "irb_proceeding", "federal_court"]);
    await expectDbError(() => db.query(`select 1 from public.support_catalogue_entries`), /permission denied/);

    await asUser(db, staff(w.ctx, "manager"));
    const firmView = (await db.query<{ c: Catalogue }>(`select public.support_catalogue($1) as c`, [w.ctx.orgId])).rows[0].c;
    expect(firmView.firm_jurisdictions).toEqual(["CA"]);
    expect(firmView.programs.find((row) => row.key === w.program)).toMatchObject({ supported: true, pack_scope: "firm", catalogued: false });
    expect(firmView.jurisdictions.find((row) => row.key === "CA")).toMatchObject({ supported: true, firm_practises: true });
    expect(firmView.jurisdictions.find((row) => row.key === "CA-ON")).toMatchObject({ supported: false, firm_practises: false });
    const rows = await db.query(`select 1 from public.support_catalogue_entries`);
    expect(rows.rows).toHaveLength(0);

    // Another firm's staff asking for this firm's view get the public catalogue.
    const other = await firm();
    await asUser(db, staff(other, "owner"));
    const spoofed = (await db.query<{ c: Catalogue }>(`select public.support_catalogue($1) as c`, [w.ctx.orgId])).rows[0].c;
    expect(spoofed.firm_jurisdictions).toBeNull();
    expect(spoofed.programs.find((row) => row.key === w.program)).toBeUndefined();

    // Writes: firm staff never; the service role must name a platform admin.
    await asUser(db, staff(w.ctx, "owner"));
    await expectDbError(
      () => db.query(`select public.save_support_catalogue_entry('program', 'fictional_x', 'X', 'CA')`),
      /platform admin access denied/,
    );
    await asServiceRole(db);
    await expectDbError(() => db.query(`select public.save_support_catalogue_entry('program', 'fictional_x', 'X', 'CA')`), /name the platform admin who records this/);
    await expectDbError(
      () => db.query(`select public.save_support_catalogue_entry('program', 'fictional_x', 'X', 'CA', null, null, 'Fictional official name', null, null, null, true, $1)`, [admin]),
      /needs the snapshot of its official page/,
    );

    // The official page must be a deep link with a platform snapshot; a homepage is refused.
    const home = await db.query<{ id: string }>(
      `insert into public.official_sources (publisher, canonical_url, jurisdiction, content_kind) values ('Immigration, Refugees and Citizenship Canada', $1, 'CA', 'program_guidance') returning id`,
      [`https://www.canada.ca/en/immigration-refugees-citizenship.html`],
    );
    const homeSnap = await db.query<{ id: string }>(
      `insert into public.source_snapshots (source_id, final_url, publisher, retrieved_at, content_hash, retrieval_result)
       values ($1, 'https://www.canada.ca/en/immigration-refugees-citizenship.html', 'Immigration, Refugees and Citizenship Canada', now(), $2, 'success') returning id`,
      [home.rows[0].id, hash("c")],
    );
    await expectDbError(
      () => db.query(`select public.save_support_catalogue_entry('program', 'fictional_x', 'X', 'CA', null, $1, 'Fictional official name', null, null, null, true, $2)`, [homeSnap.rows[0].id, admin]),
      /official deep link, not a homepage/,
    );
    const deepUrl = `https://www.canada.ca/en/immigration-refugees-citizenship/services/fictional-${token()}.html`;
    const deep = await db.query<{ id: string }>(
      `insert into public.official_sources (publisher, canonical_url, jurisdiction, content_kind) values ('Immigration, Refugees and Citizenship Canada', $1, 'CA', 'program_guidance') returning id`,
      [deepUrl],
    );
    const deepSnap = await db.query<{ id: string }>(
      `insert into public.source_snapshots (source_id, final_url, publisher, retrieved_at, modified_on, content_hash, retrieval_result)
       values ($1, $2, 'Immigration, Refugees and Citizenship Canada', '2026-10-25T12:00:00Z', '2026-01-02', $3, 'success') returning id`,
      [deep.rows[0].id, deepUrl, hash("d")],
    );
    await db.query(
      `select public.save_support_catalogue_entry('program', $1, 'Fictional catalogued program', 'CA', 'ircc_application', $2, 'Fictional official name', 'fictional-section', null, 50, true, $3)`,
      [unsupported, deepSnap.rows[0].id, admin],
    );
    await asAnon(db);
    const named = (await db.query<{ c: { programs: { key: string; official: Record<string, unknown> | null }[] } }>(`select public.support_catalogue() as c`)).rows[0].c;
    expect(named.programs.find((row) => row.key === unsupported)?.official).toMatchObject({
      name: "Fictional official name",
      url: deepUrl,
      section: "fictional-section",
      modified_on: "2026-01-02",
      reviewed: false,
    });
    await asMaintenance(db);
    const saved = await db.query(`select 1 from public.audit_log where action = 'support_catalogue.saved' and context ->> 'scope_key' = $1`, [unsupported]);
    expect(saved.rows.length).toBeGreaterThanOrEqual(2);
  });
});

describe("SRC-05 / SRC-12 on the SRC-03 gate: one definition of live, one homepage rule", () => {
  type FirmCatalogue = { programs: { key: string; supported: boolean; pack_version: number | null }[] };

  async function firmCatalogue(ctx: Firm) {
    await asUser(db, staff(ctx, "manager"));
    return (await db.query<{ c: FirmCatalogue }>(`select public.support_catalogue($1) as c`, [ctx.orgId])).rows[0].c;
  }

  it("counts a pack only while it is published and every rule version in it is live", async () => {
    const w = await world();
    const created = await openForProgram(w.ctx, w.program);
    expect((await ruleState(w.ctx, created.id)).binding?.pack_live).toBe(true);

    // A newer pack whose new rule version is then suspended is not offered, and can't be accepted.
    const formPageV2 = await snapshot(w.ctx, "2025-06-01");
    const checklistV2 = await publishedRule(w.ctx, w.checklistRule, 2, "checklist_item", formPageV2);
    const packV2 = await publishedPack(w.ctx, w.program, 2, [checklistV2, w.deadlineV1], []);
    expect((await ruleState(w.ctx, created.id)).newer?.pack_id).toBe(packV2);
    expect((await firmCatalogue(w.ctx)).programs.find((row) => row.key === w.program)).toMatchObject({ supported: true, pack_version: 2 });
    await asMaintenance(db);
    await db.query(`update public.rule_versions set status = 'suspended' where id = $1`, [checklistV2]);
    const state = await ruleState(w.ctx, created.id);
    expect(state.newer).toBeNull();
    expect((await firmCatalogue(w.ctx)).programs.find((row) => row.key === w.program)).toMatchObject({ supported: true, pack_version: 1 });
    await asUser(db, staff(w.ctx, "consultant"));
    await expectDbError(
      () => db.query(`select public.decide_matter_rule_upgrade($1, $2, $3, 'accepted', 'Move to the new version')`, [created.id, packV2, state.matter_version]),
      /not approved for this firm/,
    );

    // Once a rule version in the pinned pack is superseded, the pin stays but reads as no longer
    // live, and the program is no longer supported for new matters.
    await asMaintenance(db);
    await db.query(`update public.rule_versions set status = 'superseded' where id = $1`, [w.checklistV1]);
    const after = await ruleState(w.ctx, created.id);
    expect(after.binding?.pack_version).toBe(1);
    expect(after.binding?.pack_live).toBe(false);
    expect((await firmCatalogue(w.ctx)).programs.find((row) => row.key === w.program)).toBeUndefined();
    await asUser(db, staff(w.ctx, "manager"));
    await expectDbError(
      () =>
        db.query(`select public.create_client_matter_for_program('Fictional Applicant', null, null, null, $1, $2)`, [
          w.ctx.consultantMembership,
          w.program,
        ]),
      /choose a program from the support catalogue/,
    );
  });

  it("does not count a review-due pack, as review-due rule versions are not live", async () => {
    const w = await world();
    await asMaintenance(db);
    const selectable = async () =>
      (await db.query<{ ok: boolean }>(`select app.pack_is_selectable($1, $2) as ok`, [w.packV1, w.ctx.orgId])).rows[0].ok;
    expect(await selectable()).toBe(true);
    await db.query(`update public.rule_pack_versions set status = 'review_due' where id = $1`, [w.packV1]);
    expect((await firmCatalogue(w.ctx)).programs.find((row) => row.key === w.program)).toBeUndefined();
    // The direct program-selection path follows the same rule (Francis, 2026-10-25).
    await asMaintenance(db);
    expect(await selectable()).toBe(false);
  });

  it("refuses the same homepages as app.official_claim_url, and keeps provincial deep pages", async () => {
    await asMaintenance(db);
    const urls = [
      "https://www.canada.ca",
      "https://www.canada.ca/en.html",
      "https://www.canada.ca/en/immigration-refugees-citizenship.html",
      "https://www.canada.ca/en/fictional-src-page.html",
      "https://laws-lois.justice.gc.ca/eng/",
      "https://www.canada.ca/en/immigration-refugees-citizenship/services/fictional-page.html",
      "https://laws-lois.justice.gc.ca/eng/regulations/fictional/page.html",
    ];
    const rows = await db.query<{ url: string; deep: boolean; claim: boolean }>(
      `select u as url, app.src_deep_official_url(u) as deep, app.official_claim_url(u) is not null as claim from unnest($1::text[]) u`,
      [urls],
    );
    for (const row of rows.rows) expect(row.deep, row.url).toBe(row.claim);
    expect(rows.rows.filter((row) => row.deep).map((row) => row.url)).toEqual(urls.slice(5));
    const provincial = await db.query<{ home: boolean; deep: boolean }>(
      `select app.src_deep_official_url('https://www.ontario.ca/en/') as home,
              app.src_deep_official_url('https://www.ontario.ca/page/fictional-program/fictional-stream') as deep`,
    );
    expect(provincial.rows[0]).toEqual({ home: false, deep: true });
  });
});
