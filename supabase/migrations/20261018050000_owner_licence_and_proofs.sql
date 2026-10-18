-- A firm owner may hold their own consultant licence (decision 2026-10-18).
--
-- A solo RCIC signs up as the firm owner, and a membership has one role, so the owner's own
-- licence had nowhere to go: declare_consultant_credential accepted only licensed_consultant
-- memberships and firm setup silently skipped the licence. Now:
--   * declare_consultant_credential accepts the caller's own firm_owner membership (an owner
--     still cannot declare a licence onto another owner's membership);
--   * an owner's blocked licence blocks the owner like a consultant's (actor_licence_block_status);
--   * an owner's verified licence counts as the firm's verified licence.
-- Bodies are copied from 20261017140700_firm_onboarding.sql (their only
-- definition) with only the role conditions changed. Other licence-gated role checks follow in a
-- separate change. Grants are kept by create or replace.
--
-- Licence proof files: a private bucket written only by the server (service role) after it has
-- checked the file. There are no storage.objects policies for it; storage tables are not altered.

create or replace function app.actor_licence_block_status(p_org uuid)
returns public.credential_status
language sql
stable
security definer
set search_path = ''
as $$
  select credential.status
  from public.consultant_credentials credential
  join public.memberships mem
    on mem.id = credential.membership_id
   and mem.organization_id = credential.organization_id
  where credential.organization_id = p_org
    and mem.user_id = (select auth.uid())
    and mem.role in ('licensed_consultant', 'firm_owner')
    and mem.status = 'active'
    and (
      app.licence_status_blocks(credential.status)
      or credential.discipline_revoked
      or credential.discipline_suspended
      or credential.register_status = 'inactive'
      or credential.entitlement_to_practise is false
    )
  order by credential.checked_at desc nulls last
  limit 1;
$$;

create or replace function app.firm_has_verified_licence(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.consultant_credentials credential
    join public.memberships mem
      on mem.id = credential.membership_id
     and mem.organization_id = credential.organization_id
    where credential.organization_id = p_org
      and mem.role in ('licensed_consultant', 'firm_owner')
      and mem.status = 'active'
      and credential.status = 'verified'
      and credential.verification_method = 'manual_public_register'
      and credential.register_status = 'active'
      and credential.entitlement_to_practise is true
      and credential.discipline_suspended is false
      and credential.discipline_revoked is false
      and not app.licence_status_blocks(credential.status)
  );
$$;

create or replace function app.declare_consultant_credential(
  p_membership_id uuid,
  p_licence_type public.licence_type,
  p_college_id text,
  p_scope_note text,
  p_proof_locator text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  mem public.memberships%rowtype;
  college_id text := upper(btrim(coalesce(p_college_id, '')));
  credential_id uuid;
begin
  if actor is null or app.staff_mfa_satisfied() is distinct from true
     or app.mfa_step_up_satisfied() is distinct from true then
    raise exception 'declaring a licence requires a recent step-up' using errcode = '42501';
  end if;
  select * into mem from public.memberships where id = p_membership_id;
  if mem.id is null
     or mem.role not in ('licensed_consultant', 'firm_owner')
     or mem.status is distinct from 'active'
     or app.in_active_org(mem.organization_id) is distinct from true then
    raise exception 'licence declaration denied' using errcode = '42501';
  end if;
  -- An owner's membership carries a licence only when the owner declares it themselves.
  if mem.role = 'firm_owner' and mem.user_id is distinct from actor then
    raise exception 'licence declaration denied' using errcode = '42501';
  end if;
  if mem.user_id is distinct from actor
     and app.has_org_role(mem.organization_id, array['firm_owner']::public.org_role[]) is distinct from true then
    raise exception 'licence declaration denied' using errcode = '42501';
  end if;
  if p_licence_type is null then
    raise exception 'licence type is required' using errcode = '22023';
  end if;
  if college_id !~ '^[A-Z0-9-]{1,40}$' then
    raise exception 'college id is not usable' using errcode = '22023';
  end if;
  if p_proof_locator is null or length(btrim(p_proof_locator)) not between 1 and 500 then
    raise exception 'a proof file reference is required' using errcode = '22023';
  end if;

  insert into public.consultant_credentials (
    organization_id, membership_id, licence_type, college_id, scope_note,
    proof_locator, status
  ) values (
    mem.organization_id,
    mem.id,
    p_licence_type,
    college_id,
    nullif(btrim(coalesce(p_scope_note, '')), ''),
    btrim(p_proof_locator),
    'declared'
  )
  returning id into credential_id;

  update public.organizations
     set verification_status = 'pending_review'
   where id = mem.organization_id
     and verification_status = 'unverified';

  perform app.record_audit_event(
    mem.organization_id,
    'licence.declared',
    'public.consultant_credentials',
    credential_id,
    'success',
    jsonb_build_object('regulator', 'CICC', 'licence_type', p_licence_type, 'membership_id', mem.id)
  );
  return credential_id;
end;
$$;

do $licence_proofs$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public)
  values ('licence-proofs', 'licence-proofs', false)
  on conflict (id) do nothing;
  -- Supabase's buckets table has these; a bare test schema may not.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    execute $limits$
      update storage.buckets
         set file_size_limit = 10485760,
             allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
       where id = 'licence-proofs'
    $limits$;
  end if;
end
$licence_proofs$;
