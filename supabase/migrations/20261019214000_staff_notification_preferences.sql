-- Staff email notification preferences (Sheet > Settings > Notifications). Additive only; no
-- existing function is redefined.
--
-- What the app actually emails a staff member today (src/modules/email/designs/catalog.ts):
--   agreement_signer_turn  EM08-staff  "your turn to countersign"     LOCKED (a client's agreement waits on it)
--   agreement_executed     EM09-staff  the executed copy, staff signer  SWITCHABLE
-- Security and sign-in notices (sign-in, MFA, password, invitations) and every client notice are
-- never switchable here. In-app notifications (Sheet > Notifications) are not emailed and always show.
--
--   staff_notification_preferences   one row per staff membership and switchable kind (email on/off);
--                                    readable only by that member; no direct writes
--   app.staff_notification_switchable(kind)   the list of kinds a person may turn off
--   public.set_staff_notification_preference  the member themselves (own row only), staff MFA;
--                                             refuses a locked or unknown kind; audited
--   email_deliveries_staff_preference         BEFORE INSERT trigger: a staff copy of an executed
--                                             agreement (template signature, context audience staff)
--                                             to someone who turned it off is recorded as skipped,
--                                             never sent. Nothing else is affected.
-- The trigger lives on email_deliveries rather than in prepare_email_delivery so later
-- redefinitions of that function keep respecting the preference.

create table public.staff_notification_preferences (
  organization_id uuid not null references public.organizations (id),
  membership_id uuid not null,
  kind text not null check (kind ~ '^[a-z][a-z_]{2,39}$'),
  email boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  primary key (membership_id, kind),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.staff_notification_preferences is
  'A staff member''s email choice per switchable notification kind. No row means the default (email on). Written only by set_staff_notification_preference.';
create index staff_notification_preferences_org_idx on public.staff_notification_preferences (organization_id);
create index staff_notification_preferences_membership_org_idx on public.staff_notification_preferences (membership_id, organization_id);
create index staff_notification_preferences_updated_by_idx on public.staff_notification_preferences (updated_by);

alter table public.staff_notification_preferences enable row level security;
alter table public.staff_notification_preferences force row level security;
revoke all on public.staff_notification_preferences from public, anon, authenticated;
grant select on public.staff_notification_preferences to authenticated;
grant select on public.staff_notification_preferences to service_role;

-- The member's own rows only (not the owner's: these are personal choices).
create policy staff_notification_preferences_select on public.staff_notification_preferences
  for select to authenticated
  using (
    organization_id = (select app.current_organization_id())
    and exists (
      select 1 from public.memberships m
      where m.id = staff_notification_preferences.membership_id
        and m.organization_id = staff_notification_preferences.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
  );

-- Kinds a person may turn off. Everything else (security, sign-in, critical instructions, client
-- notices) is locked.
create function app.staff_notification_switchable(p_kind text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_kind = any (array['agreement_executed']::text[]), false);
$$;
revoke all on function app.staff_notification_switchable(text) from public;
grant execute on function app.staff_notification_switchable(text) to authenticated, service_role;

create function public.set_staff_notification_preference(p_organization_id uuid, p_kind text, p_email boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  member uuid;
begin
  perform app.require_active_staff(p_organization_id, app.staff_roles(), false);
  if app.staff_notification_switchable(p_kind) is not true then
    raise exception 'that notice can''t be turned off' using errcode = '22023';
  end if;
  if p_email is null then
    raise exception 'choose on or off' using errcode = '22023';
  end if;
  select m.id into member
  from public.memberships m
  where m.organization_id = p_organization_id
    and m.user_id = actor
    and m.status = 'active'
    and m.role = any (app.staff_roles())
  order by m.created_at
  limit 1;
  if member is null then
    raise exception 'staff access denied' using errcode = '42501';
  end if;
  insert into public.staff_notification_preferences (organization_id, membership_id, kind, email, updated_by)
  values (p_organization_id, member, p_kind, p_email, actor)
  on conflict (membership_id, kind) do update
    set email = excluded.email,
        updated_at = now(),
        updated_by = actor;
  perform app.record_audit_event(
    p_organization_id, 'notifications.preference_changed', 'staff_notification_preferences', member, 'success',
    jsonb_build_object('kind', p_kind, 'email', p_email)
  );
end;
$$;
revoke all on function public.set_staff_notification_preference(uuid, text, boolean) from public, anon;
grant execute on function public.set_staff_notification_preference(uuid, text, boolean) to authenticated, service_role;

-- Whether a staff member of the firm with this email turned this kind of email off.
create function app.staff_email_opted_out(p_org uuid, p_email text, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.staff_notification_switchable(p_kind) and exists (
    select 1
    from public.staff_notification_preferences pref
    join public.memberships m
      on m.id = pref.membership_id
     and m.organization_id = pref.organization_id
    join auth.users u on u.id = m.user_id
    where pref.organization_id = p_org
      and pref.kind = p_kind
      and pref.email is false
      and lower(u.email) = lower(btrim(coalesce(p_email, '')))
  );
$$;
revoke all on function app.staff_email_opted_out(uuid, text, text) from public;
grant execute on function app.staff_email_opted_out(uuid, text, text) to service_role;

create function app.email_deliveries_staff_preference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'sending'
     and new.template = 'signature'
     and coalesce(new.context ->> 'audience', '') = 'staff'
     and app.staff_email_opted_out(new.organization_id, new.recipient_email, 'agreement_executed') then
    new.status := 'skipped';
    new.attempt_count := 0;
    new.last_error := 'not sent: the recipient turned this email off in Settings > Notifications';
  end if;
  return new;
end;
$$;
revoke all on function app.email_deliveries_staff_preference() from public;

create trigger email_deliveries_staff_preference before insert on public.email_deliveries
  for each row execute function app.email_deliveries_staff_preference();
