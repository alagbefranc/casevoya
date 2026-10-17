-- Upload completion trusts only bytes the server read from Storage.
--
-- Before: public.complete_document_upload(p_version_id, p_sha256, p_header_hex) was
-- executable by authenticated through PostgREST. The header bytes and SHA-256 were
-- whatever the caller sent, so any uploaded content could be marked clean by sending
-- a PDF header. Any ZIP also passed as DOCX.
--
-- After: the server action (src/modules/documents/actions.ts) checks the caller with
-- the user's session, then downloads the object with a service-role client, streams
-- it for SHA-256 and size, checks magic bytes (and for DOCX, that
-- [Content_Types].xml declares a wordprocessingml main document), and calls
-- public.finish_verified_document_upload with the verified values. That function is
-- executable by service_role only and re-checks that the named actor created the
-- upload and is still an active member of the firm. The old function stays in place
-- but is no longer executable by authenticated.
-- Additive only.

revoke execute on function public.complete_document_upload(uuid, text, text) from public, anon, authenticated;
revoke execute on function app.complete_document_upload(uuid, text, text) from public, anon, authenticated;

create function app.finish_verified_document_upload(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_sha256 text,
  p_byte_size bigint,
  p_detected_media_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  stored_size bigint;
  detected text;
  next_state public.document_upload_state;
  next_engine text;
  next_result text;
  next_reason text;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  select * into version from public.document_versions where id = p_version_id for update;
  if version.id is null
     or p_actor_user_id is null
     or version.created_by is distinct from p_actor_user_id
     or not exists (
       select 1
       from public.memberships membership
       where membership.organization_id = version.organization_id
         and membership.user_id = p_actor_user_id
         and membership.status = 'active'
     ) then
    raise exception 'document upload denied' using errcode = '42501';
  end if;
  if version.upload_state <> 'uploading' then
    return jsonb_build_object(
      'version_id', version.id,
      'upload_state', version.upload_state,
      'scan_result', version.scan_result,
      'detected_media_type', version.detected_media_type
    );
  end if;

  if version.intent_expires_at <= statement_timestamp() then
    next_state := 'failed';
    next_result := 'intent_expired';
    next_reason := 'upload authorization expired';
  elsif p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'checksum must be a sha256 hex digest' using errcode = '22023';
  elsif p_byte_size is null or p_byte_size < 1 then
    raise exception 'measured size is required' using errcode = '22023';
  elsif p_detected_media_type is not null and p_detected_media_type not in (
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) then
    raise exception 'detected media type is not allowed' using errcode = '22023';
  else
    detected := p_detected_media_type;
    select (metadata ->> 'size')::bigint into stored_size
    from storage.objects
    where bucket_id = 'documents'
      and name = version.storage_key;
    if stored_size is null then
      raise exception 'stored object was not found' using errcode = '22023';
    end if;
    if stored_size <> p_byte_size
       or p_byte_size <> version.declared_byte_size
       or p_byte_size > app.document_max_bytes(version.organization_id) then
      next_state := 'failed';
      next_result := 'size_mismatch';
      next_reason := 'stored size does not match the upload authorization';
    elsif detected is null then
      next_state := 'failed';
      next_result := 'unrecognized_type';
      next_reason := 'file contents are not PDF, JPEG, PNG, HEIC, or DOCX';
    elsif detected is distinct from version.declared_media_type then
      next_state := 'quarantined';
      next_result := 'extension_mismatch';
      next_reason := 'file contents do not match the filename';
    elsif app.product_setting_enabled('documents.accept_structural_inspection') then
      next_state := 'clean';
      next_engine := 'structural_only';
      next_result := 'structural_only';
    else
      next_state := 'scanning';
      next_result := 'awaiting_scanner';
    end if;
  end if;

  perform app.open_document_write(version.id);
  update public.document_versions
  set upload_state = next_state,
      detected_media_type = coalesce(detected, detected_media_type),
      byte_size = coalesce(p_byte_size, byte_size),
      checksum_sha256 = case when p_sha256 ~ '^[0-9a-f]{64}$' then p_sha256 else checksum_sha256 end,
      scan_result = next_result,
      scan_engine = next_engine,
      quarantine_reason = next_reason,
      completed_at = statement_timestamp()
  where id = version.id;
  perform app.close_document_write(version.id);

  if next_state = 'clean' then
    perform app.enqueue_event(
      version.organization_id, 'document', version.document_id, 'document.uploaded',
      jsonb_build_object('document_id', version.document_id, 'version_id', version.id, 'matter_id', (
        select ref.matter_id from public.document_matter_refs ref
        where ref.document_id = version.document_id and ref.removed_at is null
        order by ref.created_at desc
        limit 1
      )),
      version.version_number,
      'document.uploaded:' || version.id::text,
      null
    );
  elsif next_state = 'quarantined' then
    perform app.enqueue_event(
      version.organization_id, 'document', version.document_id, 'document.quarantined',
      jsonb_build_object('document_id', version.document_id, 'version_id', version.id, 'scan_result', next_result),
      version.version_number,
      'document.quarantined:' || version.id::text,
      null
    );
  end if;

  perform app.record_audit_event(
    version.organization_id,
    'document.upload_completed',
    'document_versions',
    version.id,
    case when next_state in ('clean', 'scanning') then 'success' else 'denied' end,
    jsonb_build_object(
      'upload_state', next_state,
      'scan_result', next_result,
      'actor_user_id', p_actor_user_id,
      'verified_by', 'server'
    )
  );

  return jsonb_build_object(
    'version_id', version.id,
    'upload_state', next_state,
    'scan_result', next_result,
    'detected_media_type', detected
  );
end;
$$;
revoke all on function app.finish_verified_document_upload(uuid, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function app.finish_verified_document_upload(uuid, uuid, text, bigint, text) to service_role;

create function public.finish_verified_document_upload(
  p_version_id uuid,
  p_actor_user_id uuid,
  p_sha256 text,
  p_byte_size bigint,
  p_detected_media_type text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.finish_verified_document_upload(
    p_version_id, p_actor_user_id, p_sha256, p_byte_size, p_detected_media_type
  );
$$;
revoke all on function public.finish_verified_document_upload(uuid, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.finish_verified_document_upload(uuid, uuid, text, bigint, text) to service_role;

comment on function public.finish_verified_document_upload(uuid, uuid, text, bigint, text) is
  'service_role only. Completes an upload with SHA-256, size, and media type measured by the server from the stored object.';
