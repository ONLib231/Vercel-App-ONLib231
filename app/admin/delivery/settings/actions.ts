"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type SettingsFormState = { error: string | null; success?: boolean };

export async function updateDeliverySettingsAction(
  _prevState: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  await requireAdmin();
  const businessPhone = String(formData.get("business_phone") ?? "").trim();
  const businessEmail = String(formData.get("business_email") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase
    .from("delivery_settings")
    .update({ business_phone: businessPhone || null, business_email: businessEmail || null })
    .eq("id", "business");

  if (error) return { error: error.message };

  revalidatePath("/admin/delivery/settings");
  return { error: null, success: true };
}
