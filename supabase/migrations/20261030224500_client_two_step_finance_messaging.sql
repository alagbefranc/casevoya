-- SEC-01 client two-step, part 3: client funds, invoices and payments, and client notices.
-- Extends app.session_assurance_ok() (20261030200000_client_two_step_enforced_in_db.sql) to the
-- client / self branches of these areas. A portal person with a verified second factor reaches
-- them only from a session that completed it; a client without a factor is unchanged.
--
--   app.is_matter_party   client branch of invoices (app.can_read_invoice, so invoice, payment,
--                         refund and manual-payment reads), card checkout / payment context /
--                         payment intent, credit notes, and the other portal reads that use it.
--   app.is_own_person     client branch of client-fund ledgers, entries, receipts, bank
--                         transfers, and invoice payment receipts.
--   public.portal_notices_for_me, public.dismiss_portal_notice,
--   public.mark_portal_announcements_seen   portal notices and announcements.
--   app.can_read_person_contact, public.set_my_whatsapp_notices   the client's own WhatsApp
--                         notice contact and consent rows, and choosing the notice channel.
--
-- Staff branches are unchanged. Each function is copied from its latest definition (named above
-- it) with only the client condition changed; create or replace keeps grants.


-- From 20261019100100_stripe_connect_invoices.sql (its only definition).
create or replace function app.is_matter_party(p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1
       from public.matter_participants party
       join public.persons person
         on person.id = party.person_id
        and person.organization_id = party.organization_id
       where party.matter_id = p_matter_id
         and person.user_id = (select auth.uid())
     )
     and (select app.session_assurance_ok());
$$;


-- From 20261019120100_client_funds_ledger.sql (its only definition).
create or replace function app.is_own_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.persons person
       where person.id = p_person_id
         and person.user_id = (select auth.uid())
     )
     and (select app.session_assurance_ok());
$$;


-- From 20261025110100_ops_messaging.sql.
create or replace function public.mark_portal_announcements_seen(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if (select auth.uid()) is null then
    raise exception 'sign in is required' using errcode = '42501';
  end if;
  if not app.session_assurance_ok() then
    return 0;
  end if;
  update public.announcement_deliveries delivery
     set seen_at = clock_timestamp()
    from public.persons person
   where delivery.organization_id = p_org
     and person.id = delivery.person_id
     and person.organization_id = delivery.organization_id
     and person.user_id = (select auth.uid())
     and delivery.seen_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;


-- From 20261025110100_ops_messaging.sql.
create or replace function public.portal_notices_for_me(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(item.notice order by item.created_at desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', notice.id, 'kind', notice.kind, 'matter_id', notice.matter_id,
      'matter_title', matter.title, 'consultant_name', notice.consultant_name, 'created_at', notice.created_at
    ) as notice, notice.created_at
    from public.portal_notices notice
    join public.persons person on person.id = notice.person_id and person.organization_id = notice.organization_id
    join public.matters matter on matter.id = notice.matter_id and matter.organization_id = notice.organization_id
    where notice.organization_id = p_org
      and person.user_id = (select auth.uid())
      and (select app.session_assurance_ok())
      and notice.dismissed_at is null
      and notice.created_at > now() - interval '60 days'
    union all
    -- OPS-04: announcements.
    select jsonb_build_object(
      'id', delivery.id, 'kind', 'announcement', 'title', announcement.title,
      'body', announcement.body, 'created_at', announcement.created_at
    ), announcement.created_at
    from public.announcement_deliveries delivery
    join public.announcements announcement
      on announcement.id = delivery.announcement_id
     and announcement.organization_id = delivery.organization_id
    join public.persons person on person.id = delivery.person_id and person.organization_id = delivery.organization_id
    where delivery.organization_id = p_org
      and person.user_id = (select auth.uid())
      and (select app.session_assurance_ok())
      and delivery.dismissed_at is null
      and announcement.created_at > now() - interval '60 days'
  ) item;
$$;


-- From 20261025110100_ops_messaging.sql.
create or replace function public.dismiss_portal_notice(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.session_assurance_ok() then
    raise exception 'notice not found' using errcode = '42501';
  end if;
  update public.portal_notices notice
     set dismissed_at = coalesce(notice.dismissed_at, now())
    from public.persons person
   where notice.id = p_notice_id
     and person.id = notice.person_id
     and person.organization_id = notice.organization_id
     and person.user_id = (select auth.uid());
  if not found then
    -- OPS-04: an announcement.
    update public.announcement_deliveries delivery
       set dismissed_at = coalesce(delivery.dismissed_at, now()),
           seen_at = coalesce(delivery.seen_at, now())
      from public.persons person
     where delivery.id = p_notice_id
       and person.id = delivery.person_id
       and person.organization_id = delivery.organization_id
       and person.user_id = (select auth.uid());
  end if;
  if not found then
    raise exception 'notice not found' using errcode = '42501';
  end if;
end;
$$;


-- From 20261019230100_whatsapp_zernio.sql (its only definition).
create or replace function app.can_read_person_contact(p_person_id uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and (
       (
         exists (
           select 1 from public.persons person
           where person.id = p_person_id
             and person.organization_id = p_org
             and person.user_id = (select auth.uid())
         )
         and (select app.session_assurance_ok())
       )
       or (
         app.staff_mfa_satisfied()
         and (
           app.has_org_role(p_org, array['firm_owner']::public.org_role[])
           or exists (
             select 1
             from public.matter_participants party
             where party.person_id = p_person_id
               and party.organization_id = p_org
               and app.actor_staff_assigned_to_matter(party.matter_id, party.organization_id)
           )
         )
       )
     );
$$;


-- From 20261019230100_whatsapp_zernio.sql (its only definition).
create or replace function public.set_my_whatsapp_notices(p_organization_id uuid, p_channel public.whatsapp_notice_channel)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  me public.persons%rowtype;
  result jsonb;
begin
  if actor is null or app.in_active_org(p_organization_id) is distinct from true
     or not app.session_assurance_ok() then
    raise exception 'whatsapp preference denied' using errcode = '42501';
  end if;
  select * into me from public.persons
  where organization_id = p_organization_id and user_id = actor
  order by created_at
  limit 1;
  if me.id is null or me.is_sample then
    raise exception 'whatsapp preference denied' using errcode = '42501';
  end if;
  result := app.write_whatsapp_contact(p_organization_id, me.id, me.contact_phone, p_channel, 'portal');
  perform app.sync_email_notices(p_organization_id, me.id, p_channel);
  return result;
end;
$$;
