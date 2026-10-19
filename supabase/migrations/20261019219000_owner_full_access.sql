-- Owner = every staff ability, regulated actions included: owners are regulated consultants
-- (decision 2026-10-19, approved by Francis: "Owner is regulated too, so it's access to
-- everything").
--
-- An audit of every function in schemas public and app that names a staff role, and of every RLS
-- policy, found the firm owner already in every role list that gates a staff action, except:
--   1. the "rows I created" path. A licensed consultant or case manager reads and edits a person,
--      a person's section record and an intake answer they created; the owner could create those
--      rows (app.can_insert_practice_row includes the owner) but not read them back unless also
--      on the matter's team. The owner joins that path in app.can_read_person,
--      app.can_write_person, app.can_read_person_section, app.can_read_intake_answer and
--      public.record_person_section.
--   2. regulated actions. They are gated on app.membership_is_licensed, which counted a
--      licensed_consultant by role but a firm_owner only with an unblocked CICC credential
--      (20261018100000_owner_licence_gates.sql). It now counts every active firm_owner the way it
--      counts every active licensed_consultant, so wherever a licensed consultant is allowed (legal
--      sign-off, professional review, regulated stage changes and overrides, outcomes, legal dates,
--      intake and agreement-template approval, being the responsible consultant or the
--      submitting representative, countersigning) the owner is allowed. As for a licensed
--      consultant, a credential on file that is revoked, suspended, inactive or not entitled is
--      still refused by the existing licence locks (app.actor_licence_block_status and the
--      credential checks), which already cover firm_owner.
--
-- Kept on purpose:
--   * Person rows, section records and intake answers stay assignment-based for every staff role,
--     with audited break-glass (decision 2026-10-17); the owner can join any matter's team
--     (audited). Restricted adult-dependant sections, section shares and guardian grants are
--     portal audience rules and are not touched.
--   * Law-facing checks that need a register-verified credential, not a role, are unchanged and
--     apply to owners and licensed consultants alike: real-client invitations
--     (app.firm_has_verified_licence) and moving consultant-of-record authority to a receiver
--     (verified licence). Receipts copy the responsible consultant's credential when one is on
--     file and print nothing for it otherwise.
--   * The staff directory's is_licensed flag (the "Owner, licensed consultant" label) still means
--     a licence on file: it now reads app.membership_holds_licence, the previous rule.
-- MFA, step-up, forced RLS, tenant isolation, audit, sample-mode blocks and last-owner protections
-- are unchanged. Each function below is copied from its latest definition (named above it) with
-- only the condition described changed; create or replace keeps grants and trigger bindings.


-- From 20261017140200_owner_person_access.sql. The owner joins the creator path.
create or replace function app.can_read_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.persons p
    where p.id = p_person_id
      and app.in_active_org(p.organization_id)
      and (
        exists (
          select 1
          from public.matter_participants mp
          where mp.person_id = p.id
            and mp.organization_id = p.organization_id
            and app.actor_staff_assigned_to_matter(mp.matter_id, p.organization_id)
        )
        or (
          p.created_by = (select auth.uid())
          and app.staff_mfa_satisfied()
          and app.has_org_role(
            p.organization_id,
            array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
        or p.user_id = (select auth.uid())
        or app.grant_allows(p.id, p.organization_id, null)
        or (
          app.staff_mfa_satisfied()
          and app.break_glass_person_open(p.id)
        )
      )
  );
$$;

-- From 20261017140200_owner_person_access.sql. The owner joins the creator path.
create or replace function app.can_write_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.persons p
    where p.id = p_person_id
      and app.in_active_org(p.organization_id)
      and app.staff_mfa_satisfied()
      and (
        exists (
          select 1
          from public.matter_participants mp
          where mp.person_id = p.id
            and mp.organization_id = p.organization_id
            and app.actor_staff_assigned_to_matter(mp.matter_id, p.organization_id)
        )
        or (
          p.created_by = (select auth.uid())
          and app.has_org_role(
            p.organization_id,
            array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
      )
  );
$$;

-- From 20261017140800_portal_invitations.sql. The owner joins the creator path; the guardian,
-- share and restricted-section (portal audience) paths are unchanged.
create or replace function app.can_read_person_section(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.person_section_records rec
    join public.persons subject
      on subject.id = rec.person_id
     and subject.organization_id = rec.organization_id
    where rec.id = p_id
      and app.in_active_org(rec.organization_id)
      and (
        subject.user_id = (select auth.uid())
        or app.actor_staff_assigned_to_matter(rec.matter_id, rec.organization_id)
        or (
          rec.created_by = (select auth.uid())
          and app.staff_mfa_satisfied()
          and app.has_org_role(
            rec.organization_id,
            array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
        or (
          app.staff_mfa_satisfied()
          and app.break_glass_person_open(subject.id)
        )
        or exists (
          select 1
          from public.access_grants grant_row
          join public.persons grantee
            on grantee.id = grant_row.grantee_person_id
           and grantee.organization_id = grant_row.organization_id
          where grant_row.organization_id = rec.organization_id
            and grant_row.subject_person_id = subject.id
            and grant_row.kind = 'guardian'
            and grant_row.revoked_at is null
            and (grant_row.expires_at is null or grant_row.expires_at > statement_timestamp())
            and (grant_row.matter_id is null or grant_row.matter_id = rec.matter_id)
            and grantee.user_id = (select auth.uid())
            and app.person_is_minor(subject.id)
        )
        or exists (
          select 1
          from public.section_shares share
          join public.persons grantee
            on grantee.id = share.grantee_person_id
           and grantee.organization_id = share.organization_id
          where share.organization_id = rec.organization_id
            and share.subject_person_id = rec.person_id
            and share.matter_id = rec.matter_id
            and share.section_key = rec.section_key
            and share.revoked_at is null
            and grantee.user_id = (select auth.uid())
        )
        or (
          rec.restricted is false
          and exists (
            select 1
            from public.matter_participants party
            join public.persons viewer
              on viewer.id = party.person_id
             and viewer.organization_id = party.organization_id
            where party.matter_id = rec.matter_id
              and party.organization_id = rec.organization_id
              and viewer.user_id = (select auth.uid())
          )
        )
      )
  );
$$;

-- From 20261018010300_staff_only_matter_notes_intake.sql. The owner joins the creator path; the
-- shared-family, share and guardian (portal audience) paths are unchanged.
create or replace function app.can_read_intake_answer(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.intake_answer_versions answer
    join public.intake_responses response
      on response.id = answer.response_id
     and response.organization_id = answer.organization_id
    join public.persons subject
      on subject.id = response.person_id
     and subject.organization_id = response.organization_id
    where answer.id = p_id
      and app.in_active_org(answer.organization_id)
      and (
        subject.user_id = (select auth.uid())
        or (
          app.staff_mfa_satisfied()
          and (
            app.actor_staff_assigned_to_matter(response.matter_id, response.organization_id)
            or (
              answer.created_by = (select auth.uid())
              and app.has_org_role(
                response.organization_id,
                array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
              )
            )
            or app.break_glass_person_open(subject.id)
          )
        )
        -- Only answers explicitly marked as a shared family record reach other
        -- participants. A section-less answer is private to the subject and staff.
        or (
          answer.section_key = 'shared_family_record'
          and exists (
            select 1
            from public.matter_participants party
            join public.persons viewer
              on viewer.id = party.person_id
             and viewer.organization_id = party.organization_id
            where party.matter_id = response.matter_id
              and party.organization_id = response.organization_id
              and viewer.user_id = (select auth.uid())
          )
        )
        or exists (
          select 1
          from public.section_shares share
          join public.persons grantee
            on grantee.id = share.grantee_person_id
           and grantee.organization_id = share.organization_id
          where answer.section_key is not null
            and share.organization_id = answer.organization_id
            and share.subject_person_id = response.person_id
            and share.matter_id = response.matter_id
            and share.section_key = answer.section_key
            and share.revoked_at is null
            and grantee.user_id = (select auth.uid())
        )
        or exists (
          select 1
          from public.access_grants grant_row
          join public.persons grantee
            on grantee.id = grant_row.grantee_person_id
           and grantee.organization_id = grant_row.organization_id
          where grant_row.organization_id = response.organization_id
            and grant_row.subject_person_id = subject.id
            and grant_row.kind = 'guardian'
            and grant_row.revoked_at is null
            and (grant_row.expires_at is null or grant_row.expires_at > statement_timestamp())
            and (grant_row.matter_id is null or grant_row.matter_id = response.matter_id)
            and grantee.user_id = (select auth.uid())
            and app.person_is_minor(subject.id)
        )
      )
  );
$$;

-- From 20261017140800_portal_invitations.sql. The owner who created the person may record a section.
create or replace function public.record_person_section(
  p_person_id uuid,
  p_matter_id uuid,
  p_section_key public.person_section_key,
  p_summary text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  org uuid;
  summary text := btrim(coalesce(p_summary, ''));
  section_id uuid;
begin
  select person.organization_id into org
  from public.persons person
  where person.id = p_person_id;
  if actor is null or org is null or app.in_active_org(org) is distinct from true then
    raise exception 'section record denied' using errcode = '42501';
  end if;
  if app.staff_mfa_satisfied() is distinct from true
     or (
       app.actor_staff_assigned_to_matter(p_matter_id, org) is distinct from true
       and not (
         app.has_org_role(org, array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[])
         and exists (
           select 1 from public.persons person
           where person.id = p_person_id
             and person.created_by = actor
         )
       )
     ) then
    raise exception 'section record denied' using errcode = '42501';
  end if;
  if length(summary) not between 1 and 200 then
    raise exception 'section summary is required' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.matter_participants party
    where party.organization_id = org
      and party.matter_id = p_matter_id
      and party.person_id = p_person_id
  ) then
    raise exception 'section record denied' using errcode = '42501';
  end if;
  insert into public.person_section_records (
    organization_id, person_id, matter_id, section_key, restricted, summary
  ) values (
    org,
    p_person_id,
    p_matter_id,
    p_section_key,
    p_section_key is distinct from 'shared_family_record',
    summary
  )
  returning id into section_id;
  perform app.record_portal_audit(
    org, 'person_section.recorded', 'public.person_section_records', section_id, 'success',
    jsonb_build_object('section_key', p_section_key, 'person_id', p_person_id, 'matter_id', p_matter_id)
  );
  return section_id;
end;
$$;

-- New. The previous app.membership_is_licensed rule (20261018100000_owner_licence_gates.sql): a
-- licensed consultant, or a firm owner holding an unblocked CICC credential. For showing whether a
-- member has a licence on file (the staff directory); it no longer gates any action.
create function app.membership_holds_licence(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mem
    where mem.id = p_membership_id
      and mem.status = 'active'
      and (
        mem.role = 'licensed_consultant'
        or (
          mem.role = 'firm_owner'
          and exists (
            select 1
            from public.consultant_credentials credential
            where credential.membership_id = mem.id
              and credential.organization_id = mem.organization_id
              and not app.licence_status_blocks(credential.status)
              and credential.discipline_revoked is false
              and credential.discipline_suspended is false
              and credential.register_status is distinct from 'inactive'
              and credential.entitlement_to_practise is not false
          )
        )
      )
  );
$$;
comment on function app.membership_holds_licence(uuid) is
  'Display only: an active licensed_consultant, or an active firm_owner with an unblocked CICC credential on file.';
revoke all on function app.membership_holds_licence(uuid) from public;
grant execute on function app.membership_holds_licence(uuid) to authenticated, service_role;

-- From 20261018100000_owner_licence_gates.sql. Every active firm owner counts, like every active
-- licensed consultant.
create or replace function app.membership_is_licensed(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mem
    where mem.id = p_membership_id
      and mem.status = 'active'
      -- Owners are regulated consultants (decision 2026-10-19). A blocked credential is refused
      -- by the licence locks, as for a licensed consultant.
      and mem.role in ('licensed_consultant', 'firm_owner')
  );
$$;
comment on function app.membership_is_licensed(uuid) is
  'True for an active licensed_consultant or firm_owner membership (owners are regulated consultants, decision 2026-10-19). Blocked credentials are refused by the licence locks.';

-- From 20261018160000_firm_staff_directory.sql. is_licensed keeps meaning a licence on file.
create or replace function public.firm_staff_directory(p_organization_id uuid)
returns table (
  membership_id uuid,
  display_name text,
  email text,
  role public.org_role,
  status public.membership_status,
  is_licensed boolean,
  two_step boolean,
  is_self boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  owner_view boolean;
begin
  perform app.require_active_staff(p_organization_id, app.staff_roles(), false);
  owner_view := app.has_org_role(p_organization_id, array['firm_owner']::public.org_role[]) is true;

  return query
    select
      mem.id,
      nullif(btrim(coalesce(prof.display_name, '')), ''),
      case when owner_view then lower(usr.email) end,
      mem.role,
      mem.status,
      app.membership_holds_licence(mem.id),
      case
        when owner_view then exists (
          select 1
          from auth.mfa_factors factor
          where factor.user_id = mem.user_id
            and factor.status::text = 'verified'
        )
      end,
      mem.user_id = actor
    from public.memberships mem
    left join public.profiles prof on prof.id = mem.user_id
    left join auth.users usr on usr.id = mem.user_id
    where mem.organization_id = p_organization_id
      and mem.role = any (app.staff_roles())
      and mem.status in ('active'::public.membership_status, 'suspended'::public.membership_status)
    order by (mem.role = 'firm_owner'::public.org_role) desc, mem.accepted_at nulls last, mem.created_at, mem.id;
end;
$$;

-- From 20261019217000_settings_staff_admin.sql. A consultant of record may become an owner: owners
-- are regulated consultants.
create or replace function public.change_staff_role(p_organization_id uuid, p_membership_id uuid, p_role public.org_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.memberships%rowtype;
  licensed_after boolean;
begin
  perform app.require_firm_owner_step_up(p_organization_id);
  target := app.managed_staff_membership(p_organization_id, p_membership_id);
  if target.status not in ('active', 'suspended') then
    raise exception 'only a current team member''s role can change' using errcode = '42501';
  end if;
  if p_role is null or p_role <> all (app.staff_roles()) then
    raise exception 'choose a staff role' using errcode = '22023';
  end if;
  if p_role = target.role then
    raise exception 'they already have that role' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships mem
    where mem.organization_id = p_organization_id
      and mem.user_id = target.user_id
      and mem.role = p_role
  ) then
    raise exception 'they already hold that role in this firm' using errcode = '23505';
  end if;
  if target.role = 'firm_owner' and target.status = 'active'
     and not app.other_active_owner(p_organization_id, target.user_id) then
    raise exception 'cannot remove or demote the last firm owner' using errcode = '42501';
  end if;

  -- A consultant of record keeps a licensed role until their open matters move.
  if app.membership_is_licensed(target.id) then
    licensed_after := p_role in ('licensed_consultant', 'firm_owner');
    if not licensed_after and exists (
      select 1 from app.membership_record_matters(p_organization_id, array[target.id])
    ) then
      raise exception 'move their matters to another licensed consultant first' using errcode = '42501';
    end if;
  end if;

  update public.memberships
     set role = p_role
   where id = target.id;

  perform app.record_audit_event(
    p_organization_id,
    'membership.role_changed',
    'public.memberships',
    target.id,
    'success',
    jsonb_build_object('from', target.role, 'to', p_role)
  );
end;
$$;
