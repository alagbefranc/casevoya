-- T036 manual submission handoff, T037 government correspondence, T038 decision recording,
-- T039 basics (post-decision follow-ups and expiry reminders as tasks).
-- PRD §6 (refusal or withdrawal), §7 (stages and outcomes), §14 GOV-01 to GOV-05, DEC-01 to DEC-03.
--
-- Nothing here talks to a government system. Casevoya records what the firm's authorized
-- representative did and what the firm received, with evidence and the person who recorded it.
-- * A submission is "submission_unverified" until receipt evidence is on file. Only a verified
--   submission writes the stage-entry evidence the Submitted stage needs (matter_stage_evidence
--   'submission_confirmation'); the stage itself still moves through app.transition_matter_stage.
-- * Each letter is its own immutable row: the received date (the official date the firm
--   received it) is stored apart from the date printed on it and from when it was recorded.
--   A correction is a new row that points at the one it corrects; nothing is overwritten.
-- * A decision is recorded from a verified decision letter and counts only once a licensed
--   consultant confirms it with reviewed next steps. Nothing here reads or writes invoices,
--   payments, or client funds, and no payment or stage sets an outcome.
-- * No appeal, reconsideration, or renewal period is calculated. A refusal opens an urgent
--   consultant-review task with no invented deadline.
-- * Clients see a letter or decision only after the firm shares it (shared_with_client_at).
--   Submission records and government references stay staff-only (PRD §18).
--
-- Reuses: matter_stage_evidence (stage entry evidence), tasks via app.create_task,
-- deadlines (linked, not copied), document_versions (evidence), app.record_audit_event.
-- Additive only. No existing function, table, or policy is changed.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function app.gov_staff_roles()
returns public.org_role[]
language sql
immutable
set search_path = ''
as $$
  select array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[];
$$;
revoke all on function app.gov_staff_roles() from public;
grant execute on function app.gov_staff_roles() to authenticated, service_role;

-- Staff on this matter: MFA, a matter role, and the existing consultant/assignment scope.
create function app.gov_staff_can_read(p_matter_id uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.staff_mfa_satisfied()
    and app.has_org_role(p_org, app.gov_staff_roles())
    and app.can_read_matter(p_matter_id);
$$;
revoke all on function app.gov_staff_can_read(uuid, uuid) from public;
grant execute on function app.gov_staff_can_read(uuid, uuid) to authenticated, service_role;

-- A signed-in client who is a party on the matter.
create function app.gov_client_on_matter(p_matter_id uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matter_participants party
    join public.persons person
      on person.id = party.person_id
     and person.organization_id = party.organization_id
    where party.matter_id = p_matter_id
      and party.organization_id = p_org
      and person.user_id = (select auth.uid())
  );
$$;
revoke all on function app.gov_client_on_matter(uuid, uuid) from public;
grant execute on function app.gov_client_on_matter(uuid, uuid) to authenticated, service_role;

create function app.gov_actor_membership(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mem.id
  from public.memberships mem
  where mem.organization_id = p_org
    and mem.user_id = (select auth.uid())
    and mem.status = 'active'
    and mem.role = any (app.staff_roles())
  order by mem.created_at
  limit 1;
$$;
revoke all on function app.gov_actor_membership(uuid) from public;

-- Evidence is a stored, clean file version whose document is linked to this matter.
create function app.gov_evidence_on_matter(p_version_id uuid, p_matter_id uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.document_versions version
    join public.document_matter_refs ref
      on ref.document_id = version.document_id
     and ref.organization_id = version.organization_id
     and ref.removed_at is null
    where version.id = p_version_id
      and version.organization_id = p_org
      and ref.matter_id = p_matter_id
      and version.upload_state = 'clean'
  );
$$;
revoke all on function app.gov_evidence_on_matter(uuid, uuid, uuid) from public;

-- A licensed consultant (or credentialed owner) acting now, with a fresh step-up and no licence block.
create function app.gov_require_licensed(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_licensed_staff(p_org, true);
  if app.actor_licence_blocks_regulated_action(p_org) then
    raise exception 'not entitled, revoked, suspended, or inactive licence blocks this consultant action'
      using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.gov_require_licensed(uuid) from public;

-- Optimistic-lock nonce for the rows below: only these functions update them.
create table app.gov_write_nonce (
  row_id uuid primary key,
  txid bigint not null
);
revoke all on table app.gov_write_nonce from public, anon, authenticated, service_role;

create function app.gov_open_write(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.gov_write_nonce (row_id, txid)
  values (p_row_id, txid_current())
  on conflict (row_id) do update set txid = excluded.txid;
end;
$$;
revoke all on function app.gov_open_write(uuid) from public;

-- check:migrations allows delete inside a function body. This nonce is not a business row.
create function app.gov_close_write(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app.gov_write_nonce where row_id = p_row_id;
end;
$$;
revoke all on function app.gov_close_write(uuid) from public;

create function app.gov_guard_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'government records are not deleted' using errcode = '42501';
  end if;
  if not exists (
    select 1 from app.gov_write_nonce nonce
    where nonce.row_id = new.id and nonce.txid = txid_current()
  ) then
    raise exception 'government records change only through their functions' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.gov_guard_update() from public;

create function app.gov_reject_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'this history is append-only' using errcode = '42501';
end;
$$;
revoke all on function app.gov_reject_mutation() from public;

-- Government status on the matter follows verified evidence only (GOV-05).
create function app.gov_set_matter_status(p_matter_id uuid, p_status public.government_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.open_matter_column(p_matter_id, 'government');
  update public.matters set government_status = p_status
  where id = p_matter_id and government_status is distinct from p_status;
  perform app.close_matter_column(p_matter_id);
end;
$$;
revoke all on function app.gov_set_matter_status(uuid, public.government_status) from public;

-- ---------------------------------------------------------------------------
-- T036 submission handoffs
-- ---------------------------------------------------------------------------
create table public.submission_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  package_label text not null check (length(btrim(package_label)) between 1 and 80),
  package_sha256 text check (package_sha256 is null or package_sha256 ~ '^[0-9a-f]{64}$'),
  channel public.submission_channel not null,
  status public.submission_handoff_status not null default 'awaiting_signoff',
  signoff_membership_id uuid,
  signed_off_at timestamptz,
  submitted_by_membership_id uuid,
  external_reference text check (external_reference is null or length(btrim(external_reference)) between 1 and 200),
  submitted_at timestamptz,
  receipt_version_id uuid,
  receipt_locator text check (receipt_locator is null or length(btrim(receipt_locator)) between 1 and 300),
  acknowledged_on date,
  verified_by_membership_id uuid,
  verified_at timestamptz,
  stage_evidence_id uuid,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(btrim(cancel_reason)) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (signoff_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (submitted_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (verified_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (receipt_version_id, organization_id) references public.document_versions (id, organization_id),
  foreign key (stage_evidence_id, organization_id) references public.matter_stage_evidence (id, organization_id),
  constraint submission_handoffs_signoff_ck check (
    status in ('awaiting_signoff', 'cancelled')
    or (signoff_membership_id is not null and signed_off_at is not null)
  ),
  constraint submission_handoffs_submitted_ck check (
    status not in ('submission_unverified', 'submission_verified')
    or (submitted_by_membership_id is not null and external_reference is not null and submitted_at is not null)
  ),
  constraint submission_handoffs_verified_ck check (
    status <> 'submission_verified'
    or (
      (receipt_version_id is not null or receipt_locator is not null)
      and verified_by_membership_id is not null
      and verified_at is not null
      and stage_evidence_id is not null
    )
  ),
  constraint submission_handoffs_cancel_ck check ((status = 'cancelled') = (cancelled_at is not null and cancel_reason is not null))
);
comment on table public.submission_handoffs is
  'Manual submission handoff (T036). The firm''s authorized representative submits outside Casevoya; this records sign-off, package version, reference, receipt, and the submitting representative. Not a government integration.';
comment on column public.submission_handoffs.external_reference is
  'Government reference as text. Restricted to staff; not unique (PRD §18).';
comment on column public.submission_handoffs.acknowledged_on is
  'Date on the acknowledgement, kept apart from submitted_at (GOV-03).';

create unique index submission_handoffs_open_uidx
  on public.submission_handoffs (matter_id)
  where status in ('awaiting_signoff', 'authorized');
create index submission_handoffs_org_fk_idx on public.submission_handoffs (organization_id);
create index submission_handoffs_matter_org_fk_idx on public.submission_handoffs (matter_id, organization_id);
create index submission_handoffs_signoff_org_fk_idx on public.submission_handoffs (signoff_membership_id, organization_id);
create index submission_handoffs_submitter_org_fk_idx on public.submission_handoffs (submitted_by_membership_id, organization_id);
create index submission_handoffs_verifier_org_fk_idx on public.submission_handoffs (verified_by_membership_id, organization_id);
create index submission_handoffs_receipt_org_fk_idx on public.submission_handoffs (receipt_version_id, organization_id);
create index submission_handoffs_evidence_org_fk_idx on public.submission_handoffs (stage_evidence_id, organization_id);
create index submission_handoffs_created_by_idx on public.submission_handoffs (created_by);

create trigger submission_handoffs_touch before update on public.submission_handoffs
  for each row execute function app.touch_row();
create trigger submission_handoffs_keys before update on public.submission_handoffs
  for each row execute function app.guard_tenant_keys();
create trigger submission_handoffs_stamp before insert on public.submission_handoffs
  for each row execute function app.stamp_created_by();
create trigger submission_handoffs_guard before update or delete on public.submission_handoffs
  for each row execute function app.gov_guard_update();
create trigger submission_handoffs_audit after insert or update or delete on public.submission_handoffs
  for each row execute function app.audit_row_change();

create function app.prepare_submission_handoff(
  p_matter_id uuid,
  p_package_label text,
  p_package_sha256 text,
  p_channel public.submission_channel
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_id uuid;
begin
  if p_package_label is null or length(btrim(p_package_label)) not between 1 and 80 then
    raise exception 'name the package version' using errcode = '22023';
  end if;
  if p_package_sha256 is not null and lower(btrim(p_package_sha256)) !~ '^[0-9a-f]{64}$' then
    raise exception 'a package hash is 64 hex characters' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'submission handoff denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(matter.organization_id, app.gov_staff_roles(), false);
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if matter.stage in ('engagement_pending', 'intake', 'closed') then
    raise exception 'a submission handoff needs an engaged, open matter' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.submission_handoffs handoff
    where handoff.matter_id = matter.id and handoff.status in ('awaiting_signoff', 'authorized')
  ) then
    raise exception 'this matter already has an open submission handoff' using errcode = '23505';
  end if;
  insert into public.submission_handoffs (organization_id, matter_id, package_label, package_sha256, channel)
  values (
    matter.organization_id, matter.id, btrim(p_package_label),
    case when p_package_sha256 is null then null else lower(btrim(p_package_sha256)) end,
    p_channel
  )
  returning id into new_id;
  perform app.record_audit_event(
    matter.organization_id, 'submission.handoff_prepared', 'public.submission_handoffs', new_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'channel', p_channel)
  );
  return new_id;
end;
$$;
revoke all on function app.prepare_submission_handoff(uuid, text, text, public.submission_channel) from public;

-- Reviewer sign-off: a licensed consultant, step-up, and current representation authority on file (GOV-01).
create function app.sign_off_submission_handoff(p_handoff_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  reviewer uuid;
  new_version integer;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'sign-off denied' using errcode = '42501';
  end if;
  perform app.gov_require_licensed(handoff.organization_id);
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = '40001';
  end if;
  if handoff.status is distinct from 'awaiting_signoff' then
    raise exception 'this handoff is not waiting for sign-off' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.representation_authorities authority
    where authority.matter_id = handoff.matter_id
      and authority.organization_id = handoff.organization_id
      and authority.revoked_at is null
      and authority.effective_on <= current_date
  ) then
    raise exception 'representation authority must be on file before sign-off' using errcode = '42501';
  end if;
  reviewer := app.gov_actor_membership(handoff.organization_id);
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'authorized', signoff_membership_id = reviewer, signed_off_at = statement_timestamp()
  where id = handoff.id
  returning version into new_version;
  perform app.gov_close_write(handoff.id);
  perform app.record_audit_event(
    handoff.organization_id, 'submission.signed_off', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id, 'package_label', handoff.package_label, 'package_sha256', handoff.package_sha256)
  );
  return new_version;
end;
$$;
revoke all on function app.sign_off_submission_handoff(uuid, integer) from public;

-- Writes the Submitted stage's entry evidence from a verified handoff.
create function app.gov_submission_evidence(p_handoff public.submission_handoffs, p_locator text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  evidence uuid;
begin
  insert into public.matter_stage_evidence (
    organization_id, matter_id, kind, summary, external_reference, submission_at, receipt_locator
  ) values (
    p_handoff.organization_id,
    p_handoff.matter_id,
    'submission_confirmation',
    left('Verified submission handoff: ' || p_handoff.package_label, 500),
    p_handoff.external_reference,
    p_handoff.submitted_at,
    left(p_locator, 500)
  )
  returning id into evidence;
  return evidence;
end;
$$;
revoke all on function app.gov_submission_evidence(public.submission_handoffs, text) from public;

create function app.gov_finish_verification(
  p_handoff_id uuid,
  p_receipt_version_id uuid,
  p_receipt_locator text,
  p_acknowledged_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  evidence uuid;
  new_version integer;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id;
  if p_receipt_version_id is null and (p_receipt_locator is null or length(btrim(p_receipt_locator)) = 0) then
    raise exception 'receipt evidence is required to verify a submission' using errcode = '22023';
  end if;
  if p_receipt_version_id is not null
     and app.gov_evidence_on_matter(p_receipt_version_id, handoff.matter_id, handoff.organization_id) is distinct from true then
    raise exception 'the receipt must be a stored file on this matter' using errcode = '42501';
  end if;
  if p_acknowledged_on is not null and p_acknowledged_on > current_date then
    raise exception 'an acknowledgement date cannot be in the future' using errcode = '22023';
  end if;
  handoff.receipt_version_id := p_receipt_version_id;
  handoff.receipt_locator := nullif(btrim(coalesce(p_receipt_locator, '')), '');
  evidence := app.gov_submission_evidence(
    handoff,
    coalesce(handoff.receipt_locator, 'document version ' || p_receipt_version_id::text)
  );
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'submission_verified',
      receipt_version_id = p_receipt_version_id,
      receipt_locator = handoff.receipt_locator,
      acknowledged_on = coalesce(p_acknowledged_on, acknowledged_on),
      verified_by_membership_id = app.gov_actor_membership(handoff.organization_id),
      verified_at = statement_timestamp(),
      stage_evidence_id = evidence
  where id = handoff.id
  returning version into new_version;
  perform app.gov_close_write(handoff.id);
  if (select government_status from public.matters where id = handoff.matter_id) = 'not_recorded' then
    perform app.gov_set_matter_status(handoff.matter_id, 'receipt_on_file');
  end if;
  perform app.record_audit_event(
    handoff.organization_id, 'submission.verified', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id, 'stage_evidence_id', evidence, 'receipt_file', p_receipt_version_id is not null)
  );
  return new_version;
end;
$$;
revoke all on function app.gov_finish_verification(uuid, uuid, text, date) from public;

-- The submitting representative's record. Without receipt evidence it stays "submission_unverified".
create function app.record_submission(
  p_handoff_id uuid,
  p_expected_version integer,
  p_external_reference text,
  p_submitted_at timestamptz,
  p_submitted_by_membership_id uuid,
  p_receipt_version_id uuid,
  p_receipt_locator text,
  p_acknowledged_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  new_version integer;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'submission record denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    handoff.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = '40001';
  end if;
  if handoff.status is distinct from 'authorized' then
    raise exception 'a submission is recorded only after consultant sign-off' using errcode = '42501';
  end if;
  if p_external_reference is null or length(btrim(p_external_reference)) not between 1 and 200 then
    raise exception 'the submission reference is required' using errcode = '22023';
  end if;
  if p_submitted_at is null or p_submitted_at > statement_timestamp() + interval '5 minutes' then
    raise exception 'the submission time is required and cannot be in the future' using errcode = '22023';
  end if;
  if p_submitted_at < handoff.signed_off_at - interval '1 day' then
    raise exception 'the submission time is before the consultant sign-off' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships mem
    where mem.id = p_submitted_by_membership_id
      and mem.organization_id = handoff.organization_id
      and app.membership_is_licensed(mem.id)
  ) then
    raise exception 'the submitting representative must be a licensed member of this firm' using errcode = '42501';
  end if;
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'submission_unverified',
      external_reference = btrim(p_external_reference),
      submitted_at = p_submitted_at,
      submitted_by_membership_id = p_submitted_by_membership_id
  where id = handoff.id
  returning version into new_version;
  perform app.gov_close_write(handoff.id);
  perform app.record_audit_event(
    handoff.organization_id, 'submission.recorded', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id, 'submitted_by', p_submitted_by_membership_id)
  );
  if p_receipt_version_id is not null or nullif(btrim(coalesce(p_receipt_locator, '')), '') is not null then
    new_version := app.gov_finish_verification(handoff.id, p_receipt_version_id, p_receipt_locator, p_acknowledged_on);
  elsif p_acknowledged_on is not null then
    raise exception 'an acknowledgement date needs the receipt' using errcode = '22023';
  end if;
  return new_version;
end;
$$;
revoke all on function app.record_submission(uuid, integer, text, timestamptz, uuid, uuid, text, date) from public;

create function app.verify_submission_receipt(
  p_handoff_id uuid,
  p_expected_version integer,
  p_receipt_version_id uuid,
  p_receipt_locator text,
  p_acknowledged_on date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
begin
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'submission verification denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    handoff.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = '40001';
  end if;
  if handoff.status is distinct from 'submission_unverified' then
    raise exception 'only an unverified submission takes a receipt' using errcode = '42501';
  end if;
  return app.gov_finish_verification(handoff.id, p_receipt_version_id, p_receipt_locator, p_acknowledged_on);
end;
$$;
revoke all on function app.verify_submission_receipt(uuid, integer, uuid, text, date) from public;

create function app.cancel_submission_handoff(p_handoff_id uuid, p_expected_version integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  handoff public.submission_handoffs%rowtype;
  new_version integer;
begin
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'cancelling a handoff needs a reason' using errcode = '22023';
  end if;
  select * into handoff from public.submission_handoffs where id = p_handoff_id for update;
  if handoff.id is null or app.can_read_matter(handoff.matter_id) is distinct from true then
    raise exception 'submission handoff denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    handoff.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if handoff.version is distinct from p_expected_version then
    raise exception 'submission handoff version conflict' using errcode = '40001';
  end if;
  if handoff.status not in ('awaiting_signoff', 'authorized') then
    raise exception 'a recorded submission is not cancelled; record what happened instead' using errcode = '42501';
  end if;
  perform app.gov_open_write(handoff.id);
  update public.submission_handoffs
  set status = 'cancelled', cancelled_at = statement_timestamp(), cancel_reason = btrim(p_reason)
  where id = handoff.id
  returning version into new_version;
  perform app.gov_close_write(handoff.id);
  perform app.record_audit_event(
    handoff.organization_id, 'submission.handoff_cancelled', 'public.submission_handoffs', handoff.id, 'success',
    jsonb_build_object('matter_id', handoff.matter_id)
  );
  return new_version;
end;
$$;
revoke all on function app.cancel_submission_handoff(uuid, integer, text) from public;

-- ---------------------------------------------------------------------------
-- T037 government correspondence
-- ---------------------------------------------------------------------------
create table public.government_correspondence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  kind public.correspondence_kind not null,
  issuer text check (issuer is null or length(btrim(issuer)) between 1 and 200),
  channel public.correspondence_channel not null,
  document_date date,
  received_on date not null,
  action_requested text check (action_requested is null or length(btrim(action_requested)) between 1 and 1000),
  stated_deadline text check (stated_deadline is null or length(btrim(stated_deadline)) between 1 and 200),
  reference_text text check (reference_text is null or length(btrim(reference_text)) between 1 and 200),
  evidence_version_id uuid,
  evidence_locator text check (evidence_locator is null or length(btrim(evidence_locator)) between 1 and 300),
  corrects_id uuid,
  verified_by_membership_id uuid,
  verified_at timestamptz,
  shared_with_client_at timestamptz,
  shared_by_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (corrects_id is distinct from id),
  check (verified_at is null or (verified_by_membership_id is not null and (evidence_version_id is not null or evidence_locator is not null))),
  check (shared_with_client_at is null or (verified_at is not null and shared_by_membership_id is not null)),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (evidence_version_id, organization_id) references public.document_versions (id, organization_id),
  foreign key (corrects_id, organization_id) references public.government_correspondence (id, organization_id),
  foreign key (verified_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (shared_by_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.government_correspondence is
  'One letter or message from a government authority, as recorded by the firm (GOV-04). Each row is kept as received; a correction is a new row with corrects_id. received_on is the date the firm received it; document_date is the date printed on it; created_at is when it was recorded.';
comment on column public.government_correspondence.stated_deadline is
  'The deadline exactly as written in the letter. Not parsed or calculated; a dated deadline is a linked deadlines row.';
comment on column public.government_correspondence.reference_text is
  'A government reference quoted from the letter. Staff-only unless the letter is shared.';

create index government_correspondence_matter_received_idx
  on public.government_correspondence (matter_id, received_on desc);
create index government_correspondence_org_fk_idx on public.government_correspondence (organization_id);
create index government_correspondence_matter_org_fk_idx on public.government_correspondence (matter_id, organization_id);
create index government_correspondence_evidence_org_fk_idx on public.government_correspondence (evidence_version_id, organization_id);
create index government_correspondence_corrects_org_fk_idx on public.government_correspondence (corrects_id, organization_id);
create index government_correspondence_verifier_org_fk_idx on public.government_correspondence (verified_by_membership_id, organization_id);
create index government_correspondence_sharer_org_fk_idx on public.government_correspondence (shared_by_membership_id, organization_id);
create index government_correspondence_created_by_idx on public.government_correspondence (created_by);

create trigger government_correspondence_touch before update on public.government_correspondence
  for each row execute function app.touch_row();
create trigger government_correspondence_keys before update on public.government_correspondence
  for each row execute function app.guard_tenant_keys();
create trigger government_correspondence_stamp before insert on public.government_correspondence
  for each row execute function app.stamp_created_by();
create trigger government_correspondence_guard before update or delete on public.government_correspondence
  for each row execute function app.gov_guard_update();
create trigger government_correspondence_audit after insert or update or delete on public.government_correspondence
  for each row execute function app.audit_row_change();

-- The received facts never change after recording; only verification and sharing are added.
create function app.gov_correspondence_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.kind, new.issuer, new.channel, new.document_date, new.received_on, new.action_requested,
      new.stated_deadline, new.reference_text, new.evidence_version_id, new.evidence_locator, new.corrects_id)
     is distinct from
     (old.kind, old.issuer, old.channel, old.document_date, old.received_on, old.action_requested,
      old.stated_deadline, old.reference_text, old.evidence_version_id, old.evidence_locator, old.corrects_id) then
    raise exception 'a recorded letter is not overwritten; record a correction' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.gov_correspondence_immutable() from public;
create trigger government_correspondence_immutable before update on public.government_correspondence
  for each row execute function app.gov_correspondence_immutable();

-- Deadlines and tasks a letter created. One letter may create several (GOV-04).
create table public.correspondence_work_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  correspondence_id uuid not null,
  deadline_id uuid,
  task_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  check ((deadline_id is null) <> (task_id is null)),
  foreign key (correspondence_id, organization_id) references public.government_correspondence (id, organization_id),
  foreign key (deadline_id, organization_id) references public.deadlines (id, organization_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id)
);
comment on table public.correspondence_work_links is
  'Which deadlines and response tasks came from which letter. The deadline keeps its own source and verification.';

create unique index correspondence_work_links_deadline_uidx
  on public.correspondence_work_links (correspondence_id, deadline_id) where deadline_id is not null;
create unique index correspondence_work_links_task_uidx
  on public.correspondence_work_links (correspondence_id, task_id) where task_id is not null;
create index correspondence_work_links_org_fk_idx on public.correspondence_work_links (organization_id);
create index correspondence_work_links_corr_org_fk_idx on public.correspondence_work_links (correspondence_id, organization_id);
create index correspondence_work_links_deadline_org_fk_idx on public.correspondence_work_links (deadline_id, organization_id);
create index correspondence_work_links_task_org_fk_idx on public.correspondence_work_links (task_id, organization_id);
create index correspondence_work_links_created_by_idx on public.correspondence_work_links (created_by);

create trigger correspondence_work_links_stamp before insert on public.correspondence_work_links
  for each row execute function app.stamp_created_by();
create trigger correspondence_work_links_append_only before update or delete on public.correspondence_work_links
  for each row execute function app.gov_reject_mutation();
create trigger correspondence_work_links_audit after insert on public.correspondence_work_links
  for each row execute function app.audit_row_change();

-- "We checked the portal; no change" (GOV-05 last checked).
create table public.government_status_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  note text not null check (length(btrim(note)) between 3 and 500),
  checked_by_membership_id uuid not null,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (checked_by_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.government_status_checks is
  'A staff member looked at the official channel. A check with no change does not create a status.';

create index government_status_checks_matter_idx on public.government_status_checks (matter_id, checked_at desc);
create index government_status_checks_org_fk_idx on public.government_status_checks (organization_id);
create index government_status_checks_matter_org_fk_idx on public.government_status_checks (matter_id, organization_id);
create index government_status_checks_member_org_fk_idx on public.government_status_checks (checked_by_membership_id, organization_id);
create index government_status_checks_created_by_idx on public.government_status_checks (created_by);

create trigger government_status_checks_stamp before insert on public.government_status_checks
  for each row execute function app.stamp_created_by();
create trigger government_status_checks_append_only before update or delete on public.government_status_checks
  for each row execute function app.gov_reject_mutation();
create trigger government_status_checks_audit after insert on public.government_status_checks
  for each row execute function app.audit_row_change();

-- The consultant-review task a request, procedural-fairness letter, or decision opens. No due date
-- is invented: the letter's own deadline, if any, is a separate deadline the firm records.
create function app.gov_review_task(
  p_matter public.matters,
  p_correspondence_id uuid,
  p_title text,
  p_priority public.task_priority
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  task_id uuid;
begin
  owner := coalesce(p_matter.responsible_consultant_membership_id, app.gov_actor_membership(p_matter.organization_id));
  task_id := app.create_task(
    p_matter.id, 'internal', left(p_title, 200), owner, null, p_priority,
    null, null, null, null, null, '[]'::jsonb
  );
  insert into public.correspondence_work_links (organization_id, correspondence_id, task_id)
  values (p_matter.organization_id, p_correspondence_id, task_id);
  return task_id;
end;
$$;
revoke all on function app.gov_review_task(public.matters, uuid, text, public.task_priority) from public;

create function app.record_government_correspondence(
  p_matter_id uuid,
  p_kind public.correspondence_kind,
  p_issuer text,
  p_channel public.correspondence_channel,
  p_document_date date,
  p_received_on date,
  p_action_requested text,
  p_stated_deadline text,
  p_reference_text text,
  p_evidence_version_id uuid,
  p_evidence_locator text,
  p_corrects_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_id uuid;
begin
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'correspondence denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(matter.organization_id, app.gov_staff_roles(), false);
  if app.sample_mode_blocks_real(matter.organization_id, matter.is_sample) then
    raise exception 'this firm is in sample mode; only sample matters accept new work' using errcode = '42501';
  end if;
  if p_received_on is null or p_received_on > current_date then
    raise exception 'the received date is required and cannot be in the future' using errcode = '22023';
  end if;
  if p_document_date is not null and p_document_date > current_date then
    raise exception 'the date on the letter cannot be in the future' using errcode = '22023';
  end if;
  if p_evidence_version_id is not null
     and app.gov_evidence_on_matter(p_evidence_version_id, matter.id, matter.organization_id) is distinct from true then
    raise exception 'the letter must be a stored file on this matter' using errcode = '42501';
  end if;
  if p_corrects_id is not null and not exists (
    select 1 from public.government_correspondence earlier
    where earlier.id = p_corrects_id and earlier.matter_id = matter.id
  ) then
    raise exception 'a correction points at a letter on this matter' using errcode = '42501';
  end if;
  insert into public.government_correspondence (
    organization_id, matter_id, kind, issuer, channel, document_date, received_on, action_requested,
    stated_deadline, reference_text, evidence_version_id, evidence_locator, corrects_id
  ) values (
    matter.organization_id, matter.id, p_kind, nullif(btrim(coalesce(p_issuer, '')), ''), p_channel,
    p_document_date, p_received_on, nullif(btrim(coalesce(p_action_requested, '')), ''),
    nullif(btrim(coalesce(p_stated_deadline, '')), ''), nullif(btrim(coalesce(p_reference_text, '')), ''),
    p_evidence_version_id, nullif(btrim(coalesce(p_evidence_locator, '')), ''), p_corrects_id
  )
  returning id into new_id;
  if p_kind in ('request', 'procedural_fairness') then
    perform app.gov_review_task(matter, new_id, 'Consultant review: government request received ' || to_char(p_received_on, 'YYYY-MM-DD'), 'high');
  elsif p_kind = 'decision' then
    perform app.gov_review_task(matter, new_id, 'Consultant review: decision letter received ' || to_char(p_received_on, 'YYYY-MM-DD'), 'high');
  end if;
  perform app.record_audit_event(
    matter.organization_id, 'government.correspondence_recorded', 'public.government_correspondence', new_id, 'success',
    jsonb_build_object('matter_id', matter.id, 'kind', p_kind, 'corrects_id', p_corrects_id, 'evidence', p_evidence_version_id is not null)
  );
  return new_id;
end;
$$;
revoke all on function app.record_government_correspondence(uuid, public.correspondence_kind, text, public.correspondence_channel, date, date, text, text, text, uuid, text, uuid) from public;

-- Staff verify a letter against its evidence. Only then does the matter's government status follow it.
create function app.verify_government_correspondence(p_correspondence_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  letter public.government_correspondence%rowtype;
  new_version integer;
begin
  select * into letter from public.government_correspondence where id = p_correspondence_id for update;
  if letter.id is null or app.can_read_matter(letter.matter_id) is distinct from true then
    raise exception 'verification denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    letter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    true
  );
  if letter.version is distinct from p_expected_version then
    raise exception 'correspondence version conflict' using errcode = '40001';
  end if;
  if letter.verified_at is not null then
    raise exception 'this letter is already verified' using errcode = '42501';
  end if;
  if letter.evidence_version_id is null and letter.evidence_locator is null then
    raise exception 'a letter is verified against its evidence; attach it first' using errcode = '42501';
  end if;
  perform app.gov_open_write(letter.id);
  update public.government_correspondence
  set verified_by_membership_id = app.gov_actor_membership(letter.organization_id),
      verified_at = statement_timestamp()
  where id = letter.id
  returning version into new_version;
  perform app.gov_close_write(letter.id);
  if letter.kind = 'acknowledgement' then
    if (select government_status from public.matters where id = letter.matter_id) = 'not_recorded' then
      perform app.gov_set_matter_status(letter.matter_id, 'receipt_on_file');
    end if;
  elsif letter.kind in ('request', 'procedural_fairness') then
    perform app.gov_set_matter_status(letter.matter_id, 'additional_request_open');
  elsif letter.kind in ('application_number', 'biometrics_instruction', 'status_update') then
    if (select government_status from public.matters where id = letter.matter_id) in ('not_recorded', 'receipt_on_file') then
      perform app.gov_set_matter_status(letter.matter_id, 'processing_reported');
    end if;
  elsif letter.kind = 'decision' then
    perform app.gov_set_matter_status(letter.matter_id, 'decision_evidence_on_file');
    insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
    values (
      letter.organization_id, letter.matter_id, 'official_decision',
      'Verified decision letter received ' || to_char(letter.received_on, 'YYYY-MM-DD')
    );
  end if;
  perform app.record_audit_event(
    letter.organization_id, 'government.correspondence_verified', 'public.government_correspondence', letter.id, 'success',
    jsonb_build_object('matter_id', letter.matter_id, 'kind', letter.kind)
  );
  return new_version;
end;
$$;
revoke all on function app.verify_government_correspondence(uuid, integer) from public;

-- Link a deadline or task already on the matter to the letter it came from.
create function app.link_correspondence_work(p_correspondence_id uuid, p_deadline_id uuid, p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  letter public.government_correspondence%rowtype;
  new_id uuid;
begin
  select * into letter from public.government_correspondence where id = p_correspondence_id;
  if letter.id is null or app.can_read_matter(letter.matter_id) is distinct from true then
    raise exception 'link denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(letter.organization_id, app.gov_staff_roles(), false);
  if (p_deadline_id is null) = (p_task_id is null) then
    raise exception 'link one deadline or one task' using errcode = '22023';
  end if;
  if p_deadline_id is not null and not exists (
    select 1 from public.deadlines deadline where deadline.id = p_deadline_id and deadline.matter_id = letter.matter_id
  ) then
    raise exception 'that deadline is not on this matter' using errcode = '42501';
  end if;
  if p_task_id is not null and not exists (
    select 1 from public.tasks task where task.id = p_task_id and task.matter_id = letter.matter_id
  ) then
    raise exception 'that task is not on this matter' using errcode = '42501';
  end if;
  insert into public.correspondence_work_links (organization_id, correspondence_id, deadline_id, task_id)
  values (letter.organization_id, letter.id, p_deadline_id, p_task_id)
  on conflict do nothing
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function app.link_correspondence_work(uuid, uuid, uuid) from public;

create function app.record_government_check(p_matter_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  matter public.matters%rowtype;
  new_id uuid;
begin
  if p_note is null or length(btrim(p_note)) not between 3 and 500 then
    raise exception 'say what was checked' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = p_matter_id;
  if matter.id is null or app.can_read_matter(matter.id) is distinct from true then
    raise exception 'status check denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(matter.organization_id, app.gov_staff_roles(), false);
  insert into public.government_status_checks (organization_id, matter_id, note, checked_by_membership_id)
  values (matter.organization_id, matter.id, btrim(p_note), app.gov_actor_membership(matter.organization_id))
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function app.record_government_check(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- T038 decisions, T039 follow-ups
-- ---------------------------------------------------------------------------
create table public.decision_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  correspondence_id uuid not null,
  outcome public.matter_outcome not null,
  milestone public.decision_milestone,
  decided_on date,
  authority_reasons text check (authority_reasons is null or length(btrim(authority_reasons)) between 1 and 4000),
  state public.decision_record_state not null default 'awaiting_confirmation',
  consultant_interpretation text check (consultant_interpretation is null or length(btrim(consultant_interpretation)) between 3 and 4000),
  next_steps text check (next_steps is null or length(btrim(next_steps)) between 3 and 4000),
  confirmed_by_membership_id uuid,
  confirmed_at timestamptz,
  stage_evidence_id uuid,
  shared_with_client_at timestamptz,
  shared_by_membership_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (
    state <> 'confirmed'
    or (confirmed_by_membership_id is not null and confirmed_at is not null and next_steps is not null and stage_evidence_id is not null)
  ),
  check (shared_with_client_at is null or (state = 'confirmed' and shared_by_membership_id is not null)),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (correspondence_id, organization_id) references public.government_correspondence (id, organization_id),
  foreign key (confirmed_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (shared_by_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (stage_evidence_id, organization_id) references public.matter_stage_evidence (id, organization_id)
);
comment on table public.decision_records is
  'A decision read from a verified decision letter (DEC-01). It counts once a licensed consultant confirms it with reviewed next steps. The authority''s reasons are stored apart from the consultant''s interpretation (DEC-03). Never set from a payment or a stage.';

create unique index decision_records_open_milestone_uidx
  on public.decision_records (correspondence_id, milestone)
  where state = 'awaiting_confirmation' and milestone is not null;
create unique index decision_records_open_uidx
  on public.decision_records (correspondence_id)
  where state = 'awaiting_confirmation' and milestone is null;
create index decision_records_matter_idx on public.decision_records (matter_id, created_at desc);
create index decision_records_org_fk_idx on public.decision_records (organization_id);
create index decision_records_matter_org_fk_idx on public.decision_records (matter_id, organization_id);
create index decision_records_corr_org_fk_idx on public.decision_records (correspondence_id, organization_id);
create index decision_records_confirmer_org_fk_idx on public.decision_records (confirmed_by_membership_id, organization_id);
create index decision_records_sharer_org_fk_idx on public.decision_records (shared_by_membership_id, organization_id);
create index decision_records_evidence_org_fk_idx on public.decision_records (stage_evidence_id, organization_id);
create index decision_records_created_by_idx on public.decision_records (created_by);

create trigger decision_records_touch before update on public.decision_records
  for each row execute function app.touch_row();
create trigger decision_records_keys before update on public.decision_records
  for each row execute function app.guard_tenant_keys();
create trigger decision_records_stamp before insert on public.decision_records
  for each row execute function app.stamp_created_by();
create trigger decision_records_guard before update or delete on public.decision_records
  for each row execute function app.gov_guard_update();
create trigger decision_records_audit after insert or update or delete on public.decision_records
  for each row execute function app.audit_row_change();

create table public.decision_follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  decision_id uuid not null,
  task_id uuid not null,
  kind public.decision_follow_up_kind not null,
  document_version_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  unique (task_id),
  check (kind <> 'expiry_reminder' or document_version_id is not null),
  foreign key (decision_id, organization_id) references public.decision_records (id, organization_id),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id),
  foreign key (document_version_id, organization_id) references public.document_versions (id, organization_id)
);
comment on table public.decision_follow_ups is
  'Post-decision work as ordinary tasks (DEC-02, DEC-03). An expiry reminder points at the document version whose expiry it follows.';

create unique index decision_follow_ups_expiry_uidx
  on public.decision_follow_ups (decision_id, document_version_id) where kind = 'expiry_reminder';
create index decision_follow_ups_org_fk_idx on public.decision_follow_ups (organization_id);
create index decision_follow_ups_decision_org_fk_idx on public.decision_follow_ups (decision_id, organization_id);
create index decision_follow_ups_task_org_fk_idx on public.decision_follow_ups (task_id, organization_id);
create index decision_follow_ups_version_org_fk_idx on public.decision_follow_ups (document_version_id, organization_id);
create index decision_follow_ups_created_by_idx on public.decision_follow_ups (created_by);

create trigger decision_follow_ups_stamp before insert on public.decision_follow_ups
  for each row execute function app.stamp_created_by();
create trigger decision_follow_ups_append_only before update or delete on public.decision_follow_ups
  for each row execute function app.gov_reject_mutation();
create trigger decision_follow_ups_audit after insert on public.decision_follow_ups
  for each row execute function app.audit_row_change();

create table public.decision_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  decision_id uuid not null,
  step public.decision_step not null,
  note text check (note is null or length(btrim(note)) between 1 and 500),
  done_by_membership_id uuid not null,
  done_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (id, organization_id),
  unique (decision_id, step),
  foreign key (decision_id, organization_id) references public.decision_records (id, organization_id),
  foreign key (done_by_membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.decision_steps is
  'Withdrawal playbook steps, each recorded once with who and when. Financial reconciliation is recorded here; money moves only through the finance functions.';

create index decision_steps_org_fk_idx on public.decision_steps (organization_id);
create index decision_steps_decision_org_fk_idx on public.decision_steps (decision_id, organization_id);
create index decision_steps_member_org_fk_idx on public.decision_steps (done_by_membership_id, organization_id);
create index decision_steps_created_by_idx on public.decision_steps (created_by);

create trigger decision_steps_stamp before insert on public.decision_steps
  for each row execute function app.stamp_created_by();
create trigger decision_steps_append_only before update or delete on public.decision_steps
  for each row execute function app.gov_reject_mutation();
create trigger decision_steps_audit after insert on public.decision_steps
  for each row execute function app.audit_row_change();

create function app.gov_follow_up(
  p_decision public.decision_records,
  p_kind public.decision_follow_up_kind,
  p_title text,
  p_owner uuid,
  p_priority public.task_priority,
  p_due_on date,
  p_version_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_id uuid;
begin
  task_id := app.create_task(
    p_decision.matter_id, 'internal', left(p_title, 200), p_owner, null, p_priority,
    p_due_on, null, null, null, null, '[]'::jsonb
  );
  insert into public.decision_follow_ups (organization_id, decision_id, task_id, kind, document_version_id)
  values (p_decision.organization_id, p_decision.id, task_id, p_kind, p_version_id);
  return task_id;
end;
$$;
revoke all on function app.gov_follow_up(public.decision_records, public.decision_follow_up_kind, text, uuid, public.task_priority, date, uuid) from public;

-- Staff record what the letter says. A refusal opens an urgent consultant review at once (PRD §6).
create function app.record_decision(
  p_correspondence_id uuid,
  p_outcome public.matter_outcome,
  p_milestone public.decision_milestone,
  p_decided_on date,
  p_authority_reasons text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  letter public.government_correspondence%rowtype;
  matter public.matters%rowtype;
  decision public.decision_records%rowtype;
  owner uuid;
begin
  select * into letter from public.government_correspondence where id = p_correspondence_id;
  if letter.id is null or app.can_read_matter(letter.matter_id) is distinct from true then
    raise exception 'decision denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    letter.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if letter.kind is distinct from 'decision' or letter.verified_at is null then
    raise exception 'a decision is recorded from a verified decision letter' using errcode = '42501';
  end if;
  if p_outcome is null then
    raise exception 'choose the outcome the letter states' using errcode = '22023';
  end if;
  if p_milestone is not null and p_outcome is distinct from 'approved' then
    raise exception 'approval milestones belong to an approval' using errcode = '22023';
  end if;
  if p_decided_on is not null and p_decided_on > current_date then
    raise exception 'the decision date cannot be in the future' using errcode = '22023';
  end if;
  select * into matter from public.matters where id = letter.matter_id;
  insert into public.decision_records (
    organization_id, matter_id, correspondence_id, outcome, milestone, decided_on, authority_reasons
  ) values (
    letter.organization_id, letter.matter_id, letter.id, p_outcome, p_milestone, p_decided_on,
    nullif(btrim(coalesce(p_authority_reasons, '')), '')
  )
  returning * into decision;
  if p_outcome = 'refused' then
    owner := coalesce(matter.responsible_consultant_membership_id, app.gov_actor_membership(matter.organization_id));
    perform app.gov_follow_up(decision, 'refusal_review', 'Urgent: consultant review of refusal', owner, 'critical', current_date, null);
  end if;
  perform app.record_audit_event(
    letter.organization_id, 'decision.recorded', 'public.decision_records', decision.id, 'success',
    jsonb_build_object('matter_id', letter.matter_id, 'outcome', p_outcome, 'milestone', p_milestone)
  );
  return decision.id;
end;
$$;
revoke all on function app.record_decision(uuid, public.matter_outcome, public.decision_milestone, date, text) from public;

-- A licensed consultant confirms the outcome and reviewed next steps (DEC-01). The matter's
-- outcome follows; the post-decision stage gets its entry evidence; the playbook tasks open.
create function app.confirm_decision(
  p_decision_id uuid,
  p_expected_version integer,
  p_consultant_interpretation text,
  p_next_steps text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision public.decision_records%rowtype;
  matter public.matters%rowtype;
  evidence uuid;
  owner uuid;
  new_version integer;
begin
  if p_next_steps is null or length(btrim(p_next_steps)) not between 3 and 4000 then
    raise exception 'write the reviewed next steps' using errcode = '22023';
  end if;
  select * into decision from public.decision_records where id = p_decision_id for update;
  if decision.id is null or app.can_read_matter(decision.matter_id) is distinct from true then
    raise exception 'decision confirmation denied' using errcode = '42501';
  end if;
  perform app.gov_require_licensed(decision.organization_id);
  if decision.version is distinct from p_expected_version then
    raise exception 'decision version conflict' using errcode = '40001';
  end if;
  if decision.state is distinct from 'awaiting_confirmation' then
    raise exception 'this decision is already confirmed' using errcode = '42501';
  end if;
  select * into matter from public.matters where id = decision.matter_id for update;
  insert into public.matter_stage_evidence (organization_id, matter_id, kind, summary)
  values (
    decision.organization_id, decision.matter_id, 'outcome_and_follow_up',
    left('Consultant-confirmed ' || decision.outcome::text || '. Next steps: ' || btrim(p_next_steps), 500)
  )
  returning id into evidence;
  perform app.gov_open_write(decision.id);
  update public.decision_records
  set state = 'confirmed',
      consultant_interpretation = nullif(btrim(coalesce(p_consultant_interpretation, '')), ''),
      next_steps = btrim(p_next_steps),
      confirmed_by_membership_id = app.gov_actor_membership(decision.organization_id),
      confirmed_at = statement_timestamp(),
      stage_evidence_id = evidence
  where id = decision.id
  returning * into decision;
  perform app.gov_close_write(decision.id);
  new_version := decision.version;

  perform app.open_matter_column(matter.id, 'outcome');
  update public.matters set outcome = decision.outcome where id = matter.id;
  perform app.close_matter_column(matter.id);

  owner := coalesce(matter.responsible_consultant_membership_id, app.gov_actor_membership(matter.organization_id));
  if decision.outcome = 'approved' and not exists (
    select 1 from public.decision_follow_ups follow
    join public.decision_records other on other.id = follow.decision_id
    where other.matter_id = matter.id and follow.kind = 'conditions_summary'
  ) then
    perform app.gov_follow_up(decision, 'conditions_summary', 'Send consultant-approved conditions summary to the client', owner, 'normal', null, null);
    perform app.gov_follow_up(decision, 'document_delivery', 'Record document delivery', owner, 'normal', null, null);
    perform app.gov_follow_up(decision, 'closure_checklist', 'Closure checklist', owner, 'normal', null, null);
  elsif decision.outcome = 'refused' then
    perform app.gov_follow_up(decision, 'client_explanation', 'Explain the decision to the client', owner, 'high', null, null);
    perform app.gov_follow_up(decision, 'next_steps_meeting', 'Decide next steps with the client (new linked matter if any)', owner, 'high', null, null);
    perform app.gov_follow_up(decision, 'account_reconciliation', 'Reconcile the client account', owner, 'normal', null, null);
  elsif decision.outcome <> 'approved' then
    perform app.gov_follow_up(decision, 'client_explanation', 'Explain the outcome to the client', owner, 'high', null, null);
    perform app.gov_follow_up(decision, 'account_reconciliation', 'Reconcile the client account', owner, 'normal', null, null);
    perform app.gov_follow_up(decision, 'closure_checklist', 'Closure checklist', owner, 'normal', null, null);
  end if;

  perform app.record_audit_event(
    decision.organization_id, 'decision.confirmed', 'public.decision_records', decision.id, 'success',
    jsonb_build_object('matter_id', matter.id, 'outcome', decision.outcome, 'milestone', decision.milestone, 'stage_evidence_id', evidence)
  );
  return new_version;
end;
$$;
revoke all on function app.confirm_decision(uuid, integer, text, text) from public;

-- An expiry or renewal reminder as an internal task (DEC-02, T039). The firm chooses the due
-- date; it cannot be after the expiry it follows. Nothing is sent to the client from here.
create function app.add_expiry_reminder(
  p_decision_id uuid,
  p_document_version_id uuid,
  p_due_on date,
  p_owner_membership_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision public.decision_records%rowtype;
  doc_purpose text;
  expiry date;
begin
  select * into decision from public.decision_records where id = p_decision_id;
  if decision.id is null or app.can_read_matter(decision.matter_id) is distinct from true then
    raise exception 'reminder denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(
    decision.organization_id,
    array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
    false
  );
  if decision.state is distinct from 'confirmed' then
    raise exception 'follow-ups start after the consultant confirms the decision' using errcode = '42501';
  end if;
  if app.gov_evidence_on_matter(p_document_version_id, decision.matter_id, decision.organization_id) is distinct from true then
    raise exception 'the document must be a stored file on this matter' using errcode = '42501';
  end if;
  select version.expires_on, doc.purpose into expiry, doc_purpose
  from public.document_versions version
  join public.documents doc on doc.id = version.document_id
  where version.id = p_document_version_id;
  if expiry is null then
    raise exception 'that document has no recorded expiry' using errcode = '22023';
  end if;
  if p_due_on is null or p_due_on > expiry then
    raise exception 'the reminder is due on or before the expiry date' using errcode = '22023';
  end if;
  return app.gov_follow_up(
    decision, 'expiry_reminder',
    'Renewal review: ' || left(doc_purpose, 120) || ' expires ' || to_char(expiry, 'YYYY-MM-DD'),
    coalesce(p_owner_membership_id, app.gov_actor_membership(decision.organization_id)),
    'normal', p_due_on, p_document_version_id
  );
end;
$$;
revoke all on function app.add_expiry_reminder(uuid, uuid, date, uuid) from public;

create function app.record_decision_step(p_decision_id uuid, p_step public.decision_step, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  decision public.decision_records%rowtype;
  new_id uuid;
begin
  select * into decision from public.decision_records where id = p_decision_id;
  if decision.id is null or app.can_read_matter(decision.matter_id) is distinct from true then
    raise exception 'step denied' using errcode = '42501';
  end if;
  if decision.outcome is distinct from 'withdrawn' then
    raise exception 'these steps belong to a withdrawal' using errcode = '22023';
  end if;
  if p_step = 'consultant_review' then
    perform app.gov_require_licensed(decision.organization_id);
  else
    perform app.require_active_staff(
      decision.organization_id,
      array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[],
      false
    );
  end if;
  insert into public.decision_steps (organization_id, decision_id, step, note, done_by_membership_id)
  values (
    decision.organization_id, decision.id, p_step, nullif(btrim(coalesce(p_note, '')), ''),
    app.gov_actor_membership(decision.organization_id)
  )
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function app.record_decision_step(uuid, public.decision_step, text) from public;

-- The firm shares a verified letter or a confirmed decision with the matter's clients (GOV-05).
create function app.share_government_record(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  matter_id uuid;
  ready boolean;
begin
  if p_kind = 'correspondence' then
    select letter.organization_id, letter.matter_id, letter.verified_at is not null
      into org, matter_id, ready
    from public.government_correspondence letter where letter.id = p_id;
  elsif p_kind = 'decision' then
    select decision.organization_id, decision.matter_id, decision.state = 'confirmed'
      into org, matter_id, ready
    from public.decision_records decision where decision.id = p_id;
  else
    raise exception 'share a letter or a decision' using errcode = '22023';
  end if;
  if org is null or app.can_read_matter(matter_id) is distinct from true then
    raise exception 'share denied' using errcode = '42501';
  end if;
  perform app.require_active_staff(org, array['firm_owner', 'licensed_consultant']::public.org_role[], true);
  if ready is distinct from true then
    raise exception 'only a verified letter or a confirmed decision is shared' using errcode = '42501';
  end if;
  perform app.gov_open_write(p_id);
  if p_kind = 'correspondence' then
    update public.government_correspondence
    set shared_with_client_at = statement_timestamp(), shared_by_membership_id = app.gov_actor_membership(org)
    where id = p_id and shared_with_client_at is null;
  else
    update public.decision_records
    set shared_with_client_at = statement_timestamp(), shared_by_membership_id = app.gov_actor_membership(org)
    where id = p_id and shared_with_client_at is null;
  end if;
  perform app.gov_close_write(p_id);
  perform app.record_audit_event(
    org, 'government.shared_with_client', case when p_kind = 'decision' then 'public.decision_records' else 'public.government_correspondence' end,
    p_id, 'success', jsonb_build_object('matter_id', matter_id)
  );
end;
$$;
revoke all on function app.share_government_record(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- Invoker wrappers (the definer bodies enforce role, scope, step-up, and licence)
-- ---------------------------------------------------------------------------
create function public.prepare_submission_handoff(p_matter_id uuid, p_package_label text, p_package_sha256 text, p_channel public.submission_channel)
returns uuid language sql security invoker set search_path = ''
as $$ select app.prepare_submission_handoff(p_matter_id, p_package_label, p_package_sha256, p_channel); $$;

create function public.sign_off_submission_handoff(p_handoff_id uuid, p_expected_version integer)
returns integer language sql security invoker set search_path = ''
as $$ select app.sign_off_submission_handoff(p_handoff_id, p_expected_version); $$;

create function public.record_submission(
  p_handoff_id uuid, p_expected_version integer, p_external_reference text, p_submitted_at timestamptz,
  p_submitted_by_membership_id uuid, p_receipt_version_id uuid, p_receipt_locator text, p_acknowledged_on date
)
returns integer language sql security invoker set search_path = ''
as $$
  select app.record_submission(
    p_handoff_id, p_expected_version, p_external_reference, p_submitted_at,
    p_submitted_by_membership_id, p_receipt_version_id, p_receipt_locator, p_acknowledged_on
  );
$$;

create function public.verify_submission_receipt(
  p_handoff_id uuid, p_expected_version integer, p_receipt_version_id uuid, p_receipt_locator text, p_acknowledged_on date
)
returns integer language sql security invoker set search_path = ''
as $$ select app.verify_submission_receipt(p_handoff_id, p_expected_version, p_receipt_version_id, p_receipt_locator, p_acknowledged_on); $$;

create function public.cancel_submission_handoff(p_handoff_id uuid, p_expected_version integer, p_reason text)
returns integer language sql security invoker set search_path = ''
as $$ select app.cancel_submission_handoff(p_handoff_id, p_expected_version, p_reason); $$;

create function public.record_government_correspondence(
  p_matter_id uuid, p_kind public.correspondence_kind, p_issuer text, p_channel public.correspondence_channel,
  p_document_date date, p_received_on date, p_action_requested text, p_stated_deadline text,
  p_reference_text text, p_evidence_version_id uuid, p_evidence_locator text, p_corrects_id uuid
)
returns uuid language sql security invoker set search_path = ''
as $$
  select app.record_government_correspondence(
    p_matter_id, p_kind, p_issuer, p_channel, p_document_date, p_received_on, p_action_requested,
    p_stated_deadline, p_reference_text, p_evidence_version_id, p_evidence_locator, p_corrects_id
  );
$$;

create function public.verify_government_correspondence(p_correspondence_id uuid, p_expected_version integer)
returns integer language sql security invoker set search_path = ''
as $$ select app.verify_government_correspondence(p_correspondence_id, p_expected_version); $$;

create function public.link_correspondence_work(p_correspondence_id uuid, p_deadline_id uuid, p_task_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select app.link_correspondence_work(p_correspondence_id, p_deadline_id, p_task_id); $$;

create function public.record_government_check(p_matter_id uuid, p_note text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.record_government_check(p_matter_id, p_note); $$;

create function public.record_decision(
  p_correspondence_id uuid, p_outcome public.matter_outcome, p_milestone public.decision_milestone,
  p_decided_on date, p_authority_reasons text
)
returns uuid language sql security invoker set search_path = ''
as $$ select app.record_decision(p_correspondence_id, p_outcome, p_milestone, p_decided_on, p_authority_reasons); $$;

create function public.confirm_decision(p_decision_id uuid, p_expected_version integer, p_consultant_interpretation text, p_next_steps text)
returns integer language sql security invoker set search_path = ''
as $$ select app.confirm_decision(p_decision_id, p_expected_version, p_consultant_interpretation, p_next_steps); $$;

create function public.add_expiry_reminder(p_decision_id uuid, p_document_version_id uuid, p_due_on date, p_owner_membership_id uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select app.add_expiry_reminder(p_decision_id, p_document_version_id, p_due_on, p_owner_membership_id); $$;

create function public.record_decision_step(p_decision_id uuid, p_step public.decision_step, p_note text)
returns uuid language sql security invoker set search_path = ''
as $$ select app.record_decision_step(p_decision_id, p_step, p_note); $$;

create function public.share_government_record(p_kind text, p_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select app.share_government_record(p_kind, p_id); $$;

revoke all on function public.prepare_submission_handoff(uuid, text, text, public.submission_channel) from public, anon;
revoke all on function public.sign_off_submission_handoff(uuid, integer) from public, anon;
revoke all on function public.record_submission(uuid, integer, text, timestamptz, uuid, uuid, text, date) from public, anon;
revoke all on function public.verify_submission_receipt(uuid, integer, uuid, text, date) from public, anon;
revoke all on function public.cancel_submission_handoff(uuid, integer, text) from public, anon;
revoke all on function public.record_government_correspondence(uuid, public.correspondence_kind, text, public.correspondence_channel, date, date, text, text, text, uuid, text, uuid) from public, anon;
revoke all on function public.verify_government_correspondence(uuid, integer) from public, anon;
revoke all on function public.link_correspondence_work(uuid, uuid, uuid) from public, anon;
revoke all on function public.record_government_check(uuid, text) from public, anon;
revoke all on function public.record_decision(uuid, public.matter_outcome, public.decision_milestone, date, text) from public, anon;
revoke all on function public.confirm_decision(uuid, integer, text, text) from public, anon;
revoke all on function public.add_expiry_reminder(uuid, uuid, date, uuid) from public, anon;
revoke all on function public.record_decision_step(uuid, public.decision_step, text) from public, anon;
revoke all on function public.share_government_record(text, uuid) from public, anon;

grant execute on function public.prepare_submission_handoff(uuid, text, text, public.submission_channel) to authenticated, service_role;
grant execute on function public.sign_off_submission_handoff(uuid, integer) to authenticated, service_role;
grant execute on function public.record_submission(uuid, integer, text, timestamptz, uuid, uuid, text, date) to authenticated, service_role;
grant execute on function public.verify_submission_receipt(uuid, integer, uuid, text, date) to authenticated, service_role;
grant execute on function public.cancel_submission_handoff(uuid, integer, text) to authenticated, service_role;
grant execute on function public.record_government_correspondence(uuid, public.correspondence_kind, text, public.correspondence_channel, date, date, text, text, text, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.verify_government_correspondence(uuid, integer) to authenticated, service_role;
grant execute on function public.link_correspondence_work(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.record_government_check(uuid, text) to authenticated, service_role;
grant execute on function public.record_decision(uuid, public.matter_outcome, public.decision_milestone, date, text) to authenticated, service_role;
grant execute on function public.confirm_decision(uuid, integer, text, text) to authenticated, service_role;
grant execute on function public.add_expiry_reminder(uuid, uuid, date, uuid) to authenticated, service_role;
grant execute on function public.record_decision_step(uuid, public.decision_step, text) to authenticated, service_role;
grant execute on function public.share_government_record(text, uuid) to authenticated, service_role;

grant execute on function app.prepare_submission_handoff(uuid, text, text, public.submission_channel) to authenticated, service_role;
grant execute on function app.sign_off_submission_handoff(uuid, integer) to authenticated, service_role;
grant execute on function app.record_submission(uuid, integer, text, timestamptz, uuid, uuid, text, date) to authenticated, service_role;
grant execute on function app.verify_submission_receipt(uuid, integer, uuid, text, date) to authenticated, service_role;
grant execute on function app.cancel_submission_handoff(uuid, integer, text) to authenticated, service_role;
grant execute on function app.record_government_correspondence(uuid, public.correspondence_kind, text, public.correspondence_channel, date, date, text, text, text, uuid, text, uuid) to authenticated, service_role;
grant execute on function app.verify_government_correspondence(uuid, integer) to authenticated, service_role;
grant execute on function app.link_correspondence_work(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function app.record_government_check(uuid, text) to authenticated, service_role;
grant execute on function app.record_decision(uuid, public.matter_outcome, public.decision_milestone, date, text) to authenticated, service_role;
grant execute on function app.confirm_decision(uuid, integer, text, text) to authenticated, service_role;
grant execute on function app.add_expiry_reminder(uuid, uuid, date, uuid) to authenticated, service_role;
grant execute on function app.record_decision_step(uuid, public.decision_step, text) to authenticated, service_role;
grant execute on function app.share_government_record(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges and row-level security. Reads only; every write is a function above.
-- ---------------------------------------------------------------------------
revoke all on table public.submission_handoffs from public, anon, authenticated;
revoke all on table public.government_correspondence from public, anon, authenticated;
revoke all on table public.correspondence_work_links from public, anon, authenticated;
revoke all on table public.government_status_checks from public, anon, authenticated;
revoke all on table public.decision_records from public, anon, authenticated;
revoke all on table public.decision_follow_ups from public, anon, authenticated;
revoke all on table public.decision_steps from public, anon, authenticated;
grant select on table public.submission_handoffs to authenticated;
grant select on table public.government_correspondence to authenticated;
grant select on table public.correspondence_work_links to authenticated;
grant select on table public.government_status_checks to authenticated;
grant select on table public.decision_records to authenticated;
grant select on table public.decision_follow_ups to authenticated;
grant select on table public.decision_steps to authenticated;

alter table public.submission_handoffs enable row level security;
alter table public.submission_handoffs force row level security;
alter table public.government_correspondence enable row level security;
alter table public.government_correspondence force row level security;
alter table public.correspondence_work_links enable row level security;
alter table public.correspondence_work_links force row level security;
alter table public.government_status_checks enable row level security;
alter table public.government_status_checks force row level security;
alter table public.decision_records enable row level security;
alter table public.decision_records force row level security;
alter table public.decision_follow_ups enable row level security;
alter table public.decision_follow_ups force row level security;
alter table public.decision_steps enable row level security;
alter table public.decision_steps force row level security;

create policy submission_handoffs_select on public.submission_handoffs
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.gov_staff_can_read(matter_id, organization_id))
  );

create policy government_correspondence_select on public.government_correspondence
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      (select app.gov_staff_can_read(matter_id, organization_id))
      or (shared_with_client_at is not null and (select app.gov_client_on_matter(matter_id, organization_id)))
    )
  );

create policy correspondence_work_links_select on public.correspondence_work_links
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.government_correspondence letter
      where letter.id = correspondence_work_links.correspondence_id
        and (select app.gov_staff_can_read(letter.matter_id, letter.organization_id))
    )
  );

create policy government_status_checks_select on public.government_status_checks
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.gov_staff_can_read(matter_id, organization_id))
  );

create policy decision_records_select on public.decision_records
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (
      (select app.gov_staff_can_read(matter_id, organization_id))
      or (
        state = 'confirmed'
        and shared_with_client_at is not null
        and (select app.gov_client_on_matter(matter_id, organization_id))
      )
    )
  );

create policy decision_follow_ups_select on public.decision_follow_ups
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.decision_records decision
      where decision.id = decision_follow_ups.decision_id
        and (select app.gov_staff_can_read(decision.matter_id, decision.organization_id))
    )
  );

create policy decision_steps_select on public.decision_steps
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.decision_records decision
      where decision.id = decision_steps.decision_id
        and (select app.gov_staff_can_read(decision.matter_id, decision.organization_id))
    )
  );
