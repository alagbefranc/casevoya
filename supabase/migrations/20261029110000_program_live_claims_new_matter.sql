-- #272 item 6: New matter offered programs that public.support_catalogue counts as supported
-- through live official form or checklist claims only (no catalogue entry and no approved rule
-- pack, #188), and app.program_pack_for_new_matter then refused them with "choose a program from
-- the support catalogue". It now accepts such a program too; the matter opens with no rule pack
-- (as an unsupported program scope, like a catalogued program without a pack). No data changes,
-- nothing is seeded.
--
-- Redefined: app.program_pack_for_new_matter (latest in 20261025410000_src_pins_scope.sql). Only
-- the refusal's condition changes: a program with a live official form or checklist claim
-- (the same test as support_catalogue's claims_only) is a catalogue program.

create or replace function app.program_pack_for_new_matter(p_program_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := app.current_organization_id();
  v_pack uuid;
begin
  if v_org is null or app.is_org_staff(v_org) is distinct from true then
    raise exception 'matter create denied' using errcode = '42501';
  end if;
  if p_program_key is null or p_program_key !~ '^[a-z0-9_]{1,80}$' then
    raise exception 'choose a program from the support catalogue' using errcode = '22023';
  end if;
  v_pack := app.current_program_pack(v_org, p_program_key);
  if v_pack is null and not exists (
    select 1 from public.support_catalogue_entries e
    where e.scope_kind = 'program' and e.scope_key = p_program_key and e.active
  ) and not exists (
    -- #272: listed by the catalogue through its live official form or checklist claims.
    select 1 from public.rule_definitions d
    where d.organization_id is null
      and d.source_category in ('form', 'checklist')
      and d.program_key = p_program_key
      and app.official_live_version(d.id) is not null
  ) then
    raise exception 'choose a program from the support catalogue' using errcode = '22023';
  end if;
  return v_pack;
end;
$$;
revoke all on function app.program_pack_for_new_matter(text) from public, anon;
grant execute on function app.program_pack_for_new_matter(text) to authenticated, service_role;
