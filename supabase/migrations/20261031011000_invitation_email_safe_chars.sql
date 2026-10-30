-- Invitation emails: refuse markup and quoting characters.
-- An email address stored on an invitation is shown on public screens (the anonymous invitation
-- preview), so it may not contain any of < > " ' ` ( ) ; , \ or a control character.
--
--   * app.email_chars_ok(text): the rule, as one immutable helper.
--   * app.normalize_email: latest definition from 20261017140700_firm_onboarding.sql; now also
--     returns null for an address that breaks the rule. app.issue_portal_invitation (behind
--     public.create_portal_invitation and resend) already answers 'invalid_email' for null, and
--     the firm contact emails that use it get the same rule.
--   * app.create_staff_invitation: latest definition from 20261020160100_subscription_billing.sql;
--     only the email check changes.
--   * Check constraints on public.invitations.email and public.portal_invitations.email with the
--     same rule, NOT VALID so rows written before this migration are not re-checked.
-- Additive: create or replace keeps grants; constraints are added only when missing.

create or replace function app.email_chars_ok(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_email is not null
     and p_email !~ '[<>"''`();,\\]'
     and p_email !~ '[[:cntrl:]]';
$$;
revoke all on function app.email_chars_ok(text) from public;
comment on function app.email_chars_ok(text) is
  'False when the address contains any of < > " '' ` ( ) ; , \ or a control character.';

create or replace function app.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(p_email, ''))) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     and length(lower(btrim(p_email))) <= 320
     and app.email_chars_ok(lower(btrim(p_email)))
    then lower(btrim(p_email))
    else null
  end;
$$;
revoke all on function app.normalize_email(text) from public;

create or replace function app.create_staff_invitation(
  p_organization_id uuid,
  p_email text,
  p_role public.org_role
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  token text;
  inv public.invitations;
  entitlements jsonb;
  seat_limit integer;
  seats_used integer;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if app.has_org_role(p_organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'only a firm owner can invite staff' using errcode = '42501';
  end if;
  if app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'staff invitations require a recent TOTP step-up' using errcode = '42501';
  end if;
  if p_role is null or p_role <> all (app.staff_roles()) then
    raise exception 'this invitation path is for staff roles only' using errcode = '42501';
  end if;
  if normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or length(normalized_email) > 320
     or app.email_chars_ok(normalized_email) is distinct from true then
    raise exception 'email is invalid' using errcode = '22023';
  end if;

  entitlements := app.subscription_entitlements(p_organization_id);
  if (entitlements ->> 'new_work_blocked')::boolean then
    raise exception 'subscription paused: choose a plan in Settings > Subscription before inviting staff' using errcode = '42501';
  end if;
  seat_limit := (entitlements ->> 'seats')::integer;
  if seat_limit is not null then
    select count(*) into seats_used from (
      select mem.id from public.memberships mem
       where mem.organization_id = p_organization_id and mem.status = 'active' and mem.role = any (app.staff_roles())
      union all
      select prior.id from public.invitations prior
       where prior.organization_id = p_organization_id
         and prior.role = any (app.staff_roles())
         and prior.consumed_at is null
         and prior.revoked_at is null
         and prior.expires_at > statement_timestamp()
         and prior.email <> normalized_email
    ) used;
    if seats_used >= seat_limit then
      raise exception 'seat allowance reached: % of % staff seats are in use; add a seat in Settings > Subscription', seats_used, seat_limit
        using errcode = '42501';
    end if;
  end if;

  update public.invitations as prior
     set revoked_at = statement_timestamp()
   where prior.organization_id = p_organization_id
     and prior.email = normalized_email
     and prior.role = p_role
     and prior.consumed_at is null
     and prior.revoked_at is null;

  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (organization_id, email, role, token_hash, expires_at, created_by)
  values (
    p_organization_id,
    normalized_email,
    p_role,
    app.hash_invitation_token(token),
    statement_timestamp() + interval '7 days',
    actor
  )
  returning * into inv;

  perform app.record_audit_event(
    p_organization_id,
    'invitation.created',
    'public.invitations',
    inv.id,
    'success',
    jsonb_build_object('role', p_role)
  );
  perform app.enqueue_event(
    p_organization_id,
    'invitation',
    inv.id,
    'staff_invitation.email_requested',
    jsonb_build_object(
      'invitation_id', inv.id,
      'role', p_role,
      'recipient_email', normalized_email
    ),
    null,
    'staff-invite-email:' || inv.id::text,
    null
  );
  return token;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.invitations'::regclass and conname = 'invitations_email_safe_chars'
  ) then
    alter table public.invitations
      add constraint invitations_email_safe_chars
      check (email !~ '[<>"''`();,\\]' and email !~ '[[:cntrl:]]') not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.portal_invitations'::regclass and conname = 'portal_invitations_email_safe_chars'
  ) then
    alter table public.portal_invitations
      add constraint portal_invitations_email_safe_chars
      check (email !~ '[<>"''`();,\\]' and email !~ '[[:cntrl:]]') not valid;
  end if;
end;
$$;
