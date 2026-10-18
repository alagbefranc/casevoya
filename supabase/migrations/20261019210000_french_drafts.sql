-- French (fr-CA) drafts, decided 2026-10-18 (docs/DECISIONS.md).
--
-- Additive only; no existing function is redefined.
--
-- 1. Email language. A person's language is already stored in
--    person_contact_preferences.locale ('en-CA' | 'fr-CA', default 'en-CA'), set at portal
--    acceptance and on the portal Account page ("English" / "Français"). No new column is
--    needed. public.email_delivery_locales gives the mail worker each queued delivery's
--    recipient locale; the worker still sends English unless that template's French is
--    approved in the repository (src/modules/email/designs/french.ts).
--
-- 2. "Draft in French" for the review reason a client sees ("Why changes are needed").
--    document_review_translations keeps the French a staff member saved with a review:
--    append-only, readable exactly where the review is, with whether it was machine-drafted
--    (and by which model) and who reviewed it (the staff member who saved it).
--    public.review_document_version_fr saves the review (through the unchanged
--    app.review_document_version, same staff, MFA, step-up and version checks) and its French
--    in one transaction, and records the audit event document.review_translated.
--
-- 3. Cost and abuse control for the Workers AI draft: public.consume_translation_draft lets an
--    active staff member with staff MFA request at most 20 drafts an hour and 100 a day per
--    firm. translation_draft_requests keeps only who, when and how many characters; never text.

-- ---------------------------------------------------------------------------
-- 1. Recipient locale for the mail worker
-- ---------------------------------------------------------------------------

create function public.email_delivery_locales(p_delivery_ids uuid[])
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
  -- active member of that firm.
  select coalesce(jsonb_object_agg(delivery.id::text, coalesce(person_locale.locale, staff_locale.locale, 'en-CA')), '{}'::jsonb)
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
  where delivery.id = any(p_delivery_ids);
  return result;
end;
$$;
revoke all on function public.email_delivery_locales(uuid[]) from public, anon, authenticated;
grant execute on function public.email_delivery_locales(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 2. French review reasons
-- ---------------------------------------------------------------------------

create table public.document_review_translations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  review_id uuid not null references public.document_reviews (id),
  version_id uuid not null,
  language text not null check (language = 'fr-CA'),
  reason text not null check (length(btrim(reason)) between 3 and 2000),
  machine_drafted boolean not null,
  model text check (model is null or model ~ '^@cf/[a-z0-9._/-]{3,120}$'),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  check (machine_drafted = (model is not null)),
  unique (review_id, language),
  foreign key (version_id, organization_id) references public.document_versions (id, organization_id)
);
comment on table public.document_review_translations is
  'A French version of a review reason, saved by the staff member who reviewed it (created_by). machine_drafted: it started as a Workers AI draft (model) that this person checked and edited before saving. Append-only.';
comment on column public.document_review_translations.created_by is
  'The staff member who reviewed the French and saved it; for a machine draft, the named human reviewer.';

create index document_review_translations_org_fk_idx on public.document_review_translations (organization_id);
create index document_review_translations_review_fk_idx on public.document_review_translations (review_id);
create index document_review_translations_version_org_fk_idx on public.document_review_translations (version_id, organization_id);
create index document_review_translations_created_by_idx on public.document_review_translations (created_by);

create trigger document_review_translations_no_update
  before update or delete on public.document_review_translations
  for each row execute function app.reject_document_delete();

revoke all on table public.document_review_translations from anon, authenticated;
grant select on table public.document_review_translations to authenticated;
grant select, insert on table public.document_review_translations to service_role;
alter table public.document_review_translations enable row level security;
alter table public.document_review_translations force row level security;

-- Readable exactly where the review is (document_reviews_select).
create policy document_review_translations_select on public.document_review_translations
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.can_read_document_version(version_id))
  );

create function public.review_document_version_fr(
  p_version_id uuid,
  p_expected_version integer,
  p_decision public.document_review_decision,
  p_reason text,
  p_annotations text,
  p_reason_fr text,
  p_machine_drafted boolean,
  p_model text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  new_version integer;
  review public.document_reviews%rowtype;
begin
  if p_reason_fr is null or length(btrim(p_reason_fr)) not between 3 and 2000 then
    raise exception 'a French reason is required' using errcode = '22023';
  end if;
  if p_machine_drafted is null or (p_machine_drafted and (p_model is null or p_model !~ '^@cf/[a-z0-9._/-]{3,120}$')) then
    raise exception 'say whether the French was machine-drafted, and by which model' using errcode = '22023';
  end if;
  -- Same checks as an English-only review (staff role, staff MFA, step-up, version, clean file).
  new_version := app.review_document_version(p_version_id, p_expected_version, p_decision, p_reason, p_annotations);

  select * into review
  from public.document_reviews r
  where r.version_id = p_version_id
    and r.created_by = actor
    and r.created_at = now()
  order by r.id
  limit 1;
  if review.id is null then
    raise exception 'the review was not recorded' using errcode = '40001';
  end if;

  insert into public.document_review_translations (
    organization_id, review_id, version_id, language, reason, machine_drafted, model, created_by
  ) values (
    review.organization_id, review.id, review.version_id, 'fr-CA', btrim(p_reason_fr),
    p_machine_drafted, case when p_machine_drafted then p_model end, actor
  );

  perform app.record_audit_event(
    review.organization_id, 'document.review_translated', 'document_reviews', review.id, 'success',
    jsonb_build_object(
      'languages', jsonb_build_array('en-CA', 'fr-CA'),
      'machine_drafted', p_machine_drafted,
      'model', case when p_machine_drafted then p_model end,
      'reviewed_by', actor
    )
  );
  return new_version;
end;
$$;
revoke all on function public.review_document_version_fr(uuid, integer, public.document_review_decision, text, text, text, boolean, text) from public, anon;
grant execute on function public.review_document_version_fr(uuid, integer, public.document_review_decision, text, text, text, boolean, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Draft quota (Workers AI cost and abuse control)
-- ---------------------------------------------------------------------------

create table public.translation_draft_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references auth.users (id),
  char_count integer not null check (char_count between 1 and 4000),
  created_at timestamptz not null default now()
);
comment on table public.translation_draft_requests is
  'One "Draft in French" request: who, which firm, when, how long the text was. Never the text. Rate limit and cost audit.';
create index translation_draft_requests_user_idx on public.translation_draft_requests (user_id, organization_id, created_at);
create index translation_draft_requests_org_fk_idx on public.translation_draft_requests (organization_id);

revoke all on table public.translation_draft_requests from anon, authenticated;
grant select, insert on table public.translation_draft_requests to service_role;
alter table public.translation_draft_requests enable row level security;
alter table public.translation_draft_requests force row level security;

create function public.consume_translation_draft(p_organization_id uuid, p_char_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  last_hour integer;
  last_day integer;
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if p_char_count is null or p_char_count not between 1 and 4000 then
    raise exception 'text must be 1 to 4000 characters' using errcode = '22023';
  end if;
  -- One staff member's requests are serialized so two tabs cannot both pass the count.
  perform pg_advisory_xact_lock(hashtextextended('translation_draft:' || actor::text || ':' || p_organization_id::text, 0));
  select count(*) filter (where created_at > statement_timestamp() - interval '1 hour'),
         count(*)
  into last_hour, last_day
  from public.translation_draft_requests
  where user_id = actor
    and organization_id = p_organization_id
    and created_at > statement_timestamp() - interval '1 day';
  if last_hour >= 20 or last_day >= 100 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into public.translation_draft_requests (organization_id, user_id, char_count)
  values (p_organization_id, actor, p_char_count);
  perform app.record_audit_event(
    p_organization_id, 'i18n.draft_requested', 'translation_draft_requests', null, 'success',
    jsonb_build_object('chars', p_char_count)
  );
  return jsonb_build_object('ok', true, 'remaining_hour', 19 - last_hour, 'remaining_day', 99 - last_day);
end;
$$;
revoke all on function public.consume_translation_draft(uuid, integer) from public, anon;
grant execute on function public.consume_translation_draft(uuid, integer) to authenticated, service_role;
