-- Covering indexes for foreign keys the performance advisor flags on the
-- practice tables added after 20261017083908. Additive only.
-- A partial index does not cover every row, so person_break_glass.actor_user_id
-- gets a non-partial index beside the open-grant index.

create index if not exists matter_stage_evidence_org_fk_idx
  on public.matter_stage_evidence (organization_id);
create index if not exists matter_stage_evidence_matter_org_fk_idx
  on public.matter_stage_evidence (matter_id, organization_id);

create index if not exists matter_stage_transitions_org_fk_idx
  on public.matter_stage_transitions (organization_id);
create index if not exists matter_stage_transitions_matter_org_fk_idx
  on public.matter_stage_transitions (matter_id, organization_id);
create index if not exists matter_stage_transitions_evidence_org_fk_idx
  on public.matter_stage_transitions (evidence_id, organization_id);

create index if not exists person_break_glass_org_fk_idx
  on public.person_break_glass (organization_id);
create index if not exists person_break_glass_person_org_fk_idx
  on public.person_break_glass (person_id, organization_id);
create index if not exists person_break_glass_actor_user_fk_idx
  on public.person_break_glass (actor_user_id);

create index if not exists session_revocations_revoked_by_fk_idx
  on public.session_revocations (revoked_by);
create index if not exists session_revocations_org_fk_idx
  on public.session_revocations (organization_id);
