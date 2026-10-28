-- A client-file export whose ZIP was deleted shows as deleted, and its download is refused
-- (issue #262 item 2, from #228).
--
-- The retention runner (SEC-07) removes an export's ZIP from storage and records the deletion item,
-- but the matter_exports row stayed 'ready' inside its 24-hour window: the Client-file exports page
-- still said Ready, public.authorize_matter_export_download still granted a download, and signing a
-- link to the missing object failed as a bare 502.
--
--   matter_exports.removed_at                       new: when the export's file was deleted
--   public.service_record_deletion_item             redefined: an export_file item stamps removed_at
--   public.authorize_matter_export_download         redefined: refuses a removed export ('this export was deleted')
--   backfill                                        exports whose file a finished deletion item already removed
--
-- Bodies copied from their latest definitions: service_record_deletion_item from
-- 20261025290000_sec_retention_deletion.sql, authorize_matter_export_download from
-- 20261019205100_matter_records_exports_closure.sql (their only definitions). Grants are kept by
-- create or replace. app.guard_matter_export_change already lets a ready export's removed_at change
-- (it only freezes the file's identity columns), so it is not redefined.

alter table public.matter_exports
  add column removed_at timestamptz;
comment on column public.matter_exports.removed_at is
  'When the export''s ZIP was deleted from storage (a retention deletion job). A removed export is never downloadable; the row stays as the record.';

create or replace function public.service_record_deletion_item(p_item_id uuid, p_outcome text)
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
    elsif item.kind = 'export_file' then
      -- #262: the export's file is gone, so the export reads as deleted and can't be downloaded.
      update public.matter_exports
         set removed_at = coalesce(removed_at, now())
       where id = item.target_id and organization_id = item.organization_id;
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

create or replace function public.authorize_matter_export_download(p_export_id uuid)
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
  -- #262: the file was deleted (retention); there is nothing to download.
  if job.removed_at is not null then
    raise exception 'this export was deleted' using errcode = '22023';
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

-- Exports whose file a deletion job already removed (the runner recorded it deleted or missing).
update public.matter_exports ex
   set removed_at = coalesce(item.done_at, now())
  from public.deletion_job_items item
 where item.kind = 'export_file'
   and item.target_id = ex.id
   and item.organization_id = ex.organization_id
   and item.status in ('deleted', 'missing')
   and ex.removed_at is null;
