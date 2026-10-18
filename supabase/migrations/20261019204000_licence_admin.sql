-- Sheet: Licences page and the licence-suspended home (branch sheet-firm-admin).
--
-- PRD ORG-03..ORG-05. The register check stays a manual, recorded check (RULES.md; decision
-- 2026-10-17): nothing here contacts register.college-ic.ca. This migration adds:
--   * public.add_consultant_licence: the Licences page's "Add a licence". A firm owner (for an
--     active licensed consultant, or for their own owner membership) or the consultant themselves,
--     with a recent step-up. It records a declared CICC credential without a proof file; the
--     reviewer's register check carries its own proof (credential_checks.proof_locator).
--     app.declare_consultant_credential (setup, with proof) is unchanged.
--   * public.credential_change_reports and public.report_licence_change: "Report a change". The
--     holder or a firm owner, with a recent step-up. The report is append-only, makes the
--     credential's review due now (event-triggered review, ORG-04) and queues
--     licence.change_reported for the reviewer. It does not change the credential's status.
--   * public.licence_review_log: the Review log tab. Checks, declarations and change reports for
--     the firm, with the reviewer's display name (a platform reviewer's profile is not readable by
--     firm staff). Active staff at aal2. Read only.
--   * public.reassign_consultant_matters_selected: the suspended home's "Reassign work". The firm
--     owner, or the consultant whose licence is blocked moving their own matters, with a recent
--     step-up, to a consultant with a verified licence. Moves the responsible consultant and the
--     consultant party on each chosen open matter, with a reason; audited per matter.
-- No existing function is redefined. New table has forced RLS and no direct API writes.

-- ---------------------------------------------------------------------------
-- Change reports
-- ---------------------------------------------------------------------------
create table public.credential_change_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  credential_id uuid not null,
  detail text not null check (length(btrim(detail)) between 3 and 1000),
  reported_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (credential_id, organization_id) references public.consultant_credentials (id, organization_id)
);
comment on table public.credential_change_reports is
  'A reported change to a consultant licence (new class, condition, suspension). Append-only. It makes the review due; only a recorded register check changes the credential status.';

create index credential_change_reports_credential_org_fk_idx
  on public.credential_change_reports (credential_id, organization_id);
create index credential_change_reports_org_idx
  on public.credential_change_reports (organization_id, created_at desc);
create index credential_change_reports_reported_by_idx
  on public.credential_change_reports (reported_by);

create trigger credential_change_reports_audit after insert or update or delete on public.credential_change_reports
  for each row execute function app.audit_row_change('detail');
create trigger credential_change_reports_no_delete before delete on public.credential_change_reports
  for each row execute function app.reject_governed_delete();
create trigger credential_change_reports_no_update before update on public.credential_change_reports
  for each row execute function app.reject_governed_delete();
create trigger credential_change_reports_no_truncate before truncate on public.credential_change_reports
  for each statement execute function app.reject_governed_delete();

revoke all on table public.credential_change_reports from anon, authenticated;
grant select on table public.credential_change_reports to authenticated;

alter table public.credential_change_reports enable row level security;
alter table public.credential_change_reports force row level security;

create policy credential_change_reports_select on public.credential_change_reports
  for select to authenticated
  using (
    (select app.in_active_org(organization_id))
    and (select app.is_org_staff(organization_id))
  );

-- ---------------------------------------------------------------------------
-- Add a licence (no proof file; the register check carries the evidence)
-- ---------------------------------------------------------------------------
create function app.add_consultant_licence(
  p_membership_id uuid,
  p_licence_type public.licence_type,
  p_college_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  mem public.memberships%rowtype;
  college_id text := upper(btrim(coalesce(p_college_id, '')));
  credential_id uuid;
begin
  if actor is null or app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'adding a licence requires a recent step-up' using errcode = '42501';
  end if;
  select * into mem from public.memberships where id = p_membership_id;
  if mem.id is null
     or mem.role not in ('licensed_consultant', 'firm_owner')
     or mem.status is distinct from 'active'
     or app.in_active_org(mem.organization_id) is distinct from true then
    raise exception 'licence declaration denied' using errcode = '42501';
  end if;
  -- An owner's membership carries a licence only when the owner adds it themselves.
  if mem.role = 'firm_owner' and mem.user_id is distinct from actor then
    raise exception 'licence declaration denied' using errcode = '42501';
  end if;
  if mem.user_id is distinct from actor
     and app.has_org_role(mem.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'licence declaration denied' using errcode = '42501';
  end if;
  if p_licence_type is null then
    raise exception 'licence type is required' using errcode = '22023';
  end if;
  if college_id !~ '^[A-Z0-9-]{1,40}$' then
    raise exception 'college id is not usable' using errcode = '22023';
  end if;
  if exists (select 1 from public.consultant_credentials c where c.membership_id = mem.id) then
    raise exception 'this person already has a licence on file' using errcode = '23505';
  end if;

  insert into public.consultant_credentials (
    organization_id, membership_id, licence_type, college_id, status
  ) values (
    mem.organization_id, mem.id, p_licence_type, college_id, 'declared'
  )
  returning id into credential_id;

  update public.organizations
     set verification_status = 'pending_review'
   where id = mem.organization_id
     and verification_status = 'unverified';

  perform app.record_audit_event(
    mem.organization_id,
    'licence.declared',
    'public.consultant_credentials',
    credential_id,
    'success',
    jsonb_build_object('regulator', 'CICC', 'licence_type', p_licence_type, 'membership_id', mem.id, 'proof', false)
  );
  return credential_id;
end;
$$;
revoke all on function app.add_consultant_licence(uuid, public.licence_type, text) from public;

create function public.add_consultant_licence(
  p_membership_id uuid,
  p_licence_type public.licence_type,
  p_college_id text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.add_consultant_licence(p_membership_id, p_licence_type, p_college_id);
$$;
revoke all on function public.add_consultant_licence(uuid, public.licence_type, text) from public, anon;
grant execute on function app.add_consultant_licence(uuid, public.licence_type, text) to authenticated, service_role;
grant execute on function public.add_consultant_licence(uuid, public.licence_type, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Report a change
-- ---------------------------------------------------------------------------
create function app.report_licence_change(p_credential_id uuid, p_detail text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  credential public.consultant_credentials%rowtype;
  holder public.memberships%rowtype;
  detail text := btrim(coalesce(p_detail, ''));
  report_id uuid;
begin
  if actor is null or app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'reporting a licence change requires a recent step-up' using errcode = '42501';
  end if;
  select * into credential from public.consultant_credentials where id = p_credential_id;
  if credential.id is null or app.in_active_org(credential.organization_id) is distinct from true then
    raise exception 'licence change report denied' using errcode = '42501';
  end if;
  select * into holder
  from public.memberships
  where id = credential.membership_id and organization_id = credential.organization_id;
  if not (
    (holder.user_id = actor and holder.status = 'active')
    or app.has_org_role(credential.organization_id, array['firm_owner']::public.org_role[]) is true
  ) then
    raise exception 'licence change report denied' using errcode = '42501';
  end if;
  if length(detail) not between 3 and 1000 then
    raise exception 'describe the change in 3 to 1000 characters' using errcode = '22023';
  end if;

  insert into public.credential_change_reports (organization_id, credential_id, detail, reported_by)
  values (credential.organization_id, credential.id, detail, actor)
  returning id into report_id;

  -- Event-triggered review (ORG-04): the review is due now. Status is unchanged until a check.
  update public.consultant_credentials
     set next_review_at = least(coalesce(next_review_at, statement_timestamp()), statement_timestamp())
   where id = credential.id;

  perform app.enqueue_licence_event(
    credential.organization_id,
    credential.id,
    'licence.change_reported',
    jsonb_build_object('credential_id', credential.id, 'report_id', report_id),
    'licence.change_reported:' || report_id::text,
    statement_timestamp()
  );

  perform app.record_audit_event(
    credential.organization_id,
    'licence.change_reported',
    'public.credential_change_reports',
    report_id,
    'success',
    jsonb_build_object('credential_id', credential.id, 'detail_length', length(detail))
  );
  return report_id;
end;
$$;
revoke all on function app.report_licence_change(uuid, text) from public;

create function public.report_licence_change(p_credential_id uuid, p_detail text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.report_licence_change(p_credential_id, p_detail);
$$;
revoke all on function public.report_licence_change(uuid, text) from public, anon;
grant execute on function app.report_licence_change(uuid, text) to authenticated, service_role;
grant execute on function public.report_licence_change(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Review log
-- ---------------------------------------------------------------------------
create function public.licence_review_log(p_organization_id uuid)
returns table (
  at timestamptz,
  kind text,
  result text,
  credential_id uuid,
  holder_name text,
  college_id text,
  actor_name text,
  actor_is_platform boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_active_staff(p_organization_id, app.staff_roles(), false);
  return query
    with creds as (
      select c.id, c.college_id, c.declared_at, c.created_by,
             nullif(btrim(coalesce(prof.display_name, '')), '') as holder
      from public.consultant_credentials c
      join public.memberships mem on mem.id = c.membership_id and mem.organization_id = c.organization_id
      left join public.profiles prof on prof.id = mem.user_id
      where c.organization_id = p_organization_id
    ),
    entries as (
      select chk.retrieved_at as at, 'check'::text as kind, chk.result::text as result,
             chk.credential_id, chk.reviewer_user_id as actor
      from public.credential_checks chk
      where chk.organization_id = p_organization_id
      union all
      select creds.declared_at, 'declared', null, creds.id, creds.created_by
      from creds
      union all
      select rep.created_at, 'change_reported', null, rep.credential_id, rep.reported_by
      from public.credential_change_reports rep
      where rep.organization_id = p_organization_id
    )
    select entries.at, entries.kind, entries.result, entries.credential_id, creds.holder, creds.college_id,
           nullif(btrim(coalesce(actor_profile.display_name, '')), ''),
           exists (select 1 from public.platform_admins pa where pa.user_id = entries.actor)
    from entries
    join creds on creds.id = entries.credential_id
    left join public.profiles actor_profile on actor_profile.id = entries.actor
    order by entries.at desc
    limit 200;
end;
$$;
comment on function public.licence_review_log(uuid) is
  'The Licences page review log: manual register checks, licence declarations and change reports, newest first. Active staff at aal2. Read only.';
revoke all on function public.licence_review_log(uuid) from public, anon;
grant execute on function public.licence_review_log(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reassign chosen matters away from a consultant
-- ---------------------------------------------------------------------------
create function app.reassign_consultant_matters_selected(
  p_from_membership uuid,
  p_to_membership uuid,
  p_matter_ids uuid[],
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  source public.memberships%rowtype;
  target public.memberships%rowtype;
  target_status public.credential_status;
  matter public.matters%rowtype;
  moved integer := 0;
  v_matter_id uuid;
begin
  select * into source from public.memberships where id = p_from_membership;
  if source.id is null then
    raise exception 'reassignment denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    source.organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    true
  );
  -- The firm owner, or the consultant moving their own work.
  if source.user_id is distinct from actor
     and app.has_org_role(source.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'reassignment denied' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 8 and 500 then
    raise exception 'reassignment needs a reason' using errcode = '22023';
  end if;
  if p_matter_ids is null or cardinality(p_matter_ids) = 0 or cardinality(p_matter_ids) > 200 then
    raise exception 'choose the matters to reassign' using errcode = '22023';
  end if;
  select * into target from public.memberships where id = p_to_membership and organization_id = source.organization_id;
  if target.id is null
     or source.id = target.id
     or source.status is distinct from 'active'
     or target.status is distinct from 'active'
     or source.role not in ('licensed_consultant', 'firm_owner')
     or app.membership_is_licensed(target.id) is distinct from true then
    raise exception 'reassignment denied' using errcode = '42501';
  end if;
  select credential.status into target_status
  from public.consultant_credentials credential
  where credential.membership_id = target.id;
  if target_status is distinct from 'verified' or app.licence_status_blocks(target_status) then
    raise exception 'the receiving consultant needs a verified licence' using errcode = '42501';
  end if;

  foreach v_matter_id in array p_matter_ids loop
    select * into matter
    from public.matters m
    where m.id = v_matter_id and m.organization_id = source.organization_id
    for update;
    if matter.id is null or matter.stage = 'closed' then
      raise exception 'a chosen matter cannot be reassigned' using errcode = '42501';
    end if;
    if matter.responsible_consultant_membership_id is distinct from source.id
       and not exists (
         select 1 from public.matter_participants mp
         where mp.matter_id = matter.id and mp.membership_id = source.id and mp.role = 'consultant'
       ) then
      raise exception 'a chosen matter is not this consultant''s' using errcode = '42501';
    end if;

    if matter.responsible_consultant_membership_id = source.id then
      perform app.open_matter_column(matter.id, 'consultant');
      update public.matters
         set responsible_consultant_membership_id = target.id
       where id = matter.id;
      perform app.close_matter_column(matter.id);
    end if;

    if exists (
      select 1 from public.matter_participants existing
      where existing.matter_id = matter.id and existing.membership_id = target.id and existing.role = 'consultant'
    ) then
      delete from public.matter_participants
       where matter_participants.matter_id = matter.id
         and membership_id = source.id
         and role = 'consultant';
    else
      update public.matter_participants
         set membership_id = target.id
       where matter_participants.matter_id = matter.id
         and membership_id = source.id
         and role = 'consultant';
      insert into public.matter_participants (organization_id, matter_id, membership_id, role)
      values (matter.organization_id, matter.id, target.id, 'consultant')
      on conflict (matter_id, membership_id, role) do nothing;
    end if;

    perform app.record_audit_event(
      matter.organization_id,
      'matter.consultant_reassigned',
      'public.matters',
      matter.id,
      'success',
      jsonb_build_object('from_membership_id', source.id, 'to_membership_id', target.id, 'reason_length', length(btrim(p_reason)))
    );
    moved := moved + 1;
  end loop;

  perform app.record_audit_event(
    source.organization_id,
    'licence.matters_reassigned',
    'public.memberships',
    source.id,
    'success',
    jsonb_build_object('to_membership_id', target.id, 'count', moved, 'selected', true)
  );
  return moved;
end;
$$;
revoke all on function app.reassign_consultant_matters_selected(uuid, uuid, uuid[], text) from public;

create function public.reassign_consultant_matters_selected(
  p_from_membership uuid,
  p_to_membership uuid,
  p_matter_ids uuid[],
  p_reason text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select app.reassign_consultant_matters_selected(p_from_membership, p_to_membership, p_matter_ids, p_reason);
$$;
revoke all on function public.reassign_consultant_matters_selected(uuid, uuid, uuid[], text) from public, anon;
grant execute on function app.reassign_consultant_matters_selected(uuid, uuid, uuid[], text) to authenticated, service_role;
grant execute on function public.reassign_consultant_matters_selected(uuid, uuid, uuid[], text) to authenticated, service_role;
