// lib/supabase/database.types.ts
//
// GENERATED FILE — do not hand-edit. Produced by the Supabase MCP server's
// `generate_typescript_types` against the live "ONLib" project
// (sxacqmpsuupjgjhoonhb) on 2026-07-28, after applying
// supabase/migrations/0001-0009 fresh to that project.
//
// Regenerate after every future migration change:
//   npx supabase gen types typescript --project-id sxacqmpsuupjgjhoonhb --schema public > lib/supabase/database.types.ts
// (or re-run the Supabase MCP `generate_typescript_types` tool and paste the
// result back into this file).
//
// Why this replaced an earlier hand-authored version: the hand-authored file
// was missing the `__InternalSupabase: { PostgrestVersion }` marker below,
// which recent @supabase/supabase-js versions require to select the correct
// client-typing overload. Without it, `.from("<table>")` silently resolved
// every Row/Insert/Update type to `never`, producing errors like
// `Object literal may only specify known properties, and 'name' does not
// exist in type 'never[]'` on every insert/update — that was the actual bug
// behind the first failed Vercel build, not a column mismatch.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cart_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      delivery_agents: {
        Row: {
          created_at: string
          duty_status: Database["public"]["Enums"]["duty_status"]
          id: string
          is_active: boolean
          name: string
          phone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duty_status?: Database["public"]["Enums"]["duty_status"]
          id?: string
          is_active?: boolean
          name: string
          phone: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duty_status?: Database["public"]["Enums"]["duty_status"]
          id?: string
          is_active?: boolean
          name?: string
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      delivery_expenses: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string | null
          expense_date: string
          id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          id?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_orders: {
        Row: {
          assigned_agent_id: string | null
          created_at: string
          dropoff_address: string
          id: string
          item_description: string
          pickup_address: string
          placed_by_admin: boolean
          price_cents: number | null
          sender_id: string | null
          sender_name: string
          sender_phone: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string | null
          created_at?: string
          dropoff_address: string
          id?: string
          item_description: string
          pickup_address: string
          placed_by_admin?: boolean
          price_cents?: number | null
          sender_id?: string | null
          sender_name: string
          sender_phone?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string | null
          created_at?: string
          dropoff_address?: string
          id?: string
          item_description?: string
          pickup_address?: string
          placed_by_admin?: boolean
          price_cents?: number | null
          sender_id?: string | null
          sender_name?: string
          sender_phone?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_orders_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "delivery_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_orders_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_price_presets: {
        Row: {
          amount: number
          created_at: string
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          label: string
          sort_order?: number
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      delivery_settings: {
        Row: {
          business_email: string | null
          business_phone: string | null
          id: string
          updated_at: string
        }
        Insert: {
          business_email?: string | null
          business_phone?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          business_email?: string | null
          business_phone?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          buyer_id: string | null
          buyer_name: string
          created_at: string
          id: string
          status: Database["public"]["Enums"]["order_status"]
          store_id: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          buyer_id?: string | null
          buyer_name: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["order_status"]
          store_id: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          buyer_id?: string | null
          buyer_name?: string
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category_id: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          image_path: string | null
          is_active: boolean
          is_featured: boolean
          name: string
          price_cents: number
          rating_avg: number
          rating_count: number
          slug: string
          store_id: string
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          is_featured?: boolean
          name: string
          price_cents: number
          rating_avg?: number
          rating_count?: number
          slug: string
          store_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_path?: string | null
          is_active?: boolean
          is_featured?: boolean
          name?: string
          price_cents?: number
          rating_avg?: number
          rating_count?: number
          slug?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      stores: {
        Row: {
          avatar_color: string
          created_at: string
          id: string
          is_active: boolean
          logo_path: string | null
          name: string
          owner_id: string
          rating_avg: number
          rating_count: number
          slug: string
          updated_at: string
        }
        Insert: {
          avatar_color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name: string
          owner_id: string
          rating_avg?: number
          rating_count?: number
          slug: string
          updated_at?: string
        }
        Update: {
          avatar_color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_path?: string | null
          name?: string
          owner_id?: string
          rating_avg?: number
          rating_count?: number
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_applications: {
        Row: {
          business_name: string
          business_registration_path: string | null
          created_at: string
          id: string
          id_document_path: string | null
          id_document_type: Database["public"]["Enums"]["id_document_type"]
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["vendor_application_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          business_name: string
          business_registration_path?: string | null
          created_at?: string
          id?: string
          id_document_path?: string | null
          id_document_type: Database["public"]["Enums"]["id_document_type"]
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["vendor_application_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          business_name?: string
          business_registration_path?: string | null
          created_at?: string
          id?: string
          id_document_path?: string | null
          id_document_type?: Database["public"]["Enums"]["id_document_type"]
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["vendor_application_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_applications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlist_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
      is_approved_vendor_for_store: {
        Args: { target_store_id: string }
        Returns: boolean
      }
      owns_store: { Args: { target_store_id: string }; Returns: boolean }
    }
    Enums: {
      delivery_status:
        | "pending"
        | "accepted"
        | "picked_up"
        | "delivered"
        | "cancelled"
      duty_status: "on_duty" | "off_duty"
      id_document_type: "passport" | "national_id" | "drivers_license"
      order_status: "pending" | "processing" | "fulfilled" | "cancelled"
      user_role: "customer" | "vendor" | "admin"
      vendor_application_status: "pending" | "approved" | "rejected"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      delivery_status: [
        "pending",
        "accepted",
        "picked_up",
        "delivered",
        "cancelled",
      ],
      duty_status: ["on_duty", "off_duty"],
      id_document_type: ["passport", "national_id", "drivers_license"],
      order_status: ["pending", "processing", "fulfilled", "cancelled"],
      user_role: ["customer", "vendor", "admin"],
      vendor_application_status: ["pending", "approved", "rejected"],
    },
  },
} as const
