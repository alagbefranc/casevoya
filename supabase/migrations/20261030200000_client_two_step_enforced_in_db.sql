-- SEC-01 client two-step, enforced by the database. A portal person who has a verified second
-- factor reaches their own data only from a session that completed it. The rule mirrors the
-- portal redirect in src/lib/supabase/proxy.ts: a code is owed when the user has a verified
-- auth.mfa_factors row (Auth's nextLevel = aal2) and the session is neither aal2 nor accepted by
-- public.session_mfa_satisfied() (app.staff_mfa_satisfied: aal2, passkey sign-in or a recovery
-- code proof for this session).
--
-- app.session_assurance_ok() is added to the client / self branches of the central gates:
--   app.can_read_person, app.can_read_matter, app.grant_allows, app.can_read_task (so also
--   app.set_task_status, which checks it first), app.message_thread_person_for_me (so also
--   app.can_read_message_thread, mark/acknowledge and the thread check in send_matter_message),
--   public.confirm_reused_fact, and a check on client-authored rows in public.matter_messages
--   (covers the client branch of public.send_matter_message).
-- Staff branches are unchanged. Each function is copied from its latest definition (named above
-- it) with only the client condition changed; create or replace keeps grants.

create or replace function app.session_assurance_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is null
      or app.current_aal() = 'aal2'
      or not exists (
        select 1
        from auth.mfa_factors factor
        where factor.user_id = (select auth.uid())
          and factor.status::text = 'verified'
      )
      or app.staff_mfa_satisfied();
$$;
revoke all on function app.session_assurance_ok() from public, anon;
grant execute on function app.session_assurance_ok() to authenticated, service_role;


-- From 20261019219000_owner_full_access.sql.
create or replace function app.can_read_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.persons p
    where p.id = p_person_id
      and app.in_active_org(p.organization_id)
      and (
        exists (
          select 1
          from public.matter_participants mp
          where mp.person_id = p.id
            and mp.organization_id = p.organization_id
            and app.actor_staff_assigned_to_matter(mp.matter_id, p.organization_id)
        )
        or (
          p.created_by = (select auth.uid())
          and app.staff_mfa_satisfied()
          and app.has_org_role(
            p.organization_id,
            array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
        or (
          p.user_id = (select auth.uid())
          and (select app.session_assurance_ok())
        )
        or app.grant_allows(p.id, p.organization_id, null)
        or (
          app.staff_mfa_satisfied()
          and app.break_glass_person_open(p.id)
        )
      )
  );
$$;


-- From 20261017052636_persons_matters_grants.sql (its only definition).
create or replace function app.can_read_matter(p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matters matter
    where matter.id = p_matter_id
      and app.in_active_org(matter.organization_id)
      and (
        app.actor_is_firm_owner(matter.organization_id)
        or app.actor_staff_assigned_to_matter(matter.id, matter.organization_id)
        or (
          matter.created_by = (select auth.uid())
          and app.staff_mfa_satisfied()
          and app.has_org_role(
            matter.organization_id,
            array['licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
        or (
          exists (
            select 1
            from public.matter_participants mp
            join public.persons person
              on person.id = mp.person_id
             and person.organization_id = mp.organization_id
            where mp.matter_id = matter.id
              and mp.organization_id = matter.organization_id
              and person.user_id = (select auth.uid())
          )
          and (select app.session_assurance_ok())
        )
        or exists (
          select 1
          from public.matter_participants mp
          where mp.matter_id = matter.id
            and mp.organization_id = matter.organization_id
            and mp.person_id is not null
            and app.grant_allows(mp.person_id, matter.organization_id, matter.id)
        )
      )
  );
$$;


-- From 20261017140400_person_date_of_birth.sql. The grantee is a portal person.
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
  )
  and (select app.session_assurance_ok());
$$;


-- From 20261017170200_tasks_deadlines.sql (its only definition).
create or replace function app.can_read_task(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks task
    where task.id = p_id
      and app.in_active_org(task.organization_id)
      and (
        (
          task.audience = 'internal'
          and (select app.staff_mfa_satisfied())
          and (select app.is_org_staff(task.organization_id))
          and (
            task.matter_id is null
            or (select app.can_read_matter(task.matter_id))
          )
        )
        or (
          task.audience = 'client'
          and (
            (
              (select app.staff_mfa_satisfied())
              and (select app.can_read_matter(task.matter_id))
              and (select app.is_org_staff(task.organization_id))
            )
            or (
              exists (
                select 1
                from public.persons owner
                where owner.id = task.owner_person_id
                  and owner.user_id = (select auth.uid())
              )
              and (select app.session_assurance_ok())
            )
          )
        )
      )
  );
$$;


-- From 20261019203100_matter_messaging.sql (its only definition).
create or replace function app.message_thread_person_for_me(p_thread_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select person.id
  from public.message_threads thread
  join public.message_thread_people tp
    on tp.thread_id = thread.id
   and tp.organization_id = thread.organization_id
  join public.persons person
    on person.id = tp.person_id
   and person.organization_id = tp.organization_id
  where thread.id = p_thread_id
    and (select auth.uid()) is not null
    and person.user_id = (select auth.uid())
    and (select app.session_assurance_ok())
    and app.in_active_org(thread.organization_id)
    and exists (
      select 1 from public.matter_participants party
      where party.matter_id = thread.matter_id
        and party.organization_id = thread.organization_id
        and party.person_id = person.id
    )
  limit 1;
$$;


-- Client-authored messages need the client's two-step when it is on (the client branch of
-- public.send_matter_message and any other writer).
create or replace function app.require_client_message_assurance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.author_kind = 'client' and not app.session_assurance_ok() then
    raise exception 'two-step sign-in is required' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.require_client_message_assurance() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'matter_messages_client_assurance'
      and tgrelid = 'public.matter_messages'::regclass
  ) then
    create trigger matter_messages_client_assurance
      before insert on public.matter_messages
      for each row execute function app.require_client_message_assurance();
  end if;
end;
$$;


-- From 20261024180000_intake_fact_reuse.sql (its only definition).
create or replace function public.confirm_reused_fact(p_reuse_id uuid)
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
  ) or not app.session_assurance_ok() then
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
