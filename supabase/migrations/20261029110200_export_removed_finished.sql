-- #272 item 7d (#266): a retention deletion job errored on a failed or cancelled client-file
-- export that has a stored file. public.service_record_deletion_item stamps the export's
-- removed_at (#262), and app.guard_matter_export_change refused every change to a finished
-- (failed or cancelled) export with "this export is finished", so recording the deleted file
-- raised and the job could not finish.
--
-- Redefined: app.guard_matter_export_change (latest in
-- 20261019205100_matter_records_exports_closure.sql, its only definition). A finished export may
-- now have removed_at set once, when nothing else on the row changes; everything else about a
-- finished export stays frozen. No data changes.

create or replace function app.guard_matter_export_change()
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
    -- #272: the retention runner records that the finished export's stored file was deleted.
    if old.removed_at is null and new.removed_at is not null
       and (to_jsonb(new) - 'removed_at' - 'updated_at') = (to_jsonb(old) - 'removed_at' - 'updated_at') then
      return new;
    end if;
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
