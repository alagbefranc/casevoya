-- GOV-05 government status provenance (PRD §14 GOV-05, RULES §§1-7).
--
-- 1. Mark checked, per status. public.government_status_checks (append-only, audited) gains an
--    optional correspondence_id: a check of one recorded status (a verified or received letter)
--    rather than of the whole matter. app.mark_government_checked records it. A check with no
--    status is the existing "Checked, no change" for the matter. Nothing here changes a status:
--    a check is "a staff member looked at the official channel", never a government update.
-- 2. IRCC processing-time estimates (staff entry, licensed review). This machine cannot reach
--    canada.ca, so no estimate is seeded or captured here. Staff enter what IRCC's processing-times
--    page shows: the official URL (an allowlisted canada.ca host), the application type as IRCC
--    names it, the estimate as written, and the date they checked it. The server records the page's
--    SHA-256 and retrieval time when it can fetch the page; otherwise both stay null (shown as "page
--    not captured"). An estimate is pending until a licensed member (recent step-up, no licence
--    block) approves it; only an approved estimate is shown next to a status, labelled as IRCC's
--    estimate, "not a maximum or a guarantee". Approving supersedes the matter's earlier estimate.
--    Staff only: clients do not see estimates.
--
-- Sharing a letter with the client reuses app.share_government_record (unchanged).
-- No existing function is redefined. Forced RLS on the new table; writes only through the
-- SECURITY DEFINER functions here. Dates are the firm's (app.firm_today). Additive only.

-- ---------------------------------------------------------------------------
-- 1. Per-status checks
-- ---------------------------------------------------------------------------
alter table public.government_status_checks add column correspondence_id uuid;
alter table public.government_status_checks
  add constraint government_status_checks_correspondence_fk
  foreign key (correspondence_id, organization_id) references public.government_correspondence (id, organization_id);
comment on column public.government_status_checks.correspondence_id is
  'The recorded status (letter) this check was about; null for a check of the whole matter (GOV-05 Mark checked).';
create index government_status_checks_corr_org_fk_idx
  on public.government_status_checks (correspondence_id, organization_id);
create index government_status_checks_corr_checked_idx
  on public.government_status_checks (correspondence_id, checked_at desc)
  where correspondence_id is not null;

create function app.mark_government_checked(p_matter_id uuid, p_correspondence_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_id uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'status check denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(matter.organization_id, app.gov_staff_roles(), false);
  if p_correspondence_id is not null and not exists (
    select 1 from public.government_correspondence letter
    where letter.id = p_correspondence_id and letter.matter_id = matter.id
  ) then
    raise exception 'that status is not on this matter' using errcode = '42501';
  end if;
  insert into public.government_status_checks (organization_id, matter_id, note, checked_by_membership_id, correspondence_id)
  values (
    matter.organization_id,
    matter.id,
    case when p_correspondence_id is null
      then 'Checked the official channel. No change.'
      else 'Checked this status on the official channel. No change.'
    end,
    app.gov_actor_membership(matter.organization_id),
    p_correspondence_id
  )
  returning id into new_id;
  perform app.record_audit_event(
    matter.organization_id, 'government.status_checked', 'public.government_status_checks', new_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'correspondence_id', p_correspondence_id)
  );
  return new_id;
end;
$$;
revoke all on function app.mark_government_checked(uuid, uuid) from public;
grant execute on function app.mark_government_checked(uuid, uuid) to authenticated, service_role;

create function public.mark_government_checked(p_matter_id uuid, p_correspondence_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select app.mark_government_checked(p_matter_id, p_correspondence_id); $$;
revoke all on function public.mark_government_checked(uuid, uuid) from public, anon;
grant execute on function public.mark_government_checked(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. IRCC processing-time estimates
-- ---------------------------------------------------------------------------
create table public.government_processing_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  source_url text not null check (length(source_url) between 12 and 500),
  application_type text not null check (length(btrim(application_type)) between 2 and 200),
  estimate_text text not null check (length(btrim(estimate_text)) between 1 and 120),
  checked_on date not null,
  page_retrieved_at timestamptz,
  snapshot_sha256 text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'superseded')),
  entered_by_membership_id uuid not null,
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(btrim(review_note)) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check ((page_retrieved_at is null) = (snapshot_sha256 is null)),
  check (status not in ('approved', 'rejected') or (reviewed_by_membership_id is not null and reviewed_at is not null)),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (entered_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (reviewed_by_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.government_processing_estimates is
  'IRCC''s processing-time estimate for a matter, as a staff member read it on IRCC''s official processing-times page (GOV-05): URL, application type as IRCC names it, the estimate as written, the date checked, and the page hash when the server could fetch it. Pending until a licensed member approves it; IRCC''s estimate, not a maximum or a guarantee. Never seeded. Staff only.';
comment on column public.government_processing_estimates.estimate_text is
  'Exactly as IRCC''s page shows it (for example a number of days or months). Not parsed or calculated.';
comment on column public.government_processing_estimates.snapshot_sha256 is
  'SHA-256 of the page bytes the server fetched when the estimate was entered; null when the page could not be fetched.';

create index government_processing_estimates_matter_idx
  on public.government_processing_estimates (matter_id, created_at desc);
create index government_processing_estimates_org_fk_idx on public.government_processing_estimates (organization_id);
create index government_processing_estimates_matter_org_fk_idx on public.government_processing_estimates (matter_id, organization_id);
create index government_processing_estimates_entered_org_fk_idx on public.government_processing_estimates (entered_by_membership_id, organization_id);
create index government_processing_estimates_reviewed_org_fk_idx on public.government_processing_estimates (reviewed_by_membership_id, organization_id);
create index government_processing_estimates_created_by_idx on public.government_processing_estimates (created_by);

-- The entered facts never change; only the review is added.
create function app.gov_estimate_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.matter_id, new.source_url, new.application_type, new.estimate_text, new.checked_on,
      new.page_retrieved_at, new.snapshot_sha256, new.entered_by_membership_id)
     is distinct from
     (old.matter_id, old.source_url, old.application_type, old.estimate_text, old.checked_on,
      old.page_retrieved_at, old.snapshot_sha256, old.entered_by_membership_id) then
    raise exception 'an entered estimate is not overwritten; enter a new one' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.gov_estimate_immutable() from public;

create trigger government_processing_estimates_touch before update on public.government_processing_estimates
  for each row execute function app.touch_row();
create trigger government_processing_estimates_keys before update on public.government_processing_estimates
  for each row execute function app.guard_tenant_keys();
create trigger government_processing_estimates_stamp before insert on public.government_processing_estimates
  for each row execute function app.stamp_created_by();
create trigger government_processing_estimates_url before insert or update on public.government_processing_estimates
  for each row execute function app.enforce_allowlisted_urls('source_url');
create trigger government_processing_estimates_guard before update or delete on public.government_processing_estimates
  for each row execute function app.gov_guard_update();
create trigger government_processing_estimates_immutable before update on public.government_processing_estimates
  for each row execute function app.gov_estimate_immutable();
create trigger government_processing_estimates_audit after insert or update or delete on public.government_processing_estimates
  for each row execute function app.audit_row_change();

-- Staff enter what IRCC's processing-times page shows. p_retrieved_at and p_sha256 are the server's
-- fetch of that page (both or neither).
create function app.record_processing_estimate(
  p_matter_id uuid,
  p_source_url text,
  p_application_type text,
  p_estimate text,
  p_checked_on date,
  p_retrieved_at timestamptz,
  p_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  url text := btrim(coalesce(p_source_url, ''));
  host text;
  hash text := nullif(lower(btrim(coalesce(p_sha256, ''))), '');
  new_id uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'estimate denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(matter.organization_id, app.gov_staff_roles(), false);
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  host := app.official_url_host(url);
  if host is null or app.host_is_allowlisted(host) is distinct from true
     or not (host = 'canada.ca' or right(host, 10) = '.canada.ca') then
    raise exception 'the estimate must come from IRCC''s official processing-times page on canada.ca' using errcode = '22023';
  end if;
  if p_application_type is null or length(btrim(p_application_type)) not between 2 and 200 then
    raise exception 'name the application type as IRCC''s page does' using errcode = '22023';
  end if;
  if p_estimate is null or length(btrim(p_estimate)) not between 1 and 120 then
    raise exception 'write the estimate exactly as IRCC''s page shows it' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > app.firm_today(matter.organization_id) then
    raise exception 'the date checked is required and cannot be in the future' using errcode = '22023';
  end if;
  if (p_retrieved_at is null) <> (hash is null) then
    raise exception 'the page capture needs both its time and its hash' using errcode = '22023';
  end if;
  if hash is not null and hash !~ '^[0-9a-f]{64}$' then
    raise exception 'the page hash is invalid' using errcode = '22023';
  end if;
  if p_retrieved_at is not null
     and (p_retrieved_at > statement_timestamp() + interval '5 minutes' or p_retrieved_at < statement_timestamp() - interval '1 day') then
    raise exception 'the page capture time must be now' using errcode = '22023';
  end if;
  insert into public.government_processing_estimates (
    organization_id, matter_id, source_url, application_type, estimate_text, checked_on,
    page_retrieved_at, snapshot_sha256, entered_by_membership_id
  ) values (
    matter.organization_id, matter.id, url, btrim(p_application_type), btrim(p_estimate), p_checked_on,
    p_retrieved_at, hash, app.gov_actor_membership(matter.organization_id)
  )
  returning id into new_id;
  perform app.record_audit_event(
    matter.organization_id, 'government.estimate_entered', 'public.government_processing_estimates', new_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'source_url', url, 'captured', hash is not null)
  );
  return new_id;
end;
$$;
revoke all on function app.record_processing_estimate(uuid, text, text, text, date, timestamptz, text) from public;
grant execute on function app.record_processing_estimate(uuid, text, text, text, date, timestamptz, text) to authenticated, service_role;

-- A licensed member (recent step-up, no licence block) approves or rejects a pending estimate.
create function app.review_processing_estimate(p_estimate_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  estimate public.government_processing_estimates%rowtype;
  earlier uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  new_version integer;
begin
  select * into estimate from public.government_processing_estimates where id = p_estimate_id for update;
  if estimate.id is null or app.can_read_matter(estimate.matter_id) is distinct from true then
    raise exception 'review denied' using errcode = '42501';
  end if;
  perform app.gov_require_licensed(estimate.organization_id);
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or length(v_note) < 3) then
    raise exception 'say why it''s rejected' using errcode = '22023';
  end if;
  if estimate.version is distinct from p_expected_version then
    raise exception 'estimate version conflict' using errcode = '40001';
  end if;
  if estimate.status <> 'pending_review' then
    raise exception 'this estimate is already reviewed' using errcode = '42501';
  end if;
  if p_decision = 'approved' then
    for earlier in
      select prior.id from public.government_processing_estimates prior
      where prior.matter_id = estimate.matter_id and prior.status = 'approved' and prior.id <> estimate.id
    loop
      perform app.gov_open_write(earlier);
      update public.government_processing_estimates set status = 'superseded' where id = earlier;
      perform app.gov_close_write(earlier);
    end loop;
  end if;
  perform app.gov_open_write(estimate.id);
  update public.government_processing_estimates
  set status = p_decision,
      reviewed_by_membership_id = app.gov_actor_membership(estimate.organization_id),
      reviewed_at = statement_timestamp(),
      review_note = left(v_note, 500)
  where id = estimate.id
  returning version into new_version;
  perform app.gov_close_write(estimate.id);
  perform app.record_audit_event(
    estimate.organization_id, 'government.estimate_' || p_decision, 'public.government_processing_estimates', estimate.id, 'success',
    jsonb_build_object('matter_id', estimate.matter_id)
  );
  return new_version;
end;
$$;
revoke all on function app.review_processing_estimate(uuid, integer, text, text) from public;
grant execute on function app.review_processing_estimate(uuid, integer, text, text) to authenticated, service_role;

create function public.record_processing_estimate(
  p_matter_id uuid, p_source_url text, p_application_type text, p_estimate text, p_checked_on date,
  p_retrieved_at timestamptz, p_sha256 text
)
returns uuid language sql security invoker set search_path = ''
as $$ select app.record_processing_estimate(p_matter_id, p_source_url, p_application_type, p_estimate, p_checked_on, p_retrieved_at, p_sha256); $$;

create function public.review_processing_estimate(p_estimate_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_processing_estimate(p_estimate_id, p_expected_version, p_decision, p_note); $$;

revoke all on function public.record_processing_estimate(uuid, text, text, text, date, timestamptz, text) from public, anon;
revoke all on function public.review_processing_estimate(uuid, integer, text, text) from public, anon;
grant execute on function public.record_processing_estimate(uuid, text, text, text, date, timestamptz, text) to authenticated, service_role;
grant execute on function public.review_processing_estimate(uuid, integer, text, text) to authenticated, service_role;

revoke all on table public.government_processing_estimates from public, anon, authenticated;
grant select on table public.government_processing_estimates to authenticated;
alter table public.government_processing_estimates enable row level security;
alter table public.government_processing_estimates force row level security;

create policy government_processing_estimates_select on public.government_processing_estimates
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.gov_staff_can_read(matter_id, organization_id))
  );
