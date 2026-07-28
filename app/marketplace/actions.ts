"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/marketplace");
  }
  return user.id;
}

export async function addToCartAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const productId = String(formData.get("product_id") ?? "");
  if (!productId) return;

  const supabase = await createClient();
  const { data: existing }: { data: { id: string; quantity: number } | null } = await supabase
    .from("cart_items")
    .select("id, quantity")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();

  if (existing) {
    await supabase.from("cart_items").update({ quantity: existing.quantity + 1 }).eq("id", existing.id);
  } else {
    await supabase.from("cart_items").upsert(
      { user_id: userId, product_id: productId, quantity: 1 },
      { onConflict: "user_id,product_id" }
    );
  }

  revalidatePath("/marketplace", "layout");
}

export async function updateCartQuantityAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const itemId = String(formData.get("item_id") ?? "");
  const quantity = Number(formData.get("quantity") ?? 1);
  if (!itemId) return;

  const supabase = await createClient();
  if (quantity <= 0) {
    await supabase.from("cart_items").delete().eq("id", itemId).eq("user_id", userId);
  } else {
    await supabase.from("cart_items").update({ quantity }).eq("id", itemId).eq("user_id", userId);
  }

  revalidatePath("/marketplace/cart");
  revalidatePath("/marketplace", "layout");
}

export async function removeFromCartAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const itemId = String(formData.get("item_id") ?? "");
  if (!itemId) return;

  const supabase = await createClient();
  await supabase.from("cart_items").delete().eq("id", itemId).eq("user_id", userId);

  revalidatePath("/marketplace/cart");
  revalidatePath("/marketplace", "layout");
}

export async function toggleWishlistAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const productId = String(formData.get("product_id") ?? "");
  if (!productId) return;

  const supabase = await createClient();
  const { data: existing }: { data: { id: string } | null } = await supabase
    .from("wishlist_items")
    .select("id")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();

  if (existing) {
    await supabase.from("wishlist_items").delete().eq("id", existing.id);
  } else {
    await supabase.from("wishlist_items").upsert(
      { user_id: userId, product_id: productId },
      { onConflict: "user_id,product_id" }
    );
  }

  revalidatePath("/marketplace", "layout");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const userId = await requireUserId();
  const supabase = await createClient();
  await supabase.from("notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false);
  revalidatePath("/marketplace", "layout");
}
