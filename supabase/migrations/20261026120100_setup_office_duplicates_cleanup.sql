-- DESTRUCTIVE (deletes rows). Review before applying. Issue #259, fix 5, part 2.
--
-- Removes the duplicate "Main office" rows that firm setup step 1 left before
-- 20261026120000_setup_office_update.sql (each save demoted the primary office and inserted a new
-- one). Apply that migration first. This one can be skipped: nothing depends on it.
--
-- It deletes a row only when all of these hold:
--   * it is not the firm's primary office, and is labelled "Main office" (the label setup uses);
--   * the same firm has a primary office (the newest save, which is kept);
--   * every address field (label, address line, locality, region, postal code, country,
--     timezone) is the same as that primary office's, so nothing the firm typed is lost;
--   * no foreign key anywhere references public.organization_offices. None does today; if one
--     is added before this runs, nothing is deleted and only the counts are reported.
-- A demoted "Main office" whose address differs from the primary one is kept and only counted,
-- so the firm can remove it from Settings > Practice if it is not a real office.
-- The audit trigger on organization_offices records each deletion in audit_log.
-- The DO block reports its counts with RAISE NOTICE.

do $$
declare
  references_offices integer;
  identical integer;
  differing integer;
  removed integer := 0;
begin
  select count(*) into references_offices
    from pg_constraint fk
   where fk.contype = 'f'
     and fk.confrelid = 'public.organization_offices'::regclass;

  select count(*) into identical
    from public.organization_offices dup
    join public.organization_offices main
      on main.organization_id = dup.organization_id
     and main.is_primary
     and main.id <> dup.id
   where not dup.is_primary
     and btrim(dup.label) = 'Main office'
     and dup.label = main.label
     and dup.address_line = main.address_line
     and dup.locality = main.locality
     and dup.region is not distinct from main.region
     and dup.postal_code is not distinct from main.postal_code
     and dup.country_code = main.country_code
     and dup.timezone is not distinct from main.timezone;

  select count(*) into differing
    from public.organization_offices dup
   where not dup.is_primary
     and btrim(dup.label) = 'Main office'
     and exists (
       select 1 from public.organization_offices main
        where main.organization_id = dup.organization_id
          and main.is_primary
          and main.id <> dup.id
          and (dup.label <> main.label
               or dup.address_line <> main.address_line
               or dup.locality <> main.locality
               or dup.region is distinct from main.region
               or dup.postal_code is distinct from main.postal_code
               or dup.country_code <> main.country_code
               or dup.timezone is distinct from main.timezone)
     );

  if references_offices = 0 then
    delete from public.organization_offices dup
     using public.organization_offices main
     where main.organization_id = dup.organization_id
       and main.is_primary
       and main.id <> dup.id
       and not dup.is_primary
       and btrim(dup.label) = 'Main office'
       and dup.label = main.label
       and dup.address_line = main.address_line
       and dup.locality = main.locality
       and dup.region is not distinct from main.region
       and dup.postal_code is not distinct from main.postal_code
       and dup.country_code = main.country_code
       and dup.timezone is not distinct from main.timezone;
    get diagnostics removed = row_count;
  end if;

  raise notice 'setup office cleanup: % identical duplicate(s) found, % removed, % differing "Main office" row(s) kept, % foreign key(s) reference organization_offices',
    identical, removed, differing, references_offices;
end;
$$;
