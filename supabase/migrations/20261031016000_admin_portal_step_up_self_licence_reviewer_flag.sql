-- Admin-portal support and platform-admin follow-ups (security review).
--
-- 1. public.platform_step_up_check(): a platform owner or operator with a fresh step-up, from
--    their own session. The admin portal calls it before service-role actions that need a
--    step-up (CICC import).
-- 2. app.record_licence_check (latest 20261030130000): the platform branch refuses a check on the
--    caller's own credential. The firm-owner branch is unchanged.
-- 3. CICC list: a credential held by the admin who imported the latest list is not changed by
--    that list. app.cicc_list_check (latest 20261019221100) returns null for it;
--    app.finish_cicc_register_import (latest 20261019221100) counts it as skipped;
--    app.check_licence_against_cicc_list (latest 20261019221100) refuses it.
-- 4. Admin management (latest 20261029210000): a viewer is never a template reviewer.
--    platform_admin_set_reviewer(true) and platform_admin_invite(viewer, reviewer) refuse;
--    accept_platform_admin_invite never grants the flag to a viewer; platform_admin_set_role to
--    viewer clears the flag (audited).
-- 5. public.reject_shared_template_version (latest 20261029130100): refuses a draft that has not
--    been submitted for review, like approve (20261030234500).
--
-- Additive: one new function, function bodies replaced. create or replace keeps existing grants.
-- No data changes.

-- ---------------------------------------------------------------------------
-- 1. Step-up check for the admin portal
-- ---------------------------------------------------------------------------
create or replace function public.platform_step_up_check()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or app.platform_admin_has_role(array['owner', 'operator']) is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'a platform owner or operator step-up is required' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'user_id', (select auth.uid()));
end;
$$;
comment on function public.platform_step_up_check() is
  'True (ok) only for a signed-in platform owner or operator at aal2 with a fresh step-up; raises 42501 otherwise. Called by the admin portal with the admin''s own session.';
revoke all on function public.platform_step_up_check() from public, anon, service_role;
grant execute on function public.platform_step_up_check() to authenticated;

-- ---------------------------------------------------------------------------
-- Helper: the credential is held by this user
-- ---------------------------------------------------------------------------
create or replace function app.credential_held_by(p_credential_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.consultant_credentials c
    join public.memberships mem on mem.id = c.membership_id
    where c.id = p_credential_id
      and mem.user_id = p_user_id
  );
$$;
comment on function app.credential_held_by(uuid, uuid) is
  'True when the credential''s membership belongs to the user. Internal.';
revoke all on function app.credential_held_by(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Manual licence check (from 20261030130000; the platform branch refuses the caller's own
--    credential)
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
  if (app.in_active_org(credential.organization_id)
      and app.has_org_role(credential.organization_id, array['firm_owner']::public.org_role[])) is true then
    null; -- firm-owner branch
  elsif app.platform_admin_has_role(array['owner', 'operator']) is true then
    -- Platform branch: never the caller's own licence.
    if app.credential_held_by(credential.id, actor) then
      raise exception 'you cannot record a check on your own licence' using errcode = '42501';
    end if;
  else
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
-- 3. CICC list: the importing admin's own credentials are not changed by their list
-- ---------------------------------------------------------------------------
-- From 20261019221100; returns null for a credential held by the latest import's importer.
create or replace function app.cicc_list_check(p_credential_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  credential public.consultant_credentials%rowtype;
  latest public.cicc_register_imports%rowtype;
  entry public.cicc_register_entries%rowtype;
  holder text;
  lic_number text;
  result public.licence_check_result;
  matched boolean := false;
  applied boolean := false;
  reason text;
  register public.register_licence_status;
  entitled boolean;
  check_id uuid;
begin
  select * into credential from public.consultant_credentials where id = p_credential_id;
  if credential.id is null then
    return null;
  end if;
  select * into latest
  from public.cicc_register_imports imp
  where imp.status = 'complete'
  order by imp.completed_at desc, imp.imported_at desc
  limit 1;
  if latest.id is null then
    return null;
  end if;
  -- A list never checks the licence of the admin who imported it.
  if app.credential_held_by(credential.id, latest.imported_by) then
    return null;
  end if;

  lic_number := app.normalize_licence_number(credential.college_id);
  select nullif(btrim(coalesce(prof.display_name, '')), '') into holder
  from public.memberships mem
  left join public.profiles prof on prof.id = mem.user_id
  where mem.id = credential.membership_id
    and mem.organization_id = credential.organization_id;

  select e.* into entry
  from public.cicc_register_entries e
  where e.import_id = latest.id
    and e.licence_number = lic_number
  order by app.cicc_name_matches(holder, e.first_name, e.last_name, e.full_name) desc, e.created_at, e.id
  limit 1;

  if entry.id is null then
    result := 'needs_review';
    reason := 'Licence number is not on the CICC list';
  elsif not app.cicc_name_matches(holder, entry.first_name, entry.last_name, entry.full_name) then
    result := 'needs_review';
    reason := 'Name does not match the CICC list';
  else
    result := app.cicc_status_result(entry.status, entry.entitlement);
    if result is null then
      result := 'needs_review';
      reason := left('CICC list status not recognised: ' || btrim(entry.status), 500);
    else
      matched := true;
      reason := 'Matched on the CICC list';
    end if;
  end if;

  if matched then
    register := case
      when result = 'inactive' then 'inactive'::public.register_licence_status
      when result in ('verified', 'not_entitled') then 'active'::public.register_licence_status
      else null
    end;
    entitled := case when result = 'not_entitled' then false else app.cicc_yes_no(entry.entitlement) end;
    -- A list result never lifts an adverse status a reviewer recorded from the register by hand.
    applied := not (
      result = 'verified'
      and app.licence_status_blocks(credential.status)
      and credential.verification_method = 'manual_public_register'
    );
    if not applied then
      reason := reason || '; the adverse manual register check is kept';
    end if;
  end if;

  insert into public.credential_checks (
    organization_id, credential_id, method, cicc_import_id, cicc_entry_id, retrieved_at, result,
    register_status, entitlement_to_practise, discipline_suspended, discipline_revoked,
    reviewer_user_id, notes, created_at
  ) values (
    credential.organization_id,
    credential.id,
    'cicc_list',
    latest.id,
    entry.id,
    latest.imported_at,
    result,
    register,
    entitled,
    case when matched then result = 'suspended' else null end,
    case when matched then result = 'revoked' else null end,
    latest.imported_by,
    reason,
    clock_timestamp()
  )
  returning id into check_id;

  if matched and applied then
    update public.consultant_credentials
       set status = result::text::public.credential_status,
           verification_method = 'cicc_list',
           source_url = null,
           register_status = register,
           entitlement_to_practise = entitled,
           discipline_suspended = (result = 'suspended'),
           discipline_revoked = (result = 'revoked'),
           checked_at = latest.imported_at,
           reviewer_user_id = latest.imported_by
     where id = credential.id;

    if result in ('revoked', 'suspended', 'inactive', 'not_entitled') then
      perform app.enqueue_licence_event(
        credential.organization_id,
        credential.id,
        'licence.adverse_status',
        jsonb_build_object('credential_id', credential.id, 'check_id', check_id, 'status', result, 'result', result, 'method', 'cicc_list'),
        'licence.adverse_status:' || check_id::text,
        statement_timestamp()
      );
    end if;
  end if;

  perform app.sync_firm_verification(credential.organization_id);

  perform app.record_audit_event(
    credential.organization_id,
    'licence.check_recorded',
    'public.credential_checks',
    check_id,
    'success',
    jsonb_build_object(
      'result', result,
      'method', 'cicc_list',
      'import_id', latest.id,
      'matched', matched,
      'applied', matched and applied
    )
  );
  return check_id;
end;
$$;
comment on function app.cicc_list_check(uuid) is
  'Matches one credential against the latest complete CICC list import and records a cicc_list licence check. Null when no import exists or when the credential is held by the admin who imported that list. Internal: no API role may call it directly.';
revoke all on function app.cicc_list_check(uuid) from public;

-- From 20261019221100; credentials held by the importer are skipped and counted.
create or replace function app.finish_cicc_register_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  imp public.cicc_register_imports%rowtype;
  total integer;
  credential_id uuid;
  check_id uuid;
  checked integer := 0;
  verified integer := 0;
  needs_review integer := 0;
  adverse integer := 0;
  skipped integer := 0;
  outcome public.licence_check_result;
begin
  if not app.cicc_admin_caller() then
    raise exception 'CICC list import denied' using errcode = '42501';
  end if;
  select * into imp from public.cicc_register_imports where id = p_import_id for update;
  if imp.id is null or imp.status <> 'loading' then
    raise exception 'that CICC list import is not open' using errcode = '22023';
  end if;
  select count(*) into total from public.cicc_register_entries where import_id = imp.id;
  if total = 0 then
    raise exception 'the CICC list import has no rows' using errcode = '22023';
  end if;
  update public.cicc_register_imports
     set status = 'complete', completed_at = clock_timestamp(), row_count = total
   where id = imp.id;

  -- Re-check every credential against the new list, except the importer's own.
  for credential_id in select c.id from public.consultant_credentials c order by c.organization_id, c.id loop
    if app.credential_held_by(credential_id, imp.imported_by) then
      skipped := skipped + 1;
      continue;
    end if;
    check_id := app.cicc_list_check(credential_id);
    if check_id is not null then
      checked := checked + 1;
      select chk.result into outcome from public.credential_checks chk where chk.id = check_id;
      if outcome = 'verified' then
        verified := verified + 1;
      elsif outcome = 'needs_review' then
        needs_review := needs_review + 1;
      else
        adverse := adverse + 1;
      end if;
    end if;
  end loop;

  perform app.record_audit_event(
    null, 'cicc_register.imported', 'public.cicc_register_imports', imp.id, 'success',
    jsonb_build_object('row_count', total, 'checked', checked, 'verified', verified, 'needs_review', needs_review,
                       'adverse', adverse, 'skipped', skipped)
  );
  return jsonb_build_object(
    'import_id', imp.id, 'row_count', total, 'checked', checked,
    'verified', verified, 'needs_review', needs_review, 'adverse', adverse, 'skipped', skipped
  );
end;
$$;
revoke all on function app.finish_cicc_register_import(uuid) from public;

-- From 20261019221100; a credential held by the latest list's importer is refused.
create or replace function app.check_licence_against_cicc_list(p_credential_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  check_id uuid;
  latest_importer uuid;
begin
  if not app.cicc_admin_caller() then
    raise exception 'licence check denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.consultant_credentials where id = p_credential_id) then
    raise exception 'licence check denied' using errcode = '42501';
  end if;
  select imp.imported_by into latest_importer
  from public.cicc_register_imports imp
  where imp.status = 'complete'
  order by imp.completed_at desc, imp.imported_at desc
  limit 1;
  if app.credential_held_by(p_credential_id, latest_importer) then
    raise exception 'the latest CICC list was imported by this licence holder; another admin must check it' using errcode = '42501';
  end if;
  check_id := app.cicc_list_check(p_credential_id);
  if check_id is null then
    raise exception 'no CICC list has been imported yet' using errcode = '22023';
  end if;
  return check_id;
end;
$$;
revoke all on function app.check_licence_against_cicc_list(uuid) from public;

-- ---------------------------------------------------------------------------
-- 4. Admin management: a viewer is never a template reviewer (from 20261029210000)
-- ---------------------------------------------------------------------------
create or replace function public.platform_admin_invite(
  p_email text, p_role text, p_template_reviewer boolean default false, p_note text default null, p_days integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_session_actor(array['owner']);
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_days integer := coalesce(p_days, 7);
  rid uuid;
begin
  if length(v_email) not between 3 and 320 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'the email is invalid' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('owner', 'operator', 'viewer') then
    raise exception 'role is owner, operator or viewer' using errcode = '22023';
  end if;
  if p_role = 'viewer' and coalesce(p_template_reviewer, false) then
    raise exception 'a viewer cannot be a template reviewer' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 200 then
    raise exception 'the note is at most 200 characters' using errcode = '22023';
  end if;
  if v_days not between 1 and 30 then
    raise exception 'an invite lasts 1 to 30 days' using errcode = '22023';
  end if;
  if exists (select 1 from public.platform_admins pa join auth.users u on u.id = pa.user_id where lower(u.email) = v_email) then
    raise exception 'that person is already a platform admin' using errcode = '23505';
  end if;
  perform set_config('app.platform_admin_write', 'on', true);
  -- An expired pending invite for the same email is closed first.
  update public.platform_admin_invites
     set status = 'cancelled', cancelled_at = now(), cancelled_by = actor, cancel_reason = 'expired; replaced'
   where email = v_email and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.platform_admin_invites i where i.email = v_email and i.status = 'pending') then
    raise exception 'an invite for that email is already open' using errcode = '23505';
  end if;
  insert into public.platform_admin_invites (email, role, template_reviewer, note, invited_by, expires_at)
  values (v_email, p_role, coalesce(p_template_reviewer, false), v_note, actor, now() + make_interval(days => v_days))
  returning id into rid;
  perform app.record_audit_event(null, 'platform_admin.invited', 'public.platform_admin_invites', rid, 'success',
    jsonb_build_object('role', p_role, 'template_reviewer', coalesce(p_template_reviewer, false),
                       'email_domain', split_part(v_email, '@', 2), 'days', v_days));
  return rid;
end;
$$;

-- The invited person, signed in with MFA (aal2), accepts. An older viewer invite never grants
-- the reviewer flag.
create or replace function public.accept_platform_admin_invite()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  u auth.users%rowtype;
  inv public.platform_admin_invites%rowtype;
  v_reviewer boolean;
begin
  if uid is null or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'sign in with MFA to accept' using errcode = '42501';
  end if;
  select * into u from auth.users where id = uid;
  if u.email is null or u.email_confirmed_at is null then
    raise exception 'confirm your email first' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_admins pa where pa.user_id = uid) then
    raise exception 'you are already a platform admin' using errcode = '23505';
  end if;
  select * into inv from public.platform_admin_invites
   where email = lower(u.email) and status = 'pending'
   for update;
  if inv.id is null or inv.expires_at <= now() then
    raise exception 'no open invite for your email' using errcode = 'P0002';
  end if;
  v_reviewer := inv.template_reviewer and inv.role <> 'viewer';
  perform set_config('app.platform_admin_write', 'on', true);
  insert into public.platform_admins (user_id, note, role, template_reviewer)
  values (uid, inv.note, inv.role, v_reviewer);
  update public.platform_admin_invites
     set status = 'accepted', accepted_at = now(), accepted_user_id = uid
   where id = inv.id;
  perform app.record_audit_event(null, 'platform_admin.invite_accepted', 'public.platform_admins', uid, 'success',
    jsonb_build_object('invite_id', inv.id, 'role', inv.role, 'invited_by', inv.invited_by, 'template_reviewer', v_reviewer));
  return jsonb_build_object('user_id', uid, 'role', inv.role, 'template_reviewer', v_reviewer);
end;
$$;

create or replace function public.platform_admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_session_actor(array['owner']);
  cur text;
  cur_reviewer boolean;
  clear_reviewer boolean;
begin
  if p_role is null or p_role not in ('owner', 'operator', 'viewer') then
    raise exception 'role is owner, operator or viewer' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('casevoya.platform_admin_owners'));
  select role, template_reviewer into cur, cur_reviewer from public.platform_admins where user_id = p_user_id for update;
  if cur is null then
    raise exception 'not a platform admin' using errcode = 'P0002';
  end if;
  clear_reviewer := p_role = 'viewer' and cur_reviewer;
  if cur = p_role and not clear_reviewer then
    return;
  end if;
  if cur = 'owner' and p_role <> 'owner' and (select count(*) from public.platform_admins where role = 'owner') <= 1 then
    raise exception 'keep at least one owner' using errcode = '22023';
  end if;
  update public.platform_admins
     set role = p_role,
         template_reviewer = case when p_role = 'viewer' then false else template_reviewer end
   where user_id = p_user_id;
  if cur <> p_role then
    perform app.record_audit_event(null, 'platform_admin.role_changed', 'public.platform_admins', p_user_id, 'success',
      jsonb_build_object('from', cur, 'to', p_role, 'self', p_user_id = actor, 'template_reviewer_cleared', clear_reviewer));
  end if;
  if clear_reviewer then
    perform app.record_audit_event(null, 'platform_admin.reviewer_changed', 'public.platform_admins', p_user_id, 'success',
      jsonb_build_object('template_reviewer', false, 'self', p_user_id = actor, 'reason', 'role_viewer'));
  end if;
end;
$$;

create or replace function public.platform_admin_set_reviewer(p_user_id uuid, p_template_reviewer boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := app.platform_session_actor(array['owner']);
  cur boolean;
  cur_role text;
begin
  if p_template_reviewer is null then
    raise exception 'say on or off' using errcode = '22023';
  end if;
  select template_reviewer, role into cur, cur_role from public.platform_admins where user_id = p_user_id for update;
  if cur is null then
    raise exception 'not a platform admin' using errcode = 'P0002';
  end if;
  if p_template_reviewer and cur_role = 'viewer' then
    raise exception 'a viewer cannot be a template reviewer' using errcode = '22023';
  end if;
  if cur = p_template_reviewer then
    return;
  end if;
  update public.platform_admins set template_reviewer = p_template_reviewer where user_id = p_user_id;
  perform app.record_audit_event(null, 'platform_admin.reviewer_changed', 'public.platform_admins', p_user_id, 'success',
    jsonb_build_object('template_reviewer', p_template_reviewer, 'self', p_user_id = actor));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Shared template rejection needs a submitted draft (from 20261029130100)
-- ---------------------------------------------------------------------------
create or replace function public.reject_shared_template_version(p_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.shared_template_versions%rowtype;
  reviewer jsonb;
  actor uuid := (select auth.uid());
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  reviewer := app.platform_template_reviewer();
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select * into v from public.shared_template_versions where id = p_version_id for update;
  if v.id is null or v.status <> 'draft' then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  if v.submitted_at is null then
    raise exception 'the draft has not been submitted for review' using errcode = '22023';
  end if;
  perform set_config('app.shared_template_write', 'on', true);
  update public.shared_template_versions set
    status = 'rejected',
    reviewer_user_id = actor,
    reviewer_label = reviewer ->> 'label',
    reviewed_at = statement_timestamp()
  where id = v.id;
  insert into public.shared_template_reviews (version_id, decision, reviewer_user_id, reviewer_label, licence_snapshot, reason)
  values (v.id, 'rejected', actor, reviewer ->> 'label', reviewer - 'label', v_reason);
  perform app.record_audit_event(null, 'template.version_rejected', 'public.shared_template_versions', v.id, 'success',
    jsonb_build_object('version_number', v.version_number, 'reason_length', length(v_reason)));
  return jsonb_build_object('id', v.id, 'status', 'rejected');
end;
$$;
comment on function public.reject_shared_template_version(uuid, text) is
  'ADM-03: a licensed platform admin rejects a draft that was submitted for review, with a step-up and a reason. Nothing is published and firms are not notified.';
