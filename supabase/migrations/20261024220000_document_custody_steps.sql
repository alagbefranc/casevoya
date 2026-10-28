-- DOC-07 (#178): an original's custody as steps: received, moved, returned, acknowledged. Each step
-- is a new public.document_custody_events row (the table stays append only), now with its kind.
--
-- Changed table:
--   public.document_custody_events   + kind ('received' | 'moved' | 'returned' | 'acknowledged').
--                                    Rows from public.record_document_custody keep a null kind.
-- New function:
--   public.record_custody_step(uuid, text, date, text, text, text)
--       owner, licensed consultant or case manager who can read the document (aal2):
--         received      the date, where it is kept and why the firm holds it;
--         moved         where it is now (only while the firm holds it);
--         returned      who it went back to and when (once; then it is no longer held);
--         acknowledged  the recipient's acknowledgement of the return.
--       Audited as document.custody_<kind>.

alter table public.document_custody_events
  add column kind text check (kind is null or kind in ('received', 'moved', 'returned', 'acknowledged'));
comment on column public.document_custody_events.kind is
  'DOC-07: which custody step this row records. Null for rows recorded before steps existed.';

create index document_custody_events_version_time_idx on public.document_custody_events (version_id, created_at);

create function public.record_custody_step(
  p_version_id uuid,
  p_kind text,
  p_on date,
  p_location text,
  p_purpose text,
  p_recipient text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  received public.document_custody_events%rowtype;
  returned boolean;
  location text := nullif(btrim(p_location), '');
  purpose text := nullif(btrim(p_purpose), '');
  recipient text := nullif(btrim(p_recipient), '');
  new_id uuid;
begin
  select * into version from public.document_versions where id = p_version_id;
  if version.id is null or app.can_read_document_version(version.id) is distinct from true then
    raise exception 'document custody denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    version.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if p_kind is null or p_kind not in ('received', 'moved', 'returned', 'acknowledged') then
    raise exception 'choose a custody step' using errcode = '22023';
  end if;
  select * into received
  from public.document_custody_events event
  where event.version_id = version.id and (event.kind = 'received' or event.kind is null)
  order by event.created_at desc
  limit 1;
  select exists (
    select 1 from public.document_custody_events event
    where event.version_id = version.id and event.kind = 'returned' and event.created_at >= coalesce(received.created_at, '-infinity'::timestamptz)
  ) into returned;

  if p_kind = 'received' then
    if received.id is not null and not returned then
      raise exception 'the firm already holds this original' using errcode = '22023';
    end if;
    if p_on is null or location is null or purpose is null or length(purpose) not between 3 and 300 or length(location) > 200 then
      raise exception 'say when it arrived, where it is kept and why the firm holds it' using errcode = '22023';
    end if;
    if p_on > app.firm_today(version.organization_id) then
      raise exception 'the received date is in the future' using errcode = '22023';
    end if;
  else
    if received.id is null then
      raise exception 'record the original as received first' using errcode = '22023';
    end if;
    if p_kind = 'moved' then
      if returned then
        raise exception 'that original was returned' using errcode = '22023';
      end if;
      if location is null or length(location) > 200 then
        raise exception 'say where it is now' using errcode = '22023';
      end if;
      purpose := coalesce(purpose, received.purpose);
    elsif p_kind = 'returned' then
      if returned then
        raise exception 'that original was returned' using errcode = '22023';
      end if;
      if recipient is null or length(recipient) > 200 or p_on is null then
        raise exception 'say who it went back to and when' using errcode = '22023';
      end if;
      purpose := coalesce(purpose, received.purpose);
    else
      if not returned then
        raise exception 'record the return first' using errcode = '22023';
      end if;
      if exists (
        select 1 from public.document_custody_events event
        where event.version_id = version.id and event.kind = 'acknowledged' and event.created_at >= received.created_at
      ) then
        raise exception 'the return was already acknowledged' using errcode = '22023';
      end if;
      purpose := coalesce(purpose, received.purpose);
    end if;
  end if;

  insert into public.document_custody_events (
    organization_id, version_id, kind, received_on, location, purpose, recipient, return_on, acknowledged_at, created_by
  ) values (
    version.organization_id,
    version.id,
    p_kind,
    case when p_kind = 'received' then p_on end,
    case when p_kind in ('received', 'moved') then location end,
    purpose,
    case when p_kind in ('returned', 'acknowledged') then recipient end,
    case when p_kind = 'returned' then p_on end,
    case when p_kind = 'acknowledged' then statement_timestamp() end,
    (select auth.uid())
  )
  returning id into new_id;
  perform app.record_audit_event(
    version.organization_id, 'document.custody_' || p_kind, 'document_custody_events', new_id, 'success',
    jsonb_build_object('version_id', version.id)
  );
  return new_id;
end;
$$;
revoke all on function public.record_custody_step(uuid, text, date, text, text, text) from public;
grant execute on function public.record_custody_step(uuid, text, date, text, text, text) to authenticated;
