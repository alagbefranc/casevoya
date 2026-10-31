-- Client two-step on two more client reads (SEC-01 follow-up). Additive only; each function is
-- copied from its latest definition (named above it) with only app.session_assurance_ok() added
-- (marked "Two-step"); create or replace keeps grants.
--
-- public.portal_claim_sources: a client's open requests and their sources only from a session
--   that completed the client's second factor.
-- app.can_read_document: the access-grant branch also checks app.session_assurance_ok() itself
--   (app.grant_allows already does), like the person and matter branches.

-- From 20261030220000_source_conflict_firm_scope.sql.
create or replace function public.portal_claim_sources()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id', request.id,
    'url', evidence.final_url,
    'checked_on', evidence.checked_on,
    'review_pending', conflict.is_open is true or app.rule_version_is_live(request.rule_version_id) is distinct from true,
    'conflict_urls', case when conflict.is_open is true then jsonb_build_array(conflict.left_url, conflict.right_url) else null end
  )), '[]'::jsonb)
  from public.document_requests request
  join public.rule_versions ver on ver.id = request.rule_version_id
  join public.persons person on person.id = request.person_id and person.user_id = (select auth.uid())
  left join lateral (
    select conflict.left_url, conflict.right_url, true as is_open
    from public.source_conflicts conflict
    where conflict.definition_id = ver.definition_id
      and (
        conflict.status = 'open'
        or (conflict.status = 'firm_open' and conflict.opened_organization_id = request.organization_id)
      )
    order by (conflict.status = 'open') desc
    limit 1
  ) conflict on true
  left join lateral (
    select coalesce(snapshot.final_url, link.source_url) as final_url,
           coalesce(
             case when src.last_checked_at is null then null else app.firm_local_date(request.organization_id, src.last_checked_at) end,
             link.checked_on
           ) as checked_on
    from public.rule_evidence link
    left join public.source_snapshots snapshot on snapshot.id = link.snapshot_id
    left join public.official_sources src on src.id = snapshot.source_id
    where link.rule_version_id = coalesce(app.official_live_version(ver.definition_id), request.rule_version_id)
      and app.host_is_allowlisted(app.official_url_host(coalesce(snapshot.final_url, link.source_url)))
    order by snapshot.retrieved_at desc nulls last
    limit 1
  ) evidence on true
  where request.organization_id = (select app.current_organization_id())
    and request.status = 'open'
    and request.audience <> 'staff'
    and person.organization_id = request.organization_id
    and evidence.final_url is not null
    -- Two-step
    and (select app.session_assurance_ok());
$$;

-- From 20261031020000_document_integrity_privacy_scope_agreement_reads.sql.
create or replace function app.can_read_document(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.documents doc
    where doc.id = p_id
      and doc.organization_id = (select app.current_organization_id())
      and (
        (
          (select app.staff_mfa_satisfied())
          and (select app.has_org_role(
            doc.organization_id,
            array['firm_owner', 'licensed_consultant', 'case_manager', 'assistant']::public.org_role[]
          ))
          and (
            (select app.actor_is_firm_owner(doc.organization_id))
            or exists (
              select 1
              from public.document_matter_refs ref
              where ref.document_id = doc.id
                and ref.removed_at is null
                and (select app.can_read_matter(ref.matter_id))
            )
            or (
              doc.created_by = (select auth.uid())
              and not exists (
                select 1
                from public.document_matter_refs ref
                where ref.document_id = doc.id
                  and ref.removed_at is null
              )
            )
          )
        )
        or (
          (
            (
              doc.audience <> 'staff'
              and exists (
                select 1
                from public.persons person
                where person.id = doc.person_id
                  and person.organization_id = doc.organization_id
                  and person.user_id = (select auth.uid())
              )
              and (select app.session_assurance_ok())
            )
            or (
              doc.audience = 'matter'
              and doc.sensitivity = 'ordinary'
              and exists (
                select 1
                from public.document_matter_refs ref
                join public.matter_participants party
                  on party.matter_id = ref.matter_id
                 and party.organization_id = ref.organization_id
                join public.persons person
                  on person.id = party.person_id
                 and person.organization_id = party.organization_id
                where ref.document_id = doc.id
                  and ref.removed_at is null
                  and person.user_id = (select auth.uid())
              )
              and (select app.session_assurance_ok())
            )
            or (
              doc.sensitivity = 'ordinary'
              and doc.audience <> 'staff'
              and exists (
                select 1
                from public.document_matter_refs ref
                where ref.document_id = doc.id
                  and ref.removed_at is null
                  and (select app.grant_allows(doc.person_id, doc.organization_id, ref.matter_id))
              )
              -- Two-step
              and (select app.session_assurance_ok())
            )
          )
          -- Sealed agreement and certificate documents: also app.can_read_agreement.
          and (select app.sealed_document_agreement_readable(doc.id))
        )
      )
  );
$$;
