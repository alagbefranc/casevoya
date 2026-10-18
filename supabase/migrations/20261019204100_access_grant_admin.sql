-- Sheet: Access grants page (branch sheet-firm-admin). PRD §5 explicit grants, SEC-01 step-up.
--
-- public.access_grants already holds explicit and guardian grants (a person with a portal login
-- reads another person's records, person-wide or on one matter; explicit grants are read only).
-- Until now an owner wrote them through RLS policies with no expiry rule and no audited reason.
-- This migration adds the Access grants page's functions; the table and its policies are
-- unchanged:
--   * public.firm_access_grants(org): the firm's grants with the names a firm owner needs to manage
--     them (grantee, subject, matter reference, who granted). Person rows stay assignment-based
--     (decision 2026-10-17), so names come through this read for a firm owner at aal2 only.
--   * public.access_grant_choices(org): who can receive a grant (people with a portal login) and
--     which matter records it can open (each person party on an open matter). Firm owner at aal2.
--   * public.create_access_grant: firm owner with a recent step-up. An explicit, read-only grant
--     on one matter, for a named purpose, ending at the next local midnight after the chosen date
--     (the firm's timezone). It cannot be open-ended: at most 366 days ahead (a product control,
--     pending Francis). Sample and real records do not mix. Audited access_grant.created.
--   * public.revoke_access_grant: firm owner with a recent step-up, with a reason. Audited
--     access_grant.revoked (reason length only). A guardian grant can be revoked the same way.
-- No existing function is redefined.

create function public.firm_access_grants(p_organization_id uuid)
returns table (
  id uuid,
  kind public.access_grant_kind,
  grantee_name text,
  subject_name text,
  matter_reference text,
  purpose text,
  created_at timestamptz,
  granted_by_name text,
  granted_by_grantee boolean,
  expires_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner']::public.org_role[], false);
  return query
    select g.id, g.kind, grantee.display_name, subject.display_name, matter.reference, g.purpose,
           g.created_at, nullif(btrim(coalesce(prof.display_name, '')), ''),
           (grantee.user_id is not null and grantee.user_id = g.created_by),
           g.expires_at, g.revoked_at
    from public.access_grants g
    join public.persons grantee on grantee.id = g.grantee_person_id and grantee.organization_id = g.organization_id
    join public.persons subject on subject.id = g.subject_person_id and subject.organization_id = g.organization_id
    left join public.matters matter on matter.id = g.matter_id and matter.organization_id = g.organization_id
    left join public.profiles prof on prof.id = g.created_by
    where g.organization_id = p_organization_id
    order by (g.revoked_at is null and (g.expires_at is null or g.expires_at > statement_timestamp())) desc,
             g.created_at desc
    limit 200;
end;
$$;
comment on function public.firm_access_grants(uuid) is
  'The Access grants page: the firm''s grants with grantee, subject, matter reference and granter names. Firm owner at aal2. Read only.';
revoke all on function public.firm_access_grants(uuid) from public, anon;
grant execute on function public.firm_access_grants(uuid) to authenticated;

create function public.access_grant_choices(p_organization_id uuid)
returns table (
  choice text,
  person_id uuid,
  person_name text,
  matter_id uuid,
  matter_reference text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner']::public.org_role[], false);
  return query
    select 'grantee'::text, person.id, person.display_name, null::uuid, null::text
    from public.persons person
    where person.organization_id = p_organization_id
      and person.user_id is not null
    union all
    select 'scope'::text, person.id, person.display_name, matter.id, matter.reference
    from public.matter_participants mp
    join public.persons person on person.id = mp.person_id and person.organization_id = mp.organization_id
    join public.matters matter on matter.id = mp.matter_id and matter.organization_id = mp.organization_id
    where mp.organization_id = p_organization_id
      and matter.stage <> 'closed'
    order by 1, 3, 5
    limit 400;
end;
$$;
comment on function public.access_grant_choices(uuid) is
  'The New access grant dialog: people with a portal login, and each person party on an open matter. Firm owner at aal2. Read only.';
revoke all on function public.access_grant_choices(uuid) from public, anon;
grant execute on function public.access_grant_choices(uuid) to authenticated;

create function app.create_access_grant(
  p_grantee_person_id uuid,
  p_subject_person_id uuid,
  p_matter_id uuid,
  p_expires_on date,
  p_purpose text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  grantee public.persons%rowtype;
  subject public.persons%rowtype;
  matter public.matters%rowtype;
  zone text;
  local_today date;
  ends timestamptz;
  purpose text := btrim(coalesce(p_purpose, ''));
  grant_id uuid;
begin
  perform app.require_firm_owner_step_up(org);
  select * into grantee from public.persons where id = p_grantee_person_id and organization_id = org;
  select * into subject from public.persons where id = p_subject_person_id and organization_id = org;
  select * into matter from public.matters where id = p_matter_id and organization_id = org;
  if grantee.id is null or subject.id is null or matter.id is null then
    raise exception 'access grant denied' using errcode = '42501';
  end if;
  if grantee.id = subject.id then
    raise exception 'a person already sees their own records' using errcode = '22023';
  end if;
  if grantee.user_id is null then
    raise exception 'the person needs a portal login first' using errcode = '22023';
  end if;
  if matter.stage = 'closed' then
    raise exception 'the matter is closed' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.matter_participants mp
    where mp.matter_id = matter.id and mp.organization_id = org and mp.person_id = subject.id
  ) then
    raise exception 'the person is not on that matter' using errcode = '22023';
  end if;
  if grantee.is_sample is distinct from subject.is_sample or subject.is_sample is distinct from matter.is_sample then
    raise exception 'sample and real records cannot share a grant' using errcode = '22023';
  end if;
  if length(purpose) not between 3 and 500 then
    raise exception 'give a reason of 3 to 500 characters' using errcode = '22023';
  end if;
  select coalesce(o.timezone, 'America/Toronto') into zone from public.organizations o where o.id = org;
  local_today := (statement_timestamp() at time zone zone)::date;
  if p_expires_on is null or p_expires_on < local_today or p_expires_on > local_today + 366 then
    raise exception 'choose an end date from today up to a year ahead' using errcode = '22023';
  end if;
  -- Ends at the next local midnight after the chosen day.
  ends := ((p_expires_on + 1)::timestamp) at time zone zone;

  insert into public.access_grants (
    organization_id, grantee_person_id, subject_person_id, matter_id, kind, purpose, expires_at
  ) values (
    org, grantee.id, subject.id, matter.id, 'explicit', purpose, ends
  )
  returning id into grant_id;

  perform app.record_audit_event(
    org,
    'access_grant.created',
    'public.access_grants',
    grant_id,
    'success',
    jsonb_build_object('matter_id', matter.id, 'expires_at', ends, 'purpose_length', length(purpose))
  );
  return grant_id;
end;
$$;
revoke all on function app.create_access_grant(uuid, uuid, uuid, date, text) from public;

create function public.create_access_grant(
  p_grantee_person_id uuid,
  p_subject_person_id uuid,
  p_matter_id uuid,
  p_expires_on date,
  p_purpose text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app.create_access_grant(p_grantee_person_id, p_subject_person_id, p_matter_id, p_expires_on, p_purpose);
$$;
revoke all on function public.create_access_grant(uuid, uuid, uuid, date, text) from public, anon;
grant execute on function app.create_access_grant(uuid, uuid, uuid, date, text) to authenticated, service_role;
grant execute on function public.create_access_grant(uuid, uuid, uuid, date, text) to authenticated, service_role;

create function app.revoke_access_grant(p_grant_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  row_grant public.access_grants%rowtype;
begin
  perform app.require_firm_owner_step_up(org);
  select * into row_grant from public.access_grants where id = p_grant_id and organization_id = org for update;
  if row_grant.id is null then
    raise exception 'access grant denied' using errcode = '42501';
  end if;
  if row_grant.revoked_at is not null then
    raise exception 'that grant was already revoked' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'give a reason of 3 to 500 characters' using errcode = '22023';
  end if;
  update public.access_grants set revoked_at = statement_timestamp() where id = row_grant.id;
  perform app.record_audit_event(
    org,
    'access_grant.revoked',
    'public.access_grants',
    row_grant.id,
    'success',
    jsonb_build_object('kind', row_grant.kind, 'reason_length', length(btrim(p_reason)))
  );
end;
$$;
revoke all on function app.revoke_access_grant(uuid, text) from public;

create function public.revoke_access_grant(p_grant_id uuid, p_reason text)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.revoke_access_grant(p_grant_id, p_reason);
$$;
revoke all on function public.revoke_access_grant(uuid, text) from public, anon;
grant execute on function app.revoke_access_grant(uuid, text) to authenticated, service_role;
grant execute on function public.revoke_access_grant(uuid, text) to authenticated, service_role;
