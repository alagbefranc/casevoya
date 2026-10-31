-- Lost two-step device: real reset requests (Francis, approved 2026-10-30 21:32 CDT).
--
-- Before this, public.request_mfa_reset only wrote an audit row with the length of the message:
-- no request, no owner email or notice, no expiry. Now:
--
--   public.mfa_reset_requests   one row per request: firm, who asked (and their role), the "What
--                               happened?" message, route (firm owners or Casevoya), status
--                               (pending, approved, denied, expired), created_at, expires_at
--                               (created_at + 24 hours), who decided and when, and when the
--                               person's second factors were removed.
--   public.request_mfa_reset    (signed in, aal1 is enough: the person lost their second factor)
--                               creates the request. One open request per person (a second call
--                               returns the open one, without a second email). At most 3 new
--                               requests an hour per person (app.request_windows, bucket MFA_RESET).
--                               Route "firm" when the firm has another active owner; otherwise
--                               (the only owner asks) route "platform": the Casevoya admin queue.
--                               Queues outbox mfa_reset.requested (EX21 to the other owners).
--   public.firm_mfa_resets      a firm owner's list (assured session), with each person's name and email.
--   public.decide_mfa_reset     a firm owner (assured session, not the person who asked) approves
--                               or denies a pending "firm" request. Expired requests are refused
--                               here, not only in the page. Approve retires the person's recovery
--                               codes and ends their sessions; the app server then removes their
--                               factors with the Auth admin API and calls complete_mfa_reset.
--   public.platform_mfa_resets / public.platform_decide_mfa_reset
--                               the same for Casevoya platform admins (service role, naming the
--                               acting admin, who must be in platform_admins and not the person).
--   public.complete_mfa_reset   (service role) after the factors were removed through the Auth admin
--                               API: removes anything left (passkeys, sessions) and stamps
--                               factors_cleared_at. Audited.
-- The outcome is emailed to the person (outbox mfa_reset.decided, EX22). Firm owners also see a
-- pending request in Notifications (kind mfa_reset).

create table public.mfa_reset_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  requester_user_id uuid not null references auth.users (id) on delete cascade,
  requester_role public.org_role not null,
  reason text check (reason is null or length(reason) <= 2000),
  route text not null check (route in ('firm', 'platform')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '24 hours',
  decided_at timestamptz,
  decided_by uuid references auth.users (id),
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  factors_cleared_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours 1 minute'),
  check ((status in ('approved', 'denied')) = (decided_at is not null and decided_by is not null)),
  check (decided_by is distinct from requester_user_id),
  check (factors_cleared_at is null or status = 'approved')
);
comment on table public.mfa_reset_requests is
  'Lost two-step device: a staff member asks to reset their second factor. Firm owners (route firm) or Casevoya platform admins (route platform, when the only owner asks) approve or deny within 24 hours. Written only by the request/decide functions.';

create unique index mfa_reset_requests_one_open on public.mfa_reset_requests (requester_user_id) where status = 'pending';
create index mfa_reset_requests_org_idx on public.mfa_reset_requests (organization_id, created_at desc);
create index mfa_reset_requests_route_idx on public.mfa_reset_requests (route, status, created_at desc);
create index mfa_reset_requests_decided_by_idx on public.mfa_reset_requests (decided_by);

alter table public.mfa_reset_requests enable row level security;
alter table public.mfa_reset_requests force row level security;
revoke all on table public.mfa_reset_requests from public, anon, authenticated, service_role;
grant select on table public.mfa_reset_requests to authenticated, service_role;

-- The person sees their own requests; a firm's owners (assured session) see the firm's "firm" route.
create policy mfa_reset_requests_select on public.mfa_reset_requests
  for select to authenticated
  using (
    requester_user_id = (select auth.uid())
    or (
      route = 'firm'
      and app.has_org_role(organization_id, array['firm_owner']::public.org_role[])
      and app.staff_mfa_satisfied()
    )
  );
create policy mfa_reset_requests_service on public.mfa_reset_requests
  for select to service_role
  using (true);

-- Pending requests past their 24 hours become expired (called by every function below).
create function app.expire_mfa_resets()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.mfa_reset_requests
     set status = 'expired'
   where status = 'pending'
     and expires_at <= clock_timestamp();
$$;
revoke all on function app.expire_mfa_resets() from public;

create function app.mfa_reset_outbox(p_req public.mfa_reset_requests, p_type text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.outbox_events (organization_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, created_by, request_id)
  values (
    p_req.organization_id, 'mfa_reset_request', p_req.id, p_type,
    jsonb_build_object('request_id', p_req.id, 'route', p_req.route, 'status', p_req.status),
    p_type || ':' || p_req.id::text, (select auth.uid()), app.current_request_id()
  )
  on conflict (organization_id, idempotency_key) do nothing;
$$;
revoke all on function app.mfa_reset_outbox(public.mfa_reset_requests, text) from public;

-- The request. Signed in at aal1 is enough. Returns the request id (the open one if there is one).
create or replace function public.request_mfa_reset(p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  mem record;
  open_id uuid;
  other_owner boolean;
  hits integer;
  win timestamptz;
  req public.mfa_reset_requests%rowtype;
  why text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if why is not null and length(why) > 2000 then
    raise exception 'reason is too long' using errcode = '22023';
  end if;

  select m.organization_id, m.role into mem
  from public.memberships m
  where m.user_id = uid
    and m.status = 'active'
    and m.role = any (app.staff_roles())
  order by (m.role = 'firm_owner') desc, m.created_at
  limit 1;
  if mem.organization_id is null then
    raise exception 'two-step reset requests are for firm staff' using errcode = '42501';
  end if;

  perform app.expire_mfa_resets();
  select r.id into open_id
  from public.mfa_reset_requests r
  where r.requester_user_id = uid and r.status = 'pending';
  if open_id is not null then
    return open_id;
  end if;

  -- At most 3 new requests an hour per person (same counters as public.request_window_hit).
  win := to_timestamp(floor(extract(epoch from now()) / 3600) * 3600);
  insert into app.request_windows as w (bucket, key_hash, window_start, hits)
  values ('MFA_RESET', encode(extensions.digest(convert_to('MFA_RESET:' || uid::text, 'utf8'), 'sha256'), 'hex'), win, 1)
  on conflict (bucket, key_hash, window_start) do update set hits = w.hits + 1
  returning w.hits into hits;
  if hits > 3 then
    raise exception 'too many reset requests' using errcode = 'P0429';
  end if;

  other_owner := exists (
    select 1 from public.memberships o
    where o.organization_id = mem.organization_id
      and o.role = 'firm_owner'
      and o.status = 'active'
      and o.user_id <> uid
  );

  insert into public.mfa_reset_requests (organization_id, requester_user_id, requester_role, reason, route)
  values (mem.organization_id, uid, mem.role, why, case when other_owner then 'firm' else 'platform' end)
  returning * into req;

  if req.route = 'firm' then
    perform app.mfa_reset_outbox(req, 'mfa_reset.requested');
  end if;
  perform app.record_audit_event(
    req.organization_id, 'mfa.reset_requested', 'public.mfa_reset_requests', req.id, 'success',
    jsonb_build_object('route', req.route, 'reason_length', coalesce(length(why), 0))
  );
  return req.id;
end;
$$;
revoke all on function public.request_mfa_reset(text) from public, anon;
grant execute on function public.request_mfa_reset(text) to authenticated, service_role;

-- What the person sees about their own latest request.
create function public.my_mfa_reset()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.mfa_reset_requests%rowtype;
begin
  if (select auth.uid()) is null then
    return null;
  end if;
  perform app.expire_mfa_resets();
  select * into r from public.mfa_reset_requests
  where requester_user_id = (select auth.uid())
  order by created_at desc limit 1;
  if r.id is null then
    return null;
  end if;
  return jsonb_build_object('id', r.id, 'route', r.route, 'status', r.status, 'created_at', r.created_at, 'expires_at', r.expires_at);
end;
$$;
revoke all on function public.my_mfa_reset() from public, anon;
grant execute on function public.my_mfa_reset() to authenticated;

-- Ends the person's sessions and retires their recovery codes (as app.reset_staff_mfa does).
create function app.mfa_reset_lockout(p_req public.mfa_reset_requests, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mfa_recovery_codes
     set retired_at = statement_timestamp()
   where user_id = p_req.requester_user_id
     and retired_at is null;

  insert into public.auth_session_cutoffs (user_id, sessions_valid_after)
  values (p_req.requester_user_id, clock_timestamp())
  on conflict (user_id) do update
    set sessions_valid_after = excluded.sessions_valid_after,
        updated_at = statement_timestamp();

  if to_regclass('auth.sessions') is not null then
    execute $sql$
      insert into public.session_revocations (user_id, session_id, revoked_by, organization_id, reason)
      select s.user_id, s.id, $2, $3, 'owner_reset'
      from auth.sessions s
      where s.user_id = $1
      on conflict (user_id, session_id) do nothing
    $sql$
    using p_req.requester_user_id, p_actor, p_req.organization_id;
  end if;
end;
$$;
revoke all on function app.mfa_reset_lockout(public.mfa_reset_requests, uuid) from public;

-- Shared decision step. p_actor already checked by the caller.
create function app.decide_mfa_reset(p_id uuid, p_approve boolean, p_note text, p_actor uuid, p_route text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.mfa_reset_requests%rowtype;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_approve is null then
    raise exception 'approve or deny' using errcode = '22023';
  end if;
  if note is not null and length(note) > 500 then
    raise exception 'a note is at most 500 characters' using errcode = '22023';
  end if;
  select * into r from public.mfa_reset_requests where id = p_id for update;
  if r.id is null or r.route is distinct from p_route then
    raise exception 'reset request not found' using errcode = '42501';
  end if;
  if r.requester_user_id = p_actor then
    raise exception 'you cannot approve your own reset request' using errcode = '42501';
  end if;
  if r.status = 'pending' and r.expires_at <= clock_timestamp() then
    -- Refused, not raised, so the expired status is kept (a raise would roll it back).
    update public.mfa_reset_requests set status = 'expired' where id = r.id;
    return jsonb_build_object('id', r.id, 'status', 'expired', 'refused', 'expired', 'requester_user_id', r.requester_user_id);
  end if;
  if r.status = 'expired' then
    return jsonb_build_object('id', r.id, 'status', 'expired', 'refused', 'expired', 'requester_user_id', r.requester_user_id);
  end if;
  if r.status <> 'pending' then
    raise exception 'this reset request was already %', r.status using errcode = 'P0409';
  end if;

  update public.mfa_reset_requests
     set status = case when p_approve then 'approved' else 'denied' end,
         decided_at = clock_timestamp(),
         decided_by = p_actor,
         decision_note = note
   where id = r.id
  returning * into r;

  if p_approve then
    perform app.mfa_reset_lockout(r, p_actor);
  end if;
  perform app.mfa_reset_outbox(r, 'mfa_reset.decided');
  perform app.record_audit_event(
    r.organization_id, case when p_approve then 'mfa.reset_approved' else 'mfa.reset_denied' end,
    'public.mfa_reset_requests', r.id, 'success',
    jsonb_build_object('route', r.route, 'requester_user_id', r.requester_user_id, 'decided_by', p_actor)
  );
  return jsonb_build_object('id', r.id, 'status', r.status, 'requester_user_id', r.requester_user_id);
end;
$$;
revoke all on function app.decide_mfa_reset(uuid, boolean, text, uuid, text) from public;

-- A firm owner (assured session) decides a "firm" request of their firm.
create function public.decide_mfa_reset(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  org uuid;
begin
  if actor is null or app.staff_mfa_satisfied() is distinct from true then
    raise exception 'two-step reset decisions need an assured session' using errcode = '42501';
  end if;
  perform app.expire_mfa_resets();
  select organization_id into org from public.mfa_reset_requests where id = p_id;
  if org is null
     or app.in_active_org(org) is distinct from true
     or app.has_org_role(org, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'reset request not found' using errcode = '42501';
  end if;
  return app.decide_mfa_reset(p_id, p_approve, p_note, actor, 'firm');
end;
$$;
revoke all on function public.decide_mfa_reset(uuid, boolean, text) from public, anon;
grant execute on function public.decide_mfa_reset(uuid, boolean, text) to authenticated;

-- A firm owner's list of their firm's requests (newest first), with each person's name and email.
create function public.firm_mfa_resets(p_org uuid)
returns table (
  id uuid, requester_user_id uuid, requester_name text, requester_email text, requester_role text,
  reason text, status text, created_at timestamptz, expires_at timestamptz, decided_at timestamptz,
  decided_by_name text, factors_cleared_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or app.staff_mfa_satisfied() is distinct from true
     or app.in_active_org(p_org) is distinct from true
     or app.has_org_role(p_org, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'firm owner access denied' using errcode = '42501';
  end if;
  perform app.expire_mfa_resets();
  return query
  select r.id, r.requester_user_id, prof.display_name, u.email::text, r.requester_role::text,
         r.reason, r.status, r.created_at, r.expires_at, r.decided_at, dprof.display_name, r.factors_cleared_at
  from public.mfa_reset_requests r
  left join auth.users u on u.id = r.requester_user_id
  left join public.profiles prof on prof.id = r.requester_user_id
  left join public.profiles dprof on dprof.id = r.decided_by
  where r.organization_id = p_org and r.route = 'firm'
  order by (r.status = 'pending') desc, r.created_at desc
  limit 100;
end;
$$;
revoke all on function public.firm_mfa_resets(uuid) from public, anon;
grant execute on function public.firm_mfa_resets(uuid) to authenticated;

-- Casevoya admin queue (service role, admin portal). Lists route "platform" (or every route with p_all).
create function public.platform_mfa_resets(p_state text default 'pending', p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  items jsonb;
  counts jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_state is not null and p_state not in ('pending', 'closed') then
    raise exception 'state is pending or closed' using errcode = '22023';
  end if;
  perform app.expire_mfa_resets();
  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) into items
  from (
    select r.id, r.organization_id, org.display_name as firm_name, r.requester_user_id,
           prof.display_name as requester_name, u.email as requester_email, r.requester_role, r.reason,
           r.status, r.created_at, r.expires_at, r.decided_at, r.decided_by, r.factors_cleared_at
    from public.mfa_reset_requests r
    join public.organizations org on org.id = r.organization_id
    left join auth.users u on u.id = r.requester_user_id
    left join public.profiles prof on prof.id = r.requester_user_id
    where r.route = 'platform'
      and (p_state is null or (p_state = 'pending') = (r.status = 'pending'))
    order by r.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  ) x;
  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'closed', count(*) filter (where status <> 'pending')
  ) into counts
  from public.mfa_reset_requests where route = 'platform';
  return jsonb_build_object('items', items, 'counts', counts);
end;
$$;
revoke all on function public.platform_mfa_resets(text, integer, integer) from public, anon, authenticated;
grant execute on function public.platform_mfa_resets(text, integer, integer) to service_role;

create function public.platform_decide_mfa_reset(p_id uuid, p_approve boolean, p_note text, p_admin_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_admin_user_id is null or not exists (select 1 from public.platform_admins p where p.user_id = p_admin_user_id) then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  perform app.expire_mfa_resets();
  return app.decide_mfa_reset(p_id, p_approve, p_note, p_admin_user_id, 'platform');
end;
$$;
revoke all on function public.platform_decide_mfa_reset(uuid, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.platform_decide_mfa_reset(uuid, boolean, text, uuid) to service_role;

-- After the server removed the factors through the Auth admin API: remove anything left and stamp it.
create function public.complete_mfa_reset(p_id uuid, p_factors_removed integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.mfa_reset_requests%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into r from public.mfa_reset_requests where id = p_id for update;
  if r.id is null or r.status <> 'approved' then
    raise exception 'only an approved request is completed' using errcode = '42501';
  end if;
  if r.factors_cleared_at is not null then
    return;
  end if;
  perform app.purge_auth_user_factors(r.requester_user_id);
  update public.mfa_reset_requests set factors_cleared_at = clock_timestamp() where id = r.id;
  perform app.record_audit_event(
    r.organization_id, 'mfa.reset_factors_removed', 'public.mfa_reset_requests', r.id, 'success',
    jsonb_build_object('requester_user_id', r.requester_user_id, 'factors_removed', greatest(coalesce(p_factors_removed, 0), 0))
  );
end;
$$;
revoke all on function public.complete_mfa_reset(uuid, integer) from public, anon, authenticated;
grant execute on function public.complete_mfa_reset(uuid, integer) to service_role;

-- Mail: claim and prepare the two new events (prod definitions plus the mfa_reset branches).
CREATE OR REPLACE FUNCTION public.claim_mail_events(p_worker text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  claimed jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  if p_worker is null or length(btrim(p_worker)) < 1 then
    raise exception 'worker name is required' using errcode = '22023';
  end if;

  with due as (
    select c.id
    from public.outbox_events c
    where c.event_type = any (array[
      'portal_invitation.email_requested',
      'staff_invitation.email_requested',
      'reminder.due',
      'agreement.sent',
      'agreement.executed',
      -- firm countersign: a staff signer's turn.
      'agreement.signer_turn',
      'document.request_created',
      'document.uploaded',
      'document.reviewed',
      -- email designs: invoice, payment and refund mail.
      'invoice.issued',
      'invoice.payment_failed',
      'invoice.refund_started',
      'invoice.refund_succeeded',
      -- New (20261025530100): EX20, a refund the client was told about failed afterwards.
      'invoice.refund_failed',
      -- scheduling: consultation booked, moved, cancelled.
      'booking.confirmed',
      'booking.rescheduled',
      'booking.cancelled',
      -- matter messaging: EX07 generic notice of a staff message.
      'message.sent',
      -- inbox replies: EX15, an email a staff member wrote.
      'matter_email.sent',
      -- support access: EX11 asked, EM17 approved.
      'support_access.requested',
      'support_access.approved',
      -- consultation agreements: EM08 with the booking's private signing link.
      'booking_agreement.sent',
      -- signing flow: EX16, the sealed six-digit signing code.
      'booking_agreement.code',
      -- ORG-06: EX17, the matter's consultant changed.
      'matter.consultant_changed',
      -- CRM-01: EX18, a new web enquiry, to the firm's owners.
      'lead.enquiry_received',
      -- OPS-04: EX19, an announcement to many clients.
      'announcement.sent',
      -- Card trial: EM18c trial ending and EM18a billing payment failed, to the firm owners.
      'subscription.trial_will_end',
      'subscription.payment_failed',
      -- lost two-step device: EX21 asked (other owners), EX22 decided (the person).
      'mfa_reset.requested',
      'mfa_reset.decided'
    ])
      and (
        (c.status in ('pending', 'failed') and c.available_at <= clock_timestamp())
        or (c.status = 'processing' and c.locked_at < clock_timestamp() - interval '5 minutes')
      )
      -- sealed invitation link: wait for it, or send the linkless email after 10 minutes.
      and (
        c.event_type not in ('portal_invitation.email_requested', 'staff_invitation.email_requested')
        or c.payload ? 'sealed_link'
        or c.occurred_at < clock_timestamp() - interval '10 minutes'
      )
    order by c.available_at, c.occurred_at
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update skip locked
  ),
  locked as (
    update public.outbox_events event
       set status = 'processing',
           locked_at = clock_timestamp(),
           locked_by = left(btrim(p_worker), 200),
           attempts = event.attempts + 1
     where event.id in (select due.id from due)
    returning event.id, event.organization_id, event.event_type, event.payload, event.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', locked.id,
    'organization_id', locked.organization_id,
    'event_type', locked.event_type,
    'payload', locked.payload,
    'attempts', locked.attempts
  )), '[]'::jsonb)
  into claimed
  from locked;
  return claimed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_email_delivery(p_event_id uuid, p_worker text, p_inbound_domain text DEFAULT NULL::text, p_from_address text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  event public.outbox_events%rowtype;
  firm_name text;
  firm_slug text;
  domain text;
  from_addr text;
  matter uuid;
  template public.email_template;
  critical boolean;
  reply text;
  messages jsonb;
  rec record;
  send_ok boolean;
  ctx jsonb;
  inviter text;
  payer uuid;
  payer_known boolean;
  -- inbox replies: the staff email, and what its message carries besides the context.
  outbound public.matter_outbound_emails%rowtype;
  in_reply_to text;
  extra jsonb := '{}'::jsonb;
  -- support access: the request the event is about.
  support_req public.support_access_requests%rowtype;
  -- lost two-step device: the reset request the event is about.
  mfa_req public.mfa_reset_requests%rowtype;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') is distinct from 'service_role' then
    raise exception 'worker role required' using errcode = '42501';
  end if;
  select * into event from public.outbox_events where id = p_event_id;
  if event.id is null then
    raise exception 'mail event was not found' using errcode = '42501';
  end if;
  if event.status = 'published' then
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;
  if event.status is distinct from 'processing'
     or event.locked_by is distinct from left(btrim(coalesce(p_worker, '')), 200) then
    raise exception 'mail event is not claimed' using errcode = '42501';
  end if;

  domain := app.inbound_domain(p_inbound_domain);
  from_addr := lower(btrim(coalesce(
    nullif(p_from_address, ''),
    (select value ->> 'address' from public.product_settings where key = 'email.from_address'),
    'notices@casevoya.ca'
  )));
  if from_addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    from_addr := 'notices@casevoya.ca';
  end if;
  select display_name, slug into firm_name, firm_slug
  from public.organizations
  where id = event.organization_id;

  matter := null;
  if coalesce(event.payload ->> 'matter_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    matter := (event.payload ->> 'matter_id')::uuid;
  end if;

  if event.event_type = 'document.reviewed'
     and coalesce(event.payload ->> 'decision', '') is distinct from 'accepted' then
    perform app.mark_outbox_published(event.id, p_worker);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('reason', 'review_not_accepted')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  -- New (20261025530100): "Your refund is complete" (EX10) is no longer sent. A card refund Stripe
  -- reports succeeded can still fail later (Stripe: up to 30 days), and Stripe sends no final
  -- signal. An event already queued before this change is skipped, not sent.
  if event.event_type = 'invoice.refund_succeeded' then
    perform app.mark_outbox_published(event.id, p_worker);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('reason', 'refund_not_final')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  template := case event.event_type
    when 'portal_invitation.email_requested' then 'invite'::public.email_template
    when 'staff_invitation.email_requested' then 'invite'::public.email_template
    when 'reminder.due' then 'reminder'::public.email_template
    when 'agreement.sent' then 'agreement'::public.email_template
    when 'agreement.executed' then 'signature'::public.email_template
    -- firm countersign: the staff signer's turn uses the agreement template, staff copy.
    when 'agreement.signer_turn' then 'agreement'::public.email_template
    when 'document.request_created' then 'document_request'::public.email_template
    when 'document.uploaded' then 'document_receipt'::public.email_template
    when 'document.reviewed' then 'document_receipt'::public.email_template
    -- email designs: invoice, payment and refund mail.
    when 'invoice.issued' then 'invoice'::public.email_template
    when 'invoice.payment_failed' then 'payment_failed'::public.email_template
    when 'invoice.refund_started' then 'refund_started'::public.email_template
    when 'invoice.refund_succeeded' then 'refund_complete'::public.email_template
    -- New (20261025530100): EX20, the refund correction.
    when 'invoice.refund_failed' then 'refund_failed'::public.email_template
    -- scheduling: EM16a / EM16b / EM16c.
    when 'booking.confirmed' then 'consultation_booked'::public.email_template
    when 'booking.rescheduled' then 'consultation_rescheduled'::public.email_template
    when 'booking.cancelled' then 'consultation_cancelled'::public.email_template
    -- matter messaging: EX07, the generic "New message" notice.
    when 'message.sent' then 'message'::public.email_template
    -- inbox replies: EX15, the staff member's own words.
    when 'matter_email.sent' then 'staff_message'::public.email_template
    -- support access: EX11 asked, EM17 approved.
    when 'support_access.requested' then 'support_requested'::public.email_template
    when 'support_access.approved' then 'support_granted'::public.email_template
    -- consultation agreements: the agreement template (EM08), booking variant.
    when 'booking_agreement.sent' then 'agreement'::public.email_template
    -- signing flow: EX16, the signing code.
    when 'booking_agreement.code' then 'signing_code'::public.email_template
    -- ORG-06: EX17, the matter's consultant changed.
    when 'matter.consultant_changed' then 'consultant_changed'::public.email_template
    -- CRM-01: EX18, a new web enquiry.
    when 'lead.enquiry_received' then 'enquiry_received'::public.email_template
    -- OPS-04: EX19, a new notice (announcement).
    when 'announcement.sent' then 'announcement'::public.email_template
    -- Card trial: EM18c and EM18a.
    when 'subscription.trial_will_end' then 'trial_ending'::public.email_template
    when 'subscription.payment_failed' then 'billing_payment_failed'::public.email_template
    -- Lost two-step device: EX21 and EX22.
    when 'mfa_reset.requested' then 'mfa_reset_requested'::public.email_template
    when 'mfa_reset.decided' then 'mfa_reset_decided'::public.email_template
    else null
  end;
  if template is null then
    raise exception 'event is not a mail event' using errcode = '22023';
  end if;

  critical := template in ('invite', 'agreement', 'signature', 'document_request', 'document_receipt');
  ctx := jsonb_build_object('firm', firm_name, 'template', template);

  -- sealed invitation link: the worker decrypts it; it stays well under the 2000-byte context cap.
  if event.event_type in ('portal_invitation.email_requested', 'staff_invitation.email_requested')
     and length(coalesce(event.payload ->> 'sealed_link', '')) between 1 and 1024 then
    ctx := ctx || jsonb_build_object(
      'sealed_link', event.payload ->> 'sealed_link',
      'invitation_id', event.payload ->> 'invitation_id'
    );
  end if;

  if event.event_type = 'portal_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'portal', 'role', event.payload ->> 'role');
    -- email designs: who invited them, for the heading.
    select left(nullif(btrim(profile.display_name), ''), 120) into inviter
    from public.portal_invitations inv
    join public.profiles profile on profile.id = inv.created_by
    where inv.id::text = event.payload ->> 'invitation_id'
      and inv.organization_id = event.organization_id;
    if inviter is not null then
      ctx := ctx || jsonb_build_object('inviter', inviter);
    end if;
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, matter, true, ctx, true
    );
  elsif event.event_type = 'staff_invitation.email_requested' then
    ctx := ctx || jsonb_build_object('kind', 'staff', 'role', event.payload ->> 'role');
    -- email designs: who invited them, for the heading.
    select left(nullif(btrim(profile.display_name), ''), 120) into inviter
    from public.invitations inv
    join public.profiles profile on profile.id = inv.created_by
    where inv.id::text = event.payload ->> 'invitation_id'
      and inv.organization_id = event.organization_id;
    if inviter is not null then
      ctx := ctx || jsonb_build_object('inviter', inviter);
    end if;
    perform app.queue_email_delivery(
      event.id, event.organization_id, event.payload ->> 'recipient_email',
      template, null, true, ctx, true
    );
  elsif event.event_type = 'reminder.due' then
    critical := coalesce(event.payload ->> 'reminder_kind', '') = 'immediate'
      or exists (
        select 1
        from public.deadlines deadline
        where deadline.id::text = event.payload ->> 'deadline_id'
          and deadline.kind in ('legal', 'correspondence')
      );
    ctx := ctx || jsonb_build_object(
      'reminder_kind', coalesce(event.payload ->> 'reminder_kind', 'routine'),
      'due_on', (
        select to_char(deadline.due_on, 'YYYY-MM-DD')
        from public.deadlines deadline
        where deadline.id::text = event.payload ->> 'deadline_id'
      )
    );
    for rec in
      select person.email,
             coalesce(pref.deadline_reminders, false) as deadline_reminders,
             pref.email_notices as email_notices
      from public.persons person
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = matter
       and party.organization_id = event.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where person.organization_id = event.organization_id
        and person.email is not null
        and matter is not null
    loop
      send_ok := coalesce(event.payload ->> 'reminder_kind', '') = 'immediate'
        or (rec.deadline_reminders and rec.email_notices is distinct from false);
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, critical, ctx, send_ok
      );
    end loop;
  elsif event.event_type in ('agreement.sent', 'agreement.executed') then
    ctx := ctx || jsonb_build_object('agreement_kind', (
      select agreement.kind
      from public.signature_envelopes envelope
      join public.agreements agreement on agreement.id = envelope.agreement_id
      where envelope.id::text = event.payload ->> 'envelope_id'
    ));
    for rec in
      select lower(coalesce(person.email, users.email)) as email,
             signer.person_id is null as staff
      from public.envelope_signers signer
      left join public.persons person on person.id = signer.person_id
      left join public.memberships membership on membership.id = signer.membership_id
      left join auth.users users on users.id = membership.user_id
      where signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
        -- firm countersign: staff signers hear when it is their turn (agreement.signer_turn), not at send.
        and (event.event_type = 'agreement.executed' or signer.person_id is not null)
    loop
      -- email designs: a staff signer's executed copy links to the Sheet, not the portal.
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true,
        case when rec.staff then ctx || jsonb_build_object('audience', 'staff') else ctx end,
        true
      );
    end loop;
  -- firm countersign: the staff signer whose turn it is, while it still is, gets the Sheet link.
  elsif event.event_type = 'agreement.signer_turn' then
    ctx := ctx || jsonb_build_object(
      'audience', 'staff',
      'agreement_kind', (
        select agreement.kind
        from public.signature_envelopes envelope
        join public.agreements agreement on agreement.id = envelope.agreement_id
        where envelope.id::text = event.payload ->> 'envelope_id'
      )
    );
    for rec in
      select lower(users.email) as email
      from public.envelope_signers signer
      join public.signature_envelopes envelope
        on envelope.id = signer.envelope_id
       and envelope.organization_id = signer.organization_id
      join public.memberships membership
        on membership.id = signer.membership_id
       and membership.organization_id = signer.organization_id
       and membership.status = 'active'
      join auth.users users on users.id = membership.user_id
      where signer.id::text = event.payload ->> 'signer_id'
        and signer.envelope_id::text = event.payload ->> 'envelope_id'
        and signer.organization_id = event.organization_id
        and signer.status = 'current'
        and envelope.status in ('sent', 'partially_signed')
        and envelope.expires_at > statement_timestamp()
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, true, ctx, true
      );
    end loop;
  elsif event.event_type = 'document.request_created' then
    -- email designs: the due date only; the request's purpose names the document and stays out of mail.
    ctx := ctx || jsonb_build_object('due_on', event.payload ->> 'due_on');
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (select person.email from public.persons person where person.id::text = event.payload ->> 'person_id'),
      template, matter, true, ctx, true
    );
  elsif event.event_type in ('document.uploaded', 'document.reviewed') then
    ctx := ctx || jsonb_build_object(
      'status', case when event.event_type = 'document.reviewed' then 'accepted' else 'received' end
    );
    perform app.queue_email_delivery(
      event.id, event.organization_id,
      (
        select person.email
        from public.documents doc
        join public.persons person on person.id = doc.person_id
        where doc.id::text = event.payload ->> 'document_id'
      ),
      template, matter, true, ctx, true
    );
  -- email designs: invoice, payment and refund mail to the payer, else the matter's applicants.
  elsif event.event_type in ('invoice.issued', 'invoice.payment_failed', 'invoice.refund_started', 'invoice.refund_succeeded', 'invoice.refund_failed') then
    -- New (20261025530100): the refund correction carries Stripe's failure reason code; the
    -- renderer turns only known codes into plain words and never prints the code.
    if event.event_type = 'invoice.refund_failed' then
      ctx := ctx || coalesce((
        select jsonb_build_object('refund_reason', refund.failure_reason)
        from public.invoice_refunds refund
        where refund.id::text = event.payload ->> 'refund_id'
          and refund.organization_id = event.organization_id
          and refund.failure_reason ~ '^[a-z_]{1,60}$'
      ), '{}'::jsonb);
    end if;
    ctx := ctx || coalesce((
      select jsonb_build_object(
        'invoice_id', invoice.id,
        'invoice_number', invoice.number,
        'due_on', to_char(invoice.due_on, 'YYYY-MM-DD')
      )
      from public.invoices invoice
      where invoice.id::text = event.payload ->> 'invoice_id'
        and invoice.organization_id = event.organization_id
    ), '{}'::jsonb);
    payer := null;
    if event.event_type <> 'invoice.issued' then
      select payment.created_by into payer
      from public.invoice_payments payment
      where payment.id::text = event.payload ->> 'payment_id'
        and payment.organization_id = event.organization_id;
    end if;
    payer_known := payer is not null and matter is not null and exists (
      select 1
      from public.persons person
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = matter
       and party.organization_id = event.organization_id
      where person.user_id = payer
        and person.organization_id = event.organization_id
        and person.email is not null
    );
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_participants party
      join public.persons person
        on person.id = party.person_id
       and person.organization_id = party.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where party.matter_id = matter
        and party.organization_id = event.organization_id
        and person.email is not null
        and matter is not null
        and case when payer_known then person.user_id = payer else party.role = 'applicant' end
      group by lower(person.email)
    loop
      -- New (20261025530100, Francis 2026-10-25): the refund correction is a money correction, not
      -- a routine notice, so it ignores the Email notices opt-out. Suppressed addresses (bounces,
      -- complaints) and invalid addresses are still not sent (queue_email_delivery).
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, false, ctx,
        rec.email_notices or event.event_type = 'invoice.refund_failed'
      );
    end loop;
  -- scheduling: the booking's primary attendee, with the time in their own zone. A booking that
  -- moved again or was cancelled since this event was queued is not mailed with a stale time.
  elsif event.event_type in ('booking.confirmed', 'booking.rescheduled', 'booking.cancelled') then
    for rec in
      select attendee.email,
             attendee.time_zone,
             booking.host_name,
             booking.status,
             booking.starts_at,
             booking.location_kind,
             booking.location_detail,
             booking.is_sample,
             -- portal appointments: who cancelled (EM16c wording).
             booking.cancelled_by,
             -- booking mail: a portal button only for an attendee whose person can sign in.
             (person.id is not null and person.user_id is not null) as portal,
             pref.email_notices is distinct from false as email_notices
      from public.bookings booking
      join public.booking_attendees attendee
        on attendee.booking_id = booking.id
       and attendee.organization_id = booking.organization_id
       and attendee.role = 'primary'
      left join public.persons person
        on person.id = attendee.person_id
       and person.organization_id = attendee.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where booking.id::text = event.payload ->> 'booking_id'
        and booking.organization_id = event.organization_id
    loop
      ctx := ctx || jsonb_build_object(
        'starts_at', coalesce(event.payload ->> 'starts_at', to_char(rec.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
        'time_zone', rec.time_zone,
        'portal', rec.portal
      );
      if event.event_type = 'booking.confirmed' and rec.host_name is not null then
        ctx := ctx || jsonb_build_object('consultant_name', rec.host_name);
      end if;
      -- booking mail: how they meet; the address only for an in-person meeting, never a link.
      if event.event_type = 'booking.confirmed' then
        ctx := ctx || jsonb_build_object('location_kind', rec.location_kind);
        if rec.location_kind = 'in_person' and nullif(btrim(coalesce(rec.location_detail, '')), '') is not null then
          ctx := ctx || jsonb_build_object('address', left(btrim(rec.location_detail), 300));
        end if;
      end if;
      -- booking mail: without a portal, a cancellation points to the firm's booking page when the
      -- firm has a published free one this attendee can use (a practice one for a sample booking).
      if event.event_type = 'booking.cancelled' and not rec.portal and firm_slug is not null and exists (
        select 1 from public.booking_event_types et
        where et.organization_id = event.organization_id
          and et.is_published and et.archived_at is null and et.price_cents = 0
          and (not et.is_sample or rec.is_sample)
      ) then
        ctx := ctx || jsonb_build_object('booking_page', firm_slug);
      end if;
      -- portal appointments: EM16c says who cancelled (the client from their portal, or the firm).
      if event.event_type = 'booking.cancelled' then
        ctx := ctx || jsonb_build_object('cancelled_by',
          case when coalesce(event.payload ->> 'cancelled_by', rec.cancelled_by::text) = 'client' then 'client' else 'staff' end);
      end if;
      send_ok := rec.email_notices and case event.event_type
        when 'booking.cancelled' then rec.status = 'cancelled'
        else rec.status = 'confirmed' and rec.starts_at = (event.payload ->> 'starts_at')::timestamptz
      end;
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  -- matter messaging: each person the thread is addressed to, firm name only (never the text).
  -- A critical instruction (requires_ack) is a critical notice, so a bounce opens a staff task.
  elsif event.event_type = 'message.sent' then
    critical := coalesce((
      select message.requires_ack from public.matter_messages message
      where message.id::text = event.payload ->> 'message_id'
        and message.organization_id = event.organization_id
    ), false);
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_messages message
      join public.message_thread_people tp
        on tp.thread_id = message.thread_id
       and tp.organization_id = message.organization_id
      join public.persons person
        on person.id = tp.person_id
       and person.organization_id = tp.organization_id
      join public.matter_participants party
        on party.person_id = person.id
       and party.matter_id = message.matter_id
       and party.organization_id = message.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where message.id::text = event.payload ->> 'message_id'
        and message.organization_id = event.organization_id
        and person.email is not null
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, critical, ctx, rec.email_notices
      );
    end loop;
  -- inbox replies: the stored address of the person the staff member wrote to. A sample matter's
  -- email is recorded as skipped (never sent), as is one whose person left the matter, lost that
  -- address, or turned "Email notices" off since. The text, subject and threading headers go in
  -- the message, not the context.
  elsif event.event_type = 'matter_email.sent' then
    select * into outbound
    from public.matter_outbound_emails email
    where email.id::text = event.payload ->> 'email_id'
      and email.organization_id = event.organization_id
      and email.outbox_event_id = event.id;
    if outbound.id is not null then
      matter := outbound.matter_id;
      select * into rec
      from (
        select lower(person.email) as email,
               person.user_id is not null as portal,
               exists (
                 select 1 from public.matter_participants party
                 where party.person_id = person.id
                   and party.matter_id = outbound.matter_id
                   and party.organization_id = outbound.organization_id
               ) as on_matter,
               coalesce((
                 select pref.email_notices is distinct from false
                 from public.person_contact_preferences pref
                 where pref.person_id = person.id
               ), true) as email_notices
        from public.persons person
        where person.id = outbound.person_id
          and person.organization_id = outbound.organization_id
      ) found;
      ctx := ctx || jsonb_build_object(
        'sender', left(outbound.author_name, 120),
        'portal', coalesce(rec.portal, false)
      );
      send_ok := outbound.is_sample is false
        and coalesce(rec.on_matter, false)
        and coalesce(rec.email_notices, false)
        and rec.email is not distinct from outbound.recipient_email;
      perform app.queue_email_delivery(
        event.id, event.organization_id, outbound.recipient_email, template, matter, false, ctx, send_ok
      );
      select inbound.message_id into in_reply_to
      from public.inbound_emails inbound
      where inbound.id = outbound.reply_to_inbound_id
        and inbound.organization_id = outbound.organization_id;
      extra := jsonb_build_object('body', outbound.body, 'subject', outbound.subject);
      if btrim(coalesce(in_reply_to, '')) ~ '^<[^<>[:space:]]+>$' and length(btrim(in_reply_to)) <= 500 then
        extra := extra || jsonb_build_object(
          'headers', jsonb_build_object('In-Reply-To', btrim(in_reply_to), 'References', btrim(in_reply_to))
        );
      end if;
    end if;
  -- support access: EX11 when Casevoya support asks, EM17 when a firm owner approves, to every
  -- active firm owner at their sign-in address. Minutes only in the request mail; the approver's
  -- name, the minutes granted, the end time and the firm's zone in the approval mail. No matter
  -- (platform mail), never critical. Nothing about the matter or the reason goes in the email.
  elsif event.event_type in ('support_access.requested', 'support_access.approved') then
    select * into support_req
    from public.support_access_requests req
    where req.id::text = event.payload ->> 'request_id'
      and req.organization_id = event.organization_id;
    if support_req.id is not null then
      ctx := ctx || jsonb_build_object('minutes', support_req.requested_minutes);
      if event.event_type = 'support_access.approved' and support_req.starts_at is not null then
        ctx := ctx || jsonb_build_object(
          'approver', (
            select left(nullif(btrim(coalesce(prof.display_name, '')), ''), 120)
            from public.memberships member
            left join public.profiles prof on prof.id = member.user_id
            where member.id = support_req.approved_by_membership_id
              and member.organization_id = support_req.organization_id
          ),
          'minutes', round(extract(epoch from (support_req.ends_at - support_req.starts_at)) / 60)::integer,
          'ends_at', to_char(support_req.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'time_zone', (select org.timezone from public.organizations org where org.id = event.organization_id)
        );
      end if;
      for rec in
        select lower(users.email) as email
        from public.memberships member
        join auth.users users on users.id = member.user_id
        where member.organization_id = event.organization_id
          and member.role = 'firm_owner'
          and member.status = 'active'
          and users.email is not null
        group by lower(users.email)
      loop
        perform app.queue_email_delivery(
          event.id, event.organization_id, rec.email, template, null, false, ctx, true
        );
      end loop;
    end if;
  -- consultation agreements: the booking's primary attendee gets EM08 with the booking's private
  -- signing link (the ref only; the worker builds the link). Sent only while that agreement is
  -- still unsigned and the consultation still ahead; never critical (no matter), and it honours
  -- "Email notices" like the other booking mail.
  elsif event.event_type = 'booking_agreement.sent' then
    critical := false;
    for rec in
      select attendee.email,
             booking.public_ref,
             agreement.status as agreement_status,
             booking.status as booking_status,
             booking.ends_at,
             pref.email_notices is distinct from false as email_notices
      from public.booking_agreements agreement
      join public.bookings booking
        on booking.id = agreement.booking_id
       and booking.organization_id = agreement.organization_id
      join public.booking_attendees attendee
        on attendee.booking_id = booking.id
       and attendee.organization_id = booking.organization_id
       and attendee.role = 'primary'
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where agreement.id::text = event.payload ->> 'booking_agreement_id'
        and agreement.booking_id::text = event.payload ->> 'booking_id'
        and agreement.organization_id = event.organization_id
    loop
      ctx := ctx || jsonb_build_object('agreement_kind', 'consultation', 'signing_ref', rec.public_ref);
      send_ok := rec.email_notices
        and rec.agreement_status = 'sent'
        and rec.booking_status in ('held', 'pending_payment', 'confirmed')
        and rec.ends_at > statement_timestamp();
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  -- signing flow: EX16 to the booking's primary attendee with the sealed code (the worker opens
  -- it; the database never holds the code). Sent only while that code is the newest, unexpired
  -- and unused, and the agreement unsigned; it honours "Email notices" like EM08.
  elsif event.event_type = 'booking_agreement.code' then
    critical := false;
    for rec in
      select attendee.email,
             code.id as code_id,
             code.expires_at,
             code.verified_at,
             agreement.status as agreement_status,
             not exists (
               select 1 from public.booking_agreement_codes newer
               where newer.booking_agreement_id = code.booking_agreement_id and newer.created_at > code.created_at
             ) as newest,
             pref.email_notices is distinct from false as email_notices
      from public.booking_agreement_codes code
      join public.booking_agreements agreement
        on agreement.id = code.booking_agreement_id
       and agreement.organization_id = code.organization_id
      join public.booking_attendees attendee
        on attendee.booking_id = agreement.booking_id
       and attendee.organization_id = agreement.organization_id
       and attendee.role = 'primary'
      left join public.person_contact_preferences pref
        on pref.person_id = attendee.person_id
      where code.id::text = event.payload ->> 'code_id'
        and code.booking_agreement_id::text = event.payload ->> 'booking_agreement_id'
        and code.organization_id = event.organization_id
    loop
      if length(coalesce(event.payload ->> 'sealed_code', '')) between 1 and 1024 then
        ctx := ctx || jsonb_build_object('sealed_code', event.payload ->> 'sealed_code', 'code_id', rec.code_id);
      end if;
      send_ok := rec.email_notices and rec.newest and rec.verified_at is null
        and rec.expires_at > statement_timestamp() and rec.agreement_status = 'sent';
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, send_ok
      );
    end loop;
  -- ORG-06: EX17 to each person on the matter with a portal account and an email, the same people
  -- the staff screen showed and who got the portal notice. No names, nothing about the matter:
  -- the portal says who. Honours "Email notices".
  elsif event.event_type = 'matter.consultant_changed' then
    for rec in
      select lower(person.email) as email,
             bool_or(pref.email_notices is distinct from false) as email_notices
      from public.matter_participants party
      join public.persons person
        on person.id = party.person_id
       and person.organization_id = party.organization_id
      left join public.person_contact_preferences pref
        on pref.person_id = person.id
      where party.matter_id = matter
        and party.organization_id = event.organization_id
        and person.user_id is not null
        and person.email is not null
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, matter, false, ctx, rec.email_notices
      );
    end loop;
  -- CRM-01: EX18 to each active firm owner, and the lead's owner when it has one: the firm name
  -- and a link to the Pipeline only, never what the enquirer wrote. Staff mail (audience staff).
  elsif event.event_type = 'lead.enquiry_received' then
    ctx := ctx || jsonb_build_object('audience', 'staff');
    for rec in
      select distinct lower(users.email) as email
      from public.memberships member
      join auth.users users on users.id = member.user_id
      where member.organization_id = event.organization_id
        and member.status = 'active'
        and users.email is not null
        and (
          member.role = 'firm_owner'
          or member.id = (
            select lead.owner_membership_id from public.leads lead
            where lead.id::text = event.payload ->> 'lead_id' and lead.organization_id = event.organization_id
          )
        )
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, true
      );
    end loop;
  -- OPS-04: EX19 to each person the announcement went to who was to be emailed, firm name only
  -- (the announcement is in the portal). Never for a sample-mode firm's announcement; "Email
  -- notices" is checked again now.
  elsif event.event_type = 'announcement.sent' then
    for rec in
      select lower(person.email) as email,
             bool_and(not announcement.is_sample) and bool_or(coalesce((
               select pref.email_notices is distinct from false
               from public.person_contact_preferences pref
               where pref.person_id = person.id
               limit 1
             ), true)) as send_now
      from public.announcement_deliveries delivery
      join public.announcements announcement
        on announcement.id = delivery.announcement_id
       and announcement.organization_id = delivery.organization_id
      join public.persons person
        on person.id = delivery.person_id
       and person.organization_id = delivery.organization_id
      where announcement.id::text = event.payload ->> 'announcement_id'
        and announcement.organization_id = event.organization_id
        and delivery.emailed
        and person.email is not null
      group by lower(person.email)
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, rec.send_now
      );
    end loop;
  -- Card trial: EM18c (trial ends on <date>, what will be charged) and EM18a (a subscription
  -- payment failed or needs confirming) to each active firm owner. Casevoya's own mail (audience
  -- staff); the amount is the catalog price of the plan, before taxes.
  elsif event.event_type in ('subscription.trial_will_end', 'subscription.payment_failed') then
    ctx := ctx || jsonb_build_object('audience', 'staff');
    if event.event_type = 'subscription.trial_will_end' then
      ctx := ctx || jsonb_build_object(
        'trial_end', event.payload ->> 'trial_end',
        'plan', event.payload ->> 'plan',
        'interval', event.payload ->> 'interval',
        'amount_cents', app.subscription_amount_cents(event.payload ->> 'plan', event.payload ->> 'interval', coalesce((event.payload ->> 'extra_seats')::integer, 0)),
        'currency', coalesce(app.subscription_plan_catalog() ->> 'currency', 'CAD'),
        'time_zone', (select o.timezone from public.organizations o where o.id = event.organization_id)
      );
    else
      ctx := ctx || jsonb_build_object('grace_days', app.subscription_grace_days('past_due_days'));
    end if;
    for rec in
      select distinct lower(users.email) as email
      from public.memberships member
      join auth.users users on users.id = member.user_id
      where member.organization_id = event.organization_id
        and member.status = 'active'
        and member.role = 'firm_owner'
        and users.email is not null
    loop
      perform app.queue_email_delivery(
        event.id, event.organization_id, rec.email, template, null, false, ctx, true
      );
    end loop;
  -- Lost two-step device: EX21 (a staff member asked to reset two-step) to the firm's other active
  -- owners, never the person who asked; only while the request is still pending. EX22 (approved or
  -- denied) to the person who asked. Casevoya's own mail (audience staff); never the message itself.
  elsif event.event_type in ('mfa_reset.requested', 'mfa_reset.decided') then
    select * into mfa_req
    from public.mfa_reset_requests req
    where req.id::text = event.payload ->> 'request_id'
      and req.organization_id = event.organization_id;
    if mfa_req.id is not null then
      ctx := ctx || jsonb_build_object(
        'audience', 'staff',
        'requester', (select left(nullif(btrim(coalesce(prof.display_name, '')), ''), 120) from public.profiles prof where prof.id = mfa_req.requester_user_id),
        'expires_at', to_char(mfa_req.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'time_zone', (select o.timezone from public.organizations o where o.id = event.organization_id),
        'status', mfa_req.status
      );
      if event.event_type = 'mfa_reset.requested' and mfa_req.status = 'pending' and mfa_req.route = 'firm' then
        for rec in
          select distinct lower(users.email) as email
          from public.memberships member
          join auth.users users on users.id = member.user_id
          where member.organization_id = event.organization_id
            and member.status = 'active'
            and member.role = 'firm_owner'
            and member.user_id <> mfa_req.requester_user_id
            and users.email is not null
        loop
          perform app.queue_email_delivery(
            event.id, event.organization_id, rec.email, template, null, false, ctx, true
          );
        end loop;
      elsif event.event_type = 'mfa_reset.decided' and mfa_req.status in ('approved', 'denied') then
        for rec in
          select lower(users.email) as email
          from auth.users users
          where users.id = mfa_req.requester_user_id
            and users.email is not null
        loop
          perform app.queue_email_delivery(
            event.id, event.organization_id, rec.email, template, null, false, ctx, true
          );
        end loop;
      end if;
    end if;
  end if;

  if not exists (
    select 1 from public.email_deliveries delivery
    where delivery.outbox_event_id = event.id
      and delivery.status = 'sending'
  ) then
    perform app.mark_outbox_published(event.id, p_worker);
    -- sealed invitation link: nothing will be sent, so nothing needs it.
    perform app.scrub_invitation_link(event.id);
    perform app.record_audit_event(
      event.organization_id, 'email.skipped', 'public.outbox_events', event.id, 'success',
      jsonb_build_object('template', template, 'reason', 'no_recipient')
    );
    return jsonb_build_object('action', 'done', 'event_id', event.id, 'messages', '[]'::jsonb);
  end if;

  reply := app.firm_reply_address(event.organization_id, matter, domain);
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', delivery.id,
    'to', delivery.recipient_email,
    'from_address', from_addr,
    -- Card trial: Casevoya's billing mail comes from Casevoya, not the firm.
    'from_name', case when delivery.template in ('trial_ending', 'billing_payment_failed', 'mfa_reset_requested', 'mfa_reset_decided') then 'Casevoya' else firm_name end,
    'reply_to_address', case when delivery.template in ('trial_ending', 'billing_payment_failed', 'mfa_reset_requested', 'mfa_reset_decided') then from_addr else reply end,
    'reply_to_name', case when delivery.template in ('trial_ending', 'billing_payment_failed', 'mfa_reset_requested', 'mfa_reset_decided') then 'Casevoya' else firm_name end,
    'template', delivery.template,
    'context', delivery.context
  -- inbox replies: body, subject and headers of a staff email (empty for every other event).
  ) || extra), '[]'::jsonb)
  into messages
  from public.email_deliveries delivery
  where delivery.outbox_event_id = event.id
    and delivery.status = 'sending';

  return jsonb_build_object('action', 'send', 'event_id', event.id, 'messages', messages);
end;
$function$;

-- Notifications: kind mfa_reset for the firm's other owners.
CREATE OR REPLACE FUNCTION app.staff_notification_items(p_org uuid, p_limit integer)
 RETURNS TABLE(source_id uuid, kind text, occurred_at timestamp with time zone, matter_id uuid, actor_name text, subject text, detail text, href text, is_read boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  since timestamptz := clock_timestamp() - interval '30 days';
  firm_zone text;
  me uuid;
begin
  if actor is null
     or app.in_active_org(p_org) is distinct from true
     or app.staff_mfa_satisfied() is distinct from true
     or app.is_org_staff(p_org) is distinct from true then
    raise exception 'staff access denied' using errcode = '42501';
  end if;

  select nullif(btrim(coalesce(org.timezone, '')), '') into firm_zone
  from public.organizations org
  where org.id = p_org;

  -- OPS-01: the caller's own membership, to match task owners, watchers and matter leads.
  select mem.id into me
  from public.memberships mem
  where mem.organization_id = p_org
    and mem.user_id = actor
    and mem.status = 'active'
  order by mem.created_at
  limit 1;

  return query
  with items as (
    -- A client's message.
    select message.id as source_id, 'message'::text as kind, message.created_at as occurred_at,
           message.matter_id, person.display_name as actor_name, null::text as subject, null::text as detail,
           '/sheet/matters/' || message.matter_id::text || '?tab=messages&thread=' || message.thread_id::text as href,
           exists (
             select 1 from public.matter_message_receipts receipt
             where receipt.message_id = message.id and receipt.user_id = actor
           ) as seen
    from public.matter_messages message
    join public.persons person
      on person.id = message.author_person_id
     and person.organization_id = message.organization_id
    where message.organization_id = p_org
      and message.author_kind = 'client'
      and message.created_at > since
      and app.message_staff_reads_matter(message.matter_id, message.organization_id)

    union all
    -- A client's upload that passed the file check.
    select event.id, 'document', event.occurred_at, matter.id,
           coalesce(uploader.display_name, subject_person.display_name), doc.purpose,
           'v' || coalesce(version.version_number, 1)::text,
           '/sheet/matters/' || matter.id::text || '?tab=documents',
           false
    from public.outbox_events event
    join public.documents doc
      on doc.id::text = event.payload ->> 'document_id'
     and doc.organization_id = event.organization_id
    join public.persons subject_person
      on subject_person.id = doc.person_id
     and subject_person.organization_id = doc.organization_id
    left join public.document_versions version
      on version.id::text = event.payload ->> 'version_id'
     and version.organization_id = event.organization_id
    join public.matters matter
      on matter.id::text = event.payload ->> 'matter_id'
     and matter.organization_id = event.organization_id
    left join public.persons uploader
      on uploader.user_id = event.created_by
     and uploader.organization_id = event.organization_id
    where event.organization_id = p_org
      and event.event_type = 'document.uploaded'
      and event.occurred_at > since
      and not exists (
        select 1 from public.memberships m
        where m.organization_id = event.organization_id
          and m.user_id = event.created_by
          and m.role = any (app.staff_roles())
      )
      and app.message_staff_reads_matter(matter.id, matter.organization_id)

    union all
    -- #263-B: the virus scanner blocked a file (a virus was found), or couldn't check it after
    -- every retry. For staff who can open the matter. subject: the document; detail: which.
    select audit.id, 'document_blocked', audit.occurred_at, matter.id, null::text, doc.purpose,
           case audit.action when 'document.scan_infected' then 'infected' else 'scan_failed' end,
           '/sheet/matters/' || matter.id::text || '?tab=documents',
           false
    from public.audit_log audit
    join public.document_versions version
      on version.id = audit.object_id
     and version.organization_id = audit.organization_id
    join public.documents doc
      on doc.id = version.document_id
     and doc.organization_id = version.organization_id
    join public.matters matter
      on matter.id::text = audit.context ->> 'matter_id'
     and matter.organization_id = audit.organization_id
    where audit.organization_id = p_org
      and audit.action in ('document.scan_infected', 'document.scan_failed')
      and audit.occurred_at > since
      and app.message_staff_reads_matter(matter.id, matter.organization_id)

    union all
    -- A card payment succeeded.
    select audit.id, 'payment', audit.occurred_at, invoice.matter_id, null, invoice.number, null,
           '/sheet/finance?tab=payments',
           false
    from public.audit_log audit
    join public.invoices invoice
      on invoice.id = audit.object_id
     and invoice.organization_id = audit.organization_id
    where audit.organization_id = p_org
      and audit.action = 'invoice.payment_succeeded'
      and audit.occurred_at > since
      and app.can_read_matter_billing(invoice.matter_id)

    union all
    -- A consultation booked by a client or a visitor, at its time in the firm's zone.
    select event.id, 'booking', event.occurred_at, booking.matter_id, attendee.display_name, booking.title,
           to_char(booking.starts_at at time zone coalesce(firm_zone, booking.host_time_zone), 'YYYY-MM-DD"T"HH24:MI'),
           '/sheet/consultations',
           false
    from public.outbox_events event
    join public.bookings booking
      on booking.id::text = event.payload ->> 'booking_id'
     and booking.organization_id = event.organization_id
    left join public.booking_attendees attendee
      on attendee.booking_id = booking.id
     and attendee.organization_id = booking.organization_id
     and attendee.role = 'primary'
    where event.organization_id = p_org
      and event.event_type = 'booking.confirmed'
      and event.occurred_at > since
      and booking.source = 'public'
      and app.can_read_scheduling(p_org)

    union all
    -- portal appointments: a client cancelled their consultation from the portal, for its host
    -- and the firm owner, at the cancelled time in the firm's zone.
    select event.id, 'booking_cancelled', event.occurred_at, booking.matter_id,
           coalesce(person.display_name, attendee.display_name), booking.title,
           to_char(coalesce((event.payload ->> 'starts_at')::timestamptz, booking.starts_at)
                   at time zone coalesce(firm_zone, booking.host_time_zone), 'YYYY-MM-DD"T"HH24:MI'),
           '/sheet/consultations',
           false
    from public.outbox_events event
    join public.bookings booking
      on booking.id::text = event.payload ->> 'booking_id'
     and booking.organization_id = event.organization_id
    left join public.persons person
      on person.id = booking.person_id
     and person.organization_id = booking.organization_id
    left join public.booking_attendees attendee
      on attendee.booking_id = booking.id
     and attendee.organization_id = booking.organization_id
     and attendee.role = 'primary'
    where event.organization_id = p_org
      and event.event_type = 'booking.cancelled_by_client'
      and event.occurred_at > since
      and app.can_read_scheduling(p_org)
      and (booking.host_user_id = actor or app.has_org_role(p_org, array['firm_owner']::public.org_role[]))

    union all
    -- portal appointments: a client moved their consultation from the portal, for its host and
    -- the firm owner, at the new time in the firm's zone.
    select event.id, 'booking_rescheduled', event.occurred_at, booking.matter_id,
           coalesce(person.display_name, attendee.display_name), booking.title,
           to_char(coalesce((event.payload ->> 'starts_at')::timestamptz, booking.starts_at)
                   at time zone coalesce(firm_zone, booking.host_time_zone), 'YYYY-MM-DD"T"HH24:MI'),
           '/sheet/consultations',
           false
    from public.outbox_events event
    join public.bookings booking
      on booking.id::text = event.payload ->> 'booking_id'
     and booking.organization_id = event.organization_id
    left join public.persons person
      on person.id = booking.person_id
     and person.organization_id = booking.organization_id
    left join public.booking_attendees attendee
      on attendee.booking_id = booking.id
     and attendee.organization_id = booking.organization_id
     and attendee.role = 'primary'
    where event.organization_id = p_org
      and event.event_type = 'booking.rescheduled_by_client'
      and event.occurred_at > since
      and app.can_read_scheduling(p_org)
      and (booking.host_user_id = actor or app.has_org_role(p_org, array['firm_owner']::public.org_role[]))

    union all
    -- A deadline reminder came due.
    select event.id, 'deadline', event.occurred_at, deadline.matter_id, null, deadline.label,
           coalesce(to_char(deadline.due_on, 'YYYY-MM-DD'), ''),
           '/sheet/matters/' || deadline.matter_id::text || '?tab=tasks',
           false
    from public.outbox_events event
    join public.deadlines deadline
      on deadline.id::text = event.payload ->> 'deadline_id'
     and deadline.organization_id = event.organization_id
    where event.organization_id = p_org
      and event.event_type = 'reminder.due'
      and event.occurred_at > since
      and app.message_staff_reads_matter(deadline.matter_id, deadline.organization_id)

    union all
    -- Casevoya support asked for access (SEC-09): the firm's owners. Read once it is decided.
    select req.id, 'support', req.created_at, req.matter_id, req.requested_by_name,
           case req.scope
             when 'firm_settings' then 'firm settings'
             when 'records_set' then 'a set of records'
             else coalesce(matter.reference, matter.title)
           end,
           req.requested_minutes::text,
           '/sheet/grants?tab=support',
           req.status <> 'pending'
    from public.support_access_requests req
    left join public.matters matter
      on matter.id = req.matter_id
     and matter.organization_id = req.organization_id
    where req.organization_id = p_org
      and req.created_at > since
      and app.has_org_role(p_org, array['firm_owner']::public.org_role[])

    union all
    -- Lost two-step device: a staff member asked to reset two-step (route firm), for the firm's
    -- other owners. Read once it is decided or expired. Never the person's own request.
    select mreq.id, 'mfa_reset', mreq.created_at, null::uuid, mprof.display_name,
           null::text, mreq.status,
           '/app/two-step-resets',
           mreq.status <> 'pending' or mreq.expires_at <= clock_timestamp()
    from public.mfa_reset_requests mreq
    left join public.profiles mprof on mprof.id = mreq.requester_user_id
    where mreq.organization_id = p_org
      and mreq.route = 'firm'
      and mreq.created_at > since
      and mreq.requester_user_id <> actor
      and app.has_org_role(p_org, array['firm_owner']::public.org_role[])

    union all
    -- intake delivery: a client sent their answers (one row per submitted snapshot), for staff
    -- who can open the matter. Staff submitting on a client's behalf raise no row.
    select snap.id, 'intake_submitted', snap.created_at, response.matter_id,
           coalesce(
             (select p.display_name from public.persons p
              where p.user_id = snap.created_by and p.organization_id = snap.organization_id
              order by p.created_at limit 1),
             subject_person.display_name
           ),
           template.title, null::text,
           '/sheet/matters/' || response.matter_id::text || '?tab=intake',
           false
    from public.intake_snapshots snap
    join public.intake_responses response
      on response.id = snap.response_id
     and response.organization_id = snap.organization_id
    join public.intake_templates template
      on template.id = response.template_id
     and template.organization_id = response.organization_id
    join public.persons subject_person
      on subject_person.id = response.person_id
     and subject_person.organization_id = response.organization_id
    where snap.organization_id = p_org
      and snap.created_at > since
      and not exists (
        select 1 from public.memberships m
        where m.organization_id = snap.organization_id
          and m.user_id = snap.created_by
          and m.role = any (app.staff_roles())
      )
      and app.message_staff_reads_matter(response.matter_id, response.organization_id)

    union all
    -- intake delivery: a client asked for a correction after submitting (INT-06).
    select correction.id, 'intake_correction', correction.created_at, response.matter_id,
           subject_person.display_name, template.title,
           'CR-' || lpad(correction.correction_number::text, 4, '0'),
           '/sheet/matters/' || response.matter_id::text || '?tab=intake',
           false
    from public.intake_corrections correction
    join public.intake_responses response
      on response.id = correction.response_id
     and response.organization_id = correction.organization_id
    join public.intake_templates template
      on template.id = response.template_id
     and template.organization_id = response.organization_id
    join public.persons subject_person
      on subject_person.id = response.person_id
     and subject_person.organization_id = response.organization_id
    where correction.organization_id = p_org
      and correction.created_at > since
      and app.message_staff_reads_matter(response.matter_id, response.organization_id)

    union all
    -- OPS-01: a task's status changed, it was reassigned, or it was escalated as overdue. For its
    -- owner and watchers (status), the new owner and watchers (reassigned), and also the matter's
    -- responsible consultant (escalated). Never for the person who made the change.
    select event.id, 'task', event.created_at, task.matter_id,
           (select prof.display_name from public.profiles prof where prof.id = event.actor_user_id),
           task.title,
           case event.event_kind
             when 'status' then event.to_status::text
             when 'reassigned' then case when event.to_membership_id = me then 'reassigned_you' else 'reassigned' end
             else 'escalated'
           end,
           case when task.matter_id is null then '/sheet/tasks'
                else '/sheet/matters/' || task.matter_id::text || '?tab=tasks' end,
           false
    from public.task_events event
    join public.tasks task
      on task.id = event.task_id
     and task.organization_id = event.organization_id
    left join public.matters matter
      on matter.id = task.matter_id
     and matter.organization_id = task.organization_id
    where event.organization_id = p_org
      and event.created_at > since
      and event.event_kind in ('status', 'reassigned', 'escalated')
      and me is not null
      and event.actor_user_id is distinct from actor
      and (
        exists (
          select 1 from public.task_watchers watcher
          where watcher.task_id = task.id
            and watcher.organization_id = task.organization_id
            and watcher.membership_id = me
        )
        -- The owner when it happened: the one a later reassignment moved it from, else today's owner.
        or (
          event.event_kind in ('status', 'escalated')
          and coalesce(
            (
              select later.from_membership_id
              from public.task_events later
              where later.task_id = task.id
                and later.organization_id = task.organization_id
                and later.event_kind = 'reassigned'
                and later.created_at > event.created_at
              order by later.created_at
              limit 1
            ),
            task.owner_membership_id
          ) = me
        )
        or (event.event_kind = 'reassigned' and event.to_membership_id = me)
        or (event.event_kind = 'escalated' and matter.responsible_consultant_membership_id = me)
      )
      and app.can_read_task(task.id)

    union all
    -- REP-03: a scheduled report (or its test run) was sent to you as a link. Only while your role
    -- still sees that tab; the page checks again when it opens.
    select delivery.id, 'report', delivery.created_at, null::uuid, null::text, sched.title, run.kind,
           delivery.link,
           false
    from public.scheduled_report_deliveries delivery
    join public.scheduled_reports sched
      on sched.id = delivery.schedule_id
     and sched.organization_id = delivery.organization_id
    join public.scheduled_report_runs run
      on run.id = delivery.run_id
     and run.organization_id = delivery.organization_id
    where delivery.organization_id = p_org
      and delivery.user_id = actor
      and delivery.status = 'delivered'
      and delivery.created_at > since
      and app.has_org_role(p_org, app.report_tab_roles(sched.tab))
  )
  select items.source_id, items.kind, items.occurred_at, items.matter_id, items.actor_name, items.subject,
         items.detail, items.href,
         items.seen or exists (
           select 1 from public.staff_notification_reads r
           where r.organization_id = p_org and r.user_id = actor and r.source_id = items.source_id
         )
  from items
  order by items.occurred_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$function$;
