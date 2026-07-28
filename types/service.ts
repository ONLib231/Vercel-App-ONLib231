/**
 * Mirrors public.service_options (see supabase/migrations/0001_create_service_options.sql)
 */

export type ServiceKey = "delivery" | "marketplace";

export type BadgeIcon = "zap" | "tag";

export type AccentTheme = "verta" | "onlib";

export interface ServiceOptionRow {
  id: string;
  key: ServiceKey;
  title: string;
  subtitle: string;
  badge_label: string;
  badge_icon: BadgeIcon;
  image_path: string;
  accent: AccentTheme;
  route: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * View-model consumed by <ServiceCard />. Derived from ServiceOptionRow by
 * resolving `image_path` to a public Supabase Storage URL.
 */
export interface ServiceOptionViewModel {
  key: ServiceKey;
  title: string;
  subtitle: string;
  badgeLabel: string;
  badgeIcon: BadgeIcon;
  imageUrl: string;
  accent: AccentTheme;
  route: string;
}
