import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CategoryViewModel, ProductViewModel, StoreViewModel } from "@/types/marketplace";

const ASSET_BUCKET = "app-assets";

/**
 * Static fallbacks mirror the seed rows in
 * supabase/migrations/0002_create_marketplace_core.sql, so the homepage
 * looks correct even before a Supabase project is wired up.
 */
const FALLBACK_CATEGORIES: CategoryViewModel[] = [
  { id: "electronics", name: "Electronics", slug: "electronics", icon: "monitor", href: "/marketplace/categories/electronics" },
  { id: "home", name: "Home", slug: "home", icon: "home", href: "/marketplace/categories/home" },
  { id: "fashion", name: "Fashion", slug: "fashion", icon: "shirt", href: "/marketplace/categories/fashion" },
  { id: "beauty", name: "Beauty", slug: "beauty", icon: "sparkles", href: "/marketplace/categories/beauty" },
  { id: "more", name: "More", slug: "more", icon: "grid-2x2", href: "/marketplace/categories" },
];

const FALLBACK_PRODUCTS: ProductViewModel[] = [
  {
    id: "apex-wireless-headphones",
    name: "Apex Wireless Headphones",
    slug: "apex-wireless-headphones",
    priceLabel: "$149.00",
    imageUrl: null,
    categoryIcon: "monitor",
    ratingAvg: 4.5,
    ratingCount: 128,
    href: "/marketplace/products/apex-wireless-headphones",
  },
  {
    id: "leather-weekend-bag",
    name: "Leather Weekend Bag",
    slug: "leather-weekend-bag",
    priceLabel: "$198.00",
    imageUrl: null,
    categoryIcon: "shirt",
    ratingAvg: 4.6,
    ratingCount: 98,
    href: "/marketplace/products/leather-weekend-bag",
  },
  {
    id: "artisan-ceramic-bowl",
    name: "Artisan Ceramic Bowl",
    slug: "artisan-ceramic-bowl",
    priceLabel: "$65.00",
    imageUrl: null,
    categoryIcon: "home",
    ratingAvg: 4.9,
    ratingCount: 74,
    href: "/marketplace/products/artisan-ceramic-bowl",
  },
  {
    id: "smart-watch-series-8",
    name: "Smart Watch Series 8",
    slug: "smart-watch-series-8",
    priceLabel: "$299.00",
    imageUrl: null,
    categoryIcon: "monitor",
    ratingAvg: 4.4,
    ratingCount: 112,
    href: "/marketplace/products/smart-watch-series-8",
  },
];

const FALLBACK_STORES: StoreViewModel[] = [
  { id: "techhub", name: "TechHub", slug: "techhub", logoUrl: null, avatarColor: "#0f766e", ratingAvg: 4.8, href: "/marketplace/stores/techhub" },
  { id: "craftyhands", name: "CraftyHands", slug: "craftyhands", logoUrl: null, avatarColor: "#fbbf24", ratingAvg: 4.7, href: "/marketplace/stores/craftyhands" },
  { id: "urbanthreads", name: "UrbanThreads", slug: "urbanthreads", logoUrl: null, avatarColor: "#1e293b", ratingAvg: 4.9, href: "/marketplace/stores/urbanthreads" },
  { id: "gadgetmaxx", name: "GadgetMaxx", slug: "gadgetmaxx", logoUrl: null, avatarColor: "#c92a37", ratingAvg: 4.6, href: "/marketplace/stores/gadgetmaxx" },
];

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export async function getCategories(): Promise<CategoryViewModel[]> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error || !data || data.length === 0) {
      if (error) console.error("[getCategories] Supabase query failed:", error.message);
      return FALLBACK_CATEGORIES;
    }

    return data.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      icon: row.icon,
      href: row.slug === "more" ? "/marketplace/categories" : `/marketplace/categories/${row.slug}`,
    }));
  } catch (err) {
    console.error("[getCategories] Unexpected failure:", err);
    return FALLBACK_CATEGORIES;
  }
}

export async function getFeaturedProducts(limit = 4): Promise<ProductViewModel[]> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("products")
      .select("*, categories(icon)")
      .eq("is_active", true)
      .eq("is_featured", true)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data || data.length === 0) {
      if (error) console.error("[getFeaturedProducts] Supabase query failed:", error.message);
      return FALLBACK_PRODUCTS;
    }

    return data.map((row) => {
      const imagePath = row.image_path;
      const imageUrl = imagePath
        ? supabase.storage.from(ASSET_BUCKET).getPublicUrl(imagePath).data.publicUrl
        : null;

      // `categories` comes back as a joined object (or null) via the select above;
      // it isn't part of the base ProductRow type, so we read it defensively.
      const categoryIcon =
        (row as unknown as { categories?: { icon?: string } | null }).categories?.icon ?? "package";

      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        priceLabel: formatPrice(row.price_cents, row.currency),
        imageUrl,
        categoryIcon,
        ratingAvg: Number(row.rating_avg),
        ratingCount: row.rating_count,
        href: `/marketplace/products/${row.slug}`,
      } satisfies ProductViewModel;
    });
  } catch (err) {
    console.error("[getFeaturedProducts] Unexpected failure:", err);
    return FALLBACK_PRODUCTS;
  }
}

export async function getPopularStores(limit = 4): Promise<StoreViewModel[]> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("stores")
      .select("*")
      .eq("is_active", true)
      .order("rating_avg", { ascending: false })
      .limit(limit);

    if (error || !data || data.length === 0) {
      if (error) console.error("[getPopularStores] Supabase query failed:", error.message);
      return FALLBACK_STORES;
    }

    return data.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      logoUrl: row.logo_path
        ? supabase.storage.from(ASSET_BUCKET).getPublicUrl(row.logo_path).data.publicUrl
        : null,
      avatarColor: row.avatar_color,
      ratingAvg: Number(row.rating_avg),
      href: `/marketplace/stores/${row.slug}`,
    }));
  } catch (err) {
    console.error("[getPopularStores] Unexpected failure:", err);
    return FALLBACK_STORES;
  }
}
