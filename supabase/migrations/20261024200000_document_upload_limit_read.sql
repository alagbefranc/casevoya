-- DOC-02 (#178): anyone in the firm can read the per-file upload limit in force, so the portal and
-- the Sheet say it before a file is chosen, and a refusal names it. The limit itself is still set
-- only by the owner (public.set_document_upload_limit) and enforced by app.document_max_bytes.
--
-- New function:
--   public.document_upload_limit(uuid)   members of the firm (staff and portal users): the limit in
--                                        bytes, as app.document_max_bytes returns it.

create function public.document_upload_limit(p_organization_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or app.in_active_org(p_organization_id) is distinct from true then
    raise exception 'upload limit denied' using errcode = '42501';
  end if;
  return app.document_max_bytes(p_organization_id);
end;
$$;
revoke all on function public.document_upload_limit(uuid) from public;
grant execute on function public.document_upload_limit(uuid) to authenticated;
