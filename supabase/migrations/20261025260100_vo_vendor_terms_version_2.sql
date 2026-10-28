-- AI vendor terms version 2026-10-25.1 (PRD AI-06). The panel now records the signed agreement
-- between each AI vendor and Casevoya (effective 2026-10-20, on file with Casevoya), keeps the
-- vendors' published terms for reference, and adds "Casevoya's commitments", written to the CICC
-- Code of Professional Conduct (SOR/2022-128). A content change is a new version: firm owners
-- acknowledge it before Vo can be turned on again (app.vo_settings_require_vendor_terms).
--
-- REDEFINES app.vo_vendor_terms_version() (latest: 20261025260000_vo_vendor_terms_ack.sql): only
-- the returned version changes. Must equal VO_VENDOR_TERMS.version in src/modules/vo/vendor-terms.ts.

create or replace function app.vo_vendor_terms_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '2026-10-25.1'::text;
$$;
revoke all on function app.vo_vendor_terms_version() from public;
grant execute on function app.vo_vendor_terms_version() to authenticated, service_role;
