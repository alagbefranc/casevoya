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
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          default_locale: string
          display_name: string
          id: string
          jurisdiction_codes: string[]
          legal_name: string
          slug: string
          timezone: string
          updated_at: string
          verification_status: Database["public"]["Enums"]["org_verification_status"]
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_locale?: string
          display_name: string
          id?: string
          jurisdiction_codes?: string[]
          legal_name: string
          slug: string
          timezone?: string
          updated_at?: string
          verification_status?: Database["public"]["Enums"]["org_verification_status"]
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_locale?: string
          display_name?: string
          id?: string
          jurisdiction_codes?: string[]
          legal_name?: string
          slug?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_organization: {
        Args: { display_name: string; legal_name: string; slug: string }
        Returns: {
          created_at: string
          created_by: string | null
          default_locale: string
          display_name: string
          id: string
          jurisdiction_codes: string[]
          legal_name: string
          slug: string
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
    }
    Enums: {
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
    },
  },
} as const
