-- SEC-07 (gap #184): deletion jobs after the retention end, and tombstones.
--
-- Nothing is ever deleted automatically. A closed matter becomes "eligible for deletion" once its
-- retention end has passed in the firm's timezone (app.firm_today) and no legal hold is active.
-- The retention end is the later of the closure record's retention_on (the firm's own policy
-- version, copied at closure) and matters.retention_on (a manual retention date can only extend
-- it, never bring it forward). The firm owner, after a step-up, approves a deletion job for one
-- matter with a reason. The job lists every item it will remove:
--   document_file  each stored version (original, derivative, translation) of every document on
--                  the matter that is not also on another matter (documents bucket)
--   inbox_file     email attachments filed to the matter that still sit in the inbox folder
--   export_file    every client-file export package of the matter (matter-exports bucket)
--   vo_reading     Vo's reading of a document (summary and the values it read: extracted text)
--   vo_draft       Vo reply drafts on the matter that were never sent
-- and keeps, with the reason recorded, what it does not remove (a document also on another
-- matter; an executed agreement, whose sealed PDF is the agreement record). Casevoya stores no
-- embeddings; download grants (the short-lived cache of who may read a file) are removed with
-- each file.
--
-- Storage objects are removed only by the job runner (POST /api/retention/run, service role), never
-- inside a person's request. The runner claims a job (lease, attempts), re-checks before every item
-- (legal hold, still closed, retention end passed, document not newly linked to another matter),
-- removes the object, then records the item. Every step is idempotent: a removed object is
-- recorded once; a run cut off resumes from the items still pending. A legal hold placed after
-- approval blocks the job (re-approval needed after the hold is released). When no item is left the
-- job completes and writes the tombstone: what was removed and kept, when, who approved, the policy
-- version and retention end, and the storage keys removed (to reapply after a backup restore).
-- The matter, its closure record, the document rows and the audit trail stay as the record.
--
-- Tables (forced RLS, no policies; read through public.retention_deletion_overview):
--   deletion_jobs, deletion_job_items, deletion_tombstones (append-only)
-- Functions:
--   app.retention_end(matter)                    the later of closure and matter retention dates
--   app.matter_records_deleted(matter)           a tombstone exists
--   public.retention_deletion_overview(org)      firm owner: eligible matters, jobs, tombstones
--   public.approve_deletion_job(matter, reason, key)   firm owner + step-up; plans the items
--   public.service_claim_deletion_job()          service role: the next job and its pending items
--   public.service_deletion_item_ready(item)     service role: re-check before a storage delete
--   public.service_record_deletion_item(item, outcome)  service role: record or perform one item
--   public.service_finish_deletion_job(job)      service role: tombstone when nothing is pending
--   app.kick_retention_runner()                  pg_cron every 5 minutes when a job waits
-- Additive only. Redefines no existing function.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  closure_id uuid not null,
  status text not null default 'approved' check (status in ('approved', 'running', 'completed', 'blocked', 'failed')),
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  retention_on date not null,
  retention_years integer not null check (retention_years between 1 and 100),
  policy_version integer check (policy_version is null or policy_version >= 1),
  approved_by uuid not null references auth.users (id),
  approved_at timestamptz not null default now(),
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  item_count integer not null default 0 check (item_count >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  blocked_reason text check (blocked_reason is null or length(btrim(blocked_reason)) between 3 and 500),
  failure_reason text check (failure_reason is null or length(btrim(failure_reason)) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, idempotency_key),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (closure_id, organization_id) references public.matter_closures (id, organization_id),
  check ((status in ('completed', 'blocked', 'failed')) = (finished_at is not null)),
  check (status <> 'blocked' or blocked_reason is not null),
  check (status <> 'failed' or failure_reason is not null)
);
comment on table public.deletion_jobs is
  'SEC-07: an approved deletion of one closed matter''s files and derived data after its retention end. Approved by the firm owner with a step-up; run only by the job runner (service role). Never deleted.';

create index deletion_jobs_matter_org_fk_idx on public.deletion_jobs (matter_id, organization_id);
create index deletion_jobs_closure_org_fk_idx on public.deletion_jobs (closure_id, organization_id);
create index deletion_jobs_org_created_idx on public.deletion_jobs (organization_id, created_at desc);
create index deletion_jobs_runnable_idx on public.deletion_jobs (approved_at) where status in ('approved', 'running');
create index deletion_jobs_approved_by_idx on public.deletion_jobs (approved_by);
create index deletion_jobs_created_by_idx on public.deletion_jobs (created_by);
create unique index deletion_jobs_one_open_idx on public.deletion_jobs (matter_id) where status in ('approved', 'running');

create table public.deletion_job_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  job_id uuid not null,
  kind text not null check (kind in ('document_file', 'inbox_file', 'export_file', 'vo_reading', 'vo_draft', 'agreement_pdf')),
  target_id uuid not null,
  bucket text check (bucket is null or bucket in ('documents', 'matter-exports')),
  storage_key text check (storage_key is null or length(storage_key) between 10 and 500),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'deleted', 'missing', 'kept')),
  kept_reason text check (kept_reason is null or length(btrim(kept_reason)) between 3 and 300),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, kind, target_id),
  foreign key (job_id, organization_id) references public.deletion_jobs (id, organization_id),
  check ((status = 'pending') = (done_at is null)),
  check ((status = 'kept') = (kept_reason is not null)),
  check ((bucket is null) = (storage_key is null)),
  check (kind not in ('document_file', 'inbox_file', 'export_file') or storage_key is not null or status = 'kept')
);
comment on table public.deletion_job_items is
  'SEC-07: one thing a deletion job removes (a stored file, Vo''s reading of a document, an unsent Vo draft) or keeps with a reason. Storage keys are opaque paths, never file names.';

create index deletion_job_items_job_org_fk_idx on public.deletion_job_items (job_id, organization_id);
create index deletion_job_items_pending_idx on public.deletion_job_items (job_id) where status = 'pending';
create index deletion_job_items_org_idx on public.deletion_job_items (organization_id);

create table public.deletion_tombstones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  job_id uuid not null unique,
  matter_reference text,
  closed_on date not null,
  retention_on date not null,
  retention_years integer not null check (retention_years between 1 and 100),
  policy_version integer check (policy_version is null or policy_version >= 1),
  approved_by uuid not null references auth.users (id),
  approved_at timestamptz not null,
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  completed_at timestamptz not null default now(),
  removed jsonb not null check (jsonb_typeof(removed) = 'object'),
  kept jsonb not null check (jsonb_typeof(kept) = 'array'),
  objects jsonb not null check (jsonb_typeof(objects) = 'array'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (job_id, organization_id) references public.deletion_jobs (id, organization_id)
);
comment on table public.deletion_tombstones is
  'SEC-07: kept in place of what a deletion job removed: what (counts by kind, and what was kept and why), when, who approved, the retention policy version and end. objects lists the storage keys removed so a restored backup can have them removed again. Append-only.';
comment on column public.deletion_tombstones.objects is
  'Storage objects removed ([{bucket, key}]): reapply after restoring a backup. Keys are opaque paths, never file names.';

create index deletion_tombstones_matter_org_fk_idx on public.deletion_tombstones (matter_id, organization_id);
create index deletion_tombstones_org_completed_idx on public.deletion_tombstones (organization_id, completed_at desc);
create index deletion_tombstones_approved_by_idx on public.deletion_tombstones (approved_by);
create index deletion_tombstones_created_by_idx on public.deletion_tombstones (created_by);

-- Guards: jobs keep who approved what and for which matter; items keep what they point at;
-- tombstones and jobs are never deleted.
create function app.guard_deletion_job_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'deletion jobs are kept on record' using errcode = '42501';
  end if;
  if (new.organization_id, new.matter_id, new.closure_id, new.reason, new.retention_on, new.policy_version,
      new.approved_by, new.approved_at, new.idempotency_key)
     is distinct from (old.organization_id, old.matter_id, old.closure_id, old.reason, old.retention_on, old.policy_version,
      old.approved_by, old.approved_at, old.idempotency_key)
     or old.status in ('completed', 'blocked', 'failed') then
    raise exception 'deletion jobs are kept on record' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_deletion_job_change() from public, anon, authenticated;

create function app.guard_deletion_item_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'deletion job items are kept on record' using errcode = '42501';
  end if;
  if (new.organization_id, new.job_id, new.kind, new.target_id, new.bucket, new.storage_key)
     is distinct from (old.organization_id, old.job_id, old.kind, old.target_id, old.bucket, old.storage_key)
     or old.status <> 'pending' then
    raise exception 'deletion job items are kept on record' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_deletion_item_change() from public, anon, authenticated;

create function app.guard_deletion_tombstone_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'deletion tombstones are kept on record' using errcode = '42501';
end;
$$;
revoke all on function app.guard_deletion_tombstone_change() from public, anon, authenticated;

create trigger deletion_jobs_guard before update or delete on public.deletion_jobs
  for each row execute function app.guard_deletion_job_change();
create trigger deletion_jobs_touch before update on public.deletion_jobs
  for each row execute function app.touch_row();
create trigger deletion_jobs_stamp before insert on public.deletion_jobs
  for each row execute function app.stamp_created_by();
create trigger deletion_jobs_audit after insert or update or delete on public.deletion_jobs
  for each row execute function app.audit_row_change();

create trigger deletion_job_items_guard before update or delete on public.deletion_job_items
  for each row execute function app.guard_deletion_item_change();

create trigger deletion_tombstones_guard before update or delete on public.deletion_tombstones
  for each row execute function app.guard_deletion_tombstone_change();
create trigger deletion_tombstones_stamp before insert on public.deletion_tombstones
  for each row execute function app.stamp_created_by();
create trigger deletion_tombstones_audit after insert or update or delete on public.deletion_tombstones
  for each row execute function app.audit_row_change();

alter table public.deletion_jobs enable row level security;
alter table public.deletion_jobs force row level security;
alter table public.deletion_job_items enable row level security;
alter table public.deletion_job_items force row level security;
alter table public.deletion_tombstones enable row level security;
alter table public.deletion_tombstones force row level security;
revoke all on table public.deletion_jobs from public, anon, authenticated;
revoke all on table public.deletion_job_items from public, anon, authenticated;
revoke all on table public.deletion_tombstones from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The retention end of a closed matter: the later of its latest closure record's retention_on and
-- the matter's own retention_on. Null when the matter has no closure.
create function app.retention_end(p_matter_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(closure.retention_on, coalesce(matter.retention_on, closure.retention_on))
  from public.matters matter
  join lateral (
    select c.retention_on from public.matter_closures c
    where c.matter_id = matter.id
    order by c.closed_at desc
    limit 1
  ) closure on true
  where matter.id = p_matter_id;
$$;
revoke all on function app.retention_end(uuid) from public, anon, authenticated;
grant execute on function app.retention_end(uuid) to service_role;

create function app.matter_records_deleted(p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.deletion_tombstones t where t.matter_id = p_matter_id);
$$;
revoke all on function app.matter_records_deleted(uuid) from public, anon;
grant execute on function app.matter_records_deleted(uuid) to authenticated, service_role;

-- Why a matter is not eligible now, or null when it is.
create function app.deletion_ineligible_reason(p_matter_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  ends_on date;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null then
    return 'the matter was not found';
  end if;
  if matter.stage <> 'closed' then
    return 'the matter is not closed';
  end if;
  ends_on := app.retention_end(matter.id);
  if ends_on is null then
    return 'the matter has no closure record';
  end if;
  if ends_on >= app.firm_today(matter.organization_id) then
    return 'the retention period has not ended';
  end if;
  if app.matter_on_legal_hold(matter.id) then
    return 'the matter is under a legal hold';
  end if;
  if app.matter_records_deleted(matter.id) then
    return 'the matter''s files were already deleted';
  end if;
  return null;
end;
$$;
revoke all on function app.deletion_ineligible_reason(uuid) from public, anon, authenticated;
grant execute on function app.deletion_ineligible_reason(uuid) to service_role;

-- A document also linked (active link) to a matter other than p_matter_id whose files have not
-- been deleted: it stays.
create function app.document_on_other_matter(p_document_id uuid, p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.document_matter_refs ref
    where ref.document_id = p_document_id
      and ref.matter_id <> p_matter_id
      and ref.removed_at is null
      and not exists (select 1 from public.deletion_tombstones t where t.matter_id = ref.matter_id)
  );
$$;
revoke all on function app.document_on_other_matter(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settings > Retention: eligible matters, jobs and tombstones (firm owner)
-- ---------------------------------------------------------------------------

create function public.retention_deletion_overview(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_organization_id is distinct from (select app.current_organization_id())
     or app.in_active_org(p_organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(p_organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'retention deletion denied' using errcode = '42501';
  end if;
  today := app.firm_today(p_organization_id);
  return jsonb_build_object(
    'today', today,
    'eligible', coalesce((
      select jsonb_agg(row_data order by row_data ->> 'retention_on', row_data ->> 'reference')
      from (
        select jsonb_build_object(
          'matter_id', matter.id,
          'reference', matter.reference,
          'title', matter.title,
          'is_sample', matter.is_sample,
          'closed_on', closure.closed_on,
          'retention_on', app.retention_end(matter.id),
          'retention_years', closure.retention_years,
          'policy_version', (closure.retention_policy ->> 'version')::integer
        ) as row_data
        from public.matters matter
        join lateral (
          select c.* from public.matter_closures c where c.matter_id = matter.id order by c.closed_at desc limit 1
        ) closure on true
        where matter.organization_id = p_organization_id
          and matter.stage = 'closed'
          and app.retention_end(matter.id) < today
          and not app.matter_on_legal_hold(matter.id)
          and not exists (select 1 from public.deletion_tombstones t where t.matter_id = matter.id)
          and not exists (select 1 from public.deletion_jobs j where j.matter_id = matter.id and j.status in ('approved', 'running'))
        limit 200
      ) eligible
    ), '[]'::jsonb),
    'held', (
      select count(*) from public.matters matter
      where matter.organization_id = p_organization_id
        and matter.stage = 'closed'
        and app.retention_end(matter.id) < today
        and app.matter_on_legal_hold(matter.id)
        and not exists (select 1 from public.deletion_tombstones t where t.matter_id = matter.id)
    ),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', job.id,
        'matter_id', job.matter_id,
        'reference', matter.reference,
        'status', job.status,
        'approved_at', job.approved_at,
        'approved_by', job.approved_by,
        'item_count', job.item_count,
        'pending', (select count(*) from public.deletion_job_items i where i.job_id = job.id and i.status = 'pending'),
        'blocked_reason', job.blocked_reason,
        'failure_reason', job.failure_reason,
        'finished_at', job.finished_at
      ) order by job.approved_at desc)
      from (
        select * from public.deletion_jobs j
        where j.organization_id = p_organization_id and j.status <> 'completed'
        order by j.approved_at desc
        limit 50
      ) job
      join public.matters matter on matter.id = job.matter_id
    ), '[]'::jsonb),
    'tombstones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'matter_id', t.matter_id,
        'reference', t.matter_reference,
        'completed_at', t.completed_at,
        'approved_by', t.approved_by,
        'approved_at', t.approved_at,
        'policy_version', t.policy_version,
        'retention_years', t.retention_years,
        'retention_on', t.retention_on,
        'removed', t.removed,
        'kept', t.kept
      ) order by t.completed_at desc)
      from (
        select * from public.deletion_tombstones x
        where x.organization_id = p_organization_id
        order by x.completed_at desc
        limit 100
      ) t
    ), '[]'::jsonb)
  );
end;
$$;
comment on function public.retention_deletion_overview(uuid) is
  'Firm owner: closed matters past their retention end with no legal hold and no deletion yet (eligible), how many past-end matters are held, open or stopped deletion jobs, and tombstones.';
revoke all on function public.retention_deletion_overview(uuid) from public, anon;
grant execute on function public.retention_deletion_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Approve a deletion job (firm owner + step-up): plans every item, deletes nothing
-- ---------------------------------------------------------------------------

create function public.approve_deletion_job(p_matter_id uuid, p_reason text, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  closure public.matter_closures%rowtype;
  job_key text := btrim(coalesce(p_idempotency_key, ''));
  existing public.deletion_jobs%rowtype;
  why text;
  new_job uuid;
  doc record;
  ver record;
  planned integer;
begin
  matter := app.require_owner_step_up_for_matter(p_matter_id);
  if length(job_key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select * into existing from public.deletion_jobs
   where organization_id = matter.organization_id and idempotency_key = job_key;
  if existing.id is not null then
    if existing.matter_id <> matter.id then
      raise exception 'retention deletion denied' using errcode = '42501';
    end if;
    return existing.id;
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 10 and 1000 then
    raise exception 'a deletion needs a reason of at least 10 characters' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = matter.id for update;
  why := app.deletion_ineligible_reason(matter.id);
  if why is not null then
    raise exception 'not eligible for deletion: %', why using errcode = '22023';
  end if;
  if exists (select 1 from public.deletion_jobs j where j.matter_id = matter.id and j.status in ('approved', 'running')) then
    raise exception 'a deletion job for this matter is already waiting' using errcode = '23505';
  end if;
  select * into closure from public.matter_closures c where c.matter_id = matter.id order by c.closed_at desc limit 1;

  insert into public.deletion_jobs (
    organization_id, matter_id, closure_id, reason, retention_on, retention_years, policy_version, approved_by, idempotency_key
  ) values (
    matter.organization_id, matter.id, closure.id, btrim(p_reason), app.retention_end(matter.id), closure.retention_years,
    (closure.retention_policy ->> 'version')::integer, (select auth.uid()), job_key
  )
  returning id into new_job;

  -- Documents on the matter: every stored version, unless the document is also on another matter
  -- or the version is an executed agreement's sealed PDF or certificate.
  for doc in
    select distinct ref.document_id from public.document_matter_refs ref where ref.matter_id = matter.id
  loop
    for ver in
      select v.id, v.storage_bucket, v.storage_key, v.checksum_sha256,
             exists (
               select 1 from public.signature_envelopes env
               where env.sealed_document_version_id = v.id or env.certificate_document_version_id = v.id
             ) as sealed
      from public.document_versions v
      where v.document_id = doc.document_id
    loop
      if app.document_on_other_matter(doc.document_id, matter.id) then
        insert into public.deletion_job_items (organization_id, job_id, kind, target_id, bucket, storage_key, sha256, status, kept_reason, done_at)
        values (matter.organization_id, new_job, 'document_file', ver.id, ver.storage_bucket, ver.storage_key, ver.checksum_sha256,
          'kept', 'Also on another matter: kept until that matter''s files are deleted.', now());
      elsif ver.sealed then
        insert into public.deletion_job_items (organization_id, job_id, kind, target_id, status, kept_reason, done_at)
        values (matter.organization_id, new_job, 'agreement_pdf', ver.id,
          'kept', 'Executed agreement: its sealed PDF is the agreement record and is kept.', now());
      else
        insert into public.deletion_job_items (organization_id, job_id, kind, target_id, bucket, storage_key, sha256)
        values (matter.organization_id, new_job, 'document_file', ver.id, ver.storage_bucket, ver.storage_key, ver.checksum_sha256);
      end if;
    end loop;
  end loop;

  -- Email attachments filed to the matter that still sit in the inbox folder.
  insert into public.deletion_job_items (organization_id, job_id, kind, target_id, bucket, storage_key, sha256)
  select matter.organization_id, new_job, 'inbox_file', item.id, 'documents', item.storage_key, item.sha256
  from public.inbound_inbox_items item
  where item.matter_id = matter.id and item.organization_id = matter.organization_id;

  -- Client-file export packages.
  insert into public.deletion_job_items (organization_id, job_id, kind, target_id, bucket, storage_key, sha256)
  select matter.organization_id, new_job, 'export_file', ex.id, ex.storage_bucket, ex.storage_key, ex.sha256
  from public.matter_exports ex
  where ex.matter_id = matter.id and ex.storage_key is not null;

  -- Vo's readings of the matter's documents (summaries and the values read from them).
  insert into public.deletion_job_items (organization_id, job_id, kind, target_id)
  select matter.organization_id, new_job, 'vo_reading', draft.id
  from public.vo_doc_drafts draft
  where draft.matter_id = matter.id
    and not exists (
      select 1 from public.deletion_job_items kept_item
      where kept_item.job_id = new_job and kept_item.kind = 'document_file' and kept_item.status = 'kept' and kept_item.target_id = draft.version_id
    );

  -- Vo reply drafts never sent (a sent draft is the message on the matter).
  insert into public.deletion_job_items (organization_id, job_id, kind, target_id)
  select matter.organization_id, new_job, 'vo_draft', draft.id
  from public.vo_drafts draft
  where draft.matter_id = matter.id and draft.status <> 'sent';

  select count(*) into planned from public.deletion_job_items i where i.job_id = new_job;
  update public.deletion_jobs set item_count = planned where id = new_job;

  perform app.record_audit_event(matter.organization_id, 'retention.deletion_approved', 'public.deletion_jobs', new_job, 'success',
    jsonb_build_object('matter_id', matter.id, 'retention_on', app.retention_end(matter.id),
      'policy_version', (closure.retention_policy ->> 'version')::integer, 'items', planned));
  return new_job;
end;
$$;
comment on function public.approve_deletion_job(uuid, text, text) is
  'Firm owner + step-up: approves deleting one eligible closed matter''s files and derived data. Plans the items only; the job runner removes them. Idempotent on the key.';
revoke all on function public.approve_deletion_job(uuid, text, text) from public, anon;
grant execute on function public.approve_deletion_job(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The job runner (service role only)
-- ---------------------------------------------------------------------------

-- Stops a job whose matter is no longer eligible (legal hold placed, reopened…). Returns true when
-- the job was stopped.
create function app.deletion_job_stop_if_ineligible(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.deletion_jobs%rowtype;
  why text;
begin
  select * into job from public.deletion_jobs where id = p_job_id for update;
  if job.id is null or job.status not in ('approved', 'running') then
    return true;
  end if;
  why := app.deletion_ineligible_reason(job.matter_id);
  if why is null then
    return false;
  end if;
  update public.deletion_jobs
     set status = 'blocked', blocked_reason = left('Stopped: ' || why || '.', 500), finished_at = now(), lease_until = null
   where id = job.id;
  perform app.record_audit_event(job.organization_id, 'retention.deletion_blocked', 'public.deletion_jobs', job.id, 'denied',
    jsonb_build_object('matter_id', job.matter_id, 'reason', why));
  return true;
end;
$$;
revoke all on function app.deletion_job_stop_if_ineligible(uuid) from public, anon, authenticated;

-- The next job to run (approved, or running with an expired lease) and its pending items. A job
-- tried ten times is marked failed for the owner to approve again.
create function public.service_claim_deletion_job()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.deletion_jobs%rowtype;
begin
  loop
    select * into job from public.deletion_jobs j
     where j.status = 'approved' or (j.status = 'running' and (j.lease_until is null or j.lease_until < now()))
     order by j.approved_at
     limit 1
     for update skip locked;
    if job.id is null then
      return null;
    end if;
    if job.attempts >= 10 then
      update public.deletion_jobs
         set status = 'failed', failure_reason = 'The files could not all be removed after 10 tries. Approve it again to retry.',
             finished_at = now(), lease_until = null
       where id = job.id;
      perform app.record_audit_event(job.organization_id, 'retention.deletion_failed', 'public.deletion_jobs', job.id, 'failure',
        jsonb_build_object('matter_id', job.matter_id, 'attempts', job.attempts));
      continue;
    end if;
    if app.deletion_job_stop_if_ineligible(job.id) then
      continue;
    end if;
    update public.deletion_jobs
       set status = 'running', attempts = attempts + 1, lease_until = now() + interval '10 minutes',
           started_at = coalesce(started_at, now())
     where id = job.id;
    if job.status = 'approved' then
      perform app.record_audit_event(job.organization_id, 'retention.deletion_started', 'public.deletion_jobs', job.id, 'success',
        jsonb_build_object('matter_id', job.matter_id));
    end if;
    return jsonb_build_object(
      'job_id', job.id,
      'organization_id', job.organization_id,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'bucket', i.bucket, 'storage_key', i.storage_key) order by i.created_at, i.id)
        from (
          select * from public.deletion_job_items x
          where x.job_id = job.id and x.status = 'pending'
          order by x.created_at, x.id
          limit 500
        ) i
      ), '[]'::jsonb)
    );
  end loop;
end;
$$;
revoke all on function public.service_claim_deletion_job() from public, anon, authenticated;
grant execute on function public.service_claim_deletion_job() to service_role;

-- Re-check right before one storage delete: the job still runs, the matter is still eligible (no
-- legal hold) and a document has not been linked to another matter since approval. False means
-- do not delete (the item is kept or the job stopped).
create function public.service_deletion_item_ready(p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.deletion_job_items%rowtype;
  job public.deletion_jobs%rowtype;
  doc_id uuid;
begin
  select * into item from public.deletion_job_items where id = p_item_id for update;
  if item.id is null or item.status <> 'pending' then
    return false;
  end if;
  select * into job from public.deletion_jobs where id = item.job_id;
  if job.status <> 'running' then
    return false;
  end if;
  if app.deletion_job_stop_if_ineligible(job.id) then
    return false;
  end if;
  if item.kind = 'document_file' then
    select v.document_id into doc_id from public.document_versions v where v.id = item.target_id;
    if doc_id is not null and app.document_on_other_matter(doc_id, job.matter_id) then
      update public.deletion_job_items
         set status = 'kept', kept_reason = 'Linked to another matter after approval: kept.', done_at = now()
       where id = item.id;
      return false;
    end if;
  end if;
  return true;
end;
$$;
revoke all on function public.service_deletion_item_ready(uuid) from public, anon, authenticated;
grant execute on function public.service_deletion_item_ready(uuid) to service_role;

-- Records one item. Storage items: p_outcome 'deleted' (removed now) or 'missing' (already gone);
-- the runner removed the object after service_deletion_item_ready. Database items (vo_reading,
-- vo_draft) are removed here, after the same re-check. A document file also loses its download
-- grants. Idempotent: an item already done returns false.
create function public.service_record_deletion_item(p_item_id uuid, p_outcome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.deletion_job_items%rowtype;
  job public.deletion_jobs%rowtype;
  result_status text;
begin
  select * into item from public.deletion_job_items where id = p_item_id for update;
  if item.id is null or item.status <> 'pending' then
    return false;
  end if;
  select * into job from public.deletion_jobs where id = item.job_id;
  if job.status <> 'running' then
    return false;
  end if;
  if item.kind in ('document_file', 'inbox_file', 'export_file') then
    if p_outcome not in ('deleted', 'missing') then
      raise exception 'outcome must be deleted or missing' using errcode = '22023';
    end if;
    result_status := p_outcome;
    if item.kind = 'document_file' then
      delete from app.document_download_grants grant_row where grant_row.version_id = item.target_id;
    end if;
  else
    if app.deletion_job_stop_if_ineligible(job.id) then
      return false;
    end if;
    if item.kind = 'vo_reading' then
      update public.vo_doc_proposals
         set label = 'Deleted', value = null, detail = null, accepted_value = null
       where draft_id = item.target_id;
      update public.vo_doc_drafts
         set title = 'Deleted', body = 'Removed under the firm''s retention policy.',
             sources = '[{"kind":"retention_deletion"}]'::jsonb
       where id = item.target_id;
    elsif item.kind = 'vo_draft' then
      update public.vo_drafts
         set title = 'Deleted', body = 'Removed under the firm''s retention policy.',
             sources = '[{"kind":"retention_deletion"}]'::jsonb
       where id = item.target_id and status <> 'sent';
    end if;
    result_status := 'deleted';
  end if;
  update public.deletion_job_items set status = result_status, done_at = now() where id = item.id;
  return true;
end;
$$;
revoke all on function public.service_record_deletion_item(uuid, text) from public, anon, authenticated;
grant execute on function public.service_record_deletion_item(uuid, text) to service_role;

-- When nothing is pending: the tombstone, the job completed, audited. Otherwise the lease is
-- released so the next run picks it up. Returns the job's status.
create function public.service_finish_deletion_job(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.deletion_jobs%rowtype;
  closure public.matter_closures%rowtype;
  ref text;
  removed_counts jsonb;
  kept_list jsonb;
  removed_objects jsonb;
  tomb uuid;
begin
  select * into job from public.deletion_jobs where id = p_job_id for update;
  if job.id is null then
    return null;
  end if;
  if job.status <> 'running' then
    return job.status;
  end if;
  if exists (select 1 from public.deletion_job_items i where i.job_id = job.id and i.status = 'pending') then
    update public.deletion_jobs set lease_until = null where id = job.id;
    return 'running';
  end if;
  if app.deletion_job_stop_if_ineligible(job.id) then
    return 'blocked';
  end if;
  select * into closure from public.matter_closures where id = job.closure_id;
  select m.reference into ref from public.matters m where m.id = job.matter_id;
  select coalesce(jsonb_object_agg(counts.kind, counts.n), '{}'::jsonb) into removed_counts
    from (
      select i.kind, count(*) as n from public.deletion_job_items i
      where i.job_id = job.id and i.status in ('deleted', 'missing')
      group by i.kind
    ) counts;
  removed_counts := removed_counts || jsonb_build_object('embeddings', 0);
  select coalesce(jsonb_agg(jsonb_build_object('kind', grouped.kind, 'reason', grouped.kept_reason, 'count', grouped.n) order by grouped.kind), '[]'::jsonb)
    into kept_list
    from (
      select i.kind, i.kept_reason, count(*) as n from public.deletion_job_items i
      where i.job_id = job.id and i.status = 'kept'
      group by i.kind, i.kept_reason
    ) grouped;
  select coalesce(jsonb_agg(jsonb_build_object('bucket', i.bucket, 'key', i.storage_key) order by i.created_at, i.id), '[]'::jsonb)
    into removed_objects
    from public.deletion_job_items i
    where i.job_id = job.id and i.status in ('deleted', 'missing') and i.storage_key is not null;

  insert into public.deletion_tombstones (
    organization_id, matter_id, job_id, matter_reference, closed_on, retention_on, retention_years, policy_version,
    approved_by, approved_at, reason, removed, kept, objects
  ) values (
    job.organization_id, job.matter_id, job.id, ref, closure.closed_on, job.retention_on, job.retention_years, job.policy_version,
    job.approved_by, job.approved_at, job.reason, removed_counts, kept_list, removed_objects
  )
  on conflict (job_id) do nothing
  returning id into tomb;
  update public.deletion_jobs set status = 'completed', finished_at = now(), lease_until = null where id = job.id;
  perform app.record_audit_event(job.organization_id, 'retention.deletion_completed', 'public.deletion_tombstones', tomb, 'success',
    jsonb_build_object('matter_id', job.matter_id, 'job_id', job.id, 'removed', removed_counts, 'kept', jsonb_array_length(kept_list)));
  return 'completed';
end;
$$;
revoke all on function public.service_finish_deletion_job(uuid) from public, anon, authenticated;
grant execute on function public.service_finish_deletion_job(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Scheduler: the runner endpoint next to the mail one, with the mail dispatch bearer (the same
-- Vault secrets as app.kick_whatsapp_dispatch; nothing new is stored). Only when a job waits.
-- ---------------------------------------------------------------------------

create function app.kick_retention_runner()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text;
  secret text;
begin
  if not exists (
    select 1 from public.deletion_jobs j
    where j.status = 'approved' or (j.status = 'running' and (j.lease_until is null or j.lease_until < now()))
  ) then
    return;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'email_dispatch_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'email_dispatch_secret';
  if url is null or secret is null or url !~ '^https://[^/]+/api/email/dispatch$' then
    return;
  end if;
  perform net.http_post(
    url := regexp_replace(url, '/api/email/dispatch$', '/api/retention/run'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;
revoke all on function app.kick_retention_runner() from public;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.schedule('casevoya-retention-runner', '*/5 * * * *', 'select app.kick_retention_runner()');
  end if;
end;
$$;
