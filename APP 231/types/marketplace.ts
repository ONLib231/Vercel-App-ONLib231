/**
 * Mirrors the tables created in
 * supabase/migrations/0002_create_marketplace_core.sql
 */

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  icon: string; // lucide-react icon name
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface StoreRow {
  id: string;
  owner_id: string | null;
  name: string;
  slug: string;
  logo_path: string | null;
  avatar_color: string;
  rating_avg: number;
  rating_count: number;
  is_active: boolean;
  created_at: string;
}

export interface ProductRow {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  slug: string;
  price_cents: number;
  currency: string;
  image_path: string | null;
  rating_avg: number;
  rating_count: number;
  is_featured: boolean;
  is_active: boolean;
  created_at: string;
}

export interface CartItemRow {
  id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  created_at: string;
  updated_at: string;
}

export interface WishlistItemRow {
  id: string;
  user_id: string;
  product_id: string;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// View models consumed by components
// ---------------------------------------------------------------------------

export interface CategoryViewModel {
  id: string;
  name: string;
  slug: string;
  icon: string;
  href: string;
}

export interface StoreViewModel {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  avatarColor: string;
  ratingAvg: number;
  href: string;
}

export interface ProductViewModel {
  id: string;
  name: string;
  slug: string;
  priceLabel: string;
  imageUrl: string | null;
  categoryIcon: string;
  ratingAvg: number;
  ratingCount: number;
  href: string;
}

export interface NavUser {
  name: string;
  role: string;
  avatarUrl: string | null;
}

export interface HeaderCounts {
  cart: number;
  wishlist: number;
  notifications: number;
}
