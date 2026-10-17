-- Covering indexes for organization_id foreign keys the performance advisor
-- flagged on the portal tables. The existing composites lead with person_id,
-- matter_id, or subject_person_id, so they do not cover references to
-- organizations(id). Additive only.

create index consent_records_organization_id_idx
  on public.consent_records (organization_id);

create index person_section_records_organization_id_idx
  on public.person_section_records (organization_id);

create index section_shares_organization_id_idx
  on public.section_shares (organization_id);
