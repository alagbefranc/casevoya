-- Migration import rollback (T044): a matter a migration batch created carries the rule pack binding
-- create_engaged_matter wrote with it. Bindings are retained (they show which rules applied to work
-- done), so app.guard_matter_rule_binding refuses every DELETE. A rollback removes only matters the
-- batch created and nobody changed since (public.rollback_migration_batch checks versions, legal
-- holds and every new reference first), so their binding goes with them.
--
-- Redefines app.guard_matter_rule_binding, copied from its latest definition
-- (20261017113157_source_governance.sql). The only change: a DELETE is allowed when
-- app.migration_rollback_deletes(old.matter_id) is true, which holds only inside
-- rollback_migration_batch for a matter that batch created. Same security definer, same
-- search_path, same grants.

create or replace function app.guard_matter_rule_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter_org uuid;
  pack_org uuid;
  pack_status public.rule_publication_status;
begin
  if tg_op = 'DELETE' then
    if app.migration_rollback_deletes(old.matter_id) then
      return old;
    end if;
    raise exception 'matter rule bindings are retained' using errcode = '42501';
  end if;

  select m.organization_id into matter_org
  from public.matters m
  where m.id = new.matter_id;
  if not found or matter_org is distinct from new.organization_id then
    raise exception 'binding organization must match the matter' using errcode = '42501';
  end if;

  select p.organization_id, p.status into pack_org, pack_status
  from public.rule_pack_versions p
  where p.id = new.rule_pack_version_id;
  if not found then
    raise exception 'rule pack does not exist' using errcode = '23503';
  end if;
  if pack_org is not null and pack_org is distinct from new.organization_id then
    raise exception 'cannot pin another organization rule pack' using errcode = '42501';
  end if;
  if pack_status not in ('published', 'review_due', 'suspended', 'superseded') then
    raise exception 'a matter can only pin a published rule pack' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.recheck_required := false;
    return new;
  end if;

  if new.matter_id is distinct from old.matter_id
     or new.organization_id is distinct from old.organization_id
     or new.rule_pack_version_id is distinct from old.rule_pack_version_id
     or new.id is distinct from old.id then
    raise exception 'matter rule pack pin is immutable' using errcode = '42501';
  end if;
  if new.recheck_required is distinct from old.recheck_required
     and coalesce(current_setting('app.binding_recheck_write', true), '') is distinct from 'on' then
    raise exception 'recheck_required is maintained when source content changes' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_matter_rule_binding() from public;
