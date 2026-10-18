-- The staff accept screen says "<inviter> invited you as a <role>", but preview_invitation has
-- no inviter, so it read "the person who invited you invited you". Changing that function's
-- result columns would need a drop, so this separate lookup returns only the inviter's display
-- name, for a token that is still valid. Same token rules as preview_invitation; nothing else
-- about the firm or the inviter is returned. New function only.

create function public.preview_invitation_inviter(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rec public.invitations%rowtype;
  name text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into rec
  from public.invitations
  where token_hash = app.hash_invitation_token(p_token);
  if not found
     or rec.consumed_at is not null
     or rec.revoked_at is not null
     or rec.expires_at <= now()
     or rec.created_by is null then
    return null;
  end if;
  select nullif(btrim(p.display_name), '') into name
  from public.profiles p
  where p.id = rec.created_by;
  return left(name, 120);
end;
$$;
revoke all on function public.preview_invitation_inviter(text) from public;
grant execute on function public.preview_invitation_inviter(text) to anon, authenticated, service_role;
comment on function public.preview_invitation_inviter(text) is
  'Display name of whoever created a still-valid staff invitation, for the accept screen.';
