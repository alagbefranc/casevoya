-- Settings > Firm, Offices, Branding, Language and time (ORG-01, ORG-06, PRD §6 "Store language
-- and timezone per person").
--
-- Additive only. No existing function is redefined.
--
--   organization_offices.timezone   The office's own IANA timezone. Null means the firm's timezone.
--   app.is_known_timezone(text)     True for a name Postgres knows (pg_timezone_names).
--   public.update_firm_profile      Firm owner + step-up. Changes only the keys it is given: legal
--                                   and display name, billing / privacy / continuity contacts, firm
--                                   timezone. Audited firm.profile_updated with the key names only.
--   public.save_firm_office         Firm owner + step-up. Adds an office (p_office_id null) or edits
--                                   one of this firm's offices, with its timezone. Audited
--                                   firm.office_saved (the row trigger also audits the change).
--   public.remove_firm_office       Firm owner + step-up. Removes an office that is not the main one.
--                                   Audited firm.office_removed.
--   public.set_my_timezone          Any active staff member with MFA, for their own profile only.
--                                   Audited profile.timezone_changed.
--
-- Branding (logo and colour) keeps using public.save_firm_setup('branding', ...) and the
-- firm-logos bucket from 20261018060000_firm_logos.sql; nothing new is needed for it.

alter table public.organization_offices
  add column timezone text
    check (timezone is null or timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2}$');
comment on column public.organization_offices.timezone is
  'The office''s IANA timezone. Null means the firm''s own timezone (organizations.timezone).';

create function app.is_known_timezone(p_zone text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_zone, '') ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2}$'
     and exists (select 1 from pg_catalog.pg_timezone_names zone where zone.name = p_zone);
$$;
revoke all on function app.is_known_timezone(text) from public;
grant execute on function app.is_known_timezone(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Firm profile
-- ---------------------------------------------------------------------------
create function public.update_firm_profile(p_organization_id uuid, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text;
  allowed text[] := array[
    'legal_name', 'display_name',
    'billing_contact_name', 'billing_contact_email',
    'privacy_contact_name', 'privacy_contact_email',
    'continuity_contact_name', 'continuity_contact_email',
    'timezone'
  ];
  value text;
  email text;
  firm public.organizations%rowtype;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'nothing to change' using errcode = '22023';
  end if;
  for key in select jsonb_object_keys(p_changes)
  loop
    if not (key = any (allowed)) or jsonb_typeof(p_changes -> key) not in ('string', 'null') then
      raise exception 'unknown firm detail' using errcode = '22023';
    end if;
  end loop;

  select * into firm from public.organizations where id = p_organization_id for update;
  if firm.id is null then
    raise exception 'firm not found' using errcode = '42501';
  end if;

  -- Names that must never be blank.
  if p_changes ? 'legal_name' then
    value := btrim(coalesce(p_changes ->> 'legal_name', ''));
    if length(value) not between 1 and 300 then
      raise exception 'legal name is required' using errcode = '22023';
    end if;
    firm.legal_name := value;
  end if;
  if p_changes ? 'display_name' then
    value := btrim(coalesce(p_changes ->> 'display_name', ''));
    if length(value) not between 1 and 200 then
      raise exception 'display name is required' using errcode = '22023';
    end if;
    firm.display_name := value;
  end if;

  -- Billing and privacy contacts were required at setup and stay required.
  if p_changes ? 'billing_contact_name' then
    value := btrim(coalesce(p_changes ->> 'billing_contact_name', ''));
    if length(value) not between 1 and 200 then
      raise exception 'billing contact is required' using errcode = '22023';
    end if;
    firm.billing_contact_name := value;
  end if;
  if p_changes ? 'billing_contact_email' then
    email := app.normalize_email(p_changes ->> 'billing_contact_email');
    if email is null then
      raise exception 'billing contact email is not usable' using errcode = '22023';
    end if;
    firm.billing_contact_email := email;
  end if;
  if p_changes ? 'privacy_contact_name' then
    value := btrim(coalesce(p_changes ->> 'privacy_contact_name', ''));
    if length(value) not between 1 and 200 then
      raise exception 'privacy contact is required' using errcode = '22023';
    end if;
    firm.privacy_contact_name := value;
  end if;
  if p_changes ? 'privacy_contact_email' then
    email := app.normalize_email(p_changes ->> 'privacy_contact_email');
    if email is null then
      raise exception 'privacy contact email is not usable' using errcode = '22023';
    end if;
    firm.privacy_contact_email := email;
  end if;

  -- The continuity contact (ORG-06) may be cleared; a blank value is no contact.
  if p_changes ? 'continuity_contact_name' then
    value := nullif(btrim(coalesce(p_changes ->> 'continuity_contact_name', '')), '');
    if value is not null and length(value) > 200 then
      raise exception 'continuity contact is too long' using errcode = '22023';
    end if;
    firm.continuity_contact_name := value;
  end if;
  if p_changes ? 'continuity_contact_email' then
    value := nullif(btrim(coalesce(p_changes ->> 'continuity_contact_email', '')), '');
    email := app.normalize_email(value);
    if value is not null and email is null then
      raise exception 'continuity contact email is not usable' using errcode = '22023';
    end if;
    firm.continuity_contact_email := email;
  end if;

  if p_changes ? 'timezone' then
    value := btrim(coalesce(p_changes ->> 'timezone', ''));
    if not app.is_known_timezone(value) then
      raise exception 'timezone is not usable' using errcode = '22023';
    end if;
    firm.timezone := value;
  end if;

  update public.organizations
     set legal_name = firm.legal_name,
         display_name = firm.display_name,
         billing_contact_name = firm.billing_contact_name,
         billing_contact_email = firm.billing_contact_email,
         privacy_contact_name = firm.privacy_contact_name,
         privacy_contact_email = firm.privacy_contact_email,
         continuity_contact_name = firm.continuity_contact_name,
         continuity_contact_email = firm.continuity_contact_email,
         timezone = firm.timezone
   where id = p_organization_id;

  perform app.record_audit_event(
    p_organization_id,
    'firm.profile_updated',
    'public.organizations',
    p_organization_id,
    'success',
    jsonb_build_object('fields', (select jsonb_agg(k order by k) from jsonb_object_keys(p_changes) as t(k)))
  );
end;
$$;
revoke all on function public.update_firm_profile(uuid, jsonb) from public, anon;
grant execute on function public.update_firm_profile(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Offices
-- ---------------------------------------------------------------------------
create function public.save_firm_office(
  p_organization_id uuid,
  p_office_id uuid,
  p_label text,
  p_address_line text,
  p_locality text,
  p_region text,
  p_postal_code text,
  p_country_code text,
  p_timezone text,
  p_is_primary boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  office_id uuid := p_office_id;
  country text := upper(btrim(coalesce(p_country_code, 'CA')));
  zone text := nullif(btrim(coalesce(p_timezone, '')), '');
  was_primary boolean;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  if length(btrim(coalesce(p_label, ''))) not between 1 and 120
     or length(btrim(coalesce(p_address_line, ''))) not between 1 and 300
     or length(btrim(coalesce(p_locality, ''))) not between 1 and 120
     or length(btrim(coalesce(p_region, ''))) > 80
     or length(btrim(coalesce(p_postal_code, ''))) > 20
     or country !~ '^[A-Z]{2}$' then
    raise exception 'office address is incomplete' using errcode = '22023';
  end if;
  if zone is not null and not app.is_known_timezone(zone) then
    raise exception 'timezone is not usable' using errcode = '22023';
  end if;

  if office_id is not null then
    select office.is_primary into was_primary
      from public.organization_offices office
     where office.id = office_id and office.organization_id = p_organization_id
     for update;
    if not found then
      raise exception 'office not found' using errcode = '42501';
    end if;
    if was_primary and not coalesce(p_is_primary, false) then
      raise exception 'choose another main office first' using errcode = '22023';
    end if;
  end if;

  if coalesce(p_is_primary, false) then
    update public.organization_offices
       set is_primary = false
     where organization_id = p_organization_id
       and is_primary
       and id is distinct from office_id;
  end if;

  if office_id is null then
    insert into public.organization_offices (
      organization_id, label, address_line, locality, region, postal_code, country_code, timezone, is_primary
    ) values (
      p_organization_id,
      btrim(p_label),
      btrim(p_address_line),
      btrim(p_locality),
      nullif(btrim(coalesce(p_region, '')), ''),
      nullif(btrim(coalesce(p_postal_code, '')), ''),
      country,
      zone,
      coalesce(p_is_primary, false)
    )
    returning id into office_id;
  else
    update public.organization_offices
       set label = btrim(p_label),
           address_line = btrim(p_address_line),
           locality = btrim(p_locality),
           region = nullif(btrim(coalesce(p_region, '')), ''),
           postal_code = nullif(btrim(coalesce(p_postal_code, '')), ''),
           country_code = country,
           timezone = zone,
           is_primary = coalesce(p_is_primary, false)
     where id = office_id
       and organization_id = p_organization_id;
  end if;

  perform app.record_audit_event(
    p_organization_id,
    'firm.office_saved',
    'public.organization_offices',
    office_id,
    'success',
    jsonb_build_object('created', p_office_id is null, 'primary', coalesce(p_is_primary, false))
  );
  return office_id;
end;
$$;
revoke all on function public.save_firm_office(uuid, uuid, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_firm_office(uuid, uuid, text, text, text, text, text, text, text, boolean) to authenticated, service_role;

create function public.remove_firm_office(p_organization_id uuid, p_office_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_office boolean;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  select office.is_primary into primary_office
    from public.organization_offices office
   where office.id = p_office_id and office.organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'office not found' using errcode = '42501';
  end if;
  if primary_office then
    raise exception 'the main office cannot be removed' using errcode = '22023';
  end if;
  delete from public.organization_offices
   where id = p_office_id
     and organization_id = p_organization_id;
  perform app.record_audit_event(
    p_organization_id,
    'firm.office_removed',
    'public.organization_offices',
    p_office_id,
    'success',
    '{}'::jsonb
  );
end;
$$;
revoke all on function public.remove_firm_office(uuid, uuid) from public, anon;
grant execute on function public.remove_firm_office(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A staff member's own timezone (profiles.timezone)
-- ---------------------------------------------------------------------------
create function public.set_my_timezone(p_organization_id uuid, p_timezone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  zone text := btrim(coalesce(p_timezone, ''));
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant', 'finance_user']::public.org_role[],
    false
  );
  if not app.is_known_timezone(zone) then
    raise exception 'timezone is not usable' using errcode = '22023';
  end if;
  update public.profiles
     set timezone = zone
   where id = (select auth.uid());
  perform app.record_audit_event(
    p_organization_id,
    'profile.timezone_changed',
    'public.profiles',
    (select auth.uid()),
    'success',
    jsonb_build_object('timezone', zone)
  );
end;
$$;
revoke all on function public.set_my_timezone(uuid, text) from public, anon;
grant execute on function public.set_my_timezone(uuid, text) to authenticated, service_role;
