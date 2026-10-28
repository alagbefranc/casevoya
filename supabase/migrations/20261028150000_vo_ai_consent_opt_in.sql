-- Decision #263-3: Vo reads a client's documents only with the client's AI consent (opt-in).
--
-- Before: app.person_declines_ai was true only when the client's latest AI drafting record was a
-- refusal or withdrawn, so a client with NO record (clients from before the question, clients a
-- firm added without a portal) still had their documents read by Vo.
-- Now: Vo reads a client's documents only when their latest AI drafting record is a yes that
-- hasn't been withdrawn. No record, a no, or a withdrawn yes: Vo skips their documents.
--
-- Redefined (latest definitions in 20261025270100_sec_sessions_consent.sql; signatures and grants kept):
--   app.person_declines_ai(org, person)          true unless app.person_consent_state(...,'ai_drafting')
--                                                is true (was: only when it is false). The name is kept:
--                                                it is "Vo may not use AI on this person's records".
--   public.begin_vo_document_review(org, version) the client_ai_off result also carries the document's
--                                                person_id so the app can name the client. Otherwise
--                                                unchanged; it is the only caller of person_declines_ai
--                                                and the one database entry point that hands a client's
--                                                document contents to Vo ("Read with Vo" and "Read
--                                                documents on upload" both start here).
--
-- app.person_consent_state is unchanged (true given, false refused or withdrawn, null never asked).
-- No data changes: no consent is created or assumed for anyone.

create or replace function app.person_declines_ai(p_org uuid, p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.person_consent_state(p_org, p_person_id, 'ai_drafting') is not true;
$$;
revoke all on function app.person_declines_ai(uuid, uuid) from public;
grant execute on function app.person_declines_ai(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.begin_vo_document_review, last defined in 20261025270100_sec_sessions_consent.sql.
-- Change: client_ai_off also returns the document's person_id.
-- ---------------------------------------------------------------------------
create or replace function public.begin_vo_document_review(p_organization_id uuid, p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  version public.document_versions%rowtype;
  doc public.documents%rowtype;
  matter public.matters%rowtype;
  settings public.vo_settings%rowtype;
  category text;
  waiting uuid;
  last_hour integer;
  last_day integer;
  firm_day integer;
  rid uuid;
begin
  -- Reading the file is a download: staff with MFA and a fresh second factor, as for Open file.
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[],
    true
  );
  select * into version from public.document_versions where id = p_version_id and organization_id = p_organization_id;
  if version.id is null or app.can_read_document_version(version.id) is distinct from true then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  select * into doc from public.documents where id = version.document_id and organization_id = p_organization_id;
  -- The matter the reading belongs to: one this document is linked to that the person may read.
  select m.* into matter
  from public.document_matter_refs ref
  join public.matters m on m.id = ref.matter_id and m.organization_id = ref.organization_id
  where ref.document_id = doc.id
    and ref.organization_id = p_organization_id
    and ref.removed_at is null
    and app.message_staff_reads_matter(m.id, m.organization_id)
  order by ref.created_at asc
  limit 1;
  if doc.id is null or matter.id is null then
    raise exception 'vo denied' using errcode = '42501';
  end if;
  if version.upload_state is distinct from 'clean' then
    return jsonb_build_object('ok', false, 'error', 'not_clean');
  end if;
  if app.vo_enabled(p_organization_id) is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'off');
  end if;
  -- SEC-05, decision #263-3: Vo reads a client's documents only when the client said yes to AI
  -- drafting and hasn't withdrawn it. No answer yet (an existing client, a client without a
  -- portal) is the same as no. The person id lets the app name the client in its message.
  if app.person_declines_ai(p_organization_id, doc.person_id) then
    return jsonb_build_object('ok', false, 'error', 'client_ai_off', 'person_id', doc.person_id);
  end if;
  select * into settings from public.vo_settings where organization_id = p_organization_id;
  if settings.organization_id is not null
     and not (settings.doc_classification or settings.ocr_normalisation or settings.missing_fields or settings.inconsistency_flags) then
    return jsonb_build_object('ok', false, 'error', 'capability_off');
  end if;
  category := app.vo_document_category(doc.purpose, doc.sensitivity);
  if app.vo_category_allowed(p_organization_id, category) is distinct from true then
    return jsonb_build_object('ok', false, 'error', 'category_off', 'category', category);
  end if;
  if app.sample_mode_blocks_real(p_organization_id, matter.is_sample) then
    return jsonb_build_object('ok', false, 'error', 'sample_only');
  end if;
  select d.id into waiting from public.vo_doc_drafts d
  where d.version_id = version.id and d.organization_id = p_organization_id and d.status = 'draft'
  limit 1;
  if waiting is not null then
    return jsonb_build_object('ok', false, 'error', 'already_read', 'draft_id', waiting, 'matter_id', matter.id);
  end if;

  -- The same per-firm serialization and limits as every Vo run.
  perform pg_advisory_xact_lock(hashtextextended('vo_run:' || p_organization_id::text, 0));
  select count(*) filter (where user_id = actor and created_at > statement_timestamp() - interval '1 hour'),
         count(*) filter (where user_id = actor),
         count(*)
  into last_hour, last_day, firm_day
  from public.vo_runs
  where organization_id = p_organization_id
    and created_at > statement_timestamp() - interval '1 day';
  if last_hour >= 20 or last_day >= 100 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if firm_day >= 300 then
    return jsonb_build_object('ok', false, 'error', 'firm_rate_limited');
  end if;

  insert into public.vo_runs (organization_id, user_id, kind, matter_id, thread_id, version_id, is_sample)
  values (p_organization_id, actor, 'document_review', matter.id, null, version.id, matter.is_sample)
  returning id into rid;
  perform app.record_audit_event(
    p_organization_id, 'vo.run_started', 'vo_runs', rid, 'success',
    jsonb_build_object('kind', 'document_review', 'version_id', version.id, 'category', category)
  );
  return jsonb_build_object('ok', true, 'run_id', rid, 'matter_id', matter.id, 'category', category);
end;
$$;
revoke all on function public.begin_vo_document_review(uuid, uuid) from public, anon;
grant execute on function public.begin_vo_document_review(uuid, uuid) to authenticated, service_role;
