-- Tests for 20261029210000_adm_platform_admin_backend.sql.
-- Run against a throwaway local Supabase Postgres with every migration applied:
--   psql -v ON_ERROR_STOP=1 -1 -f supabase/tests/adm_platform_admin_backend.test.sql
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

-- Seed users (A owner, B operator, C viewer, D invitee, E nobody).
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@test.local', now(), now(), now()),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@test.local', now(), now(), now()),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c@test.local', now(), now(), now()),
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'd@test.local', now(), now(), now()),
  ('00000000-0000-4000-8000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'e@test.local', now(), now(), now());
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-4000-8000-00000000000a', 'totp', 'totp', 'verified', now(), now());

-- ---------------------------------------------------------------- bootstrap
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.expect_error($$select public.bootstrap_first_platform_admin('00000000-0000-4000-8000-00000000000a')$$, 'permission denied');
select pg_temp.as_service();
select pg_temp.expect_error($$select public.bootstrap_first_platform_admin('00000000-0000-4000-8000-00000000000b')$$, 'no verified MFA factor');
select pg_temp.expect_error($$select public.bootstrap_first_platform_admin(gen_random_uuid())$$, 'no such user');
select pg_temp.assert(public.bootstrap_first_platform_admin('00000000-0000-4000-8000-00000000000a', 'Francis') = '00000000-0000-4000-8000-00000000000a', 'bootstrap returns the user');
select pg_temp.expect_error($$select public.bootstrap_first_platform_admin('00000000-0000-4000-8000-00000000000a')$$, 'already exists');
select pg_temp.as_owner();
select pg_temp.assert((select role from public.platform_admins where user_id = '00000000-0000-4000-8000-00000000000a') = 'owner', 'bootstrapped admin is owner');
select pg_temp.assert(exists (select 1 from public.audit_log where action = 'platform_admin.bootstrapped'), 'bootstrap audited');

-- ---------------------------------------------------------------- invites
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a', false);
select pg_temp.expect_error($$select public.platform_admin_invite('d@test.local', 'operator')$$, 'step-up is required');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a', true, 'aal1');
select pg_temp.expect_error($$select public.platform_admin_invite('d@test.local', 'operator')$$, 'platform admin access denied');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.expect_error($$select public.platform_admin_invite('not-an-email', 'operator')$$, 'email is invalid');
select pg_temp.expect_error($$select public.platform_admin_invite('d@test.local', 'superuser')$$, 'role is owner');
select pg_temp.expect_error($$select public.platform_admin_invite('a@test.local', 'operator')$$, 'already a platform admin');
select public.platform_admin_invite(' D@Test.Local ', 'operator', false, 'ops');
select public.platform_admin_invite('b@test.local', 'operator');
select public.platform_admin_invite('c@test.local', 'viewer');
select pg_temp.expect_error($$select public.platform_admin_invite('d@test.local', 'viewer')$$, 'already open');
select pg_temp.as_service();
select pg_temp.expect_error($$select public.platform_admin_invite('x@test.local', 'viewer')$$, 'permission denied');
select pg_temp.assert((public.platform_admin_invite_for_email('d@test.local') ->> 'role') = 'operator', 'invite lookup by email');
select pg_temp.as_owner();
select pg_temp.expect_error($$update public.platform_admin_invites set role = 'owner'$$, 'only through the invite functions');

-- accept
select pg_temp.as_user('00000000-0000-4000-8000-00000000000e');
select pg_temp.expect_error($$select public.accept_platform_admin_invite()$$, 'no open invite');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000d', true, 'aal1');
select pg_temp.expect_error($$select public.accept_platform_admin_invite()$$, 'sign in with MFA');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000d');
select pg_temp.assert((public.accept_platform_admin_invite() ->> 'role') = 'operator', 'D accepted as operator');
select pg_temp.expect_error($$select public.accept_platform_admin_invite()$$, 'already a platform admin');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select public.accept_platform_admin_invite();
select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
select public.accept_platform_admin_invite();

-- operator cannot manage admins
select pg_temp.as_user('00000000-0000-4000-8000-00000000000d');
select pg_temp.expect_error($$select public.platform_admin_invite('x@test.local', 'viewer')$$, 'does not allow');
select pg_temp.expect_error($$select public.platform_admin_set_role('00000000-0000-4000-8000-00000000000c', 'owner')$$, 'does not allow');

-- cancel invite
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select public.platform_admin_invite('x@test.local', 'viewer');
select public.platform_admin_cancel_invite((select id from public.platform_admin_invites where email = 'x@test.local'), 'typo');
select pg_temp.expect_error($$select public.platform_admin_cancel_invite((select id from public.platform_admin_invites where email = 'x@test.local'), 'again')$$, 'already closed');

-- ---------------------------------------------------------------- role / reviewer / remove
select pg_temp.expect_error($$select public.platform_admin_set_role('00000000-0000-4000-8000-00000000000a', 'operator')$$, 'keep at least one owner');
select pg_temp.expect_error($$select public.platform_admin_remove('00000000-0000-4000-8000-00000000000a', 'leaving')$$, 'keep at least one owner');
select pg_temp.expect_error($$select public.platform_admin_remove('00000000-0000-4000-8000-00000000000d', 'x')$$, 'give a reason');
select pg_temp.expect_error($$select public.platform_admin_set_role(gen_random_uuid(), 'viewer')$$, 'not a platform admin');
select public.platform_admin_set_role('00000000-0000-4000-8000-00000000000b', 'owner');
select public.platform_admin_set_reviewer('00000000-0000-4000-8000-00000000000d', true);
select pg_temp.as_owner();
select pg_temp.assert((select template_reviewer from public.platform_admins where user_id = '00000000-0000-4000-8000-00000000000d'), 'reviewer flag set');
select pg_temp.expect_error($$delete from public.platform_admins where user_id = '00000000-0000-4000-8000-00000000000d'$$, 'removed only through');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select public.platform_admin_remove('00000000-0000-4000-8000-00000000000d', 'no longer on the team');
select pg_temp.as_owner();
select pg_temp.assert(not exists (select 1 from public.platform_admins where user_id = '00000000-0000-4000-8000-00000000000d'), 'D removed');
select pg_temp.assert(exists (select 1 from public.platform_admin_removals where user_id = '00000000-0000-4000-8000-00000000000d' and role = 'operator'), 'D archived');
select pg_temp.expect_error($$delete from public.platform_admin_removals$$, '');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000d');
select pg_temp.assert(app.is_platform_admin() is false, 'removed admin is no longer an admin');
-- With two owners, an owner may now step down.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select public.platform_admin_set_role('00000000-0000-4000-8000-00000000000b', 'operator');

select pg_temp.as_service();
select pg_temp.assert(jsonb_array_length(public.platform_admin_list() -> 'admins') = 3, 'three admins listed');
select pg_temp.assert(jsonb_array_length(public.platform_admin_list() -> 'removals') = 1, 'one removal listed');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.expect_error($$select public.platform_admin_list()$$, 'permission denied');

-- ---------------------------------------------------------------- portal audit
select pg_temp.as_service();
select public.platform_admin_record_audit('00000000-0000-4000-8000-00000000000a', 'admin_portal.notices.create', 'public.service_notices', null, null, 'success', '{"request_id":"req-1"}');
select pg_temp.expect_error($$select public.platform_admin_record_audit('00000000-0000-4000-8000-00000000000a', 'notices.create')$$, 'start with admin_portal');
select pg_temp.expect_error($$select public.platform_admin_record_audit('00000000-0000-4000-8000-00000000000a', 'admin_portal.x', null, null, null, 'maybe')$$, 'result is');
select pg_temp.as_owner();
select pg_temp.assert((select actor_user_id from public.audit_log where action = 'admin_portal.notices.create') = '00000000-0000-4000-8000-00000000000a', 'audit actor recorded');
select pg_temp.assert((select request_id from public.audit_log where action = 'admin_portal.notices.create') = 'req-1', 'request id recorded');

-- ---------------------------------------------------------------- reads
insert into public.organizations (legal_name, display_name, slug)
values ('Northshore Immigration Ltd', 'Northshore', 'northshore-test');
select pg_temp.as_service();
select pg_temp.assert((public.platform_overview() -> 'firms' ->> 'total')::int >= 1, 'overview firms');
select pg_temp.assert((public.platform_overview() -> 'incidents' ->> 'status') in ('operational', 'incident', 'maintenance', 'major_incident'), 'overview incident status');
select pg_temp.assert((public.platform_firm_list('northshore') ->> 'total')::int = 1, 'firm search');
select pg_temp.assert((public.platform_firm_list(null, null, null, null, null, 'name_asc', 10, 0) -> 'items') is not null, 'firm sort');
select pg_temp.expect_error($$select public.platform_firm_list(null, null, null, null, null, 'bogus')$$, 'sort is');
select pg_temp.assert((public.platform_firm_detail((select id from public.organizations where slug = 'northshore-test')) -> 'firm' ->> 'slug') = 'northshore-test', 'firm detail');
select pg_temp.assert(public.platform_firm_detail(gen_random_uuid()) is null, 'missing firm is null');
select pg_temp.assert(public.platform_subscription_exceptions() ? 'by_reason', 'subscription exceptions');
select pg_temp.expect_error($$select public.platform_subscription_exceptions('nope')$$, 'unknown exception reason');
select pg_temp.assert(public.platform_licence_queue('all') ? 'counts', 'licence queue');
select pg_temp.expect_error($$select public.platform_licence_queue('bogus')$$, 'kind is');
select pg_temp.assert(public.platform_credential_detail(gen_random_uuid()) is null, 'missing credential');
select pg_temp.assert((public.platform_outbox_health() ->> 'level') in ('healthy', 'degraded', 'unhealthy'), 'outbox health');
select pg_temp.assert(public.platform_dead_letters() ? 'items', 'dead letters');
select pg_temp.assert(public.platform_support_requests() ? 'counts', 'support requests');
select pg_temp.expect_error($$select public.platform_support_requests('weird')$$, 'state is');
select pg_temp.assert(public.platform_support_request_history(gen_random_uuid()) ? 'events', 'support history');
select pg_temp.assert(public.platform_complaints_overview() ? 'totals', 'complaints');
select pg_temp.assert((public.platform_support_sla(30, 60) ->> 'target_minutes')::int = 60, 'sla');
select pg_temp.assert(public.platform_cicc_imports() ? 'imports', 'cicc imports');
select pg_temp.assert(jsonb_array_length(public.platform_audit_log('platform_admin.', null, null, null, null, null, null, null, 2) -> 'items') = 2, 'audit log page');
select pg_temp.assert((public.platform_audit_log('platform_admin.', null, null, null, null, null, null, null, 2) -> 'next_cursor') is not null, 'audit cursor');
select pg_temp.expect_error($$select public.platform_audit_log(null, null, null, null, null, null, now(), null)$$, 'cursor needs both');
select pg_temp.assert(public.platform_template_queue() ? 'templates', 'template queue');
-- Firm-scope audit rows are not shown.
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(public.platform_audit_log(null, null, null, null, null, null, null, null, 200) -> 'items') i
                                  where i ->> 'action' like 'organizations.%'), 'firm row audits hidden');
-- Not callable by an ordinary signed-in user.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000e');
select pg_temp.expect_error($$select public.platform_overview()$$, 'permission denied');
select pg_temp.expect_error($$select public.platform_firm_list()$$, 'permission denied');
select pg_temp.expect_error($$select public.platform_outbox_event(gen_random_uuid())$$, 'permission denied');

-- ---------------------------------------------------------------- outbox replay
select pg_temp.as_owner();
insert into public.outbox_events (id, organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, status, attempts, last_error)
values ('00000000-0000-4000-8000-0000000000f1', (select id from public.organizations where slug = 'northshore-test'),
        'test', gen_random_uuid(), 'test.event', '{"secret":"client text","n":1}', 'test-dead-1', 'dead_lettered', 8, 'boom');
select pg_temp.as_service();
select pg_temp.assert((public.platform_outbox_event('00000000-0000-4000-8000-0000000000f1') -> 'payload_keys') = '["n","secret"]'::jsonb, 'payload keys only');
select pg_temp.assert(position('client text' in public.platform_outbox_event('00000000-0000-4000-8000-0000000000f1')::text) = 0, 'payload values never returned');
select pg_temp.assert((public.platform_outbox_health() ->> 'level') = 'unhealthy', 'dead letter makes queues unhealthy');
select pg_temp.expect_error($$select public.platform_replay_outbox_event('00000000-0000-4000-8000-0000000000f1', 'retry after fix')$$, 'permission denied');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
select pg_temp.expect_error($$select public.platform_replay_outbox_event('00000000-0000-4000-8000-0000000000f1', 'retry after fix')$$, 'does not allow');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b', false);
select pg_temp.expect_error($$select public.platform_replay_outbox_event('00000000-0000-4000-8000-0000000000f1', 'retry after fix')$$, 'step-up');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select pg_temp.expect_error($$select public.platform_replay_outbox_event('00000000-0000-4000-8000-0000000000f1', 'short')$$, 'reason of 8');
select pg_temp.assert((public.platform_replay_outbox_event('00000000-0000-4000-8000-0000000000f1', 'retry after provider fix') ->> 'status') = 'pending', 'replayed');
select pg_temp.expect_error($$select public.platform_replay_outbox_event('00000000-0000-4000-8000-0000000000f1', 'retry after fix')$$, 'only a dead-lettered');
select pg_temp.as_owner();
select pg_temp.assert((select status::text from public.outbox_events where id = '00000000-0000-4000-8000-0000000000f1') = 'pending', 'event pending again');
select pg_temp.assert(exists (select 1 from public.audit_log where action = 'outbox.replay' and object_id = '00000000-0000-4000-8000-0000000000f1'
                              and actor_user_id = '00000000-0000-4000-8000-00000000000b'), 'replay audited with actor');

-- ---------------------------------------------------------------- template sources
select pg_temp.as_service();
select public.draft_shared_template_version('study_permit_checklist', 'Study permit checklist', 'Summary text',
  '["Letter of acceptance from a DLI", "Proof of funds"]'::jsonb, 'Francis',
  '00000000-0000-4000-8000-00000000000a', 'Tested with three sample matters', date '2026-11-01', 'First version');
select pg_temp.expect_error($$select public.set_shared_template_version_sources(
  (select id from public.shared_template_versions where status = 'draft' limit 1), '[]'::jsonb, '00000000-0000-4000-8000-00000000000a')$$, '1 to 20 sources');
select pg_temp.expect_error($$select public.set_shared_template_version_sources(
  (select id from public.shared_template_versions where status = 'draft' limit 1),
  '[{"url":"http://example.com/a","title":"x","retrieved_on":"2026-10-29"}]'::jsonb, '00000000-0000-4000-8000-00000000000a')$$, 'https link');
select pg_temp.expect_error($$select public.set_shared_template_version_sources(
  (select id from public.shared_template_versions where status = 'draft' limit 1),
  '[{"url":"https://example.com/a","title":"x","retrieved_on":"2026-10-29"}]'::jsonb, '00000000-0000-4000-8000-00000000000e')$$, 'name the platform admin');
select pg_temp.assert(public.set_shared_template_version_sources(
  (select id from public.shared_template_versions where status = 'draft' limit 1),
  '[{"url":"https://example.com/blog/post","title":"Blog","retrieved_on":"2026-10-29"}]'::jsonb, '00000000-0000-4000-8000-00000000000a') = 1, 'one source set');
select pg_temp.as_owner();
select pg_temp.assert(not (select official from public.shared_template_version_sources limit 1), 'example.com is not official');
-- Publishing without an official source is refused by the trigger.
select set_config('app.shared_template_write', 'on', true);
select pg_temp.expect_error($$update public.shared_template_versions set status = 'published', published_at = now(), reviewed_at = now() where status = 'draft'$$, 'official source');
select set_config('app.shared_template_write', '', true);
select pg_temp.as_service();
select pg_temp.assert(public.set_shared_template_version_sources(
  (select id from public.shared_template_versions where status = 'draft' limit 1),
  '[{"url":"https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html","title":"Study permit","retrieved_on":"2026-10-29"},
    {"url":"https://example.com/blog/post","title":"Blog","retrieved_on":"2026-10-28","note":"context"}]'::jsonb, '00000000-0000-4000-8000-00000000000a') = 2, 'sources replaced');
select pg_temp.as_owner();
select pg_temp.assert((select count(*) from public.shared_template_version_sources where official) = 1, 'canada.ca is official');
select pg_temp.expect_error($$update public.shared_template_version_sources set title = 'x'$$, '');
-- Approve refuses a platform admin without the reviewer flag.
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select pg_temp.expect_error($$select public.approve_shared_template_version((select id from public.shared_template_versions where status = 'draft' limit 1), repeat('0', 64))$$, 'not a template reviewer');
select pg_temp.as_service();
select pg_temp.assert((public.platform_template_version((select id from public.shared_template_versions where status = 'draft' limit 1)) -> 'sources' -> 0 ->> 'official')::boolean, 'template version shows sources');
select pg_temp.assert((public.platform_template_queue() -> 'templates' -> 0 -> 'draft' ->> 'official_sources')::int = 1, 'queue counts official sources');

select pg_temp.as_owner();
select 'ALL ADM BACKEND TESTS PASSED' as result;
rollback;
