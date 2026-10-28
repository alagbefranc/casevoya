-- GOV-01 (submission checklist) and GOV-03 (package manifest, receipt) on the manual submission
-- handoff (T036, 20261019202100_government_handoff_decisions.sql). PRD §14 GOV-01, GOV-03.
--
-- 1. Official submission steps and channel names (GOV-01 criteria 3 and 4, GOV-03 criterion 4).
--    public.submission_requirements holds what a firm took from an official IRCC / Government of
--    Canada page: an outside-Casevoya step for a program and channel, or IRCC's official name for
--    a channel. Each row stores the source URL with its section anchor, the form number and the
--    form's "date modified" where one applies, the date staff checked the page, the page's
--    "current to" date when it states one, and the source identity and snapshot in the existing
--    source governance tables (public.official_sources, public.source_snapshots: a firm row for
--    the URL, a snapshot with the SHA-256 of the bytes the server fetched). The URL must be on a
--    federal official host (canada.ca or a gc.ca host on public.official_source_domains). Rows are
--    pending until a licensed member of the firm approves them with a fresh step-up, as FIN-06's
--    government fee references are; only approved rows reach a matter, and a row is approved only
--    with its page snapshot hash. Nothing is seeded.
-- 2. The submission checklist (GOV-01 criteria 1 and 2). app.submission_gates_for derives each gate
--    from records Casevoya already keeps: current representation authority, the released package,
--    reviewed (confirmed) legal and correspondence deadlines, signatures, the firm's fee-handling
--    confirmation, and the approved outside steps for the handoff's channel. Recording a submission
--    refuses while a gate is blocked. The firm owner can override a gate with a reason after a fresh
--    step-up; the override is stored and audited. The package gate is never overridden: a licensed
--    consultant's release is the professional control.
-- 3. The package manifest (GOV-03 criterion 1). Releasing the package (the consultant's sign-off)
--    pins the stored files on the matter: each file's version, name and SHA-256, and a manifest
--    SHA-256 over them. The package gate turns red again if a pinned file is replaced or removed
--    after release. Recording the submission writes the full manifest into the audit event.
-- 4. Receipt evidence (GOV-03 criteria 2 and 3). A submission is verified ("Submitted to
--    government") only with the government confirmation stored as a file on the matter and the
--    acknowledgement date entered separately. Without them it stays "Submission unverified".
--
-- Redefined (latest definitions copied, changes listed at each):
--   app.sign_off_submission_handoff  from 20261023090000_version_conflicts_not_retried.sql
--   app.record_submission            from 20261023090000_version_conflicts_not_retried.sql
--   app.gov_finish_verification      from 20261019216100_firm_today_rules.sql
-- Forced RLS on every new table; writes only through the SECURITY DEFINER functions here.
-- Dates are the firm's (app.firm_today). Additive only.

-- ---------------------------------------------------------------------------
-- Package manifest columns on the handoff
-- ---------------------------------------------------------------------------
alter table public.submission_handoffs
  add column manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  add column manifest_file_count integer check (manifest_file_count is null or manifest_file_count >= 1),
  add column manifest_pinned_at timestamptz;
alter table public.submission_handoffs
  add constraint submission_handoffs_manifest_ck check (
    (manifest_sha256 is null) = (manifest_pinned_at is null)
    and (manifest_sha256 is null) = (manifest_file_count is null)
  );
comment on column public.submission_handoffs.manifest_sha256 is
  'SHA-256 over the pinned file list (version id, file SHA-256, file name per line, in order), set when a licensed consultant releases the package (GOV-03).';

create table public.submission_manifest_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  handoff_id uuid not null,
  position integer not null check (position between 1 and 500),
  document_id uuid not null,
  document_version_id uuid not null,
  file_name text not null check (length(btrim(file_name)) between 1 and 300),
  purpose text not null check (length(btrim(purpose)) between 1 and 200),
  byte_size bigint check (byte_size is null or byte_size > 0),
  file_sha256 text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  review_state text not null check (review_state in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  unique (handoff_id, position),
  unique (handoff_id, document_version_id),
  foreign key (handoff_id, organization_id) references public.submission_handoffs (id, organization_id),
  foreign key (document_id, organization_id) references public.documents (id, organization_id),
  foreign key (document_version_id, organization_id) references public.document_versions (id, organization_id)
);
comment on table public.submission_manifest_files is
  'The files a licensed consultant released for a submission handoff (GOV-03): version, name and SHA-256 as stored at release. Append-only.';

create index submission_manifest_files_org_fk_idx on public.submission_manifest_files (organization_id);
create index submission_manifest_files_handoff_org_fk_idx on public.submission_manifest_files (handoff_id, organization_id);
create index submission_manifest_files_document_org_fk_idx on public.submission_manifest_files (document_id, organization_id);
create index submission_manifest_files_version_org_fk_idx on public.submission_manifest_files (document_version_id, organization_id);
create index submission_manifest_files_created_by_idx on public.submission_manifest_files (created_by);

create trigger submission_manifest_files_stamp before insert on public.submission_manifest_files
  for each row execute function app.stamp_created_by();
create trigger submission_manifest_files_append_only before update or delete on public.submission_manifest_files
  for each row execute function app.gov_reject_mutation();
create trigger submission_manifest_files_audit after insert on public.submission_manifest_files
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------------
-- Official steps and channel names, from official pages, reviewed before use
-- ---------------------------------------------------------------------------
create table public.submission_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  program_key text check (program_key is null or program_key ~ '^[a-z0-9_]{1,80}$'),
  channel public.submission_channel not null,
  kind text not null check (kind in ('outside_step', 'channel_name')),
  label text not null check (length(btrim(label)) between 3 and 300),
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
comment on table public.submission_requirements is
  'A step done outside Casevoya, or IRCC''s official channel name, for a program (null: every program) and submission channel, as a firm read it on an official page (GOV-01, GOV-03). Source URL with anchor, form number and date modified, date checked, current-to date and snapshot hash stored with it. Pending until a licensed member approves it. Never seeded.';
comment on column public.submission_requirements.checked_on is
  'The date staff checked the official page (firm date). Not an effective date.';

create unique index submission_requirements_channel_name_uidx
  on public.submission_requirements (organization_id, coalesce(program_key, ''), channel)
  where kind = 'channel_name' and status = 'approved';
create index submission_requirements_org_status_idx on public.submission_requirements (organization_id, status, channel);
create index submission_requirements_reviewer_org_fk_idx on public.submission_requirements (reviewed_by_membership_id, organization_id);
create index submission_requirements_source_org_fk_idx on public.submission_requirements (source_id, organization_id);
create index submission_requirements_snapshot_org_fk_idx on public.submission_requirements (snapshot_id, organization_id);
create index submission_requirements_created_by_idx on public.submission_requirements (created_by);

create trigger submission_requirements_url before insert or update on public.submission_requirements
  for each row execute function app.enforce_allowlisted_urls('source_url');
create trigger submission_requirements_touch before update on public.submission_requirements
  for each row execute function app.touch_row();
create trigger submission_requirements_keys before update on public.submission_requirements
  for each row execute function app.guard_tenant_keys();
create trigger submission_requirements_stamp before insert on public.submission_requirements
  for each row execute function app.stamp_created_by();
create trigger submission_requirements_guard before update or delete on public.submission_requirements
  for each row execute function app.gov_guard_update();
create trigger submission_requirements_audit after insert or update or delete on public.submission_requirements
  for each row execute function app.audit_row_change();

-- The source identity and snapshot of a requirement never change after it is entered.
create function app.submission_requirement_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.program_key, new.channel, new.kind, new.label, new.source_id, new.snapshot_id, new.source_url, new.source_section,
      new.form_number, new.form_modified_on, new.checked_on, new.current_to, new.snapshot_sha256)
     is distinct from
     (old.program_key, old.channel, old.kind, old.label, old.source_id, old.snapshot_id, old.source_url, old.source_section,
      old.form_number, old.form_modified_on, old.checked_on, old.current_to, old.snapshot_sha256) then
    raise exception 'an official requirement is not edited; enter a new one and retire this one' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.submission_requirement_immutable() from public;
create trigger submission_requirements_immutable before update on public.submission_requirements
  for each row execute function app.submission_requirement_immutable();

-- ---------------------------------------------------------------------------
-- Checklist state: outside steps ticked, fee handling confirmed, owner overrides
-- ---------------------------------------------------------------------------
create table public.submission_checklist_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  handoff_id uuid not null,
  matter_id uuid not null,
  kind text not null check (kind in ('outside_step', 'fee_confirmation', 'gate_override')),
  item_key text not null check (
    (kind = 'outside_step' and item_key ~ '^[0-9a-f-]{36}$')
    or (kind = 'fee_confirmation' and item_key = 'fees')
    or (kind = 'gate_override' and item_key in ('representation', 'deadlines', 'signatures', 'fees', 'outside_steps'))
  ),
  requirement_id uuid,
  ticked boolean not null,
  note text check (note is null or length(btrim(note)) between 3 and 500),
  membership_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  check ((kind = 'outside_step') = (requirement_id is not null)),
  check (kind <> 'outside_step' or item_key = requirement_id::text),
  check (kind <> 'gate_override' or (ticked and note is not null and length(btrim(note)) >= 10)),
  check (kind <> 'fee_confirmation' or not ticked or note is not null),
  foreign key (handoff_id, organization_id) references public.submission_handoffs (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (requirement_id, organization_id) references public.submission_requirements (id, organization_id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.submission_checklist_events is
  'Submission checklist history for a handoff (GOV-01): an outside step ticked or unticked, fee handling confirmed, a gate overridden by the firm owner with a reason. Append-only; the latest event per item is its state.';

create index submission_checklist_events_item_idx on public.submission_checklist_events (handoff_id, kind, item_key, created_at desc);
create index submission_checklist_events_org_fk_idx on public.submission_checklist_events (organization_id);
create index submission_checklist_events_handoff_org_fk_idx on public.submission_checklist_events (handoff_id, organization_id);
create index submission_checklist_events_matter_org_fk_idx on public.submission_checklist_events (matter_id, organization_id);
create index submission_checklist_events_requirement_org_fk_idx on public.submission_checklist_events (requirement_id, organization_id);
create index submission_checklist_events_member_org_fk_idx on public.submission_checklist_events (membership_id, organization_id);
create index submission_checklist_events_created_by_idx on public.submission_checklist_events (created_by);

create trigger submission_checklist_events_stamp before insert on public.submission_checklist_events
  for each row execute function app.stamp_created_by();
create trigger submission_checklist_events_append_only before update or delete on public.submission_checklist_events
  for each row execute function app.gov_reject_mutation();
create trigger submission_checklist_events_audit after insert on public.submission_checklist_events
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The matter's program key (from its pinned program pack), or null.
create function app.matter_program_key(p_matter_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pack.program_key
  from public.matters matter
  join public.rule_pack_versions pack on pack.id = matter.program_pack_id
  where matter.id = p_matter_id;
$$;
revoke all on function app.matter_program_key(uuid) from public;

-- The files a release would pin: for each document on the matter, its newest clean version that
-- is not superseded, unless that version was rejected. Government letters and submission
-- receipts are evidence about the application, not part of it, so they are left out.
create function app.submission_package_candidates(p_matter_id uuid, p_org uuid)
returns table (
  document_id uuid,
  document_version_id uuid,
  file_name text,
  purpose text,
  byte_size bigint,
  file_sha256 text,
  review_state text
)
language sql
stable
security definer
set search_path = ''
as $$
  select newest.document_id, newest.document_version_id, newest.file_name, newest.purpose, newest.byte_size, newest.file_sha256, newest.review_state
  from (
    select distinct on (doc.id)
      doc.id as document_id,
      version.id as document_version_id,
      version.original_filename as file_name,
      doc.purpose,
      coalesce(version.byte_size, version.declared_byte_size) as byte_size,
      version.checksum_sha256 as file_sha256,
      version.review_state::text as review_state,
      doc.created_at
    from public.document_matter_refs ref
    join public.documents doc on doc.id = ref.document_id and doc.organization_id = ref.organization_id
    join public.document_versions version on version.document_id = doc.id and version.organization_id = doc.organization_id
    where ref.matter_id = p_matter_id
      and ref.organization_id = p_org
      and ref.removed_at is null
      and version.upload_state = 'clean'
      and version.superseded_at is null
      and not exists (select 1 from public.government_correspondence letter where letter.evidence_version_id = version.id)
      and not exists (select 1 from public.submission_handoffs other where other.receipt_version_id = version.id)
    order by doc.id, version.version_number desc
  ) newest
  where newest.review_state <> 'rejected'
  order by newest.created_at, newest.document_id
  limit 500;
$$;
revoke all on function app.submission_package_candidates(uuid, uuid) from public;

-- Pins the manifest on a handoff the caller is releasing (inside the handoff's open write).
create function app.gov_pin_manifest(p_handoff public.submission_handoffs)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pos integer := 0;
  file record;
  lines text[] := '{}';
  manifest text;
begin
  for file in select * from app.submission_package_candidates(p_handoff.matter_id, p_handoff.organization_id) loop
    pos := pos + 1;
    insert into public.submission_manifest_files (
      organization_id, handoff_id, position, document_id, document_version_id, file_name, purpose, byte_size, file_sha256, review_state
    ) values (
      p_handoff.organization_id, p_handoff.id, pos, file.document_id, file.document_version_id, file.file_name, file.purpose,
      file.byte_size, file.file_sha256, file.review_state
    );
    lines := lines || (file.document_version_id::text || ' ' || coalesce(file.file_sha256, '-') || ' ' || file.file_name);
  end loop;
  if pos = 0 then
    raise exception 'the package has no stored files to release' using errcode = '42501';
  end if;
  manifest := encode(sha256(convert_to(array_to_string(lines, E'\n'), 'UTF8')), 'hex');
  update public.submission_handoffs
  set manifest_sha256 = manifest, manifest_file_count = pos, manifest_pinned_at = statement_timestamp()
  where id = p_handoff.id;
  return jsonb_build_object('manifest_sha256', manifest, 'files', pos);
end;
$$;
revoke all on function app.gov_pin_manifest(public.submission_handoffs) from public;

-- Latest checklist event for one item of a handoff.
create function app.submission_item_ticked(p_handoff_id uuid, p_kind text, p_item text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select event.ticked
    from public.submission_checklist_events event
    where event.handoff_id = p_handoff_id and event.kind = p_kind and event.item_key = p_item
    order by event.created_at desc, event.id desc
    limit 1
  ), false);
$$;
revoke all on function app.submission_item_ticked(uuid, text, text) from public;

-- The gates for a matter's open handoff (or none). No permission check: callers check.
-- Each gate: {key, state: ok | blocked | overridden | none, detail, ...}.
create function app.submission_gates_for(p_matter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  handoff public.submission_handoffs%rowtype;
  today date;
  program text;
  rep_since date;
  changed_files integer := 0;
  candidate_files integer := 0;
  tentative integer := 0;
  waiting integer := 0;
  signed boolean := false;
  fee_lines integer := 0;
  steps_total integer := 0;
  steps_done integer := 0;
  gates jsonb := '[]'::jsonb;
  gate jsonb;
  override_event public.submission_checklist_events%rowtype;
  out_gates jsonb := '[]'::jsonb;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null then
    return null;
  end if;
  today := app.firm_today(matter.organization_id);
  program := app.matter_program_key(matter.id);
  select * into handoff
  from public.submission_handoffs open_handoff
  where open_handoff.matter_id = matter.id and open_handoff.status in ('awaiting_signoff', 'authorized')
  order by open_handoff.created_at desc
  limit 1;

  -- Representation (Use of a Representative on file, effective today).
  select min(authority.effective_on) into rep_since
  from public.representation_authorities authority
  where authority.matter_id = matter.id
    and authority.organization_id = matter.organization_id
    and authority.revoked_at is null
    and authority.effective_on <= today;
  gates := gates || jsonb_build_object(
    'key', 'representation',
    'state', case when rep_since is null then 'blocked' else 'ok' end,
    'since', rep_since
  );

  -- Package released (licensed sign-off with a pinned manifest), unchanged since release.
  select count(*) into candidate_files from app.submission_package_candidates(matter.id, matter.organization_id);
  if handoff.id is not null and handoff.status = 'authorized' and handoff.manifest_pinned_at is not null then
    select count(*) into changed_files
    from public.submission_manifest_files pinned
    where pinned.handoff_id = handoff.id
      and not exists (
        select 1 from app.submission_package_candidates(matter.id, matter.organization_id) now_file
        where now_file.document_version_id = pinned.document_version_id
      );
  end if;
  gates := gates || jsonb_build_object(
    'key', 'package',
    'state', case
      when handoff.id is null or handoff.status <> 'authorized' then 'blocked'
      when handoff.manifest_pinned_at is null then 'blocked'
      when changed_files > 0 then 'blocked'
      else 'ok' end,
    'released', handoff.status = 'authorized',
    'pinned', handoff.manifest_pinned_at is not null,
    'label', handoff.package_label,
    'files', handoff.manifest_file_count,
    'changed', changed_files,
    'candidates', candidate_files
  );

  -- Deadlines reviewed: every legal or correspondence deadline confirmed by a person.
  select count(*) into tentative
  from public.deadlines deadline
  where deadline.matter_id = matter.id
    and deadline.organization_id = matter.organization_id
    and deadline.kind in ('legal', 'correspondence')
    and deadline.verification = 'tentative';
  gates := gates || jsonb_build_object('key', 'deadlines', 'state', case when tentative > 0 then 'blocked' else 'ok' end, 'tentative', tentative);

  -- Signatures: a signed service agreement, and nothing on the matter still waiting for a signature.
  select count(*) into waiting
  from public.agreements agreement
  where agreement.matter_id = matter.id and agreement.organization_id = matter.organization_id
    and agreement.status in ('sent', 'partially_signed');
  select exists (
    select 1 from public.agreements agreement
    where agreement.matter_id = matter.id and agreement.organization_id = matter.organization_id
      and agreement.kind = 'service' and agreement.status = 'completed'
  ) into signed;
  gates := gates || jsonb_build_object('key', 'signatures', 'state', case when waiting > 0 or not signed then 'blocked' else 'ok' end, 'waiting', waiting, 'signed', signed);

  -- Fees handled: a person confirmed how the government fee was handled for this handoff.
  select count(*) into fee_lines
  from public.invoice_lines line
  join public.invoices invoice on invoice.id = line.invoice_id and invoice.organization_id = line.organization_id
  where invoice.matter_id = matter.id and invoice.organization_id = matter.organization_id and line.category = 'government_fee';
  gates := gates || jsonb_build_object(
    'key', 'fees',
    'state', case when handoff.id is not null and app.submission_item_ticked(handoff.id, 'fee_confirmation', 'fees') then 'ok' else 'blocked' end,
    'fee_lines', fee_lines
  );

  -- Outside steps: every approved official step for this program and channel ticked.
  if handoff.id is not null then
    select count(*), count(*) filter (where app.submission_item_ticked(handoff.id, 'outside_step', requirement.id::text))
    into steps_total, steps_done
    from public.submission_requirements requirement
    where requirement.organization_id = matter.organization_id
      and requirement.kind = 'outside_step'
      and requirement.status = 'approved'
      and requirement.channel = handoff.channel
      and (requirement.program_key is null or requirement.program_key is not distinct from program);
  end if;
  gates := gates || jsonb_build_object(
    'key', 'outside_steps',
    'state', case when handoff.id is null or steps_total = 0 then 'none' when steps_done < steps_total then 'blocked' else 'ok' end,
    'total', steps_total,
    'done', steps_done
  );

  -- A firm owner's override turns a blocked gate (never the package) into "overridden".
  for gate in select value from jsonb_array_elements(gates) loop
    if gate ->> 'state' = 'blocked' and gate ->> 'key' <> 'package' and handoff.id is not null then
      select * into override_event
      from public.submission_checklist_events event
      where event.handoff_id = handoff.id and event.kind = 'gate_override' and event.item_key = gate ->> 'key'
      order by event.created_at desc, event.id desc
      limit 1;
      if override_event.id is not null then
        gate := gate || jsonb_build_object(
          'state', 'overridden',
          'override_reason', override_event.note,
          'override_by', override_event.membership_id,
          'override_at', override_event.created_at
        );
      end if;
      override_event := null;
    end if;
    out_gates := out_gates || gate;
  end loop;

  return jsonb_build_object(
    'handoff_id', handoff.id,
    'channel', handoff.channel,
    'program_key', program,
    'gates', out_gates,
    'blocked', (select coalesce(jsonb_agg(item ->> 'key'), '[]'::jsonb) from jsonb_array_elements(out_gates) item where item ->> 'state' = 'blocked')
  );
end;
$$;
revoke all on function app.submission_gates_for(uuid) from public;

-- Staff on the matter read the checklist (GOV-01 criterion 1).
create function app.submission_checklist(p_matter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.gov_staff_can_read(matter.id, matter.organization_id) is distinct from true then
    raise exception 'submission checklist denied' using errcode = '42501';
  end if;
  return app.submission_gates_for(matter.id);
end;
$$;
revoke all on function app.submission_checklist(uuid) from public;

-- An open handoff this member may work on, locked.
create function app.gov_open_handoff(p_handoff_id uuid, p_roles public.org_role[], p_step_up boolean)
returns public.submission_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'submission checklist denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(handoff.organization_id, p_roles, p_step_up);
  if handoff.status not in ('awaiting_signoff', 'authorized') then
    raise exception 'the checklist belongs to a handoff that is not submitted yet' using errcode = '42501';
  end if;
  return handoff;
end;
$$;
revoke all on function app.gov_open_handoff(uuid, public.org_role[], boolean) from public;

-- Tick or untick an approved outside step (GOV-01 criterion 3).
create function app.tick_submission_step(p_handoff_id uuid, p_requirement_id uuid, p_ticked boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  requirement public.submission_requirements%rowtype;
  new_id uuid;
begin
  if p_ticked is null then
    raise exception 'say whether the step is done' using errcode = '22023';
  end if;
  handoff := app.gov_open_handoff(p_handoff_id, app.gov_staff_roles(), false);
  select * into requirement from public.submission_requirements where id = p_requirement_id;
  if requirement.id is null
     or requirement.organization_id is distinct from handoff.organization_id
     or requirement.kind <> 'outside_step'
     or requirement.status <> 'approved'
     or requirement.channel <> handoff.channel
     or (requirement.program_key is not null and requirement.program_key is distinct from app.matter_program_key(handoff.matter_id)) then
    raise exception 'that step does not apply to this submission' using errcode = '42501';
  end if;
  if app.submission_item_ticked(handoff.id, 'outside_step', requirement.id::text) = p_ticked then
    raise exception 'that step is already marked so' using errcode = '22023';
  end if;
  insert into public.submission_checklist_events (organization_id, handoff_id, matter_id, kind, item_key, requirement_id, ticked, membership_id)
  values (handoff.organization_id, handoff.id, handoff.matter_id, 'outside_step', requirement.id::text, requirement.id, p_ticked,
          app.gov_actor_membership(handoff.organization_id))
  returning id into new_id;
  perform app.record_audit_event(
    handoff.organization_id, case when p_ticked then 'submission.step_done' else 'submission.step_undone' end,
    'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id, 'requirement_id', requirement.id, 'source_url', requirement.source_url)
  );
  return new_id;
end;
$$;
revoke all on function app.tick_submission_step(uuid, uuid, boolean) from public;

-- Confirm (or withdraw the confirmation of) how the government fee was handled.
create function app.confirm_submission_fees(p_handoff_id uuid, p_confirmed boolean, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  new_id uuid;
begin
  if p_confirmed is null then
    raise exception 'say whether the fee handling is confirmed' using errcode = '22023';
  end if;
  if p_confirmed and (v_note is null or length(v_note) not between 3 and 500) then
    raise exception 'say how the government fee was handled' using errcode = '22023';
  end if;
  handoff := app.gov_open_handoff(p_handoff_id, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  insert into public.submission_checklist_events (organization_id, handoff_id, matter_id, kind, item_key, ticked, note, membership_id)
  values (handoff.organization_id, handoff.id, handoff.matter_id, 'fee_confirmation', 'fees', p_confirmed, left(v_note, 500),
          app.gov_actor_membership(handoff.organization_id))
  returning id into new_id;
  perform app.record_audit_event(
    handoff.organization_id, case when p_confirmed then 'submission.fees_confirmed' else 'submission.fees_unconfirmed' end,
    'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id, 'note', v_note)
  );
  return new_id;
end;
$$;
revoke all on function app.confirm_submission_fees(uuid, boolean, text) from public;

-- The firm owner overrides a blocking gate with a reason, after a fresh step-up (GOV-01 criterion 2).
create function app.override_submission_gate(p_handoff_id uuid, p_gate text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  gate_state text;
  new_id uuid;
begin
  if p_gate is null or p_gate not in ('representation', 'deadlines', 'signatures', 'fees', 'outside_steps') then
    raise exception 'that gate cannot be overridden' using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) not between 10 and 500 then
    raise exception 'an override needs a reason of at least 10 characters' using errcode = '22023';
  end if;
  handoff := app.gov_open_handoff(p_handoff_id, array['firm_owner']::public.org_role[], true);
  perform app.require_firm_owner_step_up(handoff.organization_id);
  select item ->> 'state' into gate_state
  from jsonb_array_elements(app.submission_gates_for(handoff.matter_id) -> 'gates') item
  where item ->> 'key' = p_gate;
  if gate_state is distinct from 'blocked' then
    raise exception 'that gate is not blocking' using errcode = '22023';
  end if;
  insert into public.submission_checklist_events (organization_id, handoff_id, matter_id, kind, item_key, ticked, note, membership_id)
  values (handoff.organization_id, handoff.id, handoff.matter_id, 'gate_override', p_gate, true, v_reason,
          app.gov_actor_membership(handoff.organization_id))
  returning id into new_id;
  perform app.record_audit_event(
    handoff.organization_id, 'submission.gate_overridden', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id, 'gate', p_gate, 'reason', v_reason)
  );
  return new_id;
end;
$$;
revoke all on function app.override_submission_gate(uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- Official requirements: entered from an official page, approved by a licensed member
-- ---------------------------------------------------------------------------

-- A federal official host on the allowlist: canada.ca or a gc.ca host.
create function app.federal_official_url(p_url text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host text := app.official_url_host(p_url);
begin
  if v_host is null or app.host_is_allowlisted(v_host) is distinct from true then
    return null;
  end if;
  if not (v_host = 'canada.ca' or right(v_host, 10) = '.canada.ca' or right(v_host, 6) = '.gc.ca') then
    return null;
  end if;
  return v_host;
end;
$$;
revoke all on function app.federal_official_url(text) from public;

create function app.propose_submission_requirement(
  p_org uuid,
  p_program_key text,
  p_channel public.submission_channel,
  p_kind text,
  p_label text,
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
  new_id uuid;
begin
  perform app.require_active_staff(p_org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[], false);
  today := app.firm_today(p_org);
  if p_kind is null or p_kind not in ('outside_step', 'channel_name') then
    raise exception 'choose a step or a channel name' using errcode = '22023';
  end if;
  if p_label is null or length(btrim(p_label)) not between 3 and 300 then
    raise exception 'write the step or name as the official page gives it' using errcode = '22023';
  end if;
  if p_program_key is not null and p_program_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'unknown program' using errcode = '22023';
  end if;
  v_host := app.federal_official_url(url);
  if v_host is null or position('#' in url) = 0 and nullif(btrim(coalesce(p_source_section, '')), '') is null then
    if v_host is null then
      raise exception 'the source must be an official Government of Canada page (canada.ca or gc.ca)' using errcode = '22023';
    end if;
    raise exception 'name the section of the page, or give its link with the section anchor' using errcode = '22023';
  end if;
  if p_checked_on is null or p_checked_on > today or p_checked_on < today - 366 then
    raise exception 'the date checked is required, within the last year and not in the future' using errcode = '22023';
  end if;
  if p_form_modified_on is not null and (p_form_number is null or p_form_modified_on > today) then
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
    insert into public.source_snapshots (
      organization_id, source_id, snapshot_number, final_url, publisher, retrieved_at, current_to, content_hash,
      retrieval_result, http_status, review_status
    ) values (
      p_org, src, 1, snap_url, coalesce(publisher_name, 'Government of Canada'), snap_at, p_current_to, snap_hash,
      'success', nullif(p_snapshot ->> 'http_status', '')::integer, 'evidence_captured'
    )
    returning id into snap;
  end if;

  insert into public.submission_requirements (
    organization_id, program_key, channel, kind, label, source_id, snapshot_id, source_url, source_section,
    form_number, form_modified_on, checked_on, current_to, snapshot_sha256
  ) values (
    p_org, p_program_key, p_channel, p_kind, btrim(p_label), src, snap, url, nullif(btrim(coalesce(p_source_section, '')), ''),
    nullif(upper(btrim(coalesce(p_form_number, ''))), ''), p_form_modified_on, p_checked_on, p_current_to, snap_hash
  )
  returning id into new_id;
  perform app.record_audit_event(
    p_org, 'submission.requirement_entered', 'public.submission_requirements', new_id, 'success',
    jsonb_build_object('kind', p_kind, 'channel', p_channel, 'program_key', p_program_key, 'source_url', url, 'snapshot_sha256', snap_hash)
  );
  return new_id;
end;
$$;
revoke all on function app.propose_submission_requirement(uuid, text, public.submission_channel, text, text, text, text, text, date, date, date, jsonb) from public;

-- A licensed member (fresh step-up) approves or rejects a pending requirement. Approving a
-- channel name retires the name approved before it for the same program and channel.
create function app.review_submission_requirement(p_requirement_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  requirement public.submission_requirements%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  reviewer uuid;
  earlier record;
  new_version integer;
begin
  select * into requirement from public.submission_requirements where id = p_requirement_id for update;
  if requirement.id is null or requirement.organization_id is distinct from app.current_organization_id() then
    raise exception 'requirement review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(requirement.organization_id, true);
  if requirement.version is distinct from p_expected_version then
    raise exception 'requirement version conflict' using errcode = 'PT409';
  end if;
  if requirement.status <> 'pending_review' then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or length(v_note) < 3) then
    raise exception 'say why it''s rejected' using errcode = '22023';
  end if;
  if p_decision = 'approved' and requirement.snapshot_sha256 is null then
    raise exception 'a requirement goes live only with a snapshot of its official page; enter it again when the page can be fetched' using errcode = '42501';
  end if;
  reviewer := app.gov_actor_membership(requirement.organization_id);
  if p_decision = 'approved' and requirement.kind = 'channel_name' then
    for earlier in
      select other.id from public.submission_requirements other
      where other.organization_id = requirement.organization_id and other.kind = 'channel_name' and other.status = 'approved'
        and other.channel = requirement.channel and other.program_key is not distinct from requirement.program_key
    loop
      perform app.gov_open_write(earlier.id);
      update public.submission_requirements
      set status = 'retired', retired_at = statement_timestamp(), review_note = coalesce(review_note, 'Replaced by a newer approved name')
      where id = earlier.id;
      perform app.gov_close_write(earlier.id);
    end loop;
  end if;
  perform app.gov_open_write(requirement.id);
  update public.submission_requirements
  set status = p_decision, reviewed_by_membership_id = reviewer, reviewed_at = statement_timestamp(), review_note = left(v_note, 500)
  where id = requirement.id
  returning version into new_version;
  perform app.gov_close_write(requirement.id);
  perform app.record_audit_event(
    requirement.organization_id, 'submission.requirement_' || p_decision, 'public.submission_requirements', requirement.id, 'success',
    jsonb_build_object('kind', requirement.kind, 'channel', requirement.channel, 'source_url', requirement.source_url, 'snapshot_sha256', requirement.snapshot_sha256)
  );
  return new_version;
end;
$$;
revoke all on function app.review_submission_requirement(uuid, integer, text, text) from public;

-- A licensed member (fresh step-up) retires an approved requirement that no longer matches the page.
create function app.retire_submission_requirement(p_requirement_id uuid, p_expected_version integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  requirement public.submission_requirements%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  new_version integer;
begin
  if v_reason is null or length(v_reason) not between 3 and 500 then
    raise exception 'say why it''s retired' using errcode = '22023';
  end if;
  select * into requirement from public.submission_requirements where id = p_requirement_id for update;
  if requirement.id is null or requirement.organization_id is distinct from app.current_organization_id() then
    raise exception 'requirement review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(requirement.organization_id, true);
  if requirement.version is distinct from p_expected_version then
    raise exception 'requirement version conflict' using errcode = 'PT409';
  end if;
  if requirement.status <> 'approved' then
    raise exception 'only an approved requirement is retired' using errcode = '22023';
  end if;
  perform app.gov_open_write(requirement.id);
  update public.submission_requirements
  set status = 'retired', retired_at = statement_timestamp(), review_note = v_reason
  where id = requirement.id
  returning version into new_version;
  perform app.gov_close_write(requirement.id);
  perform app.record_audit_event(
    requirement.organization_id, 'submission.requirement_retired', 'public.submission_requirements', requirement.id, 'success',
    jsonb_build_object('reason', v_reason)
  );
  return new_version;
end;
$$;
revoke all on function app.retire_submission_requirement(uuid, integer, text) from public;

-- ---------------------------------------------------------------------------
-- Redefinitions
-- ---------------------------------------------------------------------------

-- app.sign_off_submission_handoff(uuid,integer), last defined in 20261023090000_version_conflicts_not_retried.sql.
-- Changed: the sign-off releases the package and pins its manifest (app.gov_pin_manifest); the
-- audit event carries the manifest hash and file count.
create or replace function app.sign_off_submission_handoff(p_handoff_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  reviewer uuid;
  new_version integer;
  pinned jsonb;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'sign-off denied' using errcode = '42501';
  end if;
  perform app.gov_require_licensed(handoff.organization_id);
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = 'PT409';
  end if;
  if handoff.status is distinct from 'awaiting_signoff' then
    raise exception 'this handoff is not waiting for sign-off' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.representation_authorities authority
    where authority.matter_id = handoff.matter_id
      and authority.organization_id = handoff.organization_id
      and authority.revoked_at is null
      and authority.effective_on <= app.firm_today(handoff.organization_id)
  ) then
    raise exception 'representation authority must be on file before sign-off' using errcode = '42501';
  end if;
  reviewer := app.gov_actor_membership(handoff.organization_id);
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'authorized', signoff_membership_id = reviewer, signed_off_at = statement_timestamp()
  where id = handoff.id;
  pinned := app.gov_pin_manifest(handoff);
  select version into new_version from public.submission_handoffs where id = handoff.id;
  perform app.gov_close_write(handoff.id);
  perform app.record_audit_event(
    handoff.organization_id, 'submission.signed_off', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id, 'package_label', handoff.package_label, 'package_sha256', handoff.package_sha256,
                       'manifest_sha256', pinned ->> 'manifest_sha256', 'manifest_files', (pinned ->> 'files')::integer)
  );
  return new_version;
end;
$$;

-- app.record_submission(uuid,integer,text,timestamptz,uuid,uuid,text,date), last defined in 20261023090000_version_conflicts_not_retried.sql.
-- Changed: refuses while a submission checklist gate is blocked (app.submission_gates_for), and the
-- audit event carries the pinned package manifest (version, manifest hash, each file and its hash)
-- and any gate overrides.
create or replace function app.record_submission(
  p_handoff_id uuid,
  p_expected_version integer,
  p_external_reference text,
  p_submitted_at timestamptz,
  p_submitted_by_membership_id uuid,
  p_receipt_version_id uuid,
  p_receipt_locator text,
  p_acknowledged_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  new_version integer;
  gate_state jsonb;
  blocked_list text;
  manifest jsonb;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'submission record denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    handoff.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = 'PT409';
  end if;
  if handoff.status is distinct from 'authorized' then
    raise exception 'a submission is recorded only after consultant sign-off' using errcode = '42501';
  end if;
  gate_state := app.submission_gates_for(handoff.matter_id);
  select string_agg(item #>> '{}', ', ') into blocked_list from jsonb_array_elements(gate_state -> 'blocked') item;
  if blocked_list is not null then
    raise exception 'the submission checklist is not complete: %', blocked_list using errcode = '42501';
  end if;
  if p_external_reference is null or length(btrim(p_external_reference)) not between 1 and 200 then
    raise exception 'the submission reference is required' using errcode = '22023';
  end if;
  if p_submitted_at is null or p_submitted_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'the submission time is required and cannot be in the future' using errcode = '22023';
  end if;
  if p_submitted_at < handoff.signed_off_at - interval '1 day' then
    raise exception 'the submission time is before the consultant sign-off' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships mem
    where mem.id = p_submitted_by_membership_id
      and mem.organization_id = handoff.organization_id
      and app.membership_is_licensed(mem.id)
  ) then
    raise exception 'the submitting representative must be a licensed member of this firm' using errcode = '42501';
  end if;
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'submission_unverified',
      external_reference = btrim(p_external_reference),
      submitted_at = p_submitted_at,
      submitted_by_membership_id = p_submitted_by_membership_id
  where id = handoff.id
  returning version into new_version;
  perform app.gov_close_write(handoff.id);
  select coalesce(jsonb_agg(jsonb_build_object('position', pinned.position, 'file', pinned.file_name, 'version_id', pinned.document_version_id, 'sha256', pinned.file_sha256) order by pinned.position), '[]'::jsonb)
  into manifest
  from public.submission_manifest_files pinned
  where pinned.handoff_id = handoff.id;
  perform app.record_audit_event(
    handoff.organization_id, 'submission.recorded', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object(
      'matter_id', handoff.matter_id,
      'submitted_by', p_submitted_by_membership_id,
      'package_label', handoff.package_label,
      'manifest_sha256', handoff.manifest_sha256,
      'manifest', manifest,
      'overridden', (select coalesce(jsonb_agg(item ->> 'key'), '[]'::jsonb) from jsonb_array_elements(gate_state -> 'gates') item where item ->> 'state' = 'overridden')
    )
  );
  if p_receipt_version_id is not null or nullif(btrim(coalesce(p_receipt_locator, '')), '') is not null then
    new_version := app.gov_finish_verification(handoff.id, p_receipt_version_id, p_receipt_locator, p_acknowledged_on);
  elsif p_acknowledged_on is not null then
    raise exception 'an acknowledgement date needs the receipt' using errcode = '22023';
  end if;
  return new_version;
end;
$$;

-- app.gov_finish_verification(uuid,uuid,text,date), last defined in 20261019216100_firm_today_rules.sql.
-- Changed (GOV-03): verification needs the government confirmation stored as a file on the matter
-- AND the acknowledgement date, entered separately. A note of where the receipt is kept is kept
-- with it but no longer verifies on its own.
create or replace function app.gov_finish_verification(
  p_handoff_id uuid,
  p_receipt_version_id uuid,
  p_receipt_locator text,
  p_acknowledged_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  evidence uuid;
  new_version integer;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id;
  if p_receipt_version_id is null then
    raise exception 'receipt evidence is required to verify a submission: upload the government confirmation' using errcode = '22023';
  end if;
  if app.gov_evidence_on_matter(p_receipt_version_id, handoff.matter_id, handoff.organization_id) is distinct from true then
    raise exception 'the receipt must be a stored file on this matter' using errcode = '42501';
  end if;
  if p_acknowledged_on is null then
    raise exception 'the acknowledgement date is required with the receipt' using errcode = '22023';
  end if;
  if p_acknowledged_on > app.firm_today(handoff.organization_id) then
    raise exception 'an acknowledgement date cannot be in the future' using errcode = '22023';
  end if;
  handoff.receipt_version_id := p_receipt_version_id;
  handoff.receipt_locator := nullif(btrim(coalesce(p_receipt_locator, '')), '');
  evidence := app.gov_submission_evidence(
    handoff,
    coalesce(handoff.receipt_locator, 'document version ' || p_receipt_version_id::text)
  );
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'submission_verified',
      receipt_version_id = p_receipt_version_id,
      receipt_locator = handoff.receipt_locator,
      acknowledged_on = coalesce(p_acknowledged_on, acknowledged_on),
      verified_by_membership_id = app.gov_actor_membership(handoff.organization_id),
      verified_at = statement_timestamp(),
      stage_evidence_id = evidence
  where id = handoff.id
  returning version into new_version;
  perform app.gov_close_write(handoff.id);
  if (select government_status from public.matters where id = handoff.matter_id) = 'not_recorded' then
    perform app.gov_set_matter_status(handoff.matter_id, 'receipt_on_file');
  end if;
  perform app.record_audit_event(
    handoff.organization_id, 'submission.verified', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id, 'stage_evidence_id', evidence, 'receipt_file', p_receipt_version_id is not null,
                       'acknowledged_on', p_acknowledged_on)
  );
  return new_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invoker wrappers (the definer bodies enforce role, scope, step-up, and licence)
-- ---------------------------------------------------------------------------
create function public.submission_checklist(p_matter_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app.submission_checklist(p_matter_id); $$;

create function public.tick_submission_step(p_handoff_id uuid, p_requirement_id uuid, p_ticked boolean)
returns uuid language sql security invoker set search_path = ''
as $$ select app.tick_submission_step(p_handoff_id, p_requirement_id, p_ticked); $$;

create function public.confirm_submission_fees(p_handoff_id uuid, p_confirmed boolean, p_note text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.confirm_submission_fees(p_handoff_id, p_confirmed, p_note); $$;

create function public.override_submission_gate(p_handoff_id uuid, p_gate text, p_reason text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.override_submission_gate(p_handoff_id, p_gate, p_reason); $$;

create function public.propose_submission_requirement(
  p_org uuid, p_program_key text, p_channel public.submission_channel, p_kind text, p_label text, p_source_url text,
  p_source_section text, p_form_number text, p_form_modified_on date, p_checked_on date, p_current_to date, p_snapshot jsonb
)
returns uuid language sql security invoker set search_path = ''
as $$
  select app.propose_submission_requirement(
    p_org, p_program_key, p_channel, p_kind, p_label, p_source_url, p_source_section, p_form_number, p_form_modified_on,
    p_checked_on, p_current_to, p_snapshot
  );
$$;

create function public.review_submission_requirement(p_requirement_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_submission_requirement(p_requirement_id, p_expected_version, p_decision, p_note); $$;

create function public.retire_submission_requirement(p_requirement_id uuid, p_expected_version integer, p_reason text)
returns integer language sql security invoker set search_path = ''
as $$ select app.retire_submission_requirement(p_requirement_id, p_expected_version, p_reason); $$;

revoke all on function public.submission_checklist(uuid) from public, anon;
revoke all on function public.tick_submission_step(uuid, uuid, boolean) from public, anon;
revoke all on function public.confirm_submission_fees(uuid, boolean, text) from public, anon;
revoke all on function public.override_submission_gate(uuid, text, text) from public, anon;
revoke all on function public.propose_submission_requirement(uuid, text, public.submission_channel, text, text, text, text, text, date, date, date, jsonb) from public, anon;
revoke all on function public.review_submission_requirement(uuid, integer, text, text) from public, anon;
revoke all on function public.retire_submission_requirement(uuid, integer, text) from public, anon;

grant execute on function public.submission_checklist(uuid) to authenticated, service_role;
grant execute on function public.tick_submission_step(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.confirm_submission_fees(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.override_submission_gate(uuid, text, text) to authenticated, service_role;
grant execute on function public.propose_submission_requirement(uuid, text, public.submission_channel, text, text, text, text, text, date, date, date, jsonb) to authenticated, service_role;
grant execute on function public.review_submission_requirement(uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.retire_submission_requirement(uuid, integer, text) to authenticated, service_role;

grant execute on function app.submission_checklist(uuid) to authenticated, service_role;
grant execute on function app.tick_submission_step(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function app.confirm_submission_fees(uuid, boolean, text) to authenticated, service_role;
grant execute on function app.override_submission_gate(uuid, text, text) to authenticated, service_role;
grant execute on function app.propose_submission_requirement(uuid, text, public.submission_channel, text, text, text, text, text, date, date, date, jsonb) to authenticated, service_role;
grant execute on function app.review_submission_requirement(uuid, integer, text, text) to authenticated, service_role;
grant execute on function app.retire_submission_requirement(uuid, integer, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security. Reads only; every write is a function above.
-- ---------------------------------------------------------------------------
revoke all on table public.submission_manifest_files from public, anon, authenticated;
revoke all on table public.submission_requirements from public, anon, authenticated;
revoke all on table public.submission_checklist_events from public, anon, authenticated;
grant select on table public.submission_manifest_files to authenticated;
grant select on table public.submission_requirements to authenticated;
grant select on table public.submission_checklist_events to authenticated;

alter table public.submission_manifest_files enable row level security;
alter table public.submission_manifest_files force row level security;
alter table public.submission_requirements enable row level security;
alter table public.submission_requirements force row level security;
alter table public.submission_checklist_events enable row level security;
alter table public.submission_checklist_events force row level security;

create policy submission_manifest_files_select on public.submission_manifest_files
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.submission_handoffs handoff
      where handoff.id = submission_manifest_files.handoff_id
        and (select app.gov_staff_can_read(handoff.matter_id, handoff.organization_id))
    )
  );

-- Firm content, not client data: the firm's staff (two-step) read it.
create policy submission_requirements_select on public.submission_requirements
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

create policy submission_checklist_events_select on public.submission_checklist_events
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.gov_staff_can_read(matter_id, organization_id))
  );
