-- Live official claims (#188, Francis's decisions 2026-10-25 11:42 / 11:50 CDT and 4:48 PM CDT):
-- where a rule version comes from. Its own migration so the type exists before
-- 20261025600100_src_live_claims.sql uses it.
--   official_capture  loaded from Casevoya's committed captures of an official page by
--                     scripts/ops/load-official-claims.mjs, in a database maintenance session;
--                     platform-wide (organization_id null) and live on load.
--   firm_entry        entered by a firm in Source review (Add claim); licensed review with step-up.
create type public.rule_origin as enum ('official_capture', 'firm_entry');
