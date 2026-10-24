-- AI vendor terms acknowledgement (PRD AI-06; gap AI-06 criteria 2 and 3). Additive only; no
-- existing function is redefined.
--
-- The vendor terms themselves (Anthropic for Vo, Cloudflare Workers AI for "Draft in French"),
-- quoted from each vendor's published terms with URL, section, page date, retrieval date and page
-- hash, are reviewed configuration in src/modules/vo/vendor-terms.ts. Their version is repeated in
-- app.vo_vendor_terms_version() below; a test keeps the two equal. A content change ships with a
-- new migration that redefines that function, and the firm owner acknowledges the new version
-- before Vo can be turned on again.
--
-- Table
--   vo_vendor_terms_acknowledgements  one row per firm and terms version: who acknowledged (the
--                                     firm owner), when, and which version. Never changed or
--                                     removed (no update or delete grant, no write policy).
--
-- Functions
--   app.vo_vendor_terms_version()            the current terms version.
--   app.vo_vendor_terms_acknowledged(org)    whether the firm acknowledged the current version.
--   public.acknowledge_vo_vendor_terms       firm owner with staff MFA; only the current version.
--                                            Audited vo.vendor_terms_acknowledged.
--   app.vo_settings_require_vendor_terms     BEFORE INSERT OR UPDATE trigger on vo_settings:
--                                            turning Vo on (from off) without the current
--                                            version acknowledged is refused, whatever the path
--                                            (set_vo_settings, set_composio_enabled, a direct
--                                            write). Turning Vo off, other switches, and a firm
--                                            whose Vo is already on are not affected.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.vo_vendor_terms_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  terms_version text not null check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]{1,3}$'),
  acknowledged_by uuid not null references auth.users (id),
  acknowledged_at timestamptz not null default now(),
  unique (organization_id, terms_version)
);
comment on table public.vo_vendor_terms_acknowledgements is
  'The firm owner''s acknowledgement of the AI vendor terms panel (Settings > Vo), per terms version. Needed before Vo is turned on (AI-06).';
create index vo_vendor_terms_ack_by_idx on public.vo_vendor_terms_acknowledgements (acknowledged_by);

alter table public.vo_vendor_terms_acknowledgements enable row level security;
alter table public.vo_vendor_terms_acknowledgements force row level security;

revoke all on public.vo_vendor_terms_acknowledgements from public, anon, authenticated;
grant select on public.vo_vendor_terms_acknowledgements to authenticated;
grant select on public.vo_vendor_terms_acknowledgements to service_role;

-- Firm staff who can read the Vo switches can read who acknowledged the terms.
create policy vo_vendor_terms_ack_select on public.vo_vendor_terms_acknowledgements
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Must equal VO_VENDOR_TERMS.version in src/modules/vo/vendor-terms.ts (tests/vo-vendor-terms.test.ts).
create function app.vo_vendor_terms_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select '2026-10-24.1'::text;
$$;
revoke all on function app.vo_vendor_terms_version() from public;
grant execute on function app.vo_vendor_terms_version() to authenticated, service_role;

create function app.vo_vendor_terms_acknowledged(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.vo_vendor_terms_acknowledgements a
    where a.organization_id = p_org
      and a.terms_version = app.vo_vendor_terms_version()
  );
$$;
revoke all on function app.vo_vendor_terms_acknowledged(uuid) from public;
grant execute on function app.vo_vendor_terms_acknowledged(uuid) to authenticated, service_role;

-- The firm owner acknowledges the version shown on the page; a stale page (older version) is refused.
create function public.acknowledge_vo_vendor_terms(p_organization_id uuid, p_terms_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  current_version text := app.vo_vendor_terms_version();
  saved public.vo_vendor_terms_acknowledgements%rowtype;
begin
  perform app.require_active_staff(p_organization_id, array['firm_owner']::public.org_role[], false);
  if p_terms_version is distinct from current_version then
    raise exception 'the AI vendor terms changed: reload and review them again' using errcode = '22023';
  end if;
  select * into saved
  from public.vo_vendor_terms_acknowledgements a
  where a.organization_id = p_organization_id and a.terms_version = current_version;
  if saved.id is not null then
    return jsonb_build_object('terms_version', saved.terms_version, 'acknowledged_at', saved.acknowledged_at, 'already', true);
  end if;
  insert into public.vo_vendor_terms_acknowledgements (organization_id, terms_version, acknowledged_by)
  values (p_organization_id, current_version, actor)
  returning * into saved;
  perform app.record_audit_event(
    p_organization_id, 'vo.vendor_terms_acknowledged', 'vo_vendor_terms_acknowledgements', saved.id, 'success',
    jsonb_build_object('terms_version', saved.terms_version)
  );
  return jsonb_build_object('terms_version', saved.terms_version, 'acknowledged_at', saved.acknowledged_at, 'already', false);
end;
$$;
revoke all on function public.acknowledge_vo_vendor_terms(uuid, text) from public, anon;
grant execute on function public.acknowledge_vo_vendor_terms(uuid, text) to authenticated, service_role;

-- Turning Vo on (from off: the saved switch, or with no row yet the sample-mode default) needs the
-- current terms version acknowledged.
create function app.vo_settings_require_vendor_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_on boolean;
begin
  if new.enabled is not true then
    return new;
  end if;
  if tg_op = 'INSERT' then
    was_on := app.vo_enabled(new.organization_id);
  else
    was_on := old.enabled;
  end if;
  if was_on is not true and not app.vo_vendor_terms_acknowledged(new.organization_id) then
    raise exception 'acknowledge the AI vendor terms before turning Vo on' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.vo_settings_require_vendor_terms() from public;

create trigger vo_settings_require_vendor_terms
  before insert or update of enabled on public.vo_settings
  for each row execute function app.vo_settings_require_vendor_terms();
