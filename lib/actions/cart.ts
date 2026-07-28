"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { CartItemRow } from "@/types/marketplace";

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

    const { data: existingData, error: fetchError } = await supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("user_id", user.id)
      .eq("product_id", productId)
      .maybeSingle();

    if (fetchError) {
      console.error("[addToCart] Failed to look up existing cart item:", fetchError.message);
      return { ok: false, error: "unknown" };
    }
    // Cast explicitly — .maybeSingle() on a narrow (non-"*") select has been
    // unreliable in this project's pinned @supabase/postgrest-js version,
    // silently resolving to `never` instead of the selected columns' real
    // type (same issue fixed in lib/vendor.ts's getMyStore()).
    const existing = existingData as Pick<CartItemRow, "id" | "quantity"> | null;

    // Cast explicitly — @supabase/postgrest-js's .upsert() generic resolution
    // has been unreliable in this project's pinned version when combined
    // with an `onConflict` option, silently resolving the values parameter
    // to `never[]` instead of the table's real Insert type. Asserting the
    // payload's type directly (rather than relying on inference from an
    // inline object literal) sidesteps that resolution failure.
    const cartItemPayload = {
      user_id: user.id,
      product_id: productId,
      quantity: (existing?.quantity ?? 0) + 1,
    } as Database["public"]["Tables"]["cart_items"]["Insert"];

    const { error: upsertError } = await supabase
      .from("cart_items")
      .upsert(cartItemPayload, { onConflict: "user_id,product_id" });

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
