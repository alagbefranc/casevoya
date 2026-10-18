-- Invitation emails carry the private accept link, sealed.
-- The server action that receives the raw token builds the absolute link, encrypts it
-- (AES-256-GCM, key derived from a server secret the database never sees) and attaches
-- the ciphertext to the still-pending invitation email event. The database only ever
-- holds the sealed form, never a usable plaintext token. The mail worker decrypts it,
-- sends, and the sealed link is scrubbed once the delivery is final (20261018190100).
-- Additive only.

-- Removes the sealed link from an outbox event and from every delivery made from it.
create function app.scrub_invitation_link(p_event_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.outbox_events
     set payload = payload - 'sealed_link'
   where id = p_event_id
     and payload ? 'sealed_link';
  update public.email_deliveries
     set context = context - 'sealed_link'
   where outbox_event_id = p_event_id
     and context ? 'sealed_link';
$$;
comment on function app.scrub_invitation_link(uuid) is
  'Drops sealed_link from an invitation email event and its deliveries once mail is final.';
revoke all on function app.scrub_invitation_link(uuid) from public;

-- Attaches the sealed link to the invitation's pending email event.
-- Staff invitation: a firm owner with aal2 and a recent step-up (as create_staff_invitation).
-- Portal invitation: whoever app.actor_can_invite_portal allows (as create_portal_invitation).
-- p_token_hash must equal the invitation's stored sha256(token), so a link can only be
-- attached to the invitation it opens. Returns false when nothing was attached: the
-- invitation is no longer open, the event was already claimed, or a link is already there.
create function public.attach_invitation_email_link(
  p_invitation_id uuid,
  p_sealed text,
  p_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  staff_inv public.invitations%rowtype;
  portal_inv public.portal_invitations%rowtype;
  org uuid;
  stored_hash text;
  is_open boolean;
  event_kind text;
  idem text;
  touched uuid;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_invitation_id is null then
    raise exception 'invitation link denied' using errcode = '42501';
  end if;
  if p_sealed is null
     or length(p_sealed) not between 40 and 1024
     or p_sealed !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'sealed link is invalid' using errcode = '22023';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token hash is invalid' using errcode = '22023';
  end if;

  select * into staff_inv from public.invitations where id = p_invitation_id;
  if staff_inv.id is not null then
    org := staff_inv.organization_id;
    if app.has_org_role(org, array['firm_owner']::public.org_role[]) is distinct from true
       or app.staff_mfa_satisfied() is distinct from true
       or app.mfa_step_up_satisfied() is distinct from true then
      raise exception 'invitation link denied' using errcode = '42501';
    end if;
    stored_hash := staff_inv.token_hash;
    is_open := staff_inv.consumed_at is null
      and staff_inv.revoked_at is null
      and staff_inv.expires_at > statement_timestamp();
    event_kind := 'staff_invitation.email_requested';
    idem := 'staff-invite-email:' || staff_inv.id::text;
  else
    select * into portal_inv from public.portal_invitations where id = p_invitation_id;
    if portal_inv.id is null then
      raise exception 'invitation link denied' using errcode = '42501';
    end if;
    org := portal_inv.organization_id;
    if app.actor_can_invite_portal(org, portal_inv.matter_id) is distinct from true then
      raise exception 'invitation link denied' using errcode = '42501';
    end if;
    stored_hash := portal_inv.token_hash;
    is_open := portal_inv.consumed_at is null
      and portal_inv.revoked_at is null
      and portal_inv.declined_at is null
      and portal_inv.expires_at > statement_timestamp();
    event_kind := 'portal_invitation.email_requested';
    idem := 'portal-invite-email:' || portal_inv.id::text;
  end if;

  if stored_hash is distinct from p_token_hash or is_open is not true then
    return false;
  end if;

  update public.outbox_events event
     set payload = event.payload || jsonb_build_object('sealed_link', p_sealed)
   where event.organization_id = org
     and event.idempotency_key = idem
     and event.event_type = event_kind
     and event.payload ->> 'invitation_id' = p_invitation_id::text
     and event.status = 'pending'
     and not (event.payload ? 'sealed_link')
  returning event.id into touched;
  return touched is not null;
end;
$$;
comment on function public.attach_invitation_email_link(uuid, text, text) is
  'Puts the sealed (encrypted) accept link on a pending invitation email event. Never a plaintext token.';
revoke all on function public.attach_invitation_email_link(uuid, text, text) from public, anon;
grant execute on function public.attach_invitation_email_link(uuid, text, text) to authenticated;
