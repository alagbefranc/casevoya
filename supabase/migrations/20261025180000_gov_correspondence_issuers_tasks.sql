-- GOV-04 government correspondence: issuer and letter date in the Record letter dialog, several
-- tasks from one letter (staff or client), a filed triage email as the letter's evidence, and the
-- firm's issuer list built from official Government of Canada pages.
--
-- Added:
--   public.government_issuers: the firm's list of letter issuers (for example a department, an
--     agency, a tribunal or a named visa office). Each row is typed by staff from an official page
--     and stores that page's URL (an allowlisted Government of Canada host, with its section
--     anchor), the date staff checked it and, when the server could read the page, the retrieval
--     time, the page's SHA-256, its "Date modified" and whether the name appears on it. A row is
--     pending until a licensed member of the firm (step-up) approves it; only approved rows are
--     offered in the dialog. Nothing is seeded: no issuer name is invented or recalled.
--   public.government_correspondence.issuer_id: the approved issuer the letter names, so its
--     source shows next to the issuer on the record. The issuer text is still stored as typed.
--   public.propose_government_issuer, public.review_government_issuer.
--   public.record_government_letter(...): records the letter through
--     app.record_government_correspondence (unchanged) and, in the same transaction, pins the
--     issuer and creates the letter's tasks through app.create_task (unchanged), each linked to
--     the letter in public.correspondence_work_links (unchanged). A task is the firm's (an active
--     staff owner) or the client's (a person on the matter: the existing client-task path, so it
--     shows in their portal).
-- Redefined (latest definition copied, only the noted change):
--   app.gov_correspondence_immutable (latest: 20261020130000_work_pages_fixes.sql): issuer_id is
--     also immutable, except that it may be set once, from empty, to the approved issuer whose
--     name is the letter's issuer text (what app.record_government_letter does).
-- Forced RLS on the new table; writes only through the SECURITY DEFINER functions here. Dates are
-- the firm's (app.firm_today). Additive only.

-- ---------------------------------------------------------------------------
-- The firm's issuer list
-- ---------------------------------------------------------------------------

create table public.government_issuers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null check (length(btrim(name)) between 2 and 200),
  source_url text not null check (length(source_url) between 12 and 500),
  checked_on date not null,
  retrieved_at timestamptz,
  snapshot_sha256 text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  page_modified_on date,
  name_on_page boolean,
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'retired')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(btrim(review_note)) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check ((retrieved_at is null) = (snapshot_sha256 is null)),
  check (status = 'pending_review' or (reviewed_by is not null and reviewed_at is not null))
);
comment on table public.government_issuers is
  'Who sends the firm''s government letters, typed by staff from an official Government of Canada page with its URL and the date checked (plus the server''s retrieval time and page SHA-256 when it could read the page). Pending until a licensed member approves it. Never seeded.';
comment on column public.government_issuers.checked_on is
  'The date staff checked the official page, in the firm''s timezone. Not in the future.';
comment on column public.government_issuers.page_modified_on is
  'The "Date modified" the page printed when the server read it. Null when it printed none or could not be read.';
comment on column public.government_issuers.name_on_page is
  'Whether the name appeared in the page''s text when the server read it. Null when the page could not be read.';

create unique index government_issuers_live_name_uidx
  on public.government_issuers (organization_id, lower(btrim(name)))
  where status in ('pending_review', 'approved');
create index government_issuers_org_status_idx on public.government_issuers (organization_id, status);
create index government_issuers_reviewed_by_idx on public.government_issuers (reviewed_by);
create index government_issuers_created_by_idx on public.government_issuers (created_by);

create trigger government_issuers_touch before update on public.government_issuers
  for each row execute function app.touch_row();
create trigger government_issuers_keys before update on public.government_issuers
  for each row execute function app.guard_tenant_keys();
create trigger government_issuers_stamp before insert on public.government_issuers
  for each row execute function app.stamp_created_by();
create trigger government_issuers_no_delete before delete on public.government_issuers
  for each row execute function app.reject_governed_delete();
create trigger government_issuers_audit after insert or update on public.government_issuers
  for each row execute function app.audit_row_change();

-- The letter names the approved issuer it came from.
alter table public.government_correspondence
  add column issuer_id uuid,
  add constraint government_correspondence_issuer_fk
    foreign key (issuer_id, organization_id) references public.government_issuers (id, organization_id);
comment on column public.government_correspondence.issuer_id is
  'The approved issuer (public.government_issuers) the letter names, set when it was recorded. Null when staff typed the issuer.';
create index government_correspondence_issuer_org_fk_idx on public.government_correspondence (issuer_id, organization_id);

-- app.gov_correspondence_immutable: latest definition from 20261020130000_work_pages_fixes.sql.
-- Only change: issuer_id may be set once, from empty, to the approved issuer whose name is the
-- letter's issuer; any other change to it is refused like the other received facts.
create or replace function app.gov_correspondence_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.kind, new.issuer, new.channel, new.document_date, new.received_on, new.action_requested,
      new.stated_deadline, new.reference_text, new.corrects_id)
     is distinct from
     (old.kind, old.issuer, old.channel, old.document_date, old.received_on, old.action_requested,
      old.stated_deadline, old.reference_text, old.corrects_id)
     or (
       (new.evidence_version_id, new.evidence_locator) is distinct from (old.evidence_version_id, old.evidence_locator)
       and not (old.evidence_version_id is null and old.evidence_locator is null and old.verified_at is null)
     )
     or (
       new.issuer_id is distinct from old.issuer_id
       and not (
         old.issuer_id is null
         and exists (
           select 1 from public.government_issuers issuer
           where issuer.id = new.issuer_id
             and issuer.organization_id = new.organization_id
             and issuer.status = 'approved'
             and issuer.name = new.issuer
         )
       )
     ) then
    raise exception 'a recorded letter is not overwritten; record a correction' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Issuer list: propose (staff) and review (licensed member, step-up)
-- ---------------------------------------------------------------------------

-- Staff add an issuer from an official page. p_retrieved_at, p_sha256, p_modified_on and
-- p_name_on_page come from the server's own read of the page; all null when it couldn't read it.
create function app.propose_government_issuer(
  p_org uuid,
  p_name text,
  p_source_url text,
  p_checked_on date,
  p_retrieved_at timestamptz,
  p_sha256 text,
  p_modified_on date,
  p_name_on_page boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  url text := btrim(coalesce(p_source_url, ''));
  hash text := nullif(lower(btrim(coalesce(p_sha256, ''))), '');
  new_id uuid;
begin
  perform app.require_active_staff(p_org, app.gov_staff_roles(), false);
  if length(v_name) not between 2 and 200 then
    raise exception 'name the issuer as the official page writes it' using errcode = '22023';
  end if;
  if length(url) not between 12 and 500 or app.host_is_allowlisted(app.official_url_host(url)) is distinct from true then
    raise exception 'the issuer must come from an official Government of Canada page' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > app.firm_today(p_org) or p_checked_on < app.firm_today(p_org) - 365 then
    raise exception 'the date checked is required, within the last year and not in the future' using errcode = '22023';
  end if;
  if (hash is null) <> (p_retrieved_at is null) then
    raise exception 'a page read needs both its time and its hash' using errcode = '22023';
  end if;
  if hash is not null and hash !~ '^[0-9a-f]{64}$' then
    raise exception 'the page hash is invalid' using errcode = '22023';
  end if;
  if p_retrieved_at is not null
     and (p_retrieved_at > statement_timestamp() + interval '5 minutes' or p_retrieved_at < statement_timestamp() - interval '1 day') then
    raise exception 'the retrieval time must be now' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.government_issuers issuer
    where issuer.organization_id = p_org
      and lower(btrim(issuer.name)) = lower(v_name)
      and issuer.status in ('pending_review', 'approved')
  ) then
    raise exception 'this issuer is already on the list' using errcode = '23505';
  end if;
  insert into public.government_issuers (
    organization_id, name, source_url, checked_on, retrieved_at, snapshot_sha256, page_modified_on, name_on_page
  ) values (
    p_org, v_name, url, p_checked_on, case when hash is null then null else p_retrieved_at end, hash,
    case when hash is null then null else p_modified_on end,
    case when hash is null then null else p_name_on_page end
  )
  returning id into new_id;
  perform app.record_audit_event(
    p_org, 'government.issuer_proposed', 'public.government_issuers', new_id, 'success',
    jsonb_build_object('source_url', url, 'page_read', hash is not null)
  );
  return new_id;
end;
$$;
revoke all on function app.propose_government_issuer(uuid, text, text, date, timestamptz, text, date, boolean) from public, anon;
grant execute on function app.propose_government_issuer(uuid, text, text, date, timestamptz, text, date, boolean) to authenticated, service_role;

-- A licensed member (fresh step-up) approves or rejects a pending issuer, or retires an approved
-- one that is no longer current. Rejecting and retiring need a note.
create function app.review_government_issuer(p_issuer_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  issuer public.government_issuers%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  new_version integer;
begin
  select * into issuer from public.government_issuers where id = p_issuer_id for update;
  if issuer.id is null or issuer.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'issuer review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(issuer.organization_id, true);
  if p_decision not in ('approved', 'rejected', 'retired') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if issuer.version is distinct from p_expected_version then
    raise exception 'issuer version conflict' using errcode = 'PT409';
  end if;
  if p_decision in ('approved', 'rejected') and issuer.status <> 'pending_review' then
    raise exception 'this issuer is not waiting for review' using errcode = '22023';
  end if;
  if p_decision = 'retired' and issuer.status <> 'approved' then
    raise exception 'only an approved issuer is retired' using errcode = '22023';
  end if;
  if p_decision in ('rejected', 'retired') and (v_note is null or length(v_note) < 3) then
    raise exception 'say why' using errcode = '22023';
  end if;
  update public.government_issuers
  set status = p_decision, reviewed_by = (select auth.uid()), reviewed_at = clock_timestamp(), review_note = left(v_note, 500)
  where id = issuer.id
  returning version into new_version;
  perform app.record_audit_event(
    issuer.organization_id, 'government.issuer_' || p_decision, 'public.government_issuers', issuer.id, 'success',
    jsonb_build_object('source_url', issuer.source_url)
  );
  return new_version;
end;
$$;
revoke all on function app.review_government_issuer(uuid, integer, text, text) from public, anon;
grant execute on function app.review_government_issuer(uuid, integer, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Record a letter with its issuer and its tasks
-- ---------------------------------------------------------------------------

-- p_tasks: [{title, owner: 'staff' | 'client', owner_id, due_on}], at most 10. owner_id is a
-- membership (staff) or a person on the matter (client). Each task is created by app.create_task,
-- which checks the owner, and linked to the letter.
create function app.record_government_letter(
  p_matter_id uuid,
  p_kind public.correspondence_kind,
  p_issuer_id uuid,
  p_issuer text,
  p_channel public.correspondence_channel,
  p_document_date date,
  p_received_on date,
  p_action_requested text,
  p_stated_deadline text,
  p_evidence_version_id uuid,
  p_tasks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.government_issuers%rowtype;
  v_letter public.government_correspondence%rowtype;
  v_letter_id uuid;
  v_issuer text := nullif(btrim(coalesce(p_issuer, '')), '');
  item jsonb;
  v_title text;
  v_owner text;
  v_owner_id uuid;
  v_due date;
  v_zone text;
  task_id uuid;
  made integer := 0;
begin
  if p_tasks is null then
    p_tasks := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) > 10 then
    raise exception 'a letter creates at most 10 tasks' using errcode = '22023';
  end if;
  if p_issuer_id is not null then
    select * into v_src from public.government_issuers where id = p_issuer_id;
    if v_src.id is null or v_src.status <> 'approved' then
      raise exception 'that issuer is not on the firm''s approved list' using errcode = '22023';
    end if;
    v_issuer := v_src.name;
  end if;
  if v_issuer is null then
    raise exception 'name who sent the letter' using errcode = '22023';
  end if;

  -- The letter itself: every check (matter access, staff role, sample mode, dates, evidence) is app.record_government_correspondence's.
  v_letter_id := app.record_government_correspondence(
    p_matter_id, p_kind, v_issuer, p_channel, p_document_date, p_received_on, p_action_requested,
    p_stated_deadline, null, p_evidence_version_id, null, null
  );
  select * into v_letter from public.government_correspondence where id = v_letter_id;

  if v_src.id is not null then
    if v_src.organization_id is distinct from v_letter.organization_id then
      raise exception 'that issuer is not on the firm''s approved list' using errcode = '22023';
    end if;
    perform app.gov_open_write(v_letter.id);
    update public.government_correspondence set issuer_id = v_src.id where id = v_letter.id;
    perform app.gov_close_write(v_letter.id);
  end if;

  begin
    v_zone := app.usable_timezone(coalesce((select org.timezone from public.organizations org where org.id = v_letter.organization_id), 'America/Toronto'));
  exception when others then
    v_zone := 'America/Toronto';
  end;

  for item in select value from jsonb_array_elements(p_tasks) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'each task needs a description, an owner and a due date' using errcode = '22023';
    end if;
    v_title := btrim(coalesce(item ->> 'title', ''));
    v_owner := item ->> 'owner';
    if length(v_title) not between 1 and 200 then
      raise exception 'each task needs a description of up to 200 characters' using errcode = '22023';
    end if;
    if v_owner is null or v_owner not in ('staff', 'client') or coalesce(item ->> 'owner_id', '') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'each task needs an owner' using errcode = '22023';
    end if;
    v_owner_id := (item ->> 'owner_id')::uuid;
    if coalesce(item ->> 'due_on', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'each task needs a due date' using errcode = '22023';
    end if;
    v_due := (item ->> 'due_on')::date;
    if v_due < app.firm_today(v_letter.organization_id) then
      raise exception 'a task''s due date cannot be in the past' using errcode = '22023';
    end if;
    task_id := app.create_task(
      v_letter.matter_id,
      case when v_owner = 'client' then 'client' else 'internal' end::public.task_audience,
      v_title,
      case when v_owner = 'staff' then v_owner_id else null end,
      case when v_owner = 'client' then v_owner_id else null end,
      'normal',
      v_due,
      null,
      v_zone,
      null,
      null,
      '[]'::jsonb
    );
    insert into public.correspondence_work_links (organization_id, correspondence_id, task_id)
    values (v_letter.organization_id, v_letter.id, task_id);
    made := made + 1;
  end loop;

  if made > 0 or v_src.id is not null then
    perform app.record_audit_event(
      v_letter.organization_id, 'government.letter_tasks_created', 'public.government_correspondence', v_letter.id, 'success',
      jsonb_build_object('matter_id', v_letter.matter_id, 'tasks', made, 'issuer_id', v_src.id)
    );
  end if;
  return v_letter.id;
end;
$$;
revoke all on function app.record_government_letter(uuid, public.correspondence_kind, uuid, text, public.correspondence_channel, date, date, text, text, uuid, jsonb) from public, anon;
grant execute on function app.record_government_letter(uuid, public.correspondence_kind, uuid, text, public.correspondence_channel, date, date, text, text, uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public wrappers (security invoker: the app functions decide)
-- ---------------------------------------------------------------------------

create function public.propose_government_issuer(
  p_org uuid, p_name text, p_source_url text, p_checked_on date, p_retrieved_at timestamptz,
  p_sha256 text, p_modified_on date, p_name_on_page boolean
)
returns uuid language sql security invoker set search_path = ''
as $$ select app.propose_government_issuer(p_org, p_name, p_source_url, p_checked_on, p_retrieved_at, p_sha256, p_modified_on, p_name_on_page); $$;
revoke all on function public.propose_government_issuer(uuid, text, text, date, timestamptz, text, date, boolean) from public, anon;
grant execute on function public.propose_government_issuer(uuid, text, text, date, timestamptz, text, date, boolean) to authenticated, service_role;

create function public.review_government_issuer(p_issuer_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_government_issuer(p_issuer_id, p_expected_version, p_decision, p_note); $$;
revoke all on function public.review_government_issuer(uuid, integer, text, text) from public, anon;
grant execute on function public.review_government_issuer(uuid, integer, text, text) to authenticated, service_role;

create function public.record_government_letter(
  p_matter_id uuid, p_kind public.correspondence_kind, p_issuer_id uuid, p_issuer text,
  p_channel public.correspondence_channel, p_document_date date, p_received_on date,
  p_action_requested text, p_stated_deadline text, p_evidence_version_id uuid, p_tasks jsonb
)
returns uuid language sql security invoker set search_path = ''
as $$
  select app.record_government_letter(
    p_matter_id, p_kind, p_issuer_id, p_issuer, p_channel, p_document_date, p_received_on,
    p_action_requested, p_stated_deadline, p_evidence_version_id, p_tasks
  );
$$;
revoke all on function public.record_government_letter(uuid, public.correspondence_kind, uuid, text, public.correspondence_channel, date, date, text, text, uuid, jsonb) from public, anon;
grant execute on function public.record_government_letter(uuid, public.correspondence_kind, uuid, text, public.correspondence_channel, date, date, text, text, uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.government_issuers from public, anon, authenticated, service_role;
grant select on table public.government_issuers to authenticated, service_role;
alter table public.government_issuers enable row level security;
alter table public.government_issuers force row level security;

-- Firm staff (MFA satisfied) read their firm's list. Clients never do.
create policy government_issuers_select on public.government_issuers
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(organization_id, app.gov_staff_roles()))
  );
