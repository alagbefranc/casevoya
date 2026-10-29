-- ADM admin pages (Usage, Privacy, Sample mode, Migration, Releases, Config).
-- Metadata-only read functions for the platform admin portal. Additive: new functions only, no table
-- changes. Every function calls app.platform_read_allowed() (service role or a platform admin) and is
-- granted to service_role only. None returns client names, request details, notes, file names or
-- document contents: counts, statuses, timestamps and ids only.

-- Usage: per-firm seats, active matters, storage and Vo (AI) usage against plan allowances.
-- Allowances come from product_settings 'subscription.plans' (app.subscription_plan_catalog()). A firm
-- without a chosen plan (trial, none) or on enterprise has no allowance (limit null). Seat limit =
-- plan seats + extra_seats. Flags: '<metric>_over' when used > limit; '<metric>_near' when used >= 90%
-- of the limit and not over.
create or replace function public.platform_usage(
  p_search text default null, p_flagged_only boolean default false, p_sort text default 'name_asc',
  p_limit integer default 50, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  catalog jsonb;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_sort text := coalesce(p_sort, 'name_asc');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  result jsonb;
begin
  perform app.platform_read_allowed();
  if v_search is not null and length(v_search) > 100 then
    raise exception 'search is at most 100 characters' using errcode = '22023';
  end if;
  if v_sort not in ('name_asc', 'seats_desc', 'matters_desc', 'storage_desc', 'ai_cost_desc') then
    raise exception 'sort is name_asc, seats_desc, matters_desc, storage_desc or ai_cost_desc' using errcode = '22023';
  end if;
  catalog := coalesce(app.subscription_plan_catalog(), '{}'::jsonb);

  with firms as (
    select org.id, org.display_name, org.slug, org.sample_mode, org.created_at,
           sub.plan::text as plan, sub.status::text as subscription_status, coalesce(sub.extra_seats, 0) as extra_seats
      from public.organizations org
      left join public.organization_subscriptions sub on sub.organization_id = org.id
     where v_search is null
        or org.display_name ilike '%' || v_search || '%'
        or org.slug ilike '%' || v_search || '%'
  ),
  seats as (
    select m.organization_id,
           count(*) filter (where m.status = 'active') as active,
           count(*) filter (where m.status = 'invited') as invited
      from public.memberships m
     where m.role = any (app.staff_roles()) and m.organization_id in (select id from firms)
     group by m.organization_id
  ),
  matters as (
    select mt.organization_id,
           count(*) filter (where mt.stage <> 'closed') as active,
           count(*) filter (where mt.stage <> 'closed' and mt.is_sample) as sample
      from public.matters mt
     where mt.organization_id in (select id from firms)
     group by mt.organization_id
  ),
  storage as (
    select dv.organization_id, coalesce(sum(dv.byte_size), 0)::bigint as bytes
      from public.document_versions dv
     where dv.byte_size is not null and dv.organization_id in (select id from firms)
     group by dv.organization_id
  ),
  ai as (
    select r.organization_id,
           count(*) as runs,
           count(*) filter (where r.result = 'failed') as failed,
           coalesce(sum(coalesce(r.input_tokens, 0) + coalesce(r.output_tokens, 0)), 0)::bigint as tokens,
           coalesce(sum(r.cost_usd), 0)::numeric(12, 4) as cost_usd
      from public.vo_runs r
     where r.created_at >= statement_timestamp() - interval '30 days' and r.organization_id in (select id from firms)
     group by r.organization_id
  ),
  rows as (
    select f.*,
           coalesce(s.active, 0) as seats_active, coalesce(s.invited, 0) as seats_invited,
           case when f.plan in ('solo', 'practice', 'firm') and f.subscription_status not in ('trial', 'trial_ended')
                then (catalog -> f.plan ->> 'seats')::integer + f.extra_seats end as seat_limit,
           coalesce(mt.active, 0) as active_matters, coalesce(mt.sample, 0) as sample_matters,
           case when f.plan in ('solo', 'practice', 'firm') and f.subscription_status not in ('trial', 'trial_ended')
                then (catalog -> f.plan ->> 'matters')::integer end as matter_limit,
           coalesce(st.bytes, 0) as storage_bytes,
           case when f.plan in ('solo', 'practice', 'firm') and f.subscription_status not in ('trial', 'trial_ended')
                then ((catalog -> f.plan ->> 'storage_gb')::numeric * 1073741824)::bigint end as storage_limit_bytes,
           coalesce(ai.runs, 0) as ai_runs_30d, coalesce(ai.failed, 0) as ai_failed_30d,
           coalesce(ai.tokens, 0) as ai_tokens_30d, coalesce(ai.cost_usd, 0) as ai_cost_usd_30d
      from firms f
      left join seats s on s.organization_id = f.id
      left join matters mt on mt.organization_id = f.id
      left join storage st on st.organization_id = f.id
      left join ai on ai.organization_id = f.id
  ),
  flagged as (
    select r.*,
           array_remove(array[
             case when r.seat_limit is not null and r.seats_active > r.seat_limit then 'seats_over'
                  when r.seat_limit is not null and r.seat_limit > 0 and r.seats_active >= 0.9 * r.seat_limit then 'seats_near' end,
             case when r.matter_limit is not null and r.active_matters > r.matter_limit then 'matters_over'
                  when r.matter_limit is not null and r.matter_limit > 0 and r.active_matters >= 0.9 * r.matter_limit then 'matters_near' end,
             case when r.storage_limit_bytes is not null and r.storage_bytes > r.storage_limit_bytes then 'storage_over'
                  when r.storage_limit_bytes is not null and r.storage_limit_bytes > 0 and r.storage_bytes >= 0.9 * r.storage_limit_bytes then 'storage_near' end
           ], null) as flags
      from rows r
  ),
  filtered as (
    select * from flagged where not coalesce(p_flagged_only, false) or cardinality(flags) > 0
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'organization_id', x.id, 'display_name', x.display_name, 'slug', x.slug, 'sample_mode', x.sample_mode,
        'plan', x.plan, 'subscription_status', coalesce(x.subscription_status, 'none'),
        'seats_active', x.seats_active, 'seats_invited', x.seats_invited, 'seat_limit', x.seat_limit,
        'active_matters', x.active_matters, 'sample_matters', x.sample_matters, 'matter_limit', x.matter_limit,
        'storage_bytes', x.storage_bytes, 'storage_limit_bytes', x.storage_limit_bytes,
        'ai_runs_30d', x.ai_runs_30d, 'ai_failed_30d', x.ai_failed_30d, 'ai_tokens_30d', x.ai_tokens_30d,
        'ai_cost_usd_30d', x.ai_cost_usd_30d, 'flags', to_jsonb(x.flags)
      ) order by
        case when v_sort = 'seats_desc' then x.seats_active end desc nulls last,
        case when v_sort = 'matters_desc' then x.active_matters end desc nulls last,
        case when v_sort = 'storage_desc' then x.storage_bytes end desc nulls last,
        case when v_sort = 'ai_cost_desc' then x.ai_cost_usd_30d end desc nulls last,
        lower(x.display_name), x.id)
      from (select * from filtered order by
              case when v_sort = 'seats_desc' then seats_active end desc nulls last,
              case when v_sort = 'matters_desc' then active_matters end desc nulls last,
              case when v_sort = 'storage_desc' then storage_bytes end desc nulls last,
              case when v_sort = 'ai_cost_desc' then ai_cost_usd_30d end desc nulls last,
              lower(display_name), id
            limit v_limit offset v_offset) x
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'flagged_total', (select count(*) from flagged where cardinality(flags) > 0),
    'totals', (select jsonb_build_object(
        'seats_active', coalesce(sum(seats_active), 0), 'active_matters', coalesce(sum(active_matters), 0),
        'storage_bytes', coalesce(sum(storage_bytes), 0), 'ai_runs_30d', coalesce(sum(ai_runs_30d), 0),
        'ai_cost_usd_30d', coalesce(sum(ai_cost_usd_30d), 0)) from flagged),
    'plans', catalog - 'currency' - 'annual_months' - 'extra_seat_monthly_cents',
    'near_threshold', 0.9,
    'ai_window_days', 30,
    'limit', v_limit, 'offset', v_offset
  ) into result;
  return result;
end;
$$;
revoke all on function public.platform_usage(text, boolean, text, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_usage(text, boolean, text, integer, integer) to service_role;

-- Privacy requests across firms, metadata only (no requester name, details, notes or delivery content).
-- Effective due date = extended_due_on, else due_on. open = not closed. overdue = open and due < today
-- (America/Toronto). due_soon = open and due within 5 days. stage follows the recorded timestamps.
create or replace function public.platform_privacy_requests(
  p_state text default 'open', p_organization_id uuid default null, p_limit integer default 50, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state text := coalesce(p_state, 'open');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  today date := (statement_timestamp() at time zone 'America/Toronto')::date;
  result jsonb;
begin
  perform app.platform_read_allowed();
  if v_state not in ('open', 'overdue', 'due_soon', 'closed', 'all') then
    raise exception 'state is open, overdue, due_soon, closed or all' using errcode = '22023';
  end if;
  with base as (
    select pr.id, pr.organization_id, org.display_name, pr.reference, pr.kind::text as kind, pr.channel::text as channel,
           pr.received_on, pr.due_on, pr.extended_due_on, coalesce(pr.extended_due_on, pr.due_on) as effective_due_on,
           pr.target_days, pr.closed_at, pr.outcome::text as outcome, pr.is_sample, pr.created_at,
           pr.assignee_membership_id is not null as assigned,
           case when pr.closed_at is not null then 'closed'
                when pr.reviewed_at is not null then 'reviewed'
                when pr.redaction_at is not null then 'redacted'
                when pr.scope_at is not null then 'scoped'
                when pr.identity_verified_at is not null then 'identity_verified'
                else 'received' end as stage
      from public.privacy_requests pr
      join public.organizations org on org.id = pr.organization_id
     where p_organization_id is null or pr.organization_id = p_organization_id
  ),
  tagged as (
    select b.*,
           case when b.closed_at is null and b.effective_due_on is not null then b.effective_due_on - today end as days_left,
           (b.closed_at is null and b.effective_due_on < today) as overdue,
           (b.closed_at is null and b.effective_due_on between today and today + 5) as due_soon
      from base b
  ),
  filtered as (
    select * from tagged t
     where v_state = 'all'
        or (v_state = 'open' and t.closed_at is null)
        or (v_state = 'closed' and t.closed_at is not null)
        or (v_state = 'overdue' and t.overdue)
        or (v_state = 'due_soon' and t.due_soon)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'organization_id', x.organization_id, 'firm_name', x.display_name, 'reference', x.reference,
        'kind', x.kind, 'channel', x.channel, 'received_on', x.received_on, 'due_on', x.due_on,
        'extended_due_on', x.extended_due_on, 'effective_due_on', x.effective_due_on, 'target_days', x.target_days,
        'days_left', x.days_left, 'overdue', x.overdue, 'due_soon', x.due_soon, 'stage', x.stage,
        'assigned', x.assigned, 'outcome', x.outcome, 'closed_at', x.closed_at, 'is_sample', x.is_sample
      ) order by x.overdue desc, x.effective_due_on nulls last, x.created_at)
      from (select * from filtered order by overdue desc, effective_due_on nulls last, created_at limit v_limit offset v_offset) x), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'summary', (select jsonb_build_object(
        'open', count(*) filter (where closed_at is null),
        'overdue', count(*) filter (where overdue),
        'due_soon', count(*) filter (where due_soon),
        'closed_30d', count(*) filter (where closed_at >= statement_timestamp() - interval '30 days'),
        'open_by_kind', coalesce((select jsonb_object_agg(k, n) from (select kind as k, count(*) as n from tagged where closed_at is null group by kind) q), '{}'::jsonb)
      ) from tagged),
    'due_soon_days', 5,
    'limit', v_limit, 'offset', v_offset
  ) into result;
  return result;
end;
$$;
revoke all on function public.platform_privacy_requests(text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_privacy_requests(text, uuid, integer, integer) to service_role;

-- Sample mode: firms in sample mode or holding sample rows, with sample counts and proof steps.
create or replace function public.platform_sample_overview(p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  all_steps text[] := array(select unnest(enum_range(null::public.sample_proof_step))::text);
  result jsonb;
begin
  perform app.platform_read_allowed();
  with counts as (
    select org.id, org.display_name, org.slug, org.sample_mode, org.created_at,
           (select count(*) from public.matters m where m.organization_id = org.id and m.is_sample) as sample_matters,
           (select count(*) from public.matters m where m.organization_id = org.id and not m.is_sample) as real_matters,
           (select count(*) from public.privacy_requests p where p.organization_id = org.id and p.is_sample) as sample_privacy_requests,
           (select count(*) from public.migration_batches b where b.organization_id = org.id and b.is_sample) as sample_migration_batches,
           (select count(*) from public.vo_runs r where r.organization_id = org.id and r.is_sample) as sample_ai_runs,
           coalesce((select array_agg(s.step::text order by s.step) from public.sample_proof_steps s
                      where s.organization_id = org.id and s.completed_at is not null), array[]::text[]) as steps_done
      from public.organizations org
  ),
  relevant as (
    select * from counts c
     where c.sample_mode or c.sample_matters > 0 or c.sample_privacy_requests > 0 or c.sample_migration_batches > 0 or c.sample_ai_runs > 0
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'organization_id', x.id, 'display_name', x.display_name, 'slug', x.slug, 'sample_mode', x.sample_mode,
        'sample_matters', x.sample_matters, 'real_matters', x.real_matters,
        'sample_privacy_requests', x.sample_privacy_requests, 'sample_migration_batches', x.sample_migration_batches,
        'sample_ai_runs', x.sample_ai_runs, 'proof_steps_done', to_jsonb(x.steps_done),
        'proof_complete', x.steps_done @> all_steps, 'mixed', (x.sample_matters > 0 and x.real_matters > 0)
      ) order by x.sample_mode desc, lower(x.display_name), x.id)
      from (select * from relevant order by sample_mode desc, lower(display_name), id limit v_limit offset v_offset) x), '[]'::jsonb),
    'total', (select count(*) from relevant),
    'summary', (select jsonb_build_object(
        'firms_in_sample_mode', count(*) filter (where sample_mode),
        'firms_total', count(*),
        'proof_complete', count(*) filter (where sample_mode and steps_done @> all_steps),
        'mixed', count(*) filter (where sample_matters > 0 and real_matters > 0)) from counts),
    'proof_steps', to_jsonb(all_steps),
    'limit', v_limit, 'offset', v_offset
  ) into result;
  return result;
end;
$$;
revoke all on function public.platform_sample_overview(integer, integer) from public, anon, authenticated;
grant execute on function public.platform_sample_overview(integer, integer) to service_role;

-- Migration: data import jobs (migration_batches) across firms, metadata only (no file names, headers,
-- mappings or row content; exceptions only as a count). stuck = committing for over 30 minutes.
-- purge_due = staging not yet purged and purge_after has passed.
create or replace function public.platform_migration_jobs(
  p_status text default null, p_organization_id uuid default null, p_limit integer default 50, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  result jsonb;
begin
  perform app.platform_read_allowed();
  if p_status is not null and p_status not in ('staged', 'checked', 'committing', 'committed', 'rolled_back', 'discarded', 'stuck') then
    raise exception 'status is staged, checked, committing, committed, rolled_back, discarded or stuck' using errcode = '22023';
  end if;
  with base as (
    select b.*, org.display_name,
           (b.status = 'committing' and coalesce(b.commit_started_at, b.full_run_started_at, b.updated_at) < statement_timestamp() - interval '30 minutes') as stuck,
           (b.staging_purged_at is null and b.purge_after is not null and b.purge_after < statement_timestamp()) as purge_due,
           jsonb_array_length(b.exceptions) as exception_count
      from public.migration_batches b
      join public.organizations org on org.id = b.organization_id
     where p_organization_id is null or b.organization_id = p_organization_id
  ),
  filtered as (
    select * from base
     where p_status is null or (p_status = 'stuck' and stuck) or (p_status <> 'stuck' and status::text = p_status)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'organization_id', x.organization_id, 'firm_name', x.display_name, 'kind', x.kind,
        'source_system', x.source_system, 'status', x.status::text, 'is_sample', x.is_sample,
        'byte_size', x.byte_size, 'source_row_count', x.source_row_count, 'staged_row_count', x.staged_row_count,
        'attachment_files', x.attachment_files, 'attachment_bytes', x.attachment_bytes,
        'plan_counts', x.plan_counts, 'result_counts', x.result_counts, 'pilot_counts', x.pilot_counts,
        'exception_count', x.exception_count, 'pilot_size', x.pilot_size,
        'verified_at', x.verified_at, 'checked_at', x.checked_at, 'pilot_started_at', x.pilot_started_at,
        'pilot_completed_at', x.pilot_completed_at, 'pilot_signed_off_at', x.pilot_signed_off_at,
        'full_run_started_at', x.full_run_started_at, 'commit_started_at', x.commit_started_at,
        'committed_at', x.committed_at, 'commit_verified_at', x.commit_verified_at,
        'rolled_back_at', x.rolled_back_at, 'discarded_at', x.discarded_at,
        'purge_after', x.purge_after, 'staging_purged_at', x.staging_purged_at,
        'stuck', x.stuck, 'purge_due', x.purge_due, 'created_at', x.created_at, 'updated_at', x.updated_at
      ) order by x.stuck desc, x.updated_at desc, x.id)
      from (select * from filtered order by stuck desc, updated_at desc, id limit v_limit offset v_offset) x), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'summary', (select jsonb_build_object(
        'by_status', coalesce((select jsonb_object_agg(s, n) from (select status::text as s, count(*) as n from base group by status) q), '{}'::jsonb),
        'stuck', count(*) filter (where stuck),
        'purge_due', count(*) filter (where purge_due),
        'active', count(*) filter (where status in ('staged', 'checked', 'committing'))) from base),
    'stuck_after_minutes', 30,
    'limit', v_limit, 'offset', v_offset
  ) into result;
  return result;
end;
$$;
revoke all on function public.platform_migration_jobs(text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_migration_jobs(text, uuid, integer, integer) to service_role;

-- Releases: shared template versions that reached firms (published, superseded, rolled back), newest first.
create or replace function public.platform_template_releases(p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  result jsonb;
begin
  perform app.platform_read_allowed();
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'version_id', x.id, 'template_id', x.template_id, 'stable_key', x.stable_key, 'title', x.title,
        'version_number', x.version_number, 'status', x.status, 'effective_on', x.effective_on,
        'published_at', x.published_at, 'reviewed_at', x.reviewed_at, 'reviewer_label', x.reviewer_label,
        'author_name', x.author_name, 'changelog', x.changelog,
        'adopting_firms', (select count(*) from public.firm_shared_template_adoptions a where a.template_id = x.template_id)
      ) order by x.published_at desc, x.id)
      from (select v.*, t.stable_key, coalesce(v.body ->> 'title', t.title) as title
              from public.shared_template_versions v join public.shared_templates t on t.id = v.template_id
             where v.published_at is not null
             order by v.published_at desc, v.id limit v_limit offset v_offset) x), '[]'::jsonb),
    'total', (select count(*) from public.shared_template_versions v where v.published_at is not null),
    'limit', v_limit, 'offset', v_offset
  ) into result;
  return result;
end;
$$;
revoke all on function public.platform_template_releases(integer, integer) from public, anon, authenticated;
grant execute on function public.platform_template_releases(integer, integer) to service_role;
