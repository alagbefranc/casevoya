-- REP-02 / REP-03 (gap PR #185): report exports record the segment they were narrowed to.
--
-- public.record_report_export(uuid, text, text, text, text) is a new overload of the T041 audit
-- function (20261019205100_matter_records_exports_closure.sql, its only definition, copied here).
-- It adds p_segment: the program a Processing and outcomes export is narrowed to (a program key,
-- or 'none' for matters without a program), or null for every program. Same checks as before:
-- signed in, the caller's current firm, active membership, MFA satisfied, and a role that can see
-- the tab. The audit row's metadata gains 'segment'; no report figures go into the audit log.
-- The four-argument function is unchanged and still callable.
-- Additive only.

create function public.record_report_export(p_organization_id uuid, p_tab text, p_range text, p_format text, p_segment text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  roles public.org_role[];
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if p_tab not in ('ops', 'money', 'outcomes') or p_range not in ('90d', 'month', 'year') or p_format not in ('csv', 'pdf') then
    raise exception 'choose a report, period and format' using errcode = '22023';
  end if;
  if p_segment is not null and (p_tab <> 'outcomes' or p_segment !~ '^[a-z0-9_]{1,60}$') then
    raise exception 'choose a program from the report' using errcode = '22023';
  end if;
  roles := case when p_tab = 'money'
    then array['firm_owner', 'finance_user']::public.org_role[]
    else array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
  end;
  if p_organization_id is null
     or p_organization_id is distinct from (select app.current_organization_id())
     or app.in_active_org(p_organization_id) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.has_org_role(p_organization_id, roles) is distinct from true then
    raise exception 'report export denied' using errcode = '42501';
  end if;
  return app.record_audit_event(
    p_organization_id,
    'report.exported',
    null,
    null,
    'success',
    jsonb_build_object('tab', p_tab, 'range', p_range, 'format', p_format, 'segment', p_segment)
  );
end;
$$;
revoke all on function public.record_report_export(uuid, text, text, text, text) from public, anon;
grant execute on function public.record_report_export(uuid, text, text, text, text) to authenticated;
