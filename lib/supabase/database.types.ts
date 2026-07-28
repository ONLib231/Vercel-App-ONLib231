// lib/supabase/database.types.ts
//
// ⚠️ THIS FILE IS HAND-AUTHORED, NOT GENERATED — READ THIS BEFORE TOUCHING IT.
//
// The Supabase CLI (`npx supabase`) could not be reached from the sandbox
// this repo was first built in (its outbound network only allowlists a
// handful of hosts and registry.npmjs.org / the Supabase CLI's own download
// host were not on it), so `npx supabase gen types typescript ...` could
// not be run against a real project here.
//
// This file was instead written by hand to match supabase/migrations/*.sql
// column-for-column, using the exact shape `supabase gen types` produces
// (Database.public.Tables.<table>.{Row,Insert,Update}, .Enums, .Functions),
// so that swapping it for a real generated file is a drop-in replacement
// with no call-site changes required.
//
// >>> REPLACE THIS FILE FOR REAL as soon as you can run, from a machine/CI
// >>> runner with normal internet access:
// >>>
// >>>   npx supabase login
// >>>   npx supabase link --project-ref <your-project-ref>
// >>>   npx supabase gen types typescript --project-id <your-project-ref> --schema public > lib/supabase/database.types.ts
// >>>
// >>> Re-run that command after every migration change. Do this before your
// >>> first production deploy, and treat any diff it produces against this
// >>> file as a bug in this hand-authored version to go fix in the SQL or
// >>> here — not the other way around.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          role: Database["public"]["Enums"]["user_role"];
          phone: string | null;
          avatar_path: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          phone?: string | null;
          avatar_path?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          phone?: string | null;
          avatar_path?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          name: string;
          slug: string;
          icon: string | null;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          icon?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          icon?: string | null;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      stores: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          slug: string;
          logo_path: string | null;
          avatar_color: string;
          rating_avg: number;
          rating_count: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          slug: string;
          logo_path?: string | null;
          avatar_color?: string;
          rating_avg?: number;
          rating_count?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          slug?: string;
          logo_path?: string | null;
          avatar_color?: string;
          rating_avg?: number;
          rating_count?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          store_id: string;
          category_id: string | null;
          name: string;
          slug: string;
          description: string | null;
          price_cents: number;
          currency: string;
          image_path: string | null;
          rating_avg: number;
          rating_count: number;
          is_featured: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          category_id?: string | null;
          name: string;
          slug: string;
          description?: string | null;
          price_cents: number;
          currency?: string;
          image_path?: string | null;
          rating_avg?: number;
          rating_count?: number;
          is_featured?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          category_id?: string | null;
          name?: string;
          slug?: string;
          description?: string | null;
          price_cents?: number;
          currency?: string;
          image_path?: string | null;
          rating_avg?: number;
          rating_count?: number;
          is_featured?: boolean;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      cart_items: {
        Row: {
          id: string;
          user_id: string;
          product_id: string;
          quantity: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_id: string;
          quantity?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          product_id?: string;
          quantity?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      wishlist_items: {
        Row: {
          id: string;
          user_id: string;
          product_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          product_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          body: string | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          body?: string | null;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          body?: string | null;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      vendor_applications: {
        Row: {
          id: string;
          user_id: string;
          business_name: string;
          id_document_type: Database["public"]["Enums"]["id_document_type"];
          business_registration_path: string | null;
          id_document_path: string | null;
          status: Database["public"]["Enums"]["vendor_application_status"];
          reviewed_by: string | null;
          reviewed_at: string | null;
          rejection_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          business_name: string;
          id_document_type: Database["public"]["Enums"]["id_document_type"];
          business_registration_path?: string | null;
          id_document_path?: string | null;
          status?: Database["public"]["Enums"]["vendor_application_status"];
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          business_name?: string;
          id_document_type?: Database["public"]["Enums"]["id_document_type"];
          business_registration_path?: string | null;
          id_document_path?: string | null;
          status?: Database["public"]["Enums"]["vendor_application_status"];
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          store_id: string;
          buyer_id: string | null;
          buyer_name: string;
          total_cents: number;
          status: Database["public"]["Enums"]["order_status"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          buyer_id?: string | null;
          buyer_name: string;
          total_cents?: number;
          status?: Database["public"]["Enums"]["order_status"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          buyer_id?: string | null;
          buyer_name?: string;
          total_cents?: number;
          status?: Database["public"]["Enums"]["order_status"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      delivery_agents: {
        Row: {
          id: string;
          name: string;
          phone: string;
          duty_status: Database["public"]["Enums"]["duty_status"];
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          phone: string;
          duty_status?: Database["public"]["Enums"]["duty_status"];
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          phone?: string;
          duty_status?: Database["public"]["Enums"]["duty_status"];
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      delivery_orders: {
        Row: {
          id: string;
          sender_id: string | null;
          sender_name: string;
          sender_phone: string | null;
          pickup_address: string;
          dropoff_address: string;
          item_description: string;
          price_cents: number | null;
          status: Database["public"]["Enums"]["delivery_status"];
          placed_by_admin: boolean;
          assigned_agent_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sender_id?: string | null;
          sender_name: string;
          sender_phone?: string | null;
          pickup_address: string;
          dropoff_address: string;
          item_description: string;
          price_cents?: number | null;
          status?: Database["public"]["Enums"]["delivery_status"];
          placed_by_admin?: boolean;
          assigned_agent_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          sender_id?: string | null;
          sender_name?: string;
          sender_phone?: string | null;
          pickup_address?: string;
          dropoff_address?: string;
          item_description?: string;
          price_cents?: number | null;
          status?: Database["public"]["Enums"]["delivery_status"];
          placed_by_admin?: boolean;
          assigned_agent_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      delivery_expenses: {
        Row: {
          id: string;
          expense_date: string;
          amount: number;
          description: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          expense_date?: string;
          amount: number;
          description?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          expense_date?: string;
          amount?: number;
          description?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      delivery_price_presets: {
        Row: {
          id: string;
          label: string;
          amount: number;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          label: string;
          amount: number;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          label?: string;
          amount?: number;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      delivery_settings: {
        Row: {
          id: string;
          business_phone: string | null;
          business_email: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_phone?: string | null;
          business_email?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_phone?: string | null;
          business_email?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      owns_store: {
        Args: { target_store_id: string };
        Returns: boolean;
      };
      is_approved_vendor_for_store: {
        Args: { target_store_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      user_role: "customer" | "vendor" | "admin";
      id_document_type: "passport" | "national_id" | "drivers_license";
      vendor_application_status: "pending" | "approved" | "rejected";
      order_status: "pending" | "processing" | "fulfilled" | "cancelled";
      duty_status: "on_duty" | "off_duty";
      delivery_status: "pending" | "accepted" | "picked_up" | "delivered" | "cancelled";
    };
    CompositeTypes: Record<string, never>;
  };
}

// --- Small convenience aliases used throughout app/ and lib/ -------------
// Kept here (co-located with Database) instead of scattered per-file so
// there is exactly one place that maps table name -> row/insert/update type.

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
