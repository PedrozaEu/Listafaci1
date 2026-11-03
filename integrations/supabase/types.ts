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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      legacy_id_map: {
        Row: {
          import_id: string
          kind: string
          legacy_id: string
          new_id: string
          owner_id: string
        }
        Insert: {
          import_id: string
          kind: string
          legacy_id: string
          new_id: string
          owner_id: string
        }
        Update: {
          import_id?: string
          kind?: string
          legacy_id?: string
          new_id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legacy_id_map_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "legacy_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_imports: {
        Row: {
          actual: Json | null
          checksum: string
          created_at: string
          expected: Json
          id: string
          owner_id: string
          schema_version: number
          source: string
          state: string
          updated_at: string
        }
        Insert: {
          actual?: Json | null
          checksum: string
          created_at?: string
          expected: Json
          id?: string
          owner_id: string
          schema_version: number
          source: string
          state?: string
          updated_at?: string
        }
        Update: {
          actual?: Json | null
          checksum?: string
          created_at?: string
          expected?: Json
          id?: string
          owner_id?: string
          schema_version?: number
          source?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      legacy_price_history: {
        Row: {
          cents: number
          import_id: string
          item_key: string
          month: string
          owner_id: string
        }
        Insert: {
          cents: number
          import_id: string
          item_key: string
          month: string
          owner_id: string
        }
        Update: {
          cents?: number
          import_id?: string
          item_key?: string
          month?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legacy_price_history_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "legacy_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      list_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          list_id: string
          revoked_at: string | null
          role: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          list_id: string
          revoked_at?: string | null
          role: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          list_id?: string
          revoked_at?: string | null
          role?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_invites_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "shared_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_items: {
        Row: {
          added_by: string | null
          category: string | null
          control_portion: number | null
          created_at: string
          deleted_at: string | null
          id: string
          legacy_created_at: string | null
          list_id: string
          marked_at: string | null
          marked_by: string | null
          name: string
          note: string | null
          pack_size: number | null
          pack_unit: string | null
          position: number
          presentation: string | null
          price_basis: string
          price_cents: number | null
          price_estimated: boolean
          purchased: boolean
          quantity: number
          unit: string
          updated_at: string
          version: number
        }
        Insert: {
          added_by?: string | null
          category?: string | null
          control_portion?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          legacy_created_at?: string | null
          list_id: string
          marked_at?: string | null
          marked_by?: string | null
          name: string
          note?: string | null
          pack_size?: number | null
          pack_unit?: string | null
          position?: number
          presentation?: string | null
          price_basis?: string
          price_cents?: number | null
          price_estimated?: boolean
          purchased?: boolean
          quantity?: number
          unit?: string
          updated_at?: string
          version?: number
        }
        Update: {
          added_by?: string | null
          category?: string | null
          control_portion?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          legacy_created_at?: string | null
          list_id?: string
          marked_at?: string | null
          marked_by?: string | null
          name?: string
          note?: string | null
          pack_size?: number | null
          pack_unit?: string | null
          position?: number
          presentation?: string | null
          price_basis?: string
          price_cents?: number | null
          price_estimated?: boolean
          purchased?: boolean
          quantity?: number
          unit?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "shared_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_members: {
        Row: {
          color: string
          created_at: string
          display_name: string
          list_id: string
          role: string
          status: string
          user_id: string
        }
        Insert: {
          color: string
          created_at?: string
          display_name: string
          list_id: string
          role: string
          status?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          display_name?: string
          list_id?: string
          role?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "shared_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      list_operations: {
        Row: {
          created_at: string
          kind: string
          list_id: string
          operation_id: string
          result: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          kind: string
          list_id: string
          operation_id: string
          result?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          kind?: string
          list_id?: string
          operation_id?: string
          result?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "list_operations_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "shared_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      shared_lists: {
        Row: {
          budget_cents: number | null
          created_at: string
          emoji: string
          id: string
          legacy_created_at: string | null
          name: string
          owner_id: string
          route_version: number
          sort_mode: string | null
          source_list_id: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          budget_cents?: number | null
          created_at?: string
          emoji?: string
          id?: string
          legacy_created_at?: string | null
          name: string
          owner_id: string
          route_version?: number
          sort_mode?: string | null
          source_list_id?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          budget_cents?: number | null
          created_at?: string
          emoji?: string
          id?: string
          legacy_created_at?: string | null
          name?: string
          owner_id?: string
          route_version?: number
          sort_mode?: string | null
          source_list_id?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      shared_purchases: {
        Row: {
          completed_by: string
          created_at: string
          id: string
          list_id: string
          purchased_on: string
          snapshot: Json
        }
        Insert: {
          completed_by: string
          created_at?: string
          id?: string
          list_id: string
          purchased_on: string
          snapshot: Json
        }
        Update: {
          completed_by?: string
          created_at?: string
          id?: string
          list_id?: string
          purchased_on?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "shared_purchases_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "shared_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      user_state: {
        Row: {
          data: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          data?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          data?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_state_history: {
        Row: {
          created_at: string
          data: Json
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_list_invite: {
        Args: { _display_name: string; _token: string }
        Returns: Json
      }
      accept_list_invite_v2: {
        Args: { _display_name: string; _token: string }
        Returns: Json
      }
      apply_list_op: {
        Args: {
          _base_version: number
          _entity_id: string
          _kind: string
          _list_id: string
          _operation_id: string
          _payload: Json
        }
        Returns: Json
      }
      begin_legacy_import: {
        Args: {
          _checksum: string
          _expected: Json
          _schema_version: number
          _source: string
        }
        Returns: Json
      }
      can_edit_list: { Args: { _list_id: string }; Returns: boolean }
      can_mark_list: { Args: { _list_id: string }; Returns: boolean }
      collab_begin_op: {
        Args: { _kind: string; _list: string; _op: string }
        Returns: Json
      }
      collab_finish_op: { Args: { _op: string; _result: Json }; Returns: Json }
      collab_palette: { Args: never; Returns: string[] }
      collab_schema_version: { Args: never; Returns: string }
      complete_shared_purchase: {
        Args: {
          _confirmed_ids: string[]
          _expected_versions: number[]
          _item_ids: string[]
          _list_id: string
          _operation_id: string
          _purchased_on: string
        }
        Returns: Json
      }
      create_list_invite: {
        Args: { _days?: number; _list_id: string; _role: string }
        Returns: Json
      }
      create_list_invite_v2: {
        Args: { _hours?: number; _list_id: string; _role?: string }
        Returns: Json
      }
      finalize_legacy_import: { Args: { _import_id: string }; Returns: Json }
      import_legacy_chunk: {
        Args: { _import_id: string; _payload: Json }
        Returns: Json
      }
      invite_link_status: {
        Args: { _list_id: string; _uid: string }
        Returns: string
      }
      is_list_member: { Args: { _list_id: string }; Returns: boolean }
      legacy_import_summary: { Args: { _import_id: string }; Returns: Json }
      legacy_map_id: {
        Args: {
          _import: string
          _kind: string
          _legacy: string
          _taken: boolean
        }
        Returns: string
      }
      list_role: { Args: { _list_id: string }; Returns: string }
      member_color: { Args: { _user_id: string }; Returns: string }
      peek_list_invite: { Args: { _token: string }; Returns: Json }
      remove_list_member: {
        Args: { _list_id: string; _user_id: string }
        Returns: undefined
      }
      reorder_items: {
        Args: {
          _expected_route_version: number
          _item_ids: string[]
          _list_id: string
          _operation_id: string
        }
        Returns: Json
      }
      revoke_list_invite: { Args: { _invite_id: string }; Returns: undefined }
      save_purchase_record: {
        Args: {
          _id: string
          _list_id: string
          _purchased_on: string
          _snapshot: Json
        }
        Returns: undefined
      }
      set_item_marked: {
        Args: {
          _expected_version: number
          _item_id: string
          _marked: boolean
          _operation_id: string
        }
        Returns: Json
      }
      set_legacy_import_state: {
        Args: { _import_id: string; _state: string }
        Returns: undefined
      }
      set_member_role: {
        Args: { _list_id: string; _role: string; _user_id: string }
        Returns: undefined
      }
      set_my_display_name: {
        Args: { _display_name: string; _list_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
