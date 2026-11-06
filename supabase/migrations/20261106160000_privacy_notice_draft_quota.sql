-- A privacy-notice draft uses the same Workers AI budget as "Draft in French".
-- The row records who asked and how long the fact sheet was. It never stores the notice.
--
-- Rollback: drop function public.consume_policy_draft(uuid, integer);

create function public.consume_policy_draft(p_organization_id uuid, p_char_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  last_hour integer;
  last_day integer;
begin
  perform app.require_active_staff(
    p_organization_id,
    array['firm_owner', 'licensed_consultant']::public.org_role[],
    false
  );
  if p_char_count is null or p_char_count not between 1 and 4000 then
    raise exception 'text must be 1 to 4000 characters' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('translation_draft:' || actor::text || ':' || p_organization_id::text, 0));
  select count(*) filter (where created_at > statement_timestamp() - interval '1 hour'),
         count(*)
  into last_hour, last_day
  from public.translation_draft_requests
  where user_id = actor
    and organization_id = p_organization_id
    and created_at > statement_timestamp() - interval '1 day';
  if last_hour >= 20 or last_day >= 100 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  insert into public.translation_draft_requests (organization_id, user_id, char_count)
  values (p_organization_id, actor, p_char_count);
  perform app.record_audit_event(
    p_organization_id, 'policy.draft_requested', 'translation_draft_requests', null, 'success',
    jsonb_build_object('chars', p_char_count)
  );
  return jsonb_build_object('ok', true, 'remaining_hour', 19 - last_hour, 'remaining_day', 99 - last_day);
end;
$$;
comment on function public.consume_policy_draft(uuid, integer) is
  'One privacy-notice draft for this firm. Shares the Draft in French hourly and daily limits. Does not store the notice.';
revoke all on function public.consume_policy_draft(uuid, integer) from public, anon;
grant execute on function public.consume_policy_draft(uuid, integer) to authenticated, service_role;
