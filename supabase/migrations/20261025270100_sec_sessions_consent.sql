-- SEC-01 and SEC-05 (gap #184). Additive only.
--
-- SEC-01 Idle timeout (staff)
--   organizations.staff_idle_timeout_minutes   the firm's idle sign-out time for staff, 5 to 480
--                                              minutes, 30 by default. Changed only through
--                                              public.set_staff_idle_timeout (firm owner, fresh
--                                              step-up), audited security.idle_timeout_changed.
--   staff_session_activity                     the last time a person was active in one sign-in
--                                              session (per Auth session id). Not a tenant table:
--                                              a session belongs to a user, like
--                                              session_revocations. No grants, read and written
--                                              only by the function below.
--   public.record_staff_activity(p_active)     called by the app when a staff member is active
--                                              (input in the Sheet, at most once a minute) and by the
--                                              proxy on every full page load of the staff area. The
--                                              timeout is the strictest of the user's active staff
--                                              firms. When the last recorded activity is older than
--                                              the timeout, the session is ended here, on the server:
--                                              a session_revocations row (reason 'idle', so
--                                              app.session_is_revoked refuses the token for every
--                                              tenant read and write), the Auth session row removed
--                                              (its refresh token stops working), audited
--                                              session.idle_signed_out. A browser that skips the
--                                              warning timer is still signed out at its next request
--                                              that reaches this check.
--
-- SEC-01 Client two-step (portal)
--   public.record_my_two_step(p_enabled)       a client's own two-step change, after Supabase Auth
--                                              enrolled and verified (or removed) the factor: checked
--                                              against auth.mfa_factors, audited mfa.client_enabled /
--                                              mfa.client_disabled.
--   app.client_step_up_satisfied()             a high-risk portal action needs the client's two-step
--                                              set up and checked in the last 15 minutes.
--   public.my_two_step_state()                 'off' | 'needs_check' | 'ok' for the portal.
--   client_mfa_resets                          a staff-assisted reset of a client's two-step, with how
--                                              the client's identity was verified (never email alone).
--   public.reset_client_two_step(...)          firm owner, licensed consultant or case manager who can
--                                              read the person, with a fresh step-up. Refuses a staff
--                                              user (their two-step is reset from Team and seats) and
--                                              the caller themselves. Ends the client's sessions and
--                                              removes their factors. Audited mfa.client_reset.
--
-- SEC-05 Consent withdrawal impact review
--   consent_impact_reviews                     one review per withdrawn consent: the person, the
--                                              consent record, the features it affects, the internal
--                                              task, and who marked it done with which note.
--   app.consent_impact_items(purpose)          the affected features for each purpose (plain words).
--   app.open_consent_impact_review()           AFTER INSERT / UPDATE trigger on consent_records: a
--                                              purpose that was granted and is now refused (a new
--                                              granted = false record, from the portal, the contact
--                                              choices or any other path) or withdrawn (withdrawn_at
--                                              set, e.g. a privacy request) opens a review and a high-
--                                              priority internal task with the impacts as its
--                                              checklist, owned by the responsible consultant of the
--                                              person's latest open matter (else the firm owner).
--                                              Nothing is deleted or changed in the person's records.
--   public.set_my_consent(purpose, granted)    the client's own choice for AI drafting, marketing and
--                                              core processing on /portal/account, saved at once as a
--                                              new consent record (append-only). Audited.
--   public.my_consents()                       the client's current choice per purpose.
--   public.person_consent_overview(org, person)  staff: consent history, reviews and two-step state
--                                              for one person.
--   public.complete_consent_review(id, note)   marks a review done with a note and completes its task.
--   app.person_declines_ai(org, person)        the person's latest AI drafting record is a refusal or
--                                              withdrawn.
--
-- Redefined
--   public.begin_vo_document_review  (latest in 20261019218100_vo_doc_review.sql): returns
--                                    {ok:false, error:'client_ai_off'} when the document's person
--                                    declines AI drafting. Otherwise unchanged.

-- ---------------------------------------------------------------------------
-- SEC-01: idle timeout
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column staff_idle_timeout_minutes integer not null default 30;
alter table public.organizations
  add constraint organizations_staff_idle_timeout_ck check (staff_idle_timeout_minutes between 5 and 480);
comment on column public.organizations.staff_idle_timeout_minutes is
  'SEC-01: minutes a staff member can be idle before Casevoya signs them out (5 to 480, default 30). Set by public.set_staff_idle_timeout.';

create table public.staff_session_activity (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id),
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
comment on table public.staff_session_activity is
  'SEC-01: the last activity in one staff sign-in session (Auth session id). Read and written only by public.record_staff_activity.';

create index staff_session_activity_user_idx on public.staff_session_activity (user_id);

revoke all on table public.staff_session_activity from anon, authenticated, service_role;
alter table public.staff_session_activity enable row level security;
alter table public.staff_session_activity force row level security;

create function public.record_staff_activity(p_active boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  sid uuid := app.current_session_id();
  timeout_minutes integer;
  strict_firm uuid;
  seen timestamptz;
  idle_for interval;
begin
  if uid is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if app.session_is_revoked() then
    return jsonb_build_object('state', 'ended');
  end if;
  -- The strictest idle time of the firms where this person is active staff.
  select org.staff_idle_timeout_minutes, org.id
  into timeout_minutes, strict_firm
  from public.memberships mem
  join public.organizations org on org.id = mem.organization_id
  where mem.user_id = uid
    and mem.status = 'active'
    and mem.role = any (app.staff_roles())
  order by org.staff_idle_timeout_minutes asc, org.id asc
  limit 1;
  if timeout_minutes is null or sid is null then
    return jsonb_build_object('state', 'none');
  end if;

  select act.last_active_at into seen
  from public.staff_session_activity act
  where act.session_id = sid
    and act.user_id = uid
  for update;

  if seen is not null then
    idle_for := clock_timestamp() - seen;
    if idle_for > make_interval(mins => timeout_minutes) then
      insert into public.session_revocations (user_id, session_id, revoked_by, organization_id, reason)
      values (uid, sid, uid, strict_firm, 'idle')
      on conflict (user_id, session_id) do nothing;
      if to_regclass('auth.sessions') is not null then
        execute 'delete from auth.sessions where id = $1 and user_id = $2' using sid, uid;
      end if;
      perform app.record_audit_event(
        strict_firm, 'session.idle_signed_out', 'auth.sessions', sid, 'success',
        jsonb_build_object('timeout_minutes', timeout_minutes, 'idle_minutes', floor(extract(epoch from idle_for) / 60)::integer)
      );
      return jsonb_build_object('state', 'expired', 'timeout_minutes', timeout_minutes);
    end if;
  end if;

  if p_active is true or seen is null then
    insert into public.staff_session_activity (session_id, user_id, last_active_at)
    values (sid, uid, clock_timestamp())
    on conflict (session_id) do update
      set last_active_at = excluded.last_active_at
      where public.staff_session_activity.user_id = excluded.user_id;
    seen := clock_timestamp();
  end if;
  return jsonb_build_object(
    'state', 'active',
    'timeout_minutes', timeout_minutes,
    'idle_seconds', greatest(0, floor(extract(epoch from clock_timestamp() - seen)))::integer
  );
end;
$$;
revoke all on function public.record_staff_activity(boolean) from public, anon;
grant execute on function public.record_staff_activity(boolean) to authenticated;

create function public.set_staff_idle_timeout(p_organization_id uuid, p_minutes integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_minutes integer;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  if p_minutes is null or p_minutes < 5 or p_minutes > 480 then
    raise exception 'idle sign-out must be 5 to 480 minutes' using errcode = '22023';
  end if;
  select org.staff_idle_timeout_minutes into before_minutes
  from public.organizations org
  where org.id = p_organization_id
  for update;
  if before_minutes is null then
    raise exception 'firm owner step-up is required' using errcode = '42501';
  end if;
  if before_minutes = p_minutes then
    return p_minutes;
  end if;
  update public.organizations set staff_idle_timeout_minutes = p_minutes where id = p_organization_id;
  perform app.record_audit_event(
    p_organization_id, 'security.idle_timeout_changed', 'public.organizations', p_organization_id, 'success',
    jsonb_build_object('from_minutes', before_minutes, 'to_minutes', p_minutes)
  );
  return p_minutes;
end;
$$;
revoke all on function public.set_staff_idle_timeout(uuid, integer) from public, anon;
grant execute on function public.set_staff_idle_timeout(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- SEC-01: client two-step
-- ---------------------------------------------------------------------------

-- Whether a user has a verified authenticator (TOTP) factor. False where Auth has no factor table.
create function app.user_has_verified_totp(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found boolean := false;
begin
  if p_user_id is null or to_regclass('auth.mfa_factors') is null then
    return false;
  end if;
  execute 'select exists (select 1 from auth.mfa_factors f where f.user_id = $1 and f.factor_type::text = ''totp'' and f.status::text = ''verified'')'
    into found
    using p_user_id;
  return coalesce(found, false);
end;
$$;
revoke all on function app.user_has_verified_totp(uuid) from public;

-- A high-risk portal action (changing the sign-in email, downloading a full export): the client
-- has two-step set up and checked it in the last 15 minutes.
create function app.client_step_up_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and app.user_has_verified_totp((select auth.uid()))
     and app.mfa_step_up_satisfied();
$$;
revoke all on function app.client_step_up_satisfied() from public;
grant execute on function app.client_step_up_satisfied() to authenticated;

create function public.my_two_step_state()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if not app.user_has_verified_totp(uid) then
    return 'off';
  end if;
  if app.mfa_step_up_satisfied() then
    return 'ok';
  end if;
  return 'needs_check';
end;
$$;
revoke all on function public.my_two_step_state() from public, anon;
grant execute on function public.my_two_step_state() to authenticated;

-- The person record of the signed-in client in the current firm.
create function app.my_person_id(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select person.id
  from public.persons person
  where p_org is not null
    and person.organization_id = p_org
    and person.user_id = (select auth.uid())
  limit 1;
$$;
revoke all on function app.my_person_id(uuid) from public;

create function public.record_my_two_step(p_enabled boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  org uuid := app.current_organization_id();
  v_person_id uuid;
begin
  if uid is null or org is null or p_enabled is null then
    raise exception 'two-step change denied' using errcode = '42501';
  end if;
  v_person_id := app.my_person_id(org);
  if v_person_id is null then
    raise exception 'two-step change denied' using errcode = '42501';
  end if;
  -- The record follows what Supabase Auth holds, never the other way round.
  if app.user_has_verified_totp(uid) is distinct from p_enabled then
    raise exception 'two-step state does not match' using errcode = '22023';
  end if;
  perform app.record_portal_audit(
    org, case when p_enabled then 'mfa.client_enabled' else 'mfa.client_disabled' end,
    'public.persons', v_person_id, 'success', '{}'::jsonb
  );
  return case when p_enabled then 'on' else 'off' end;
end;
$$;
revoke all on function public.record_my_two_step(boolean) from public, anon;
grant execute on function public.record_my_two_step(boolean) to authenticated;

create table public.client_mfa_resets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  person_id uuid not null,
  user_id uuid not null references auth.users (id),
  identity_method text not null check (length(btrim(identity_method)) between 3 and 500),
  note text check (note is null or length(btrim(note)) between 3 and 2000),
  reset_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.client_mfa_resets is
  'SEC-01: a staff-assisted reset of a client''s two-step, with how the client''s identity was verified. Never changed or removed.';

create index client_mfa_resets_org_idx on public.client_mfa_resets (organization_id, created_at desc);
create index client_mfa_resets_person_fk_idx on public.client_mfa_resets (person_id, organization_id);
create index client_mfa_resets_user_fk_idx on public.client_mfa_resets (user_id);
create index client_mfa_resets_reset_by_fk_idx on public.client_mfa_resets (reset_by);

revoke all on table public.client_mfa_resets from anon, authenticated, service_role;
grant select on table public.client_mfa_resets to authenticated;
alter table public.client_mfa_resets enable row level security;
alter table public.client_mfa_resets force row level security;

-- Staff who may see and act on a person's consent and sign-in help: the firm owner, or a licensed
-- consultant or case manager who can read the person, with staff two-step.
create function app.can_work_person_privacy(p_org uuid, p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_org is not null
     and p_person_id is not null
     and app.in_active_org(p_org)
     and app.staff_mfa_satisfied()
     and (
       app.actor_is_firm_owner(p_org)
       or (
         app.has_org_role(p_org, array['licensed_consultant', 'case_manager']::public.org_role[])
         and app.can_read_person(p_person_id)
       )
     );
$$;
revoke all on function app.can_work_person_privacy(uuid, uuid) from public, anon;
grant execute on function app.can_work_person_privacy(uuid, uuid) to authenticated;

create policy client_mfa_resets_select on public.client_mfa_resets
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and app.can_work_person_privacy(organization_id, person_id)
  );

create function public.reset_client_two_step(
  p_organization_id uuid,
  p_person_id uuid,
  p_identity_method text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target uuid;
  rid uuid;
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if app.can_work_person_privacy(p_organization_id, p_person_id) is distinct from true then
    raise exception 'client two-step reset denied' using errcode = '42501';
  end if;
  if p_identity_method is null or length(btrim(p_identity_method)) < 3 or length(btrim(p_identity_method)) > 500 then
    raise exception 'say how you verified who the client is' using errcode = '22023';
  end if;
  if p_note is not null and btrim(p_note) <> '' and (length(btrim(p_note)) < 3 or length(btrim(p_note)) > 2000) then
    raise exception 'a note is 3 to 2000 characters' using errcode = '22023';
  end if;
  select person.user_id into target
  from public.persons person
  where person.id = p_person_id
    and person.organization_id = p_organization_id;
  if target is null then
    raise exception 'this person has no portal sign-in' using errcode = '22023';
  end if;
  if target = actor then
    raise exception 'use your own authenticator or a recovery code' using errcode = '42501';
  end if;
  -- Staff two-step is reset by a firm owner from Team and seats, never from a client record.
  if exists (
    select 1 from public.memberships mem
    where mem.user_id = target
      and mem.status in ('invited', 'active', 'suspended')
      and mem.role = any (app.staff_roles())
  ) then
    raise exception 'a staff sign-in is reset from Team and seats' using errcode = '42501';
  end if;

  insert into public.client_mfa_resets (organization_id, person_id, user_id, identity_method, note, reset_by)
  values (p_organization_id, p_person_id, target, btrim(p_identity_method), nullif(btrim(coalesce(p_note, '')), ''), actor)
  returning id into rid;

  perform app.revoke_member_sessions(p_organization_id, target, 'client_mfa_reset');
  perform app.purge_auth_user_factors(target);

  perform app.record_audit_event(
    p_organization_id, 'mfa.client_reset', 'public.client_mfa_resets', rid, 'success',
    jsonb_build_object('person_id', p_person_id, 'method_length', length(btrim(p_identity_method)))
  );
  return rid;
end;
$$;
revoke all on function public.reset_client_two_step(uuid, uuid, text, text) from public, anon;
grant execute on function public.reset_client_two_step(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- SEC-05: consent withdrawal impact review
-- ---------------------------------------------------------------------------

create table public.consent_impact_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  person_id uuid not null,
  consent_record_id uuid not null,
  consent_purpose public.consent_purpose not null,
  source text not null check (source in ('portal', 'staff')),
  impacts jsonb not null check (jsonb_typeof(impacts) = 'array'),
  matter_id uuid,
  task_id uuid,
  status text not null default 'open' check (status in ('open', 'done')),
  done_at timestamptz,
  done_by uuid references auth.users (id),
  done_note text check (done_note is null or length(btrim(done_note)) between 3 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (consent_record_id, organization_id) references public.consent_records (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id),
  check ((status = 'done') = (done_at is not null)),
  check ((done_at is null) = (done_by is null)),
  check (status <> 'done' or done_note is not null)
);
comment on table public.consent_impact_reviews is
  'SEC-05: one impact review per withdrawn or refused consent. Lists the affected features; a person marks it done with a note. Withdrawal never deletes records kept for retention or under a legal hold.';

create index consent_impact_reviews_org_status_idx on public.consent_impact_reviews (organization_id, status, created_at desc);
create index consent_impact_reviews_person_fk_idx on public.consent_impact_reviews (person_id, organization_id);
create index consent_impact_reviews_consent_fk_idx on public.consent_impact_reviews (consent_record_id, organization_id);
create index consent_impact_reviews_matter_fk_idx on public.consent_impact_reviews (matter_id, organization_id);
create index consent_impact_reviews_task_fk_idx on public.consent_impact_reviews (task_id, organization_id);
create index consent_impact_reviews_done_by_fk_idx on public.consent_impact_reviews (done_by);
create index consent_impact_reviews_created_by_fk_idx on public.consent_impact_reviews (created_by);

revoke all on table public.consent_impact_reviews from anon, authenticated, service_role;
grant select on table public.consent_impact_reviews to authenticated;
alter table public.consent_impact_reviews enable row level security;
alter table public.consent_impact_reviews force row level security;

create policy consent_impact_reviews_select on public.consent_impact_reviews
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and app.can_work_person_privacy(organization_id, person_id)
  );

create trigger consent_impact_reviews_audit after insert or update or delete on public.consent_impact_reviews
  for each row execute function app.audit_row_change('done_note');

-- What stops or needs a person's attention when a consent is withdrawn. Plain words, as listed on
-- the review and as the task's checklist. Nothing here is done automatically except what the
-- product already does from the consent itself (Vo skips the person's documents; texts and emails
-- follow the saved contact choices).
create function app.consent_impact_items(p_purpose public.consent_purpose)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_purpose::text
    when 'ai_drafting' then jsonb_build_array(
      'Vo no longer reads this client’s documents (Casevoya skips them)',
      'Don’t use Vo drafts or readings based on this client’s records',
      'Nothing already in the file is deleted'
    )
    when 'contact_sms' then jsonb_build_array(
      'Text message reminders to this client have stopped',
      'Reach the client another way for anything urgent'
    )
    when 'contact_email' then jsonb_build_array(
      'Routine email notices to this client have stopped',
      'Requests, deadlines and invoices still show in their portal'
    )
    when 'deadline_reminder' then jsonb_build_array(
      'Deadline reminders to this client have stopped',
      'Watch this client’s deadlines yourself'
    )
    when 'marketing' then jsonb_build_array(
      'Casevoya sends no marketing for the firm',
      'Remove the client from any newsletter or offer list the firm keeps elsewhere'
    )
    when 'processing' then jsonb_build_array(
      'Decide with the client whether the firm can keep working on their matters',
      'Records stay for the firm’s retention period and under any legal hold; nothing is deleted',
      'Tell the client what happens next'
    )
    when 'electronic_signature' then jsonb_build_array(
      'Offer paper or in-person signing for new agreements'
    )
    when 'share_section' then jsonb_build_array(
      'Check that the shared section is no longer shown to the other person'
    )
    else jsonb_build_array(
      'Review what this consent covered for this client'
    )
  end;
$$;
revoke all on function app.consent_impact_items(public.consent_purpose) from public;

create function app.consent_purpose_label(p_purpose public.consent_purpose)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_purpose::text
    when 'ai_drafting' then 'AI drafting'
    when 'contact_sms' then 'text messages'
    when 'contact_email' then 'email notices'
    when 'deadline_reminder' then 'deadline reminders'
    when 'marketing' then 'news and offers'
    when 'processing' then 'core processing'
    when 'electronic_signature' then 'electronic signature'
    when 'share_section' then 'a shared section'
    when 'portal_terms' then 'portal terms'
    when 'privacy_notice' then 'privacy notice'
    else replace(p_purpose::text, '_', ' ')
  end;
$$;
revoke all on function app.consent_purpose_label(public.consent_purpose) from public;

-- Opens the review and its internal task. Internal: called by the consent_records trigger only.
create function app.create_consent_impact_review(p_consent_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  consent public.consent_records%rowtype;
  v_matter public.matters%rowtype;
  owner_membership uuid;
  impact jsonb;
  new_task uuid;
  rid uuid;
  v_source text;
begin
  select * into consent from public.consent_records where id = p_consent_id;
  if consent.id is null then
    return null;
  end if;
  impact := app.consent_impact_items(consent.purpose);
  v_source := case
    when exists (
      select 1 from public.persons person
      where person.id = consent.person_id
        and person.organization_id = consent.organization_id
        and person.user_id is not null
        and person.user_id = (select auth.uid())
    ) then 'portal'
    else 'staff'
  end;

  -- The person's latest open matter, for the task and its owner.
  select m.* into v_matter
  from public.matter_participants part
  join public.matters m on m.id = part.matter_id and m.organization_id = part.organization_id
  where part.organization_id = consent.organization_id
    and part.person_id = consent.person_id
    and m.stage <> 'closed'
  order by m.updated_at desc, m.id
  limit 1;
  owner_membership := v_matter.responsible_consultant_membership_id;
  if v_matter.id is not null and owner_membership is null then
    select mem.id into owner_membership
    from public.memberships mem
    where mem.organization_id = consent.organization_id
      and mem.role = 'firm_owner'
      and mem.status = 'active'
    order by mem.created_at, mem.id
    limit 1;
  end if;

  if v_matter.id is not null and owner_membership is not null then
    insert into public.tasks (
      organization_id, matter_id, person_id, audience, title, priority, owner_membership_id, due_timezone, checklist
    ) values (
      consent.organization_id,
      v_matter.id,
      consent.person_id,
      'internal',
      left('Consent withdrawn (' || app.consent_purpose_label(consent.purpose) || '): review the impact', 200),
      'high',
      owner_membership,
      coalesce((select org.timezone from public.organizations org where org.id = consent.organization_id), 'America/Toronto'),
      coalesce((select jsonb_agg(jsonb_build_object('text', item, 'done', false)) from jsonb_array_elements_text(impact) item), '[]'::jsonb)
    )
    returning id into new_task;
    insert into public.task_events (organization_id, task_id, event_kind, to_status, actor_user_id)
    values (consent.organization_id, new_task, 'created', 'open', (select auth.uid()));
  end if;

  insert into public.consent_impact_reviews (
    organization_id, person_id, consent_record_id, consent_purpose, source, impacts, matter_id, task_id, created_by
  ) values (
    consent.organization_id, consent.person_id, consent.id, consent.purpose, v_source, impact, v_matter.id, new_task, (select auth.uid())
  )
  returning id into rid;

  perform app.record_portal_audit(
    consent.organization_id, 'consent.impact_review_opened', 'public.consent_impact_reviews', rid, 'success',
    jsonb_build_object('purpose', consent.purpose, 'source', v_source, 'task_id', new_task)
  );
  return rid;
end;
$$;
revoke all on function app.create_consent_impact_review(uuid) from public;

create function app.open_consent_impact_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior public.consent_records%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.granted then
      return null;
    end if;
    select c.* into prior
    from public.consent_records c
    where c.organization_id = new.organization_id
      and c.person_id = new.person_id
      and c.purpose = new.purpose
      and c.scope is not distinct from new.scope
      and c.id <> new.id
    order by c.created_at desc, c.id desc
    limit 1;
    if prior.id is null or prior.granted is not true or prior.withdrawn_at is not null then
      return null;
    end if;
    perform app.create_consent_impact_review(new.id);
  elsif tg_op = 'UPDATE' then
    if old.withdrawn_at is null and new.withdrawn_at is not null and new.granted then
      perform app.create_consent_impact_review(new.id);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function app.open_consent_impact_review() from public;

create trigger consent_records_impact_review
  after insert or update of withdrawn_at on public.consent_records
  for each row execute function app.open_consent_impact_review();

-- The person's latest choice for a purpose: true given, false refused or withdrawn, null never asked.
create function app.person_consent_state(p_org uuid, p_person_id uuid, p_purpose public.consent_purpose)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select c.granted and c.withdrawn_at is null
  from public.consent_records c
  where c.organization_id = p_org
    and c.person_id = p_person_id
    and c.purpose = p_purpose
  order by c.created_at desc, c.id desc
  limit 1;
$$;
revoke all on function app.person_consent_state(uuid, uuid, public.consent_purpose) from public;

create function app.person_declines_ai(p_org uuid, p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.person_consent_state(p_org, p_person_id, 'ai_drafting') is false;
$$;
revoke all on function app.person_declines_ai(uuid, uuid) from public;
grant execute on function app.person_declines_ai(uuid, uuid) to authenticated, service_role;

create function public.my_consents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  v_person_id uuid;
begin
  if (select auth.uid()) is null or org is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_person_id := app.my_person_id(org);
  if v_person_id is null then
    raise exception 'consent denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'ai_drafting', app.person_consent_state(org, v_person_id, 'ai_drafting'),
    'marketing', app.person_consent_state(org, v_person_id, 'marketing'),
    'processing', app.person_consent_state(org, v_person_id, 'processing'),
    'marketing_since', (
      select c.created_at from public.consent_records c
      where c.organization_id = org and c.person_id = v_person_id and c.purpose = 'marketing'
      order by c.created_at desc, c.id desc limit 1
    )
  );
end;
$$;
revoke all on function public.my_consents() from public, anon;
grant execute on function public.my_consents() to authenticated;

create function public.set_my_consent(p_purpose text, p_granted boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  v_person_id uuid;
  v_purpose public.consent_purpose;
  current_state boolean;
  v_statement text;
  rid uuid;
  review uuid;
begin
  if (select auth.uid()) is null or org is null or p_granted is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_person_id := app.my_person_id(org);
  if v_person_id is null then
    raise exception 'consent denied' using errcode = '42501';
  end if;
  if p_purpose not in ('ai_drafting', 'marketing', 'processing') then
    raise exception 'that consent is not changed here' using errcode = '22023';
  end if;
  v_purpose := p_purpose::public.consent_purpose;
  current_state := app.person_consent_state(org, v_person_id, v_purpose);
  if current_state is not distinct from p_granted then
    return jsonb_build_object('granted', p_granted, 'changed', false, 'review_id', null);
  end if;
  -- The same statements the portal invitation shows, so the record says what was answered.
  v_statement := case p_purpose
    when 'ai_drafting' then 'The firm may use drafting help that a person at the firm reviews before it is used.'
    when 'processing' then 'I agree that the firm can use my information to prepare this application.'
    else 'Send me news and offers from the firm.'
  end;
  insert into public.consent_records (organization_id, person_id, purpose, statement_text, statement_sha256, granted, created_by)
  values (org, v_person_id, v_purpose, v_statement, app.portal_statement_hash(v_statement), p_granted, (select auth.uid()))
  returning id into rid;
  select r.id into review from public.consent_impact_reviews r where r.consent_record_id = rid and r.organization_id = org;
  perform app.record_portal_audit(
    org, case when p_granted then 'consent.given' else 'consent.withdrawn' end,
    'public.consent_records', rid, 'success',
    jsonb_build_object('purpose', p_purpose, 'review_id', review)
  );
  return jsonb_build_object('granted', p_granted, 'changed', true, 'review_id', review);
end;
$$;
revoke all on function public.set_my_consent(text, boolean) from public, anon;
grant execute on function public.set_my_consent(text, boolean) to authenticated;

create function public.person_consent_overview(p_organization_id uuid, p_person_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if app.can_work_person_privacy(p_organization_id, p_person_id) is distinct from true then
    raise exception 'consent review denied' using errcode = '42501';
  end if;
  select person.user_id into target
  from public.persons person
  where person.id = p_person_id and person.organization_id = p_organization_id;
  return jsonb_build_object(
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'purpose', c.purpose, 'granted', c.granted, 'withdrawn_at', c.withdrawn_at,
        'created_at', c.created_at, 'scope', c.scope
      ) order by c.created_at desc, c.id desc)
      from (
        select * from public.consent_records rec
        where rec.organization_id = p_organization_id and rec.person_id = p_person_id
        order by rec.created_at desc, rec.id desc
        limit 200
      ) c
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'purpose', r.consent_purpose, 'source', r.source, 'impacts', r.impacts,
        'status', r.status, 'created_at', r.created_at, 'done_at', r.done_at, 'done_note', r.done_note,
        'done_by', r.done_by, 'matter_id', r.matter_id, 'task_id', r.task_id, 'version', r.version
      ) order by r.created_at desc, r.id desc)
      from public.consent_impact_reviews r
      where r.organization_id = p_organization_id and r.person_id = p_person_id
    ), '[]'::jsonb),
    'portal', target is not null,
    'two_step', case when target is null then null else app.user_has_verified_totp(target) end,
    'resets', coalesce((
      select jsonb_agg(jsonb_build_object('created_at', x.created_at, 'identity_method', x.identity_method, 'reset_by', x.reset_by) order by x.created_at desc)
      from public.client_mfa_resets x
      where x.organization_id = p_organization_id and x.person_id = p_person_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.person_consent_overview(uuid, uuid) from public, anon;
grant execute on function public.person_consent_overview(uuid, uuid) to authenticated;

create function public.complete_consent_review(p_review_id uuid, p_expected_version integer, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.consent_impact_reviews%rowtype;
  task_row public.tasks%rowtype;
  new_version integer;
begin
  select * into review from public.consent_impact_reviews where id = p_review_id for update;
  if review.id is null or app.can_work_person_privacy(review.organization_id, review.person_id) is distinct from true then
    raise exception 'consent review denied' using errcode = '42501';
  end if;
  if p_expected_version is distinct from review.version then
    raise exception 'consent review version conflict' using errcode = '40001';
  end if;
  if review.status = 'done' then
    raise exception 'this review is already done' using errcode = '22023';
  end if;
  if p_note is null or length(btrim(p_note)) < 3 or length(btrim(p_note)) > 2000 then
    raise exception 'a review note is 3 to 2000 characters' using errcode = '22023';
  end if;
  update public.consent_impact_reviews
  set status = 'done',
      done_at = clock_timestamp(),
      done_by = (select auth.uid()),
      done_note = btrim(p_note),
      updated_at = clock_timestamp(),
      version = review.version + 1
  where id = review.id
  returning version into new_version;

  if review.task_id is not null then
    select * into task_row from public.tasks where id = review.task_id and organization_id = review.organization_id for update;
    if task_row.id is not null and task_row.status in ('open', 'blocked') then
      perform app.open_task_write(task_row.id);
      update public.tasks
      set status = 'done', blocker_note = null, completed_at = statement_timestamp()
      where id = task_row.id;
      perform app.close_task_write(task_row.id);
      insert into public.task_events (organization_id, task_id, event_kind, from_status, to_status, actor_user_id)
      values (task_row.organization_id, task_row.id, 'status', task_row.status, 'done', (select auth.uid()));
    end if;
  end if;

  perform app.record_audit_event(
    review.organization_id, 'consent.impact_review_done', 'public.consent_impact_reviews', review.id, 'success',
    jsonb_build_object('purpose', review.consent_purpose, 'note_length', length(btrim(p_note)))
  );
  return new_version;
end;
$$;
revoke all on function public.complete_consent_review(uuid, integer, text) from public, anon;
grant execute on function public.complete_consent_review(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.begin_vo_document_review, last defined in 20261019218100_vo_doc_review.sql.
-- Change: a document whose person declines AI drafting is skipped ('client_ai_off').
-- ---------------------------------------------------------------------------
create or replace function public.begin_vo_document_review(p_organization_id uuid, p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  version public.document_versions%rowtype;
  doc public.documents%rowtype;
  matter public.matters%rowtype;
  settings public.vo_settings%rowtype;
  category text;
  waiting uuid;
  last_hour integer;
  last_day integer;
  firm_day integer;
  rid uuid;
begin
  -- Reading the file is a download: staff with MFA and a fresh second factor, as for Open file.
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    true
  );
  select * into version from public.document_versions where id = p_version_id and organization_id = p_organization_id;
  if version.id is null or app.can_read_document_version(version.id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  select * into doc from public.documents where id = version.document_id and organization_id = p_organization_id;
  -- The matter the reading belongs to: one this document is linked to that the person may read.
  select m.* into matter
  from public.document_matter_refs ref
  join public.matters m on m.id = ref.matter_id and m.organization_id = ref.organization_id
  where ref.document_id = doc.id
    and ref.organization_id = p_organization_id
    and ref.removed_at is null
    and app.message_staff_reads_matter(m.id, m.organization_id)
  order by ref.created_at asc
  limit 1;
  if doc.id is null or matter.id is null then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if version.upload_state is distinct from 'clean' then
    return jsonb_build_object('ok', false, 'error', 'not_clean');
  end if;
  if app.vo_enabled(p_organization_id) is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'off');
  end if;
  -- SEC-05: the client said no to AI drafting (or withdrew it): Vo skips their documents.
  if app.person_declines_ai(p_organization_id, doc.person_id) then
    return jsonb_build_object('ok', false, 'error', 'client_ai_off');
  end if;
  select * into settings from public.vo_settings where organization_id = p_organization_id;
  if settings.organization_id is not null
     and not (settings.doc_classification or settings.ocr_normalisation or settings.missing_fields or settings.inconsistency_flags) then
    return jsonb_build_object('ok', false, 'error', 'capability_off');
  end if;
  category := app.vo_document_category(doc.purpose, doc.sensitivity);
  if app.vo_category_allowed(p_organization_id, category) is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'category_off', 'category', category);
  end if;
  if app.sample_mode_blocks_real(p_organization_id, matter.is_sample) then
    return jsonb_build_object('ok', false, 'error', 'sample_only');
  end if;
  select d.id into waiting from public.vo_doc_drafts d
  where d.version_id = version.id and d.organization_id = p_organization_id and d.status = 'draft'
  limit 1;
  if waiting is not null then
    return jsonb_build_object('ok', false, 'error', 'already_read', 'draft_id', waiting, 'matter_id', matter.id);
  end if;

  -- The same per-firm serialization and limits as every Vo run.
  perform pg_advisory_xact_lock(hashtextextended('vo_run:' || p_organization_id::text, 0));
  select count(*) filter (where user_id = actor and created_at > statement_timestamp() - interval '1 hour'),
         count(*) filter (where user_id = actor),
         count(*)
  into last_hour, last_day, firm_day
  from public.vo_runs
  where organization_id = p_organization_id
    and created_at > statement_timestamp() - interval '1 day';
  if last_hour >= 20 or last_day >= 100 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if firm_day >= 300 then
    return jsonb_build_object('ok', false, 'error', 'firm_rate_limited');
  end if;

  insert into public.vo_runs (organization_id, user_id, kind, matter_id, thread_id, version_id, is_sample)
  values (p_organization_id, actor, 'document_review', matter.id, null, version.id, matter.is_sample)
  returning id into rid;
  perform app.record_audit_event(
    p_organization_id, 'vo.run_started', 'vo_runs', rid, 'success',
    jsonb_build_object('kind', 'document_review', 'version_id', version.id, 'category', category)
  );
  return jsonb_build_object('ok', true, 'run_id', rid, 'matter_id', matter.id, 'category', category);
end;
$$;
revoke all on function public.begin_vo_document_review(uuid, uuid) from public, anon;
grant execute on function public.begin_vo_document_review(uuid, uuid) to authenticated, service_role;
