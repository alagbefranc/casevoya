-- WhatsApp / Zernio binding is written by the server only.
--
-- The firm's Zernio profile id and WhatsApp account id are checked against Zernio by the server
-- actions (src/modules/whatsapp/actions.ts) before they are stored, so the database no longer
-- accepts them from a signed-in session:
--   * public.save_firm_zernio_profile and public.connect_firm_whatsapp are service role only.
--     New overloads take p_actor (the firm owner's user id, recorded as connected_by and in the
--     audit context); the actor must be an active firm owner of the organization.
--   * public.assert_firm_owner_step_up(org) lets the server confirm, with the user's own session,
--     that the caller is the firm owner with a recent step-up before it uses the service role.
--   * A Zernio profile id belongs to one organization only, and a WhatsApp account id is held by
--     one organization row at a time (connected or not). A different firm can take over an
--     account id only after the holder disconnected it, and only through the server path.
-- scripts/ops/zernio-whatsapp.mjs keeps calling the 4-argument connect_firm_whatsapp as the
-- service role to link the sandbox number.

-- ---------------------------------------------------------------------------
-- Existing data: keep one holder per profile id and per account id before the unique indexes.
-- ---------------------------------------------------------------------------

update public.firm_whatsapp_accounts a
   set zernio_account_id = null, updated_at = now(), version = a.version + 1
 where a.status <> 'connected'
   and a.zernio_account_id is not null
   and exists (
     select 1 from public.firm_whatsapp_accounts b
     where b.zernio_account_id = a.zernio_account_id
       and b.organization_id <> a.organization_id
       and (b.status = 'connected'
            or (b.status <> 'connected' and (b.updated_at, b.organization_id) > (a.updated_at, a.organization_id)))
   );

update public.firm_whatsapp_accounts a
   set zernio_profile_id = null, updated_at = now(), version = a.version + 1
 where a.status <> 'connected'
   and a.zernio_profile_id is not null
   and exists (
     select 1 from public.firm_whatsapp_accounts b
     where b.zernio_profile_id = a.zernio_profile_id
       and b.organization_id <> a.organization_id
       and (b.status = 'connected'
            or (b.status <> 'connected' and (b.created_at, b.organization_id) < (a.created_at, a.organization_id)))
   );

create unique index if not exists firm_whatsapp_accounts_profile_uidx
  on public.firm_whatsapp_accounts (zernio_profile_id) where zernio_profile_id is not null;

create unique index if not exists firm_whatsapp_accounts_account_any_uidx
  on public.firm_whatsapp_accounts (zernio_account_id) where zernio_account_id is not null;

-- ---------------------------------------------------------------------------
-- Session check used by the server before it writes with the service role
-- ---------------------------------------------------------------------------

create or replace function public.assert_firm_owner_step_up(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  return true;
end;
$$;
revoke all on function public.assert_firm_owner_step_up(uuid) from public, anon;
grant execute on function public.assert_firm_owner_step_up(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Internal writers (no grants)
-- ---------------------------------------------------------------------------

create or replace function app.require_service_role()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'service role only' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.require_service_role() from public;

create or replace function app.require_active_firm_owner(p_organization_id uuid, p_actor uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor is null or not exists (
    select 1 from public.memberships m
    where m.organization_id = p_organization_id
      and m.user_id = p_actor
      and m.role = 'firm_owner'
      and m.status = 'active'
  ) then
    raise exception 'firm owner step-up is required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.require_active_firm_owner(uuid, uuid) from public;

create or replace function app.save_firm_zernio_profile_core(p_organization_id uuid, p_profile_id text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cur public.firm_whatsapp_accounts%rowtype;
begin
  if p_profile_id is null or p_profile_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'profile id is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.firm_whatsapp_accounts other
    where other.zernio_profile_id = p_profile_id
      and other.organization_id <> p_organization_id
  ) then
    raise exception 'that Zernio profile belongs to another firm' using errcode = '23505';
  end if;
  select * into v_cur from public.firm_whatsapp_accounts where organization_id = p_organization_id for update;
  if v_cur.organization_id is null then
    insert into public.firm_whatsapp_accounts (organization_id, zernio_profile_id, status)
    values (p_organization_id, p_profile_id, 'pending');
  elsif v_cur.zernio_profile_id is distinct from p_profile_id then
    if v_cur.status = 'connected' then
      raise exception 'disconnect WhatsApp before changing the profile' using errcode = '42501';
    end if;
    update public.firm_whatsapp_accounts
       set zernio_profile_id = p_profile_id, updated_at = now(), version = version + 1
     where organization_id = p_organization_id;
  else
    return;
  end if;
  perform app.record_audit_event(p_organization_id, 'whatsapp.profile_saved', 'public.firm_whatsapp_accounts', null, 'success',
    case when p_actor is null then '{}'::jsonb else jsonb_build_object('actor_user_id', p_actor) end);
end;
$$;
revoke all on function app.save_firm_zernio_profile_core(uuid, text, uuid) from public;

-- p_require_profile: the app path needs the firm's own profile (and never the sandbox); the
-- operator's sandbox link does not.
create or replace function app.connect_firm_whatsapp_core(
  p_organization_id uuid,
  p_account_id text,
  p_display_phone text,
  p_sandbox boolean,
  p_actor uuid,
  p_require_profile boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cur public.firm_whatsapp_accounts%rowtype;
begin
  if p_account_id is null or p_account_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'account id is invalid' using errcode = '22023';
  end if;
  select * into v_cur from public.firm_whatsapp_accounts where organization_id = p_organization_id for update;
  if p_require_profile and v_cur.zernio_profile_id is null then
    raise exception 'start the WhatsApp connection from Settings first' using errcode = '42501';
  end if;
  -- Another firm holding this account id (connected or not yet released) keeps it, unless it
  -- disconnected: then the id is released to this firm, which the server has just verified.
  perform 1 from public.firm_whatsapp_accounts other
   where other.zernio_account_id = p_account_id
     and other.organization_id <> p_organization_id
   for update;
  if exists (
    select 1 from public.firm_whatsapp_accounts other
    where other.zernio_account_id = p_account_id
      and other.organization_id <> p_organization_id
      and other.status <> 'disconnected'
  ) then
    raise exception 'that WhatsApp number is connected to another firm' using errcode = '23505';
  end if;
  update public.firm_whatsapp_accounts other
     set zernio_account_id = null, updated_at = now(), version = other.version + 1
   where other.zernio_account_id = p_account_id
     and other.organization_id <> p_organization_id
     and other.status = 'disconnected';
  insert into public.firm_whatsapp_accounts (
    organization_id, zernio_profile_id, zernio_account_id, display_phone, status, is_sandbox, connected_at, connected_by
  ) values (
    p_organization_id, v_cur.zernio_profile_id, p_account_id, left(nullif(btrim(coalesce(p_display_phone, '')), ''), 40), 'connected',
    coalesce(p_sandbox, false), clock_timestamp(), p_actor
  )
  on conflict (organization_id) do update
    set zernio_account_id = excluded.zernio_account_id,
        display_phone = excluded.display_phone,
        status = 'connected',
        is_sandbox = excluded.is_sandbox,
        connected_at = excluded.connected_at,
        connected_by = excluded.connected_by,
        disconnected_at = null,
        disconnected_by = null,
        updated_at = now(),
        version = public.firm_whatsapp_accounts.version + 1;
  perform app.record_audit_event(p_organization_id, 'whatsapp.connected', 'public.firm_whatsapp_accounts', null, 'success',
    jsonb_build_object('sandbox', coalesce(p_sandbox, false))
      || case when p_actor is null then '{}'::jsonb else jsonb_build_object('actor_user_id', p_actor) end);
end;
$$;
revoke all on function app.connect_firm_whatsapp_core(uuid, text, text, boolean, uuid, boolean) from public;

-- ---------------------------------------------------------------------------
-- Public entry points (service role only)
-- ---------------------------------------------------------------------------

-- Existing signature: service role only now (kept for compatibility, no actor recorded).
create or replace function public.save_firm_zernio_profile(p_organization_id uuid, p_profile_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_service_role();
  perform app.save_firm_zernio_profile_core(p_organization_id, p_profile_id, null);
end;
$$;
revoke all on function public.save_firm_zernio_profile(uuid, text) from public, anon, authenticated;
grant execute on function public.save_firm_zernio_profile(uuid, text) to service_role;

-- The server, after it confirmed the owner's step-up with their session.
create or replace function public.save_firm_zernio_profile(p_organization_id uuid, p_profile_id text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_service_role();
  perform app.require_active_firm_owner(p_organization_id, p_actor);
  perform app.save_firm_zernio_profile_core(p_organization_id, p_profile_id, p_actor);
end;
$$;
revoke all on function public.save_firm_zernio_profile(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.save_firm_zernio_profile(uuid, text, uuid) to service_role;

-- Existing signature: the operator's sandbox link (scripts/ops/zernio-whatsapp.mjs).
create or replace function public.connect_firm_whatsapp(
  p_organization_id uuid,
  p_account_id text,
  p_display_phone text default null,
  p_sandbox boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_service_role();
  perform app.connect_firm_whatsapp_core(p_organization_id, p_account_id, p_display_phone, p_sandbox, null, false);
end;
$$;
revoke all on function public.connect_firm_whatsapp(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.connect_firm_whatsapp(uuid, text, text, boolean) to service_role;

-- The server records the account Embedded Signup returned, after checking with Zernio that it
-- is a WhatsApp account on this firm's profile. Never the sandbox.
create or replace function public.connect_firm_whatsapp(
  p_organization_id uuid,
  p_account_id text,
  p_display_phone text,
  p_sandbox boolean,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_service_role();
  perform app.require_active_firm_owner(p_organization_id, p_actor);
  if coalesce(p_sandbox, false) then
    raise exception 'the sandbox number is linked by the operator only' using errcode = '42501';
  end if;
  perform app.connect_firm_whatsapp_core(p_organization_id, p_account_id, p_display_phone, false, p_actor, true);
end;
$$;
revoke all on function public.connect_firm_whatsapp(uuid, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.connect_firm_whatsapp(uuid, text, text, boolean, uuid) to service_role;
