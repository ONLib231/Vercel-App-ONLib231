"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type PresetFormState = { error: string | null };

export async function addPresetAction(_prevState: PresetFormState, formData: FormData): Promise<PresetFormState> {
  await requireAdmin();
  const label = String(formData.get("label") ?? "").trim();
  const amount = Number(formData.get("amount") ?? 0);

  if (!label) return { error: "Label is required." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a valid amount." };

  const supabase = await createClient();
  const { error } = await supabase.from("delivery_price_presets").insert({ label, amount });
  if (error) return { error: error.message };

  revalidatePath("/admin/delivery/presets");
  return { error: null };
}

export async function deletePresetAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const presetId = String(formData.get("preset_id") ?? "");
  if (!presetId) return;

  const supabase = await createClient();
  await supabase.from("delivery_price_presets").delete().eq("id", presetId);

  revalidatePath("/admin/delivery/presets");
}
