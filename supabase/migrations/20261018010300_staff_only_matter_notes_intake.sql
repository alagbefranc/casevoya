-- Client exposure fixes (PR #11 audit items 2 and 3).
--
-- 1. matter_engagements, matter_stage_overrides and matter_program_changes hold
--    staff-internal reasons (exception_reason, override reason, permitted_role,
--    program-change reason). Their SELECT policies use app.can_read_matter, which is
--    true for every matter participant with a login (client, sponsor, employer
--    contact) and for grant holders. A RESTRICTIVE policy now also requires an
--    active staff membership in the row's firm at staff assurance (aal2), so portal
--    users see none of these rows. Existing policies are not dropped.
--
-- 2. app.can_read_intake_answer let every matter participant read any answer whose
--    section_key is null. section_key is optional in the template schema, so the
--    default was open to sponsors and employer contacts. The conservative rule:
--      - staff (assigned, author, or break-glass) and the answer's own subject keep
--        access to every answer, as before;
--      - a guardian of a minor subject keeps access, as before;
--      - other participants see only answers explicitly marked
--        'shared_family_record', or a section shared with them through
--        section_shares;
--      - an answer with no section is private to the subject and staff.
--    intake_snapshot_answers reuses this function, so snapshots follow the same rule.
-- Additive only.

create policy matter_engagements_staff_only on public.matter_engagements
  as restrictive
  for select
  to authenticated
  using (
    (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

create policy matter_program_changes_staff_only on public.matter_program_changes
  as restrictive
  for select
  to authenticated
  using (
    (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

create policy matter_stage_overrides_staff_only on public.matter_stage_overrides
  as restrictive
  for select
  to authenticated
  using (
    (select app.is_org_staff(organization_id))
    and (select app.staff_mfa_satisfied())
  );

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
                array['licensed_consultant', 'case_manager']::public.org_role[]
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
comment on function app.can_read_intake_answer(uuid) is
  'Subject, staff (assigned, author, break-glass), minor''s guardian, shared_family_record to participants, or an explicit section share. Section-less answers are private.';
