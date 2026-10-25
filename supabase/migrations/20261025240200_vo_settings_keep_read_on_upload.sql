-- Follow-up to 20261025240100_vo_letter_drafts.sql (AI-01, #226): keep DOC-05's read_on_upload switch.
--
-- The live project already runs #206's public.set_vo_settings (20261025000000_vo_read_on_upload.sql), which
-- accepts read_on_upload. 20261025240100 redefined set_vo_settings from the older 20261019218100 body plus
-- letter_drafts, so on its own it drops read_on_upload. This migration:
--   * adds vo_settings.read_on_upload when it's missing, with #206's definition (a no-op on prod and once
--     #206 is merged, since its migration sorts first);
--   * redefines public.set_vo_settings from #206's body (20261025000000) plus the letter_drafts key, so both
--     switches work whichever PR lands first. Nothing else changes.
-- Apply it together with 20261025240000 and 20261025240100.

alter table public.vo_settings add column if not exists read_on_upload boolean not null default false;
comment on column public.vo_settings.read_on_upload is
  'DOC-05: Vo reads new uploads when staff open the matter''s Documents tab. Off by default; every other Vo switch still applies.';

-- public.set_vo_settings(uuid, jsonb): from 20261025000000_vo_read_on_upload.sql, plus letter_drafts (20261025240100).
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
    'read_on_upload',
    -- AI-01 letter drafts
    'letter_drafts'
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
        letter_drafts = coalesce((p_changes ->> 'letter_drafts')::boolean, current_row.letter_drafts),
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
