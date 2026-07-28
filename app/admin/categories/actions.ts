"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";

export type CategoryFormState = { error: string | null };

export async function createCategoryAction(_prevState: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const icon = String(formData.get("icon") ?? "").trim();

  if (!name) return { error: "Name is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("categories").insert({ name, slug: slugify(name), icon: icon || null });
  if (error) return { error: error.message };

  revalidatePath("/admin/categories");
  return { error: null };
}

export async function toggleCategoryActiveAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const categoryId = String(formData.get("category_id") ?? "");
  const isActive = formData.get("is_active") === "true";
  if (!categoryId) return;

  const supabase = await createClient();
  await supabase.from("categories").update({ is_active: !isActive }).eq("id", categoryId);

  revalidatePath("/admin/categories");
}

export async function deleteCategoryAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const categoryId = String(formData.get("category_id") ?? "");
  if (!categoryId) return;

  const supabase = await createClient();
  await supabase.from("categories").delete().eq("id", categoryId);

  revalidatePath("/admin/categories");
}
