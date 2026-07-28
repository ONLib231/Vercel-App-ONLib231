import {
  Grid2x2,
  Home,
  Monitor,
  Package,
  Shirt,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/**
 * Maps the free-text `icon` column on categories/products (see
 * supabase/migrations/0002_create_marketplace_core.sql) to a concrete
 * lucide-react component. Keeping icon names as data (rather than importing
 * components directly in the DB) lets content editors change a category's
 * icon without a code change; unknown values fall back to a generic glyph
 * instead of crashing the page.
 */
const ICON_REGISTRY: Record<string, LucideIcon> = {
  monitor: Monitor,
  home: Home,
  shirt: Shirt,
  sparkles: Sparkles,
  "grid-2x2": Grid2x2,
};

export function getCatalogIcon(name: string): LucideIcon {
  return ICON_REGISTRY[name] ?? Package;
}
