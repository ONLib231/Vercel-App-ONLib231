"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedVendor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/supabase/database.types";

export async function updateOrderStatusAction(formData: FormData): Promise<void> {
  const { store } = await requireApprovedVendor();
  const orderId = String(formData.get("order_id") ?? "");
  const status = String(formData.get("status") ?? "") as Enums<"order_status">;

  if (!orderId || !["pending", "processing", "fulfilled", "cancelled"].includes(status)) return;

  const supabase = await createClient();
  await supabase.from("orders").update({ status }).eq("id", orderId).eq("store_id", store.id);

  revalidatePath("/vendor/dashboard/orders");
  revalidatePath("/vendor/dashboard");
}
