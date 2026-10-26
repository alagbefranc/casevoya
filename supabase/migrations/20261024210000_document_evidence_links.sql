-- DOC-06 (#178): the same verified evidence on several matters, translations, and a document's
-- classification, each changed only through a function that checks access and writes the audit log.
--
-- New functions:
--   public.link_document_matter(uuid, uuid)
--       owner, licensed consultant or case manager (aal2) who can read the document and the matter:
--       uses a document whose current version passed its file check on another matter of the same
--       person (they must be on that matter). An existing link is returned, not duplicated.
--       Removing it again is public.unlink_document_matter (unchanged): the file itself is never
--       deleted by removing a link, so a matter that still uses it keeps it.
--   public.set_document_translation(uuid, integer, uuid, text)
--       the same roles: marks one version as the translation of another version of the same
--       person's documents, with the translation's language, or clears it (null original).
--   public.set_document_classification(uuid, integer, text, public.document_sensitivity)
--       the same roles: changes a document's type (its purpose line) and its sensitivity. Changing
--       the sensitivity needs a recent step-up, because it changes who may read the file.
-- Expiry stays public.set_document_expiry (unchanged, audited by this file's callers through it).

create function public.link_document_matter(p_document_id uuid, p_matter_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc public.documents%rowtype;
  current_state public.document_upload_state;
  existing uuid;
  new_id uuid;
begin
  select * into doc from public.documents where id = p_document_id;
  if doc.id is null or app.can_read_document(doc.id) is distinct from true then
    raise exception 'document link denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    doc.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if p_matter_id is null or app.can_read_matter(p_matter_id) is distinct from true then
    raise exception 'document link denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.matters matter
    where matter.id = p_matter_id and matter.organization_id = doc.organization_id
  ) then
    raise exception 'document link denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.matter_participants party
    where party.matter_id = p_matter_id
      and party.organization_id = doc.organization_id
      and party.person_id = doc.person_id
  ) then
    raise exception 'the document''s person is not on that matter' using errcode = '22023';
  end if;
  select version.upload_state into current_state
  from public.document_versions version
  where version.id = doc.current_version_id;
  if current_state is distinct from 'clean' then
    raise exception 'only a file that passed its check can be used on another matter' using errcode = '22023';
  end if;
  select ref.id into existing
  from public.document_matter_refs ref
  where ref.document_id = doc.id and ref.matter_id = p_matter_id and ref.removed_at is null
  limit 1;
  if existing is not null then
    return existing;
  end if;
  insert into public.document_matter_refs (organization_id, document_id, matter_id, created_by)
  values (doc.organization_id, doc.id, p_matter_id, (select auth.uid()))
  returning id into new_id;
  perform app.record_audit_event(
    doc.organization_id, 'document.linked', 'document_matter_refs', new_id, 'success',
    jsonb_build_object('document_id', doc.id, 'matter_id', p_matter_id)
  );
  return new_id;
end;
$$;
revoke all on function public.link_document_matter(uuid, uuid) from public;
grant execute on function public.link_document_matter(uuid, uuid) to authenticated;

create function public.set_document_translation(
  p_version_id uuid,
  p_expected_version integer,
  p_original_version_id uuid,
  p_language_tag text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  original public.document_versions%rowtype;
  person uuid;
  original_person uuid;
  tag text := nullif(btrim(p_language_tag), '');
  new_version integer;
begin
  select * into version from public.document_versions where id = p_version_id for update;
  if version.id is null or app.can_read_document_version(version.id) is distinct from true then
    raise exception 'document review denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    version.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if version.version is distinct from p_expected_version then
    raise exception 'document version conflict' using errcode = 'PT409';
  end if;
  if p_original_version_id is not null then
    select * into original from public.document_versions where id = p_original_version_id;
    if original.id is null or original.organization_id is distinct from version.organization_id
       or app.can_read_document_version(original.id) is distinct from true then
      raise exception 'document review denied' using errcode = '42501';
    end if;
    if original.document_id = version.document_id then
      raise exception 'a translation is of another document' using errcode = '22023';
    end if;
    if original.translation_of_version_id = version.id then
      raise exception 'that document is already a translation of this one' using errcode = '22023';
    end if;
    select doc.person_id into person from public.documents doc where doc.id = version.document_id;
    select doc.person_id into original_person from public.documents doc where doc.id = original.document_id;
    if person is distinct from original_person then
      raise exception 'a translation belongs to the same person as the original' using errcode = '22023';
    end if;
    if tag is null or tag !~ '^[a-z]{2}(-[A-Z]{2})?$' then
      raise exception 'choose the translation''s language' using errcode = '22023';
    end if;
  end if;
  perform app.open_document_write(version.id);
  update public.document_versions
  set translation_of_version_id = p_original_version_id,
      language_tag = case when p_original_version_id is null then null else tag end
  where id = version.id
  returning public.document_versions.version into new_version;
  perform app.close_document_write(version.id);
  perform app.record_audit_event(
    version.organization_id,
    case when p_original_version_id is null then 'document.translation_cleared' else 'document.translation_set' end,
    'document_versions', version.id, 'success',
    jsonb_build_object('document_id', version.document_id, 'original_version_id', p_original_version_id, 'language_tag', tag)
  );
  return new_version;
end;
$$;
revoke all on function public.set_document_translation(uuid, integer, uuid, text) from public;
grant execute on function public.set_document_translation(uuid, integer, uuid, text) to authenticated;

create function public.set_document_classification(
  p_document_id uuid,
  p_expected_version integer,
  p_purpose text,
  p_sensitivity public.document_sensitivity
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc public.documents%rowtype;
  new_purpose text := btrim(coalesce(p_purpose, ''));
  new_version integer;
begin
  select * into doc from public.documents where id = p_document_id for update;
  if doc.id is null or app.can_read_document(doc.id) is distinct from true then
    raise exception 'document review denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    doc.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    p_sensitivity is distinct from doc.sensitivity
  );
  if doc.version is distinct from p_expected_version then
    raise exception 'document version conflict' using errcode = 'PT409';
  end if;
  if length(new_purpose) not between 1 and 200 then
    raise exception 'say what the document is, in up to 200 characters' using errcode = '22023';
  end if;
  if p_sensitivity is null then
    raise exception 'choose how sensitive the document is' using errcode = '22023';
  end if;
  perform app.open_document_write(doc.id);
  update public.documents
  set purpose = new_purpose,
      sensitivity = p_sensitivity
  where id = doc.id
  returning public.documents.version into new_version;
  perform app.close_document_write(doc.id);
  perform app.record_audit_event(
    doc.organization_id, 'document.classified', 'documents', doc.id, 'success',
    jsonb_build_object('purpose_changed', new_purpose is distinct from doc.purpose, 'sensitivity', p_sensitivity, 'previous_sensitivity', doc.sensitivity)
  );
  return new_version;
end;
$$;
revoke all on function public.set_document_classification(uuid, integer, text, public.document_sensitivity) from public;
grant execute on function public.set_document_classification(uuid, integer, text, public.document_sensitivity) to authenticated;
