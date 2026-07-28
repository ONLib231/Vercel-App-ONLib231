"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/supabase/database.types";

export async function updateDeliveryOrderStatusAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const orderId = String(formData.get("order_id") ?? "");
  const status = String(formData.get("status") ?? "") as Enums<"delivery_status">;
  if (!orderId || !["pending", "accepted", "picked_up", "delivered", "cancelled"].includes(status)) return;

  const supabase = await createClient();
  await supabase.from("delivery_orders").update({ status }).eq("id", orderId);

  revalidatePath("/admin/delivery");
}

export async function assignDeliveryAgentAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const orderId = String(formData.get("order_id") ?? "");
  const agentId = String(formData.get("agent_id") ?? "");
  if (!orderId) return;

  const supabase = await createClient();
  await supabase
    .from("delivery_orders")
    .update({ assigned_agent_id: agentId || null })
    .eq("id", orderId);

  revalidatePath("/admin/delivery");
}
