-- Documents bucket reads require a fresh, audited download authorization.
--
-- Before: the storage.objects SELECT policy (documents_object_select) called
-- app.can_read_storage_object, which allowed any eligible reader to fetch a clean
-- object straight from the Storage API. That skipped the document.download audit
-- event and the 120-second signed URL lifetime.
--
-- After: public.authorize_document_download (unchanged checks and audit) also writes
-- a row to app.document_download_grants for (caller, version) that expires with the
-- signed URL. app.can_read_storage_object now requires that unexpired row for the
-- same user and the same object before a clean object is readable. The server
-- action creates the signed URL right after authorizing, so createSignedUrl (which
-- needs SELECT on the object for the caller) still works; a later direct read fails.
--
-- The upload path is unchanged: while its intent is open, the uploader may insert
-- and read back its own 'uploading' object (Storage returns the inserted row).
--
-- Only function bodies are replaced. No policy is dropped and no storage table is
-- altered; documents_object_select keeps calling app.can_read_storage_object(name).
-- Additive only.

create table app.document_download_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  version_id uuid not null references public.document_versions (id),
  user_id uuid not null references auth.users (id),
  storage_key text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table app.document_download_grants is
  'One row per authorize_document_download call. Storage reads of a clean documents object need an unexpired row for the same user and key.';

create index document_download_grants_lookup_idx
  on app.document_download_grants (storage_key, user_id, expires_at);
create index document_download_grants_org_fk_idx on app.document_download_grants (organization_id);
create index document_download_grants_version_fk_idx on app.document_download_grants (version_id);
create index document_download_grants_user_fk_idx on app.document_download_grants (user_id);

-- Definer functions only. No API role reads or writes this table.
revoke all on table app.document_download_grants from public, anon, authenticated, service_role;

create or replace function app.authorize_document_download(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version public.document_versions%rowtype;
  seconds integer;
  actor uuid := (select auth.uid());
begin
  select * into version from public.document_versions where id = p_version_id;
  if actor is null
     or version.id is null
     or app.can_read_document_version(version.id) is distinct from true
     or version.upload_state is distinct from 'clean' then
    raise exception 'document download denied' using errcode = '42501';
  end if;
  if (select app.has_org_role(version.organization_id, (select app.staff_roles())))
     and app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  seconds := app.signed_url_seconds();

  -- Expired grants for this caller are no longer useful; keep the table small.
  delete from app.document_download_grants
  where user_id = actor
    and expires_at < statement_timestamp() - interval '1 day';

  insert into app.document_download_grants (organization_id, version_id, user_id, storage_key, expires_at)
  values (
    version.organization_id,
    version.id,
    actor,
    version.storage_key,
    statement_timestamp() + make_interval(secs => seconds)
  );

  perform app.record_audit_event(
    version.organization_id,
    'document.download',
    'document_versions',
    version.id,
    'success',
    jsonb_build_object('seconds', seconds)
  );
  return jsonb_build_object(
    'bucket', version.storage_bucket,
    'storage_key', version.storage_key,
    'seconds', seconds
  );
end;
$$;

create or replace function app.can_read_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_versions version
    join public.documents doc
      on doc.id = version.document_id
     and doc.organization_id = version.organization_id
    where version.storage_key = p_name
      and version.storage_bucket = 'documents'
      and (select app.is_org_member(version.organization_id))
      and (
        (
          -- The uploader reads back its own in-flight object (Storage upload returns the row).
          version.upload_state = 'uploading'
          and version.created_by = (select auth.uid())
          and version.intent_expires_at > statement_timestamp()
        )
        or (
          version.upload_state = 'clean'
          -- A fresh, audited authorization from authorize_document_download is required.
          and exists (
            select 1
            from app.document_download_grants grant_row
            where grant_row.storage_key = p_name
              and grant_row.version_id = version.id
              and grant_row.user_id = (select auth.uid())
              and grant_row.expires_at > statement_timestamp()
          )
          and (
            (
              doc.audience <> 'staff'
              and exists (
                select 1
                from public.persons person
                where person.id = doc.person_id
                  and person.user_id = (select auth.uid())
              )
            )
            or (
              doc.audience = 'matter'
              and doc.sensitivity = 'ordinary'
              and exists (
                select 1
                from public.document_matter_refs ref
                join public.matter_participants party
                  on party.matter_id = ref.matter_id
                 and party.organization_id = ref.organization_id
                join public.persons person
                  on person.id = party.person_id
                 and person.organization_id = party.organization_id
                where ref.document_id = doc.id
                  and ref.removed_at is null
                  and person.user_id = (select auth.uid())
              )
            )
            or (
              (select app.staff_mfa_satisfied())
              and (select app.has_org_role(
                doc.organization_id,
                array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
              ))
              and (
                (select app.actor_is_firm_owner(doc.organization_id))
                or exists (
                  select 1
                  from public.document_matter_refs ref
                  join public.matter_participants party
                    on party.matter_id = ref.matter_id
                   and party.organization_id = ref.organization_id
                  join public.memberships membership
                    on membership.id = party.membership_id
                   and membership.organization_id = party.organization_id
                  where ref.document_id = doc.id
                    and ref.removed_at is null
                    and membership.user_id = (select auth.uid())
                    and membership.status = 'active'
                    and membership.role = any (
                      array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
                    )
                )
              )
            )
          )
        )
      )
  );
$$;
