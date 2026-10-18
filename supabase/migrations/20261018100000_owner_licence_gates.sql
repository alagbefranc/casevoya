-- Licence-gated rules accept a firm owner who holds a CICC licence (decision 2026-10-18).
--
-- 20261018050000_owner_licence_and_proofs.sql let a firm owner declare their own licence (a solo
-- RCIC signs up as the owner, and a membership has one role) and deferred the other
-- licence-gated role checks. Those checks required the licensed_consultant role, so a solo owner
-- could not be a matter's responsible consultant, open a matter, file, record an outcome, confirm
-- a legal date, publish intake, approve an agreement template, or approve a rule review.
--
-- app.membership_is_licensed(membership) is the one test: an active licensed_consultant
-- membership (unchanged: its credential is checked by the existing licence locks), or an active
-- firm_owner membership with a CICC credential on that membership that is not revoked,
-- suspended, inactive, or not entitled (status or register/discipline fields). An owner with no
-- credential, or a blocked one, is not licensed. app.actor_is_licensed(org) applies it to the
-- signed-in user, and app.require_licensed_staff(org, step_up) is require_active_staff for it.
-- app.actor_licence_block_status still locks a blocked owner or consultant where it already did.
--
-- Each function below is copied from its latest definition (the file is named above it) with
-- only the role condition changed. create or replace keeps grants and the triggers bound to
-- them. Checks whose role lists include case_manager (creator and assigned-staff access paths)
-- are not licence checks and are left alone. No table, policy, or RLS setting changes.

create function app.membership_is_licensed(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mem
    where mem.id = p_membership_id
      and mem.status = 'active'
      and (
        mem.role = 'licensed_consultant'
        or (
          mem.role = 'firm_owner'
          and exists (
            select 1
            from public.consultant_credentials credential
            where credential.membership_id = mem.id
              and credential.organization_id = mem.organization_id
              and not app.licence_status_blocks(credential.status)
              and credential.discipline_revoked is false
              and credential.discipline_suspended is false
              and credential.register_status is distinct from 'inactive'
              and credential.entitlement_to_practise is not false
          )
        )
      )
  );
$$;
comment on function app.membership_is_licensed(uuid) is
  'True for an active licensed_consultant membership, or an active firm_owner membership holding a CICC credential that is not revoked, suspended, inactive, or not entitled.';
revoke all on function app.membership_is_licensed(uuid) from public;
grant execute on function app.membership_is_licensed(uuid) to authenticated, service_role;

create function app.actor_is_licensed(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mem
    where mem.organization_id = p_org
      and mem.user_id = (select auth.uid())
      and mem.status = 'active'
      and app.membership_is_licensed(mem.id)
  );
$$;
comment on function app.actor_is_licensed(uuid) is
  'The signed-in user has a licensed membership (app.membership_is_licensed) in this firm.';
revoke all on function app.actor_is_licensed(uuid) from public;
grant execute on function app.actor_is_licensed(uuid) to authenticated, service_role;

-- require_active_staff for a licensed membership: the same sign-in, active-firm, MFA, and
-- step-up checks, with the role test widened from licensed_consultant to a licensed membership.
create function app.require_licensed_staff(p_org uuid, p_step_up boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_active_staff(
    p_org,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    p_step_up
  );
  if app.actor_is_licensed(p_org) is distinct from true then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.require_licensed_staff(uuid, boolean) from public;

-- From 20261017170000_matter_lifecycle.sql. The responsible consultant is a licensed membership.
create or replace function app.validate_new_matter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cred public.credential_status;
  pack public.rule_pack_versions%rowtype;
  codes text[];
begin
  if new.responsible_consultant_membership_id is not null then
    if not exists (
      select 1
      from public.memberships mem
      where mem.id = new.responsible_consultant_membership_id
        and mem.organization_id = new.organization_id
        and app.membership_is_licensed(mem.id)
        and mem.status = 'active'
    ) then
      raise exception 'the responsible consultant must be an active licensed consultant' using errcode = '42501';
    end if;
    select credential.status into cred
    from public.consultant_credentials credential
    where credential.membership_id = new.responsible_consultant_membership_id
      and credential.organization_id = new.organization_id;
    if cred is not null and app.licence_status_blocks(cred) then
      raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
        using errcode = '42501';
    end if;
  end if;

  if new.program_pack_id is not null then
    select * into pack from public.rule_pack_versions where id = new.program_pack_id;
    select org.jurisdiction_codes into codes
    from public.organizations org
    where org.id = new.organization_id;
    if pack.id is null
       or pack.status not in ('published', 'review_due')
       or (pack.organization_id is not null and pack.organization_id is distinct from new.organization_id)
       or not exists (
         select 1
         from unnest(coalesce(codes, array[]::text[])) firm_code
         where pack.jurisdiction = firm_code
            or pack.jurisdiction like firm_code || '-%'
       ) then
      raise exception 'program selection must be a published pack for a jurisdiction this firm practises'
        using errcode = '42501';
    end if;
  end if;

  if new.on_hold
     or new.engagement_status is distinct from 'pending'
     or new.government_status is distinct from 'not_recorded'
     or new.outcome is not null
     or new.predecessor_matter_id is not null
     or new.retention_on is not null then
    raise exception 'those matter fields are set by a lifecycle function' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- From 20261017170000_matter_lifecycle.sql. A regulated edge needs a licensed actor.
create or replace function app.transition_matter_stage(
  p_matter_id uuid,
  p_to_stage public.matter_stage,
  p_expected_version integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  evidence uuid;
  override_id uuid;
  new_version integer;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a stage change needs a reason' using errcode = '22023';
  end if;

  select * into matter
  from public.matters
  where id = p_matter_id
  for update;

  if matter.id is null
     or app.in_active_org(matter.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.can_read_matter(matter.id) is distinct from true
     or app.has_org_role(
       matter.organization_id,
       array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
     ) is distinct from true then
    raise exception 'matter stage change denied' using errcode = '42501';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  if app.matter_stage_is_regulated(matter.stage, p_to_stage)
     and app.actor_is_licensed(matter.organization_id) is distinct from true then
    raise exception 'submitted and later stages require a licensed consultant' using errcode = '42501';
  end if;
  if app.matter_stage_is_regulated(matter.stage, p_to_stage)
     and app.actor_licence_blocks_regulated_action(matter.organization_id) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
      using errcode = '42501';
  end if;
  if app.matter_stage_transition_allowed(matter.stage, p_to_stage) is distinct from true then
    raise exception 'that stage transition is not allowed' using errcode = '42501';
  end if;

  evidence := app.stage_entry_evidence_id(matter.id, p_to_stage);
  if evidence is null then
    select nonce.override_id into override_id
    from app.matter_stage_override_nonce nonce
    where nonce.matter_id = matter.id
      and nonce.txid = txid_current();
    if override_id is null then
      raise exception 'stage entry evidence is missing' using errcode = '42501';
    end if;
  else
    select nonce.override_id into override_id
    from app.matter_stage_override_nonce nonce
    where nonce.matter_id = matter.id
      and nonce.txid = txid_current();
  end if;

  insert into app.matter_stage_transition_nonce (matter_id, txid)
  values (matter.id, txid_current())
  on conflict (matter_id) do update set txid = excluded.txid;

  update public.matters
  set stage = p_to_stage
  where id = matter.id
  returning version into new_version;

  delete from app.matter_stage_transition_nonce where matter_id = matter.id;
  delete from app.matter_stage_override_nonce where matter_id = matter.id;

  insert into public.matter_stage_transitions (
    organization_id, matter_id, from_stage, to_stage, reason, evidence_id, override_id, actor_user_id, from_version
  ) values (
    matter.organization_id,
    matter.id,
    matter.stage,
    p_to_stage,
    btrim(p_reason),
    evidence,
    override_id,
    (select auth.uid()),
    matter.version
  );

  perform app.record_audit_event(
    matter.organization_id,
    case
      when matter.stage = 'closed' and p_to_stage = 'engagement_pending' then 'matter.reopened'
      when override_id is not null then 'matter.stage_override'
      else 'matter.stage_transition'
    end,
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object(
      'from_stage', matter.stage,
      'to_stage', p_to_stage,
      'evidence_id', evidence,
      'override_id', override_id
    )
  );

  if p_to_stage = 'closed' then
    perform app.enqueue_event(
      matter.organization_id,
      'matter',
      matter.id,
      'matter.closed',
      jsonb_build_object('matter_id', matter.id),
      new_version,
      'matter.closed:' || matter.id::text || ':' || matter.version::text
    );
  end if;
  return new_version;
end;
$$;

-- From 20261017170000_matter_lifecycle.sql. A regulated override needs a licensed actor.
create or replace function app.override_matter_stage(
  p_matter_id uuid,
  p_to_stage public.matter_stage,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  permitted public.org_role;
  override_id uuid;
  new_version integer;
  blocked public.credential_status;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a stage change needs a reason' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'matter stage change denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    true
  );
  if app.matter_stage_is_regulated(matter.stage, p_to_stage) then
    perform app.require_licensed_staff(matter.organization_id, true);
    permitted := 'licensed_consultant';
  elsif app.has_org_role(matter.organization_id, array['licensed_consultant']::public.org_role[]) then
    permitted := 'licensed_consultant';
  else
    permitted := 'firm_owner';
  end if;

  insert into public.matter_stage_overrides (
    organization_id, matter_id, from_stage, to_stage, reason, permitted_role, actor_user_id
  ) values (
    matter.organization_id,
    matter.id,
    matter.stage,
    p_to_stage,
    btrim(p_reason),
    permitted,
    (select auth.uid())
  )
  returning id into override_id;

  insert into app.matter_stage_override_nonce (matter_id, txid, override_id)
  values (matter.id, txid_current(), override_id)
  on conflict (matter_id) do update
    set txid = excluded.txid, override_id = excluded.override_id;

  new_version := app.transition_matter_stage(p_matter_id, p_to_stage, p_expected_version, p_reason);
  return jsonb_build_object('ok', true, 'version', new_version, 'override_id', override_id, 'permitted_role', permitted);
exception
  when insufficient_privilege then
    if sqlerrm ilike '%licence blocks%' then
      blocked := app.actor_licence_block_status(matter.organization_id);
      perform app.record_audit_event(
        matter.organization_id,
        'licence.regulated_action_blocked',
        'public.matters',
        p_matter_id,
        'denied',
        jsonb_build_object('action', 'matter.stage_override', 'to_stage', p_to_stage, 'credential_status', blocked)
      );
      return jsonb_build_object('ok', false, 'blocked', 'licence', 'credential_status', blocked);
    end if;
    raise;
end;
$$;

-- From 20261017170000_matter_lifecycle.sql. The responsible consultant is a licensed membership.
create or replace function app.assign_responsible_consultant(
  p_matter_id uuid,
  p_membership_id uuid,
  p_expected_version integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  cred public.credential_status;
  new_version integer;
  changing boolean;
begin
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'consultant assignment denied' using errcode = '42501';
  end if;
  changing := matter.responsible_consultant_membership_id is not null
    and matter.responsible_consultant_membership_id is distinct from p_membership_id;
  perform app.require_active_staff(
    matter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    changing
  );
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  if not exists (
    select 1 from public.memberships mem
    where mem.id = p_membership_id
      and mem.organization_id = matter.organization_id
      and app.membership_is_licensed(mem.id)
      and mem.status = 'active'
  ) then
    raise exception 'the responsible consultant must be an active licensed consultant' using errcode = '42501';
  end if;
  select credential.status into cred
  from public.consultant_credentials credential
  where credential.membership_id = p_membership_id
    and credential.organization_id = matter.organization_id;
  if cred is not null and app.licence_status_blocks(cred) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
      using errcode = '42501';
  end if;

  perform app.open_matter_column(matter.id, 'consultant');
  update public.matters
  set responsible_consultant_membership_id = p_membership_id
  where id = matter.id
  returning version into new_version;
  perform app.close_matter_column(matter.id);

  insert into public.matter_participants (organization_id, matter_id, membership_id, role)
  values (matter.organization_id, matter.id, p_membership_id, 'consultant')
  on conflict (matter_id, membership_id, role) do nothing;

  perform app.record_audit_event(
    matter.organization_id,
    'matter.consultant_assigned',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('membership_id', p_membership_id, 'replaced', changing)
  );
  return new_version;
end;
$$;

-- From 20261017170000_matter_lifecycle.sql. Recording an outcome needs a licensed actor.
create or replace function app.record_matter_outcome(
  p_matter_id uuid,
  p_outcome public.matter_outcome,
  p_expected_version integer,
  p_note text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_version integer;
begin
  if p_note is null or length(btrim(p_note)) < 3 then
    raise exception 'an outcome needs a note' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'outcome denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(matter.organization_id, true);
  if app.actor_licence_blocks_regulated_action(matter.organization_id) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
      using errcode = '42501';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  if app.stage_entry_evidence_id(matter.id, 'decision_review') is null then
    raise exception 'an outcome needs official decision evidence' using errcode = '42501';
  end if;
  perform app.open_matter_column(matter.id, 'outcome');
  update public.matters set outcome = p_outcome where id = matter.id returning version into new_version;
  perform app.close_matter_column(matter.id);
  perform app.record_audit_event(
    matter.organization_id,
    'matter.outcome_recorded',
    'public.matters',
    matter.id,
    'success',
    jsonb_build_object('outcome', p_outcome, 'stage', matter.stage, 'government_status', matter.government_status)
  );
  return new_version;
end;
$$;

-- From 20261017140700_firm_onboarding.sql. The source may be an owner who holds a credential (blocked
-- or not: a blocked licence is the reason to move matters); the target is a licensed membership.
create or replace function app.reassign_consultant_matters(
  p_from_membership uuid,
  p_to_membership uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  source public.memberships%rowtype;
  target public.memberships%rowtype;
  target_status public.credential_status;
  moved integer := 0;
  rec record;
begin
  perform app.require_firm_owner_step_up(org);
  if p_reason is null or length(btrim(p_reason)) < 8 then
    raise exception 'reassignment needs a reason' using errcode = '22023';
  end if;
  select * into source from public.memberships where id = p_from_membership and organization_id = org;
  select * into target from public.memberships where id = p_to_membership and organization_id = org;
  if source.id is null or target.id is null
     or not (
       source.role = 'licensed_consultant'
       or (
         source.role = 'firm_owner'
         and exists (
           select 1 from public.consultant_credentials credential
           where credential.membership_id = source.id
             and credential.organization_id = source.organization_id
         )
       )
     )
     or app.membership_is_licensed(target.id) is distinct from true
     or source.status is distinct from 'active'
     or target.status is distinct from 'active'
     or source.id = target.id then
    raise exception 'reassignment denied' using errcode = '42501';
  end if;
  select credential.status into target_status
  from public.consultant_credentials credential
  where credential.membership_id = target.id;
  if target_status is distinct from 'verified' or app.licence_status_blocks(target_status) then
    raise exception 'the receiving consultant needs a verified licence' using errcode = '42501';
  end if;

  for rec in
    select participant.id, participant.matter_id
    from public.matter_participants participant
    where participant.organization_id = org
      and participant.membership_id = source.id
      and participant.role = 'consultant'
  loop
    if exists (
      select 1 from public.matter_participants existing
      where existing.matter_id = rec.matter_id
        and existing.membership_id = target.id
        and existing.role = 'consultant'
    ) then
      delete from public.matter_participants where id = rec.id;
    else
      update public.matter_participants
         set membership_id = target.id
       where id = rec.id;
    end if;
    moved := moved + 1;
  end loop;

  perform app.record_audit_event(
    org,
    'licence.matters_reassigned',
    'public.memberships',
    source.id,
    'success',
    jsonb_build_object('to_membership_id', target.id, 'count', moved)
  );
  return moved;
end;
$$;

-- From 20261017170200_tasks_deadlines.sql. Confirming a legal or correspondence date needs a licensed actor.
create or replace function app.confirm_deadline(p_deadline_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deadline public.deadlines%rowtype;
  verifier uuid;
  new_version integer;
begin
  select * into deadline from public.deadlines where id = p_deadline_id for update;
  if deadline.id is null or app.can_read_matter(deadline.matter_id) is distinct from true then
    raise exception 'deadline confirmation denied' using errcode = '42501';
  end if;
  if deadline.version is distinct from p_expected_version then
    raise exception 'deadline version conflict' using errcode = '40001';
  end if;
  if deadline.kind in ('legal', 'correspondence') then
    perform app.require_licensed_staff(deadline.organization_id, true);
    if app.actor_licence_blocks_regulated_action(deadline.organization_id) then
      raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
        using errcode = '42501';
    end if;
    if deadline.source_url is null and deadline.rule_version_id is null then
      raise exception 'a legal or correspondence date stays tentative without an official source or published rule'
        using errcode = '42501';
    end if;
    perform app.assert_deadline_source(deadline.source_url, deadline.source_retrieved_on, deadline.rule_version_id);
  else
    perform app.require_active_staff(
      deadline.organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
      true
    );
  end if;
  select mem.id into verifier
  from public.memberships mem
  where mem.organization_id = deadline.organization_id
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and mem.role = any (app.staff_roles())
  limit 1;
  update public.deadlines
  set verification = 'confirmed',
      verifying_membership_id = verifier
  where id = deadline.id
  returning version into new_version;
  perform app.record_audit_event(
    deadline.organization_id,
    'deadline.confirmed',
    'public.deadlines',
    deadline.id,
    'success',
    jsonb_build_object('kind', deadline.kind, 'rule_version_id', deadline.rule_version_id)
  );
  return new_version;
end;
$$;

-- From 20261017170100_intake_responses.sql. Publishing needs a licensed actor and records that membership.
create or replace function app.save_intake_template(
  p_stable_key text,
  p_title text,
  p_locale text,
  p_workflow_category public.intake_workflow_category,
  p_schema jsonb,
  p_publish boolean,
  p_effective_on date,
  p_rule_pack_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  reviewer uuid;
  next_number integer;
  new_id uuid;
begin
  if org is null then
    raise exception 'intake template denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    org,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    coalesce(p_publish, false)
  );
  if p_stable_key is null or p_stable_key !~ '^[a-z][a-z0-9_]{1,80}$' then
    raise exception 'intake template key is not usable' using errcode = '22023';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'intake template title is required' using errcode = '22023';
  end if;
  if p_locale not in ('en-CA', 'fr-CA') then
    raise exception 'locale must be en-CA or fr-CA' using errcode = '22023';
  end if;
  if app.intake_schema_ok(p_schema) is distinct from true then
    raise exception 'intake schema is not usable' using errcode = '22023';
  end if;
  if p_rule_pack_version_id is not null
     and app.pack_is_selectable(p_rule_pack_version_id, org) is distinct from true then
    raise exception 'program selection must be a published pack for a jurisdiction this firm practises'
      using errcode = '42501';
  end if;

  if coalesce(p_publish, false) then
    perform app.require_licensed_staff(org, true);
    if p_effective_on is null then
      raise exception 'a published intake template needs an effective date' using errcode = '22023';
    end if;
    select mem.id into reviewer
    from public.memberships mem
    where mem.organization_id = org
      and mem.user_id = (select auth.uid())
      and app.membership_is_licensed(mem.id)
      and mem.status = 'active'
    limit 1;
    if reviewer is null then
      raise exception 'publishing an intake template requires a licensed consultant' using errcode = '42501';
    end if;
    update public.intake_templates
    set status = 'superseded'
    where organization_id = org
      and stable_key = p_stable_key
      and status = 'published';
  end if;

  select coalesce(max(version_number), 0) + 1 into next_number
  from public.intake_templates
  where organization_id = org
    and stable_key = p_stable_key;

  insert into public.intake_templates (
    organization_id, stable_key, version_number, status, locale, title, workflow_category,
    schema, effective_on, rule_pack_version_id, reviewer_membership_id, published_at
  ) values (
    org,
    p_stable_key,
    next_number,
    case when coalesce(p_publish, false) then 'published' else 'draft' end::public.intake_template_status,
    p_locale,
    btrim(p_title),
    coalesce(p_workflow_category, 'unspecified'),
    p_schema,
    p_effective_on,
    p_rule_pack_version_id,
    case when coalesce(p_publish, false) then reviewer else null end,
    case when coalesce(p_publish, false) then statement_timestamp() else null end
  )
  returning id into new_id;
  return new_id;
end;
$$;

-- From 20261017190100_inhouse_esign.sql. Approving needs a licensed actor and records that membership.
create or replace function app.approve_agreement_template(p_template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  template public.agreement_templates%rowtype;
  membership uuid;
begin
  perform app.require_licensed_staff(org, true);
  select * into template
  from public.agreement_templates
  where id = p_template_id
    and organization_id = org;
  if template.id is null or template.status <> 'draft' then
    raise exception 'agreement template denied' using errcode = '42501';
  end if;
  select mem.id into membership
  from public.memberships mem
  where mem.organization_id = org
    and mem.user_id = (select auth.uid())
    and app.membership_is_licensed(mem.id)
    and mem.status = 'active'
  limit 1;
  update public.agreement_templates
  set status = 'approved',
      approved_at = statement_timestamp(),
      approved_by = membership
  where id = template.id;
  perform app.record_audit_event(org, 'agreement.template_approved', 'public.agreement_templates', template.id, 'success', '{}'::jsonb);
end;
$$;

-- From 20261017113157_source_governance.sql. An approved review needs a licensed reviewer membership.
create or replace function app.prepare_professional_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ver_org uuid;
  ver_revision integer;
  mem_user uuid;
  mem_role public.org_role;
  mem_status public.membership_status;
  mem_org uuid;
begin
  select v.organization_id, v.content_revision into ver_org, ver_revision
  from public.rule_versions v
  where v.id = new.rule_version_id;
  if not found then
    raise exception 'rule version is not reviewable' using errcode = '42501';
  end if;
  if ver_org is not null and ver_org is distinct from new.organization_id then
    raise exception 'review organization must match the rule version' using errcode = '42501';
  end if;

  select m.user_id, m.role, m.status, m.organization_id
    into mem_user, mem_role, mem_status, mem_org
  from public.memberships m
  where m.id = new.reviewer_membership_id;
  if not found
     or mem_org is distinct from new.organization_id
     or mem_status is distinct from 'active' then
    raise exception 'reviewer membership is not an active membership of this organization'
      using errcode = '42501';
  end if;
  if new.decision = 'approved' and app.membership_is_licensed(new.reviewer_membership_id) is distinct from true then
    raise exception 'approved review requires a licensed_consultant membership' using errcode = '42501';
  end if;
  if (select auth.uid()) is not null and mem_user is distinct from (select auth.uid()) then
    raise exception 'reviewer membership must belong to the signed-in user' using errcode = '42501';
  end if;

  -- Always pin the revision that exists now. A caller cannot approve an older revision.
  new.rule_content_revision := ver_revision;
  return new;
end;
$$;

-- From 20261017140800_portal_invitations.sql. The inviter's verified licence also shows for a licensed owner.
create or replace function public.preview_portal_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.portal_invitations;
  status text;
  person public.persons;
  matter public.matters;
  firm public.organizations;
  inviter_name text;
  licence public.licence_type;
  applicant_name text;
  sponsor_name text;
  visibility jsonb := '[]'::jsonb;
  sections jsonb := '[]'::jsonb;
  subjects jsonb := '[]'::jsonb;
  summary jsonb;
begin
  inv := app.present_portal_invitation(p_token);
  if current_setting('app.portal_rate_limited', true) = '1' then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  if inv.id is null then
    return jsonb_build_object('status', 'unknown');
  end if;

  status := app.portal_invitation_status(inv);
  select * into person from public.persons where id = inv.person_id;
  select * into matter from public.matters where id = inv.matter_id;
  select * into firm from public.organizations where id = inv.organization_id;

  if status <> 'open' then
    return jsonb_build_object(
      'status', status,
      'role', inv.role,
      'sample', person.is_sample,
      'expires_at', inv.expires_at,
      'invitee', jsonb_build_object('display_name', person.display_name),
      'organization', jsonb_build_object('display_name', firm.display_name)
    );
  end if;

  if inv.opened_at is null then
    update public.portal_invitations
       set opened_at = statement_timestamp()
     where id = inv.id
       and opened_at is null;
    perform app.record_portal_audit(
      inv.organization_id,
      'portal_invitation.opened',
      'public.portal_invitations',
      inv.id,
      'success',
      jsonb_build_object('role', inv.role)
    );
  end if;

  select profile.display_name into inviter_name
  from public.profiles profile
  where profile.id = inv.created_by;
  select credential.licence_type into licence
  from public.consultant_credentials credential
  join public.memberships mem
    on mem.id = credential.membership_id
   and mem.organization_id = credential.organization_id
  where mem.user_id = inv.created_by
    and mem.organization_id = inv.organization_id
    and (mem.role = 'licensed_consultant' or app.membership_is_licensed(mem.id))
    and credential.status = 'verified'
  order by credential.checked_at desc nulls last
  limit 1;

  select child.display_name into applicant_name
  from public.matter_participants party
  join public.persons child
    on child.id = party.person_id
   and child.organization_id = party.organization_id
  where party.matter_id = inv.matter_id
    and party.role = 'applicant'
  order by party.created_at
  limit 1;

  select child.display_name into sponsor_name
  from public.matter_participants party
  join public.persons child
    on child.id = party.person_id
   and child.organization_id = party.organization_id
  where party.matter_id = inv.matter_id
    and party.role = 'sponsor'
    and party.person_id is distinct from inv.person_id
  order by party.created_at
  limit 1;

  visibility := jsonb_build_array(
    jsonb_build_object('who', 'self', 'display_name', person.display_name, 'access', 'full'),
    jsonb_build_object('who', 'assigned_staff', 'display_name', null, 'access', 'full')
  );
  if applicant_name is not null and inv.role <> 'client' then
    visibility := visibility || jsonb_build_array(
      jsonb_build_object('who', 'applicant', 'display_name', applicant_name, 'access', 'shared_only')
    );
  end if;
  if inv.role = 'adult_dependant' and sponsor_name is not null then
    visibility := visibility || jsonb_build_array(
      jsonb_build_object('who', 'sponsor', 'display_name', sponsor_name, 'access', 'shared_only')
    );
  end if;
  if inv.role = 'guardian' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'who', 'minor_subject',
      'display_name', child.display_name,
      'access', 'full'
    )), '[]'::jsonb) into subjects
    from public.persons child
    where child.id = any (inv.guardian_subject_ids)
      and child.organization_id = inv.organization_id;
    visibility := visibility || subjects;
  end if;

  if inv.role = 'adult_dependant' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', section_key,
      'label', app.person_section_label(section_key),
      'recorded', exists (
        select 1
        from public.person_section_records rec
        where rec.person_id = inv.person_id
          and rec.matter_id = inv.matter_id
          and rec.section_key = keys.section_key
      )
    ) order by section_key), '[]'::jsonb) into sections
    from unnest(enum_range(null::public.person_section_key)) as keys(section_key)
    where section_key <> 'shared_family_record';
  end if;

  summary := case inv.role
    when 'sponsor' then jsonb_build_object(
      'will_see', jsonb_build_array(
        'Your own questions, documents and tasks',
        'Shared items on this file',
        'Invoices you agree to pay'
      ),
      'will_not_see', jsonb_build_array(
        'Another adult''s private records',
        'A dependant''s records unless they share them'
      )
    )
    when 'employer_contact' then jsonb_build_object(
      'will_see', jsonb_build_array('Your own questions, documents and tasks', 'Shared items on this file'),
      'will_not_see', jsonb_build_array('Another adult''s private records')
    )
    when 'adult_dependant' then jsonb_build_object(
      'will_see', jsonb_build_array('Everything you upload and answer', 'Staff assigned to this file'),
      'will_not_see', jsonb_build_array('Items you have not marked as shared')
    )
    else jsonb_build_object(
      'will_see', jsonb_build_array('Staff assigned to this file', 'People you choose to share with'),
      'will_not_see', jsonb_build_array(
        'Other clients of the firm',
        'Platform staff, unless the firm asks for support and you are told'
      )
    )
  end;

  return jsonb_build_object(
    'status', 'open',
    'role', inv.role,
    'single_use', true,
    'sample', person.is_sample,
    'sample_label', person.sample_label,
    'expires_at', inv.expires_at,
    'invitee', jsonb_build_object('display_name', person.display_name, 'email', inv.email),
    'organization', jsonb_build_object('display_name', firm.display_name, 'branding', firm.branding),
    'matter', jsonb_build_object('title', matter.title),
    'inviter', jsonb_build_object(
      'display_name', coalesce(inviter_name, 'Staff member'),
      'licence_type', licence
    ),
    'applicant', case when applicant_name is null then null else jsonb_build_object('display_name', applicant_name) end,
    'contact_phone', person.contact_phone,
    'policies', jsonb_build_object(
      'portal_terms', app.portal_policy_json(inv.organization_id, 'portal_terms'),
      'privacy_notice', app.portal_policy_json(inv.organization_id, 'privacy_notice')
    ),
    'accept_ready', (app.current_portal_policy(inv.organization_id, 'portal_terms')).id is not null
      and (app.current_portal_policy(inv.organization_id, 'privacy_notice')).id is not null,
    'visibility', visibility,
    'shareable_sections', sections,
    'access_summary', summary,
    'draft', inv.draft
  );
end;
$$;
