-- Platform admin roles enforced in the database (security review).
--
-- public.platform_admins.role is owner / operator / viewer. Until now only the admin portal
-- enforced it; a viewer's own signed-in session could still call the platform write paths.
-- From here, every platform write needs an owner or operator, both for a signed-in admin and
-- for the service role naming the acting admin. Reads stay open to every platform admin.
-- Admin management (invite, role, reviewer flag, removal) was already owner-only.
--
-- Additive: one new helper, function bodies replaced, write policies altered. No data changes.
--
--   * app.platform_admin_has_role(text[]): the signed-in user is a platform admin (aal2) with
--     one of the roles.
--   * app.service_notice_actor: post / update / resolve service notices (owner, operator).
--   * app.platform_ops_actor: record_support_response, save_support_catalogue_entry,
--     set_shared_template_version_sources (owner, operator).
--   * app.platform_template_reviewer: approve / reject / roll back shared templates (owner,
--     operator; still needs the reviewer flag, a fresh step-up and a licence).
--   * Global catalogue write policies (official_source_domains, official_sources,
--     rule_definitions, rule_versions, rule_pack_versions, rule_pack_items) and
--     product_settings_update (owner, operator).
--   * app.set_product_setting, app.record_licence_check (platform branch), the CICC list import
--     and re-check (owner, operator). public.cicc_needs_review_credentials stays a read for
--     every platform admin.

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------
create or replace function app.platform_admin_has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.is_platform_admin()
    and exists (
      select 1
      from public.platform_admins pa
      where pa.user_id = (select auth.uid())
        and pa.role = any (p_roles)
    ),
    false
  );
$$;
comment on function app.platform_admin_has_role(text[]) is
  'True when the signed-in user is a platform admin at aal2 whose role is one of p_roles. Viewers are read-only.';
revoke all on function app.platform_admin_has_role(text[]) from public, anon;
grant execute on function app.platform_admin_has_role(text[]) to authenticated;

comment on column public.platform_admins.role is
  'owner: everything, including admin management. operator: day-to-day actions. viewer: read only. Enforced in the database: platform writes need owner or operator; admin management needs owner.';

-- ---------------------------------------------------------------------------
-- Service notices
-- ---------------------------------------------------------------------------
create or replace function app.service_notice_actor(p_acting_admin uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if app.is_platform_admin() is distinct from true
       or app.mfa_step_up_satisfied() is distinct from true then
      raise exception 'service notices require a platform admin step-up' using errcode = '42501';
    end if;
    if app.platform_admin_has_role(array['owner', 'operator']) is distinct from true then
      raise exception 'your platform role does not allow this' using errcode = '42501';
    end if;
    return (select auth.uid());
  end if;
  if app.current_actor_type() is distinct from 'service' then
    raise exception 'service notices require a platform admin' using errcode = '42501';
  end if;
  if p_acting_admin is null
     or not exists (select 1 from public.platform_admins pa where pa.user_id = p_acting_admin) then
    raise exception 'name the platform admin who posts the notice' using errcode = '22023';
  end if;
  if coalesce(app.platform_admin_role(p_acting_admin) = any (array['owner', 'operator']), false) is not true then
    raise exception 'the named platform admin''s role does not allow this' using errcode = '42501';
  end if;
  return p_acting_admin;
end;
$$;
revoke all on function app.service_notice_actor(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Platform operations actor (support responses, support catalogue, template sources)
-- ---------------------------------------------------------------------------
create or replace function app.platform_ops_actor(p_named uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if app.is_platform_admin() is distinct from true then
      raise exception 'platform admin access denied' using errcode = '42501';
    end if;
    if app.platform_admin_has_role(array['owner', 'operator']) is distinct from true then
      raise exception 'your platform role does not allow this' using errcode = '42501';
    end if;
    return (select auth.uid());
  end if;
  if app.current_actor_type() is distinct from 'service' then
    raise exception 'platform admin access denied' using errcode = '42501';
  end if;
  if p_named is null
     or not exists (select 1 from public.platform_admins pa where pa.user_id = p_named) then
    raise exception 'name the platform admin who records this' using errcode = '22023';
  end if;
  if coalesce(app.platform_admin_role(p_named) = any (array['owner', 'operator']), false) is not true then
    raise exception 'the named platform admin''s role does not allow this' using errcode = '42501';
  end if;
  return p_named;
end;
$$;
comment on function app.platform_ops_actor(uuid) is
  'A signed-in platform admin at aal2 (their id), or the service role naming a platform_admins user (that id). The admin must be an owner or operator. Anyone else is refused.';
revoke all on function app.platform_ops_actor(uuid) from public;

-- ---------------------------------------------------------------------------
-- Shared template review (final definition from 20261029210000 plus the role)
-- ---------------------------------------------------------------------------
create or replace function app.platform_template_reviewer()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  snap jsonb;
  label text;
begin
  if app.support_service_role() then
    raise exception 'the service role cannot publish a template' using errcode = '42501';
  end if;
  if app.is_platform_admin() is distinct from true then
    raise exception 'template review denied' using errcode = '42501';
  end if;
  if app.platform_admin_has_role(array['owner', 'operator']) is distinct from true then
    raise exception 'your platform role does not allow this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()) and pa.template_reviewer) then
    raise exception 'you are not a template reviewer' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  select jsonb_build_object('licence_type', c.licence_type, 'college_id', c.college_id, 'status', c.status),
         c.licence_type::text || ' ' || c.college_id
    into snap, label
  from public.consultant_credentials c
  join public.memberships mem
    on mem.id = c.membership_id and mem.organization_id = c.organization_id
  where mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and mem.role in ('firm_owner', 'licensed_consultant')
    and c.register_status = 'active'
    and c.entitlement_to_practise is distinct from false
    and c.discipline_revoked is not true
    and c.discipline_suspended is not true
    and app.licence_status_blocks(c.status) is not true
  order by c.checked_at desc nulls last
  limit 1;
  if snap is null then
    raise exception 'a licensed reviewer is required' using errcode = '42501';
  end if;
  return snap || jsonb_build_object('label', label);
end;
$$;
revoke all on function app.platform_template_reviewer() from public;

-- ---------------------------------------------------------------------------
-- Global catalogue write policies: owner or operator. Select policies are unchanged.
-- ---------------------------------------------------------------------------
alter policy official_source_domains_platform_insert on public.official_source_domains
  with check ((select app.platform_admin_has_role(array['owner', 'operator'])));
alter policy official_source_domains_platform_update on public.official_source_domains
  using ((select app.platform_admin_has_role(array['owner', 'operator'])))
  with check ((select app.platform_admin_has_role(array['owner', 'operator'])));

alter policy official_sources_platform_insert on public.official_sources
  with check (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])));
alter policy official_sources_platform_update on public.official_sources
  using (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])))
  with check (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])));

alter policy rule_definitions_platform_insert on public.rule_definitions
  with check (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])));
alter policy rule_definitions_platform_update on public.rule_definitions
  using (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])))
  with check (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])));

alter policy rule_versions_platform_insert on public.rule_versions
  with check (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])));
alter policy rule_versions_platform_update on public.rule_versions
  using (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])))
  with check (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])));

alter policy rule_pack_versions_platform_insert on public.rule_pack_versions
  with check (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])));
alter policy rule_pack_versions_platform_update on public.rule_pack_versions
  using (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])))
  with check (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])));

alter policy rule_pack_items_platform_insert on public.rule_pack_items
  with check (organization_id is null and (select app.platform_admin_has_role(array['owner', 'operator'])));

alter policy product_settings_update on public.product_settings
  using ((select app.platform_admin_has_role(array['owner', 'operator'])))
  with check ((select app.platform_admin_has_role(array['owner', 'operator'])));

-- ---------------------------------------------------------------------------
-- Product settings (definition from 20261017140700 plus the role)
-- ---------------------------------------------------------------------------
create or replace function app.set_product_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  unit text;
  count integer;
begin
  if app.is_platform_admin() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'product settings require a platform admin step-up' using errcode = '42501';
  end if;
  if app.platform_admin_has_role(array['owner', 'operator']) is distinct from true then
    raise exception 'your platform role does not allow this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.product_settings where key = p_key) then
    raise exception 'unknown product setting' using errcode = '22023';
  end if;
  unit := p_value ->> 'unit';
  begin
    count := (p_value ->> 'count')::integer;
  exception when others then
    count := null;
  end;
  if p_key = 'licence.manual_check_target' and unit is distinct from 'business_days' then
    raise exception 'manual check target uses business_days' using errcode = '22023';
  end if;
  if p_key = 'trial.duration' and unit not in ('days', 'months') then
    raise exception 'trial duration uses days or months' using errcode = '22023';
  end if;
  if p_key = 'licence.recheck_interval' and unit not in ('days', 'months') then
    raise exception 'recheck interval uses days or months' using errcode = '22023';
  end if;
  if count is null or count < 1 or count > 3650 then
    raise exception 'setting count is not usable' using errcode = '22023';
  end if;
  update public.product_settings
     set value = jsonb_build_object('unit', unit, 'count', count),
         pending_confirmation = false
   where key = p_key;
  perform app.record_audit_event(
    null,
    'product.setting_changed',
    'public.product_settings',
    null,
    'success',
    jsonb_build_object('key', p_key, 'unit', unit, 'count', count)
  );
end;
$$;
revoke all on function app.set_product_setting(text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- Manual licence check (definition from 20261017140700; the platform branch needs the role)
-- ---------------------------------------------------------------------------
create or replace function app.record_licence_check(
  p_credential_id uuid,
  p_source_url text,
  p_retrieved_at timestamptz,
  p_register_status public.register_licence_status,
  p_entitlement_to_practise boolean,
  p_discipline_suspended boolean,
  p_discipline_revoked boolean,
  p_discipline_restricted boolean,
  p_discipline_restriction_detail text,
  p_proof_locator text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  credential public.consultant_credentials%rowtype;
  host text;
  check_id uuid;
  result public.licence_check_result;
  new_status public.credential_status;
  review_at timestamptz;
  interval_known interval;
  restriction_detail text;
begin
  if actor is null or app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'a licence check requires a recent step-up' using errcode = '42501';
  end if;
  select * into credential from public.consultant_credentials where id = p_credential_id;
  if credential.id is null then
    raise exception 'licence check denied' using errcode = '42501';
  end if;
  if not (
    (app.in_active_org(credential.organization_id)
      and app.has_org_role(credential.organization_id, array['firm_owner']::public.org_role[]))
    or app.platform_admin_has_role(array['owner', 'operator'])
  ) then
    raise exception 'licence check denied' using errcode = '42501';
  end if;

  host := app.cicc_register_host(p_source_url);
  if host is null then
    raise exception 'licence evidence must cite register.college-ic.ca' using errcode = '22023';
  end if;
  if p_retrieved_at is null or p_retrieved_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'retrieval time is missing or in the future' using errcode = '22023';
  end if;
  if p_proof_locator is null or length(btrim(p_proof_locator)) not between 1 and 500 then
    raise exception 'a proof file reference is required' using errcode = '22023';
  end if;
  if p_register_status is null or p_entitlement_to_practise is null
     or p_discipline_suspended is null or p_discipline_revoked is null
     or p_discipline_restricted is null then
    raise exception 'register status, entitlement, and discipline flags are required' using errcode = '22023';
  end if;
  restriction_detail := nullif(btrim(coalesce(p_discipline_restriction_detail, '')), '');
  if p_discipline_restricted and (restriction_detail is null or length(restriction_detail) > 1000) then
    raise exception 'a restriction needs the register detail' using errcode = '22023';
  end if;
  if not p_discipline_restricted and restriction_detail is not null then
    raise exception 'restriction detail requires the restriction flag' using errcode = '22023';
  end if;

  -- Precedence matches src/modules/firm-onboarding/licence.ts.
  -- Revoked, then suspended, then inactive, then not entitled, otherwise verified.
  -- discipline_restricted and its detail are stored and do not change this result.
  -- not_entitled locks, the same as revoked, suspended, and inactive.
  if p_discipline_revoked then
    result := 'revoked';
    new_status := 'revoked';
  elsif p_discipline_suspended then
    result := 'suspended';
    new_status := 'suspended';
  elsif p_register_status = 'inactive' then
    result := 'inactive';
    new_status := 'inactive';
  elsif p_entitlement_to_practise is distinct from true then
    result := 'not_entitled';
    new_status := 'not_entitled';
  else
    result := 'verified';
    new_status := 'verified';
  end if;

  interval_known := app.product_setting_interval('licence.recheck_interval');
  review_at := case
    when interval_known is null then null
    else p_retrieved_at + interval_known
  end;

  insert into public.credential_checks (
    organization_id, credential_id, source_url, source_host, retrieved_at, result,
    proof_locator, register_status, entitlement_to_practise,
    discipline_suspended, discipline_revoked, discipline_restricted,
    discipline_restriction_detail, reviewer_user_id, notes
  ) values (
    credential.organization_id,
    credential.id,
    p_source_url,
    host,
    p_retrieved_at,
    result,
    btrim(p_proof_locator),
    p_register_status,
    p_entitlement_to_practise,
    p_discipline_suspended,
    p_discipline_revoked,
    p_discipline_restricted,
    restriction_detail,
    actor,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into check_id;

  update public.consultant_credentials
     set status = new_status,
         source_url = p_source_url,
         register_status = p_register_status,
         entitlement_to_practise = p_entitlement_to_practise,
         discipline_suspended = p_discipline_suspended,
         discipline_revoked = p_discipline_revoked,
         discipline_restricted = p_discipline_restricted,
         discipline_restriction_detail = restriction_detail,
         verification_method = 'manual_public_register',
         proof_locator = btrim(p_proof_locator),
         checked_at = p_retrieved_at,
         next_review_at = review_at,
         reviewer_user_id = actor
   where id = credential.id;

  perform app.sync_firm_verification(credential.organization_id);

  perform app.enqueue_licence_event(
    credential.organization_id,
    credential.id,
    'licence.recheck_due',
    jsonb_build_object(
      'credential_id', credential.id,
      'check_id', check_id,
      'method', 'manual_public_register',
      'interval_configured', interval_known is not null
    ),
    'licence.recheck_due:' || check_id::text,
    coalesce(review_at, statement_timestamp())
  );

  if new_status in ('revoked', 'suspended', 'inactive', 'not_entitled') then
    perform app.enqueue_licence_event(
      credential.organization_id,
      credential.id,
      'licence.adverse_status',
      jsonb_build_object(
        'credential_id', credential.id,
        'check_id', check_id,
        'status', new_status,
        'result', result
      ),
      'licence.adverse_status:' || check_id::text,
      statement_timestamp()
    );
  end if;

  perform app.record_audit_event(
    credential.organization_id,
    'licence.check_recorded',
    'public.credential_checks',
    check_id,
    'success',
    jsonb_build_object(
      'result', result,
      'status', new_status,
      'method', 'manual_public_register',
      'source_host', host,
      'register_status', p_register_status,
      'entitlement_to_practise', p_entitlement_to_practise,
      'discipline_suspended', p_discipline_suspended,
      'discipline_revoked', p_discipline_revoked,
      'discipline_restricted', p_discipline_restricted,
      'restriction_detail_recorded', restriction_detail is not null
    )
  );
  return check_id;
end;
$$;
revoke all on function app.record_licence_check(uuid, text, timestamptz, public.register_licence_status, boolean, boolean, boolean, boolean, text, text, text) from public;

-- ---------------------------------------------------------------------------
-- CICC list: import and re-check are writes (owner, operator); the needs-review list is a read.
-- ---------------------------------------------------------------------------
create or replace function app.cicc_admin_caller()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is not null then app.platform_admin_has_role(array['owner', 'operator'])
    else app.current_actor_type() = 'service'
  end;
$$;
comment on function app.cicc_admin_caller() is
  'A signed-in platform admin (owner or operator) at aal2, or the service role (ops scripts). Firm staff and viewers never. Used for CICC list writes.';
revoke all on function app.cicc_admin_caller() from public;

create or replace function app.cicc_importer(p_imported_by uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if app.platform_admin_has_role(array['owner', 'operator']) is distinct from true then
      raise exception 'CICC list import denied' using errcode = '42501';
    end if;
    return (select auth.uid());
  end if;
  if app.current_actor_type() is distinct from 'service' then
    raise exception 'CICC list import denied' using errcode = '42501';
  end if;
  if p_imported_by is null
     or not exists (select 1 from public.platform_admins pa where pa.user_id = p_imported_by) then
    raise exception 'name the platform admin who imports the list' using errcode = '22023';
  end if;
  if coalesce(app.platform_admin_role(p_imported_by) = any (array['owner', 'operator']), false) is not true then
    raise exception 'the named platform admin''s role does not allow this' using errcode = '42501';
  end if;
  return p_imported_by;
end;
$$;
revoke all on function app.cicc_importer(uuid) from public;

create or replace function public.cicc_needs_review_credentials()
returns table (
  credential_id uuid,
  organization_id uuid,
  firm_name text,
  holder_name text,
  licence_type public.licence_type,
  college_id text,
  credential_status public.credential_status,
  check_id uuid,
  checked_at timestamptz,
  reason text,
  import_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- A read: any platform admin (viewers included), or the service role.
  if not (case
    when (select auth.uid()) is not null then app.is_platform_admin() is true
    else app.current_actor_type() = 'service'
  end) then
    raise exception 'needs-review list denied' using errcode = '42501';
  end if;
  return query
    with latest as (
      select distinct on (chk.credential_id) chk.*
      from public.credential_checks chk
      order by chk.credential_id, chk.created_at desc, chk.retrieved_at desc
    )
    select c.id, c.organization_id, o.display_name, nullif(btrim(coalesce(prof.display_name, '')), ''),
           c.licence_type, c.college_id, c.status, latest.id, latest.created_at, latest.notes, latest.cicc_import_id
    from latest
    join public.consultant_credentials c on c.id = latest.credential_id
    join public.organizations o on o.id = c.organization_id
    left join public.memberships mem on mem.id = c.membership_id and mem.organization_id = c.organization_id
    left join public.profiles prof on prof.id = mem.user_id
    where latest.method = 'cicc_list'
      and latest.result = 'needs_review'
    order by latest.created_at desc;
end;
$$;
revoke all on function public.cicc_needs_review_credentials() from public, anon;
grant execute on function public.cicc_needs_review_credentials() to authenticated, service_role;
