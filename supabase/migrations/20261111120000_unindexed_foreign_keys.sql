-- Covering indexes for foreign keys that the migrations do not already index.
-- Derived by scripts/unindexed-foreign-keys.mjs from supabase/migrations (public schema):
-- a foreign key is covered only when a non-partial index, primary key, or unique constraint
-- has those columns as its leftmost columns, in the same order. 41 keys were uncovered.
-- The live advisor had counted 38; this list is what the migration files imply, not a live query.
-- A concurrent index build cannot run in this file: the Supabase migration runner applies each
-- file inside a transaction, and that form of CREATE INDEX is not allowed in a transaction.
-- Apply on a quiet database, or run the same statements outside the runner, if lock time matters.
-- Not applied by this change.

create index if not exists booking_attendees_organization_id_fk_idx on public.booking_attendees (organization_id);
create index if not exists booking_event_type_hosts_organization_id_fk_idx on public.booking_event_type_hosts (organization_id);
create index if not exists booking_events_organization_id_fk_idx on public.booking_events (organization_id);
create index if not exists booking_manage_tokens_booking_id_organization_id_fk_idx on public.booking_manage_tokens (booking_id, organization_id);
create index if not exists booking_provider_meetings_booking_id_organization_id_fk_idx on public.booking_provider_meetings (booking_id, organization_id);
create index if not exists calendly_sync_state_membership_id_organization_id_fk_idx on public.calendly_sync_state (membership_id, organization_id);
create index if not exists client_fund_bank_transfers_organization_id_fk_idx on public.client_fund_bank_transfers (organization_id);
create index if not exists client_fund_deposit_reviews_organization_id_fk_idx on public.client_fund_deposit_reviews (organization_id);
create index if not exists client_fund_ledgers_organization_id_fk_idx on public.client_fund_ledgers (organization_id);
create index if not exists client_reconciliation_adjustments_organization_id_fk_idx on public.client_reconciliation_adjustments (organization_id);
create index if not exists complaint_handlers_organization_id_fk_idx on public.complaint_handlers (organization_id);
create index if not exists consultant_connect_requests_lead_id_fk_idx on public.consultant_connect_requests (lead_id);
create index if not exists consultant_connect_requests_organization_id_fk_idx on public.consultant_connect_requests (organization_id);
create index if not exists consultant_connect_requests_sent_by_fk_idx on public.consultant_connect_requests (sent_by);
create index if not exists deletion_tombstones_job_id_organization_id_fk_idx on public.deletion_tombstones (job_id, organization_id);
create index if not exists feature_flag_overrides_updated_by_fk_idx on public.feature_flag_overrides (updated_by);
create index if not exists feature_flags_updated_by_fk_idx on public.feature_flags (updated_by);
create index if not exists firm_shared_template_adoptions_template_id_fk_idx on public.firm_shared_template_adoptions (template_id);
create index if not exists firm_shared_template_overrides_template_id_fk_idx on public.firm_shared_template_overrides (template_id);
create index if not exists firm_transfer_items_organization_id_fk_idx on public.firm_transfer_items (organization_id);
create index if not exists intake_fact_reuses_response_id_organization_id_fk_idx on public.intake_fact_reuses (response_id, organization_id);
create index if not exists lead_booking_links_organization_id_fk_idx on public.lead_booking_links (organization_id);
create index if not exists lead_consents_organization_id_fk_idx on public.lead_consents (organization_id);
create index if not exists lead_duplicate_decisions_organization_id_fk_idx on public.lead_duplicate_decisions (organization_id);
create index if not exists lead_events_organization_id_fk_idx on public.lead_events (organization_id);
create index if not exists lead_follow_ups_organization_id_fk_idx on public.lead_follow_ups (organization_id);
create index if not exists lead_notes_organization_id_fk_idx on public.lead_notes (organization_id);
create index if not exists matter_closures_organization_id_fk_idx on public.matter_closures (organization_id);
create index if not exists matter_legal_holds_organization_id_fk_idx on public.matter_legal_holds (organization_id);
create index if not exists matter_letter_versions_organization_id_fk_idx on public.matter_letter_versions (organization_id);
create index if not exists matter_shared_template_pins_template_id_fk_idx on public.matter_shared_template_pins (template_id);
create index if not exists mfa_reset_requests_requester_user_id_fk_idx on public.mfa_reset_requests (requester_user_id);
create index if not exists organizations_live_by_fk_idx on public.organizations (live_by);
create index if not exists platform_config_changes_actor_user_id_fk_idx on public.platform_config_changes (actor_user_id);
create index if not exists platform_config_changes_organization_id_fk_idx on public.platform_config_changes (organization_id);
create index if not exists platform_config_changes_reverts_change_id_fk_idx on public.platform_config_changes (reverts_change_id);
create index if not exists portal_notices_organization_id_fk_idx on public.portal_notices (organization_id);
create index if not exists privacy_request_deliveries_organization_id_fk_idx on public.privacy_request_deliveries (organization_id);
create index if not exists privacy_request_items_organization_id_fk_idx on public.privacy_request_items (organization_id);
create index if not exists privacy_request_redactions_organization_id_fk_idx on public.privacy_request_redactions (organization_id);
create index if not exists privacy_response_downloads_organization_id_fk_idx on public.privacy_response_downloads (organization_id);
