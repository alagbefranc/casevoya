// Generated from the live schema (project aqjtvqmojfamtspzyeqm) on 2026-10-18 after migrations
// through 20261019210000 were applied (`pnpm db:types` equivalent via the Management API).

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
      agreement_templates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["agreement_kind"]
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
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "agreement_templates_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_versions: {
        Row: {
          agreement_id: string
          canonical_body: string
          comparison_note: string | null
          content_sha256: string | null
          created_at: string
          created_by: string | null
          currency: string
          exclusions: string | null
          fee_cents: number | null
          government_fee_note: string | null
          id: string
          locked_at: string | null
          organization_id: string
          refund_policy: string | null
          scope_summary: string
          updated_at: string
          version: number
          version_number: number
        }
        Insert: {
          agreement_id: string
          canonical_body: string
          comparison_note?: string | null
          content_sha256?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          exclusions?: string | null
          fee_cents?: number | null
          government_fee_note?: string | null
          id?: string
          locked_at?: string | null
          organization_id: string
          refund_policy?: string | null
          scope_summary: string
          updated_at?: string
          version?: number
          version_number: number
        }
        Update: {
          agreement_id?: string
          canonical_body?: string
          comparison_note?: string | null
          content_sha256?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          exclusions?: string | null
          fee_cents?: number | null
          government_fee_note?: string | null
          id?: string
          locked_at?: string | null
          organization_id?: string
          refund_policy?: string | null
          scope_summary?: string
          updated_at?: string
          version?: number
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "agreement_versions_agreement_id_organization_id_fkey"
            columns: ["agreement_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "agreement_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agreements: {
        Row: {
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
        Relationships: [
          {
            foreignKeyName: "agreements_current_version_fkey"
            columns: ["current_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agreement_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "agreements_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "agreements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreements_supersedes_id_organization_id_fkey"
            columns: ["supersedes_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "agreements_template_id_organization_id_fkey"
            columns: ["template_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "availability_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_overrides_schedule_id_organization_id_fkey"
            columns: ["schedule_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "availability_schedules"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "availability_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_rules_schedule_id_organization_id_fkey"
            columns: ["schedule_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "availability_schedules"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "availability_schedules_membership_id_organization_id_fkey"
            columns: ["membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "availability_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "booking_attendees_booking_id_organization_id_fkey"
            columns: ["booking_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "booking_attendees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_attendees_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "booking_event_type_hosts_event_type_id_organization_id_fkey"
            columns: ["event_type_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "booking_event_types"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "booking_event_type_hosts_membership_id_organization_id_fkey"
            columns: ["membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "booking_event_type_hosts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_event_types: {
        Row: {
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
        Relationships: [
          {
            foreignKeyName: "booking_event_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "booking_events_booking_id_organization_id_fkey"
            columns: ["booking_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "booking_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "booking_hold_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "bookings_event_type_id_organization_id_fkey"
            columns: ["event_type_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "booking_event_types"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bookings_host_membership_id_organization_id_fkey"
            columns: ["host_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bookings_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "bookings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      client_account_reconciliations: {
        Row: {
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
          client_account_id: string
          client_count: number
          client_ledgers_total_cents: number
          created_at?: string
          created_by?: string | null
          currency?: string
          difference_cents: number
          discard_reason?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          id?: string
          idempotency_key: string
          is_sample?: boolean
          item_count: number
          items?: Json
          ledger_balance_cents: number
          organization_id: string
          owner_self_signed?: boolean
          period_start: string
          prepared_at?: string
          prepared_by: string
          preparer_note?: string | null
          review_notes?: string | null
          signed_at?: string | null
          signed_by?: string | null
          statement_balance_cents: number
          statement_date: string
          status?: Database["public"]["Enums"]["client_reconciliation_status"]
          updated_at?: string
          version?: number
        }
        Update: {
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
        Relationships: [
          {
            foreignKeyName: "client_account_reconciliation_client_account_id_organizati_fkey"
            columns: ["client_account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "client_accounts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_account_reconciliations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "client_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "client_fund_bank_transfers_entry_id_organization_id_fkey"
            columns: ["entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "client_fund_entries"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_bank_transfers_invoice_id_organization_id_fkey"
            columns: ["invoice_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_bank_transfers_ledger_id_organization_id_fkey"
            columns: ["ledger_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "client_fund_ledgers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_bank_transfers_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_bank_transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "client_fund_entries_client_account_id_organization_id_fkey"
            columns: ["client_account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "client_accounts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_entries_invoice_id_organization_id_fkey"
            columns: ["invoice_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_entries_ledger_id_organization_id_fkey"
            columns: ["ledger_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "client_fund_ledgers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_entries_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_fund_entries_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_entries_reverses_entry_id_organization_id_fkey"
            columns: ["reverses_entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "client_fund_entries"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "client_fund_ledgers_client_account_id_organization_id_fkey"
            columns: ["client_account_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "client_accounts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_ledgers_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_ledgers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_fund_ledgers_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "client_fund_receipts_entry_id_organization_id_fkey"
            columns: ["entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "client_fund_entries"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_receipts_ledger_id_organization_id_fkey"
            columns: ["ledger_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "client_fund_ledgers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_receipts_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "client_fund_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_fund_receipts_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "complaint_handlers_membership_id_organization_id_fkey"
            columns: ["membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "complaint_handlers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "complaints_assignee_membership_id_organization_id_fkey"
            columns: ["assignee_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "complaints_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "complaints_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "complaints_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "compliance_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          created_at: string
          created_by: string | null
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
          updated_at: string
          version: number
          withdrawn_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
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
          updated_at?: string
          version?: number
          withdrawn_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          granted?: boolean
          id?: string
          invitation_id?: string | null
          matter_id?: string | null
          organization_id?: string
          person_id?: string
          policy_document_id?: string | null
          policy_version?: string | null
          purpose?: Database["public"]["Enums"]["consent_purpose"]
          scope?: string | null
          statement_sha256?: string
          statement_text?: string
          updated_at?: string
          version?: number
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_invitation_id_organization_id_fkey"
            columns: ["invitation_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "portal_invitations"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "consent_records_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "consent_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "consent_records_policy_document_id_fkey"
            columns: ["policy_document_id"]
            isOneToOne: false
            referencedRelation: "portal_policy_documents"
            referencedColumns: ["id"]
          },
        ]
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
          register_status:
            | Database["public"]["Enums"]["register_licence_status"]
            | null
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
          register_status?:
            | Database["public"]["Enums"]["register_licence_status"]
            | null
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
          register_status?:
            | Database["public"]["Enums"]["register_licence_status"]
            | null
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
            isOneToOne: false
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
        Relationships: [
          {
            foreignKeyName: "correspondence_work_links_correspondence_id_organization_i_fkey"
            columns: ["correspondence_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "government_correspondence"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "correspondence_work_links_deadline_id_organization_id_fkey"
            columns: ["deadline_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "deadlines"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "correspondence_work_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correspondence_work_links_task_id_organization_id_fkey"
            columns: ["task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
          created_at: string
          credential_id: string
          discipline_restricted: boolean
          discipline_restriction_detail: string | null
          discipline_revoked: boolean
          discipline_suspended: boolean
          entitlement_to_practise: boolean
          id: string
          method: string
          notes: string | null
          organization_id: string
          proof_locator: string
          register_status: Database["public"]["Enums"]["register_licence_status"]
          result: Database["public"]["Enums"]["licence_check_result"]
          retrieved_at: string
          reviewer_user_id: string
          source_host: string
          source_url: string
        }
        Insert: {
          created_at?: string
          credential_id: string
          discipline_restricted: boolean
          discipline_restriction_detail?: string | null
          discipline_revoked: boolean
          discipline_suspended: boolean
          entitlement_to_practise: boolean
          id?: string
          method?: string
          notes?: string | null
          organization_id: string
          proof_locator: string
          register_status: Database["public"]["Enums"]["register_licence_status"]
          result: Database["public"]["Enums"]["licence_check_result"]
          retrieved_at: string
          reviewer_user_id: string
          source_host: string
          source_url: string
        }
        Update: {
          created_at?: string
          credential_id?: string
          discipline_restricted?: boolean
          discipline_restriction_detail?: string | null
          discipline_revoked?: boolean
          discipline_suspended?: boolean
          entitlement_to_practise?: boolean
          id?: string
          method?: string
          notes?: string | null
          organization_id?: string
          proof_locator?: string
          register_status?: Database["public"]["Enums"]["register_licence_status"]
          result?: Database["public"]["Enums"]["licence_check_result"]
          retrieved_at?: string
          reviewer_user_id?: string
          source_host?: string
          source_url?: string
        }
        Relationships: [
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
        Relationships: [
          {
            foreignKeyName: "decision_follow_ups_decision_id_organization_id_fkey"
            columns: ["decision_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "decision_records"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "decision_follow_ups_document_version_id_organization_id_fkey"
            columns: ["document_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "decision_follow_ups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_follow_ups_task_id_organization_id_fkey"
            columns: ["task_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "decision_records_confirmed_by_membership_id_organization_i_fkey"
            columns: ["confirmed_by_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "decision_records_correspondence_id_organization_id_fkey"
            columns: ["correspondence_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "government_correspondence"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "decision_records_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "decision_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_records_shared_by_membership_id_organization_id_fkey"
            columns: ["shared_by_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "decision_records_stage_evidence_id_organization_id_fkey"
            columns: ["stage_evidence_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matter_stage_evidence"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "decision_steps_decision_id_organization_id_fkey"
            columns: ["decision_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "decision_records"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "decision_steps_done_by_membership_id_organization_id_fkey"
            columns: ["done_by_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "decision_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "document_custody_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_custody_events_version_id_organization_id_fkey"
            columns: ["version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "document_matter_refs_document_id_organization_id_fkey"
            columns: ["document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "document_matter_refs_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "document_matter_refs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_requests: {
        Row: {
          acceptable_formats: string[]
          audience: Database["public"]["Enums"]["document_audience"]
          created_at: string
          created_by: string | null
          document_id: string | null
          due_on: string | null
          expires_on: string | null
          explanation: string
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
          expires_on?: string | null
          explanation: string
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
          expires_on?: string | null
          explanation?: string
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
        Relationships: [
          {
            foreignKeyName: "document_requests_document_id_organization_id_fkey"
            columns: ["document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "document_requests_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "document_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requests_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "document_requests_rule_version_id_fkey"
            columns: ["rule_version_id"]
            isOneToOne: false
            referencedRelation: "rule_versions"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "document_review_translations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_review_translations_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "document_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_review_translations_version_id_organization_id_fkey"
            columns: ["version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "document_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_reviews_version_id_organization_id_fkey"
            columns: ["version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_organization_id_fkey"
            columns: ["document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "document_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_parent_version_id_organization_id_fkey"
            columns: ["parent_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "document_versions_request_org_fkey"
            columns: ["request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "document_versions_translation_of_version_id_organization_i_fkey"
            columns: ["translation_of_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "documents_current_version_fkey"
            columns: ["current_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "documents_translates_document_id_organization_id_fkey"
            columns: ["translates_document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      email_deliveries: {
        Row: {
          attempt_count: number
          context: Json
          created_at: string
          created_by: string | null
          critical: boolean
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
        Relationships: [
          {
            foreignKeyName: "email_deliveries_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "email_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_deliveries_outbox_event_id_fkey"
            columns: ["outbox_event_id"]
            isOneToOne: false
            referencedRelation: "outbox_events"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "email_suppressions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          ip: unknown
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
          ip?: unknown
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
          ip?: unknown
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
        Relationships: [
          {
            foreignKeyName: "envelope_signers_envelope_id_organization_id_fkey"
            columns: ["envelope_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "signature_envelopes"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "envelope_signers_membership_id_organization_id_fkey"
            columns: ["membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "envelope_signers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envelope_signers_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "external_busy_blocks_membership_id_organization_id_fkey"
            columns: ["membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "external_busy_blocks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_payment_accounts: {
        Row: {
          account_id: string
          card_payments_status: string
          created_at: string
          created_by: string | null
          id: string
          livemode: boolean
          organization_id: string
          payouts_status: string
          provider: string
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
          id?: string
          livemode?: boolean
          organization_id: string
          payouts_status?: string
          provider?: string
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
          id?: string
          livemode?: boolean
          organization_id?: string
          payouts_status?: string
          provider?: string
          requirements_due?: number
          status_checked_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "firm_payment_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "government_correspondence_corrects_id_organization_id_fkey"
            columns: ["corrects_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "government_correspondence"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "government_correspondence_evidence_version_id_organization_fkey"
            columns: ["evidence_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "government_correspondence_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "government_correspondence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "government_correspondence_shared_by_membership_id_organiza_fkey"
            columns: ["shared_by_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "government_correspondence_verified_by_membership_id_organi_fkey"
            columns: ["verified_by_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      government_status_checks: {
        Row: {
          checked_at: string
          checked_by_membership_id: string
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
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id?: string
          note?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "government_status_checks_checked_by_membership_id_organiza_fkey"
            columns: ["checked_by_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "government_status_checks_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "government_status_checks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "inbound_emails_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inbound_emails_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_emails_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      inbound_inbox_items: {
        Row: {
          assigned_version_id: string | null
          byte_size: number | null
          created_at: string
          created_by: string | null
          filename: string
          id: string
          inbound_email_id: string
          matter_id: string | null
          media_type: string | null
          organization_id: string
          scan_result: string | null
          sha256: string | null
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
          filename: string
          id?: string
          inbound_email_id: string
          matter_id?: string | null
          media_type?: string | null
          organization_id: string
          scan_result?: string | null
          sha256?: string | null
          storage_key: string
          updated_at?: string
          upload_state: string
          version?: number
        }
        Update: {
          assigned_version_id?: string | null
          byte_size?: number | null
          created_at?: string
          created_by?: string | null
          filename?: string
          id?: string
          inbound_email_id?: string
          matter_id?: string | null
          media_type?: string | null
          organization_id?: string
          scan_result?: string | null
          sha256?: string | null
          storage_key?: string
          updated_at?: string
          upload_state?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "inbound_inbox_items_inbound_email_id_organization_id_fkey"
            columns: ["inbound_email_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inbound_emails"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inbound_inbox_items_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inbound_inbox_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
          amount_cents: number
          applied_cents?: number | null
          client_name?: string | null
          consultant_licence?: string | null
          consultant_name?: string | null
          created_at?: string
          created_by?: string | null
          credit_balance_cents?: number | null
          currency: string
          decline_reason?: string | null
          declined_at?: string | null
          declined_by?: string | null
          firm_display_name?: string | null
          firm_legal_name?: string | null
          firm_timezone?: string | null
          id?: string
          idempotency_key: string
          invoice_amount_cents?: number | null
          invoice_description?: string | null
          invoice_id: string
          invoice_issued_on?: string | null
          invoice_number?: string | null
          is_sample?: boolean
          issued_at?: string | null
          issued_by?: string | null
          matter_id: string
          matter_label?: string | null
          number: string
          organization_id: string
          owner_self_approved?: boolean
          reason: string
          requested_by: string
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
        Relationships: [
          {
            foreignKeyName: "invoice_credit_notes_invoice_id_organization_id_fkey"
            columns: ["invoice_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_credit_notes_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_credit_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_disputes_invoice_id_organization_id_fkey"
            columns: ["invoice_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_disputes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_disputes_payment_id_organization_id_fkey"
            columns: ["payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "invoice_payment_events_invoice_id_organization_id_fkey"
            columns: ["invoice_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_payment_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payment_events_payment_id_organization_id_fkey"
            columns: ["payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_payment_events_webhook_inbox_id_fkey"
            columns: ["webhook_inbox_id"]
            isOneToOne: false
            referencedRelation: "webhook_inbox"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "invoice_payment_receipts_entry_id_organization_id_fkey"
            columns: ["entry_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "client_fund_entries"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_payment_receipts_invoice_id_organization_id_fkey"
            columns: ["invoice_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_payment_receipts_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_payment_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payment_receipts_payment_id_organization_id_fkey"
            columns: ["payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_payment_receipts_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount_cents: number
          amount_received_cents: number
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
          refunded_cents: number
          status: Database["public"]["Enums"]["invoice_payment_status"]
          succeeded_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          amount_cents: number
          amount_received_cents?: number
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
          refunded_cents?: number
          status?: Database["public"]["Enums"]["invoice_payment_status"]
          succeeded_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          amount_cents?: number
          amount_received_cents?: number
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
          refunded_cents?: number
          status?: Database["public"]["Enums"]["invoice_payment_status"]
          succeeded_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_organization_id_fkey"
            columns: ["invoice_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_refunds_invoice_id_organization_id_fkey"
            columns: ["invoice_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_refunds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_refunds_payment_id_organization_id_fkey"
            columns: ["payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      invoice_reversal_events: {
        Row: {
          amount_cents: number | null
          connected_account_id: string
          created_at: string
          currency: string | null
          detail: string | null
          dispute_id: string | null
          dispute_status:
            | Database["public"]["Enums"]["invoice_dispute_status"]
            | null
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
          refund_status:
            | Database["public"]["Enums"]["invoice_refund_status"]
            | null
          webhook_inbox_id: string
        }
        Insert: {
          amount_cents?: number | null
          connected_account_id: string
          created_at?: string
          currency?: string | null
          detail?: string | null
          dispute_id?: string | null
          dispute_status?:
            | Database["public"]["Enums"]["invoice_dispute_status"]
            | null
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
          refund_status?:
            | Database["public"]["Enums"]["invoice_refund_status"]
            | null
          webhook_inbox_id: string
        }
        Update: {
          amount_cents?: number | null
          connected_account_id?: string
          created_at?: string
          currency?: string | null
          detail?: string | null
          dispute_id?: string | null
          dispute_status?:
            | Database["public"]["Enums"]["invoice_dispute_status"]
            | null
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
          refund_status?:
            | Database["public"]["Enums"]["invoice_refund_status"]
            | null
          webhook_inbox_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_reversal_events_dispute_id_organization_id_fkey"
            columns: ["dispute_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoice_disputes"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_reversal_events_invoice_id_organization_id_fkey"
            columns: ["invoice_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_reversal_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_reversal_events_payment_id_organization_id_fkey"
            columns: ["payment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoice_payments"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_reversal_events_refund_id_organization_id_fkey"
            columns: ["refund_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "invoice_refunds"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoice_reversal_events_webhook_inbox_id_fkey"
            columns: ["webhook_inbox_id"]
            isOneToOne: false
            referencedRelation: "webhook_inbox"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_cents: number
          client_funds_paid_cents: number
          created_at: string
          created_by: string | null
          credited_cents: number
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
          paid_cents: number
          refunded_cents: number
          status: Database["public"]["Enums"]["invoice_status"]
          updated_at: string
          version: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_cents: number
          client_funds_paid_cents?: number
          created_at?: string
          created_by?: string | null
          credited_cents?: number
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
          paid_cents?: number
          refunded_cents?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          version?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_cents?: number
          client_funds_paid_cents?: number
          created_at?: string
          created_by?: string | null
          credited_cents?: number
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
          paid_cents?: number
          refunded_cents?: number
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          version?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "lead_booking_links_booking_id_organization_id_fkey"
            columns: ["booking_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "lead_booking_links_lead_id_organization_id_fkey"
            columns: ["lead_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "lead_booking_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "lead_consents_lead_id_organization_id_fkey"
            columns: ["lead_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "lead_consents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "lead_duplicate_decisions_lead_id_organization_id_fkey"
            columns: ["lead_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "lead_duplicate_decisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_duplicate_decisions_other_lead_id_organization_id_fkey"
            columns: ["other_lead_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "lead_enquiry_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "lead_events_from_stage_id_organization_id_fkey"
            columns: ["from_stage_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "lead_stages"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "lead_events_lead_id_organization_id_fkey"
            columns: ["lead_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "lead_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_to_stage_id_organization_id_fkey"
            columns: ["to_stage_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "lead_stages"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "lead_follow_ups_lead_id_organization_id_fkey"
            columns: ["lead_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "lead_follow_ups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_follow_ups_owner_membership_id_organization_id_fkey"
            columns: ["owner_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "lead_notes_lead_id_organization_id_fkey"
            columns: ["lead_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "lead_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "lead_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          conflict_checked_at: string | null
          conflict_checked_by: string | null
          conflict_note: string | null
          conflict_result: Database["public"]["Enums"]["lead_conflict_result"]
          converted_at: string | null
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
        Relationships: [
          {
            foreignKeyName: "leads_converted_matter_id_organization_id_fkey"
            columns: ["converted_matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "leads_converted_person_id_organization_id_fkey"
            columns: ["converted_person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_owner_membership_id_organization_id_fkey"
            columns: ["owner_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "leads_same_person_lead_id_organization_id_fkey"
            columns: ["same_person_lead_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "leads_stage_id_organization_id_fkey"
            columns: ["stage_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "lead_stages"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "matter_closures_custodian_membership_id_organization_id_fkey"
            columns: ["custodian_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_closures_evidence_id_organization_id_fkey"
            columns: ["evidence_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matter_stage_evidence"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_closures_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_closures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "matter_exports_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_exports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "matter_legal_holds_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_legal_holds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "matter_message_attachments_document_id_organization_id_fkey"
            columns: ["document_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_message_attachments_message_id_organization_id_fkey"
            columns: ["message_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matter_messages"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_message_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "matter_message_receipts_message_id_organization_id_fkey"
            columns: ["message_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matter_messages"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_message_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_message_receipts_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      matter_messages: {
        Row: {
          author_kind: string
          author_membership_id: string | null
          author_name: string
          author_person_id: string | null
          author_user_id: string
          body: string
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
          author_user_id: string
          body: string
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
          author_user_id?: string
          body?: string
          client_key?: string | null
          created_at?: string
          id?: string
          matter_id?: string
          organization_id?: string
          requires_ack?: boolean
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matter_messages_author_membership_id_organization_id_fkey"
            columns: ["author_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_messages_author_person_id_organization_id_fkey"
            columns: ["author_person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_messages_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matter_messages_thread_id_organization_id_fkey"
            columns: ["thread_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "matter_staff_notes_author_membership_id_organization_id_fkey"
            columns: ["author_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_staff_notes_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matter_staff_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          override_id: string | null
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
          override_id?: string | null
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
          override_id?: string | null
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
          {
            foreignKeyName: "matter_stage_transitions_override_fk"
            columns: ["override_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matter_stage_overrides"
            referencedColumns: ["id", "organization_id"]
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
            foreignKeyName: "matters_consultant_org_fk"
            columns: ["responsible_consultant_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matters_hold_owner_org_fk"
            columns: ["on_hold_owner_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matters_predecessor_org_fk"
            columns: ["predecessor_matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "matters_program_pack_id_fkey"
            columns: ["program_pack_id"]
            isOneToOne: false
            referencedRelation: "rule_pack_versions"
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
        Relationships: [
          {
            foreignKeyName: "message_thread_people_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_thread_people_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "message_thread_people_thread_id_organization_id_fkey"
            columns: ["thread_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "message_threads"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "message_threads_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "message_threads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          created_at: string
          created_by: string | null
          duration_snapshot: Json | null
          organization_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at: string | null
          trial_started_at: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          duration_snapshot?: Json | null
          organization_id: string
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          trial_started_at?: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          duration_snapshot?: Json | null
          organization_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
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
          display_name: string
          document_max_bytes: number | null
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
          display_name: string
          document_max_bytes?: number | null
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
          display_name?: string
          document_max_bytes?: number | null
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
          created_at: string
          created_by: string | null
          deadline_reminders: boolean
          email_notices: boolean
          locale: string
          organization_id: string
          person_id: string
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          sms_notices: boolean
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deadline_reminders?: boolean
          email_notices?: boolean
          locale?: string
          organization_id: string
          person_id: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          sms_notices?: boolean
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deadline_reminders?: boolean
          email_notices?: boolean
          locale?: string
          organization_id?: string
          person_id?: string
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          sms_notices?: boolean
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "person_contact_preferences_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: true
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
          restricted: boolean
          section_key: Database["public"]["Enums"]["person_section_key"]
          summary: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          matter_id?: string
          organization_id?: string
          person_id?: string
          restricted?: boolean
          section_key?: Database["public"]["Enums"]["person_section_key"]
          summary?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "person_section_records_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "person_section_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_section_records_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      persons: {
        Row: {
          birth_date: string | null
          birth_date_precision:
            | Database["public"]["Enums"]["date_precision"]
            | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          display_name: string
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
          birth_date_precision?:
            | Database["public"]["Enums"]["date_precision"]
            | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
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
          birth_date_precision?:
            | Database["public"]["Enums"]["date_precision"]
            | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
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
          token_hash: string
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
          token_hash: string
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
          token_hash?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "portal_invitations_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "portal_invitations_membership_id_organization_id_fkey"
            columns: ["membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "portal_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_invitations_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "portal_policy_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_request_redactions: {
        Row: {
          created_at: string
          created_by: string | null
          done_at: string | null
          done_by: string | null
          id: string
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
          organization_id?: string
          record_label?: string
          removed?: string
          request_id?: string
          state?: Database["public"]["Enums"]["privacy_redaction_state"]
          third_party?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "privacy_request_redactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "privacy_request_redactions_request_id_organization_id_fkey"
            columns: ["request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "privacy_requests"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
          id: string
          idempotency_key: string
          identity_method: string | null
          identity_verified_at: string | null
          identity_verified_by: string | null
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
          id?: string
          idempotency_key: string
          identity_method?: string | null
          identity_verified_at?: string | null
          identity_verified_by?: string | null
          is_sample?: boolean
          kept_records?: Json | null
          kind: Database["public"]["Enums"]["privacy_request_kind"]
          matter_id?: string | null
          number: number
          organization_id: string
          outcome?:
            | Database["public"]["Enums"]["privacy_request_outcome"]
            | null
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
          id?: string
          idempotency_key?: string
          identity_method?: string | null
          identity_verified_at?: string | null
          identity_verified_by?: string | null
          is_sample?: boolean
          kept_records?: Json | null
          kind?: Database["public"]["Enums"]["privacy_request_kind"]
          matter_id?: string | null
          number?: number
          organization_id?: string
          outcome?:
            | Database["public"]["Enums"]["privacy_request_outcome"]
            | null
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
        Relationships: [
          {
            foreignKeyName: "privacy_requests_assignee_membership_id_organization_id_fkey"
            columns: ["assignee_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "privacy_requests_consent_record_id_organization_id_fkey"
            columns: ["consent_record_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "consent_records"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "privacy_requests_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "privacy_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "privacy_requests_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
          revocation_reason: string | null
          revoked_at: string | null
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
          revocation_reason?: string | null
          revoked_at?: string | null
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
          revocation_reason?: string | null
          revoked_at?: string | null
          scope?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "representation_authorities_agreement_id_organization_id_fkey"
            columns: ["agreement_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "representation_authorities_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "representation_authorities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "representation_authorities_person_id_organization_id_fkey"
            columns: ["person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
          created_at: string
          created_by: string | null
          evidence_excerpt: string | null
          id: string
          interpretation_notes: string | null
          locator: string | null
          organization_id: string | null
          rule_version_id: string
          snapshot_id: string
          source_language: string | null
          source_section: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          evidence_excerpt?: string | null
          id?: string
          interpretation_notes?: string | null
          locator?: string | null
          organization_id?: string | null
          rule_version_id: string
          snapshot_id: string
          source_language?: string | null
          source_section?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          evidence_excerpt?: string | null
          id?: string
          interpretation_notes?: string | null
          locator?: string | null
          organization_id?: string | null
          rule_version_id?: string
          snapshot_id?: string
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
          consent_record_id: string
          created_at: string
          created_by: string | null
          grantee_person_id: string
          id: string
          matter_id: string
          organization_id: string
          revoked_at: string | null
          section_key: Database["public"]["Enums"]["person_section_key"]
          subject_person_id: string
          updated_at: string
          version: number
        }
        Insert: {
          consent_record_id: string
          created_at?: string
          created_by?: string | null
          grantee_person_id: string
          id?: string
          matter_id: string
          organization_id: string
          revoked_at?: string | null
          section_key: Database["public"]["Enums"]["person_section_key"]
          subject_person_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          consent_record_id?: string
          created_at?: string
          created_by?: string | null
          grantee_person_id?: string
          id?: string
          matter_id?: string
          organization_id?: string
          revoked_at?: string | null
          section_key?: Database["public"]["Enums"]["person_section_key"]
          subject_person_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "section_shares_consent_record_id_organization_id_fkey"
            columns: ["consent_record_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "consent_records"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "section_shares_grantee_person_id_organization_id_fkey"
            columns: ["grantee_person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "section_shares_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "section_shares_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_shares_subject_person_id_organization_id_fkey"
            columns: ["subject_person_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "signature_envelopes_agreement_id_organization_id_fkey"
            columns: ["agreement_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agreements"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "signature_envelopes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_envelopes_version_id_organization_id_fkey"
            columns: ["version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "agreement_versions"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
          ip: unknown
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
          ip?: unknown
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
          ip?: unknown
          kind?: Database["public"]["Enums"]["signature_event_kind"]
          occurred_at?: string
          organization_id?: string
          provider?: string
          signer_id?: string | null
          summary?: Json
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signature_events_envelope_id_organization_id_fkey"
            columns: ["envelope_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "signature_envelopes"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "signature_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_events_signer_id_organization_id_fkey"
            columns: ["signer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "envelope_signers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "staff_notification_reads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "submission_handoffs_matter_id_organization_id_fkey"
            columns: ["matter_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "submission_handoffs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_handoffs_receipt_version_id_organization_id_fkey"
            columns: ["receipt_version_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "submission_handoffs_signoff_membership_id_organization_id_fkey"
            columns: ["signoff_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "submission_handoffs_stage_evidence_id_organization_id_fkey"
            columns: ["stage_evidence_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "matter_stage_evidence"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "submission_handoffs_submitted_by_membership_id_organizatio_fkey"
            columns: ["submitted_by_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "submission_handoffs_verified_by_membership_id_organization_fkey"
            columns: ["verified_by_membership_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "organization_id"]
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
        Relationships: [
          {
            foreignKeyName: "translation_draft_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      accept_quote: { Args: { p_agreement_id: string }; Returns: undefined }
      access_grant_choices: {
        Args: { p_organization_id: string }
        Returns: {
          choice: string
          matter_id: string
          matter_reference: string
          person_id: string
          person_name: string
        }[]
      }
      acknowledge_matter_message: {
        Args: { p_message_id: string; p_organization_id: string }
        Returns: string
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
          p_owner_membership_id: string
        }
        Returns: string
      }
      add_lead_follow_up: {
        Args: {
          p_due_on: string
          p_lead: string
          p_org: string
          p_owner_membership_id: string
          p_title: string
        }
        Returns: string
      }
      add_lead_note: {
        Args: { p_body: string; p_lead: string; p_org: string }
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
      agreement_certificate_pdf: {
        Args: { p_envelope_id: string }
        Returns: string
      }
      agreement_executed_pdf: {
        Args: { p_envelope_id: string }
        Returns: string
      }
      agreement_seal_source: { Args: { p_envelope_id: string }; Returns: Json }
      apply_document_scan: {
        Args: { p_result: string; p_version_id: string }
        Returns: Database["public"]["Enums"]["document_upload_state"]
      }
      apply_stripe_payment_event: {
        Args: {
          p_account_id: string
          p_amount_cents: number
          p_amount_received_cents: number
          p_currency: string
          p_event_id: string
          p_event_type: string
          p_invoice_id: string
          p_livemode: boolean
          p_payload: Json
          p_payment_intent_id: string
        }
        Returns: Json
      }
      apply_stripe_reversal_event: {
        Args: {
          p_account_id: string
          p_amount_cents: number
          p_amount_refunded_cents: number
          p_charge_id: string
          p_currency: string
          p_event_created: number
          p_event_id: string
          p_event_type: string
          p_evidence_due_by: string
          p_failure_reason: string
          p_livemode: boolean
          p_object_id: string
          p_payload: Json
          p_payment_intent_id: string
          p_reason: string
          p_status: string
        }
        Returns: Json
      }
      approve_agreement_template: {
        Args: { p_template_id: string }
        Returns: undefined
      }
      approve_client_transfer: { Args: { p_entry_id: string }; Returns: Json }
      archive_lead_stage: {
        Args: { p_org: string; p_stage_id: string }
        Returns: undefined
      }
      assign_responsible_consultant: {
        Args: {
          p_expected_version: number
          p_matter_id: string
          p_membership_id: string
        }
        Returns: number
      }
      assign_unsorted_email_file: {
        Args: { p_item_id: string; p_matter_id: string; p_person_id: string }
        Returns: Json
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
          p_client_hash: string
          p_email: string
          p_event_slug: string
          p_firm_slug: string
          p_idempotency_key: string
          p_name: string
          p_phone: string
          p_start: string
          p_time_zone: string
        }
        Returns: Json
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
      claim_due_reminders: {
        Args: { p_as_of: string; p_limit: number }
        Returns: string[]
      }
      claim_mail_events: {
        Args: { p_limit?: number; p_worker: string }
        Returns: Json
      }
      clear_matter_on_hold: {
        Args: {
          p_expected_version: number
          p_matter_id: string
          p_reason: string
        }
        Returns: number
      }
      client_fund_receipt: { Args: { p_entry_id: string }; Returns: Json }
      client_fund_staff_names: {
        Args: { p_org: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
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
        Args: {
          p_expected_version: number
          p_matter_id: string
          p_override_reason?: string
          p_reason: string
        }
        Returns: string
      }
      close_person_break_glass: { Args: { p_id: string }; Returns: undefined }
      close_privacy_request: {
        Args: {
          p_consent_record_id: string
          p_delivery_method: string
          p_evidence_note: string
          p_outcome: string
          p_outcome_note: string
          p_refusal_reason: string
          p_request_id: string
        }
        Returns: undefined
      }
      complete_document_upload: {
        Args: { p_header_hex: string; p_sha256: string; p_version_id: string }
        Returns: Json
      }
      complete_email_upload: {
        Args: {
          p_header_hex: string
          p_inbound_id: string
          p_ordinal: number
          p_sha256: string
        }
        Returns: Json
      }
      complete_lead_follow_up: {
        Args: { p_follow_up: string; p_org: string }
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
          p_consultant_interpretation: string
          p_decision_id: string
          p_expected_version: number
          p_next_steps: string
        }
        Returns: number
      }
      consume_recovery_code: { Args: { p_code: string }; Returns: boolean }
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
          p_rule_pack_version_id?: string
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
          p_comparison: string
          p_currency: string
          p_exclusions: string
          p_fee_cents: number
          p_government_fee_note: string
          p_kind: Database["public"]["Enums"]["agreement_kind"]
          p_matter_id: string
          p_quote_expires_on: string
          p_refund_policy: string
          p_scope: string
          p_supersedes_id: string
          p_template_id: string
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
          p_applicant_date_of_birth?: string
          p_applicant_email: string
          p_applicant_name: string
          p_consultant_membership_id: string
          p_rule_pack_version_id?: string
          p_sponsor_date_of_birth?: string
          p_sponsor_email: string
          p_sponsor_name: string
          p_title?: string
        }
        Returns: Json
      }
      create_document_request: {
        Args: {
          p_acceptable_formats: string[]
          p_audience: Database["public"]["Enums"]["document_audience"]
          p_due_on: string
          p_expires_on: string
          p_explanation: string
          p_matter_id: string
          p_person_id: string
          p_purpose: string
          p_review_criteria: string
          p_rule_item_key?: string
          p_rule_version_id?: string
          p_sensitivity: Database["public"]["Enums"]["document_sensitivity"]
        }
        Returns: string
      }
      create_email_upload_intent: {
        Args: {
          p_byte_size: number
          p_filename: string
          p_inbound_id: string
          p_ordinal: number
        }
        Returns: Json
      }
      create_engaged_matter: {
        Args: {
          p_consultant_membership_id: string
          p_is_sample: boolean
          p_rule_pack_version_id?: string
          p_scope?: string
          p_title: string
        }
        Returns: Json
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
          p_country_now: string
          p_email: string
          p_language: string
          p_marketing_consent: boolean
          p_name: string
          p_note: string
          p_org: string
          p_owner_membership_id: string
          p_phone: string
          p_preferred_contact: string
          p_proposed_fee_cents: number
          p_reply_consent: boolean
          p_service_interest: string
          p_source: Database["public"]["Enums"]["lead_source"]
          p_source_detail: string
          p_tags: string[]
        }
        Returns: string
      }
      create_lead_from_booking: {
        Args: { p_booking: string; p_org: string }
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
          display_name: string
          document_max_bytes: number | null
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
      create_staff_invitation: {
        Args: {
          email: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Returns: string
      }
      create_task: {
        Args: {
          p_audience: Database["public"]["Enums"]["task_audience"]
          p_checklist: Json
          p_due_at: string
          p_due_on: string
          p_due_timezone: string
          p_estimated_minutes: number
          p_intake_field_key: string
          p_matter_id: string
          p_owner_membership_id: string
          p_owner_person_id: string
          p_priority: Database["public"]["Enums"]["task_priority"]
          p_title: string
        }
        Returns: string
      }
      create_upload_intent: {
        Args: {
          p_audience: Database["public"]["Enums"]["document_audience"]
          p_declared_byte_size: number
          p_document_id?: string
          p_filename: string
          p_language_tag?: string
          p_matter_id: string
          p_person_id: string
          p_purpose: string
          p_sensitivity: Database["public"]["Enums"]["document_sensitivity"]
          p_translation_of_version_id?: string
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
          p_ip: unknown
          p_user_agent: string
        }
        Returns: Json
      }
      decline_client_transfer: {
        Args: { p_entry_id: string; p_reason: string }
        Returns: string
      }
      decline_credit_note: {
        Args: { p_credit_note_id: string; p_reason: string }
        Returns: string
      }
      decline_portal_invitation: { Args: { p_token: string }; Returns: Json }
      discard_client_reconciliation: {
        Args: { p_reason: string; p_reconciliation_id: string }
        Returns: string
      }
      dismiss_inbound_email: {
        Args: { p_email_id: string; p_note?: string }
        Returns: undefined
      }
      document_request_progress: {
        Args: { p_matter_id: string }
        Returns: Json
      }
      email_delivery_locales: {
        Args: { p_delivery_ids: string[] }
        Returns: Json
      }
      ensure_sample_case: { Args: never; Returns: string }
      escalate_overdue_work: { Args: { p_as_of: string }; Returns: number }
      evaluate_real_client_invites: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      expire_booking_holds: { Args: { p_as_of?: string }; Returns: number }
      file_inbound_email: {
        Args: { p_email_id: string; p_matter_id: string; p_person_id: string }
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
        Args: {
          p_header_hex: string
          p_inbound_id: string
          p_ordinal: number
          p_sha256: string
        }
        Returns: Json
      }
      finish_verified_document_upload: {
        Args: {
          p_actor_user_id: string
          p_byte_size: number
          p_detected_media_type: string
          p_sha256: string
          p_version_id: string
        }
        Returns: Json
      }
      firm_access_grants: {
        Args: { p_organization_id: string }
        Returns: {
          created_at: string
          expires_at: string
          granted_by_grantee: boolean
          granted_by_name: string
          grantee_name: string
          id: string
          kind: Database["public"]["Enums"]["access_grant_kind"]
          matter_reference: string
          purpose: string
          revoked_at: string
          subject_name: string
        }[]
      }
      firm_payment_account_for_owner: {
        Args: { p_org: string }
        Returns: string
      }
      firm_staff_directory: {
        Args: { p_organization_id: string }
        Returns: {
          display_name: string
          email: string
          is_licensed: boolean
          is_self: boolean
          membership_id: string
          role: Database["public"]["Enums"]["org_role"]
          status: Database["public"]["Enums"]["membership_status"]
          two_step: boolean
        }[]
      }
      freeze_intake_response: {
        Args: { p_response_id: string }
        Returns: undefined
      }
      generate_recovery_codes: { Args: never; Returns: string[] }
      import_leads: {
        Args: { p_file_name: string; p_org: string; p_rows: Json }
        Returns: Json
      }
      intake_template_usage: {
        Args: { p_organization_id: string }
        Returns: {
          matters: number
          stable_key: string
        }[]
      }
      invoice_credit_note: { Args: { p_credit_note_id: string }; Returns: Json }
      invoice_payment_context: { Args: { p_invoice_id: string }; Returns: Json }
      invoice_payment_receipt: { Args: { p_receipt_id: string }; Returns: Json }
      invoice_refund_context: { Args: { p_payment_id: string }; Returns: Json }
      issue_credit_note: { Args: { p_credit_note_id: string }; Returns: Json }
      lead_conflict_matches: {
        Args: { p_lead: string; p_org: string }
        Returns: Json
      }
      licence_review_log: {
        Args: { p_organization_id: string }
        Returns: {
          actor_is_platform: boolean
          actor_name: string
          at: string
          college_id: string
          credential_id: string
          holder_name: string
          kind: string
          result: string
        }[]
      }
      link_booking_to_lead: {
        Args: { p_booking: string; p_lead: string; p_org: string }
        Returns: undefined
      }
      link_correspondence_work: {
        Args: {
          p_correspondence_id: string
          p_deadline_id: string
          p_task_id: string
        }
        Returns: string
      }
      link_successor_matter: {
        Args: {
          p_predecessor_id: string
          p_reason: string
          p_successor_id: string
        }
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
          entry_id: string
          entry_number: string
          invoice_id: string
          invoice_number: string
          invoiced_on: string
          is_sample: boolean
          ledger_id: string
          matter_id: string
          organization_id: string
          overdue: boolean
          person_id: string
          state: string
          withdraw_by: string
        }[]
      }
      list_exportable_matter_ids: {
        Args: never
        Returns: {
          matter_id: string
        }[]
      }
      list_matter_billing: {
        Args: never
        Returns: {
          client_display_name: string
          matter_id: string
          organization_id: string
          stage: Database["public"]["Enums"]["matter_stage"]
          title: string
        }[]
      }
      list_my_sessions: {
        Args: never
        Returns: {
          aal: string
          created_at: string
          refreshed_at: string
          revoked: boolean
          session_id: string
          user_agent: string
        }[]
      }
      mark_message_thread_read: {
        Args: { p_organization_id: string; p_thread_id: string }
        Returns: number
      }
      mark_staff_notifications_read: {
        Args: { p_ids?: string[]; p_organization_id: string }
        Returns: number
      }
      matter_closure_check: { Args: { p_matter_id: string }; Returns: Json }
      move_lead_stage: {
        Args: {
          p_expected_version: number
          p_lead: string
          p_org: string
          p_reason: string
          p_to_stage: string
        }
        Returns: number
      }
      open_intake_response: {
        Args: {
          p_matter_id: string
          p_person_id: string
          p_template_id: string
        }
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
        Args: {
          p_byte_size: number
          p_filename: string
          p_inbound_id: string
          p_ordinal: number
        }
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
      prepare_client_reconciliation: {
        Args: {
          p_client_account_id: string
          p_idempotency_key: string
          p_note: string
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
          p_package_sha256: string
        }
        Returns: string
      }
      preview_invitation: {
        Args: { p_token: string }
        Returns: {
          email: string
          expires_at: string
          organization_name: string
          role: string
          status: string
        }[]
      }
      preview_invitation_inviter: { Args: { p_token: string }; Returns: string }
      preview_portal_invitation: { Args: { p_token: string }; Returns: Json }
      privacy_request_kept_records: {
        Args: { p_request_id: string }
        Returns: Json
      }
      publish_intake_draft: {
        Args: { p_expected_version: number; p_template_id: string }
        Returns: string
      }
      publish_portal_policy: {
        Args: {
          p_body: string
          p_kind: string
          p_title: string
          p_version_label: string
        }
        Returns: string
      }
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
          p_owner_membership_id: string
          p_owner_person_id: string
          p_task_id: string
        }
        Returns: number
      }
      record_client_deposit: {
        Args: {
          p_amount_cents: number
          p_client_account_id: string
          p_currency: string
          p_evidence: string
          p_idempotency_key: string
          p_matter_id: string
          p_method: string
          p_person_id: string
          p_received_on: string
          p_reference: string
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
          p_reference: string
        }
        Returns: string
      }
      record_client_transfer_bank: {
        Args: {
          p_entry_id: string
          p_note: string
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
          p_matter_id: string
          p_org: string
          p_person_id: string
          p_received_on: string
        }
        Returns: string
      }
      record_complaint_step: {
        Args: {
          p_complaint_id: string
          p_note: string
          p_on: string
          p_step: string
        }
        Returns: undefined
      }
      record_deadline: {
        Args: {
          p_calculation_note: string
          p_due_at: string
          p_due_on: string
          p_event_on: string
          p_evidence_locator: string
          p_kind: Database["public"]["Enums"]["deadline_kind"]
          p_label: string
          p_matter_id: string
          p_receipt_on: string
          p_rule_version_id: string
          p_source_retrieved_on: string
          p_source_url: string
          p_task_id: string
          p_timezone: string
        }
        Returns: string
      }
      record_decision: {
        Args: {
          p_authority_reasons: string
          p_correspondence_id: string
          p_decided_on: string
          p_milestone: Database["public"]["Enums"]["decision_milestone"]
          p_outcome: Database["public"]["Enums"]["matter_outcome"]
        }
        Returns: string
      }
      record_decision_step: {
        Args: {
          p_decision_id: string
          p_note: string
          p_step: Database["public"]["Enums"]["decision_step"]
        }
        Returns: string
      }
      record_document_custody: {
        Args: {
          p_acknowledged: boolean
          p_location: string
          p_purpose: string
          p_received_on: string
          p_recipient: string
          p_return_on: string
          p_version_id: string
        }
        Returns: string
      }
      record_firm_payment_account: {
        Args: { p_account_id: string; p_livemode: boolean; p_org: string }
        Returns: string
      }
      record_government_check: {
        Args: { p_matter_id: string; p_note: string }
        Returns: string
      }
      record_government_correspondence: {
        Args: {
          p_action_requested: string
          p_channel: Database["public"]["Enums"]["correspondence_channel"]
          p_corrects_id: string
          p_document_date: string
          p_evidence_locator: string
          p_evidence_version_id: string
          p_issuer: string
          p_kind: Database["public"]["Enums"]["correspondence_kind"]
          p_matter_id: string
          p_received_on: string
          p_reference_text: string
          p_stated_deadline: string
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
          p_idempotency_key: string
          p_livemode: boolean
          p_payment_id: string
          p_reason: string
          p_refund_id: string
        }
        Returns: string
      }
      record_lead_conflict_check: {
        Args: {
          p_expected_version: number
          p_lead: string
          p_note: string
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
      record_matter_engagement: {
        Args: {
          p_agreement_locator: string
          p_exception_reason: string
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
          p_matter_id: string
          p_org: string
          p_person_id: string
          p_received_on: string
          p_requester_name: string
        }
        Returns: string
      }
      record_privacy_step: {
        Args: { p_note: string; p_request_id: string; p_step: string }
        Returns: undefined
      }
      record_report_export: {
        Args: {
          p_format: string
          p_organization_id: string
          p_range: string
          p_tab: string
        }
        Returns: string
      }
      record_representation_authority: {
        Args: {
          p_agreement_id: string
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
          p_acknowledged_on: string
          p_expected_version: number
          p_external_reference: string
          p_handoff_id: string
          p_receipt_locator: string
          p_receipt_version_id: string
          p_submitted_at: string
          p_submitted_by_membership_id: string
        }
        Returns: number
      }
      reject_client_deposit: {
        Args: { p_entry_id: string; p_reason: string }
        Returns: string
      }
      release_legal_hold: {
        Args: { p_hold_id: string; p_reason: string }
        Returns: undefined
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
          p_note: string
        }
        Returns: string
      }
      request_credit_note: {
        Args: {
          p_amount_cents: number
          p_idempotency_key: string
          p_invoice_id: string
          p_reason: string
        }
        Returns: string
      }
      request_mfa_reset: { Args: { p_reason: string }; Returns: string }
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
      review_document_version: {
        Args: {
          p_annotations?: string
          p_decision: Database["public"]["Enums"]["document_review_decision"]
          p_expected_version: number
          p_reason: string
          p_version_id: string
        }
        Returns: number
      }
      review_document_version_fr: {
        Args: {
          p_annotations: string
          p_decision: Database["public"]["Enums"]["document_review_decision"]
          p_expected_version: number
          p_machine_drafted: boolean
          p_model?: string
          p_reason: string
          p_reason_fr: string
          p_version_id: string
        }
        Returns: number
      }
      revise_agreement: {
        Args: {
          p_agreement_id: string
          p_body: string
          p_comparison: string
          p_fee_cents: number
          p_government_fee_note: string
          p_scope: string
        }
        Returns: string
      }
      revise_deadline_due: {
        Args: {
          p_deadline_id: string
          p_due_at: string
          p_due_on: string
          p_expected_version: number
          p_timezone: string
        }
        Returns: number
      }
      revoke_access_grant: {
        Args: { p_grant_id: string; p_reason: string }
        Returns: undefined
      }
      revoke_my_session: { Args: { p_session_id: string }; Returns: undefined }
      revoke_other_sessions: { Args: never; Returns: number }
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
          p_daily_capacity: number
          p_description: string
          p_duration_min: number
          p_event_type_id: string
          p_expected_version: number
          p_host_membership_ids: string[]
          p_location_detail: string
          p_location_kind: Database["public"]["Enums"]["booking_location_kind"]
          p_max_advance_days: number
          p_min_notice_min: number
          p_org: string
          p_publish: boolean
          p_slot_step_min: number
          p_slug: string
          p_title: string
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
          p_expected_version: number
          p_schema: Json
          p_stable_key: string
          p_template_id: string
          p_title: string
        }
        Returns: Json
      }
      save_intake_template: {
        Args: {
          p_effective_on: string
          p_locale: string
          p_publish: boolean
          p_rule_pack_version_id: string
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
          p_stage_id: string
        }
        Returns: string
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
          p_record_label: string
          p_redaction_id: string
          p_removed: string
          p_request_id: string
          p_state: string
          p_third_party: string
        }
        Returns: string
      }
      schedule_deadline_reminders: {
        Args: { p_as_of: string; p_deadline_id: string }
        Returns: number
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
          p_expires_at: string
          p_idempotency_key: string
          p_signers: Json
        }
        Returns: Json
      }
      send_matter_message: {
        Args: {
          p_body: string
          p_client_key?: string
          p_document_ids?: string[]
          p_matter_id: string
          p_organization_id: string
          p_person_ids: string[]
          p_requires_ack?: boolean
          p_thread_id: string
        }
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
      session_mfa_satisfied: { Args: never; Returns: boolean }
      set_complaint_handlers: {
        Args: { p_membership_ids: string[]; p_org: string }
        Returns: number
      }
      set_compliance_settings: {
        Args: {
          p_complaint_ack_days: number
          p_complaint_escalation_text: string
          p_complaint_response_days: number
          p_org: string
          p_privacy_response_days: number
        }
        Returns: undefined
      }
      set_credential_valid_until: {
        Args: { p_credential_id: string; p_valid_until: string }
        Returns: string
      }
      set_document_expiry: {
        Args: {
          p_expected_version: number
          p_expires_on: string
          p_version_id: string
        }
        Returns: number
      }
      set_document_upload_limit: { Args: { p_bytes: number }; Returns: number }
      set_firm_reminder_offsets: {
        Args: { p_days: number[] }
        Returns: undefined
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
      set_product_setting: {
        Args: { p_key: string; p_value: Json }
        Returns: undefined
      }
      set_quiet_hours: {
        Args: { p_end: string; p_start: string }
        Returns: undefined
      }
      set_sample_mode: { Args: { p_enabled: boolean }; Returns: undefined }
      set_task_status: {
        Args: {
          p_blocker_note: string
          p_expected_version: number
          p_status: Database["public"]["Enums"]["task_status"]
          p_task_id: string
        }
        Returns: number
      }
      share_government_record: {
        Args: { p_id: string; p_kind: string }
        Returns: undefined
      }
      sign_agreement: {
        Args: {
          p_consent: boolean
          p_envelope_id: string
          p_idempotency_key: string
          p_ip: unknown
          p_user_agent: string
        }
        Returns: Json
      }
      sign_client_reconciliation: {
        Args: {
          p_notes: string
          p_outcome: string
          p_reconciliation_id: string
        }
        Returns: Json
      }
      sign_off_submission_handoff: {
        Args: { p_expected_version: number; p_handoff_id: string }
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
          p_exclude_booking?: string
          p_from: string
          p_org: string
          p_to: string
        }
        Returns: Json
      }
      staff_cancel_booking: {
        Args: {
          p_booking_id: string
          p_expected_version: number
          p_org: string
          p_reason: string
        }
        Returns: undefined
      }
      staff_notifications: {
        Args: { p_limit?: number; p_organization_id: string }
        Returns: Json
      }
      staff_record_booking_outcome: {
        Args: { p_booking_id: string; p_org: string; p_outcome: string }
        Returns: undefined
      }
      staff_reschedule_booking: {
        Args: {
          p_booking_id: string
          p_expected_version: number
          p_org: string
          p_start: string
        }
        Returns: undefined
      }
      start_matter_export: {
        Args: { p_idempotency_key: string; p_matter_id: string }
        Returns: string
      }
      submit_enquiry: {
        Args: {
          p_client_hash: string
          p_consent_version: string
          p_contact: string
          p_country_now: string
          p_firm_slug: string
          p_idempotency_key: string
          p_language: string
          p_marketing_consent: boolean
          p_marketing_statement: string
          p_name: string
          p_preferred_contact: string
          p_reply_consent: boolean
          p_reply_statement: string
          p_service_interest: string
          p_source: Database["public"]["Enums"]["lead_source"]
        }
        Returns: Json
      }
      submit_intake_response: {
        Args: { p_expected_version: number; p_response_id: string }
        Returns: number
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
      update_lead: {
        Args: {
          p_country_now: string
          p_date_of_birth: string
          p_email: string
          p_expected_version: number
          p_language: string
          p_lead: string
          p_name: string
          p_org: string
          p_owner_membership_id: string
          p_phone: string
          p_preferred_contact: string
          p_proposed_fee_cents: number
          p_service_interest: string
          p_source_detail: string
          p_tags: string[]
        }
        Returns: number
      }
      verify_client_deposit: { Args: { p_entry_id: string }; Returns: string }
      verify_government_correspondence: {
        Args: { p_correspondence_id: string; p_expected_version: number }
        Returns: number
      }
      verify_submission_receipt: {
        Args: {
          p_acknowledged_on: string
          p_expected_version: number
          p_handoff_id: string
          p_receipt_locator: string
          p_receipt_version_id: string
        }
        Returns: number
      }
      void_agreement_envelope: {
        Args: { p_envelope_id: string; p_reason: string }
        Returns: undefined
      }
      void_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: Json
      }
      waive_document_request: {
        Args: {
          p_expected_version: number
          p_reason: string
          p_request_id: string
        }
        Returns: number
      }
      withdraw_section_share: {
        Args: { p_share_id: string }
        Returns: undefined
      }
    }
    Enums: {
      access_grant_kind: "explicit" | "guardian"
      agreement_kind:
        | "quote"
        | "consultation"
        | "service"
        | "amendment"
        | "consent"
      agreement_signer_role:
        | "client"
        | "consultant"
        | "sponsor"
        | "dependant"
        | "guardian"
        | "firm"
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
      client_fund_method:
        | "bank_transfer"
        | "interac_e_transfer"
        | "cheque"
        | "cash"
      client_reconciliation_status:
        | "pending_review"
        | "reconciled"
        | "exceptions"
        | "discarded"
      complaint_category:
        | "fees_billing"
        | "communication"
        | "service_quality"
        | "conduct"
        | "privacy"
        | "other"
      compliance_channel:
        | "email"
        | "phone"
        | "letter"
        | "in_person"
        | "portal"
        | "other"
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
      decision_record_state: "awaiting_confirmation" | "confirmed"
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
      document_upload_state:
        | "uploading"
        | "scanning"
        | "quarantined"
        | "clean"
        | "failed"
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
        | "message"
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
      lead_conflict_result:
        | "not_checked"
        | "clear"
        | "possible_conflict"
        | "conflict"
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
      licence_check_result:
        | "verified"
        | "not_entitled"
        | "inactive"
        | "suspended"
        | "revoked"
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
      person_section_key:
        | "passport_bio"
        | "school_transcript"
        | "police_certificate"
        | "shared_family_record"
        | "private_record"
      privacy_redaction_state: "to_do" | "redacted" | "excluded" | "kept"
      privacy_request_kind:
        | "access"
        | "correction"
        | "consent_withdrawal"
        | "deletion"
      privacy_request_outcome:
        | "fulfilled"
        | "partly_fulfilled"
        | "refused"
        | "withdrawn"
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
      sample_proof_step:
        | "intake"
        | "agreement"
        | "upload"
        | "reminder"
        | "invoice"
        | "export"
      signature_event_kind:
        | "sent"
        | "signed"
        | "declined"
        | "voided"
        | "expired"
        | "completed"
        | "superseded"
        | "replayed"
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
      subscription_status: "trial" | "trial_ended" | "active" | "cancelled"
      task_audience: "internal" | "client"
      task_priority: "low" | "normal" | "high" | "critical"
      task_status: "open" | "blocked" | "done" | "cancelled"
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
      access_grant_kind: ["explicit", "guardian"],
      agreement_kind: [
        "quote",
        "consultation",
        "service",
        "amendment",
        "consent",
      ],
      agreement_signer_role: [
        "client",
        "consultant",
        "sponsor",
        "dependant",
        "guardian",
        "firm",
      ],
      agreement_signer_status: ["waiting", "current", "signed", "declined"],
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
      answer_date_kind: ["exact", "year_month", "year"],
      answer_presence: ["provided", "unknown", "not_applicable", "approximate"],
      booking_actor: ["client", "staff", "system"],
      booking_location_kind: ["video", "phone", "in_person", "meeting_link"],
      booking_status: [
        "held",
        "pending_payment",
        "confirmed",
        "cancelled",
        "expired",
        "no_show",
        "completed",
      ],
      client_fund_entry_kind: ["deposit", "transfer", "refund", "correction"],
      client_fund_entry_status: [
        "pending_verification",
        "verified",
        "rejected",
        "pending_approval",
        "approved",
        "declined",
        "recorded",
      ],
      client_fund_method: [
        "bank_transfer",
        "interac_e_transfer",
        "cheque",
        "cash",
      ],
      client_reconciliation_status: [
        "pending_review",
        "reconciled",
        "exceptions",
        "discarded",
      ],
      complaint_category: [
        "fees_billing",
        "communication",
        "service_quality",
        "conduct",
        "privacy",
        "other",
      ],
      compliance_channel: [
        "email",
        "phone",
        "letter",
        "in_person",
        "portal",
        "other",
      ],
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
      ],
      correspondence_channel: [
        "portal_message",
        "email",
        "mail",
        "courier",
        "in_person",
        "other",
      ],
      correspondence_kind: [
        "acknowledgement",
        "application_number",
        "request",
        "biometrics_instruction",
        "procedural_fairness",
        "status_update",
        "decision",
        "other",
      ],
      credential_status: [
        "declared",
        "verified",
        "not_entitled",
        "inactive",
        "suspended",
        "revoked",
      ],
      credit_note_status: ["draft", "issued", "declined"],
      date_precision: ["day", "month", "year"],
      deadline_kind: ["legal", "correspondence", "internal"],
      deadline_verification: ["tentative", "confirmed"],
      decision_follow_up_kind: [
        "refusal_review",
        "client_explanation",
        "next_steps_meeting",
        "conditions_summary",
        "document_delivery",
        "expiry_reminder",
        "account_reconciliation",
        "closure_checklist",
      ],
      decision_milestone: [
        "approval_in_principle",
        "final_approval",
        "documents_issued",
        "arrival_confirmed",
        "status_expiry_recorded",
        "other",
      ],
      decision_record_state: ["awaiting_confirmation", "confirmed"],
      decision_step: [
        "withdrawal_instructions",
        "consultant_review",
        "withdrawal_request_sent",
        "acknowledgement_received",
        "financial_reconciliation",
      ],
      document_audience: ["subject", "matter", "staff"],
      document_request_source: ["rule", "staff"],
      document_request_status: ["open", "fulfilled", "waived", "cancelled"],
      document_review_decision: ["accepted", "changes_requested"],
      document_review_state: ["pending", "accepted", "rejected"],
      document_sensitivity: ["ordinary", "narrative", "medical", "criminal"],
      document_upload_state: [
        "uploading",
        "scanning",
        "quarantined",
        "clean",
        "failed",
      ],
      domain_match_kind: ["exact", "suffix"],
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
        "message",
      ],
      engagement_status: ["pending", "engaged", "exception", "ended"],
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
      government_status: [
        "not_recorded",
        "receipt_on_file",
        "processing_reported",
        "additional_request_open",
        "decision_evidence_on_file",
      ],
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
      intake_response_status: ["draft", "submitted"],
      intake_template_status: ["draft", "published", "superseded"],
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
      invoice_payment_status: [
        "requires_payment",
        "processing",
        "succeeded",
        "failed",
        "canceled",
      ],
      invoice_refund_status: [
        "pending",
        "requires_action",
        "succeeded",
        "failed",
        "canceled",
      ],
      invoice_status: [
        "draft",
        "issued",
        "partially_paid",
        "paid",
        "voided",
        "credited",
        "refunded",
      ],
      lead_conflict_result: [
        "not_checked",
        "clear",
        "possible_conflict",
        "conflict",
      ],
      lead_consent_purpose: ["enquiry_reply", "marketing"],
      lead_source: [
        "web_form",
        "hosted_page",
        "booking_page",
        "phone",
        "email",
        "referral",
        "event",
        "walk_in",
        "csv_import",
        "other",
      ],
      lead_stage_kind: ["open", "converted", "lost", "archived"],
      licence_check_result: [
        "verified",
        "not_entitled",
        "inactive",
        "suspended",
        "revoked",
      ],
      licence_type: ["RCIC", "RISIA"],
      matter_export_status: ["building", "ready", "failed", "cancelled"],
      matter_outcome: [
        "approved",
        "refused",
        "withdrawn",
        "returned_or_incomplete",
        "abandoned",
        "other_verified",
      ],
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
      person_section_key: [
        "passport_bio",
        "school_transcript",
        "police_certificate",
        "shared_family_record",
        "private_record",
      ],
      privacy_redaction_state: ["to_do", "redacted", "excluded", "kept"],
      privacy_request_kind: [
        "access",
        "correction",
        "consent_withdrawal",
        "deletion",
      ],
      privacy_request_outcome: [
        "fulfilled",
        "partly_fulfilled",
        "refused",
        "withdrawn",
      ],
      register_licence_status: ["active", "inactive"],
      reminder_status: ["pending", "sent", "cancelled"],
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
      sample_proof_step: [
        "intake",
        "agreement",
        "upload",
        "reminder",
        "invoice",
        "export",
      ],
      signature_event_kind: [
        "sent",
        "signed",
        "declined",
        "voided",
        "expired",
        "completed",
        "superseded",
        "replayed",
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
      submission_channel: [
        "online_portal",
        "paper",
        "email",
        "in_person",
        "other",
      ],
      submission_handoff_status: [
        "awaiting_signoff",
        "authorized",
        "submission_unverified",
        "submission_verified",
        "cancelled",
      ],
      subscription_status: ["trial", "trial_ended", "active", "cancelled"],
      task_audience: ["internal", "client"],
      task_priority: ["low", "normal", "high", "critical"],
      task_status: ["open", "blocked", "done", "cancelled"],
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
