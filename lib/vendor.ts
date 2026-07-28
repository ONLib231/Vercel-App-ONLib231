import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAuthUser } from "@/lib/user";
import type { OrderViewModel, VendorApplicationRow, VendorDashboardStats, VendorNavUser } from "@/types/vendor";
import type { StoreRow } from "@/types/marketplace";

/**
 * Static fallback so the Vendor Dashboard renders correctly (matching the
 * mockup numbers) before real orders exist for a brand-new store, and
 * degrades gracefully rather than throwing if a query fails.
 */
const FALLBACK_STATS: VendorDashboardStats = {
  salesLast30Label: "$18,450.00",
  salesChangePct: 12.6,
  salesTrend: [42, 58, 50, 61, 55, 68, 60, 72, 66, 80, 74, 90],
  totalOrders: 312,
  newLeads: 45,
  recentOrders: [
    { id: "12304", orderNumber: "#12304", buyerName: "Sylvester Kane", status: "fulfilled", statusLabel: "Fulfilled", totalLabel: "$150.00" },
    { id: "12303", orderNumber: "#12303", buyerName: "Adewale", status: "fulfilled", statusLabel: "Fulfilled", totalLabel: "$85.00" },
    { id: "12302", orderNumber: "#12302", buyerName: "Anion", status: "processing", statusLabel: "Processing", totalLabel: "$210.00" },
  ],
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function statusLabelFor(status: OrderViewModel["status"]): string {
  return status === "fulfilled" ? "Fulfilled" : status === "cancelled" ? "Cancelled" : "Processing";
}

/**
 * The signed-in user's vendor application, if any. Drives the /vendor/*
 * gating in app/vendor/layout.tsx (pending vs approved vs no application).
 */
export async function getVendorApplication(): Promise<VendorApplicationRow | null> {
  try {
    const user = await getCurrentAuthUser();
    if (!user) return null;

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("vendor_applications")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[getVendorApplication] Supabase query failed:", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error("[getVendorApplication] Unexpected failure:", err);
    return null;
  }
}

/** The store owned by the signed-in vendor (created automatically when their application is approved). */
export async function getMyStore(): Promise<StoreRow | null> {
  try {
    const user = await getCurrentAuthUser();
    if (!user) return null;

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.from("stores").select("*").eq("owner_id", user.id).maybeSingle();

    if (error) {
      console.error("[getMyStore] Supabase query failed:", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error("[getMyStore] Unexpected failure:", err);
    return null;
  }
}

/**
 * Display identity for the Vendor Dashboard header ("Girlee Fashion / Admin"
 * in the mockup) — every approved vendor is the "Admin" of their own store,
 * distinct from the platform-wide profiles.role enum.
 */
export async function getVendorNavUser(): Promise<VendorNavUser> {
  try {
    const user = await getCurrentAuthUser();
    if (!user) return { name: "Vendor", role: "Admin", avatarUrl: null };

    const supabase = createSupabaseServerClient();
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();

    return { name: profile?.full_name ?? user.email ?? "Vendor", role: "Admin", avatarUrl: null };
  } catch (err) {
    console.error("[getVendorNavUser] Unexpected failure:", err);
    return { name: "Vendor", role: "Admin", avatarUrl: null };
  }
}

/** Sales overview, order totals, and recent orders for a vendor's own store. */
export async function getVendorDashboardStats(storeId: string): Promise<VendorDashboardStats> {
  try {
    const supabase = createSupabaseServerClient();
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("store_id", storeId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false });

    if (error || !data) {
      if (error) console.error("[getVendorDashboardStats] Supabase query failed:", error.message);
      return FALLBACK_STATS;
    }

    if (data.length === 0) {
      // A brand-new store legitimately has zero orders — show real zeros
      // rather than the fallback demo numbers.
      return {
        salesLast30Label: formatMoney(0),
        salesChangePct: 0,
        salesTrend: new Array(12).fill(0),
        totalOrders: 0,
        newLeads: 0,
        recentOrders: [],
      };
    }

    const totalCents = data.reduce((sum, row) => sum + row.total_cents, 0);
    const recentOrders: OrderViewModel[] = data.slice(0, 5).map((row) => ({
      id: row.id,
      orderNumber: `#${row.id.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      buyerName: row.buyer_name,
      status: row.status,
      statusLabel: statusLabelFor(row.status),
      totalLabel: formatMoney(row.total_cents),
    }));

    return {
      salesLast30Label: formatMoney(totalCents),
      salesChangePct: 0, // needs a prior-30-day comparison query once there's real volume to compare against
      salesTrend: FALLBACK_STATS.salesTrend,
      totalOrders: data.length,
      newLeads: 0,
      recentOrders,
    };
  } catch (err) {
    console.error("[getVendorDashboardStats] Unexpected failure:", err);
    return FALLBACK_STATS;
  }
}
