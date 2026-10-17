-- Covering indexes for foreign keys flagged by the Supabase performance advisor
-- (lint 0001_unindexed_foreign_keys) after the T006/T007/T010 migrations.
-- Additive only: creates indexes, changes no data. NOT yet applied to live.
create index if not exists access_grants_grantee_org_fk_idx on public.access_grants (grantee_person_id, organization_id);
create index if not exists access_grants_subject_org_fk_idx on public.access_grants (subject_person_id, organization_id);
create index if not exists access_grants_matter_org_fk_idx on public.access_grants (matter_id, organization_id);
create index if not exists access_grants_org_fk_idx on public.access_grants (organization_id);
create index if not exists household_members_household_org_fk_idx on public.household_members (household_id, organization_id);
create index if not exists household_members_person_org_fk_idx on public.household_members (person_id, organization_id);
create index if not exists household_members_org_fk_idx on public.household_members (organization_id);
create index if not exists invitations_membership_org_fk_idx on public.invitations (membership_id, organization_id);
create index if not exists matter_participants_matter_org_fk_idx on public.matter_participants (matter_id, organization_id);
create index if not exists matter_participants_membership_org_fk_idx on public.matter_participants (membership_id, organization_id);
create index if not exists matter_participants_person_org_fk_idx on public.matter_participants (person_id, organization_id);
create index if not exists matter_participants_org_fk_idx on public.matter_participants (organization_id);
create index if not exists person_relationships_from_org_fk_idx on public.person_relationships (from_person_id, organization_id);
create index if not exists person_relationships_to_org_fk_idx on public.person_relationships (to_person_id, organization_id);
create index if not exists persons_user_fk_idx on public.persons (user_id);
