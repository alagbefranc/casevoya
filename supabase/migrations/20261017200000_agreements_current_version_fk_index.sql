-- Covering index for agreements_current_version_fkey (current_version_id, organization_id).
-- The earlier index agreements_current_version_idx covers only current_version_id.
-- Additive only.

create index agreements_current_version_org_fk_idx
  on public.agreements (current_version_id, organization_id);
