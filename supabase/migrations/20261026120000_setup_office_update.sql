-- Firm setup step 1 saves the main office in place (issue #259, fix 5).
--
-- app.save_organization_office demoted the current primary office and inserted a new one on every
-- save, so Back then Continue on /setup left two "Main office" rows. Saving a primary office now
-- updates the firm's existing primary office when there is one, and inserts only when there is
-- none. A non-primary save still inserts. Body copied from 20261017140700_firm_onboarding.sql (its
-- only definition); only the primary branch changes. Grants are kept by create or replace.

create or replace function app.save_organization_office(
  p_label text,
  p_address_line text,
  p_locality text,
  p_region text,
  p_postal_code text,
  p_country_code text,
  p_is_primary boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  office_id uuid;
  country text := upper(btrim(coalesce(p_country_code, 'CA')));
begin
  perform app.require_firm_owner_step_up(org);
  if length(btrim(coalesce(p_label, ''))) not between 1 and 120
     or length(btrim(coalesce(p_address_line, ''))) not between 1 and 300
     or length(btrim(coalesce(p_locality, ''))) not between 1 and 120
     or country !~ '^[A-Z]{2}$' then
    raise exception 'office address is incomplete' using errcode = '22023';
  end if;
  if coalesce(p_is_primary, false) then
    -- The firm's main office is edited in place: one row however often setup saves it.
    update public.organization_offices
       set label = btrim(p_label),
           address_line = btrim(p_address_line),
           locality = btrim(p_locality),
           region = nullif(btrim(coalesce(p_region, '')), ''),
           postal_code = nullif(btrim(coalesce(p_postal_code, '')), ''),
           country_code = country
     where organization_id = org
       and is_primary
    returning id into office_id;
    if office_id is not null then
      return office_id;
    end if;
  end if;
  insert into public.organization_offices (
    organization_id, label, address_line, locality, region, postal_code, country_code, is_primary
  ) values (
    org,
    btrim(p_label),
    btrim(p_address_line),
    btrim(p_locality),
    nullif(btrim(coalesce(p_region, '')), ''),
    nullif(btrim(coalesce(p_postal_code, '')), ''),
    country,
    coalesce(p_is_primary, false)
  )
  returning id into office_id;
  return office_id;
end;
$$;
revoke all on function app.save_organization_office(text, text, text, text, text, text, boolean) from public;
