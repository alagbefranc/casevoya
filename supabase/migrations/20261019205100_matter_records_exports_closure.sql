-- T040 / T041: report export audit, portable matter file export jobs, legal holds, and matter
-- closure with a retention date from the firm's own setting (PRD §16 SEC-01/03/04/07, §17 REP-03).
--
-- Report exports: public.record_report_export checks the role for the tab and writes the audit row
-- before the server draws a CSV or PDF. Nothing is stored.
--
-- Client-file exports (matter_exports): a staff member who can read the matter, with a recent
-- step-up (SEC-01), starts an export. The server then collects the matter's records as that person
-- (RLS decides what is included), writes a ZIP with a manifest (SHA-256 of every file) to the
-- private 'matter-exports' bucket with the service role, and marks the job ready. Downloads go
-- through public.authorize_matter_export_download (requester or firm owner, fresh step-up, inside the
-- 24-hour window) and a 60-second signed link. Every step is audited. Cloudflare Workers has no
-- long-running background jobs here, so the package is built on request with size limits; a job
-- still 'building' after 15 minutes is marked failed when anyone next starts one.
--
-- Legal holds (matter_legal_holds): the firm owner places and releases them with a step-up and a
-- reason. While a hold is active, deleting the matter or its linked records (documents, document
-- versions, exports, tasks, deadlines, stage evidence, agreements, invoices) is refused by trigger.
--
-- Closure (matter_closures): public.close_matter closes a post-decision matter. It refuses while the
-- matter's client-fund ledger holds or awaits money, or an issued invoice is unpaid, unless the firm
-- owner records a reviewed reason after a step-up. The retention date is the closure date plus the
-- firm's own retention setting (organizations.retention_policy, chosen by the firm in setup).
-- Casevoya does not supply a legal retention period; every closure is marked
-- retention_review_required until a professional review process exists (docs/DECISIONS.md).
-- Additive only. Redefines no existing function.

-- ---------------------------------------------------------------------------
-- Report exports (REP-03)
-- ---------------------------------------------------------------------------

create function public.record_report_export(p_organization_id uuid, p_tab text, p_range text, p_format text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  roles public.org_role[];
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_tab not in ('ops', 'money', 'outcomes') or p_range not in ('90d', 'month', 'year') or p_format not in ('csv', 'pdf') then
    raise exception 'choose a report, period and format' using errcode = '22023';
  end if;
  roles := case when p_tab = 'money'
    then array['firm_owner', 'finance_user']::public.org_role[]
    else array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
  end;
  if p_organization_id is null
     or p_organization_id is distinct from (select app.current_organization_id())
     or app.in_active_org(p_organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(p_organization_id, roles) is distinct from true then
    raise exception 'report export denied' using errcode = '42501';
  end if;
  return app.record_audit_event(
    p_organization_id,
    'report.exported',
    null,
    null,
    'success',
    jsonb_build_object('tab', p_tab, 'range', p_range, 'format', p_format)
  );
end;
$$;
revoke all on function public.record_report_export(uuid, text, text, text) from public, anon;
grant execute on function public.record_report_export(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Legal holds
-- ---------------------------------------------------------------------------

create table public.matter_legal_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  placed_by uuid not null references auth.users (id),
  placed_at timestamptz not null default now(),
  released_by uuid references auth.users (id),
  released_at timestamptz,
  release_reason text check (release_reason is null or length(btrim(release_reason)) between 10 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  check ((released_at is null) = (released_by is null) and (released_at is null) = (release_reason is null))
);
comment on table public.matter_legal_holds is
  'Legal holds on a matter. While one is active (released_at is null) deleting the matter or its linked records is refused. Placed and released by the firm owner with a reason; never deleted.';

create index matter_legal_holds_matter_org_fk_idx on public.matter_legal_holds (matter_id, organization_id);
create index matter_legal_holds_placed_by_idx on public.matter_legal_holds (placed_by);
create index matter_legal_holds_released_by_idx on public.matter_legal_holds (released_by);
create index matter_legal_holds_created_by_idx on public.matter_legal_holds (created_by);
create unique index matter_legal_holds_one_active_idx on public.matter_legal_holds (matter_id) where released_at is null;

create function app.guard_legal_hold_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'legal holds are kept on record' using errcode = '42501';
  end if;
  if (new.organization_id, new.matter_id, new.reason, new.placed_by, new.placed_at)
     is distinct from (old.organization_id, old.matter_id, old.reason, old.placed_by, old.placed_at)
     or old.released_at is not null then
    raise exception 'legal holds are kept on record' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_legal_hold_change() from public, anon, authenticated;

create trigger matter_legal_holds_guard before update or delete on public.matter_legal_holds
  for each row execute function app.guard_legal_hold_change();
create trigger matter_legal_holds_touch before update on public.matter_legal_holds
  for each row execute function app.touch_row();
create trigger matter_legal_holds_stamp before insert on public.matter_legal_holds
  for each row execute function app.stamp_created_by();
create trigger matter_legal_holds_audit after insert or update or delete on public.matter_legal_holds
  for each row execute function app.audit_row_change();

alter table public.matter_legal_holds enable row level security;
alter table public.matter_legal_holds force row level security;
revoke all on table public.matter_legal_holds from public, anon;
revoke insert, update, delete on table public.matter_legal_holds from authenticated;
grant select on table public.matter_legal_holds to authenticated;

create policy matter_legal_holds_select on public.matter_legal_holds
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant', 'finance_user']::public.org_role[]
    ))
    and app.can_read_matter(matter_id)
  );

create function app.matter_on_legal_hold(p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.matter_legal_holds hold
    where hold.matter_id = p_matter_id and hold.released_at is null
  );
$$;
revoke all on function app.matter_on_legal_hold(uuid) from public, anon;
grant execute on function app.matter_on_legal_hold(uuid) to authenticated, service_role;

-- Deletion guard: a row of a held matter cannot be deleted by anyone, the service role included.
create function app.guard_legal_hold_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  held boolean := false;
begin
  if tg_table_name = 'matters' then
    held := app.matter_on_legal_hold(old.id);
  elsif tg_table_name = 'documents' then
    select exists (
      select 1 from public.document_matter_refs ref
      where ref.document_id = old.id and app.matter_on_legal_hold(ref.matter_id)
    ) into held;
  elsif tg_table_name = 'document_versions' then
    select exists (
      select 1 from public.document_matter_refs ref
      where ref.document_id = old.document_id and app.matter_on_legal_hold(ref.matter_id)
    ) into held;
  else
    held := app.matter_on_legal_hold((to_jsonb(old) ->> 'matter_id')::uuid);
  end if;
  if held then
    raise exception 'this record is under a legal hold and cannot be deleted' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function app.guard_legal_hold_delete() from public, anon, authenticated;

create trigger zz_legal_hold_delete before delete on public.matters
  for each row execute function app.guard_legal_hold_delete();
create trigger zz_legal_hold_delete before delete on public.documents
  for each row execute function app.guard_legal_hold_delete();
create trigger zz_legal_hold_delete before delete on public.document_versions
  for each row execute function app.guard_legal_hold_delete();
create trigger zz_legal_hold_delete before delete on public.document_matter_refs
  for each row execute function app.guard_legal_hold_delete();
create trigger zz_legal_hold_delete before delete on public.tasks
  for each row execute function app.guard_legal_hold_delete();
create trigger zz_legal_hold_delete before delete on public.deadlines
  for each row execute function app.guard_legal_hold_delete();
create trigger zz_legal_hold_delete before delete on public.matter_stage_evidence
  for each row execute function app.guard_legal_hold_delete();
create trigger zz_legal_hold_delete before delete on public.agreements
  for each row execute function app.guard_legal_hold_delete();
create trigger zz_legal_hold_delete before delete on public.invoices
  for each row execute function app.guard_legal_hold_delete();

-- The firm owner, in the active firm, after a recent step-up.
create function app.require_owner_step_up_for_matter(p_matter_id uuid)
returns public.matters
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null
     or matter.organization_id is distinct from (select app.current_organization_id())
     or app.in_active_org(matter.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(matter.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'only the firm owner can do this' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  return matter;
end;
$$;
revoke all on function app.require_owner_step_up_for_matter(uuid) from public, anon, authenticated;

create function public.place_legal_hold(p_matter_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  hold_id uuid;
begin
  matter := app.require_owner_step_up_for_matter(p_matter_id);
  if p_reason is null or length(btrim(p_reason)) not between 10 and 1000 then
    raise exception 'a legal hold needs a reason of at least 10 characters' using errcode = '22023';
  end if;
  if app.matter_on_legal_hold(matter.id) then
    raise exception 'this matter is already under a legal hold' using errcode = '23505';
  end if;
  insert into public.matter_legal_holds (organization_id, matter_id, reason, placed_by)
  values (matter.organization_id, matter.id, btrim(p_reason), (select auth.uid()))
  returning id into hold_id;
  perform app.record_audit_event(matter.organization_id, 'matter.legal_hold_placed', 'public.matter_legal_holds', hold_id, 'success',
    jsonb_build_object('matter_id', matter.id));
  return hold_id;
end;
$$;
revoke all on function public.place_legal_hold(uuid, text) from public, anon;
grant execute on function public.place_legal_hold(uuid, text) to authenticated;

create function public.release_legal_hold(p_hold_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  hold public.matter_legal_holds%rowtype;
begin
  select * into hold from public.matter_legal_holds where id = p_hold_id for update;
  if hold.id is null then
    raise exception 'only the firm owner can do this' using errcode = '42501';
  end if;
  perform app.require_owner_step_up_for_matter(hold.matter_id);
  if hold.released_at is not null then
    raise exception 'this legal hold was already released' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 1000 then
    raise exception 'releasing a legal hold needs a reason of at least 10 characters' using errcode = '22023';
  end if;
  update public.matter_legal_holds
     set released_at = now(), released_by = (select auth.uid()), release_reason = btrim(p_reason)
   where id = hold.id;
  perform app.record_audit_event(hold.organization_id, 'matter.legal_hold_released', 'public.matter_legal_holds', hold.id, 'success',
    jsonb_build_object('matter_id', hold.matter_id));
end;
$$;
revoke all on function public.release_legal_hold(uuid, text) from public, anon;
grant execute on function public.release_legal_hold(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Client-file exports
-- ---------------------------------------------------------------------------

create table public.matter_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  status public.matter_export_status not null default 'building',
  stage text not null default 'collect' check (stage in ('collect', 'manifest', 'package', 'ready')),
  progress integer not null default 0 check (progress between 0 and 100),
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  requested_by uuid not null references auth.users (id),
  requested_at timestamptz not null default now(),
  file_count integer check (file_count is null or file_count >= 0),
  record_count integer check (record_count is null or record_count >= 0),
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  storage_bucket text check (storage_bucket is null or storage_bucket = 'matter-exports'),
  storage_key text check (storage_key is null or length(storage_key) between 10 and 400),
  contents jsonb not null default '{}'::jsonb check (jsonb_typeof(contents) = 'object'),
  excluded jsonb not null default '[]'::jsonb check (jsonb_typeof(excluded) = 'array'),
  ready_at timestamptz,
  expires_at timestamptz,
  failed_at timestamptz,
  failure_reason text check (failure_reason is null or length(btrim(failure_reason)) between 3 and 500),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id),
  download_count integer not null default 0 check (download_count >= 0),
  last_downloaded_at timestamptz,
  last_downloaded_by uuid references auth.users (id),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  check (status <> 'ready' or (sha256 is not null and manifest_sha256 is not null and storage_key is not null
    and storage_bucket is not null and ready_at is not null and expires_at is not null and file_count is not null and byte_size is not null)),
  check (status <> 'failed' or (failed_at is not null and failure_reason is not null)),
  check (status <> 'cancelled' or (cancelled_at is not null and cancelled_by is not null))
);
comment on table public.matter_exports is
  'Portable client-file exports (T040): a ZIP of a matter''s records and documents with a SHA-256 manifest, stored in the private matter-exports bucket. Written only by functions; downloads use 60-second signed links within 24 hours of ready.';

create index matter_exports_matter_org_fk_idx on public.matter_exports (matter_id, organization_id);
create index matter_exports_org_requested_idx on public.matter_exports (organization_id, requested_at desc);
create index matter_exports_requested_by_idx on public.matter_exports (requested_by);
create index matter_exports_cancelled_by_idx on public.matter_exports (cancelled_by);
create index matter_exports_last_downloaded_by_idx on public.matter_exports (last_downloaded_by);
create index matter_exports_created_by_idx on public.matter_exports (created_by);
create unique index matter_exports_one_building_idx on public.matter_exports (matter_id) where status = 'building';

create function app.guard_matter_export_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.organization_id, new.matter_id, new.idempotency_key, new.requested_by, new.requested_at, new.is_sample)
     is distinct from (old.organization_id, old.matter_id, old.idempotency_key, old.requested_by, old.requested_at, old.is_sample) then
    raise exception 'export jobs keep who asked and for which matter' using errcode = '42501';
  end if;
  if old.status in ('failed', 'cancelled') then
    raise exception 'this export is finished' using errcode = '42501';
  end if;
  if old.status = 'ready' and (new.status <> 'ready'
     or (new.sha256, new.manifest_sha256, new.storage_key, new.byte_size, new.file_count, new.expires_at)
        is distinct from (old.sha256, old.manifest_sha256, old.storage_key, old.byte_size, old.file_count, old.expires_at)) then
    raise exception 'a ready export is not changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_matter_export_change() from public, anon, authenticated;

create trigger matter_exports_guard before update on public.matter_exports
  for each row execute function app.guard_matter_export_change();
create trigger matter_exports_touch before update on public.matter_exports
  for each row execute function app.touch_row();
create trigger matter_exports_stamp before insert on public.matter_exports
  for each row execute function app.stamp_created_by();
create trigger matter_exports_audit after insert or update or delete on public.matter_exports
  for each row execute function app.audit_row_change();
create trigger zz_legal_hold_delete before delete on public.matter_exports
  for each row execute function app.guard_legal_hold_delete();

alter table public.matter_exports enable row level security;
alter table public.matter_exports force row level security;
revoke all on table public.matter_exports from public, anon;
revoke insert, update, delete on table public.matter_exports from authenticated;
grant select on table public.matter_exports to authenticated;

-- The people who may export a matter see its export jobs.
create policy matter_exports_select on public.matter_exports
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
    ))
    and app.can_read_matter(matter_id)
  );

-- Export access: firm owner, licensed consultant or case manager who can read the matter, at aal2.
create function app.require_export_access(p_matter_id uuid)
returns public.matters
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null
     or matter.organization_id is distinct from (select app.current_organization_id())
     or app.in_active_org(matter.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.can_read_matter(matter.id) is distinct from true
     or app.has_org_role(
       matter.organization_id,
       array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
     ) is distinct from true then
    raise exception 'export access denied' using errcode = '42501';
  end if;
  return matter;
end;
$$;
revoke all on function app.require_export_access(uuid) from public, anon, authenticated;

create function public.start_matter_export(p_matter_id uuid, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  key text := btrim(coalesce(p_idempotency_key, ''));
  existing public.matter_exports%rowtype;
  export_id uuid;
begin
  matter := app.require_export_access(p_matter_id);
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select * into existing from public.matter_exports
   where organization_id = matter.organization_id and idempotency_key = key;
  if existing.id is not null then
    if existing.requested_by is distinct from (select auth.uid()) or existing.matter_id <> matter.id then
      raise exception 'export access denied' using errcode = '42501';
    end if;
    return existing.id;
  end if;
  -- A build that never finished (the request was cut off) stops blocking new exports after 15 minutes.
  update public.matter_exports
     set status = 'failed', failed_at = now(), failure_reason = 'The build did not finish in time.'
   where matter_id = matter.id and status = 'building' and requested_at < now() - interval '15 minutes';
  if exists (select 1 from public.matter_exports where matter_id = matter.id and status = 'building') then
    raise exception 'an export of this matter is already building' using errcode = '23505';
  end if;
  insert into public.matter_exports (organization_id, matter_id, idempotency_key, requested_by, is_sample)
  values (matter.organization_id, matter.id, key, (select auth.uid()), matter.is_sample)
  returning id into export_id;
  perform app.record_audit_event(matter.organization_id, 'matter_export.started', 'public.matter_exports', export_id, 'success',
    jsonb_build_object('matter_id', matter.id));
  return export_id;
end;
$$;
revoke all on function public.start_matter_export(uuid, text) from public, anon;
grant execute on function public.start_matter_export(uuid, text) to authenticated;

create function public.cancel_matter_export(p_export_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.matter_exports%rowtype;
begin
  select * into job from public.matter_exports where id = p_export_id for update;
  if job.id is null then
    raise exception 'export access denied' using errcode = '42501';
  end if;
  perform app.require_export_access(job.matter_id);
  if job.requested_by is distinct from (select auth.uid())
     and app.has_org_role(job.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'export access denied' using errcode = '42501';
  end if;
  if job.status <> 'building' then
    raise exception 'only a building export can be cancelled' using errcode = '22023';
  end if;
  update public.matter_exports
     set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid())
   where id = job.id;
  perform app.record_audit_event(job.organization_id, 'matter_export.cancelled', 'public.matter_exports', job.id, 'success',
    jsonb_build_object('matter_id', job.matter_id));
end;
$$;
revoke all on function public.cancel_matter_export(uuid) from public, anon;
grant execute on function public.cancel_matter_export(uuid) to authenticated;

-- A download: the requester or the firm owner, who can still read the matter, after a recent
-- step-up, inside the 24-hour window. Returns where the file is; the server signs a 60-second link.
create function public.authorize_matter_export_download(p_export_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.matter_exports%rowtype;
begin
  select * into job from public.matter_exports where id = p_export_id for update;
  if job.id is null then
    raise exception 'export access denied' using errcode = '42501';
  end if;
  perform app.require_export_access(job.matter_id);
  if job.requested_by is distinct from (select auth.uid())
     and app.has_org_role(job.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'export access denied' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  if job.status <> 'ready' then
    raise exception 'this export is not ready' using errcode = '22023';
  end if;
  if job.expires_at <= now() then
    raise exception 'this export link has expired' using errcode = '22023';
  end if;
  update public.matter_exports
     set download_count = download_count + 1, last_downloaded_at = now(), last_downloaded_by = (select auth.uid())
   where id = job.id;
  perform app.record_audit_event(job.organization_id, 'matter_export.downloaded', 'public.matter_exports', job.id, 'success',
    jsonb_build_object('matter_id', job.matter_id, 'sha256', job.sha256));
  return jsonb_build_object('bucket', job.storage_bucket, 'storage_key', job.storage_key, 'seconds', 60, 'sha256', job.sha256);
end;
$$;
revoke all on function public.authorize_matter_export_download(uuid) from public, anon;
grant execute on function public.authorize_matter_export_download(uuid) to authenticated;

-- The server's build steps. Service role only: browsers never report progress or a file.
create function public.service_matter_export_progress(p_export_id uuid, p_stage text, p_progress integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.matter_exports
     set stage = p_stage, progress = greatest(progress, least(100, greatest(0, p_progress)))
   where id = p_export_id and status = 'building';
end;
$$;
revoke all on function public.service_matter_export_progress(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.service_matter_export_progress(uuid, text, integer) to service_role;

create function public.service_complete_matter_export(
  p_export_id uuid,
  p_storage_key text,
  p_sha256 text,
  p_byte_size bigint,
  p_file_count integer,
  p_record_count integer,
  p_manifest_sha256 text,
  p_contents jsonb,
  p_excluded jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.matter_exports%rowtype;
begin
  select * into job from public.matter_exports where id = p_export_id for update;
  if job.id is null or job.status <> 'building' then
    return false;
  end if;
  if p_storage_key is null or p_storage_key not like job.organization_id::text || '/' || job.id::text || '/%' then
    raise exception 'export file must be stored under its own job' using errcode = '22023';
  end if;
  update public.matter_exports
     set status = 'ready', stage = 'ready', progress = 100,
         storage_bucket = 'matter-exports', storage_key = p_storage_key, sha256 = p_sha256, byte_size = p_byte_size,
         file_count = p_file_count, record_count = p_record_count, manifest_sha256 = p_manifest_sha256,
         contents = coalesce(p_contents, '{}'::jsonb), excluded = coalesce(p_excluded, '[]'::jsonb),
         ready_at = now(), expires_at = now() + interval '24 hours'
   where id = job.id;
  perform app.record_audit_event(job.organization_id, 'matter_export.ready', 'public.matter_exports', job.id, 'success',
    jsonb_build_object('matter_id', job.matter_id, 'requested_by', job.requested_by, 'sha256', p_sha256,
      'files', p_file_count, 'bytes', p_byte_size));
  return true;
end;
$$;
revoke all on function public.service_complete_matter_export(uuid, text, text, bigint, integer, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.service_complete_matter_export(uuid, text, text, bigint, integer, integer, text, jsonb, jsonb) to service_role;

create function public.service_fail_matter_export(p_export_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.matter_exports%rowtype;
begin
  select * into job from public.matter_exports where id = p_export_id for update;
  if job.id is null or job.status <> 'building' then
    return;
  end if;
  update public.matter_exports
     set status = 'failed', failed_at = now(), failure_reason = left(coalesce(nullif(btrim(p_reason), ''), 'The export failed.'), 500)
   where id = job.id;
  perform app.record_audit_event(job.organization_id, 'matter_export.failed', 'public.matter_exports', job.id, 'failure',
    jsonb_build_object('matter_id', job.matter_id, 'requested_by', job.requested_by));
end;
$$;
revoke all on function public.service_fail_matter_export(uuid, text) from public, anon, authenticated;
grant execute on function public.service_fail_matter_export(uuid, text) to service_role;

-- The private bucket. No storage.objects policies: only the service role writes or signs links.
do $matter_exports_bucket$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public)
  values ('matter-exports', 'matter-exports', false)
  on conflict (id) do nothing;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    execute $limits$
      update storage.buckets
         set file_size_limit = 52428800,
             allowed_mime_types = array['application/zip']
       where id = 'matter-exports'
    $limits$;
  end if;
end
$matter_exports_bucket$;

-- ---------------------------------------------------------------------------
-- Closure and retention
-- ---------------------------------------------------------------------------

create table public.matter_closures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  closed_on date not null,
  closed_at timestamptz not null default now(),
  closed_by uuid not null references auth.users (id),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  blockers jsonb not null default '{}'::jsonb check (jsonb_typeof(blockers) = 'object'),
  override_reason text check (override_reason is null or length(btrim(override_reason)) between 10 and 1000),
  retention_policy jsonb not null check (jsonb_typeof(retention_policy) = 'object'),
  retention_years integer not null check (retention_years between 1 and 100),
  retention_on date not null,
  retention_review_required boolean not null default true,
  custodian_membership_id uuid,
  legal_hold_active boolean not null,
  evidence_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (custodian_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (evidence_id, organization_id) references public.matter_stage_evidence (id, organization_id),
  check (retention_on > closed_on)
);
comment on table public.matter_closures is
  'Each closure of a matter (SEC-07): closure date, reason, any reviewed override of open money, the firm''s retention setting as it was, retention end, custodian and legal-hold status. Append-only; reopening keeps the row. retention_review_required: the period is the firm''s own setting, not a reviewed legal period.';
comment on column public.matter_closures.retention_review_required is
  'True: the retention period came from the firm''s setting and has not been confirmed by a professional review. Casevoya supplies no statutory period.';

create index matter_closures_matter_org_fk_idx on public.matter_closures (matter_id, organization_id);
create index matter_closures_closed_by_idx on public.matter_closures (closed_by);
create index matter_closures_custodian_org_fk_idx on public.matter_closures (custodian_membership_id, organization_id);
create index matter_closures_evidence_org_fk_idx on public.matter_closures (evidence_id, organization_id);
create index matter_closures_created_by_idx on public.matter_closures (created_by);

create function app.guard_matter_closure_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'closures are kept on record' using errcode = '42501';
end;
$$;
revoke all on function app.guard_matter_closure_change() from public, anon, authenticated;

create trigger matter_closures_guard before update or delete on public.matter_closures
  for each row execute function app.guard_matter_closure_change();
create trigger matter_closures_stamp before insert on public.matter_closures
  for each row execute function app.stamp_created_by();
create trigger matter_closures_audit after insert or update or delete on public.matter_closures
  for each row execute function app.audit_row_change();

alter table public.matter_closures enable row level security;
alter table public.matter_closures force row level security;
revoke all on table public.matter_closures from public, anon;
revoke insert, update, delete on table public.matter_closures from authenticated;
grant select on table public.matter_closures to authenticated;

create policy matter_closures_select on public.matter_closures
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.staff_mfa_satisfied())
    and (select app.has_org_role(
      organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant', 'finance_user']::public.org_role[]
    ))
    and app.can_read_matter(matter_id)
  );

-- What stops a matter from closing: money held or awaiting verification in its client-fund ledger,
-- and issued invoices with an amount still owed. Read-only; callers check access.
create function app.matter_closure_blockers(p_matter_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'client_funds_held_cents', coalesce((
      select sum(case
        when entry.kind = 'deposit' and entry.status = 'verified' then entry.amount_cents
        when entry.kind = 'transfer' and entry.status = 'approved' then -entry.amount_cents
        when entry.kind in ('refund', 'correction') then
          case entry.direction when 'in' then entry.amount_cents else -entry.amount_cents end
        else 0
      end)
      from public.client_fund_entries entry
      where entry.matter_id = p_matter_id
    ), 0)::bigint,
    'client_funds_pending_cents', coalesce((
      select sum(entry.amount_cents)
      from public.client_fund_entries entry
      where entry.matter_id = p_matter_id and entry.kind = 'deposit' and entry.status = 'pending_verification'
    ), 0)::bigint,
    'unpaid_invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'number', invoice.number,
        'owed_cents', invoice.amount_cents - invoice.paid_cents - invoice.credited_cents,
        'currency', invoice.currency
      ) order by invoice.number)
      from public.invoices invoice
      where invoice.matter_id = p_matter_id
        and invoice.status in ('issued', 'partially_paid')
        and invoice.amount_cents - invoice.paid_cents - invoice.credited_cents > 0
    ), '[]'::jsonb)
  );
$$;
revoke all on function app.matter_closure_blockers(uuid) from public, anon, authenticated;

create function app.closure_blocked(p_blockers jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_blockers ->> 'client_funds_held_cents')::bigint <> 0
      or (p_blockers ->> 'client_funds_pending_cents')::bigint <> 0
      or jsonb_array_length(p_blockers -> 'unpaid_invoices') > 0;
$$;
revoke all on function app.closure_blocked(jsonb) from public, anon;

-- The closure checklist for one matter, for the people who may read it.
create function public.matter_closure_check(p_matter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  policy jsonb;
  blockers jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null
     or matter.organization_id is distinct from (select app.current_organization_id())
     or app.staff_mfa_satisfied() is distinct from true
     or app.can_read_matter(matter.id) is distinct from true
     or app.has_org_role(
       matter.organization_id,
       array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant', 'finance_user']::public.org_role[]
     ) is distinct from true then
    raise exception 'closure check denied' using errcode = '42501';
  end if;
  select org.retention_policy into policy from public.organizations org where org.id = matter.organization_id;
  blockers := app.matter_closure_blockers(matter.id);
  return jsonb_build_object(
    'stage', matter.stage,
    'outcome', matter.outcome,
    'blockers', blockers,
    'blocked', app.closure_blocked(blockers),
    'retention_policy', policy,
    'legal_hold', app.matter_on_legal_hold(matter.id)
  );
end;
$$;
revoke all on function public.matter_closure_check(uuid) from public, anon;
grant execute on function public.matter_closure_check(uuid) to authenticated;

-- Close a post-decision matter: closure evidence, the closure record, the stage change through
-- app.transition_matter_stage (licence and version checks stay there), and the retention date.
create function public.close_matter(
  p_matter_id uuid,
  p_expected_version integer,
  p_reason text,
  p_override_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  org public.organizations%rowtype;
  blockers jsonb;
  override text := nullif(btrim(coalesce(p_override_reason, '')), '');
  keep_years integer;
  closed_on date;
  custodian uuid;
  evidence uuid;
  closure_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = p_matter_id for update;
  if matter.id is null
     or matter.organization_id is distinct from (select app.current_organization_id())
     or app.in_active_org(matter.organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.can_read_matter(matter.id) is distinct from true
     or app.has_org_role(matter.organization_id, array['firm_owner', 'licensed_consultant']::public.org_role[]) is distinct from true then
    raise exception 'matter closure denied' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a closure needs a reason' using errcode = '22023';
  end if;
  if matter.version is distinct from p_expected_version then
    raise exception 'matter version conflict' using errcode = '40001';
  end if;
  if matter.stage <> 'post_decision' then
    raise exception 'a matter closes from the post-decision stage' using errcode = '22023';
  end if;
  select * into org from public.organizations where id = matter.organization_id;
  if org.sample_mode and not matter.is_sample then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if org.retention_policy is null or (org.retention_policy ->> 'unit') is distinct from 'years' then
    raise exception 'set the firm retention period before closing a matter' using errcode = '22023';
  end if;
  keep_years := (org.retention_policy ->> 'count')::integer;

  blockers := app.matter_closure_blockers(matter.id);
  if app.closure_blocked(blockers) then
    if override is null then
      raise exception 'closure blocked: client funds are held or pending, or an issued invoice is unpaid' using errcode = '22023';
    end if;
    if length(override) < 10 then
      raise exception 'a reviewed reason needs at least 10 characters' using errcode = '22023';
    end if;
    if app.has_org_role(matter.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
      raise exception 'only the firm owner can close a matter with money still open' using errcode = '42501';
    end if;
    if app.mfa_step_up_satisfied() is distinct from true then
      raise exception 'step-up is required' using errcode = '42501';
    end if;
  elsif override is not null then
    raise exception 'there is nothing open to override' using errcode = '22023';
  end if;

  closed_on := app.firm_local_date(matter.organization_id, now());
  select coalesce(matter.responsible_consultant_membership_id, (
    select mem.id from public.memberships mem
    where mem.organization_id = matter.organization_id and mem.user_id = (select auth.uid()) and mem.status = 'active'
    limit 1
  )) into custodian;

  insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
  values (matter.organization_id, matter.id, 'closure', left('Closure recorded: ' || btrim(p_reason), 500))
  returning id into evidence;

  insert into public.matter_closures (
    organization_id, matter_id, closed_on, closed_by, reason, blockers, override_reason,
    retention_policy, retention_years, retention_on, retention_review_required, custodian_membership_id,
    legal_hold_active, evidence_id
  ) values (
    matter.organization_id, matter.id, closed_on, (select auth.uid()), btrim(p_reason), blockers, override,
    org.retention_policy, keep_years, (closed_on + make_interval(years => keep_years))::date, true, custodian,
    app.matter_on_legal_hold(matter.id), evidence
  )
  returning id into closure_id;

  perform app.transition_matter_stage(matter.id, 'closed', p_expected_version, btrim(p_reason));

  perform app.open_matter_column(matter.id, 'retention');
  update public.matters set retention_on = (closed_on + make_interval(years => keep_years))::date where id = matter.id;

  perform app.record_audit_event(matter.organization_id, 'matter.closure_recorded', 'public.matter_closures', closure_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'retention_years', keep_years, 'overridden', override is not null,
      'retention_review_required', true));
  return closure_id;
end;
$$;
revoke all on function public.close_matter(uuid, integer, text, text) from public, anon;
grant execute on function public.close_matter(uuid, integer, text, text) to authenticated;
