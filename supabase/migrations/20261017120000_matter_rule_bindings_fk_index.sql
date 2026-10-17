-- Covering index for the matter_rule_bindings (matter_id, organization_id) foreign key
-- flagged by the Supabase performance advisor (lint 0001_unindexed_foreign_keys).
-- Additive only: creates an index, changes no data. NOT applied to the live project.
create index if not exists matter_rule_bindings_matter_org_fk_idx on public.matter_rule_bindings (matter_id, organization_id);
