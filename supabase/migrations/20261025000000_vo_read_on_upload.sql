-- DOC-05 (#178): an optional per-firm switch, "Read documents on upload" (off by default). When it is
-- on, a matter's new uploads are read by Vo the next time a staff member who may use Vo opens the
-- matter's Documents tab, under that person's own access, so every Vo switch, category switch,
-- sample-mode rule and rate limit in public.begin_vo_document_review still applies. Readings stay
-- proposals until a person accepts them.
--
-- Changed table:
--   public.vo_settings      + read_on_upload boolean not null default false.
-- Redefined:
--   public.set_vo_settings  (latest in 20261019218100_vo_doc_review.sql): accepts read_on_upload.
--                           Otherwise unchanged.

alter table public.vo_settings add column read_on_upload boolean not null default false;
comment on column public.vo_settings.read_on_upload is
  'DOC-05: Vo reads new uploads when staff open the matter''s Documents tab. Off by default; every other Vo switch still applies.';

-- public.set_vo_settings(uuid, jsonb), last defined in 20261019218100_vo_doc_review.sql
create or replace function public.set_vo_settings(p_organization_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  before_enabled boolean;
  current_row public.vo_settings%rowtype;
  key text;
  allowed text[] := array[
    'enabled', 'reply_drafts', 'staff_answers', 'read_client_messages', 'read_identity', 'read_relationship',
    'read_financial', 'read_medical', 'read_criminal', 'read_narratives',
    'doc_classification', 'ocr_normalisation', 'missing_fields', 'inconsistency_flags',
    'read_on_upload'
  ];
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner']::public.org_role[], false);
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'choose a Vo switch' using errcode = '22023';
  end if;
  for key in select jsonb_object_keys(p_changes)
  loop
    if not (key = any (allowed)) or jsonb_typeof(p_changes -> key) <> 'boolean' then
      raise exception 'unknown Vo switch' using errcode = '22023';
    end if;
  end loop;
  before_enabled := app.vo_enabled(p_organization_id);
  select * into current_row from public.vo_settings where organization_id = p_organization_id for update;
  if current_row.organization_id is null then
    insert into public.vo_settings (organization_id, enabled, updated_by)
    values (p_organization_id, before_enabled, actor)
    returning * into current_row;
  end if;
  update public.vo_settings
    set enabled = coalesce((p_changes ->> 'enabled')::boolean, current_row.enabled),
        reply_drafts = coalesce((p_changes ->> 'reply_drafts')::boolean, current_row.reply_drafts),
        staff_answers = coalesce((p_changes ->> 'staff_answers')::boolean, current_row.staff_answers),
        read_client_messages = coalesce((p_changes ->> 'read_client_messages')::boolean, current_row.read_client_messages),
        read_identity = coalesce((p_changes ->> 'read_identity')::boolean, current_row.read_identity),
        read_relationship = coalesce((p_changes ->> 'read_relationship')::boolean, current_row.read_relationship),
        read_financial = coalesce((p_changes ->> 'read_financial')::boolean, current_row.read_financial),
        read_medical = coalesce((p_changes ->> 'read_medical')::boolean, current_row.read_medical),
        read_criminal = coalesce((p_changes ->> 'read_criminal')::boolean, current_row.read_criminal),
        read_narratives = coalesce((p_changes ->> 'read_narratives')::boolean, current_row.read_narratives),
        doc_classification = coalesce((p_changes ->> 'doc_classification')::boolean, current_row.doc_classification),
        ocr_normalisation = coalesce((p_changes ->> 'ocr_normalisation')::boolean, current_row.ocr_normalisation),
        missing_fields = coalesce((p_changes ->> 'missing_fields')::boolean, current_row.missing_fields),
        inconsistency_flags = coalesce((p_changes ->> 'inconsistency_flags')::boolean, current_row.inconsistency_flags),
        read_on_upload = coalesce((p_changes ->> 'read_on_upload')::boolean, current_row.read_on_upload),
        updated_at = now(),
        updated_by = actor
    where organization_id = p_organization_id
    returning * into current_row;
  perform app.record_audit_event(
    p_organization_id, 'vo.settings_changed', 'vo_settings', null, 'success',
    jsonb_build_object('changes', p_changes, 'was_enabled', before_enabled, 'enabled', current_row.enabled)
  );
  return to_jsonb(current_row) - 'updated_by';
end;
$$;
