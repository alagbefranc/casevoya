// Live schema (project aqjtvqmojfamtspzyeqm) through 20261017113202, extended in-repo
// for unapplied migrations 20261017120000, 20261017140000–20261017140800,
// 20261017160000 (preview_invitation, request_mfa_reset),
// 20261017170000–20261017170300, 20261017180000–20261017180100,
// 20261017190000–20261017190100, and 20261017200000–20261017200200.
// 20261017200300 only sets search_path on app.reserved_firm_slugs. It does not change this file.
// Regenerate with `pnpm db:types` only after those migrations are applied live.
// Table types for tasks, deadlines, intake, engagement and inbound-attachment tables were copied
// from `pnpm db:types` on 2026-10-17; function signatures keep their hand-reviewed optional arguments.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      access_grants: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          grantee_person_id: string
          id: string
          kind: Database["public"]["Enums"]["access_grant_kind"]
          matter_id: string | null
          organization_id: string
          purpose: string
          revoked_at: string | null
          subject_person_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          grantee_person_id: string
          id?: string
          kind: Database["public"]["Enums"]["access_grant_kind"]
          matter_id?: string | null
          organization_id: string
          purpose: string
          revoked_at?: string | null
          subject_person_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          grantee_person_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["access_grant_kind"]
          matter_id?: string | null
          organization_id?: string
          purpose?: string
          revoked_at?: string | null
          subject_person_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "access_grants_grantee_person_id_organization_id_fkey"
            columns: ["grantee_person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "access_grants_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "access_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_grants_subject_person_id_organization_id_fkey"
            columns: ["subject_person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      agreement_clauses: {
        Row: {
          agreement_version_id: string
          body: string
          created_at: string
          headed: boolean
          id: string
          mandatory: boolean
          organization_id: string
          position: number
          source: Database["public"]["Enums"]["agreement_clause_source"]
          title: string
        }
        Insert: {
          agreement_version_id: string
          body: string
          created_at?: string
          headed?: boolean
          id?: string
          mandatory?: boolean
          organization_id: string
          position: number
          source?: Database["public"]["Enums"]["agreement_clause_source"]
          title: string
        }
        Update: {
          agreement_version_id?: string
          body?: string
          created_at?: string
          headed?: boolean
          id?: string
          mandatory?: boolean
          organization_id?: string
          position?: number
          source?: Database["public"]["Enums"]["agreement_clause_source"]
          title?: string
        }
        Relationships: []
      }
      agreement_templates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["agreement_kind"]
          mandatory_clauses: string[] | null
          name: string
          organization_id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["agreement_kind"]
          mandatory_clauses?: string[] | null
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["agreement_kind"]
          mandatory_clauses?: string[] | null
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      agreement_versions: {
        Row: {
          agreement_id: string
          body: string | null
          canonical_body: string
          comparison_note: string | null
          content_sha256: string | null
          created_at: string
          created_by: string | null
          currency: string
          deliverables: string | null
          exclusions: string | null
          fee_cents: number | null
          fee_structure: string | null
          government_fee_note: string | null
          id: string
          locked_at: string | null
          organization_id: string
          refund_policy: string | null
          scope_summary: string
          services: string | null
          updated_at: string
          version: number
          version_number: number
        }
        Insert: {
          agreement_id: string
          body?: string | null
          canonical_body: string
          comparison_note?: string | null
          content_sha256?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deliverables?: string | null
          exclusions?: string | null
          fee_cents?: number | null
          fee_structure?: string | null
          government_fee_note?: string | null
          id?: string
          locked_at?: string | null
          organization_id: string
          refund_policy?: string | null
          scope_summary: string
          services?: string | null
          updated_at?: string
          version?: number
          version_number: number
        }
        Update: {
          agreement_id?: string
          body?: string | null
          canonical_body?: string
          comparison_note?: string | null
          content_sha256?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deliverables?: string | null
          exclusions?: string | null
          fee_cents?: number | null
          fee_structure?: string | null
          government_fee_note?: string | null
          id?: string
          locked_at?: string | null
          organization_id?: string
          refund_policy?: string | null
          scope_summary?: string
          services?: string | null
          updated_at?: string
          version?: number
          version_number?: number
        }
        Relationships: []
      }
      agreements: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string | null
          current_version_id: string | null
          id: string
          kind: Database["public"]["Enums"]["agreement_kind"]
          matter_id: string
          organization_id: string
          quote_expires_on: string | null
          status: Database["public"]["Enums"]["agreement_status"]
          supersedes_id: string | null
          template_id: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["agreement_kind"]
          matter_id: string
          organization_id: string
          quote_expires_on?: string | null
          status?: Database["public"]["Enums"]["agreement_status"]
          supersedes_id?: string | null
          template_id?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["agreement_kind"]
          matter_id?: string
          organization_id?: string
          quote_expires_on?: string | null
          status?: Database["public"]["Enums"]["agreement_status"]
          supersedes_id?: string | null
          template_id?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_type: string
          actor_user_id: string | null
          context: Json
          db_role: string
          diff: Json
          id: string
          object_id: string | null
          object_table: string | null
          occurred_at: string
          organization_id: string | null
          request_id: string | null
          result: string
        }
        Insert: {
          action: string
          actor_type: string
          actor_user_id?: string | null
          context?: Json
          db_role?: string
          diff?: Json
          id?: string
          object_id?: string | null
          object_table?: string | null
          occurred_at?: string
          organization_id?: string | null
          request_id?: string | null
          result?: string
        }
        Update: {
          action?: string
          actor_type?: string
          actor_user_id?: string | null
          context?: Json
          db_role?: string
          diff?: Json
          id?: string
          object_id?: string | null
          object_table?: string | null
          occurred_at?: string
          organization_id?: string | null
          request_id?: string | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_session_cutoffs: {
        Row: {
          sessions_valid_after: string
          updated_at: string
          user_id: string
        }
        Insert: {
          sessions_valid_after: string
          updated_at?: string
          user_id: string
        }
        Update: {
          sessions_valid_after?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      availability_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          end_local: string | null
          id: string
          on_date: string
          organization_id: string
          schedule_id: string
          start_local: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_local?: string | null
          id?: string
          on_date: string
          organization_id: string
          schedule_id: string
          start_local?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_local?: string | null
          id?: string
          on_date?: string
          organization_id?: string
          schedule_id?: string
          start_local?: string | null
        }
        Relationships: []
      }
      availability_rules: {
        Row: {
          created_at: string
          created_by: string | null
          end_local: string
          id: string
          organization_id: string
          schedule_id: string
          start_local: string
          weekday: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_local: string
          id?: string
          organization_id: string
          schedule_id: string
          start_local: string
          weekday: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_local?: string
          id?: string
          organization_id?: string
          schedule_id?: string
          start_local?: string
          weekday?: number
        }
        Relationships: []
      }
      availability_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          membership_id: string
          name: string
          organization_id: string
          time_zone: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          membership_id: string
          name?: string
          organization_id: string
          time_zone: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          membership_id?: string
          name?: string
          organization_id?: string
          time_zone?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      booking_agreement_codes: {
        Row: {
          attempts: number
          booking_agreement_id: string
          code_sha256: string
          created_at: string
          expires_at: string
          id: string
          organization_id: string
          session_sha256: string | null
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          booking_agreement_id: string
          code_sha256: string
          created_at?: string
          expires_at: string
          id?: string
          organization_id: string
          session_sha256?: string | null
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          booking_agreement_id?: string
          code_sha256?: string
          created_at?: string
          expires_at?: string
          id?: string
          organization_id?: string
          session_sha256?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      booking_agreements: {
        Row: {
          body: string
          booking_id: string
          consent_text: string | null
          consent_version: string | null
          content_sha256: string
          created_at: string
          decline_reason: string | null
          declined_at: string | null
          id: string
          is_sample: boolean
          last_request_at: string | null
          last_request_kind: string | null
          opened_at: string | null
          organization_id: string
          reminded_at: string | null
          reminder_count: number
          sent_at: string
          sent_by: string | null
          signed_at: string | null
          signature_image: string | null
          signature_kind: string | null
          signed_name: string | null
          signer_ip: unknown
          signer_user_agent: string | null
          status: string
          template_id: string
          template_version: number
          title: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          body: string
          booking_id: string
          consent_text?: string | null
          consent_version?: string | null
          content_sha256: string
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          id?: string
          is_sample?: boolean
          last_request_at?: string | null
          last_request_kind?: string | null
          opened_at?: string | null
          organization_id: string
          reminded_at?: string | null
          reminder_count?: number
          sent_at?: string
          sent_by?: string | null
          signed_at?: string | null
          signature_image?: string | null
          signature_kind?: string | null
          signed_name?: string | null
          signer_ip?: unknown
          signer_user_agent?: string | null
          status?: string
          template_id: string
          template_version: number
          title: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          body?: string
          booking_id?: string
          consent_text?: string | null
          consent_version?: string | null
          content_sha256?: string
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          id?: string
          is_sample?: boolean
          last_request_at?: string | null
          last_request_kind?: string | null
          opened_at?: string | null
          organization_id?: string
          reminded_at?: string | null
          reminder_count?: number
          sent_at?: string
          sent_by?: string | null
          signed_at?: string | null
          signature_image?: string | null
          signature_kind?: string | null
          signed_name?: string | null
          signer_ip?: unknown
          signer_user_agent?: string | null
          status?: string
          template_id?: string
          template_version?: number
          title?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: []
      }
      booking_attendees: {
        Row: {
          booking_id: string
          created_at: string
          created_by: string | null
          display_name: string
          email: string
          id: string
          locale: string
          organization_id: string
          person_id: string | null
          phone: string | null
          role: string
          time_zone: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          created_by?: string | null
          display_name: string
          email: string
          id?: string
          locale?: string
          organization_id: string
          person_id?: string | null
          phone?: string | null
          role?: string
          time_zone: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          email?: string
          id?: string
          locale?: string
          organization_id?: string
          person_id?: string | null
          phone?: string | null
          role?: string
          time_zone?: string
        }
        Relationships: []
      }
      booking_event_type_hosts: {
        Row: {
          created_at: string
          created_by: string | null
          event_type_id: string
          id: string
          membership_id: string
          organization_id: string
          position: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type_id: string
          id?: string
          membership_id: string
          organization_id: string
          position?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type_id?: string
          id?: string
          membership_id?: string
          organization_id?: string
          position?: number
        }
        Relationships: []
      }
      booking_event_types: {
        Row: {
          agreement_template_id: string | null
          archived_at: string | null
          buffer_after_min: number
          buffer_before_min: number
          created_at: string
          created_by: string | null
          currency: string
          daily_capacity: number | null
          description: string | null
          duration_min: number
          id: string
          is_published: boolean
          is_sample: boolean
          location_detail: string | null
          location_kind: Database["public"]["Enums"]["booking_location_kind"]
          max_advance_days: number
          min_notice_min: number
          organization_id: string
          price_cents: number
          refund_cutoff_hours: number
          refund_policy: string
          slot_step_min: number | null
          slug: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          agreement_template_id?: string | null
          archived_at?: string | null
          buffer_after_min?: number
          buffer_before_min?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          daily_capacity?: number | null
          description?: string | null
          duration_min: number
          id?: string
          is_published?: boolean
          is_sample?: boolean
          location_detail?: string | null
          location_kind?: Database["public"]["Enums"]["booking_location_kind"]
          max_advance_days?: number
          min_notice_min?: number
          organization_id: string
          price_cents?: number
          refund_cutoff_hours?: number
          refund_policy?: string
          slot_step_min?: number | null
          slug: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          agreement_template_id?: string | null
          archived_at?: string | null
          buffer_after_min?: number
          buffer_before_min?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          daily_capacity?: number | null
          description?: string | null
          duration_min?: number
          id?: string
          is_published?: boolean
          is_sample?: boolean
          location_detail?: string | null
          location_kind?: Database["public"]["Enums"]["booking_location_kind"]
          max_advance_days?: number
          min_notice_min?: number
          organization_id?: string
          price_cents?: number
          refund_cutoff_hours?: number
          refund_policy?: string
          slot_step_min?: number | null
          slug?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      booking_events: {
        Row: {
          actor: Database["public"]["Enums"]["booking_actor"]
          actor_user_id: string | null
          booking_id: string
          created_at: string
          id: string
          kind: string
          organization_id: string
          payload: Json
        }
        Insert: {
          actor: Database["public"]["Enums"]["booking_actor"]
          actor_user_id?: string | null
          booking_id: string
          created_at?: string
          id?: string
          kind: string
          organization_id: string
          payload?: Json
        }
        Update: {
          actor?: Database["public"]["Enums"]["booking_actor"]
          actor_user_id?: string | null
          booking_id?: string
          created_at?: string
          id?: string
          kind?: string
          organization_id?: string
          payload?: Json
        }
        Relationships: []
      }
      booking_hold_attempts: {
        Row: {
          client_hash: string | null
          created_at: string
          id: string
          organization_id: string
        }
        Insert: {
          client_hash?: string | null
          created_at?: string
          id?: string
          organization_id: string
        }
        Update: {
          client_hash?: string | null
          created_at?: string
          id?: string
          organization_id?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          attendee_time_zone: string
          blocked_from: string
          blocked_until: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: Database["public"]["Enums"]["booking_actor"] | null
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          ends_at: string
          event_type_id: string
          hold_expires_at: string | null
          host_membership_id: string
          host_name: string | null
          host_time_zone: string
          host_user_id: string
          ics_sequence: number
          id: string
          idempotency_key: string
          is_sample: boolean
          location_detail: string | null
          location_kind: Database["public"]["Enums"]["booking_location_kind"]
          matter_id: string | null
          organization_id: string
          outcome_at: string | null
          person_id: string | null
          price_cents: number
          public_ref: string
          source: string
          starts_at: string
          status: Database["public"]["Enums"]["booking_status"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          attendee_time_zone: string
          blocked_from: string
          blocked_until: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: Database["public"]["Enums"]["booking_actor"] | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          ends_at: string
          event_type_id: string
          hold_expires_at?: string | null
          host_membership_id: string
          host_name?: string | null
          host_time_zone: string
          host_user_id: string
          ics_sequence?: number
          id?: string
          idempotency_key: string
          is_sample?: boolean
          location_detail?: string | null
          location_kind: Database["public"]["Enums"]["booking_location_kind"]
          matter_id?: string | null
          organization_id: string
          outcome_at?: string | null
          person_id?: string | null
          price_cents?: number
          public_ref: string
          source: string
          starts_at: string
          status?: Database["public"]["Enums"]["booking_status"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          attendee_time_zone?: string
          blocked_from?: string
          blocked_until?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: Database["public"]["Enums"]["booking_actor"] | null
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          ends_at?: string
          event_type_id?: string
          hold_expires_at?: string | null
          host_membership_id?: string
          host_name?: string | null
          host_time_zone?: string
          host_user_id?: string
          ics_sequence?: number
          id?: string
          idempotency_key?: string
          is_sample?: boolean
          location_detail?: string | null
          location_kind?: Database["public"]["Enums"]["booking_location_kind"]
          matter_id?: string | null
          organization_id?: string
          outcome_at?: string | null
          person_id?: string | null
          price_cents?: number
          public_ref?: string
          source?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["booking_status"]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      cicc_register_entries: {
        Row: {
          college_fields: Json
          created_at: string
          entitlement: string | null
          first_name: string | null
          full_name: string
          id: string
          import_id: string
          last_name: string | null
          licence_class: string | null
          licence_number: string
          licence_number_raw: string
          status: string
        }
        Insert: {
          college_fields?: Json
          created_at?: string
          entitlement?: string | null
          first_name?: string | null
          full_name: string
          id?: string
          import_id: string
          last_name?: string | null
          licence_class?: string | null
          licence_number: string
          licence_number_raw: string
          status: string
        }
        Update: {
          college_fields?: Json
          created_at?: string
          entitlement?: string | null
          first_name?: string | null
          full_name?: string
          id?: string
          import_id?: string
          last_name?: string | null
          licence_class?: string | null
          licence_number?: string
          licence_number_raw?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cicc_register_entries_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "cicc_register_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      cicc_register_imports: {
        Row: {
          completed_at: string | null
          file_locator: string | null
          file_sha256: string | null
          id: string
          imported_at: string
          imported_by: string
          row_count: number
          source_note: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          file_locator?: string | null
          file_sha256?: string | null
          id?: string
          imported_at?: string
          imported_by: string
          row_count?: number
          source_note: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          file_locator?: string | null
          file_sha256?: string | null
          id?: string
          imported_at?: string
          imported_by?: string
          row_count?: number
          source_note?: string
          status?: string
        }
        Relationships: []
      }
      client_account_reconciliations: {
        Row: {
          adjusted_balance_cents: number | null
          client_account_id: string
          client_count: number
          client_ledgers_total_cents: number
          created_at: string
          created_by: string | null
          currency: string
          difference_cents: number
          discard_reason: string | null
          discarded_at: string | null
          discarded_by: string | null
          id: string
          idempotency_key: string
          is_sample: boolean
          item_count: number
          items: Json
          ledger_balance_cents: number
          organization_id: string
          owner_self_signed: boolean
          period_start: string
          prepared_at: string
          prepared_by: string
          preparer_note: string | null
          review_notes: string | null
          signed_at: string | null
          signed_by: string | null
          statement_balance_cents: number
          statement_date: string
          status: Database["public"]["Enums"]["client_reconciliation_status"]
          updated_at: string
          version: number
        }
        Insert: {
          adjusted_balance_cents?: number | null
          client_account_id?: string
          client_count?: number
          client_ledgers_total_cents?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          difference_cents?: number
          discard_reason?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          id?: string
          idempotency_key?: string
          is_sample?: boolean
          item_count?: number
          items?: Json
          ledger_balance_cents?: number
          organization_id?: string
          owner_self_signed?: boolean
          period_start?: string
          prepared_at?: string
          prepared_by?: string
          preparer_note?: string | null
          review_notes?: string | null
          signed_at?: string | null
          signed_by?: string | null
          statement_balance_cents?: number
          statement_date?: string
          status?: Database["public"]["Enums"]["client_reconciliation_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          adjusted_balance_cents?: number | null
          client_account_id?: string
          client_count?: number
          client_ledgers_total_cents?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          difference_cents?: number
          discard_reason?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          id?: string
          idempotency_key?: string
          is_sample?: boolean
          item_count?: number
          items?: Json
          ledger_balance_cents?: number
          organization_id?: string
          owner_self_signed?: boolean
          period_start?: string
          prepared_at?: string
          prepared_by?: string
          preparer_note?: string | null
          review_notes?: string | null
          signed_at?: string | null
          signed_by?: string | null
          statement_balance_cents?: number
          statement_date?: string
          status?: Database["public"]["Enums"]["client_reconciliation_status"]
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      client_accounts: {
        Row: {
          account_last4: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          institution: string
          is_active: boolean
          label: string
          organization_id: string
          updated_at: string
          version: number
        }
        Insert: {
          account_last4: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          institution: string
          is_active?: boolean
          label: string
          organization_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          account_last4?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          institution?: string
          is_active?: boolean
          label?: string
          organization_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      client_credit_allocations: {
        Row: {
          amount_cents: number
          bank_method: string | null
          bank_reference: string | null
          created_at: string
          created_by: string | null
          credit_id: string
          currency: string
          id: string
          idempotency_key: string | null
          kind: string
          organization_id: string
          refund_id: string | null
          refunded_on: string | null
          target_invoice_id: string | null
        }
        Insert: {
          amount_cents: number
          bank_method?: string | null
          bank_reference?: string | null
          created_at?: string
          created_by?: string | null
          credit_id: string
          currency: string
          id?: string
          idempotency_key?: string | null
          kind: string
          organization_id: string
          refund_id?: string | null
          refunded_on?: string | null
          target_invoice_id?: string | null
        }
        Update: {
          amount_cents?: number
          bank_method?: string | null
          bank_reference?: string | null
          created_at?: string
          created_by?: string | null
          credit_id?: string
          currency?: string
          id?: string
          idempotency_key?: string | null
          kind?: string
          organization_id?: string
          refund_id?: string | null
          refunded_on?: string | null
          target_invoice_id?: string | null
        }
        Relationships: []
      }
      client_credits: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          id: string
          matter_id: string
          number: string
          opened_cents: number
          organization_id: string
          settled_at: string | null
          source_invoice_id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          matter_id: string
          number: string
          opened_cents: number
          organization_id: string
          settled_at?: string | null
          source_invoice_id: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          matter_id?: string
          number?: string
          opened_cents?: number
          organization_id?: string
          settled_at?: string | null
          source_invoice_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      client_fund_bank_transfers: {
        Row: {
          amount_cents: number
          bank_reference: string
          created_at: string
          created_by: string | null
          entry_id: string
          id: string
          invoice_id: string
          is_sample: boolean
          ledger_id: string
          matter_id: string
          note: string | null
          organization_id: string
          recorded_by: string
          transferred_on: string
          withdraw_by: string
        }
        Insert: {
          amount_cents: number
          bank_reference: string
          created_at?: string
          created_by?: string | null
          entry_id: string
          id?: string
          invoice_id: string
          is_sample?: boolean
          ledger_id: string
          matter_id: string
          note?: string | null
          organization_id: string
          recorded_by: string
          transferred_on: string
          withdraw_by: string
        }
        Update: {
          amount_cents?: number
          bank_reference?: string
          created_at?: string
          created_by?: string | null
          entry_id?: string
          id?: string
          invoice_id?: string
          is_sample?: boolean
          ledger_id?: string
          matter_id?: string
          note?: string | null
          organization_id?: string
          recorded_by?: string
          transferred_on?: string
          withdraw_by?: string
        }
        Relationships: []
      }
      client_fund_deposit_reviews: {
        Row: {
          created_at: string
          created_by: string | null
          entry_id: string
          evidence_version_id: string | null
          matter_id: string
          organization_id: string
          reviewer_user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entry_id: string
          evidence_version_id?: string | null
          matter_id: string
          organization_id: string
          reviewer_user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entry_id?: string
          evidence_version_id?: string | null
          matter_id?: string
          organization_id?: string
          reviewer_user_id?: string
        }
        Relationships: []
      }
      client_fund_entries: {
        Row: {
          amount_cents: number
          approved_at: string | null
          approved_by: string | null
          client_account_id: string
          created_at: string
          created_by: string | null
          currency: string
          decline_reason: string | null
          declined_at: string | null
          declined_by: string | null
          direction: string
          evidence_note: string | null
          external_reference: string | null
          id: string
          idempotency_key: string
          invoice_id: string | null
          is_sample: boolean
          kind: Database["public"]["Enums"]["client_fund_entry_kind"]
          ledger_id: string
          matter_id: string
          method: Database["public"]["Enums"]["client_fund_method"] | null
          note: string | null
          number: string
          occurred_on: string
          organization_id: string
          owner_self_approved: boolean
          person_id: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          requested_by: string
          reverses_entry_id: string | null
          status: Database["public"]["Enums"]["client_fund_entry_status"]
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          verified_by_owner_self: boolean
          version: number
        }
        Insert: {
          amount_cents: number
          approved_at?: string | null
          approved_by?: string | null
          client_account_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          decline_reason?: string | null
          declined_at?: string | null
          declined_by?: string | null
          direction: string
          evidence_note?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key: string
          invoice_id?: string | null
          is_sample?: boolean
          kind: Database["public"]["Enums"]["client_fund_entry_kind"]
          ledger_id: string
          matter_id: string
          method?: Database["public"]["Enums"]["client_fund_method"] | null
          note?: string | null
          number: string
          occurred_on: string
          organization_id: string
          owner_self_approved?: boolean
          person_id: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_by: string
          reverses_entry_id?: string | null
          status: Database["public"]["Enums"]["client_fund_entry_status"]
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          verified_by_owner_self?: boolean
          version?: number
        }
        Update: {
          amount_cents?: number
          approved_at?: string | null
          approved_by?: string | null
          client_account_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          decline_reason?: string | null
          declined_at?: string | null
          declined_by?: string | null
          direction?: string
          evidence_note?: string | null
          external_reference?: string | null
          id?: string
          idempotency_key?: string
          invoice_id?: string | null
          is_sample?: boolean
          kind?: Database["public"]["Enums"]["client_fund_entry_kind"]
          ledger_id?: string
          matter_id?: string
          method?: Database["public"]["Enums"]["client_fund_method"] | null
          note?: string | null
          number?: string
          occurred_on?: string
          organization_id?: string
          owner_self_approved?: boolean
          person_id?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_by?: string
          reverses_entry_id?: string | null
          status?: Database["public"]["Enums"]["client_fund_entry_status"]
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          verified_by_owner_self?: boolean
          version?: number
        }
        Relationships: []
      }
      client_fund_ledgers: {
        Row: {
          client_account_id: string
          created_at: string
          created_by: string | null
          id: string
          is_sample: boolean
          matter_id: string
          organization_id: string
          person_id: string
          updated_at: string
          version: number
        }
        Insert: {
          client_account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_sample?: boolean
          matter_id: string
          organization_id: string
          person_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          client_account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_sample?: boolean
          matter_id?: string
          organization_id?: string
          person_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      client_fund_receipts: {
        Row: {
          account_institution: string
          account_label: string
          account_last4: string
          amount_cents: number
          client_name: string
          consultant_licence: string | null
          consultant_name: string | null
          created_at: string
          created_by: string | null
          currency: string
          entry_id: string
          external_reference: string | null
          firm_display_name: string
          firm_legal_name: string
          firm_timezone: string
          id: string
          is_sample: boolean
          issued_at: string
          issued_by: string | null
          ledger_id: string
          matter_id: string
          matter_label: string
          method: Database["public"]["Enums"]["client_fund_method"]
          number: string
          organization_id: string
          person_id: string
          received_on: string
        }
        Insert: {
          account_institution: string
          account_label: string
          account_last4: string
          amount_cents: number
          client_name: string
          consultant_licence?: string | null
          consultant_name?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          entry_id: string
          external_reference?: string | null
          firm_display_name: string
          firm_legal_name: string
          firm_timezone: string
          id?: string
          is_sample?: boolean
          issued_at?: string
          issued_by?: string | null
          ledger_id: string
          matter_id: string
          matter_label: string
          method: Database["public"]["Enums"]["client_fund_method"]
          number: string
          organization_id: string
          person_id: string
          received_on: string
        }
        Update: {
          account_institution?: string
          account_label?: string
          account_last4?: string
          amount_cents?: number
          client_name?: string
          consultant_licence?: string | null
          consultant_name?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          entry_id?: string
          external_reference?: string | null
          firm_display_name?: string
          firm_legal_name?: string
          firm_timezone?: string
          id?: string
          is_sample?: boolean
          issued_at?: string
          issued_by?: string | null
          ledger_id?: string
          matter_id?: string
          matter_label?: string
          method?: Database["public"]["Enums"]["client_fund_method"]
          number?: string
          organization_id?: string
          person_id?: string
          received_on?: string
        }
        Relationships: []
      }
      client_mfa_resets: {
        Row: {
          created_at: string
          id: string
          identity_method: string
          note: string | null
          organization_id: string
          person_id: string
          reset_by: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          identity_method: string
          note?: string | null
          organization_id: string
          person_id: string
          reset_by: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          identity_method?: string
          note?: string | null
          organization_id?: string
          person_id?: string
          reset_by?: string
          user_id?: string
        }
        Relationships: []
      }
      client_reconciliation_adjustments: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          description: string
          id: string
          item_date: string
          kind: string
          organization_id: string
          reconciliation_id: string
          reference: string | null
          removed_at: string | null
          removed_by: string | null
          updated_at: string
          version: number
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          item_date: string
          kind: string
          organization_id: string
          reconciliation_id: string
          reference?: string | null
          removed_at?: string | null
          removed_by?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          item_date?: string
          kind?: string
          organization_id?: string
          reconciliation_id?: string
          reference?: string | null
          removed_at?: string | null
          removed_by?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      complaint_handlers: {
        Row: {
          added_by: string | null
          created_at: string
          created_by: string | null
          id: string
          membership_id: string
          organization_id: string
          removed_at: string | null
          removed_by: string | null
          updated_at: string
          version: number
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id: string
          organization_id: string
          removed_at?: string | null
          removed_by?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          added_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id?: string
          organization_id?: string
          removed_at?: string | null
          removed_by?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      complaints: {
        Row: {
          ack_due_on: string | null
          ack_note: string | null
          acknowledged_by: string | null
          acknowledged_on: string | null
          assignee_membership_id: string
          category: Database["public"]["Enums"]["complaint_category"]
          channel: Database["public"]["Enums"]["compliance_channel"]
          complainant_name: string
          created_at: string
          created_by: string | null
          evidence_note: string | null
          id: string
          idempotency_key: string
          is_sample: boolean
          issue: string
          matter_id: string | null
          number: number
          organization_id: string
          person_id: string | null
          received_on: string
          reference: string
          resolution: string | null
          resolved_by: string | null
          resolved_on: string | null
          response_by: string | null
          response_due_on: string | null
          response_note: string | null
          response_sent_on: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string
          version: number
        }
        Insert: {
          ack_due_on?: string | null
          ack_note?: string | null
          acknowledged_by?: string | null
          acknowledged_on?: string | null
          assignee_membership_id: string
          category: Database["public"]["Enums"]["complaint_category"]
          channel: Database["public"]["Enums"]["compliance_channel"]
          complainant_name: string
          created_at?: string
          created_by?: string | null
          evidence_note?: string | null
          id?: string
          idempotency_key: string
          is_sample?: boolean
          issue: string
          matter_id?: string | null
          number: number
          organization_id: string
          person_id?: string | null
          received_on: string
          reference: string
          resolution?: string | null
          resolved_by?: string | null
          resolved_on?: string | null
          response_by?: string | null
          response_due_on?: string | null
          response_note?: string | null
          response_sent_on?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          ack_due_on?: string | null
          ack_note?: string | null
          acknowledged_by?: string | null
          acknowledged_on?: string | null
          assignee_membership_id?: string
          category?: Database["public"]["Enums"]["complaint_category"]
          channel?: Database["public"]["Enums"]["compliance_channel"]
          complainant_name?: string
          created_at?: string
          created_by?: string | null
          evidence_note?: string | null
          id?: string
          idempotency_key?: string
          is_sample?: boolean
          issue?: string
          matter_id?: string | null
          number?: number
          organization_id?: string
          person_id?: string | null
          received_on?: string
          reference?: string
          resolution?: string | null
          resolved_by?: string | null
          resolved_on?: string | null
          response_by?: string | null
          response_due_on?: string | null
          response_note?: string | null
          response_sent_on?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      compliance_settings: {
        Row: {
          complaint_ack_days: number | null
          complaint_escalation_text: string | null
          complaint_response_days: number | null
          created_at: string
          created_by: string | null
          organization_id: string
          privacy_response_days: number | null
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          complaint_ack_days?: number | null
          complaint_escalation_text?: string | null
          complaint_response_days?: number | null
          created_at?: string
          created_by?: string | null
          organization_id: string
          privacy_response_days?: number | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          complaint_ack_days?: number | null
          complaint_escalation_text?: string | null
          complaint_response_days?: number | null
          created_at?: string
          created_by?: string | null
          organization_id?: string
          privacy_response_days?: number | null
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      consent_impact_reviews: {
        Row: {
          consent_purpose: Database["public"]["Enums"]["consent_purpose"]
          consent_record_id: string
          created_at: string
          created_by: string | null
          done_at: string | null
          done_by: string | null
          done_note: string | null
          id: string
          impacts: Json
          matter_id: string | null
          organization_id: string
          person_id: string
          source: string
          status: string
          task_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          consent_purpose: Database["public"]["Enums"]["consent_purpose"]
          consent_record_id: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          done_note?: string | null
          id?: string
          impacts: Json
          matter_id?: string | null
          organization_id: string
          person_id: string
          source: string
          status?: string
          task_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          consent_purpose?: Database["public"]["Enums"]["consent_purpose"]
          consent_record_id?: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          done_note?: string | null
          id?: string
          impacts?: Json
          matter_id?: string | null
          organization_id?: string
          person_id?: string
          source?: string
          status?: string
          task_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      consent_records: {
        Row: {
          created_at: string
          granted: boolean
          id: string
          invitation_id: string | null
          matter_id: string | null
          organization_id: string
          person_id: string
          policy_document_id: string | null
          policy_version: string | null
          purpose: Database["public"]["Enums"]["consent_purpose"]
          scope: string | null
          statement_sha256: string
          statement_text: string
          withdrawn_at: string | null
        }
        Insert: {
          created_at?: string
          granted: boolean
          id?: string
          invitation_id?: string | null
          matter_id?: string | null
          organization_id: string
          person_id: string
          policy_document_id?: string | null
          policy_version?: string | null
          purpose: Database["public"]["Enums"]["consent_purpose"]
          scope?: string | null
          statement_sha256: string
          statement_text: string
          withdrawn_at?: string | null
        }
        Update: {
          withdrawn_at?: string | null
        }
        Relationships: []
      }
      consultation_summaries: {
        Row: {
          body: string
          booking_id: string
          created_at: string
          id: string
          is_sample: boolean
          organization_id: string
          shared_at: string | null
          shared_body: string | null
          shared_by: string | null
          status: string
          version: number
          written_at: string
          written_by: string
        }
        Insert: {
          body: string
          booking_id: string
          created_at?: string
          id?: string
          is_sample?: boolean
          organization_id: string
          shared_at?: string | null
          shared_body?: string | null
          shared_by?: string | null
          status?: string
          version?: number
          written_at?: string
          written_by: string
        }
        Update: {
          body?: string
          booking_id?: string
          created_at?: string
          id?: string
          is_sample?: boolean
          organization_id?: string
          shared_at?: string | null
          shared_body?: string | null
          shared_by?: string | null
          status?: string
          version?: number
          written_at?: string
          written_by?: string
        }
        Relationships: []
      }
      consultant_credentials: {
        Row: {
          checked_at: string | null
          college_id: string
          created_at: string
          created_by: string | null
          declared_at: string
          discipline_restricted: boolean
          discipline_restriction_detail: string | null
          discipline_revoked: boolean
          discipline_suspended: boolean
          entitlement_to_practise: boolean | null
          id: string
          licence_type: Database["public"]["Enums"]["licence_type"]
          membership_id: string
          next_review_at: string | null
          organization_id: string
          proof_locator: string | null
          register_status: Database["public"]["Enums"]["register_licence_status"] | null
          regulator: string
          reviewer_user_id: string | null
          scope_note: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["credential_status"]
          updated_at: string
          valid_until: string | null
          verification_method: string | null
          version: number
        }
        Insert: {
          checked_at?: string | null
          college_id: string
          created_at?: string
          created_by?: string | null
          declared_at?: string
          discipline_restricted?: boolean
          discipline_restriction_detail?: string | null
          discipline_revoked?: boolean
          discipline_suspended?: boolean
          entitlement_to_practise?: boolean | null
          id?: string
          licence_type: Database["public"]["Enums"]["licence_type"]
          membership_id: string
          next_review_at?: string | null
          organization_id: string
          proof_locator?: string | null
          register_status?: Database["public"]["Enums"]["register_licence_status"] | null
          regulator?: string
          reviewer_user_id?: string | null
          scope_note?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["credential_status"]
          updated_at?: string
          valid_until?: string | null
          verification_method?: string | null
          version?: number
        }
        Update: {
          checked_at?: string | null
          college_id?: string
          created_at?: string
          created_by?: string | null
          declared_at?: string
          discipline_restricted?: boolean
          discipline_restriction_detail?: string | null
          discipline_revoked?: boolean
          discipline_suspended?: boolean
          entitlement_to_practise?: boolean | null
          id?: string
          licence_type?: Database["public"]["Enums"]["licence_type"]
          membership_id?: string
          next_review_at?: string | null
          organization_id?: string
          proof_locator?: string | null
          register_status?: Database["public"]["Enums"]["register_licence_status"] | null
          regulator?: string
          reviewer_user_id?: string | null
          scope_note?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["credential_status"]
          updated_at?: string
          valid_until?: string | null
          verification_method?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "consultant_credentials_membership_id_organization_id_fkey"
            columns: ["membership_id", "organization_id"]
            isOneToOne: true
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "consultant_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      correspondence_work_links: {
        Row: {
          correspondence_id: string
          created_at: string
          created_by: string | null
          deadline_id: string | null
          id: string
          organization_id: string
          task_id: string | null
        }
        Insert: {
          correspondence_id: string
          created_at?: string
          created_by?: string | null
          deadline_id?: string | null
          id?: string
          organization_id: string
          task_id?: string | null
        }
        Update: {
          correspondence_id?: string
          created_at?: string
          created_by?: string | null
          deadline_id?: string | null
          id?: string
          organization_id?: string
          task_id?: string | null
        }
        Relationships: []
      }
      credential_change_reports: {
        Row: {
          created_at: string
          credential_id: string
          detail: string
          id: string
          organization_id: string
          reported_by: string
        }
        Insert: {
          created_at?: string
          credential_id: string
          detail: string
          id?: string
          organization_id: string
          reported_by: string
        }
        Update: {
          created_at?: string
          credential_id?: string
          detail?: string
          id?: string
          organization_id?: string
          reported_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_change_reports_credential_id_organization_id_fkey"
            columns: ["credential_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "consultant_credentials"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "credential_change_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credential_checks: {
        Row: {
          cicc_entry_id: string | null
          cicc_import_id: string | null
          created_at: string
          credential_id: string
          discipline_restricted: boolean | null
          discipline_restriction_detail: string | null
          discipline_revoked: boolean | null
          discipline_suspended: boolean | null
          entitlement_to_practise: boolean | null
          id: string
          method: string
          notes: string | null
          organization_id: string
          proof_locator: string | null
          register_status: Database["public"]["Enums"]["register_licence_status"] | null
          result: Database["public"]["Enums"]["licence_check_result"]
          retrieved_at: string
          reviewer_user_id: string
          source_host: string | null
          source_url: string | null
        }
        Insert: {
          cicc_entry_id?: string | null
          cicc_import_id?: string | null
          created_at?: string
          credential_id: string
          discipline_restricted?: boolean | null
          discipline_restriction_detail?: string | null
          discipline_revoked?: boolean | null
          discipline_suspended?: boolean | null
          entitlement_to_practise?: boolean | null
          id?: string
          method?: string
          notes?: string | null
          organization_id: string
          proof_locator?: string | null
          register_status?: Database["public"]["Enums"]["register_licence_status"] | null
          result: Database["public"]["Enums"]["licence_check_result"]
          retrieved_at: string
          reviewer_user_id: string
          source_host?: string | null
          source_url?: string | null
        }
        Update: {
          cicc_entry_id?: string | null
          cicc_import_id?: string | null
          created_at?: string
          credential_id?: string
          discipline_restricted?: boolean | null
          discipline_restriction_detail?: string | null
          discipline_revoked?: boolean | null
          discipline_suspended?: boolean | null
          entitlement_to_practise?: boolean | null
          id?: string
          method?: string
          notes?: string | null
          organization_id?: string
          proof_locator?: string | null
          register_status?: Database["public"]["Enums"]["register_licence_status"] | null
          result?: Database["public"]["Enums"]["licence_check_result"]
          retrieved_at?: string
          reviewer_user_id?: string
          source_host?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credential_checks_cicc_entry_id_fkey"
            columns: ["cicc_entry_id"]
            isOneToOne: false
            referencedRelation: "cicc_register_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_checks_cicc_import_id_fkey"
            columns: ["cicc_import_id"]
            isOneToOne: false
            referencedRelation: "cicc_register_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_checks_credential_id_organization_id_fkey"
            columns: ["credential_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "consultant_credentials"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "credential_checks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deadlines: {
        Row: {
          calculation_note: string | null
          created_at: string
          created_by: string | null
          due_at: string | null
          due_on: string | null
          escalated_at: string | null
          event_on: string | null
          evidence_locator: string | null
          id: string
          kind: Database["public"]["Enums"]["deadline_kind"]
          label: string
          matter_id: string
          organization_id: string
          receipt_on: string | null
          rule_version_id: string | null
          source_retrieved_on: string | null
          source_url: string | null
          task_id: string | null
          timezone: string
          updated_at: string
          verification: Database["public"]["Enums"]["deadline_verification"]
          verifying_membership_id: string | null
          version: number
        }
        Insert: {
          calculation_note?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          due_on?: string | null
          escalated_at?: string | null
          event_on?: string | null
          evidence_locator?: string | null
          id?: string
          kind: Database["public"]["Enums"]["deadline_kind"]
          label: string
          matter_id: string
          organization_id: string
          receipt_on?: string | null
          rule_version_id?: string | null
          source_retrieved_on?: string | null
          source_url?: string | null
          task_id?: string | null
          timezone: string
          updated_at?: string
          verification?: Database["public"]["Enums"]["deadline_verification"]
          verifying_membership_id?: string | null
          version?: number
        }
        Update: {
          calculation_note?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          due_on?: string | null
          escalated_at?: string | null
          event_on?: string | null
          evidence_locator?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["deadline_kind"]
          label?: string
          matter_id?: string
          organization_id?: string
          receipt_on?: string | null
          rule_version_id?: string | null
          source_retrieved_on?: string | null
          source_url?: string | null
          task_id?: string | null
          timezone?: string
          updated_at?: string
          verification?: Database["public"]["Enums"]["deadline_verification"]
          verifying_membership_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "deadlines_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "deadlines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deadlines_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deadlines_task_id_organization_id_fkey"
            columns: ["task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "deadlines_verifying_membership_id_organization_id_fkey"
            columns: ["verifying_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      decision_follow_ups: {
        Row: {
          created_at: string
          created_by: string | null
          decision_id: string
          document_version_id: string | null
          id: string
          kind: Database["public"]["Enums"]["decision_follow_up_kind"]
          organization_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          decision_id: string
          document_version_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["decision_follow_up_kind"]
          organization_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          decision_id?: string
          document_version_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["decision_follow_up_kind"]
          organization_id?: string
          task_id?: string
        }
        Relationships: []
      }
      decision_records: {
        Row: {
          authority_reasons: string | null
          confirmed_at: string | null
          confirmed_by_membership_id: string | null
          consultant_interpretation: string | null
          correspondence_id: string
          created_at: string
          created_by: string | null
          decided_on: string | null
          id: string
          matter_id: string
          milestone: Database["public"]["Enums"]["decision_milestone"] | null
          next_steps: string | null
          organization_id: string
          outcome: Database["public"]["Enums"]["matter_outcome"]
          shared_by_membership_id: string | null
          shared_with_client_at: string | null
          stage_evidence_id: string | null
          state: Database["public"]["Enums"]["decision_record_state"]
          updated_at: string
          version: number
        }
        Insert: {
          authority_reasons?: string | null
          confirmed_at?: string | null
          confirmed_by_membership_id?: string | null
          consultant_interpretation?: string | null
          correspondence_id: string
          created_at?: string
          created_by?: string | null
          decided_on?: string | null
          id?: string
          matter_id: string
          milestone?: Database["public"]["Enums"]["decision_milestone"] | null
          next_steps?: string | null
          organization_id: string
          outcome: Database["public"]["Enums"]["matter_outcome"]
          shared_by_membership_id?: string | null
          shared_with_client_at?: string | null
          stage_evidence_id?: string | null
          state?: Database["public"]["Enums"]["decision_record_state"]
          updated_at?: string
          version?: number
        }
        Update: {
          authority_reasons?: string | null
          confirmed_at?: string | null
          confirmed_by_membership_id?: string | null
          consultant_interpretation?: string | null
          correspondence_id?: string
          created_at?: string
          created_by?: string | null
          decided_on?: string | null
          id?: string
          matter_id?: string
          milestone?: Database["public"]["Enums"]["decision_milestone"] | null
          next_steps?: string | null
          organization_id?: string
          outcome?: Database["public"]["Enums"]["matter_outcome"]
          shared_by_membership_id?: string | null
          shared_with_client_at?: string | null
          stage_evidence_id?: string | null
          state?: Database["public"]["Enums"]["decision_record_state"]
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      decision_steps: {
        Row: {
          created_at: string
          created_by: string | null
          decision_id: string
          done_at: string
          done_by_membership_id: string
          id: string
          note: string | null
          organization_id: string
          step: Database["public"]["Enums"]["decision_step"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          decision_id: string
          done_at?: string
          done_by_membership_id: string
          id?: string
          note?: string | null
          organization_id: string
          step: Database["public"]["Enums"]["decision_step"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          decision_id?: string
          done_at?: string
          done_by_membership_id?: string
          id?: string
          note?: string | null
          organization_id?: string
          step?: Database["public"]["Enums"]["decision_step"]
        }
        Relationships: []
      }
      document_custody_events: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          created_by: string | null
          id: string
          location: string | null
          organization_id: string
          purpose: string
          received_on: string | null
          recipient: string | null
          return_on: string | null
          version_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          organization_id: string
          purpose: string
          received_on?: string | null
          recipient?: string | null
          return_on?: string | null
          version_id: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location?: string | null
          organization_id?: string
          purpose?: string
          received_on?: string | null
          recipient?: string | null
          return_on?: string | null
          version_id?: string
        }
        Relationships: []
      }
      document_matter_refs: {
        Row: {
          created_at: string
          created_by: string | null
          document_id: string
          id: string
          matter_id: string
          organization_id: string
          removal_reason: string | null
          removed_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_id: string
          id?: string
          matter_id: string
          organization_id: string
          removal_reason?: string | null
          removed_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_id?: string
          id?: string
          matter_id?: string
          organization_id?: string
          removal_reason?: string | null
          removed_at?: string | null
        }
        Relationships: []
      }
      document_requests: {
        Row: {
          acceptable_formats: string[]
          audience: Database["public"]["Enums"]["document_audience"]
          created_at: string
          created_by: string | null
          document_id: string | null
          due_on: string | null
          explanation: string
          expires_on: string | null
          id: string
          matter_id: string
          organization_id: string
          person_id: string
          purpose: string
          review_criteria: string | null
          rule_item_key: string | null
          rule_version_id: string | null
          sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          source: Database["public"]["Enums"]["document_request_source"]
          status: Database["public"]["Enums"]["document_request_status"]
          updated_at: string
          version: number
          waiver_reason: string | null
        }
        Insert: {
          acceptable_formats: string[]
          audience?: Database["public"]["Enums"]["document_audience"]
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          due_on?: string | null
          explanation: string
          expires_on?: string | null
          id?: string
          matter_id: string
          organization_id: string
          person_id: string
          purpose: string
          review_criteria?: string | null
          rule_item_key?: string | null
          rule_version_id?: string | null
          sensitivity?: Database["public"]["Enums"]["document_sensitivity"]
          source: Database["public"]["Enums"]["document_request_source"]
          status?: Database["public"]["Enums"]["document_request_status"]
          updated_at?: string
          version?: number
          waiver_reason?: string | null
        }
        Update: {
          acceptable_formats?: string[]
          audience?: Database["public"]["Enums"]["document_audience"]
          created_at?: string
          created_by?: string | null
          document_id?: string | null
          due_on?: string | null
          explanation?: string
          expires_on?: string | null
          id?: string
          matter_id?: string
          organization_id?: string
          person_id?: string
          purpose?: string
          review_criteria?: string | null
          rule_item_key?: string | null
          rule_version_id?: string | null
          sensitivity?: Database["public"]["Enums"]["document_sensitivity"]
          source?: Database["public"]["Enums"]["document_request_source"]
          status?: Database["public"]["Enums"]["document_request_status"]
          updated_at?: string
          version?: number
          waiver_reason?: string | null
        }
        Relationships: []
      }
      document_review_translations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          language: string
          machine_drafted: boolean
          model: string | null
          organization_id: string
          reason: string
          review_id: string
          version_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          language: string
          machine_drafted: boolean
          model?: string | null
          organization_id: string
          reason: string
          review_id: string
          version_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          language?: string
          machine_drafted?: boolean
          model?: string | null
          organization_id?: string
          reason?: string
          review_id?: string
          version_id?: string
        }
        Relationships: []
      }
      document_reviews: {
        Row: {
          annotations: string | null
          created_at: string
          created_by: string | null
          decision: Database["public"]["Enums"]["document_review_decision"]
          id: string
          organization_id: string
          reason: string
          version_id: string
        }
        Insert: {
          annotations?: string | null
          created_at?: string
          created_by?: string | null
          decision: Database["public"]["Enums"]["document_review_decision"]
          id?: string
          organization_id: string
          reason: string
          version_id: string
        }
        Update: {
          annotations?: string | null
          created_at?: string
          created_by?: string | null
          decision?: Database["public"]["Enums"]["document_review_decision"]
          id?: string
          organization_id?: string
          reason?: string
          version_id?: string
        }
        Relationships: []
      }
      document_versions: {
        Row: {
          byte_size: number | null
          checksum_sha256: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          declared_byte_size: number
          declared_media_type: string
          detected_media_type: string | null
          document_id: string
          expires_on: string | null
          id: string
          intent_expires_at: string
          language_tag: string | null
          organization_id: string
          original_filename: string
          parent_version_id: string | null
          quarantine_reason: string | null
          request_id: string | null
          review_state: Database["public"]["Enums"]["document_review_state"]
          scan_engine: string | null
          scan_result: string | null
          storage_bucket: string
          storage_key: string
          superseded_at: string | null
          transformation: Json | null
          translation_of_version_id: string | null
          updated_at: string
          upload_state: Database["public"]["Enums"]["document_upload_state"]
          version: number
          version_number: number
        }
        Insert: {
          byte_size?: number | null
          checksum_sha256?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          declared_byte_size: number
          declared_media_type: string
          detected_media_type?: string | null
          document_id: string
          expires_on?: string | null
          id?: string
          intent_expires_at: string
          language_tag?: string | null
          organization_id: string
          original_filename: string
          parent_version_id?: string | null
          quarantine_reason?: string | null
          request_id?: string | null
          review_state?: Database["public"]["Enums"]["document_review_state"]
          scan_engine?: string | null
          scan_result?: string | null
          storage_bucket?: string
          storage_key: string
          superseded_at?: string | null
          transformation?: Json | null
          translation_of_version_id?: string | null
          updated_at?: string
          upload_state?: Database["public"]["Enums"]["document_upload_state"]
          version?: number
          version_number: number
        }
        Update: {
          byte_size?: number | null
          checksum_sha256?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          declared_byte_size?: number
          declared_media_type?: string
          detected_media_type?: string | null
          document_id?: string
          expires_on?: string | null
          id?: string
          intent_expires_at?: string
          language_tag?: string | null
          organization_id?: string
          original_filename?: string
          parent_version_id?: string | null
          quarantine_reason?: string | null
          request_id?: string | null
          review_state?: Database["public"]["Enums"]["document_review_state"]
          scan_engine?: string | null
          scan_result?: string | null
          storage_bucket?: string
          storage_key?: string
          superseded_at?: string | null
          transformation?: Json | null
          translation_of_version_id?: string | null
          updated_at?: string
          upload_state?: Database["public"]["Enums"]["document_upload_state"]
          version?: number
          version_number?: number
        }
        Relationships: []
      }
      documents: {
        Row: {
          audience: Database["public"]["Enums"]["document_audience"]
          created_at: string
          created_by: string | null
          current_version_id: string | null
          id: string
          organization_id: string
          person_id: string
          purpose: string
          sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          translates_document_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          audience?: Database["public"]["Enums"]["document_audience"]
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          id?: string
          organization_id: string
          person_id: string
          purpose: string
          sensitivity?: Database["public"]["Enums"]["document_sensitivity"]
          translates_document_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          audience?: Database["public"]["Enums"]["document_audience"]
          created_at?: string
          created_by?: string | null
          current_version_id?: string | null
          id?: string
          organization_id?: string
          person_id?: string
          purpose?: string
          sensitivity?: Database["public"]["Enums"]["document_sensitivity"]
          translates_document_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      email_deliveries: {
        Row: {
          attempt_count: number
          context: Json
          created_at: string
          created_by: string | null
          critical: boolean
          follow_up_task_id: string | null
          id: string
          last_error: string | null
          matter_id: string | null
          organization_id: string
          outbox_event_id: string
          provider_message_id: string | null
          recipient_email: string
          status: Database["public"]["Enums"]["email_delivery_status"]
          template: Database["public"]["Enums"]["email_template"]
          updated_at: string
          version: number
        }
        Insert: {
          attempt_count?: number
          context?: Json
          created_at?: string
          created_by?: string | null
          critical?: boolean
          follow_up_task_id?: string | null
          id?: string
          last_error?: string | null
          matter_id?: string | null
          organization_id: string
          outbox_event_id: string
          provider_message_id?: string | null
          recipient_email: string
          status?: Database["public"]["Enums"]["email_delivery_status"]
          template: Database["public"]["Enums"]["email_template"]
          updated_at?: string
          version?: number
        }
        Update: {
          attempt_count?: number
          context?: Json
          created_at?: string
          created_by?: string | null
          critical?: boolean
          follow_up_task_id?: string | null
          id?: string
          last_error?: string | null
          matter_id?: string | null
          organization_id?: string
          outbox_event_id?: string
          provider_message_id?: string | null
          recipient_email?: string
          status?: Database["public"]["Enums"]["email_delivery_status"]
          template?: Database["public"]["Enums"]["email_template"]
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      email_inbound_windows: {
        Row: {
          created_at: string
          created_by: string | null
          hits: number
          hour_bucket: string
          organization_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          hits?: number
          hour_bucket: string
          organization_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          hits?: number
          hour_bucket?: string
          organization_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_inbound_windows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          reason: string
          recipient_email: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          reason: string
          recipient_email: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          reason?: string
          recipient_email?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      envelope_signers: {
        Row: {
          consent_accepted: boolean
          consent_text: string | null
          consent_version: string | null
          created_at: string
          created_by: string | null
          declined_at: string | null
          display_name: string
          envelope_id: string
          id: string
          ip: string | null
          membership_id: string | null
          organization_id: string
          person_id: string | null
          role: Database["public"]["Enums"]["agreement_signer_role"]
          signed_at: string | null
          signer_user_id: string | null
          signing_order: number
          status: Database["public"]["Enums"]["agreement_signer_status"]
          updated_at: string
          user_agent: string | null
          version: number
        }
        Insert: {
          consent_accepted?: boolean
          consent_text?: string | null
          consent_version?: string | null
          created_at?: string
          created_by?: string | null
          declined_at?: string | null
          display_name: string
          envelope_id: string
          id?: string
          ip?: string | null
          membership_id?: string | null
          organization_id: string
          person_id?: string | null
          role: Database["public"]["Enums"]["agreement_signer_role"]
          signed_at?: string | null
          signer_user_id?: string | null
          signing_order: number
          status?: Database["public"]["Enums"]["agreement_signer_status"]
          updated_at?: string
          user_agent?: string | null
          version?: number
        }
        Update: {
          consent_accepted?: boolean
          consent_text?: string | null
          consent_version?: string | null
          created_at?: string
          created_by?: string | null
          declined_at?: string | null
          display_name?: string
          envelope_id?: string
          id?: string
          ip?: string | null
          membership_id?: string | null
          organization_id?: string
          person_id?: string | null
          role?: Database["public"]["Enums"]["agreement_signer_role"]
          signed_at?: string | null
          signer_user_id?: string | null
          signing_order?: number
          status?: Database["public"]["Enums"]["agreement_signer_status"]
          updated_at?: string
          user_agent?: string | null
          version?: number
        }
        Relationships: []
      }
      external_busy_blocks: {
        Row: {
          ends_at: string
          external_ref: string | null
          id: string
          membership_id: string
          organization_id: string
          source: string
          starts_at: string
          synced_at: string
        }
        Insert: {
          ends_at: string
          external_ref?: string | null
          id?: string
          membership_id: string
          organization_id: string
          source: string
          starts_at: string
          synced_at?: string
        }
        Update: {
          ends_at?: string
          external_ref?: string | null
          id?: string
          membership_id?: string
          organization_id?: string
          source?: string
          starts_at?: string
          synced_at?: string
        }
        Relationships: []
      }
      firm_operating_accounts: {
        Row: {
          account_last4: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          institution: string
          is_active: boolean
          label: string
          organization_id: string
          updated_at: string
          version: number
        }
        Insert: {
          account_last4: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          institution: string
          is_active?: boolean
          label: string
          organization_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          account_last4?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          institution?: string
          is_active?: boolean
          label?: string
          organization_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      firm_payment_accounts: {
        Row: {
          account_id: string
          card_payments_status: string
          created_at: string
          created_by: string | null
          fees_collector: string | null
          id: string
          livemode: boolean
          losses_collector: string | null
          organization_id: string
          payouts_status: string
          provider: string
          requirements: Json
          requirements_due: number
          status_checked_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          account_id: string
          card_payments_status?: string
          created_at?: string
          created_by?: string | null
          fees_collector?: string | null
          id?: string
          livemode?: boolean
          losses_collector?: string | null
          organization_id: string
          payouts_status?: string
          provider?: string
          requirements?: Json
          requirements_due?: number
          status_checked_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          account_id?: string
          card_payments_status?: string
          created_at?: string
          created_by?: string | null
          fees_collector?: string | null
          id?: string
          livemode?: boolean
          losses_collector?: string | null
          organization_id?: string
          payouts_status?: string
          provider?: string
          requirements?: Json
          requirements_due?: number
          status_checked_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      firm_reminder_offsets: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          offset_days: number
          organization_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          offset_days: number
          organization_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          offset_days?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_reminder_offsets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      government_correspondence: {
        Row: {
          action_requested: string | null
          channel: Database["public"]["Enums"]["correspondence_channel"]
          corrects_id: string | null
          created_at: string
          created_by: string | null
          document_date: string | null
          evidence_locator: string | null
          evidence_version_id: string | null
          id: string
          issuer: string | null
          issuer_id: string | null
          kind: Database["public"]["Enums"]["correspondence_kind"]
          matter_id: string
          organization_id: string
          received_on: string
          reference_text: string | null
          shared_by_membership_id: string | null
          shared_with_client_at: string | null
          stated_deadline: string | null
          updated_at: string
          verified_at: string | null
          verified_by_membership_id: string | null
          version: number
        }
        Insert: {
          action_requested?: string | null
          channel: Database["public"]["Enums"]["correspondence_channel"]
          corrects_id?: string | null
          created_at?: string
          created_by?: string | null
          document_date?: string | null
          evidence_locator?: string | null
          evidence_version_id?: string | null
          id?: string
          issuer?: string | null
          issuer_id?: string | null
          kind: Database["public"]["Enums"]["correspondence_kind"]
          matter_id: string
          organization_id: string
          received_on: string
          reference_text?: string | null
          shared_by_membership_id?: string | null
          shared_with_client_at?: string | null
          stated_deadline?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by_membership_id?: string | null
          version?: number
        }
        Update: {
          action_requested?: string | null
          channel?: Database["public"]["Enums"]["correspondence_channel"]
          corrects_id?: string | null
          created_at?: string
          created_by?: string | null
          document_date?: string | null
          evidence_locator?: string | null
          evidence_version_id?: string | null
          id?: string
          issuer?: string | null
          issuer_id?: string | null
          kind?: Database["public"]["Enums"]["correspondence_kind"]
          matter_id?: string
          organization_id?: string
          received_on?: string
          reference_text?: string | null
          shared_by_membership_id?: string | null
          shared_with_client_at?: string | null
          stated_deadline?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by_membership_id?: string | null
          version?: number
        }
        Relationships: []
      }
      government_fee_references: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          fee_group: string | null
          id: string
          name: string
          organization_id: string
          position: number
          retrieved_at: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          section: string | null
          snapshot_sha256: string
          source_url: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          currency?: string
          fee_group?: string | null
          id?: string
          name: string
          organization_id: string
          position: number
          retrieved_at: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          section?: string | null
          snapshot_sha256: string
          source_url: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          fee_group?: string | null
          id?: string
          name?: string
          organization_id?: string
          position?: number
          retrieved_at?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          section?: string | null
          snapshot_sha256?: string
          source_url?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      government_issuers: {
        Row: {
          checked_on: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          name_on_page: boolean | null
          organization_id: string
          page_attested_at: string | null
          page_attested_by_membership_id: string | null
          page_attested_on: string | null
          page_modified_on: string | null
          retrieved_at: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          snapshot_sha256: string | null
          source_url: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          checked_on: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          name_on_page?: boolean | null
          organization_id: string
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          page_modified_on?: string | null
          retrieved_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          snapshot_sha256?: string | null
          source_url: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          checked_on?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          name_on_page?: boolean | null
          organization_id?: string
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          page_modified_on?: string | null
          retrieved_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          snapshot_sha256?: string | null
          source_url?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      government_processing_estimates: {
        Row: {
          application_type: string
          checked_on: string
          created_at: string
          created_by: string | null
          entered_by_membership_id: string
          estimate_text: string
          id: string
          matter_id: string
          organization_id: string
          page_attested_at: string | null
          page_attested_by_membership_id: string | null
          page_attested_on: string | null
          page_retrieved_at: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by_membership_id: string | null
          snapshot_sha256: string | null
          source_url: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          application_type: string
          checked_on: string
          created_at?: string
          created_by?: string | null
          entered_by_membership_id: string
          estimate_text: string
          id?: string
          matter_id: string
          organization_id: string
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          page_retrieved_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          snapshot_sha256?: string | null
          source_url: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          application_type?: string
          checked_on?: string
          created_at?: string
          created_by?: string | null
          entered_by_membership_id?: string
          estimate_text?: string
          id?: string
          matter_id?: string
          organization_id?: string
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          page_retrieved_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          snapshot_sha256?: string | null
          source_url?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      // DEC-02 renewal follow-up (20261025210000_dec_renewal.sql)
      decision_renewals: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by_membership_id: string | null
          client_person_id: string | null
          consent_record_id: string | null
          created_at: string
          created_by: string | null
          decision_id: string
          document_label: string
          document_version_id: string | null
          expires_on: string
          fee_group: string | null
          fee_name: string | null
          fee_reference_id: string | null
          fee_section: string | null
          id: string
          lead_id: string | null
          matter_id: string
          organization_id: string
          owner_membership_id: string
          recorded_by_membership_id: string
          remind_on: string
          reminder_set_at: string | null
          reminder_set_by_membership_id: string | null
          service_scope: string | null
          task_id: string
          timing_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_membership_id?: string | null
          client_person_id?: string | null
          consent_record_id?: string | null
          created_at?: string
          created_by?: string | null
          decision_id: string
          document_label: string
          document_version_id?: string | null
          expires_on: string
          fee_group?: string | null
          fee_name?: string | null
          fee_reference_id?: string | null
          fee_section?: string | null
          id?: string
          lead_id?: string | null
          matter_id: string
          organization_id: string
          owner_membership_id: string
          recorded_by_membership_id: string
          remind_on: string
          reminder_set_at?: string | null
          reminder_set_by_membership_id?: string | null
          service_scope?: string | null
          task_id: string
          timing_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_membership_id?: string | null
          client_person_id?: string | null
          consent_record_id?: string | null
          created_at?: string
          created_by?: string | null
          decision_id?: string
          document_label?: string
          document_version_id?: string | null
          expires_on?: string
          fee_group?: string | null
          fee_name?: string | null
          fee_reference_id?: string | null
          fee_section?: string | null
          id?: string
          lead_id?: string | null
          matter_id?: string
          organization_id?: string
          owner_membership_id?: string
          recorded_by_membership_id?: string
          remind_on?: string
          reminder_set_at?: string | null
          reminder_set_by_membership_id?: string | null
          service_scope?: string | null
          task_id?: string
          timing_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      renewal_timings: {
        Row: {
          applies_to: string
          checked_on: string
          created_at: string
          created_by: string | null
          current_to: string | null
          form_modified_on: string | null
          form_number: string | null
          id: string
          lead_days: number | null
          organization_id: string
          page_attested_at: string | null
          page_attested_by_membership_id: string | null
          page_attested_on: string | null
          program_key: string | null
          retired_at: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by_membership_id: string | null
          snapshot_id: string | null
          snapshot_sha256: string | null
          source_id: string
          source_section: string | null
          source_url: string
          status: string
          timing_text: string
          updated_at: string
          version: number
        }
        Insert: {
          applies_to: string
          checked_on: string
          created_at?: string
          created_by?: string | null
          current_to?: string | null
          form_modified_on?: string | null
          form_number?: string | null
          id?: string
          lead_days?: number | null
          organization_id: string
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          program_key?: string | null
          retired_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          snapshot_id?: string | null
          snapshot_sha256?: string | null
          source_id: string
          source_section?: string | null
          source_url: string
          status?: string
          timing_text: string
          updated_at?: string
          version?: number
        }
        Update: {
          applies_to?: string
          checked_on?: string
          created_at?: string
          created_by?: string | null
          current_to?: string | null
          form_modified_on?: string | null
          form_number?: string | null
          id?: string
          lead_days?: number | null
          organization_id?: string
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          program_key?: string | null
          retired_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          snapshot_id?: string | null
          snapshot_sha256?: string | null
          source_id?: string
          source_section?: string | null
          source_url?: string
          status?: string
          timing_text?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      government_status_checks: {
        Row: {
          checked_at: string
          checked_by_membership_id: string
          correspondence_id: string | null
          created_at: string
          created_by: string | null
          id: string
          matter_id: string
          note: string
          organization_id: string
        }
        Insert: {
          checked_at?: string
          checked_by_membership_id: string
          correspondence_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id: string
          note: string
          organization_id: string
        }
        Update: {
          checked_at?: string
          checked_by_membership_id?: string
          correspondence_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id?: string
          note?: string
          organization_id?: string
        }
        Relationships: []
      }
      household_members: {
        Row: {
          created_at: string
          created_by: string | null
          household_id: string
          id: string
          organization_id: string
          person_id: string
          relationship_label: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          household_id: string
          id?: string
          organization_id: string
          person_id: string
          relationship_label?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          household_id?: string
          id?: string
          organization_id?: string
          person_id?: string
          relationship_label?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_organization_id_fkey"
            columns: ["household_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "household_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "household_members_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "households_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_attachment_files: {
        Row: {
          byte_size: number
          created_at: string
          created_by: string | null
          filename: string
          id: string
          inbound_email_id: string
          inbox_item_id: string | null
          ordinal: number
          organization_id: string
          storage_key: string | null
          updated_at: string
          version: number
          version_id: string | null
        }
        Insert: {
          byte_size: number
          created_at?: string
          created_by?: string | null
          filename: string
          id?: string
          inbound_email_id: string
          inbox_item_id?: string | null
          ordinal: number
          organization_id: string
          storage_key?: string | null
          updated_at?: string
          version?: number
          version_id?: string | null
        }
        Update: {
          byte_size?: number
          created_at?: string
          created_by?: string | null
          filename?: string
          id?: string
          inbound_email_id?: string
          inbox_item_id?: string | null
          ordinal?: number
          organization_id?: string
          storage_key?: string | null
          updated_at?: string
          version?: number
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_attachment_files_inbound_email_id_organization_id_fkey"
            columns: ["inbound_email_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inbound_emails"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inbound_attachment_files_inbox_item_id_organization_id_fkey"
            columns: ["inbox_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inbound_inbox_items"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inbound_attachment_files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_attachment_files_version_id_organization_id_fkey"
            columns: ["version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      inbound_emails: {
        Row: {
          attachments_done: boolean
          body_location: string
          created_at: string
          created_by: string | null
          from_email: string
          html_body: string | null
          id: string
          matter_id: string | null
          message_id: string
          organization_id: string
          person_id: string | null
          sender_verified: boolean
          subject: string | null
          text_body: string | null
          to_email: string
          triage_note: string | null
          triage_state: string
          triaged_at: string | null
          triaged_by: string | null
          updated_at: string
          version: number
        }
        Insert: {
          attachments_done?: boolean
          body_location: string
          created_at?: string
          created_by?: string | null
          from_email: string
          html_body?: string | null
          id?: string
          matter_id?: string | null
          message_id: string
          organization_id: string
          person_id?: string | null
          sender_verified?: boolean
          subject?: string | null
          text_body?: string | null
          to_email: string
          triage_note?: string | null
          triage_state?: string
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          attachments_done?: boolean
          body_location?: string
          created_at?: string
          created_by?: string | null
          from_email?: string
          html_body?: string | null
          id?: string
          matter_id?: string | null
          message_id?: string
          organization_id?: string
          person_id?: string | null
          sender_verified?: boolean
          subject?: string | null
          text_body?: string | null
          to_email?: string
          triage_note?: string | null
          triage_state?: string
          triaged_at?: string | null
          triaged_by?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      inbound_inbox_items: {
        Row: {
          assigned_version_id: string | null
          byte_size: number | null
          created_at: string
          created_by: string | null
          file_audience: Database["public"]["Enums"]["document_audience"] | null
          filename: string
          id: string
          inbound_email_id: string
          matter_id: string | null
          media_type: string | null
          organization_id: string
          scan_result: string | null
          sha256: string | null
          skipped_at: string | null
          skipped_by: string | null
          storage_key: string
          updated_at: string
          upload_state: string
          version: number
        }
        Insert: {
          assigned_version_id?: string | null
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          file_audience?: Database["public"]["Enums"]["document_audience"] | null
          filename: string
          id?: string
          inbound_email_id: string
          matter_id?: string | null
          media_type?: string | null
          organization_id: string
          scan_result?: string | null
          sha256?: string | null
          skipped_at?: string | null
          skipped_by?: string | null
          storage_key: string
          updated_at?: string
          upload_state?: string
          version?: number
        }
        Update: {
          assigned_version_id?: string | null
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          file_audience?: Database["public"]["Enums"]["document_audience"] | null
          filename?: string
          id?: string
          inbound_email_id?: string
          matter_id?: string | null
          media_type?: string | null
          organization_id?: string
          scan_result?: string | null
          sha256?: string | null
          skipped_at?: string | null
          skipped_by?: string | null
          storage_key?: string
          updated_at?: string
          upload_state?: string
          version?: number
        }
        Relationships: []
      }
      instalment_plan_items: {
        Row: {
          amount_cents: number
          created_at: string
          due_on: string
          id: string
          label: string
          organization_id: string
          paid_as: string
          plan_id: string
          position: number
          quote_instalment_id: string
          task_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          due_on: string
          id?: string
          label: string
          organization_id: string
          paid_as: string
          plan_id: string
          position: number
          quote_instalment_id: string
          task_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          due_on?: string
          id?: string
          label?: string
          organization_id?: string
          paid_as?: string
          plan_id?: string
          position?: number
          quote_instalment_id?: string
          task_id?: string | null
        }
        Relationships: []
      }
      instalment_plans: {
        Row: {
          agreement_id: string
          agreement_version_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          id: string
          is_sample: boolean
          matter_id: string
          organization_id: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          agreement_id: string
          agreement_version_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_sample?: boolean
          matter_id: string
          organization_id: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          agreement_id?: string
          agreement_version_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_sample?: boolean
          matter_id?: string
          organization_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      intake_answer_reviews: {
        Row: {
          answer_id: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          response_id: string
          reviewer_membership_id: string
        }
        Insert: {
          answer_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          response_id: string
          reviewer_membership_id: string
        }
        Update: {
          answer_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          response_id?: string
          reviewer_membership_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_answer_reviews_answer_id_organization_id_fkey"
            columns: ["answer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "intake_answer_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_answer_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_answer_reviews_response_id_organization_id_fkey"
            columns: ["response_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "intake_responses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_answer_reviews_reviewer_membership_id_organization_id_fkey"
            columns: ["reviewer_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      intake_answer_versions: {
        Row: {
          approximate_note: string | null
          calendar_date: string | null
          created_at: string
          created_by: string | null
          date_kind: Database["public"]["Enums"]["answer_date_kind"] | null
          field_key: string
          id: string
          month_value: number | null
          normalized_value: Json
          organization_id: string
          presence: Database["public"]["Enums"]["answer_presence"]
          raw_value: Json
          response_id: string
          section_key: Database["public"]["Enums"]["person_section_key"] | null
          year_value: number | null
        }
        Insert: {
          approximate_note?: string | null
          calendar_date?: string | null
          created_at?: string
          created_by?: string | null
          date_kind?: Database["public"]["Enums"]["answer_date_kind"] | null
          field_key: string
          id?: string
          month_value?: number | null
          normalized_value: Json
          organization_id: string
          presence: Database["public"]["Enums"]["answer_presence"]
          raw_value: Json
          response_id: string
          section_key?: Database["public"]["Enums"]["person_section_key"] | null
          year_value?: number | null
        }
        Update: {
          approximate_note?: string | null
          calendar_date?: string | null
          created_at?: string
          created_by?: string | null
          date_kind?: Database["public"]["Enums"]["answer_date_kind"] | null
          field_key?: string
          id?: string
          month_value?: number | null
          normalized_value?: Json
          organization_id?: string
          presence?: Database["public"]["Enums"]["answer_presence"]
          raw_value?: Json
          response_id?: string
          section_key?: Database["public"]["Enums"]["person_section_key"] | null
          year_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_answer_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_answer_versions_response_id_organization_id_fkey"
            columns: ["response_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "intake_responses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      intake_fact_reuses: {
        Row: {
          answer_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          field_key: string
          id: string
          organization_id: string
          origin_answer_id: string
          origin_matter_id: string
          origin_response_id: string
          response_id: string
          status: Database["public"]["Enums"]["intake_fact_reuse_status"]
        }
        Insert: {
          answer_id: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          field_key: string
          id?: string
          organization_id: string
          origin_answer_id: string
          origin_matter_id: string
          origin_response_id: string
          response_id: string
          status?: Database["public"]["Enums"]["intake_fact_reuse_status"]
        }
        Update: {
          answer_id?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          field_key?: string
          id?: string
          organization_id?: string
          origin_answer_id?: string
          origin_matter_id?: string
          origin_response_id?: string
          response_id?: string
          status?: Database["public"]["Enums"]["intake_fact_reuse_status"]
        }
        Relationships: []
      }
      intake_corrections: {
        Row: {
          answer_id: string | null
          correction_number: number
          created_at: string
          created_by: string | null
          description: string | null
          field_key: string | null
          id: string
          organization_id: string
          previous_answer_id: string | null
          proof_document_id: string | null
          reason: string | null
          response_id: string
        }
        Insert: {
          answer_id?: string | null
          correction_number: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          field_key?: string | null
          id?: string
          organization_id: string
          previous_answer_id?: string | null
          proof_document_id?: string | null
          reason?: string | null
          response_id: string
        }
        Update: {
          answer_id?: string | null
          correction_number?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          field_key?: string | null
          id?: string
          organization_id?: string
          previous_answer_id?: string | null
          proof_document_id?: string | null
          reason?: string | null
          response_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_corrections_answer_id_organization_id_fkey"
            columns: ["answer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "intake_answer_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_corrections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_corrections_previous_answer_id_organization_id_fkey"
            columns: ["previous_answer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "intake_answer_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_corrections_proof_document_id_organization_id_fkey"
            columns: ["proof_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_corrections_response_id_organization_id_fkey"
            columns: ["response_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "intake_responses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      intake_requests: {
        Row: {
          created_at: string
          created_by: string | null
          due_on: string | null
          id: string
          is_sample: boolean
          matter_id: string
          message: string | null
          organization_id: string
          person_id: string
          response_id: string
          sent_by_membership_id: string
          task_id: string | null
          template_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          id?: string
          is_sample?: boolean
          matter_id: string
          message?: string | null
          organization_id: string
          person_id: string
          response_id: string
          sent_by_membership_id: string
          task_id?: string | null
          template_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          id?: string
          is_sample?: boolean
          matter_id?: string
          message?: string | null
          organization_id?: string
          person_id?: string
          response_id?: string
          sent_by_membership_id?: string
          task_id?: string | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_requests_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_requests_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_requests_response_id_organization_id_fkey"
            columns: ["response_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "intake_responses"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_requests_sent_by_membership_id_organization_id_fkey"
            columns: ["sent_by_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_requests_task_id_organization_id_fkey"
            columns: ["task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_requests_template_id_organization_id_fkey"
            columns: ["template_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "intake_templates"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      intake_responses: {
        Row: {
          created_at: string
          created_by: string | null
          frozen_at: string | null
          id: string
          matter_id: string
          organization_id: string
          person_id: string
          status: Database["public"]["Enums"]["intake_response_status"]
          submitted_at: string | null
          template_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          frozen_at?: string | null
          id?: string
          matter_id: string
          organization_id: string
          person_id: string
          status?: Database["public"]["Enums"]["intake_response_status"]
          submitted_at?: string | null
          template_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          frozen_at?: string | null
          id?: string
          matter_id?: string
          organization_id?: string
          person_id?: string
          status?: Database["public"]["Enums"]["intake_response_status"]
          submitted_at?: string | null
          template_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "intake_responses_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_responses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_responses_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_responses_template_id_organization_id_fkey"
            columns: ["template_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "intake_templates"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      intake_snapshot_answers: {
        Row: {
          calendar_date: string | null
          created_at: string
          date_kind: Database["public"]["Enums"]["answer_date_kind"] | null
          field_key: string
          id: string
          month_value: number | null
          normalized_value: Json
          organization_id: string
          presence: Database["public"]["Enums"]["answer_presence"]
          section_key: Database["public"]["Enums"]["person_section_key"] | null
          snapshot_id: string
          source_answer_id: string
          year_value: number | null
        }
        Insert: {
          calendar_date?: string | null
          created_at?: string
          date_kind?: Database["public"]["Enums"]["answer_date_kind"] | null
          field_key: string
          id?: string
          month_value?: number | null
          normalized_value: Json
          organization_id: string
          presence: Database["public"]["Enums"]["answer_presence"]
          section_key?: Database["public"]["Enums"]["person_section_key"] | null
          snapshot_id: string
          source_answer_id: string
          year_value?: number | null
        }
        Update: {
          calendar_date?: string | null
          created_at?: string
          date_kind?: Database["public"]["Enums"]["answer_date_kind"] | null
          field_key?: string
          id?: string
          month_value?: number | null
          normalized_value?: Json
          organization_id?: string
          presence?: Database["public"]["Enums"]["answer_presence"]
          section_key?: Database["public"]["Enums"]["person_section_key"] | null
          snapshot_id?: string
          source_answer_id?: string
          year_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_snapshot_answers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_snapshot_answers_snapshot_id_organization_id_fkey"
            columns: ["snapshot_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "intake_snapshots"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_snapshot_answers_source_answer_id_organization_id_fkey"
            columns: ["source_answer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "intake_answer_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      intake_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          response_id: string
          snapshot_number: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          response_id: string
          snapshot_number: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          response_id?: string
          snapshot_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "intake_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_snapshots_response_id_organization_id_fkey"
            columns: ["response_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "intake_responses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      intake_templates: {
        Row: {
          created_at: string
          created_by: string | null
          effective_on: string | null
          id: string
          locale: string
          organization_id: string
          published_at: string | null
          reviewer_membership_id: string | null
          rule_pack_version_id: string | null
          schema: Json
          stable_key: string
          status: Database["public"]["Enums"]["intake_template_status"]
          title: string
          updated_at: string
          version: number
          version_number: number
          workflow_category: Database["public"]["Enums"]["intake_workflow_category"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_on?: string | null
          id?: string
          locale: string
          organization_id: string
          published_at?: string | null
          reviewer_membership_id?: string | null
          rule_pack_version_id?: string | null
          schema: Json
          stable_key: string
          status?: Database["public"]["Enums"]["intake_template_status"]
          title: string
          updated_at?: string
          version?: number
          version_number: number
          workflow_category?: Database["public"]["Enums"]["intake_workflow_category"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_on?: string | null
          id?: string
          locale?: string
          organization_id?: string
          published_at?: string | null
          reviewer_membership_id?: string | null
          rule_pack_version_id?: string | null
          schema?: Json
          stable_key?: string
          status?: Database["public"]["Enums"]["intake_template_status"]
          title?: string
          updated_at?: string
          version?: number
          version_number?: number
          workflow_category?: Database["public"]["Enums"]["intake_workflow_category"]
        }
        Relationships: [
          {
            foreignKeyName: "intake_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_templates_reviewer_membership_id_organization_id_fkey"
            columns: ["reviewer_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "intake_templates_rule_pack_version_id_fkey"
            columns: ["rule_pack_version_id"]
            isOneToOne: false
            referencedRelation: "rule_pack_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          membership_id: string | null
          organization_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["org_role"]
          token_hash: string
          updated_at: string
          version: number
        }
        Insert: {
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string | null
          email: string
          expires_at: string
          id?: string
          membership_id?: string | null
          organization_id: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["org_role"]
          token_hash: string
          updated_at?: string
          version?: number
        }
        Update: {
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          membership_id?: string | null
          organization_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"]
          token_hash?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "invitations_membership_id_organization_id_fkey"
            columns: ["membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_credit_notes: {
        Row: {
          amount_cents: number
          applied_cents: number | null
          client_name: string | null
          consultant_licence: string | null
          consultant_name: string | null
          created_at: string
          created_by: string | null
          credit_balance_cents: number | null
          currency: string
          decline_reason: string | null
          declined_at: string | null
          declined_by: string | null
          firm_display_name: string | null
          firm_legal_name: string | null
          firm_timezone: string | null
          id: string
          idempotency_key: string
          invoice_amount_cents: number | null
          invoice_description: string | null
          invoice_id: string
          invoice_issued_on: string | null
          invoice_number: string | null
          is_sample: boolean
          issued_at: string | null
          issued_by: string | null
          matter_id: string
          matter_label: string | null
          number: string
          organization_id: string
          owner_self_approved: boolean
          reason: string
          requested_by: string
          status: Database["public"]["Enums"]["credit_note_status"]
          updated_at: string
          version: number
        }
        Insert: {
          amount_cents?: number
          applied_cents?: number | null
          client_name?: string | null
          consultant_licence?: string | null
          consultant_name?: string | null
          created_at?: string
          created_by?: string | null
          credit_balance_cents?: number | null
          currency?: string
          decline_reason?: string | null
          declined_at?: string | null
          declined_by?: string | null
          firm_display_name?: string | null
          firm_legal_name?: string | null
          firm_timezone?: string | null
          id?: string
          idempotency_key?: string
          invoice_amount_cents?: number | null
          invoice_description?: string | null
          invoice_id?: string
          invoice_issued_on?: string | null
          invoice_number?: string | null
          is_sample?: boolean
          issued_at?: string | null
          issued_by?: string | null
          matter_id?: string
          matter_label?: string | null
          number?: string
          organization_id?: string
          owner_self_approved?: boolean
          reason?: string
          requested_by?: string
          status?: Database["public"]["Enums"]["credit_note_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          amount_cents?: number
          applied_cents?: number | null
          client_name?: string | null
          consultant_licence?: string | null
          consultant_name?: string | null
          created_at?: string
          created_by?: string | null
          credit_balance_cents?: number | null
          currency?: string
          decline_reason?: string | null
          declined_at?: string | null
          declined_by?: string | null
          firm_display_name?: string | null
          firm_legal_name?: string | null
          firm_timezone?: string | null
          id?: string
          idempotency_key?: string
          invoice_amount_cents?: number | null
          invoice_description?: string | null
          invoice_id?: string
          invoice_issued_on?: string | null
          invoice_number?: string | null
          is_sample?: boolean
          issued_at?: string | null
          issued_by?: string | null
          matter_id?: string
          matter_label?: string | null
          number?: string
          organization_id?: string
          owner_self_approved?: boolean
          reason?: string
          requested_by?: string
          status?: Database["public"]["Enums"]["credit_note_status"]
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      invoice_dispute_evidence: {
        Row: {
          content_type: string
          created_at: string
          created_by: string | null
          dispute_id: string
          explanation: string | null
          file_name: string
          id: string
          livemode: boolean
          organization_id: string
          size_bytes: number
          stripe_file_id: string
          submitted: boolean
        }
        Insert: {
          content_type: string
          created_at?: string
          created_by?: string | null
          dispute_id: string
          explanation?: string | null
          file_name: string
          id?: string
          livemode?: boolean
          organization_id: string
          size_bytes: number
          stripe_file_id: string
          submitted?: boolean
        }
        Update: {
          content_type?: string
          created_at?: string
          created_by?: string | null
          dispute_id?: string
          explanation?: string | null
          file_name?: string
          id?: string
          livemode?: boolean
          organization_id?: string
          size_bytes?: number
          stripe_file_id?: string
          submitted?: boolean
        }
        Relationships: []
      }
      invoice_disputes: {
        Row: {
          amount_cents: number
          charge_id: string | null
          closed_at: string | null
          connected_account_id: string
          created_at: string
          created_by: string | null
          currency: string
          dispute_id: string
          evidence_due_by: string | null
          evidence_submitted_at: string | null
          evidence_submitted_by: string | null
          id: string
          invoice_id: string
          last_event_created: number | null
          last_event_id: string | null
          livemode: boolean
          number: string
          organization_id: string
          payment_id: string
          provider: string
          reason: string | null
          status: Database["public"]["Enums"]["invoice_dispute_status"]
          task_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          amount_cents: number
          charge_id?: string | null
          closed_at?: string | null
          connected_account_id: string
          created_at?: string
          created_by?: string | null
          currency: string
          dispute_id: string
          evidence_due_by?: string | null
          evidence_submitted_at?: string | null
          evidence_submitted_by?: string | null
          id?: string
          invoice_id: string
          last_event_created?: number | null
          last_event_id?: string | null
          livemode?: boolean
          number: string
          organization_id: string
          payment_id: string
          provider?: string
          reason?: string | null
          status: Database["public"]["Enums"]["invoice_dispute_status"]
          task_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          amount_cents?: number
          charge_id?: string | null
          closed_at?: string | null
          connected_account_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          dispute_id?: string
          evidence_due_by?: string | null
          evidence_submitted_at?: string | null
          evidence_submitted_by?: string | null
          id?: string
          invoice_id?: string
          last_event_created?: number | null
          last_event_id?: string | null
          livemode?: boolean
          number?: string
          organization_id?: string
          payment_id?: string
          provider?: string
          reason?: string | null
          status?: Database["public"]["Enums"]["invoice_dispute_status"]
          task_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      invoice_manual_payments: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          evidence_note: string | null
          evidence_version_id: string | null
          external_reference: string
          id: string
          idempotency_key: string
          invoice_id: string
          is_sample: boolean
          matter_id: string
          method: Database["public"]["Enums"]["client_fund_method"]
          number: string
          operating_account_id: string
          organization_id: string
          received_on: string
          recorded_by: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          reopened_cents: number
          reversal_reason: string | null
          reversal_task_id: string | null
          reversed_at: string | null
          reversed_by: string | null
          reviewer_user_id: string
          self_verified: boolean
          status: Database["public"]["Enums"]["manual_payment_status"]
          updated_at: string
          verified_at: string | null
          verified_by: string | null
          version: number
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          currency: string
          evidence_note?: string | null
          evidence_version_id?: string | null
          external_reference: string
          id?: string
          idempotency_key: string
          invoice_id: string
          is_sample?: boolean
          matter_id: string
          method: Database["public"]["Enums"]["client_fund_method"]
          number: string
          operating_account_id: string
          organization_id: string
          received_on: string
          recorded_by: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reopened_cents?: number
          reversal_reason?: string | null
          reversal_task_id?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reviewer_user_id: string
          self_verified?: boolean
          status?: Database["public"]["Enums"]["manual_payment_status"]
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          version?: number
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          evidence_note?: string | null
          evidence_version_id?: string | null
          external_reference?: string
          id?: string
          idempotency_key?: string
          invoice_id?: string
          is_sample?: boolean
          matter_id?: string
          method?: Database["public"]["Enums"]["client_fund_method"]
          number?: string
          operating_account_id?: string
          organization_id?: string
          received_on?: string
          recorded_by?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reopened_cents?: number
          reversal_reason?: string | null
          reversal_task_id?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          reviewer_user_id?: string
          self_verified?: boolean
          status?: Database["public"]["Enums"]["manual_payment_status"]
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
          version?: number
        }
        Relationships: []
      }
      invoice_lines: {
        Row: {
          amount_cents: number
          category: string
          created_at: string
          created_by: string | null
          description: string
          fee_reference_id: string | null
          id: string
          instalment_item_id: string | null
          invoice_id: string
          is_sample: boolean
          minutes: number | null
          organization_id: string
          position: number
          quote_line_id: string | null
          rate_cents: number | null
          source_checked_on: string | null
          source_retrieved_at: string | null
          source_sha256: string | null
          source_url: string | null
          tax_cents: number
          tax_name: string | null
          tax_rate_id: string | null
          tax_rate_percent: number | null
          time_entry_id: string | null
        }
        Insert: {
          amount_cents: number
          category: string
          created_at?: string
          created_by?: string | null
          description: string
          fee_reference_id?: string | null
          id?: string
          instalment_item_id?: string | null
          invoice_id: string
          is_sample?: boolean
          minutes?: number | null
          organization_id: string
          position: number
          quote_line_id?: string | null
          rate_cents?: number | null
          source_checked_on?: string | null
          source_retrieved_at?: string | null
          source_sha256?: string | null
          source_url?: string | null
          tax_cents?: number
          tax_name?: string | null
          tax_rate_id?: string | null
          tax_rate_percent?: number | null
          time_entry_id?: string | null
        }
        Update: {
          amount_cents?: number
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string
          fee_reference_id?: string | null
          id?: string
          instalment_item_id?: string | null
          invoice_id?: string
          is_sample?: boolean
          minutes?: number | null
          organization_id?: string
          position?: number
          quote_line_id?: string | null
          rate_cents?: number | null
          source_checked_on?: string | null
          source_retrieved_at?: string | null
          source_sha256?: string | null
          source_url?: string | null
          tax_cents?: number
          tax_name?: string | null
          tax_rate_id?: string | null
          tax_rate_percent?: number | null
          time_entry_id?: string | null
        }
        Relationships: []
      }
      invoice_payment_events: {
        Row: {
          amount_cents: number | null
          connected_account_id: string
          created_at: string
          currency: string | null
          detail: string | null
          event_id: string
          event_type: string
          id: string
          invoice_id: string
          invoice_status: Database["public"]["Enums"]["invoice_status"]
          organization_id: string
          outcome: string
          payment_id: string
          payment_status: Database["public"]["Enums"]["invoice_payment_status"]
          provider: string
          webhook_inbox_id: string
        }
        Insert: {
          amount_cents?: number | null
          connected_account_id: string
          created_at?: string
          currency?: string | null
          detail?: string | null
          event_id: string
          event_type: string
          id?: string
          invoice_id: string
          invoice_status: Database["public"]["Enums"]["invoice_status"]
          organization_id: string
          outcome: string
          payment_id: string
          payment_status: Database["public"]["Enums"]["invoice_payment_status"]
          provider?: string
          webhook_inbox_id: string
        }
        Update: {
          amount_cents?: number | null
          connected_account_id?: string
          created_at?: string
          currency?: string | null
          detail?: string | null
          event_id?: string
          event_type?: string
          id?: string
          invoice_id?: string
          invoice_status?: Database["public"]["Enums"]["invoice_status"]
          organization_id?: string
          outcome?: string
          payment_id?: string
          payment_status?: Database["public"]["Enums"]["invoice_payment_status"]
          provider?: string
          webhook_inbox_id?: string
        }
        Relationships: []
      }
      invoice_payment_receipts: {
        Row: {
          account_institution: string | null
          account_label: string | null
          account_last4: string | null
          amount_cents: number
          card_brand: string | null
          card_last4: string | null
          client_name: string
          consultant_licence: string | null
          consultant_name: string | null
          created_at: string
          created_by: string | null
          currency: string
          entry_id: string | null
          firm_display_name: string
          firm_legal_name: string
          firm_timezone: string
          id: string
          invoice_amount_cents: number
          invoice_description: string
          invoice_id: string
          invoice_issued_on: string | null
          invoice_number: string
          is_sample: boolean
          issued_at: string
          issued_by: string | null
          matter_id: string
          matter_label: string
          method: string
          number: string
          organization_id: string
          paid_at: string
          paid_on: string
          payment_id: string | null
          person_id: string | null
          reference: string | null
          source: string
        }
        Insert: {
          account_institution?: string | null
          account_label?: string | null
          account_last4?: string | null
          amount_cents: number
          card_brand?: string | null
          card_last4?: string | null
          client_name: string
          consultant_licence?: string | null
          consultant_name?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          entry_id?: string | null
          firm_display_name: string
          firm_legal_name: string
          firm_timezone: string
          id?: string
          invoice_amount_cents: number
          invoice_description: string
          invoice_id: string
          invoice_issued_on?: string | null
          invoice_number: string
          is_sample?: boolean
          issued_at?: string
          issued_by?: string | null
          matter_id: string
          matter_label: string
          method: string
          number: string
          organization_id: string
          paid_at: string
          paid_on: string
          payment_id?: string | null
          person_id?: string | null
          reference?: string | null
          source: string
        }
        Update: {
          account_institution?: string | null
          account_label?: string | null
          account_last4?: string | null
          amount_cents?: number
          card_brand?: string | null
          card_last4?: string | null
          client_name?: string
          consultant_licence?: string | null
          consultant_name?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          entry_id?: string | null
          firm_display_name?: string
          firm_legal_name?: string
          firm_timezone?: string
          id?: string
          invoice_amount_cents?: number
          invoice_description?: string
          invoice_id?: string
          invoice_issued_on?: string | null
          invoice_number?: string
          is_sample?: boolean
          issued_at?: string
          issued_by?: string | null
          matter_id?: string
          matter_label?: string
          method?: string
          number?: string
          organization_id?: string
          paid_at?: string
          paid_on?: string
          payment_id?: string | null
          person_id?: string | null
          reference?: string | null
          source?: string
        }
        Relationships: []
      }
      invoice_payments: {
        Row: {
          amount_cents: number
          amount_received_cents: number
          refunded_cents: number
          application_fee_cents: number
          card_brand: string | null
          card_last4: string | null
          connected_account_id: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          invoice_id: string
          last_event_id: string | null
          livemode: boolean
          organization_id: string
          payment_intent_id: string
          provider: string
          status: Database["public"]["Enums"]["invoice_payment_status"]
          succeeded_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          amount_cents: number
          amount_received_cents?: number
          refunded_cents?: number
          application_fee_cents?: number
          card_brand?: string | null
          card_last4?: string | null
          connected_account_id: string
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          invoice_id: string
          last_event_id?: string | null
          livemode?: boolean
          organization_id: string
          payment_intent_id: string
          provider?: string
          status?: Database["public"]["Enums"]["invoice_payment_status"]
          succeeded_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          amount_cents?: number
          amount_received_cents?: number
          refunded_cents?: number
          application_fee_cents?: number
          card_brand?: string | null
          card_last4?: string | null
          connected_account_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          invoice_id?: string
          last_event_id?: string | null
          livemode?: boolean
          organization_id?: string
          payment_intent_id?: string
          provider?: string
          status?: Database["public"]["Enums"]["invoice_payment_status"]
          succeeded_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      invoice_refunds: {
        Row: {
          amount_cents: number
          connected_account_id: string
          created_at: string
          created_by: string | null
          currency: string
          failed_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string
          last_event_id: string | null
          livemode: boolean
          number: string
          organization_id: string
          payment_id: string
          provider: string
          reason: string | null
          refund_id: string
          requested_by: string | null
          status: Database["public"]["Enums"]["invoice_refund_status"]
          succeeded_at: string | null
          task_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          amount_cents: number
          connected_account_id: string
          created_at?: string
          created_by?: string | null
          currency: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id: string
          last_event_id?: string | null
          livemode?: boolean
          number: string
          organization_id: string
          payment_id: string
          provider?: string
          reason?: string | null
          refund_id: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["invoice_refund_status"]
          succeeded_at?: string | null
          task_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          amount_cents?: number
          connected_account_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string
          last_event_id?: string | null
          livemode?: boolean
          number?: string
          organization_id?: string
          payment_id?: string
          provider?: string
          reason?: string | null
          refund_id?: string
          requested_by?: string | null
          status?: Database["public"]["Enums"]["invoice_refund_status"]
          succeeded_at?: string | null
          task_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      invoice_reversal_events: {
        Row: {
          amount_cents: number | null
          connected_account_id: string
          created_at: string
          currency: string | null
          detail: string | null
          dispute_id: string | null
          dispute_status: Database["public"]["Enums"]["invoice_dispute_status"] | null
          event_id: string
          event_type: string
          id: string
          invoice_id: string
          invoice_status: Database["public"]["Enums"]["invoice_status"]
          object_id: string | null
          organization_id: string
          outcome: string
          payment_id: string
          provider: string
          refund_id: string | null
          refund_status: Database["public"]["Enums"]["invoice_refund_status"] | null
          webhook_inbox_id: string
        }
        Insert: {
          amount_cents?: number | null
          connected_account_id: string
          created_at?: string
          currency?: string | null
          detail?: string | null
          dispute_id?: string | null
          dispute_status?: Database["public"]["Enums"]["invoice_dispute_status"] | null
          event_id: string
          event_type: string
          id?: string
          invoice_id: string
          invoice_status: Database["public"]["Enums"]["invoice_status"]
          object_id?: string | null
          organization_id: string
          outcome: string
          payment_id: string
          provider?: string
          refund_id?: string | null
          refund_status?: Database["public"]["Enums"]["invoice_refund_status"] | null
          webhook_inbox_id: string
        }
        Update: {
          amount_cents?: number | null
          connected_account_id?: string
          created_at?: string
          currency?: string | null
          detail?: string | null
          dispute_id?: string | null
          dispute_status?: Database["public"]["Enums"]["invoice_dispute_status"] | null
          event_id?: string
          event_type?: string
          id?: string
          invoice_id?: string
          invoice_status?: Database["public"]["Enums"]["invoice_status"]
          object_id?: string | null
          organization_id?: string
          outcome?: string
          payment_id?: string
          provider?: string
          refund_id?: string | null
          refund_status?: Database["public"]["Enums"]["invoice_refund_status"] | null
          webhook_inbox_id?: string
        }
        Relationships: []
      }
      invoice_write_offs: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          idempotency_key: string
          invoice_id: string
          is_sample: boolean
          organization_id: string
          reason: string
          written_off_by: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          id?: string
          idempotency_key: string
          invoice_id: string
          is_sample?: boolean
          organization_id: string
          reason: string
          written_off_by: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          idempotency_key?: string
          invoice_id?: string
          is_sample?: boolean
          organization_id?: string
          reason?: string
          written_off_by?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          discard_reason: string | null
          discarded_at: string | null
          discarded_by: string | null
          written_off_cents: number
          amount_cents: number
          created_at: string
          created_by: string | null
          currency: string
          description: string
          due_on: string
          fee_category: string
          id: string
          idempotency_key: string
          is_sample: boolean
          issued_on: string | null
          matter_id: string
          number: string
          organization_id: string
          client_funds_paid_cents: number
          manual_paid_cents: number
          credited_cents: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
          paid_cents: number
          refunded_cents: number
          status: Database["public"]["Enums"]["invoice_status"]
          updated_at: string
          version: number
        }
        Insert: {
          discard_reason?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          written_off_cents?: number
          amount_cents: number
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          due_on: string
          fee_category?: string
          id?: string
          idempotency_key: string
          is_sample?: boolean
          issued_on?: string | null
          matter_id: string
          number: string
          organization_id: string
          client_funds_paid_cents?: number
          manual_paid_cents?: number
          credited_cents?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          paid_cents?: number
          refunded_cents?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          discard_reason?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          written_off_cents?: number
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          due_on?: string
          fee_category?: string
          id?: string
          idempotency_key?: string
          is_sample?: boolean
          issued_on?: string | null
          matter_id?: string
          number?: string
          organization_id?: string
          client_funds_paid_cents?: number
          manual_paid_cents?: number
          credited_cents?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
          paid_cents?: number
          refunded_cents?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      lead_booking_links: {
        Row: {
          booking_id: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string
          organization_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id: string
          organization_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string
          organization_id?: string
        }
        Relationships: []
      }
      lead_consents: {
        Row: {
          captured_via: string
          created_by: string | null
          granted: boolean
          id: string
          lead_id: string
          organization_id: string
          policy_version: string | null
          purpose: Database["public"]["Enums"]["lead_consent_purpose"]
          recorded_at: string
          statement_sha256: string
          statement_text: string
        }
        Insert: {
          captured_via: string
          created_by?: string | null
          granted: boolean
          id?: string
          lead_id: string
          organization_id: string
          policy_version?: string | null
          purpose: Database["public"]["Enums"]["lead_consent_purpose"]
          recorded_at?: string
          statement_sha256: string
          statement_text: string
        }
        Update: {
          captured_via?: string
          created_by?: string | null
          granted?: boolean
          id?: string
          lead_id?: string
          organization_id?: string
          policy_version?: string | null
          purpose?: Database["public"]["Enums"]["lead_consent_purpose"]
          recorded_at?: string
          statement_sha256?: string
          statement_text?: string
        }
        Relationships: []
      }
      lead_duplicate_decisions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          lead_id: string
          organization_id: string
          other_lead_id: string
          same_person: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id: string
          organization_id: string
          other_lead_id: string
          same_person: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string
          organization_id?: string
          other_lead_id?: string
          same_person?: boolean
        }
        Relationships: []
      }
      lead_enquiry_attempts: {
        Row: {
          client_hash: string | null
          created_at: string
          id: string
          organization_id: string
        }
        Insert: {
          client_hash?: string | null
          created_at?: string
          id?: string
          organization_id: string
        }
        Update: {
          client_hash?: string | null
          created_at?: string
          id?: string
          organization_id?: string
        }
        Relationships: []
      }
      lead_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          from_stage_id: string | null
          id: string
          kind: string
          lead_id: string
          organization_id: string
          payload: Json
          reason: string | null
          to_stage_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          from_stage_id?: string | null
          id?: string
          kind: string
          lead_id: string
          organization_id: string
          payload?: Json
          reason?: string | null
          to_stage_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          from_stage_id?: string | null
          id?: string
          kind?: string
          lead_id?: string
          organization_id?: string
          payload?: Json
          reason?: string | null
          to_stage_id?: string | null
        }
        Relationships: []
      }
      lead_follow_ups: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          due_on: string | null
          id: string
          lead_id: string
          organization_id: string
          owner_membership_id: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          id?: string
          lead_id: string
          organization_id: string
          owner_membership_id?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          id?: string
          lead_id?: string
          organization_id?: string
          owner_membership_id?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      lead_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          lead_id: string
          organization_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id: string
          organization_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          lead_id?: string
          organization_id?: string
        }
        Relationships: []
      }
      lead_stages: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          id: string
          key: string
          kind: Database["public"]["Enums"]["lead_stage_kind"]
          label: string
          organization_id: string
          position: number
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          key: string
          kind: Database["public"]["Enums"]["lead_stage_kind"]
          label: string
          organization_id: string
          position: number
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string
          kind?: Database["public"]["Enums"]["lead_stage_kind"]
          label?: string
          organization_id?: string
          position?: number
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      leads: {
        Row: {
          conflict_checked_at: string | null
          conflict_checked_by: string | null
          conflict_note: string | null
          conflict_result: Database["public"]["Enums"]["lead_conflict_result"]
          converted_at: string | null
          attribution: Json
          converted_matter_id: string | null
          converted_person_id: string | null
          country_now: string | null
          created_at: string
          created_by: string | null
          currency: string
          date_of_birth: string | null
          display_name: string
          email: string | null
          id: string
          is_sample: boolean
          language: string | null
          lost_at: string | null
          lost_reason: string | null
          organization_id: string
          owner_membership_id: string | null
          phone: string | null
          preferred_contact: string | null
          proposed_fee_cents: number | null
          same_person_lead_id: string | null
          service_interest: string | null
          source: Database["public"]["Enums"]["lead_source"]
          source_detail: string | null
          stage_id: string
          submission_key: string | null
          tags: string[]
          updated_at: string
          version: number
        }
        Insert: {
          conflict_checked_at?: string | null
          conflict_checked_by?: string | null
          conflict_note?: string | null
          conflict_result?: Database["public"]["Enums"]["lead_conflict_result"]
          converted_at?: string | null
          attribution?: Json
          converted_matter_id?: string | null
          converted_person_id?: string | null
          country_now?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          date_of_birth?: string | null
          display_name: string
          email?: string | null
          id?: string
          is_sample?: boolean
          language?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          organization_id: string
          owner_membership_id?: string | null
          phone?: string | null
          preferred_contact?: string | null
          proposed_fee_cents?: number | null
          same_person_lead_id?: string | null
          service_interest?: string | null
          source: Database["public"]["Enums"]["lead_source"]
          source_detail?: string | null
          stage_id: string
          submission_key?: string | null
          tags?: string[]
          updated_at?: string
          version?: number
        }
        Update: {
          conflict_checked_at?: string | null
          conflict_checked_by?: string | null
          conflict_note?: string | null
          conflict_result?: Database["public"]["Enums"]["lead_conflict_result"]
          converted_at?: string | null
          attribution?: Json
          converted_matter_id?: string | null
          converted_person_id?: string | null
          country_now?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          date_of_birth?: string | null
          display_name?: string
          email?: string | null
          id?: string
          is_sample?: boolean
          language?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          organization_id?: string
          owner_membership_id?: string | null
          phone?: string | null
          preferred_contact?: string | null
          proposed_fee_cents?: number | null
          same_person_lead_id?: string | null
          service_interest?: string | null
          source?: Database["public"]["Enums"]["lead_source"]
          source_detail?: string | null
          stage_id?: string
          submission_key?: string | null
          tags?: string[]
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      matter_closures: {
        Row: {
          blockers: Json
          closed_at: string
          closed_by: string
          closed_on: string
          created_at: string
          created_by: string | null
          custodian_membership_id: string | null
          evidence_id: string | null
          id: string
          legal_hold_active: boolean
          matter_id: string
          organization_id: string
          override_reason: string | null
          reason: string
          retention_on: string
          retention_policy: Json
          retention_review_required: boolean
          retention_years: number
        }
        Insert: {
          blockers?: Json
          closed_at?: string
          closed_by: string
          closed_on: string
          created_at?: string
          created_by?: string | null
          custodian_membership_id?: string | null
          evidence_id?: string | null
          id?: string
          legal_hold_active: boolean
          matter_id: string
          organization_id: string
          override_reason?: string | null
          reason: string
          retention_on: string
          retention_policy: Json
          retention_review_required?: boolean
          retention_years: number
        }
        Update: {
          blockers?: Json
          closed_at?: string
          closed_by?: string
          closed_on?: string
          created_at?: string
          created_by?: string | null
          custodian_membership_id?: string | null
          evidence_id?: string | null
          id?: string
          legal_hold_active?: boolean
          matter_id?: string
          organization_id?: string
          override_reason?: string | null
          reason?: string
          retention_on?: string
          retention_policy?: Json
          retention_review_required?: boolean
          retention_years?: number
        }
        Relationships: []
      }
      matter_engagements: {
        Row: {
          agreement_locator: string | null
          consultant_membership_id: string
          created_at: string
          created_by: string | null
          exception_reason: string | null
          id: string
          matter_id: string
          organization_id: string
          permitted_role: Database["public"]["Enums"]["org_role"] | null
          scope_summary: string
          status: Database["public"]["Enums"]["engagement_status"]
          updated_at: string
          use_exception: boolean
          version: number
        }
        Insert: {
          agreement_locator?: string | null
          consultant_membership_id: string
          created_at?: string
          created_by?: string | null
          exception_reason?: string | null
          id?: string
          matter_id: string
          organization_id: string
          permitted_role?: Database["public"]["Enums"]["org_role"] | null
          scope_summary: string
          status: Database["public"]["Enums"]["engagement_status"]
          updated_at?: string
          use_exception: boolean
          version?: number
        }
        Update: {
          agreement_locator?: string | null
          consultant_membership_id?: string
          created_at?: string
          created_by?: string | null
          exception_reason?: string | null
          id?: string
          matter_id?: string
          organization_id?: string
          permitted_role?: Database["public"]["Enums"]["org_role"] | null
          scope_summary?: string
          status?: Database["public"]["Enums"]["engagement_status"]
          updated_at?: string
          use_exception?: boolean
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "matter_engagements_consultant_membership_id_organization_i_fkey"
            columns: ["consultant_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_engagements_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_engagements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_exports: {
        Row: {
          byte_size: number | null
          cancelled_at: string | null
          cancelled_by: string | null
          contents: Json
          created_at: string
          created_by: string | null
          download_count: number
          excluded: Json
          expires_at: string | null
          failed_at: string | null
          failure_reason: string | null
          file_count: number | null
          id: string
          idempotency_key: string
          is_sample: boolean
          last_downloaded_at: string | null
          last_downloaded_by: string | null
          manifest_sha256: string | null
          matter_id: string
          organization_id: string
          progress: number
          ready_at: string | null
          record_count: number | null
          requested_at: string
          requested_by: string
          sha256: string | null
          stage: string
          status: Database["public"]["Enums"]["matter_export_status"]
          storage_bucket: string | null
          storage_key: string | null
          updated_at: string
          version: number
        }
        Insert: {
          byte_size?: number | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contents?: Json
          created_at?: string
          created_by?: string | null
          download_count?: number
          excluded?: Json
          expires_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          file_count?: number | null
          id?: string
          idempotency_key: string
          is_sample?: boolean
          last_downloaded_at?: string | null
          last_downloaded_by?: string | null
          manifest_sha256?: string | null
          matter_id: string
          organization_id: string
          progress?: number
          ready_at?: string | null
          record_count?: number | null
          requested_at?: string
          requested_by: string
          sha256?: string | null
          stage?: string
          status?: Database["public"]["Enums"]["matter_export_status"]
          storage_bucket?: string | null
          storage_key?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          byte_size?: number | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contents?: Json
          created_at?: string
          created_by?: string | null
          download_count?: number
          excluded?: Json
          expires_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          file_count?: number | null
          id?: string
          idempotency_key?: string
          is_sample?: boolean
          last_downloaded_at?: string | null
          last_downloaded_by?: string | null
          manifest_sha256?: string | null
          matter_id?: string
          organization_id?: string
          progress?: number
          ready_at?: string | null
          record_count?: number | null
          requested_at?: string
          requested_by?: string
          sha256?: string | null
          stage?: string
          status?: Database["public"]["Enums"]["matter_export_status"]
          storage_bucket?: string | null
          storage_key?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      matter_legal_holds: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          matter_id: string
          organization_id: string
          placed_at: string
          placed_by: string
          reason: string
          release_reason: string | null
          released_at: string | null
          released_by: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id: string
          organization_id: string
          placed_at?: string
          placed_by: string
          reason: string
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id?: string
          organization_id?: string
          placed_at?: string
          placed_by?: string
          reason?: string
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      matter_message_attachments: {
        Row: {
          created_at: string
          document_id: string
          id: string
          message_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          message_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          message_id?: string
          organization_id?: string
        }
        Relationships: []
      }
      matter_message_receipts: {
        Row: {
          acknowledged_at: string | null
          message_id: string
          organization_id: string
          person_id: string | null
          read_at: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          message_id: string
          organization_id: string
          person_id?: string | null
          read_at?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          message_id?: string
          organization_id?: string
          person_id?: string | null
          read_at?: string
          user_id?: string
        }
        Relationships: []
      }
      matter_messages: {
        Row: {
          author_kind: string
          author_membership_id: string | null
          author_name: string
          author_person_id: string | null
          author_user_id: string | null
          body: string
          channel: Database["public"]["Enums"]["message_channel"]
          client_key: string | null
          created_at: string
          id: string
          matter_id: string
          organization_id: string
          requires_ack: boolean
          thread_id: string
        }
        Insert: {
          author_kind: string
          author_membership_id?: string | null
          author_name: string
          author_person_id?: string | null
          author_user_id?: string | null
          body: string
          channel?: Database["public"]["Enums"]["message_channel"]
          client_key?: string | null
          created_at?: string
          id?: string
          matter_id: string
          organization_id: string
          requires_ack?: boolean
          thread_id: string
        }
        Update: {
          author_kind?: string
          author_membership_id?: string | null
          author_name?: string
          author_person_id?: string | null
          author_user_id?: string | null
          body?: string
          channel?: Database["public"]["Enums"]["message_channel"]
          client_key?: string | null
          created_at?: string
          id?: string
          matter_id?: string
          organization_id?: string
          requires_ack?: boolean
          thread_id?: string
        }
        Relationships: []
      }
      matter_outbound_emails: {
        Row: {
          author_membership_id: string
          author_name: string
          author_user_id: string
          body: string
          client_key: string | null
          created_at: string
          id: string
          is_sample: boolean
          matter_id: string
          organization_id: string
          outbox_event_id: string
          person_id: string
          recipient_email: string
          reply_to_inbound_id: string | null
          subject: string | null
        }
        Insert: {
          author_membership_id: string
          author_name: string
          author_user_id: string
          body: string
          client_key?: string | null
          created_at?: string
          id?: string
          is_sample?: boolean
          matter_id: string
          organization_id: string
          outbox_event_id: string
          person_id: string
          recipient_email: string
          reply_to_inbound_id?: string | null
          subject?: string | null
        }
        Update: {
          author_membership_id?: string
          author_name?: string
          author_user_id?: string
          body?: string
          client_key?: string | null
          created_at?: string
          id?: string
          is_sample?: boolean
          matter_id?: string
          organization_id?: string
          outbox_event_id?: string
          person_id?: string
          recipient_email?: string
          reply_to_inbound_id?: string | null
          subject?: string | null
        }
        Relationships: []
      }
      matter_participants: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          matter_id: string
          membership_id: string | null
          organization_id: string
          person_id: string | null
          role: Database["public"]["Enums"]["matter_party_role"]
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id: string
          membership_id?: string | null
          organization_id: string
          person_id?: string | null
          role: Database["public"]["Enums"]["matter_party_role"]
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id?: string
          membership_id?: string | null
          organization_id?: string
          person_id?: string | null
          role?: Database["public"]["Enums"]["matter_party_role"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "matter_participants_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_participants_membership_id_organization_id_fkey"
            columns: ["membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_participants_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      matter_program_changes: {
        Row: {
          actor_user_id: string | null
          created_at: string
          from_pack_id: string | null
          id: string
          matter_id: string
          organization_id: string
          permitted_role: Database["public"]["Enums"]["org_role"]
          reason: string
          to_pack_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          from_pack_id?: string | null
          id?: string
          matter_id: string
          organization_id: string
          permitted_role: Database["public"]["Enums"]["org_role"]
          reason: string
          to_pack_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          from_pack_id?: string | null
          id?: string
          matter_id?: string
          organization_id?: string
          permitted_role?: Database["public"]["Enums"]["org_role"]
          reason?: string
          to_pack_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_program_changes_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_program_changes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_program_changes_to_pack_id_fkey"
            columns: ["to_pack_id"]
            isOneToOne: false
            referencedRelation: "rule_pack_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_reply_addresses: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          matter_id: string
          organization_id: string
          token: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id: string
          organization_id: string
          token: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id?: string
          organization_id?: string
          token?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "matter_reply_addresses_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_reply_addresses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_rule_bindings: {
        Row: {
          checked_at: string | null
          chosen_context: Json | null
          created_at: string
          created_by: string | null
          id: string
          matter_id: string
          organization_id: string
          rationale: string | null
          recheck_required: boolean
          reviewed_by: string | null
          rule_pack_version_id: string
          superseded_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          checked_at?: string | null
          chosen_context?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id: string
          organization_id: string
          rationale?: string | null
          recheck_required?: boolean
          reviewed_by?: string | null
          rule_pack_version_id: string
          superseded_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          checked_at?: string | null
          chosen_context?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id?: string
          organization_id?: string
          rationale?: string | null
          recheck_required?: boolean
          reviewed_by?: string | null
          rule_pack_version_id?: string
          superseded_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "matter_rule_bindings_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_rule_bindings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_rule_bindings_reviewed_by_organization_id_fkey"
            columns: ["reviewed_by", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_rule_bindings_rule_pack_version_id_fkey"
            columns: ["rule_pack_version_id"]
            isOneToOne: false
            referencedRelation: "rule_pack_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_letters: {
        Row: {
          approved_at: string | null
          approved_by_membership_id: string | null
          approved_self: boolean | null
          approved_version: number | null
          created_at: string
          created_by: string
          current_version: number
          discarded_at: string | null
          discarded_by: string | null
          id: string
          is_sample: boolean
          letter_type: string
          matter_id: string
          organization_id: string
          origin: string
          run_id: string | null
          status: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by_membership_id?: string | null
          approved_self?: boolean | null
          approved_version?: number | null
          created_at?: string
          created_by: string
          current_version?: number
          discarded_at?: string | null
          discarded_by?: string | null
          id?: string
          is_sample?: boolean
          letter_type: string
          matter_id: string
          organization_id: string
          origin: string
          run_id?: string | null
          status?: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by_membership_id?: string | null
          approved_self?: boolean | null
          approved_version?: number | null
          created_at?: string
          created_by?: string
          current_version?: number
          discarded_at?: string | null
          discarded_by?: string | null
          id?: string
          is_sample?: boolean
          letter_type?: string
          matter_id?: string
          organization_id?: string
          origin?: string
          run_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      matter_letter_versions: {
        Row: {
          body: string
          created_at: string
          created_by: string
          facts: Json
          id: string
          left_out: Json
          letter_id: string
          matter_id: string
          official: Json
          organization_id: string
          origin: string
          title: string
          version_number: number
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          facts?: Json
          id?: string
          left_out?: Json
          letter_id: string
          matter_id: string
          official?: Json
          organization_id: string
          origin: string
          title: string
          version_number: number
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          facts?: Json
          id?: string
          left_out?: Json
          letter_id?: string
          matter_id?: string
          official?: Json
          organization_id?: string
          origin?: string
          title?: string
          version_number?: number
        }
        Relationships: []
      }
      matter_staff_notes: {
        Row: {
          author_membership_id: string
          author_user_id: string
          body: string
          created_at: string
          id: string
          matter_id: string
          organization_id: string
        }
        Insert: {
          author_membership_id: string
          author_user_id: string
          body: string
          created_at?: string
          id?: string
          matter_id: string
          organization_id: string
        }
        Update: {
          author_membership_id?: string
          author_user_id?: string
          body?: string
          created_at?: string
          id?: string
          matter_id?: string
          organization_id?: string
        }
        Relationships: []
      }
      announcement_deliveries: {
        Row: {
          announcement_id: string
          created_at: string
          dismissed_at: string | null
          emailed: boolean
          id: string
          organization_id: string
          person_id: string
          seen_at: string | null
        }
        Insert: {
          announcement_id: string
          created_at?: string
          dismissed_at?: string | null
          emailed?: boolean
          id?: string
          organization_id: string
          person_id: string
          seen_at?: string | null
        }
        Update: {
          announcement_id?: string
          created_at?: string
          dismissed_at?: string | null
          emailed?: boolean
          id?: string
          organization_id?: string
          person_id?: string
          seen_at?: string | null
        }
        Relationships: []
      }
      announcements: {
        Row: {
          audience_kind: string
          body: string
          created_at: string
          emailed_count: number
          id: string
          is_sample: boolean
          organization_id: string
          program_key: string | null
          recipient_count: number
          sent_by: string
          sent_by_membership_id: string
          template_id: string
          template_version: number
          title: string
        }
        Insert: {
          audience_kind: string
          body: string
          created_at?: string
          emailed_count: number
          id?: string
          is_sample?: boolean
          organization_id: string
          program_key?: string | null
          recipient_count: number
          sent_by: string
          sent_by_membership_id: string
          template_id: string
          template_version: number
          title: string
        }
        Update: {
          audience_kind?: string
          body?: string
          created_at?: string
          emailed_count?: number
          id?: string
          is_sample?: boolean
          organization_id?: string
          program_key?: string | null
          recipient_count?: number
          sent_by?: string
          sent_by_membership_id?: string
          template_id?: string
          template_version?: number
          title?: string
        }
        Relationships: []
      }
      message_templates: {
        Row: {
          approved_at: string | null
          approved_by_membership_id: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          status: string
          title: string | null
          updated_at: string
          updated_by: string | null
          use_for: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by_membership_id?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          status?: string
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          use_for: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by_membership_id?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: string
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          use_for?: string
          version?: number
        }
        Relationships: []
      }
      matter_stage_evidence: {
        Row: {
          created_at: string
          created_by: string | null
          external_reference: string | null
          id: string
          kind: Database["public"]["Enums"]["matter_stage_evidence_kind"]
          matter_id: string
          organization_id: string
          receipt_locator: string | null
          submission_at: string | null
          summary: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          external_reference?: string | null
          id?: string
          kind: Database["public"]["Enums"]["matter_stage_evidence_kind"]
          matter_id: string
          organization_id: string
          receipt_locator?: string | null
          submission_at?: string | null
          summary: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          external_reference?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["matter_stage_evidence_kind"]
          matter_id?: string
          organization_id?: string
          receipt_locator?: string | null
          submission_at?: string | null
          summary?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "matter_stage_evidence_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_stage_evidence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_stage_overrides: {
        Row: {
          actor_user_id: string | null
          created_at: string
          from_stage: Database["public"]["Enums"]["matter_stage"]
          id: string
          matter_id: string
          organization_id: string
          permitted_role: Database["public"]["Enums"]["org_role"]
          reason: string
          to_stage: Database["public"]["Enums"]["matter_stage"]
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          from_stage: Database["public"]["Enums"]["matter_stage"]
          id?: string
          matter_id: string
          organization_id: string
          permitted_role: Database["public"]["Enums"]["org_role"]
          reason: string
          to_stage: Database["public"]["Enums"]["matter_stage"]
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          from_stage?: Database["public"]["Enums"]["matter_stage"]
          id?: string
          matter_id?: string
          organization_id?: string
          permitted_role?: Database["public"]["Enums"]["org_role"]
          reason?: string
          to_stage?: Database["public"]["Enums"]["matter_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "matter_stage_overrides_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_stage_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matter_stage_transitions: {
        Row: {
          actor_user_id: string | null
          created_at: string
          evidence_id: string | null
          from_stage: Database["public"]["Enums"]["matter_stage"]
          from_version: number
          id: string
          matter_id: string
          organization_id: string
          reason: string
          to_stage: Database["public"]["Enums"]["matter_stage"]
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          evidence_id?: string | null
          from_stage: Database["public"]["Enums"]["matter_stage"]
          from_version: number
          id?: string
          matter_id: string
          organization_id: string
          reason: string
          to_stage: Database["public"]["Enums"]["matter_stage"]
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          evidence_id?: string | null
          from_stage?: Database["public"]["Enums"]["matter_stage"]
          from_version?: number
          id?: string
          matter_id?: string
          organization_id?: string
          reason?: string
          to_stage?: Database["public"]["Enums"]["matter_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "matter_stage_transitions_evidence_id_organization_id_fkey"
            columns: ["evidence_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matter_stage_evidence"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_stage_transitions_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_stage_transitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      matters: {
        Row: {
          created_at: string
          created_by: string | null
          engagement_status: Database["public"]["Enums"]["engagement_status"]
          government_status: Database["public"]["Enums"]["government_status"]
          id: string
          is_sample: boolean
          on_hold: boolean
          on_hold_owner_membership_id: string | null
          on_hold_reason: string | null
          on_hold_review_on: string | null
          organization_id: string
          outcome: Database["public"]["Enums"]["matter_outcome"] | null
          predecessor_matter_id: string | null
          program_pack_id: string | null
          reference: string | null
          reference_seq: number | null
          reference_year: number | null
          responsible_consultant_membership_id: string | null
          retention_on: string | null
          sample_label: string | null
          stage: Database["public"]["Enums"]["matter_stage"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          engagement_status?: Database["public"]["Enums"]["engagement_status"]
          government_status?: Database["public"]["Enums"]["government_status"]
          id?: string
          is_sample?: boolean
          on_hold?: boolean
          on_hold_owner_membership_id?: string | null
          on_hold_reason?: string | null
          on_hold_review_on?: string | null
          organization_id: string
          outcome?: Database["public"]["Enums"]["matter_outcome"] | null
          predecessor_matter_id?: string | null
          program_pack_id?: string | null
          reference?: string | null
          reference_seq?: number | null
          reference_year?: number | null
          responsible_consultant_membership_id?: string | null
          retention_on?: string | null
          sample_label?: string | null
          stage?: Database["public"]["Enums"]["matter_stage"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          engagement_status?: Database["public"]["Enums"]["engagement_status"]
          government_status?: Database["public"]["Enums"]["government_status"]
          id?: string
          is_sample?: boolean
          on_hold?: boolean
          on_hold_owner_membership_id?: string | null
          on_hold_reason?: string | null
          on_hold_review_on?: string | null
          organization_id?: string
          outcome?: Database["public"]["Enums"]["matter_outcome"] | null
          predecessor_matter_id?: string | null
          program_pack_id?: string | null
          reference?: string | null
          reference_seq?: number | null
          reference_year?: number | null
          responsible_consultant_membership_id?: string | null
          retention_on?: string | null
          sample_label?: string | null
          stage?: Database["public"]["Enums"]["matter_stage"]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "matters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          accepted_at: string | null
          created_at: string
          created_by: string | null
          id: string
          invited_at: string | null
          invited_by: string | null
          organization_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["org_role"]
          status: Database["public"]["Enums"]["membership_status"]
          suspended_at: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          organization_id: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["org_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          suspended_at?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          organization_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          suspended_at?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_thread_people: {
        Row: {
          created_at: string
          organization_id: string
          person_id: string
          thread_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          person_id: string
          thread_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          person_id?: string
          thread_id?: string
        }
        Relationships: []
      }
      message_threads: {
        Row: {
          audience_key: string
          created_at: string
          created_by: string | null
          id: string
          is_sample: boolean
          last_message_at: string
          matter_id: string
          organization_id: string
        }
        Insert: {
          audience_key: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_sample?: boolean
          last_message_at?: string
          matter_id: string
          organization_id: string
        }
        Update: {
          audience_key?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_sample?: boolean
          last_message_at?: string
          matter_id?: string
          organization_id?: string
        }
        Relationships: []
      }
      mfa_assurance_proofs: {
        Row: {
          created_at: string
          id: string
          method: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          method: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          method?: string
          session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      mfa_recovery_attempts: {
        Row: {
          failures: number
          locked_until: string | null
          user_id: string
        }
        Insert: {
          failures?: number
          locked_until?: string | null
          user_id: string
        }
        Update: {
          failures?: number
          locked_until?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mfa_recovery_codes: {
        Row: {
          batch_id: string
          code_hash: string
          created_at: string
          id: string
          retired_at: string | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          batch_id: string
          code_hash: string
          created_at?: string
          id?: string
          retired_at?: string | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          batch_id?: string
          code_hash?: string
          created_at?: string
          id?: string
          retired_at?: string | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      migration_batches: {
        Row: {
          byte_size: number
          checked_at: string | null
          commit_started_at: string | null
          committed_at: string | null
          committed_by: string | null
          created_at: string
          created_by: string | null
          discarded_at: string | null
          exceptions: Json
          file_name: string
          headers: string[]
          id: string
          is_sample: boolean
          mapping: Json
          organization_id: string
          parsed_digest: string
          plan_counts: Json | null
          plan_hash: string | null
          purge_after: string
          references_at_import: Json
          result_counts: Json | null
          rolled_back_at: string | null
          rolled_back_by: string | null
          source_row_count: number
          source_sha256: string
          source_system: string
          staged_digest: string | null
          staged_row_count: number
          staging_purged_at: string | null
          status: Database["public"]["Enums"]["migration_batch_status"]
          updated_at: string
          verified_at: string | null
          version: number
        }
        Insert: {
          byte_size: number
          checked_at?: string | null
          commit_started_at?: string | null
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          created_by?: string | null
          discarded_at?: string | null
          exceptions?: Json
          file_name: string
          headers: string[]
          id?: string
          is_sample?: boolean
          mapping?: Json
          organization_id: string
          parsed_digest: string
          plan_counts?: Json | null
          plan_hash?: string | null
          purge_after: string
          references_at_import?: Json
          result_counts?: Json | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          source_row_count: number
          source_sha256: string
          source_system?: string
          staged_digest?: string | null
          staged_row_count?: number
          staging_purged_at?: string | null
          status?: Database["public"]["Enums"]["migration_batch_status"]
          updated_at?: string
          verified_at?: string | null
          version?: number
        }
        Update: {
          byte_size?: number
          checked_at?: string | null
          commit_started_at?: string | null
          committed_at?: string | null
          committed_by?: string | null
          created_at?: string
          created_by?: string | null
          discarded_at?: string | null
          exceptions?: Json
          file_name?: string
          headers?: string[]
          id?: string
          is_sample?: boolean
          mapping?: Json
          organization_id?: string
          parsed_digest?: string
          plan_counts?: Json | null
          plan_hash?: string | null
          purge_after?: string
          references_at_import?: Json
          result_counts?: Json | null
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          source_row_count?: number
          source_sha256?: string
          source_system?: string
          staged_digest?: string | null
          staged_row_count?: number
          staging_purged_at?: string | null
          status?: Database["public"]["Enums"]["migration_batch_status"]
          updated_at?: string
          verified_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "migration_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_records: {
        Row: {
          batch_id: string
          created: boolean
          created_at: string
          id: string
          imported_stage: Database["public"]["Enums"]["matter_stage"] | null
          organization_id: string
          record_id: string
          record_table: string
          removed_at: string | null
          row_number: number
          source_reference: string | null
          version_at_import: number
        }
        Insert: {
          batch_id: string
          created: boolean
          created_at?: string
          id?: string
          imported_stage?: Database["public"]["Enums"]["matter_stage"] | null
          organization_id: string
          record_id: string
          record_table: string
          removed_at?: string | null
          row_number: number
          source_reference?: string | null
          version_at_import: number
        }
        Update: {
          batch_id?: string
          created?: boolean
          created_at?: string
          id?: string
          imported_stage?: Database["public"]["Enums"]["matter_stage"] | null
          organization_id?: string
          record_id?: string
          record_table?: string
          removed_at?: string | null
          row_number?: number
          source_reference?: string | null
          version_at_import?: number
        }
        Relationships: [
          {
            foreignKeyName: "migration_records_batch_id_organization_id_fkey"
            columns: ["batch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "migration_batches"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      migration_rows: {
        Row: {
          batch_id: string
          cells: string[]
          committed_at: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          decision_target: string | null
          group_first: number | null
          group_key: string | null
          id: string
          is_applicant: boolean
          match_detail: string[] | null
          match_person_id: string | null
          match_row_number: number | null
          matter_id: string | null
          normalized: Json | null
          organization_id: string
          person_id: string | null
          plan: Database["public"]["Enums"]["migration_row_plan"] | null
          problems: Json
          row_number: number
          row_sha256: string
        }
        Insert: {
          batch_id: string
          cells: string[]
          committed_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_target?: string | null
          group_first?: number | null
          group_key?: string | null
          id?: string
          is_applicant?: boolean
          match_detail?: string[] | null
          match_person_id?: string | null
          match_row_number?: number | null
          matter_id?: string | null
          normalized?: Json | null
          organization_id: string
          person_id?: string | null
          plan?: Database["public"]["Enums"]["migration_row_plan"] | null
          problems?: Json
          row_number: number
          row_sha256: string
        }
        Update: {
          batch_id?: string
          cells?: string[]
          committed_at?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_target?: string | null
          group_first?: number | null
          group_key?: string | null
          id?: string
          is_applicant?: boolean
          match_detail?: string[] | null
          match_person_id?: string | null
          match_row_number?: number | null
          matter_id?: string | null
          normalized?: Json | null
          organization_id?: string
          person_id?: string | null
          plan?: Database["public"]["Enums"]["migration_row_plan"] | null
          problems?: Json
          row_number?: number
          row_sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "migration_rows_batch_id_organization_id_fkey"
            columns: ["batch_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "migration_batches"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      migration_settings: {
        Row: {
          created_at: string
          created_by: string | null
          organization_id: string
          staging_days: number
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          organization_id: string
          staging_days?: number
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          organization_id?: string
          staging_days?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "migration_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      official_source_domains: {
        Row: {
          active: boolean
          authority: string
          created_at: string
          created_by: string | null
          host: string
          id: string
          jurisdiction_code: string
          match_kind: Database["public"]["Enums"]["domain_match_kind"]
          notes: string | null
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          authority: string
          created_at?: string
          created_by?: string | null
          host: string
          id?: string
          jurisdiction_code: string
          match_kind: Database["public"]["Enums"]["domain_match_kind"]
          notes?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          authority?: string
          created_at?: string
          created_by?: string | null
          host?: string
          id?: string
          jurisdiction_code?: string
          match_kind?: Database["public"]["Enums"]["domain_match_kind"]
          notes?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      official_sources: {
        Row: {
          allowed_host: string
          canonical_url: string
          change_state: Database["public"]["Enums"]["source_change_state"]
          content_kind: Database["public"]["Enums"]["source_content_kind"]
          created_at: string
          created_by: string | null
          discovery_status: Database["public"]["Enums"]["source_discovery_status"]
          id: string
          jurisdiction: string
          last_attempt_at: string | null
          last_attempt_error: string | null
          last_attempt_result:
            | Database["public"]["Enums"]["source_observation"]
            | null
          last_checked_at: string | null
          next_review_at: string | null
          organization_id: string | null
          publisher: string
          review_status: Database["public"]["Enums"]["source_review_status"]
          source_language: string | null
          title: string | null
          updated_at: string
          version: number
        }
        Insert: {
          allowed_host: string
          canonical_url: string
          change_state?: Database["public"]["Enums"]["source_change_state"]
          content_kind: Database["public"]["Enums"]["source_content_kind"]
          created_at?: string
          created_by?: string | null
          discovery_status?: Database["public"]["Enums"]["source_discovery_status"]
          id?: string
          jurisdiction: string
          last_attempt_at?: string | null
          last_attempt_error?: string | null
          last_attempt_result?:
            | Database["public"]["Enums"]["source_observation"]
            | null
          last_checked_at?: string | null
          next_review_at?: string | null
          organization_id?: string | null
          publisher: string
          review_status?: Database["public"]["Enums"]["source_review_status"]
          source_language?: string | null
          title?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          allowed_host?: string
          canonical_url?: string
          change_state?: Database["public"]["Enums"]["source_change_state"]
          content_kind?: Database["public"]["Enums"]["source_content_kind"]
          created_at?: string
          created_by?: string | null
          discovery_status?: Database["public"]["Enums"]["source_discovery_status"]
          id?: string
          jurisdiction?: string
          last_attempt_at?: string | null
          last_attempt_error?: string | null
          last_attempt_result?:
            | Database["public"]["Enums"]["source_observation"]
            | null
          last_checked_at?: string | null
          next_review_at?: string | null
          organization_id?: string | null
          publisher?: string
          review_status?: Database["public"]["Enums"]["source_review_status"]
          source_language?: string | null
          title?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "official_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_offices: {
        Row: {
          address_line: string
          country_code: string
          created_at: string
          created_by: string | null
          id: string
          is_primary: boolean
          label: string
          locality: string
          organization_id: string
          postal_code: string | null
          region: string | null
          timezone: string | null
          updated_at: string
          version: number
        }
        Insert: {
          address_line: string
          country_code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          label: string
          locality: string
          organization_id: string
          postal_code?: string | null
          region?: string | null
          timezone?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          address_line?: string
          country_code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_primary?: boolean
          label?: string
          locality?: string
          organization_id?: string
          postal_code?: string | null
          region?: string | null
          timezone?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_offices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_setup_steps: {
        Row: {
          completed_at: string
          completed_by: string
          organization_id: string
          step: Database["public"]["Enums"]["firm_setup_step"]
        }
        Insert: {
          completed_at?: string
          completed_by: string
          organization_id: string
          step: Database["public"]["Enums"]["firm_setup_step"]
        }
        Update: {
          completed_at?: string
          completed_by?: string
          organization_id?: string
          step?: Database["public"]["Enums"]["firm_setup_step"]
        }
        Relationships: [
          {
            foreignKeyName: "organization_setup_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_subscriptions: {
        Row: {
          archived_at: string | null
          cancel_requested_at: string | null
          cancel_requested_by: string | null
          billing_interval: Database["public"]["Enums"]["billing_interval"] | null
          cancel_at: string | null
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          current_period_end: string | null
          duration_snapshot: Json | null
          end_arrangement: string | null
          end_arrangement_chosen_at: string | null
          end_arrangement_chosen_by: string | null
          end_transfer_id: string | null
          extra_seats: number
          last_webhook_event_id: string | null
          latest_invoice_status: string | null
          latest_invoice_url: string | null
          organization_id: string
          past_due_since: string | null
          plan: Database["public"]["Enums"]["subscription_plan"] | null
          restricted_at: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          trial_started_at: string
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          cancel_requested_at?: string | null
          cancel_requested_by?: string | null
          billing_interval?: Database["public"]["Enums"]["billing_interval"] | null
          cancel_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          current_period_end?: string | null
          duration_snapshot?: Json | null
          end_arrangement?: string | null
          end_arrangement_chosen_at?: string | null
          end_arrangement_chosen_by?: string | null
          end_transfer_id?: string | null
          extra_seats?: number
          last_webhook_event_id?: string | null
          latest_invoice_status?: string | null
          latest_invoice_url?: string | null
          organization_id: string
          past_due_since?: string | null
          plan?: Database["public"]["Enums"]["subscription_plan"] | null
          restricted_at?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          trial_started_at?: string
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          cancel_requested_at?: string | null
          cancel_requested_by?: string | null
          billing_interval?: Database["public"]["Enums"]["billing_interval"] | null
          cancel_at?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          current_period_end?: string | null
          duration_snapshot?: Json | null
          end_arrangement?: string | null
          end_arrangement_chosen_at?: string | null
          end_arrangement_chosen_by?: string | null
          end_transfer_id?: string | null
          extra_seats?: number
          last_webhook_event_id?: string | null
          latest_invoice_status?: string | null
          latest_invoice_url?: string | null
          organization_id?: string
          past_due_since?: string | null
          plan?: Database["public"]["Enums"]["subscription_plan"] | null
          restricted_at?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          trial_started_at?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          age_of_majority_years: number
          billing_contact_email: string | null
          billing_contact_name: string | null
          branding: Json
          continuity_contact_email: string | null
          continuity_contact_name: string | null
          created_at: string
          created_by: string | null
          default_locale: string
          enquiry_page_enabled: boolean
          document_max_bytes: number | null
          display_name: string
          dpa_accepted_at: string | null
          dpa_version: string | null
          id: string
          jurisdiction_codes: string[]
          legal_name: string
          privacy_contact_email: string | null
          privacy_contact_name: string | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          retention_policy: Json | null
          sample_mode: boolean
          slug: string
          staff_idle_timeout_minutes: number
          subscription_terms_accepted_at: string | null
          subscription_terms_version: string | null
          succession_note: string | null
          timezone: string
          updated_at: string
          verification_status: Database["public"]["Enums"]["org_verification_status"]
          version: number
        }
        Insert: {
          age_of_majority_years?: number
          billing_contact_email?: string | null
          billing_contact_name?: string | null
          branding?: Json
          continuity_contact_email?: string | null
          continuity_contact_name?: string | null
          created_at?: string
          created_by?: string | null
          default_locale?: string
          enquiry_page_enabled?: boolean
          document_max_bytes?: number | null
          display_name: string
          dpa_accepted_at?: string | null
          dpa_version?: string | null
          id?: string
          jurisdiction_codes?: string[]
          legal_name: string
          privacy_contact_email?: string | null
          privacy_contact_name?: string | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          retention_policy?: Json | null
          sample_mode?: boolean
          slug: string
          staff_idle_timeout_minutes?: number
          subscription_terms_accepted_at?: string | null
          subscription_terms_version?: string | null
          succession_note?: string | null
          timezone?: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["org_verification_status"]
          version?: number
        }
        Update: {
          age_of_majority_years?: number
          billing_contact_email?: string | null
          billing_contact_name?: string | null
          branding?: Json
          continuity_contact_email?: string | null
          continuity_contact_name?: string | null
          created_at?: string
          created_by?: string | null
          default_locale?: string
          enquiry_page_enabled?: boolean
          document_max_bytes?: number | null
          display_name?: string
          dpa_accepted_at?: string | null
          dpa_version?: string | null
          id?: string
          jurisdiction_codes?: string[]
          legal_name?: string
          privacy_contact_email?: string | null
          privacy_contact_name?: string | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          retention_policy?: Json | null
          sample_mode?: boolean
          slug?: string
          staff_idle_timeout_minutes?: number
          subscription_terms_accepted_at?: string | null
          subscription_terms_version?: string | null
          succession_note?: string | null
          timezone?: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["org_verification_status"]
          version?: number
        }
        Relationships: []
      }
      outbox_events: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          aggregate_version: number | null
          attempts: number
          available_at: string
          created_by: string | null
          event_type: string
          id: string
          idempotency_key: string | null
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          occurred_at: string
          organization_id: string
          payload: Json
          published_at: string | null
          request_id: string | null
          schema_version: number
          status: Database["public"]["Enums"]["outbox_status"]
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          aggregate_version?: number | null
          attempts?: number
          available_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          occurred_at?: string
          organization_id: string
          payload?: Json
          published_at?: string | null
          request_id?: string | null
          schema_version?: number
          status?: Database["public"]["Enums"]["outbox_status"]
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          aggregate_version?: number | null
          attempts?: number
          available_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          occurred_at?: string
          organization_id?: string
          payload?: Json
          published_at?: string | null
          request_id?: string | null
          schema_version?: number
          status?: Database["public"]["Enums"]["outbox_status"]
        }
        Relationships: [
          {
            foreignKeyName: "outbox_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      person_break_glass: {
        Row: {
          actor_user_id: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          organization_id: string
          person_id: string
          reason: string
          revoked_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          organization_id: string
          person_id: string
          reason: string
          revoked_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          organization_id?: string
          person_id?: string
          reason?: string
          revoked_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "person_break_glass_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_break_glass_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      person_contact_preferences: {
        Row: {
          deadline_reminders: boolean
          email_notices: boolean
          locale: string
          organization_id: string
          person_id: string
          sms_notices: boolean
          updated_at: string
        }
        Insert: {
          deadline_reminders?: boolean
          email_notices?: boolean
          locale?: string
          organization_id: string
          person_id: string
          sms_notices?: boolean
          updated_at?: string
        }
        Update: {
          deadline_reminders?: boolean
          email_notices?: boolean
          locale?: string
          sms_notices?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      person_flag_resolutions: {
        Row: {
          created_at: string
          created_by: string | null
          detail: string
          flag_key: string
          id: string
          note: string
          organization_id: string
          person_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          detail: string
          flag_key: string
          id?: string
          note: string
          organization_id: string
          person_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          detail?: string
          flag_key?: string
          id?: string
          note?: string
          organization_id?: string
          person_id?: string
        }
        Relationships: []
      }
      person_identity_entries: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          id: string
          kind: Database["public"]["Enums"]["person_identity_kind"]
          organization_id: string
          person_id: string
          replaces_id: string | null
          retired: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: Json
          id?: string
          kind: Database["public"]["Enums"]["person_identity_kind"]
          organization_id: string
          person_id: string
          replaces_id?: string | null
          retired?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          kind?: Database["public"]["Enums"]["person_identity_kind"]
          organization_id?: string
          person_id?: string
          replaces_id?: string | null
          retired?: boolean
        }
        Relationships: []
      }
      person_relationships: {
        Row: {
          created_at: string
          created_by: string | null
          from_person_id: string
          id: string
          organization_id: string
          relationship_type: Database["public"]["Enums"]["person_relationship_type"]
          to_person_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_person_id: string
          id?: string
          organization_id: string
          relationship_type: Database["public"]["Enums"]["person_relationship_type"]
          to_person_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_person_id?: string
          id?: string
          organization_id?: string
          relationship_type?: Database["public"]["Enums"]["person_relationship_type"]
          to_person_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "person_relationships_from_person_id_organization_id_fkey"
            columns: ["from_person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "person_relationships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_relationships_to_person_id_organization_id_fkey"
            columns: ["to_person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      person_section_records: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          matter_id: string
          organization_id: string
          person_id: string
          restricted: boolean
          section_key: Database["public"]["Enums"]["person_section_key"]
          summary: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id: string
          organization_id: string
          person_id: string
          restricted?: boolean
          section_key: Database["public"]["Enums"]["person_section_key"]
          summary: string
          updated_at?: string
          version?: number
        }
        Update: {
          restricted?: boolean
          summary?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      persons: {
        Row: {
          birth_date: string | null
          birth_date_precision: Database["public"]["Enums"]["date_precision"] | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          display_name: string
          contact_phone: string | null
          email: string | null
          id: string
          is_minor: boolean
          is_sample: boolean
          organization_id: string
          sample_label: string | null
          updated_at: string
          user_id: string | null
          version: number
        }
        Insert: {
          birth_date?: string | null
          birth_date_precision?: Database["public"]["Enums"]["date_precision"] | null
          created_at?: string
          created_by?: string | null
          contact_phone?: string | null
          date_of_birth?: string | null
          display_name: string
          email?: string | null
          id?: string
          is_minor?: boolean
          is_sample?: boolean
          organization_id: string
          sample_label?: string | null
          updated_at?: string
          user_id?: string | null
          version?: number
        }
        Update: {
          birth_date?: string | null
          birth_date_precision?: Database["public"]["Enums"]["date_precision"] | null
          created_at?: string
          created_by?: string | null
          contact_phone?: string | null
          date_of_birth?: string | null
          display_name?: string
          email?: string | null
          id?: string
          is_minor?: boolean
          is_sample?: boolean
          organization_id?: string
          sample_label?: string | null
          updated_at?: string
          user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "persons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          created_by: string | null
          note: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          note?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          note?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      portal_invitations: {
        Row: {
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
          created_by: string | null
          declined_at: string | null
          draft: Json
          email: string
          email_enqueued_at: string | null
          expires_at: string
          guardian_subject_ids: string[]
          id: string
          matter_id: string
          membership_id: string | null
          opened_at: string | null
          organization_id: string
          person_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["org_role"]
          updated_at: string
          version: number
        }
        Insert: {
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string | null
          declined_at?: string | null
          draft?: Json
          email: string
          email_enqueued_at?: string | null
          expires_at: string
          guardian_subject_ids?: string[]
          id?: string
          matter_id: string
          membership_id?: string | null
          opened_at?: string | null
          organization_id: string
          person_id: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          version?: number
        }
        Update: {
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string | null
          declined_at?: string | null
          draft?: Json
          email?: string
          email_enqueued_at?: string | null
          expires_at?: string
          guardian_subject_ids?: string[]
          id?: string
          matter_id?: string
          membership_id?: string | null
          opened_at?: string | null
          organization_id?: string
          person_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      portal_invite_attempts: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          organization_id: string | null
          token_hash: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string | null
          token_hash?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string | null
          token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_invite_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_policy_documents: {
        Row: {
          body: string
          body_sha256: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          organization_id: string
          published_at: string
          title: string
          updated_at: string
          version: number
          version_label: string
        }
        Insert: {
          body: string
          body_sha256: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          organization_id: string
          published_at?: string
          title: string
          updated_at?: string
          version?: number
          version_label: string
        }
        Update: {
          body?: string
          body_sha256?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          organization_id?: string
          published_at?: string
          title?: string
          updated_at?: string
          version?: number
          version_label?: string
        }
        Relationships: []
      }
      privacy_request_redactions: {
        Row: {
          created_at: string
          created_by: string | null
          done_at: string | null
          done_by: string | null
          id: string
          item_id: string | null
          organization_id: string
          record_label: string
          removed: string
          request_id: string
          state: Database["public"]["Enums"]["privacy_redaction_state"]
          third_party: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          id?: string
          item_id?: string | null
          organization_id: string
          record_label: string
          removed: string
          request_id: string
          state?: Database["public"]["Enums"]["privacy_redaction_state"]
          third_party: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          done_by?: string | null
          id?: string
          item_id?: string | null
          organization_id?: string
          record_label?: string
          removed?: string
          request_id?: string
          state?: Database["public"]["Enums"]["privacy_redaction_state"]
          third_party?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      privacy_requests: {
        Row: {
          assignee_membership_id: string
          channel: Database["public"]["Enums"]["compliance_channel"]
          closed_at: string | null
          closed_by: string | null
          consent_record_id: string | null
          created_at: string
          created_by: string | null
          delivery_method: string | null
          details: string
          due_on: string | null
          evidence_note: string | null
          extended_at: string | null
          extended_by: string | null
          extended_due_on: string | null
          extension_basis: string | null
          extension_notice_channel: string | null
          extension_notice_late: boolean | null
          extension_notice_method: string | null
          extension_notice_seen_at: string | null
          extension_reason: string | null
          extension_recourse: string | null
          extension_time_limit_id: string | null
          id: string
          identity_method: string | null
          identity_verified_at: string | null
          identity_verified_by: string | null
          idempotency_key: string
          is_sample: boolean
          kept_records: Json | null
          kind: Database["public"]["Enums"]["privacy_request_kind"]
          matter_id: string | null
          number: number
          organization_id: string
          outcome: Database["public"]["Enums"]["privacy_request_outcome"] | null
          outcome_note: string | null
          person_id: string | null
          received_on: string
          redaction_at: string | null
          redaction_by: string | null
          redaction_note: string | null
          reference: string
          refusal_reason: string | null
          requester_name: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scope_at: string | null
          scope_by: string | null
          scope_note: string | null
          target_days: number | null
          updated_at: string
          version: number
        }
        Insert: {
          assignee_membership_id: string
          channel: Database["public"]["Enums"]["compliance_channel"]
          closed_at?: string | null
          closed_by?: string | null
          consent_record_id?: string | null
          created_at?: string
          created_by?: string | null
          delivery_method?: string | null
          details: string
          due_on?: string | null
          evidence_note?: string | null
          extended_at?: string | null
          extended_by?: string | null
          extended_due_on?: string | null
          extension_basis?: string | null
          extension_notice_channel?: string | null
          extension_notice_late?: boolean | null
          extension_notice_method?: string | null
          extension_notice_seen_at?: string | null
          extension_reason?: string | null
          extension_recourse?: string | null
          extension_time_limit_id?: string | null
          id?: string
          identity_method?: string | null
          identity_verified_at?: string | null
          identity_verified_by?: string | null
          idempotency_key: string
          is_sample?: boolean
          kept_records?: Json | null
          kind: Database["public"]["Enums"]["privacy_request_kind"]
          matter_id?: string | null
          number: number
          organization_id: string
          outcome?: Database["public"]["Enums"]["privacy_request_outcome"] | null
          outcome_note?: string | null
          person_id?: string | null
          received_on: string
          redaction_at?: string | null
          redaction_by?: string | null
          redaction_note?: string | null
          reference: string
          refusal_reason?: string | null
          requester_name: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope_at?: string | null
          scope_by?: string | null
          scope_note?: string | null
          target_days?: number | null
          updated_at?: string
          version?: number
        }
        Update: {
          assignee_membership_id?: string
          channel?: Database["public"]["Enums"]["compliance_channel"]
          closed_at?: string | null
          closed_by?: string | null
          consent_record_id?: string | null
          created_at?: string
          created_by?: string | null
          delivery_method?: string | null
          details?: string
          due_on?: string | null
          evidence_note?: string | null
          extended_at?: string | null
          extended_by?: string | null
          extended_due_on?: string | null
          extension_basis?: string | null
          extension_notice_channel?: string | null
          extension_notice_late?: boolean | null
          extension_notice_method?: string | null
          extension_notice_seen_at?: string | null
          extension_reason?: string | null
          extension_recourse?: string | null
          extension_time_limit_id?: string | null
          id?: string
          identity_method?: string | null
          identity_verified_at?: string | null
          identity_verified_by?: string | null
          idempotency_key?: string
          is_sample?: boolean
          kept_records?: Json | null
          kind?: Database["public"]["Enums"]["privacy_request_kind"]
          matter_id?: string | null
          number?: number
          organization_id?: string
          outcome?: Database["public"]["Enums"]["privacy_request_outcome"] | null
          outcome_note?: string | null
          person_id?: string | null
          received_on?: string
          redaction_at?: string | null
          redaction_by?: string | null
          redaction_note?: string | null
          reference?: string
          refusal_reason?: string | null
          requester_name?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope_at?: string | null
          scope_by?: string | null
          scope_note?: string | null
          target_days?: number | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      privacy_request_deliveries: {
        Row: {
          created_at: string
          created_by: string | null
          delivered_at: string
          delivered_by: string
          download_count: number
          expires_at: string
          first_downloaded_at: string | null
          id: string
          last_downloaded_at: string | null
          organization_id: string
          person_id: string
          request_id: string
          response_id: string
          sha256: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivered_at?: string
          delivered_by: string
          download_count?: number
          expires_at: string
          first_downloaded_at?: string | null
          id?: string
          last_downloaded_at?: string | null
          organization_id: string
          person_id: string
          request_id: string
          response_id: string
          sha256: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivered_at?: string
          delivered_by?: string
          download_count?: number
          expires_at?: string
          first_downloaded_at?: string | null
          id?: string
          last_downloaded_at?: string | null
          organization_id?: string
          person_id?: string
          request_id?: string
          response_id?: string
          sha256?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      privacy_request_items: {
        Row: {
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision: string
          fields: string[]
          id: string
          label: string
          matter_id: string | null
          organization_id: string
          reason: string | null
          request_id: string
          source: string
          source_id: string
          third_party: string | null
          updated_at: string
          version: number
          withheld_fields: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          fields?: string[]
          id?: string
          label: string
          matter_id?: string | null
          organization_id: string
          reason?: string | null
          request_id: string
          source: string
          source_id: string
          third_party?: string | null
          updated_at?: string
          version?: number
          withheld_fields?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          fields?: string[]
          id?: string
          label?: string
          matter_id?: string | null
          organization_id?: string
          reason?: string | null
          request_id?: string
          source?: string
          source_id?: string
          third_party?: string | null
          updated_at?: string
          version?: number
          withheld_fields?: string[]
        }
        Relationships: []
      }
      privacy_request_responses: {
        Row: {
          byte_size: number | null
          contents: Json | null
          created_at: string
          created_by: string | null
          excluded: Json | null
          failed_reason: string | null
          file_count: number | null
          id: string
          idempotency_key: string
          manifest_sha256: string | null
          organization_id: string
          ready_at: string | null
          record_count: number | null
          request_id: string
          requested_at: string
          requested_by: string
          sha256: string | null
          status: string
          storage_bucket: string | null
          storage_key: string | null
          updated_at: string
          version: number
          withheld_count: number | null
        }
        Insert: {
          byte_size?: number | null
          contents?: Json | null
          created_at?: string
          created_by?: string | null
          excluded?: Json | null
          failed_reason?: string | null
          file_count?: number | null
          id?: string
          idempotency_key: string
          manifest_sha256?: string | null
          organization_id: string
          ready_at?: string | null
          record_count?: number | null
          request_id: string
          requested_at?: string
          requested_by: string
          sha256?: string | null
          status?: string
          storage_bucket?: string | null
          storage_key?: string | null
          updated_at?: string
          version?: number
          withheld_count?: number | null
        }
        Update: {
          byte_size?: number | null
          contents?: Json | null
          created_at?: string
          created_by?: string | null
          excluded?: Json | null
          failed_reason?: string | null
          file_count?: number | null
          id?: string
          idempotency_key?: string
          manifest_sha256?: string | null
          organization_id?: string
          ready_at?: string | null
          record_count?: number | null
          request_id?: string
          requested_at?: string
          requested_by?: string
          sha256?: string | null
          status?: string
          storage_bucket?: string | null
          storage_key?: string | null
          updated_at?: string
          version?: number
          withheld_count?: number | null
        }
        Relationships: []
      }
      privacy_response_downloads: {
        Row: {
          created_at: string
          delivery_id: string
          downloaded_at: string
          id: string
          organization_id: string
          sha256: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delivery_id: string
          downloaded_at?: string
          id?: string
          organization_id: string
          sha256: string
          user_id: string
        }
        Update: {
          created_at?: string
          delivery_id?: string
          downloaded_at?: string
          id?: string
          organization_id?: string
          sha256?: string
          user_id?: string
        }
        Relationships: []
      }
      privacy_time_limits: {
        Row: {
          checked_on: string
          created_at: string
          created_by: string | null
          current_to: string | null
          days: number | null
          id: string
          kind: string
          law_name: string
          organization_id: string
          page_attested_at: string | null
          page_attested_by_membership_id: string | null
          page_attested_on: string | null
          provision_text: string
          retired_at: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by_membership_id: string | null
          snapshot_id: string | null
          snapshot_sha256: string | null
          source_id: string
          source_section: string
          source_url: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          checked_on: string
          created_at?: string
          created_by?: string | null
          current_to?: string | null
          days?: number | null
          id?: string
          kind: string
          law_name: string
          organization_id: string
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          provision_text: string
          retired_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          snapshot_id?: string | null
          snapshot_sha256?: string | null
          source_id: string
          source_section: string
          source_url: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          checked_on?: string
          created_at?: string
          created_by?: string | null
          current_to?: string | null
          days?: number | null
          id?: string
          kind?: string
          law_name?: string
          organization_id?: string
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          provision_text?: string
          retired_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          snapshot_id?: string | null
          snapshot_sha256?: string | null
          source_id?: string
          source_section?: string
          source_url?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      product_settings: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          key: string
          pending_confirmation: boolean
          updated_at: string
          value: Json
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description: string
          key: string
          pending_confirmation?: boolean
          updated_at?: string
          value: Json
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          key?: string
          pending_confirmation?: boolean
          updated_at?: string
          value?: Json
          version?: number
        }
        Relationships: []
      }
      professional_reviews: {
        Row: {
          created_at: string
          created_by: string | null
          decided_at: string
          decision: Database["public"]["Enums"]["review_decision"]
          id: string
          organization_id: string
          rationale: string | null
          reviewer_credential_snapshot: Json | null
          reviewer_membership_id: string
          rule_content_revision: number
          rule_version_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          decided_at: string
          decision: Database["public"]["Enums"]["review_decision"]
          id?: string
          organization_id: string
          rationale?: string | null
          reviewer_credential_snapshot?: Json | null
          reviewer_membership_id: string
          rule_content_revision: number
          rule_version_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          decided_at?: string
          decision?: Database["public"]["Enums"]["review_decision"]
          id?: string
          organization_id?: string
          rationale?: string | null
          reviewer_credential_snapshot?: Json | null
          reviewer_membership_id?: string
          rule_content_revision?: number
          rule_version_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "professional_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_reviews_reviewer_membership_id_organization_i_fkey"
            columns: ["reviewer_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "professional_reviews_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          created_by: string | null
          display_name: string | null
          id: string
          preferred_locale: string
          timezone: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          id: string
          preferred_locale?: string
          timezone?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          id?: string
          preferred_locale?: string
          timezone?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      quote_instalments: {
        Row: {
          agreement_version_id: string
          amount_cents: number
          created_at: string
          id: string
          is_sample: boolean
          label: string
          organization_id: string
          paid_as: Database["public"]["Enums"]["quote_paid_as"]
          position: number
        }
        Insert: {
          agreement_version_id: string
          amount_cents: number
          created_at?: string
          id?: string
          is_sample?: boolean
          label: string
          organization_id: string
          paid_as: Database["public"]["Enums"]["quote_paid_as"]
          position: number
        }
        Update: {
          agreement_version_id?: string
          amount_cents?: number
          created_at?: string
          id?: string
          is_sample?: boolean
          label?: string
          organization_id?: string
          paid_as?: Database["public"]["Enums"]["quote_paid_as"]
          position?: number
        }
        Relationships: []
      }
      quote_lines: {
        Row: {
          agreement_version_id: string
          amount_cents: number
          category: Database["public"]["Enums"]["quote_line_category"]
          created_at: string
          description: string
          entered_by: string | null
          entered_on: string | null
          id: string
          is_sample: boolean
          organization_id: string
          position: number
          source_note: string | null
          tax_rate_bps: number | null
        }
        Insert: {
          agreement_version_id: string
          amount_cents: number
          category: Database["public"]["Enums"]["quote_line_category"]
          created_at?: string
          description: string
          entered_by?: string | null
          entered_on?: string | null
          id?: string
          is_sample?: boolean
          organization_id: string
          position: number
          source_note?: string | null
          tax_rate_bps?: number | null
        }
        Update: {
          agreement_version_id?: string
          amount_cents?: number
          category?: Database["public"]["Enums"]["quote_line_category"]
          created_at?: string
          description?: string
          entered_by?: string | null
          entered_on?: string | null
          id?: string
          is_sample?: boolean
          organization_id?: string
          position?: number
          source_note?: string | null
          tax_rate_bps?: number | null
        }
        Relationships: []
      }
      reminder_schedules: {
        Row: {
          created_at: string
          deadline_id: string | null
          id: string
          idempotency_key: string
          offset_days: number | null
          organization_id: string
          reminder_kind: string
          scheduled_for: string
          sent_at: string | null
          status: Database["public"]["Enums"]["reminder_status"]
          task_id: string | null
        }
        Insert: {
          created_at?: string
          deadline_id?: string | null
          id?: string
          idempotency_key: string
          offset_days?: number | null
          organization_id: string
          reminder_kind: string
          scheduled_for: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          task_id?: string | null
        }
        Update: {
          created_at?: string
          deadline_id?: string | null
          id?: string
          idempotency_key?: string
          offset_days?: number | null
          organization_id?: string
          reminder_kind?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reminder_status"]
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_schedules_deadline_id_organization_id_fkey"
            columns: ["deadline_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "deadlines"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "reminder_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_schedules_task_id_organization_id_fkey"
            columns: ["task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      representation_authorities: {
        Row: {
          agreement_id: string | null
          created_at: string
          created_by: string | null
          effective_on: string
          evidence_locator: string
          id: string
          matter_id: string
          organization_id: string
          person_id: string
          revoked_at: string | null
          revocation_reason: string | null
          scope: string
          updated_at: string
          version: number
        }
        Insert: {
          agreement_id?: string | null
          created_at?: string
          created_by?: string | null
          effective_on: string
          evidence_locator: string
          id?: string
          matter_id: string
          organization_id: string
          person_id: string
          revoked_at?: string | null
          revocation_reason?: string | null
          scope: string
          updated_at?: string
          version?: number
        }
        Update: {
          agreement_id?: string | null
          created_at?: string
          created_by?: string | null
          effective_on?: string
          evidence_locator?: string
          id?: string
          matter_id?: string
          organization_id?: string
          person_id?: string
          revoked_at?: string | null
          revocation_reason?: string | null
          scope?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      retention_policy_versions: {
        Row: {
          approved_at: string
          approved_by: string
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          period_count: number
          source: string
          unit: string
          version: number
        }
        Insert: {
          approved_at: string
          approved_by: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          period_count: number
          source: string
          unit?: string
          version: number
        }
        Update: {
          approved_at?: string
          approved_by?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          period_count?: number
          source?: string
          unit?: string
          version?: number
        }
        Relationships: []
      }
      rule_definitions: {
        Row: {
          applicant_context: string | null
          category: Database["public"]["Enums"]["rule_category"]
          created_at: string
          created_by: string | null
          has_published_version: boolean
          id: string
          jurisdiction: string
          organization_id: string | null
          owner_label: string | null
          program_key: string | null
          required_facts: string[]
          stable_key: string
          updated_at: string
          version: number
        }
        Insert: {
          applicant_context?: string | null
          category: Database["public"]["Enums"]["rule_category"]
          created_at?: string
          created_by?: string | null
          has_published_version?: boolean
          id?: string
          jurisdiction: string
          organization_id?: string | null
          owner_label?: string | null
          program_key?: string | null
          required_facts?: string[]
          stable_key: string
          updated_at?: string
          version?: number
        }
        Update: {
          applicant_context?: string | null
          category?: Database["public"]["Enums"]["rule_category"]
          created_at?: string
          created_by?: string | null
          has_published_version?: boolean
          id?: string
          jurisdiction?: string
          organization_id?: string | null
          owner_label?: string | null
          program_key?: string | null
          required_facts?: string[]
          stable_key?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "rule_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_evidence: {
        Row: {
          checked_on: string | null
          current_to: string | null
          form_modified_on: string | null
          form_number: string | null
          last_amended_on: string | null
          modified_on: string | null
          page_attested_at: string | null
          page_attested_by_membership_id: string | null
          page_attested_on: string | null
          published_on: string | null
          source_url: string | null
          created_at: string
          created_by: string | null
          evidence_excerpt: string | null
          id: string
          interpretation_notes: string | null
          locator: string | null
          organization_id: string | null
          rule_version_id: string
          snapshot_id: string | null
          source_language: string | null
          source_section: string | null
          updated_at: string
          version: number
        }
        Insert: {
          checked_on?: string | null
          current_to?: string | null
          form_modified_on?: string | null
          form_number?: string | null
          last_amended_on?: string | null
          modified_on?: string | null
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          published_on?: string | null
          source_url?: string | null
          created_at?: string
          created_by?: string | null
          evidence_excerpt?: string | null
          id?: string
          interpretation_notes?: string | null
          locator?: string | null
          organization_id?: string | null
          rule_version_id: string
          snapshot_id?: string | null
          source_language?: string | null
          source_section?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          checked_on?: string | null
          current_to?: string | null
          form_modified_on?: string | null
          form_number?: string | null
          last_amended_on?: string | null
          modified_on?: string | null
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          published_on?: string | null
          source_url?: string | null
          created_at?: string
          created_by?: string | null
          evidence_excerpt?: string | null
          id?: string
          interpretation_notes?: string | null
          locator?: string | null
          organization_id?: string | null
          rule_version_id?: string
          snapshot_id?: string | null
          source_language?: string | null
          source_section?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "rule_evidence_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_evidence_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_impacts: {
        Row: {
          created_at: string
          created_by: string | null
          disposition: Database["public"]["Enums"]["rule_impact_disposition"]
          id: string
          matter_id: string | null
          organization_id: string
          owner_membership_id: string | null
          reason: string
          rule_version_id: string | null
          snapshot_id: string | null
          source_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          disposition?: Database["public"]["Enums"]["rule_impact_disposition"]
          id?: string
          matter_id?: string | null
          organization_id: string
          owner_membership_id?: string | null
          reason: string
          rule_version_id?: string | null
          snapshot_id?: string | null
          source_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          disposition?: Database["public"]["Enums"]["rule_impact_disposition"]
          id?: string
          matter_id?: string | null
          organization_id?: string
          owner_membership_id?: string | null
          reason?: string
          rule_version_id?: string | null
          snapshot_id?: string | null
          source_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "rule_impacts_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "rule_impacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_impacts_owner_membership_id_organization_id_fkey"
            columns: ["owner_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "rule_impacts_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_impacts_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_impacts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "official_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_pack_items: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string | null
          pack_id: string
          rule_version_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string | null
          pack_id: string
          rule_version_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string | null
          pack_id?: string
          rule_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rule_pack_items_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "rule_pack_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_pack_items_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_pack_versions: {
        Row: {
          content_frozen: boolean
          created_at: string
          created_by: string | null
          form_mappings: Json | null
          id: string
          jurisdiction: string
          next_review_at: string | null
          organization_id: string | null
          pack_version: number
          program_key: string
          release_notes: string | null
          signature_policy: string | null
          status: Database["public"]["Enums"]["rule_publication_status"]
          updated_at: string
          version: number
        }
        Insert: {
          content_frozen?: boolean
          created_at?: string
          created_by?: string | null
          form_mappings?: Json | null
          id?: string
          jurisdiction: string
          next_review_at?: string | null
          organization_id?: string | null
          pack_version: number
          program_key: string
          release_notes?: string | null
          signature_policy?: string | null
          status?: Database["public"]["Enums"]["rule_publication_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          content_frozen?: boolean
          created_at?: string
          created_by?: string | null
          form_mappings?: Json | null
          id?: string
          jurisdiction?: string
          next_review_at?: string | null
          organization_id?: string | null
          pack_version?: number
          program_key?: string
          release_notes?: string | null
          signature_policy?: string | null
          status?: Database["public"]["Enums"]["rule_publication_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "rule_pack_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rule_versions: {
        Row: {
          applicability: Json | null
          applicability_established: boolean
          applicability_note: string | null
          claim: string | null
          content_frozen: boolean
          content_revision: number
          created_at: string
          created_by: string | null
          definition_id: string
          effective_from: string | null
          effective_to: string | null
          exceptions: Json | null
          id: string
          next_review_at: string | null
          organization_id: string | null
          output_value: Json | null
          status: Database["public"]["Enums"]["rule_publication_status"]
          status_changed_at: string | null
          status_changed_by_membership_id: string | null
          status_reason: string | null
          structured_condition: Json | null
          supersedes_version_id: string | null
          test_case_ids: string[]
          updated_at: string
          version: number
          version_number: number
        }
        Insert: {
          applicability?: Json | null
          applicability_established?: boolean
          applicability_note?: string | null
          claim?: string | null
          content_frozen?: boolean
          content_revision?: number
          created_at?: string
          created_by?: string | null
          definition_id: string
          effective_from?: string | null
          effective_to?: string | null
          exceptions?: Json | null
          id?: string
          next_review_at?: string | null
          organization_id?: string | null
          output_value?: Json | null
          status?: Database["public"]["Enums"]["rule_publication_status"]
          status_changed_at?: string | null
          status_changed_by_membership_id?: string | null
          status_reason?: string | null
          structured_condition?: Json | null
          supersedes_version_id?: string | null
          test_case_ids?: string[]
          updated_at?: string
          version?: number
          version_number: number
        }
        Update: {
          applicability?: Json | null
          applicability_established?: boolean
          applicability_note?: string | null
          claim?: string | null
          content_frozen?: boolean
          content_revision?: number
          created_at?: string
          created_by?: string | null
          definition_id?: string
          effective_from?: string | null
          effective_to?: string | null
          exceptions?: Json | null
          id?: string
          next_review_at?: string | null
          organization_id?: string | null
          output_value?: Json | null
          status?: Database["public"]["Enums"]["rule_publication_status"]
          status_changed_at?: string | null
          status_changed_by_membership_id?: string | null
          status_reason?: string | null
          structured_condition?: Json | null
          supersedes_version_id?: string | null
          test_case_ids?: string[]
          updated_at?: string
          version?: number
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "rule_versions_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "rule_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rule_versions_supersedes_version_id_fkey"
            columns: ["supersedes_version_id"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      sample_proof_steps: {
        Row: {
          completed_at: string
          completed_by: string
          organization_id: string
          sample_matter_id: string
          step: Database["public"]["Enums"]["sample_proof_step"]
        }
        Insert: {
          completed_at?: string
          completed_by: string
          organization_id: string
          sample_matter_id: string
          step: Database["public"]["Enums"]["sample_proof_step"]
        }
        Update: {
          completed_at?: string
          completed_by?: string
          organization_id?: string
          sample_matter_id?: string
          step?: Database["public"]["Enums"]["sample_proof_step"]
        }
        Relationships: [
          {
            foreignKeyName: "sample_proof_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sample_proof_steps_sample_matter_id_organization_id_fkey"
            columns: ["sample_matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      section_shares: {
        Row: {
          consent_record_id: string | null
          created_at: string
          grantee_person_id: string
          id: string
          matter_id: string
          organization_id: string
          revoked_at: string | null
          section_key: Database["public"]["Enums"]["person_section_key"]
          subject_person_id: string
        }
        Insert: {
          consent_record_id?: string | null
          created_at?: string
          grantee_person_id: string
          id?: string
          matter_id: string
          organization_id: string
          revoked_at?: string | null
          section_key: Database["public"]["Enums"]["person_section_key"]
          subject_person_id: string
        }
        Update: {
          revoked_at?: string | null
        }
        Relationships: []
      }
      service_notice_dismissals: {
        Row: {
          dismissed_at: string
          notice_id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          notice_id: string
          organization_id: string
          user_id: string
        }
        Update: {
          dismissed_at?: string
          notice_id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: []
      }
      service_notice_targets: {
        Row: {
          created_at: string
          notice_id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          notice_id: string
          organization_id: string
        }
        Update: {
          created_at?: string
          notice_id?: string
          organization_id?: string
        }
        Relationships: []
      }
      service_notices: {
        Row: {
          audience: string
          body: string
          created_at: string
          created_by: string
          ends_at: string | null
          id: string
          kind: string
          published_at: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          starts_at: string
          status: string
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          audience: string
          body: string
          created_at?: string
          created_by: string
          ends_at?: string | null
          id?: string
          kind: string
          published_at?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          starts_at?: string
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          audience?: string
          body?: string
          created_at?: string
          created_by?: string
          ends_at?: string | null
          id?: string
          kind?: string
          published_at?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          starts_at?: string
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      session_revocations: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          reason: string | null
          revoked_by: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          reason?: string | null
          revoked_by: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          reason?: string | null
          revoked_by?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_revocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_envelopes: {
        Row: {
          agreement_id: string
          certificate_document_version_id: string | null
          certificate_pdf: string | null
          certificate_sha256: string | null
          certificate_storage_key: string | null
          completed_at: string | null
          content_sha256: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          idempotency_key: string
          organization_id: string
          provider: string
          sealed_document_version_id: string | null
          sealed_pdf: string | null
          sealed_renderer: string | null
          sealed_sha256: string | null
          sealed_storage_key: string | null
          sent_at: string
          status: Database["public"]["Enums"]["agreement_status"]
          updated_at: string
          version: number
          version_id: string
          voided_at: string | null
        }
        Insert: {
          agreement_id: string
          certificate_document_version_id?: string | null
          certificate_pdf?: string | null
          certificate_sha256?: string | null
          certificate_storage_key?: string | null
          completed_at?: string | null
          content_sha256: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          idempotency_key: string
          organization_id: string
          provider?: string
          sealed_document_version_id?: string | null
          sealed_pdf?: string | null
          sealed_renderer?: string | null
          sealed_sha256?: string | null
          sealed_storage_key?: string | null
          sent_at?: string
          status?: Database["public"]["Enums"]["agreement_status"]
          updated_at?: string
          version?: number
          version_id: string
          voided_at?: string | null
        }
        Update: {
          agreement_id?: string
          certificate_document_version_id?: string | null
          certificate_pdf?: string | null
          certificate_sha256?: string | null
          certificate_storage_key?: string | null
          completed_at?: string | null
          content_sha256?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          provider?: string
          sealed_document_version_id?: string | null
          sealed_pdf?: string | null
          sealed_renderer?: string | null
          sealed_sha256?: string | null
          sealed_storage_key?: string | null
          sent_at?: string
          status?: Database["public"]["Enums"]["agreement_status"]
          updated_at?: string
          version?: number
          version_id?: string
          voided_at?: string | null
        }
        Relationships: []
      }
      signature_events: {
        Row: {
          actor_user_id: string | null
          consent_accepted: boolean | null
          consent_version: string | null
          content_sha256: string | null
          created_at: string
          envelope_id: string
          id: string
          idempotency_key: string
          ip: string | null
          kind: Database["public"]["Enums"]["signature_event_kind"]
          occurred_at: string
          organization_id: string
          provider: string
          signer_id: string | null
          summary: Json
          user_agent: string | null
        }
        Insert: {
          actor_user_id?: string | null
          consent_accepted?: boolean | null
          consent_version?: string | null
          content_sha256?: string | null
          created_at?: string
          envelope_id: string
          id?: string
          idempotency_key: string
          ip?: string | null
          kind: Database["public"]["Enums"]["signature_event_kind"]
          occurred_at?: string
          organization_id: string
          provider?: string
          signer_id?: string | null
          summary?: Json
          user_agent?: string | null
        }
        Update: {
          actor_user_id?: string | null
          consent_accepted?: boolean | null
          consent_version?: string | null
          content_sha256?: string | null
          created_at?: string
          envelope_id?: string
          id?: string
          idempotency_key?: string
          ip?: string | null
          kind?: Database["public"]["Enums"]["signature_event_kind"]
          occurred_at?: string
          organization_id?: string
          provider?: string
          signer_id?: string | null
          summary?: Json
          user_agent?: string | null
        }
        Relationships: []
      }
      source_check_attempts: {
        Row: {
          attempted_at: string
          change_signal: boolean
          created_at: string
          created_by: string | null
          error_code: string | null
          error_detail: string | null
          http_status: number | null
          id: string
          next_retry_at: string | null
          organization_id: string | null
          result: Database["public"]["Enums"]["source_observation"]
          snapshot_id: string | null
          source_id: string
        }
        Insert: {
          attempted_at: string
          change_signal?: boolean
          created_at?: string
          created_by?: string | null
          error_code?: string | null
          error_detail?: string | null
          http_status?: number | null
          id?: string
          next_retry_at?: string | null
          organization_id?: string | null
          result: Database["public"]["Enums"]["source_observation"]
          snapshot_id?: string | null
          source_id: string
        }
        Update: {
          attempted_at?: string
          change_signal?: boolean
          created_at?: string
          created_by?: string | null
          error_code?: string | null
          error_detail?: string | null
          http_status?: number | null
          id?: string
          next_retry_at?: string | null
          organization_id?: string | null
          result?: Database["public"]["Enums"]["source_observation"]
          snapshot_id?: string | null
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_check_attempts_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_check_attempts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "official_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      source_dependencies: {
        Row: {
          created_at: string
          created_by: string | null
          expected_type: string | null
          id: string
          linked_snapshot_id: string | null
          linked_url: string
          observed_version: string | null
          organization_id: string | null
          parent_snapshot_id: string
          purpose: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expected_type?: string | null
          id?: string
          linked_snapshot_id?: string | null
          linked_url: string
          observed_version?: string | null
          organization_id?: string | null
          parent_snapshot_id: string
          purpose: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expected_type?: string | null
          id?: string
          linked_snapshot_id?: string | null
          linked_url?: string
          observed_version?: string | null
          organization_id?: string | null
          parent_snapshot_id?: string
          purpose?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "source_dependencies_linked_snapshot_id_fkey"
            columns: ["linked_snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_dependencies_parent_snapshot_id_fkey"
            columns: ["parent_snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      source_snapshots: {
        Row: {
          content_hash: string
          created_at: string
          created_by: string | null
          current_to: string | null
          evidence_storage_ref: string | null
          final_url: string
          http_status: number | null
          id: string
          modified_at: string | null
          modified_on: string | null
          organization_id: string | null
          published_at: string | null
          published_on: string | null
          publisher: string
          retrieval_result: Database["public"]["Enums"]["source_observation"]
          retrieved_at: string
          review_status: Database["public"]["Enums"]["snapshot_review_status"]
          snapshot_number: number
          source_id: string
          supersedes_snapshot_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          content_hash: string
          created_at?: string
          created_by?: string | null
          current_to?: string | null
          evidence_storage_ref?: string | null
          final_url: string
          http_status?: number | null
          id?: string
          modified_at?: string | null
          modified_on?: string | null
          organization_id?: string | null
          published_at?: string | null
          published_on?: string | null
          publisher: string
          retrieval_result: Database["public"]["Enums"]["source_observation"]
          retrieved_at: string
          review_status?: Database["public"]["Enums"]["snapshot_review_status"]
          snapshot_number: number
          source_id: string
          supersedes_snapshot_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          content_hash?: string
          created_at?: string
          created_by?: string | null
          current_to?: string | null
          evidence_storage_ref?: string | null
          final_url?: string
          http_status?: number | null
          id?: string
          modified_at?: string | null
          modified_on?: string | null
          organization_id?: string | null
          published_at?: string | null
          published_on?: string | null
          publisher?: string
          retrieval_result?: Database["public"]["Enums"]["source_observation"]
          retrieved_at?: string
          review_status?: Database["public"]["Enums"]["snapshot_review_status"]
          snapshot_number?: number
          source_id?: string
          supersedes_snapshot_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "source_snapshots_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "official_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_snapshots_supersedes_snapshot_id_fkey"
            columns: ["supersedes_snapshot_id"]
            isOneToOne: false
            referencedRelation: "source_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_notification_reads: {
        Row: {
          organization_id: string
          read_at: string
          source_id: string
          user_id: string
        }
        Insert: {
          organization_id: string
          read_at?: string
          source_id: string
          user_id: string
        }
        Update: {
          organization_id?: string
          read_at?: string
          source_id?: string
          user_id?: string
        }
        Relationships: []
      }
      staff_notification_preferences: {
        Row: {
          email: boolean
          kind: string
          membership_id: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          email: boolean
          kind: string
          membership_id: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          email?: boolean
          kind?: string
          membership_id?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      staff_session_activity: {
        Row: {
          created_at: string
          last_active_at: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_active_at?: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_active_at?: string
          session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      submission_checklist_events: {
        Row: {
          created_at: string
          created_by: string | null
          handoff_id: string
          id: string
          item_key: string
          kind: string
          matter_id: string
          membership_id: string
          note: string | null
          organization_id: string
          requirement_id: string | null
          ticked: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          handoff_id: string
          id?: string
          item_key: string
          kind: string
          matter_id: string
          membership_id: string
          note?: string | null
          organization_id: string
          requirement_id?: string | null
          ticked: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          handoff_id?: string
          id?: string
          item_key?: string
          kind?: string
          matter_id?: string
          membership_id?: string
          note?: string | null
          organization_id?: string
          requirement_id?: string | null
          ticked?: boolean
        }
        Relationships: []
      }
      submission_handoffs: {
        Row: {
          acknowledged_on: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          channel: Database["public"]["Enums"]["submission_channel"]
          created_at: string
          created_by: string | null
          external_reference: string | null
          id: string
          manifest_file_count: number | null
          manifest_pinned_at: string | null
          manifest_sha256: string | null
          matter_id: string
          organization_id: string
          package_label: string
          package_sha256: string | null
          receipt_locator: string | null
          receipt_version_id: string | null
          signed_off_at: string | null
          signoff_membership_id: string | null
          stage_evidence_id: string | null
          status: Database["public"]["Enums"]["submission_handoff_status"]
          submitted_at: string | null
          submitted_by_membership_id: string | null
          updated_at: string
          verified_at: string | null
          verified_by_membership_id: string | null
          version: number
        }
        Insert: {
          acknowledged_on?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          channel: Database["public"]["Enums"]["submission_channel"]
          created_at?: string
          created_by?: string | null
          external_reference?: string | null
          id?: string
          manifest_file_count?: number | null
          manifest_pinned_at?: string | null
          manifest_sha256?: string | null
          matter_id: string
          organization_id: string
          package_label: string
          package_sha256?: string | null
          receipt_locator?: string | null
          receipt_version_id?: string | null
          signed_off_at?: string | null
          signoff_membership_id?: string | null
          stage_evidence_id?: string | null
          status?: Database["public"]["Enums"]["submission_handoff_status"]
          submitted_at?: string | null
          submitted_by_membership_id?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by_membership_id?: string | null
          version?: number
        }
        Update: {
          acknowledged_on?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          channel?: Database["public"]["Enums"]["submission_channel"]
          created_at?: string
          created_by?: string | null
          external_reference?: string | null
          id?: string
          manifest_file_count?: number | null
          manifest_pinned_at?: string | null
          manifest_sha256?: string | null
          matter_id?: string
          organization_id?: string
          package_label?: string
          package_sha256?: string | null
          receipt_locator?: string | null
          receipt_version_id?: string | null
          signed_off_at?: string | null
          signoff_membership_id?: string | null
          stage_evidence_id?: string | null
          status?: Database["public"]["Enums"]["submission_handoff_status"]
          submitted_at?: string | null
          submitted_by_membership_id?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by_membership_id?: string | null
          version?: number
        }
        Relationships: []
      }
      submission_manifest_files: {
        Row: {
          byte_size: number | null
          created_at: string
          created_by: string | null
          document_id: string
          document_version_id: string
          file_name: string
          file_sha256: string | null
          handoff_id: string
          id: string
          organization_id: string
          position: number
          purpose: string
          review_state: string
        }
        Insert: {
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          document_id: string
          document_version_id: string
          file_name: string
          file_sha256?: string | null
          handoff_id: string
          id?: string
          organization_id: string
          position: number
          purpose: string
          review_state: string
        }
        Update: {
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          document_id?: string
          document_version_id?: string
          file_name?: string
          file_sha256?: string | null
          handoff_id?: string
          id?: string
          organization_id?: string
          position?: number
          purpose?: string
          review_state?: string
        }
        Relationships: []
      }
      submission_requirements: {
        Row: {
          channel: Database["public"]["Enums"]["submission_channel"]
          checked_on: string
          created_at: string
          created_by: string | null
          current_to: string | null
          form_modified_on: string | null
          form_number: string | null
          id: string
          kind: string
          label: string
          organization_id: string
          page_attested_at: string | null
          page_attested_by_membership_id: string | null
          page_attested_on: string | null
          program_key: string | null
          retired_at: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by_membership_id: string | null
          snapshot_id: string | null
          snapshot_sha256: string | null
          source_id: string
          source_section: string | null
          source_url: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          channel: Database["public"]["Enums"]["submission_channel"]
          checked_on: string
          created_at?: string
          created_by?: string | null
          current_to?: string | null
          form_modified_on?: string | null
          form_number?: string | null
          id?: string
          kind: string
          label: string
          organization_id: string
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          program_key?: string | null
          retired_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          snapshot_id?: string | null
          snapshot_sha256?: string | null
          source_id: string
          source_section?: string | null
          source_url: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          channel?: Database["public"]["Enums"]["submission_channel"]
          checked_on?: string
          created_at?: string
          created_by?: string | null
          current_to?: string | null
          form_modified_on?: string | null
          form_number?: string | null
          id?: string
          kind?: string
          label?: string
          organization_id?: string
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          program_key?: string | null
          retired_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          snapshot_id?: string | null
          snapshot_sha256?: string | null
          source_id?: string
          source_section?: string | null
          source_url?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      // DEC-02 approval follow-up (20261025200000_dec_approval_follow_up.sql).
      approval_follow_up_steps: {
        Row: {
          checked_on: string
          created_at: string
          created_by: string | null
          current_to: string | null
          form_modified_on: string | null
          form_number: string | null
          id: string
          label: string
          organization_id: string
          page_attested_at: string | null
          page_attested_by_membership_id: string | null
          page_attested_on: string | null
          program_key: string
          retired_at: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by_membership_id: string | null
          snapshot_id: string | null
          snapshot_sha256: string | null
          source_id: string
          source_section: string | null
          source_url: string
          status: string
          timing_text: string | null
          updated_at: string
          version: number
        }
        Insert: {
          checked_on: string
          created_at?: string
          created_by?: string | null
          current_to?: string | null
          form_modified_on?: string | null
          form_number?: string | null
          id?: string
          label: string
          organization_id: string
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          program_key: string
          retired_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          snapshot_id?: string | null
          snapshot_sha256?: string | null
          source_id: string
          source_section?: string | null
          source_url: string
          status?: string
          timing_text?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          checked_on?: string
          created_at?: string
          created_by?: string | null
          current_to?: string | null
          form_modified_on?: string | null
          form_number?: string | null
          id?: string
          label?: string
          organization_id?: string
          page_attested_at?: string | null
          page_attested_by_membership_id?: string | null
          page_attested_on?: string | null
          program_key?: string
          retired_at?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by_membership_id?: string | null
          snapshot_id?: string | null
          snapshot_sha256?: string | null
          source_id?: string
          source_section?: string | null
          source_url?: string
          status?: string
          timing_text?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      approval_follow_up_events: {
        Row: {
          created_at: string
          created_by: string | null
          decision_id: string
          id: string
          matter_id: string
          membership_id: string
          organization_id: string
          step_id: string
          ticked: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          decision_id: string
          id?: string
          matter_id: string
          membership_id: string
          organization_id: string
          step_id: string
          ticked: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          decision_id?: string
          id?: string
          matter_id?: string
          membership_id?: string
          organization_id?: string
          step_id?: string
          ticked?: boolean
        }
        Relationships: []
      }
      conditions_summaries: {
        Row: {
          approved_at: string | null
          approved_by_membership_id: string | null
          body: string
          body_sha256: string | null
          created_at: string
          created_by: string | null
          decision_id: string
          drafted_by_membership_id: string
          id: string
          matter_id: string
          number: number | null
          organization_id: string
          status: string
          superseded_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by_membership_id?: string | null
          body: string
          body_sha256?: string | null
          created_at?: string
          created_by?: string | null
          decision_id: string
          drafted_by_membership_id: string
          id?: string
          matter_id: string
          number?: number | null
          organization_id: string
          status?: string
          superseded_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by_membership_id?: string | null
          body?: string
          body_sha256?: string | null
          created_at?: string
          created_by?: string | null
          decision_id?: string
          drafted_by_membership_id?: string
          id?: string
          matter_id?: string
          number?: number | null
          organization_id?: string
          status?: string
          superseded_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      decision_deliveries: {
        Row: {
          ack_evidence_note: string | null
          ack_evidence_version_id: string | null
          ack_recorded_by_membership_id: string | null
          acknowledged_at: string | null
          acknowledged_by_user_id: string | null
          acknowledged_on: string | null
          acknowledgement: string | null
          created_at: string
          created_by: string | null
          decision_id: string
          delivered_at: string
          delivered_by_membership_id: string
          document_label: string
          document_version_id: string
          id: string
          matter_id: string
          method: string
          note: string | null
          organization_id: string
          updated_at: string
          version: number
        }
        Insert: {
          ack_evidence_note?: string | null
          ack_evidence_version_id?: string | null
          ack_recorded_by_membership_id?: string | null
          acknowledged_at?: string | null
          acknowledged_by_user_id?: string | null
          acknowledged_on?: string | null
          acknowledgement?: string | null
          created_at?: string
          created_by?: string | null
          decision_id: string
          delivered_at: string
          delivered_by_membership_id: string
          document_label: string
          document_version_id: string
          id?: string
          matter_id: string
          method: string
          note?: string | null
          organization_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          ack_evidence_note?: string | null
          ack_evidence_version_id?: string | null
          ack_recorded_by_membership_id?: string | null
          acknowledged_at?: string | null
          acknowledged_by_user_id?: string | null
          acknowledged_on?: string | null
          acknowledgement?: string | null
          created_at?: string
          created_by?: string | null
          decision_id?: string
          delivered_at?: string
          delivered_by_membership_id?: string
          document_label?: string
          document_version_id?: string
          id?: string
          matter_id?: string
          method?: string
          note?: string | null
          organization_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      support_access_requests: {
        Row: {
          approved_at: string | null
          approved_by_membership_id: string | null
          created_at: string
          created_by: string | null
          decline_reason: string | null
          ended_at: string | null
          ended_by_user_id: string | null
          ends_at: string | null
          extension_count: number
          id: string
          matter_id: string | null
          not_included: string | null
          organization_id: string
          reason: string
          requested_by_email: string | null
          requested_by_name: string
          requested_by_user_id: string | null
          requested_minutes: number
          scope: Database["public"]["Enums"]["support_access_scope"]
          starts_at: string | null
          status: Database["public"]["Enums"]["support_access_status"]
          ticket_ref: string | null
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by_membership_id?: string | null
          created_at?: string
          created_by?: string | null
          decline_reason?: string | null
          ended_at?: string | null
          ended_by_user_id?: string | null
          ends_at?: string | null
          extension_count?: number
          id?: string
          matter_id?: string | null
          not_included?: string | null
          organization_id: string
          reason: string
          requested_by_email?: string | null
          requested_by_name: string
          requested_by_user_id?: string | null
          requested_minutes?: number
          scope: Database["public"]["Enums"]["support_access_scope"]
          starts_at?: string | null
          status?: Database["public"]["Enums"]["support_access_status"]
          ticket_ref?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by_membership_id?: string | null
          created_at?: string
          created_by?: string | null
          decline_reason?: string | null
          ended_at?: string | null
          ended_by_user_id?: string | null
          ends_at?: string | null
          extension_count?: number
          id?: string
          matter_id?: string | null
          not_included?: string | null
          organization_id?: string
          reason?: string
          requested_by_email?: string | null
          requested_by_name?: string
          requested_by_user_id?: string | null
          requested_minutes?: number
          scope?: Database["public"]["Enums"]["support_access_scope"]
          starts_at?: string | null
          status?: Database["public"]["Enums"]["support_access_status"]
          ticket_ref?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "support_access_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_access_requests_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "support_access_requests_approved_by_membership_id_organization_id_fkey"
            columns: ["approved_by_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      support_access_uses: {
        Row: {
          action: string
          actor_user_id: string | null
          id: string
          object_id: string | null
          object_table: string
          occurred_at: string
          organization_id: string
          request_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          id?: string
          object_id?: string | null
          object_table: string
          occurred_at?: string
          organization_id: string
          request_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          id?: string
          object_id?: string | null
          object_table?: string
          occurred_at?: string
          organization_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_access_uses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_access_uses_request_id_organization_id_fkey"
            columns: ["request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "support_access_requests"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      support_response_records: {
        Row: {
          created_at: string
          created_by: string | null
          first_response_at: string | null
          id: string
          organization_id: string
          received_at: string
          recorded_by_user_id: string
          ticket_ref: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          first_response_at?: string | null
          id?: string
          organization_id: string
          received_at: string
          recorded_by_user_id: string
          ticket_ref: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          first_response_at?: string | null
          id?: string
          organization_id?: string
          received_at?: string
          recorded_by_user_id?: string
          ticket_ref?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "support_response_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          created_by: string | null
          depends_on_task_id: string
          id: string
          organization_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          depends_on_task_id: string
          id?: string
          organization_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          depends_on_task_id?: string
          id?: string
          organization_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_organization_id_fkey"
            columns: ["depends_on_task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "task_dependencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_organization_id_fkey"
            columns: ["task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      task_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_kind: string
          from_membership_id: string | null
          from_status: Database["public"]["Enums"]["task_status"] | null
          id: string
          organization_id: string
          task_id: string
          to_membership_id: string | null
          to_status: Database["public"]["Enums"]["task_status"] | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_kind: string
          from_membership_id?: string | null
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: string
          organization_id: string
          task_id: string
          to_membership_id?: string | null
          to_status?: Database["public"]["Enums"]["task_status"] | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_kind?: string
          from_membership_id?: string | null
          from_status?: Database["public"]["Enums"]["task_status"] | null
          id?: string
          organization_id?: string
          task_id?: string
          to_membership_id?: string | null
          to_status?: Database["public"]["Enums"]["task_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "task_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_events_task_id_organization_id_fkey"
            columns: ["task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      task_watchers: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          membership_id: string
          organization_id: string
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id: string
          organization_id: string
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id?: string
          organization_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_watchers_membership_id_organization_id_fkey"
            columns: ["membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "task_watchers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_watchers_task_id_organization_id_fkey"
            columns: ["task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          occurred_at: string
          organization_id: string
          payload: Json
          stripe_event_id: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          occurred_at?: string
          organization_id: string
          payload?: Json
          stripe_event_id?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          occurred_at?: string
          organization_id?: string
          payload?: Json
          stripe_event_id?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "subscription_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_invoices: {
        Row: {
          amount_due_cents: number
          amount_paid_cents: number
          created_at: string
          created_by: string | null
          currency: string
          hosted_invoice_url: string | null
          id: string
          number: string | null
          organization_id: string
          pdf_url: string | null
          period_end: string | null
          period_start: string | null
          status: string
          stripe_created_at: string | null
          stripe_invoice_id: string
          updated_at: string
          version: number
        }
        Insert: {
          amount_due_cents: number
          amount_paid_cents?: number
          created_at?: string
          created_by?: string | null
          currency: string
          hosted_invoice_url?: string | null
          id?: string
          number?: string | null
          organization_id: string
          pdf_url?: string | null
          period_end?: string | null
          period_start?: string | null
          status: string
          stripe_created_at?: string | null
          stripe_invoice_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          amount_due_cents?: number
          amount_paid_cents?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          hosted_invoice_url?: string | null
          id?: string
          number?: string | null
          organization_id?: string
          pdf_url?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_created_at?: string | null
          stripe_invoice_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "subscription_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          audience: Database["public"]["Enums"]["task_audience"]
          blocker_note: string | null
          checklist: Json
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_at: string | null
          due_on: string | null
          due_timezone: string
          escalated_at: string | null
          estimated_minutes: number | null
          id: string
          intake_field_key: string | null
          intake_stale: boolean
          matter_id: string | null
          organization_id: string
          owner_membership_id: string | null
          owner_person_id: string | null
          person_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          recurrence: string | null
          recurrence_parent_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_key: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          audience: Database["public"]["Enums"]["task_audience"]
          blocker_note?: string | null
          checklist?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          due_on?: string | null
          due_timezone?: string
          escalated_at?: string | null
          estimated_minutes?: number | null
          id?: string
          intake_field_key?: string | null
          intake_stale?: boolean
          matter_id?: string | null
          organization_id: string
          owner_membership_id?: string | null
          owner_person_id?: string | null
          person_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence?: string | null
          recurrence_parent_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_key?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          audience?: Database["public"]["Enums"]["task_audience"]
          blocker_note?: string | null
          checklist?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          due_on?: string | null
          due_timezone?: string
          escalated_at?: string | null
          estimated_minutes?: number | null
          id?: string
          intake_field_key?: string | null
          intake_stale?: boolean
          matter_id?: string | null
          organization_id?: string
          owner_membership_id?: string | null
          owner_person_id?: string | null
          person_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence?: string | null
          recurrence_parent_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_key?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "tasks_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_owner_membership_id_organization_id_fkey"
            columns: ["owner_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "tasks_owner_person_id_organization_id_fkey"
            columns: ["owner_person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "tasks_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          approved_by: string
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          ended_by: string | null
          id: string
          name: string
          organization_id: string
          rate_percent: number
          source_note: string | null
          updated_at: string
          version: number
        }
        Insert: {
          approved_by: string
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          ended_by?: string | null
          id?: string
          name: string
          organization_id: string
          rate_percent: number
          source_note?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          approved_by?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          ended_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          rate_percent?: number
          source_note?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          billable: boolean
          created_at: string
          created_by: string | null
          description: string
          discarded_at: string | null
          discarded_by: string | null
          id: string
          is_sample: boolean
          matter_id: string
          membership_id: string
          minutes: number | null
          organization_id: string
          rate_cents: number
          started_at: string | null
          stopped_at: string | null
          updated_at: string
          version: number
          worked_on: string
        }
        Insert: {
          billable?: boolean
          created_at?: string
          created_by?: string | null
          description: string
          discarded_at?: string | null
          discarded_by?: string | null
          id?: string
          is_sample?: boolean
          matter_id: string
          membership_id: string
          minutes?: number | null
          organization_id: string
          rate_cents: number
          started_at?: string | null
          stopped_at?: string | null
          updated_at?: string
          version?: number
          worked_on: string
        }
        Update: {
          billable?: boolean
          created_at?: string
          created_by?: string | null
          description?: string
          discarded_at?: string | null
          discarded_by?: string | null
          id?: string
          is_sample?: boolean
          matter_id?: string
          membership_id?: string
          minutes?: number | null
          organization_id?: string
          rate_cents?: number
          started_at?: string | null
          stopped_at?: string | null
          updated_at?: string
          version?: number
          worked_on?: string
        }
        Relationships: []
      }
      translation_draft_requests: {
        Row: {
          char_count: number
          created_at: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          char_count: number
          created_at?: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          char_count?: number
          created_at?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: []
      }
      video_sessions: {
        Row: {
          booking_id: string
          created_at: string
          created_by: string | null
          ended_at: string | null
          ended_by_host_at: string | null
          id: string
          is_sample: boolean
          organization_id: string
          room_created_at: string | null
          room_name: string
          started_at: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          booking_id: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          ended_by_host_at?: string | null
          id?: string
          is_sample?: boolean
          organization_id: string
          room_created_at?: string | null
          room_name: string
          started_at?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          booking_id?: string
          created_at?: string
          created_by?: string | null
          ended_at?: string | null
          ended_by_host_at?: string | null
          id?: string
          is_sample?: boolean
          organization_id?: string
          room_created_at?: string | null
          room_name?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      vo_drafts: {
        Row: {
          body: string
          created_at: string
          created_by: string
          edited: boolean | null
          id: string
          is_sample: boolean
          kind: Database["public"]["Enums"]["vo_draft_kind"]
          matter_id: string
          model: string
          needs_rule: boolean
          organization_id: string
          prompt_version: string
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string
          sent_message_id: string | null
          sources: Json
          status: Database["public"]["Enums"]["vo_draft_status"]
          thread_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          edited?: boolean | null
          id?: string
          is_sample?: boolean
          kind: Database["public"]["Enums"]["vo_draft_kind"]
          matter_id: string
          model: string
          needs_rule?: boolean
          organization_id: string
          prompt_version: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id: string
          sent_message_id?: string | null
          sources: Json
          status?: Database["public"]["Enums"]["vo_draft_status"]
          thread_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          edited?: boolean | null
          id?: string
          is_sample?: boolean
          kind?: Database["public"]["Enums"]["vo_draft_kind"]
          matter_id?: string
          model?: string
          needs_rule?: boolean
          organization_id?: string
          prompt_version?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string
          sent_message_id?: string | null
          sources?: Json
          status?: Database["public"]["Enums"]["vo_draft_status"]
          thread_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      vo_runs: {
        Row: {
          booking_id: string | null
          cost_usd: number | null
          created_at: string
          failure: string | null
          finished_at: string | null
          id: string
          input_tokens: number | null
          is_sample: boolean
          kind: Database["public"]["Enums"]["vo_run_kind"]
          latency_ms: number | null
          lead_id: string | null
          matter_id: string | null
          model: string | null
          organization_id: string
          output_tokens: number | null
          prompt_version: string | null
          result: Database["public"]["Enums"]["vo_run_result"]
          source_count: number | null
          thread_id: string | null
          tools_called: string[]
          useful: boolean | null
          user_id: string
          version_id: string | null
        }
        Insert: {
          booking_id?: string | null
          cost_usd?: number | null
          created_at?: string
          failure?: string | null
          finished_at?: string | null
          id?: string
          input_tokens?: number | null
          is_sample?: boolean
          kind: Database["public"]["Enums"]["vo_run_kind"]
          latency_ms?: number | null
          lead_id?: string | null
          matter_id?: string | null
          model?: string | null
          organization_id: string
          output_tokens?: number | null
          prompt_version?: string | null
          result?: Database["public"]["Enums"]["vo_run_result"]
          source_count?: number | null
          thread_id?: string | null
          tools_called?: string[]
          useful?: boolean | null
          user_id: string
          version_id?: string | null
        }
        Update: {
          booking_id?: string | null
          cost_usd?: number | null
          created_at?: string
          failure?: string | null
          finished_at?: string | null
          id?: string
          input_tokens?: number | null
          is_sample?: boolean
          kind?: Database["public"]["Enums"]["vo_run_kind"]
          latency_ms?: number | null
          lead_id?: string | null
          matter_id?: string | null
          model?: string | null
          organization_id?: string
          output_tokens?: number | null
          prompt_version?: string | null
          result?: Database["public"]["Enums"]["vo_run_result"]
          source_count?: number | null
          thread_id?: string | null
          tools_called?: string[]
          useful?: boolean | null
          user_id?: string
          version_id?: string | null
        }
        Relationships: []
      }
      vo_crm_drafts: {
        Row: {
          body: string
          booking_id: string | null
          created_at: string
          created_by: string
          edited: boolean | null
          id: string
          is_sample: boolean
          kind: Database["public"]["Enums"]["vo_draft_kind"]
          lead_id: string | null
          lead_note_id: string | null
          left_out: number
          marketing_consent: boolean | null
          matter_id: string | null
          matter_note_id: string | null
          model: string
          needs_rule: boolean
          organization_id: string
          prompt_version: string
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string
          sources: Json
          status: Database["public"]["Enums"]["vo_draft_status"]
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          booking_id?: string | null
          created_at?: string
          created_by: string
          edited?: boolean | null
          id?: string
          is_sample?: boolean
          kind: Database["public"]["Enums"]["vo_draft_kind"]
          lead_id?: string | null
          lead_note_id?: string | null
          left_out?: number
          marketing_consent?: boolean | null
          matter_id?: string | null
          matter_note_id?: string | null
          model: string
          needs_rule?: boolean
          organization_id: string
          prompt_version: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id: string
          sources: Json
          status?: Database["public"]["Enums"]["vo_draft_status"]
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          booking_id?: string | null
          created_at?: string
          created_by?: string
          edited?: boolean | null
          id?: string
          is_sample?: boolean
          kind?: Database["public"]["Enums"]["vo_draft_kind"]
          lead_id?: string | null
          lead_note_id?: string | null
          left_out?: number
          marketing_consent?: boolean | null
          matter_id?: string | null
          matter_note_id?: string | null
          model?: string
          needs_rule?: boolean
          organization_id?: string
          prompt_version?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string
          sources?: Json
          status?: Database["public"]["Enums"]["vo_draft_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      vo_doc_drafts: {
        Row: {
          body: string
          created_at: string
          created_by: string
          document_id: string
          id: string
          is_sample: boolean
          kind: Database["public"]["Enums"]["vo_draft_kind"]
          matter_id: string
          model: string
          needs_rule: boolean
          organization_id: string
          prompt_version: string
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string
          sources: Json
          status: Database["public"]["Enums"]["vo_draft_status"]
          title: string
          updated_at: string
          version_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          document_id: string
          id?: string
          is_sample?: boolean
          kind?: Database["public"]["Enums"]["vo_draft_kind"]
          matter_id: string
          model: string
          needs_rule?: boolean
          organization_id: string
          prompt_version: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id: string
          sources: Json
          status?: Database["public"]["Enums"]["vo_draft_status"]
          title: string
          updated_at?: string
          version_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          document_id?: string
          id?: string
          is_sample?: boolean
          kind?: Database["public"]["Enums"]["vo_draft_kind"]
          matter_id?: string
          model?: string
          needs_rule?: boolean
          organization_id?: string
          prompt_version?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string
          sources?: Json
          status?: Database["public"]["Enums"]["vo_draft_status"]
          title?: string
          updated_at?: string
          version_id?: string
        }
        Relationships: []
      }
      vo_doc_proposals: {
        Row: {
          accepted_due_on: string | null
          accepted_value: string | null
          category: string | null
          confidence: number | null
          created_at: string
          deadline_id: string | null
          detail: string | null
          draft_id: string
          due_on: string | null
          edited: boolean | null
          id: string
          kind: Database["public"]["Enums"]["vo_proposal_kind"]
          label: string
          organization_id: string
          page: number | null
          position: number
          reviewed_at: string | null
          reviewed_by: string | null
          sensitivity: Database["public"]["Enums"]["document_sensitivity"] | null
          status: Database["public"]["Enums"]["vo_proposal_status"]
          value: string | null
        }
        Insert: {
          accepted_due_on?: string | null
          accepted_value?: string | null
          category?: string | null
          confidence?: number | null
          created_at?: string
          deadline_id?: string | null
          detail?: string | null
          draft_id: string
          due_on?: string | null
          edited?: boolean | null
          id?: string
          kind: Database["public"]["Enums"]["vo_proposal_kind"]
          label: string
          organization_id: string
          page?: number | null
          position: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          sensitivity?: Database["public"]["Enums"]["document_sensitivity"] | null
          status?: Database["public"]["Enums"]["vo_proposal_status"]
          value?: string | null
        }
        Update: {
          accepted_due_on?: string | null
          accepted_value?: string | null
          category?: string | null
          confidence?: number | null
          created_at?: string
          deadline_id?: string | null
          detail?: string | null
          draft_id?: string
          due_on?: string | null
          edited?: boolean | null
          id?: string
          kind?: Database["public"]["Enums"]["vo_proposal_kind"]
          label?: string
          organization_id?: string
          page?: number | null
          position?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          sensitivity?: Database["public"]["Enums"]["document_sensitivity"] | null
          status?: Database["public"]["Enums"]["vo_proposal_status"]
          value?: string | null
        }
        Relationships: []
      }
      vo_settings: {
        Row: {
          enabled: boolean
          organization_id: string
          read_client_messages: boolean
          read_criminal: boolean
          read_financial: boolean
          read_identity: boolean
          read_medical: boolean
          read_narratives: boolean
          read_relationship: boolean
          reply_drafts: boolean
          staff_answers: boolean
          updated_at: string
          updated_by: string
          composio_accepted_at: string | null
          composio_accepted_by: string | null
          composio_enabled: boolean
          doc_classification: boolean
          inconsistency_flags: boolean
          missing_fields: boolean
          ocr_normalisation: boolean
          letter_drafts: boolean
        }
        Insert: {
          letter_drafts?: boolean
          composio_accepted_at?: string | null
          composio_accepted_by?: string | null
          composio_enabled?: boolean
          doc_classification?: boolean
          inconsistency_flags?: boolean
          missing_fields?: boolean
          ocr_normalisation?: boolean
          enabled: boolean
          organization_id: string
          read_client_messages?: boolean
          read_criminal?: boolean
          read_financial?: boolean
          read_identity?: boolean
          read_medical?: boolean
          read_narratives?: boolean
          read_relationship?: boolean
          reply_drafts?: boolean
          staff_answers?: boolean
          updated_at?: string
          updated_by: string
        }
        Update: {
          letter_drafts?: boolean
          doc_classification?: boolean
          inconsistency_flags?: boolean
          missing_fields?: boolean
          ocr_normalisation?: boolean
          enabled?: boolean
          organization_id?: string
          read_client_messages?: boolean
          read_criminal?: boolean
          read_financial?: boolean
          read_identity?: boolean
          read_medical?: boolean
          read_narratives?: boolean
          read_relationship?: boolean
          reply_drafts?: boolean
          staff_answers?: boolean
          updated_at?: string
          updated_by?: string
          composio_accepted_at?: string | null
          composio_accepted_by?: string | null
          composio_enabled?: boolean
        }
        Relationships: []
      }
      vo_vendor_terms_acknowledgements: {
        Row: {
          acknowledged_at: string
          acknowledged_by: string
          id: string
          organization_id: string
          terms_version: string
        }
        Insert: {
          acknowledged_at?: string
          acknowledged_by: string
          id?: string
          organization_id: string
          terms_version: string
        }
        Update: {
          acknowledged_at?: string
          acknowledged_by?: string
          id?: string
          organization_id?: string
          terms_version?: string
        }
        Relationships: []
      }
      staff_connections: {
        Row: {
          connected_account_id: string | null
          created_at: string
          id: string
          mail_label: string
          membership_id: string
          organization_id: string
          status: string
          toolkit: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          connected_account_id?: string | null
          created_at?: string
          id?: string
          mail_label?: string
          membership_id: string
          organization_id: string
          status: string
          toolkit: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          connected_account_id?: string | null
          created_at?: string
          id?: string
          mail_label?: string
          membership_id?: string
          organization_id?: string
          status?: string
          toolkit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      webhook_inbox: {
        Row: {
          connected_account_id: string | null
          created_at: string
          created_by: string | null
          event_id: string
          event_type: string | null
          id: string
          organization_id: string | null
          payload: Json
          processed_at: string | null
          provider: string
          provider_account_id: string
          received_at: string
          signature_verified: boolean
          status: Database["public"]["Enums"]["webhook_inbox_status"]
          updated_at: string
          version: number
        }
        Insert: {
          connected_account_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id: string
          event_type?: string | null
          id?: string
          organization_id?: string | null
          payload?: Json
          processed_at?: string | null
          provider: string
          provider_account_id?: string
          received_at?: string
          signature_verified?: boolean
          status?: Database["public"]["Enums"]["webhook_inbox_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          connected_account_id?: string | null
          created_at?: string
          created_by?: string | null
          event_id?: string
          event_type?: string | null
          id?: string
          organization_id?: string | null
          payload?: Json
          processed_at?: string | null
          provider?: string
          provider_account_id?: string
          received_at?: string
          signature_verified?: boolean
          status?: Database["public"]["Enums"]["webhook_inbox_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "webhook_inbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_whatsapp_accounts: {
        Row: {
          connected_at: string | null
          connected_by: string | null
          created_at: string
          disconnected_at: string | null
          disconnected_by: string | null
          display_phone: string | null
          is_sandbox: boolean
          organization_id: string
          status: Database["public"]["Enums"]["whatsapp_account_status"]
          updated_at: string
          version: number
          zernio_account_id: string | null
          zernio_profile_id: string | null
        }
        Insert: {
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          disconnected_by?: string | null
          display_phone?: string | null
          is_sandbox?: boolean
          organization_id: string
          status?: Database["public"]["Enums"]["whatsapp_account_status"]
          updated_at?: string
          version?: number
          zernio_account_id?: string | null
          zernio_profile_id?: string | null
        }
        Update: {
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          disconnected_by?: string | null
          display_phone?: string | null
          is_sandbox?: boolean
          organization_id?: string
          status?: Database["public"]["Enums"]["whatsapp_account_status"]
          updated_at?: string
          version?: number
          zernio_account_id?: string | null
          zernio_profile_id?: string | null
        }
        Relationships: []
      }
      person_whatsapp_contacts: {
        Row: {
          channel: Database["public"]["Enums"]["whatsapp_notice_channel"]
          consent_at: string | null
          consent_recorded_by: string | null
          consent_source: Database["public"]["Enums"]["whatsapp_consent_source"] | null
          created_at: string
          organization_id: string
          person_id: string
          phone_e164: string
          updated_at: string
          version: number
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        Insert: {
          channel?: Database["public"]["Enums"]["whatsapp_notice_channel"]
          consent_at?: string | null
          consent_recorded_by?: string | null
          consent_source?: Database["public"]["Enums"]["whatsapp_consent_source"] | null
          created_at?: string
          organization_id: string
          person_id: string
          phone_e164: string
          updated_at?: string
          version?: number
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["whatsapp_notice_channel"]
          consent_at?: string | null
          consent_recorded_by?: string | null
          consent_source?: Database["public"]["Enums"]["whatsapp_consent_source"] | null
          created_at?: string
          organization_id?: string
          person_id?: string
          phone_e164?: string
          updated_at?: string
          version?: number
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Relationships: []
      }
      whatsapp_consent_events: {
        Row: {
          action: string
          channel: Database["public"]["Enums"]["whatsapp_notice_channel"]
          id: string
          organization_id: string
          person_id: string
          phone_e164: string
          recorded_at: string
          recorded_by: string
          source: Database["public"]["Enums"]["whatsapp_consent_source"]
        }
        Insert: {
          action: string
          channel: Database["public"]["Enums"]["whatsapp_notice_channel"]
          id?: string
          organization_id: string
          person_id: string
          phone_e164: string
          recorded_at?: string
          recorded_by: string
          source: Database["public"]["Enums"]["whatsapp_consent_source"]
        }
        Update: {
          action?: string
          channel?: Database["public"]["Enums"]["whatsapp_notice_channel"]
          id?: string
          organization_id?: string
          person_id?: string
          phone_e164?: string
          recorded_at?: string
          recorded_by?: string
          source?: Database["public"]["Enums"]["whatsapp_consent_source"]
        }
        Relationships: []
      }
      whatsapp_deliveries: {
        Row: {
          attempt_count: number
          conversation_id: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          email_delivery_id: string | null
          failed_at: string | null
          id: string
          kind: string
          last_error: string | null
          matter_id: string | null
          matter_message_id: string | null
          organization_id: string
          outbox_event_id: string
          person_id: string
          phone_e164: string | null
          provider_message_id: string | null
          read_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["whatsapp_delivery_status"]
          template_name: string | null
          updated_at: string
          version: number
        }
        Insert: {
          attempt_count?: number
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          email_delivery_id?: string | null
          failed_at?: string | null
          id?: string
          kind: string
          last_error?: string | null
          matter_id?: string | null
          matter_message_id?: string | null
          organization_id: string
          outbox_event_id: string
          person_id: string
          phone_e164?: string | null
          provider_message_id?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["whatsapp_delivery_status"]
          template_name?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          attempt_count?: number
          conversation_id?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          email_delivery_id?: string | null
          failed_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          matter_id?: string | null
          matter_message_id?: string | null
          organization_id?: string
          outbox_event_id?: string
          person_id?: string
          phone_e164?: string | null
          provider_message_id?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["whatsapp_delivery_status"]
          template_name?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      whatsapp_inbound_messages: {
        Row: {
          body: string | null
          conversation_id: string | null
          has_attachments: boolean
          id: string
          matter_id: string | null
          matter_message_id: string | null
          organization_id: string
          person_id: string | null
          platform_message_id: string
          reason: string | null
          received_at: string
          sender_bsuid: string | null
          sender_name: string | null
          sender_phone_e164: string | null
          sent_at: string | null
          triage_state: string
          zernio_event_id: string
        }
        Insert: {
          body?: string | null
          conversation_id?: string | null
          has_attachments?: boolean
          id?: string
          matter_id?: string | null
          matter_message_id?: string | null
          organization_id: string
          person_id?: string | null
          platform_message_id: string
          reason?: string | null
          received_at?: string
          sender_bsuid?: string | null
          sender_name?: string | null
          sender_phone_e164?: string | null
          sent_at?: string | null
          triage_state: string
          zernio_event_id: string
        }
        Update: {
          body?: string | null
          conversation_id?: string | null
          has_attachments?: boolean
          id?: string
          matter_id?: string | null
          matter_message_id?: string | null
          organization_id?: string
          person_id?: string | null
          platform_message_id?: string
          reason?: string | null
          received_at?: string
          sender_bsuid?: string | null
          sender_name?: string | null
          sender_phone_e164?: string | null
          sent_at?: string | null
          triage_state?: string
          zernio_event_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { token: string }; Returns: string }
      accept_portal_invitation: {
        Args: { p_payload: Json; p_token: string }
        Returns: Json
      }
      accept_quote: {
        Args: { p_agreement_id: string }
        Returns: undefined
      }
      accept_vo_doc_proposal: {
        Args: { p_due_on?: string | null; p_proposal_id: string; p_value?: string | null }
        Returns: Json
      }
      access_grant_choices: {
        Args: { p_organization_id: string }
        Returns: {
          choice: string
          matter_id: string | null
          matter_reference: string | null
          person_id: string
          person_name: string
        }[]
      }
      acknowledge_matter_message: {
        Args: { p_message_id: string; p_organization_id: string }
        Returns: string
      }
      acknowledge_vo_vendor_terms: {
        Args: { p_organization_id: string; p_terms_version: string }
        Returns: Json
      }
      add_consultant_licence: {
        Args: {
          p_college_id: string
          p_licence_type: Database["public"]["Enums"]["licence_type"]
          p_membership_id: string
        }
        Returns: string
      }
      add_expiry_reminder: {
        Args: {
          p_decision_id: string
          p_document_version_id: string
          p_due_on: string
          p_owner_membership_id?: string | null
        }
        Returns: string
      }
      add_invoice_government_fee: {
        Args: {
          p_amount_cents: number | null
          p_checked_on: string | null
          p_invoice_id: string
          p_name: string | null
          p_reference_id: string | null
          p_source_url: string | null
        }
        Returns: string
      }
      add_lead_follow_up: {
        Args: {
          p_due_on: string | null
          p_lead: string
          p_org: string
          p_owner_membership_id: string | null
          p_title: string
        }
        Returns: string
      }
      add_lead_note: {
        Args: {
          p_body: string
          p_lead: string
          p_org: string
        }
        Returns: string
      }
      add_matter_staff_note: {
        Args: { p_body: string; p_matter_id: string; p_organization_id: string }
        Returns: string
      }
      add_task_dependency: {
        Args: { p_depends_on_task_id: string; p_task_id: string }
        Returns: string
      }
      add_task_watcher: {
        Args: { p_membership_id: string; p_task_id: string }
        Returns: string
      }
      add_tax_rate: {
        Args: {
          p_approved_by: string
          p_effective_from: string
          p_effective_to: string | null
          p_name: string
          p_org: string
          p_rate_percent: number
          p_source_note: string | null
        }
        Returns: string
      }
      agreement_certificate_pdf: {
        Args: { p_envelope_id: string }
        Returns: string
      }
      agreement_executed_pdf: {
        Args: { p_envelope_id: string }
        Returns: string
      }
      agreement_seal_source: {
        Args: { p_envelope_id: string }
        Returns: Json
      }
      append_migration_rows: {
        Args: { p_batch: string; p_first_row: number; p_org: string; p_rows: Json }
        Returns: number
      }
      apply_client_credit: {
        Args: {
          p_amount_cents: number
          p_credit_id: string
          p_idempotency_key: string
          p_target_invoice_id: string
        }
        Returns: string
      }
      apply_document_scan: {
        Args: { p_result: string; p_version_id: string }
        Returns: Database["public"]["Enums"]["document_upload_state"]
      }
      apply_livekit_event: {
        Args: { p_event: Json }
        Returns: Json
      }
      apply_stripe_payment_event: {
        Args: {
          p_account_id: string
          p_amount_cents: number | null
          p_amount_received_cents: number | null
          p_currency: string | null
          p_event_id: string
          p_event_type: string
          p_invoice_id: string | null
          p_livemode: boolean
          p_payload: Json
          p_payment_intent_id: string
        }
        Returns: Json
      }
      apply_stripe_reversal_event: {
        Args: {
          p_account_id: string
          p_amount_cents: number | null
          p_amount_refunded_cents: number | null
          p_charge_id: string | null
          p_currency: string | null
          p_event_created: number | null
          p_event_id: string
          p_event_type: string
          p_evidence_due_by: string | null
          p_failure_reason: string | null
          p_livemode: boolean
          p_object_id: string
          p_payload: Json
          p_payment_intent_id: string
          p_reason: string | null
          p_status: string | null
        }
        Returns: Json
      }
      apply_stripe_subscription_event: {
        Args: { p_event: Json }
        Returns: Json
      }
      approve_agreement_template: {
        Args: { p_template_id: string }
        Returns: undefined
      }
      approve_client_transfer: {
        Args: {
          p_entry_id: string
        }
        Returns: Json
      }
      approve_support_access_request: {
        Args: { p_id: string }
        Returns: string
      }
      archive_booking_event_type: {
        Args: {
          p_event_type_id: string
          p_expected_version: number
          p_org: string
        }
        Returns: undefined
      }
      archive_lead_stage: {
        Args: {
          p_org: string
          p_stage_id: string
        }
        Returns: undefined
      }
      assign_responsible_consultant: {
        Args: { p_expected_version: number; p_matter_id: string; p_membership_id: string }
        Returns: number
      }
      assign_unsorted_email_file: {
        Args: { p_item_id: string; p_matter_id: string; p_person_id: string }
        Returns: Json
      }
      attach_correspondence_evidence: {
        Args: {
          p_correspondence_id: string
          p_evidence_locator: string | null
          p_evidence_version_id: string | null
          p_expected_version: number
        }
        Returns: number
      }
      attach_invitation_email_link: {
        Args: {
          p_invitation_id: string
          p_sealed: string
          p_token_hash: string
        }
        Returns: boolean
      }
      attach_sealed_agreement: {
        Args: {
          p_certificate: string
          p_envelope_id: string
          p_pdf: string
          p_renderer: string
        }
        Returns: Json
      }
      attach_upload_to_request: {
        Args: { p_request_id: string; p_version_id: string }
        Returns: undefined
      }
      attempt_matter_stage_transition: {
        Args: {
          p_expected_version: number
          p_matter_id: string
          p_reason: string
          p_to_stage: Database["public"]["Enums"]["matter_stage"]
        }
        Returns: Json
      }
      authorize_document_download: {
        Args: { p_version_id: string }
        Returns: Json
      }
      authorize_matter_export_download: {
        Args: { p_export_id: string }
        Returns: Json
      }
      begin_inbound_message: {
        Args: {
          p_domain?: string
          p_from: string
          p_html: string
          p_message_id: string
          p_subject: string
          p_text: string
          p_to: string
        }
        Returns: Json
      }
      begin_migration_commit: {
        Args: { p_batch: string; p_org: string; p_plan_hash: string }
        Returns: Json
      }
      begin_verified_inbound_message: {
        Args: {
          p_domain: string
          p_from: string
          p_html: string
          p_message_id: string
          p_sender_verified: boolean
          p_subject: string
          p_text: string
          p_to: string
        }
        Returns: Json
      }
      begin_vo_call_summary: {
        Args: { p_booking_id: string; p_organization_id: string }
        Returns: Json
      }
      begin_vo_document_review: {
        Args: { p_organization_id: string; p_version_id: string }
        Returns: Json
      }
      begin_vo_lead_follow_up: {
        Args: { p_lead_id: string; p_organization_id: string }
        Returns: Json
      }
      begin_vo_letter_draft: {
        Args: { p_letter_type: string; p_matter_id: string; p_organization_id: string }
        Returns: Json
      }
      create_matter_letter: {
        Args: { p_body: string; p_letter_type: string; p_matter_id: string; p_organization_id: string; p_title: string }
        Returns: string
      }
      revise_matter_letter: {
        Args: { p_body: string; p_expected_version: number; p_letter_id: string; p_title: string }
        Returns: number
      }
      approve_matter_letter: {
        Args: { p_expected_version: number; p_letter_id: string }
        Returns: Json
      }
      discard_matter_letter: {
        Args: { p_expected_version: number; p_letter_id: string }
        Returns: undefined
      }
      release_matter_letter: {
        Args: { p_letter_id: string }
        Returns: Json
      }
      vo_letter_facts: {
        Args: { p_run_id: string }
        Returns: Json
      }
      vo_letter_official_content: {
        Args: { p_run_id: string }
        Returns: Json
      }
      save_vo_letter_draft: {
        Args: {
          p_body: string
          p_cost_usd?: number | null
          p_facts: Json
          p_input_tokens?: number | null
          p_latency_ms?: number | null
          p_left_out: Json
          p_letter_type: string
          p_model: string
          p_official: Json
          p_output_tokens?: number | null
          p_prompt_version: string
          p_run_id: string
          p_title: string
          p_tools?: string[] | null
        }
        Returns: string
      }
      begin_vo_run: {
        Args: {
          p_kind: Database["public"]["Enums"]["vo_run_kind"]
          p_matter_id?: string | null
          p_organization_id: string
          p_thread_id: string | null
        }
        Returns: Json
      }
      booking_agreement_for_signing: {
        Args: { p_ref: string }
        Returns: Json
      }
      booking_public_busy: {
        Args: { p_event_type_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      booking_public_event: {
        Args: { p_event_slug: string; p_firm_slug: string }
        Returns: Json
      }
      booking_public_event_types: {
        Args: { p_firm_slug: string }
        Returns: Json
      }
      booking_public_hold: {
        Args: {
          p_client_hash: string | null
          p_email: string
          p_event_slug: string
          p_firm_slug: string
          p_idempotency_key: string
          p_name: string
          p_phone: string | null
          p_start: string
          p_time_zone: string
        }
        Returns: Json
      }
      cache_subscription_stripe_prices: {
        Args: { p_mode: string; p_prices: Json }
        Returns: undefined
      }
      cancel_instalment_plan: {
        Args: {
          p_plan_id: string
          p_reason: string
        }
        Returns: number
      }
      cancel_matter_export: {
        Args: { p_export_id: string }
        Returns: undefined
      }
      cancel_submission_handoff: {
        Args: {
          p_expected_version: number
          p_handoff_id: string
          p_reason: string
        }
        Returns: number
      }
      cancel_support_access_request: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      change_responsible_consultant: {
        Args: { p_expected_version: number; p_matter_id: string; p_membership_id: string }
        Returns: Json
      }
      change_staff_role: {
        Args: {
          p_membership_id: string
          p_organization_id: string
          p_role: Database["public"]["Enums"]["org_role"]
        }
        Returns: undefined
      }
      check_licence_against_cicc_list: {
        Args: { p_credential_id: string }
        Returns: string
      }
      cicc_needs_review_credentials: {
        Args: never
        Returns: {
          checked_at: string
          check_id: string
          college_id: string
          credential_id: string
          credential_status: Database["public"]["Enums"]["credential_status"]
          firm_name: string
          holder_name: string | null
          import_id: string
          licence_type: Database["public"]["Enums"]["licence_type"]
          organization_id: string
          reason: string | null
        }[]
      }
      claim_due_reminders: {
        Args: { p_as_of: string; p_limit: number }
        Returns: string[]
      }
      claim_mail_events: {
        Args: { p_limit?: number; p_worker: string }
        Returns: Json
      }
      claim_whatsapp_events: {
        Args: { p_limit?: number; p_worker: string }
        Returns: Json
      }
      clear_matter_on_hold: {
        Args: { p_expected_version: number; p_matter_id: string; p_reason: string }
        Returns: number
      }
      add_reconciliation_adjustment: {
        Args: { p_amount_cents: number; p_description: string; p_item_date: string; p_kind: string; p_reconciliation_id: string; p_reference: string | null }
        Returns: string
      }
      complete_consent_review: {
        Args: { p_expected_version: number; p_note: string; p_review_id: string }
        Returns: number
      }
      confirm_submission_fees: {
        Args: { p_confirmed: boolean; p_handoff_id: string; p_note: string }
        Returns: string
      }
      create_firm_operating_account: {
        Args: { p_institution: string; p_label: string; p_last4: string; p_org: string }
        Returns: string
      }
      invoice_manual_payment_summary: {
        Args: { p_invoice_ids: string[] }
        Returns: { amount_cents: number; currency: string; invoice_id: string; method: string; number: string; payment_id: string; received_on: string; status: string }[]
      }
      list_payment_reviewers: {
        Args: { p_org: string }
        Returns: { display_name: string; matter_ids: string[] | null; role: string; user_id: string }[]
      }
      my_consents: { Args: never; Returns: Json }
      my_two_step_state: { Args: never; Returns: string }
      override_submission_gate: {
        Args: { p_gate: string; p_handoff_id: string; p_reason: string }
        Returns: string
      }
      person_consent_overview: {
        Args: { p_organization_id: string; p_person_id: string }
        Returns: Json
      }
      // SRC-01/02/03 claims and the review workbench (20261025400000_src_claims_review.sql).
      add_rule_claim: {
        Args: {
          p_applicability_note: string
          p_checked_on: string
          p_claim: string
          p_current_to: string
          p_effective_from: string
          p_effective_to: string
          p_excerpt: string
          p_form_modified_on: string
          p_form_number: string
          p_jurisdiction: string
          p_last_amended_on: string
          p_modified_on: string
          p_org: string
          p_program_key: string
          p_published_on: string
          p_snapshot: Json
          p_source_section: string
          p_source_url: string
          p_stable_key: string
          p_value: string
        }
        Returns: string
      }
      resolve_rule_applicability: {
        Args: { p_expected_version: number; p_note: string; p_resolution: string; p_version_id: string }
        Returns: number
      }
      review_rule_version: {
        Args: {
          p_decision: string
          p_expected_version: number
          p_next_review_on: string
          p_note: string
          p_page_opened_on: string
          p_version_id: string
        }
        Returns: number
      }
      suspend_rule_version: {
        Args: { p_expected_version: number; p_reason: string; p_version_id: string }
        Returns: number
      }
      propose_submission_requirement: {
        Args: {
          p_channel: Database["public"]["Enums"]["submission_channel"]
          p_checked_on: string
          p_current_to: string
          p_form_modified_on: string
          p_form_number: string
          p_kind: string
          p_label: string
          p_org: string
          p_program_key: string
          p_snapshot: Json
          p_source_section: string
          p_source_url: string
        }
        Returns: string
      }
      // DEC-02 approval follow-up (20261025200000_dec_approval_follow_up.sql).
      propose_approval_follow_up_step: {
        Args: {
          p_checked_on: string
          p_current_to: string
          p_form_modified_on: string
          p_form_number: string
          p_label: string
          p_org: string
          p_program_key: string
          p_snapshot: Json
          p_source_section: string
          p_source_url: string
          p_timing_text: string
        }
        Returns: string
      }
      review_approval_follow_up_step:
        | {
            Args: { p_decision: string; p_expected_version: number; p_note: string; p_step_id: string }
            Returns: number
          }
        | {
            Args: { p_decision: string; p_expected_version: number; p_note: string; p_page_opened_on: string | null; p_step_id: string }
            Returns: number
          }
      record_my_two_step: { Args: { p_enabled: boolean }; Returns: string }
      record_staff_activity: { Args: { p_active?: boolean }; Returns: Json }
      reset_client_two_step: {
        Args: {
          p_identity_method: string
          p_note?: string
          p_organization_id: string
          p_person_id: string
        }
        Returns: string
      }
      retire_approval_follow_up_step: {
        Args: { p_expected_version: number; p_reason: string; p_step_id: string }
        Returns: number
      }
      set_my_consent: {
        Args: { p_granted: boolean; p_purpose: string }
        Returns: Json
      }
      set_staff_idle_timeout: {
        Args: { p_minutes: number; p_organization_id: string }
        Returns: number
      }
      tick_approval_follow_up_step: {
        Args: { p_matter_id: string; p_step_id: string; p_ticked: boolean }
        Returns: string
      }
      draft_conditions_summary: { Args: { p_body: string; p_matter_id: string }; Returns: string }
      revise_conditions_summary: {
        Args: { p_body: string; p_expected_version: number; p_summary_id: string }
        Returns: number
      }
      approve_conditions_summary: {
        Args: { p_expected_version: number; p_summary_id: string }
        Returns: number
      }
      record_decision_delivery: {
        Args: { p_delivered_at: string; p_document_version_id: string; p_matter_id: string; p_method: string; p_note: string }
        Returns: string
      }
      acknowledge_decision_delivery: { Args: { p_delivery_id: string }; Returns: undefined }
      record_delivery_acknowledgement: {
        Args: { p_acknowledged_on: string; p_delivery_id: string; p_evidence_note: string; p_evidence_version_id: string; p_expected_version: number }
        Returns: number
      }
      portal_decision_follow_up: { Args: { p_org: string }; Returns: Json }
      record_client_advance: {
        Args: {
          p_amount_cents: number
          p_client_account_id: string
          p_evidence_note: string | null
          p_evidence_version_id: string | null
          p_idempotency_key: string
          p_matter_id: string
          p_method: string
          p_person_id: string
          p_received_on: string
          p_reference: string
          p_reviewer_user_id: string
        }
        Returns: string
      }
      record_invoice_manual_payment: {
        Args: {
          p_amount_cents: number
          p_evidence_note: string | null
          p_evidence_version_id: string | null
          p_idempotency_key: string
          p_invoice_id: string
          p_method: string
          p_operating_account_id: string
          p_received_on: string
          p_reference: string
          p_reviewer_user_id: string
        }
        Returns: string
      }
      record_reconciliation_export: {
        Args: { p_reconciliation_id: string }
        Returns: string
      }
      reject_invoice_manual_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: string
      }
      remove_reconciliation_adjustment: {
        Args: { p_adjustment_id: string }
        Returns: string
      }
      retire_submission_requirement: {
        Args: {
          p_expected_version: number
          p_reason: string
          p_requirement_id: string
        }
        Returns: number
      }
      // DEC-02 renewal follow-up (20261025210000_dec_renewal.sql)
      propose_renewal_timing: {
        Args: {
          p_applies_to: string
          p_checked_on: string
          p_current_to: string | null
          p_form_modified_on: string | null
          p_form_number: string | null
          p_lead_days: number | null
          p_org: string
          p_program_key: string | null
          p_snapshot: Json | null
          p_source_section: string | null
          p_source_url: string
          p_timing_text: string
        }
        Returns: string
      }
      review_renewal_timing:
        | {
            Args: {
              p_decision: string
              p_expected_version: number
              p_note: string | null
              p_timing_id: string
            }
            Returns: number
          }
        | {
            Args: {
              p_decision: string
              p_expected_version: number
              p_note: string | null
              p_page_opened_on: string | null
              p_timing_id: string
            }
            Returns: number
          }
      retire_renewal_timing: {
        Args: { p_expected_version: number; p_reason: string; p_timing_id: string }
        Returns: number
      }
      renewal_contact_state: { Args: { p_matter_id: string }; Returns: Json }
      record_issued_expiry: {
        Args: {
          p_decision_id: string
          p_document_label: string
          p_document_version_id: string | null
          p_expires_on: string
          p_owner_membership_id: string | null
          p_remind_on: string | null
          p_timing_id: string | null
        }
        Returns: string
      }
      set_renewal_reminder: {
        Args: {
          p_expected_version: number
          p_fee_reference_id: string | null
          p_renewal_id: string
          p_service_scope: string
        }
        Returns: number
      }
      cancel_decision_renewal: {
        Args: { p_expected_version: number; p_reason: string; p_renewal_id: string }
        Returns: number
      }
      portal_renewal_reminders: { Args: { p_org: string }; Returns: Json }
      reverse_invoice_manual_payment: {
        Args: { p_outcome: string; p_payment_id: string; p_reason: string }
        Returns: Json
      }
      review_submission_requirement:
        | {
            Args: {
              p_decision: string
              p_expected_version: number
              p_note: string
              p_requirement_id: string
            }
            Returns: number
          }
        | {
            Args: {
              p_decision: string
              p_expected_version: number
              p_note: string
              p_page_opened_on: string | null
              p_requirement_id: string
            }
            Returns: number
          }
      submission_checklist: {
        Args: { p_matter_id: string }
        Returns: Json
      }
      tick_submission_step: {
        Args: { p_handoff_id: string; p_requirement_id: string; p_ticked: boolean }
        Returns: string
      }
      verify_invoice_manual_payment: {
        Args: { p_payment_id: string }
        Returns: Json
      }
      client_credit_available_cents: {
        Args: {
          p_credit_id: string
        }
        Returns: number
      }
      client_credit_refund_context: {
        Args: {
          p_credit_id: string
        }
        Returns: Json
      }
      client_fund_receipt: {
        Args: {
          p_entry_id: string
        }
        Returns: Json
      }
      client_fund_staff_names: {
        Args: {
          p_org: string
        }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      close_firm_transfer: {
        Args: { p_note: string; p_status: string; p_transfer_id: string }
        Returns: undefined
      }
      close_lead_lost: {
        Args: {
          p_expected_version: number
          p_lead: string
          p_org: string
          p_reason: string
        }
        Returns: number
      }
      close_matter: {
        Args: { p_expected_version: number; p_matter_id: string; p_override_reason?: string | null; p_reason: string }
        Returns: string
      }
      close_person_break_glass: {
        Args: { p_id: string }
        Returns: undefined
      }
      close_privacy_request: {
        Args: {
          p_consent_record_id: string | null
          p_delivery_method: string | null
          p_evidence_note: string | null
          p_outcome: string
          p_outcome_note: string | null
          p_refusal_reason: string | null
          p_request_id: string
        }
        Returns: undefined
      }
      commit_migration_chunk: {
        Args: { p_batch: string; p_limit?: number; p_org: string }
        Returns: Json
      }
      complete_document_upload: {
        Args: { p_header_hex: string; p_sha256: string; p_version_id: string }
        Returns: Json
      }
      complete_email_upload: {
        Args: { p_header_hex: string; p_inbound_id: string; p_ordinal: number; p_sha256: string }
        Returns: Json
      }
      complete_lead_follow_up: {
        Args: {
          p_follow_up: string
          p_org: string
        }
        Returns: undefined
      }
      complete_sample_proof: {
        Args: {
          p_matter_id: string
          p_step: Database["public"]["Enums"]["sample_proof_step"]
        }
        Returns: undefined
      }
      complete_unsorted_assignment: {
        Args: { p_item_id: string }
        Returns: undefined
      }
      confirm_deadline: {
        Args: { p_deadline_id: string; p_expected_version: number }
        Returns: number
      }
      confirm_decision: {
        Args: {
          p_consultant_interpretation?: string | null
          p_decision_id: string
          p_expected_version: number
          p_next_steps: string
        }
        Returns: number
      }
      confirm_reused_fact: { Args: { p_reuse_id: string }; Returns: undefined }
      connect_firm_whatsapp: {
        Args: { p_account_id: string; p_display_phone?: string; p_organization_id: string; p_sandbox?: boolean }
        Returns: undefined
      }
      consultant_change_audience: { Args: { p_matter_id: string }; Returns: Json }
      consume_recovery_code: {
        Args: { p_code: string }
        Returns: boolean
      }
      consume_translation_draft: {
        Args: { p_char_count: number; p_organization_id: string }
        Returns: Json
      }
      convert_lead_to_matter: {
        Args: {
          p_consultant_membership_id: string
          p_expected_version: number
          p_lead: string
          p_org: string
          p_rule_pack_version_id?: string | null
        }
        Returns: Json
      }
      create_access_grant: {
        Args: {
          p_expires_on: string
          p_grantee_person_id: string
          p_matter_id: string
          p_purpose: string
          p_subject_person_id: string
        }
        Returns: string
      }
      create_agreement: {
        Args: {
          p_body: string
          p_comparison: string | null
          p_currency: string | null
          p_exclusions: string | null
          p_fee_cents: number | null
          p_government_fee_note: string | null
          p_kind: Database["public"]["Enums"]["agreement_kind"]
          p_matter_id: string
          p_quote_expires_on: string | null
          p_refund_policy: string | null
          p_scope: string
          p_supersedes_id: string | null
          p_template_id: string | null
          p_title: string
        }
        Returns: string
      }
      create_agreement_template: {
        Args: {
          p_body: string
          p_kind: Database["public"]["Enums"]["agreement_kind"]
          p_name: string
        }
        Returns: string
      }
      create_client_account: {
        Args: {
          p_institution: string
          p_label: string
          p_last4: string
          p_org: string
        }
        Returns: string
      }
      create_client_matter: {
        Args: {
          p_applicant_date_of_birth?: string | null
          p_applicant_email: string | null
          p_applicant_name: string
          p_consultant_membership_id: string
          p_rule_pack_version_id?: string | null
          p_sponsor_date_of_birth?: string | null
          p_sponsor_email: string | null
          p_sponsor_name: string | null
          p_title?: string | null
        }
        Returns: Json
      }
      create_document_request: {
        Args: {
          p_acceptable_formats: string[]
          p_audience: Database["public"]["Enums"]["document_audience"]
          p_due_on: string | null
          p_explanation: string
          p_expires_on: string | null
          p_matter_id: string
          p_person_id: string
          p_purpose: string
          p_review_criteria: string | null
          p_rule_item_key: string | null
          p_rule_version_id: string | null
          p_sensitivity: Database["public"]["Enums"]["document_sensitivity"]
        }
        Returns: string
      }
      create_email_upload_intent: {
        Args: { p_byte_size: number; p_filename: string; p_inbound_id: string; p_ordinal: number }
        Returns: Json
      }
      create_engaged_matter: {
        Args: {
          p_consultant_membership_id: string
          p_is_sample: boolean
          p_rule_pack_version_id?: string | null
          p_scope?: string | null
          p_title: string
        }
        Returns: Json
      }
      create_firm_with_licence: {
        Args: {
          college_id: string
          display_name: string
          legal_name: string
          licence_class: string
          licence_type: Database["public"]["Enums"]["licence_type"]
          slug: string
        }
        Returns: {
          age_of_majority_years: number
          billing_contact_email: string | null
          billing_contact_name: string | null
          branding: Json
          continuity_contact_email: string | null
          continuity_contact_name: string | null
          created_at: string
          created_by: string | null
          default_locale: string
          enquiry_page_enabled: boolean
          display_name: string
          dpa_accepted_at: string | null
          dpa_version: string | null
          id: string
          jurisdiction_codes: string[]
          legal_name: string
          privacy_contact_email: string | null
          privacy_contact_name: string | null
          retention_policy: Json | null
          sample_mode: boolean
          slug: string
          subscription_terms_accepted_at: string | null
          subscription_terms_version: string | null
          succession_note: string | null
          timezone: string
          updated_at: string
          verification_status: Database["public"]["Enums"]["org_verification_status"]
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_instalment_plan: {
        Args: {
          p_agreement_id: string
          p_due_dates: string[]
        }
        Returns: string
      }
      create_invoice: {
        Args: {
          p_amount_cents: number
          p_currency: string
          p_description: string
          p_due_on: string
          p_idempotency_key: string
          p_matter_id: string
        }
        Returns: string
      }
      create_lead: {
        Args: {
          p_country_now: string | null
          p_email: string | null
          p_language: string | null
          p_marketing_consent: boolean
          p_name: string
          p_note: string | null
          p_org: string
          p_owner_membership_id: string | null
          p_phone: string | null
          p_preferred_contact: string | null
          p_proposed_fee_cents: number | null
          p_reply_consent: boolean
          p_service_interest: string | null
          p_source: Database["public"]["Enums"]["lead_source"]
          p_source_detail: string | null
          p_tags: string[]
        }
        Returns: string
      }
      create_lead_from_booking: {
        Args: {
          p_booking: string
          p_org: string
        }
        Returns: string
      }
      create_organization: {
        Args: { display_name: string; legal_name: string; slug: string }
        Returns: {
          age_of_majority_years: number
          billing_contact_email: string | null
          billing_contact_name: string | null
          branding: Json
          continuity_contact_email: string | null
          continuity_contact_name: string | null
          created_at: string
          created_by: string | null
          default_locale: string
          enquiry_page_enabled: boolean
          display_name: string
          dpa_accepted_at: string | null
          dpa_version: string | null
          id: string
          jurisdiction_codes: string[]
          legal_name: string
          privacy_contact_email: string | null
          privacy_contact_name: string | null
          retention_policy: Json | null
          sample_mode: boolean
          slug: string
          subscription_terms_accepted_at: string | null
          subscription_terms_version: string | null
          succession_note: string | null
          timezone: string
          updated_at: string
          verification_status: Database["public"]["Enums"]["org_verification_status"]
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_portal_invitation: {
        Args: {
          p_email: string
          p_guardian_subject_ids?: string[]
          p_matter_id: string
          p_person_id: string
          p_role: Database["public"]["Enums"]["org_role"]
        }
        Returns: Json
      }
      create_practice_matter: {
        Args: { p_is_sample: boolean; p_title: string }
        Returns: Json
      }
      create_quote: {
        Args: { p_matter_id: string; p_template_id: string | null; p_title: string | null }
        Returns: string
      }
      create_quote_invoice: {
        Args: {
          p_agreement_id: string
          p_due_on: string
          p_idempotency_key: string
          p_tax_name: string | null
        }
        Returns: string
      }
      create_staff_invitation: {
        Args: {
          email: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Returns: string
      }
      create_support_access_request: {
        Args: {
          p_organization_id: string
          p_requester_name: string
          p_requester_email: string
          p_ticket_ref: string
          p_scope: Database["public"]["Enums"]["support_access_scope"]
          p_matter_id: string
          p_not_included: string
          p_reason: string
          p_minutes?: number
          p_requested_by_user_id?: string
        }
        Returns: string
      }
      create_task: {
        Args: {
          p_audience: Database["public"]["Enums"]["task_audience"]
          p_checklist: Json
          p_due_at: string | null
          p_due_on: string | null
          p_due_timezone: string
          p_estimated_minutes: number | null
          p_intake_field_key: string | null
          p_matter_id: string
          p_owner_membership_id: string | null
          p_owner_person_id: string | null
          p_priority: Database["public"]["Enums"]["task_priority"]
          p_title: string
        }
        Returns: string
      }
      create_time_invoice: {
        Args: {
          p_due_on: string
          p_entry_ids: string[] | null
          p_idempotency_key: string
          p_matter_id: string
          p_tax_name: string | null
        }
        Returns: string
      }
      create_upload_intent: {
        Args: {
          p_audience: Database["public"]["Enums"]["document_audience"]
          p_declared_byte_size: number
          p_document_id: string | null
          p_filename: string
          p_language_tag: string | null
          p_matter_id: string
          p_person_id: string
          p_purpose: string
          p_sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          p_translation_of_version_id: string | null
        }
        Returns: Json
      }
      deadline_local_end: {
        Args: { p_due_on: string; p_timezone: string }
        Returns: string
      }
      decide_lead_duplicate: {
        Args: {
          p_lead: string
          p_org: string
          p_other: string
          p_same_person: boolean
        }
        Returns: undefined
      }
      decide_migration_duplicate: {
        Args: { p_batch: string; p_org: string; p_row: number; p_same: boolean }
        Returns: Json
      }
      declare_consultant_credential: {
        Args: {
          p_college_id: string
          p_licence_type: Database["public"]["Enums"]["licence_type"]
          p_membership_id: string
          p_proof_locator: string
          p_scope_note: string
        }
        Returns: string
      }
      decline_agreement: {
        Args: {
          p_envelope_id: string
          p_idempotency_key: string
          p_ip: string
          p_user_agent: string
        }
        Returns: Json
      }
      decline_booking_agreement: { Args: { p_reason: string; p_ref: string }; Returns: Json }
      decline_client_transfer: {
        Args: {
          p_entry_id: string
          p_reason: string
        }
        Returns: string
      }
      decline_credit_note: {
        Args: { p_credit_note_id: string; p_reason: string }
        Returns: string
      }
      decline_portal_invitation: {
        Args: { p_token: string }
        Returns: Json
      }
      decline_support_access_request: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      discard_client_reconciliation: {
        Args: { p_reason: string; p_reconciliation_id: string }
        Returns: string
      }
      discard_invoice_draft: {
        Args: {
          p_invoice_id: string
          p_reason: string
        }
        Returns: undefined
      }
      discard_migration_batch: {
        Args: { p_batch: string; p_org: string }
        Returns: undefined
      }
      discard_time_entry: {
        Args: {
          p_entry_id: string
        }
        Returns: undefined
      }
      discard_vo_crm_draft: { Args: { p_draft_id: string }; Returns: undefined }
      discard_vo_doc_draft: { Args: { p_draft_id: string }; Returns: undefined }
      discard_vo_draft: { Args: { p_draft_id: string }; Returns: undefined }
      disconnect_firm_whatsapp: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      disconnect_staff_connection: { Args: { p_connection_id: string }; Returns: undefined }
      dismiss_inbound_email: {
        Args: { p_email_id: string; p_note?: string | null }
        Returns: undefined
      }
      dismiss_portal_notice: { Args: { p_notice_id: string }; Returns: undefined }
      dismiss_service_notice: { Args: { p_notice_id: string }; Returns: boolean }
      post_service_notice: {
        Args: {
          p_acting_admin?: string | null
          p_body: string
          p_ends_at?: string | null
          p_kind: string
          p_organization_ids?: string[] | null
          p_publish?: boolean
          p_severity: string
          p_starts_at?: string | null
          p_title: string
        }
        Returns: string
      }
      resolve_service_notice: {
        Args: { p_acting_admin?: string | null; p_notice_id: string; p_resolution_note: string }
        Returns: string
      }
      update_service_notice: {
        Args: {
          p_acting_admin?: string | null
          p_body?: string | null
          p_ends_at?: string | null
          p_notice_id: string
          p_publish?: boolean
          p_severity?: string | null
          p_starts_at?: string | null
          p_title?: string | null
        }
        Returns: string
      }
      dispute_evidence_context: {
        Args: {
          p_dispute_id: string
        }
        Returns: Json
      }
      document_request_progress: {
        Args: { p_matter_id: string }
        Returns: Json
      }
      document_upload_limit: { Args: { p_organization_id: string }; Returns: number }
      edit_agreement_clause: {
        Args: { p_agreement_id: string; p_body: string; p_clause_id: string }
        Returns: string
      }
      email_delivery_brands: {
        Args: { p_delivery_ids: string[] }
        Returns: Json
      }
      email_delivery_locales: {
        Args: { p_delivery_ids: string[] }
        Returns: Json
      }
      end_support_access: {
        Args: { p_id: string }
        Returns: undefined
      }
      end_tax_rate: {
        Args: {
          p_effective_to: string
          p_rate_id: string
        }
        Returns: undefined
      }
      enquiry_public_firm: { Args: { p_firm_slug: string }; Returns: Json }
      ensure_sample_case: { Args: never; Returns: string }
      escalate_overdue_work: {
        Args: { p_as_of: string }
        Returns: number
      }
      evaluate_real_client_invites: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      expire_booking_holds: {
        Args: { p_as_of?: string }
        Returns: number
      }
      extend_support_access: {
        Args: { p_id: string; p_minutes?: number }
        Returns: string
      }
      file_inbound_email: {
        Args: { p_email_id: string; p_matter_id: string; p_person_id: string }
        Returns: Json
      }
      file_inbound_email_to_matter: {
        Args: {
          p_email_id: string
          p_files: Json
          p_matter_id: string
          p_person_id: string
        }
        Returns: Json
      }
      finish_cicc_register_import: {
        Args: { p_import_id: string }
        Returns: Json
      }
      finish_email_delivery: {
        Args: {
          p_delivery_id: string
          p_error?: string
          p_outcome: string
          p_provider_message_id?: string
          p_worker: string
        }
        Returns: undefined
      }
      finish_inbound_attachments: {
        Args: { p_inbound_id: string }
        Returns: undefined
      }
      finish_unsorted_email_file: {
        Args: { p_header_hex: string; p_inbound_id: string; p_ordinal: number; p_sha256: string }
        Returns: Json
      }
      finish_verified_document_upload: {
        Args: {
          p_actor_user_id: string
          p_byte_size: number
          p_detected_media_type: string | null
          p_sha256: string
          p_version_id: string
        }
        Returns: Json
      }
      finish_vo_crm_run: {
        Args: {
          p_body?: string | null
          p_cost_usd?: number | null
          p_failure?: string | null
          p_input_tokens?: number | null
          p_latency_ms?: number | null
          p_left_out?: number
          p_model?: string | null
          p_needs_rule?: boolean
          p_output_tokens?: number | null
          p_prompt_version?: string | null
          p_result: Database["public"]["Enums"]["vo_run_result"]
          p_run_id: string
          p_sources?: Json | null
          p_title?: string | null
          p_tools?: string[] | null
        }
        Returns: string | null
      }
      finish_vo_document_review: {
        Args: {
          p_body?: string | null
          p_cost_usd?: number | null
          p_failure?: string | null
          p_input_tokens?: number | null
          p_latency_ms?: number | null
          p_model?: string | null
          p_needs_rule?: boolean
          p_output_tokens?: number | null
          p_prompt_version?: string | null
          p_proposals?: Json | null
          p_result: Database["public"]["Enums"]["vo_run_result"]
          p_run_id: string
          p_title?: string | null
          p_tools?: string[] | null
        }
        Returns: string | null
      }
      finish_vo_run: {
        Args: {
          p_body?: string | null
          p_cost_usd?: number | null
          p_failure?: string | null
          p_input_tokens?: number | null
          p_latency_ms?: number | null
          p_model?: string | null
          p_needs_rule?: boolean
          p_output_tokens?: number | null
          p_prompt_version?: string | null
          p_result: Database["public"]["Enums"]["vo_run_result"]
          p_run_id: string
          p_sources?: Json | null
          p_title?: string | null
          p_tools?: string[] | null
        }
        Returns: string | null
      }
      finish_whatsapp_delivery: {
        Args: {
          p_conversation_id?: string
          p_delivery_id: string
          p_error?: string
          p_outcome: string
          p_provider_message_id?: string
          p_worker: string
        }
        Returns: undefined
      }
      firm_access_grants: {
        Args: { p_organization_id: string }
        Returns: {
          created_at: string
          expires_at: string | null
          granted_by_grantee: boolean
          granted_by_name: string | null
          grantee_name: string
          id: string
          kind: Database["public"]["Enums"]["access_grant_kind"]
          matter_reference: string | null
          purpose: string
          revoked_at: string | null
          subject_name: string
        }[]
      }
      firm_payment_account_for_owner: {
        Args: { p_org: string }
        Returns: string | null
      }
      firm_staff_directory: {
        Args: { p_organization_id: string }
        Returns: {
          display_name: string | null
          email: string | null
          is_licensed: boolean
          is_self: boolean
          membership_id: string
          role: Database["public"]["Enums"]["org_role"]
          status: Database["public"]["Enums"]["membership_status"]
          two_step: boolean | null
        }[]
      }
      firm_staff_security: {
        Args: { p_organization_id: string }
        Returns: {
          active_sessions: number | null
          last_active_at: string | null
          membership_id: string
          passkeys: number | null
          second_factor: boolean
        }[]
      }
      firm_subscription: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      firm_subscription_usage: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      firm_support_access: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      firm_transfers_overview: { Args: { p_organization_id: string }; Returns: Json }
      firm_export_index: { Args: { p_organization_id: string }; Returns: Json }
      retention_deletion_overview: { Args: { p_organization_id: string }; Returns: Json }
      approve_deletion_job: {
        Args: { p_idempotency_key: string; p_matter_id: string; p_reason: string }
        Returns: string
      }
      service_claim_deletion_job: { Args: never; Returns: Json }
      service_deletion_item_ready: { Args: { p_item_id: string }; Returns: boolean }
      service_record_deletion_item: {
        Args: { p_item_id: string; p_outcome: string }
        Returns: boolean
      }
      service_finish_deletion_job: { Args: { p_job_id: string }; Returns: string }
      scheduled_reports_overview: { Args: { p_organization_id: string }; Returns: Json }
      save_scheduled_report: {
        Args: {
          p_organization_id: string
          p_schedule_id: string | null
          p_title: string
          p_tab: string
          p_range: string
          p_frequency: string
          p_weekday: number | null
          p_month_day: number | null
          p_send_time: string
          p_recipients: string[]
          p_expected_version?: number | null
        }
        Returns: string
      }
      set_scheduled_report_paused: {
        Args: { p_schedule_id: string; p_paused: boolean }
        Returns: boolean
      }
      delete_scheduled_report: { Args: { p_schedule_id: string }; Returns: boolean }
      run_scheduled_report_now: { Args: { p_schedule_id: string }; Returns: Json }
      service_run_scheduled_reports: { Args: { p_limit?: number }; Returns: Json }
      subscription_continuity: { Args: { p_organization_id: string }; Returns: Json }
      subscription_cancel_allowed: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      service_record_subscription_cancel: {
        Args: {
          p_actor: string
          p_cancel_at: string
          p_organization_id: string
          p_period_end: string | null
        }
        Returns: undefined
      }
      choose_subscription_end_arrangement: {
        Args: {
          p_arrangement: string
          p_organization_id: string
          p_transfer_id: string | null
        }
        Returns: undefined
      }
      freeze_intake_response: {
        Args: { p_response_id: string }
        Returns: undefined
      }
      generate_recovery_codes: {
        Args: never
        Returns: string[]
      }
      import_cicc_register: {
        Args: { p_import_id: string; p_rows: Json }
        Returns: number
      }
      import_leads: {
        Args: {
          p_file_name: string
          p_org: string
          p_rows: Json
        }
        Returns: Json
      }
      intake_response_forms: {
        Args: { p_response_ids: string[] }
        Returns: {
          locale: string
          response_id: string
          schema: Json
          template_id: string
          title: string
          version_number: number
        }[]
      }
      intake_template_usage: {
        Args: { p_organization_id: string }
        Returns: { matters: number; stable_key: string }[]
      }
      invoice_card_checkout_check: {
        Args: {
          p_invoice_id: string
        }
        Returns: Json
      }
      invoice_credit_note: {
        Args: { p_credit_note_id: string }
        Returns: Json
      }
      invoice_instalment: {
        Args: {
          p_due_on: string
          p_idempotency_key: string
          p_item_id: string
          p_tax_name: string | null
        }
        Returns: string
      }
      invoice_payment_context: {
        Args: { p_invoice_id: string }
        Returns: Json
      }
      invoice_payment_receipt: {
        Args: {
          p_receipt_id: string
        }
        Returns: Json
      }
      invoice_refund_context: {
        Args: { p_payment_id: string }
        Returns: Json
      }
      issue_booking_agreement_code: { Args: { p_code_id: string; p_code_sha256: string; p_ref: string; p_sealed: string }; Returns: Json }
      issue_credit_note: {
        Args: { p_credit_note_id: string }
        Returns: Json
      }
      issue_invoice_draft: {
        Args: {
          p_due_on: string | null
          p_invoice_id: string
        }
        Returns: Json
      }
      lead_conflict_matches: {
        Args: {
          p_lead: string
          p_org: string
        }
        Returns: Json
      }
      licence_review_log: {
        Args: { p_organization_id: string }
        Returns: {
          actor_is_platform: boolean
          actor_name: string | null
          at: string
          college_id: string
          credential_id: string
          holder_name: string | null
          kind: string
          result: string | null
        }[]
      }
      link_booking_to_lead: {
        Args: {
          p_booking: string
          p_lead: string
          p_org: string
        }
        Returns: undefined
      }
      link_client_credit_refund: {
        Args: {
          p_credit_id: string
          p_refund_id: string
        }
        Returns: string
      }
      link_correspondence_work: {
        Args: {
          p_correspondence_id: string
          p_deadline_id?: string | null
          p_task_id?: string | null
        }
        Returns: string
      }
      link_successor_matter: {
        Args: { p_predecessor_id: string; p_reason: string; p_successor_id: string }
        Returns: string
      }
      list_client_fund_parties: {
        Args: never
        Returns: {
          display_name: string
          is_sample: boolean
          matter_id: string
          organization_id: string
          person_id: string
          role: string
        }[]
      }
      list_client_fund_withdrawals: {
        Args: never
        Returns: {
          amount_cents: number
          days_left: number
          entry_id: string | null
          entry_number: string | null
          invoice_id: string
          invoice_number: string
          invoiced_on: string
          is_sample: boolean
          ledger_id: string | null
          matter_id: string
          organization_id: string
          overdue: boolean
          person_id: string | null
          state: string
          withdraw_by: string
        }[]
      }
      list_exportable_matter_ids: {
        Args: never
        Returns: { matter_id: string }[]
      }
      list_matter_billing: {
        Args: never
        Returns: {
          client_display_name: string | null
          matter_id: string
          organization_id: string
          stage: Database["public"]["Enums"]["matter_stage"]
          title: string
        }[]
      }
      list_my_sessions: {
        Args: never
        Returns: {
          aal: string | null
          created_at: string
          refreshed_at: string | null
          revoked: boolean
          session_id: string
          user_agent: string | null
        }[]
      }
      log_time_entry: {
        Args: {
          p_billable: boolean
          p_description: string
          p_matter_id: string
          p_minutes: number
          p_rate_cents: number
          p_worked_on: string
        }
        Returns: string
      }
      mark_government_checked: {
        Args: { p_correspondence_id: string | null; p_matter_id: string }
        Returns: string
      }
      mark_message_thread_read: {
        Args: { p_organization_id: string; p_thread_id: string }
        Returns: number
      }
      mark_staff_notifications_read: {
        Args: { p_ids?: string[] | null; p_organization_id: string }
        Returns: number
      }
      mark_vo_lead_follow_up_sent: {
        Args: { p_body: string; p_draft_id: string }
        Returns: string
      }
      matter_closure_check: {
        Args: { p_matter_id: string }
        Returns: Json
      }
      matter_inbound_address: {
        Args: { p_domain?: string; p_matter_id: string }
        Returns: Json
      }
      matter_time_invoices: {
        Args: { p_matter_id: string }
        Returns: {
          invoice_number: string
          invoice_status: string
          time_entry_id: string
        }[]
      }
      migration_column_values: {
        Args: { p_batch: string; p_column: number; p_org: string }
        Returns: Json
      }
      migration_rollback_check: {
        Args: { p_batch: string; p_org: string }
        Returns: Json
      }
      move_lead_stage: {
        Args: {
          p_expected_version: number
          p_lead: string
          p_org: string
          p_reason: string | null
          p_to_stage: string
        }
        Returns: number
      }
      note_booking_agreement_opened: { Args: { p_ref: string }; Returns: undefined }
      note_booking_agreement_request: { Args: { p_kind: string; p_ref: string }; Returns: Json }
      note_migration_commit_failure: {
        Args: { p_batch: string; p_org: string; p_reason: string }
        Returns: undefined
      }
      offboard_staff_member:
        | {
            Args: {
              p_membership_id: string
              p_organization_id: string
              p_receiver_membership_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_handover: Json
              p_membership_id: string
              p_organization_id: string
              p_receiver_membership_id: string
            }
            Returns: Json
          }
      open_intake_response: {
        Args: { p_matter_id: string; p_person_id: string; p_template_id: string }
        Returns: string
      }
      open_majority_review_task: {
        Args: { p_person_id: string }
        Returns: string
      }
      open_person_break_glass: {
        Args: { p_person_id: string; p_reason: string }
        Returns: string
      }
      open_unsorted_email_file: {
        Args: { p_byte_size: number; p_filename: string; p_inbound_id: string; p_ordinal: number }
        Returns: Json
      }
      override_matter_stage: {
        Args: {
          p_expected_version: number
          p_matter_id: string
          p_reason: string
          p_to_stage: Database["public"]["Enums"]["matter_stage"]
        }
        Returns: Json
      }
      perform_billing_action: {
        Args: { p_action: string; p_matter_id: string }
        Returns: string
      }
      place_legal_hold: {
        Args: { p_matter_id: string; p_reason: string }
        Returns: string
      }
      portal_booking_availability: {
        Args: { p_booking_id: string; p_from: string; p_org: string; p_to: string }
        Returns: Json
      }
      portal_booking_rules: {
        Args: { p_org: string }
        Returns: Json
      }
      portal_cancel_booking: {
        Args: { p_booking_id: string; p_expected_version: number | null; p_org: string; p_reason?: string | null }
        Returns: Json
      }
      portal_consultation_summaries: {
        Args: { p_org: string }
        Returns: { booking_id: string; shared_at: string; summary: string }[]
      }
      portal_matter_consultants: {
        Args: { p_org: string }
        Returns: { consultant_name: string | null; matter_id: string }[]
      }
      portal_notices_for_me: { Args: { p_org: string }; Returns: Json }
      announcement_audiences: { Args: { p_organization_id: string }; Returns: Json }
      approve_message_template: {
        Args: { p_expected_version: number; p_organization_id: string; p_template_id: string }
        Returns: Json
      }
      archive_message_template: {
        Args: { p_organization_id: string; p_template_id: string }
        Returns: undefined
      }
      mark_portal_announcements_seen: { Args: { p_org: string }; Returns: number }
      save_message_template: {
        Args: {
          p_body: string
          p_expected_version?: number | null
          p_name: string
          p_organization_id: string
          p_template_id: string | null
          p_title: string | null
          p_use_for: string
        }
        Returns: Json
      }
      send_announcement: {
        Args: {
          p_organization_id: string
          p_program_key?: string | null
          p_template_id: string
          p_template_version: number
        }
        Returns: Json
      }
      portal_reschedule_booking: {
        Args: { p_booking_id: string; p_expected_version: number | null; p_org: string; p_start: string; p_time_zone: string }
        Returns: undefined
      }
      prepare_client_reconciliation: {
        Args: {
          p_client_account_id: string
          p_idempotency_key: string
          p_note: string | null
          p_statement_balance_cents: number
          p_statement_date: string
        }
        Returns: string
      }
      prepare_email_delivery: {
        Args: {
          p_event_id: string
          p_from_address?: string
          p_inbound_domain?: string
          p_worker: string
        }
        Returns: Json
      }
      prepare_submission_handoff: {
        Args: {
          p_channel: Database["public"]["Enums"]["submission_channel"]
          p_matter_id: string
          p_package_label: string
          p_package_sha256?: string | null
        }
        Returns: string
      }
      prepare_whatsapp_delivery: {
        Args: { p_event_id: string; p_worker: string }
        Returns: Json
      }
      preview_invitation: {
        Args: { p_token: string }
        Returns: {
          email: string | null
          expires_at: string | null
          organization_name: string | null
          role: string | null
          status: string
        }[]
      }
      preview_invitation_inviter: {
        Args: { p_token: string }
        Returns: string | null
      }
      preview_portal_invitation: {
        Args: { p_token: string }
        Returns: Json
      }
      authorize_privacy_response_download: {
        Args: {
          p_delivery_id: string
        }
        Returns: Json
      }
      authorize_privacy_response_preview: {
        Args: {
          p_response_id: string
        }
        Returns: Json
      }
      decide_privacy_item: {
        Args: {
          p_decision: string
          p_fields: string[] | null
          p_item_id: string
          p_reason: string | null
          p_third_party: string | null
        }
        Returns: undefined
      }
      deliver_privacy_response: {
        Args: {
          p_note: string | null
          p_outcome: string
          p_request_id: string
          p_response_id: string
        }
        Returns: string
      }
      extend_privacy_request: {
        Args: {
          p_new_due_on: string
          p_notice_method: string | null
          p_reason: string
          p_recourse: string | null
          p_request_id: string
          p_time_limit_id: string | null
        }
        Returns: undefined
      }
      mark_privacy_notices_seen: {
        Args: {
          p_org: string
        }
        Returns: number
      }
      privacy_requests_for_me: {
        Args: {
          p_org: string
        }
        Returns: Json
      }
      privacy_scope_search: {
        Args: {
          p_request_id: string
        }
        Returns: Json
      }
      propose_privacy_time_limit: {
        Args: {
          p_checked_on: string
          p_current_to: string | null
          p_days: number | null
          p_kind: string
          p_law_name: string
          p_org: string
          p_provision_text: string
          p_snapshot: Json | null
          p_source_section: string
          p_source_url: string
        }
        Returns: string
      }
      retire_privacy_time_limit: {
        Args: {
          p_expected_version: number
          p_limit_id: string
          p_reason: string
        }
        Returns: number
      }
      review_privacy_time_limit: {
        Args: {
          p_decision: string
          p_expected_version: number
          p_limit_id: string
          p_note: string | null
          p_page_opened_on: string | null
        }
        Returns: number
      }
      service_complete_privacy_response: {
        Args: {
          p_byte_size: number
          p_contents: Json
          p_excluded: Json
          p_file_count: number
          p_manifest_sha256: string
          p_record_count: number
          p_response_id: string
          p_sha256: string
          p_storage_key: string
          p_withheld_count: number
        }
        Returns: boolean
      }
      service_fail_privacy_response: {
        Args: {
          p_reason: string
          p_response_id: string
        }
        Returns: undefined
      }
      start_privacy_response: {
        Args: {
          p_idempotency_key: string
          p_request_id: string
        }
        Returns: string
      }
      privacy_request_kept_records: {
        Args: { p_request_id: string }
        Returns: Json
      }
      propose_government_issuer: {
        Args: {
          p_checked_on: string
          p_modified_on: string | null
          p_name: string
          p_name_on_page: boolean | null
          p_org: string
          p_retrieved_at: string | null
          p_sha256: string | null
          p_source_url: string
        }
        Returns: string
      }
      public_privacy_notice: { Args: { p_firm_slug: string }; Returns: Json }
      publish_intake_draft: {
        Args: { p_expected_version: number; p_template_id: string }
        Returns: string
      }
      publish_portal_policy: {
        Args: { p_body: string; p_kind: string; p_title: string; p_version_label: string }
        Returns: string
      }
      quote_to_agreement: {
        Args: { p_agreement_id: string; p_template_id: string }
        Returns: string
      }
      rate_vo_run: { Args: { p_run_id: string; p_useful: boolean }; Returns: undefined }
      reassign_consultant_matters: {
        Args: {
          p_from_membership: string
          p_reason: string
          p_to_membership: string
        }
        Returns: number
      }
      reassign_consultant_matters_selected: {
        Args: {
          p_from_membership: string
          p_matter_ids: string[]
          p_reason: string
          p_to_membership: string
        }
        Returns: number
      }
      reassign_task: {
        Args: {
          p_expected_version: number
          p_owner_membership_id: string | null
          p_owner_person_id: string | null
          p_task_id: string
        }
        Returns: number
      }
      receive_whatsapp_message: {
        Args: {
          p_account_id: string
          p_bsuid: string
          p_conversation_id: string
          p_event_id: string
          p_has_attachments: boolean
          p_phone: string
          p_platform_message_id: string
          p_sender_name: string
          p_sent_at: string
          p_text: string
        }
        Returns: Json
      }
      record_client_credit_bank_refund: {
        Args: {
          p_amount_cents: number
          p_credit_id: string
          p_idempotency_key: string
          p_method: string
          p_reference: string
          p_refunded_on: string
        }
        Returns: string
      }
      record_client_deposit: {
        Args: {
          p_amount_cents: number
          p_client_account_id: string
          p_currency: string
          p_evidence: string | null
          p_idempotency_key: string
          p_matter_id: string
          p_method: string
          p_person_id: string
          p_received_on: string
          p_reference: string | null
        }
        Returns: string
      }
      record_client_fund_correction: {
        Args: {
          p_entry_id: string
          p_idempotency_key: string
          p_reason: string
        }
        Returns: string
      }
      record_client_refund: {
        Args: {
          p_amount_cents: number
          p_idempotency_key: string
          p_ledger_id: string
          p_method: string
          p_paid_on: string
          p_reason: string
          p_reference: string | null
        }
        Returns: string
      }
      record_client_transfer_bank: {
        Args: {
          p_entry_id: string
          p_note: string | null
          p_reference: string
          p_transferred_on: string
        }
        Returns: string
      }
      record_complaint: {
        Args: {
          p_assignee_membership_id: string
          p_category: string
          p_channel: string
          p_complainant_name: string
          p_idempotency_key: string
          p_issue: string
          p_matter_id: string | null
          p_org: string
          p_person_id: string | null
          p_received_on: string
        }
        Returns: string
      }
      record_complaint_step: {
        Args: { p_complaint_id: string; p_note: string | null; p_on: string | null; p_step: string }
        Returns: undefined
      }
      record_deadline: {
        Args: {
          p_calculation_note: string | null
          p_due_at: string | null
          p_due_on: string | null
          p_event_on: string | null
          p_evidence_locator: string | null
          p_kind: Database["public"]["Enums"]["deadline_kind"]
          p_label: string
          p_matter_id: string
          p_receipt_on: string | null
          p_rule_version_id: string | null
          p_source_retrieved_on: string | null
          p_source_url: string | null
          p_task_id: string | null
          p_timezone: string
        }
        Returns: string
      }
      record_decision: {
        Args: {
          p_authority_reasons?: string | null
          p_correspondence_id: string
          p_decided_on?: string | null
          p_milestone?: Database["public"]["Enums"]["decision_milestone"] | null
          p_outcome: Database["public"]["Enums"]["matter_outcome"]
        }
        Returns: string
      }
      record_decision_step: {
        Args: {
          p_decision_id: string
          p_note?: string | null
          p_step: Database["public"]["Enums"]["decision_step"]
        }
        Returns: string
      }
      record_dispute_evidence: {
        Args: {
          p_content_type: string
          p_dispute_id: string
          p_explanation: string
          p_file_name: string
          p_livemode: boolean
          p_size_bytes: number
          p_stripe_file_id: string
          p_submitted: boolean
        }
        Returns: string
      }
      record_document_custody: {
        Args: {
          p_acknowledged: boolean
          p_location: string | null
          p_purpose: string
          p_received_on: string | null
          p_recipient: string | null
          p_return_on: string | null
          p_version_id: string
        }
        Returns: string
      }
      record_firm_payment_account: {
        Args: { p_account_id: string; p_livemode: boolean; p_org: string }
        Returns: string
      }
      record_firm_transfer: {
        Args: {
          p_contact_email: string
          p_contact_name: string
          p_matter_ids: string[]
          p_note: string
          p_organization_id: string
          p_receiving_firm: string
        }
        Returns: string
      }
      record_processing_estimate: {
        Args: {
          p_application_type: string
          p_checked_on: string
          p_estimate: string
          p_matter_id: string
          p_retrieved_at: string | null
          p_sha256: string | null
          p_source_url: string
        }
        Returns: string
      }
      record_government_check: {
        Args: {
          p_matter_id: string
          p_note?: string | null
        }
        Returns: string
      }
      record_government_correspondence: {
        Args: {
          p_action_requested?: string | null
          p_channel: Database["public"]["Enums"]["correspondence_channel"]
          p_corrects_id?: string | null
          p_document_date?: string | null
          p_evidence_locator?: string | null
          p_evidence_version_id?: string | null
          p_issuer?: string | null
          p_kind: Database["public"]["Enums"]["correspondence_kind"]
          p_matter_id: string
          p_received_on: string
          p_reference_text?: string | null
          p_stated_deadline?: string | null
        }
        Returns: string
      }
      record_government_fee_snapshot: {
        Args: {
          p_org: string
          p_retrieved_at: string
          p_rows: Json
          p_sha256: string
          p_source_url: string
        }
        Returns: number
      }
      record_government_letter: {
        Args: {
          p_action_requested: string | null
          p_channel: Database["public"]["Enums"]["correspondence_channel"]
          p_document_date: string | null
          p_evidence_version_id: string | null
          p_issuer: string | null
          p_issuer_id: string | null
          p_kind: Database["public"]["Enums"]["correspondence_kind"]
          p_matter_id: string
          p_received_on: string
          p_stated_deadline: string | null
          p_tasks: Json
        }
        Returns: string
      }
      record_government_status: {
        Args: {
          p_expected_version: number
          p_matter_id: string
          p_note: string
          p_status: Database["public"]["Enums"]["government_status"]
        }
        Returns: number
      }
      record_invoice_payment_card: {
        Args: {
          p_account_id: string
          p_card_brand: string
          p_card_last4: string
          p_livemode: boolean
          p_payment_intent_id: string
        }
        Returns: Json
      }
      record_invoice_payment_intent: {
        Args: {
          p_account_id: string
          p_amount_cents: number
          p_application_fee_cents: number
          p_currency: string
          p_invoice_id: string
          p_livemode: boolean
          p_payment_intent_id: string
        }
        Returns: string
      }
      record_invoice_refund: {
        Args: {
          p_amount_cents: number
          p_currency: string
          p_idempotency_key: string | null
          p_livemode: boolean
          p_payment_id: string
          p_reason: string | null
          p_refund_id: string
        }
        Returns: string
      }
      record_lead_conflict_check: {
        Args: {
          p_expected_version: number
          p_lead: string
          p_note: string | null
          p_org: string
          p_result: Database["public"]["Enums"]["lead_conflict_result"]
        }
        Returns: number
      }
      record_lead_consent: {
        Args: {
          p_granted: boolean
          p_lead: string
          p_org: string
          p_purpose: Database["public"]["Enums"]["lead_consent_purpose"]
        }
        Returns: string
      }
      record_licence_check: {
        Args: {
          p_credential_id: string
          p_discipline_restricted: boolean
          p_discipline_restriction_detail: string
          p_discipline_revoked: boolean
          p_discipline_suspended: boolean
          p_entitlement_to_practise: boolean
          p_notes: string
          p_proof_locator: string
          p_register_status: Database["public"]["Enums"]["register_licence_status"]
          p_retrieved_at: string
          p_source_url: string
        }
        Returns: string
      }
      record_support_response: {
        Args: {
          p_first_response_at: string | null
          p_organization_id: string
          p_received_at: string
          p_recorded_by?: string | null
          p_ticket_ref: string
        }
        Returns: string
      }
      record_matter_engagement: {
        Args: {
          p_agreement_locator: string | null
          p_exception_reason: string | null
          p_matter_id: string
          p_scope: string
          p_use_exception: boolean
        }
        Returns: string
      }
      record_matter_outcome: {
        Args: {
          p_expected_version: number
          p_matter_id: string
          p_note: string
          p_outcome: Database["public"]["Enums"]["matter_outcome"]
        }
        Returns: number
      }
      record_matter_retention: {
        Args: {
          p_expected_version: number
          p_matter_id: string
          p_reason: string
          p_retention_on: string
        }
        Returns: number
      }
      record_person_identity: {
        Args: { p_data: Json; p_kind: string; p_person_id: string; p_replaces_id?: string; p_retire?: boolean }
        Returns: string
      }
      record_person_section: {
        Args: {
          p_matter_id: string
          p_person_id: string
          p_section_key: Database["public"]["Enums"]["person_section_key"]
          p_summary: string
        }
        Returns: string
      }
      record_privacy_request: {
        Args: {
          p_assignee_membership_id: string
          p_channel: string
          p_details: string
          p_idempotency_key: string
          p_kind: string
          p_matter_id: string | null
          p_org: string
          p_person_id: string | null
          p_received_on: string
          p_requester_name: string
        }
        Returns: string
      }
      record_privacy_step: {
        Args: { p_note: string; p_request_id: string; p_step: string }
        Returns: undefined
      }
      record_report_export:
        | {
            Args: { p_format: string; p_organization_id: string; p_range: string; p_tab: string }
            Returns: string
          }
        | {
            Args: { p_format: string; p_organization_id: string; p_range: string; p_segment: string | null; p_tab: string }
            Returns: string
          }
      record_representation_authority: {
        Args: {
          p_agreement_id: string | null
          p_effective_on: string
          p_evidence_locator: string
          p_matter_id: string
          p_person_id: string
          p_scope: string
        }
        Returns: string
      }
      record_submission: {
        Args: {
          p_acknowledged_on?: string | null
          p_expected_version: number
          p_external_reference: string
          p_handoff_id: string
          p_receipt_locator?: string | null
          p_receipt_version_id?: string | null
          p_submitted_at: string
          p_submitted_by_membership_id: string
        }
        Returns: number
      }
      record_subscription_customer: {
        Args: { p_organization_id: string; p_stripe_customer_id: string }
        Returns: undefined
      }
      record_whatsapp_status: {
        Args: { p_account_id: string; p_at?: string; p_error?: string; p_provider_message_id: string; p_status: string }
        Returns: boolean
      }
      reject_client_deposit: {
        Args: {
          p_entry_id: string
          p_reason: string
        }
        Returns: string
      }
      reject_vo_doc_proposal: { Args: { p_proposal_id: string }; Returns: Json }
      release_legal_hold: {
        Args: { p_hold_id: string; p_reason: string }
        Returns: undefined
      }
      remind_booking_agreement: { Args: { p_booking_id: string }; Returns: number }
      remove_firm_office: {
        Args: { p_office_id: string; p_organization_id: string }
        Returns: undefined
      }
      remove_invoice_line: {
        Args: {
          p_line_id: string
        }
        Returns: undefined
      }
      remove_task_dependency: {
        Args: { p_depends_on_task_id: string; p_task_id: string }
        Returns: boolean
      }
      remove_task_watcher: {
        Args: { p_membership_id: string; p_task_id: string }
        Returns: boolean
      }
      replace_external_busy_blocks: {
        Args: { p_blocks: Json; p_from: string; p_organization_id: string; p_source: string; p_to: string }
        Returns: number
      }
      report_licence_change: {
        Args: { p_credential_id: string; p_detail: string }
        Returns: string
      }
      report_portal_invitation_mismatch: {
        Args: { p_token: string }
        Returns: Json
      }
      request_client_transfer: {
        Args: {
          p_amount_cents: number
          p_idempotency_key: string
          p_invoice_id: string
          p_ledger_id: string
          p_note: string | null
        }
        Returns: string
      }
      request_credit_note: {
        Args: { p_amount_cents: number; p_idempotency_key: string; p_invoice_id: string; p_reason: string }
        Returns: string
      }
      request_intake_correction: {
        Args: {
          p_description: string | null
          p_field_key: string | null
          p_presence: Database["public"]["Enums"]["answer_presence"] | null
          p_proof_document_id: string | null
          p_reason: string | null
          p_response_id: string
          p_value: Json | null
        }
        Returns: Json
      }
      request_mfa_reset: {
        Args: { p_reason: string }
        Returns: string
      }
      resend_portal_invitation: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      reset_staff_mfa: {
        Args: {
          p_organization_id: string
          p_reason: string
          p_target_user_id: string
        }
        Returns: undefined
      }
      resolve_person_flag: {
        Args: { p_detail: string; p_flag_key: string; p_note: string; p_person_id: string }
        Returns: string
      }
      reuse_approved_facts: { Args: { p_response_id: string }; Returns: number }
      review_document_version: {
        Args: {
          p_annotations: string | null
          p_decision: Database["public"]["Enums"]["document_review_decision"]
          p_expected_version: number
          p_reason: string
          p_version_id: string
        }
        Returns: number
      }
      review_document_version_fr: {
        Args: {
          p_annotations: string | null
          p_decision: Database["public"]["Enums"]["document_review_decision"]
          p_expected_version: number
          p_machine_drafted: boolean
          p_model?: string | null
          p_reason: string
          p_reason_fr: string
          p_version_id: string
        }
        Returns: number
      }
      review_processing_estimate:
        | {
            Args: {
              p_decision: string
              p_estimate_id: string
              p_expected_version: number
              p_note: string | null
            }
            Returns: number
          }
        | {
            Args: {
              p_decision: string
              p_estimate_id: string
              p_expected_version: number
              p_note: string | null
              p_page_opened_on: string | null
            }
            Returns: number
          }
      review_firm_transfer_authority: {
        Args: { p_authorised: boolean; p_item_id: string; p_note: string }
        Returns: undefined
      }
      review_government_fee_snapshot: {
        Args: {
          p_decision: string
          p_note: string | null
          p_org: string
          p_sha256: string
        }
        Returns: number
      }
      review_government_issuer:
        | {
            Args: {
              p_decision: string
              p_expected_version: number
              p_issuer_id: string
              p_note: string | null
            }
            Returns: number
          }
        | {
            Args: {
              p_decision: string
              p_expected_version: number
              p_issuer_id: string
              p_note: string | null
              p_page_opened_on: string | null
            }
            Returns: number
          }
      review_intake_answer: {
        Args: { p_answer_id: string }
        Returns: string
      }
      revise_agreement: {
        Args: {
          p_agreement_id: string
          p_body: string
          p_comparison: string | null
          p_fee_cents: number | null
          p_government_fee_note: string | null
          p_scope: string
        }
        Returns: string
      }
      revise_deadline_due: {
        Args: {
          p_deadline_id: string
          p_due_at: string | null
          p_due_on: string | null
          p_expected_version: number
          p_timezone: string
        }
        Returns: number
      }
      revoke_access_grant: {
        Args: { p_grant_id: string; p_reason: string }
        Returns: undefined
      }
      revoke_my_session: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      revoke_other_sessions: {
        Args: never
        Returns: number
      }
      revoke_portal_invitation: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      revoke_representation_authority: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      revoke_staff_invitation: {
        Args: { invitation_id: string }
        Returns: undefined
      }
      rollback_migration_batch: {
        Args: { p_batch: string; p_org: string }
        Returns: Json
      }
      run_migration_dry_run: {
        Args: { p_batch: string; p_org: string }
        Returns: Json
      }
      save_availability: {
        Args: {
          p_membership_id: string
          p_org: string
          p_overrides: Json
          p_rules: Json
          p_time_zone: string
        }
        Returns: string
      }
      save_booking_event_type: {
        Args: {
          p_buffer_after_min: number
          p_buffer_before_min: number
          p_daily_capacity: number | null
          p_description: string | null
          p_duration_min: number
          p_event_type_id: string | null
          p_expected_version: number | null
          p_host_membership_ids: string[]
          p_location_detail: string | null
          p_location_kind: Database["public"]["Enums"]["booking_location_kind"]
          p_max_advance_days: number
          p_min_notice_min: number
          p_org: string
          p_publish: boolean
          p_slot_step_min: number | null
          p_slug: string
          p_title: string
        }
        Returns: string
      }
      save_consultation_summary: {
        Args: { p_body: string; p_booking_id: string; p_expected_version: number }
        Returns: number
      }
      save_firm_office: {
        Args: {
          p_address_line: string
          p_country_code: string
          p_is_primary: boolean
          p_label: string
          p_locality: string
          p_office_id: string | null
          p_organization_id: string
          p_postal_code: string
          p_region: string
          p_timezone: string | null
        }
        Returns: string
      }
      save_firm_setup: {
        Args: {
          p_payload: Json
          p_step: Database["public"]["Enums"]["firm_setup_step"]
        }
        Returns: undefined
      }
      save_firm_zernio_profile: {
        Args: { p_organization_id: string; p_profile_id: string }
        Returns: undefined
      }
      save_intake_answer: {
        Args: {
          p_expected_version: number
          p_field_key: string
          p_presence: Database["public"]["Enums"]["answer_presence"]
          p_response_id: string
          p_value: Json
        }
        Returns: string
      }
      save_intake_draft: {
        Args: {
          p_expected_version: number | null
          p_schema: Json
          p_stable_key: string
          p_template_id: string | null
          p_title: string
        }
        Returns: Json
      }
      save_intake_template: {
        Args: {
          p_effective_on: string | null
          p_locale: string
          p_publish: boolean
          p_rule_pack_version_id: string | null
          p_schema: Json
          p_stable_key: string
          p_title: string
          p_workflow_category: Database["public"]["Enums"]["intake_workflow_category"]
        }
        Returns: string
      }
      save_lead_stage: {
        Args: {
          p_label: string
          p_org: string
          p_position: number
          p_stage_id: string | null
        }
        Returns: string
      }
      save_migration_mapping: {
        Args: { p_batch: string; p_mapping: Json; p_org: string }
        Returns: undefined
      }
      save_my_contact_preferences: {
        Args: {
          p_deadline_reminders: boolean
          p_email_notices: boolean
          p_locale: string
          p_sms_notices: boolean
        }
        Returns: undefined
      }
      save_organization_office: {
        Args: {
          p_address_line: string
          p_country_code: string
          p_is_primary: boolean
          p_label: string
          p_locality: string
          p_postal_code: string
          p_region: string
        }
        Returns: string
      }
      save_portal_invitation_draft: {
        Args: { p_draft: Json; p_token: string }
        Returns: Json
      }
      save_privacy_redaction: {
        Args: {
          p_record_label: string | null
          p_redaction_id: string | null
          p_removed: string | null
          p_request_id: string
          p_state: string
          p_third_party: string | null
        }
        Returns: string
      }
      save_quote: {
        Args: {
          p_agreement_id: string
          p_deliverables: string | null
          p_exclusions: string | null
          p_fee_structure: string | null
          p_government_fee_note: string | null
          p_instalments: Json
          p_lines: Json
          p_quote_expires_on: string
          p_refund_policy: string | null
          p_scope: string
          p_services: string | null
        }
        Returns: string
      }
      save_vo_call_summary: {
        Args: { p_body: string; p_draft_id: string }
        Returns: string
      }
      save_staff_connection: {
        Args: {
          p_connected_account_id?: string | null
          p_mail_label?: string | null
          p_organization_id: string
          p_status: string
          p_toolkit: string
        }
        Returns: string
      }
      schedule_deadline_reminders: {
        Args: { p_as_of: string; p_deadline_id: string }
        Returns: number
      }
      seal_migration_batch: {
        Args: { p_batch: string; p_org: string }
        Returns: Json
      }
      select_matter_program: {
        Args: {
          p_expected_version: number
          p_matter_id: string
          p_reason: string
          p_rule_pack_version_id: string
        }
        Returns: number
      }
      send_agreement: {
        Args: {
          p_agreement_id: string
          p_expires_at: string | null
          p_idempotency_key: string
          p_signers: Json
        }
        Returns: Json
      }
      send_booking_agreement: {
        Args: { p_booking_id: string; p_template_id: string }
        Returns: string
      }
      send_intake_request: {
        Args: {
          p_due_on: string | null
          p_matter_id: string
          p_message: string | null
          p_person_id: string
          p_template_id: string
        }
        Returns: Json
      }
      send_matter_email: {
        Args: {
          p_body: string
          p_client_key?: string | null
          p_matter_id: string
          p_organization_id: string
          p_person_id: string
          p_reply_to_email_id?: string | null
        }
        Returns: Json
      }
      send_matter_message: {
        Args: {
          p_body: string
          p_client_key?: string | null
          p_document_ids?: string[] | null
          p_matter_id: string
          p_organization_id: string
          p_person_ids: string[] | null
          p_requires_ack?: boolean
          p_thread_id: string | null
        }
        Returns: Json
      }
      send_quote: {
        Args: { p_agreement_id: string }
        Returns: Json
      }
      send_vo_draft: {
        Args: { p_body: string; p_client_key?: string | null; p_draft_id: string }
        Returns: Json
      }
      service_complete_matter_export: {
        Args: {
          p_byte_size: number
          p_contents: Json
          p_excluded: Json
          p_export_id: string
          p_file_count: number
          p_manifest_sha256: string
          p_record_count: number
          p_sha256: string
          p_storage_key: string
        }
        Returns: boolean
      }
      service_fail_matter_export: {
        Args: { p_export_id: string; p_reason: string }
        Returns: undefined
      }
      service_matter_export_progress: {
        Args: { p_export_id: string; p_progress: number; p_stage: string }
        Returns: undefined
      }
      session_mfa_satisfied: {
        Args: never
        Returns: boolean
      }
      set_booking_type_agreement: {
        Args: { p_event_type_id: string; p_template_id: string | null }
        Returns: undefined
      }
      set_complaint_handlers: {
        Args: { p_membership_ids: string[]; p_org: string }
        Returns: number
      }
      set_compliance_settings: {
        Args: {
          p_complaint_ack_days: number | null
          p_complaint_escalation_text: string | null
          p_complaint_response_days: number | null
          p_org: string
          p_privacy_response_days: number | null
        }
        Returns: undefined
      }
      set_composio_enabled: {
        Args: { p_accept_disclosure: boolean; p_enabled: boolean; p_organization_id: string }
        Returns: undefined
      }
      set_credential_proof: {
        Args: { p_credential_id: string; p_proof_locator: string }
        Returns: string
      }
      set_credential_valid_until: {
        Args: { p_credential_id: string; p_valid_until: string | null }
        Returns: string
      }
      set_document_expiry: {
        Args: { p_expected_version: number; p_expires_on: string | null; p_version_id: string }
        Returns: number
      }
      set_document_upload_limit: {
        Args: { p_bytes: number }
        Returns: number
      }
      set_enquiry_page_enabled: {
        Args: { p_enabled: boolean; p_organization_id: string }
        Returns: undefined
      }
      set_firm_continuity: {
        Args: {
          p_email: string
          p_name: string
          p_organization_id: string
          p_succession_note: string
        }
        Returns: undefined
      }
      set_firm_reminder_offsets: {
        Args: { p_days: number[] }
        Returns: undefined
      }
      set_firm_retention_policy: {
        Args: {
          p_expected_version: number
          p_organization_id: string
          p_years: number
        }
        Returns: number
      }
      set_lead_source: {
        Args: {
          p_expected_version: number
          p_lead: string
          p_org: string
          p_source: Database["public"]["Enums"]["lead_source"]
        }
        Returns: number
      }
      set_matter_on_hold: {
        Args: {
          p_expected_version: number
          p_matter_id: string
          p_owner_membership_id: string
          p_reason: string
          p_review_on: string
        }
        Returns: number
      }
      set_migration_staging_days: {
        Args: { p_days: number; p_org: string }
        Returns: undefined
      }
      set_my_timezone: {
        Args: { p_organization_id: string; p_timezone: string }
        Returns: undefined
      }
      set_my_whatsapp_notices: {
        Args: { p_channel: Database["public"]["Enums"]["whatsapp_notice_channel"]; p_organization_id: string }
        Returns: Json
      }
      set_person_whatsapp: {
        Args: {
          p_channel: Database["public"]["Enums"]["whatsapp_notice_channel"]
          p_organization_id: string
          p_person_id: string
          p_phone: string
        }
        Returns: Json
      }
      set_product_setting: {
        Args: { p_key: string; p_value: Json }
        Returns: undefined
      }
      set_quiet_hours: {
        Args: { p_end: string | null; p_start: string | null }
        Returns: undefined
      }
      set_sample_mode: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      set_staff_notification_preference: {
        Args: { p_email: boolean; p_kind: string; p_organization_id: string }
        Returns: undefined
      }
      set_staff_suspended: {
        Args: {
          p_membership_id: string
          p_organization_id: string
          p_suspended: boolean
        }
        Returns: number
      }
      set_task_checklist: {
        Args: { p_checklist: Json; p_expected_version: number; p_task_id: string }
        Returns: number
      }
      set_task_status: {
        Args: {
          p_blocker_note: string | null
          p_expected_version: number
          p_status: Database["public"]["Enums"]["task_status"]
          p_task_id: string
        }
        Returns: number
      }
      set_vo_settings: {
        Args: { p_changes: Json; p_organization_id: string }
        Returns: Json
      }
      share_consultation_summary: {
        Args: { p_booking_id: string; p_expected_version: number }
        Returns: number
      }
      share_government_record: {
        Args: {
          p_id: string
          p_kind: string
        }
        Returns: undefined
      }
      sign_agreement: {
        Args: {
          p_consent: boolean
          p_envelope_id: string
          p_idempotency_key: string
          p_ip: string
          p_user_agent: string
        }
        Returns: Json
      }
      sign_booking_agreement:
        | {
            Args: { p_consent: boolean; p_ip: unknown; p_name: string; p_ref: string; p_sha256: string; p_user_agent: string }
            Returns: Json
          }
        | {
            Args: {
              p_consent: boolean
              p_ip: unknown
              p_name: string
              p_ref: string
              p_session_sha256: string
              p_sha256: string
              p_signature_image: string | null
              p_signature_kind: string
              p_user_agent: string
            }
            Returns: Json
          }
      sign_client_reconciliation: {
        Args: { p_notes: string | null; p_outcome: string; p_reconciliation_id: string }
        Returns: Json
      }
      sign_off_submission_handoff: {
        Args: {
          p_expected_version: number
          p_handoff_id: string
        }
        Returns: number
      }
      staff_book_consultation: {
        Args: {
          p_event_type_id: string
          p_idempotency_key: string
          p_org: string
          p_person_id: string
          p_start: string
          p_time_zone: string
        }
        Returns: string
      }
      staff_booking_availability: {
        Args: {
          p_event_type_id: string
          p_exclude_booking?: string | null
          p_from: string
          p_org: string
          p_to: string
        }
        Returns: Json
      }
      staff_cancel_booking: {
        Args: { p_booking_id: string; p_expected_version: number | null; p_org: string; p_reason: string | null }
        Returns: undefined
      }
      staff_notifications: {
        Args: { p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      staff_offboarding_preview: {
        Args: { p_membership_id: string; p_organization_id: string }
        Returns: Json
      }
      staff_record_booking_outcome: {
        Args: { p_booking_id: string; p_org: string; p_outcome: string }
        Returns: undefined
      }
      staff_reschedule_booking: {
        Args: { p_booking_id: string; p_expected_version: number | null; p_org: string; p_start: string }
        Returns: undefined
      }
      stage_migration_batch: {
        Args: {
          p_byte_size: number
          p_file_name: string
          p_headers: string[]
          p_org: string
          p_parsed_digest: string
          p_row_count: number
          p_source_sha256: string
        }
        Returns: string
      }
      start_cicc_register_import: {
        Args: {
          p_file_locator: string
          p_file_sha256: string
          p_imported_by?: string
          p_source_note: string
        }
        Returns: string
      }
      start_matter_export: {
        Args: { p_idempotency_key: string; p_matter_id: string }
        Returns: string
      }
      start_timer: {
        Args: {
          p_billable: boolean
          p_description: string
          p_matter_id: string
          p_rate_cents: number
        }
        Returns: string
      }
      stop_timer: {
        Args: {
          p_entry_id: string
        }
        Returns: number
      }
      submit_enquiry: {
        Args: {
          p_client_hash: string | null
          p_consent_version: string | null
          p_contact: string
          p_country_now: string | null
          p_firm_slug: string
          p_idempotency_key: string
          p_language: string | null
          p_marketing_consent: boolean
          p_marketing_statement: string | null
          p_name: string
          p_preferred_contact: string | null
          p_reply_consent: boolean
          p_reply_statement: string
          p_service_interest: string | null
          p_source: Database["public"]["Enums"]["lead_source"]
          p_attribution?: Json
        }
        Returns: Json
      }
      submit_intake_response: {
        Args: { p_expected_version: number; p_response_id: string }
        Returns: number
      }
      subscription_checkout_allowed: {
        Args: {
          p_extra_seats: number
          p_interval: Database["public"]["Enums"]["billing_interval"]
          p_organization_id: string
          p_plan: Database["public"]["Enums"]["subscription_plan"]
        }
        Returns: Json
      }
      service_level_report: {
        Args: { p_months?: number; p_organization_id: string }
        Returns: Json
      }
      subscription_entitlements: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      subscription_plan_catalog: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      subscription_portal_allowed: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      support_read_firm_settings: {
        Args: { p_request_id: string }
        Returns: Json
      }
      support_read_matter: {
        Args: { p_request_id: string; p_matter_id: string }
        Returns: Json
      }
      sync_firm_payment_account: {
        Args: {
          p_account_id: string
          p_card_payments_status: string
          p_org: string
          p_payouts_status: string
          p_requirements_due: number
        }
        Returns: undefined
      }
      sync_firm_payment_account_status: {
        Args: {
          p_account_id: string
          p_card_payments_status: string
          p_fees_collector?: string
          p_losses_collector?: string
          p_org: string
          p_payouts_status: string
          p_requirements: Json
        }
        Returns: undefined
      }
      sync_trial_status: {
        Args: never
        Returns: Database["public"]["Enums"]["subscription_status"]
      }
      transition_matter_stage: {
        Args: {
          p_expected_version: number
          p_matter_id: string
          p_reason: string
          p_to_stage: Database["public"]["Enums"]["matter_stage"]
        }
        Returns: number
      }
      unlink_document_matter: {
        Args: { p_reason: string; p_ref_id: string }
        Returns: undefined
      }
      update_firm_profile: {
        Args: { p_changes: Json; p_organization_id: string }
        Returns: undefined
      }
      update_lead: {
        Args: {
          p_country_now: string | null
          p_date_of_birth: string | null
          p_email: string | null
          p_expected_version: number
          p_language: string | null
          p_lead: string
          p_name: string
          p_org: string
          p_owner_membership_id: string | null
          p_phone: string | null
          p_preferred_contact: string | null
          p_proposed_fee_cents: number | null
          p_service_interest: string | null
          p_source_detail: string | null
          p_tags: string[]
        }
        Returns: number
      }
      update_task: {
        Args: {
          p_due_on: string | null
          p_expected_version: number
          p_priority: Database["public"]["Enums"]["task_priority"] | null
          p_task_id: string
          p_title: string
        }
        Returns: number
      }
      update_task_details: {
        Args: {
          p_due_time: string | null
          p_due_timezone: string | null
          p_estimated_minutes: number | null
          p_expected_version: number
          p_recurrence: string | null
          p_task_id: string
        }
        Returns: number
      }
      verify_booking_agreement_code: { Args: { p_code_sha256: string; p_ref: string; p_session_sha256: string }; Returns: Json }
      verify_client_deposit: {
        Args: {
          p_entry_id: string
        }
        Returns: string
      }
      verify_government_correspondence: {
        Args: {
          p_correspondence_id: string
          p_expected_version: number
        }
        Returns: number
      }
      verify_submission_receipt: {
        Args: {
          p_acknowledged_on?: string | null
          p_expected_version: number
          p_handoff_id: string
          p_receipt_locator?: string | null
          p_receipt_version_id?: string | null
        }
        Returns: number
      }
      video_admit: {
        Args: { p_admit: boolean; p_identity: string; p_org: string; p_ref: string }
        Returns: Json
      }
      video_end: {
        Args: { p_org: string; p_ref: string }
        Returns: Json
      }
      video_join: {
        Args: { p_issue?: boolean; p_org: string; p_ref: string }
        Returns: Json
      }
      video_room_created: {
        Args: { p_org: string; p_ref: string }
        Returns: undefined
      }
      void_agreement_envelope: {
        Args: { p_envelope_id: string; p_reason: string }
        Returns: undefined
      }
      void_booking_agreement: {
        Args: { p_booking_id: string; p_reason: string }
        Returns: undefined
      }
      void_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: Json
      }
      waive_document_request: {
        Args: { p_expected_version: number; p_reason: string; p_request_id: string }
        Returns: number
      }
      withdraw_intake_form: {
        Args: { p_stable_key: string }
        Returns: Json
      }
      withdraw_section_share: {
        Args: { p_share_id: string }
        Returns: undefined
      }
      write_off_invoice: {
        Args: {
          p_amount_cents: number
          p_idempotency_key: string
          p_invoice_id: string
          p_reason: string
        }
        Returns: Json
      }
    }
    Enums: {
      message_channel: "portal" | "whatsapp"
      whatsapp_account_status: "pending" | "connected" | "disconnected"
      whatsapp_consent_source: "portal" | "staff"
      whatsapp_delivery_status: "sending" | "sent" | "delivered" | "read" | "failed" | "skipped"
      whatsapp_notice_channel: "email" | "whatsapp" | "both"
      access_grant_kind: "explicit" | "guardian"
      agreement_kind: "quote" | "consultation" | "service" | "amendment" | "consent"
      agreement_signer_role: "client" | "consultant" | "sponsor" | "dependant" | "guardian" | "firm"
      agreement_signer_status: "waiting" | "current" | "signed" | "declined"
      agreement_status:
        | "draft"
        | "sent"
        | "partially_signed"
        | "completed"
        | "declined"
        | "expired"
        | "voided"
        | "superseded"
        | "accepted"
      agreement_clause_source: "template" | "edited"
      quote_line_category: "professional_fee" | "tax" | "disbursement" | "government_fee"
      quote_paid_as: "advance" | "invoice_after_delivery"
      answer_date_kind: "exact" | "year_month" | "year"
      answer_presence: "provided" | "unknown" | "not_applicable" | "approximate"
      booking_actor: "client" | "staff" | "system"
      booking_location_kind: "video" | "phone" | "in_person" | "meeting_link"
      booking_status:
        | "held"
        | "pending_payment"
        | "confirmed"
        | "cancelled"
        | "expired"
        | "no_show"
        | "completed"
      client_fund_entry_kind: "deposit" | "transfer" | "refund" | "correction"
      client_fund_entry_status:
        | "pending_verification"
        | "verified"
        | "rejected"
        | "pending_approval"
        | "approved"
        | "declined"
        | "recorded"
      client_fund_method: "bank_transfer" | "interac_e_transfer" | "cheque" | "cash"
      client_reconciliation_status: "pending_review" | "reconciled" | "exceptions" | "discarded"
      complaint_category: "fees_billing" | "communication" | "service_quality" | "conduct" | "privacy" | "other"
      compliance_channel: "email" | "phone" | "letter" | "in_person" | "portal" | "other"
      consent_purpose:
        | "portal_terms"
        | "privacy_notice"
        | "processing"
        | "contact_email"
        | "contact_sms"
        | "deadline_reminder"
        | "share_section"
        | "ai_drafting"
        | "participation_declined"
        | "electronic_signature"
        | "marketing"
      correspondence_channel:
        | "portal_message"
        | "email"
        | "mail"
        | "courier"
        | "in_person"
        | "other"
      correspondence_kind:
        | "acknowledgement"
        | "application_number"
        | "request"
        | "biometrics_instruction"
        | "procedural_fairness"
        | "status_update"
        | "decision"
        | "other"
      credential_status:
        | "declared"
        | "verified"
        | "not_entitled"
        | "inactive"
        | "suspended"
        | "revoked"
      credit_note_status: "draft" | "issued" | "declined"
      date_precision: "day" | "month" | "year"
      deadline_kind: "legal" | "correspondence" | "internal"
      deadline_verification: "tentative" | "confirmed"
      decision_follow_up_kind:
        | "refusal_review"
        | "client_explanation"
        | "next_steps_meeting"
        | "conditions_summary"
        | "document_delivery"
        | "expiry_reminder"
        | "account_reconciliation"
        | "closure_checklist"
      decision_milestone:
        | "approval_in_principle"
        | "final_approval"
        | "documents_issued"
        | "arrival_confirmed"
        | "status_expiry_recorded"
        | "other"
      decision_record_state:
        | "awaiting_confirmation"
        | "confirmed"
      decision_step:
        | "withdrawal_instructions"
        | "consultant_review"
        | "withdrawal_request_sent"
        | "acknowledgement_received"
        | "financial_reconciliation"
      document_audience: "subject" | "matter" | "staff"
      document_request_source: "rule" | "staff"
      document_request_status: "open" | "fulfilled" | "waived" | "cancelled"
      document_review_decision: "accepted" | "changes_requested"
      document_review_state: "pending" | "accepted" | "rejected"
      document_sensitivity: "ordinary" | "narrative" | "medical" | "criminal"
      document_upload_state: "uploading" | "scanning" | "quarantined" | "clean" | "failed"
      domain_match_kind: "exact" | "suffix"
      email_delivery_status:
        | "pending"
        | "sending"
        | "sent"
        | "queued"
        | "bounced"
        | "suppressed"
        | "skipped"
        | "failed"
      email_template:
        | "invite"
        | "reminder"
        | "agreement"
        | "signature"
        | "document_request"
        | "document_receipt"
        | "invoice"
        | "payment_failed"
        | "refund_started"
        | "refund_complete"
        | "consultation_booked"
        | "consultation_rescheduled"
        | "consultation_cancelled"
        | "signing_code"
        | "message"
        | "staff_message"
        | "support_requested"
        | "support_granted"
        | "consultant_changed"
        | "enquiry_received"
        | "announcement"
      engagement_status: "pending" | "engaged" | "exception" | "ended"
      firm_setup_step:
        | "firm_details"
        | "terms_and_privacy"
        | "jurisdictions"
        | "licence"
        | "branding"
        | "calendar_and_payments"
        | "records_and_retention"
        | "sample_case"
      government_status:
        | "not_recorded"
        | "receipt_on_file"
        | "processing_reported"
        | "additional_request_open"
        | "decision_evidence_on_file"
      intake_field_type:
        | "text"
        | "date"
        | "country"
        | "address"
        | "repeatable"
        | "relationship"
        | "declaration"
        | "file_request"
        | "choice"
      intake_fact_reuse_status: "needs_reconfirmation" | "confirmed" | "replaced"
      intake_response_status: "draft" | "submitted"
      intake_template_status: "draft" | "published" | "superseded"
      intake_workflow_category:
        | "temporary_residence"
        | "study"
        | "work"
        | "permanent_residence"
        | "sponsorship"
        | "citizenship"
        | "provincial"
        | "unspecified"
      invoice_dispute_status:
        | "warning_needs_response"
        | "warning_under_review"
        | "warning_closed"
        | "needs_response"
        | "under_review"
        | "won"
        | "lost"
        | "prevented"
      invoice_payment_status:
        | "requires_payment"
        | "processing"
        | "succeeded"
        | "failed"
        | "canceled"
      invoice_refund_status:
        | "pending"
        | "requires_action"
        | "succeeded"
        | "failed"
        | "canceled"
      invoice_status:
        | "draft"
        | "issued"
        | "partially_paid"
        | "paid"
        | "voided"
        | "credited"
        | "refunded"
      lead_conflict_result: "not_checked" | "clear" | "possible_conflict" | "conflict"
      lead_consent_purpose: "enquiry_reply" | "marketing"
      lead_source:
        | "web_form"
        | "hosted_page"
        | "booking_page"
        | "phone"
        | "email"
        | "referral"
        | "event"
        | "walk_in"
        | "csv_import"
        | "other"
      lead_stage_kind: "open" | "converted" | "lost" | "archived"
      licence_check_result: "verified" | "not_entitled" | "inactive" | "suspended" | "revoked" | "needs_review"
      licence_type: "RCIC" | "RISIA"
      matter_export_status: "building" | "ready" | "failed" | "cancelled"
      matter_outcome:
        | "approved"
        | "refused"
        | "withdrawn"
        | "returned_or_incomplete"
        | "abandoned"
        | "other_verified"
      matter_party_role:
        | "applicant"
        | "dependant"
        | "sponsor"
        | "employer"
        | "guardian"
        | "consultant"
        | "case_manager"
        | "assistant"
      manual_payment_status: "pending_verification" | "verified" | "rejected" | "reversed" | "failed"
      matter_stage:
        | "engagement_pending"
        | "intake"
        | "evidence_collection"
        | "preparation"
        | "consultant_review"
        | "client_confirmation"
        | "ready_to_submit"
        | "submitted"
        | "government_processing"
        | "decision_review"
        | "post_decision"
        | "closed"
      matter_stage_evidence_kind:
        | "engagement_prerequisites"
        | "service_agreement"
        | "service_agreement_exception"
        | "questionnaire_assigned"
        | "facts_reviewed"
        | "draft_package"
        | "client_review_package"
        | "submission_approvals"
        | "submission_confirmation"
        | "verified_submission"
        | "official_decision"
        | "outcome_and_follow_up"
        | "closure"
      membership_status: "invited" | "active" | "suspended" | "revoked"
      migration_batch_status:
        | "staged"
        | "checked"
        | "committing"
        | "committed"
        | "rolled_back"
        | "discarded"
      migration_row_plan: "create" | "link" | "confirm" | "review" | "error" | "skip"
      org_role:
        | "firm_owner"
        | "licensed_consultant"
        | "case_manager"
        | "assistant"
        | "finance_user"
        | "client"
        | "adult_dependant"
        | "sponsor"
        | "employer_contact"
        | "guardian"
        | "external_collaborator"
      org_verification_status:
        | "unverified"
        | "pending_review"
        | "verified"
        | "restricted"
      outbox_status:
        | "pending"
        | "processing"
        | "published"
        | "failed"
        | "dead_lettered"
      person_relationship_type:
        | "spouse"
        | "parent"
        | "child"
        | "payer"
        | "sponsor"
        | "household"
        | "other"
      person_identity_kind: "name" | "passport" | "address"
      person_section_key:
        | "passport_bio"
        | "school_transcript"
        | "police_certificate"
        | "shared_family_record"
        | "private_record"
      privacy_redaction_state: "to_do" | "redacted" | "excluded" | "kept"
      privacy_request_kind: "access" | "correction" | "consent_withdrawal" | "deletion"
      privacy_request_outcome: "fulfilled" | "partly_fulfilled" | "refused" | "withdrawn"
      register_licence_status: "active" | "inactive"
      reminder_status: "pending" | "sent" | "cancelled"
      review_decision:
        | "approved"
        | "rejected"
        | "changes_requested"
        | "abstained"
      rule_category:
        | "immigration_requirement"
        | "professional_obligation"
        | "privacy_requirement"
        | "product_control"
      rule_impact_disposition:
        | "open"
        | "acknowledged"
        | "reassessed"
        | "dismissed"
      rule_publication_status:
        | "draft"
        | "evidence_captured"
        | "professional_review"
        | "approved"
        | "published"
        | "review_due"
        | "suspended"
        | "superseded"
        | "rejected"
      sample_proof_step: "intake" | "agreement" | "upload" | "reminder" | "invoice" | "export"
      signature_event_kind: "sent" | "signed" | "declined" | "voided" | "expired" | "completed" | "superseded" | "replayed"
      snapshot_review_status:
        | "draft"
        | "evidence_captured"
        | "verified"
        | "rejected"
        | "superseded"
      source_change_state: "unknown" | "unchanged" | "change_detected"
      source_content_kind:
        | "legislation"
        | "regulation"
        | "program_guidance"
        | "ministerial_instruction"
        | "public_policy"
        | "form_instruction"
        | "checklist"
        | "fee_schedule"
        | "processing_time_tool"
        | "professional_rule"
        | "privacy_guidance"
        | "other_official"
      source_discovery_status: "candidate" | "active" | "archived" | "suspended"
      source_observation:
        | "success"
        | "unchanged"
        | "changed"
        | "partial"
        | "failed"
        | "blocked"
      source_review_status:
        | "unverified"
        | "evidence_captured"
        | "in_review"
        | "verified"
        | "review_due"
        | "suspended"
      submission_channel:
        | "online_portal"
        | "paper"
        | "email"
        | "in_person"
        | "other"
      submission_handoff_status:
        | "awaiting_signoff"
        | "authorized"
        | "submission_unverified"
        | "submission_verified"
        | "cancelled"
      subscription_status:
        | "trial"
        | "trial_ended"
        | "active"
        | "cancelled"
        | "past_due"
        | "restricted"
        | "archived"
      subscription_plan: "solo" | "practice" | "firm" | "enterprise"
      billing_interval: "month" | "year"
      support_access_scope: "firm_settings" | "matter_documents" | "matter_records" | "matter_all" | "records_set"
      support_access_status: "pending" | "approved" | "declined" | "expired" | "ended" | "cancelled"
      task_audience: "internal" | "client"
      task_priority: "low" | "normal" | "high" | "critical"
      task_status: "open" | "blocked" | "done" | "cancelled"
      vo_draft_kind:
        | "message_reply"
        | "document_request"
        | "document_review"
        | "lead_follow_up"
        | "call_summary"
      vo_draft_status: "draft" | "sent" | "discarded" | "reviewed"
      vo_proposal_kind: "classification" | "field" | "missing_field" | "inconsistency" | "deadline" | "needs_rule"
      vo_proposal_status: "proposed" | "accepted" | "rejected"
      vo_run_kind:
        | "message_reply"
        | "document_request"
        | "ask"
        | "document_review"
        | "letter_draft"
        | "lead_follow_up"
        | "call_summary"
      vo_run_result: "running" | "drafted" | "answered" | "abstained" | "failed"
      webhook_inbox_status:
        | "received"
        | "processing"
        | "processed"
        | "ignored"
        | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      message_channel: ["portal", "whatsapp"],
      whatsapp_account_status: ["pending", "connected", "disconnected"],
      whatsapp_consent_source: ["portal", "staff"],
      whatsapp_delivery_status: ["sending", "sent", "delivered", "read", "failed", "skipped"],
      whatsapp_notice_channel: ["email", "whatsapp", "both"],
      booking_actor: ["client", "staff", "system"],
      booking_location_kind: ["video", "phone", "in_person", "meeting_link"],
      booking_status: ["held", "pending_payment", "confirmed", "cancelled", "expired", "no_show", "completed"],
      invoice_status: ["draft", "issued", "partially_paid", "paid", "voided", "credited", "refunded"],
      invoice_payment_status: ["requires_payment", "processing", "succeeded", "failed", "canceled"],
      client_fund_entry_kind: ["deposit", "transfer", "refund", "correction"],
      client_fund_entry_status: ["pending_verification", "verified", "rejected", "pending_approval", "approved", "declined", "recorded"],
      client_fund_method: ["bank_transfer", "interac_e_transfer", "cheque", "cash"],
      client_reconciliation_status: ["pending_review", "reconciled", "exceptions", "discarded"],
      credit_note_status: ["draft", "issued", "declined"],
      invoice_refund_status: ["pending", "requires_action", "succeeded", "failed", "canceled"],
      invoice_dispute_status: [
        "warning_needs_response",
        "warning_under_review",
        "warning_closed",
        "needs_response",
        "under_review",
        "won",
        "lost",
        "prevented",
      ],
      email_delivery_status: [
        "pending",
        "sending",
        "sent",
        "queued",
        "bounced",
        "suppressed",
        "skipped",
        "failed",
      ],
      email_template: [
        "invite",
        "reminder",
        "agreement",
        "signature",
        "document_request",
        "document_receipt",
        "invoice",
        "payment_failed",
        "refund_started",
        "refund_complete",
        "consultation_booked",
        "consultation_rescheduled",
        "consultation_cancelled",
        "signing_code",
        "staff_message",
        "support_requested",
        "support_granted",
        "consultant_changed",
        "enquiry_received",
        "announcement",
      ],
      access_grant_kind: ["explicit", "guardian"],
      agreement_kind: ["quote", "consultation", "service", "amendment", "consent"],
      agreement_status: [
        "draft",
        "sent",
        "partially_signed",
        "completed",
        "declined",
        "expired",
        "voided",
        "superseded",
        "accepted",
      ],
      agreement_clause_source: ["template", "edited"],
      quote_line_category: ["professional_fee", "tax", "disbursement", "government_fee"],
      quote_paid_as: ["advance", "invoice_after_delivery"],
      agreement_signer_role: ["client", "consultant", "sponsor", "dependant", "guardian", "firm"],
      agreement_signer_status: ["waiting", "current", "signed", "declined"],
      signature_event_kind: ["sent", "signed", "declined", "voided", "expired", "completed", "superseded", "replayed"],
      consent_purpose: [
        "portal_terms",
        "privacy_notice",
        "processing",
        "contact_email",
        "contact_sms",
        "deadline_reminder",
        "share_section",
        "ai_drafting",
        "participation_declined",
        "electronic_signature",
        "marketing",
      ],
      person_identity_kind: ["name", "passport", "address"],
      person_section_key: [
        "passport_bio",
        "school_transcript",
        "police_certificate",
        "shared_family_record",
        "private_record",
      ],
      date_precision: ["day", "month", "year"],
      credential_status: ["declared", "verified", "not_entitled", "inactive", "suspended", "revoked"],
      domain_match_kind: ["exact", "suffix"],
      firm_setup_step: [
        "firm_details",
        "terms_and_privacy",
        "jurisdictions",
        "licence",
        "branding",
        "calendar_and_payments",
        "records_and_retention",
        "sample_case",
      ],
      licence_check_result: ["verified", "not_entitled", "inactive", "suspended", "revoked", "needs_review"],
      licence_type: ["RCIC", "RISIA"],
      register_licence_status: ["active", "inactive"],
      sample_proof_step: ["intake", "agreement", "upload", "reminder", "invoice", "export"],
      subscription_status: [
        "trial",
        "trial_ended",
        "active",
        "cancelled",
        "past_due",
        "restricted",
        "archived",
      ],
      subscription_plan: ["solo", "practice", "firm", "enterprise"],
      billing_interval: ["month", "year"],
      support_access_scope: ["firm_settings", "matter_documents", "matter_records", "matter_all", "records_set"],
      support_access_status: ["pending", "approved", "declined", "expired", "ended", "cancelled"],
      matter_party_role: [
        "applicant",
        "dependant",
        "sponsor",
        "employer",
        "guardian",
        "consultant",
        "case_manager",
        "assistant",
      ],
      migration_batch_status: ["staged", "checked", "committing", "committed", "rolled_back", "discarded"],
      migration_row_plan: ["create", "link", "confirm", "review", "error", "skip"],
      manual_payment_status: ["pending_verification", "verified", "rejected", "reversed", "failed"],
      matter_stage: [
        "engagement_pending",
        "intake",
        "evidence_collection",
        "preparation",
        "consultant_review",
        "client_confirmation",
        "ready_to_submit",
        "submitted",
        "government_processing",
        "decision_review",
        "post_decision",
        "closed",
      ],
      matter_stage_evidence_kind: [
        "engagement_prerequisites",
        "service_agreement",
        "service_agreement_exception",
        "questionnaire_assigned",
        "facts_reviewed",
        "draft_package",
        "client_review_package",
        "submission_approvals",
        "submission_confirmation",
        "verified_submission",
        "official_decision",
        "outcome_and_follow_up",
        "closure",
      ],
      engagement_status: ["pending", "engaged", "exception", "ended"],
      government_status: [
        "not_recorded",
        "receipt_on_file",
        "processing_reported",
        "additional_request_open",
        "decision_evidence_on_file",
      ],
      matter_outcome: [
        "approved",
        "refused",
        "withdrawn",
        "returned_or_incomplete",
        "abandoned",
        "other_verified",
      ],
      intake_workflow_category: [
        "temporary_residence",
        "study",
        "work",
        "permanent_residence",
        "sponsorship",
        "citizenship",
        "provincial",
        "unspecified",
      ],
      intake_template_status: ["draft", "published", "superseded"],
      intake_fact_reuse_status: ["needs_reconfirmation", "confirmed", "replaced"],
      intake_response_status: ["draft", "submitted"],
      intake_field_type: [
        "text",
        "date",
        "country",
        "address",
        "repeatable",
        "relationship",
        "declaration",
        "file_request",
        "choice",
      ],
      answer_presence: ["provided", "unknown", "not_applicable", "approximate"],
      answer_date_kind: ["exact", "year_month", "year"],
      task_audience: ["internal", "client"],
      task_priority: ["low", "normal", "high", "critical"],
      task_status: ["open", "blocked", "done", "cancelled"],
      deadline_kind: ["legal", "correspondence", "internal"],
      deadline_verification: ["tentative", "confirmed"],
      document_audience: ["subject", "matter", "staff"],
      document_request_source: ["rule", "staff"],
      document_request_status: ["open", "fulfilled", "waived", "cancelled"],
      document_review_decision: ["accepted", "changes_requested"],
      document_review_state: ["pending", "accepted", "rejected"],
      document_sensitivity: ["ordinary", "narrative", "medical", "criminal"],
      document_upload_state: ["uploading", "scanning", "quarantined", "clean", "failed"],
      reminder_status: ["pending", "sent", "cancelled"],
      membership_status: ["invited", "active", "suspended", "revoked"],
      org_role: [
        "firm_owner",
        "licensed_consultant",
        "case_manager",
        "assistant",
        "finance_user",
        "client",
        "adult_dependant",
        "sponsor",
        "employer_contact",
        "guardian",
        "external_collaborator",
      ],
      org_verification_status: [
        "unverified",
        "pending_review",
        "verified",
        "restricted",
      ],
      outbox_status: [
        "pending",
        "processing",
        "published",
        "failed",
        "dead_lettered",
      ],
      person_relationship_type: [
        "spouse",
        "parent",
        "child",
        "payer",
        "sponsor",
        "household",
        "other",
      ],
      review_decision: [
        "approved",
        "rejected",
        "changes_requested",
        "abstained",
      ],
      rule_category: [
        "immigration_requirement",
        "professional_obligation",
        "privacy_requirement",
        "product_control",
      ],
      rule_impact_disposition: [
        "open",
        "acknowledged",
        "reassessed",
        "dismissed",
      ],
      rule_publication_status: [
        "draft",
        "evidence_captured",
        "professional_review",
        "approved",
        "published",
        "review_due",
        "suspended",
        "superseded",
        "rejected",
      ],
      snapshot_review_status: [
        "draft",
        "evidence_captured",
        "verified",
        "rejected",
        "superseded",
      ],
      source_change_state: ["unknown", "unchanged", "change_detected"],
      source_content_kind: [
        "legislation",
        "regulation",
        "program_guidance",
        "ministerial_instruction",
        "public_policy",
        "form_instruction",
        "checklist",
        "fee_schedule",
        "processing_time_tool",
        "professional_rule",
        "privacy_guidance",
        "other_official",
      ],
      source_discovery_status: ["candidate", "active", "archived", "suspended"],
      source_observation: [
        "success",
        "unchanged",
        "changed",
        "partial",
        "failed",
        "blocked",
      ],
      source_review_status: [
        "unverified",
        "evidence_captured",
        "in_review",
        "verified",
        "review_due",
        "suspended",
      ],
      vo_draft_kind: [
        "message_reply",
        "document_request",
        "document_review",
        "lead_follow_up",
        "call_summary",
      ],
      vo_draft_status: ["draft", "sent", "discarded", "reviewed"],
      vo_proposal_kind: ["classification", "field", "missing_field", "inconsistency", "deadline", "needs_rule"],
      vo_proposal_status: ["proposed", "accepted", "rejected"],
      vo_run_kind: [
        "message_reply",
        "document_request",
        "ask",
        "document_review",
        "letter_draft",
        "lead_follow_up",
        "call_summary",
      ],
      vo_run_result: ["running", "drafted", "answered", "abstained", "failed"],
      webhook_inbox_status: [
        "received",
        "processing",
        "processed",
        "ignored",
        "failed",
      ],
    },
  },
} as const
