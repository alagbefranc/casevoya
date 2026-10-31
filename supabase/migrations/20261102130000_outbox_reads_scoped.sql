-- Outbox reads by signed-in staff: active workspace, staff assurance, and either the firm owner
-- (full job history) or an event about a matter message the caller can already read (the
-- Messages tab's email notice state). Workers and platform tools use definer functions or the
-- service role and are unaffected. Additive: a restrictive policy on top of
-- outbox_events_select_staff and outbox_events_select_requires_aal2.

do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'outbox_events' and policyname = 'outbox_events_select_scope'
  ) then
    execute $policy$
      create policy outbox_events_select_scope on public.outbox_events
        as restrictive for select to authenticated
        using (
          (select app.in_active_org(organization_id))
          and (select app.staff_mfa_satisfied())
          and (
            (select app.has_org_role(organization_id, array['firm_owner']::public.org_role[]))
            or (
              aggregate_type = 'message'
              and exists (
                select 1 from public.matter_messages message
                where message.id = outbox_events.aggregate_id
                  and message.organization_id = outbox_events.organization_id
              )
            )
          )
        )
    $policy$;
  end if;
end
$policies$;
