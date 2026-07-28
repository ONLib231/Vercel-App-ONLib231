// lib/delivery-admin.ts
// Server-only read queries for the Delivery Admin dashboard (/admin/delivery/*).
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type DeliveryOrder = Tables<"delivery_orders">;
export type DeliveryAgent = Tables<"delivery_agents">;
export type DeliveryExpense = Tables<"delivery_expenses">;
export type DeliveryPricePreset = Tables<"delivery_price_presets">;
export type DeliverySettings = Tables<"delivery_settings">;

export async function getDeliveryOrders(limit = 100): Promise<DeliveryOrder[]> {
  const supabase = await createClient();
  const { data, error }: { data: DeliveryOrder[] | null; error: { message: string } | null } = await supabase
    .from("delivery_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getDeliveryOrders:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getDeliveryAgents(): Promise<DeliveryAgent[]> {
  const supabase = await createClient();
  const { data, error }: { data: DeliveryAgent[] | null; error: { message: string } | null } = await supabase
    .from("delivery_agents")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getDeliveryAgents:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getDeliveryExpenses(limit = 100): Promise<DeliveryExpense[]> {
  const supabase = await createClient();
  const { data, error }: { data: DeliveryExpense[] | null; error: { message: string } | null } = await supabase
    .from("delivery_expenses")
    .select("*")
    .order("expense_date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getDeliveryExpenses:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getDeliveryPricePresets(): Promise<DeliveryPricePreset[]> {
  const supabase = await createClient();
  const { data, error }: { data: DeliveryPricePreset[] | null; error: { message: string } | null } = await supabase
    .from("delivery_price_presets")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("getDeliveryPricePresets:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getDeliverySettings(): Promise<DeliverySettings | null> {
  const supabase = await createClient();
  const { data, error }: { data: DeliverySettings | null; error: { message: string } | null } = await supabase
    .from("delivery_settings")
    .select("*")
    .eq("id", "business")
    .maybeSingle();

  if (error) {
    console.error("getDeliverySettings:", error.message);
    return null;
  }
  return data;
}
