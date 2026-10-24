-- INT-04 (#177): reuse approved facts in a later matter, only after the client reconfirms them.
--
-- New table:
--   public.intake_fact_reuses   one fact copied into a later form: the new answer version, the
--                               answer it came from (origin response and matter), and its state:
--                               needs_reconfirmation -> confirmed (the client) or replaced (a new
--                               answer for that question). Read with the form; written only here.
-- New functions:
--   public.reuse_approved_facts(uuid)   staff on the matter (owner, licensed consultant, case
--                               manager, aal2): for each question of a draft form that has no answer
--                               yet, copies the newest reviewed answer the same person gave on
--                               another form in the same firm (a matter the caller can read, same
--                               question key and type) as a new answer version, marked
--                               needs_reconfirmation. Declarations and file uploads are never
--                               copied. Audited; returns how many were copied.
--   public.confirm_reused_fact(uuid)    the person the form is for: confirms one copied answer that
--                               is still the latest for its question. Audited.
-- New triggers:
--   intake_answer_versions_zz_reuse_replaced   a newer answer for a question marks its pending
--                               reuse replaced (the client changed it instead of confirming).
--   intake_responses_reuse_guard               a form can't be sent while a copied answer waits for
--                               the client's confirmation.
-- Staff review after the client sends the form is unchanged (public.review_intake_answer).

create type public.intake_fact_reuse_status as enum ('needs_reconfirmation', 'confirmed', 'replaced');

create table public.intake_fact_reuses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  response_id uuid not null,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  answer_id uuid not null,
  origin_answer_id uuid not null,
  origin_response_id uuid not null,
  origin_matter_id uuid not null,
  status public.intake_fact_reuse_status not null default 'needs_reconfirmation',
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (answer_id),
  unique (id, organization_id),
  check ((status = 'confirmed') = (confirmed_at is not null)),
  check (response_id <> origin_response_id),
  foreign key (response_id, organization_id) references public.intake_responses (id, organization_id),
  foreign key (answer_id, organization_id) references public.intake_answer_versions (id, organization_id),
  foreign key (origin_answer_id, organization_id) references public.intake_answer_versions (id, organization_id),
  foreign key (origin_response_id, organization_id) references public.intake_responses (id, organization_id),
  foreign key (origin_matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.intake_fact_reuses is
  'An approved fact reused on a later form (INT-04): the new answer version, the answer it came from, and whether the client has reconfirmed it.';

create index intake_fact_reuses_org_fk_idx on public.intake_fact_reuses (organization_id);
create index intake_fact_reuses_response_idx on public.intake_fact_reuses (response_id, field_key);
create index intake_fact_reuses_answer_org_fk_idx on public.intake_fact_reuses (answer_id, organization_id);
create index intake_fact_reuses_origin_answer_org_fk_idx on public.intake_fact_reuses (origin_answer_id, organization_id);
create index intake_fact_reuses_origin_response_org_fk_idx on public.intake_fact_reuses (origin_response_id, organization_id);
create index intake_fact_reuses_origin_matter_org_fk_idx on public.intake_fact_reuses (origin_matter_id, organization_id);
create index intake_fact_reuses_confirmed_by_idx on public.intake_fact_reuses (confirmed_by);
create index intake_fact_reuses_created_by_idx on public.intake_fact_reuses (created_by);

alter table public.intake_fact_reuses enable row level security;
alter table public.intake_fact_reuses force row level security;
revoke all on table public.intake_fact_reuses from anon, authenticated;
grant select on table public.intake_fact_reuses to authenticated;
grant select, insert, update on table public.intake_fact_reuses to service_role;

-- Read with the form: its person and the staff on its matter (app.can_read_intake_response).
create policy intake_fact_reuses_select on public.intake_fact_reuses
  for select to authenticated
  using ((select app.can_read_intake_response(response_id)));

create function public.reuse_approved_facts(p_response_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  response public.intake_responses%rowtype;
  template public.intake_templates%rowtype;
  matter_sample boolean;
  field jsonb;
  qkey text;
  qtype text;
  origin record;
  new_answer uuid;
  copied integer := 0;
  keys text[] := array[]::text[];
begin
  select * into response from public.intake_responses where id = p_response_id for update;
  if response.id is null then
    raise exception 'intake reuse denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    response.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if app.can_read_matter(response.matter_id) is distinct from true
     or app.can_read_intake_response(response.id) is distinct from true then
    raise exception 'intake reuse denied' using errcode = '42501';
  end if;
  if response.status is distinct from 'draft' or response.frozen_at is not null then
    raise exception 'reuse earlier answers before the client sends this form' using errcode = '42501';
  end if;
  select matter.is_sample into matter_sample from public.matters matter where matter.id = response.matter_id;
  if app.sample_mode_blocks_real(response.organization_id, matter_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  select * into template from public.intake_templates where id = response.template_id;

  for field in select value from jsonb_array_elements(coalesce(template.schema -> 'fields', '[]'::jsonb)) loop
    qkey := field ->> 'key';
    qtype := field ->> 'type';
    -- A declaration is made fresh on each form; an upload belongs to its own matter.
    if qkey is null or qtype in ('declaration', 'file_request') then
      continue;
    end if;
    if exists (
      select 1 from public.intake_answer_versions answer
      where answer.response_id = response.id and answer.field_key = qkey
    ) then
      continue;
    end if;

    -- The newest reviewed answer this person gave to the same question (same key and type) on
    -- another form of this firm, where it is still that form's latest answer, on a matter the
    -- caller can read.
    select latest.*, other.matter_id as origin_matter
    into origin
    from public.intake_responses other
    join public.intake_templates other_template on other_template.id = other.template_id
    cross join lateral (
      select candidate.*
      from public.intake_answer_versions candidate
      where candidate.response_id = other.id and candidate.field_key = qkey
      order by candidate.created_at desc, candidate.id desc
      limit 1
    ) latest
    where other.organization_id = response.organization_id
      and other.person_id = response.person_id
      and other.id <> response.id
      and other.status = 'submitted'
      and latest.presence in ('provided', 'approximate')
      and exists (select 1 from public.intake_answer_reviews review where review.answer_id = latest.id)
      and exists (
        select 1 from jsonb_array_elements(coalesce(other_template.schema -> 'fields', '[]'::jsonb)) other_field
        where other_field ->> 'key' = qkey and other_field ->> 'type' = qtype
      )
      and app.can_read_matter(other.matter_id)
    order by latest.created_at desc, latest.id desc
    limit 1;
    if not found then
      continue;
    end if;
    -- A choice is copied only when this form still offers it.
    if qtype = 'choice' and not exists (
      select 1 from jsonb_array_elements_text(coalesce(field -> 'options', '[]'::jsonb)) option
      where option = origin.normalized_value ->> 'text'
    ) then
      continue;
    end if;

    insert into public.intake_answer_versions (
      organization_id, response_id, field_key, section_key, presence, raw_value, normalized_value,
      date_kind, calendar_date, year_value, month_value, approximate_note
    ) values (
      response.organization_id,
      response.id,
      qkey,
      case when field ? 'section_key' then (field ->> 'section_key')::public.person_section_key end,
      origin.presence,
      origin.raw_value,
      origin.normalized_value,
      origin.date_kind,
      origin.calendar_date,
      origin.year_value,
      origin.month_value,
      origin.approximate_note
    )
    returning id into new_answer;

    insert into public.intake_fact_reuses (
      organization_id, response_id, field_key, answer_id, origin_answer_id, origin_response_id, origin_matter_id, created_by
    ) values (
      response.organization_id, response.id, qkey, new_answer, origin.id, origin.response_id, origin.origin_matter, (select auth.uid())
    );
    copied := copied + 1;
    keys := keys || qkey;
  end loop;

  if copied > 0 then
    -- The form changed: an open portal page sees a newer version on its next save.
    update public.intake_responses set updated_at = statement_timestamp() where id = response.id;
    perform app.record_audit_event(
      response.organization_id,
      'intake.facts_reused',
      'public.intake_responses',
      response.id,
      'success',
      jsonb_build_object('matter_id', response.matter_id, 'count', copied, 'field_keys', to_jsonb(keys))
    );
  end if;
  return copied;
end;
$$;
revoke all on function public.reuse_approved_facts(uuid) from public;
grant execute on function public.reuse_approved_facts(uuid) to authenticated;

create function public.confirm_reused_fact(p_reuse_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reuse public.intake_fact_reuses%rowtype;
  response public.intake_responses%rowtype;
  latest uuid;
begin
  select * into reuse from public.intake_fact_reuses where id = p_reuse_id for update;
  if reuse.id is null then
    raise exception 'intake reuse denied' using errcode = '42501';
  end if;
  select * into response from public.intake_responses where id = reuse.response_id;
  -- Only the person the form is for confirms; staff can't confirm for them.
  if not exists (
    select 1 from public.persons subject
    where subject.id = response.person_id
      and subject.organization_id = response.organization_id
      and subject.user_id = (select auth.uid())
  ) then
    raise exception 'intake reuse denied' using errcode = '42501';
  end if;
  if response.status is distinct from 'draft' or response.frozen_at is not null then
    raise exception 'that form was already sent' using errcode = '42501';
  end if;
  if reuse.status = 'confirmed' then
    return;
  end if;
  select answer.id into latest
  from public.intake_answer_versions answer
  where answer.response_id = reuse.response_id and answer.field_key = reuse.field_key
  order by answer.created_at desc, answer.id desc
  limit 1;
  if reuse.status = 'replaced' or latest is distinct from reuse.answer_id then
    raise exception 'that answer was changed; check the new one instead' using errcode = 'PT409';
  end if;
  update public.intake_fact_reuses
  set status = 'confirmed', confirmed_at = statement_timestamp(), confirmed_by = (select auth.uid())
  where id = reuse.id;
  perform app.record_audit_event(
    response.organization_id,
    'intake.reused_fact_confirmed',
    'public.intake_fact_reuses',
    reuse.id,
    'success',
    jsonb_build_object('response_id', response.id, 'matter_id', response.matter_id, 'field_key', reuse.field_key, 'answer_id', reuse.answer_id, 'origin_answer_id', reuse.origin_answer_id)
  );
end;
$$;
revoke all on function public.confirm_reused_fact(uuid) from public;
grant execute on function public.confirm_reused_fact(uuid) to authenticated;

create function app.intake_fact_reuse_replaced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.intake_fact_reuses
  set status = 'replaced'
  where response_id = new.response_id
    and field_key = new.field_key
    and status = 'needs_reconfirmation'
    and answer_id <> new.id;
  return new;
end;
$$;
revoke all on function app.intake_fact_reuse_replaced() from public;

create trigger intake_answer_versions_zz_reuse_replaced after insert on public.intake_answer_versions
  for each row execute function app.intake_fact_reuse_replaced();

create function app.intake_reuse_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' and exists (
    select 1 from public.intake_fact_reuses reuse
    where reuse.response_id = new.id and reuse.status = 'needs_reconfirmation'
  ) then
    raise exception 'confirm the answers from your earlier matter first' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.intake_reuse_guard() from public;

create trigger intake_responses_reuse_guard before update on public.intake_responses
  for each row execute function app.intake_reuse_guard();
