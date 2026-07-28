"use server";

import { revalidatePath } from "next/cache";
import { requireApprovedVendor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";

export type ProductFormState = { error: string | null };

export async function createProductAction(_prevState: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const { store } = await requireApprovedVendor();

  const name = String(formData.get("name") ?? "").trim();
  const priceDollars = Number(formData.get("price") ?? 0);
  const description = String(formData.get("description") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "") || null;

  if (!name) return { error: "Product name is required." };
  if (!Number.isFinite(priceDollars) || priceDollars < 0) return { error: "Enter a valid price." };

  const supabase = await createClient();
  const slug = `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`;

  const { error } = await supabase.from("products").insert({
    store_id: store.id,
    category_id: categoryId,
    name,
    slug,
    description: description || null,
    price_cents: Math.round(priceDollars * 100),
    is_active: true,
  });

  if (error) return { error: error.message };

  revalidatePath("/vendor/dashboard/products");
  return { error: null };
}

export async function toggleProductActiveAction(formData: FormData): Promise<void> {
  const { store } = await requireApprovedVendor();
  const productId = String(formData.get("product_id") ?? "");
  const isActive = formData.get("is_active") === "true";

  const supabase = await createClient();
  await supabase.from("products").update({ is_active: !isActive }).eq("id", productId).eq("store_id", store.id);

  revalidatePath("/vendor/dashboard/products");
}

export async function deleteProductAction(formData: FormData): Promise<void> {
  const { store } = await requireApprovedVendor();
  const productId = String(formData.get("product_id") ?? "");

  const supabase = await createClient();
  await supabase.from("products").delete().eq("id", productId).eq("store_id", store.id);

  revalidatePath("/vendor/dashboard/products");
}
