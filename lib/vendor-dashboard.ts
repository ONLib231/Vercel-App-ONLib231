// lib/vendor-dashboard.ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Order = Tables<"orders">;
export type Product = Tables<"products">;

export type SalesSummary = {
  totalCents: number;
  orderCount: number;
  trend: { date: string; totalCents: number }[]; // last 7 days, oldest first
};

export async function getStoreSalesSummary(storeId: string): Promise<SalesSummary> {
  const supabase = await createClient();
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data, error }: { data: Pick<Order, "total_cents" | "created_at" | "status">[] | null; error: { message: string } | null } =
    await supabase
      .from("orders")
      .select("total_cents, created_at, status")
      .eq("store_id", storeId)
      .neq("status", "cancelled")
      .gte("created_at", since.toISOString());

  if (error || !data) {
    if (error) console.error("getStoreSalesSummary:", error.message);
    return { totalCents: 0, orderCount: 0, trend: emptyTrend() };
  }

  const totalCents = data.reduce((sum, order) => sum + order.total_cents, 0);
  const orderCount = data.length;

  const trendMap = new Map<string, number>();
  for (const { date } of last7Days()) trendMap.set(date, 0);
  for (const order of data) {
    const day = order.created_at.slice(0, 10);
    if (trendMap.has(day)) {
      trendMap.set(day, (trendMap.get(day) ?? 0) + order.total_cents);
    }
  }

  const trend = last7Days().map(({ date }) => ({ date, totalCents: trendMap.get(date) ?? 0 }));

  return { totalCents, orderCount, trend };
}

function last7Days(): { date: string }[] {
  const days: { date: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ date: d.toISOString().slice(0, 10) });
  }
  return days;
}

function emptyTrend(): { date: string; totalCents: number }[] {
  return last7Days().map(({ date }) => ({ date, totalCents: 0 }));
}

export async function getRecentStoreOrders(storeId: string, limit = 10): Promise<Order[]> {
  const supabase = await createClient();
  const { data, error }: { data: Order[] | null; error: { message: string } | null } = await supabase
    .from("orders")
    .select("*")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getRecentStoreOrders:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getStoreProducts(storeId: string): Promise<Product[]> {
  const supabase = await createClient();
  const { data, error }: { data: Product[] | null; error: { message: string } | null } = await supabase
    .from("products")
    .select("*")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getStoreProducts:", error.message);
    return [];
  }
  return data ?? [];
}
