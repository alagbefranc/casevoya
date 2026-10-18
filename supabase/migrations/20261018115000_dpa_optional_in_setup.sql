-- Firm setup no longer requires accepting a data processing agreement (decision 2026-10-18).
--
-- No DPA is published yet, so setup asked firms to accept a document that does not exist. The
-- terms step now requires only the subscription terms; a DPA acceptance is recorded only when the
-- payload carries dpa_accepted = true (with its version), so it can be switched back on once a
-- real DPA is published. Body copied from 20261017140700_firm_onboarding.sql (its only
-- definition); only the terms_and_privacy branch changes. Grants are kept by create or replace.

create or replace function app.save_firm_setup(p_step public.firm_setup_step, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  email text;
  billing_email text;
  locale text;
  zone text;
  codes text[];
  code text;
  years integer;
begin
  perform app.require_firm_owner_step_up(org);
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'setup payload is required' using errcode = '22023';
  end if;

  if p_step = 'firm_details' then
    locale := p_payload ->> 'locale';
    zone := btrim(coalesce(p_payload ->> 'timezone', ''));
    billing_email := app.normalize_email(p_payload ->> 'billing_contact_email');
    if locale not in ('en-CA', 'fr-CA') or zone !~ '^[A-Za-z_]+(/[A-Za-z_]+){1,2}$' then
      raise exception 'locale or timezone is not usable' using errcode = '22023';
    end if;
    if length(btrim(coalesce(p_payload ->> 'legal_name', ''))) not between 1 and 300
       or length(btrim(coalesce(p_payload ->> 'display_name', ''))) not between 1 and 200
       or length(btrim(coalesce(p_payload ->> 'billing_contact_name', ''))) not between 1 and 200
       or billing_email is null then
      raise exception 'firm name and billing contact are required' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.organization_offices office
      where office.organization_id = org and office.is_primary
    ) then
      raise exception 'add the main office before completing firm details' using errcode = '22023';
    end if;
    update public.organizations
       set legal_name = btrim(p_payload ->> 'legal_name'),
           display_name = btrim(p_payload ->> 'display_name'),
           default_locale = locale,
           timezone = zone,
           billing_contact_name = btrim(p_payload ->> 'billing_contact_name'),
           billing_contact_email = billing_email
     where id = org;
  elsif p_step = 'jurisdictions' then
    select coalesce(array_agg(value), array[]::text[]) into codes
    from jsonb_array_elements_text(coalesce(p_payload -> 'codes', '[]'::jsonb)) as t(value);
    if cardinality(codes) < 1 then
      raise exception 'choose at least one jurisdiction code' using errcode = '22023';
    end if;
    foreach code in array codes loop
      if code !~ '^[A-Z]{2}$' then
        raise exception 'jurisdiction codes are two letters' using errcode = '22023';
      end if;
    end loop;
    update public.organizations set jurisdiction_codes = codes where id = org;
  elsif p_step = 'terms_and_privacy' then
    if (p_payload ->> 'subscription_terms_accepted') is distinct from 'true' then
      raise exception 'subscription terms must be accepted' using errcode = '22023';
    end if;
    -- The DPA is recorded only when it is offered and accepted (none is published yet).
    if (p_payload ? 'dpa_accepted') and (p_payload ->> 'dpa_accepted') is distinct from 'true' then
      raise exception 'the data processing agreement can only be recorded as accepted' using errcode = '22023';
    end if;
    email := app.normalize_email(p_payload ->> 'privacy_contact_email');
    if email is null
       or length(btrim(coalesce(p_payload ->> 'privacy_contact_name', ''))) not between 1 and 200
       or ((p_payload ->> 'dpa_accepted') = 'true' and length(btrim(coalesce(p_payload ->> 'dpa_version', ''))) not between 1 and 40)
       or length(btrim(coalesce(p_payload ->> 'subscription_terms_version', ''))) not between 1 and 40 then
      raise exception 'privacy contact and terms versions are required' using errcode = '22023';
    end if;
    update public.organizations
       set privacy_contact_name = btrim(p_payload ->> 'privacy_contact_name'),
           privacy_contact_email = email,
           dpa_version = case when (p_payload ->> 'dpa_accepted') = 'true' then btrim(p_payload ->> 'dpa_version') else dpa_version end,
           dpa_accepted_at = case when (p_payload ->> 'dpa_accepted') = 'true' then statement_timestamp() else dpa_accepted_at end,
           subscription_terms_version = btrim(p_payload ->> 'subscription_terms_version'),
           subscription_terms_accepted_at = statement_timestamp()
     where id = org;
  elsif p_step = 'branding' then
    if (p_payload ->> 'acknowledged') is distinct from 'true' then
      raise exception 'branding step must be acknowledged' using errcode = '22023';
    end if;
    if nullif(p_payload ->> 'accent', '') is not null
       and (p_payload ->> 'accent') !~ '^#[0-9A-Fa-f]{6}$' then
      raise exception 'accent must be a hex colour' using errcode = '22023';
    end if;
    update public.organizations
       set branding = jsonb_strip_nulls(jsonb_build_object(
         'logo_locator', nullif(btrim(coalesce(p_payload ->> 'logo_locator', '')), ''),
         'accent', nullif(p_payload ->> 'accent', '')
       ))
     where id = org;
  elsif p_step = 'calendar_and_payments' then
    if (p_payload ->> 'acknowledged') is distinct from 'true' then
      raise exception 'calendar and payments must be acknowledged' using errcode = '22023';
    end if;
  elsif p_step = 'records_and_retention' then
    begin
      years := (p_payload ->> 'count')::integer;
    exception when others then
      years := null;
    end;
    if (p_payload ->> 'unit') is distinct from 'years' or years is null or years not between 1 and 100 then
      raise exception 'retention is a firm-chosen number of years' using errcode = '22023';
    end if;
    update public.organizations
       set retention_policy = jsonb_build_object('unit', 'years', 'count', years)
     where id = org;
  elsif p_step = 'sample_case' then
    if (p_payload ->> 'acknowledged') is distinct from 'true' then
      raise exception 'the sample case must be acknowledged' using errcode = '22023';
    end if;
  elsif p_step = 'licence' then
    if not exists (
      select 1 from public.consultant_credentials credential
      where credential.organization_id = org
    ) then
      raise exception 'declare a consultant licence before completing this step' using errcode = '22023';
    end if;
  end if;

  insert into public.organization_setup_steps (organization_id, step, completed_by)
  values (org, p_step, (select auth.uid()))
  on conflict (organization_id, step) do update
    set completed_at = statement_timestamp(),
        completed_by = excluded.completed_by;

  perform app.record_audit_event(
    org,
    'firm.setup_step_completed',
    'public.organization_setup_steps',
    org,
    'success',
    jsonb_build_object('step', p_step)
  );
end;
$$;
