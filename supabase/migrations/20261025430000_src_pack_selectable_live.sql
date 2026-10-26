-- SRC follow-up (Francis, 2026-10-25, gap #188): the direct program-selection path
-- (app.select_matter_program and the callers that check app.pack_is_selectable) accepts only a
-- live pack, the same rule as matter creation, the support catalogue and upgrades
-- (app.rule_pack_is_live, 20261025410100). A review-due pack, or one holding a suspended,
-- superseded, rejected, expired or not-yet-effective rule version, can no longer be selected.
--
-- Redefines app.pack_is_selectable(uuid, uuid), copied from its only definition in
-- 20261017170000_matter_lifecycle.sql; the only change is the status test. Grants are kept.

create or replace function app.pack_is_selectable(p_pack uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rule_pack_versions pack
    join public.organizations org on org.id = p_org
    where pack.id = p_pack
      and app.rule_pack_is_live(pack.id)
      and (pack.organization_id is null or pack.organization_id = p_org)
      and exists (
        select 1
        from unnest(org.jurisdiction_codes) firm_code
        where pack.jurisdiction = firm_code
           or pack.jurisdiction like firm_code || '-%'
      )
  );
$$;
revoke all on function app.pack_is_selectable(uuid, uuid) from public;
