// Live schema (project aqjtvqmojfamtspzyeqm) through 20261017113202, extended in-repo
// for unapplied migrations 20261017120000 and 20261017140000–20261017140700.
// Regenerate with `pnpm db:types` only after those migrations are applied live.

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
      consultant_credentials: {
        Row: {
          checked_at: string | null
          college_id: string
          created_at: string
          created_by: string | null
          declared_at: string
          discipline_restricted: boolean
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
      credential_checks: {
        Row: {
          created_at: string
          credential_id: string
          discipline_restricted: boolean
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
          id: string
          is_sample: boolean
          on_hold: boolean
          organization_id: string
          sample_label: string | null
          stage: Database["public"]["Enums"]["matter_stage"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_sample?: boolean
          on_hold?: boolean
          organization_id: string
          sample_label?: string | null
          stage?: Database["public"]["Enums"]["matter_stage"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_sample?: boolean
          on_hold?: boolean
          organization_id?: string
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
          dpa_accepted_at?: string | null
          dpa_version?: string | null
          id?: string
          jurisdiction_codes?: string[]
          legal_name: string
          privacy_contact_email?: string | null
          privacy_contact_name?: string | null
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
          dpa_accepted_at?: string | null
          dpa_version?: string | null
          id?: string
          jurisdiction_codes?: string[]
          legal_name?: string
          privacy_contact_email?: string | null
          privacy_contact_name?: string | null
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
      persons: {
        Row: {
          birth_date: string | null
          birth_date_precision: Database["public"]["Enums"]["date_precision"] | null
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
          birth_date_precision?: Database["public"]["Enums"]["date_precision"] | null
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
          birth_date_precision?: Database["public"]["Enums"]["date_precision"] | null
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
      close_person_break_glass: {
        Args: { p_id: string }
        Returns: undefined
      }
      consume_recovery_code: {
        Args: { p_code: string }
        Returns: boolean
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
      create_staff_invitation: {
        Args: {
          email: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
        }
        Returns: string
      }
      generate_recovery_codes: {
        Args: never
        Returns: string[]
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
      open_person_break_glass: {
        Args: { p_person_id: string; p_reason: string }
        Returns: string
      }
      perform_billing_action: {
        Args: { p_action: string; p_matter_id: string }
        Returns: string
      }
      reset_staff_mfa: {
        Args: {
          p_organization_id: string
          p_reason: string
          p_target_user_id: string
        }
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
      revoke_staff_invitation: {
        Args: { invitation_id: string }
        Returns: undefined
      }
      session_mfa_satisfied: {
        Args: never
        Returns: boolean
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
      attempt_matter_stage_transition: {
        Args: {
          p_expected_version: number
          p_matter_id: string
          p_reason: string
          p_to_stage: Database["public"]["Enums"]["matter_stage"]
        }
        Returns: Json
      }
      complete_sample_proof: {
        Args: {
          p_matter_id: string
          p_step: Database["public"]["Enums"]["sample_proof_step"]
        }
        Returns: undefined
      }
      create_practice_matter: {
        Args: { p_is_sample: boolean; p_title: string }
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
      evaluate_real_client_invites: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      list_exportable_matter_ids: {
        Args: never
        Returns: { matter_id: string }[]
      }
      reassign_consultant_matters: {
        Args: {
          p_from_membership: string
          p_reason: string
          p_to_membership: string
        }
        Returns: number
      }
      record_licence_check: {
        Args: {
          p_credential_id: string
          p_discipline_restricted: boolean
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
      save_firm_setup: {
        Args: {
          p_payload: Json
          p_step: Database["public"]["Enums"]["firm_setup_step"]
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
      set_product_setting: {
        Args: { p_key: string; p_value: Json }
        Returns: undefined
      }
      set_sample_mode: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      sync_trial_status: {
        Args: never
        Returns: Database["public"]["Enums"]["subscription_status"]
      }
    }
    Enums: {
      access_grant_kind: "explicit" | "guardian"
      date_precision: "day" | "month" | "year"
      credential_status:
        | "declared"
        | "verified"
        | "not_entitled"
        | "inactive"
        | "suspended"
        | "revoked"
      domain_match_kind: "exact" | "suffix"
      firm_setup_step:
        | "firm_profile"
        | "offices"
        | "jurisdictions"
        | "privacy_and_terms"
        | "branding"
        | "retention"
        | "continuity"
        | "licence"
      licence_check_result: "verified" | "not_entitled" | "inactive" | "suspended" | "revoked"
      licence_type: "RCIC" | "RISIA"
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
      register_licence_status: "active" | "inactive"
      sample_proof_step: "intake" | "agreement" | "upload" | "reminder" | "invoice" | "export"
      subscription_status: "trial" | "trial_ended" | "active" | "cancelled"
      person_relationship_type:
        | "spouse"
        | "parent"
        | "child"
        | "payer"
        | "sponsor"
        | "household"
        | "other"
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
      date_precision: ["day", "month", "year"],
      credential_status: ["declared", "verified", "not_entitled", "inactive", "suspended", "revoked"],
      domain_match_kind: ["exact", "suffix"],
      firm_setup_step: [
        "firm_profile",
        "offices",
        "jurisdictions",
        "privacy_and_terms",
        "branding",
        "retention",
        "continuity",
        "licence",
      ],
      licence_check_result: ["verified", "not_entitled", "inactive", "suspended", "revoked"],
      licence_type: ["RCIC", "RISIA"],
      register_licence_status: ["active", "inactive"],
      sample_proof_step: ["intake", "agreement", "upload", "reminder", "invoice", "export"],
      subscription_status: ["trial", "trial_ended", "active", "cancelled"],
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
