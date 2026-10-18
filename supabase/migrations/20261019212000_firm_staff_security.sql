-- Sign-in security per staff member, for the Sheet's Settings > Team and seats and Security tabs
-- (SEC-01, ORG-02).
--
-- public.firm_staff_directory already returns whether a verified second factor is enrolled. It
-- does not see passkeys (a primary login that satisfies staff MFA here, see DECISIONS 2026-10-17)
-- or sign-in sessions, which live in auth tables the API cannot read. firm_staff_security(org)
-- returns, for each active or suspended staff membership of the firm:
--   * second_factor: a verified auth.mfa_factors row (same test as firm_staff_directory);
--   * passkeys: how many passkeys are registered (auth.webauthn_credentials), or null when that
--     table does not exist;
--   * active_sessions: sign-in sessions that have not ended, been revoked
--     (public.session_revocations) or been cut off by an MFA reset (public.auth_session_cutoffs),
--     or null when auth.sessions does not exist;
--   * last_active_at: the latest of those sessions' refresh, update or start time.
-- Counts and times only: no session ids, user agents, IP addresses or credential material.
--
-- Firm owner only, active in the firm, with staff MFA satisfied (app.require_active_staff); anyone
-- else is refused. Read-only: nothing is written, so it is not audited (like the directory). New
-- function only: no table, policy or RLS change.

create function public.firm_staff_security(p_organization_id uuid)
returns table (
  membership_id uuid,
  second_factor boolean,
  passkeys integer,
  active_sessions integer,
  last_active_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  has_passkeys boolean;
  has_sessions boolean;
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner']::public.org_role[], false);

  has_passkeys := exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'webauthn_credentials' and column_name = 'user_id'
  );
  has_sessions := exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'sessions' and column_name = 'not_after'
  );

  return query execute format(
    $sql$
      select
        mem.id,
        exists (
          select 1
          from auth.mfa_factors factor
          where factor.user_id = mem.user_id
            and factor.status::text = 'verified'
        ),
        %1$s,
        %2$s,
        %3$s
      from public.memberships mem
      where mem.organization_id = $1
        and mem.role = any (app.staff_roles())
        and mem.status in ('active'::public.membership_status, 'suspended'::public.membership_status)
      order by (mem.role = 'firm_owner'::public.org_role) desc, mem.accepted_at nulls last, mem.created_at, mem.id
    $sql$,
    case when has_passkeys then
      '(select count(*)::integer from auth.webauthn_credentials cred where cred.user_id = mem.user_id)'
    else 'null::integer' end,
    case when has_sessions then
      $s$(select count(*)::integer
          from auth.sessions s
          left join public.auth_session_cutoffs cut on cut.user_id = s.user_id
          where s.user_id = mem.user_id
            and (s.not_after is null or s.not_after > statement_timestamp())
            and (cut.sessions_valid_after is null or s.created_at >= cut.sessions_valid_after)
            and not exists (
              select 1 from public.session_revocations r
              where r.user_id = s.user_id and r.session_id = s.id
            ))$s$
    else 'null::integer' end,
    case when has_sessions then
      $s$(select max(coalesce(s.refreshed_at, s.updated_at, s.created_at))
          from auth.sessions s
          left join public.auth_session_cutoffs cut on cut.user_id = s.user_id
          where s.user_id = mem.user_id
            and (cut.sessions_valid_after is null or s.created_at >= cut.sessions_valid_after)
            and not exists (
              select 1 from public.session_revocations r
              where r.user_id = s.user_id and r.session_id = s.id
            ))$s$
    else 'null::timestamptz' end
  )
  using p_organization_id;
end;
$$;
comment on function public.firm_staff_security(uuid) is
  'Firm owner only: per staff membership, a verified second factor, passkey count, open sign-in sessions and last activity. Counts and times only.';
revoke all on function public.firm_staff_security(uuid) from public, anon;
grant execute on function public.firm_staff_security(uuid) to authenticated;
