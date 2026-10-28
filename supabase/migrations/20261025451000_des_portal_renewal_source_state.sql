-- DES-04 (stale-source state, client portal): the client's renewal reminders show IRCC's timing as
-- official content (DEC-02). The client could not tell when that timing stopped being current: a
-- licensed member retired it after the reminder was set, its official page is due for review or
-- suspended, a change was detected on the page, or the last check of the page failed. None of this
-- was in what public.portal_renewal_reminders returns, and clients can't read renewal_timings or
-- official_sources themselves, so the portal can't tell these states apart without this change.
--
-- Redefined (copied from its latest definition, 20261025230000_dec_review_rules.sql; only the
-- 'timing' object gains fields):
--   app.portal_renewal_reminders(uuid): the timing also carries
--     'status'             renewal_timings.status (approved, retired, …)
--     'source_review'      official_sources.review_status (review_due, suspended, …)
--     'source_next_review' official_sources.next_review_at (the steward's deadline, never defaulted)
--     'source_change'      official_sources.change_state (change_detected after a check saw a change)
--     'source_attempt'     official_sources.last_attempt_result (failed, blocked, partial, …)
--     'source_attempt_at'  official_sources.last_attempt_at
-- Freshness on official_sources is written only by the snapshot and check triggers (SRC). Nothing
-- here changes what the client may read, or which reminders are returned. Additive: no tables, no
-- data, same signature and privileges (create or replace keeps the grants).

-- app.portal_renewal_reminders, copied from 20261025230000_dec_review_rules.sql.
create or replace function app.portal_renewal_reminders(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person uuid;
begin
  if (select auth.uid()) is null or p_org is null or p_org is distinct from app.current_organization_id() then
    return '[]'::jsonb;
  end if;
  select person.id into v_person
  from public.persons person
  where person.organization_id = p_org and person.user_id = (select auth.uid())
  limit 1;
  if v_person is null or not exists (
    select 1 from public.person_contact_preferences pref where pref.person_id = v_person and pref.deadline_reminders
  ) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', renewal.id,
      'matter_id', renewal.matter_id,
      'document_label', renewal.document_label,
      'expires_on', renewal.expires_on,
      'remind_on', renewal.remind_on,
      'service_scope', renewal.service_scope,
      'timing', case when timing.id is null then null else jsonb_build_object(
        'text', timing.timing_text, 'source_url', timing.source_url, 'checked_on', timing.checked_on,
        'current_to', timing.current_to, 'snapshot_sha256', timing.snapshot_sha256,
        'page_attested_on', timing.page_attested_on,
        'page_attested_by', case when timing.page_attested_on is null then null else coalesce(
          (select nullif(btrim(profile.display_name), '')
           from public.memberships mem join public.profiles profile on profile.id = mem.user_id
           where mem.id = timing.page_attested_by_membership_id),
          'your consultant') end,
        -- DES-04: whether the timing and its official page are still current.
        'status', timing.status,
        'source_review', source.review_status,
        'source_next_review', source.next_review_at,
        'source_change', source.change_state,
        'source_attempt', source.last_attempt_result,
        'source_attempt_at', source.last_attempt_at) end,
      'fee', app.renewal_current_fee(renewal.organization_id, renewal.fee_section, renewal.fee_group, renewal.fee_name)
    ) order by renewal.expires_on)
    from public.decision_renewals renewal
    left join public.renewal_timings timing on timing.id = renewal.timing_id
    left join public.official_sources source on source.id = timing.source_id
    where renewal.organization_id = p_org
      and renewal.client_person_id = v_person
      and renewal.reminder_set_at is not null
      and renewal.cancelled_at is null
  ), '[]'::jsonb);
end;
$$;
