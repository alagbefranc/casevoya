-- DES-04 follow-up (#237 live checks): opening an imported matter shows its inbound address, and
-- public.matter_inbound_address creates the matter's reply address (matter_reply_addresses, a
-- random plus-tag) on first use. That new row pointed at an imported matter, so the import's
-- rollback refused ("1 new matter reply addresses linked to imported records since the import").
-- Viewing a matter must not block a rollback.
--
-- A reply address nobody used is not work on the matter. It is "used" only when mail went out
-- from the matter (email_deliveries.matter_id: its Reply-To is the reply address) or came in to it
-- (inbound_emails.matter_id). So the rollback now ignores reply addresses made since the import
-- only while none of the batch's matters has any email out or in, and then removes them with the
-- matters. A used reply address still refuses the rollback, as before.
--
-- Redefined (each copied from its latest definition, 20261025385200_mig_import_kinds_commit.sql;
-- no later migration redefines them), with only the noted change:
--   app.migration_rollback_blockers: skips the public.matter_reply_addresses.matter_id count when
--     no email_deliveries or inbound_emails row names one of the batch's matters.
--   public.rollback_migration_batch: removes the batch's matters' reply addresses before the
--     matters (a used one never gets there: the blockers refuse first).
-- Additive only; nothing seeded.

create or replace function app.migration_rollback_blockers(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  reasons jsonb := '[]'::jsonb;
  rec record;
  now_counts jsonb;
  k text;
  v_before integer;
  v_after integer;
  batch_matters uuid[];
  reply_unused boolean;
begin
  select * into b from public.migration_batches where id = p_batch;
  if b.kind is distinct from 'clients_matters' then
    return app.migration_rollback_blockers_kind(p_batch);
  end if;
  if b.status not in ('committed', 'committing') then
    return jsonb_build_array('Only an imported batch can be rolled back.');
  end if;
  for rec in
    select r.row_number, m.id, m.reference, m.version, r.version_at_import
    from public.migration_records r
    left join public.matters m on m.id = r.record_id
    where r.batch_id = p_batch and r.record_table = 'matters' and r.created and r.removed_at is null
    order by r.row_number
  loop
    if rec.id is null then
      reasons := reasons || to_jsonb(format('The matter from row %s is no longer there.', rec.row_number));
    else
      if rec.version <> rec.version_at_import then
        reasons := reasons || to_jsonb(format('Matter %s (row %s) was changed after the import.', coalesce(rec.reference, 'without a reference'), rec.row_number));
      end if;
      if app.matter_on_legal_hold(rec.id) then
        reasons := reasons || to_jsonb(format('Matter %s (row %s) is under a legal hold.', coalesce(rec.reference, 'without a reference'), rec.row_number));
      end if;
    end if;
  end loop;
  for rec in
    select r.row_number, p.id, p.version, p.user_id, r.version_at_import
    from public.migration_records r
    left join public.persons p on p.id = r.record_id
    where r.batch_id = p_batch and r.record_table = 'persons' and r.created and r.removed_at is null
    order by r.row_number
  loop
    if rec.id is null then
      reasons := reasons || to_jsonb(format('The person from row %s is no longer there.', rec.row_number));
    elsif rec.version <> rec.version_at_import then
      reasons := reasons || to_jsonb(format('The person from row %s was edited after the import.', rec.row_number));
    elsif rec.user_id is not null then
      reasons := reasons || to_jsonb(format('The person from row %s now has a portal login.', rec.row_number));
    end if;
  end loop;
  -- DES-04: a reply address made by opening a matter is unused while no mail went out from, or
  -- came in to, any of the batch's matters.
  select coalesce(array_agg(r.record_id), '{}') into batch_matters
  from public.migration_records r
  where r.batch_id = p_batch and r.record_table = 'matters' and r.created and r.removed_at is null;
  reply_unused := not exists (select 1 from public.email_deliveries d where d.matter_id = any(batch_matters))
    and not exists (select 1 from public.inbound_emails e where e.matter_id = any(batch_matters));
  now_counts := app.migration_reference_counts(p_batch);
  for k in select jsonb_object_keys(now_counts) loop
    continue when k = 'public.matter_reply_addresses.matter_id' and reply_unused;
    v_before := coalesce((b.references_at_import ->> k)::integer, 0);
    v_after := (now_counts ->> k)::integer;
    if v_after > v_before then
      reasons := reasons || to_jsonb(format('%s new %s linked to imported records since the import.',
        v_after - v_before, replace(split_part(k, '.', 2), '_', ' ')));
    end if;
  end loop;
  return reasons;
end;
$$;
revoke all on function app.migration_rollback_blockers(uuid) from public, anon, authenticated;

create or replace function public.rollback_migration_batch(p_org uuid, p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.migration_batches%rowtype;
  reasons jsonb;
  matter_ids uuid[];
  person_ids uuid[];
  k text;
  tbl text;
  col text;
  n_matters integer;
  n_persons integer;
  kind_result jsonb;
begin
  perform app.migration_owner(p_org, true);
  select * into b from public.migration_batches where id = p_batch and organization_id = p_org for update;
  if b.id is null then
    raise exception 'migration batch not found' using errcode = 'P0002';
  end if;
  reasons := app.migration_rollback_blockers(p_batch);
  if jsonb_array_length(reasons) > 0 then
    perform app.record_audit_event(p_org, 'migration.rollback_refused', 'public.migration_batches', p_batch, 'denied',
      jsonb_build_object('reasons', jsonb_array_length(reasons)));
    return jsonb_build_object('ok', false, 'reasons', reasons);
  end if;

  if b.kind <> 'clients_matters' then
    kind_result := app.migration_rollback_kind(p_org, p_batch);
    update public.migration_records set removed_at = now() where batch_id = p_batch and created and removed_at is null;
    update public.migration_batches set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = (select auth.uid()) where id = p_batch;
    perform app.migration_purge_staging(p_batch);
    perform app.record_audit_event(p_org, 'migration.rolled_back', 'public.migration_batches', p_batch, 'success',
      jsonb_build_object('kind', b.kind, 'records_removed', kind_result -> 'records'));
    return jsonb_build_object('ok', true, 'records', kind_result -> 'records');
  end if;

  select coalesce(array_agg(record_id) filter (where record_table = 'matters'), '{}'),
         coalesce(array_agg(record_id) filter (where record_table = 'persons'), '{}')
  into matter_ids, person_ids
  from public.migration_records
  where batch_id = p_batch and created and removed_at is null;

  perform set_config('app.migration_rollback', p_batch::text, true);
  delete from public.matter_participants where matter_id = any(matter_ids) or person_id = any(person_ids);
  delete from public.matter_rule_bindings where matter_id = any(matter_ids);
  -- Anything else the creation itself wrote that points at the records (unchanged since import).
  for k in select jsonb_object_keys(b.references_at_import) loop
    tbl := split_part(k, '.', 1) || '.' || split_part(k, '.', 2);
    col := split_part(k, '.', 3);
    continue when tbl in ('public.matter_participants', 'public.matter_rule_bindings');
    execute format('delete from %s where %I = any($1) or %I = any($2)', tbl, col, col) using matter_ids, person_ids;
  end loop;
  -- DES-04: reply addresses made by opening the matters since the import (unused: the blockers
  -- refuse a batch whose matters sent or received any email).
  delete from public.matter_reply_addresses where matter_id = any(matter_ids);
  delete from public.matters where id = any(matter_ids);
  get diagnostics n_matters = row_count;
  delete from public.persons where id = any(person_ids);
  get diagnostics n_persons = row_count;
  perform set_config('app.migration_rollback', '', true);

  update public.migration_records set removed_at = now() where batch_id = p_batch and created and removed_at is null;
  update public.migration_batches set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = (select auth.uid()) where id = p_batch;
  perform app.migration_purge_staging(p_batch);
  perform app.record_audit_event(p_org, 'migration.rolled_back', 'public.migration_batches', p_batch, 'success',
    jsonb_build_object('matters_removed', n_matters, 'people_removed', n_persons));
  return jsonb_build_object('ok', true, 'matters', n_matters, 'people', n_persons);
end;
$$;
revoke all on function public.rollback_migration_batch(uuid, uuid) from public, anon;
