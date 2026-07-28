// lib/marketplace.ts
// Server-only read queries for the ONLib marketplace. Every function has an
// explicit return type so a Supabase result is never relied on to infer
// correctly at the call site (see the top-of-repo note in
// lib/supabase/database.types.ts for why this matters here).
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Category = Tables<"categories">;
export type Store = Tables<"stores">;
export type Product = Tables<"products">;
export type CartItem = Tables<"cart_items">;
export type WishlistItem = Tables<"wishlist_items">;
export type NotificationRow = Tables<"notifications">;

export async function getActiveCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error }: { data: Category[] | null; error: { message: string } | null } = await supabase
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("getActiveCategories:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getFeaturedProducts(limit = 8): Promise<Product[]> {
  const supabase = await createClient();
  const { data, error }: { data: Product[] | null; error: { message: string } | null } = await supabase
    .from("products")
    .select("*")
    .eq("is_active", true)
    .eq("is_featured", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getFeaturedProducts:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getPopularStores(limit = 4): Promise<Store[]> {
  const supabase = await createClient();
  const { data, error }: { data: Store[] | null; error: { message: string } | null } = await supabase
    .from("stores")
    .select("*")
    .eq("is_active", true)
    .order("rating_avg", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getPopularStores:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const supabase = await createClient();
  const { data, error }: { data: Category | null; error: { message: string } | null } = await supabase
    .from("categories")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("getCategoryBySlug:", error.message);
    return null;
  }
  return data;
}

export async function getProductsByCategoryId(categoryId: string): Promise<Product[]> {
  const supabase = await createClient();
  const { data, error }: { data: Product[] | null; error: { message: string } | null } = await supabase
    .from("products")
    .select("*")
    .eq("category_id", categoryId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getProductsByCategoryId:", error.message);
    return [];
  }
  return data ?? [];
}

export type ProductWithStore = Product & { store: Pick<Store, "id" | "name" | "slug" | "avatar_color" | "logo_path"> | null };

export async function getProductBySlug(slug: string): Promise<ProductWithStore | null> {
  const supabase = await createClient();
  const { data: product, error }: { data: Product | null; error: { message: string } | null } = await supabase
    .from("products")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !product) {
    if (error) console.error("getProductBySlug:", error.message);
    return null;
  }

  const { data: store }: { data: Store | null } = await supabase
    .from("stores")
    .select("*")
    .eq("id", product.store_id)
    .maybeSingle();

  return {
    ...product,
    store: store ? { id: store.id, name: store.name, slug: store.slug, avatar_color: store.avatar_color, logo_path: store.logo_path } : null,
  };
}

export type CartItemWithProduct = CartItem & { product: Product };

export async function getCartItems(userId: string): Promise<CartItemWithProduct[]> {
  const supabase = await createClient();
  const { data: items, error }: { data: CartItem[] | null; error: { message: string } | null } = await supabase
    .from("cart_items")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error || !items || items.length === 0) {
    if (error) console.error("getCartItems:", error.message);
    return [];
  }

  const productIds = items.map((item) => item.product_id);
  const { data: products }: { data: Product[] | null } = await supabase.from("products").select("*").in("id", productIds);
  const productsById = new Map((products ?? []).map((p) => [p.id, p]));

  return items
    .map((item) => {
      const product = productsById.get(item.product_id);
      return product ? { ...item, product } : null;
    })
    .filter((item): item is CartItemWithProduct => item !== null);
}

export async function getCartCount(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error }: { count: number | null; error: { message: string } | null } = await supabase
    .from("cart_items")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    console.error("getCartCount:", error.message);
    return 0;
  }
  return count ?? 0;
}

export type WishlistItemWithProduct = WishlistItem & { product: Product };

export async function getWishlistItems(userId: string): Promise<WishlistItemWithProduct[]> {
  const supabase = await createClient();
  const { data: items, error }: { data: WishlistItem[] | null; error: { message: string } | null } = await supabase
    .from("wishlist_items")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error || !items || items.length === 0) {
    if (error) console.error("getWishlistItems:", error.message);
    return [];
  }

  const productIds = items.map((item) => item.product_id);
  const { data: products }: { data: Product[] | null } = await supabase.from("products").select("*").in("id", productIds);
  const productsById = new Map((products ?? []).map((p) => [p.id, p]));

  return items
    .map((item) => {
      const product = productsById.get(item.product_id);
      return product ? { ...item, product } : null;
    })
    .filter((item): item is WishlistItemWithProduct => item !== null);
}

export async function getWishlistCount(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error }: { count: number | null; error: { message: string } | null } = await supabase
    .from("wishlist_items")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    console.error("getWishlistCount:", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error }: { count: number | null; error: { message: string } | null } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) {
    console.error("getUnreadNotificationCount:", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function getRecentNotifications(userId: string, limit = 10): Promise<NotificationRow[]> {
  const supabase = await createClient();
  const { data, error }: { data: NotificationRow[] | null; error: { message: string } | null } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("getRecentNotifications:", error.message);
    return [];
  }
  return data ?? [];
}
