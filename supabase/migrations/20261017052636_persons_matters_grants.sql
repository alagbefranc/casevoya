-- Person, matter and household permissions (T007, PRD §5 and §18, DEC-006).
-- A person is tenant-local and is not a login profile. A household is a grouping,
-- never a permission. A payer, sponsor or household link never reveals another
-- adult's record. Guardian access exists only for a minor and only with an
-- explicit grant. Staff other than the firm owner see people through matter
-- assignment (finance users have no person visibility in this slice).
-- Age of majority is not calculated: is_minor is a staff-recorded fact.
-- Additive only.

create type public.matter_stage as enum (
  'engagement_pending',
  'intake',
  'evidence_collection',
  'preparation',
  'consultant_review',
  'client_confirmation',
  'ready_to_submit',
  'submitted',
  'government_processing',
  'decision_review',
  'post_decision',
  'closed'
);

create type public.matter_party_role as enum (
  'applicant',
  'dependant',
  'sponsor',
  'employer',
  'guardian',
  'consultant',
  'case_manager',
  'assistant'
);

create type public.access_grant_kind as enum ('explicit', 'guardian');

-- Descriptive only. Authorization functions must not consult this type.
create type public.person_relationship_type as enum (
  'spouse',
  'parent',
  'child',
  'payer',
  'sponsor',
  'household',
  'other'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.persons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  user_id uuid references auth.users (id),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  email text check (
    email is null
    or (email = lower(email) and length(email) <= 320)
  ),
  birth_date date,
  is_minor boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id)
);
comment on table public.persons is
  'Tenant-local person. Separate from profiles. user_id is an optional verified login link.';
comment on column public.persons.is_minor is
  'Staff-recorded fact. Age of majority is jurisdiction-specific and is not calculated here.';
comment on column public.persons.birth_date is
  'Calendar date when known. Null means unknown; do not invent a full date.';

create unique index persons_org_user_uidx
  on public.persons (organization_id, user_id)
  where user_id is not null;
create index persons_org_idx on public.persons (organization_id);
create index persons_created_by_idx on public.persons (created_by);

create table public.matters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  title text not null check (length(btrim(title)) between 1 and 200),
  stage public.matter_stage not null default 'engagement_pending',
  on_hold boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id)
);
comment on table public.matters is
  'Firm matter. Stage is the firm workflow only; it is not a government status.';

create index matters_org_stage_idx on public.matters (organization_id, stage);
create index matters_created_by_idx on public.matters (created_by);

create table public.matter_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  matter_id uuid not null,
  person_id uuid,
  membership_id uuid,
  role public.matter_party_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (matter_id, person_id, role),
  unique (matter_id, membership_id, role),
  check (person_id is not null or membership_id is not null),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id),
  foreign key (membership_id, organization_id) references public.memberships (id, organization_id)
);
comment on table public.matter_participants is
  'Matter party. A sponsor or payer role here does not grant access to another person.';

create index matter_participants_matter_idx on public.matter_participants (matter_id);
create index matter_participants_person_idx on public.matter_participants (person_id);
create index matter_participants_membership_idx on public.matter_participants (membership_id);
create index matter_participants_created_by_idx on public.matter_participants (created_by);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null check (length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id)
);
comment on table public.households is
  'Relationship grouping only. Household membership is not a permission boundary.';

create index households_org_idx on public.households (organization_id);
create index households_created_by_idx on public.households (created_by);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  household_id uuid not null,
  person_id uuid not null,
  relationship_label text check (relationship_label is null or length(relationship_label) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (household_id, person_id),
  unique (id, organization_id),
  foreign key (household_id, organization_id) references public.households (id, organization_id),
  foreign key (person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.household_members is
  'Who is grouped together. Never consulted by app.can_read_person.';

create index household_members_person_idx on public.household_members (person_id);
create index household_members_created_by_idx on public.household_members (created_by);

create table public.person_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  from_person_id uuid not null,
  to_person_id uuid not null,
  relationship_type public.person_relationship_type not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  unique (organization_id, from_person_id, to_person_id, relationship_type),
  check (from_person_id <> to_person_id),
  foreign key (from_person_id, organization_id) references public.persons (id, organization_id),
  foreign key (to_person_id, organization_id) references public.persons (id, organization_id)
);
comment on table public.person_relationships is
  'Descriptive link (including payer and sponsor). Never consulted by authorization.';

create index person_relationships_to_idx on public.person_relationships (to_person_id);
create index person_relationships_from_idx on public.person_relationships (from_person_id);
create index person_relationships_created_by_idx on public.person_relationships (created_by);

create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  grantee_person_id uuid not null,
  subject_person_id uuid not null,
  matter_id uuid,
  kind public.access_grant_kind not null,
  purpose text not null check (length(btrim(purpose)) between 1 and 500),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  version integer not null default 1 check (version >= 1),
  unique (id, organization_id),
  check (grantee_person_id <> subject_person_id),
  foreign key (grantee_person_id, organization_id) references public.persons (id, organization_id),
  foreign key (subject_person_id, organization_id) references public.persons (id, organization_id),
  foreign key (matter_id, organization_id) references public.matters (id, organization_id)
);
comment on table public.access_grants is
  'Explicit access. kind=guardian is valid only while the subject is a minor.';

create index access_grants_grantee_idx on public.access_grants (grantee_person_id);
create index access_grants_subject_idx on public.access_grants (subject_person_id);
create index access_grants_matter_idx on public.access_grants (matter_id);
create index access_grants_created_by_idx on public.access_grants (created_by);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function app.guard_tenant_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'id and organization_id are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_tenant_keys() from public;

create function app.stamp_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and (select auth.uid()) is not null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;
revoke all on function app.stamp_created_by() from public;

create function app.guard_guardian_grant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  minor boolean;
begin
  -- Revoking a grant must stay possible after the subject is no longer a minor.
  if new.kind = 'guardian' and new.revoked_at is null then
    select p.is_minor into minor
    from public.persons p
    where p.id = new.subject_person_id
      and p.organization_id = new.organization_id;
    if minor is distinct from true then
      raise exception 'guardian grants are only valid for a minor subject' using errcode = '42501';
    end if;
  end if;
  if new.expires_at is not null and new.revoked_at is null and new.expires_at <= statement_timestamp() then
    raise exception 'grant expiry must be in the future' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_guardian_grant() from public;

create trigger persons_touch before update on public.persons
  for each row execute function app.touch_row();
create trigger persons_immutable before update on public.persons
  for each row execute function app.guard_tenant_keys();
create trigger persons_stamp before insert on public.persons
  for each row execute function app.stamp_created_by();
create trigger persons_audit after insert or update or delete on public.persons
  for each row execute function app.audit_row_change();

create trigger matters_touch before update on public.matters
  for each row execute function app.touch_row();
create trigger matters_immutable before update on public.matters
  for each row execute function app.guard_tenant_keys();
create trigger matters_stamp before insert on public.matters
  for each row execute function app.stamp_created_by();
create trigger matters_audit after insert or update or delete on public.matters
  for each row execute function app.audit_row_change();

create trigger matter_participants_touch before update on public.matter_participants
  for each row execute function app.touch_row();
create trigger matter_participants_immutable before update on public.matter_participants
  for each row execute function app.guard_tenant_keys();
create trigger matter_participants_stamp before insert on public.matter_participants
  for each row execute function app.stamp_created_by();
create trigger matter_participants_audit after insert or update or delete on public.matter_participants
  for each row execute function app.audit_row_change();

create trigger households_touch before update on public.households
  for each row execute function app.touch_row();
create trigger households_immutable before update on public.households
  for each row execute function app.guard_tenant_keys();
create trigger households_stamp before insert on public.households
  for each row execute function app.stamp_created_by();
create trigger households_audit after insert or update or delete on public.households
  for each row execute function app.audit_row_change();

create trigger household_members_touch before update on public.household_members
  for each row execute function app.touch_row();
create trigger household_members_immutable before update on public.household_members
  for each row execute function app.guard_tenant_keys();
create trigger household_members_stamp before insert on public.household_members
  for each row execute function app.stamp_created_by();
create trigger household_members_audit after insert or update or delete on public.household_members
  for each row execute function app.audit_row_change();

create trigger person_relationships_touch before update on public.person_relationships
  for each row execute function app.touch_row();
create trigger person_relationships_immutable before update on public.person_relationships
  for each row execute function app.guard_tenant_keys();
create trigger person_relationships_stamp before insert on public.person_relationships
  for each row execute function app.stamp_created_by();
create trigger person_relationships_audit after insert or update or delete on public.person_relationships
  for each row execute function app.audit_row_change();

create trigger access_grants_touch before update on public.access_grants
  for each row execute function app.touch_row();
create trigger access_grants_immutable before update on public.access_grants
  for each row execute function app.guard_tenant_keys();
create trigger access_grants_stamp before insert on public.access_grants
  for each row execute function app.stamp_created_by();
create trigger access_grants_guardian before insert or update on public.access_grants
  for each row execute function app.guard_guardian_grant();
create trigger access_grants_audit after insert or update or delete on public.access_grants
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------------
-- Authorization. Household and person_relationships are intentionally unused.
-- ---------------------------------------------------------------------------
create function app.actor_is_firm_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_org_role(p_org, array['firm_owner']::public.org_role[])
     and app.staff_mfa_satisfied();
$$;

-- Assigned operational staff. finance_user is excluded: billing access is not person access.
create function app.actor_staff_assigned_to_matter(p_matter_id uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.staff_mfa_satisfied()
     and exists (
       select 1
       from public.matter_participants mp
       join public.memberships m
         on m.id = mp.membership_id
        and m.organization_id = mp.organization_id
       where mp.matter_id = p_matter_id
         and mp.organization_id = p_org
         and m.user_id = (select auth.uid())
         and m.status = 'active'
         and m.role = any (array['licensed_consultant', 'case_manager', 'assistant', 'firm_owner']::public.org_role[])
     );
$$;

-- p_matter null: any live grant on the subject. Otherwise the grant is person-wide
-- or scoped to that matter. Guardian grants match only while the subject is a minor.
create function app.grant_allows(p_subject uuid, p_org uuid, p_matter uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_grants g
    join public.persons grantee
      on grantee.id = g.grantee_person_id
     and grantee.organization_id = g.organization_id
    join public.persons subject
      on subject.id = g.subject_person_id
     and subject.organization_id = g.organization_id
    where g.organization_id = p_org
      and g.subject_person_id = p_subject
      and grantee.user_id = (select auth.uid())
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > statement_timestamp())
      and (p_matter is null or g.matter_id is null or g.matter_id = p_matter)
      and (
        g.kind = 'explicit'
        or (g.kind = 'guardian' and subject.is_minor)
      )
  );
$$;

create function app.can_read_person(p_person_id uuid)
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
        app.actor_is_firm_owner(p.organization_id)
        or exists (
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
            array['licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
        or p.user_id = (select auth.uid())
        or app.grant_allows(p.id, p.organization_id, null)
      )
  );
$$;

create function app.can_write_person(p_person_id uuid)
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
        app.actor_is_firm_owner(p.organization_id)
        or exists (
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
            array['licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
      )
  );
$$;

create function app.can_read_matter(p_matter_id uuid)
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
      and (
        app.actor_is_firm_owner(matter.organization_id)
        or app.actor_staff_assigned_to_matter(matter.id, matter.organization_id)
        or (
          matter.created_by = (select auth.uid())
          and app.staff_mfa_satisfied()
          and app.has_org_role(
            matter.organization_id,
            array['licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
        or exists (
          select 1
          from public.matter_participants mp
          join public.persons person
            on person.id = mp.person_id
           and person.organization_id = mp.organization_id
          where mp.matter_id = matter.id
            and mp.organization_id = matter.organization_id
            and person.user_id = (select auth.uid())
        )
        or exists (
          select 1
          from public.matter_participants mp
          where mp.matter_id = matter.id
            and mp.organization_id = matter.organization_id
            and mp.person_id is not null
            and app.grant_allows(mp.person_id, matter.organization_id, matter.id)
        )
      )
  );
$$;

create function app.can_read_matter_participant(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.matter_participants mp
    where mp.id = p_id
      and app.can_read_matter(mp.matter_id)
      and (
        (
          app.staff_mfa_satisfied()
          and (
            app.actor_is_firm_owner(mp.organization_id)
            or app.actor_staff_assigned_to_matter(mp.matter_id, mp.organization_id)
            or (
              mp.created_by = (select auth.uid())
              and app.has_org_role(
                mp.organization_id,
                array['licensed_consultant', 'case_manager']::public.org_role[]
              )
            )
          )
        )
        or (
          mp.membership_id is not null
          and exists (
            select 1
            from public.memberships m
            where m.id = mp.membership_id
              and m.user_id = (select auth.uid())
              and m.status = 'active'
          )
        )
        or (mp.person_id is not null and app.can_read_person(mp.person_id))
      )
  );
$$;

create function app.can_read_household(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.households h
    where h.id = p_household_id
      and app.in_active_org(h.organization_id)
      and app.staff_mfa_satisfied()
      and (
        app.actor_is_firm_owner(h.organization_id)
        or (
          h.created_by = (select auth.uid())
          and app.has_org_role(
            h.organization_id,
            array['licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
        or exists (
          select 1
          from public.household_members hm
          join public.matter_participants mp
            on mp.person_id = hm.person_id
           and mp.organization_id = hm.organization_id
          where hm.household_id = h.id
            and hm.organization_id = h.organization_id
            and app.actor_staff_assigned_to_matter(mp.matter_id, h.organization_id)
        )
      )
  );
$$;

create function app.can_read_relationship(p_relationship_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.person_relationships r
    where r.id = p_relationship_id
      and app.in_active_org(r.organization_id)
      and app.staff_mfa_satisfied()
      and (
        app.actor_is_firm_owner(r.organization_id)
        or (
          r.created_by = (select auth.uid())
          and app.has_org_role(
            r.organization_id,
            array['licensed_consultant', 'case_manager']::public.org_role[]
          )
        )
      )
  );
$$;

create function app.can_read_grant(p_grant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_grants g
    where g.id = p_grant_id
      and app.in_active_org(g.organization_id)
      and (
        app.actor_is_firm_owner(g.organization_id)
        or exists (
          select 1
          from public.persons person
          where person.organization_id = g.organization_id
            and person.user_id = (select auth.uid())
            and (person.id = g.grantee_person_id or person.id = g.subject_person_id)
        )
      )
  );
$$;

create function app.can_insert_practice_row(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and app.staff_mfa_satisfied()
     and app.has_org_role(
       p_org,
       array['firm_owner', 'licensed_consultant', 'case_manager']::public.org_role[]
     );
$$;

create function app.can_manage_access(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.in_active_org(p_org)
     and app.actor_is_firm_owner(p_org)
     and app.mfa_step_up_satisfied();
$$;

revoke all on function app.actor_is_firm_owner(uuid) from public;
revoke all on function app.actor_staff_assigned_to_matter(uuid, uuid) from public;
revoke all on function app.grant_allows(uuid, uuid, uuid) from public;
revoke all on function app.can_read_person(uuid) from public;
revoke all on function app.can_write_person(uuid) from public;
revoke all on function app.can_read_matter(uuid) from public;
revoke all on function app.can_read_matter_participant(uuid) from public;
revoke all on function app.can_read_household(uuid) from public;
revoke all on function app.can_read_relationship(uuid) from public;
revoke all on function app.can_read_grant(uuid) from public;
revoke all on function app.can_insert_practice_row(uuid) from public;
revoke all on function app.can_manage_access(uuid) from public;

grant execute on function app.actor_is_firm_owner(uuid) to authenticated, service_role;
grant execute on function app.actor_staff_assigned_to_matter(uuid, uuid) to authenticated, service_role;
grant execute on function app.grant_allows(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function app.can_read_person(uuid) to authenticated, service_role;
grant execute on function app.can_write_person(uuid) to authenticated, service_role;
grant execute on function app.can_read_matter(uuid) to authenticated, service_role;
grant execute on function app.can_read_matter_participant(uuid) to authenticated, service_role;
grant execute on function app.can_read_household(uuid) to authenticated, service_role;
grant execute on function app.can_read_relationship(uuid) to authenticated, service_role;
grant execute on function app.can_read_grant(uuid) to authenticated, service_role;
grant execute on function app.can_insert_practice_row(uuid) to authenticated, service_role;
grant execute on function app.can_manage_access(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Privileges and RLS. No DELETE policies.
-- ---------------------------------------------------------------------------
revoke all on table public.persons from anon, authenticated;
revoke all on table public.matters from anon, authenticated;
revoke all on table public.matter_participants from anon, authenticated;
revoke all on table public.households from anon, authenticated;
revoke all on table public.household_members from anon, authenticated;
revoke all on table public.person_relationships from anon, authenticated;
revoke all on table public.access_grants from anon, authenticated;

grant select, insert, update on table public.persons to authenticated;
grant select, insert, update on table public.matters to authenticated;
grant select, insert, update on table public.matter_participants to authenticated;
grant select, insert, update on table public.households to authenticated;
grant select, insert, update on table public.household_members to authenticated;
grant select, insert, update on table public.person_relationships to authenticated;
grant select, insert, update on table public.access_grants to authenticated;

alter table public.persons enable row level security;
alter table public.persons force row level security;
alter table public.matters enable row level security;
alter table public.matters force row level security;
alter table public.matter_participants enable row level security;
alter table public.matter_participants force row level security;
alter table public.households enable row level security;
alter table public.households force row level security;
alter table public.household_members enable row level security;
alter table public.household_members force row level security;
alter table public.person_relationships enable row level security;
alter table public.person_relationships force row level security;
alter table public.access_grants enable row level security;
alter table public.access_grants force row level security;

create policy persons_select on public.persons
  for select to authenticated
  using ((select app.can_read_person(id)));
create policy persons_insert on public.persons
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy persons_update on public.persons
  for update to authenticated
  using ((select app.can_write_person(id)))
  with check (
    (select app.can_write_person(id))
    and (select app.in_active_org(organization_id))
  );

create policy matters_select on public.matters
  for select to authenticated
  using ((select app.can_read_matter(id)));
create policy matters_insert on public.matters
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy matters_update on public.matters
  for update to authenticated
  using (
    (select app.can_read_matter(id))
    and (select app.staff_mfa_satisfied())
  )
  with check ((select app.in_active_org(organization_id)));

create policy matter_participants_select on public.matter_participants
  for select to authenticated
  using ((select app.can_read_matter_participant(id)));
create policy matter_participants_insert on public.matter_participants
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy matter_participants_update on public.matter_participants
  for update to authenticated
  using ((select app.can_insert_practice_row(organization_id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy households_select on public.households
  for select to authenticated
  using ((select app.can_read_household(id)));
create policy households_insert on public.households
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy households_update on public.households
  for update to authenticated
  using ((select app.can_read_household(id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy household_members_select on public.household_members
  for select to authenticated
  using ((select app.can_read_household(household_id)));
create policy household_members_insert on public.household_members
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy household_members_update on public.household_members
  for update to authenticated
  using ((select app.can_read_household(household_id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy person_relationships_select on public.person_relationships
  for select to authenticated
  using ((select app.can_read_relationship(id)));
create policy person_relationships_insert on public.person_relationships
  for insert to authenticated
  with check ((select app.can_insert_practice_row(organization_id)));
create policy person_relationships_update on public.person_relationships
  for update to authenticated
  using ((select app.can_read_relationship(id)))
  with check ((select app.can_insert_practice_row(organization_id)));

create policy access_grants_select on public.access_grants
  for select to authenticated
  using ((select app.can_read_grant(id)));
create policy access_grants_insert on public.access_grants
  for insert to authenticated
  with check ((select app.can_manage_access(organization_id)));
create policy access_grants_update on public.access_grants
  for update to authenticated
  using ((select app.can_manage_access(organization_id)))
  with check ((select app.can_manage_access(organization_id)));
