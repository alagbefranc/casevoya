-- ORG-06 (#175): offboarding hands over the leaver's open leads, the booking types they host and
-- their upcoming consultations, each to a person chosen for it, before access closes. All in the
-- one transaction offboard_staff_member already was; the old three-argument form now refuses
-- whenever there is anything to hand over, so it can't skip the choices.

create or replace function public.staff_offboarding_preview(p_organization_id uuid, p_membership_id uuid)
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
    ),
    -- ORG-06: what needs a new owner or host, one choice each, before access closes. The owner
    -- sees these leads in the pipeline already; consultations show their title and time only.
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'label', l.display_name, 'stage', s.label) order by l.created_at)
      from public.leads l
      join public.lead_stages s on s.id = l.stage_id and s.organization_id = l.organization_id
      where l.organization_id = p_organization_id
        and l.owner_membership_id = any (leaver)
        and s.kind = 'open'
    ), '[]'::jsonb),
    'booking_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', et.id,
        'title', et.title,
        'published', et.is_published,
        'other_hosts', (
          select count(*) from public.booking_event_type_hosts other
          join public.memberships om on om.id = other.membership_id and om.organization_id = other.organization_id
          where other.event_type_id = et.id and not (other.membership_id = any (leaver)) and om.status = 'active'
        )
      ) order by et.title)
      from public.booking_event_types et
      where et.organization_id = p_organization_id
        and et.archived_at is null
        and exists (
          select 1 from public.booking_event_type_hosts host
          where host.event_type_id = et.id and host.membership_id = any (leaver)
        )
    ), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'starts_at', b.starts_at, 'time_zone', b.host_time_zone) order by b.starts_at)
      from public.bookings b
      where b.organization_id = p_organization_id
        and b.host_membership_id = any (leaver)
        and b.status in ('held', 'pending_payment', 'confirmed')
        and b.ends_at > statement_timestamp()
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
comment on function public.staff_offboarding_preview(uuid, uuid) is
  'Firm owner at aal2: what offboarding a staff member would move (tasks, deadlines, consultant-of-record matters, assignments, and per item their open leads, hosted booking types and upcoming consultations) and end (sessions, connections). Read only; matter labels only, never client names.';
revoke all on function public.staff_offboarding_preview(uuid, uuid) from public, anon;
grant execute on function public.staff_offboarding_preview(uuid, uuid) to authenticated;

create function public.offboard_staff_member(p_organization_id uuid, p_membership_id uuid, p_receiver_membership_id uuid, p_handover jsonb)
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
  handover jsonb := coalesce(p_handover, '{}'::jsonb);
  choice uuid;
  chosen public.memberships%rowtype;
  host_label text;
  host_zone text;
  moved_leads integer := 0;
  moved_follow_ups integer := 0;
  moved_types integer := 0;
  moved_bookings integer := 0;
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

  if jsonb_typeof(handover) <> 'object' then
    raise exception 'handover must be an object' using errcode = '22023';
  end if;

  -- 0. ORG-06: each open lead, hosted booking type and upcoming consultation goes to the person
  -- chosen for it (handover.leads / booking_types / bookings: {id: membership id}). One missing
  -- or unusable choice refuses the whole offboarding, before anything moves.
  for rec in
    select 'leads' as section, l.id, l.display_name as label
    from public.leads l
    join public.lead_stages s on s.id = l.stage_id and s.organization_id = l.organization_id
    where l.organization_id = p_organization_id and l.owner_membership_id = any (leaver) and s.kind = 'open'
    union all
    select 'booking_types', et.id, et.title
    from public.booking_event_types et
    where et.organization_id = p_organization_id and et.archived_at is null
      and exists (select 1 from public.booking_event_type_hosts host where host.event_type_id = et.id and host.membership_id = any (leaver))
    union all
    select 'bookings', b.id, b.title
    from public.bookings b
    where b.organization_id = p_organization_id and b.host_membership_id = any (leaver)
      and b.status in ('held', 'pending_payment', 'confirmed') and b.ends_at > statement_timestamp()
  loop
    begin
      choice := nullif(handover -> rec.section ->> rec.id::text, '')::uuid;
    exception when invalid_text_representation then
      choice := null;
    end;
    if choice is null then
      raise exception '%', case rec.section
        when 'leads' then 'choose a new owner for each open lead'
        when 'booking_types' then 'choose a new host for each booking type'
        else 'choose a new host for each upcoming consultation' end
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.memberships mem
      where mem.id = choice and mem.organization_id = p_organization_id and mem.status = 'active'
        and mem.role = any (app.scheduling_staff_roles()) and mem.user_id <> target.user_id
    ) then
      raise exception 'choose an active team member for %', rec.label using errcode = '22023';
    end if;
  end loop;

  -- 0a. Open leads, and the open follow-ups on them, to each lead's new owner.
  for rec in
    select l.id, l.owner_membership_id
    from public.leads l
    join public.lead_stages s on s.id = l.stage_id and s.organization_id = l.organization_id
    where l.organization_id = p_organization_id and l.owner_membership_id = any (leaver) and s.kind = 'open'
    order by l.created_at
    for update of l
  loop
    choice := (handover -> 'leads' ->> rec.id::text)::uuid;
    update public.leads set owner_membership_id = choice where id = rec.id;
    perform app.lead_event(p_organization_id, rec.id, 'assigned', null, null, 'offboarding',
      jsonb_build_object('from', rec.owner_membership_id, 'to', choice));
    update public.lead_follow_ups f
       set owner_membership_id = choice
     where f.organization_id = p_organization_id and f.lead_id = rec.id
       and f.owner_membership_id = any (leaver) and f.completed_at is null;
    get diagnostics new_version = row_count;
    moved_follow_ups := moved_follow_ups + new_version;
    perform app.record_audit_event(p_organization_id, 'lead.owner_reassigned', 'public.leads', rec.id, 'success',
      jsonb_build_object('from_membership_id', rec.owner_membership_id, 'to_membership_id', choice, 'reason', 'offboarding'));
    moved_leads := moved_leads + 1;
  end loop;
  -- Their open follow-ups on anyone else's leads go to the main receiver.
  update public.lead_follow_ups f
     set owner_membership_id = receiver.id
   where f.organization_id = p_organization_id and f.owner_membership_id = any (leaver) and f.completed_at is null;
  get diagnostics new_version = row_count;
  moved_follow_ups := moved_follow_ups + new_version;

  -- 0b. Booking types they host: the chosen host takes their place (or already hosts it).
  for rec in
    select host.id, host.event_type_id, host.membership_id
    from public.booking_event_type_hosts host
    join public.booking_event_types et on et.id = host.event_type_id and et.organization_id = host.organization_id
    where host.organization_id = p_organization_id and host.membership_id = any (leaver) and et.archived_at is null
    order by host.event_type_id
    for update of host
  loop
    choice := (handover -> 'booking_types' ->> rec.event_type_id::text)::uuid;
    if exists (select 1 from public.booking_event_type_hosts x where x.event_type_id = rec.event_type_id and x.membership_id = choice) then
      delete from public.booking_event_type_hosts where id = rec.id;
    else
      update public.booking_event_type_hosts set membership_id = choice where id = rec.id;
    end if;
    perform app.record_audit_event(p_organization_id, 'booking_type.host_reassigned', 'public.booking_event_types', rec.event_type_id, 'success',
      jsonb_build_object('from_membership_id', rec.membership_id, 'to_membership_id', choice, 'reason', 'offboarding'));
    moved_types := moved_types + 1;
  end loop;

  -- 0c. Upcoming consultations they host: the chosen host, at the same time. A new host who is
  -- already booked then is refused by name; nothing moves.
  for rec in
    select b.id, b.title, b.starts_at, b.host_membership_id, b.host_time_zone
    from public.bookings b
    where b.organization_id = p_organization_id and b.host_membership_id = any (leaver)
      and b.status in ('held', 'pending_payment', 'confirmed') and b.ends_at > statement_timestamp()
    order by b.starts_at
    for update
  loop
    choice := (handover -> 'bookings' ->> rec.id::text)::uuid;
    select * into chosen from public.memberships mem where mem.id = choice;
    select left(nullif(btrim(profile.display_name), ''), 200), profile.timezone into host_label, host_zone
    from public.profiles profile where profile.id = chosen.user_id;
    begin
      update public.bookings
         set host_membership_id = chosen.id,
             host_user_id = chosen.user_id,
             host_name = host_label,
             host_time_zone = coalesce(nullif(host_zone, ''), rec.host_time_zone),
             ics_sequence = ics_sequence + 1
       where id = rec.id;
    exception when exclusion_violation then
      raise exception 'the new host already has a consultation at the time of %', rec.title using errcode = '22023';
    end;
    perform app.record_audit_event(p_organization_id, 'booking.host_reassigned', 'public.bookings', rec.id, 'success',
      jsonb_build_object('from_membership_id', rec.host_membership_id, 'to_membership_id', chosen.id, 'reason', 'offboarding'));
    moved_bookings := moved_bookings + 1;
  end loop;

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
      'sessions', ended_sessions,
      'leads', moved_leads,
      'follow_ups', moved_follow_ups,
      'booking_types', moved_types,
      'bookings', moved_bookings
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
    'sessions', ended_sessions,
    'leads', moved_leads,
    'follow_ups', moved_follow_ups,
    'booking_types', moved_types,
    'bookings', moved_bookings
  );
end;
$$;
comment on function public.offboard_staff_member(uuid, uuid, uuid, jsonb) is
  'Firm owner + step-up: hands each open lead, hosted booking type and upcoming consultation to the person chosen for it (p_handover), moves open tasks, matter assignments and (to a verified licence) consultant-of-record matters to the receiver, then revokes memberships and sessions, in one transaction. Audited.';
revoke all on function public.offboard_staff_member(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.offboard_staff_member(uuid, uuid, uuid, jsonb) to authenticated;

-- The old form: no choices, so it refuses when the leaver has leads, booking types or consultations.
create or replace function public.offboard_staff_member(p_organization_id uuid, p_membership_id uuid, p_receiver_membership_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.offboard_staff_member(p_organization_id, p_membership_id, p_receiver_membership_id, '{}'::jsonb);
$$;
