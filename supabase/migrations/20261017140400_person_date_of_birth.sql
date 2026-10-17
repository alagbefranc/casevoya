-- Date of birth is the source of minor status (PRD §5 and §18).
-- is_minor stays as a stored mirror for older readers. Authorization uses
-- app.person_is_minor, which is recomputed from the date, its precision, and
-- the firm's age_of_majority_years. A partial date counts as minor only when
-- every possible birthday is still under that age, so a possible adult does
-- not keep a guardian grant.
-- age_of_majority_years default 19 is a product safety setting (the higher
-- age used by some Canadian provinces). It is not a finding of law.
-- Null date of birth is not a confirmed minor. No date is invented for old rows.

create type public.date_precision as enum ('day', 'month', 'year');

alter table public.organizations
  add column age_of_majority_years smallint not null default 19
  check (age_of_majority_years between 18 and 21);
comment on column public.organizations.age_of_majority_years is
  'Product setting for guardian expiry. Default 19. Not an immigration-law finding.';

alter table public.persons
  add column date_of_birth date,
  add column birth_date_precision public.date_precision;

alter table public.persons
  add constraint persons_dob_pair_ck check (
    (date_of_birth is null and birth_date_precision is null)
    or (date_of_birth is not null and birth_date_precision is not null)
  );
alter table public.persons
  add constraint persons_dob_month_ck check (
    birth_date_precision is distinct from 'month'
    or extract(day from date_of_birth) = 1
  );
alter table public.persons
  add constraint persons_dob_year_ck check (
    birth_date_precision is distinct from 'year'
    or (
      extract(month from date_of_birth) = 1
      and extract(day from date_of_birth) = 1
    )
  );

comment on column public.persons.date_of_birth is
  'Canonical birth date. Month precision stores day 1. Year precision stores 1 January. Null means unknown.';
comment on column public.persons.birth_date is
  'Mirror of date_of_birth kept for existing readers. Do not write it on its own.';
comment on column public.persons.is_minor is
  'Mirror of app.person_is_minor at the last write. Guardian grants use the live function, not this column.';

create function app.derive_is_minor(
  p_dob date,
  p_precision public.date_precision,
  p_majority_years integer,
  p_on date
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  earliest date;
  latest date;
begin
  if p_dob is null or p_precision is null or p_majority_years is null or p_on is null then
    return false;
  end if;
  if p_precision = 'day' then
    earliest := p_dob;
    latest := p_dob;
  elsif p_precision = 'month' then
    earliest := date_trunc('month', p_dob)::date;
    latest := (date_trunc('month', p_dob) + interval '1 month' - interval '1 day')::date;
  else
    earliest := date_trunc('year', p_dob)::date;
    latest := (date_trunc('year', p_dob) + interval '1 year' - interval '1 day')::date;
  end if;
  -- Definitely a minor only when even the oldest possible birthday is still under the age.
  -- latest is retained so callers can see the range is intentional; ambiguity is not "minor".
  if latest < earliest then
    return false;
  end if;
  return (earliest + make_interval(years => p_majority_years))::date > p_on;
end;
$$;

create function app.person_is_minor(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select app.derive_is_minor(
        person.date_of_birth,
        person.birth_date_precision,
        org.age_of_majority_years,
        current_date
      )
      from public.persons person
      join public.organizations org on org.id = person.organization_id
      where person.id = p_person_id
    ),
    false
  );
$$;

create function app.sync_person_birth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  majority integer;
  was_minor boolean := case when tg_op = 'UPDATE' then old.is_minor else false end;
begin
  if new.date_of_birth is null and new.birth_date is not null then
    new.date_of_birth := new.birth_date;
    new.birth_date_precision := coalesce(new.birth_date_precision, 'day');
  end if;
  if new.date_of_birth is not null and new.birth_date_precision is null then
    new.birth_date_precision := 'day';
  end if;
  if new.date_of_birth is null then
    new.birth_date_precision := null;
    new.birth_date := null;
    new.is_minor := false;
    return new;
  end if;
  if new.date_of_birth > current_date then
    raise exception 'date of birth cannot be in the future' using errcode = '22023';
  end if;
  new.birth_date := new.date_of_birth;

  select org.age_of_majority_years into majority
  from public.organizations org
  where org.id = new.organization_id;
  new.is_minor := app.derive_is_minor(
    new.date_of_birth,
    new.birth_date_precision,
    majority,
    current_date
  );

  if tg_op = 'UPDATE' and was_minor and new.is_minor is distinct from true then
    perform app.enqueue_event(
      new.organization_id,
      'person',
      new.id,
      'person.majority_review_due',
      jsonb_build_object('person_id', new.id, 'date_of_birth', new.date_of_birth),
      new.version,
      'majority:' || new.id::text || ':' || new.date_of_birth::text
    );
  end if;
  return new;
end;
$$;
revoke all on function app.sync_person_birth() from public;

-- Named to run after persons_touch so the outbox records the bumped version.
create trigger persons_z_sync_birth before insert or update on public.persons
  for each row execute function app.sync_person_birth();

update public.persons
set date_of_birth = birth_date,
    birth_date_precision = 'day'
where birth_date is not null
  and date_of_birth is null;

create or replace function app.grant_allows(p_subject uuid, p_org uuid, p_matter uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_grants g
    join public.persons grantee
      on grantee.id = g.grantee_person_id
     and grantee.organization_id = g.organization_id
    where g.organization_id = p_org
      and g.subject_person_id = p_subject
      and grantee.user_id = (select auth.uid())
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > statement_timestamp())
      and (p_matter is null or g.matter_id is null or g.matter_id = p_matter)
      and (
        g.kind = 'explicit'
        or (g.kind = 'guardian' and app.person_is_minor(g.subject_person_id))
      )
  );
$$;

create or replace function app.guard_guardian_grant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Revoking a grant must stay possible after the subject is no longer a minor.
  if new.kind = 'guardian' and new.revoked_at is null then
    if app.person_is_minor(new.subject_person_id) is distinct from true then
      raise exception 'guardian grants are only valid for a minor subject' using errcode = '42501';
    end if;
  end if;
  if new.expires_at is not null and new.revoked_at is null and new.expires_at <= statement_timestamp() then
    raise exception 'grant expiry must be in the future' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function app.derive_is_minor(date, public.date_precision, integer, date) from public;
revoke all on function app.person_is_minor(uuid) from public;
grant execute on function app.derive_is_minor(date, public.date_precision, integer, date) to authenticated, service_role;
grant execute on function app.person_is_minor(uuid) to authenticated, service_role;
