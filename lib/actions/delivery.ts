"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { getCurrentAuthUser, getNavUser } from "@/lib/user";
import { isDeliveryAdmin } from "@/lib/delivery";
import { notifyAdminNewOrder } from "@/lib/notifications/delivery-notifications";
import type {
  AcceptDeliveryOrderInput,
  AdminUpdateDeliveryOrderInput,
  CreateDeliveryOrderInput,
  DeliveryOrderRow,
} from "@/types/delivery";

export interface DeliveryActionResult {
  ok: boolean;
  error?: string;
}

// The original standalone app required this on top of "logged in as admin"
// for destructive actions (bulk order delete, expense delete) — same
// behavior, now a plain environment variable rather than a platform-specific
// one. Defaults to "SKY" to match the original app's default.
function deletePassword(): string {
  return process.env.DELIVERY_DELETE_PASSWORD || "SKY";
}

// ---------------------------------------------------------------------------
// Sender actions — run as the signed-in user, protected by RLS (see
// 0006_create_delivery_module.sql), not by a service-role bypass.
// ---------------------------------------------------------------------------

/** Places a new delivery order as the signed-in sender. */
export async function createDeliveryOrder(input: CreateDeliveryOrderInput): Promise<DeliveryActionResult> {
  try {
    const user = await getCurrentAuthUser();
    if (!user) return { ok: false, error: "Please log in to place a delivery order." };

    const pickupAddress = input.pickupAddress?.trim();
    const dropoffAddress = input.dropoffAddress?.trim();
    const itemDescription = input.itemDescription?.trim();
    if (!pickupAddress || !dropoffAddress || !itemDescription) {
      return { ok: false, error: "Pickup address, dropoff address, and item description are all required." };
    }

    const navUser = await getNavUser();
    const senderName = navUser?.name ?? user.email ?? "Customer";
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("delivery_orders")
      .insert({
        sender_id: user.id,
        sender_name: senderName,
        pickup_address: pickupAddress,
        dropoff_address: dropoffAddress,
        item_description: itemDescription,
        status: "pending",
        placed_by_admin: false,
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error("[createDeliveryOrder] Insert failed:", error?.message);
      return { ok: false, error: "Couldn't place your order. Please try again." };
    }

    // Best-effort — never blocks the sender's success response on Twilio/SendGrid.
    await notifyAdminNewOrder({
      orderId: data.id,
      senderName,
      pickupAddress,
      dropoffAddress,
      itemDescription,
    });

    revalidatePath("/delivery");
    return { ok: true };
  } catch (err) {
    console.error("[createDeliveryOrder] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong placing your order. Please try again." };
  }
}

/** Cancels the signed-in sender's own order — only while it's still pending (RLS enforces both). */
export async function cancelDeliveryOrder(orderId: string): Promise<DeliveryActionResult> {
  try {
    const user = await getCurrentAuthUser();
    if (!user) return { ok: false, error: "Please log in." };

    const supabase = createSupabaseServerClient();
    const { error } = await supabase
      .from("delivery_orders")
      .update({ status: "cancelled" })
      .eq("id", orderId)
      .eq("sender_id", user.id);

    if (error) {
      console.error("[cancelDeliveryOrder] Update failed:", error.message);
      return { ok: false, error: "Couldn't cancel this order — it may have already been accepted by an agent." };
    }

    revalidatePath("/delivery");
    return { ok: true };
  } catch (err) {
    console.error("[cancelDeliveryOrder] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong cancelling your order. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Admin actions — every one re-checks profiles.role === 'admin' server-side
// (never trust the client) before using the service-role client to bypass
// RLS, same pattern as lib/actions/vendor.ts#submitVendorApplication.
// ---------------------------------------------------------------------------

async function requireDeliveryAdmin(): Promise<DeliveryActionResult | null> {
  if (!(await isDeliveryAdmin())) {
    return { ok: false, error: "Admin access required." };
  }
  return null;
}

/** Accept a pending order: assign an agent, amount, and payment method. */
export async function acceptDeliveryOrder(input: AcceptDeliveryOrderInput): Promise<DeliveryActionResult> {
  const denied = await requireDeliveryAdmin();
  if (denied) return denied;

  try {
    if (!input.acceptedBy?.trim()) return { ok: false, error: "Choose an agent to assign this order to." };
    if (input.amount === undefined || input.amount === null || isNaN(input.amount) || input.amount < 0) {
      return { ok: false, error: "Enter a valid, non-negative delivery amount." };
    }

    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase
      .from("delivery_orders")
      .update({
        amount: input.amount,
        accepted_by: input.acceptedBy.trim(),
        payment_method: input.paymentMethod ?? null,
        status: "accepted",
        accepted_at: new Date().toISOString(),
      })
      .eq("id", input.orderId);

    if (error) {
      console.error("[acceptDeliveryOrder] Update failed:", error.message);
      return { ok: false, error: "Couldn't accept this order. Please try again." };
    }

    revalidatePath("/delivery/admin");
    return { ok: true };
  } catch (err) {
    console.error("[acceptDeliveryOrder] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong accepting this order. Please try again." };
  }
}

/** Move an order forward (accepted -> picked_up -> delivered), or make other admin edits. */
export async function updateDeliveryOrder(input: AdminUpdateDeliveryOrderInput): Promise<DeliveryActionResult> {
  const denied = await requireDeliveryAdmin();
  if (denied) return denied;

  try {
    const fields: Partial<DeliveryOrderRow> = {};
    if (input.status) {
      fields.status = input.status;
      if (input.status === "picked_up") fields.picked_up_at = new Date().toISOString();
      if (input.status === "delivered") fields.delivered_at = new Date().toISOString();
    }
    if (input.amount !== undefined) fields.amount = input.amount;
    if (input.acceptedBy !== undefined) fields.accepted_by = input.acceptedBy;
    if (input.paymentMethod !== undefined) fields.payment_method = input.paymentMethod;

    if (Object.keys(fields).length === 0) return { ok: true };

    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase.from("delivery_orders").update(fields).eq("id", input.orderId);

    if (error) {
      console.error("[updateDeliveryOrder] Update failed:", error.message);
      return { ok: false, error: "Couldn't update this order. Please try again." };
    }

    revalidatePath("/delivery/admin");
    return { ok: true };
  } catch (err) {
    console.error("[updateDeliveryOrder] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong updating this order. Please try again." };
  }
}

/** Bulk delete orders — requires the delete password, same as the original app's confirmation gate. */
export async function deleteDeliveryOrders(orderIds: string[], password: string): Promise<DeliveryActionResult> {
  const denied = await requireDeliveryAdmin();
  if (denied) return denied;
  if (password !== deletePassword()) return { ok: false, error: "Incorrect delete password." };
  if (!orderIds.length) return { ok: true };

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase.from("delivery_orders").delete().in("id", orderIds);
    if (error) {
      console.error("[deleteDeliveryOrders] Delete failed:", error.message);
      return { ok: false, error: "Couldn't delete these orders. Please try again." };
    }
    revalidatePath("/delivery/admin");
    return { ok: true };
  } catch (err) {
    console.error("[deleteDeliveryOrders] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong deleting these orders. Please try again." };
  }
}

// ---- Fleet Directory (agents) — admin-managed roster, not login accounts ----

export async function createDeliveryAgent(name: string, phone: string): Promise<DeliveryActionResult> {
  const denied = await requireDeliveryAdmin();
  if (denied) return denied;
  if (!name?.trim() || !phone?.trim()) return { ok: false, error: "Name and phone are required." };

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase.from("delivery_agents").insert({ name: name.trim(), phone: phone.trim() });
    if (error) {
      console.error("[createDeliveryAgent] Insert failed:", error.message);
      return { ok: false, error: "Couldn't add this agent. Please try again." };
    }
    revalidatePath("/delivery/admin/fleet");
    return { ok: true };
  } catch (err) {
    console.error("[createDeliveryAgent] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong adding this agent. Please try again." };
  }
}

export async function updateDeliveryAgent(id: string, name: string, phone: string): Promise<DeliveryActionResult> {
  const denied = await requireDeliveryAdmin();
  if (denied) return denied;
  if (!name?.trim() || !phone?.trim()) return { ok: false, error: "Name and phone are required." };

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase
      .from("delivery_agents")
      .update({ name: name.trim(), phone: phone.trim() })
      .eq("id", id);
    if (error) {
      console.error("[updateDeliveryAgent] Update failed:", error.message);
      return { ok: false, error: "Couldn't update this agent. Please try again." };
    }
    revalidatePath("/delivery/admin/fleet");
    return { ok: true };
  } catch (err) {
    console.error("[updateDeliveryAgent] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong updating this agent. Please try again." };
  }
}

export async function setDeliveryAgentDutyStatus(
  id: string,
  dutyStatus: "on_duty" | "off_duty"
): Promise<DeliveryActionResult> {
  const denied = await requireDeliveryAdmin();
  if (denied) return denied;

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase.from("delivery_agents").update({ duty_status: dutyStatus }).eq("id", id);
    if (error) {
      console.error("[setDeliveryAgentDutyStatus] Update failed:", error.message);
      return { ok: false, error: "Couldn't update duty status. Please try again." };
    }
    revalidatePath("/delivery/admin/fleet");
    return { ok: true };
  } catch (err) {
    console.error("[setDeliveryAgentDutyStatus] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong updating duty status. Please try again." };
  }
}

// ---- Expenses (admin only) ----

export async function createDeliveryExpense(
  expenseDate: string,
  amount: number,
  description: string
): Promise<DeliveryActionResult> {
  const denied = await requireDeliveryAdmin();
  if (denied) return denied;
  if (!description?.trim() || isNaN(amount) || amount < 0) {
    return { ok: false, error: "A description and a valid, non-negative amount are required." };
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase
      .from("delivery_expenses")
      .insert({ expense_date: expenseDate, amount, description: description.trim() });
    if (error) {
      console.error("[createDeliveryExpense] Insert failed:", error.message);
      return { ok: false, error: "Couldn't add this expense. Please try again." };
    }
    revalidatePath("/delivery/admin/expenses");
    return { ok: true };
  } catch (err) {
    console.error("[createDeliveryExpense] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong adding this expense. Please try again." };
  }
}

export async function deleteDeliveryExpense(id: string, password: string): Promise<DeliveryActionResult> {
  const denied = await requireDeliveryAdmin();
  if (denied) return denied;
  if (password !== deletePassword()) return { ok: false, error: "Incorrect delete password." };

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase.from("delivery_expenses").delete().eq("id", id);
    if (error) {
      console.error("[deleteDeliveryExpense] Delete failed:", error.message);
      return { ok: false, error: "Couldn't delete this expense. Please try again." };
    }
    revalidatePath("/delivery/admin/expenses");
    return { ok: true };
  } catch (err) {
    console.error("[deleteDeliveryExpense] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong deleting this expense. Please try again." };
  }
}

// ---- Pricing presets (admin only) ----

export async function createDeliveryPricePreset(label: string, amount: number): Promise<DeliveryActionResult> {
  const denied = await requireDeliveryAdmin();
  if (denied) return denied;
  if (!label?.trim() || isNaN(amount) || amount < 0) {
    return { ok: false, error: "A label and a valid, non-negative amount are required." };
  }

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase.from("delivery_price_presets").insert({ label: label.trim(), amount });
    if (error) {
      console.error("[createDeliveryPricePreset] Insert failed:", error.message);
      return { ok: false, error: "Couldn't save this price preset. Please try again." };
    }
    revalidatePath("/delivery/admin/pricing");
    return { ok: true };
  } catch (err) {
    console.error("[createDeliveryPricePreset] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong saving this price preset. Please try again." };
  }
}

export async function deleteDeliveryPricePreset(id: string): Promise<DeliveryActionResult> {
  const denied = await requireDeliveryAdmin();
  if (denied) return denied;

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase.from("delivery_price_presets").delete().eq("id", id);
    if (error) {
      console.error("[deleteDeliveryPricePreset] Delete failed:", error.message);
      return { ok: false, error: "Couldn't delete this price preset. Please try again." };
    }
    revalidatePath("/delivery/admin/pricing");
    return { ok: true };
  } catch (err) {
    console.error("[deleteDeliveryPricePreset] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong deleting this price preset. Please try again." };
  }
}

// ---- Business settings (admin only) ----
// Logo upload isn't ported in this pass — see supabase/migrations/0006's
// header for what's deferred. Text fields only for now.

export interface DeliverySettingsInput {
  businessName?: string;
  businessEmail?: string;
  businessPhone?: string;
  businessAddress?: string;
  businessDescription?: string;
  openingTime?: string;
  closingTime?: string;
  openDays?: string[];
  currency?: string;
  timezone?: string;
}

export async function updateDeliverySettings(input: DeliverySettingsInput): Promise<DeliveryActionResult> {
  const denied = await requireDeliveryAdmin();
  if (denied) return denied;

  try {
    const supabase = createSupabaseServiceRoleClient();
    const { error } = await supabase
      .from("delivery_settings")
      .update({
        business_name: input.businessName,
        business_email: input.businessEmail,
        business_phone: input.businessPhone,
        business_address: input.businessAddress,
        business_description: input.businessDescription,
        opening_time: input.openingTime,
        closing_time: input.closingTime,
        open_days: input.openDays,
        currency: input.currency,
        timezone: input.timezone,
      })
      .eq("id", "business");

    if (error) {
      console.error("[updateDeliverySettings] Update failed:", error.message);
      return { ok: false, error: "Couldn't save settings. Please try again." };
    }
    revalidatePath("/delivery/admin/settings");
    return { ok: true };
  } catch (err) {
    console.error("[updateDeliverySettings] Unexpected failure:", err);
    return { ok: false, error: "Something went wrong saving settings. Please try again." };
  }
}
