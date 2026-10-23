-- Consultations: the outcome summary a client sees, reviewed by a consultant first (PRD CRM-04).
--
-- The Designer's Consultation record tab: staff notes stay staff-only (they live on the lead);
-- the outcome summary is written for the client after an attended consultation, marked "Needs
-- consultant review", and only a licensed consultant (or licensed owner) can Approve and share it.
-- The client then sees it in their portal, on the past consultation.
--
-- New:
--   * public.consultation_summaries: one per booking. `body` is the current text (staff only);
--     `shared_body` is the text last approved and shared, the only text a client can read. Editing
--     after sharing puts the summary back to needs_review; the client keeps seeing the shared text
--     until the new one is approved. Forced RLS: scheduling staff of the firm read it; nobody
--     writes it directly.
--   * public.save_consultation_summary(booking, body, expected_version): scheduling staff, an
--     attended (completed) consultation. Audited consultation_summary.saved.
--   * public.share_consultation_summary(booking, expected_version): a licensed consultant or
--     licensed owner. Audited consultation_summary.shared.
--   * public.portal_consultation_summaries(org): the signed-in client's own shared summaries
--     (booking id, shared text, when), nothing else.
-- A stale version is refused with PT409 (HTTP 409), like every other version conflict.

create table public.consultation_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  booking_id uuid not null,
  body text not null check (length(btrim(body)) between 3 and 4000),
  status text not null default 'needs_review' check (status in ('needs_review', 'shared')),
  written_by uuid not null,
  written_at timestamptz not null default statement_timestamp(),
  shared_body text,
  shared_by uuid,
  shared_at timestamptz,
  version integer not null default 1,
  is_sample boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  unique (booking_id),
  foreign key (booking_id, organization_id) references public.bookings (id, organization_id),
  check ((shared_body is null) = (shared_at is null))
);
comment on table public.consultation_summaries is
  'The client-facing outcome summary of one consultation. body is staff-only until a licensed reviewer shares it; shared_body is what the client sees.';
create index consultation_summaries_org_fk_idx on public.consultation_summaries (organization_id);
create index consultation_summaries_booking_org_fk_idx on public.consultation_summaries (booking_id, organization_id);

alter table public.consultation_summaries enable row level security;
alter table public.consultation_summaries force row level security;
create policy consultation_summaries_select on public.consultation_summaries
  for select to authenticated
  using (organization_id = (select app.current_organization_id()) and (select app.can_read_scheduling(organization_id)));
revoke all on public.consultation_summaries from anon;
grant select on public.consultation_summaries to authenticated;

create function public.save_consultation_summary(p_booking_id uuid, p_body text, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  summary public.consultation_summaries%rowtype;
  text_in text := btrim(coalesce(p_body, ''));
  next_version integer;
begin
  select * into booking from public.bookings where id = p_booking_id;
  if booking.id is null then
    raise exception 'booking denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(booking.organization_id, app.scheduling_staff_roles(), false);
  if booking.organization_id is distinct from app.current_organization_id() then
    raise exception 'booking denied' using errcode = '42501';
  end if;
  if booking.status is distinct from 'completed' then
    raise exception 'mark the consultation attended before writing its summary' using errcode = '22023';
  end if;
  if length(text_in) not between 3 and 4000 then
    raise exception 'write the summary (3 to 4000 characters)' using errcode = '22023';
  end if;

  select * into summary from public.consultation_summaries where booking_id = booking.id for update;
  if summary.id is null then
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception 'consultation summary changed by someone else' using errcode = 'PT409';
    end if;
    insert into public.consultation_summaries (organization_id, booking_id, body, written_by, is_sample)
    values (booking.organization_id, booking.id, text_in, (select auth.uid()), booking.is_sample)
    returning version into next_version;
  else
    if summary.version is distinct from p_expected_version then
      raise exception 'consultation summary changed by someone else' using errcode = 'PT409';
    end if;
    update public.consultation_summaries
    set body = text_in,
        status = 'needs_review',
        written_by = (select auth.uid()),
        written_at = statement_timestamp(),
        version = summary.version + 1
    where id = summary.id
    returning version into next_version;
  end if;
  perform app.record_audit_event(
    booking.organization_id, 'consultation_summary.saved', 'public.bookings', booking.id, 'success',
    jsonb_build_object('version', next_version)
  );
  return next_version;
end;
$$;
comment on function public.save_consultation_summary(uuid, text, integer) is
  'Writes or edits an attended consultation''s outcome summary (scheduling staff). It then needs a licensed reviewer before the client sees it.';
revoke all on function public.save_consultation_summary(uuid, text, integer) from public, anon;
grant execute on function public.save_consultation_summary(uuid, text, integer) to authenticated, service_role;

create function public.share_consultation_summary(p_booking_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  summary public.consultation_summaries%rowtype;
begin
  select * into summary from public.consultation_summaries where booking_id = p_booking_id for update;
  if summary.id is null then
    raise exception 'write the summary before sharing it' using errcode = '22023';
  end if;
  perform app.require_licensed_staff(summary.organization_id, false);
  if summary.organization_id is distinct from app.current_organization_id() then
    raise exception 'booking denied' using errcode = '42501';
  end if;
  if summary.version is distinct from p_expected_version then
    raise exception 'consultation summary changed by someone else' using errcode = 'PT409';
  end if;
  if summary.status = 'shared' then
    return summary.version;
  end if;
  update public.consultation_summaries
  set status = 'shared',
      shared_body = summary.body,
      shared_by = (select auth.uid()),
      shared_at = statement_timestamp(),
      version = summary.version + 1
  where id = summary.id;
  perform app.record_audit_event(
    summary.organization_id, 'consultation_summary.shared', 'public.bookings', summary.booking_id, 'success',
    jsonb_build_object('version', summary.version + 1)
  );
  return summary.version + 1;
end;
$$;
comment on function public.share_consultation_summary(uuid, integer) is
  'A licensed consultant or licensed owner approves the outcome summary and shares it with the client (CRM-04).';
revoke all on function public.share_consultation_summary(uuid, integer) from public, anon;
grant execute on function public.share_consultation_summary(uuid, integer) to authenticated, service_role;

create function public.portal_consultation_summaries(p_org uuid)
returns table (booking_id uuid, summary text, shared_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.booking_id, s.shared_body, s.shared_at
  from public.consultation_summaries s
  join public.bookings b on b.id = s.booking_id and b.organization_id = s.organization_id
  where s.organization_id = p_org
    and s.shared_body is not null
    and app.booking_person_is_me(b.person_id);
$$;
comment on function public.portal_consultation_summaries(uuid) is
  'The signed-in client''s own shared consultation summaries: never a draft, never another person''s.';
revoke all on function public.portal_consultation_summaries(uuid) from public, anon;
grant execute on function public.portal_consultation_summaries(uuid) to authenticated, service_role;
