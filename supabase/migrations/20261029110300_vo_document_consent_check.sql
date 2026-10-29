-- #272 item 7a (#270): "Read with Vo" showed "Vo is reading the document" before the refusal for
-- a client who hasn't agreed to AI help, because the consent check runs inside the reading's own
-- server call. This read-only check lets the Sheet ask first, so the "reading" message only shows
-- when Vo may read the client's document.
--
-- New: public.vo_document_client_ai_off(org, version). It answers with the same decision
-- public.begin_vo_document_review makes (app.person_declines_ai on the document's person), for a
-- version this staff member may read; it creates no run, reads no file and changes nothing.
-- begin_vo_document_review stays the authority and still refuses on its own.
--   returns {"client_ai_off": true, "person_id": <uuid>} when Vo may not read it for consent;
--           {"client_ai_off": false} otherwise, including when the caller can't read the version
--           (the reading itself then refuses as before, with no detail given here).

create function public.vo_document_client_ai_off(p_organization_id uuid, p_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid;
begin
  if (select auth.uid()) is null
     or p_organization_id is distinct from app.current_organization_id()
     or app.in_active_org(p_organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(p_organization_id, array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]) is distinct from true then
    return jsonb_build_object('client_ai_off', false);
  end if;
  if not exists (
    select 1 from public.document_versions version
    where version.id = p_version_id and version.organization_id = p_organization_id
  ) or app.can_read_document_version(p_version_id) is distinct from true then
    return jsonb_build_object('client_ai_off', false);
  end if;
  select doc.person_id into v_person
  from public.document_versions version
  join public.documents doc on doc.id = version.document_id and doc.organization_id = version.organization_id
  where version.id = p_version_id and version.organization_id = p_organization_id;
  if app.person_declines_ai(p_organization_id, v_person) then
    return jsonb_build_object('client_ai_off', true, 'person_id', v_person);
  end if;
  return jsonb_build_object('client_ai_off', false);
end;
$$;
comment on function public.vo_document_client_ai_off(uuid, uuid) is
  '#272: whether Vo may not read this document version because its client hasn''t agreed to AI help (the same test as begin_vo_document_review). Staff who may read the version; read only.';
revoke all on function public.vo_document_client_ai_off(uuid, uuid) from public, anon;
grant execute on function public.vo_document_client_ai_off(uuid, uuid) to authenticated, service_role;
