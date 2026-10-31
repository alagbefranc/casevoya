-- Turning connected accounts off ends them (#299). Additive only; each function is copied from its
-- latest definition (20261019207200_staff_connections.sql, its only definition) and only the marked
-- parts change.
--
-- public.set_composio_enabled(false): every connection of the firm becomes 'disconnected' and the
--   busy times read from connected calendars (sources google, microsoft) are removed. Marked "Off".
-- public.replace_external_busy_blocks: refused while the firm's switch is off. Marked "Switch".
-- public.composio_connection_ready: what the app checks before any Composio call for the signed-in
--   staff member: the firm's switch is on and, when a toolkit is named, their connection to it is
--   active (returns its mail label).

create or replace function public.set_composio_enabled(p_organization_id uuid, p_enabled boolean, p_accept_disclosure boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  ended integer := 0;
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner']::public.org_role[], false);
  if p_enabled and p_accept_disclosure is not true then
    raise exception 'accept the Composio disclosure first' using errcode = '22023';
  end if;
  insert into public.vo_settings (organization_id, enabled, updated_by)
  values (p_organization_id, app.vo_enabled(p_organization_id), actor)
  on conflict (organization_id) do nothing;
  update public.vo_settings
    set composio_enabled = p_enabled,
        composio_accepted_by = case when p_enabled then actor else composio_accepted_by end,
        composio_accepted_at = case when p_enabled then now() else composio_accepted_at end,
        updated_at = now(),
        updated_by = actor
    where organization_id = p_organization_id;
  -- Off: every connection ends, and the busy times read through them go.
  if p_enabled is not true then
    update public.staff_connections
       set status = 'disconnected', updated_at = now(), updated_by = actor
     where organization_id = p_organization_id
       and status <> 'disconnected';
    get diagnostics ended = row_count;
    delete from public.external_busy_blocks x
     where x.organization_id = p_organization_id
       and x.source in ('google', 'microsoft');
  end if;
  perform app.record_audit_event(
    p_organization_id, 'integrations.composio_changed', 'vo_settings', null, 'success',
    jsonb_build_object('enabled', p_enabled, 'disclosure_accepted', p_enabled, 'connections_ended', ended)
  );
end;
$$;

create or replace function public.replace_external_busy_blocks(
  p_organization_id uuid,
  p_source text,
  p_from timestamptz,
  p_to timestamptz,
  p_blocks jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  member uuid;
  block jsonb;
  added integer := 0;
  starts timestamptz;
  ends timestamptz;
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  member := app.my_staff_membership(p_organization_id);
  if member is null then
    raise exception 'calendar denied' using errcode = '42501';
  end if;
  if p_source not in ('google', 'microsoft') then
    raise exception 'unknown calendar source' using errcode = '22023';
  end if;
  -- Switch
  if not exists (select 1 from public.vo_settings s where s.organization_id = p_organization_id and s.composio_enabled) then
    raise exception 'the firm owner has not turned on connected accounts' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.staff_connections c
    where c.membership_id = member and c.status = 'active'
      and c.toolkit = case when p_source = 'google' then 'googlecalendar' else 'outlook_calendar' end
  ) then
    raise exception 'connect that calendar first' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'choose a range of up to 62 days' using errcode = '22023';
  end if;
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) > 500 then
    raise exception 'up to 500 busy times' using errcode = '22023';
  end if;
  delete from public.external_busy_blocks x
  where x.membership_id = member and x.organization_id = p_organization_id and x.source = p_source
    and x.ends_at > p_from and x.starts_at < p_to;
  for block in select value from jsonb_array_elements(p_blocks)
  loop
    starts := (block ->> 'start')::timestamptz;
    ends := (block ->> 'end')::timestamptz;
    continue when starts is null or ends is null or ends <= starts or ends - starts > interval '14 days'
      or ends <= p_from or starts >= p_to;
    insert into public.external_busy_blocks (organization_id, membership_id, source, starts_at, ends_at)
    values (p_organization_id, member, p_source, greatest(starts, p_from), least(ends, p_to));
    added := added + 1;
  end loop;
  perform app.record_audit_event(
    p_organization_id, 'integrations.busy_synced', 'external_busy_blocks', null, 'success',
    jsonb_build_object('source', p_source, 'blocks', added)
  );
  return added;
end;
$$;

create or replace function public.composio_connection_ready(p_organization_id uuid, p_toolkit text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  member uuid;
  label text;
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    false
  );
  member := app.my_staff_membership(p_organization_id);
  if member is null then
    raise exception 'connection denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.vo_settings s where s.organization_id = p_organization_id and s.composio_enabled) then
    raise exception 'the firm owner has not turned on connected accounts' using errcode = '42501';
  end if;
  if p_toolkit is null then
    return jsonb_build_object('membership_id', member);
  end if;
  select c.mail_label into label
  from public.staff_connections c
  where c.membership_id = member and c.organization_id = p_organization_id
    and c.toolkit = p_toolkit and c.status = 'active';
  if label is null then
    raise exception 'connect that account first' using errcode = '42501';
  end if;
  return jsonb_build_object('membership_id', member, 'mail_label', label);
end;
$$;
revoke all on function public.composio_connection_ready(uuid, text) from public, anon, service_role;
grant execute on function public.composio_connection_ready(uuid, text) to authenticated;
comment on function public.composio_connection_ready(uuid, text) is
  'The signed-in staff member may call Composio now: the firm''s connected-accounts switch is on and, when p_toolkit is named, their connection to it is active (returns its mail label). Checked before every Composio call.';
