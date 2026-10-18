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
          document_max_bytes: number | null
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
          document_max_bytes?: number | null
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
          document_max_bytes?: number | null
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
        Relationships: []
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
          upload_state?: string
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
        Relationships: []
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
      request_mfa_reset: {
        Args: { p_reason: string }
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
      ensure_sample_case: { Args: never; Returns: string }
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
      accept_portal_invitation: {
        Args: { p_payload: Json; p_token: string }
        Returns: Json
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
      decline_portal_invitation: {
        Args: { p_token: string }
        Returns: Json
      }
      preview_portal_invitation: {
        Args: { p_token: string }
        Returns: Json
      }
      publish_portal_policy: {
        Args: { p_body: string; p_kind: string; p_title: string; p_version_label: string }
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
      report_portal_invitation_mismatch: {
        Args: { p_token: string }
        Returns: Json
      }
      resend_portal_invitation: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      revoke_portal_invitation: {
        Args: { p_invitation_id: string }
        Returns: Json
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
      save_portal_invitation_draft: {
        Args: { p_draft: Json; p_token: string }
        Returns: Json
      }
      withdraw_section_share: {
        Args: { p_share_id: string }
        Returns: undefined
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
      set_credential_valid_until: {
        Args: { p_credential_id: string; p_valid_until: string | null }
        Returns: string
      }
      set_sample_mode: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      sync_trial_status: {
        Args: never
        Returns: Database["public"]["Enums"]["subscription_status"]
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
      assign_responsible_consultant: {
        Args: { p_expected_version: number; p_matter_id: string; p_membership_id: string }
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
      clear_matter_on_hold: {
        Args: { p_expected_version: number; p_matter_id: string; p_reason: string }
        Returns: number
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
      link_successor_matter: {
        Args: { p_predecessor_id: string; p_reason: string; p_successor_id: string }
        Returns: string
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
      open_intake_response: {
        Args: { p_matter_id: string; p_person_id: string; p_template_id: string }
        Returns: string
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
      submit_intake_response: {
        Args: { p_expected_version: number; p_response_id: string }
        Returns: number
      }
      freeze_intake_response: {
        Args: { p_response_id: string }
        Returns: undefined
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
      set_task_status: {
        Args: {
          p_blocker_note: string | null
          p_expected_version: number
          p_status: Database["public"]["Enums"]["task_status"]
          p_task_id: string
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
      add_task_dependency: {
        Args: { p_depends_on_task_id: string; p_task_id: string }
        Returns: string
      }
      add_task_watcher: {
        Args: { p_membership_id: string; p_task_id: string }
        Returns: string
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
      confirm_deadline: {
        Args: { p_deadline_id: string; p_expected_version: number }
        Returns: number
      }
      schedule_deadline_reminders: {
        Args: { p_as_of: string; p_deadline_id: string }
        Returns: number
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
      claim_due_reminders: {
        Args: { p_as_of: string; p_limit: number }
        Returns: string[]
      }
      escalate_overdue_work: {
        Args: { p_as_of: string }
        Returns: number
      }
      set_quiet_hours: {
        Args: { p_end: string | null; p_start: string | null }
        Returns: undefined
      }
      set_firm_reminder_offsets: {
        Args: { p_days: number[] }
        Returns: undefined
      }
      open_majority_review_task: {
        Args: { p_person_id: string }
        Returns: string
      }
      deadline_local_end: {
        Args: { p_due_on: string; p_timezone: string }
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
      complete_document_upload: {
        Args: { p_header_hex: string; p_sha256: string; p_version_id: string }
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
      apply_document_scan: {
        Args: { p_result: string; p_version_id: string }
        Returns: Database["public"]["Enums"]["document_upload_state"]
      }
      authorize_document_download: {
        Args: { p_version_id: string }
        Returns: Json
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
      set_document_upload_limit: {
        Args: { p_bytes: number }
        Returns: number
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
      attach_upload_to_request: {
        Args: { p_request_id: string; p_version_id: string }
        Returns: undefined
      }
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
      waive_document_request: {
        Args: { p_expected_version: number; p_reason: string; p_request_id: string }
        Returns: number
      }
      set_document_expiry: {
        Args: { p_expected_version: number; p_expires_on: string | null; p_version_id: string }
        Returns: number
      }
      document_request_progress: {
        Args: { p_matter_id: string }
        Returns: Json
      }
      unlink_document_matter: {
        Args: { p_reason: string; p_ref_id: string }
        Returns: undefined
      }
      create_agreement_template: {
        Args: {
          p_body: string
          p_kind: Database["public"]["Enums"]["agreement_kind"]
          p_name: string
        }
        Returns: string
      }
      approve_agreement_template: {
        Args: { p_template_id: string }
        Returns: undefined
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
      send_agreement: {
        Args: {
          p_agreement_id: string
          p_expires_at: string | null
          p_idempotency_key: string
          p_signers: Json
        }
        Returns: Json
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
      decline_agreement: {
        Args: {
          p_envelope_id: string
          p_idempotency_key: string
          p_ip: string
          p_user_agent: string
        }
        Returns: Json
      }
      void_agreement_envelope: {
        Args: { p_envelope_id: string; p_reason: string }
        Returns: undefined
      }
      accept_quote: {
        Args: { p_agreement_id: string }
        Returns: undefined
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
      revoke_representation_authority: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      agreement_executed_pdf: {
        Args: { p_envelope_id: string }
        Returns: string
      }
      agreement_certificate_pdf: {
        Args: { p_envelope_id: string }
        Returns: string
      }
      assign_unsorted_email_file: {
        Args: { p_item_id: string; p_matter_id: string; p_person_id: string }
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
      claim_mail_events: {
        Args: { p_limit?: number; p_worker: string }
        Returns: Json
      }
      complete_email_upload: {
        Args: { p_header_hex: string; p_inbound_id: string; p_ordinal: number; p_sha256: string }
        Returns: Json
      }
      complete_unsorted_assignment: {
        Args: { p_item_id: string }
        Returns: undefined
      }
      create_email_upload_intent: {
        Args: { p_byte_size: number; p_filename: string; p_inbound_id: string; p_ordinal: number }
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
      open_unsorted_email_file: {
        Args: { p_byte_size: number; p_filename: string; p_inbound_id: string; p_ordinal: number }
        Returns: Json
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
      attach_invitation_email_link: {
        Args: {
          p_invitation_id: string
          p_sealed: string
          p_token_hash: string
        }
        Returns: boolean
      }
    }
    Enums: {
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
      access_grant_kind: "explicit" | "guardian"
      agreement_kind: "quote" | "consultation" | "service" | "amendment" | "consent"
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
      agreement_signer_role: "client" | "consultant" | "sponsor" | "dependant" | "guardian" | "firm"
      agreement_signer_status: "waiting" | "current" | "signed" | "declined"
      signature_event_kind: "sent" | "signed" | "declined" | "voided" | "expired" | "completed" | "superseded" | "replayed"
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
      person_section_key:
        | "passport_bio"
        | "school_transcript"
        | "police_certificate"
        | "shared_family_record"
        | "private_record"
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
        | "firm_details"
        | "terms_and_privacy"
        | "jurisdictions"
        | "licence"
        | "branding"
        | "calendar_and_payments"
        | "records_and_retention"
        | "sample_case"
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
      engagement_status: "pending" | "engaged" | "exception" | "ended"
      government_status:
        | "not_recorded"
        | "receipt_on_file"
        | "processing_reported"
        | "additional_request_open"
        | "decision_evidence_on_file"
      matter_outcome:
        | "approved"
        | "refused"
        | "withdrawn"
        | "returned_or_incomplete"
        | "abandoned"
        | "other_verified"
      intake_workflow_category:
        | "temporary_residence"
        | "study"
        | "work"
        | "permanent_residence"
        | "sponsorship"
        | "citizenship"
        | "provincial"
        | "unspecified"
      intake_template_status: "draft" | "published" | "superseded"
      intake_response_status: "draft" | "submitted"
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
      answer_presence: "provided" | "unknown" | "not_applicable" | "approximate"
      answer_date_kind: "exact" | "year_month" | "year"
      task_audience: "internal" | "client"
      task_priority: "low" | "normal" | "high" | "critical"
      task_status: "open" | "blocked" | "done" | "cancelled"
      deadline_kind: "legal" | "correspondence" | "internal"
      deadline_verification: "tentative" | "confirmed"
      document_audience: "subject" | "matter" | "staff"
      document_request_source: "rule" | "staff"
      document_request_status: "open" | "fulfilled" | "waived" | "cancelled"
      document_review_decision: "accepted" | "changes_requested"
      document_review_state: "pending" | "accepted" | "rejected"
      document_sensitivity: "ordinary" | "narrative" | "medical" | "criminal"
      document_upload_state: "uploading" | "scanning" | "quarantined" | "clean" | "failed"
      reminder_status: "pending" | "sent" | "cancelled"
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
      ],
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
