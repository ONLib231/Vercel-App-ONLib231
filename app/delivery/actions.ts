"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { notifyNewDeliveryOrder } from "@/lib/notifications/send-delivery-notification";
import type { Tables } from "@/lib/supabase/database.types";

export type DeliveryOrderState = { error: string | null };

export async function createDeliveryOrderAction(
  _prevState: DeliveryOrderState,
  formData: FormData
): Promise<DeliveryOrderState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/delivery");
  }

  const senderName = String(formData.get("sender_name") ?? "").trim();
  const senderPhone = String(formData.get("sender_phone") ?? "").trim();
  const pickupAddress = String(formData.get("pickup_address") ?? "").trim();
  const dropoffAddress = String(formData.get("dropoff_address") ?? "").trim();
  const itemDescription = String(formData.get("item_description") ?? "").trim();

  if (!senderName || !pickupAddress || !dropoffAddress || !itemDescription) {
    return { error: "Sender name, pickup address, dropoff address, and item description are all required." };
  }

  const { data: order, error }: { data: Tables<"delivery_orders"> | null; error: { message: string } | null } = await supabase
    .from("delivery_orders")
    .insert({
      sender_id: user.id,
      sender_name: senderName,
      sender_phone: senderPhone || null,
      pickup_address: pickupAddress,
      dropoff_address: dropoffAddress,
      item_description: itemDescription,
    })
    .select("*")
    .single();

  if (error || !order) {
    return { error: error?.message ?? "Could not place your delivery order. Please try again." };
  }

  // The order already succeeded above. Notification fan-out is best-effort
  // and time-boxed (see lib/notifications/send-delivery-notification.ts) —
  // its failures are logged, never surfaced to the sender, and never undo
  // the order.
  try {
    const results = await notifyNewDeliveryOrder(order);
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.warn(
        `notifyNewDeliveryOrder: ${failed.length}/${results.length} channel(s) failed for order ${order.id}:`,
        failed.map((f) => `${f.channel}: ${f.error}`).join("; ")
      );
    }
  } catch (notifyError) {
    console.error("notifyNewDeliveryOrder threw unexpectedly:", notifyError);
  }

  redirect(`/delivery?placed=${order.id}`);
}
