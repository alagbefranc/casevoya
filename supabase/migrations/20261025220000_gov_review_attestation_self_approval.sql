-- GOV follow-up (#181): two review rules Francis delegated to engineering (docs/DECISIONS.md, 2026-10-24).
--
-- 1. Approval without a server page snapshot. When Casevoya's server could not read the official
--    page (no snapshot hash), a licensed reviewer may still approve the entry, but only by
--    attesting "I opened the official page myself on <date> and the entry matches it". The
--    attestation (who, the date they opened the page, and when they attested) is stored on the row
--    and shown next to the value. With a snapshot, approval is unchanged and no attestation is kept.
--    Applies to official steps and channel names (public.submission_requirements, which until now
--    refused approval without a snapshot), the issuer list (public.government_issuers) and IRCC
--    processing-time estimates (public.government_processing_estimates), which until now approved
--    an unread page with nothing said about it.
-- 2. Self-approval. A licensed member may approve an entry they entered themselves only when the firm
--    has no other active licensed member (app.gov_other_licensed_reviewers), and then only after a
--    step-up taken after the entry was made, as for FIN-09's own-payment verification. Otherwise the
--    database refuses with a plain message. Audited as <event>_self. Rejecting your own entry is
--    still allowed (it publishes nothing).
--
-- Each review function takes a new last argument, p_page_opened_on (the date the reviewer opened
-- the page). The four-argument functions stay and pass null, so existing callers keep working and a
-- no-snapshot approval through them is refused with the attestation message.
--
-- Redefined (copied from their latest definitions, changes marked "GOV follow-up"):
--   app.review_submission_requirement(uuid, integer, text, text)  from 20261025170000_gov_submission_checklist.sql
--   app.review_government_issuer(uuid, integer, text, text)       from 20261025180000_gov_correspondence_issuers_tasks.sql
--   app.review_processing_estimate(uuid, integer, text, text)     from 20261025190000_gov_status_provenance.sql
-- The four-argument versions now delegate to new five-argument versions holding the copied bodies.
-- Additive: new nullable columns, one relaxed check constraint, new checks (NOT VALID where rows
-- approved before this migration may exist), new functions and wrappers.

-- ---------------------------------------------------------------------------
-- Attestation columns
-- ---------------------------------------------------------------------------

alter table public.submission_requirements
  add column page_attested_by_membership_id uuid,
  add column page_attested_on date,
  add column page_attested_at timestamptz,
  add constraint submission_requirements_attester_fk
    foreign key (page_attested_by_membership_id, organization_id) references public.memberships (id, organization_id),
  add constraint submission_requirements_attestation_shape check (
    ((page_attested_by_membership_id is null) = (page_attested_on is null))
    and ((page_attested_on is null) = (page_attested_at is null))
    and (page_attested_on is null or snapshot_sha256 is null)
  );
-- Was: an approved requirement needs a snapshot. Now: a snapshot, or the reviewer's attestation.
alter table public.submission_requirements drop constraint submission_requirements_check3;
alter table public.submission_requirements
  add constraint submission_requirements_approved_source check (status <> 'approved' or snapshot_sha256 is not null or page_attested_on is not null);
create index submission_requirements_attester_org_fk_idx on public.submission_requirements (page_attested_by_membership_id, organization_id);
comment on column public.submission_requirements.page_attested_on is
  'When the server had no snapshot of the page: the date the approving licensed member says they opened the official page themselves and found the entry matches it. Null when a snapshot exists.';

alter table public.government_issuers
  add column page_attested_by_membership_id uuid,
  add column page_attested_on date,
  add column page_attested_at timestamptz,
  add constraint government_issuers_attester_fk
    foreign key (page_attested_by_membership_id, organization_id) references public.memberships (id, organization_id),
  add constraint government_issuers_attestation_shape check (
    ((page_attested_by_membership_id is null) = (page_attested_on is null))
    and ((page_attested_on is null) = (page_attested_at is null))
    and (page_attested_on is null or snapshot_sha256 is null)
  );
-- Issuers approved before this rule may lack both; new approvals are checked.
alter table public.government_issuers
  add constraint government_issuers_approved_source check (status <> 'approved' or snapshot_sha256 is not null or page_attested_on is not null) not valid;
create index government_issuers_attester_org_fk_idx on public.government_issuers (page_attested_by_membership_id, organization_id);
comment on column public.government_issuers.page_attested_on is
  'When the server could not read the page: the date the approving licensed member says they opened the official page themselves and found the name matches it. Null when the page was read.';

alter table public.government_processing_estimates
  add column page_attested_by_membership_id uuid,
  add column page_attested_on date,
  add column page_attested_at timestamptz,
  add constraint government_processing_estimates_attester_fk
    foreign key (page_attested_by_membership_id, organization_id) references public.memberships (id, organization_id),
  add constraint government_processing_estimates_attestation_shape check (
    ((page_attested_by_membership_id is null) = (page_attested_on is null))
    and ((page_attested_on is null) = (page_attested_at is null))
    and (page_attested_on is null or snapshot_sha256 is null)
  );
alter table public.government_processing_estimates
  add constraint government_processing_estimates_approved_source check (status <> 'approved' or snapshot_sha256 is not null or page_attested_on is not null) not valid;
create index government_processing_estimates_attester_org_fk_idx on public.government_processing_estimates (page_attested_by_membership_id, organization_id);
comment on column public.government_processing_estimates.page_attested_on is
  'When the server could not capture IRCC''s page: the date the approving licensed member says they opened it themselves and found the estimate matches it. Null when the page was captured.';

-- ---------------------------------------------------------------------------
-- Shared rules
-- ---------------------------------------------------------------------------

-- Other active licensed members (owners included, app.membership_is_licensed) who could review
-- instead of p_user. A member whose licence is revoked, suspended, inactive or not entitled can't
-- review, so they don't count.
create function app.gov_other_licensed_reviewers(p_org uuid, p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct mem.user_id)::integer
  from public.memberships mem
  where mem.organization_id = p_org
    and mem.status = 'active'
    and mem.user_id is distinct from p_user
    and app.membership_is_licensed(mem.id)
    and not exists (
      select 1
      from public.consultant_credentials credential
      where credential.membership_id = mem.id
        and credential.organization_id = mem.organization_id
        and app.licence_status_blocks(credential.status)
    );
$$;
revoke all on function app.gov_other_licensed_reviewers(uuid, uuid) from public, anon;
grant execute on function app.gov_other_licensed_reviewers(uuid, uuid) to authenticated, service_role;

-- Approving an entry the signed-in member made: refused while another licensed member exists;
-- otherwise needs a step-up taken after the entry was made (FIN-09's own-entry rule). Returns true
-- when this is a self-approval.
create function app.gov_check_self_approval(p_org uuid, p_entered_by uuid, p_entered_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if p_entered_by is null or p_entered_by is distinct from actor then
    return false;
  end if;
  if app.gov_other_licensed_reviewers(p_org, actor) > 0 then
    raise exception 'you entered this yourself, so another licensed member of the firm approves it' using errcode = '42501';
  end if;
  if app.mfa_step_up_satisfied(least(interval '15 minutes', statement_timestamp() - date_trunc('second', p_entered_at)))
     is distinct from true then
    raise exception 'step-up is required: approving your own entry needs a step-up after it was entered' using errcode = '42501';
  end if;
  return true;
end;
$$;
revoke all on function app.gov_check_self_approval(uuid, uuid, timestamptz) from public, anon;
grant execute on function app.gov_check_self_approval(uuid, uuid, timestamptz) to authenticated, service_role;

-- Approving without a snapshot: the reviewer attests they opened the page on p_opened_on, a day
-- from the day the entry was made up to today (firm dates). With a snapshot, nothing is kept.
create function app.gov_check_page_attestation(p_org uuid, p_has_snapshot boolean, p_opened_on date, p_entered_at timestamptz)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_has_snapshot then
    return null;
  end if;
  if p_opened_on is null then
    raise exception 'Casevoya has no capture of this page: approving it needs your attestation that you opened the official page yourself and the entry matches it' using errcode = '22023';
  end if;
  if p_opened_on > app.firm_today(p_org) or p_opened_on < app.firm_local_date(p_org, p_entered_at) then
    raise exception 'the date you opened the page must be between the day the entry was made and today' using errcode = '22023';
  end if;
  return p_opened_on;
end;
$$;
revoke all on function app.gov_check_page_attestation(uuid, boolean, date, timestamptz) from public, anon;
grant execute on function app.gov_check_page_attestation(uuid, boolean, date, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Official steps and channel names
-- ---------------------------------------------------------------------------

-- app.review_submission_requirement, copied from 20261025170000_gov_submission_checklist.sql.
-- GOV follow-up: p_page_opened_on added; the "goes live only with a snapshot" refusal is replaced by
-- the attestation (app.gov_check_page_attestation); self-approval checked (app.gov_check_self_approval).
create function app.review_submission_requirement(
  p_requirement_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  requirement public.submission_requirements%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  reviewer uuid;
  earlier record;
  new_version integer;
  opened date;
  self_approval boolean := false;
begin
  select * into requirement from public.submission_requirements where id = p_requirement_id for update;
  if requirement.id is null or requirement.organization_id is distinct from app.current_organization_id() then
    raise exception 'requirement review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(requirement.organization_id, true);
  if requirement.version is distinct from p_expected_version then
    raise exception 'requirement version conflict' using errcode = 'PT409';
  end if;
  if requirement.status <> 'pending_review' then
    raise exception 'nothing is waiting for review' using errcode = '22023';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or length(v_note) < 3) then
    raise exception 'say why it''s rejected' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    -- GOV follow-up: no snapshot needs the reviewer's attestation; own entries only when no one else can review.
    opened := app.gov_check_page_attestation(requirement.organization_id, requirement.snapshot_sha256 is not null, p_page_opened_on, requirement.created_at);
    self_approval := app.gov_check_self_approval(requirement.organization_id, requirement.created_by, requirement.created_at);
  end if;
  reviewer := app.gov_actor_membership(requirement.organization_id);
  if p_decision = 'approved' and requirement.kind = 'channel_name' then
    for earlier in
      select other.id from public.submission_requirements other
      where other.organization_id = requirement.organization_id and other.kind = 'channel_name' and other.status = 'approved'
        and other.channel = requirement.channel and other.program_key is not distinct from requirement.program_key
    loop
      perform app.gov_open_write(earlier.id);
      update public.submission_requirements
      set status = 'retired', retired_at = statement_timestamp(), review_note = coalesce(review_note, 'Replaced by a newer approved name')
      where id = earlier.id;
      perform app.gov_close_write(earlier.id);
    end loop;
  end if;
  perform app.gov_open_write(requirement.id);
  update public.submission_requirements
  set status = p_decision, reviewed_by_membership_id = reviewer, reviewed_at = statement_timestamp(), review_note = left(v_note, 500),
      page_attested_by_membership_id = case when opened is null then null else reviewer end,
      page_attested_on = opened,
      page_attested_at = case when opened is null then null else statement_timestamp() end
  where id = requirement.id
  returning version into new_version;
  perform app.gov_close_write(requirement.id);
  perform app.record_audit_event(
    requirement.organization_id,
    'submission.requirement_' || p_decision || case when self_approval then '_self' else '' end,
    'public.submission_requirements', requirement.id, 'success',
    jsonb_build_object(
      'kind', requirement.kind, 'channel', requirement.channel, 'source_url', requirement.source_url, 'snapshot_sha256', requirement.snapshot_sha256,
      'page_attested_on', opened, 'self_approved', self_approval
    )
  );
  return new_version;
end;
$$;
revoke all on function app.review_submission_requirement(uuid, integer, text, text, date) from public;
grant execute on function app.review_submission_requirement(uuid, integer, text, text, date) to authenticated, service_role;

-- The four-argument version (20261025170000) now delegates with no attestation.
create or replace function app.review_submission_requirement(p_requirement_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.review_submission_requirement(p_requirement_id, p_expected_version, p_decision, p_note, null::date);
end;
$$;

create function public.review_submission_requirement(
  p_requirement_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date
)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_submission_requirement(p_requirement_id, p_expected_version, p_decision, p_note, p_page_opened_on); $$;
revoke all on function public.review_submission_requirement(uuid, integer, text, text, date) from public, anon;
grant execute on function public.review_submission_requirement(uuid, integer, text, text, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Issuer list
-- ---------------------------------------------------------------------------

-- app.review_government_issuer, copied from 20261025180000_gov_correspondence_issuers_tasks.sql.
-- GOV follow-up: p_page_opened_on added; approving an issuer whose page wasn't read needs the
-- attestation; self-approval checked.
create function app.review_government_issuer(
  p_issuer_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  issuer public.government_issuers%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  new_version integer;
  opened date;
  self_approval boolean := false;
  attester uuid;
begin
  select * into issuer from public.government_issuers where id = p_issuer_id for update;
  if issuer.id is null or issuer.organization_id is distinct from (select app.current_organization_id()) then
    raise exception 'issuer review denied' using errcode = '42501';
  end if;
  perform app.require_licensed_staff(issuer.organization_id, true);
  if p_decision not in ('approved', 'rejected', 'retired') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if issuer.version is distinct from p_expected_version then
    raise exception 'issuer version conflict' using errcode = 'PT409';
  end if;
  if p_decision in ('approved', 'rejected') and issuer.status <> 'pending_review' then
    raise exception 'this issuer is not waiting for review' using errcode = '22023';
  end if;
  if p_decision = 'retired' and issuer.status <> 'approved' then
    raise exception 'only an approved issuer is retired' using errcode = '22023';
  end if;
  if p_decision in ('rejected', 'retired') and (v_note is null or length(v_note) < 3) then
    raise exception 'say why' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    -- GOV follow-up: an unread page needs the reviewer's attestation; own entries only when no one else can review.
    opened := app.gov_check_page_attestation(issuer.organization_id, issuer.snapshot_sha256 is not null, p_page_opened_on, issuer.created_at);
    self_approval := app.gov_check_self_approval(issuer.organization_id, issuer.created_by, issuer.created_at);
    if opened is not null then
      attester := app.gov_actor_membership(issuer.organization_id);
    end if;
  end if;
  update public.government_issuers
  set status = p_decision, reviewed_by = (select auth.uid()), reviewed_at = clock_timestamp(), review_note = left(v_note, 500),
      page_attested_by_membership_id = case when p_decision = 'approved' then attester else page_attested_by_membership_id end,
      page_attested_on = case when p_decision = 'approved' then opened else page_attested_on end,
      page_attested_at = case when p_decision = 'approved' then (case when opened is null then null else clock_timestamp() end) else page_attested_at end
  where id = issuer.id
  returning version into new_version;
  perform app.record_audit_event(
    issuer.organization_id, 'government.issuer_' || p_decision || case when self_approval then '_self' else '' end,
    'public.government_issuers', issuer.id, 'success',
    jsonb_build_object('source_url', issuer.source_url, 'page_attested_on', opened, 'self_approved', self_approval)
  );
  return new_version;
end;
$$;
revoke all on function app.review_government_issuer(uuid, integer, text, text, date) from public, anon;
grant execute on function app.review_government_issuer(uuid, integer, text, text, date) to authenticated, service_role;

create or replace function app.review_government_issuer(p_issuer_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.review_government_issuer(p_issuer_id, p_expected_version, p_decision, p_note, null::date);
end;
$$;

create function public.review_government_issuer(p_issuer_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_government_issuer(p_issuer_id, p_expected_version, p_decision, p_note, p_page_opened_on); $$;
revoke all on function public.review_government_issuer(uuid, integer, text, text, date) from public, anon;
grant execute on function public.review_government_issuer(uuid, integer, text, text, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- IRCC processing-time estimates
-- ---------------------------------------------------------------------------

-- app.review_processing_estimate, copied from 20261025190000_gov_status_provenance.sql.
-- GOV follow-up: p_page_opened_on added; approving an estimate whose page wasn't captured needs the
-- attestation; self-approval checked.
create function app.review_processing_estimate(
  p_estimate_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  estimate public.government_processing_estimates%rowtype;
  earlier uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  new_version integer;
  opened date;
  self_approval boolean := false;
  reviewer uuid;
begin
  select * into estimate from public.government_processing_estimates where id = p_estimate_id for update;
  if estimate.id is null or app.can_read_matter(estimate.matter_id) is distinct from true then
    raise exception 'review denied' using errcode = '42501';
  end if;
  perform app.gov_require_licensed(estimate.organization_id);
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'unknown decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (v_note is null or length(v_note) < 3) then
    raise exception 'say why it''s rejected' using errcode = '22023';
  end if;
  if estimate.version is distinct from p_expected_version then
    raise exception 'estimate version conflict' using errcode = '40001';
  end if;
  if estimate.status <> 'pending_review' then
    raise exception 'this estimate is already reviewed' using errcode = '42501';
  end if;
  if p_decision = 'approved' then
    -- GOV follow-up: an uncaptured page needs the reviewer's attestation; own entries only when no one else can review.
    opened := app.gov_check_page_attestation(estimate.organization_id, estimate.snapshot_sha256 is not null, p_page_opened_on, estimate.created_at);
    self_approval := app.gov_check_self_approval(estimate.organization_id, estimate.created_by, estimate.created_at);
    for earlier in
      select prior.id from public.government_processing_estimates prior
      where prior.matter_id = estimate.matter_id and prior.status = 'approved' and prior.id <> estimate.id
    loop
      perform app.gov_open_write(earlier);
      update public.government_processing_estimates set status = 'superseded' where id = earlier;
      perform app.gov_close_write(earlier);
    end loop;
  end if;
  reviewer := app.gov_actor_membership(estimate.organization_id);
  perform app.gov_open_write(estimate.id);
  update public.government_processing_estimates
  set status = p_decision,
      reviewed_by_membership_id = reviewer,
      reviewed_at = statement_timestamp(),
      review_note = left(v_note, 500),
      page_attested_by_membership_id = case when opened is null then null else reviewer end,
      page_attested_on = opened,
      page_attested_at = case when opened is null then null else statement_timestamp() end
  where id = estimate.id
  returning version into new_version;
  perform app.gov_close_write(estimate.id);
  perform app.record_audit_event(
    estimate.organization_id, 'government.estimate_' || p_decision || case when self_approval then '_self' else '' end,
    'public.government_processing_estimates', estimate.id, 'success',
    jsonb_build_object('matter_id', estimate.matter_id, 'page_attested_on', opened, 'self_approved', self_approval)
  );
  return new_version;
end;
$$;
revoke all on function app.review_processing_estimate(uuid, integer, text, text, date) from public;
grant execute on function app.review_processing_estimate(uuid, integer, text, text, date) to authenticated, service_role;

create or replace function app.review_processing_estimate(p_estimate_id uuid, p_expected_version integer, p_decision text, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.review_processing_estimate(p_estimate_id, p_expected_version, p_decision, p_note, null::date);
end;
$$;

create function public.review_processing_estimate(p_estimate_id uuid, p_expected_version integer, p_decision text, p_note text, p_page_opened_on date)
returns integer language sql security invoker set search_path = ''
as $$ select app.review_processing_estimate(p_estimate_id, p_expected_version, p_decision, p_note, p_page_opened_on); $$;
revoke all on function public.review_processing_estimate(uuid, integer, text, text, date) from public, anon;
grant execute on function public.review_processing_estimate(uuid, integer, text, text, date) to authenticated, service_role;
