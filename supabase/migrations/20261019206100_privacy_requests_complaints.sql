-- Privacy requests (SEC-05, SEC-06) and the firm complaints register (ADM-05). Additive only.
--
-- Privacy requests. Staff log a request a person made to the firm (access, correction, withdrawal of
-- consent, deletion), then record identity verification, the scope search, the third-party redaction
-- worklist (access requests), the review, and the outcome with its evidence. There is no client-side
-- submission: the Designer has no portal page for it. Requests are per firm: another firm handling the
-- same person never sees this one (SEC-06). Closing a login never erases the firm's record.
--   * The due date is a FIRM-CONFIGURED TARGET (compliance_settings.privacy_response_days), never a
--     statutory deadline: no statutory response time is encoded (docs/DECISIONS.md, 2026-10-18).
--   * A deletion request can only be refused (reason required) or withdrawn. Casevoya has no
--     record-destruction workflow (SEC-07), and never destroys records under a hold or still inside
--     the retention period; the matters that keep the person's records are snapshotted on the request
--     when it closes.
--   * Withdrawal of consent, when fulfilled for a chosen consent record, sets that record's
--     withdrawn_at (public.consent_records stays append-only). It starts an impact review; it does not
--     delete records the firm must keep (SEC-05).
--
-- Complaints (ADM-05). A register of complaints about the firm's professional service, separate from
-- Casevoya software support. Visible only to the firm owner and the staff the owner designates
-- (complaint_handlers). Received, acknowledged, reviewed (evidence), response sent, resolved. The
-- acknowledgement and response targets and the escalation path text are the firm's own settings;
-- none is invented here. Complaints and their evidence notes are never deleted.
--
-- Settings (compliance_settings) are changed by the firm owner after a step-up. Every write goes
-- through a security definer function with an audit event that names ids and steps only (no request
-- text). Reads are row-level secured and forced.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.compliance_settings (
  organization_id uuid primary key references public.organizations (id),
  privacy_response_days integer check (privacy_response_days is null or privacy_response_days between 1 and 365),
  complaint_ack_days integer check (complaint_ack_days is null or complaint_ack_days between 1 and 60),
  complaint_response_days integer check (complaint_response_days is null or complaint_response_days between 1 and 365),
  complaint_escalation_text text check (complaint_escalation_text is null or length(btrim(complaint_escalation_text)) between 3 and 2000),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1)
);
comment on table public.compliance_settings is
  'Firm-configured targets for privacy requests and complaints, and the complaint escalation path text the firm supplies. Targets are internal, not statutory deadlines.';

create index compliance_settings_updated_by_idx on public.compliance_settings (updated_by);
create index compliance_settings_created_by_idx on public.compliance_settings (created_by);

create table public.complaint_handlers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  membership_id uuid not null,
  added_by uuid references auth.users (id),
  removed_at timestamptz,
  removed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id),
  check ((removed_at is null) = (removed_by is null))
);
comment on table public.complaint_handlers is
  'Staff the firm owner designates to see and handle the complaints register (ADM-05). A removal is kept as removed_at.';

create unique index complaint_handlers_active_idx on public.complaint_handlers (organization_id, membership_id) where removed_at is null;
create index complaint_handlers_membership_fk_idx on public.complaint_handlers (membership_id, organization_id);
create index complaint_handlers_added_by_idx on public.complaint_handlers (added_by);
create index complaint_handlers_removed_by_idx on public.complaint_handlers (removed_by);
create index complaint_handlers_created_by_idx on public.complaint_handlers (created_by);

create table public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  number integer not null check (number >= 1),
  reference text not null check (reference ~ '^PR-[0-9]{3,}$'),
  kind public.privacy_request_kind not null,
  requester_name text not null check (length(btrim(requester_name)) between 1 and 200),
  person_id uuid,
  matter_id uuid,
  details text not null check (length(btrim(details)) between 3 and 2000),
  channel public.compliance_channel not null,
  received_on date not null,
  -- The firm's own target, copied when the request is recorded. Null when the firm has none.
  target_days integer check (target_days is null or target_days between 1 and 365),
  due_on date,
  assignee_membership_id uuid not null,
  identity_verified_at timestamptz,
  identity_verified_by uuid references auth.users (id),
  identity_method text check (identity_method is null or length(btrim(identity_method)) between 3 and 500),
  scope_at timestamptz,
  scope_by uuid references auth.users (id),
  scope_note text check (scope_note is null or length(btrim(scope_note)) between 3 and 2000),
  redaction_at timestamptz,
  redaction_by uuid references auth.users (id),
  redaction_note text check (redaction_note is null or length(btrim(redaction_note)) between 3 and 2000),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  review_note text check (review_note is null or length(btrim(review_note)) between 3 and 2000),
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  outcome public.privacy_request_outcome,
  outcome_note text check (outcome_note is null or length(btrim(outcome_note)) between 3 and 2000),
  refusal_reason text check (refusal_reason is null or length(btrim(refusal_reason)) between 3 and 2000),
  delivery_method text check (delivery_method is null or length(btrim(delivery_method)) between 3 and 200),
  evidence_note text check (evidence_note is null or length(btrim(evidence_note)) between 3 and 2000),
  consent_record_id uuid,
  -- Matters that keep the person's records, as they stood when a deletion request closed.
  kept_records jsonb check (kept_records is null or jsonb_typeof(kept_records) = 'array'),
  is_sample boolean not null default false,
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, number),
  unique (organization_id, idempotency_key),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (assignee_membership_id, organization_id) references public.memberships (id, organization_id),
  foreign key (consent_record_id, organization_id) references public.consent_records (id, organization_id),
  check ((closed_at is null) = (outcome is null)),
  check ((closed_at is null) = (closed_by is null)),
  check (outcome is distinct from 'refused' or refusal_reason is not null),
  check (kind <> 'deletion' or outcome is null or outcome in ('refused', 'withdrawn')),
  check (outcome not in ('fulfilled', 'partly_fulfilled') or (identity_verified_at is not null and reviewed_at is not null)),
  check (kind = 'access' or redaction_at is null),
  check (consent_record_id is null or kind = 'consent_withdrawal'),
  check ((due_on is null) = (target_days is null)),
  check (due_on is null or due_on = received_on + target_days)
);
comment on table public.privacy_requests is
  'Privacy requests a person made to this firm (SEC-05, SEC-06): identity verification, scope, third-party redaction, review, outcome and evidence. due_on is a firm-configured target, not a statutory deadline. Never deleted.';

create index privacy_requests_org_received_idx on public.privacy_requests (organization_id, received_on desc);
create index privacy_requests_person_fk_idx on public.privacy_requests (person_id, organization_id);
create index privacy_requests_matter_fk_idx on public.privacy_requests (matter_id, organization_id);
create index privacy_requests_assignee_fk_idx on public.privacy_requests (assignee_membership_id, organization_id);
create index privacy_requests_consent_fk_idx on public.privacy_requests (consent_record_id, organization_id);
create index privacy_requests_identity_by_idx on public.privacy_requests (identity_verified_by);
create index privacy_requests_scope_by_idx on public.privacy_requests (scope_by);
create index privacy_requests_redaction_by_idx on public.privacy_requests (redaction_by);
create index privacy_requests_reviewed_by_idx on public.privacy_requests (reviewed_by);
create index privacy_requests_closed_by_idx on public.privacy_requests (closed_by);
create index privacy_requests_created_by_idx on public.privacy_requests (created_by);

create table public.privacy_request_redactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  request_id uuid not null,
  record_label text not null check (length(btrim(record_label)) between 1 and 200),
  third_party text not null check (length(btrim(third_party)) between 1 and 200),
  removed text not null check (length(btrim(removed)) between 1 and 500),
  state public.privacy_redaction_state not null default 'to_do',
  done_by uuid references auth.users (id),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  foreign key (request_id, organization_id) references public.privacy_requests (id, organization_id),
  check ((state = 'to_do') = (done_at is null)),
  check ((done_at is null) = (done_by is null))
);
comment on table public.privacy_request_redactions is
  'The third-party redaction worklist of an access request (SEC-06): which record, whose information, what is removed, and who did it.';

create index privacy_request_redactions_request_fk_idx on public.privacy_request_redactions (request_id, organization_id);
create index privacy_request_redactions_done_by_idx on public.privacy_request_redactions (done_by);
create index privacy_request_redactions_created_by_idx on public.privacy_request_redactions (created_by);

create table public.complaints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  number integer not null check (number >= 1),
  reference text not null check (reference ~ '^CP-[0-9]{3,}$'),
  complainant_name text not null check (length(btrim(complainant_name)) between 1 and 200),
  person_id uuid,
  matter_id uuid,
  category public.complaint_category not null,
  channel public.compliance_channel not null,
  issue text not null check (length(btrim(issue)) between 3 and 2000),
  received_on date not null,
  -- The firm's own targets, copied when the complaint is recorded. Null when the firm has none.
  ack_due_on date,
  response_due_on date,
  assignee_membership_id uuid not null,
  acknowledged_on date,
  acknowledged_by uuid references auth.users (id),
  ack_note text check (ack_note is null or length(btrim(ack_note)) between 3 and 2000),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  evidence_note text check (evidence_note is null or length(btrim(evidence_note)) between 3 and 2000),
  response_sent_on date,
  response_by uuid references auth.users (id),
  response_note text check (response_note is null or length(btrim(response_note)) between 3 and 2000),
  resolved_on date,
  resolved_by uuid references auth.users (id),
  resolution text check (resolution is null or length(btrim(resolution)) between 3 and 2000),
  is_sample boolean not null default false,
  idempotency_key text not null check (length(idempotency_key) between 8 and 180),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, number),
  unique (organization_id, idempotency_key),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (assignee_membership_id, organization_id) references public.memberships (id, organization_id),
  check ((acknowledged_on is null) = (acknowledged_by is null)),
  check ((reviewed_at is null) = (reviewed_by is null)),
  check ((response_sent_on is null) = (response_by is null)),
  check ((resolved_on is null) = (resolved_by is null)),
  check ((resolved_on is null) = (resolution is null)),
  check (acknowledged_on is null or acknowledged_on >= received_on),
  check (response_sent_on is null or response_sent_on >= received_on),
  check (resolved_on is null or resolved_on >= received_on)
);
comment on table public.complaints is
  'The firm complaints register (ADM-05): complaints about the firm''s professional service, not Casevoya software support. Visible to the firm owner and designated handlers. Never deleted.';

create index complaints_org_received_idx on public.complaints (organization_id, received_on desc);
create index complaints_person_fk_idx on public.complaints (person_id, organization_id);
create index complaints_matter_fk_idx on public.complaints (matter_id, organization_id);
create index complaints_assignee_fk_idx on public.complaints (assignee_membership_id, organization_id);
create index complaints_acknowledged_by_idx on public.complaints (acknowledged_by);
create index complaints_reviewed_by_idx on public.complaints (reviewed_by);
create index complaints_response_by_idx on public.complaints (response_by);
create index complaints_resolved_by_idx on public.complaints (resolved_by);
create index complaints_created_by_idx on public.complaints (created_by);

-- ---------------------------------------------------------------------------
-- Guards: keys never change, nothing is deleted. Writes come only from the functions below.
-- ---------------------------------------------------------------------------

create trigger compliance_settings_touch before update on public.compliance_settings
  for each row execute function app.touch_row();
create trigger compliance_settings_stamp before insert on public.compliance_settings
  for each row execute function app.stamp_created_by();
create trigger compliance_settings_no_delete before delete on public.compliance_settings
  for each row execute function app.reject_governed_delete();

create trigger complaint_handlers_touch before update on public.complaint_handlers
  for each row execute function app.touch_row();
create trigger complaint_handlers_keys before update on public.complaint_handlers
  for each row execute function app.guard_tenant_keys();
create trigger complaint_handlers_stamp before insert on public.complaint_handlers
  for each row execute function app.stamp_created_by();
create trigger complaint_handlers_no_delete before delete on public.complaint_handlers
  for each row execute function app.reject_governed_delete();

create trigger privacy_requests_touch before update on public.privacy_requests
  for each row execute function app.touch_row();
create trigger privacy_requests_keys before update on public.privacy_requests
  for each row execute function app.guard_tenant_keys();
create trigger privacy_requests_stamp before insert on public.privacy_requests
  for each row execute function app.stamp_created_by();
create trigger privacy_requests_no_delete before delete on public.privacy_requests
  for each row execute function app.reject_governed_delete();

create trigger privacy_request_redactions_touch before update on public.privacy_request_redactions
  for each row execute function app.touch_row();
create trigger privacy_request_redactions_keys before update on public.privacy_request_redactions
  for each row execute function app.guard_tenant_keys();
create trigger privacy_request_redactions_stamp before insert on public.privacy_request_redactions
  for each row execute function app.stamp_created_by();
create trigger privacy_request_redactions_no_delete before delete on public.privacy_request_redactions
  for each row execute function app.reject_governed_delete();

create trigger complaints_touch before update on public.complaints
  for each row execute function app.touch_row();
create trigger complaints_keys before update on public.complaints
  for each row execute function app.guard_tenant_keys();
create trigger complaints_stamp before insert on public.complaints
  for each row execute function app.stamp_created_by();
create trigger complaints_no_delete before delete on public.complaints
  for each row execute function app.reject_governed_delete();

-- ---------------------------------------------------------------------------
-- Who may see and handle what
-- ---------------------------------------------------------------------------

-- Staff who may log and work privacy requests: the firm owner, licensed consultants and case
-- managers, at aal2, in the active firm.
create function app.privacy_staff(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and app.staff_mfa_satisfied()
     and app.has_org_role(p_org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]);
$$;
revoke all on function app.privacy_staff(uuid) from public, anon;
grant execute on function app.privacy_staff(uuid) to authenticated;

-- True when the membership is the signed-in user's own, active, in that firm.
create function app.is_own_membership(p_org uuid, p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.id = p_membership_id
      and m.organization_id = p_org
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;
revoke all on function app.is_own_membership(uuid, uuid) from public, anon;
grant execute on function app.is_own_membership(uuid, uuid) to authenticated;

-- A privacy request is visible to the firm owner, its assignee, and (consultant scope) a licensed
-- consultant or case manager who can read the person it is about. Other firms never see it.
create function app.can_read_privacy_request(p_org uuid, p_person_id uuid, p_assignee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and app.staff_mfa_satisfied()
     and (
       app.actor_is_firm_owner(p_org)
       or app.is_own_membership(p_org, p_assignee)
       or (
         p_person_id is not null
         and app.has_org_role(p_org, array['licensed_consultant', 'case_manager']::public.org_role[])
         and app.can_read_person(p_person_id)
       )
     );
$$;
revoke all on function app.can_read_privacy_request(uuid, uuid, uuid) from public, anon;
grant execute on function app.can_read_privacy_request(uuid, uuid, uuid) to authenticated;

-- Working a request (steps, redactions, closing): the firm owner or the assignee.
create function app.can_work_privacy_request(p_org uuid, p_assignee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.privacy_staff(p_org)
     and (app.actor_is_firm_owner(p_org) or app.is_own_membership(p_org, p_assignee));
$$;
revoke all on function app.can_work_privacy_request(uuid, uuid) from public, anon;
grant execute on function app.can_work_privacy_request(uuid, uuid) to authenticated;

-- The complaints register: the firm owner and the staff the owner designated, at aal2.
create function app.is_complaint_handler(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and app.staff_mfa_satisfied()
     and (
       app.actor_is_firm_owner(p_org)
       or exists (
         select 1
         from public.complaint_handlers h
         join public.memberships m on m.id = h.membership_id and m.organization_id = h.organization_id
         where h.organization_id = p_org
           and h.removed_at is null
           and m.user_id = (select auth.uid())
           and m.status = 'active'
           and m.role = any (app.staff_roles())
       )
     );
$$;
revoke all on function app.is_complaint_handler(uuid) from public, anon;
grant execute on function app.is_complaint_handler(uuid) to authenticated;

-- A membership that may be assigned a complaint: an active staff member who is the owner or a handler.
create function app.complaint_assignable(p_org uuid, p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.id = p_membership_id
      and m.organization_id = p_org
      and m.status = 'active'
      and (
        m.role = 'firm_owner'
        or (
          m.role = any (app.staff_roles())
          and exists (
            select 1 from public.complaint_handlers h
            where h.organization_id = p_org and h.membership_id = m.id and h.removed_at is null
          )
        )
      )
  );
$$;
revoke all on function app.complaint_assignable(uuid, uuid) from public, anon;
grant execute on function app.complaint_assignable(uuid, uuid) to authenticated;

-- The firm's today, in its own time zone.
create function app.compliance_today(p_org uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select app.firm_local_date(p_org, statement_timestamp());
$$;
revoke all on function app.compliance_today(uuid) from public, anon;
grant execute on function app.compliance_today(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Settings (firm owner, step-up)
-- ---------------------------------------------------------------------------

create function app.set_compliance_settings(
  p_org uuid,
  p_privacy_response_days integer,
  p_complaint_ack_days integer,
  p_complaint_response_days integer,
  p_complaint_escalation_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  escalation text := nullif(btrim(coalesce(p_complaint_escalation_text, '')), '');
begin
  perform app.require_firm_owner_step_up(p_org);
  if p_privacy_response_days is not null and p_privacy_response_days not between 1 and 365 then
    raise exception 'the privacy target must be between 1 and 365 days' using errcode = '22023';
  end if;
  if p_complaint_ack_days is not null and p_complaint_ack_days not between 1 and 60 then
    raise exception 'the acknowledgement target must be between 1 and 60 days' using errcode = '22023';
  end if;
  if p_complaint_response_days is not null and p_complaint_response_days not between 1 and 365 then
    raise exception 'the response target must be between 1 and 365 days' using errcode = '22023';
  end if;
  if escalation is not null and length(escalation) not between 3 and 2000 then
    raise exception 'the escalation path must be 3 to 2000 characters' using errcode = '22023';
  end if;
  insert into public.compliance_settings as s (
    organization_id, privacy_response_days, complaint_ack_days, complaint_response_days, complaint_escalation_text, updated_by
  ) values (
    p_org, p_privacy_response_days, p_complaint_ack_days, p_complaint_response_days, escalation, (select auth.uid())
  )
  on conflict (organization_id) do update
    set privacy_response_days = excluded.privacy_response_days,
        complaint_ack_days = excluded.complaint_ack_days,
        complaint_response_days = excluded.complaint_response_days,
        complaint_escalation_text = excluded.complaint_escalation_text,
        updated_by = excluded.updated_by;
  perform app.record_audit_event(
    p_org, 'compliance.settings_changed', 'public.compliance_settings', null, 'success',
    jsonb_build_object(
      'privacy_response_days', p_privacy_response_days,
      'complaint_ack_days', p_complaint_ack_days,
      'complaint_response_days', p_complaint_response_days,
      'escalation_text_set', escalation is not null
    )
  );
end;
$$;
revoke all on function app.set_compliance_settings(uuid, integer, integer, integer, text) from public, anon;
grant execute on function app.set_compliance_settings(uuid, integer, integer, integer, text) to authenticated;

-- Replaces the designated complaint handlers with p_membership_ids (active staff of the firm).
create function app.set_complaint_handlers(p_org uuid, p_membership_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_membership_ids, array[]::uuid[])) x where x is not null), array[]::uuid[]);
  actor uuid := (select auth.uid());
  bad integer;
  added integer;
  removed integer;
begin
  perform app.require_firm_owner_step_up(p_org);
  if cardinality(wanted) > 50 then
    raise exception 'too many handlers' using errcode = '22023';
  end if;
  select count(*) into bad
  from unnest(wanted) as w(id)
  where not exists (
    select 1 from public.memberships m
    where m.id = w.id and m.organization_id = p_org and m.status = 'active' and m.role = any (app.staff_roles())
  );
  if bad > 0 then
    raise exception 'handlers must be active staff of this firm' using errcode = '22023';
  end if;
  update public.complaint_handlers
  set removed_at = clock_timestamp(), removed_by = actor
  where organization_id = p_org and removed_at is null and not (membership_id = any (wanted));
  get diagnostics removed = row_count;
  insert into public.complaint_handlers (organization_id, membership_id, added_by)
  select p_org, w.id, actor
  from unnest(wanted) as w(id)
  where not exists (
    select 1 from public.complaint_handlers h
    where h.organization_id = p_org and h.membership_id = w.id and h.removed_at is null
  );
  get diagnostics added = row_count;
  perform app.record_audit_event(
    p_org, 'complaints.handlers_changed', 'public.complaint_handlers', null, 'success',
    jsonb_build_object('handlers', to_jsonb(wanted), 'added', added, 'removed', removed)
  );
  return cardinality(wanted);
end;
$$;
revoke all on function app.set_complaint_handlers(uuid, uuid[]) from public, anon;
grant execute on function app.set_complaint_handlers(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Privacy requests
-- ---------------------------------------------------------------------------

-- The person's matters that keep their records: open, on hold, or closed with a retention date not yet
-- reached (or none recorded). Read-only; callers check access.
create function app.privacy_kept_records(p_org uuid, p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'matter_id', matter.id,
           'reference', coalesce(matter.reference, matter.title),
           'reason', case
             when matter.on_hold then 'on_hold'
             when matter.stage <> 'closed' then 'open'
             when matter.retention_on is null then 'retention_unset'
             else 'retention'
           end,
           'retention_on', matter.retention_on
         ) order by matter.reference nulls last, matter.title), '[]'::jsonb)
  from public.matters matter
  where matter.organization_id = p_org
    and p_person_id is not null
    and exists (
      select 1 from public.matter_participants mp
      where mp.matter_id = matter.id and mp.organization_id = p_org and mp.person_id = p_person_id
    )
    and (
      matter.on_hold
      or matter.stage <> 'closed'
      or matter.retention_on is null
      or matter.retention_on > app.compliance_today(p_org)
    );
$$;
revoke all on function app.privacy_kept_records(uuid, uuid) from public, anon, authenticated;

create function app.record_privacy_request(
  p_org uuid,
  p_kind text,
  p_requester_name text,
  p_person_id uuid,
  p_matter_id uuid,
  p_details text,
  p_channel text,
  p_received_on date,
  p_assignee_membership_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text := btrim(coalesce(p_idempotency_key, ''));
  name text := btrim(coalesce(p_requester_name, ''));
  body text := btrim(coalesce(p_details, ''));
  existing public.privacy_requests%rowtype;
  days integer;
  next_number integer;
  sample boolean;
  rid uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if app.privacy_staff(p_org) is distinct from true then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select * into existing from public.privacy_requests where organization_id = p_org and idempotency_key = key;
  if existing.id is not null then
    return existing.id;
  end if;
  if p_kind is null or p_kind not in ('access', 'correction', 'consent_withdrawal', 'deletion') then
    raise exception 'choose the kind of request' using errcode = '22023';
  end if;
  if p_channel is null or p_channel not in ('email', 'phone', 'letter', 'in_person', 'portal', 'other') then
    raise exception 'choose how the request arrived' using errcode = '22023';
  end if;
  if length(name) not between 1 and 200 then
    raise exception 'the requester''s name is required' using errcode = '22023';
  end if;
  if length(body) not between 3 and 2000 then
    raise exception 'describe the request in 3 to 2000 characters' using errcode = '22023';
  end if;
  if p_received_on is null or p_received_on > app.compliance_today(p_org) then
    raise exception 'the received date can''t be in the future' using errcode = '22023';
  end if;
  if p_received_on < app.compliance_today(p_org) - 3650 then
    raise exception 'the received date is too far in the past' using errcode = '22023';
  end if;
  if p_person_id is not null and not (
    exists (select 1 from public.persons p where p.id = p_person_id and p.organization_id = p_org)
    and (app.actor_is_firm_owner(p_org) or app.can_read_person(p_person_id))
  ) then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  if p_matter_id is not null and not (
    exists (select 1 from public.matters m where m.id = p_matter_id and m.organization_id = p_org)
    and app.can_read_matter(p_matter_id)
  ) then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.id = p_assignee_membership_id and m.organization_id = p_org and m.status = 'active'
      and m.role = any (array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[])
  ) then
    raise exception 'choose who handles the request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('privacy_requests:' || p_org::text, 0));
  select coalesce(max(r.number), 0) + 1 into next_number from public.privacy_requests r where r.organization_id = p_org;
  select s.privacy_response_days into days from public.compliance_settings s where s.organization_id = p_org;
  select org.sample_mode into sample from public.organizations org where org.id = p_org;

  insert into public.privacy_requests (
    organization_id, number, reference, kind, requester_name, person_id, matter_id, details, channel,
    received_on, target_days, due_on, assignee_membership_id, is_sample, idempotency_key
  ) values (
    p_org, next_number, 'PR-' || lpad(next_number::text, 3, '0'), p_kind::public.privacy_request_kind, name,
    p_person_id, p_matter_id, body, p_channel::public.compliance_channel,
    p_received_on, days, case when days is null then null else p_received_on + days end,
    p_assignee_membership_id, coalesce(sample, false), key
  )
  returning id into rid;
  perform app.record_audit_event(
    p_org, 'privacy.request_recorded', 'public.privacy_requests', rid, 'success',
    jsonb_build_object('kind', p_kind, 'person_id', p_person_id, 'matter_id', p_matter_id, 'received_on', p_received_on,
                       'due_on', case when days is null then null else p_received_on + days end, 'assignee_membership_id', p_assignee_membership_id)
  );
  return rid;
end;
$$;
revoke all on function app.record_privacy_request(uuid, text, text, uuid, uuid, text, text, date, uuid, text) from public, anon;
grant execute on function app.record_privacy_request(uuid, text, text, uuid, uuid, text, text, date, uuid, text) to authenticated;

-- Records one step of an open request, in order: identity, scope, redaction (access only), review.
create function app.record_privacy_step(p_request_id uuid, p_step text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.privacy_requests%rowtype;
  note text := btrim(coalesce(p_note, ''));
  actor uuid := (select auth.uid());
begin
  select * into req from public.privacy_requests where id = p_request_id;
  if req.id is null or app.can_work_privacy_request(req.organization_id, req.assignee_membership_id) is distinct from true then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  select * into req from public.privacy_requests where id = req.id for update;
  if req.closed_at is not null then
    raise exception 'this request is closed' using errcode = '22023';
  end if;
  if length(note) not between 3 and 2000 then
    raise exception 'add a note of 3 to 2000 characters' using errcode = '22023';
  end if;
  if p_step = 'identity' then
    if req.identity_verified_at is not null then
      raise exception 'identity is already recorded' using errcode = '22023';
    end if;
    if length(note) > 500 then
      raise exception 'describe how identity was checked in 500 characters or fewer' using errcode = '22023';
    end if;
    update public.privacy_requests
    set identity_verified_at = clock_timestamp(), identity_verified_by = actor, identity_method = note
    where id = req.id;
  elsif p_step = 'scope' then
    if req.identity_verified_at is null then
      raise exception 'verify identity first' using errcode = '22023';
    end if;
    if req.scope_at is not null then
      raise exception 'the scope is already recorded' using errcode = '22023';
    end if;
    update public.privacy_requests set scope_at = clock_timestamp(), scope_by = actor, scope_note = note where id = req.id;
  elsif p_step = 'redaction' then
    if req.kind <> 'access' then
      raise exception 'only an access request has a redaction step' using errcode = '22023';
    end if;
    if req.scope_at is null then
      raise exception 'record the scope search first' using errcode = '22023';
    end if;
    if req.redaction_at is not null then
      raise exception 'the redaction step is already recorded' using errcode = '22023';
    end if;
    if exists (select 1 from public.privacy_request_redactions r where r.request_id = req.id and r.state = 'to_do') then
      raise exception 'finish every line of the redaction worklist first' using errcode = '22023';
    end if;
    update public.privacy_requests set redaction_at = clock_timestamp(), redaction_by = actor, redaction_note = note where id = req.id;
  elsif p_step = 'review' then
    if req.scope_at is null then
      raise exception 'record the scope search first' using errcode = '22023';
    end if;
    if req.kind = 'access' and req.redaction_at is null then
      raise exception 'finish the redaction step first' using errcode = '22023';
    end if;
    if req.reviewed_at is not null then
      raise exception 'the review is already recorded' using errcode = '22023';
    end if;
    update public.privacy_requests set reviewed_at = clock_timestamp(), reviewed_by = actor, review_note = note where id = req.id;
  else
    raise exception 'unknown step' using errcode = '22023';
  end if;
  perform app.record_audit_event(
    req.organization_id, 'privacy.request_step', 'public.privacy_requests', req.id, 'success',
    jsonb_build_object('step', p_step, 'kind', req.kind)
  );
end;
$$;
revoke all on function app.record_privacy_step(uuid, text, text) from public, anon;
grant execute on function app.record_privacy_step(uuid, text, text) to authenticated;

-- Adds a line to an open access request's redaction worklist, or (p_redaction_id) changes its state.
create function app.save_privacy_redaction(
  p_request_id uuid,
  p_redaction_id uuid,
  p_record_label text,
  p_third_party text,
  p_removed text,
  p_state text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.privacy_requests%rowtype;
  line public.privacy_request_redactions%rowtype;
  label text := btrim(coalesce(p_record_label, ''));
  party text := btrim(coalesce(p_third_party, ''));
  what text := btrim(coalesce(p_removed, ''));
  rid uuid;
begin
  select * into req from public.privacy_requests where id = p_request_id;
  if req.id is null or app.can_work_privacy_request(req.organization_id, req.assignee_membership_id) is distinct from true then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  select * into req from public.privacy_requests where id = req.id for update;
  if req.kind <> 'access' then
    raise exception 'only an access request has a redaction worklist' using errcode = '22023';
  end if;
  if req.closed_at is not null or req.redaction_at is not null then
    raise exception 'the redaction worklist is closed' using errcode = '22023';
  end if;
  if p_state is null or p_state not in ('to_do', 'redacted', 'excluded', 'kept') then
    raise exception 'choose a state' using errcode = '22023';
  end if;
  if p_redaction_id is null then
    if length(label) not between 1 and 200 or length(party) not between 1 and 200 or length(what) not between 1 and 500 then
      raise exception 'name the record, the third party and what is removed' using errcode = '22023';
    end if;
    insert into public.privacy_request_redactions (organization_id, request_id, record_label, third_party, removed, state, done_by, done_at)
    values (
      req.organization_id, req.id, label, party, what, p_state::public.privacy_redaction_state,
      case when p_state = 'to_do' then null else (select auth.uid()) end,
      case when p_state = 'to_do' then null else clock_timestamp() end
    )
    returning id into rid;
  else
    select * into line from public.privacy_request_redactions where id = p_redaction_id and request_id = req.id for update;
    if line.id is null then
      raise exception 'privacy request access denied' using errcode = '42501';
    end if;
    update public.privacy_request_redactions
    set state = p_state::public.privacy_redaction_state,
        done_by = case when p_state = 'to_do' then null else (select auth.uid()) end,
        done_at = case when p_state = 'to_do' then null else clock_timestamp() end
    where id = line.id;
    rid := line.id;
  end if;
  perform app.record_audit_event(
    req.organization_id, 'privacy.redaction_saved', 'public.privacy_request_redactions', rid, 'success',
    jsonb_build_object('request_id', req.id, 'state', p_state)
  );
  return rid;
end;
$$;
revoke all on function app.save_privacy_redaction(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function app.save_privacy_redaction(uuid, uuid, text, text, text, text) to authenticated;

-- Closes a request with its outcome and evidence, after a step-up. A deletion request needs the firm
-- owner and can only be refused (reason) or withdrawn. A fulfilled withdrawal of consent withdraws the
-- chosen consent record.
create function app.close_privacy_request(
  p_request_id uuid,
  p_outcome text,
  p_outcome_note text,
  p_refusal_reason text,
  p_delivery_method text,
  p_evidence_note text,
  p_consent_record_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.privacy_requests%rowtype;
  consent public.consent_records%rowtype;
  note text := nullif(btrim(coalesce(p_outcome_note, '')), '');
  refusal text := nullif(btrim(coalesce(p_refusal_reason, '')), '');
  delivery text := nullif(btrim(coalesce(p_delivery_method, '')), '');
  evidence text := nullif(btrim(coalesce(p_evidence_note, '')), '');
  kept jsonb;
begin
  select * into req from public.privacy_requests where id = p_request_id;
  if req.id is null or app.can_work_privacy_request(req.organization_id, req.assignee_membership_id) is distinct from true then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  if req.kind = 'deletion' then
    perform app.require_firm_owner_step_up(req.organization_id);
  elsif app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'step-up is required' using errcode = '42501';
  end if;
  select * into req from public.privacy_requests where id = req.id for update;
  if req.closed_at is not null then
    raise exception 'this request is closed' using errcode = '22023';
  end if;
  if p_outcome is null or p_outcome not in ('fulfilled', 'partly_fulfilled', 'refused', 'withdrawn') then
    raise exception 'choose an outcome' using errcode = '22023';
  end if;
  if req.kind = 'deletion' and p_outcome not in ('refused', 'withdrawn') then
    raise exception 'records are never deleted here: refuse the deletion with a reason, or record it withdrawn' using errcode = '22023';
  end if;
  if p_outcome = 'refused' and (refusal is null or length(refusal) < 3) then
    raise exception 'a refusal needs a reason' using errcode = '22023';
  end if;
  if p_outcome in ('fulfilled', 'partly_fulfilled') and (req.identity_verified_at is null or req.reviewed_at is null) then
    raise exception 'verify identity and record the review first' using errcode = '22023';
  end if;
  if p_outcome in ('fulfilled', 'partly_fulfilled') and (evidence is null or length(evidence) < 3) then
    raise exception 'record the evidence of what was done' using errcode = '22023';
  end if;
  if (note is not null and length(note) not between 3 and 2000)
     or (refusal is not null and length(refusal) > 2000)
     or (evidence is not null and length(evidence) > 2000)
     or (delivery is not null and length(delivery) not between 3 and 200) then
    raise exception 'a note is too short or too long' using errcode = '22023';
  end if;
  if p_consent_record_id is not null then
    if req.kind <> 'consent_withdrawal' or p_outcome not in ('fulfilled', 'partly_fulfilled') then
      raise exception 'a consent is withdrawn only by a fulfilled withdrawal request' using errcode = '22023';
    end if;
    select * into consent from public.consent_records
    where id = p_consent_record_id and organization_id = req.organization_id for update;
    if consent.id is null or req.person_id is null or consent.person_id <> req.person_id then
      raise exception 'that consent isn''t this person''s' using errcode = '22023';
    end if;
    if consent.granted is not true or consent.withdrawn_at is not null then
      raise exception 'that consent isn''t active' using errcode = '22023';
    end if;
    update public.consent_records set withdrawn_at = clock_timestamp() where id = consent.id;
  end if;
  if req.kind = 'deletion' then
    kept := app.privacy_kept_records(req.organization_id, req.person_id);
  end if;
  update public.privacy_requests
  set closed_at = clock_timestamp(),
      closed_by = (select auth.uid()),
      outcome = p_outcome::public.privacy_request_outcome,
      outcome_note = note,
      refusal_reason = case when p_outcome = 'refused' then refusal else null end,
      delivery_method = delivery,
      evidence_note = evidence,
      consent_record_id = p_consent_record_id,
      kept_records = kept
  where id = req.id;
  perform app.record_audit_event(
    req.organization_id, 'privacy.request_closed', 'public.privacy_requests', req.id, 'success',
    jsonb_build_object(
      'kind', req.kind, 'outcome', p_outcome, 'consent_record_id', p_consent_record_id,
      'kept_matters', case when kept is null then null else jsonb_array_length(kept) end
    )
  );
end;
$$;
revoke all on function app.close_privacy_request(uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function app.close_privacy_request(uuid, text, text, text, text, text, uuid) to authenticated;

-- What keeps an open deletion request's person's records (for the page), for whoever can read the request.
create function app.privacy_request_kept_records(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  req public.privacy_requests%rowtype;
begin
  select * into req from public.privacy_requests where id = p_request_id;
  if req.id is null or app.can_read_privacy_request(req.organization_id, req.person_id, req.assignee_membership_id) is distinct from true then
    raise exception 'privacy request access denied' using errcode = '42501';
  end if;
  if req.kept_records is not null then
    return req.kept_records;
  end if;
  return app.privacy_kept_records(req.organization_id, req.person_id);
end;
$$;
revoke all on function app.privacy_request_kept_records(uuid) from public, anon;
grant execute on function app.privacy_request_kept_records(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Complaints
-- ---------------------------------------------------------------------------

create function app.record_complaint(
  p_org uuid,
  p_complainant_name text,
  p_person_id uuid,
  p_matter_id uuid,
  p_category text,
  p_channel text,
  p_issue text,
  p_received_on date,
  p_assignee_membership_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text := btrim(coalesce(p_idempotency_key, ''));
  name text := btrim(coalesce(p_complainant_name, ''));
  body text := btrim(coalesce(p_issue, ''));
  existing public.complaints%rowtype;
  settings public.compliance_settings%rowtype;
  next_number integer;
  sample boolean;
  cid uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if app.is_complaint_handler(p_org) is distinct from true then
    raise exception 'complaints access denied' using errcode = '42501';
  end if;
  if length(key) not between 8 and 180 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  select * into existing from public.complaints where organization_id = p_org and idempotency_key = key;
  if existing.id is not null then
    return existing.id;
  end if;
  if length(name) not between 1 and 200 then
    raise exception 'the complainant''s name is required' using errcode = '22023';
  end if;
  if length(body) not between 3 and 2000 then
    raise exception 'describe the issue in 3 to 2000 characters' using errcode = '22023';
  end if;
  if p_category is null or p_category not in ('fees_billing', 'communication', 'service_quality', 'conduct', 'privacy', 'other') then
    raise exception 'choose a category' using errcode = '22023';
  end if;
  if p_channel is null or p_channel not in ('email', 'phone', 'letter', 'in_person', 'portal', 'other') then
    raise exception 'choose how the complaint arrived' using errcode = '22023';
  end if;
  if p_received_on is null or p_received_on > app.compliance_today(p_org) then
    raise exception 'the received date can''t be in the future' using errcode = '22023';
  end if;
  if p_received_on < app.compliance_today(p_org) - 3650 then
    raise exception 'the received date is too far in the past' using errcode = '22023';
  end if;
  if p_person_id is not null and not exists (select 1 from public.persons p where p.id = p_person_id and p.organization_id = p_org) then
    raise exception 'complaints access denied' using errcode = '42501';
  end if;
  if p_matter_id is not null and not exists (select 1 from public.matters m where m.id = p_matter_id and m.organization_id = p_org) then
    raise exception 'complaints access denied' using errcode = '42501';
  end if;
  if app.complaint_assignable(p_org, p_assignee_membership_id) is distinct from true then
    raise exception 'choose a complaint handler' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('complaints:' || p_org::text, 0));
  select coalesce(max(c.number), 0) + 1 into next_number from public.complaints c where c.organization_id = p_org;
  select * into settings from public.compliance_settings s where s.organization_id = p_org;
  select org.sample_mode into sample from public.organizations org where org.id = p_org;

  insert into public.complaints (
    organization_id, number, reference, complainant_name, person_id, matter_id, category, channel, issue,
    received_on, ack_due_on, response_due_on, assignee_membership_id, is_sample, idempotency_key
  ) values (
    p_org, next_number, 'CP-' || lpad(next_number::text, 3, '0'), name, p_person_id, p_matter_id,
    p_category::public.complaint_category, p_channel::public.compliance_channel, body, p_received_on,
    case when settings.complaint_ack_days is null then null else p_received_on + settings.complaint_ack_days end,
    case when settings.complaint_response_days is null then null else p_received_on + settings.complaint_response_days end,
    p_assignee_membership_id, coalesce(sample, false), key
  )
  returning id into cid;
  perform app.record_audit_event(
    p_org, 'complaints.recorded', 'public.complaints', cid, 'success',
    jsonb_build_object('category', p_category, 'channel', p_channel, 'person_id', p_person_id, 'matter_id', p_matter_id,
                       'received_on', p_received_on, 'assignee_membership_id', p_assignee_membership_id)
  );
  return cid;
end;
$$;
revoke all on function app.record_complaint(uuid, text, uuid, uuid, text, text, text, date, uuid, text) from public, anon;
grant execute on function app.record_complaint(uuid, text, uuid, uuid, text, text, text, date, uuid, text) to authenticated;

-- Records one milestone, in order: acknowledge, review (evidence), respond, resolve (step-up).
create function app.record_complaint_step(p_complaint_id uuid, p_step text, p_on date, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.complaints%rowtype;
  note text := btrim(coalesce(p_note, ''));
  actor uuid := (select auth.uid());
  today date;
begin
  select * into c from public.complaints where id = p_complaint_id;
  if c.id is null or app.is_complaint_handler(c.organization_id) is distinct from true then
    raise exception 'complaints access denied' using errcode = '42501';
  end if;
  select * into c from public.complaints where id = c.id for update;
  today := app.compliance_today(c.organization_id);
  if c.resolved_on is not null then
    raise exception 'this complaint is resolved' using errcode = '22023';
  end if;
  if p_step in ('acknowledge', 'respond', 'resolve') and (p_on is null or p_on > today or p_on < c.received_on) then
    raise exception 'the date must be between the received date and today' using errcode = '22023';
  end if;
  if p_step = 'acknowledge' then
    if c.acknowledged_on is not null then
      raise exception 'the acknowledgement is already recorded' using errcode = '22023';
    end if;
    if note <> '' and length(note) not between 3 and 2000 then
      raise exception 'a note is too short or too long' using errcode = '22023';
    end if;
    update public.complaints set acknowledged_on = p_on, acknowledged_by = actor, ack_note = nullif(note, '') where id = c.id;
  elsif p_step = 'review' then
    if c.acknowledged_on is null then
      raise exception 'record the acknowledgement first' using errcode = '22023';
    end if;
    if c.reviewed_at is not null then
      raise exception 'the review is already recorded' using errcode = '22023';
    end if;
    if length(note) not between 3 and 2000 then
      raise exception 'list the evidence reviewed' using errcode = '22023';
    end if;
    update public.complaints set reviewed_at = clock_timestamp(), reviewed_by = actor, evidence_note = note where id = c.id;
  elsif p_step = 'respond' then
    if c.reviewed_at is null then
      raise exception 'record the review first' using errcode = '22023';
    end if;
    if c.response_sent_on is not null then
      raise exception 'the response is already recorded' using errcode = '22023';
    end if;
    if length(note) not between 3 and 2000 then
      raise exception 'summarize the response sent' using errcode = '22023';
    end if;
    update public.complaints set response_sent_on = p_on, response_by = actor, response_note = note where id = c.id;
  elsif p_step = 'resolve' then
    if app.mfa_step_up_satisfied() is distinct from true then
      raise exception 'step-up is required' using errcode = '42501';
    end if;
    if c.response_sent_on is null then
      raise exception 'record the response first' using errcode = '22023';
    end if;
    if length(note) not between 3 and 2000 then
      raise exception 'record the resolution' using errcode = '22023';
    end if;
    update public.complaints set resolved_on = p_on, resolved_by = actor, resolution = note where id = c.id;
  else
    raise exception 'unknown step' using errcode = '22023';
  end if;
  perform app.record_audit_event(
    c.organization_id, 'complaints.step', 'public.complaints', c.id, 'success',
    jsonb_build_object('step', p_step, 'on', p_on)
  );
end;
$$;
revoke all on function app.record_complaint_step(uuid, text, date, text) from public, anon;
grant execute on function app.record_complaint_step(uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Public wrappers. The database checks the caller; these stay security invoker.
-- ---------------------------------------------------------------------------

create function public.set_compliance_settings(
  p_org uuid, p_privacy_response_days integer, p_complaint_ack_days integer, p_complaint_response_days integer, p_complaint_escalation_text text
) returns void language sql security invoker set search_path = ''
as $$ select app.set_compliance_settings(p_org, p_privacy_response_days, p_complaint_ack_days, p_complaint_response_days, p_complaint_escalation_text); $$;

create function public.set_complaint_handlers(p_org uuid, p_membership_ids uuid[])
returns integer language sql security invoker set search_path = ''
as $$ select app.set_complaint_handlers(p_org, p_membership_ids); $$;

create function public.record_privacy_request(
  p_org uuid, p_kind text, p_requester_name text, p_person_id uuid, p_matter_id uuid, p_details text,
  p_channel text, p_received_on date, p_assignee_membership_id uuid, p_idempotency_key text
) returns uuid language sql security invoker set search_path = ''
as $$ select app.record_privacy_request(p_org, p_kind, p_requester_name, p_person_id, p_matter_id, p_details, p_channel, p_received_on, p_assignee_membership_id, p_idempotency_key); $$;

create function public.record_privacy_step(p_request_id uuid, p_step text, p_note text)
returns void language sql security invoker set search_path = ''
as $$ select app.record_privacy_step(p_request_id, p_step, p_note); $$;

create function public.save_privacy_redaction(
  p_request_id uuid, p_redaction_id uuid, p_record_label text, p_third_party text, p_removed text, p_state text
) returns uuid language sql security invoker set search_path = ''
as $$ select app.save_privacy_redaction(p_request_id, p_redaction_id, p_record_label, p_third_party, p_removed, p_state); $$;

create function public.close_privacy_request(
  p_request_id uuid, p_outcome text, p_outcome_note text, p_refusal_reason text, p_delivery_method text, p_evidence_note text, p_consent_record_id uuid
) returns void language sql security invoker set search_path = ''
as $$ select app.close_privacy_request(p_request_id, p_outcome, p_outcome_note, p_refusal_reason, p_delivery_method, p_evidence_note, p_consent_record_id); $$;

create function public.privacy_request_kept_records(p_request_id uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app.privacy_request_kept_records(p_request_id); $$;

create function public.record_complaint(
  p_org uuid, p_complainant_name text, p_person_id uuid, p_matter_id uuid, p_category text, p_channel text,
  p_issue text, p_received_on date, p_assignee_membership_id uuid, p_idempotency_key text
) returns uuid language sql security invoker set search_path = ''
as $$ select app.record_complaint(p_org, p_complainant_name, p_person_id, p_matter_id, p_category, p_channel, p_issue, p_received_on, p_assignee_membership_id, p_idempotency_key); $$;

create function public.record_complaint_step(p_complaint_id uuid, p_step text, p_on date, p_note text)
returns void language sql security invoker set search_path = ''
as $$ select app.record_complaint_step(p_complaint_id, p_step, p_on, p_note); $$;

revoke all on function public.set_compliance_settings(uuid, integer, integer, integer, text) from public, anon;
revoke all on function public.set_complaint_handlers(uuid, uuid[]) from public, anon;
revoke all on function public.record_privacy_request(uuid, text, text, uuid, uuid, text, text, date, uuid, text) from public, anon;
revoke all on function public.record_privacy_step(uuid, text, text) from public, anon;
revoke all on function public.save_privacy_redaction(uuid, uuid, text, text, text, text) from public, anon;
revoke all on function public.close_privacy_request(uuid, text, text, text, text, text, uuid) from public, anon;
revoke all on function public.privacy_request_kept_records(uuid) from public, anon;
revoke all on function public.record_complaint(uuid, text, uuid, uuid, text, text, text, date, uuid, text) from public, anon;
revoke all on function public.record_complaint_step(uuid, text, date, text) from public, anon;

grant execute on function public.set_compliance_settings(uuid, integer, integer, integer, text) to authenticated;
grant execute on function public.set_complaint_handlers(uuid, uuid[]) to authenticated;
grant execute on function public.record_privacy_request(uuid, text, text, uuid, uuid, text, text, date, uuid, text) to authenticated;
grant execute on function public.record_privacy_step(uuid, text, text) to authenticated;
grant execute on function public.save_privacy_redaction(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.close_privacy_request(uuid, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.privacy_request_kept_records(uuid) to authenticated;
grant execute on function public.record_complaint(uuid, text, uuid, uuid, text, text, text, date, uuid, text) to authenticated;
grant execute on function public.record_complaint_step(uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges and row-level security
-- ---------------------------------------------------------------------------

revoke all on table public.compliance_settings from anon, authenticated, service_role;
revoke all on table public.complaint_handlers from anon, authenticated, service_role;
revoke all on table public.privacy_requests from anon, authenticated, service_role;
revoke all on table public.privacy_request_redactions from anon, authenticated, service_role;
revoke all on table public.complaints from anon, authenticated, service_role;
grant select on table public.compliance_settings to authenticated;
grant select on table public.complaint_handlers to authenticated;
grant select on table public.privacy_requests to authenticated;
grant select on table public.privacy_request_redactions to authenticated;
grant select on table public.complaints to authenticated;

alter table public.compliance_settings enable row level security;
alter table public.compliance_settings force row level security;
alter table public.complaint_handlers enable row level security;
alter table public.complaint_handlers force row level security;
alter table public.privacy_requests enable row level security;
alter table public.privacy_requests force row level security;
alter table public.privacy_request_redactions enable row level security;
alter table public.privacy_request_redactions force row level security;
alter table public.complaints enable row level security;
alter table public.complaints force row level security;

-- The firm's targets and escalation text: any active staff member of the firm.
create policy compliance_settings_select on public.compliance_settings
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
  );

create policy complaint_handlers_select on public.complaint_handlers
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_complaint_handler(organization_id))
  );

create policy privacy_requests_select on public.privacy_requests
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and app.can_read_privacy_request(organization_id, person_id, assignee_membership_id)
  );

create policy privacy_request_redactions_select on public.privacy_request_redactions
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.privacy_requests req
      where req.id = privacy_request_redactions.request_id
        and req.organization_id = privacy_request_redactions.organization_id
        and app.can_read_privacy_request(req.organization_id, req.person_id, req.assignee_membership_id)
    )
  );

create policy complaints_select on public.complaints
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_complaint_handler(organization_id))
  );
