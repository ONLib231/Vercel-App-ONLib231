import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentAuthUser, getNavUser } from "@/lib/user";
import { formatMoney, orderCodeFor, statusLabelFor } from "@/lib/delivery-format";
import type {
  DeliveryAgentRow,
  DeliveryDashboardStats,
  DeliveryExpenseRow,
  DeliveryOrderRow,
  DeliveryOrderViewModel,
  DeliveryPricePresetRow,
  DeliverySettingsRow,
} from "@/types/delivery";

// Re-exported so existing server-only importers (e.g.
// lib/notifications/delivery-notifications.ts) don't need to change their
// import path — this file is still the canonical place to import these from
// on the server. Client Components must import from "@/lib/delivery-format"
// directly instead (see that file's header comment for why).
export { formatMoney, orderCodeFor, statusLabelFor };

function toViewModel(row: DeliveryOrderRow): DeliveryOrderViewModel {
  return {
    id: row.id,
    orderCode: orderCodeFor(row.id),
    senderName: row.sender_name,
    pickupAddress: row.pickup_address,
    dropoffAddress: row.dropoff_address,
    itemDescription: row.item_description,
    amountLabel: formatMoney(row.amount),
    status: row.status,
    statusLabel: statusLabelFor(row.status),
    acceptedBy: row.accepted_by,
    paymentMethod: row.payment_method,
    createdAtLabel: new Date(row.created_at).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

/**
 * Is the current signed-in user the (single, shared) Delivery admin? Same
 * profiles.role = 'admin' used for the Marketplace admin-write policies —
 * one admin tier across the whole platform, not a separate Delivery-only
 * login the way the original standalone app had.
 */
export async function isDeliveryAdmin(): Promise<boolean> {
  const navUser = await getNavUser();
  return navUser?.role === "admin";
}

/** A sender's own delivery orders, newest first — powers the /delivery live tracking list. */
export async function getMyDeliveryOrders(): Promise<DeliveryOrderViewModel[]> {
  try {
    const user = await getCurrentAuthUser();
    if (!user) return [];

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("delivery_orders")
      .select("*")
      .eq("sender_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[getMyDeliveryOrders] Supabase query failed:", error.message);
      return [];
    }
    return (data ?? []).map(toViewModel);
  } catch (err) {
    console.error("[getMyDeliveryOrders] Unexpected failure:", err);
    return [];
  }
}

/** Every order across every sender — admin dispatch board only (RLS enforces this). */
export async function getAllDeliveryOrders(): Promise<DeliveryOrderViewModel[]> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.from("delivery_orders").select("*").order("created_at", { ascending: false });

    if (error) {
      console.error("[getAllDeliveryOrders] Supabase query failed:", error.message);
      return [];
    }
    return (data ?? []).map(toViewModel);
  } catch (err) {
    console.error("[getAllDeliveryOrders] Unexpected failure:", err);
    return [];
  }
}

export async function getDeliveryDashboardStats(): Promise<DeliveryDashboardStats> {
  try {
    const supabase = createSupabaseServerClient();
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const { data, error } = await supabase
      .from("delivery_orders")
      .select("*")
      .gte("created_at", since.toISOString());

    if (error || !data) {
      if (error) console.error("[getDeliveryDashboardStats] Supabase query failed:", error.message);
      return { pendingCount: 0, acceptedCount: 0, deliveredTodayCount: 0, revenueLast30Label: formatMoney(0)! };
    }

    const todayStr = new Date().toDateString();
    const pendingCount = data.filter((o) => o.status === "pending").length;
    const acceptedCount = data.filter((o) => o.status === "accepted" || o.status === "picked_up").length;
    const deliveredTodayCount = data.filter(
      (o) => o.status === "delivered" && o.delivered_at && new Date(o.delivered_at).toDateString() === todayStr
    ).length;
    const revenueLast30 = data
      .filter((o) => o.status === "delivered" && o.amount !== null && o.amount !== undefined)
      .reduce((sum, o) => sum + Number(o.amount), 0);

    return {
      pendingCount,
      acceptedCount,
      deliveredTodayCount,
      revenueLast30Label: formatMoney(revenueLast30)!,
    };
  } catch (err) {
    console.error("[getDeliveryDashboardStats] Unexpected failure:", err);
    return { pendingCount: 0, acceptedCount: 0, deliveredTodayCount: 0, revenueLast30Label: formatMoney(0)! };
  }
}

export async function getDeliverySettings(): Promise<DeliverySettingsRow | null> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.from("delivery_settings").select("*").eq("id", "business").maybeSingle();
    if (error) {
      console.error("[getDeliverySettings] Supabase query failed:", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error("[getDeliverySettings] Unexpected failure:", err);
    return null;
  }
}

export async function getDeliveryAgents(): Promise<DeliveryAgentRow[]> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.from("delivery_agents").select("*").order("name", { ascending: true });
    if (error) {
      console.error("[getDeliveryAgents] Supabase query failed:", error.message);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error("[getDeliveryAgents] Unexpected failure:", err);
    return [];
  }
}

export async function getDeliveryExpenses(): Promise<DeliveryExpenseRow[]> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("delivery_expenses")
      .select("*")
      .order("expense_date", { ascending: false });
    if (error) {
      console.error("[getDeliveryExpenses] Supabase query failed:", error.message);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error("[getDeliveryExpenses] Unexpected failure:", err);
    return [];
  }
}

export async function getDeliveryPricePresets(): Promise<DeliveryPricePresetRow[]> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("delivery_price_presets")
      .select("*")
      .order("amount", { ascending: true });
    if (error) {
      console.error("[getDeliveryPricePresets] Supabase query failed:", error.message);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error("[getDeliveryPricePresets] Unexpected failure:", err);
    return [];
  }
}
