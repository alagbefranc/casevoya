-- Tests for 20261029220000_adm_platform_admin_pages.sql.
-- Run against a throwaway local Supabase Postgres with every migration applied:
--   psql -v ON_ERROR_STOP=1 -1 -f supabase/tests/adm_platform_admin_pages.test.sql
-- Everything runs in one transaction and is rolled back at the end.

begin;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;

create function pg_temp.as_user(p_uid uuid, p_fresh boolean default true, p_aal text default 'aal2') returns void language plpgsql as $$
declare ts bigint := extract(epoch from now())::bigint - case when p_fresh then 60 else 3600 end;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_uid, 'role', 'authenticated', 'aal', p_aal, 'iat', extract(epoch from now())::bigint,
    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', ts - 5),
                             jsonb_build_object('method', 'totp', 'timestamp', ts)))::text, true);
end $$;

create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected failure (%) but it succeeded: %', p_like, p_sql;
exception when others then
  if sqlerrm not like '%' || p_like || '%' then
    raise exception 'expected error like "%" but got "%" for %', p_like, sqlerrm, p_sql;
  end if;
end $$;

create function pg_temp.assert(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'assertion failed: %', p_msg; end if;
end $$;

grant execute on all functions in schema pg_temp to service_role, authenticated;

-- Seed (triggers off for seeding only; rolled back at the end).
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p1@test.local', now(), now(), now()),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p2@test.local', now(), now(), now()),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p3@test.local', now(), now(), now());
insert into public.organizations (id, legal_name, display_name, slug, sample_mode) values
  ('00000000-0000-4000-8000-0000000000f1', 'Solo Firm Ltd', 'Solo Firm', 'solo-firm-test', false),
  ('00000000-0000-4000-8000-0000000000f2', 'Trial Firm Ltd', 'Trial Firm', 'trial-firm-test', true);
insert into public.organization_subscriptions (organization_id, status, plan, extra_seats) values
  ('00000000-0000-4000-8000-0000000000f1', 'active', 'solo', 0),
  ('00000000-0000-4000-8000-0000000000f2', 'trial', null, 0);
insert into public.memberships (id, organization_id, user_id, role, status) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', 'firm_owner', 'active'),
  (gen_random_uuid(), '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a2', 'case_manager', 'active'),
  (gen_random_uuid(), '00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a3', 'assistant', 'active'),
  (gen_random_uuid(), '00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000a1', 'firm_owner', 'active');
insert into public.matters (id, organization_id, title, is_sample) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000f1', 'M1', false),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000f2', 'Sample', true);
insert into public.vo_runs (organization_id, user_id, kind, matter_id, result, input_tokens, output_tokens, cost_usd, created_at, finished_at, failure) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', 'ask', '00000000-0000-4000-8000-0000000000c1', 'answered', 100, 50, 0.01, now(), now(), null),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', 'ask', '00000000-0000-4000-8000-0000000000c1', 'failed', 10, 0, 0.001, now(), now(), 'failed'),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', 'ask', '00000000-0000-4000-8000-0000000000c1', 'answered', 1, 1, 0, now() - interval '40 days', now() - interval '40 days', null);
insert into public.privacy_requests (organization_id, number, reference, kind, requester_name, details, channel, received_on, target_days, due_on, closed_at, closed_by, outcome, idempotency_key, assignee_membership_id) values
  ('00000000-0000-4000-8000-0000000000f1', 1, 'PR-001', 'access', 'Secret Name', 'Secret details', 'email', current_date - 40, 30, current_date - 10, null, null, null, 'key-0001', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000f1', 2, 'PR-002', 'correction', 'Other Name', 'More words', 'email', current_date - 27, 30, current_date + 3, null, null, null, 'key-0002', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000f1', 3, 'PR-003', 'access', 'Third', 'Done here', 'portal', current_date - 20, 30, current_date + 10, now() - interval '1 day', '00000000-0000-4000-8000-0000000000a1', 'withdrawn', 'key-0003', '00000000-0000-4000-8000-0000000000e1');
insert into public.migration_batches (organization_id, file_name, source_system, source_sha256, byte_size, source_row_count, parsed_digest, headers, mapping, status, kind, commit_started_at, updated_at, exceptions, purge_after, is_sample) values
  ('00000000-0000-4000-8000-0000000000f1', 'Smith_client_list.csv', 'csv', repeat('a', 64), 100, 2, repeat('a', 64), array['name'], '{}', 'committing', 'clients_matters', now() - interval '2 hours', now() - interval '2 hours', '[{"row": 2}]', now() - interval '1 day', false),
  ('00000000-0000-4000-8000-0000000000f2', 'sample.csv', 'csv', repeat('a', 64), 100, 2, repeat('a', 64), array['name'], '{}', 'committed', 'clients_matters', now() - interval '1 minute', now(), '[]', now() + interval '30 days', true);
insert into public.sample_proof_steps (organization_id, step, sample_matter_id, completed_at, completed_by) values
  ('00000000-0000-4000-8000-0000000000f2', 'intake', '00000000-0000-4000-8000-0000000000c2', now(), '00000000-0000-4000-8000-0000000000a1');

-- ---------------------------------------------------------------- access
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.expect_error($$select public.platform_usage()$$, 'permission denied');
select pg_temp.expect_error($$select public.platform_privacy_requests()$$, 'permission denied');
select pg_temp.expect_error($$select public.platform_sample_overview()$$, 'permission denied');
select pg_temp.expect_error($$select public.platform_migration_jobs()$$, 'permission denied');
select pg_temp.expect_error($$select public.platform_template_releases()$$, 'permission denied');

select pg_temp.as_service();
-- ---------------------------------------------------------------- usage
create temp table u as select public.platform_usage('test') as j;
select pg_temp.assert((select (j ->> 'total')::int from u) = 2, 'usage lists both firms');
select pg_temp.assert((select x ->> 'seat_limit' from u, jsonb_array_elements(j -> 'items') x where x ->> 'slug' = 'solo-firm-test') = '2', 'solo seat limit');
select pg_temp.assert((select x -> 'flags' from u, jsonb_array_elements(j -> 'items') x where x ->> 'slug' = 'solo-firm-test') ? 'seats_over', 'three seats on solo is over');
select pg_temp.assert((select (x ->> 'ai_runs_30d')::int from u, jsonb_array_elements(j -> 'items') x where x ->> 'slug' = 'solo-firm-test') = 2, 'AI window is 30 days');
select pg_temp.assert((select (x ->> 'ai_failed_30d')::int from u, jsonb_array_elements(j -> 'items') x where x ->> 'slug' = 'solo-firm-test') = 1, 'AI failures');
select pg_temp.assert((select x ->> 'seat_limit' from u, jsonb_array_elements(j -> 'items') x where x ->> 'slug' = 'trial-firm-test') is null, 'trial has no allowance');
select pg_temp.assert((public.platform_usage('test', true) ->> 'total')::int = 1, 'flagged only');
select pg_temp.assert((public.platform_usage('test', false, 'seats_desc') -> 'items' -> 0 ->> 'slug') = 'solo-firm-test', 'seats sort');
select pg_temp.expect_error($$select public.platform_usage(null, false, 'bogus')$$, 'sort is');
select pg_temp.assert(position('Secret' in public.platform_usage()::text) = 0, 'usage carries no client content');

-- ---------------------------------------------------------------- privacy
select pg_temp.assert((public.platform_privacy_requests('open') ->> 'total')::int = 2, 'two open');
select pg_temp.assert((public.platform_privacy_requests('overdue') ->> 'total')::int = 1, 'one overdue');
select pg_temp.assert((public.platform_privacy_requests('due_soon') ->> 'total')::int = 1, 'one due soon');
select pg_temp.assert((public.platform_privacy_requests('closed') ->> 'total')::int = 1, 'one closed');
select pg_temp.assert((public.platform_privacy_requests('all') -> 'summary' ->> 'closed_30d')::int = 1, 'closed in 30 days');
select pg_temp.assert(position('Secret' in public.platform_privacy_requests('all')::text) = 0, 'no requester names or details');
select pg_temp.assert(position('Other Name' in public.platform_privacy_requests('all')::text) = 0, 'no requester names');
select pg_temp.expect_error($$select public.platform_privacy_requests('bogus')$$, 'state is');

-- ---------------------------------------------------------------- sample mode
create temp table s as select public.platform_sample_overview() as j;
select pg_temp.assert((select (j ->> 'total')::int from s) >= 1, 'sample firm listed');
select pg_temp.assert((select x -> 'proof_steps_done' from s, jsonb_array_elements(j -> 'items') x where x ->> 'slug' = 'trial-firm-test') = '["intake"]', 'proof steps');
select pg_temp.assert((select (x ->> 'proof_complete')::boolean from s, jsonb_array_elements(j -> 'items') x where x ->> 'slug' = 'trial-firm-test') is false, 'proof incomplete');
select pg_temp.assert(not exists (select 1 from s, jsonb_array_elements(j -> 'items') x where x ->> 'slug' = 'solo-firm-test'), 'real-only firm not listed');

-- ---------------------------------------------------------------- migration
select pg_temp.assert((public.platform_migration_jobs('stuck') ->> 'total')::int = 1, 'stuck job');
select pg_temp.assert((public.platform_migration_jobs() -> 'summary' ->> 'purge_due')::int = 1, 'purge due');
select pg_temp.assert((public.platform_migration_jobs() -> 'items' -> 0 ->> 'exception_count')::int = 1, 'exception count');
select pg_temp.assert(position('Smith' in public.platform_migration_jobs()::text) = 0, 'no file names');
select pg_temp.assert((public.platform_migration_jobs('committed', '00000000-0000-4000-8000-0000000000f2') ->> 'total')::int = 1, 'filter by firm and status');
select pg_temp.expect_error($$select public.platform_migration_jobs('bogus')$$, 'status is');

-- ---------------------------------------------------------------- releases
select pg_temp.assert((public.platform_template_releases() ->> 'total') is not null, 'releases');

select 'adm_platform_admin_pages tests PASSED';
rollback;
