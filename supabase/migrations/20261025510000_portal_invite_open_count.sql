-- Bug 3 (2026-10-25, #215 live checks): the client accept wizard ran app.present_portal_invitation
-- on every step and every retry (the page, each draft save, the sign-in, the code, the acceptance),
-- and each call counted toward the 'present' limits (40 per token per hour, 30 per signed-in actor
-- per 15 minutes). A client hit them within a few tries.
--
-- Now only an OPEN of the invitation counts: public.preview_portal_invitation(p_token, true),
-- which the accept screen calls once per page load. Every other use of the token (the server's
-- own re-reads, draft saves, sign-in, acceptance, decline, mismatch report) checks the same limits
-- without adding to them, so a token already over its limit stays refused. A token that matches
-- no invitation is always counted, so guessing tokens stays limited.
--
-- Changes:
--   app.portal_invite_limited(text, text, uuid, boolean): new. The latest 3-argument body
--     (20261017140800_portal_invitations.sql) with p_record: false checks without inserting.
--   app.portal_invite_limited(text, text, uuid): now calls the 4-argument form with p_record true.
--   app.present_portal_invitation(text): latest body (20261017140800) with the count made
--     conditional on app.portal_invitation_open = '1' (or an unknown token).
--   public.preview_portal_invitation(text, boolean): new. Sets app.portal_invitation_open for this
--     transaction and returns public.preview_portal_invitation(text) (unchanged, latest in
--     20261024100000_firm_default_locale.sql), which on its own is now an uncounted read.

create function app.portal_invite_limited(
  p_action text,
  p_token_hash text,
  p_organization_id uuid,
  p_record boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  present_count integer;
  actor_count integer;
  org_count integer;
  actor uuid := (select auth.uid());
begin
  if p_record then
    insert into public.portal_invite_attempts (organization_id, actor_user_id, token_hash, action)
    values (p_organization_id, actor, p_token_hash, p_action);
  end if;

  if p_action = 'present' then
    select count(*) into present_count
    from public.portal_invite_attempts attempt
    where attempt.token_hash = p_token_hash
      and attempt.action = 'present'
      and attempt.created_at > statement_timestamp() - interval '1 hour';
    if present_count > 40 then
      return true;
    end if;
    if actor is not null then
      select count(*) into actor_count
      from public.portal_invite_attempts attempt
      where attempt.actor_user_id = actor
        and attempt.action = 'present'
        and attempt.created_at > statement_timestamp() - interval '15 minutes';
      if actor_count > 30 then
        return true;
      end if;
    end if;
    return false;
  end if;

  select count(*) into org_count
  from public.portal_invite_attempts attempt
  where attempt.organization_id = p_organization_id
    and attempt.action in ('create', 'resend')
    and attempt.created_at > statement_timestamp() - interval '1 hour';
  if org_count > 30 then
    return true;
  end if;
  if actor is not null then
    select count(*) into actor_count
    from public.portal_invite_attempts attempt
    where attempt.actor_user_id = actor
      and attempt.action in ('create', 'resend')
      and attempt.created_at > statement_timestamp() - interval '1 hour';
    if actor_count > 10 then
      return true;
    end if;
  end if;
  return false;
end;
$$;
revoke all on function app.portal_invite_limited(text, text, uuid, boolean) from public;

create or replace function app.portal_invite_limited(
  p_action text,
  p_token_hash text,
  p_organization_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return app.portal_invite_limited(p_action, p_token_hash, p_organization_id, true);
end;
$$;
revoke all on function app.portal_invite_limited(text, text, uuid) from public;

create or replace function app.present_portal_invitation(p_token text)
returns public.portal_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  hashed text := app.portal_token_hash(p_token);
  inv public.portal_invitations;
  counted boolean;
begin
  perform set_config('app.portal_rate_limited', '', true);
  if hashed is null then
    return null;
  end if;
  select * into inv from public.portal_invitations where token_hash = hashed;
  -- Only an open of the invitation (or a token that matches nothing) adds to the count.
  counted := coalesce(current_setting('app.portal_invitation_open', true), '') = '1' or inv.id is null;
  -- One open per call: a later use in the same transaction is not another open.
  perform set_config('app.portal_invitation_open', '', true);
  if app.portal_invite_limited('present', hashed, inv.organization_id, counted) then
    perform set_config('app.portal_rate_limited', '1', true);
    return null;
  end if;
  select * into inv
  from public.portal_invitations
  where token_hash = hashed
  for update;
  return inv;
end;
$$;
revoke all on function app.present_portal_invitation(text) from public;

create function public.preview_portal_invitation(p_token text, p_open boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.portal_invitation_open', case when p_open then '1' else '' end, true);
  return public.preview_portal_invitation(p_token);
end;
$$;
revoke all on function public.preview_portal_invitation(text, boolean) from public;
grant execute on function public.preview_portal_invitation(text, boolean) to anon, authenticated;
