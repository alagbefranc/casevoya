-- Settings > Team and seats: change a member's role, suspend or reactivate them, offboard them,
-- and edit the continuity contact and succession note (PRD ORG-02, ORG-06, SEC-01).
--
-- Memberships are write-locked to definer functions (20261018010100). Until now no audited function
-- changed a member's role or status. This migration adds, all firm owner + recent step-up through
-- app.require_firm_owner_step_up, never on the caller's own memberships, and audited:
--
--   app.revoke_member_sessions(org, user, reason)  Internal. Ends every sign-in session of a user the
--       way public.reset_staff_mfa and public.revoke_other_sessions do: a public.auth_session_cutoffs
--       cut-off (tokens issued before it are refused by app.session_is_revoked), a
--       public.session_revocations row per open auth.sessions row, and the Auth session rows removed
--       so their refresh tokens stop working. Sessions are per sign-in, not per firm: a person who is
--       also staff of another firm signs in again there. Returns how many sessions ended.
--   public.change_staff_role(org, membership, role)  A staff role for an active or suspended staff
--       membership. Refuses the same role, a role the person already holds in this firm (one row per
--       role), and the last active firm owner (app.guard_last_firm_owner also refuses it). A
--       licensed membership (app.membership_is_licensed) that is still the consultant of record on an
--       open matter keeps a licensed role: its matters move first (offboarding, or Licences >
--       Reassign work). Becoming a licensed consultant needs no credential here, as with an
--       invitation; the existing licence gates refuse regulated actions until a licence is declared
--       and checked. Audited membership.role_changed {from, to}.
--   public.set_staff_suspended(org, membership, suspended)  Active <-> suspended. Suspending ends the
--       person's sign-in sessions (above). Never the last active firm owner. Audited
--       membership.suspended {sessions} / membership.reactivated.
--   public.staff_offboarding_preview(org, membership)  Read only (firm owner at aal2, no step-up):
--       what offboarding would move, for the Designer's Offboard dialog. Open and blocked internal
--       tasks the person owns, the deadlines tied to them, matters where they are the consultant of
--       record (responsible consultant or consultant party) with how many representation
--       authorities are on file, other matter assignments (case manager or assistant party, on-hold
--       owner), open sessions and active connections. Matter labels are the matter reference or
--       title, never a client's name.
--   public.offboard_staff_member(org, membership, receiver)  One transaction, in this order:
--       1. open and blocked internal tasks owned by any of the person's staff memberships move to
--          the receiver (task_events 'reassigned', outbox task.reassigned, as public.reassign_task);
--          a deadline tied to a moved task changes owner with it; its date, source and verification
--          do not change;
--       2. case manager and assistant parties and on-hold ownership on open matters move to the
--          receiver;
--       3. client-facing authority: on each open matter where the person is the consultant of record,
--          the responsible consultant and the consultant party move to the receiver, who must hold a
--          verified licence (as public.reassign_consultant_matters_selected), else nothing happens.
--          Each such matter gets a high-priority internal task for the receiver to review the
--          client's representation authority and tell the client. No client notice is sent: no
--          approved email design exists (open item in DECISIONS);
--       4. the person's active staff connections are marked disconnected, with their calendar busy
--          times (as public.disconnect_staff_connection);
--       5. access ends: every staff membership of the person in this firm becomes 'revoked' (the
--          existing membership_status value; nothing is deleted) and their sessions end.
--       Audited membership.offboarded with the counts; per-matter matter.consultant_reassigned.
--       Returns the counts.
--   public.set_firm_continuity(org, name, email, note)  The continuity contact's name and email and
--       the succession note (organizations.continuity_contact_*, succession_note). A blank value
--       clears it; an email needs a name. Audited firm.continuity_changed with field names only.
--
-- New functions only. No table, column, enum value, policy or existing function changes.

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
create function app.revoke_member_sessions(p_organization_id uuid, p_user_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ended integer := 0;
begin
  insert into public.auth_session_cutoffs (user_id, sessions_valid_after)
  values (p_user_id, clock_timestamp())
  on conflict (user_id) do update
    set sessions_valid_after = excluded.sessions_valid_after,
        updated_at = statement_timestamp();

  if to_regclass('auth.sessions') is not null then
    execute $sql$
      with doomed as (
        select s.id from auth.sessions s where s.user_id = $1
      ),
      marked as (
        insert into public.session_revocations (user_id, session_id, revoked_by, organization_id, reason)
        select $1, doomed.id, $2, $3, $4
        from doomed
        on conflict (user_id, session_id) do nothing
        returning session_id
      )
      delete from auth.sessions s
      using doomed
      where s.id = doomed.id
      returning s.id
    $sql$
    using p_user_id, (select auth.uid()), p_organization_id, p_reason;
    get diagnostics ended = row_count;
  end if;
  return ended;
end;
$$;
comment on function app.revoke_member_sessions(uuid, uuid, text) is
  'Internal: ends a user''s sign-in sessions (cut-off, session_revocations rows, Auth session rows removed). Callers check authority first.';
revoke all on function app.revoke_member_sessions(uuid, uuid, text) from public;

-- A staff membership of this firm that a firm owner may manage: not the caller's own.
create function app.managed_staff_membership(p_organization_id uuid, p_membership_id uuid)
returns public.memberships
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.memberships%rowtype;
begin
  select * into target
  from public.memberships mem
  where mem.id = p_membership_id
    and mem.organization_id = p_organization_id
    and mem.role = any (app.staff_roles());
  if target.id is null then
    raise exception 'team member not found' using errcode = '42501';
  end if;
  if target.user_id = (select auth.uid()) then
    raise exception 'you cannot change your own access; ask another firm owner' using errcode = '42501';
  end if;
  return target;
end;
$$;
revoke all on function app.managed_staff_membership(uuid, uuid) from public;

-- True when another active firm owner (a different person) remains.
create function app.other_active_owner(p_organization_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships mem
    where mem.organization_id = p_organization_id
      and mem.role = 'firm_owner'
      and mem.status = 'active'
      and mem.user_id <> p_user_id
  );
$$;
revoke all on function app.other_active_owner(uuid, uuid) from public;

-- Open matters where a membership is the consultant of record.
create function app.membership_record_matters(p_organization_id uuid, p_membership_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.matters m
  where m.organization_id = p_organization_id
    and m.stage <> 'closed'
    and (
      m.responsible_consultant_membership_id = any (p_membership_ids)
      or exists (
        select 1 from public.matter_participants mp
        where mp.matter_id = m.id
          and mp.organization_id = m.organization_id
          and mp.membership_id = any (p_membership_ids)
          and mp.role = 'consultant'
      )
    );
$$;
revoke all on function app.membership_record_matters(uuid, uuid[]) from public;

-- ---------------------------------------------------------------------------
-- Change role
-- ---------------------------------------------------------------------------
create function public.change_staff_role(p_organization_id uuid, p_membership_id uuid, p_role public.org_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.memberships%rowtype;
  licensed_after boolean;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  target := app.managed_staff_membership(p_organization_id, p_membership_id);
  if target.status not in ('active', 'suspended') then
    raise exception 'only a current team member''s role can change' using errcode = '42501';
  end if;
  if p_role is null or p_role <> all (app.staff_roles()) then
    raise exception 'choose a staff role' using errcode = '22023';
  end if;
  if p_role = target.role then
    raise exception 'they already have that role' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships mem
    where mem.organization_id = p_organization_id
      and mem.user_id = target.user_id
      and mem.role = p_role
  ) then
    raise exception 'they already hold that role in this firm' using errcode = '23505';
  end if;
  if target.role = 'firm_owner' and target.status = 'active'
     and not app.other_active_owner(p_organization_id, target.user_id) then
    raise exception 'cannot remove or demote the last firm owner' using errcode = '42501';
  end if;

  -- A consultant of record keeps a licensed role until their open matters move.
  if app.membership_is_licensed(target.id) then
    licensed_after := p_role = 'licensed_consultant'
      or (
        p_role = 'firm_owner'
        and exists (
          select 1 from public.consultant_credentials credential
          where credential.membership_id = target.id
            and credential.organization_id = target.organization_id
            and not app.licence_status_blocks(credential.status)
        )
      );
    if not licensed_after and exists (
      select 1 from app.membership_record_matters(p_organization_id, array[target.id])
    ) then
      raise exception 'move their matters to another licensed consultant first' using errcode = '42501';
    end if;
  end if;

  update public.memberships
     set role = p_role
   where id = target.id;

  perform app.record_audit_event(
    p_organization_id,
    'membership.role_changed',
    'public.memberships',
    target.id,
    'success',
    jsonb_build_object('from', target.role, 'to', p_role)
  );
end;
$$;
comment on function public.change_staff_role(uuid, uuid, public.org_role) is
  'Firm owner + step-up: a staff member''s role. Never your own, never the last firm owner; a consultant of record keeps a licensed role. Audited membership.role_changed.';
revoke all on function public.change_staff_role(uuid, uuid, public.org_role) from public, anon;
grant execute on function public.change_staff_role(uuid, uuid, public.org_role) to authenticated;

-- ---------------------------------------------------------------------------
-- Suspend / reactivate
-- ---------------------------------------------------------------------------
create function public.set_staff_suspended(p_organization_id uuid, p_membership_id uuid, p_suspended boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.memberships%rowtype;
  ended integer := 0;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  target := app.managed_staff_membership(p_organization_id, p_membership_id);
  if p_suspended is null then
    raise exception 'choose suspend or reactivate' using errcode = '22023';
  end if;

  if p_suspended then
    if target.status <> 'active' then
      raise exception 'only an active team member can be suspended' using errcode = '22023';
    end if;
    if target.role = 'firm_owner' and not app.other_active_owner(p_organization_id, target.user_id) then
      raise exception 'cannot remove or demote the last firm owner' using errcode = '42501';
    end if;
    update public.memberships
       set status = 'suspended', suspended_at = statement_timestamp()
     where id = target.id;
    ended := app.revoke_member_sessions(p_organization_id, target.user_id, 'suspended');
    perform app.record_audit_event(
      p_organization_id,
      'membership.suspended',
      'public.memberships',
      target.id,
      'success',
      jsonb_build_object('role', target.role, 'sessions', ended)
    );
  else
    if target.status <> 'suspended' then
      raise exception 'only a suspended team member can be reactivated' using errcode = '22023';
    end if;
    update public.memberships
       set status = 'active', suspended_at = null
     where id = target.id;
    perform app.record_audit_event(
      p_organization_id,
      'membership.reactivated',
      'public.memberships',
      target.id,
      'success',
      jsonb_build_object('role', target.role)
    );
  end if;
  return ended;
end;
$$;
comment on function public.set_staff_suspended(uuid, uuid, boolean) is
  'Firm owner + step-up: suspend (ends their sessions) or reactivate a staff member. Never your own, never the last firm owner. Audited.';
revoke all on function public.set_staff_suspended(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_staff_suspended(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Offboarding preview
-- ---------------------------------------------------------------------------
create function public.staff_offboarding_preview(p_organization_id uuid, p_membership_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.memberships%rowtype;
  leaver uuid[];
  result jsonb;
  sessions integer;
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner']::public.org_role[], false);
  target := app.managed_staff_membership(p_organization_id, p_membership_id);
  select array_agg(mem.id) into leaver
  from public.memberships mem
  where mem.organization_id = p_organization_id
    and mem.user_id = target.user_id
    and mem.role = any (app.staff_roles())
    and mem.status in ('invited', 'active', 'suspended');
  leaver := coalesce(leaver, array[]::uuid[]);

  if to_regclass('auth.sessions') is not null then
    execute $sql$
      select count(*)::integer from auth.sessions s
      where s.user_id = $1
        and (s.not_after is null or s.not_after > statement_timestamp())
        and not exists (select 1 from public.session_revocations r where r.user_id = s.user_id and r.session_id = s.id)
    $sql$ into sessions using target.user_id;
  end if;

  select jsonb_build_object(
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('title', t.title, 'matter', coalesce(m.reference, m.title)) order by t.due_on nulls last, t.created_at)
      from public.tasks t
      left join public.matters m on m.id = t.matter_id
      where t.organization_id = p_organization_id
        and t.audience = 'internal'
        and t.status in ('open', 'blocked')
        and t.owner_membership_id = any (leaver)
    ), '[]'::jsonb),
    'deadlines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', d.label,
        'matter', coalesce(m.reference, m.title),
        'due_on', coalesce(d.due_on, (d.due_at at time zone d.timezone)::date),
        'confirmed', d.verification = 'confirmed',
        'source_url', d.source_url,
        'source_retrieved_on', d.source_retrieved_on,
        'rule', d.rule_version_id is not null
      ) order by coalesce(d.due_on, (d.due_at at time zone d.timezone)::date), d.created_at)
      from public.deadlines d
      join public.tasks t on t.id = d.task_id and t.organization_id = d.organization_id
      join public.matters m on m.id = d.matter_id
      where d.organization_id = p_organization_id
        and t.audience = 'internal'
        and t.status in ('open', 'blocked')
        and t.owner_membership_id = any (leaver)
    ), '[]'::jsonb),
    'authority', coalesce((
      select jsonb_agg(jsonb_build_object(
        'matter', coalesce(m.reference, m.title),
        'authorities', (
          select count(*) from public.representation_authorities ra
          where ra.matter_id = m.id and ra.organization_id = m.organization_id and ra.revoked_at is null
        )
      ) order by m.created_at)
      from public.matters m
      where m.id in (select app.membership_record_matters(p_organization_id, leaver))
    ), '[]'::jsonb),
    'assignments', (
      select count(*) from public.matter_participants mp
      join public.matters m on m.id = mp.matter_id and m.organization_id = mp.organization_id
      where mp.organization_id = p_organization_id
        and mp.membership_id = any (leaver)
        and mp.role in ('case_manager', 'assistant')
        and m.stage <> 'closed'
    ) + (
      select count(*) from public.matters m
      where m.organization_id = p_organization_id
        and m.on_hold_owner_membership_id = any (leaver)
        and m.stage <> 'closed'
    ),
    'sessions', sessions,
    'connections', (
      select count(*) from public.staff_connections c
      where c.organization_id = p_organization_id
        and c.membership_id = any (leaver)
        and c.status <> 'disconnected'
    )
  ) into result;
  return result;
end;
$$;
comment on function public.staff_offboarding_preview(uuid, uuid) is
  'Firm owner at aal2: what offboarding a staff member would move (tasks, deadlines, consultant-of-record matters, assignments) and end (sessions, connections). Read only; matter labels only, never client names.';
revoke all on function public.staff_offboarding_preview(uuid, uuid) from public, anon;
grant execute on function public.staff_offboarding_preview(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Offboard
-- ---------------------------------------------------------------------------
create function public.offboard_staff_member(p_organization_id uuid, p_membership_id uuid, p_receiver_membership_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.memberships%rowtype;
  receiver public.memberships%rowtype;
  receiver_status public.credential_status;
  leaver uuid[];
  rec record;
  matter public.matters%rowtype;
  new_version integer;
  review_id uuid;
  new_task uuid;
  moved_tasks integer := 0;
  moved_deadlines integer := 0;
  moved_assignments integer := 0;
  moved_authority integer := 0;
  review_tasks integer := 0;
  ended_connections integer := 0;
  ended_memberships integer := 0;
  ended_sessions integer := 0;
  record_matters uuid[];
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  target := app.managed_staff_membership(p_organization_id, p_membership_id);
  if target.status = 'revoked' then
    raise exception 'they no longer have access' using errcode = '22023';
  end if;

  select array_agg(mem.id) into leaver
  from public.memberships mem
  where mem.organization_id = p_organization_id
    and mem.user_id = target.user_id
    and mem.role = any (app.staff_roles())
    and mem.status in ('invited', 'active', 'suspended');

  select * into receiver
  from public.memberships mem
  where mem.id = p_receiver_membership_id
    and mem.organization_id = p_organization_id;
  if receiver.id is null
     or receiver.status <> 'active'
     or receiver.role not in ('firm_owner', 'licensed_consultant', 'case_manager', 'assistant')
     or receiver.user_id = target.user_id then
    raise exception 'choose an active team member to receive their work' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.memberships mem
    where mem.id = any (leaver) and mem.role = 'firm_owner' and mem.status = 'active'
  ) and not app.other_active_owner(p_organization_id, target.user_id) then
    raise exception 'cannot remove or demote the last firm owner' using errcode = '42501';
  end if;

  -- Client-facing authority can only move to a consultant with a verified licence.
  select coalesce(array_agg(id), array[]::uuid[]) into record_matters
  from app.membership_record_matters(p_organization_id, leaver) as id;
  if cardinality(record_matters) > 0 then
    select credential.status into receiver_status
    from public.consultant_credentials credential
    where credential.membership_id = receiver.id
      and credential.organization_id = receiver.organization_id;
    if app.membership_is_licensed(receiver.id) is distinct from true
       or receiver_status is distinct from 'verified'
       or app.licence_status_blocks(receiver_status) then
      raise exception 'the receiving consultant needs a verified licence' using errcode = '42501';
    end if;
  end if;

  -- 1. Open tasks (and the deadlines tied to them).
  for rec in
    select t.id, t.matter_id, t.owner_membership_id
    from public.tasks t
    where t.organization_id = p_organization_id
      and t.audience = 'internal'
      and t.status in ('open', 'blocked')
      and t.owner_membership_id = any (leaver)
    order by t.created_at
    for update
  loop
    perform app.open_task_write(rec.id);
    update public.tasks set owner_membership_id = receiver.id where id = rec.id returning version into new_version;
    perform app.close_task_write(rec.id);
    insert into public.task_events (organization_id, task_id, event_kind, from_membership_id, to_membership_id, actor_user_id)
    values (p_organization_id, rec.id, 'reassigned', rec.owner_membership_id, receiver.id, actor);
    perform app.enqueue_event(
      p_organization_id,
      'task',
      rec.id,
      'task.reassigned',
      jsonb_build_object('task_id', rec.id, 'matter_id', rec.matter_id),
      new_version,
      'task.reassigned:' || rec.id::text || ':' || new_version::text
    );
    moved_tasks := moved_tasks + 1;
    moved_deadlines := moved_deadlines + (
      select count(*)::integer from public.deadlines d where d.task_id = rec.id and d.organization_id = p_organization_id
    );
  end loop;

  -- 2. Case manager and assistant parties, and on-hold ownership, on open matters.
  for rec in
    select mp.id, mp.matter_id, mp.role
    from public.matter_participants mp
    join public.matters m on m.id = mp.matter_id and m.organization_id = mp.organization_id
    where mp.organization_id = p_organization_id
      and mp.membership_id = any (leaver)
      and mp.role in ('case_manager', 'assistant')
      and m.stage <> 'closed'
  loop
    if exists (
      select 1 from public.matter_participants existing
      where existing.matter_id = rec.matter_id and existing.membership_id = receiver.id and existing.role = rec.role
    ) then
      delete from public.matter_participants where id = rec.id;
    else
      update public.matter_participants set membership_id = receiver.id where id = rec.id;
    end if;
    moved_assignments := moved_assignments + 1;
  end loop;
  for rec in
    select m.id from public.matters m
    where m.organization_id = p_organization_id
      and m.on_hold_owner_membership_id = any (leaver)
      and m.stage <> 'closed'
    for update
  loop
    perform app.open_matter_column(rec.id, 'on_hold');
    update public.matters set on_hold_owner_membership_id = receiver.id where id = rec.id;
    perform app.close_matter_column(rec.id);
    moved_assignments := moved_assignments + 1;
  end loop;

  -- 3. Consultant of record, with a review task per matter for the receiver.
  foreach review_id in array record_matters loop
    select * into matter from public.matters m where m.id = review_id for update;
    if matter.responsible_consultant_membership_id = any (leaver) then
      perform app.open_matter_column(matter.id, 'consultant');
      update public.matters set responsible_consultant_membership_id = receiver.id where id = matter.id;
      perform app.close_matter_column(matter.id);
    end if;
    delete from public.matter_participants
     where matter_participants.matter_id = matter.id
       and membership_id = any (leaver)
       and role = 'consultant';
    insert into public.matter_participants (organization_id, matter_id, membership_id, role)
    values (matter.organization_id, matter.id, receiver.id, 'consultant')
    on conflict (matter_id, membership_id, role) do nothing;
    perform app.record_audit_event(
      p_organization_id,
      'matter.consultant_reassigned',
      'public.matters',
      matter.id,
      'success',
      jsonb_build_object('from_membership_id', target.id, 'to_membership_id', receiver.id, 'reason', 'offboarding')
    );
    moved_authority := moved_authority + 1;

    insert into public.tasks (organization_id, matter_id, audience, title, priority, owner_membership_id, due_timezone, checklist)
    values (
      p_organization_id,
      matter.id,
      'internal',
      'Review client authority after consultant change',
      'high',
      receiver.id,
      coalesce((select org.timezone from public.organizations org where org.id = p_organization_id), 'America/Toronto'),
      '[]'::jsonb
    )
    returning id into new_task;
    insert into public.task_events (organization_id, task_id, event_kind, to_status, actor_user_id)
    values (p_organization_id, new_task, 'created', 'open', actor);
    review_tasks := review_tasks + 1;
  end loop;

  -- 4. Their connections.
  for rec in
    select c.id, c.membership_id, c.toolkit from public.staff_connections c
    where c.organization_id = p_organization_id
      and c.membership_id = any (leaver)
      and c.status <> 'disconnected'
    for update
  loop
    update public.staff_connections
       set status = 'disconnected', updated_at = now(), updated_by = actor
     where id = rec.id;
    if rec.toolkit in ('googlecalendar', 'outlook_calendar') then
      delete from public.external_busy_blocks x
       where x.membership_id = rec.membership_id
         and x.organization_id = p_organization_id
         and x.source = case when rec.toolkit = 'googlecalendar' then 'google' else 'microsoft' end;
    end if;
    ended_connections := ended_connections + 1;
  end loop;

  -- 5. Access ends last.
  update public.memberships
     set status = 'revoked', revoked_at = statement_timestamp()
   where id = any (leaver);
  get diagnostics ended_memberships = row_count;
  ended_sessions := app.revoke_member_sessions(p_organization_id, target.user_id, 'offboarded');

  perform app.record_audit_event(
    p_organization_id,
    'membership.offboarded',
    'public.memberships',
    target.id,
    'success',
    jsonb_build_object(
      'to_membership_id', receiver.id,
      'tasks', moved_tasks,
      'deadlines', moved_deadlines,
      'assignments', moved_assignments,
      'authority', moved_authority,
      'review_tasks', review_tasks,
      'connections', ended_connections,
      'memberships', ended_memberships,
      'sessions', ended_sessions
    )
  );
  return jsonb_build_object(
    'tasks', moved_tasks,
    'deadlines', moved_deadlines,
    'assignments', moved_assignments,
    'authority', moved_authority,
    'review_tasks', review_tasks,
    'connections', ended_connections,
    'memberships', ended_memberships,
    'sessions', ended_sessions
  );
end;
$$;
comment on function public.offboard_staff_member(uuid, uuid, uuid) is
  'Firm owner + step-up: moves a staff member''s open tasks, matter assignments and (to a verified licence) consultant-of-record matters to a colleague, then revokes their memberships and sessions, in one transaction. Audited membership.offboarded.';
revoke all on function public.offboard_staff_member(uuid, uuid, uuid) from public, anon;
grant execute on function public.offboard_staff_member(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Continuity contact and succession note
-- ---------------------------------------------------------------------------
create function public.set_firm_continuity(p_organization_id uuid, p_name text, p_email text, p_succession_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  firm public.organizations%rowtype;
  name_value text := nullif(btrim(coalesce(p_name, '')), '');
  email_raw text := nullif(btrim(coalesce(p_email, '')), '');
  email_value text;
  note_value text := nullif(btrim(coalesce(p_succession_note, '')), '');
  changed text[] := array[]::text[];
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  if name_value is not null and length(name_value) > 200 then
    raise exception 'continuity contact is too long' using errcode = '22023';
  end if;
  email_value := app.normalize_email(email_raw);
  if email_raw is not null and email_value is null then
    raise exception 'continuity contact email is not usable' using errcode = '22023';
  end if;
  if email_value is not null and name_value is null then
    raise exception 'continuity contact needs a name' using errcode = '22023';
  end if;
  if note_value is not null and length(note_value) > 2000 then
    raise exception 'succession note is too long' using errcode = '22023';
  end if;

  select * into firm from public.organizations where id = p_organization_id for update;
  if firm.id is null then
    raise exception 'firm not found' using errcode = '42501';
  end if;
  if firm.continuity_contact_name is distinct from name_value then changed := array_append(changed, 'continuity_contact_name'); end if;
  if firm.continuity_contact_email is distinct from email_value then changed := array_append(changed, 'continuity_contact_email'); end if;
  if firm.succession_note is distinct from note_value then changed := array_append(changed, 'succession_note'); end if;
  if cardinality(changed) = 0 then
    return;
  end if;

  update public.organizations
     set continuity_contact_name = name_value,
         continuity_contact_email = email_value,
         succession_note = note_value
   where id = p_organization_id;

  perform app.record_audit_event(
    p_organization_id,
    'firm.continuity_changed',
    'public.organizations',
    p_organization_id,
    'success',
    jsonb_build_object('fields', to_jsonb(changed))
  );
end;
$$;
comment on function public.set_firm_continuity(uuid, text, text, text) is
  'Firm owner + step-up: the continuity contact (name, email) and succession note. Blank clears. Audited firm.continuity_changed with field names only.';
revoke all on function public.set_firm_continuity(uuid, text, text, text) from public, anon;
grant execute on function public.set_firm_continuity(uuid, text, text, text) to authenticated;
