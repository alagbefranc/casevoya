-- ORG-01 (#175): a firm default language. Settings > Language and time saves
-- organizations.default_locale through update_firm_profile; the invite page pre-selects it
-- (preview_portal_invitation returns it); and email falls back to it when the recipient has no
-- stored language of their own.

create or replace function public.update_firm_profile(p_organization_id uuid, p_changes jsonb)
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
    'timezone', 'default_locale'
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

  if p_changes ? 'default_locale' then
    value := btrim(coalesce(p_changes ->> 'default_locale', ''));
    if value not in ('en-CA', 'fr-CA') then
      raise exception 'language is not usable' using errcode = '22023';
    end if;
    firm.default_locale := value;
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
         timezone = firm.timezone,
         default_locale = firm.default_locale
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
    'organization', jsonb_build_object('display_name', firm.display_name, 'branding', firm.branding, 'default_locale', firm.default_locale),
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

create or replace function public.email_delivery_locales(p_delivery_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_delivery_ids is null or cardinality(p_delivery_ids) > 500 then
    raise exception 'too many deliveries' using errcode = '22023';
  end if;
  -- French only when every person in the delivery's firm with that address who has a stored
  -- preference chose fr-CA; otherwise (no person, mixed, or English) en-CA. A recipient who is
  -- not a person (a staff member) uses their profile's preferred_locale while they are an
  -- active member of that firm. Anyone else (a new client before they choose) gets the firm's
  -- default language (ORG-01).
  select coalesce(jsonb_object_agg(delivery.id::text, coalesce(person_locale.locale, staff_locale.locale, firm.default_locale, 'en-CA')), '{}'::jsonb)
  into result
  from public.email_deliveries delivery
  left join lateral (
    select case when count(pref.person_id) > 0 and bool_and(pref.locale = 'fr-CA') then 'fr-CA' else 'en-CA' end as locale
    from public.persons person
    join public.person_contact_preferences pref
      on pref.person_id = person.id
     and pref.organization_id = person.organization_id
    where person.organization_id = delivery.organization_id
      and lower(person.email) = delivery.recipient_email
    having count(pref.person_id) > 0
  ) person_locale on true
  left join lateral (
    select case when bool_and(profile.preferred_locale = 'fr-CA') then 'fr-CA' else 'en-CA' end as locale
    from auth.users users
    join public.memberships membership
      on membership.user_id = users.id
     and membership.organization_id = delivery.organization_id
     and membership.status = 'active'
    join public.profiles profile on profile.id = users.id
    where lower(users.email) = delivery.recipient_email
    having count(*) > 0
  ) staff_locale on true
  left join public.organizations firm on firm.id = delivery.organization_id
  where delivery.id = any(p_delivery_ids);
  return result;
end;
$$;
revoke all on function public.email_delivery_locales(uuid[]) from public, anon, authenticated;
grant execute on function public.email_delivery_locales(uuid[]) to service_role;


-- Each delivery's firm look for the email header (ORG-01): the firm's stored logo locator and
-- colour from organizations.branding, for firm emails. The mail worker turns the locator into a
-- public /api/firm/logo link only when it is that firm's own stored logo. Worker role only.
create function public.email_delivery_brands(p_delivery_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_delivery_ids is null or cardinality(p_delivery_ids) > 500 then
    raise exception 'too many deliveries' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(delivery.id::text, jsonb_build_object(
    'organization_id', firm.id,
    'logo_locator', firm.branding ->> 'logo_locator',
    'accent', firm.branding ->> 'accent'
  )), '{}'::jsonb)
  into result
  from public.email_deliveries delivery
  join public.organizations firm on firm.id = delivery.organization_id
  where delivery.id = any(p_delivery_ids)
    and jsonb_typeof(firm.branding) = 'object';
  return result;
end;
$$;
revoke all on function public.email_delivery_brands(uuid[]) from public, anon, authenticated;
grant execute on function public.email_delivery_brands(uuid[]) to service_role;
