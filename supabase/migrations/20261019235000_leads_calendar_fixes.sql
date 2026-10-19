-- Leads and scheduling fixes from the production audit (branch fix-leads-calendar). Additive only:
-- three new functions and one new trigger. No existing function is redefined.
--
--   public.set_lead_source             Edit lead can change where a staff-recorded lead came from.
--                                      Website, hosted page, booking page and CSV leads keep the
--                                      source they arrived with (the system recorded it).
--   public.archive_booking_event_type  The firm owner (with a recent step-up, like saving a type)
--                                      archives a booking type: it is unpublished and leaves the
--                                      lists. Booking types are never deleted (governed delete);
--                                      bookings already made keep their type.
--   app.lead_retreat_for_booking       After a lead's booking is cancelled or its hold expires, a
--   (trigger bookings_lead_retreat)    lead still at "Consultation scheduled" with no other live or
--                                      past booking moves back to the stage it was in before the
--                                      booking moved it forward (or to Contacted), with a history
--                                      line "Consultation cancelled". Only that one forward move
--                                      made by app.lead_advance_for_booking is undone; a lead a
--                                      person moved elsewhere is left alone.

-- ---------------------------------------------------------------------------
-- Lead source (Edit lead)
-- ---------------------------------------------------------------------------

create function public.set_lead_source(p_org uuid, p_lead uuid, p_expected_version integer, p_source public.lead_source)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead public.leads;
  v_version integer;
begin
  lead := app.lead_for_update(p_org, p_lead, p_expected_version);
  if lead.converted_at is not null then
    raise exception 'a converted lead is kept as it was; edit the client on the matter' using errcode = '22023';
  end if;
  if p_source is null or p_source in ('web_form', 'hosted_page', 'booking_page', 'csv_import') then
    raise exception 'choose where this lead came from' using errcode = '22023';
  end if;
  if lead.source in ('web_form', 'hosted_page', 'booking_page', 'csv_import') then
    raise exception 'this lead''s source was recorded when it came in' using errcode = '22023';
  end if;
  if lead.source = p_source then
    return lead.version;
  end if;
  update public.leads set source = p_source where id = lead.id returning version into v_version;
  perform app.lead_event(p_org, lead.id, 'updated', null, null, null,
    jsonb_build_object('source_from', lead.source, 'source_to', p_source));
  perform app.record_audit_event(p_org, 'lead.source_changed', 'public.leads', lead.id, 'success',
    jsonb_build_object('from', lead.source, 'to', p_source));
  return v_version;
end;
$$;

revoke all on function public.set_lead_source(uuid, uuid, integer, public.lead_source) from public, anon;
grant execute on function public.set_lead_source(uuid, uuid, integer, public.lead_source) to authenticated;

-- ---------------------------------------------------------------------------
-- Archive a booking type
-- ---------------------------------------------------------------------------

create function public.archive_booking_event_type(p_org uuid, p_event_type_id uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  et public.booking_event_types%rowtype;
  upcoming integer;
begin
  perform app.require_firm_owner_step_up(p_org);
  select * into et from public.booking_event_types where id = p_event_type_id and organization_id = p_org for update;
  if et.id is null then
    raise exception 'booking type not found' using errcode = 'P0002';
  end if;
  if p_expected_version is not null and et.version <> p_expected_version then
    raise exception 'this booking type was changed by someone else; reload' using errcode = '40001';
  end if;
  if et.archived_at is not null then
    raise exception 'this booking type is already archived' using errcode = '22023';
  end if;
  select count(*) into upcoming from public.bookings b
  where b.event_type_id = et.id and b.status in ('held', 'pending_payment', 'confirmed') and b.starts_at > now();
  update public.booking_event_types set is_published = false, archived_at = now() where id = et.id;
  perform app.record_audit_event(p_org, 'booking_type.archived', 'public.booking_event_types', et.id, 'success',
    jsonb_build_object('was_published', et.is_published, 'upcoming_bookings', upcoming));
end;
$$;

revoke all on function public.archive_booking_event_type(uuid, uuid, integer) from public, anon;
grant execute on function public.archive_booking_event_type(uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- A cancelled consultation moves its lead back
-- ---------------------------------------------------------------------------

create function app.lead_retreat_for_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  link record;
  lead public.leads%rowtype;
  v_current public.lead_stages%rowtype;
  v_target public.lead_stages%rowtype;
  v_previous uuid;
begin
  if new.status not in ('cancelled', 'expired') or old.status not in ('held', 'pending_payment', 'confirmed') then
    return null;
  end if;
  for link in select l.lead_id from public.lead_booking_links l where l.booking_id = new.id and l.organization_id = new.organization_id loop
    select * into lead from public.leads where id = link.lead_id and organization_id = new.organization_id for update;
    continue when lead.id is null or lead.converted_at is not null or lead.lost_at is not null;
    select * into v_current from public.lead_stages s where s.id = lead.stage_id;
    continue when v_current.kind <> 'open' or v_current.key <> 'consultation_scheduled';
    -- Another booking still holds the consultation (or already happened): the stage stays true.
    continue when exists (
      select 1
      from public.lead_booking_links other
      join public.bookings b on b.id = other.booking_id
      where other.lead_id = lead.id and b.id <> new.id
        and b.status in ('held', 'pending_payment', 'confirmed', 'completed', 'no_show')
    );
    -- The stage the lead was in before it reached Consultation scheduled.
    select e.from_stage_id into v_previous
    from public.lead_events e
    where e.lead_id = lead.id and e.kind = 'stage_changed' and e.to_stage_id = lead.stage_id
    order by e.created_at desc
    limit 1;
    v_target := null;
    if v_previous is not null then
      select * into v_target from public.lead_stages s
      where s.id = v_previous and s.organization_id = new.organization_id and s.kind = 'open'
        and s.archived_at is null and s.position < v_current.position;
    end if;
    if v_target.id is null then
      select * into v_target from public.lead_stages s
      where s.organization_id = new.organization_id and s.key = 'contacted' and s.kind = 'open'
        and s.archived_at is null and s.position < v_current.position;
    end if;
    if v_target.id is null then
      select * into v_target from public.lead_stages s
      where s.organization_id = new.organization_id and s.kind = 'open' and s.archived_at is null
        and s.position < v_current.position
      order by s.position desc, s.key
      limit 1;
    end if;
    continue when v_target.id is null;
    update public.leads set stage_id = v_target.id where id = lead.id;
    perform app.lead_event(new.organization_id, lead.id, 'stage_changed', v_current.id, v_target.id,
      case when new.status = 'expired' then 'Consultation hold expired' else 'Consultation cancelled' end,
      jsonb_build_object('booking_id', new.id));
  end loop;
  return null;
end;
$$;
revoke all on function app.lead_retreat_for_booking() from public;

create trigger bookings_lead_retreat after update of status on public.bookings
  for each row execute function app.lead_retreat_for_booking();
