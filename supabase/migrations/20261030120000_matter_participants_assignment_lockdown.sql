-- Matter team membership and matter edits are limited to the matter's own staff.
--
-- 1. public.matter_participants. app.actor_staff_assigned_to_matter (and through it person,
--    section and intake access) trusts any participant row naming the caller's membership, and a
--    person row naming a login opens the portal path of app.can_read_matter. The insert and update
--    policies only required app.can_insert_practice_row (any owner, consultant or case manager of
--    the firm), so a participant row could be written onto any matter in the firm.
--    Now:
--    * INSERT needs app.can_insert_practice_row and one of:
--      - the firm owner (owner join path; every insert is audited by matter_participants_audit);
--      - staff already assigned to that matter;
--      - the matter's creator. For a staff (membership) row only while the matter is made in this
--        same transaction (public.create_engaged_matter and app.create_client_matter_as are
--        invoker and add the consultant and the creator right after inserting the matter), so a
--        creator taken off the team cannot re-add themselves. matters.created_at and created_by
--        cannot move after insert (app.touch_row).
--      For a person row, a non-owner must already be able to read that person
--      (app.can_read_person), so attaching a person to a matter never widens who can read them.
--    * UPDATE is no longer granted to API roles. Every legitimate re-pointing (consultant
--      reassignment, offboarding handover, sample case) runs in SECURITY DEFINER functions as the
--      table owner. A trigger refuses API-role updates in case of a future re-grant, as for
--      memberships (20261018010100_memberships_write_lockdown.sql).
-- 2. public.matters UPDATE. matters_update used app.can_read_matter, which also admits portal
--    clients and access-grant holders. Direct updates now need the staff read paths of
--    app.can_read_matter only (firm owner, assigned staff, or the creating consultant or case
--    manager) with staff MFA. Lifecycle columns stay behind their definer functions.
-- Additive: policies are altered in place, functions are new.

-- ---------------------------------------------------------------------------
-- 1. matter_participants
-- ---------------------------------------------------------------------------
create or replace function app.can_write_matter_participant(
  p_matter_id uuid,
  p_org uuid,
  p_membership_id uuid,
  p_person_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.can_insert_practice_row(p_org)
    and (
      app.actor_is_firm_owner(p_org)
      or (
        (p_person_id is null or app.can_read_person(p_person_id))
        and (
          app.actor_staff_assigned_to_matter(p_matter_id, p_org)
          or exists (
            select 1
            from public.matters matter
            where matter.id = p_matter_id
              and matter.organization_id = p_org
              and matter.created_by = (select auth.uid())
              -- A staff row only while the matter is made in this transaction (now() is the
              -- transaction start, as matters.created_at's default).
              and (p_membership_id is null or matter.created_at = now())
          )
        )
      )
    ),
    false
  );
$$;
comment on function app.can_write_matter_participant(uuid, uuid, uuid, uuid) is
  'Direct participant insert: practice staff who are the firm owner, already assigned to the matter, or its creator (a staff row only in the creating transaction). A non-owner may attach only a person they can already read.';
revoke all on function app.can_write_matter_participant(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function app.can_write_matter_participant(uuid, uuid, uuid, uuid) to authenticated, service_role;

alter policy matter_participants_insert on public.matter_participants
  with check ((select app.can_write_matter_participant(matter_id, organization_id, membership_id, person_id)));

revoke update on table public.matter_participants from anon, authenticated;

alter policy matter_participants_update on public.matter_participants
  using (false)
  with check (false);

create or replace function app.guard_matter_participant_api_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Invoker on purpose: definer functions run as their owner and pass.
  if current_user in ('authenticated', 'anon') then
    raise exception 'matter team changes go through the assignment functions' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_matter_participant_api_updates() from public;
comment on function app.guard_matter_participant_api_updates() is
  'Refuses direct API-role updates on matter_participants. Re-pointing a participant happens only inside definer functions.';

create trigger matter_participants_api_updates before update on public.matter_participants
  for each row execute function app.guard_matter_participant_api_updates();

-- ---------------------------------------------------------------------------
-- 2. matters UPDATE: staff of the matter only
-- ---------------------------------------------------------------------------
-- The staff branches of app.can_read_matter (portal participant and access-grant paths excluded).
create or replace function app.can_staff_write_matter(p_matter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matters matter
    where matter.id = p_matter_id
      and app.in_active_org(matter.organization_id)
      and app.staff_mfa_satisfied()
      and (
        app.actor_is_firm_owner(matter.organization_id)
        or app.actor_staff_assigned_to_matter(matter.id, matter.organization_id)
        or (
          matter.created_by = (select auth.uid())
          and app.has_org_role(
            matter.organization_id,
            array['licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
      )
  );
$$;
comment on function app.can_staff_write_matter(uuid) is
  'Direct matter update: firm owner, staff assigned to the matter, or its creating consultant or case manager, with staff MFA. Portal and grant readers are excluded.';
revoke all on function app.can_staff_write_matter(uuid) from public, anon;
grant execute on function app.can_staff_write_matter(uuid) to authenticated, service_role;

alter policy matters_update on public.matters
  using ((select app.can_staff_write_matter(id)))
  with check (
    (select app.in_active_org(organization_id))
    and (select app.can_staff_write_matter(id))
  );
