-- Sheet: Intake form builder, "Delete form" (PRD INT-01, INT-03).
--
-- A firm can withdraw an intake form it no longer wants. Nothing that was already sent changes:
-- the versions stay (matters that use one keep it, with its answers and history), they just
-- can't be sent again. Withdrawing:
--   * supersedes the form's published version, so public.send_intake_request (which sends only
--     a published version) refuses it from now on and the matter's form picker no longer lists
--     it. published -> superseded is the transition app.guard_intake_template already allows,
--     with nothing else changed;
--   * removes the form's open draft, if any. A draft was never sent (only published versions
--     are), so no request or response refers to it. The intake_templates audit trigger records
--     the removal.
-- A withdrawn form has no published and no draft version left. Building it again starts the
-- next version number from an empty form.
--
-- New:
--   * public.withdraw_intake_form(p_stable_key): a licensed consultant or licensed owner with a
--     recent step-up, like publishing. Audited intake_template.withdrawn.
-- No table, type, policy or RLS setting changes; no existing function redefined.

create function app.withdraw_intake_form(p_stable_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := app.current_organization_id();
  published_number integer;
  drafts_removed integer;
begin
  if org is null then
    raise exception 'intake template denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(org, true);
  if p_stable_key is null or p_stable_key !~ '^[a-z][a-z0-9_]{1,80}$' then
    raise exception 'intake template key is not usable' using errcode = '22023';
  end if;
  perform 1
  from public.intake_templates t
  where t.organization_id = org and t.stable_key = p_stable_key
  for update;
  if not found then
    raise exception 'intake template denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.intake_templates t
    where t.organization_id = org and t.stable_key = p_stable_key and t.status in ('draft', 'published')
  ) then
    raise exception 'this intake form is already deleted' using errcode = '22023';
  end if;

  delete from public.intake_templates t
  where t.organization_id = org and t.stable_key = p_stable_key and t.status = 'draft';
  get diagnostics drafts_removed = row_count;

  update public.intake_templates t
     set status = 'superseded'
   where t.organization_id = org and t.stable_key = p_stable_key and t.status = 'published'
  returning t.version_number into published_number;

  perform app.record_audit_event(
    org,
    'intake_template.withdrawn',
    'public.intake_templates',
    null,
    'success',
    jsonb_build_object('stable_key', p_stable_key, 'published_version_number', published_number, 'drafts_removed', drafts_removed)
  );
  return jsonb_build_object('withdrawn_version_number', published_number, 'drafts_removed', drafts_removed);
end;
$$;
revoke all on function app.withdraw_intake_form(text) from public;

create function public.withdraw_intake_form(p_stable_key text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app.withdraw_intake_form(p_stable_key);
$$;
comment on function public.withdraw_intake_form(text) is
  'Withdraws an intake form: its published version can no longer be sent and its draft is removed. Sent versions are kept. Licensed staff with a recent step-up.';
revoke all on function public.withdraw_intake_form(text) from public, anon;
grant execute on function app.withdraw_intake_form(text) to authenticated, service_role;
grant execute on function public.withdraw_intake_form(text) to authenticated, service_role;
