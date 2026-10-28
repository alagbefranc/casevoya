-- SRC-09 on top of the SRC-03 publication gate (20261025400000_src_claims_review.sql).
--
-- 1. One definition of "live". A rule version Vo may cite is one app.rule_version_is_live accepts
--    (published, and today within its stated effective dates): review_due, suspended, superseded,
--    rejected, expired and unapproved versions are never cited. 20261025420000 checked the same
--    status and dates inline; it now calls the single definition. The registers (IRCC fees,
--    submission steps, renewal timings, follow-up steps) keep status 'approved': their own
--    statuses (pending_review, approved, rejected, superseded, retired) are not rule statuses.
-- 2. One homepage rule. app.vo_citable_official_url stays federal-only (canada.ca, *.canada.ca,
--    *.gc.ca), as decided, and now also refuses every URL app.official_claim_url refuses.
--
-- Redefined (copied from their latest definitions in 20261025420000_vo_grounded_outputs.sql):
--   app.vo_citable_official_url(text)            adds the app.official_claim_url check
--   app.vo_letter_official_items(uuid, uuid)     rule versions through app.rule_version_is_live
-- The claims functions are called as they are, never redefined. Additive; seeds nothing.

-- ---------------------------------------------------------------------------
-- app.vo_citable_official_url (redefined from 20261025420000_vo_grounded_outputs.sql)
-- ---------------------------------------------------------------------------

create or replace function app.vo_citable_official_url(p_url text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host text := app.federal_official_url(p_url);
  rest text;
  hostport text;
  page text;
begin
  if v_host is null then
    return false;
  end if;
  -- SRC-01 homepage: never a page app.official_claim_url refuses (fewer than two path segments
  -- besides language folders and index pages).
  if app.official_claim_url(p_url) is null then
    return false;
  end if;
  rest := substring(btrim(p_url) from 9);
  hostport := split_part(split_part(split_part(rest, '/', 1), '?', 1), '#', 1);
  page := substring(rest from length(hostport) + 1);
  page := lower(btrim(split_part(split_part(page, '#', 1), '?', 1), '/'));
  return page <> '' and page not in (
    'en', 'fr', 'eng', 'fra', 'english', 'francais',
    'index.html', 'index.htm', 'index.asp', 'default.asp',
    'en.html', 'fr.html', 'en/index.html', 'fr/index.html', 'eng/index.html', 'fra/index.html',
    'english/index.asp', 'francais/index.asp',
    'en/immigration-refugees-citizenship.html', 'fr/immigration-refugies-citoyennete.html',
    'eng/acts', 'fra/lois', 'eng/regulations', 'fra/reglements'
  );
end;
$$;
revoke all on function app.vo_citable_official_url(text) from public;
grant execute on function app.vo_citable_official_url(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- app.vo_letter_official_items (redefined from 20261025420000_vo_grounded_outputs.sql: rule
-- versions are the live ones, by app.rule_version_is_live)
-- ---------------------------------------------------------------------------

create or replace function app.vo_letter_official_items(p_org uuid, p_matter_id uuid)
returns table (
  kind text,
  id uuid,
  label text,
  content text,
  source_url text,
  source_section text,
  form_number text,
  form_modified_on date,
  checked_on date,
  current_to date,
  snapshot_sha256 text,
  attested_on date,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select items.*
  from (
    with program as (select app.matter_program_key(p_matter_id) as key)
    select 'fee', fee.id, left(fee.name, 300),
           left(fee.name || ': CAD ' || to_char(fee.amount_cents / 100.0, 'FM999999990.00'), 600),
           fee.source_url, fee.section, null::text, null::date,
           app.firm_local_date(p_org, fee.retrieved_at), null::date, fee.snapshot_sha256, null::date, fee.reviewed_at
    from public.government_fee_references fee
    where fee.organization_id = p_org and fee.status = 'approved'
    union all
    select 'submission_requirement', req.id,
           case when req.kind = 'channel_name' then 'IRCC channel name' else 'Step outside Casevoya' end,
           left(req.label, 600),
           req.source_url, req.source_section, req.form_number, req.form_modified_on,
           req.checked_on, req.current_to, req.snapshot_sha256, req.page_attested_on, req.reviewed_at
    from public.submission_requirements req, program
    where req.organization_id = p_org and req.status = 'approved'
      and (req.program_key is null or req.program_key = program.key)
    union all
    select 'renewal_timing', timing.id, left(timing.applies_to, 300),
           left(timing.applies_to || ': ' || timing.timing_text, 600),
           timing.source_url, timing.source_section, timing.form_number, timing.form_modified_on,
           timing.checked_on, timing.current_to, timing.snapshot_sha256, timing.page_attested_on, timing.reviewed_at
    from public.renewal_timings timing, program
    where timing.organization_id = p_org and timing.status = 'approved'
      and (timing.program_key is null or timing.program_key = program.key)
    union all
    select 'follow_up_step', step.id, left(step.label, 300),
           left(step.label || coalesce(': ' || step.timing_text, ''), 600),
           step.source_url, step.source_section, step.form_number, step.form_modified_on,
           step.checked_on, step.current_to, step.snapshot_sha256, step.page_attested_on, step.reviewed_at
    from public.approval_follow_up_steps step, program
    where step.organization_id = p_org and step.status = 'approved' and step.retired_at is null
      and step.program_key = program.key
    union all
    select 'rule_version', rule.id, left(definition.stable_key, 300), left(rule.claim, 600),
           evidence.final_url, evidence.source_section, null::text, evidence.modified_on,
           app.firm_local_date(p_org, evidence.retrieved_at), evidence.current_to, evidence.content_hash, null::date, null::timestamptz
    from public.rule_versions rule
    join public.rule_definitions definition on definition.id = rule.definition_id
    cross join program
    cross join lateral (
      select snapshot.final_url, link.source_section, snapshot.modified_on, snapshot.retrieved_at, snapshot.current_to, snapshot.content_hash
      from public.rule_evidence link
      join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
      where link.rule_version_id = rule.id
      order by snapshot.retrieved_at desc
      limit 1
    ) evidence
    where app.rule_version_is_live(rule.id)
      and rule.claim is not null
      and (definition.organization_id is null or definition.organization_id = p_org)
      and (rule.organization_id is null or rule.organization_id = p_org)
      and (definition.program_key is null or definition.program_key = program.key)
  ) as items (
    kind, id, label, content, source_url, source_section, form_number, form_modified_on,
    checked_on, current_to, snapshot_sha256, attested_on, reviewed_at
  )
  where app.vo_citable_official_url(items.source_url);
$$;
revoke all on function app.vo_letter_official_items(uuid, uuid) from public;
