"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AddToCartResult {
  ok: boolean;
  error?: "sign_in_required" | "product_not_found" | "unknown";
}

/**
 * Adds one unit of `productId` to the signed-in user's cart (upserting the
 * quantity if it's already there). Backs the "Add to Cart" button on the
 * marketplace product cards.
 */
export async function addToCart(productId: string): Promise<AddToCartResult> {
  try {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { ok: false, error: "sign_in_required" };
    }

    const { data: existing, error: fetchError } = await supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("user_id", user.id)
      .eq("product_id", productId)
      .maybeSingle();

    if (fetchError) {
      console.error("[addToCart] Failed to look up existing cart item:", fetchError.message);
      return { ok: false, error: "unknown" };
    }

    const { error: upsertError } = await supabase.from("cart_items").upsert(
      {
        user_id: user.id,
        product_id: productId,
        quantity: (existing?.quantity ?? 0) + 1,
      },
      { onConflict: "user_id,product_id" }
    );

    if (upsertError) {
      console.error("[addToCart] Failed to upsert cart item:", upsertError.message);
      return { ok: false, error: "unknown" };
    }

    revalidatePath("/marketplace");
    return { ok: true };
  } catch (err) {
    console.error("[addToCart] Unexpected failure:", err);
    return { ok: false, error: "unknown" };
  }
}
