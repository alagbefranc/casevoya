-- DEC-02 renewal follow-up on an approved matter (PRD §14 DEC-02; gap PR #182, Builder B).
--
-- 1. Official renewal timing (DEC-02 criterion 5, the renewal-timing part). public.renewal_timings
--    holds what a firm took from an official IRCC / Government of Canada page about when to act
--    before a document expires: the document or status as the page names it, the timing word for
--    word, and the number of days before expiry only when the page states one. Each row stores the
--    source URL with its section anchor, the form number and the form's "date modified" where one
--    applies, the date staff checked the page, the page's "current to" date when it states one, and
--    the source identity and snapshot in the existing source governance tables
--    (public.official_sources, public.source_snapshots), exactly as GOV-01's
--    public.submission_requirements does. The URL must be a federal official host (canada.ca or a
--    gc.ca host on public.official_source_domains). Rows are pending until a licensed member of the
--    firm approves them with a fresh step-up, and only with the page's snapshot hash. Nothing is
--    seeded: there is no default timing anywhere.
-- 2. Expiry reminders (DEC-02 criterion 4, T039). public.decision_renewals: staff record the expiry
--    date shown on the client's issued document (for example a permit or a PR card) from a
--    consultant-confirmed approval, optionally with the stored file it was read from. The reminder
--    is an internal task. Its date follows an approved official timing when one is chosen (expiry
--    minus the days the page states); otherwise staff choose it and it is stored and shown as the
--    firm's choice. No date is ever defaulted.
-- 3. Renewal reminder and successor lead (DEC-02 criterion 4). On a recorded expiry, staff set a
--    renewal reminder for the client only when the client's own contact choices allow it: the
--    matter's applicant uses the portal and chose "Remind me before a deadline"
--    (public.person_contact_preferences.deadline_reminders, with its consent record). When they
--    don't, the refusal says why (app.renewal_contact_state). Staff state the scope of the new
--    service. Setting it creates a Pipeline lead (public.create_lead, source "other", no consent
--    recorded on the lead) and never an invoice, a bill or a payment request. The client sees the
--    reminder in the portal only (public.portal_renewal_reminders); no email is sent (no approved
--    design).
-- 4. Renewal fee (DEC-02 criterion 6). A reminder may name a fee from the firm's approved IRCC fee
--    list (FIN-06 public.government_fee_references). The client sees the fee only while the same
--    fee (section, group and name) is in the currently approved snapshot, with its amount, source
--    URL, retrieval time and snapshot hash; otherwise nothing is shown.
--
-- No existing function is redefined. Reuses app.federal_official_url and app.matter_program_key
-- (20261025170000_gov_submission_checklist.sql), app.gov_* helpers (20261019202100), app.create_task,
-- app.set_task_status (20261025100000), public.create_lead (20261019201200). Forced RLS on both new
-- tables; writes only through the SECURITY DEFINER functions here. Dates are the firm's
-- (app.firm_today). Additive only.

-- ---------------------------------------------------------------------------
-- 1. Official renewal timing, reviewed before use
-- ---------------------------------------------------------------------------
create table public.renewal_timings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  program_key text check (program_key is null or program_key ~ '^[a-z0-9_]{1,80}$'),
  applies_to text not null check (length(btrim(applies_to)) between 2 and 200),
  timing_text text not null check (length(btrim(timing_text)) between 3 and 500),
  lead_days integer check (lead_days is null or lead_days between 1 and 1095),
  source_id uuid not null,
  snapshot_id uuid,
  source_url text not null check (length(source_url) between 12 and 500),
  source_section text check (source_section is null or length(btrim(source_section)) between 1 and 200),
  form_number text check (form_number is null or length(btrim(form_number)) between 2 and 40),
  form_modified_on date,
  checked_on date not null,
  current_to date,
  snapshot_sha256 text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'retired')),
  reviewed_by_membership_id uuid,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(btrim(review_note)) between 3 and 500),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (form_modified_on is null or form_number is not null),
  check ((snapshot_id is null) = (snapshot_sha256 is null)),
  check (status not in ('approved', 'rejected', 'retired') or (reviewed_by_membership_id is not null and reviewed_at is not null)),
  check (status <> 'approved' or snapshot_sha256 is not null),
  check ((status = 'retired') = (retired_at is not null)),
  foreign key (reviewed_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (source_id, organization_id) references public.official_sources (id, organization_id),
  foreign key (snapshot_id, organization_id) references public.source_snapshots (id, organization_id)
);
comment on table public.renewal_timings is
  'When to act before a document or status expires, as a firm read it on an official IRCC / Government of Canada page (DEC-02): the timing word for word, the days before expiry only when the page states them, source URL with anchor, form number and date modified, date checked, current-to date and snapshot hash. Pending until a licensed member approves it. Never seeded; no default timing exists.';
comment on column public.renewal_timings.lead_days is
  'Days before expiry, only when the official page states a number of days. Null: the page gives no number, so the firm chooses the reminder date.';

create index renewal_timings_org_status_idx on public.renewal_timings (organization_id, status);
create index renewal_timings_reviewer_org_fk_idx on public.renewal_timings (reviewed_by_membership_id, organization_id);
create index renewal_timings_source_org_fk_idx on public.renewal_timings (source_id, organization_id);
create index renewal_timings_snapshot_org_fk_idx on public.renewal_timings (snapshot_id, organization_id);
create index renewal_timings_created_by_idx on public.renewal_timings (created_by);

create trigger renewal_timings_url before insert or update on public.renewal_timings
  for each row execute function app.enforce_allowlisted_urls('source_url');
create trigger renewal_timings_touch before update on public.renewal_timings
  for each row execute function app.touch_row();
create trigger renewal_timings_keys before update on public.renewal_timings
  for each row execute function app.guard_tenant_keys();
create trigger renewal_timings_stamp before insert on public.renewal_timings
  for each row execute function app.stamp_created_by();
create trigger renewal_timings_guard before update or delete on public.renewal_timings
  for each row execute function app.gov_guard_update();
create trigger renewal_timings_audit after insert or update or delete on public.renewal_timings
  for each row execute function app.audit_row_change();

-- What was read from the page never changes after it is entered; only the review is added.
create function app.renewal_timing_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.program_key, new.applies_to, new.timing_text, new.lead_days, new.source_id, new.snapshot_id, new.source_url,
      new.source_section, new.form_number, new.form_modified_on, new.checked_on, new.current_to, new.snapshot_sha256)
     is distinct from
     (old.program_key, old.applies_to, old.timing_text, old.lead_days, old.source_id, old.snapshot_id, old.source_url,
      old.source_section, old.form_number, old.form_modified_on, old.checked_on, old.current_to, old.snapshot_sha256) then
    raise exception 'an official timing is not edited; enter a new one and retire this one' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.renewal_timing_immutable() from public;
create trigger renewal_timings_immutable before update on public.renewal_timings
  for each row execute function app.renewal_timing_immutable();

-- ---------------------------------------------------------------------------
-- 2 and 3. Expiry of the issued document, its reminder, and the client's renewal reminder
-- ---------------------------------------------------------------------------
create table public.decision_renewals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  decision_id uuid not null,
  document_label text not null check (length(btrim(document_label)) between 2 and 200),
  expires_on date not null,
  document_version_id uuid,
  remind_on date not null,
  timing_id uuid,
  task_id uuid not null,
  owner_membership_id uuid not null,
  recorded_by_membership_id uuid not null,
  client_person_id uuid,
  consent_record_id uuid,
  service_scope text check (service_scope is null or length(btrim(service_scope)) between 10 and 2000),
  fee_reference_id uuid,
  fee_section text,
  fee_group text,
  fee_name text,
  lead_id uuid,
  reminder_set_at timestamptz,
  reminder_set_by_membership_id uuid,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(btrim(cancel_reason)) between 3 and 500),
  cancelled_by_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (task_id),
  check (remind_on <= expires_on),
  check (
    (reminder_set_at is null) = (client_person_id is null)
    and (reminder_set_at is null) = (service_scope is null)
    and (reminder_set_at is null) = (lead_id is null)
    and (reminder_set_at is null) = (reminder_set_by_membership_id is null)
  ),
  check ((fee_reference_id is null) = (fee_name is null)),
  check (fee_reference_id is null or reminder_set_at is not null),
  check ((cancelled_at is null) = (cancel_reason is null) and (cancelled_at is null) = (cancelled_by_membership_id is null)),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (decision_id, organization_id) references public.decision_records (id, organization_id),
  foreign key (document_version_id, organization_id) references public.document_versions (id, organization_id),
  foreign key (timing_id, organization_id) references public.renewal_timings (id, organization_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id),
  foreign key (owner_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (recorded_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (client_person_id, organization_id) references public.persons (id, organization_id),
  foreign key (consent_record_id, organization_id) references public.consent_records (id, organization_id),
  foreign key (fee_reference_id, organization_id) references public.government_fee_references (id, organization_id),
  foreign key (lead_id, organization_id) references public.leads (id, organization_id),
  foreign key (reminder_set_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (cancelled_by_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.decision_renewals is
  'DEC-02: the expiry date shown on the client''s issued document, recorded by staff from a confirmed approval, with its internal reminder task. The reminder date follows an approved official timing (timing_id) or is the firm''s choice (timing_id null). A renewal reminder for the client is set only when the client''s contact choices allow it; it creates a Pipeline lead, never an invoice.';
comment on column public.decision_renewals.fee_name is
  'The IRCC fee named on the reminder, as it reads in the approved fee list. The client sees its amount only while the same fee is in the currently approved snapshot.';

create index decision_renewals_matter_idx on public.decision_renewals (matter_id, created_at desc);
create index decision_renewals_org_fk_idx on public.decision_renewals (organization_id);
create index decision_renewals_matter_org_fk_idx on public.decision_renewals (matter_id, organization_id);
create index decision_renewals_decision_org_fk_idx on public.decision_renewals (decision_id, organization_id);
create index decision_renewals_version_org_fk_idx on public.decision_renewals (document_version_id, organization_id);
create index decision_renewals_timing_org_fk_idx on public.decision_renewals (timing_id, organization_id);
create index decision_renewals_task_org_fk_idx on public.decision_renewals (task_id, organization_id);
create index decision_renewals_owner_org_fk_idx on public.decision_renewals (owner_membership_id, organization_id);
create index decision_renewals_recorder_org_fk_idx on public.decision_renewals (recorded_by_membership_id, organization_id);
create index decision_renewals_person_org_fk_idx on public.decision_renewals (client_person_id, organization_id);
create index decision_renewals_consent_org_fk_idx on public.decision_renewals (consent_record_id, organization_id);
create index decision_renewals_fee_org_fk_idx on public.decision_renewals (fee_reference_id, organization_id);
create index decision_renewals_lead_org_fk_idx on public.decision_renewals (lead_id, organization_id);
create index decision_renewals_setter_org_fk_idx on public.decision_renewals (reminder_set_by_membership_id, organization_id);
create index decision_renewals_canceller_org_fk_idx on public.decision_renewals (cancelled_by_membership_id, organization_id);
create index decision_renewals_created_by_idx on public.decision_renewals (created_by);

create trigger decision_renewals_touch before update on public.decision_renewals
  for each row execute function app.touch_row();
create trigger decision_renewals_keys before update on public.decision_renewals
  for each row execute function app.guard_tenant_keys();
create trigger decision_renewals_stamp before insert on public.decision_renewals
  for each row execute function app.stamp_created_by();
create trigger decision_renewals_guard before update or delete on public.decision_renewals
  for each row execute function app.gov_guard_update();
create trigger decision_renewals_audit after insert or update or delete on public.decision_renewals
  for each row execute function app.audit_row_change();

-- The recorded expiry and its reminder never change; a mistake is cancelled and recorded again.
create function app.decision_renewal_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.matter_id, new.decision_id, new.document_label, new.expires_on, new.document_version_id, new.remind_on,
      new.timing_id, new.task_id, new.owner_membership_id, new.recorded_by_membership_id)
     is distinct from
     (old.matter_id, old.decision_id, old.document_label, old.expires_on, old.document_version_id, old.remind_on,
      old.timing_id, old.task_id, old.owner_membership_id, old.recorded_by_membership_id) then
    raise exception 'a recorded expiry is not edited; cancel it and record it again' using errcode = '42501';
  end if;
  if old.reminder_set_at is not null
     and (new.client_person_id, new.consent_record_id, new.service_scope, new.fee_reference_id, new.fee_section, new.fee_group,
          new.fee_name, new.lead_id, new.reminder_set_at, new.reminder_set_by_membership_id)
     is distinct from
         (old.client_person_id, old.consent_record_id, old.service_scope, old.fee_reference_id, old.fee_section, old.fee_group,
          old.fee_name, old.lead_id, old.reminder_set_at, old.reminder_set_by_membership_id) then
    raise exception 'a renewal reminder is not edited; cancel it and record it again' using errcode = '42501';
  end if;
  if old.cancelled_at is not null then
    raise exception 'this expiry is cancelled' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.decision_renewal_immutable() from public;
create trigger decision_renewals_immutable before update on public.decision_renewals
  for each row execute function app.decision_renewal_immutable();

-- ---------------------------------------------------------------------------
-- Functions: official timing
-- ---------------------------------------------------------------------------

-- Staff enter a timing from an official page. p_snapshot is the server's fetch of that page
-- ({sha256, retrieved_at, final_url, http_status}) or null when it couldn't be fetched (then it
-- can't be approved).
create function app.propose_renewal_timing(
  p_org uuid,
  p_program_key text,
  p_applies_to text,
  p_timing_text text,
  p_lead_days integer,
  p_source_url text,
  p_source_section text,
  p_form_number text,
  p_form_modified_on date,
  p_checked_on date,
  p_current_to date,
  p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := btrim(coalesce(p_source_url, ''));
  canonical text;
  v_host text;
  publisher_name text;
  today date;
  src uuid;
  snap uuid;
  snap_hash text;
  snap_url text;
  snap_at timestamptz;
  snap_no integer;
  new_id uuid;
begin
  perform app.require_active_staff(p_org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  today := app.firm_today(p_org);
  if p_applies_to is null or length(btrim(p_applies_to)) not between 2 and 200 then
    raise exception 'name the document or status as the official page does' using errcode = '22023';
  end if;
  if p_timing_text is null or length(btrim(p_timing_text)) not between 3 and 500 then
    raise exception 'write the timing word for word, as the official page gives it' using errcode = '22023';
  end if;
  if p_lead_days is not null and p_lead_days not between 1 and 1095 then
    raise exception 'the days before expiry must be between 1 and 1095, and only when the page states a number' using errcode = '22023';
  end if;
  if p_program_key is not null and p_program_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'unknown program' using errcode = '22023';
  end if;
  v_host := app.federal_official_url(url);
  if v_host is null then
    raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
  end if;
  if position('#' in url) = 0 and nullif(btrim(coalesce(p_source_section, '')), '') is null then
    raise exception 'name the section of the page, or give its link with the section anchor' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > today or p_checked_on < today - 366 then
    raise exception 'the date checked is required, within the last year and not in the future' using errcode = '22023';
  end if;
  if p_form_modified_on is not null and (nullif(btrim(coalesce(p_form_number, '')), '') is null or p_form_modified_on > today) then
    raise exception 'a form''s date modified needs its form number and cannot be in the future' using errcode = '22023';
  end if;
  if p_current_to is not null and p_current_to > today then
    raise exception 'a current-to date cannot be in the future' using errcode = '22023';
  end if;
  if p_snapshot is not null then
    snap_hash := lower(btrim(coalesce(p_snapshot ->> 'sha256', '')));
    snap_url := btrim(coalesce(p_snapshot ->> 'final_url', url));
    snap_at := (p_snapshot ->> 'retrieved_at')::timestamptz;
    if snap_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'the page hash is invalid' using errcode = '22023';
    end if;
    if snap_at is null or snap_at > statement_timestamp() + interval '5 minutes' or snap_at < statement_timestamp() - interval '1 day' then
      raise exception 'the retrieval time must be now' using errcode = '22023';
    end if;
    if app.federal_official_url(snap_url) is null then
      raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
    end if;
  end if;

  canonical := split_part(url, '#', 1);
  select domain.authority into publisher_name
  from public.official_source_domains domain
  where domain.active and (v_host = domain.host or right(v_host, length(domain.host) + 1) = '.' || domain.host)
  order by length(domain.host) desc
  limit 1;

  select source.id into src
  from public.official_sources source
  where source.organization_id = p_org and source.canonical_url = canonical;
  if src is null then
    insert into public.official_sources (organization_id, publisher, canonical_url, allowed_host, jurisdiction, content_kind, title, source_language)
    values (p_org, coalesce(publisher_name, 'Government of Canada'), canonical, v_host, 'CA', 'program_guidance',
            left(nullif(btrim(coalesce(p_source_section, '')), ''), 300), 'en')
    returning id into src;
  end if;
  if snap_hash is not null then
    -- The same page bytes already captured for this source are reused; a new capture is numbered next.
    select snapshot.id into snap
    from public.source_snapshots snapshot
    where snapshot.source_id = src and snapshot.content_hash = snap_hash
    order by snapshot.snapshot_number desc
    limit 1;
    if snap is null then
      select coalesce(max(snapshot.snapshot_number), 0) + 1 into snap_no
      from public.source_snapshots snapshot
      where snapshot.source_id = src;
      insert into public.source_snapshots (
        organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, current_to, content_hash,
        retrieval_result, http_status, review_status
      ) values (
        p_org, src, snap_no, snap_url, coalesce(publisher_name, 'Government of Canada'), snap_at, p_current_to, snap_hash,
        'success', nullif(p_snapshot ->> 'http_status', '')::integer, 'evidence_captured'
      )
      returning id into snap;
    end if;
  end if;

  insert into public.renewal_timings (
    organization_id, program_key, applies_to, timing_text, lead_days, source_id, snapshot_id, source_url, source_section,
    form_number, form_modified_on, checked_on, current_to, snapshot_sha256
  ) values (
    p_org, p_program_key, btrim(p_applies_to), btrim(p_timing_text), p_lead_days, src, snap, url,
    nullif(btrim(coalesce(p_source_section, '')), ''),
    nullif(upper(btrim(coalesce(p_form_number, ''))), ''), p_form_modified_on, p_checked_on, p_current_to, snap_hash
  )
  returning id into new_id;
  perform app.record_audit_event(
    p_org, 'decision.renewal_timing_entered', 'public.renewal_timings', new_id, 'success',
    jsonb_build_object('program_key', p_program_key, 'source_url', url, 'lead_days', p_lead_days, 'snapshot_sha256', snap_hash)
  );
  return new_id;
end;
$$;
revoke all on function app.propose_renewal_timing(uuid, text, text, text, integer, text, text, text, date, date, date, jsonb) from public;

-- A licensed member (fresh step-up) approves or rejects a pending timing. Approval needs the snapshot.
create function app.review_renewal_timing(p_timing_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  timing public.renewal_timings%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  new_version integer;
begin
  select * into timing from public.renewal_timings where id = p_timing_id for update;
  if timing.id is null or timing.organization_id is distinct from app.current_organization_id() then
    raise exception 'timing review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(timing.organization_id, true);
  if timing.version is distinct from p_expected_version then
    raise exception 'timing version conflict' using errcode = 'PT409';
  end if;
  if timing.status <> 'pending_review' then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or length(v_note) < 3) then
    raise exception 'say why it''s rejected' using errcode = '22023';
  end if;
  if p_decision = 'approved' and timing.snapshot_sha256 is null then
    raise exception 'a timing goes live only with a snapshot of its official page; enter it again when the page can be fetched' using errcode = '42501';
  end if;
  perform app.gov_open_write(timing.id);
  update public.renewal_timings
  set status = p_decision,
      reviewed_by_membership_id = app.gov_actor_membership(timing.organization_id),
      reviewed_at = statement_timestamp(),
      review_note = left(v_note, 500)
  where id = timing.id
  returning version into new_version;
  perform app.gov_close_write(timing.id);
  perform app.record_audit_event(
    timing.organization_id, 'decision.renewal_timing_' || p_decision, 'public.renewal_timings', timing.id, 'success',
    jsonb_build_object('source_url', timing.source_url, 'snapshot_sha256', timing.snapshot_sha256, 'lead_days', timing.lead_days)
  );
  return new_version;
end;
$$;
revoke all on function app.review_renewal_timing(uuid, integer, text, text) from public;

-- A licensed member (fresh step-up) retires an approved timing that no longer matches the page.
create function app.retire_renewal_timing(p_timing_id uuid, p_expected_version integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  timing public.renewal_timings%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  new_version integer;
begin
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'say why it''s retired' using errcode = '22023';
  end if;
  select * into timing from public.renewal_timings where id = p_timing_id for update;
  if timing.id is null or timing.organization_id is distinct from app.current_organization_id() then
    raise exception 'timing review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(timing.organization_id, true);
  if timing.version is distinct from p_expected_version then
    raise exception 'timing version conflict' using errcode = 'PT409';
  end if;
  if timing.status <> 'approved' then
    raise exception 'only an approved timing is retired' using errcode = '22023';
  end if;
  perform app.gov_open_write(timing.id);
  update public.renewal_timings
  set status = 'retired', retired_at = statement_timestamp(), review_note = v_reason
  where id = timing.id
  returning version into new_version;
  perform app.gov_close_write(timing.id);
  perform app.record_audit_event(
    timing.organization_id, 'decision.renewal_timing_retired', 'public.renewal_timings', timing.id, 'success',
    jsonb_build_object('reason', v_reason)
  );
  return new_version;
end;
$$;
revoke all on function app.retire_renewal_timing(uuid, integer, text) from public;

-- ---------------------------------------------------------------------------
-- Functions: the client's contact choices
-- ---------------------------------------------------------------------------

-- Whether the matter's client may get a renewal reminder, and why not. The client is the matter's
-- applicant. Reminders are shown in the portal only, so the client must use the portal and have
-- chosen "Remind me before a deadline" in their own contact choices. Staff on the matter only
-- (null otherwise).
create function app.renewal_contact_state(p_matter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_person public.persons%rowtype;
  v_prefs public.person_contact_preferences%rowtype;
  v_consent public.consent_records%rowtype;
  v_name text;
begin
  select matter.organization_id into v_org from public.matters matter where matter.id = p_matter_id;
  if v_org is null or app.gov_staff_can_read(p_matter_id, v_org) is distinct from true then
    return null;
  end if;
  select person.* into v_person
  from public.matter_participants party
  join public.persons person on person.id = party.person_id and person.organization_id = party.organization_id
  where party.matter_id = p_matter_id and party.organization_id = v_org and party.role = 'applicant'
  order by party.created_at
  limit 1;
  if v_person.id is null then
    return jsonb_build_object('allowed', false, 'person_id', null, 'name', null,
      'reason', 'This matter has no applicant on file, so there is no client to remind.');
  end if;
  v_name := v_person.display_name;
  if v_person.user_id is null then
    return jsonb_build_object('allowed', false, 'person_id', v_person.id, 'name', v_name,
      'reason', v_name || ' doesn''t use the portal, and renewal reminders are shown only there (Casevoya sends no renewal email).');
  end if;
  select * into v_prefs from public.person_contact_preferences pref where pref.person_id = v_person.id;
  select * into v_consent
  from public.consent_records consent
  where consent.person_id = v_person.id and consent.organization_id = v_org and consent.purpose = 'deadline_reminder'
  order by consent.created_at desc
  limit 1;
  if v_prefs.person_id is null then
    return jsonb_build_object('allowed', false, 'person_id', v_person.id, 'name', v_name,
      'reason', v_name || ' hasn''t saved contact choices in the portal, so they haven''t asked for reminders.');
  end if;
  if v_prefs.deadline_reminders is distinct from true or v_consent.id is null or v_consent.granted is distinct from true or v_consent.withdrawn_at is not null then
    return jsonb_build_object('allowed', false, 'person_id', v_person.id, 'name', v_name,
      'since', coalesce(v_consent.created_at, v_prefs.updated_at),
      'reason', v_name || ' has “Remind me before a deadline” turned off in their portal contact choices.');
  end if;
  return jsonb_build_object('allowed', true, 'person_id', v_person.id, 'name', v_name, 'since', v_consent.created_at,
    'consent_record_id', v_consent.id,
    'reason', v_name || ' chose “Remind me before a deadline” in their portal contact choices.');
end;
$$;
revoke all on function app.renewal_contact_state(uuid) from public;

-- ---------------------------------------------------------------------------
-- Functions: expiry, reminder, renewal
-- ---------------------------------------------------------------------------

-- Staff record the expiry date shown on the client's issued document, from a consultant-confirmed
-- approval, and its internal reminder task. With p_timing_id (an approved official timing that
-- states its days), the reminder falls that many days before expiry; without it, staff choose the
-- date and it is the firm's choice. Nothing is sent to the client from here.
create function app.record_issued_expiry(
  p_decision_id uuid,
  p_document_label text,
  p_expires_on date,
  p_document_version_id uuid,
  p_remind_on date,
  p_timing_id uuid,
  p_owner_membership_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision public.decision_records%rowtype;
  matter public.matters%rowtype;
  timing public.renewal_timings%rowtype;
  today date;
  v_remind date;
  v_owner uuid;
  v_actor uuid;
  v_task uuid;
  new_id uuid;
begin
  select * into decision from public.decision_records where id = p_decision_id;
  if decision.id is null or app.can_read_matter(decision.matter_id) is distinct from true then
    raise exception 'expiry denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    decision.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if decision.state is distinct from 'confirmed' or decision.outcome is distinct from 'approved' then
    raise exception 'expiry reminders follow an approval the consultant confirmed' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = decision.matter_id;
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if p_document_label is null or length(btrim(p_document_label)) not between 2 and 200 then
    raise exception 'name the issued document as it reads (for example the permit or card)' using errcode = '22023';
  end if;
  if p_expires_on is null then
    raise exception 'enter the expiry date shown on the issued document' using errcode = '22023';
  end if;
  if p_document_version_id is not null
     and app.gov_evidence_on_matter(p_document_version_id, matter.id, matter.organization_id) is distinct from true then
    raise exception 'the document must be a stored file on this matter' using errcode = '42501';
  end if;
  today := app.firm_today(matter.organization_id);
  if p_timing_id is not null then
    select * into timing from public.renewal_timings where id = p_timing_id;
    if timing.id is null or timing.organization_id is distinct from matter.organization_id or timing.status <> 'approved' then
      raise exception 'only an approved official timing can set the reminder date' using errcode = '42501';
    end if;
    if timing.program_key is not null and timing.program_key is distinct from app.matter_program_key(matter.id) then
      raise exception 'that official timing is for another program' using errcode = '22023';
    end if;
    if timing.lead_days is null then
      raise exception 'that official timing states no number of days; choose the date as the firm''s choice' using errcode = '22023';
    end if;
    v_remind := p_expires_on - timing.lead_days;
    if p_remind_on is not null and p_remind_on is distinct from v_remind then
      raise exception 'the official timing sets the reminder on %; leave the date to follow it, or choose the firm''s own date without the timing', to_char(v_remind, 'YYYY-MM-DD')
        using errcode = '22023';
    end if;
  else
    v_remind := p_remind_on;
    if v_remind is null then
      raise exception 'choose the reminder date (the firm''s choice); no default is set' using errcode = '22023';
    end if;
  end if;
  if v_remind > p_expires_on then
    raise exception 'the reminder is due on or before the expiry date' using errcode = '22023';
  end if;
  if v_remind < today then
    raise exception 'the reminder date % has passed; choose a date from today', to_char(v_remind, 'YYYY-MM-DD') using errcode = '22023';
  end if;
  v_actor := app.gov_actor_membership(matter.organization_id);
  v_owner := coalesce(p_owner_membership_id, matter.responsible_consultant_membership_id, v_actor);
  v_task := app.create_task(
    matter.id, 'internal',
    left('Renewal review: ' || btrim(p_document_label) || ' expires ' || to_char(p_expires_on, 'YYYY-MM-DD'), 200),
    v_owner, null, 'normal', v_remind, null, null, null, null, '[]'::jsonb
  );
  insert into public.decision_renewals (
    organization_id, matter_id, decision_id, document_label, expires_on, document_version_id, remind_on, timing_id,
    task_id, owner_membership_id, recorded_by_membership_id
  ) values (
    matter.organization_id, matter.id, decision.id, btrim(p_document_label), p_expires_on, p_document_version_id, v_remind,
    p_timing_id, v_task, v_owner, v_actor
  )
  returning id into new_id;
  perform app.record_audit_event(
    matter.organization_id, 'decision.expiry_recorded', 'public.decision_renewals', new_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'decision_id', decision.id, 'expires_on', p_expires_on, 'remind_on', v_remind,
      'timing_id', p_timing_id, 'basis', case when p_timing_id is null then 'firm_choice' else 'official_timing' end, 'task_id', v_task)
  );
  return new_id;
end;
$$;
revoke all on function app.record_issued_expiry(uuid, text, date, uuid, date, uuid, uuid) from public;

-- Staff set the client's renewal reminder on a recorded expiry: only when the client's contact
-- choices allow it, with the scope of the new service stated. It creates a Pipeline lead for the
-- successor work; it never creates an invoice, a bill or a payment request. A fee is named only
-- from the firm's approved IRCC fee list.
create function app.set_renewal_reminder(
  p_renewal_id uuid,
  p_expected_version integer,
  p_service_scope text,
  p_fee_reference_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  renewal public.decision_renewals%rowtype;
  matter public.matters%rowtype;
  v_person public.persons%rowtype;
  fee public.government_fee_references%rowtype;
  contact jsonb;
  v_scope text := nullif(btrim(coalesce(p_service_scope, '')), '');
  v_lead uuid;
  new_version integer;
begin
  select * into renewal from public.decision_renewals where id = p_renewal_id for update;
  if renewal.id is null or app.can_read_matter(renewal.matter_id) is distinct from true then
    raise exception 'renewal reminder denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    renewal.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if renewal.version is distinct from p_expected_version then
    raise exception 'renewal version conflict' using errcode = 'PT409';
  end if;
  if renewal.cancelled_at is not null then
    raise exception 'this expiry is cancelled' using errcode = '42501';
  end if;
  if renewal.reminder_set_at is not null then
    raise exception 'a renewal reminder is already set for this expiry' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = renewal.matter_id;
  if matter.is_sample then
    raise exception 'a sample matter''s client isn''t a real person; set renewal reminders on a real matter' using errcode = '42501';
  end if;
  contact := app.renewal_contact_state(matter.id);
  if contact is null then
    raise exception 'renewal reminder denied' using errcode = '42501';
  end if;
  if (contact ->> 'allowed')::boolean is distinct from true then
    raise exception 'renewal reminder refused: %', contact ->> 'reason' using errcode = '42501';
  end if;
  if v_scope is null or length(v_scope) not between 10 and 2000 then
    raise exception 'state the scope of the new service (at least 10 characters)' using errcode = '22023';
  end if;
  if p_fee_reference_id is not null then
    select * into fee from public.government_fee_references ref where ref.id = p_fee_reference_id;
    if fee.id is null or fee.organization_id is distinct from matter.organization_id or fee.status <> 'approved' then
      raise exception 'only a fee from the approved IRCC fee list can be shown to the client' using errcode = '22023';
    end if;
  end if;
  select * into v_person from public.persons where id = (contact ->> 'person_id')::uuid;

  -- The successor work starts as a Pipeline lead. No consent is recorded on the lead: the client's
  -- own portal choice above is the basis for this reminder.
  v_lead := public.create_lead(
    matter.organization_id,
    v_person.display_name,
    v_person.email,
    v_person.contact_phone,
    null,
    left(v_scope, 120),
    null,
    null,
    'other'::public.lead_source,
    left('Renewal from ' || coalesce(matter.reference, 'a matter') || ': ' || renewal.document_label, 200),
    renewal.owner_membership_id,
    null,
    array['renewal'],
    'Renewal of ' || renewal.document_label || ', which expires ' || to_char(renewal.expires_on, 'YYYY-MM-DD')
      || ' (from the client''s issued document). Scope of the new service: ' || v_scope,
    false,
    false
  );

  perform app.gov_open_write(renewal.id);
  update public.decision_renewals
  set client_person_id = v_person.id,
      consent_record_id = (contact ->> 'consent_record_id')::uuid,
      service_scope = v_scope,
      fee_reference_id = fee.id,
      fee_section = fee.section,
      fee_group = fee.fee_group,
      fee_name = fee.name,
      lead_id = v_lead,
      reminder_set_at = statement_timestamp(),
      reminder_set_by_membership_id = app.gov_actor_membership(renewal.organization_id)
  where id = renewal.id
  returning version into new_version;
  perform app.gov_close_write(renewal.id);
  perform app.record_audit_event(
    renewal.organization_id, 'decision.renewal_reminder_set', 'public.decision_renewals', renewal.id, 'success',
    jsonb_build_object('matter_id', matter.id, 'lead_id', v_lead, 'person_id', v_person.id,
      'consent_record_id', contact ->> 'consent_record_id', 'fee_reference_id', fee.id)
  );
  return new_version;
end;
$$;
revoke all on function app.set_renewal_reminder(uuid, integer, text, uuid) from public;

-- Staff cancel a recorded expiry (a mistake, or the client no longer needs it). Its open reminder
-- task is cancelled; a lead already created stays in the Pipeline for the firm to close.
create function app.cancel_decision_renewal(p_renewal_id uuid, p_expected_version integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  renewal public.decision_renewals%rowtype;
  task public.tasks%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  new_version integer;
begin
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'say why it''s cancelled' using errcode = '22023';
  end if;
  select * into renewal from public.decision_renewals where id = p_renewal_id for update;
  if renewal.id is null or app.can_read_matter(renewal.matter_id) is distinct from true then
    raise exception 'renewal cancel denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    renewal.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if renewal.version is distinct from p_expected_version then
    raise exception 'renewal version conflict' using errcode = 'PT409';
  end if;
  if renewal.cancelled_at is not null then
    raise exception 'this expiry is cancelled' using errcode = '42501';
  end if;
  select * into task from public.tasks where id = renewal.task_id;
  if task.status in ('open', 'blocked') then
    perform app.set_task_status(task.id, task.version, 'cancelled', null);
  end if;
  perform app.gov_open_write(renewal.id);
  update public.decision_renewals
  set cancelled_at = statement_timestamp(),
      cancel_reason = v_reason,
      cancelled_by_membership_id = app.gov_actor_membership(renewal.organization_id)
  where id = renewal.id
  returning version into new_version;
  perform app.gov_close_write(renewal.id);
  perform app.record_audit_event(
    renewal.organization_id, 'decision.expiry_cancelled', 'public.decision_renewals', renewal.id, 'success',
    jsonb_build_object('matter_id', renewal.matter_id, 'reason', v_reason)
  );
  return new_version;
end;
$$;
revoke all on function app.cancel_decision_renewal(uuid, integer, text) from public;

-- The fee currently approved under the same section, group and name as a reminder's fee, or null.
create function app.renewal_current_fee(p_org uuid, p_section text, p_group text, p_name text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', ref.name, 'amount_cents', ref.amount_cents, 'currency', ref.currency, 'source_url', ref.source_url,
    'retrieved_at', ref.retrieved_at, 'snapshot_sha256', ref.snapshot_sha256
  )
  from public.government_fee_references ref
  where ref.organization_id = p_org
    and ref.status = 'approved'
    and p_name is not null
    and ref.name = p_name
    and ref.section is not distinct from p_section
    and ref.fee_group is not distinct from p_group
  order by ref.reviewed_at desc, ref.position
  limit 1;
$$;
revoke all on function app.renewal_current_fee(uuid, text, text, text) from public;

-- The signed-in client's renewal reminders (portal only), while their contact choices still allow
-- them. A fee shows only while it is in the firm's approved IRCC fee list.
create function app.portal_renewal_reminders(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid;
begin
  if (select auth.uid()) is null or p_org is null or p_org is distinct from app.current_organization_id() then
    return '[]'::jsonb;
  end if;
  select person.id into v_person
  from public.persons person
  where person.organization_id = p_org and person.user_id = (select auth.uid())
  limit 1;
  if v_person is null or not exists (
    select 1 from public.person_contact_preferences pref where pref.person_id = v_person and pref.deadline_reminders
  ) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', renewal.id,
      'matter_id', renewal.matter_id,
      'document_label', renewal.document_label,
      'expires_on', renewal.expires_on,
      'remind_on', renewal.remind_on,
      'service_scope', renewal.service_scope,
      'timing', case when timing.id is null then null else jsonb_build_object(
        'text', timing.timing_text, 'source_url', timing.source_url, 'checked_on', timing.checked_on,
        'current_to', timing.current_to, 'snapshot_sha256', timing.snapshot_sha256) end,
      'fee', app.renewal_current_fee(renewal.organization_id, renewal.fee_section, renewal.fee_group, renewal.fee_name)
    ) order by renewal.expires_on)
    from public.decision_renewals renewal
    left join public.renewal_timings timing on timing.id = renewal.timing_id
    where renewal.organization_id = p_org
      and renewal.client_person_id = v_person
      and renewal.reminder_set_at is not null
      and renewal.cancelled_at is null
  ), '[]'::jsonb);
end;
$$;
revoke all on function app.portal_renewal_reminders(uuid) from public;

-- ---------------------------------------------------------------------------
-- Invoker wrappers (the definer bodies enforce role, scope, step-up, and licence)
-- ---------------------------------------------------------------------------
create function public.propose_renewal_timing(
  p_org uuid, p_program_key text, p_applies_to text, p_timing_text text, p_lead_days integer, p_source_url text,
  p_source_section text, p_form_number text, p_form_modified_on date, p_checked_on date, p_current_to date, p_snapshot jsonb
)
returns uuid language sql security invoker set search_path = ''
as $$
  select app.propose_renewal_timing(
    p_org, p_program_key, p_applies_to, p_timing_text, p_lead_days, p_source_url, p_source_section, p_form_number,
    p_form_modified_on, p_checked_on, p_current_to, p_snapshot
  );
$$;

create function public.review_renewal_timing(p_timing_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_renewal_timing(p_timing_id, p_expected_version, p_decision, p_note); $$;

create function public.retire_renewal_timing(p_timing_id uuid, p_expected_version integer, p_reason text)
returns integer language sql security invoker set search_path = ''
as $$ select app.retire_renewal_timing(p_timing_id, p_expected_version, p_reason); $$;

create function public.renewal_contact_state(p_matter_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app.renewal_contact_state(p_matter_id); $$;

create function public.record_issued_expiry(
  p_decision_id uuid, p_document_label text, p_expires_on date, p_document_version_id uuid, p_remind_on date,
  p_timing_id uuid, p_owner_membership_id uuid
)
returns uuid language sql security invoker set search_path = ''
as $$
  select app.record_issued_expiry(p_decision_id, p_document_label, p_expires_on, p_document_version_id, p_remind_on, p_timing_id, p_owner_membership_id);
$$;

create function public.set_renewal_reminder(p_renewal_id uuid, p_expected_version integer, p_service_scope text, p_fee_reference_id uuid)
returns integer language sql security invoker set search_path = ''
as $$ select app.set_renewal_reminder(p_renewal_id, p_expected_version, p_service_scope, p_fee_reference_id); $$;

create function public.cancel_decision_renewal(p_renewal_id uuid, p_expected_version integer, p_reason text)
returns integer language sql security invoker set search_path = ''
as $$ select app.cancel_decision_renewal(p_renewal_id, p_expected_version, p_reason); $$;

create function public.portal_renewal_reminders(p_org uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app.portal_renewal_reminders(p_org); $$;

revoke all on function public.propose_renewal_timing(uuid, text, text, text, integer, text, text, text, date, date, date, jsonb) from public, anon;
revoke all on function public.review_renewal_timing(uuid, integer, text, text) from public, anon;
revoke all on function public.retire_renewal_timing(uuid, integer, text) from public, anon;
revoke all on function public.renewal_contact_state(uuid) from public, anon;
revoke all on function public.record_issued_expiry(uuid, text, date, uuid, date, uuid, uuid) from public, anon;
revoke all on function public.set_renewal_reminder(uuid, integer, text, uuid) from public, anon;
revoke all on function public.cancel_decision_renewal(uuid, integer, text) from public, anon;
revoke all on function public.portal_renewal_reminders(uuid) from public, anon;

grant execute on function public.propose_renewal_timing(uuid, text, text, text, integer, text, text, text, date, date, date, jsonb) to authenticated, service_role;
grant execute on function public.review_renewal_timing(uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.retire_renewal_timing(uuid, integer, text) to authenticated, service_role;
grant execute on function public.renewal_contact_state(uuid) to authenticated, service_role;
grant execute on function public.record_issued_expiry(uuid, text, date, uuid, date, uuid, uuid) to authenticated, service_role;
grant execute on function public.set_renewal_reminder(uuid, integer, text, uuid) to authenticated, service_role;
grant execute on function public.cancel_decision_renewal(uuid, integer, text) to authenticated, service_role;
grant execute on function public.portal_renewal_reminders(uuid) to authenticated, service_role;

grant execute on function app.propose_renewal_timing(uuid, text, text, text, integer, text, text, text, date, date, date, jsonb) to authenticated, service_role;
grant execute on function app.review_renewal_timing(uuid, integer, text, text) to authenticated, service_role;
grant execute on function app.retire_renewal_timing(uuid, integer, text) to authenticated, service_role;
grant execute on function app.renewal_contact_state(uuid) to authenticated, service_role;
grant execute on function app.record_issued_expiry(uuid, text, date, uuid, date, uuid, uuid) to authenticated, service_role;
grant execute on function app.set_renewal_reminder(uuid, integer, text, uuid) to authenticated, service_role;
grant execute on function app.cancel_decision_renewal(uuid, integer, text) to authenticated, service_role;
grant execute on function app.portal_renewal_reminders(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security. Reads only; every write is a function above.
-- ---------------------------------------------------------------------------
revoke all on table public.renewal_timings from public, anon, authenticated;
revoke all on table public.decision_renewals from public, anon, authenticated;
grant select on table public.renewal_timings to authenticated;
grant select on table public.decision_renewals to authenticated;

alter table public.renewal_timings enable row level security;
alter table public.renewal_timings force row level security;
alter table public.decision_renewals enable row level security;
alter table public.decision_renewals force row level security;

-- Firm content, not client data: the firm's staff (two-step) read it.
create policy renewal_timings_select on public.renewal_timings
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

-- Staff on the matter. Clients read their reminders only through public.portal_renewal_reminders.
create policy decision_renewals_select on public.decision_renewals
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.gov_staff_can_read(matter_id, organization_id))
  );
